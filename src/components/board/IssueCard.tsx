import { useDraggable } from "@dnd-kit/core";
import { Link2, MessageSquare } from "lucide-react";
import { memo } from "react";
import type { GhIssue } from "../../lib/types";
import { cx, issueKey } from "../../lib/util";
import { GhLabelChip, IssueStateIcon } from "../ui";

/** Drag id of an issue card in a label column; tasks use their own ids. */
export const issueDragId = (i: GhIssue) => `issue:${issueKey(i)}`;

/**
 * A GitHub issue shown by a label column. Read-only: its content comes from GitHub, so there is
 * no priority, checklist or due date, only what the issue itself has.
 */
export const IssueCard = memo(function IssueCard({
  issue,
  hideLabelId,
  onBoard,
  onOpen,
}: {
  issue: GhIssue;
  /** The column's own label, which every card would repeat. */
  hideLabelId?: number;
  /** Where the issue is also a task on this board, if it is. */
  onBoard?: string;
  onOpen?: () => void;
}) {
  const labels = issue.labels.filter((l) => l.id == null || l.id !== hideLabelId).slice(0, 3);
  return (
    <div className={cx("task-card", "issue-card", issue.state)} onClick={onOpen}>
      {labels.length > 0 && (
        <div className="task-labels">
          {labels.map((l) => (
            <GhLabelChip key={l.name} label={l} repo={issue.repo} />
          ))}
        </div>
      )}
      <div className="task-title">
        <span>{issue.title}</span>
      </div>
      <div className="task-meta">
        <span className={cx("task-issue", issue.state)}>
          <IssueStateIcon issue={issue} size={13} />
          {issue.repo.split("/")[1]}#{issue.number}
        </span>
        {issue.comments > 0 && (
          <span title={`${issue.comments} comment(s)`}>
            <MessageSquare size={12} />
            {issue.comments}
          </span>
        )}
        {issue.assignees.length > 0 && <span className="issue-card-assignees">@{issue.assignees.join(", @")}</span>}
        {onBoard && (
          <span className="issue-card-linked" title={`Also a task on this board, in “${onBoard}”`}>
            <Link2 size={12} />
          </span>
        )}
      </div>
    </div>
  );
});

/** An issue card that can be dragged to an ordinary column, which adds it there as a linked task. */
export function DraggableIssue({ issue, ...rest }: Parameters<typeof IssueCard>[0] & { onOpen: () => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: issueDragId(issue),
    data: { type: "issue", issue },
  });
  return (
    <div
      ref={setNodeRef}
      className={cx("sortable-task", isDragging && "placeholder")}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        if (e.key === "Enter") rest.onOpen();
        else listeners?.onKeyDown?.(e);
      }}
    >
      <IssueCard issue={issue} {...rest} />
    </div>
  );
}
