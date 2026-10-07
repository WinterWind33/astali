import { invoke } from "@tauri-apps/api/core";
import type { Board, IssueRef, Plan, PlanItem, PlanItemState, PlanQuestion, PlanStep } from "./types";
import { uid } from "./util";

/*
 * Plan boards: an implementation plan as ordered steps, each with notes and a checklist of nested
 * items, plus open questions. The file format and the Markdown import/export live in Rust
 * (src-tauri/src/plan.rs), shared with the MCP server; this module normalizes plans and edits them
 * immutably.
 */

export const isPlan = (b: Pick<Board, "kind"> | undefined): boolean => b?.kind === "plan";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : null);

function normalizeItem(v: Partial<PlanItem>): PlanItem {
  const state: PlanItemState = v.state === "done" || v.state === "skipped" ? v.state : "todo";
  return {
    ...v,
    id: str(v.id) || uid(),
    text: str(v.text),
    state,
    reason: str(v.reason),
    decision: num(v.decision),
    children: Array.isArray(v.children) ? v.children.map(normalizeItem) : [],
  };
}

export function normalizePlan(v: Partial<Plan> | undefined): Plan {
  const p = v ?? {};
  // Unknown fields (from a newer version) are kept throughout, like in vault.ts.
  return {
    ...p,
    goal: str(p.goal),
    issues: Array.isArray(p.issues)
      ? p.issues.filter((i): i is IssueRef => !!i && typeof i.repo === "string" && typeof i.number === "number")
      : [],
    steps: Array.isArray(p.steps)
      ? p.steps.map((s: Partial<PlanStep>) => ({
          ...s,
          id: str(s.id) || uid(),
          title: str(s.title),
          notes: str(s.notes),
          items: Array.isArray(s.items) ? s.items.map(normalizeItem) : [],
        }))
      : [],
    questions: Array.isArray(p.questions)
      ? p.questions.map((q: Partial<PlanQuestion>) => ({
          ...q,
          id: str(q.id) || uid(),
          text: str(q.text),
          answer: str(q.answer),
          resolved: q.resolved === true,
          decision: num(q.decision),
        }))
      : [],
    notes: str(p.notes),
  };
}

export const emptyPlan = (): Plan => ({ goal: "", issues: [], steps: [], questions: [], notes: "" });
export const newItem = (text = ""): PlanItem => ({
  id: uid(),
  text,
  state: "todo",
  reason: "",
  decision: null,
  children: [],
});
export const newStep = (title: string): PlanStep => ({ id: uid(), title, notes: "", items: [] });
export const newQuestion = (text: string): PlanQuestion => ({
  id: uid(),
  text,
  answer: "",
  resolved: false,
  decision: null,
});

/** Done and skipped items count as resolved; every item at any depth counts. */
export function progress(items: PlanItem[]): { resolved: number; total: number } {
  let resolved = 0;
  let total = 0;
  for (const it of items) {
    const c = progress(it.children);
    resolved += c.resolved + (it.state === "todo" ? 0 : 1);
    total += c.total + 1;
  }
  return { resolved, total };
}

export function planProgress(plan: Plan) {
  return plan.steps.reduce(
    (acc, s) => {
      const p = progress(s.items);
      return { resolved: acc.resolved + p.resolved, total: acc.total + p.total };
    },
    { resolved: 0, total: 0 },
  );
}

/** The step being worked on: the first with something left to do. */
export function currentStepId(plan: Plan): string | null {
  return (
    plan.steps.find((s) => {
      const p = progress(s.items);
      return p.resolved < p.total;
    })?.id ?? null
  );
}

// ---------------------------------------------------------------- editing items (immutable)

export function mapItem(items: PlanItem[], id: string, fn: (it: PlanItem) => PlanItem): PlanItem[] {
  return items.map((it) => (it.id === id ? fn(it) : { ...it, children: mapItem(it.children, id, fn) }));
}

export function removeItem(items: PlanItem[], id: string): PlanItem[] {
  return items.filter((it) => it.id !== id).map((it) => ({ ...it, children: removeItem(it.children, id) }));
}

/** Inserts `item` right after the item `afterId`, at its level. */
export function insertAfter(items: PlanItem[], afterId: string, item: PlanItem): PlanItem[] {
  const i = items.findIndex((it) => it.id === afterId);
  if (i >= 0) return [...items.slice(0, i + 1), item, ...items.slice(i + 1)];
  return items.map((it) => ({ ...it, children: insertAfter(it.children, afterId, item) }));
}

export function findItem(items: PlanItem[], id: string): PlanItem | undefined {
  for (const it of items) {
    if (it.id === id) return it;
    const f = findItem(it.children, id);
    if (f) return f;
  }
}

/** Makes the item the last child of the sibling above it. */
export function indent(items: PlanItem[], id: string): PlanItem[] {
  const i = items.findIndex((it) => it.id === id);
  if (i > 0) {
    const prev = items[i - 1];
    const moved = { ...prev, children: [...prev.children, items[i]] };
    return [...items.slice(0, i - 1), moved, ...items.slice(i + 1)];
  }
  if (i === 0) return items;
  return items.map((it) => ({ ...it, children: indent(it.children, id) }));
}

/** Moves the item out of its parent, right after it. */
export function outdent(items: PlanItem[], id: string): PlanItem[] {
  for (let p = 0; p < items.length; p++) {
    const parent = items[p];
    const c = parent.children.findIndex((it) => it.id === id);
    if (c >= 0) {
      const item = parent.children[c];
      const rest = { ...parent, children: parent.children.filter((it) => it.id !== id) };
      return [...items.slice(0, p), rest, item, ...items.slice(p + 1)];
    }
  }
  return items.map((it) => ({ ...it, children: outdent(it.children, id) }));
}

/** Where a dragged item lands: next to `ref` ("before"/"after"), as its last child ("inside"), or at the end of the step (no `ref`). */
export interface ItemDrop {
  stepId: string;
  ref: string | null;
  zone: "before" | "after" | "inside";
}

/** Puts `item` next to or under `ref`, wherever it is in the tree. */
function placeItem(items: PlanItem[], ref: string, item: PlanItem, zone: ItemDrop["zone"]): PlanItem[] {
  const i = items.findIndex((it) => it.id === ref);
  if (i >= 0) {
    if (zone === "inside") return items.map((it, j) => (j === i ? { ...it, children: [...it.children, item] } : it));
    const at = zone === "before" ? i : i + 1;
    return [...items.slice(0, at), item, ...items.slice(at)];
  }
  return items.map((it) => ({ ...it, children: placeItem(it.children, ref, item, zone) }));
}

/**
 * Moves an item, with its sub-items, within its step or to another one. Dropping it on itself or into its
 * own sub-items changes nothing.
 */
export function moveItem(steps: PlanStep[], id: string, drop: ItemDrop): PlanStep[] {
  const from = steps.find((s) => findItem(s.items, id));
  const item = from && findItem(from.items, id);
  if (!item || drop.ref === id || (drop.ref && findItem(item.children, drop.ref))) return steps;
  const without = steps.map((s) => (s.id === from.id ? { ...s, items: removeItem(s.items, id) } : s));
  return without.map((s) => {
    if (s.id !== drop.stepId) return s;
    if (drop.ref && findItem(s.items, drop.ref)) return { ...s, items: placeItem(s.items, drop.ref, item, drop.zone) };
    return { ...s, items: [...s.items, item] };
  });
}

/** Item ids in reading order (depth first). */
export function flatIds(items: PlanItem[]): string[] {
  return items.flatMap((it) => [it.id, ...flatIds(it.children)]);
}

// ---------------------------------------------------------------- Markdown (in Rust)

export async function planFromMarkdown(markdown: string): Promise<{ title: string | null; plan: Plan }> {
  const r = await invoke<{ title: string | null; plan: Plan }>("plan_from_markdown", { markdown });
  return { title: r.title, plan: normalizePlan(r.plan) };
}

export const planToMarkdown = (name: string, plan: Plan) => invoke<string>("plan_to_markdown", { name, plan });
