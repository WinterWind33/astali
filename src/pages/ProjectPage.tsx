import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
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
  Archive,
  ArrowLeft,
  ArrowUpDown,
  BookA,
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
  LayoutTemplate,
  ChevronRight,
  FolderClosed,
  FolderInput,
  FolderMinus,
  FolderOpen,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ActivityView } from "../components/ActivityView";
import { BoardArchiveDialog } from "../components/BoardArchiveDialog";
import { BoardView } from "../components/board/BoardView";
import { DecisionsView } from "../components/DecisionsView";
import { GlossaryView } from "../components/GlossaryView";
import { NotesView } from "../components/NotesView";
import { PlanImportDialog, PlanView } from "../components/PlanView";
import { IssuesView } from "../components/IssuesView";
import { ProjectDialog } from "../components/ProjectDialog";
import { TagsView } from "../components/TagsView";
import { NewFromTemplateDialog, SaveTemplateDialog } from "../components/TemplateDialog";
import { EmptyState, InlineEdit, Menu, Modal, ModalHeader, confirm } from "../components/ui";
import type { Board, BoardGroup } from "../lib/types";
import {
  archiveBoard,
  createBoardGroup,
  deleteBoardGroup,
  renameBoardGroup,
  setBoardGroup,
  toggleBoardGroup,
  createBoard,
  currentProject,
  deleteBoard,
  glossaryBoard,
  goHome,
  orderedBoards,
  renameBoard,
  reorderBoards,
  setView,
  syncIssues,
  useStore,
} from "../lib/store";
import { isGlossary } from "../lib/glossary";
import { isNotes } from "../lib/notes";
import { emptyPlan, isPlan, planProgress } from "../lib/plan";
import { collectTags, decisionList } from "../lib/tags";
import { colorHex, cx, relativeTime } from "../lib/util";

export function ProjectPage() {
  const entry = useStore((s) => currentProject(s));
  const route = useStore((s) => s.route);
  // The glossary has its own sidebar entry, so it isn't listed with the boards.
  const allBoards = useStore(useShallow((s) => orderedBoards(s)));
  const boards = useMemo(() => allBoards.filter((b) => !isGlossary(b)), [allBoards]);
  const issues = useStore((s) => s.issues);
  const syncing = useStore((s) => s.syncing);
  const decisionCount = useStore((s) => Object.keys(s.decisions).length);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newBoard, setNewBoard] = useState<{ name: string; kind: NewKind } | null>(null);
  const termCount = useStore((s) => glossaryBoard(s)?.terms?.length ?? 0);
  const archivedCount = useStore((s) => Object.keys(s.archivedBoards).length);
  const [importing, setImporting] = useState(false);
  const [fromTemplate, setFromTemplate] = useState(false);
  const [templating, setTemplating] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<string | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  // A dragged group moves folded; its boards follow once it's dropped.
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
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
  const tagCount = useMemo(() => collectTags(allBoards, decisionList(decisionMap)).length, [allBoards, decisionMap]);
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
  const groups = project.boardGroups ?? [];
  const groupOf = new Map(groups.flatMap((g) => g.boardIds.map((id) => [id, g.id] as const)));
  const entries = sidebarEntries(boards, groups);
  const shown = (g: BoardGroup) => !g.collapsed && draggingGroup !== g.id;
  // One sortable list: each group's header, then its boards while it's open.
  const flat = entries.flatMap(({ group, boards: list }) =>
    group ? [GROUP + group.id, ...(shown(group) ? list.map((b) => b.id) : [])] : list.map((b) => b.id),
  );
  const onDragStart = ({ active }: DragStartEvent) => {
    dragged.current = true;
    const id = String(active.id);
    if (id.startsWith(GROUP)) setDraggingGroup(id.slice(GROUP.length));
  };
  const onDragEnd = ({ active, over, delta }: DragEndEvent) => {
    setTimeout(() => (dragged.current = false));
    setDraggingGroup(null);
    const moved = String(active.id);
    // A grouped board dragged to the left leaves its group, landing right after it.
    const outdent = groupOf.has(moved) && delta.x < -OUTDENT;
    if (!over || (active.id === over.id && !outdent)) return;
    const ids = arrayMove(flat, flat.indexOf(moved), flat.indexOf(String(over.id)));
    const boardGroup = (id: string | undefined) => (id && !id.startsWith(GROUP) ? groupOf.get(id) : undefined);
    let groupAfter = (id: string) => groupOf.get(id) ?? null;
    if (!moved.startsWith(GROUP)) {
      // A board joins the group it lands inside: above one of its boards, or right under its open header. Below a
      // group's last board it stays outside, unless it was already in that group.
      const at = ids.indexOf(moved);
      const [before, after] = [ids[at - 1], ids[at + 1]];
      const header = before?.startsWith(GROUP) ? before.slice(GROUP.length) : undefined;
      const target = outdent
        ? null
        : (boardGroup(after) ??
          (header && groups.some((g) => g.id === header && shown(g)) ? header : undefined) ??
          (boardGroup(before) === groupOf.get(moved) ? boardGroup(before) : undefined) ??
          null);
      if (target !== (groupOf.get(moved) ?? null)) setBoardGroup(moved, target);
      groupAfter = (id) => (id === moved ? target : (groupOf.get(id) ?? null));
    }
    // A group's boards follow its header, so a group dropped inside another one lands right after it.
    const order = new Set<string>();
    for (const id of ids) {
      if (id.startsWith(GROUP)) {
        const gid = id.slice(GROUP.length);
        // A folded group's boards aren't in the list: they keep their order.
        const entry = entries.find((e) => e.group?.id === gid);
        const list =
          entry && !shown(entry.group!)
            ? entry.boards.map((b) => b.id)
            : ids.filter((x) => !x.startsWith(GROUP) && groupAfter(x) === gid);
        list.forEach((b) => order.add(b));
      } else if (!groupAfter(id)) order.add(id);
    }
    boards.forEach((b) => order.add(b.id));
    reorderBoards([...order]);
  };

  const boardItem = (b: Board) => {
    const active = view.kind === "board" && view.boardId === b.id;
    const plan = isPlan(b) && b.plan ? planProgress(b.plan) : null;
    const notes = isNotes(b) ? (b.notes?.length ?? 0) : isGlossary(b) ? (b.terms?.length ?? 0) : null;
    const count = plan ? plan.total - plan.resolved : (notes ?? Object.keys(b.tasks).length);
    const kind = kindOf(b);
    const what = { kanban: "board", plan: "plan", notes: "notes board", glossary: "glossary" }[kind];
    const item = { kanban: "task", plan: "item", notes: "note", glossary: "term" }[kind];
    return (
      <SortableBoardItem
        key={b.id}
        id={b.id}
        grouped={groupOf.has(b.id)}
        active={active}
        icon={<BoardIcon kind={kind} />}
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
            ...(kind === "kanban"
              ? [
                  {
                    label: "Save as template…",
                    icon: <LayoutTemplate size={14} />,
                    onClick: () => setTemplating(b.id),
                  },
                ]
              : []),
            { label: "Move to group…", icon: <FolderInput size={14} />, onClick: () => setGrouping(b.id) },
            { label: `Archive ${what}`, icon: <Archive size={14} />, onClick: () => archiveBoard(b.id) },
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
                    : `Its ${count} ${item}(s) will be deleted too. You can undo this from Activity.`,
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
              {archivedCount > 0 && (
                <button className="icon-btn small" title="Archived boards" onClick={() => setArchiveOpen(true)}>
                  <Archive size={14} />
                  <span className="count-badge">{archivedCount}</span>
                </button>
              )}
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
                  {
                    label: "Board from a template…",
                    icon: <LayoutTemplate size={14} />,
                    onClick: () => setFromTemplate(true),
                  },
                  "divider",
                  {
                    label: "Group of boards",
                    icon: <FolderClosed size={14} />,
                    onClick: () => setRenamingGroup(createBoardGroup("New group")),
                  },
                ]}
              />
            </span>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setDraggingGroup(null);
              setTimeout(() => (dragged.current = false));
            }}
          >
            <SortableContext items={flat} strategy={verticalListSortingStrategy}>
              {entries.map(({ group, boards: list }) =>
                group ? (
                  <BoardGroupSection
                    key={group.id}
                    group={group}
                    open={shown(group)}
                    count={list.length}
                    renaming={renamingGroup === group.id}
                    onRenamingChange={(e) => setRenamingGroup(e ? group.id : null)}
                    onToggle={() => !dragged.current && toggleBoardGroup(group.id)}
                  >
                    {shown(group) && list.map(boardItem)}
                  </BoardGroupSection>
                ) : (
                  list.map(boardItem)
                ),
              )}
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
          <div
            className={cx("sidebar-item", view.kind === "glossary" && "active")}
            onClick={() => setView({ kind: "glossary" })}
          >
            <BookA size={15} />
            <span className="sidebar-item-name">Glossary</span>
            {termCount > 0 && <span className="sidebar-count">{termCount}</span>}
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
          <PlanView key={view.boardId} boardId={view.boardId} focus={view.stepId} />
        ) : view.kind === "board" ? (
          <BoardView key={view.boardId} boardId={view.boardId} archivedTask={view.archivedTaskId} />
        ) : view.kind === "issues" ? (
          <IssuesView />
        ) : view.kind === "activity" ? (
          <ActivityView boardId={view.boardId} />
        ) : view.kind === "tags" ? (
          <TagsView selected={view.tag} />
        ) : view.kind === "decisions" ? (
          <DecisionsView selected={view.decisionId} />
        ) : view.kind === "glossary" ? (
          <GlossaryView selected={view.termId} />
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
      {archiveOpen && <BoardArchiveDialog onClose={() => setArchiveOpen(false)} />}
      {fromTemplate && <NewFromTemplateDialog onClose={() => setFromTemplate(false)} />}
      {templating && <SaveTemplateDialog boardId={templating} onClose={() => setTemplating(null)} />}
      {grouping && <BoardGroupDialog boardId={grouping} onClose={() => setGrouping(null)} />}
    </div>
  );
}

type BoardKind = "kanban" | NonNullable<Board["kind"]>;
/** Kinds listed and made in the sidebar's board list (the glossary has its own entry). */
type NewKind = Exclude<BoardKind, "glossary">;

function BoardIcon({ kind }: { kind: BoardKind }) {
  return kind === "plan" ? (
    <ListChecks size={15} />
  ) : kind === "notes" ? (
    <StickyNote size={15} />
  ) : kind === "glossary" ? (
    <BookA size={15} />
  ) : (
    <Kanban size={15} />
  );
}

const BOARD_KIND_RANK: Record<BoardKind, number> = { kanban: 0, plan: 1, notes: 2, glossary: 3 };
const kindOf = (b: Board): BoardKind => b.kind ?? "kanban";
const byName = (a: Board, b: Board) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** One-off sorts: each rewrites the saved order, which dragging then adjusts ("Kind" keeps it within each kind). */
const BOARD_SORTS: { label: string; compare: (a: Board, b: Board) => number }[] = [
  { label: "Name (A–Z)", compare: byName },
  { label: "Name (Z–A)", compare: (a, b) => byName(b, a) },
  { label: "Newest first", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  { label: "Oldest first", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
  {
    label: "Kind (boards, plans, notes)",
    // A kind from a newer version goes last.
    compare: (a, b) => (BOARD_KIND_RANK[kindOf(a)] ?? 9) - (BOARD_KIND_RANK[kindOf(b)] ?? 9),
  },
];

/** Sortable id of a group's header, beside the boards' ids. */
const GROUP = "group:";
/** How far left a grouped board is dragged to take it out of its group. */
const OUTDENT = 24;

/**
 * The sidebar's rows in the saved board order, groups and boards mixed as the user arranged them: a group shows
 * where its first board is, an empty one at the end.
 */
function sidebarEntries(boards: Board[], groups: BoardGroup[]) {
  const groupOf = new Map(groups.flatMap((g) => g.boardIds.map((id) => [id, g] as const)));
  const entries: { group: BoardGroup | null; boards: Board[] }[] = [];
  const lists = new Map<string, Board[]>();
  for (const b of boards) {
    const g = groupOf.get(b.id);
    const list = g && lists.get(g.id);
    if (list) list.push(b);
    else if (g) {
      lists.set(g.id, [b]);
      entries.push({ group: g, boards: lists.get(g.id)! });
    } else entries.push({ group: null, boards: [b] });
  }
  for (const g of groups) if (!lists.has(g.id)) entries.push({ group: g, boards: [] });
  return entries;
}

/** A group's header, dragged by the whole row, and its boards. */
function BoardGroupSection({
  group,
  open,
  count,
  renaming,
  onRenamingChange,
  onToggle,
  children,
}: {
  group: BoardGroup;
  open: boolean;
  count: number;
  renaming: boolean;
  onRenamingChange: (editing: boolean) => void;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: GROUP + group.id,
    disabled: renaming,
  });
  return (
    <div className={cx("board-group", !open && "collapsed")}>
      <div
        ref={setNodeRef}
        className={cx("sidebar-item", "board-group-head", isDragging && "dragging")}
        style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
        onClick={onToggle}
        {...attributes}
        {...listeners}
      >
        <span className="sidebar-item-lead">
          <ChevronRight size={14} className="board-group-chevron" />
          {open ? <FolderOpen size={15} /> : <FolderClosed size={15} />}
        </span>
        <InlineEdit
          value={group.name}
          onSave={(v) => renameBoardGroup(group.id, v)}
          editing={renaming}
          onEditingChange={onRenamingChange}
          className="sidebar-item-name"
        />
        <span className="sidebar-count">{count}</span>
        <Menu
          align="right"
          trigger={(t) => (
            <button className="icon-btn tiny sidebar-item-menu" {...t}>
              <MoreHorizontal size={14} />
            </button>
          )}
          items={[
            { label: "Rename", icon: <Pencil size={14} />, onClick: () => onRenamingChange(true) },
            {
              label: "Ungroup",
              icon: <FolderMinus size={14} />,
              title: "Remove the group; its boards stay, outside any group",
              onClick: () => deleteBoardGroup(group.id),
            },
          ]}
        />
      </div>
      <div className="board-group-boards">{children}</div>
    </div>
  );
}

/** Moves a board into one of the project's groups, a new one, or out of any. */
function BoardGroupDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const groups = useStore(useShallow((s) => currentProject(s)?.project.boardGroups ?? []));
  const name = useStore((s) => s.boards[boardId]?.board.name ?? "");
  const current = groups.find((g) => g.boardIds.includes(boardId))?.id ?? null;
  const [fresh, setFresh] = useState("");
  const pick = (id: string | null) => {
    setBoardGroup(boardId, id);
    onClose();
  };
  return (
    <Modal onClose={onClose} width={420}>
      <ModalHeader title="Move to group" subtitle={`Where “${name}” shows in the sidebar.`} onClose={onClose} />
      <div className="form">
        <div className="template-list">
          {[{ id: null as string | null, name: "No group" }, ...groups].map((g) => (
            <button
              key={g.id ?? ""}
              type="button"
              className={cx("template-item", g.id === current && "active")}
              onClick={() => pick(g.id)}
            >
              {g.id ? <FolderClosed size={15} /> : <FolderMinus size={15} />}
              <span className="template-item-name">{g.name}</span>
            </button>
          ))}
        </div>
        <form
          className="board-group-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (!fresh.trim()) return;
            createBoardGroup(fresh, [boardId]);
            onClose();
          }}
        >
          <input value={fresh} onChange={(e) => setFresh(e.target.value)} placeholder="New group name" />
          <button type="submit" className="btn primary" disabled={!fresh.trim()}>
            Create and move
          </button>
        </form>
      </div>
    </Modal>
  );
}

/**
 * A board in the sidebar, dragged up or down by the grip beside its icon, shown on hover (or focus the grip, then
 * Space and the arrow keys).
 */
function SortableBoardItem({
  id,
  grouped,
  active,
  icon,
  onOpen,
  children,
}: {
  id: string;
  grouped: boolean;
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
      style={{
        // Shown out of its group's indent while a drop would take it out.
        transform: CSS.Translate.toString(
          transform && { ...transform, x: grouped && isDragging && transform.x < -OUTDENT ? -14 : 0 },
        ),
        transition,
      }}
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
