import { isViewColumn } from "./labelColumns";
import { NOTE_WIDTH } from "./notes";
import { newStep } from "./plan";
import { addNote, addTask, orderedBoards, patchPlan } from "./store";
import type { Board, IssueRef } from "./types";
import { issueKey } from "./util";

/*
 * Promotion turns an item (a note today) into another kind of item: a task, a plan step, a
 * decision… Sources describe themselves as a `Promotable`; destinations come from each board kind's
 * receiver below, plus the project-wide ones (decisions). `RECEIVERS` is keyed by every board kind,
 * so adding a kind to `Board["kind"]` doesn't compile until it says how it takes promoted items in
 * (an empty list is a valid answer).
 */

/** What any item can be promoted from: the common ground of tasks, notes, steps and decisions. */
export interface Promotable {
  title: string;
  /** Markdown. */
  body: string;
  tags: string[];
  issues: IssueRef[];
}

export type PromoteIcon = "kanban" | "plan" | "notes" | "decision";

/** Where the promoted item ended up, for the confirmation. */
export interface Promoted {
  what: string;
}

export interface PromoteTarget {
  /** Unique among the targets offered at once. */
  id: string;
  /** Heading the target is listed under, e.g. the board's name. */
  group: string;
  icon: PromoteIcon;
  /** e.g. "Task in “To Do”". */
  label: string;
  /** What doesn't carry over, in a word or two (e.g. "tags"), when something doesn't. */
  loses?: string;
  /** The board the target belongs to, so an item isn't offered its own board. */
  boardId?: string;
  /**
   * Creates the item. "dialog" targets (decisions) only open their editor, whose own save completes
   * the promotion; see `PromoteDialog`.
   */
  run: ((item: Promotable) => Promoted | null) | "dialog";
}

export type BoardKind = "kanban" | NonNullable<Board["kind"]>;

export const boardKind = (b: Pick<Board, "kind">): BoardKind => b.kind ?? "kanban";

/** A task takes one issue; the others are listed at the end of its description so they aren't lost. */
function taskFrom(item: Promotable) {
  const [first, ...rest] = item.issues;
  const extra = rest.length ? `\n\nAlso: ${rest.map(issueKey).join(", ")}` : "";
  return {
    title: item.title.trim() || "Untitled",
    description: (item.body.trim() + extra).trim(),
    labels: item.tags,
    issue: first ?? null,
  };
}

/** How each kind of board takes in a promoted item. */
const RECEIVERS: Record<BoardKind, (board: Board) => PromoteTarget[]> = {
  kanban: (board) =>
    board.columns
      .filter((c) => !isViewColumn(c))
      .map((c) => ({
        id: `${board.id}:${c.id}`,
        group: board.name,
        icon: "kanban",
        label: `Task in “${c.name}”`,
        boardId: board.id,
        run: (item) =>
          addTask(board.id, c.id, taskFrom(item)) ? { what: `a task in ${board.name} · ${c.name}` } : null,
      })),
  plan: (board) => [
    {
      id: board.id,
      group: board.name,
      icon: "plan",
      label: "New step",
      // Steps have no tags; the issues are linked to the plan instead.
      loses: "tags",
      boardId: board.id,
      run: (item) => {
        const step = { ...newStep(item.title.trim() || "Untitled step"), notes: item.body.trim() };
        patchPlan(board.id, (p) => ({
          ...p,
          steps: [...p.steps, step],
          issues: [...p.issues, ...item.issues.filter((i) => !p.issues.some((x) => issueKey(x) === issueKey(i)))],
        }));
        return { what: `step ${(board.plan?.steps.length ?? 0) + 1} of ${board.name}` };
      },
    },
  ],
  notes: (board) => [
    {
      id: board.id,
      group: board.name,
      icon: "notes",
      label: "Note",
      boardId: board.id,
      run: (item) => {
        // Below whatever is already there, so it doesn't land on top of another note.
        const y = Math.max(0, ...(board.notes ?? []).map((n) => n.y + 180)) + 24;
        addNote(board.id, 40 + NOTE_WIDTH / 4, y, {
          title: item.title,
          description: item.body,
          tags: item.tags,
          issues: item.issues,
        });
        return { what: `a note on ${board.name}` };
      },
    },
  ],
};

/** Destinations that aren't boards. */
const PROJECT_TARGETS: PromoteTarget[] = [
  { id: "decision", group: "Decisions", icon: "decision", label: "Decision", run: "dialog" },
];

/** Everywhere an item can be promoted to in the current project, leaving out the board it is on. */
export function promoteTargets(fromBoardId?: string): PromoteTarget[] {
  return [
    ...orderedBoards()
      .filter((b) => b.id !== fromBoardId)
      .flatMap((b) => RECEIVERS[boardKind(b)](b)),
    ...PROJECT_TARGETS,
  ];
}
