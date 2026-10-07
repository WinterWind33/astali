import { ArchiveRestore, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { doneColumn } from "../../lib/labelColumns";
import { autoArchives, purgeArchived, restoreArchived, restoreTarget, toast, useStore } from "../../lib/store";
import type { ArchivedTask } from "../../lib/types";
import { relativeTime } from "../../lib/util";
import { Modal, ModalHeader, TagChip, confirm } from "../ui";

/** A board's archived tasks, newest first: find one, put it back, or delete it for good (D-8). */
export function ArchiveDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const board = useStore((s) => s.boards[boardId]?.board);
  const [query, setQuery] = useState("");
  const archive = board?.archive ?? [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return archive;
    return archive.filter(({ task: t }) =>
      `${t.title} ${t.description} ${t.labels.join(" ")}`.toLowerCase().includes(q),
    );
  }, [archive, query]);
  if (!board) return null;
  const columnName = (id: string) => board.columns.find((c) => c.id === id)?.name;
  // Tasks that would go back to an auto-archiving done column stay archived until it's turned off.
  const locked = (entry: ArchivedTask) => {
    const to = restoreTarget(board, entry);
    return !!to && autoArchives(board, to.id);
  };
  const anyLocked = archive.some(locked);

  const purge = async (taskId: string, title: string) => {
    const ok = await confirm({
      title: "Delete this task for good?",
      message: `“${title}” will be removed from the archive. You can still undo this from Activity.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) purgeArchived(boardId, taskId);
  };

  return (
    <Modal onClose={onClose} width={620} className="archive-dialog">
      <ModalHeader
        title="Archive"
        subtitle={`${archive.length} finished task${archive.length === 1 ? "" : "s"} put away from “${board.name}”. They still count as done.`}
        onClose={onClose}
      />
      <div className="archive-body">
        {anyLocked && (
          <p className="faint small">
            Auto archive is on for “{doneColumn(board)?.name}”, so tasks archived from it can't be restored there. Turn
            it off from that column's menu first.
          </p>
        )}
        <label className="search">
          <Search size={15} />
          <input autoFocus placeholder="Search the archive" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="archive-list">
          {shown.map((entry) => {
            const { task, from, at } = entry;
            return (
              <div key={task.id} className="archive-row">
                <div className="archive-main">
                  <div className="archive-title">{task.title || "Untitled"}</div>
                  <div className="faint small">
                    From {columnName(from) ? `“${columnName(from)}”` : "a deleted column"} · archived {relativeTime(at)}
                  </div>
                  {task.labels.length > 0 && (
                    <div className="task-labels">
                      {task.labels.map((l) => (
                        <TagChip key={l} tag={l} />
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="btn small"
                  disabled={locked(entry)}
                  title={
                    locked(entry) ? `Turn off auto archive on “${doneColumn(board)?.name}” to restore it` : undefined
                  }
                  onClick={() => {
                    const to = restoreArchived(boardId, task.id);
                    if (to) toast(`Restored “${task.title}” to “${to}”`, "success");
                    else toast("The board has no column to restore it to", "error");
                  }}
                >
                  <ArchiveRestore size={14} /> Restore
                </button>
                <button className="icon-btn" title="Delete for good" onClick={() => purge(task.id, task.title)}>
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
          {shown.length === 0 && (
            <p className="faint small archive-empty">
              {archive.length
                ? "No archived task matches."
                : "Nothing archived yet. Archive a task from its dialog, or a whole column from its menu."}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
