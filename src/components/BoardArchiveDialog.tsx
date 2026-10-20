import { ArchiveRestore, Kanban, ListChecks, Search, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isNotes } from "../lib/notes";
import { isPlan, planProgress } from "../lib/plan";
import { archivedBoardList, deleteBoard, restoreBoard, useStore } from "../lib/store";
import type { Board } from "../lib/types";
import { relativeTime } from "../lib/util";
import { Modal, ModalHeader, confirm } from "./ui";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What an archived board holds, in a few words. */
function contents(b: Board) {
  if (isPlan(b) && b.plan) {
    const { resolved, total } = planProgress(b.plan);
    return `${plural(b.plan.steps.length, "step")} · ${resolved}/${total} items done`;
  }
  if (isNotes(b)) return plural(b.notes?.length ?? 0, "note");
  const parts = [plural(Object.keys(b.tasks).length, "task")];
  if (b.archive?.length) parts.push(`${b.archive.length} archived`);
  return parts.join(" · ");
}

/**
 * The project's archived boards, most recently archived first, like a board's task archive. Each one is
 * kept whole, tasks and task archive included, but nothing else in the app reaches it until it is
 * restored here (D-16).
 */
export function BoardArchiveDialog({ onClose }: { onClose: () => void }) {
  const boards = useStore(useShallow((s) => archivedBoardList(s)));
  const [query, setQuery] = useState("");
  // Its button only shows while boards are archived, so restoring or deleting the last one closes it.
  useEffect(() => {
    if (!boards.length) onClose();
  }, [boards.length, onClose]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? boards.filter((b) => `${b.name} ${b.description}`.toLowerCase().includes(q)) : boards;
  }, [boards, query]);

  const remove = async (b: Board) => {
    const ok = await confirm({
      title: `Delete “${b.name}” for good?`,
      message: `It holds ${contents(b)}, which will be deleted too. You can still undo this from Activity.`,
      confirmLabel: "Delete board",
      danger: true,
    });
    if (ok) deleteBoard(b.id);
  };

  return (
    <Modal onClose={onClose} width={620} className="archive-dialog">
      <ModalHeader
        title="Archived boards"
        subtitle={`${plural(boards.length, "board")} put away from the sidebar, with ${boards.length === 1 ? "its" : "their"} tasks and archived tasks.`}
        onClose={onClose}
      />
      <div className="archive-body">
        {boards.length > 5 && (
          <label className="search">
            <Search size={15} />
            <input
              data-local-search
              autoFocus
              placeholder="Search archived boards"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        <div className="archive-list">
          {shown.map((b) => (
            <div key={b.id} className="archive-row">
              <span className="board-archive-icon">
                {isPlan(b) ? <ListChecks size={16} /> : isNotes(b) ? <StickyNote size={16} /> : <Kanban size={16} />}
              </span>
              <div className="archive-main">
                <div className="archive-title">{b.name}</div>
                {b.description && <div className="muted small board-archive-desc">{b.description}</div>}
                <div className="faint small">
                  {contents(b)} · archived {relativeTime(b.archivedAt ?? b.updatedAt)}
                </div>
              </div>
              <button className="btn small" onClick={() => restoreBoard(b.id)}>
                <ArchiveRestore size={14} /> Restore
              </button>
              <button className="icon-btn" title="Delete for good" onClick={() => remove(b)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {shown.length === 0 && <p className="faint small archive-empty">No archived board matches.</p>}
        </div>
      </div>
    </Modal>
  );
}
