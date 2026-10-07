import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Archive,
  Calendar,
  CheckSquare,
  Columns3,
  ExternalLink,
  Flag,
  FolderInput,
  Kanban,
  Link2,
  Link2Off,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  archiveTasks,
  currentProject,
  deleteTask,
  moveTask,
  moveTaskToBoard,
  orderedBoards,
  setTagColor,
  setView,
  toast,
  updateTask,
  useStore,
} from "../../lib/store";
import { isViewColumn } from "../../lib/labelColumns";
import { defaultTagColor, tagKey } from "../../lib/tags";
import type { GhIssue, Priority, Task } from "../../lib/types";
import { cx, MOD_KEY, relativeTime, uid } from "../../lib/util";
import { ColorPicker } from "../ColorPicker";
import { TagInput } from "../TagInput";
import { IssuePanel, IssueStateIcon, Markdown, Modal, Popover, TagChip, confirm, Github } from "../ui";
import { PRIORITY_META, PriorityIcon } from "./TaskCard";
import { TaskLinks } from "./TaskLinks";

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}

/** What the dialog edits: the task's own fields, and the column it sits in. */
type Draft = Pick<Task, "title" | "description" | "priority" | "labels" | "dueDate" | "issue" | "checklist"> & {
  column: string;
};

/**
 * Edits a task: changes stay in the dialog until Save (Ctrl+Enter), and closing with unsaved changes
 * asks first. Links, moving to another board and deleting act right away.
 */
export function TaskDialog({
  boardId,
  taskId,
  onClose,
  onOpenTask,
}: {
  boardId: string;
  taskId: string;
  onClose: () => void;
  /** Opens a linked task in place of this one. */
  onOpenTask?: (taskId: string) => void;
}) {
  const board = useStore((s) => s.boards[boardId]?.board);
  const task = board?.tasks[taskId];
  const issues = useStore((s) => s.issues);
  const [descMode, setDescMode] = useState<"preview" | "edit">(task?.description ? "preview" : "edit");
  const [checkInput, setCheckInput] = useState("");
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const [tagMenu, setTagMenu] = useState<{ tag: string; anchor: DOMRect } | null>(null);
  const [moveAnchor, setMoveAnchor] = useState<DOMRect | null>(null);
  // Only the fields edited here; the others show the task as it is on disk (e.g. edited by Claude meanwhile).
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const asking = useRef(false);

  const savedColumn = board?.columns.find((c) => c.taskIds.includes(taskId));
  const draft: Draft | undefined = task && { ...task, column: savedColumn?.id ?? "", ...edits };
  const issue = draft?.issue;
  const linked = useMemo(
    () => (issue ? issues.repos[issue.repo]?.issues.find((i) => i.number === issue.number) : undefined),
    [issue, issues],
  );

  if (!board || !task || !draft) return null;
  const column = board.columns.find((c) => c.id === draft.column);
  const changed = (Object.keys(edits) as (keyof Draft)[]).filter(
    (k) => JSON.stringify(edits[k]) !== JSON.stringify(k === "column" ? savedColumn?.id : task[k]),
  );
  const dirty = changed.length > 0 || checkInput.trim() !== "";
  const canSave = dirty && draft.title.trim() !== "";
  const update = (patch: Partial<Draft>) => setEdits((e) => ({ ...e, ...patch }));

  /** Writes the edited fields, and the checklist item still being typed. */
  const save = () => {
    if (!canSave) return false;
    const pending = checkInput.trim();
    const patch: Partial<Task> = {};
    for (const k of changed) if (k !== "column") Object.assign(patch, { [k]: draft[k] });
    if (pending) patch.checklist = [...draft.checklist, { id: uid(), text: pending, done: false }];
    if (patch.title !== undefined) patch.title = patch.title.trim();
    if (Object.keys(patch).length) updateTask(boardId, taskId, patch);
    const target = changed.includes("column") ? board.columns.find((c) => c.id === draft.column) : undefined;
    if (target) moveTask(boardId, taskId, target.id, target.taskIds.length);
    setEdits({});
    setCheckInput("");
    return true;
  };

  /** Whether unsaved changes may be dropped: true when there are none, else the user's answer. */
  const mayLeave = async () => {
    if (!dirty) return true;
    if (asking.current) return false;
    asking.current = true;
    const ok = await confirm({
      title: "Discard your changes?",
      message: "Your edits to this task will be lost.",
      confirmLabel: "Discard",
      danger: true,
    });
    asking.current = false;
    return ok;
  };
  const close = async () => {
    if (await mayLeave()) onClose();
  };

  const addCheck = () => {
    const t = checkInput.trim();
    if (t) update({ checklist: [...draft.checklist, { id: uid(), text: t, done: false }] });
    setCheckInput("");
  };

  const linkIssue = (i: GhIssue) => {
    update({
      issue: { repo: i.repo, number: i.number },
      ...(draft.title === "Untitled" || !draft.title ? { title: i.title } : {}),
    });
    setPickerAnchor(null);
  };

  const doneCount = draft.checklist.filter((c) => c.done).length;

  return (
    <Modal onClose={close} width={900} className="task-dialog">
      <div
        className="task-dialog-body"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (save()) onClose();
          }
        }}
      >
        <div className="task-dialog-grid">
          <div className="task-dialog-main">
            <div className="task-dialog-topline">
              <span className="column-pill" style={{ "--c": "var(--accent)" } as React.CSSProperties}>
                {board.name} · {column?.name}
              </span>
              <button className="icon-btn" onClick={close} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <AutoTextarea
              className="task-dialog-title"
              value={draft.title}
              placeholder="Task title"
              onChange={(e) => update({ title: e.target.value.replace(/\n/g, " ") })}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            />

            <div className="section-head">
              <span>Description</span>
              <div className="segmented tiny">
                <button className={cx(descMode === "edit" && "active")} onClick={() => setDescMode("edit")}>
                  Write
                </button>
                <button className={cx(descMode === "preview" && "active")} onClick={() => setDescMode("preview")}>
                  Preview
                </button>
              </div>
            </div>
            {descMode === "edit" ? (
              <AutoTextarea
                className="task-dialog-desc"
                value={draft.description}
                placeholder="Add more detail… Markdown supported."
                onChange={(e) => update({ description: e.target.value })}
                autoFocus={!draft.description && draft.title !== ""}
              />
            ) : draft.description ? (
              <div className="desc-preview" onDoubleClick={() => setDescMode("edit")}>
                <Markdown>{draft.description}</Markdown>
              </div>
            ) : (
              <button className="desc-empty" onClick={() => setDescMode("edit")}>
                Add a description…
              </button>
            )}

            <div className="section-head">
              <span>
                <CheckSquare size={14} /> Checklist
                {draft.checklist.length > 0 && (
                  <span className="faint">
                    {" "}
                    {doneCount}/{draft.checklist.length}
                  </span>
                )}
              </span>
            </div>
            {draft.checklist.length > 0 && (
              <div className="progress-bar wide">
                <span style={{ width: `${(doneCount / draft.checklist.length) * 100}%` }} />
              </div>
            )}
            <div className="checklist">
              {draft.checklist.map((item) => (
                <div key={item.id} className={cx("check-item", item.done && "done")}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      update({
                        checklist: draft.checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)),
                      })
                    }
                  />
                  <input
                    className="check-text"
                    value={item.text}
                    onChange={(e) =>
                      update({
                        checklist: draft.checklist.map((c) => (c.id === item.id ? { ...c, text: e.target.value } : c)),
                      })
                    }
                  />
                  <button
                    className="icon-btn tiny"
                    onClick={() => update({ checklist: draft.checklist.filter((c) => c.id !== item.id) })}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <div className="check-item new">
                <Plus size={15} className="faint" />
                <input
                  className="check-text"
                  placeholder="Add an item"
                  value={checkInput}
                  onChange={(e) => setCheckInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && addCheck()}
                  onBlur={addCheck}
                />
              </div>
            </div>

            <TaskLinks boardId={boardId} taskId={taskId} onOpenTask={onOpenTask} mayLeave={mayLeave} />

            {draft.issue && (
              <>
                <div className="section-head">
                  <span>
                    <Github size={14} /> Linked issue
                  </span>
                </div>
                {linked ? (
                  <IssuePanel issue={linked} />
                ) : (
                  <div className="issue-panel missing">
                    <span>
                      {draft.issue.repo}#{draft.issue.number} is not in the local cache. Sync issues to see its details.
                    </span>
                    <button
                      className="btn small"
                      onClick={() => openUrl(`https://github.com/${draft.issue!.repo}/issues/${draft.issue!.number}`)}
                    >
                      <ExternalLink size={13} /> Open on GitHub
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <aside className="task-dialog-side">
            <div className="prop">
              <div className="prop-label">
                <Columns3 size={14} /> Column
              </div>
              <select value={draft.column} onChange={(e) => update({ column: e.target.value })}>
                {board.columns
                  .filter((c) => !isViewColumn(c))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="prop">
              <div className="prop-label">
                <Flag size={14} /> Priority
              </div>
              <div className="priority-picker">
                {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
                  <button
                    key={p}
                    className={cx("priority-option", draft.priority === p && "active")}
                    onClick={() => update({ priority: p })}
                    title={PRIORITY_META[p].label}
                  >
                    {p === "none" ? <span className="faint">—</span> : <PriorityIcon priority={p} />}
                  </button>
                ))}
              </div>
              <div className="faint small">{PRIORITY_META[draft.priority].label}</div>
            </div>

            <div className="prop">
              <div className="prop-label">
                <Calendar size={14} /> Due date
              </div>
              <div className="input-row">
                <input
                  type="date"
                  value={draft.dueDate ?? ""}
                  onChange={(e) => update({ dueDate: e.target.value || null })}
                />
                {draft.dueDate && (
                  <button className="icon-btn small" onClick={() => update({ dueDate: null })} title="Clear">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="prop">
              <div className="prop-label">
                <Tag size={14} /> Tags
              </div>
              <TagInput
                tags={draft.labels}
                chipTitle="Click to change its color or see every task with it"
                onChipClick={(l, e) => setTagMenu({ tag: l, anchor: e.currentTarget.getBoundingClientRect() })}
                onAdd={(l) => update({ labels: [...draft.labels, l] })}
                onRemove={(l) => update({ labels: draft.labels.filter((x) => x !== l) })}
              />
            </div>

            <div className="prop">
              <div className="prop-label">
                <Github size={14} /> GitHub issue
              </div>
              {draft.issue ? (
                <div className="linked-issue-chip">
                  {linked ? <IssueStateIcon issue={linked} size={14} /> : <Github size={14} />}
                  <span title={`${draft.issue.repo}#${draft.issue.number}`}>
                    {draft.issue.repo.split("/")[1]}#{draft.issue.number}
                  </span>
                  <button className="icon-btn tiny" title="Unlink" onClick={() => update({ issue: null })}>
                    <Link2Off size={13} />
                  </button>
                </div>
              ) : (
                <button
                  className="btn small full"
                  onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}
                >
                  <Link2 size={14} /> Link issue
                </button>
              )}
            </div>

            <div className="side-spacer" />
            <button
              className="btn ghost full"
              onClick={(e) => setMoveAnchor(e.currentTarget.getBoundingClientRect())}
              disabled={dirty && !canSave}
              title={dirty ? "Saves your changes, then moves the task" : undefined}
            >
              <FolderInput size={14} /> Move to board…
            </button>
            <button
              className="btn ghost full"
              onClick={() => {
                save();
                archiveTasks(boardId, [taskId]);
                onClose();
                toast(`Archived “${draft.title.trim()}”. Find it in the board's archive.`, "success");
              }}
              disabled={dirty && !canSave}
              title="Put it away from the board: it stays searchable, counts as done, and can be restored"
            >
              <Archive size={14} /> Archive
            </button>
            <div className="meta-lines faint small">
              <div>Created {relativeTime(task.createdAt)}</div>
              <div>Updated {relativeTime(task.updatedAt)}</div>
            </div>
            <button
              className="btn danger-ghost full"
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete this task?",
                  message: `“${task.title}” will be deleted. You can undo this from Activity.`,
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (ok) {
                  onClose();
                  deleteTask(boardId, taskId);
                }
              }}
            >
              <Trash2 size={14} /> Delete task
            </button>
            <div className="task-dialog-actions">
              <span className="faint small">{dirty ? `Unsaved changes · ${MOD_KEY}+Enter saves` : "No changes"}</span>
              <div className="task-dialog-buttons">
                <button className="btn ghost" onClick={close}>
                  Cancel
                </button>
                <button className="btn primary" onClick={() => save() && onClose()} disabled={!canSave}>
                  Save
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {tagMenu && <TagMenu tag={tagMenu.tag} anchor={tagMenu.anchor} onClose={() => setTagMenu(null)} />}
      {moveAnchor && (
        <Popover anchor={moveAnchor} align="right" onClose={() => setMoveAnchor(null)}>
          <BoardColumnPicker
            fromBoardId={boardId}
            onPick={(toBoard, toColumn) => {
              setMoveAnchor(null);
              save();
              const target = useStore.getState().boards[toBoard]?.board;
              if (!moveTaskToBoard(boardId, taskId, toBoard, toColumn))
                return toast("Could not move the task there", "error");
              onClose();
              toast(
                `Moved “${draft.title.trim()}” to ${target?.name} · ${target?.columns.find((c) => c.id === toColumn)?.name}`,
                "success",
              );
            }}
          />
        </Popover>
      )}
      {pickerAnchor && (
        <Popover anchor={pickerAnchor} align="right" onClose={() => setPickerAnchor(null)}>
          <IssuePicker onPick={linkIssue} />
        </Popover>
      )}
    </Modal>
  );
}

/** The columns that can take a task on the project's other kanban boards, by board. */
function BoardColumnPicker({
  fromBoardId,
  onPick,
}: {
  fromBoardId: string;
  onPick: (boardId: string, columnId: string) => void;
}) {
  const boards = useStore(useShallow((s) => orderedBoards(s).filter((b) => b.id !== fromBoardId && !b.kind)));
  return (
    <div className="board-column-picker">
      {boards.length === 0 && <div className="faint small pad">No other kanban board in this project.</div>}
      {boards.map((b) => (
        <div key={b.id} className="promote-group">
          <div className="promote-group-head">{b.name}</div>
          {b.columns
            .filter((c) => !isViewColumn(c))
            .map((c) => (
              <button key={c.id} className="promote-target" onClick={() => onPick(b.id, c.id)}>
                <Kanban size={14} className="faint" />
                <span className="promote-target-label">{c.name}</span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

export function IssuePicker({ onPick }: { onPick: (i: GhIssue) => void }) {
  const issues = useStore((s) => s.issues);
  const [q, setQ] = useState("");
  const all = useMemo(() => Object.values(issues.repos).flatMap((r) => r.issues), [issues]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^#/, "");
    return all
      .filter((i) => !i.isPullRequest)
      .filter((i) => !s || i.title.toLowerCase().includes(s) || String(i.number).startsWith(s))
      .sort((a, b) => (a.state === b.state ? b.updatedAt.localeCompare(a.updatedAt) : a.state === "open" ? -1 : 1))
      .slice(0, 50);
  }, [all, q]);

  return (
    <div className="issue-picker">
      <label className="search">
        <Search size={14} />
        <input
          autoFocus
          placeholder="Search issues by title or #number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div className="issue-picker-list">
        {all.length === 0 && <div className="faint small pad">No cached issues. Sync from the sidebar first.</div>}
        {shown.map((i) => (
          <button key={`${i.repo}#${i.number}`} className="issue-picker-item" onClick={() => onPick(i)}>
            <IssueStateIcon issue={i} size={14} />
            <span className="issue-picker-title">{i.title}</span>
            <span className="faint small">#{i.number}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A tag's color, and a way to every task carrying it. */
function TagMenu({ tag, anchor, onClose }: { tag: string; anchor: DOMRect; onClose: () => void }) {
  const picked = useStore((s) => currentProject(s)?.project.tagColors[tagKey(tag)]);
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="popover-pad tag-menu">
        <div className="tag-menu-head">
          <TagChip tag={tag} onClick={() => {}} title={tag} />
          {picked && (
            <button
              className="btn ghost small"
              onClick={() => setTagColor(tag, null)}
              title="Use the color derived from the tag's name"
            >
              Reset color
            </button>
          )}
        </div>
        <ColorPicker
          value={picked ?? defaultTagColor(tag)}
          onChange={(c, done) => {
            setTagColor(tag, c);
            if (done) onClose();
          }}
        />
        <button className="btn small full" onClick={() => setView({ kind: "tags", tag: { kind: "tag", name: tag } })}>
          <Search size={13} /> Show every task tagged “{tag}”
        </button>
      </div>
    </Popover>
  );
}
