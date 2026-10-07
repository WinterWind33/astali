import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Archive,
  ArchiveX,
  ChevronsLeftRight,
  ChevronsRightLeft,
  CircleCheck,
  Eye,
  EyeOff,
  Gauge,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Tag,
  Tags,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { doneColumn, isViewColumn, labelUrl, liveLabel } from "../../lib/labelColumns";
import {
  addTask,
  archiveTasks,
  deleteColumn,
  setAutoArchive,
  setColumnCollapsed,
  setDoneColumn,
  toast,
  updateColumn,
} from "../../lib/store";
import { describeTagSource, tagSource, tagsToAdd } from "../../lib/tags";
import type { Board, Column, GhIssue, IssueRef, Task } from "../../lib/types";
import { colorHex, cx, issueKey, relativeTime } from "../../lib/util";
import { ColorPicker } from "../ColorPicker";
import { InlineEdit, Menu, type MenuItem, Modal, ModalHeader, Popover } from "../ui";
import { DraggableIssue } from "./IssueCard";
import { DraggableTagged, SortableTask } from "./TaskCard";
import { TagColumnPicker } from "./TagColumnPicker";

/** What a live label column shows, computed by the board from the issue cache. */
export interface LabelColumnIssues {
  /** Issues matching the board filter. */
  visible: GhIssue[];
  total: number;
  /** False when the label's repository isn't one of the project's any more. */
  repoInProject: boolean;
  /** Column name by issue key ("owner/repo#n"), for issues that are also tasks on the board. */
  onBoard: Map<string, string>;
  onOpen: (ref: IssueRef) => void;
}

/** What a tag column shows, computed by the board from its tasks. */
export interface TagColumnTasks {
  /** Tasks matching the board filter. */
  visible: string[];
  total: number;
  /** Name of the column each task actually is in. */
  homeOf: Map<string, string>;
  /** Where a task added from the column goes; null when the board has no ordinary column. */
  home: { id: string; name: string } | null;
}

export function ColumnView({
  board,
  column,
  visibleTaskIds,
  filtering,
  onOpenTask,
  otherColumns,
  labelIssues,
  tagged,
}: {
  board: Board;
  column: Column;
  visibleTaskIds: string[];
  filtering: boolean;
  onOpenTask: (id: string) => void;
  otherColumns: Column[];
  /** Set for a live label column, whose cards are these issues instead of tasks. */
  labelIssues?: LabelColumnIssues;
  /** Set for a tag column, whose cards are these tasks of other columns. */
  tagged?: TagColumnTasks;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: "column" },
  });
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null);
  const [wipOpen, setWipOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tagsAnchor, setTagsAnchor] = useState<DOMRect | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const label = liveLabel(column);
  const live = label && labelIssues;
  const frozen = column.source?.kind === "label" && column.source.deletedAt ? column.source : null;
  const tags = tagSource(column);
  const tagView = tags && tagged;
  const count = live ? live.total : tagView ? tagView.total : column.taskIds.length;
  const visibleCount = live ? live.visible.length : tagView ? tagView.visible.length : visibleTaskIds.length;
  const isDone = doneColumn(board)?.id === column.id;
  // Finished work is dragged into the done column, not created there: it would count as done without being worked on.
  const canAdd = !label && !isDone && (!tags || !!tagged?.home);
  const overWip = column.wipLimit != null && count > column.wipLimit;

  // A live column's name and color are the label's, so they can't be edited here.
  const menuItems: (MenuItem | "divider")[] = label
    ? [
        {
          label: label.showClosed ? "Hide closed issues" : "Show closed issues",
          icon: label.showClosed ? <EyeOff size={14} /> : <Eye size={14} />,
          onClick: () => updateColumn(board.id, column.id, { source: { ...label, showClosed: !label.showClosed } }),
        },
        { label: "Open label on GitHub", icon: <Tag size={14} />, onClick: () => openUrl(labelUrl(label)) },
        { label: "WIP limit", icon: <Gauge size={14} />, onClick: () => setWipOpen(true) },
      ]
    : [
        ...(tags
          ? [
              {
                label: "Edit tags",
                icon: <Tags size={14} />,
                onClick: () => setTagsAnchor(headRef.current?.getBoundingClientRect() ?? null),
              },
            ]
          : []),
        { label: "Rename", icon: <Pencil size={14} />, onClick: () => setRenaming(true) },
        {
          label: "Color",
          icon: <Palette size={14} />,
          onClick: () => setColorAnchor(headRef.current?.getBoundingClientRect() ?? null),
        },
        { label: "WIP limit", icon: <Gauge size={14} />, onClick: () => setWipOpen(true) },
        ...(tags || isDone
          ? []
          : [
              {
                label: "Mark as done column",
                icon: <CircleCheck size={14} />,
                title: "Count this column's tasks as finished, wherever it sits on the board",
                onClick: () => setDoneColumn(board.id, column.id),
              },
            ]),
        ...(isDone
          ? [
              {
                label: board.autoArchive ? "Stop auto archiving" : "Auto archive",
                icon: board.autoArchive ? <ArchiveX size={14} /> : <Archive size={14} />,
                title: board.autoArchive
                  ? "Tasks moved here stay in this column again, and archived tasks can be restored"
                  : "Archive this column's tasks, and every task moved into it from now on",
                onClick: () => {
                  const on = !board.autoArchive;
                  const n = setAutoArchive(board.id, on);
                  if (on)
                    toast(
                      `Auto archive is on${n ? `: archived ${n} task${n === 1 ? "" : "s"} from “${column.name}”` : ""}`,
                      "success",
                    );
                },
              },
            ]
          : []),
        ...(tags || column.taskIds.length === 0
          ? []
          : [
              {
                label: "Archive all tasks",
                icon: <Archive size={14} />,
                title: "Put this column's tasks away: they stay searchable, count as done, and can be restored",
                onClick: () => {
                  const n = archiveTasks(board.id, column.taskIds);
                  toast(`Archived ${n} task${n === 1 ? "" : "s"} from “${column.name}”`, "success");
                },
              },
            ]),
      ];
  const collapseItem: MenuItem = {
    label: "Collapse",
    icon: <ChevronsRightLeft size={14} />,
    onClick: () => setColumnCollapsed(board.id, column.id, true),
  };

  const submitTask = (keepOpen: boolean) => {
    const title = adding?.trim();
    if (title && tags) {
      // A task added from a tag column lands in the board's first ordinary column, tagged to show here.
      if (tagged?.home)
        addTask(board.id, tagged.home.id, { title, labels: tagsToAdd({ labels: [] as string[] } as Task, tags) });
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 30);
    } else if (title) {
      addTask(board.id, column.id, { title });
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 30);
    }
    setAdding(keepOpen && title ? "" : null);
  };

  if (column.collapsed) {
    const expand = () => setColumnCollapsed(board.id, column.id, false);
    return (
      <div
        ref={setNodeRef}
        className={cx("column", "collapsed", isDragging && "dragging", label && "label-column", tags && "tag-column")}
        style={
          {
            transform: CSS.Translate.toString(transform),
            transition,
            "--c": colorHex(column.color),
          } as React.CSSProperties
        }
        title={`${column.name}: ${count} card${count === 1 ? "" : "s"}. Double-click to expand.`}
        onDoubleClick={expand}
        {...attributes}
        {...listeners}
      >
        <button
          className="icon-btn tiny"
          title="Expand column"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={expand}
        >
          <ChevronsLeftRight size={15} />
        </button>
        <span className="column-dot" />
        <span className={cx("column-count", overWip && "over")}>
          {filtering && visibleCount !== count ? `${visibleCount}/` : ""}
          {count}
        </span>
        <span className="column-name column-collapsed-name">
          {label ? <Tag size={12} /> : tags ? <Tags size={12} /> : null}
          {column.name}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cx(
        "column",
        isDragging && "dragging",
        label && "label-column",
        tags && "tag-column",
        frozen && "label-deleted",
      )}
      style={
        {
          transform: CSS.Translate.toString(transform),
          transition,
          "--c": colorHex(column.color),
        } as React.CSSProperties
      }
    >
      <div className="column-head" ref={headRef} {...attributes} {...listeners}>
        <span className="column-dot" />
        {label ? (
          <span
            className="column-name column-label-name"
            title={`Live view of the issues labeled “${label.name}” in ${label.repo}${label.showClosed ? " (closed ones included)" : ""}`}
          >
            <Tag size={12} /> {column.name}
          </span>
        ) : tags ? (
          <span className="column-name column-label-name" title={`${describeTagSource(tags)}. Double-click to rename.`}>
            <Tags size={12} />
            <InlineEdit
              value={column.name}
              onSave={(v) => updateColumn(board.id, column.id, { name: v })}
              editing={renaming}
              onEditingChange={setRenaming}
            />
          </span>
        ) : (
          <InlineEdit
            value={column.name}
            onSave={(v) => updateColumn(board.id, column.id, { name: v })}
            editing={renaming}
            onEditingChange={setRenaming}
            className="column-name"
          />
        )}
        {isDone && (
          <span
            className="column-done-mark"
            title="Done column: the progress bar counts its tasks, and tasks blocked by one of them are unblocked"
          >
            <CircleCheck size={13} />
          </span>
        )}
        {isDone && board.autoArchive && (
          <span className="column-done-mark" title="Auto archive: tasks moved into this column are archived right away">
            <Archive size={13} />
          </span>
        )}
        {frozen && (
          <span
            className="column-label-gone"
            title={`Was a live view of the label “${frozen.name}” in ${frozen.repo}, deleted on GitHub ${relativeTime(frozen.deletedAt)}. Its issues were kept as tasks.`}
          >
            <Tag size={12} />
          </span>
        )}
        <span
          className={cx("column-count", overWip && "over")}
          title={column.wipLimit != null ? `WIP limit ${column.wipLimit}` : undefined}
        >
          {filtering && visibleCount !== count ? `${visibleCount}/` : ""}
          {count}
          {column.wipLimit != null && <span className="faint"> / {column.wipLimit}</span>}
        </span>
        <span className="spacer" />
        {canAdd && (
          <button
            className="icon-btn tiny column-add"
            title={tags && tagged?.home ? `Add a tagged task to “${tagged.home.name}”` : "Add task"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setAdding("")}
          >
            <Plus size={15} />
          </button>
        )}
        <span onPointerDown={(e) => e.stopPropagation()}>
          <Menu
            align="right"
            trigger={(t) => (
              <button className="icon-btn tiny" {...t}>
                <MoreHorizontal size={15} />
              </button>
            )}
            items={[
              ...menuItems,
              collapseItem,
              "divider",
              { label: "Delete column", icon: <Trash2 size={14} />, danger: true, onClick: () => setDeleting(true) },
            ]}
          />
        </span>
      </div>

      {live ? (
        <div className="column-body" ref={listRef}>
          {live.visible.map((i) => (
            <DraggableIssue
              key={issueKey(i)}
              issue={i}
              hideLabelId={label.labelId}
              onBoard={live.onBoard.get(issueKey(i))}
              onOpen={() => live.onOpen({ repo: i.repo, number: i.number })}
            />
          ))}
          {count === 0 && (
            <div className="column-empty static">
              {!live.repoInProject
                ? `${label.repo} is no longer one of this project's repositories`
                : `No ${label.showClosed ? "" : "open "}issues labeled “${label.name}”`}
            </div>
          )}
        </div>
      ) : tagView ? (
        <div className="column-body" ref={listRef}>
          {tagView.visible.map((id) => (
            <DraggableTagged
              key={id}
              task={board.tasks[id]}
              columnId={column.id}
              columnName={tagView.homeOf.get(id)}
              onOpen={() => onOpenTask(id)}
            />
          ))}
          {count === 0 && adding === null && (
            <div className="column-empty static">
              No tasks tagged {tags.tags.map((t) => `“${t}”`).join(tags.match === "all" ? " and " : " or ")} yet. Drop a
              task here to tag it.
            </div>
          )}
          {adding !== null && (
            <div className="task-composer">
              <textarea
                autoFocus
                rows={2}
                placeholder={`Task title…  (added to “${tagView.home?.name}”, tagged)`}
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onBlur={() => submitTask(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitTask(true);
                  }
                  if (e.key === "Escape") setAdding(null);
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="column-body" ref={listRef}>
          <SortableContext items={column.taskIds} strategy={verticalListSortingStrategy}>
            {visibleTaskIds.map((id) => (
              <SortableTask key={id} task={board.tasks[id]} onOpen={() => onOpenTask(id)} />
            ))}
          </SortableContext>
          {count === 0 &&
            adding === null &&
            (isDone ? (
              <div className="column-empty static">Drop finished tasks here</div>
            ) : (
              <button className="column-empty" onClick={() => setAdding("")}>
                Drop tasks here or click to add
              </button>
            ))}
          {adding !== null && (
            <div className="task-composer">
              <textarea
                autoFocus
                rows={2}
                placeholder="Task title…  (Enter to add, Esc to close)"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onBlur={() => submitTask(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitTask(true);
                  }
                  if (e.key === "Escape") setAdding(null);
                }}
              />
            </div>
          )}
        </div>
      )}

      {canAdd && adding === null && count > 0 && (
        <button className="column-footer-add" onClick={() => setAdding("")}>
          <Plus size={14} /> Add task
        </button>
      )}

      {colorAnchor && (
        <Popover anchor={colorAnchor} onClose={() => setColorAnchor(null)}>
          <div className="popover-pad">
            <ColorPicker
              value={column.color}
              onChange={(c, picked) => {
                updateColumn(board.id, column.id, { color: c });
                if (picked) setColorAnchor(null);
              }}
            />
          </div>
        </Popover>
      )}

      {tagsAnchor && tags && (
        <TagColumnPicker
          boardId={board.id}
          anchor={tagsAnchor}
          column={{ ...column, source: tags }}
          onClose={() => setTagsAnchor(null)}
        />
      )}

      {wipOpen && <WipDialog column={column} boardId={board.id} onClose={() => setWipOpen(false)} />}
      {deleting && (
        <DeleteColumnDialog
          column={column}
          boardId={board.id}
          others={otherColumns.filter((c) => !isViewColumn(c))}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

function WipDialog({ column, boardId, onClose }: { column: Column; boardId: string; onClose: () => void }) {
  const [value, setValue] = useState(column.wipLimit?.toString() ?? "");
  const save = () => {
    const n = parseInt(value, 10);
    updateColumn(boardId, column.id, { wipLimit: Number.isFinite(n) && n > 0 ? n : null });
    onClose();
  };
  return (
    <Modal onClose={onClose} width={380}>
      <ModalHeader
        title="Work-in-progress limit"
        subtitle={`Highlight “${column.name}” when it holds too many tasks.`}
        onClose={onClose}
      />
      <div className="form">
        <label className="field">
          <span>Maximum tasks (empty for no limit)</span>
          <input
            type="number"
            min={1}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteColumnDialog({
  column,
  boardId,
  others,
  onClose,
}: {
  column: Column;
  boardId: string;
  others: Column[];
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string>(others[0]?.id ?? "");
  const hasTasks = column.taskIds.length > 0;
  return (
    <Modal onClose={onClose} width={420}>
      <ModalHeader title={`Delete “${column.name}”?`} onClose={onClose} />
      <div className="form">
        {hasTasks ? (
          <label className="field">
            <span>This column has {column.taskIds.length} task(s). What should happen to them?</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  Move to “{c.name}”
                </option>
              ))}
              <option value="">Delete them</option>
            </select>
          </label>
        ) : liveLabel(column) ? (
          <p className="muted">Its issues stay as they are on GitHub; only the column is removed.</p>
        ) : column.source?.kind === "tags" ? (
          <p className="muted">Its tasks stay in their columns, with their tags; only the column is removed.</p>
        ) : (
          <p className="muted">The column is empty.</p>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn danger"
            autoFocus
            onClick={() => {
              deleteColumn(boardId, column.id, hasTasks && target ? target : null);
              onClose();
            }}
          >
            Delete column
          </button>
        </div>
      </div>
    </Modal>
  );
}
