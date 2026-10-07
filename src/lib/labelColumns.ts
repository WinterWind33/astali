import type { Board, Column, ColumnSource, GhIssue, GhLabel, IssueCache, LabelSource, Task } from "./types";
import { normalizeTagSource } from "./tags";
import { colorHex } from "./util";

/*
 * Label columns: a column bound to a GitHub label shows, live, the cached issues carrying it. The
 * binding is by label id, which GitHub keeps across renames, so a renamed or recolored label is
 * followed on the next sync. When the label is gone from the repository's label list the column is
 * frozen: the issues it last showed become ordinary tasks and the column turns gray.
 */

/** Color of a column whose label was deleted on GitHub (GitHub's own neutral gray). */
export const DELETED_LABEL_COLOR = "#8b949e";

export const deletedLabelName = (name: string) => `${name} (label deleted on GitHub)`;

/** The column's label while it is live, i.e. not known to be deleted. */
export function liveLabel(c: Pick<Column, "source"> | undefined): LabelSource | null {
  return c?.source?.kind === "label" && !c.source.deletedAt ? c.source : null;
}

/**
 * A column whose cards are computed rather than held: a live label column (GitHub's issues) or a
 * tag column (the board's tasks carrying some tags). Neither holds tasks of its own.
 */
export function isViewColumn(c: Pick<Column, "source"> | undefined): boolean {
  return !!liveLabel(c) || c?.source?.kind === "tags";
}

/** The board's done column: the one picked as such, else the last column that holds tasks (D-3). */
export function doneColumn(board: Pick<Board, "columns" | "doneColumn">): Column | undefined {
  const own = board.columns.filter((c) => !isViewColumn(c));
  return own.find((c) => c.id === board.doneColumn) ?? own.at(-1);
}

// Caches written before label columns have no label ids; fall back to the name there.
const carries = (i: GhIssue, src: LabelSource) =>
  i.labels.some((l) => (l.id != null ? l.id === src.labelId : l.name === src.name));

/** The issues a live label column shows: open ones first, most recently updated first. */
export function labelIssues(src: LabelSource, cache: IssueCache): GhIssue[] {
  return (cache.repos[src.repo]?.issues ?? [])
    .filter((i) => (src.showClosed || i.state === "open") && carries(i, src))
    .sort((a, b) => (a.state === b.state ? b.updatedAt.localeCompare(a.updatedAt) : a.state === "open" ? -1 : 1));
}

/**
 * The label as of the last sync: undefined when that can't be told (labels never fetched, or the
 * last sync of the repo failed), null when the label no longer exists.
 */
export function findLabel(src: LabelSource, cache: IssueCache): GhLabel | null | undefined {
  const rc = cache.repos[src.repo];
  if (!rc?.labels || rc.error) return undefined;
  const listed = rc.labels.find((l) => l.id === src.labelId);
  if (listed) return listed;
  // GitHub strips a deleted label from every issue, so one still on an issue isn't deleted, just
  // missing from the list (e.g. archived).
  for (const i of rc.issues) for (const l of i.labels) if (l.id === src.labelId) return l;
  return null;
}

export type LabelEvent =
  { kind: "renamed"; from: string; to: string } | { kind: "deleted"; name: string; kept: number };

/**
 * Brings a board's label columns in step with GitHub after the issue cache changed from `prev` to
 * `next`: a renamed or recolored label renames and recolors its column; a deleted one freezes it,
 * turning the issues it showed into tasks made by `makeTask` and graying it out. Those issues come
 * from `prev`, since GitHub strips a deleted label from its issues. Null when nothing changed.
 */
export function followLabels(
  board: Board,
  prev: IssueCache,
  next: IssueCache,
  at: string,
  makeTask: (issue: GhIssue) => Task,
): { columns: Column[]; tasks: Record<string, Task>; events: LabelEvent[] } | null {
  const tasks = { ...board.tasks };
  const events: LabelEvent[] = [];
  const columns = board.columns.map((c): Column => {
    const src = liveLabel(c);
    const label = src && findLabel(src, next);
    if (!src || label === undefined) return c;
    if (label === null) {
      const kept = labelIssues(src, prev).map(makeTask);
      for (const t of kept) tasks[t.id] = t;
      events.push({ kind: "deleted", name: src.name, kept: kept.length });
      return {
        ...c,
        name: deletedLabelName(src.name),
        color: DELETED_LABEL_COLOR,
        taskIds: kept.map((t) => t.id),
        source: { ...src, deletedAt: at },
      };
    }
    const color = `#${label.color}`;
    if (label.name === src.name && colorHex(c.color) === colorHex(color)) return c;
    if (label.name !== src.name) events.push({ kind: "renamed", from: src.name, to: label.name });
    return { ...c, name: label.name, color, source: { ...src, name: label.name } };
  });
  return columns.some((c, i) => c !== board.columns[i]) ? { columns, tasks, events } : null;
}

/** GitHub's page listing the issues with the label. */
export const labelUrl = (src: LabelSource) => `https://github.com/${src.repo}/labels/${encodeURIComponent(src.name)}`;

export function normalizeSource(s: unknown): ColumnSource | null {
  const kind = (s as { kind?: unknown } | null)?.kind;
  if (kind === "tags") return normalizeTagSource(s as object);
  // A kind of column this version doesn't know (from a newer one) is kept as it is; nothing here acts on it.
  if (typeof kind === "string" && kind !== "label") return s as ColumnSource;
  const v = s as Partial<LabelSource> | null | undefined;
  if (v?.kind !== "label" || typeof v.repo !== "string" || typeof v.labelId !== "number") return null;
  return {
    ...v,
    kind: "label",
    repo: v.repo,
    labelId: v.labelId,
    name: typeof v.name === "string" ? v.name : "label",
    showClosed: v.showClosed === true,
    deletedAt: typeof v.deletedAt === "string" ? v.deletedAt : null,
  };
}
