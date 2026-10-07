import { join, listDir, readJson, readText, writeNow, writeText } from "./fs";
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

const AGENTS_MD = `${AGENTS_HEADING}

This folder is an Astali kanban vault. Everything is plain JSON; the Astali desktop app watches
this folder and reloads live, so edits made here (by hand or by an AI agent) appear instantly.
The app keeps this guide up to date and rewrites it when the format changes, so don't keep notes in it.

**Preferred for AI agents:** use the Astali MCP server (\`astali mcp --vault <this folder>\`), which
validates input and keeps files consistent. Editing the JSON directly also works if you follow the rules below.

## Layout

- \`<project-folder>/project.json\` — one folder per project (any folder name; not starting with ".")
- \`<project-folder>/boards/*.json\` — one file per board
- \`<project-folder>/decisions/*.json\` — one file per decision (why the code is the way it is)
- \`<project-folder>/.cache/github-issues.json\` — read-only cache of GitHub issues (regenerated on sync)
- \`.astali/vault.json\` — marks the folder as a vault; its optional \`name\` is the vault's name in the app (else the folder's).
- \`.astali/history.jsonl\` — change history written by the app and the MCP server (don't edit it). Edits made
  directly to the JSON files are not recorded there, so they can't be undone from the app

## project.json
\`{ schemaVersion: 1, id, name, description, color, repos: [{owner, repo}], tagColors: { [tag lowercase]: color }, decisionCharLimit: number, boardOrder: [boardId...], createdAt, updatedAt }\`

\`tagColors\` holds the colors picked for task tags (\`Task.labels\`); tags not listed get a color derived from their name.
\`decisionCharLimit\` (a whole number from 50 to 5000, default 500) caps a decision's \`why\` + \`rejected\`, in characters.

## decision file (\`decisions/d<number>-<id>.json\`)
\`{ schemaVersion: 1, id, number, title, why (markdown), rejected, about: [string], tags: [string], issues: [{repo: "owner/name", number}], replacedBy: number|null, createdAt, updatedAt }\`

- \`number\` is shown as D-<number>: unique in the project, the next one is the highest + 1.
- \`about\` lists the code the decision explains (class or function names, paths); search matches it first.
- \`replacedBy\` is the number of the decision that superseded this one.
- Keep \`why\` + \`rejected\` within the project's \`decisionCharLimit\`.

## board file
\`{ schemaVersion: 1, id, name, description, columns: [Column], doneColumn?: columnId, autoArchive?: true, tasks: { [taskId]: Task }, archive?: [{ task: Task, from: columnId, at }], createdAt, updatedAt }\`

\`archive\` holds finished tasks put away from the board, newest first: they are in no column and not in \`tasks\`,
\`from\` is the column they left (restoring puts them back there), and they count as done.

\`doneColumn\` is the column where finished work ends up: the progress bar counts its tasks, and a task blocked by
one of them isn't blocked any more. When it is absent, or names a column that is gone, the last column that holds
tasks is the done column.
With \`autoArchive: true\`, a task moved into the done column goes straight to the archive (\`from\` is the done column).

A board with \`kind: "plan"\` is an implementation plan instead: its \`columns\` and \`tasks\` stay empty and it holds
\`plan: { goal (markdown), issues: [{repo, number}], steps: [Step], questions: [Question], notes (markdown) }\`:

- Step: \`{ id, title, notes (markdown), items: [Item] }\` — steps are shown numbered, in this order.
- Item: \`{ id, text (markdown), state: "todo"|"done"|"skipped", reason (why it was skipped), decision: number|null, children: [Item] }\`
- Question: \`{ id, text, answer, resolved: boolean, decision: number|null }\` — \`decision\` is a decision's number (D-<number>).

A board with \`kind: "notes"\` is a board of post-its instead: its \`columns\` and \`tasks\` stay empty and it holds
\`noteLimit: number\` (most characters a note's title and description may hold together) and \`notes: [Note]\`:

- Note: \`{ id, title, description (markdown), tags: [string] (the project's tags), issues: [{repo, number}], color: null|Color, x, y, createdAt, updatedAt }\`
  — \`color\` null follows the note's first tag (plain yellow without tags).
  — \`x\`/\`y\` are the note's top-left corner in pixels (the board is endless: they may be negative); later notes are drawn over earlier ones.

- Column: \`{ id, name, color, wipLimit: number|null, collapsed?: true, taskIds: [taskId...], source: null|LabelSource|TagSource }\` — order of \`taskIds\` is the card order.
  \`collapsed\` is only written while the column is collapsed to a narrow strip on the board.
- LabelSource: \`{ kind: "label", repo: "owner/name", labelId: number, name, showClosed: boolean, deletedAt: ISO|null }\`.
  While \`deletedAt\` is null the column is a live view of the cached issues carrying that GitHub label: the app
  computes its cards, keeps \`taskIds\` empty and keeps \`name\`/\`color\` in step with the label. Don't put tasks in it.
- TagSource: \`{ kind: "tags", tags: [string], match: "any"|"all" }\`. The column is a live view of the board's tasks
  carrying any (or all) of the tags, case-insensitively; the tasks stay in their own columns. \`taskIds\` stays empty.
- Task: \`{ id, title, description (markdown), priority: "none"|"low"|"medium"|"high"|"urgent", labels: [string] (the task's tags),
  dueDate: "YYYY-MM-DD"|null, issue: {repo: "owner/name", number}|null, checklist: [{id, text, done}],
  links?: [{type: "blocks"|"relates", board: <board id>, task: <task id>}], createdAt, updatedAt }\`.
  A link is stored once, on the task it starts from ("blocked by" is the other task's "blocks"); a pair of tasks has
  at most one link, and \`links\` is left out when empty.
- Colors: a preset (slate, violet, blue, cyan, emerald, lime, amber, orange, rose, pink) or any hex color "#rrggbb".

## Rules
- Every task must be listed in exactly one column's \`taskIds\`.
- IDs are short random lowercase alphanumeric strings and must be unique.
- Timestamps are ISO-8601. Bump \`updatedAt\` when you change something.
- Keep JSON valid (2-space indent). Never write to \`.cache/\`.
`;

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
