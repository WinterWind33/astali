import { isGlossary } from "./glossary";
import { isNotes } from "./notes";
import { isPlan } from "./plan";
import { collectTags } from "./tags";
import type { Board, Decision, PlanItem, ProjectView } from "./types";

/*
 * The title bar's search: one query across a project's tasks (archived ones too), notes, plan steps,
 * items and questions, decisions, glossary terms, tags and board names. Archived boards stay out, like
 * everywhere else (D-16). No index: the loaded data is scanned on each query (D-17). The MCP server's `search`
 * tool covers the same ground (src-tauri/src/mcp.rs).
 */

export type SearchKind = "task" | "note" | "plan" | "decision" | "term" | "tag" | "board";

export interface SearchHit {
  kind: SearchKind;
  /** Unique among the hits of one search. */
  key: string;
  title: string;
  /** Where it lives, e.g. "Sprint 3 › Doing". */
  where: string;
  /** The text that matched, when the title alone doesn't: `snippet` cuts the part to show from it. */
  matched?: string;
  /** An archived task, a finished plan item or a replaced decision. */
  faded?: boolean;
  score: number;
  projectId: string;
  /** The view that shows it, and the task to open there. */
  view: ProjectView;
  task?: string;
}

/** What a project holds that search looks through. */
export interface SearchSource {
  projectId: string;
  projectName: string;
  /** The project's boards, archived ones left out. */
  boards: Board[];
  decisions: Decision[];
}

/** Lower case without accents, so "cafe" finds "Café". */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** The query's words, folded. */
export const queryTokens = (q: string) => fold(q).split(/\s+/).filter(Boolean);

/** Markdown reduced to plain words, for snippets. */
const plainText = (md: string) =>
  md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~|]+/g, "")
    .replace(/^\s*[-+]\s+(\[[ xX]\]\s*)?/gm, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * How well a folded title and body match: 0 unless every token appears in one of them. Words in the
 * title count double, and a title that is, or starts with, the whole query comes first.
 */
function score(tokens: string[], title: string, body: string): number {
  let n = 0;
  for (const tok of tokens) {
    if (title.includes(tok)) n += 2;
    else if (body.includes(tok)) n += 1;
    else return 0;
  }
  const whole = tokens.join(" ");
  if (title === whole) n += 10;
  else if (title.startsWith(whole)) n += 5;
  return n;
}

/**
 * Folded text by the object it was read from. The store replaces an object whenever it changes, so an
 * entry stays right for as long as its object lives, and typing a query doesn't fold everything again.
 */
const foldCache = new WeakMap<object, { title: string; body: string }>();

function folded(owner: object | null, title: string, body: () => string) {
  const cached = owner && foldCache.get(owner);
  if (cached) return cached;
  const f = { title: fold(title), body: fold(body()) };
  if (owner) foldCache.set(owner, f);
  return f;
}

/** About `width` characters of `body` around the first token found in it. */
export function snippet(tokens: string[], body: string, width = 110): string | undefined {
  const text = plainText(body);
  const f = fold(text);
  // Folding can change the length (ligatures); only then fall back to the start.
  const same = f.length === text.length;
  let at = -1;
  for (const tok of tokens) {
    const i = f.indexOf(tok);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || !same) at = 0;
  const start = Math.max(0, at - Math.floor(width / 3));
  const out = text.slice(start, start + width).trim();
  if (!out) return undefined;
  return (start > 0 ? "…" : "") + out + (start + width < text.length ? "…" : "");
}

const label = (s: string, fallback = "Untitled") => s.trim() || fallback;

function flatItems(items: PlanItem[]): PlanItem[] {
  return items.flatMap((it) => [it, ...flatItems(it.children)]);
}

type HitInfo = Omit<SearchHit, "projectId" | "score" | "matched">;

/** Every hit for `query` in a project, best first. */
export function searchProject(src: SearchSource, query: string): SearchHit[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const out: SearchHit[] = [];
  const { projectId } = src;
  /** Checks one thing. Its body and hit are only built when they match (or aren't cached yet). */
  const check = (owner: object | null, title: string, body: () => string, info: () => HitInfo) => {
    const f = folded(owner, title, body);
    const n = score(tokens, f.title, f.body);
    if (!n) return;
    const inTitle = tokens.every((t) => f.title.includes(t));
    out.push({ ...info(), projectId, score: n, matched: inTitle ? undefined : body() });
  };

  for (const b of src.boards) {
    const boardView: ProjectView = { kind: "board", boardId: b.id };
    if (!isGlossary(b))
      check(
        null,
        b.name,
        () => b.description,
        () => ({ kind: "board", key: `board:${b.id}`, title: label(b.name), where: boardKind(b), view: boardView }),
      );

    if (isPlan(b) && b.plan) {
      b.plan.steps.forEach((step, i) => {
        const view: ProjectView = { kind: "board", boardId: b.id, stepId: step.id };
        check(
          step,
          step.title,
          () => step.notes,
          () => ({
            kind: "plan",
            key: `step:${b.id}:${step.id}`,
            title: label(step.title),
            where: label(b.name),
            view,
          }),
        );
        for (const it of flatItems(step.items))
          check(
            it,
            it.text,
            () => it.reason,
            () => ({
              kind: "plan",
              key: `item:${b.id}:${it.id}`,
              title: plainText(it.text) || "Untitled item",
              where: `${label(b.name)} › Step ${i + 1}: ${label(step.title)}`,
              faded: it.state !== "todo",
              view,
            }),
          );
      });
      for (const q of b.plan.questions)
        check(
          q,
          q.text,
          () => q.answer,
          () => ({
            kind: "plan",
            key: `question:${b.id}:${q.id}`,
            title: plainText(q.text) || "Untitled question",
            where: `${label(b.name)} › Open questions`,
            faded: q.resolved,
            view: { kind: "board", boardId: b.id, stepId: q.id },
          }),
        );
    }

    if (isNotes(b))
      for (const n of b.notes ?? [])
        check(
          n,
          n.title,
          () => `${n.description} ${n.tags.join(" ")}`,
          () => ({
            kind: "note",
            key: `note:${b.id}:${n.id}`,
            // A blank title shows the text's start instead.
            title: n.title.trim() || plainText(n.description).slice(0, 80) || "Blank note",
            where: label(b.name),
            view: { kind: "board", boardId: b.id, noteId: n.id },
          }),
        );

    if (isGlossary(b))
      for (const t of b.terms ?? [])
        check(
          t,
          t.term,
          () => `${t.definition} ${t.tags.join(" ")} ${t.source}`,
          () => ({
            kind: "term",
            key: `term:${t.id}`,
            title: label(t.term),
            where: "Glossary",
            view: { kind: "glossary", termId: t.id },
          }),
        );

    for (const c of b.columns)
      for (const id of c.taskIds) {
        const t = b.tasks[id];
        if (!t) continue;
        check(
          t,
          t.title,
          () => taskBody(t),
          () => ({
            kind: "task",
            key: `task:${b.id}:${t.id}`,
            title: label(t.title),
            where: `${label(b.name)} › ${label(c.name, "Column")}`,
            view: boardView,
            task: t.id,
          }),
        );
      }
    for (const a of b.archive ?? [])
      check(
        a.task,
        a.task.title,
        () => taskBody(a.task),
        () => ({
          kind: "task",
          key: `archived:${b.id}:${a.task.id}`,
          title: label(a.task.title),
          where: `${label(b.name)} › Archive`,
          faded: true,
          view: { kind: "board", boardId: b.id, archivedTaskId: a.task.id },
        }),
      );
  }

  for (const d of src.decisions)
    check(
      d,
      `D-${d.number} ${d.title}`,
      () => `${d.why} ${d.rejected} ${d.about.join(" ")} ${d.tags.join(" ")}`,
      () => ({
        kind: "decision",
        key: `decision:${d.id}`,
        title: `D-${d.number} ${label(d.title)}`,
        where: d.replacedBy ? `Decisions · replaced by D-${d.replacedBy}` : "Decisions",
        faded: d.replacedBy != null,
        view: { kind: "decisions", decisionId: d.id },
      }),
    );

  for (const tag of collectTags(src.boards, src.decisions))
    check(
      null,
      tag.name,
      () => "",
      () => ({
        kind: "tag",
        key: `tag:${fold(tag.name)}`,
        title: tag.name,
        where: `Used ${tag.count} time${tag.count === 1 ? "" : "s"}`,
        view: { kind: "tags", tag: { kind: "tag", name: tag.name } },
      }),
    );

  // Archived tasks, finished items and replaced decisions after the live ones that match as well.
  return out.sort((a, b) => b.score - a.score || Number(!!a.faded) - Number(!!b.faded));
}

function taskBody(t: Board["tasks"][string]) {
  const issue = t.issue ? ` #${t.issue.number}` : "";
  return `${t.description} ${t.labels.join(" ")} ${t.checklist.map((c) => c.text).join(" ")}${issue}`;
}

function boardKind(b: Board) {
  return isPlan(b) ? "Plan" : isNotes(b) ? "Notes board" : "Board";
}

/** The kinds in the order their groups are listed, with their headings. */
export const SEARCH_GROUPS: { kind: SearchKind; title: string }[] = [
  { kind: "task", title: "Tasks" },
  { kind: "note", title: "Notes" },
  { kind: "plan", title: "Plans" },
  { kind: "decision", title: "Decisions" },
  { kind: "term", title: "Glossary" },
  { kind: "tag", title: "Tags" },
  { kind: "board", title: "Boards" },
];
