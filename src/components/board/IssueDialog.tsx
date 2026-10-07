import { Plus } from "lucide-react";
import { useState } from "react";
import { isViewColumn } from "../../lib/labelColumns";
import { addIssueTasks, toast, useStore } from "../../lib/store";
import type { IssueRef } from "../../lib/types";
import { IssuePanel, Modal, ModalHeader } from "../ui";

/**
 * Details of an issue shown by a label column. The issue itself is read-only here; it can be added
 * to an ordinary column as a linked task, or opened as a task if it already is one on this board.
 */
export function IssueDialog({
  boardId,
  issueRef,
  onClose,
  onOpenTask,
}: {
  boardId: string;
  issueRef: IssueRef;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const board = useStore((s) => s.boards[boardId]?.board);
  const issue = useStore((s) => s.issues.repos[issueRef.repo]?.issues.find((i) => i.number === issueRef.number));
  const targets = board?.columns.filter((c) => !isViewColumn(c)) ?? [];
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  if (!board || !issue) return null;

  const taskId = board.columns
    .flatMap((c) => c.taskIds)
    .find((id) => board.tasks[id]?.issue?.repo === issue.repo && board.tasks[id]?.issue?.number === issue.number);
  const taskColumn = taskId ? board.columns.find((c) => c.taskIds.includes(taskId)) : undefined;

  const add = () => {
    const col = targets.find((c) => c.id === target);
    if (!col || !addIssueTasks(boardId, col.id, [issue])) return;
    toast(`Added #${issue.number} to “${col.name}”`, "success");
    onClose();
  };

  return (
    <Modal onClose={onClose} width={720}>
      <ModalHeader
        title="GitHub issue"
        subtitle="Shown because it carries the column's label. Edit it on GitHub."
        onClose={onClose}
      />
      <div className="form">
        <IssuePanel issue={issue} />
        <div className="modal-actions issue-dialog-actions">
          {taskId ? (
            <>
              <span className="muted small">Already a task on this board, in “{taskColumn?.name}”.</span>
              <button
                className="btn primary"
                onClick={() => {
                  onClose();
                  onOpenTask(taskId);
                }}
              >
                Open task
              </button>
            </>
          ) : targets.length ? (
            <>
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Column">
                {targets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="btn primary" onClick={add}>
                <Plus size={14} /> Add as task
              </button>
            </>
          ) : (
            <span className="muted small">Add an ordinary column to turn issues into tasks.</span>
          )}
        </div>
      </div>
    </Modal>
  );
}
