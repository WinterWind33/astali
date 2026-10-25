import { Archive, Calendar, Columns3, Flag, Tag, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isViewColumn } from "../../lib/labelColumns";
import { archiveTasks, clearSelection, deleteTasks, moveTasks, toast, updateTasks, useStore } from "../../lib/store";
import type { Priority } from "../../lib/types";
import { cx } from "../../lib/util";
import { TagChip, confirm } from "../ui";
import { PRIORITY_META, PriorityIcon } from "./TaskCard";

/**
 * Changes the selected tasks of a board together: what they share is shown as set, what only some
 * have is shown with a count. Each change applies at once, in one write.
 */
export function SelectionPanel({ boardId }: { boardId: string }) {
  const board = useStore((s) => s.boards[boardId]?.board);
  const selection = useStore((s) => s.selection);
  const [tag, setTag] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal")) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!board) return null;
  const tasks = selection.map((id) => board.tasks[id]).filter(Boolean);
  if (!tasks.length) return null;
  const ids = tasks.map((t) => t.id);
  const n = tasks.length;

  const tagCounts = new Map<string, number>();
  for (const t of tasks) for (const l of t.labels) tagCounts.set(l, (tagCounts.get(l) ?? 0) + 1);
  const priorities = new Set(tasks.map((t) => t.priority));
  const dues = new Set(tasks.map((t) => t.dueDate ?? ""));
  const columnOf = (id: string) => board.columns.find((c) => c.taskIds.includes(id))?.id;
  const columns = new Set(ids.map(columnOf));

  const addTag = () => {
    const t = tag.trim();
    if (!t) return;
    updateTasks(boardId, ids, (task) =>
      task.labels.some((l) => l.toLowerCase() === t.toLowerCase()) ? task : { ...task, labels: [...task.labels, t] },
    );
    setTag("");
  };

  return (
    <aside className="selection-panel" onClick={(e) => e.stopPropagation()}>
      <div className="selection-head">
        <strong>
          {n} task{n === 1 ? "" : "s"} selected
        </strong>
        <button className="icon-btn small" title="Clear the selection (Esc)" onClick={clearSelection}>
          <X size={15} />
        </button>
      </div>
      <p className="faint small">Ctrl/⌘-click adds or removes a card; Shift-click selects a run in a column.</p>

      <div className="prop">
        <div className="prop-label">
          <Tag size={14} /> Tags
        </div>
        <div className="selection-tags">
          {[...tagCounts].map(([l, c]) => (
            <span key={l} className="selection-tag" title={c < n ? `On ${c} of ${n}` : "On every selected task"}>
              <TagChip tag={l} />
              {c < n && <span className="faint small">{c}</span>}
              <button
                className="icon-btn tiny"
                title={`Remove “${l}” from the selected tasks`}
                onClick={() => updateTasks(boardId, ids, (t) => ({ ...t, labels: t.labels.filter((x) => x !== l) }))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <input
          placeholder="Add a tag to all…"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTag()}
          onBlur={addTag}
        />
      </div>

      <div className="prop">
        <div className="prop-label">
          <Flag size={14} /> Priority
        </div>
        <div className="priority-picker">
          {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
            <button
              key={p}
              className={cx("priority-option", priorities.size === 1 && priorities.has(p) && "active")}
              onClick={() => updateTasks(boardId, ids, (t) => ({ ...t, priority: p }))}
              title={PRIORITY_META[p].label}
            >
              {p === "none" ? <span className="faint">—</span> : <PriorityIcon priority={p} />}
            </button>
          ))}
        </div>
        {priorities.size > 1 && <div className="faint small">Mixed</div>}
      </div>

      <div className="prop">
        <div className="prop-label">
          <Calendar size={14} /> Due date
        </div>
        <div className="selection-row">
          <input
            type="date"
            value={dues.size === 1 ? [...dues][0] : ""}
            onChange={(e) => updateTasks(boardId, ids, (t) => ({ ...t, dueDate: e.target.value || null }))}
          />
          <button
            className="btn ghost small"
            onClick={() => updateTasks(boardId, ids, (t) => ({ ...t, dueDate: null }))}
            title="Clear the due date of every selected task"
          >
            Clear
          </button>
        </div>
        {dues.size > 1 && <div className="faint small">Mixed</div>}
      </div>

      <div className="prop">
        <div className="prop-label">
          <Columns3 size={14} /> Column
        </div>
        <select
          value={columns.size === 1 ? ([...columns][0] ?? "") : ""}
          onChange={(e) => e.target.value && moveTasks(boardId, ids, e.target.value)}
        >
          {columns.size > 1 && <option value="">Mixed — move all to…</option>}
          {board.columns
            .filter((c) => !isViewColumn(c))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>

      <div className="selection-actions">
        <button
          className="btn ghost full"
          onClick={() => {
            const done = archiveTasks(boardId, ids);
            clearSelection();
            toast(`Archived ${done} task${done === 1 ? "" : "s"}`, "success");
          }}
        >
          <Archive size={14} /> Archive
        </button>
        <button
          className="btn ghost full danger"
          onClick={async () => {
            const ok = await confirm({
              title: `Delete ${n} task${n === 1 ? "" : "s"}?`,
              message: "You can undo this from Activity.",
              confirmLabel: "Delete",
              danger: true,
            });
            if (ok) deleteTasks(boardId, ids);
          }}
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </aside>
  );
}
