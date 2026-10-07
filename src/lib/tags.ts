import { hslToHex } from "./color";
import type { Board, Color, Column, Decision, Project, Task, TagSource } from "./types";
import { colorHex } from "./util";

/*
 * Tags are the free-form labels on tasks (GitHub labels are separate: they come from the issue a
 * task links to, and GitHub owns them). A tag is matched case-insensitively everywhere; its color
 * is the one picked in the project, else one derived from its name.
 */

export const tagKey = (tag: string) => tag.trim().toLowerCase();

/** Deterministic pleasant hue for a tag without a picked color. */
export function tagHue(tag: string) {
  let h = 0;
  for (const c of tagKey(tag)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export const defaultTagColor = (tag: string) => hslToHex(tagHue(tag), 70, 58);

/** The tag's color as "#rrggbb". */
export function tagColor(tag: string, colors: Project["tagColors"] | undefined): string {
  const picked = colors?.[tagKey(tag)];
  return picked ? colorHex(picked) : defaultTagColor(tag);
}

export const hasTag = (t: Task, tag: string) => t.labels.some((l) => tagKey(l) === tagKey(tag));

/** The tag column a column is, if it is one. */
export function tagSource(c: Pick<Column, "source"> | undefined): TagSource | null {
  return c?.source?.kind === "tags" ? c.source : null;
}

/** Whether a task shows in a tag column. */
export function matchesTags(t: Task, src: TagSource) {
  if (!src.tags.length) return false;
  return src.match === "all" ? src.tags.every((g) => hasTag(t, g)) : src.tags.some((g) => hasTag(t, g));
}

/** The board's tasks a tag column shows, in board order (column by column, top to bottom). */
export function taggedTaskIds(board: Board, src: TagSource): string[] {
  return board.columns.flatMap((c) =>
    c.source?.kind === "tags" ? [] : c.taskIds.filter((id) => board.tasks[id] && matchesTags(board.tasks[id], src)),
  );
}

/** The tags to add so a task dropped on a tag column shows in it; empty when it already does. */
export function tagsToAdd(t: Task, src: TagSource): string[] {
  if (matchesTags(t, src)) return [];
  return src.match === "all" ? src.tags.filter((g) => !hasTag(t, g)) : src.tags.slice(0, 1);
}

export const tagColumnName = (src: Pick<TagSource, "tags" | "match">) =>
  src.tags.join(src.match === "all" ? " + " : " / ");

export function describeTagSource(src: TagSource) {
  const list = src.tags.map((t) => `“${t}”`).join(src.match === "all" ? " and " : " or ");
  return `Live view of this board's tasks tagged ${list}`;
}

/**
 * Every tag used on these boards (tasks and notes, and decisions, which share the project's tags) with
 * how many tasks, notes and decisions carry it, spelled as first seen; most used first.
 */
export function collectTags(
  boards: Board[],
  decisions: Pick<Decision, "tags">[] = [],
): { name: string; count: number }[] {
  const byKey = new Map<string, { name: string; count: number }>();
  const count = (labels: string[]) => {
    for (const l of new Set(labels.map(tagKey))) {
      const e = byKey.get(l);
      if (e) e.count++;
      else byKey.set(l, { name: labels.find((x) => tagKey(x) === l)!, count: 1 });
    }
  };
  for (const b of boards) {
    for (const t of Object.values(b.tasks)) count(t.labels);
    for (const n of b.notes ?? []) count(n.tags);
  }
  for (const d of decisions) count(d.tags);
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The project's decisions, as a list (the store keeps them keyed by id). */
export const decisionList = (decisions: Record<string, { decision: Decision }>) =>
  Object.values(decisions).map((e) => e.decision);

export function normalizeTagSource(v: Partial<TagSource>): TagSource | null {
  if (!Array.isArray(v.tags)) return null;
  const seen = new Set<string>();
  const tags = v.tags
    .filter((t): t is string => typeof t === "string" && !!t.trim() && !seen.has(tagKey(t)) && !!seen.add(tagKey(t)))
    .map((t) => t.trim());
  return { ...v, kind: "tags", tags, match: v.match === "all" ? "all" : "any" };
}

export function normalizeTagColors(v: unknown, normalize: (c: unknown) => Color | null): Record<string, Color> {
  const out: Record<string, Color> = {};
  if (v && typeof v === "object")
    for (const [k, c] of Object.entries(v)) {
      const n = normalize(c);
      if (k.trim() && n) out[tagKey(k)] = n;
    }
  return out;
}

/** How lists of tags (and GitHub labels) are ordered. */
export type TagSort = "most" | "least" | "az" | "za";

/** Orders by `sort`, falling back to the name (then most used) to break ties. */
export function tagOrder<T>(sort: TagSort, name: (x: T) => string, count: (x: T) => number) {
  return (a: T, b: T) => {
    const byName = name(a).localeCompare(name(b), undefined, { sensitivity: "base", numeric: true });
    switch (sort) {
      case "most":
        return count(b) - count(a) || byName;
      case "least":
        return count(a) - count(b) || byName;
      case "az":
        return byName || count(b) - count(a);
      case "za":
        return -byName || count(b) - count(a);
    }
  };
}
