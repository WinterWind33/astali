import { Ban, CircleCheck, Link2, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { LINK_LABEL, isFinished, taskLinks, type LinkKind, type LinkedTask } from "../../lib/links";
import { isViewColumn } from "../../lib/labelColumns";
import { linkTask, openTaskOnBoard, orderedBoards, unlinkTask, useStore } from "../../lib/store";
import type { Board } from "../../lib/types";
import { cx } from "../../lib/util";
import { Popover } from "../ui";

const KINDS: LinkKind[] = ["blockedBy", "blocks", "relates"];

/** Name of the column each task of the board is in. */
function columnOf(board: Board, taskId: string) {
  return board.columns.find((c) => !isViewColumn(c) && c.taskIds.includes(taskId))?.name ?? "";
}

/** Where a linked task is: its column, after its board's name when that's another board. */
function where(l: LinkedTask, here: string) {
  const column = columnOf(l.board, l.task.id);
  return l.board.id === here ? column : `${l.board.name} · ${column}`;
}

/** The task dialog's Links section: tasks of the project this one blocks, is blocked by, or relates to. */
export function TaskLinks({
  boardId,
  taskId,
  onOpenTask,
  mayLeave,
}: {
  boardId: string;
  taskId: string;
  onOpenTask?: (id: string) => void;
  /** Asked before opening a linked task in place of this one, e.g. to keep unsaved edits. */
  mayLeave?: () => Promise<boolean>;
}) {
  const boards = useStore((s) => s.boards);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const here = { board: boardId, task: taskId };
  const links = taskLinks(boards, here);

  const open = async (l: LinkedTask) => {
    if (mayLeave && !(await mayLeave())) return;
    if (l.board.id === boardId) onOpenTask?.(l.task.id);
    else openTaskOnBoard(l.board.id, l.task.id);
  };

  return (
    <>
      <div className="section-head">
        <span>
          <Link2 size={14} /> Links
        </span>
        <button className="btn ghost small" onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}>
          <Plus size={13} /> Link a task
        </button>
      </div>
      {KINDS.filter((k) => links[k].length > 0).map((k) => (
        <div key={k} className="link-group">
          <div className="link-group-label">{LINK_LABEL[k]}</div>
          {links[k].map((l) => {
            const finished = isFinished(l.board, l.task.id);
            const blocking = k === "blockedBy" && !finished;
            return (
              <div
                key={`${l.board.id}/${l.task.id}`}
                className={cx("link-row", finished && "finished", blocking && "blocking")}
              >
                {blocking ? <Ban size={14} /> : finished ? <CircleCheck size={14} /> : <Link2 size={14} />}
                <button className="link-title" onClick={() => open(l)} title={l.task.title}>
                  {l.task.title}
                </button>
                <span className="faint small">{where(l, boardId)}</span>
                <button
                  className="icon-btn tiny"
                  title="Remove link"
                  onClick={() => unlinkTask(here, { board: l.board.id, task: l.task.id })}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
      {anchor && (
        <Popover anchor={anchor} align="right" onClose={() => setAnchor(null)}>
          <TaskPicker
            boardId={boardId}
            exclude={taskId}
            onPick={(kind, other) => {
              linkTask(here, kind, other);
              setAnchor(null);
            }}
          />
        </Popover>
      )}
    </>
  );
}

/**
 * Choose how to link, then the task to link to: this board's tasks first, then those of the
 * project's other kanban boards, each in column order.
 */
function TaskPicker({
  boardId,
  exclude,
  onPick,
}: {
  boardId: string;
  exclude: string;
  onPick: (kind: LinkKind, other: { board: string; task: string }) => void;
}) {
  const boards = useStore((s) => s.boards);
  const [kind, setKind] = useState<LinkKind>("blockedBy");
  const [q, setQ] = useState("");
  const all = useMemo(() => {
    const kanban = orderedBoards().filter((b) => !b.kind);
    const sorted = [...kanban.filter((b) => b.id === boardId), ...kanban.filter((b) => b.id !== boardId)];
    return sorted.flatMap((board) =>
      board.columns
        .filter((c) => !isViewColumn(c))
        .flatMap((c) => c.taskIds)
        .map((id) => board.tasks[id])
        .filter((task) => task && !(board.id === boardId && task.id === exclude))
        .map((task): LinkedTask => ({ board, task })),
    );
  }, [boards, boardId, exclude]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = q.trim().toLowerCase();
  const shown = s
    ? all.filter((l) => l.task.title.toLowerCase().includes(s) || l.board.name.toLowerCase().includes(s))
    : all;

  return (
    <div className="issue-picker">
      <div className="segmented tiny link-kinds">
        {KINDS.map((k) => (
          <button key={k} className={cx(kind === k && "active")} onClick={() => setKind(k)}>
            {LINK_LABEL[k]}
          </button>
        ))}
      </div>
      <label className="search">
        <Search size={14} />
        <input
          autoFocus
          placeholder="Search tasks or boards in this project"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div className="issue-picker-list">
        {all.length === 0 && <div className="faint small pad">No other tasks in this project yet.</div>}
        {shown.map((l) => (
          <button
            key={`${l.board.id}/${l.task.id}`}
            className="issue-picker-item"
            onClick={() => onPick(kind, { board: l.board.id, task: l.task.id })}
          >
            <span className="issue-picker-title">{l.task.title}</span>
            <span className="faint small">{where(l, boardId)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
