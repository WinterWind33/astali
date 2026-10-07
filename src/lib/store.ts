import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import {
  cancelWrites,
  flushWrites,
  hasPendingWrite,
  isOwnWrite,
  join,
  listDir,
  normPath,
  pathExists,
  readText,
  removePath,
  scheduleWrite,
  setWriteErrorHandler,
  writeNow,
} from "./fs";
import { GitHubError, fetchBranchPr, fetchRepoIssues, fetchRepoLabels, fetchTokenStatus, repoChanged } from "./github";
import { decisionFileName, decisionLength, normalizeDecision } from "./decisions";
import { doneColumn, followLabels, isViewColumn } from "./labelColumns";
import { hasTag, tagColumnName, tagColor, tagKey } from "./tags";
import { clip, newNote, normalizeNoteLimit, noteLength } from "./notes";
import { linkTasks, pruneLinks, retargetLinks, unlinkTasks, type LinkKind, type TaskRef } from "./links";
import type {
  ArchivedTask,
  AppConfig,
  BranchPr,
  Board,
  BoardEntry,
  Color,
  Column,
  Decision,
  DecisionEntry,
  GhIssue,
  GhLabel,
  GitStatus,
  HistoryEntry,
  RepoInfo,
  IssueCache,
  Project,
  ProjectEntry,
  ProjectView,
  Note,
  Plan,
  RepoRef,
  Route,
  Task,
  Theme,
} from "./types";
import { now, repoKey, slugify, uid } from "./util";
import { compareVersions, releasesBetween } from "./changelog";
import {
  boardFile,
  boardFileName,
  boardsDir,
  decisionFile,
  ensureVault,
  writeVaultName,
  issueCacheFile,
  loadDecisions,
  loadIssueCache,
  loadProjects,
  newBoard,
  newColumn,
  newNotesBoard,
  newPlanBoard,
  normalizeBoard,
  normalizeProject,
  normalizeTask,
  projectDir,
  projectFile,
} from "./vault";

const STALE_MS = 15 * 60 * 1000;

const DEFAULT_CONFIG: AppConfig = {
  recentVaults: [],
  vaultNames: {},
  lastVault: null,
  githubToken: "",
  githubTokenExpiresAt: null,
  theme: "dark",
  seasonalThemes: false,
  checkForUpdates: true,
  dismissedGitPrompts: [],
  favoriteColors: [],
};

/** What is known about the saved GitHub token. "ok" also covers "couldn't ask, but not past its expiry". */
export interface GithubAuth {
  state: "ok" | "expired" | "invalid";
  expiresAt: string | null;
}

export interface Toast {
  id: string;
  message: string;
  kind: "info" | "error" | "success";
}

interface State {
  ready: boolean;
  config: AppConfig;
  vault: string | null;
  projects: ProjectEntry[];
  route: Route;
  /** Boards of the currently open project, keyed by board id. */
  boards: Record<string, BoardEntry>;
  /** Decisions of the currently open project, keyed by decision id. */
  decisions: Record<string, DecisionEntry>;
  issues: IssueCache;
  syncing: boolean;
  toasts: Toast[];
  /** Git repository enclosing the vault, or null when there is none. */
  git: GitStatus | null;
  /** Branch and pending changes of that repository, or null outside a repo / without git. */
  repo: RepoInfo | null;
  /** Open pull request for the current branch, when it tracks a GitHub branch that has one. */
  pr: BranchPr | null;
  /** The saved GitHub token's status; null without a token or before it is checked. */
  githubAuth: GithubAuth | null;
  /** Recent vaults whose folder was not found at the last check (renamed, moved or deleted). */
  missingVaults: string[];
  /** Set after an update until its news are read: the version used before (null when unknown) and now. */
  whatsNew: { from: string | null; to: string } | null;
  /** Bumped whenever the vault's history log changes, so views listing it reload. */
  historyRev: number;
  /** Task cards briefly highlighted after jumping to them from the activity view. */
  highlight: string[];
  /** A task to open once its board is shown (following a link from another board). */
  pendingTask: string | null;
}

const initial: State = {
  ready: false,
  config: DEFAULT_CONFIG,
  vault: null,
  projects: [],
  route: { name: "home" },
  boards: {},
  decisions: {},
  issues: { repos: {} },
  syncing: false,
  toasts: [],
  git: null,
  repo: null,
  pr: null,
  githubAuth: null,
  missingVaults: [],
  whatsNew: null,
  historyRev: 0,
  highlight: [],
  pendingTask: null,
};

export const useStore = create<State>(() => initial);
const get = useStore.getState;
const set = useStore.setState;

// ---------------------------------------------------------------- selectors / helpers

export function currentProject(s: State = get()): ProjectEntry | undefined {
  return s.route.name === "project"
    ? s.projects.find((p) => p.project.id === (s.route as { projectId: string }).projectId)
    : undefined;
}

export function orderedBoards(s: State = get()): Board[] {
  const p = currentProject(s);
  const all = Object.values(s.boards).map((b) => b.board);
  const order = p?.project.boardOrder ?? [];
  return all.sort((a, b) => {
    const ia = order.indexOf(a.id),
      ib = order.indexOf(b.id);
    if (ia === -1 && ib === -1) return a.createdAt.localeCompare(b.createdAt);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function requireVault(): string {
  const v = get().vault;
  if (!v) throw new Error("No vault open");
  return v;
}

// ---------------------------------------------------------------- toasts

export function toast(message: string, kind: Toast["kind"] = "info") {
  const id = uid();
  set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 6000 : 3200);
}

setWriteErrorHandler((path, e) => toast(`Could not save ${path.split("/").pop()}: ${e}`, "error"));

// ---------------------------------------------------------------- app config

/**
 * Whether the settings on disk were read (or found missing, or set aside as unreadable). Until then
 * nothing is saved, so a save can never replace the user's settings with the defaults.
 */
let configLoaded = false;

/**
 * The GitHub token is kept in the OS credential store, never in the settings file, unless the system
 * has no credential store (e.g. a Linux desktop without the Secret Service): then it stays in the file (D-7).
 */
let tokenInFile = false;
// Dev builds share the settings file with the installed app, which may be older and read the token only from there.
const keepTokenInFile = () => tokenInFile || import.meta.env.DEV;

async function saveConfig(config: AppConfig) {
  set({ config });
  if (!configLoaded) return;
  const { githubToken: _, ...rest } = config;
  await invoke("save_app_config", { contents: JSON.stringify(keepTokenInFile() ? config : rest, null, 2) });
}

/** The saved GitHub token, moving one still in the settings file (before 1.7.0) to the credential store. */
async function loadGithubToken(fromFile: string): Promise<string> {
  try {
    if (!fromFile.trim()) return (await invoke<string | null>("load_github_token")) ?? "";
    await invoke("save_github_token", { token: fromFile });
    return fromFile;
  } catch (e) {
    console.error("credential store unavailable", e);
    tokenInFile = true;
    return fromFile;
  }
}

export function setTheme(theme: Theme) {
  saveConfig({ ...get().config, theme });
}

export function setSeasonalThemes(seasonalThemes: boolean) {
  saveConfig({ ...get().config, seasonalThemes });
}

export function setCheckForUpdates(checkForUpdates: boolean) {
  saveConfig({ ...get().config, checkForUpdates });
}

export async function setGithubToken(githubToken: string) {
  if (!tokenInFile) {
    try {
      await invoke("save_github_token", { token: githubToken });
    } catch (e) {
      tokenInFile = true;
      toast(
        `The system's credential store couldn't be reached, so the token is kept in Astali's settings file instead: ${e}`,
        "error",
      );
    }
  }
  saveConfig({ ...get().config, githubToken, githubTokenExpiresAt: null });
  checkGithubToken();
}

/** Whether the saved GitHub token needs replacing (expired or rejected), for the red dots. */
export function githubTokenProblem(s: State = get()): boolean {
  const a = s.githubAuth;
  return !!a && (a.state !== "ok" || (!!a.expiresAt && Date.parse(a.expiresAt) <= Date.now()));
}

/** Dev builds only: a token state to show whatever GitHub says, to try the red dots and messages. */
export type GithubAuthOverride = "auto" | "valid" | "expiring" | "expired" | "invalid";
let authOverride: GithubAuthOverride = "auto";
export const githubAuthOverride = () => authOverride;

export function setGithubAuthOverride(o: GithubAuthOverride) {
  authOverride = o;
  checkGithubToken();
}

function overriddenAuth(o: Exclude<GithubAuthOverride, "auto">): GithubAuth {
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
  if (o === "valid") return { state: "ok", expiresAt: inDays(90) };
  if (o === "expiring") return { state: "ok", expiresAt: inDays(3) };
  if (o === "expired") return { state: "expired", expiresAt: inDays(-2) };
  return { state: "invalid", expiresAt: null };
}

/** Asks GitHub whether the saved token still works and when it expires. */
export async function checkGithubToken() {
  if (import.meta.env.DEV && authOverride !== "auto") return set({ githubAuth: overriddenAuth(authOverride) });
  const { githubToken: token, githubTokenExpiresAt: known } = get().config;
  if (!token.trim()) return set({ githubAuth: null });
  try {
    const { valid, expiresAt } = await fetchTokenStatus(token);
    if (get().config.githubToken !== token) return; // replaced while we were asking
    if (!valid) return tokenRejected();
    set({ githubAuth: { state: "ok", expiresAt } });
    if (expiresAt !== known) saveConfig({ ...get().config, githubTokenExpiresAt: expiresAt });
  } catch {
    // Offline or GitHub down: go by the expiry it reported last time.
    set({ githubAuth: known ? { state: Date.parse(known) <= Date.now() ? "expired" : "ok", expiresAt: known } : null });
  }
}

/** GitHub answered 401 to the saved token: past its last known expiry it expired, otherwise it was revoked or mistyped. */
function tokenRejected() {
  if (import.meta.env.DEV && authOverride !== "auto") return;
  const expiresAt = get().config.githubTokenExpiresAt;
  set({ githubAuth: { state: expiresAt && Date.parse(expiresAt) <= Date.now() ? "expired" : "invalid", expiresAt } });
}

export function addFavoriteColor(name: string, hex: string) {
  const c = get().config;
  saveConfig({ ...c, favoriteColors: [...c.favoriteColors, { id: uid(), name: name.trim() || hex, hex }] });
}

export function renameFavoriteColor(id: string, name: string) {
  const c = get().config;
  saveConfig({
    ...c,
    favoriteColors: c.favoriteColors.map((f) => (f.id === id ? { ...f, name: name.trim() || f.hex } : f)),
  });
}

export function removeFavoriteColor(id: string) {
  const c = get().config;
  saveConfig({ ...c, favoriteColors: c.favoriteColors.filter((f) => f.id !== id) });
}

export async function init() {
  let config = DEFAULT_CONFIG;
  let firstRun = false;
  try {
    const raw = await invoke<string | null>("load_app_config");
    firstRun = !raw;
    if (raw) {
      try {
        // Settings this version doesn't know (from a newer one) are kept and saved back as they were.
        config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      } catch {
        const kept = await invoke<string>("set_aside_app_config");
        toast(
          `Your settings file couldn't be read, so Astali started with default settings. The old file was kept as ${kept}.`,
          "error",
        );
      }
    }
    if (!Array.isArray(config.favoriteColors)) config.favoriteColors = [];
    const fileToken = config.githubToken ?? "";
    config = { ...config, githubToken: await loadGithubToken(fileToken) };
    configLoaded = true;
    // A token moved to the credential store leaves the settings file.
    if (fileToken.trim() && !keepTokenInFile()) await saveConfig(config).catch((e) => console.error(e));
  } catch (e) {
    // Couldn't even read the file: keep the defaults for this session, but don't save over it.
    console.error(e);
    toast(`Your settings couldn't be loaded, so changes to them won't be saved this session: ${e}`, "error");
  }
  set({ config });
  checkRecentVaults();
  checkGithubToken();
  checkWhatsNew(firstRun);
  if (config.lastVault && (await pathExists(config.lastVault))) {
    await openVault(config.lastVault).catch((e) => toast(String(e), "error"));
  }
  set({ ready: true });
}

// ---------------------------------------------------------------- what's new

/**
 * After an update, offers the news of the versions since the one last used. A first run has nothing to
 * catch up on; settings from before this was tracked count as an update from an unknown version.
 */
async function checkWhatsNew(firstRun: boolean) {
  const version = await getVersion().catch(() => null);
  if (!version) return;
  const seen = get().config.lastSeenVersion ?? null;
  if (seen && compareVersions(seen, version) >= 0) return;
  if (firstRun || releasesBetween(seen, version).length === 0)
    return saveConfig({ ...get().config, lastSeenVersion: version });
  set({ whatsNew: { from: seen, to: version } });
}

/** The news were read: they aren't offered again until the next update. */
export function dismissWhatsNew() {
  const w = get().whatsNew;
  if (!w) return;
  set({ whatsNew: null });
  saveConfig({ ...get().config, lastSeenVersion: w.to });
}

// ---------------------------------------------------------------- vault

export async function pickVault() {
  const dir = await openDialog({ directory: true, multiple: false, title: "Choose a folder for your vault" });
  if (typeof dir === "string") await openVault(dir);
}

export async function openVault(path: string) {
  const vault = path.replace(/\\/g, "/").replace(/\/+$/, "");
  // Finish saving the vault we are leaving before its state is dropped.
  if (get().vault) await flushWrites().catch(() => {});
  const name = await ensureVault(vault);
  const projects = await loadProjects(vault);
  set({ vault, projects, route: { name: "home" }, boards: {}, decisions: {}, issues: { repos: {} } });
  set({ repo: null, pr: null });
  prLookup = { key: "", at: 0 };
  await Promise.all([refreshGit(), refreshRepo()]);
  const { config } = get();
  const recentVaults = [vault, ...config.recentVaults.filter((v) => v !== vault)].slice(0, 8);
  await saveConfig({
    ...config,
    lastVault: vault,
    recentVaults,
    vaultNames: withVaultName(config.vaultNames, vault, name, recentVaults),
  });
  await invoke("watch_vault", { path: vault }).catch((e) => console.error("watch failed", e));
}

/** The names cache with `vault`'s name set (or dropped for none), keeping only vaults still listed. */
function withVaultName(names: Record<string, string>, vault: string, name: string | undefined, keep: string[]) {
  const out = Object.fromEntries(Object.entries(names).filter(([v]) => v !== vault && keep.includes(v)));
  return name ? { ...out, [vault]: name } : out;
}

/** Gives the open vault a name, stored in the vault so it follows it to other machines; "" goes back to the folder's name. */
export async function renameVault(name: string) {
  const vault = requireVault();
  await writeVaultName(vault, name);
  const { config } = get();
  await saveConfig({
    ...config,
    vaultNames: withVaultName(config.vaultNames, vault, name.trim() || undefined, config.recentVaults),
  });
}

export async function closeVault() {
  await flushWrites().catch(() => {});
  await invoke("unwatch_vault").catch(() => {});
  set({
    vault: null,
    projects: [],
    route: { name: "home" },
    boards: {},
    decisions: {},
    issues: { repos: {} },
    git: null,
    repo: null,
    pr: null,
  });
  await saveConfig({ ...get().config, lastVault: null });
}

// ---------------------------------------------------------------- git

/** Re-detects the enclosing repo and, if the user opted in, refreshes the .gitignore block. */
export async function refreshGit() {
  const vault = get().vault;
  if (!vault) return;
  const git = await invoke<GitStatus | null>("git_ignore_sync", { vault }).catch(() => null);
  if (get().vault === vault) set({ git });
}

/** Re-reads branch and working-tree state. Cheap enough to poll; skips the update when nothing changed. */
export async function refreshRepo() {
  const vault = get().vault;
  if (!vault) return;
  const repo = await invoke<RepoInfo | null>("git_repo_info", { vault }).catch(() => null);
  const s = get();
  if (s.vault !== vault) return;
  if (JSON.stringify(repo) !== JSON.stringify(s.repo)) set({ repo });
  refreshPr(repo);
}

// The PR lookup goes to the GitHub API, so unlike the local git state it is not polled every few
// seconds: only when the branch changes, or at most every few minutes (60 requests/hour without a token).
const PR_INTERVAL = 3 * 60_000;
let prLookup = { key: "", at: 0 };

async function refreshPr(repo: RepoInfo | null) {
  const key = repo?.prHead ? `${repo.prHead}|${repo.prRepos.join(",")}` : "";
  if (key === prLookup.key && Date.now() - prLookup.at < PR_INTERVAL) return;
  const branchChanged = key !== prLookup.key;
  prLookup = { key, at: Date.now() };
  if (branchChanged) set({ pr: null });
  if (!repo?.prHead) return;
  const token = get().config.githubToken;
  try {
    let pr: BranchPr | null = null;
    for (const r of repo.prRepos) if ((pr = await fetchBranchPr(r, repo.prHead, token))) break;
    if (prLookup.key === key && JSON.stringify(pr) !== JSON.stringify(get().pr)) set({ pr });
  } catch {
    // Offline, rate-limited or a private repo without a token: keep whatever we showed last.
  }
}

export async function setGitIgnored(ignored: boolean) {
  const vault = requireVault();
  try {
    const git = await invoke<GitStatus>(ignored ? "git_ignore_enable" : "git_ignore_disable", { vault });
    set({ git });
    toast(ignored ? "Astali files added to .gitignore" : "Astali block removed from .gitignore", "success");
  } catch (e) {
    toast(`Could not update .gitignore: ${e}`, "error");
  }
}

export function dismissGitPrompt() {
  const { config, vault } = get();
  if (vault && !config.dismissedGitPrompts.includes(vault))
    saveConfig({ ...config, dismissedGitPrompts: [...config.dismissedGitPrompts, vault] });
}

export function forgetRecentVault(path: string) {
  const c = get().config;
  set((s) => ({ missingVaults: s.missingVaults.filter((v) => v !== path) }));
  saveConfig({ ...c, recentVaults: c.recentVaults.filter((v) => v !== path) });
}

function setVaultMissing(path: string, missing: boolean) {
  set((s) => {
    const rest = s.missingVaults.filter((v) => v !== path);
    return { missingVaults: missing ? [...rest, path] : rest };
  });
}

/** Flags recent vaults whose folder no longer exists, so the UI can offer to forget them. */
export async function checkRecentVaults() {
  const recent = get().config.recentVaults;
  // A failed check is not proof the folder is gone, so only a definite "no" flags it.
  const exists = await Promise.all(recent.map((v) => pathExists(v).catch(() => true)));
  set({ missingVaults: recent.filter((_, i) => !exists[i]) });
}

export async function openRecentVault(path: string) {
  const exists = await pathExists(path);
  setVaultMissing(path, !exists);
  if (!exists) {
    toast("That folder can't be found. It may have been renamed, moved or deleted.", "error");
    return;
  }
  await openVault(path);
}

// ---------------------------------------------------------------- projects

function persistProject(entry: ProjectEntry) {
  scheduleWrite(projectFile(requireVault(), entry.dir), entry.project);
}

function patchProject(id: string, fn: (p: Project) => Project) {
  let updated: ProjectEntry | undefined;
  set((s) => ({
    projects: s.projects.map((e) => {
      if (e.project.id !== id) return e;
      updated = { ...e, project: { ...fn(e.project), updatedAt: now() } };
      return updated;
    }),
  }));
  if (updated) persistProject(updated);
}

export async function createProject(input: {
  name: string;
  description: string;
  color: Color;
  repos: RepoRef[];
  decisionCharLimit?: number;
}) {
  const vault = requireVault();
  const base = slugify(input.name);
  let dir = base;
  for (let i = 2; (await pathExists(join(vault, dir))) || get().projects.some((p) => p.dir === dir); i++)
    dir = `${base}-${i}`;

  const board = newBoard("Main");
  const project = normalizeProject({ ...input, id: uid(), boardOrder: [board.id] });
  const entry: ProjectEntry = { project, dir };
  await writeNow(projectFile(vault, dir), project);
  await writeNow(boardFile(vault, dir, boardFileName(board)), board);
  set((s) => ({ projects: [entry, ...s.projects] }));
  refreshGit();
  return project.id;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "description" | "color" | "repos" | "tagColors" | "decisionCharLimit">>,
) {
  patchProject(id, (p) => ({ ...p, ...patch }));
}

// ---------------------------------------------------------------- tags

/** Sets the color of a tag in the current project; null goes back to the color derived from its name. */
export function setTagColor(tag: string, color: Color | null) {
  const p = currentProject();
  if (!p) return;
  patchProject(p.project.id, (pr) => {
    const tagColors = { ...pr.tagColors };
    if (color) tagColors[tagKey(tag)] = color;
    else delete tagColors[tagKey(tag)];
    return { ...pr, tagColors };
  });
}

/** Adds tags a task doesn't carry yet. */
export function addTaskTags(boardId: string, taskId: string, tags: string[]) {
  const t = get().boards[boardId]?.board.tasks[taskId];
  const add = t ? tags.filter((g, i) => !hasTag(t, g) && tags.findIndex((x) => tagKey(x) === tagKey(g)) === i) : [];
  if (t && add.length) updateTask(boardId, taskId, { labels: [...t.labels, ...add] });
  return add;
}

/** What a tag change touched. */
export interface TagChange {
  tasks: number;
  decisions: number;
  notes: number;
}

/** Rewrites the tags of every note carrying `tag`; returns how many changed. */
function retagNotes(tag: string, fn: (tags: string[]) => string[]) {
  let changed = 0;
  for (const { board } of Object.values(get().boards)) {
    const has = (n: Note) => n.tags.some((t) => tagKey(t) === tagKey(tag));
    const n = board.notes?.filter(has).length ?? 0;
    if (!n) continue;
    changed += n;
    patchBoard(board.id, (b) => ({
      ...b,
      notes: b.notes!.map((x) => (has(x) ? { ...x, tags: fn(x.tags), updatedAt: now() } : x)),
    }));
  }
  return changed;
}

/** Rewrites the tags of every decision carrying `tag`; returns how many changed. */
function retagDecisions(tag: string, fn: (tags: string[]) => string[]) {
  const p = currentProject();
  if (!p) return 0;
  let changed = 0;
  for (const entry of Object.values(get().decisions)) {
    if (!entry.decision.tags.some((t) => tagKey(t) === tagKey(tag))) continue;
    changed++;
    // Not through updateDecision: the text doesn't change, so the length limit has nothing to say.
    const decision = { ...entry.decision, tags: fn(entry.decision.tags), updatedAt: now() };
    set((s) => ({ decisions: { ...s.decisions, [decision.id]: { ...entry, decision } } }));
    scheduleWrite(decisionFile(requireVault(), p.dir, entry.file), decision);
  }
  return changed;
}

/**
 * Renames a tag on every task and decision of the current project (merging it into `to` where one has
 * both), carrying its color over.
 */
export function renameTag(from: string, to: string): TagChange {
  const p = currentProject();
  const name = to.trim();
  if (!p || !name || from === name) return { tasks: 0, decisions: 0, notes: 0 };
  let changed = 0;
  for (const { board } of Object.values(get().boards)) {
    const ids = Object.keys(board.tasks).filter((id) => hasTag(board.tasks[id], from));
    const cols = board.columns.some(
      (c) => c.source?.kind === "tags" && c.source.tags.some((g) => tagKey(g) === tagKey(from)),
    );
    if (!ids.length && !cols) continue;
    changed += ids.length;
    patchBoard(board.id, (b) => {
      const tasks = { ...b.tasks };
      for (const id of ids) {
        const t = tasks[id];
        const labels: string[] = [];
        for (const l of t.labels) {
          const next = tagKey(l) === tagKey(from) ? name : l;
          if (!labels.some((x) => tagKey(x) === tagKey(next))) labels.push(next);
        }
        tasks[id] = { ...t, labels, updatedAt: now() };
      }
      const columns = b.columns.map((c) => {
        if (c.source?.kind !== "tags") return c;
        const old = c.source;
        if (!old.tags.some((g) => tagKey(g) === tagKey(from))) return c;
        const tags = old.tags
          .map((g) => (tagKey(g) === tagKey(from) ? name : g))
          .filter((g, i, a) => a.findIndex((x) => tagKey(x) === tagKey(g)) === i);
        const source = { ...old, tags };
        // A column still named after its tags follows the rename.
        return { ...c, source, name: c.name === tagColumnName(old) ? tagColumnName(source) : c.name };
      });
      return { ...b, tasks, columns };
    });
  }
  const retag = (tags: string[]) => {
    const out: string[] = [];
    for (const t of tags) {
      const next = tagKey(t) === tagKey(from) ? name : t;
      if (!out.some((x) => tagKey(x) === tagKey(next))) out.push(next);
    }
    return out;
  };
  const decisions = retagDecisions(from, retag);
  const notes = retagNotes(from, retag);
  const color = p.project.tagColors[tagKey(from)];
  if (color && tagKey(from) !== tagKey(name)) {
    patchProject(p.project.id, (pr) => {
      const tagColors = { ...pr.tagColors };
      delete tagColors[tagKey(from)];
      if (!tagColors[tagKey(name)]) tagColors[tagKey(name)] = color;
      return { ...pr, tagColors };
    });
  }
  return { tasks: changed, decisions, notes };
}

/** Removes a tag from every task and decision of the current project, and forgets its color. */
export function deleteTag(tag: string): TagChange {
  const p = currentProject();
  if (!p) return { tasks: 0, decisions: 0, notes: 0 };
  let changed = 0;
  for (const { board } of Object.values(get().boards)) {
    const ids = Object.keys(board.tasks).filter((id) => hasTag(board.tasks[id], tag));
    if (!ids.length) continue;
    changed += ids.length;
    patchBoard(board.id, (b) => {
      const tasks = { ...b.tasks };
      for (const id of ids)
        tasks[id] = {
          ...tasks[id],
          labels: tasks[id].labels.filter((l) => tagKey(l) !== tagKey(tag)),
          updatedAt: now(),
        };
      return { ...b, tasks };
    });
  }
  const drop = (tags: string[]) => tags.filter((t) => tagKey(t) !== tagKey(tag));
  const decisions = retagDecisions(tag, drop);
  const notes = retagNotes(tag, drop);
  if (p.project.tagColors[tagKey(tag)]) setTagColor(tag, null);
  return { tasks: changed, decisions, notes };
}

export async function deleteProject(id: string) {
  const vault = requireVault();
  const entry = get().projects.find((p) => p.project.id === id);
  if (!entry) return;
  const dir = projectDir(vault, entry.dir);
  cancelWrites(dir);
  await removePath(dir);
  set((s) => ({
    projects: s.projects.filter((p) => p.project.id !== id),
    route: s.route.name === "project" && s.route.projectId === id ? { name: "home" } : s.route,
  }));
  toast(`Deleted “${entry.project.name}”`);
  refreshGit();
}

export function goHome() {
  set({ route: { name: "home" }, boards: {}, decisions: {}, issues: { repos: {} } });
}

/** Board files of a project, by name. */
async function listBoardFiles(vault: string, dir: string): Promise<string[]> {
  return (await listDir(boardsDir(vault, dir))).filter((e) => !e.is_dir && e.name.endsWith(".json")).map((e) => e.name);
}

/** Reads the project's boards, or only the board files in `files`. */
async function readBoards(vault: string, dir: string, files?: string[]): Promise<Record<string, BoardEntry>> {
  const out: Record<string, BoardEntry> = {};
  await Promise.all(
    (files ?? (await listBoardFiles(vault, dir))).map(async (name) => {
      const text = await readText(boardFile(vault, dir, name));
      if (!text) return;
      try {
        const board = normalizeBoard(JSON.parse(text));
        out[board.id] = { board, file: name };
      } catch {
        toast(`Skipped ${name}: invalid JSON`, "error");
      }
    }),
  );
  return out;
}

export async function openProject(id: string, view?: ProjectView) {
  const vault = requireVault();
  const entry = get().projects.find((p) => p.project.id === id);
  if (!entry) return;
  const [boards, decisions, issues] = await Promise.all([
    readBoards(vault, entry.dir),
    loadDecisions(vault, entry.dir),
    loadIssueCache(vault, entry.dir),
  ]);
  set({ boards, decisions, issues, route: { name: "project", projectId: id, view: { kind: "empty" } } });
  // Follows label renames picked up while the project was closed (e.g. by an MCP sync).
  reconcileLabelColumns(issues, issues);
  lastPoll = Date.now();
  const first = orderedBoards()[0];
  set({
    route: {
      name: "project",
      projectId: id,
      view: view ?? (first ? { kind: "board", boardId: first.id } : { kind: "empty" }),
    },
  });

  const stale = entry.project.repos.some((r) => {
    const c = issues.repos[repoKey(r)];
    return !c || Date.now() - new Date(c.fetchedAt).getTime() > STALE_MS;
  });
  if (stale) syncIssues({ quiet: true });
}

export function setView(view: ProjectView) {
  const r = get().route;
  if (r.name === "project") set({ route: { ...r, view } });
}

// ---------------------------------------------------------------- boards

function persistBoard(entry: BoardEntry) {
  const p = currentProject();
  if (p) scheduleWrite(boardFile(requireVault(), p.dir, entry.file), entry.board);
}

export function patchBoard(boardId: string, fn: (b: Board) => Board) {
  const entry = get().boards[boardId];
  if (!entry) return;
  const next: BoardEntry = { ...entry, board: { ...fn(entry.board), updatedAt: now() } };
  set((s) => ({ boards: { ...s.boards, [boardId]: next } }));
  persistBoard(next);
}

/** Creates a kanban board, a plan board when `plan` is given, or a notes board for "notes". */
export async function createBoard(name: string, plan?: Plan | "notes") {
  const p = currentProject();
  if (!p) return;
  const board =
    plan === "notes"
      ? newNotesBoard(name.trim() || "Untitled notes")
      : plan
        ? newPlanBoard(name.trim() || "Untitled plan", plan)
        : newBoard(name.trim() || "Untitled board");
  const entry: BoardEntry = { board, file: boardFileName(board) };
  await writeNow(boardFile(requireVault(), p.dir, entry.file), board);
  set((s) => ({ boards: { ...s.boards, [board.id]: entry } }));
  patchProject(p.project.id, (pr) => ({ ...pr, boardOrder: [...pr.boardOrder, board.id] }));
  setView({ kind: "board", boardId: board.id });
}

/** Edits a plan board's plan. */
export function patchPlan(boardId: string, fn: (p: Plan) => Plan) {
  patchBoard(boardId, (b) => (b.plan ? { ...b, plan: fn(b.plan) } : b));
}

// ---------------------------------------------------------------- notes boards

function patchNotes(boardId: string, fn: (notes: Note[]) => Note[]) {
  patchBoard(boardId, (b) => (b.notes ? { ...b, notes: fn(b.notes) } : b));
}

/** Adds a note (empty unless `content` says) with its top-left corner at (x, y), on top of the others; returns its id. */
export function addNote(
  boardId: string,
  x: number,
  y: number,
  content: Partial<Pick<Note, "title" | "description" | "tags" | "issues" | "color">> = {},
): string {
  const note = { ...newNote(x, y), ...content };
  patchNotes(boardId, (ns) => [...ns, note]);
  return note.id;
}

/**
 * Edits a note. Text that would take it over the board's limit is cut to fit; a note already over
 * it (written under a higher limit) can stay as it is but not grow.
 */
export function updateNote(boardId: string, noteId: string, patch: Partial<Omit<Note, "id" | "createdAt">>) {
  const b = get().boards[boardId]?.board;
  const old = b?.notes?.find((n) => n.id === noteId);
  if (!b || !old) return;
  let next: Note = { ...old, ...patch };
  const room = Math.max(normalizeNoteLimit(b.noteLimit), noteLength(old));
  if (noteLength(next) > room) {
    // Cut what was being typed, never the other field.
    if ("description" in patch) next = { ...next, description: clip(next.description, room - [...next.title].length) };
    if ("title" in patch) next = { ...next, title: clip(next.title, room - [...next.description].length) };
    if (noteLength(next) > room) return;
  }
  const moved = "x" in patch || "y" in patch;
  const textual = Object.keys(patch).some((k) => k !== "x" && k !== "y");
  patchNotes(boardId, (ns) => {
    const updated = { ...next, updatedAt: textual ? now() : old.updatedAt };
    const rest = ns.filter((n) => n.id !== noteId);
    // A note dragged somewhere comes to the top.
    return moved ? [...rest, updated] : ns.map((n) => (n.id === noteId ? updated : n));
  });
}

export function deleteNote(boardId: string, noteId: string) {
  patchNotes(boardId, (ns) => ns.filter((n) => n.id !== noteId));
}

export function setNoteLimit(boardId: string, limit: number) {
  patchBoard(boardId, (b) => ({ ...b, noteLimit: normalizeNoteLimit(limit) }));
}

export function renameBoard(boardId: string, name: string) {
  patchBoard(boardId, (b) => ({ ...b, name: name.trim() || b.name }));
}

export function updateBoardDescription(boardId: string, description: string) {
  patchBoard(boardId, (b) => ({ ...b, description }));
}

export async function deleteBoard(boardId: string) {
  const p = currentProject();
  const entry = get().boards[boardId];
  if (!p || !entry) return;
  const path = boardFile(requireVault(), p.dir, entry.file);
  cancelWrites(path);
  await removePath(path);
  const boards = { ...get().boards };
  delete boards[boardId];
  set({ boards });
  patchProject(p.project.id, (pr) => ({ ...pr, boardOrder: pr.boardOrder.filter((id) => id !== boardId) }));
  const r = get().route;
  if (r.name === "project" && r.view.kind === "board" && r.view.boardId === boardId) {
    const first = orderedBoards()[0];
    setView(first ? { kind: "board", boardId: first.id } : { kind: "empty" });
  }
  toast(`Deleted board “${entry.board.name}”`);
}

export function reorderBoards(order: string[]) {
  const p = currentProject();
  if (p) patchProject(p.project.id, (pr) => ({ ...pr, boardOrder: order }));
}

// ---------------------------------------------------------------- columns

export function addColumn(boardId: string, name: string, color: Color = "slate") {
  const col = newColumn(name.trim() || "New column", color);
  patchBoard(boardId, (b) => ({ ...b, columns: [...b.columns, col] }));
  return col.id;
}

/** Adds a column showing, live, the issues of `repo` ("owner/repo") that carry `label`. */
export function addLabelColumn(boardId: string, repo: string, label: GhLabel) {
  if (label.id == null) return null;
  const col: Column = {
    ...newColumn(label.name, `#${label.color}`),
    source: { kind: "label", repo, labelId: label.id, name: label.name, showClosed: false, deletedAt: null },
  };
  patchBoard(boardId, (b) => ({ ...b, columns: [...b.columns, col] }));
  return col.id;
}

/** Adds a column showing, live, the board's tasks tagged with any (or all) of `tags`. */
export function addTagColumn(boardId: string, tags: string[], match: "any" | "all") {
  const list = tags.map((t) => t.trim()).filter((t, i, a) => t && a.findIndex((x) => tagKey(x) === tagKey(t)) === i);
  if (!list.length) return null;
  const col: Column = {
    ...newColumn(tagColumnName({ tags: list, match }), tagColor(list[0], currentProject()?.project.tagColors)),
    source: { kind: "tags", tags: list, match },
  };
  patchBoard(boardId, (b) => ({ ...b, columns: [...b.columns, col] }));
  return col.id;
}

export function updateColumn(
  boardId: string,
  columnId: string,
  patch: Partial<Pick<Column, "name" | "color" | "wipLimit" | "source">>,
) {
  patchBoard(boardId, (b) => ({ ...b, columns: b.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)) }));
}

/** Collapses a column to a narrow strip on the board, or expands it back. */
export function setColumnCollapsed(boardId: string, columnId: string, collapsed: boolean) {
  patchBoard(boardId, (b) => ({
    ...b,
    columns: b.columns.map((c) => {
      if (c.id !== columnId) return c;
      const { collapsed: _, ...rest } = c;
      return collapsed ? { ...rest, collapsed: true } : rest;
    }),
  }));
}

/** Makes the column the board's done column, whatever its place. */
export function setDoneColumn(boardId: string, columnId: string) {
  patchBoard(boardId, (b) => ({ ...b, doneColumn: columnId }));
}

/** Deletes a column; its tasks move to `moveTo` or are deleted when `moveTo` is null. */
export function deleteColumn(boardId: string, columnId: string, moveTo: string | null) {
  patchBoard(boardId, (b) => {
    const col = b.columns.find((c) => c.id === columnId);
    if (!col) return b;
    const tasks = { ...b.tasks };
    if (!moveTo) for (const id of col.taskIds) delete tasks[id];
    const columns = b.columns
      .filter((c) => c.id !== columnId)
      .map((c) => (c.id === moveTo ? { ...c, taskIds: [...c.taskIds, ...col.taskIds] } : c));
    // Deleting the done column hands the role to the last column that holds tasks, for good (D-3).
    return pruneLinks({ ...b, columns, tasks, doneColumn: doneColumn({ columns, doneColumn: b.doneColumn })?.id });
  });
}

export function moveColumn(boardId: string, from: number, to: number) {
  patchBoard(boardId, (b) => {
    const columns = [...b.columns];
    const [c] = columns.splice(from, 1);
    columns.splice(to, 0, c);
    return { ...b, columns };
  });
}

// ---------------------------------------------------------------- tasks

export function addTask(boardId: string, columnId: string, partial: Partial<Task>, atTop = false) {
  if (isViewColumn(get().boards[boardId]?.board.columns.find((c) => c.id === columnId))) return null;
  const task = normalizeTask({ ...partial, id: uid(), createdAt: now(), updatedAt: now() });
  patchBoard(boardId, (b) => ({
    ...b,
    tasks: { ...b.tasks, [task.id]: task },
    columns: b.columns.map((c) =>
      c.id === columnId ? { ...c, taskIds: atTop ? [task.id, ...c.taskIds] : [...c.taskIds, task.id] } : c,
    ),
  }));
  return task.id;
}

/**
 * Adds many GitHub issues to a column in a single board write, at `index` (default: the end).
 * Issues already linked on that board are skipped. Returns how many tasks were created.
 */
export function addIssueTasks(
  boardId: string,
  columnId: string,
  issues: Pick<GhIssue, "repo" | "number" | "title">[],
  index?: number,
) {
  const board = get().boards[boardId]?.board;
  const target = board?.columns.find((c) => c.id === columnId);
  if (!board || !target || isViewColumn(target)) return 0;
  const onBoard = new Set(
    Object.values(board.tasks).flatMap((t) => (t.issue ? [`${t.issue.repo}#${t.issue.number}`] : [])),
  );
  const created: Task[] = [];
  for (const i of issues) {
    const key = `${i.repo}#${i.number}`;
    if (onBoard.has(key)) continue;
    onBoard.add(key);
    created.push(
      normalizeTask({
        title: i.title,
        issue: { repo: i.repo, number: i.number },
        labels: [],
        id: uid(),
        createdAt: now(),
        updatedAt: now(),
      }),
    );
  }
  if (created.length === 0) return 0;
  patchBoard(boardId, (b) => ({
    ...b,
    tasks: { ...b.tasks, ...Object.fromEntries(created.map((t) => [t.id, t])) },
    columns: b.columns.map((c) => {
      if (c.id !== columnId) return c;
      const taskIds = [...c.taskIds];
      taskIds.splice(index ?? taskIds.length, 0, ...created.map((t) => t.id));
      return { ...c, taskIds };
    }),
  }));
  return created.length;
}

export function updateTask(boardId: string, taskId: string, patch: Partial<Task>) {
  patchBoard(boardId, (b) =>
    b.tasks[taskId] ? { ...b, tasks: { ...b.tasks, [taskId]: { ...b.tasks[taskId], ...patch, updatedAt: now() } } } : b,
  );
}

export function deleteTask(boardId: string, taskId: string) {
  patchBoard(boardId, (b) => {
    const tasks = { ...b.tasks };
    delete tasks[taskId];
    return pruneLinks({
      ...b,
      tasks,
      columns: b.columns.map((c) => ({ ...c, taskIds: c.taskIds.filter((id) => id !== taskId) })),
    });
  });
}

// ---------------------------------------------------------------- archive

/**
 * Puts tasks away in the board's archive, newest first, remembering their column (D-8), or `from` when given.
 * Returns how many.
 */
export function archiveTasks(boardId: string, taskIds: string[], from?: string): number {
  const wanted = new Set(taskIds);
  let count = 0;
  patchBoard(boardId, (b) => {
    const at = now();
    const put: ArchivedTask[] = [];
    for (const c of b.columns)
      for (const id of c.taskIds)
        if (wanted.has(id) && b.tasks[id]) put.push({ task: b.tasks[id], from: from ?? c.id, at });
    count = put.length;
    if (!count) return b;
    const tasks = { ...b.tasks };
    for (const a of put) delete tasks[a.task.id];
    const columns = b.columns.map((c) => ({ ...c, taskIds: c.taskIds.filter((id) => !wanted.has(id)) }));
    return { ...b, tasks, columns, archive: [...put, ...(b.archive ?? [])] };
  });
  return count;
}

/** The column an archived task goes back to: the one it left, or the first one when that one is gone. */
export function restoreTarget(board: Board, entry: ArchivedTask) {
  const own = board.columns.filter((c) => !isViewColumn(c));
  return own.find((c) => c.id === entry.from) ?? own[0];
}

/** Brings an archived task back to the top of its column, or of the first column when that one is gone. Returns the column's name. */
export function restoreArchived(boardId: string, taskId: string): string | null {
  const b = get().boards[boardId]?.board;
  const entry = b?.archive?.find((a) => a.task.id === taskId);
  const to = b && entry && restoreTarget(b, entry);
  // A task can't go back to a done column that auto-archives: it would be archived again right away.
  if (!b || !to || autoArchives(b, to.id)) return null;
  patchBoard(boardId, (b) => {
    const archive = (b.archive ?? []).filter((a) => a.task.id !== taskId);
    return {
      ...b,
      tasks: { ...b.tasks, [taskId]: entry.task },
      columns: b.columns.map((c) => (c.id === to.id ? { ...c, taskIds: [taskId, ...c.taskIds] } : c)),
      archive: archive.length ? archive : undefined,
    };
  });
  return to.name;
}

/** Deletes an archived task for good (it can still be undone from Activity). */
export function purgeArchived(boardId: string, taskId: string) {
  patchBoard(boardId, (b) => {
    const archive = (b.archive ?? []).filter((a) => a.task.id !== taskId);
    return pruneLinks({ ...b, archive: archive.length ? archive : undefined });
  });
}

/** Links two tasks of the project, replacing any link they already had; see src/lib/links.ts. */
export function linkTask(a: TaskRef, kind: LinkKind, b: TaskRef) {
  for (const [id, board] of Object.entries(linkTasks(get().boards, a, kind, b))) patchBoard(id, () => board);
}

export function unlinkTask(a: TaskRef, b: TaskRef) {
  for (const [id, board] of Object.entries(unlinkTasks(get().boards, a, b))) patchBoard(id, () => board);
}

/** Shows a board and opens one of its tasks. */
export function openTaskOnBoard(boardId: string, taskId: string) {
  set({ pendingTask: taskId });
  setView({ kind: "board", boardId });
}

/** Whether a task moved into this column of the board goes straight to the archive. */
export function autoArchives(board: Board, columnId: string) {
  return !!board.autoArchive && doneColumn(board)?.id === columnId;
}

function autoArchived(title: string) {
  toast(`“${title.trim() || "Untitled"}” was archived automatically`);
}

/** Turns auto archive on (archiving what the done column holds already) or off. Returns how many tasks it archived. */
export function setAutoArchive(boardId: string, on: boolean): number {
  const done = get().boards[boardId] && doneColumn(get().boards[boardId].board);
  const count = on && done ? archiveTasks(boardId, done.taskIds) : 0;
  patchBoard(boardId, (b) => ({ ...b, autoArchive: on || undefined }));
  return count;
}

/**
 * Archives a task that a drag took from `fromColumnId` into an auto-archiving done column. A drag moves the
 * card through the columns it passes over, so this waits for the drop instead of happening in moveTask.
 */
export function autoArchiveDropped(boardId: string, taskId: string, fromColumnId: string) {
  const board = get().boards[boardId]?.board;
  const col = board?.columns.find((c) => c.taskIds.includes(taskId));
  if (board && col && col.id !== fromColumnId && autoArchives(board, col.id) && archiveTasks(boardId, [taskId])) {
    autoArchived(board.tasks[taskId].title);
  }
}

/** Moves a task; into an auto-archiving done column, it goes to the archive instead, unless `autoArchive` is false. */
export function moveTask(boardId: string, taskId: string, toColumnId: string, toIndex: number, autoArchive = true) {
  const board = get().boards[boardId]?.board;
  const from = board?.columns.find((c) => c.taskIds.includes(taskId));
  // Reordering within the done column leaves a task there; only moving it in archives it.
  if (autoArchive && board && from && from.id !== toColumnId && autoArchives(board, toColumnId)) {
    if (archiveTasks(boardId, [taskId], toColumnId)) autoArchived(board.tasks[taskId].title);
    return;
  }
  patchBoard(boardId, (b) => {
    const columns = b.columns.map((c) => ({ ...c, taskIds: c.taskIds.filter((id) => id !== taskId) }));
    const target = columns.find((c) => c.id === toColumnId);
    if (!target || isViewColumn(target)) return b;
    const idx = Math.max(0, Math.min(toIndex, target.taskIds.length));
    target.taskIds.splice(idx, 0, taskId);
    return { ...b, columns };
  });
}

/**
 * Moves a task to a column of another kanban board of the project, at the end. It keeps its id (unless that
 * board already has one like it) and its links, and links pointing to it from any board follow it there.
 * Returns the task's id on the new board, or null when it couldn't move.
 */
export function moveTaskToBoard(fromBoardId: string, taskId: string, toBoardId: string, toColumnId: string) {
  const boards = get().boards;
  const from = boards[fromBoardId]?.board;
  const to = boards[toBoardId]?.board;
  const task = from?.tasks[taskId];
  const column = to?.columns.find((c) => c.id === toColumnId);
  if (!from || !to || !task || fromBoardId === toBoardId || to.kind || !column || isViewColumn(column)) return null;
  const id = to.tasks[taskId] ? uid() : taskId;

  const copy = { ...task, id, updatedAt: now() };
  const archive = autoArchives(to, toColumnId);
  patchBoard(toBoardId, (b) =>
    archive
      ? { ...b, archive: [{ task: copy, from: toColumnId, at: now() }, ...(b.archive ?? [])] }
      : {
          ...b,
          tasks: { ...b.tasks, [id]: copy },
          columns: b.columns.map((c) => (c.id === toColumnId ? { ...c, taskIds: [...c.taskIds, id] } : c)),
        },
  );
  patchBoard(fromBoardId, (b) => {
    const tasks = { ...b.tasks };
    delete tasks[taskId];
    return { ...b, tasks, columns: b.columns.map((c) => ({ ...c, taskIds: c.taskIds.filter((t) => t !== taskId) })) };
  });
  for (const [boardId, { board }] of Object.entries(get().boards)) {
    const moved = retargetLinks(board, { board: fromBoardId, task: taskId }, { board: toBoardId, task: id });
    if (moved !== board) patchBoard(boardId, () => moved);
  }
  if (archive) autoArchived(task.title);
  return id;
}

/** Board/column location of every task linked to an issue, keyed "owner/repo#n". */
export function linkedIssueIndex(boards: Record<string, BoardEntry>) {
  const idx = new Map<string, { boardId: string; boardName: string; taskId: string; columnName: string }[]>();
  for (const { board } of Object.values(boards)) {
    for (const col of board.columns) {
      for (const tid of col.taskIds) {
        const t = board.tasks[tid];
        if (!t?.issue) continue;
        const key = `${t.issue.repo}#${t.issue.number}`;
        const list = idx.get(key) ?? [];
        list.push({ boardId: board.id, boardName: board.name, taskId: tid, columnName: col.name });
        idx.set(key, list);
      }
    }
  }
  return idx;
}

// ---------------------------------------------------------------- decisions

export type DecisionInput = Pick<Decision, "title" | "why" | "rejected" | "about" | "tags" | "issues">;

/** Whether text of `length` characters may be saved over text that had `before` (null for a new decision). */
export function decisionFits(length: number, before: number | null, limit: number) {
  // Text written under a higher limit is kept, but can't grow while it is over the current one.
  return length <= limit || (before != null && length <= before);
}

/** Records a new decision with the next number. Returns its id, or null when it is over the project's limit. */
export async function createDecision(input: DecisionInput) {
  const p = currentProject();
  if (!p || !decisionFits(decisionLength(input), null, p.project.decisionCharLimit)) return null;
  const all = Object.values(get().decisions).map((e) => e.decision);
  const number = all.reduce((n, d) => Math.max(n, d.number), 0) + 1;
  const decision = normalizeDecision({ ...input, id: uid(), number, createdAt: now(), updatedAt: now() });
  const entry: DecisionEntry = { decision, file: decisionFileName(decision) };
  await writeNow(decisionFile(requireVault(), p.dir, entry.file), decision);
  set((s) => ({ decisions: { ...s.decisions, [decision.id]: entry } }));
  return decision.id;
}

/** Changes a decision. Returns false (and changes nothing) when its text would grow past the project's limit. */
export function updateDecision(id: string, patch: Partial<DecisionInput & Pick<Decision, "replacedBy">>) {
  const p = currentProject();
  const entry = get().decisions[id];
  if (!p || !entry) return false;
  const decision = { ...entry.decision, ...patch, updatedAt: now() };
  if (!decisionFits(decisionLength(decision), decisionLength(entry.decision), p.project.decisionCharLimit))
    return false;
  const next = { ...entry, decision };
  set((s) => ({ decisions: { ...s.decisions, [id]: next } }));
  scheduleWrite(decisionFile(requireVault(), p.dir, entry.file), decision);
  return true;
}

export async function deleteDecision(id: string) {
  const p = currentProject();
  const entry = get().decisions[id];
  if (!p || !entry) return;
  const path = decisionFile(requireVault(), p.dir, entry.file);
  cancelWrites(path);
  await removePath(path);
  const decisions = { ...get().decisions };
  delete decisions[id];
  set({ decisions });
  toast(`Deleted D-${entry.decision.number} “${entry.decision.title}”`);
}

// ---------------------------------------------------------------- GitHub (read-only)

export async function syncIssues(opts: { quiet?: boolean } = {}) {
  const p = currentProject();
  if (!p || get().syncing) return;
  if (!p.project.repos.length) {
    if (!opts.quiet) toast("Add a GitHub repository in project settings first");
    return;
  }
  set({ syncing: true });
  const token = get().config.githubToken;
  const repos: IssueCache["repos"] = {};
  let failures = 0;
  let total = 0;
  await Promise.all(
    p.project.repos.map(async (r) => {
      const key = repoKey(r);
      try {
        // Records the change markers first, so a change made during the fetch is seen by the next poll.
        await repoChanged(r, token);
        const [issues, labels] = await Promise.all([fetchRepoIssues(r, token), fetchRepoLabels(r, token)]);
        repos[key] = { fetchedAt: now(), issues, labels };
        total += issues.length;
      } catch (e) {
        failures++;
        if (e instanceof GitHubError && e.status === 401 && token.trim()) tokenRejected();
        const prev = get().issues.repos[key];
        repos[key] = {
          fetchedAt: prev?.fetchedAt ?? now(),
          issues: prev?.issues ?? [],
          labels: prev?.labels,
          error: (e as Error).message,
        };
        if (!opts.quiet || !(e instanceof GitHubError && e.status === 403))
          toast(`${key}: ${(e as Error).message}`, "error");
      }
    }),
  );
  // The user may have navigated away mid-sync; only apply to the same project.
  if (currentProject()?.project.id === p.project.id) {
    const cache: IssueCache = { repos };
    const prev = get().issues;
    set({ issues: cache });
    reconcileLabelColumns(prev, cache);
    await writeNow(issueCacheFile(requireVault(), p.dir), cache);
  }
  set({ syncing: false });
  if (!opts.quiet && !failures) toast(`Synced ${total} issues from ${p.project.repos.length} repo(s)`, "success");
}

// GitHub can't notify a desktop app, so changes made there are polled for. A poll is two
// conditional requests per repo, free when nothing changed (with a token); a full sync follows only
// when something did. Without a token every request counts against 60/hour, hence the longer gap.
const POLL_MS = 2 * 60_000;
const POLL_MS_ANONYMOUS = 10 * 60_000;
let lastPoll = 0;

/** Syncs the open project's issues if they changed on GitHub. Safe to call often: it throttles itself. */
export async function pollIssues() {
  const s = get();
  const p = currentProject(s);
  if (!p?.project.repos.length || s.syncing) return;
  if (Date.now() - lastPoll < (s.config.githubToken.trim() ? POLL_MS : POLL_MS_ANONYMOUS)) return;
  lastPoll = Date.now();
  const token = s.config.githubToken;
  const probes = await Promise.all(p.project.repos.map((r) => repoChanged(r, token)));
  // Offline or rate-limited: try again at the next poll rather than failing a sync (and toasting) now.
  if (probes.includes("error")) return;
  // The probes miss issues deleted outright, so a stale cache is refreshed anyway.
  const stale = p.project.repos.some((r) => {
    const c = get().issues.repos[repoKey(r)];
    return !c || Date.now() - new Date(c.fetchedAt).getTime() > STALE_MS;
  });
  if ((probes.includes("changed") || stale) && currentProject()?.project.id === p.project.id)
    await syncIssues({ quiet: true });
}

/** Applies label renames, recolors and deletions seen in the cache change to the open project's boards. */
function reconcileLabelColumns(prev: IssueCache, next: IssueCache) {
  for (const { board } of Object.values(get().boards)) {
    const at = now();
    const res = followLabels(board, prev, next, at, (i) =>
      normalizeTask({
        title: i.title,
        issue: { repo: i.repo, number: i.number },
        id: uid(),
        createdAt: at,
        updatedAt: at,
      }),
    );
    if (!res) continue;
    patchBoard(board.id, (b) => ({ ...b, columns: res.columns, tasks: res.tasks }));
    for (const e of res.events) {
      if (e.kind === "deleted")
        toast(
          `Label “${e.name}” was deleted on GitHub. Its column on “${board.name}” keeps its ${e.kept} issue(s) as tasks.`,
        );
      else toast(`Label “${e.from}” was renamed to “${e.to}” on GitHub`);
    }
  }
}

// ---------------------------------------------------------------- history

/** The vault's change log, relative to the vault (normalized like the watcher's paths). */
const HISTORY_FILE = ".astali/history.jsonl";

export async function loadHistory(filter: { project?: string; board?: string; limit?: number } = {}) {
  const vault = requireVault();
  return invoke<HistoryEntry[]>("history_list", {
    vault,
    project: filter.project,
    board: filter.board,
    limit: filter.limit,
  });
}

/**
 * Reverts a history entry on the files (the watcher then reloads them). With conflicts, nothing
 * changes unless `skipConflicts` is set; the caller decides whether to retry with it.
 */
export async function undoChange(id: string, skipConflicts = false) {
  const vault = requireVault();
  // The undo works on what is on disk, so our own pending edits must land first.
  await flushWrites();
  return invoke<{ done: boolean; conflicts: string[] }>("history_undo", { vault, id, skipConflicts });
}

let highlightTimer = 0;

/** Opens a board and briefly highlights some of its cards. */
export function showOnBoard(boardId: string, taskIds: string[]) {
  setView({ kind: "board", boardId });
  clearTimeout(highlightTimer);
  set({ highlight: taskIds });
  highlightTimer = window.setTimeout(() => set({ highlight: [] }), 2400);
}

// ---------------------------------------------------------------- live reload from disk

/**
 * Called when files in the vault change outside the app (Claude via MCP, an editor, a sync
 * client). Reloads whatever changed, skipping echoes of our own writes and files we are
 * about to overwrite anyway.
 */
export async function refreshFromDisk(changed: string[]) {
  const vault = get().vault;
  if (!vault) return;
  const v = normPath(vault);
  const all = changed
    .map(normPath)
    .filter((p) => p.startsWith(v + "/") && !p.endsWith(".tmp~"))
    .map((p) => p.slice(v.length + 1));
  if (all.includes(HISTORY_FILE)) set((s) => ({ historyRev: s.historyRev + 1 }));
  const rel = all.filter((p) => !p.startsWith(".astali"));
  if (!rel.length) return;

  // Projects: any change to a top-level folder or a project.json.
  if (rel.some((p) => !p.includes("/") || /^[^/]+\/project\.json$/.test(p))) {
    const fresh = await loadProjects(vault);
    const current = new Map(get().projects.map((e) => [e.dir, e]));
    const merged = await Promise.all(
      fresh.map(async (e) => {
        const path = projectFile(vault, e.dir);
        const mine = current.get(e.dir);
        if (mine && (hasPendingWrite(path) || isOwnWrite(path, await readText(path)))) return mine;
        return e;
      }),
    );
    const s = get();
    const dirsChanged =
      merged
        .map((e) => e.dir)
        .sort()
        .join("|") !==
      s.projects
        .map((e) => e.dir)
        .sort()
        .join("|");
    set({ projects: merged });
    if (dirsChanged) refreshGit();
    if (
      s.route.name === "project" &&
      !merged.some((e) => e.project.id === (s.route as { projectId: string }).projectId)
    )
      goHome();
  }

  const p = currentProject();
  if (!p) return;
  const prefix = p.dir.toLowerCase() + "/";

  if (rel.some((r) => r.startsWith(prefix + "boards"))) {
    // Only the board files that changed are read again: a big project has megabytes of boards, and
    // every save of ours comes back here too. An event on the folder itself rereads them all.
    const inBoards = prefix + "boards/";
    const touched = new Set(rel.filter((r) => r.startsWith(inBoards)).map((r) => r.slice(inBoards.length)));
    const everything = rel.includes(prefix + "boards") || [...touched].some((f) => f.includes("/"));
    const stale = (file: string) => everything || touched.has(file.toLowerCase());
    const listed = await listBoardFiles(vault, p.dir);
    const fresh = await readBoards(vault, p.dir, listed.filter(stale));
    const current = get().boards;
    const merged: Record<string, BoardEntry> = {};
    for (const [id, e] of Object.entries(current)) {
      if (!stale(e.file) && listed.includes(e.file)) merged[id] = e;
    }
    for (const [id, e] of Object.entries(fresh)) {
      const path = boardFile(vault, p.dir, e.file);
      const mine = current[id];
      merged[id] = mine && (hasPendingWrite(path) || isOwnWrite(path, await readText(path))) ? mine : e;
    }
    // Keep boards whose file is still being created by us.
    for (const [id, e] of Object.entries(current)) {
      if (!merged[id] && hasPendingWrite(boardFile(vault, p.dir, e.file))) merged[id] = e;
    }
    set({ boards: merged });
    // Boards created on disk by someone else are appended to the sidebar order.
    const missing = Object.keys(merged).filter((id) => !p.project.boardOrder.includes(id));
    if (missing.length) patchProject(p.project.id, (pr) => ({ ...pr, boardOrder: [...pr.boardOrder, ...missing] }));
    const r = get().route;
    if (r.name === "project" && r.view.kind === "board" && !merged[r.view.boardId]) {
      const first = orderedBoards()[0];
      setView(first ? { kind: "board", boardId: first.id } : { kind: "empty" });
    }
  }

  if (rel.some((r) => r.startsWith(prefix + "decisions"))) {
    const fresh = await loadDecisions(vault, p.dir);
    const current = get().decisions;
    const merged: Record<string, DecisionEntry> = {};
    for (const [id, e] of Object.entries(fresh)) {
      const path = decisionFile(vault, p.dir, e.file);
      const mine = current[id];
      merged[id] = mine && (hasPendingWrite(path) || isOwnWrite(path, await readText(path))) ? mine : e;
    }
    set({ decisions: merged });
  }

  if (rel.some((r) => r.startsWith(prefix + ".cache"))) {
    const prev = get().issues;
    const next = await loadIssueCache(vault, p.dir);
    set({ issues: next });
    reconcileLabelColumns(prev, next);
  }
}
