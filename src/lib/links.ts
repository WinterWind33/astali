import { doneColumn } from "./labelColumns";
import type { Board, Task, TaskLink } from "./types";

/*
 * Links between tasks of a project, on the same board or across boards. Each link is stored once,
 * on the task it starts from: `{ type: "blocks", board, task }` on the blocker, `{ type: "relates",
 * board, task }` on either side. "Blocked by" is read back from the other tasks. A pair of tasks has
 * at most one link, and `links` is left out of a task that has none. Links to a task that is gone
 * are skipped when read. The MCP server (src-tauri/src/mcp.rs) follows the same rules.
 */

/** How a task relates to another, seen from the task: "blockedBy" is the other task's "blocks". */
export type LinkKind = "blocks" | "blockedBy" | "relates";

export const LINK_LABEL: Record<LinkKind, string> = {
  blocks: "Blocks",
  blockedBy: "Blocked by",
  relates: "Related to",
};

/** A task somewhere in the project. */
export interface TaskRef {
  board: string;
  task: string;
}

export interface LinkedTask {
  board: Board;
  task: Task;
}

export type TaskLinks = Record<LinkKind, LinkedTask[]>;

type Boards = Record<string, { board: Board }>;

const key = (r: TaskRef) => `${r.board}/${r.task}`;
const empty = (): TaskLinks => ({ blocks: [], blockedBy: [], relates: [] });

// One index per state of the project's boards, shared by every card and dialog.
const indexes = new WeakMap<Boards, Map<string, TaskLinks>>();

function linkIndex(boards: Boards): Map<string, TaskLinks> {
  let index = indexes.get(boards);
  if (index) return index;
  index = new Map();
  const at = (r: TaskRef) => index!.get(key(r)) ?? index!.set(key(r), empty()).get(key(r))!;
  for (const { board } of Object.values(boards)) {
    for (const task of Object.values(board.tasks)) {
      for (const l of task.links ?? []) {
        const otherBoard = boards[l.board]?.board;
        const other = otherBoard?.tasks[l.task];
        if (!otherBoard || !other || (l.board === board.id && l.task === task.id)) continue;
        const from = { board, task };
        const to = { board: otherBoard, task: other };
        if (l.type === "blocks") {
          at({ board: board.id, task: task.id }).blocks.push(to);
          at(l).blockedBy.push(from);
        } else {
          at({ board: board.id, task: task.id }).relates.push(to);
          at(l).relates.push(from);
        }
      }
    }
  }
  indexes.set(boards, index);
  return index;
}

/** The task's links, from both sides, to tasks that still exist. */
export function taskLinks(boards: Boards, ref: TaskRef): TaskLinks {
  return linkIndex(boards).get(key(ref)) ?? empty();
}

/** Whether the task sits in its board's done column. */
export function isFinished(board: Board, taskId: string): boolean {
  return !!doneColumn(board)?.taskIds.includes(taskId);
}

/** Tasks blocking this one that aren't finished yet. */
export function openBlockers(boards: Boards, ref: TaskRef): LinkedTask[] {
  return taskLinks(boards, ref).blockedBy.filter((l) => !isFinished(l.board, l.task.id));
}

function withLinks(t: Task, links: TaskLink[]): Task {
  const { links: _, ...rest } = t;
  return links.length ? { ...rest, links } : rest;
}

/** Boards changed so far by a link edit, by id. */
type Changes = Record<string, Board>;

function setTask(boards: Boards, changes: Changes, boardId: string, task: Task) {
  const board = changes[boardId] ?? boards[boardId].board;
  changes[boardId] = { ...board, tasks: { ...board.tasks, [task.id]: task } };
}

function getTask(boards: Boards, changes: Changes, r: TaskRef): Task | undefined {
  return (changes[r.board] ?? boards[r.board]?.board)?.tasks[r.task];
}

/** Removes whatever link two tasks have. */
function unlinkPair(boards: Boards, changes: Changes, a: TaskRef, b: TaskRef) {
  for (const [from, to] of [
    [a, b],
    [b, a],
  ]) {
    const t = getTask(boards, changes, from);
    const points = (l: TaskLink) => l.board === to.board && l.task === to.task;
    if (t?.links?.some(points))
      setTask(
        boards,
        changes,
        from.board,
        withLinks(
          t,
          t.links.filter((l) => !points(l)),
        ),
      );
  }
}

/** Links task `a` to task `b`, replacing any link the two already had. Returns the boards that changed. */
export function linkTasks(boards: Boards, a: TaskRef, kind: LinkKind, b: TaskRef): Changes {
  const changes: Changes = {};
  if (key(a) === key(b) || !getTask(boards, changes, a) || !getTask(boards, changes, b)) return changes;
  unlinkPair(boards, changes, a, b);
  const [from, to] = kind === "blockedBy" ? [b, a] : [a, b];
  const src = getTask(boards, changes, from)!;
  const link: TaskLink = { type: kind === "relates" ? "relates" : "blocks", board: to.board, task: to.task };
  setTask(boards, changes, from.board, withLinks(src, [...(src.links ?? []), link]));
  return changes;
}

/** Returns the boards that changed. */
export function unlinkTasks(boards: Boards, a: TaskRef, b: TaskRef): Changes {
  const changes: Changes = {};
  unlinkPair(boards, changes, a, b);
  return changes;
}

/** Points this board's links to task `from` at `to` instead, for a task that moved to another board. */
export function retargetLinks(board: Board, from: TaskRef, to: TaskRef): Board {
  let tasks: Record<string, Task> | null = null;
  for (const t of Object.values(board.tasks)) {
    if (!t.links?.some((l) => l.board === from.board && l.task === from.task)) continue;
    tasks ??= { ...board.tasks };
    tasks[t.id] = withLinks(
      t,
      t.links.map((l) => (l.board === from.board && l.task === from.task ? { ...l, ...to } : l)),
    );
  }
  return tasks ? { ...board, tasks } : board;
}

/**
 * Drops links from this board's tasks to tasks of the same board that are gone. Links to other
 * boards are left alone (they are skipped when read), so undoing a deletion there brings them back.
 */
export function pruneLinks(board: Board): Board {
  // Links to an archived task stay, so restoring it brings them back.
  const archived = new Set(board.archive?.map((a) => a.task.id));
  const dangling = (t: Task, l: TaskLink) =>
    l.board === board.id && ((!board.tasks[l.task] && !archived.has(l.task)) || l.task === t.id);
  let tasks: Record<string, Task> | null = null;
  for (const t of Object.values(board.tasks)) {
    if (!t.links?.some((l) => dangling(t, l))) continue;
    tasks ??= { ...board.tasks };
    tasks[t.id] = withLinks(
      t,
      t.links.filter((l) => !dangling(t, l)),
    );
  }
  return tasks ? { ...board, tasks } : board;
}
