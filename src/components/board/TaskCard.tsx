import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { AlignLeft, Ban, Calendar, CheckSquare, Columns3 } from "lucide-react";
import { memo } from "react";
import { openBlockers } from "../../lib/links";
import { useStore } from "../../lib/store";
import type { Priority, Task } from "../../lib/types";
import { cx, dueStatus, formatDate } from "../../lib/util";
import { GhLabelChip, IssueStateIcon, TagChip } from "../ui";

export const PRIORITY_META: Record<Priority, { label: string; level: number }> = {
  none: { label: "No priority", level: 0 },
  low: { label: "Low", level: 1 },
  medium: { label: "Medium", level: 2 },
  high: { label: "High", level: 3 },
  urgent: { label: "Urgent", level: 4 },
};

export function PriorityIcon({ priority }: { priority: Priority }) {
  const level = PRIORITY_META[priority].level;
  if (priority === "urgent")
    return (
      <span className="priority-icon urgent" title="Urgent">
        !
      </span>
    );
  return (
    <span className={cx("priority-icon", `p-${priority}`)} title={PRIORITY_META[priority].label}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cx("bar", i <= level && "on")} style={{ height: 4 + i * 3 }} />
      ))}
    </span>
  );
}

export const TaskCard = memo(function TaskCard({
  task,
  onOpen,
  columnName,
}: {
  task: Task;
  onOpen?: () => void;
  /** Shown on cards in a tag column: the column the task actually is in. */
  columnName?: string;
}) {
  const issue = useStore((s) =>
    task.issue ? s.issues.repos[task.issue.repo]?.issues.find((i) => i.number === task.issue!.number) : undefined,
  );
  const highlighted = useStore((s) => s.highlight.includes(task.id));
  // Titles joined into one string, so the card only re-renders when its blockers change.
  const blockers = useStore((s) => {
    const board = Object.values(s.boards).find((e) => e.board.tasks[task.id])?.board;
    if (!board) return "";
    return openBlockers(s.boards, { board: board.id, task: task.id })
      .map((l) => (l.board.id === board.id ? `“${l.task.title}”` : `“${l.task.title}” (${l.board.name})`))
      .join(", ");
  });
  const due = dueStatus(task.dueDate);
  const doneItems = task.checklist.filter((c) => c.done).length;
  const own = new Set(task.labels.map((l) => l.toLowerCase()));
  const ghLabels = (issue?.labels ?? []).filter((l) => !own.has(l.name.toLowerCase())).slice(0, 3);

  return (
    <div className={cx("task-card", `prio-${task.priority}`, highlighted && "highlight")} onClick={onOpen}>
      {(task.labels.length > 0 || ghLabels.length > 0) && (
        <div className="task-labels">
          {task.labels.map((l) => (
            <TagChip key={l} tag={l} />
          ))}
          {ghLabels.map((l) => (
            <GhLabelChip key={"gh-" + l.name} label={l} repo={issue?.repo} />
          ))}
        </div>
      )}
      <div className="task-title">
        {task.priority !== "none" && <PriorityIcon priority={task.priority} />}
        <span>{task.title}</span>
      </div>
      {(task.issue || task.dueDate || task.checklist.length > 0 || task.description || columnName || blockers) && (
        <div className="task-meta">
          {blockers && (
            <span className="task-blocked" title={`Blocked by ${blockers}`}>
              <Ban size={12} />
              Blocked
            </span>
          )}
          {columnName && (
            <span className="task-home" title={`In “${columnName}”`}>
              <Columns3 size={12} />
              {columnName}
            </span>
          )}
          {task.issue && (
            <span
              className={cx("task-issue", issue?.state)}
              title={issue ? issue.title : "Not in the local cache — sync issues"}
            >
              {issue ? <IssueStateIcon issue={issue} size={13} /> : <span className="issue-dot" />}
              {task.issue.repo.split("/")[1]}#{task.issue.number}
            </span>
          )}
          {task.dueDate && (
            <span className={cx("task-due", due)}>
              <Calendar size={12} />
              {formatDate(task.dueDate)}
            </span>
          )}
          {task.checklist.length > 0 && (
            <span className={cx("task-check", doneItems === task.checklist.length && "complete")}>
              <CheckSquare size={12} />
              {doneItems}/{task.checklist.length}
            </span>
          )}
          {task.description && (
            <span className="task-has-desc" title="Has description">
              <AlignLeft size={12} />
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export function SortableTask({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task" },
  });
  return (
    <div
      ref={setNodeRef}
      className={cx("sortable-task", isDragging && "placeholder")}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
        else listeners?.onKeyDown?.(e);
      }}
    >
      <TaskCard task={task} onOpen={onOpen} />
    </div>
  );
}

/** Drag id of a task card shown by a tag column; the task's own card uses the task id. */
export const taggedDragId = (columnId: string, taskId: string) => `tagged:${columnId}:${taskId}`;

/**
 * A task as shown by a tag column. Dragging it to an ordinary column moves the task there; to
 * another tag column, tags it for that column.
 */
export function DraggableTagged({
  task,
  columnId,
  columnName,
  onOpen,
}: {
  task: Task;
  columnId: string;
  columnName?: string;
  onOpen: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: taggedDragId(columnId, task.id),
    data: { type: "tagged", taskId: task.id, fromColumn: columnId },
  });
  return (
    <div
      ref={setNodeRef}
      className={cx("sortable-task", isDragging && "placeholder")}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
        else listeners?.onKeyDown?.(e);
      }}
    >
      <TaskCard task={task} onOpen={onOpen} columnName={columnName} />
    </div>
  );
}
