import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Archive, History, Plus, Search, Tag, Tags, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doneColumn, isViewColumn, labelIssues, liveLabel } from "../../lib/labelColumns";
import { tagSource, taggedTaskIds, tagsToAdd } from "../../lib/tags";
import {
  addColumn,
  addIssueTasks,
  addTaskTags,
  autoArchiveDropped,
  currentProject,
  moveColumn,
  moveTask,
  renameBoard,
  setView,
  toast,
  updateBoardDescription,
  useStore,
} from "../../lib/store";
import type { Board, Column, GhIssue, IssueRef, Task } from "../../lib/types";
import { issueKey, repoKey } from "../../lib/util";
import { InlineEdit } from "../ui";
import { ArchiveDialog } from "./ArchiveDialog";
import { ColumnView, type LabelColumnIssues, type TagColumnTasks } from "./ColumnView";
import { IssueCard } from "./IssueCard";
import { IssueDialog } from "./IssueDialog";
import { LabelColumnPicker } from "./LabelColumnPicker";
import { TagColumnPicker } from "./TagColumnPicker";
import { TaskCard } from "./TaskCard";
import { TaskDialog } from "./TaskDialog";

function columnOfTask(board: Board, taskId: string) {
  return board.columns.find((c) => c.taskIds.includes(taskId));
}

/** Tags a task so it shows in the tag column it was dropped on. */
function tagForColumn(boardId: string, board: Board, taskId: string, col: Column) {
  const src = tagSource(col);
  const task = board.tasks[taskId];
  if (!src || !task) return;
  const added = addTaskTags(boardId, taskId, tagsToAdd(task, src));
  if (added.length) toast(`Tagged “${task.title}” ${added.map((t) => `“${t}”`).join(", ")}`, "success");
}

/** True when `el` or an ancestor below `stop` can scroll vertically (e.g. a long column). */
function inVerticalScroller(el: Element | null, stop: Element) {
  for (; el && el !== stop; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

/**
 * Horizontal scrolling for the column strip, which overflows whenever the window is narrower
 * than the board: the mouse wheel scrolls sideways (unless it is over a column that scrolls
 * vertically), and dragging empty board space, or middle-dragging anywhere, pans.
 */
function useHorizontalPan(el: HTMLDivElement | null) {
  useEffect(() => {
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // native handling
      if (el.scrollWidth <= el.clientWidth || inVerticalScroller(e.target as Element, el)) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY;
      el.scrollLeft += px;
    };

    let pan: { id: number; x: number; left: number } | null = null;
    const onDown = (e: PointerEvent) => {
      const empty = e.button === 0 && e.target === el;
      if (!empty && e.button !== 1) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      pan = { id: e.pointerId, x: e.clientX, left: el.scrollLeft };
      el.setPointerCapture(e.pointerId);
      el.classList.add("panning");
    };
    const onMove = (e: PointerEvent) => {
      if (pan?.id === e.pointerId) el.scrollLeft = pan.left - (e.clientX - pan.x);
    };
    const onUp = (e: PointerEvent) => {
      if (pan?.id !== e.pointerId) return;
      pan = null;
      el.classList.remove("panning");
    };

    // Stop WebView2's middle-click autoscroll from fighting the pan.
    const onMouseDown = (e: MouseEvent) => e.button === 1 && e.preventDefault();

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [el]);
}

function matches(task: Task, q: string) {
  if (!q) return true;
  const hay =
    `${task.title} ${task.description} ${task.labels.join(" ")} ${task.issue ? `#${task.issue.number}` : ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

function issueMatches(issue: GhIssue, q: string) {
  if (!q) return true;
  const hay =
    `${issue.title} ${issue.labels.map((l) => l.name).join(" ")} #${issue.number} ${issue.assignees.join(" ")}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

export function BoardView({ boardId }: { boardId: string }) {
  const board = useStore((s) => s.boards[boardId]?.board);
  const issues = useStore((s) => s.issues);
  const repos = useStore((s) => currentProject(s)?.project.repos);
  const [query, setQuery] = useState("");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [openIssue, setOpenIssue] = useState<IssueRef | null>(null);
  // A task opened from a link on another board.
  const pendingTask = useStore((s) => s.pendingTask);
  useEffect(() => {
    if (pendingTask && board?.tasks[pendingTask]) {
      setOpenTask(pendingTask);
      useStore.setState({ pendingTask: null });
    }
  }, [pendingTask, board]);
  const [active, setActive] = useState<
    { type: "task" | "column" | "tagged"; id: string } | { type: "issue"; id: string; issue: GhIssue } | null
  >(null);
  const [addingColumn, setAddingColumn] = useState<string | null>(null);
  const [labelPicker, setLabelPicker] = useState<DOMRect | null>(null);
  const [tagPicker, setTagPicker] = useState<DOMRect | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const stripRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setStrip(node);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // "/" focuses search, like in most productivity tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !t.closest("input, textarea")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const collision: CollisionDetection = useCallback(
    (args) => {
      if (active?.type === "column") {
        return closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === "column"),
        });
      }
      const hits = pointerWithin(args);
      const taskHits = hits.filter(
        (h) => args.droppableContainers.find((c) => c.id === h.id)?.data.current?.type === "task",
      );
      if (taskHits.length) return taskHits;
      if (hits.length) return hits;
      return closestCorners(args);
    },
    [active],
  );

  useHorizontalPan(strip);

  const filtered = useMemo(() => {
    if (!board) return null;
    const q = query.trim();
    return Object.fromEntries(
      board.columns.map((c) => [c.id, c.taskIds.filter((id) => board.tasks[id] && matches(board.tasks[id], q))]),
    );
  }, [board, query]);

  // Cards of the live label columns, straight from the issue cache.
  const labelColumns = useMemo(() => {
    const out: Record<string, LabelColumnIssues> = {};
    if (!board) return out;
    const onBoard = new Map<string, string>();
    for (const c of board.columns)
      for (const id of c.taskIds) {
        const ref = board.tasks[id]?.issue;
        if (ref) onBoard.set(issueKey(ref), c.name);
      }
    const inProject = new Set((repos ?? []).map(repoKey));
    const q = query.trim();
    for (const c of board.columns) {
      const src = liveLabel(c);
      if (!src) continue;
      const all = inProject.has(src.repo) ? labelIssues(src, issues) : [];
      out[c.id] = {
        visible: all.filter((i) => issueMatches(i, q)),
        total: all.length,
        repoInProject: inProject.has(src.repo),
        onBoard,
        onOpen: setOpenIssue,
      };
    }
    return out;
  }, [board, issues, repos, query]);

  // Cards of the tag columns: the board's own tasks carrying the tags, wherever they are.
  const tagColumns = useMemo(() => {
    const out: Record<string, TagColumnTasks> = {};
    if (!board) return out;
    const homeOf = new Map<string, string>();
    for (const c of board.columns) for (const id of c.taskIds) homeOf.set(id, c.name);
    const first = board.columns.find((c) => !isViewColumn(c));
    const home = first ? { id: first.id, name: first.name } : null;
    const q = query.trim();
    for (const c of board.columns) {
      const src = tagSource(c);
      if (!src) continue;
      const all = taggedTaskIds(board, src);
      out[c.id] = { visible: all.filter((id) => matches(board.tasks[id], q)), total: all.length, homeOf, home };
    }
    return out;
  }, [board, query]);

  if (!board || !filtered) return null;

  // Archived tasks are finished work put away: the progress bar still counts them as done.
  const archived = board.archive?.length ?? 0;
  const total = Object.keys(board.tasks).length;
  const doneCol = doneColumn(board);
  const done = (doneCol ? doneCol.taskIds.length : 0) + archived;

  // The column a dragged task started in: it is only auto-archived once dropped in the done column.
  const dragFrom = useRef<string | null>(null);

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current;
    const b = useStore.getState().boards[boardId]?.board;
    dragFrom.current = data?.type === "task" && b ? (columnOfTask(b, String(e.active.id))?.id ?? null) : null;
    setActive(
      data?.type === "issue"
        ? { type: "issue", id: String(e.active.id), issue: data.issue }
        : data?.type === "tagged"
          ? { type: "tagged", id: data.taskId }
          : { type: data?.type, id: String(e.active.id) },
    );
  };

  // A task isn't moved into a live label or tag column: those compute their cards.
  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || a.data.current?.type !== "task") return;
    const b = useStore.getState().boards[boardId]?.board;
    if (!b) return;
    const taskId = String(a.id);
    const from = columnOfTask(b, taskId);
    const overType = over.data.current?.type;
    const to = overType === "column" ? b.columns.find((c) => c.id === over.id) : columnOfTask(b, String(over.id));
    // A collapsed column shows no cards to place the task among; dropping on it appends it (see onDragEnd).
    if (!from || !to || from.id === to.id || isViewColumn(to) || to.collapsed) return;
    let index = to.taskIds.length;
    if (overType === "task") {
      const overIndex = to.taskIds.indexOf(String(over.id));
      const below = a.rect.current.translated && a.rect.current.translated.top > over.rect.top + over.rect.height / 2;
      index = overIndex + (below ? 1 : 0);
    }
    moveTask(boardId, taskId, to.id, index, false);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    drop(e);
    if (from) autoArchiveDropped(boardId, String(e.active.id), from);
  };

  const drop = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    if (!over) return;
    const b = useStore.getState().boards[boardId]?.board;
    if (!b) return;
    if (a.data.current?.type === "column") {
      const from = b.columns.findIndex((c) => c.id === a.id);
      const to = b.columns.findIndex((c) => c.id === over.id);
      if (from !== -1 && to !== -1 && from !== to) moveColumn(boardId, from, to);
      return;
    }
    if (a.data.current?.type === "issue") {
      // Dropping an issue card adds the issue as a task there; it stays in its label column too.
      const issue: GhIssue = a.data.current.issue;
      const overType = over.data.current?.type;
      const to = overType === "column" ? b.columns.find((c) => c.id === over.id) : columnOfTask(b, String(over.id));
      if (!to || isViewColumn(to)) return;
      const index = overType === "task" ? to.taskIds.indexOf(String(over.id)) : to.taskIds.length;
      if (addIssueTasks(boardId, to.id, [issue], index)) toast(`Added #${issue.number} to “${to.name}”`, "success");
      else toast(`#${issue.number} is already on this board`);
      return;
    }
    const overType = over.data.current?.type;
    const target = overType === "column" ? b.columns.find((c) => c.id === over.id) : columnOfTask(b, String(over.id));
    if (a.data.current?.type === "tagged") {
      // A card from a tag column: tag it for another tag column, or move the task to an ordinary one.
      const taskId: string = a.data.current.taskId;
      if (!target || target.id === a.data.current.fromColumn || liveLabel(target)) return;
      if (tagSource(target)) return tagForColumn(boardId, b, taskId, target);
      const index = overType === "task" ? target.taskIds.indexOf(String(over.id)) : target.taskIds.length;
      if (columnOfTask(b, taskId)?.id !== target.id)
        toast(`Moved “${b.tasks[taskId]?.title}” to “${target.name}”`, "success");
      moveTask(boardId, taskId, target.id, index);
      return;
    }
    const taskId = String(a.id);
    if (target && tagSource(target)) return tagForColumn(boardId, b, taskId, target);
    const col = columnOfTask(b, taskId);
    if (target?.collapsed && col && target.id !== col.id && !isViewColumn(target)) {
      toast(`Moved “${b.tasks[taskId]?.title}” to “${target.name}”`, "success");
      moveTask(boardId, taskId, target.id, target.taskIds.length);
      return;
    }
    if (!col || overType !== "task") return;
    const overCol = columnOfTask(b, String(over.id));
    if (overCol?.id !== col.id) return;
    const from = col.taskIds.indexOf(taskId);
    const to = col.taskIds.indexOf(String(over.id));
    if (from !== to) moveTask(boardId, taskId, col.id, to);
  };

  const submitColumn = () => {
    if (addingColumn?.trim()) {
      addColumn(boardId, addingColumn.trim());
      setTimeout(() => scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" }), 50);
    }
    setAddingColumn(null);
  };

  const activeTask = active?.type === "task" || active?.type === "tagged" ? board.tasks[active.id] : null;
  const activeColumn = active?.type === "column" ? board.columns.find((c) => c.id === active.id) : null;

  return (
    <div className="board">
      <div className="board-header">
        <div className="board-title">
          <InlineEdit value={board.name} onSave={(v) => renameBoard(boardId, v)} className="board-name" />
          <InlineEdit
            value={board.description}
            onSave={(v) => updateBoardDescription(boardId, v)}
            placeholder="Add a description…"
            className="board-desc"
          />
        </div>
        <div className="board-tools">
          <div className="board-stats">
            <span>{total} tasks</span>
            {total + archived > 0 && doneCol && (
              <span
                className="progress"
                title={`${done - archived} in “${doneCol.name}”${archived ? `, ${archived} archived` : ""}`}
              >
                <span className="progress-bar">
                  <span style={{ width: `${(done / (total + archived)) * 100}%` }} />
                </span>
                {Math.round((done / (total + archived)) * 100)}%
              </span>
            )}
          </div>
          <label className="search">
            <Search size={15} />
            <input
              ref={searchRef}
              placeholder="Filter tasks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button className="icon-btn tiny" onClick={() => setQuery("")}>
                <X size={13} />
              </button>
            ) : (
              <kbd>/</kbd>
            )}
          </label>
          <button className="icon-btn" title="Archived tasks" onClick={() => setArchiveOpen(true)}>
            <Archive size={16} />
            {archived > 0 && <span className="count-badge">{archived}</span>}
          </button>
          <button
            className="icon-btn"
            title="Activity on this board"
            onClick={() => setView({ kind: "activity", boardId })}
          >
            <History size={16} />
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActive(null);
          dragFrom.current = null;
        }}
      >
        <div className="board-columns" ref={stripRef}>
          <SortableContext items={board.columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            {board.columns.map((col) => (
              <ColumnView
                key={col.id}
                board={board}
                column={col}
                visibleTaskIds={filtered[col.id] ?? []}
                filtering={!!query.trim()}
                onOpenTask={setOpenTask}
                otherColumns={board.columns.filter((c) => c.id !== col.id)}
                labelIssues={labelColumns[col.id]}
                tagged={tagColumns[col.id]}
              />
            ))}
          </SortableContext>

          {addingColumn === null ? (
            <div className="add-column-stack">
              <button className="add-column" onClick={() => setAddingColumn("")}>
                <Plus size={16} /> Add column
              </button>
              <button
                className="add-column secondary"
                title="A column that always shows this board's tasks carrying some tags"
                onClick={(e) => setTagPicker(e.currentTarget.getBoundingClientRect())}
              >
                <Tags size={14} /> Add tag column
              </button>
              {!!repos?.length && (
                <button
                  className="add-column secondary"
                  title="A column that always shows the GitHub issues carrying a label"
                  onClick={(e) => setLabelPicker(e.currentTarget.getBoundingClientRect())}
                >
                  <Tag size={14} /> Add label column
                </button>
              )}
            </div>
          ) : (
            <div className="add-column editing">
              <input
                autoFocus
                placeholder="Column name"
                value={addingColumn}
                onChange={(e) => setAddingColumn(e.target.value)}
                onBlur={submitColumn}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitColumn();
                  if (e.key === "Escape") setAddingColumn(null);
                }}
              />
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
          {activeTask ? (
            <div className="drag-overlay">
              <TaskCard task={activeTask} />
            </div>
          ) : active?.type === "issue" ? (
            <div className="drag-overlay">
              <IssueCard issue={active.issue} />
            </div>
          ) : activeColumn ? (
            <div className="column-overlay">
              <div className="column-overlay-head">{activeColumn.name}</div>
              <div className="faint small">
                {labelColumns[activeColumn.id]
                  ? `${labelColumns[activeColumn.id].total} issues`
                  : `${tagColumns[activeColumn.id]?.total ?? activeColumn.taskIds.length} tasks`}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {openTask && board.tasks[openTask] && (
        <TaskDialog
          key={openTask}
          boardId={boardId}
          taskId={openTask}
          onClose={() => setOpenTask(null)}
          onOpenTask={setOpenTask}
        />
      )}
      {archiveOpen && <ArchiveDialog boardId={boardId} onClose={() => setArchiveOpen(false)} />}
      {openIssue && (
        <IssueDialog
          boardId={boardId}
          issueRef={openIssue}
          onClose={() => setOpenIssue(null)}
          onOpenTask={setOpenTask}
        />
      )}
      {tagPicker && (
        <TagColumnPicker
          boardId={boardId}
          anchor={tagPicker}
          onClose={() => setTagPicker(null)}
          onAdded={() =>
            setTimeout(
              () => scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" }),
              50,
            )
          }
        />
      )}
      {labelPicker && (
        <LabelColumnPicker
          boardId={boardId}
          anchor={labelPicker}
          onClose={() => setLabelPicker(null)}
          onAdded={() =>
            setTimeout(
              () => scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" }),
              50,
            )
          }
        />
      )}
    </div>
  );
}
