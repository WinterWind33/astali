export const SCHEMA_VERSION = 1;

export type ColorKey = "slate" | "violet" | "blue" | "cyan" | "emerald" | "lime" | "amber" | "orange" | "rose" | "pink";

/** A preset key, or any custom color as "#rrggbb". */
export type Color = ColorKey | (string & {});

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  color: Color;
  repos: RepoRef[];
  /** Colors the user picked for tags, keyed by the tag in lowercase; other tags get a color derived from their name. */
  tagColors: Record<string, Color>;
  /** Most characters a decision's why and rejected alternative may hold together. */
  decisionCharLimit: number;
  boardOrder: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  name: string;
  color: Color;
  wipLimit: number | null;
  /** Shown on the board as a narrow strip with just its name and count. Absent when expanded. */
  collapsed?: boolean;
  taskIds: string[];
  /** Where the column's cards come from when GitHub decides them; null for an ordinary column. */
  source: ColumnSource | null;
}

/**
 * A column bound to a GitHub label. While the label exists the column is a live, read-only view of
 * the cached issues carrying it (`taskIds` stays empty), and its name and color follow the label.
 */
export interface LabelSource {
  kind: "label";
  /** "owner/repo". */
  repo: string;
  /** GitHub's label id, which survives renames, so the column can follow them. */
  labelId: number;
  /** The label's name at the last sync. */
  name: string;
  /** Also show closed issues and merged/closed pull requests. */
  showClosed: boolean;
  /**
   * When the label was found deleted on GitHub. The column then holds the issues it last showed
   * as ordinary tasks and behaves like any other column.
   */
  deletedAt: string | null;
}

/**
 * A column showing, live, the board's tasks that carry some tags. The tasks stay in their own
 * columns (`taskIds` stays empty); dropping a task on the column adds the tags to it.
 */
export interface TagSource {
  kind: "tags";
  /** As typed; matched case-insensitively. */
  tags: string[];
  /** "any": a task needs one of the tags; "all": every one of them. */
  match: "any" | "all";
}

export type ColumnSource = LabelSource | TagSource;

export type Priority = "none" | "low" | "medium" | "high" | "urgent";

/** Pointer to a GitHub issue, as "owner/repo" + number. */
export interface IssueRef {
  repo: string;
  number: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** A link from a task to another task of the project; see src/lib/links.ts. */
export interface TaskLink {
  type: "blocks" | "relates";
  /** Board id of the other task (this task's own board for a link within it). */
  board: string;
  task: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  labels: string[];
  dueDate: string | null;
  issue: IssueRef | null;
  checklist: ChecklistItem[];
  /** Links to other tasks of the project, stored on the task they start from. Absent when there are none. */
  links?: TaskLink[];
  createdAt: string;
  updatedAt: string;
}

export type PlanItemState = "todo" | "done" | "skipped";

/** A checklist item of a plan step; items nest. */
export interface PlanItem {
  id: string;
  /** Markdown (inline). */
  text: string;
  state: PlanItemState;
  /** Why it was skipped; "" otherwise. */
  reason: string;
  /** Number of the decision it led to. */
  decision: number | null;
  children: PlanItem[];
}

export interface PlanStep {
  id: string;
  title: string;
  /** Markdown: design notes, the state of the code, anything that isn't a checklist item. */
  notes: string;
  items: PlanItem[];
}

export interface PlanQuestion {
  id: string;
  text: string;
  answer: string;
  resolved: boolean;
  decision: number | null;
}

/** What a plan board holds (see src-tauri/src/plan.rs). */
export interface Plan {
  /** Markdown: what the plan is for. */
  goal: string;
  issues: IssueRef[];
  steps: PlanStep[];
  questions: PlanQuestion[];
  /** Markdown: known limits and anything else. */
  notes: string;
}

/** A post-it on a notes board. */
export interface Note {
  id: string;
  title: string;
  /** Markdown. Title and description together fit the board's `noteLimit`. */
  description: string;
  /** The project's own tags (never GitHub labels). */
  tags: string[];
  issues: IssueRef[];
  /** The note's color; null follows its first tag (or plain yellow when it has none). */
  color: Color | null;
  /** Top-left corner on the (endless) board, in pixels at 100% zoom; may be negative. */
  x: number;
  y: number;
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  /**
   * "plan" boards hold a `plan`, "notes" boards hold `notes`, instead of columns and tasks; absent
   * means a kanban board.
   */
  kind?: "plan" | "notes";
  plan?: Plan;
  /** Post-its of a notes board, bottom to top (the last one is drawn over the others). */
  notes?: Note[];
  /** Most characters a note's title and description may hold together, on a notes board. */
  noteLimit?: number;
  columns: Column[];
  /**
   * Id of the column where finished work ends up, which the progress bar counts and blocked tasks
   * wait on. Absent, or naming a column that is gone, means the last column that holds tasks.
   */
  doneColumn?: string;
  /** Whether a task moved into the done column is archived right away. */
  autoArchive?: boolean;
  /**
   * Finished tasks put away from the board, newest first: off the columns and out of `tasks`, but
   * kept with the column they left, to search and restore (D-8). Absent when there are none.
   */
  archive?: ArchivedTask[];
  tasks: Record<string, Task>;
  createdAt: string;
  updatedAt: string;
}

/** A task in a board's archive. */
export interface ArchivedTask {
  task: Task;
  /** The column it was archived from, where restoring puts it back when it still exists. */
  from: string;
  /** When it was archived. */
  at: string;
}

/**
 * Why something in the code is the way it is: one file in `<project>/decisions/`, short on purpose
 * (`why` + `rejected` fit the project's `decisionCharLimit`).
 */
export interface Decision {
  schemaVersion: number;
  id: string;
  /** Shown as "D-12"; unique in the project, in creation order. */
  number: number;
  title: string;
  /** Markdown. */
  why: string;
  /** The alternative not taken, and why not; "" when there is none. */
  rejected: string;
  /** Code it explains: class or function names, file or folder paths. */
  about: string[];
  tags: string[];
  issues: IssueRef[];
  /** Number of the decision that replaced this one. */
  replacedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionEntry {
  decision: Decision;
  /** File name inside <project>/decisions. */
  file: string;
}

export interface GhLabel {
  /** Missing in caches written before label columns existed. */
  id?: number;
  name: string;
  /** "rrggbb", without the "#". */
  color: string;
  description?: string;
}

export interface GhIssue {
  repo: string;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  stateReason: string | null;
  url: string;
  isPullRequest: boolean;
  labels: GhLabel[];
  author: string;
  authorAvatar: string;
  assignees: string[];
  comments: number;
  milestone: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface RepoCache {
  fetchedAt: string;
  issues: GhIssue[];
  /** Every label of the repository; missing in caches written before label columns existed. */
  labels?: GhLabel[];
  error?: string;
}

export interface IssueCache {
  repos: Record<string, RepoCache>;
}

export interface ProjectEntry {
  project: Project;
  /** Folder name inside the vault. */
  dir: string;
}

export interface BoardEntry {
  board: Board;
  /** File name inside <project>/boards. */
  file: string;
}

/** The user's choice; "system" follows the OS setting. */
export type Theme = "dark" | "light" | "system";

/** A named color the user saved for reuse. */
export interface FavoriteColor {
  id: string;
  name: string;
  hex: string;
}

export interface AppConfig {
  recentVaults: string[];
  /**
   * Names given to vaults, by path, as last seen in each vault's `.astali/vault.json`: kept here so lists
   * of vaults that aren't open can show them. A vault without a name goes by its folder's name.
   */
  vaultNames: Record<string, string>;
  /** The app version whose news the user has seen; "What's new" shows what came after it. */
  lastSeenVersion?: string | null;
  lastVault: string | null;
  /** Held in memory; saved in the OS credential store, not in config.json (see saveConfig in store.ts). */
  githubToken: string;
  /** When the token expires, as GitHub last reported it; null when it never does or isn't known yet. */
  githubTokenExpiresAt: string | null;
  theme: Theme;
  /** Holiday themes (Halloween, Christmas, Easter) on top of the theme while their dates last. */
  seasonalThemes: boolean;
  /** Ask GitHub for a newer version when Astali starts; installing always waits for a click. */
  checkForUpdates: boolean;
  /** Vaults for which the "inside a git repo" suggestion was dismissed. */
  dismissedGitPrompts: string[];
  favoriteColors: FavoriteColor[];
}

/** The vault's enclosing git repository, as reported by the backend. */
export interface GitStatus {
  repoRoot: string;
  gitignorePath: string;
  vaultRel: string;
  /** True when Astali's managed block is present in the repo's .gitignore. */
  enabled: boolean;
  entries: string[];
}

/** Branch and working-tree summary of the vault's repository. */
export interface RepoInfo {
  /** Null when HEAD is detached. */
  branch: string | null;
  /** Abbreviated HEAD commit; null before the first commit. */
  commit: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  /** Web page of the remote, e.g. { short: "owner/repo", url: "https://github.com/owner/repo" }. */
  remote: { short: string; url: string } | null;
  /** "owner:branch" to find the branch's pull request with; null unless it tracks a GitHub branch. */
  prHead: string | null;
  /** GitHub repos ("owner/repo") the pull request may target. */
  prRepos: string[];
}

/** Open pull request for the vault repository's current branch. */
export interface BranchPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  draft: boolean;
}

/** One recorded change to the vault (see src-tauri/src/history.rs), as listed for display. */
export interface HistoryEntry {
  id: string;
  /** Unix milliseconds. */
  t: number;
  at: string;
  /** Made in the app, or by an MCP client. */
  by: "app" | "mcp";
  /** MCP client name, e.g. "claude-code". */
  client?: string;
  /** MCP tool that made the change. */
  tool?: string;
  /** Set when this entry is the undo of another one. */
  undoes?: string;
  project: { id: string; name: string };
  board?: { id: string; name: string };
  /** Change kinds, e.g. "task.move", "project.delete". */
  ops: string[];
  headline: string;
  /** One line per change. */
  details: string[];
  /** Tasks the entry touched. */
  tasks: string[];
  undone: boolean;
  /** The entry that undid this one; undoing it redoes this one. */
  undoneBy?: string;
}

export type ProjectView =
  | { kind: "board"; boardId: string; noteId?: string }
  | { kind: "issues" }
  | { kind: "activity"; boardId?: string }
  | { kind: "tags"; tag?: TagRef }
  | { kind: "decisions"; decisionId?: string }
  | { kind: "empty" };

/** A tag of the project's tasks, or a label of one of its GitHub repositories. */
export type TagRef = { kind: "tag"; name: string } | { kind: "label"; repo: string; name: string };

export type Route = { name: "home" } | { name: "project"; projectId: string; view: ProjectView };
