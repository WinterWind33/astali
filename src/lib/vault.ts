import { join, listDir, readJson, readText, writeNow, writeText } from "./fs";
import agentsGuide from "./vault-guide.md?raw";
import {
  SCHEMA_VERSION,
  type Board,
  type BoardEntry,
  type Color,
  type Column,
  type Decision,
  type DecisionEntry,
  type IssueCache,
  type Plan,
  type Project,
  type ProjectEntry,
  type Task,
} from "./types";
import { normalizeDecision, normalizeDecisionLimit } from "./decisions";
import { normalizeGlossaryLimit, normalizeTerm } from "./glossary";
import { doneColumn, isViewColumn, normalizeSource } from "./labelColumns";
import { normalizeNote, normalizeNoteLimit } from "./notes";
import { emptyPlan, normalizePlan } from "./plan";
import { normalizeTagColors } from "./tags";
import { isPreset, normalizeColor, now, slugify, uid } from "./util";
import { normalizeHex } from "./color";

/*
 * Vault layout (plain, human-readable JSON — safe to sync with git, Dropbox, etc.):
 *
 *   <vault>/
 *     AGENTS.md                      guide for AI agents / humans editing files directly
 *     .astali/vault.json
 *     <project-folder>/
 *       project.json
 *       boards/<board-slug>-<id>.json
 *       decisions/d<number>-<id>.json
 *       .cache/github-issues.json
 */

export const META_DIR = ".astali";

export const projectDir = (vault: string, dir: string) => join(vault, dir);
export const projectFile = (vault: string, dir: string) => join(vault, dir, "project.json");
export const boardsDir = (vault: string, dir: string) => join(vault, dir, "boards");
export const boardFile = (vault: string, dir: string, file: string) => join(vault, dir, "boards", file);
export const decisionsDir = (vault: string, dir: string) => join(vault, dir, "decisions");
export const decisionFile = (vault: string, dir: string, file: string) => join(vault, dir, "decisions", file);
export const issueCacheFile = (vault: string, dir: string) => join(vault, dir, ".cache", "github-issues.json");

/** First line of the guide; src-tauri/src/gitignore.rs recognizes the file by it too. */
const AGENTS_HEADING = "# Astali vault";

/** The guide, shared with the MCP server's create_vault (src-tauri/src/mcp.rs); LF even if checked out with CRLF. */
const AGENTS_MD = agentsGuide.replace(/\r\n/g, "\n");

const vaultMetaFile = (vault: string) => join(vault, META_DIR, "vault.json");

/** The folder's own name, which a vault goes by until it is given another one. */
export const folderName = (vault: string) => vault.split("/").pop() || vault;

/** A vault's name: the one it was given, else its folder's. */
export const vaultName = (vault: string, names: Record<string, string>) => names[vault] || folderName(vault);

/**
 * Makes sure the folder is set up as a vault, and returns the name it was given in `.astali/vault.json`
 * (absent: it goes by its folder's name).
 */
export async function ensureVault(vault: string): Promise<string | undefined> {
  const metaPath = vaultMetaFile(vault);
  const meta = await readJson<Record<string, unknown>>(metaPath);
  if (!meta) await writeNow(metaPath, { schemaVersion: SCHEMA_VERSION, createdAt: now(), app: "Astali" });
  // Our own guide (it starts with AGENTS_HEADING) is refreshed when it describes an older format; an
  // AGENTS.md the vault's repository already had is left alone.
  const agentsPath = join(vault, "AGENTS.md");
  const agents = await readText(agentsPath);
  if (agents == null || (agents.startsWith(AGENTS_HEADING) && agents.replace(/\r\n/g, "\n") !== AGENTS_MD))
    await writeText(agentsPath, AGENTS_MD);
  const name = meta?.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/** Names the vault in its `.astali/vault.json`, keeping the file's other fields; "" goes back to the folder's name. */
export async function writeVaultName(vault: string, name: string) {
  const metaPath = vaultMetaFile(vault);
  const { name: _, ...meta } = (await readJson<Record<string, unknown>>(metaPath)) ?? {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now(),
    app: "Astali",
  };
  await writeNow(metaPath, name.trim() ? { ...meta, name: name.trim() } : meta);
}

/*
 * The normalize* functions fill in missing fields and fix invalid ones, but keep fields they don't
 * know: a vault written by a newer Astali must come back unchanged when this version saves it.
 */

export function normalizeProject(p: Partial<Project>): Project {
  return {
    ...p,
    schemaVersion: SCHEMA_VERSION,
    id: p.id ?? uid(),
    name: p.name ?? "Untitled project",
    description: p.description ?? "",
    color: normalizeColor(p.color, "violet"),
    repos: Array.isArray(p.repos) ? p.repos : [],
    tagColors: normalizeTagColors(p.tagColors, (c) =>
      typeof c === "string" && isPreset(c) ? c : normalizeHex(c as string),
    ),
    decisionCharLimit: normalizeDecisionLimit(p.decisionCharLimit),
    glossaryCharLimit: normalizeGlossaryLimit(p.glossaryCharLimit),
    boardOrder: Array.isArray(p.boardOrder) ? p.boardOrder : [],
    createdAt: p.createdAt ?? now(),
    updatedAt: p.updatedAt ?? now(),
  };
}

export function normalizeTask(t: Partial<Task>): Task {
  const links = Array.isArray(t.links)
    ? t.links.filter(
        (l) =>
          l &&
          (l.type === "blocks" || l.type === "relates") &&
          typeof l.board === "string" &&
          typeof l.task === "string",
      )
    : [];
  const { links: _, ...rest } = t;
  return {
    ...rest,
    ...(links.length ? { links } : {}),
    id: t.id ?? uid(),
    title: t.title ?? "Untitled",
    description: t.description ?? "",
    priority: t.priority ?? "none",
    labels: Array.isArray(t.labels) ? t.labels : [],
    dueDate: t.dueDate ?? null,
    issue: t.issue ?? null,
    checklist: Array.isArray(t.checklist) ? t.checklist : [],
    createdAt: t.createdAt ?? now(),
    updatedAt: t.updatedAt ?? now(),
  };
}

export function normalizeBoard(b: Partial<Board>): Board {
  const tasks: Record<string, Task> = {};
  for (const [id, t] of Object.entries(b.tasks ?? {})) tasks[id] = normalizeTask({ ...t, id });
  const seen = new Set<string>();
  const columns: Column[] = (b.columns ?? []).map((c) => {
    const source = normalizeSource(c.source);
    const { collapsed, ...known } = c;
    return {
      ...known,
      id: c.id ?? uid(),
      name: c.name ?? "Column",
      color: normalizeColor(c.color, "slate"),
      wipLimit: c.wipLimit ?? null,
      ...(collapsed ? { collapsed: true } : {}),
      // Live label and tag columns compute their cards; they never hold tasks.
      taskIds: isViewColumn({ source })
        ? []
        : (c.taskIds ?? []).filter((id) => tasks[id] && !seen.has(id) && seen.add(id)),
      source,
    };
  });
  // A task both on the board and in the archive (e.g. after a hand edit) stays on the board.
  const archive = (Array.isArray(b.archive) ? b.archive : [])
    .filter((a) => a?.task?.id && !tasks[a.task.id])
    .map((a) => ({ task: normalizeTask(a.task), from: String(a.from ?? ""), at: a.at ?? now() }));
  // Orphaned tasks (e.g. after a hand edit) land in the first column that takes tasks instead of vanishing.
  const orphans = Object.keys(tasks).filter((id) => !seen.has(id));
  const home = columns.find((c) => !isViewColumn(c)) ?? columns[0];
  if (orphans.length && home) home.taskIds.push(...orphans);
  if (b.kind === "notes") {
    // A notes board holds post-its, never columns or tasks.
    return {
      ...b,
      schemaVersion: SCHEMA_VERSION,
      id: b.id ?? uid(),
      name: b.name ?? "Notes",
      description: b.description ?? "",
      kind: "notes",
      notes: Array.isArray(b.notes) ? b.notes.map(normalizeNote) : [],
      noteLimit: normalizeNoteLimit(b.noteLimit),
      columns: [],
      tasks: {},
      createdAt: b.createdAt ?? now(),
      updatedAt: b.updatedAt ?? now(),
    };
  }
  if (b.kind === "glossary") {
    // A glossary holds terms, never columns or tasks.
    return {
      ...b,
      schemaVersion: SCHEMA_VERSION,
      id: b.id ?? uid(),
      name: b.name ?? "Glossary",
      description: b.description ?? "",
      kind: "glossary",
      terms: Array.isArray(b.terms) ? b.terms.map(normalizeTerm) : [],
      columns: [],
      tasks: {},
      createdAt: b.createdAt ?? now(),
      updatedAt: b.updatedAt ?? now(),
    };
  }
  if (b.kind === "plan") {
    // A plan holds steps and items, never columns or tasks.
    return {
      ...b,
      schemaVersion: SCHEMA_VERSION,
      id: b.id ?? uid(),
      name: b.name ?? "Plan",
      description: b.description ?? "",
      kind: "plan",
      plan: normalizePlan(b.plan),
      columns: [],
      tasks: {},
      createdAt: b.createdAt ?? now(),
      updatedAt: b.updatedAt ?? now(),
    };
  }
  return {
    ...b,
    schemaVersion: SCHEMA_VERSION,
    id: b.id ?? uid(),
    name: b.name ?? "Board",
    description: b.description ?? "",
    columns,
    // Saved explicitly, so adding or moving columns can't change which one is done (D-3).
    doneColumn: doneColumn({ columns, doneColumn: b.doneColumn })?.id,
    tasks,
    archive: archive.length ? archive : undefined,
    createdAt: b.createdAt ?? now(),
    updatedAt: b.updatedAt ?? now(),
  };
}

export function newColumn(name: string, color: Color = "slate"): Column {
  return { id: uid(), name, color, wipLimit: null, taskIds: [], source: null };
}

export function newBoard(name: string): Board {
  return normalizeBoard({
    id: uid(),
    name,
    columns: [newColumn("To Do", "slate"), newColumn("Doing", "blue"), newColumn("Done", "emerald")],
    tasks: {},
  });
}

export function newNotesBoard(name: string): Board {
  return normalizeBoard({ id: uid(), name, kind: "notes", notes: [], columns: [], tasks: {} });
}

export function newGlossaryBoard(name: string): Board {
  return normalizeBoard({ id: uid(), name, kind: "glossary", terms: [], columns: [], tasks: {} });
}

export function newPlanBoard(name: string, plan: Plan = emptyPlan()): Board {
  return normalizeBoard({ id: uid(), name, kind: "plan", plan, columns: [], tasks: {} });
}

export const boardFileName = (b: Board) => `${slugify(b.name)}-${b.id}.json`;

export async function loadProjects(vault: string): Promise<ProjectEntry[]> {
  const entries = await listDir(vault);
  const out: ProjectEntry[] = [];
  await Promise.all(
    entries
      .filter((e) => e.is_dir && !e.name.startsWith("."))
      .map(async (e) => {
        const raw = await readJson<Partial<Project>>(projectFile(vault, e.name));
        if (raw) out.push({ project: normalizeProject(raw), dir: e.name });
      }),
  );
  return out.sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt));
}

export async function loadBoards(vault: string, dir: string): Promise<BoardEntry[]> {
  const entries = await listDir(boardsDir(vault, dir));
  const out: BoardEntry[] = [];
  await Promise.all(
    entries
      .filter((e) => !e.is_dir && e.name.endsWith(".json"))
      .map(async (e) => {
        const raw = await readJson<Partial<Board>>(boardFile(vault, dir, e.name));
        if (raw) out.push({ board: normalizeBoard(raw), file: e.name });
      }),
  );
  return out;
}

export async function loadDecisions(vault: string, dir: string): Promise<Record<string, DecisionEntry>> {
  const entries = await listDir(decisionsDir(vault, dir));
  const out: Record<string, DecisionEntry> = {};
  await Promise.all(
    entries
      .filter((e) => !e.is_dir && e.name.endsWith(".json"))
      .map(async (e) => {
        const raw = await readJson<Partial<Decision>>(decisionFile(vault, dir, e.name));
        if (!raw) return;
        const decision = normalizeDecision(raw);
        out[decision.id] = { decision, file: e.name };
      }),
  );
  return out;
}

export async function loadIssueCache(vault: string, dir: string): Promise<IssueCache> {
  const raw = await readJson<IssueCache>(issueCacheFile(vault, dir));
  return raw && raw.repos ? raw : { repos: {} };
}
