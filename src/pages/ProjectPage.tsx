import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowUpDown,
  GripVertical,
  CircleDot,
  History,
  Kanban,
  FileUp,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  StickyNote,
  Tags,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ActivityView } from "../components/ActivityView";
import { BoardView } from "../components/board/BoardView";
import { DecisionsView } from "../components/DecisionsView";
import { NotesView } from "../components/NotesView";
import { PlanImportDialog, PlanView } from "../components/PlanView";
import { IssuesView } from "../components/IssuesView";
import { ProjectDialog } from "../components/ProjectDialog";
import { TagsView } from "../components/TagsView";
import { EmptyState, InlineEdit, Menu, confirm } from "../components/ui";
import type { Board } from "../lib/types";
import {
  createBoard,
  currentProject,
  deleteBoard,
  goHome,
  orderedBoards,
  renameBoard,
  reorderBoards,
  setView,
  syncIssues,
  useStore,
} from "../lib/store";
import { isNotes } from "../lib/notes";
import { emptyPlan, isPlan, planProgress } from "../lib/plan";
import { collectTags, decisionList } from "../lib/tags";
import { colorHex, cx, relativeTime } from "../lib/util";

export function ProjectPage() {
  const entry = useStore((s) => currentProject(s));
  const route = useStore((s) => s.route);
  const boards = useStore(useShallow((s) => orderedBoards(s)));
  const issues = useStore((s) => s.issues);
  const syncing = useStore((s) => s.syncing);
  const decisionCount = useStore((s) => Object.keys(s.decisions).length);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newBoard, setNewBoard] = useState<{ name: string; kind: NewKind } | null>(null);
  const [importing, setImporting] = useState(false);
  // A drag ends with a click on the dragged board; it shouldn't open it.
  const dragged = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const openIssueCount = useMemo(
    () =>
      Object.values(issues.repos).reduce(
        (n, r) => n + r.issues.filter((i) => i.state === "open" && !i.isPullRequest).length,
        0,
      ),
    [issues],
  );
  const decisionMap = useStore((s) => s.decisions);
  const tagCount = useMemo(() => collectTags(boards, decisionList(decisionMap)).length, [boards, decisionMap]);
  const lastSync = useMemo(() => {
    const times = Object.values(issues.repos)
      .map((r) => r.fetchedAt)
      .sort();
    return times[times.length - 1];
  }, [issues]);

  if (!entry || route.name !== "project") return null;
  const project = entry.project;
  const view = route.view;

  const submitNewBoard = () => {
    if (newBoard?.name.trim())
      createBoard(
        newBoard.name.trim(),
        newBoard.kind === "plan" ? emptyPlan() : newBoard.kind === "notes" ? "notes" : undefined,
      );
    setNewBoard(null);
  };
  const openBoard = view.kind === "board" ? boards.find((b) => b.id === view.boardId) : undefined;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setTimeout(() => (dragged.current = false));
    if (!over || active.id === over.id) return;
    const ids = boards.map((b) => b.id);
    reorderBoards(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  return (
    <div className="project-page">
      <aside className="sidebar">
        <button className="sidebar-back" onClick={goHome}>
          <ArrowLeft size={15} /> All projects
        </button>

        <div className="sidebar-project" style={{ "--c": colorHex(project.color) } as React.CSSProperties}>
          <div className="project-avatar small">{project.name.slice(0, 1).toUpperCase()}</div>
          <div className="sidebar-project-text">
            <div className="sidebar-project-name">{project.name}</div>
            {project.description && <div className="sidebar-project-desc">{project.description}</div>}
          </div>
          <button className="icon-btn small" onClick={() => setEditing(true)} title="Project settings">
            <Settings2 size={15} />
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">
            <span>Boards</span>
            <span className="sidebar-label-actions">
              {boards.length > 1 && (
                <Menu
                  align="right"
                  trigger={(t) => (
                    <button className="icon-btn small" title="Sort boards" {...t}>
                      <ArrowUpDown size={14} />
                    </button>
                  )}
                  items={BOARD_SORTS.map((x) => ({
                    label: x.label,
                    onClick: () => reorderBoards([...boards].sort(x.compare).map((b) => b.id)),
                  }))}
                />
              )}
              <Menu
                align="right"
                trigger={(t) => (
                  <button className="icon-btn small" title="New board, plan or notes" {...t}>
                    <Plus size={15} />
                  </button>
                )}
                items={[
                  {
                    label: "Kanban board",
                    icon: <Kanban size={14} />,
                    onClick: () => setNewBoard({ name: "", kind: "kanban" }),
                  },
                  {
                    label: "Plan",
                    icon: <ListChecks size={14} />,
                    onClick: () => setNewBoard({ name: "", kind: "plan" }),
                  },
                  {
                    label: "Notes",
                    icon: <StickyNote size={14} />,
                    onClick: () => setNewBoard({ name: "", kind: "notes" }),
                  },
                  { label: "Plan from Markdown…", icon: <FileUp size={14} />, onClick: () => setImporting(true) },
                ]}
              />
            </span>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => (dragged.current = true)}
            onDragEnd={onDragEnd}
            onDragCancel={() => setTimeout(() => (dragged.current = false))}
          >
            <SortableContext items={boards.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              {boards.map((b) => {
                const active = view.kind === "board" && view.boardId === b.id;
                const plan = isPlan(b) && b.plan ? planProgress(b.plan) : null;
                const notes = isNotes(b) ? (b.notes?.length ?? 0) : null;
                const count = plan ? plan.total - plan.resolved : (notes ?? Object.keys(b.tasks).length);
                const what = plan ? "plan" : notes !== null ? "notes board" : "board";
                return (
                  <SortableBoardItem
                    key={b.id}
                    id={b.id}
                    active={active}
                    icon={<BoardIcon kind={plan ? "plan" : notes !== null ? "notes" : "kanban"} />}
                    onOpen={() => !dragged.current && setView({ kind: "board", boardId: b.id })}
                  >
                    <InlineEdit
                      value={b.name}
                      onSave={(v) => renameBoard(b.id, v)}
                      editing={renaming === b.id}
                      onEditingChange={(e) => setRenaming(e ? b.id : null)}
                      className="sidebar-item-name"
                    />
                    <span
                      className="sidebar-count"
                      title={plan ? `${count} item${count === 1 ? "" : "s"} left of ${plan.total}` : undefined}
                    >
                      {count}
                    </span>
                    <Menu
                      align="right"
                      trigger={(t) => (
                        <button className="icon-btn tiny sidebar-item-menu" {...t}>
                          <MoreHorizontal size={14} />
                        </button>
                      )}
                      items={[
                        { label: "Rename", icon: <Pencil size={14} />, onClick: () => setRenaming(b.id) },
                        "divider",
                        {
                          label: `Delete ${what}`,
                          icon: <Trash2 size={14} />,
                          danger: true,
                          onClick: async () => {
                            const ok = await confirm({
                              title: `Delete ${what} “${b.name}”?`,
                              message: plan
                                ? `Its ${b.plan!.steps.length} step(s) and ${plan.total} item(s) will be deleted too. You can undo this from Activity.`
                                : `Its ${count} ${notes !== null ? "note" : "task"}(s) will be deleted too. You can undo this from Activity.`,
                              confirmLabel: `Delete ${what}`,
                              danger: true,
                            });
                            if (ok) deleteBoard(b.id);
                          },
                        },
                      ]}
                    />
                  </SortableBoardItem>
                );
              })}
            </SortableContext>
          </DndContext>
          {newBoard !== null && (
            <div className="sidebar-item editing">
              <BoardIcon kind={newBoard.kind} />
              <input
                autoFocus
                className="inline-edit-input"
                placeholder={
                  newBoard.kind === "plan" ? "Plan name" : newBoard.kind === "notes" ? "Notes board name" : "Board name"
                }
                value={newBoard.name}
                onChange={(e) => setNewBoard({ ...newBoard, name: e.target.value })}
                onBlur={submitNewBoard}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNewBoard();
                  if (e.key === "Escape") setNewBoard(null);
                }}
              />
            </div>
          )}
          {boards.length === 0 && newBoard === null && <div className="sidebar-hint">No boards yet</div>}
        </div>

        <div className="sidebar-section">
          <div
            className={cx("sidebar-item", view.kind === "activity" && "active")}
            onClick={() => setView({ kind: "activity" })}
          >
            <History size={15} />
            <span className="sidebar-item-name">Activity</span>
          </div>
          <div
            className={cx("sidebar-item", view.kind === "tags" && "active")}
            onClick={() => setView({ kind: "tags" })}
          >
            <Tags size={15} />
            <span className="sidebar-item-name">Tags</span>
            {tagCount > 0 && <span className="sidebar-count">{tagCount}</span>}
          </div>
          <div
            className={cx("sidebar-item", view.kind === "decisions" && "active")}
            onClick={() => setView({ kind: "decisions" })}
          >
            <Lightbulb size={15} />
            <span className="sidebar-item-name">Decisions</span>
            {decisionCount > 0 && <span className="sidebar-count">{decisionCount}</span>}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">
            <span>GitHub</span>
            {project.repos.length > 0 && (
              <button className="icon-btn small" onClick={() => syncIssues()} title="Sync issues" disabled={syncing}>
                <RefreshCw size={14} className={cx(syncing && "spin")} />
              </button>
            )}
          </div>
          {project.repos.length === 0 ? (
            <button className="sidebar-hint link" onClick={() => setEditing(true)}>
              + Connect a repository
            </button>
          ) : (
            <>
              <div
                className={cx("sidebar-item", view.kind === "issues" && "active")}
                onClick={() => setView({ kind: "issues" })}
              >
                <CircleDot size={15} />
                <span className="sidebar-item-name">Issues</span>
                <span className="sidebar-count">{openIssueCount}</span>
              </div>
              <div className="sidebar-repos">
                {project.repos.map((r) => {
                  const key = `${r.owner}/${r.repo}`;
                  const err = issues.repos[key]?.error;
                  return (
                    <div key={key} className={cx("sidebar-repo", err && "error")} title={err ?? key}>
                      {key}
                    </div>
                  );
                })}
                {lastSync && <div className="sidebar-hint">Synced {relativeTime(lastSync)}</div>}
              </div>
            </>
          )}
        </div>
      </aside>

      <section className="project-content">
        {view.kind === "board" && openBoard && isNotes(openBoard) ? (
          <NotesView key={view.boardId} boardId={view.boardId} focusNote={view.noteId} />
        ) : view.kind === "board" && openBoard && isPlan(openBoard) ? (
          <PlanView key={view.boardId} boardId={view.boardId} />
        ) : view.kind === "board" ? (
          <BoardView key={view.boardId} boardId={view.boardId} />
        ) : view.kind === "issues" ? (
          <IssuesView />
        ) : view.kind === "activity" ? (
          <ActivityView boardId={view.boardId} />
        ) : view.kind === "tags" ? (
          <TagsView selected={view.tag} />
        ) : view.kind === "decisions" ? (
          <DecisionsView selected={view.decisionId} />
        ) : (
          <EmptyState icon={<LayoutGrid size={28} />} title="No boards in this project">
            <p className="muted">Boards hold columns and tasks. Create one to get started.</p>
            <button className="btn primary" onClick={() => setNewBoard({ name: "", kind: "kanban" })}>
              <Plus size={16} /> New board
            </button>
          </EmptyState>
        )}
      </section>

      {editing && <ProjectDialog project={project} onClose={() => setEditing(false)} />}
      {importing && <PlanImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}

type NewKind = "kanban" | "plan" | "notes";

function BoardIcon({ kind }: { kind: NewKind }) {
  return kind === "plan" ? (
    <ListChecks size={15} />
  ) : kind === "notes" ? (
    <StickyNote size={15} />
  ) : (
    <Kanban size={15} />
  );
}

const BOARD_KIND_RANK = { kanban: 0, plan: 1, notes: 2 };
const kindOf = (b: Board): NewKind => (b.kind === "plan" ? "plan" : b.kind === "notes" ? "notes" : "kanban");
const byName = (a: Board, b: Board) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** One-off sorts: each rewrites the saved order, which dragging then adjusts ("Kind" keeps it within each kind). */
const BOARD_SORTS: { label: string; compare: (a: Board, b: Board) => number }[] = [
  { label: "Name (A–Z)", compare: byName },
  { label: "Name (Z–A)", compare: (a, b) => byName(b, a) },
  { label: "Newest first", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  { label: "Oldest first", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
  { label: "Kind (boards, plans, notes)", compare: (a, b) => BOARD_KIND_RANK[kindOf(a)] - BOARD_KIND_RANK[kindOf(b)] },
];

/**
 * A board in the sidebar, dragged up or down by the grip beside its icon, shown on hover (or focus the grip, then
 * Space and the arrow keys).
 */
function SortableBoardItem({
  id,
  active,
  icon,
  onOpen,
  children,
}: {
  id: string;
  active: boolean;
  icon: React.ReactNode;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      className={cx("sidebar-item", "sortable", active && "active", isDragging && "dragging")}
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
      onClick={onOpen}
    >
      <span className="sidebar-item-lead">
        <button
          ref={setActivatorNodeRef}
          className="sidebar-grip"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </button>
        {icon}
      </span>
      {children}
    </div>
  );
}
