import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Check,
  ChevronRight,
  ClipboardCopy,
  CornerDownRight,
  FileUp,
  GripVertical,
  HelpCircle,
  History,
  Lightbulb,
  Link2,
  ListChecks,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  SkipForward,
  Trash2,
  Undo2,
} from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { readText } from "../lib/fs";
import {
  currentStepId,
  findItem,
  flatIds,
  indent,
  insertAfter,
  mapItem,
  moveItem,
  newItem,
  newQuestion,
  newStep,
  outdent,
  planFromMarkdown,
  planProgress,
  planToMarkdown,
  progress,
  removeItem,
  type ItemDrop,
} from "../lib/plan";
import {
  createBoard,
  currentProject,
  patchPlan,
  renameBoard,
  setView,
  toast,
  updateBoardDescription,
  useStore,
} from "../lib/store";
import type { GhIssue, Plan, PlanItem, PlanQuestion, PlanStep } from "../lib/types";
import { cx, issueKey } from "../lib/util";
import { DecisionDialog, IssueChip } from "./DecisionDialog";
import { IssuePicker } from "./board/TaskDialog";
import { InlineEdit, Markdown, Menu, Modal, ModalHeader, Popover, confirm } from "./ui";

/** Renders `code` spans in a one-line text such as a step title. */
function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : p,
      )}
    </>
  );
}

function AutoTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { inputRef?: React.Ref<HTMLTextAreaElement> },
) {
  const { inputRef, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [props.value]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        if (typeof inputRef === "function") inputRef(el);
        else if (inputRef) (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      }}
      rows={1}
      {...rest}
    />
  );
}

/** Markdown shown as such; a click edits it, leaving the field saves it, Esc cancels. */
function MarkdownField({
  value,
  onSave,
  placeholder,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null)
    return (
      <AutoTextarea
        autoFocus
        className={cx("plan-md-edit", className)}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft.trim());
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
    );
  return value.trim() ? (
    <div
      className={cx("plan-md", className)}
      onClick={(e) => !(e.target as HTMLElement).closest("a") && setDraft(value)}
      title="Click to edit"
    >
      <Markdown>{value}</Markdown>
    </div>
  ) : (
    <button className={cx("plan-md-empty", className)} onClick={() => setDraft("")}>
      {placeholder}
    </button>
  );
}

type DecisionFor =
  | { kind: "item"; stepId: string; id: string; title: string }
  | { kind: "question"; id: string; title: string; why: string };

/*
 * Dragging: steps reorder by the grip left of their head. Items move by their grip, with their sub-items:
 * dropped on the top or bottom of a row they go before or after it, on its middle they nest under it, and
 * on a step's head or its "Add an item" they go to the end of that step (folded steps included).
 */

/** Where the dragged item would land, for the drop marker. */
type DropHint = { kind: "row"; id: string; zone: ItemDrop["zone"] } | { kind: "step"; stepId: string } | null;

/** What drop targets carry: an item's row, or a step's head (and its "Add an item"). */
type DropData = { kind: "itemrow"; id: string; stepId: string } | { kind: "stephead"; stepId: string };
type DragData = { kind: "step"; id: string; title: string } | { kind: "item"; id: string; text: string };

const DragHint = createContext<DropHint>(null);

// Steps sort among steps; items look at what is under the pointer, the deepest row there being the only one.
const collision: CollisionDetection = (args) => {
  const kind = (args.active.data.current as DragData | undefined)?.kind;
  const droppableContainers = args.droppableContainers.filter(
    (c) => (c.data.current?.kind === "step") === (kind === "step"),
  );
  return kind === "step"
    ? closestCenter({ ...args, droppableContainers })
    : pointerWithin({ ...args, droppableContainers });
};

/** The drop for an item dragged over `over`, the pointer at height `y`. */
function dropAt(
  over: { rect: { top: number; height: number }; data: { current?: unknown } },
  y: number,
): { hint: DropHint; drop: ItemDrop } | null {
  const d = over.data.current as DropData | undefined;
  if (d?.kind === "stephead")
    return { hint: { kind: "step", stepId: d.stepId }, drop: { stepId: d.stepId, ref: null, zone: "after" } };
  if (d?.kind !== "itemrow") return null;
  const f = (y - over.rect.top) / over.rect.height;
  const zone = f < 0.3 ? "before" : f > 0.7 ? "after" : "inside";
  return { hint: { kind: "row", id: d.id, zone }, drop: { stepId: d.stepId, ref: d.id, zone } };
}

export function PlanView({ boardId }: { boardId: string }) {
  const board = useStore((s) => s.boards[boardId]?.board);
  const repos = useStore((s) => currentProject(s)?.project.repos ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newStepTitle, setNewStepTitle] = useState<string | null>(null);
  const [newQuestionText, setNewQuestionText] = useState<string | null>(null);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [decisionFor, setDecisionFor] = useState<DecisionFor | null>(null);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [hint, setHint] = useState<DropHint>(null);
  const startY = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (!board?.plan) return null;
  const plan = board.plan;
  const patch = (fn: (p: Plan) => Plan) => patchPlan(boardId, fn);
  const patchStep = (stepId: string, fn: (s: PlanStep) => PlanStep) =>
    patch((p) => ({ ...p, steps: p.steps.map((s) => (s.id === stepId ? fn(s) : s)) }));
  const patchItems = (stepId: string, fn: (items: PlanItem[]) => PlanItem[]) =>
    patchStep(stepId, (s) => ({ ...s, items: fn(s.items) }));
  const patchQuestion = (id: string, fn: (q: PlanQuestion) => PlanQuestion) =>
    patch((p) => ({ ...p, questions: p.questions.map((q) => (q.id === id ? fn(q) : q)) }));

  const total = planProgress(plan);
  const current = currentStepId(plan);
  const isCollapsed = (s: PlanStep) => {
    if (s.id in collapsed) return collapsed[s.id];
    // Finished steps fold away; the work left stays in view.
    const p = progress(s.items);
    return p.total > 0 && p.resolved === p.total;
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(await planToMarkdown(board.name, plan));
      toast("Plan copied as Markdown", "success");
    } catch (e) {
      toast(`Could not copy: ${e}`, "error");
    }
  };

  const linkIssue = (i: GhIssue) => {
    if (!plan.issues.some((x) => x.repo === i.repo && x.number === i.number))
      patch((p) => ({ ...p, issues: [...p.issues, { repo: i.repo, number: i.number }] }));
    setPicker(null);
  };

  /** The drop under the pointer, unless it is the dragged item itself or one of its sub-items. */
  const itemDrop = (e: DragMoveEvent | DragEndEvent) => {
    const d = e.active.data.current as DragData | undefined;
    if (d?.kind !== "item" || !e.over) return null;
    const at = dropAt(e.over, startY.current + e.delta.y);
    const moved = plan.steps.map((s) => findItem(s.items, d.id)).find(Boolean);
    if (!at || (at.drop.ref && (at.drop.ref === d.id || (moved && findItem(moved.children, at.drop.ref))))) return null;
    return at;
  };
  const onDragStart = (e: DragStartEvent) => {
    setDragging((e.active.data.current as DragData) ?? null);
    startY.current = (e.activatorEvent as PointerEvent).clientY;
  };
  const onDragMove = (e: DragMoveEvent) => {
    const next = itemDrop(e)?.hint ?? null;
    if (JSON.stringify(next) !== JSON.stringify(hint)) setHint(next);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const d = e.active.data.current as DragData | undefined;
    if (d?.kind === "item") {
      const at = itemDrop(e);
      if (at) patch((p) => ({ ...p, steps: moveItem(p.steps, d.id, at.drop) }));
    } else if (d?.kind === "step" && e.over && e.over.id !== e.active.id) {
      const to = String(e.over.id).replace(/^step:/, "");
      patch((p) => {
        const ids = p.steps.map((s) => s.id);
        return { ...p, steps: arrayMove(p.steps, ids.indexOf(d.id), ids.indexOf(to)) };
      });
    }
    setDragging(null);
    setHint(null);
  };

  const addStep = () => {
    const t = newStepTitle?.trim();
    if (t) patch((p) => ({ ...p, steps: [...p.steps, newStep(t)] }));
    setNewStepTitle(null);
  };
  const addQuestion = () => {
    const t = newQuestionText?.trim();
    if (t) patch((p) => ({ ...p, questions: [...p.questions, newQuestion(t)] }));
    setNewQuestionText(null);
  };

  return (
    <div className="plan-view">
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
          {total.total > 0 && (
            <div className="board-stats">
              <span className="progress" title={`${total.resolved} of ${total.total} items done or skipped`}>
                <span className="progress-bar">
                  <span style={{ width: `${(total.resolved / total.total) * 100}%` }} />
                </span>
                {total.resolved}/{total.total}
              </span>
            </div>
          )}
          <button
            className="btn small"
            onClick={copyMarkdown}
            title="Copy the whole plan as Markdown, e.g. for a pull request"
          >
            <ClipboardCopy size={14} /> Copy as Markdown
          </button>
          <button
            className="icon-btn"
            title="Activity on this plan"
            onClick={() => setView({ kind: "activity", boardId })}
          >
            <History size={16} />
          </button>
        </div>
      </div>

      <div className="plan-scroll">
        <div className="plan-doc">
          {(plan.issues.length > 0 || repos.length > 0) && (
            <div className="plan-issues">
              {plan.issues.map((i) => (
                <IssueChip
                  key={issueKey(i)}
                  issue={i}
                  onRemove={() => patch((p) => ({ ...p, issues: p.issues.filter((x) => issueKey(x) !== issueKey(i)) }))}
                />
              ))}
              {repos.length > 0 && (
                <button className="btn ghost small" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}>
                  <Link2 size={13} /> Link issue
                </button>
              )}
            </div>
          )}

          <MarkdownField
            value={plan.goal}
            onSave={(goal) => patch((p) => ({ ...p, goal }))}
            placeholder="What is this plan for? Context, terms, constraints… (Markdown)"
            className="plan-goal"
          />

          <div className="plan-steps">
            <DndContext
              sensors={sensors}
              collisionDetection={collision}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onDragCancel={() => (setDragging(null), setHint(null))}
            >
              <DragHint.Provider value={hint}>
                <SortableContext items={plan.steps.map((s) => `step:${s.id}`)} strategy={verticalListSortingStrategy}>
                  {plan.steps.map((s, i) => (
                    <StepCard
                      key={s.id}
                      step={s}
                      number={i + 1}
                      isCurrent={s.id === current}
                      collapsed={isCollapsed(s)}
                      onToggle={() => setCollapsed({ ...collapsed, [s.id]: !isCollapsed(s) })}
                      editing={editing}
                      setEditing={setEditing}
                      patchStep={(fn) => patchStep(s.id, fn)}
                      patchItems={(fn) => patchItems(s.id, fn)}
                      onMove={(dir) =>
                        patch((p) => {
                          const steps = [...p.steps];
                          const [moved] = steps.splice(i, 1);
                          steps.splice(Math.max(0, Math.min(steps.length, i + dir)), 0, moved);
                          return { ...p, steps };
                        })
                      }
                      canMove={{ up: i > 0, down: i < plan.steps.length - 1 }}
                      onDelete={async () => {
                        const n = progress(s.items).total;
                        const ok = await confirm({
                          title: `Delete step ${i + 1}?`,
                          message: `“${s.title}”${n ? ` and its ${n} item${n === 1 ? "" : "s"}` : ""} will be deleted. You can undo this from Activity.`,
                          confirmLabel: "Delete step",
                          danger: true,
                        });
                        if (ok) patch((p) => ({ ...p, steps: p.steps.filter((x) => x.id !== s.id) }));
                      }}
                      onRecordDecision={(it) =>
                        setDecisionFor({ kind: "item", stepId: s.id, id: it.id, title: it.text })
                      }
                    />
                  ))}
                </SortableContext>
              </DragHint.Provider>
              <DragOverlay dropAnimation={null}>
                {dragging?.kind === "item" && (
                  <div className="plan-drag-chip">
                    <InlineMd text={dragging.text || "Empty item"} />
                  </div>
                )}
              </DragOverlay>
            </DndContext>
            {newStepTitle !== null ? (
              <div className="plan-step adding">
                <span className="plan-step-num">{plan.steps.length + 1}</span>
                <input
                  autoFocus
                  className="plan-step-title-input"
                  placeholder="Step title"
                  value={newStepTitle}
                  onChange={(e) => setNewStepTitle(e.target.value)}
                  onBlur={addStep}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addStep();
                    if (e.key === "Escape") setNewStepTitle(null);
                  }}
                />
              </div>
            ) : (
              <button className="plan-add" onClick={() => setNewStepTitle("")}>
                <Plus size={14} /> Add a step
              </button>
            )}
          </div>

          <section className="plan-section">
            <h3>
              <HelpCircle size={15} /> Open questions
              {plan.questions.length > 0 && (
                <span className="faint">
                  {plan.questions.filter((q) => q.resolved).length}/{plan.questions.length} resolved
                </span>
              )}
            </h3>
            {plan.questions.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                patch={(fn) => patchQuestion(q.id, fn)}
                onDelete={() => patch((p) => ({ ...p, questions: p.questions.filter((x) => x.id !== q.id) }))}
                onRecordDecision={() => setDecisionFor({ kind: "question", id: q.id, title: q.text, why: q.answer })}
              />
            ))}
            {newQuestionText !== null ? (
              <input
                autoFocus
                className="plan-question-input"
                placeholder="What is still undecided?"
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                onBlur={addQuestion}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addQuestion();
                  if (e.key === "Escape") setNewQuestionText(null);
                }}
              />
            ) : (
              <button className="plan-add" onClick={() => setNewQuestionText("")}>
                <Plus size={14} /> Ask a question
              </button>
            )}
          </section>

          <section className="plan-section">
            <h3>Notes</h3>
            <MarkdownField
              value={plan.notes}
              onSave={(notes) => patch((p) => ({ ...p, notes }))}
              placeholder="Known limits, follow-ups, anything else… (Markdown)"
            />
          </section>
        </div>
      </div>

      {picker && (
        <Popover anchor={picker} onClose={() => setPicker(null)}>
          <IssuePicker onPick={linkIssue} />
        </Popover>
      )}
      {decisionFor && (
        <DecisionDialog
          initial={{
            // Plain text: backticks and bold markers make no sense in a title (underscores do, in names).
            title: decisionFor.title.replace(/`|\*\*/g, ""),
            why: decisionFor.kind === "question" ? decisionFor.why : "",
            issues: plan.issues,
          }}
          onClose={() => setDecisionFor(null)}
          onCreated={(id, number) => {
            if (decisionFor.kind === "item")
              patchItems(decisionFor.stepId, (items) =>
                mapItem(items, decisionFor.id, (it) => ({ ...it, decision: number })),
              );
            else {
              // The decision answers the question: an empty answer takes its why.
              const why = useStore.getState().decisions[id]?.decision.why ?? "";
              patchQuestion(decisionFor.id, (q) => ({
                ...q,
                decision: number,
                resolved: true,
                answer: q.answer || why,
              }));
            }
            toast(`Recorded D-${number}`, "success");
          }}
        />
      )}
    </div>
  );
}

function StepCard({
  step,
  number,
  isCurrent,
  collapsed,
  onToggle,
  editing,
  setEditing,
  patchStep,
  patchItems,
  onMove,
  canMove,
  onDelete,
  onRecordDecision,
}: {
  step: PlanStep;
  number: number;
  isCurrent: boolean;
  collapsed: boolean;
  onToggle: () => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  patchStep: (fn: (s: PlanStep) => PlanStep) => void;
  patchItems: (fn: (items: PlanItem[]) => PlanItem[]) => void;
  onMove: (dir: -1 | 1) => void;
  canMove: { up: boolean; down: boolean };
  onDelete: () => void;
  onRecordDecision: (it: PlanItem) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const sortable = useSortable({
    id: `step:${step.id}`,
    data: { kind: "step", id: step.id, title: step.title } satisfies DragData,
  });
  const head = useDroppable({ id: `head:${step.id}`, data: { kind: "stephead", stepId: step.id } satisfies DropData });
  const end = useDroppable({ id: `end:${step.id}`, data: { kind: "stephead", stepId: step.id } satisfies DropData });
  const hint = useContext(DragHint);
  const p = progress(step.items);
  const done = p.total > 0 && p.resolved === p.total;

  const addItem = () => {
    const it = newItem();
    patchItems((items) => [...items, it]);
    setEditing(it.id);
    if (collapsed) onToggle();
  };
  const saveTitle = () => {
    if (renaming?.trim() && renaming.trim() !== step.title) patchStep((s) => ({ ...s, title: renaming.trim() }));
    setRenaming(null);
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform && { ...sortable.transform, x: 0 }),
        transition: sortable.transition,
      }}
      className={cx(
        "plan-step",
        done && "done",
        isCurrent && "current",
        collapsed && "collapsed",
        sortable.isDragging && "dragging",
        hint?.kind === "step" && hint.stepId === step.id && "drop-into",
      )}
    >
      <div className="plan-step-head" ref={head.setNodeRef}>
        <button
          ref={sortable.setActivatorNodeRef}
          className="plan-grip step"
          title="Drag to reorder"
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical size={14} />
        </button>
        <span className="plan-step-num">{done ? <Check size={13} strokeWidth={3} /> : number}</span>
        {renaming !== null ? (
          <input
            autoFocus
            className="plan-step-title-input"
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <button
            className="plan-step-title"
            onClick={onToggle}
            onDoubleClick={() => setRenaming(step.title)}
            title="Click to fold, double-click to rename"
          >
            <InlineMd text={step.title} />
          </button>
        )}
        {isCurrent && <span className="plan-step-badge">Current</span>}
        <span className="spacer" />
        {p.total > 0 && (
          <span className="plan-step-progress" title={`${p.resolved} of ${p.total} done or skipped`}>
            <span className="progress-bar">
              <span style={{ width: `${(p.resolved / p.total) * 100}%` }} />
            </span>
            {p.resolved}/{p.total}
          </span>
        )}
        <button
          className={cx("icon-btn small plan-fold", !collapsed && "open")}
          onClick={onToggle}
          title={collapsed ? "Expand" : "Fold"}
        >
          <ChevronRight size={15} />
        </button>
        <Menu
          align="right"
          trigger={(t) => (
            <button className="icon-btn small" {...t}>
              <MoreHorizontal size={15} />
            </button>
          )}
          items={[
            { label: "Rename", icon: <Pencil size={14} />, onClick: () => setRenaming(step.title) },
            {
              label: step.notes ? "Edit notes" : "Add notes",
              icon: <ListChecks size={14} />,
              onClick: () => (collapsed && onToggle(), setShowNotes(true)),
            },
            ...(canMove.up
              ? [{ label: "Move up", icon: <ChevronRight size={14} className="rot-up" />, onClick: () => onMove(-1) }]
              : []),
            ...(canMove.down
              ? [
                  {
                    label: "Move down",
                    icon: <ChevronRight size={14} className="rot-down" />,
                    onClick: () => onMove(1),
                  },
                ]
              : []),
            "divider" as const,
            { label: "Delete step", icon: <Trash2 size={14} />, danger: true, onClick: onDelete },
          ]}
        />
      </div>

      {!collapsed && (
        <div className="plan-step-body">
          {(step.notes || showNotes) && (
            <MarkdownField
              key={showNotes ? "open" : "closed"}
              value={step.notes}
              onSave={(notes) => {
                patchStep((s) => ({ ...s, notes }));
                setShowNotes(false);
              }}
              placeholder="Notes for this step: design decisions, the state of the code… (Markdown)"
              className="plan-step-notes"
            />
          )}
          <div className="plan-items">
            {step.items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                step={step}
                editing={editing}
                setEditing={setEditing}
                patchItems={patchItems}
                onRecordDecision={onRecordDecision}
              />
            ))}
          </div>
          <button className="plan-add small" onClick={addItem} ref={end.setNodeRef}>
            <Plus size={13} /> Add an item
          </button>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  step,
  editing,
  setEditing,
  patchItems,
  onRecordDecision,
}: {
  item: PlanItem;
  step: PlanStep;
  editing: string | null;
  setEditing: (id: string | null) => void;
  patchItems: (fn: (items: PlanItem[]) => PlanItem[]) => void;
  onRecordDecision: (it: PlanItem) => void;
}) {
  const [draft, setDraft] = useState(item.text);
  const [reasonDraft, setReasonDraft] = useState<string | null>(null);
  const committed = useRef(false);
  const isEditing = editing === item.id;
  const drag = useDraggable({
    id: `item:${item.id}`,
    data: { kind: "item", id: item.id, text: item.text } satisfies DragData,
  });
  const drop = useDroppable({
    id: `row:${item.id}`,
    data: { kind: "itemrow", id: item.id, stepId: step.id } satisfies DropData,
  });
  const hint = useContext(DragHint);
  const zone = hint?.kind === "row" && hint.id === item.id ? hint.zone : null;

  useEffect(() => {
    if (isEditing) {
      setDraft(item.text);
      committed.current = false;
    }
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (fn: (it: PlanItem) => PlanItem) => patchItems((items) => mapItem(items, item.id, fn));
  const setState = (state: PlanItem["state"]) =>
    update((it) => ({ ...it, state, reason: state === "skipped" ? it.reason : "" }));

  /** Saves the text; an item left empty is removed. */
  const commit = (text: string) => {
    committed.current = true;
    const t = text.trim();
    if (!t) patchItems((items) => removeItem(items, item.id));
    else if (t !== item.text) update((it) => ({ ...it, text: t }));
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!draft.trim()) return;
      commit(draft);
      const next = newItem();
      patchItems((items) => insertAfter(items, item.id, next));
      setEditing(next.id);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (draft.trim() && draft.trim() !== item.text) update((it) => ({ ...it, text: draft.trim() }));
      patchItems((items) => (e.shiftKey ? outdent(items, item.id) : indent(items, item.id)));
    } else if (e.key === "Backspace" && !draft) {
      e.preventDefault();
      const ids = flatIds(step.items);
      const prev = ids[ids.indexOf(item.id) - 1] ?? null;
      committed.current = true;
      patchItems((items) => removeItem(items, item.id));
      setEditing(prev);
    } else if (e.key === "Escape") {
      // Like leaving the field: keeps what was typed (an empty item goes away).
      e.stopPropagation();
      commit(draft);
      setEditing(null);
    }
  };

  return (
    <div className={cx("plan-item", item.state, drag.isDragging && "dragging")} ref={drag.setNodeRef}>
      <div className={cx("plan-item-row", zone && `drop-${zone}`)} ref={drop.setNodeRef}>
        <button
          ref={drag.setActivatorNodeRef}
          className="plan-grip"
          title="Drag to move it; drop on the middle of another item to nest it there"
          {...drag.attributes}
          {...drag.listeners}
        >
          <GripVertical size={13} />
        </button>
        <button
          className={cx("plan-check", item.state)}
          title={
            item.state === "done"
              ? "Done — click to reopen"
              : item.state === "skipped"
                ? "Skipped — click to reopen"
                : "Mark done"
          }
          onClick={() => setState(item.state === "todo" ? "done" : "todo")}
        >
          {item.state === "done" ? (
            <Check size={11} strokeWidth={3.5} />
          ) : item.state === "skipped" ? (
            <Minus size={11} strokeWidth={3.5} />
          ) : null}
        </button>
        {isEditing ? (
          <AutoTextarea
            autoFocus
            className="plan-item-edit"
            value={draft}
            placeholder="Describe the item… (Enter: next, Tab: nest)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => {
              if (!committed.current) commit(draft);
              if (editing === item.id) setEditing(null);
            }}
          />
        ) : (
          <div
            className="plan-item-text"
            onClick={(e) => !(e.target as HTMLElement).closest("a") && setEditing(item.id)}
          >
            <Markdown>{item.text}</Markdown>
          </div>
        )}
        {item.decision != null && (
          <button className="plan-decision" onClick={() => setView({ kind: "decisions" })} title="Open the decisions">
            <Lightbulb size={11} /> D-{item.decision}
          </button>
        )}
        {!isEditing && (
          <Menu
            align="right"
            trigger={(t) => (
              <button className="icon-btn tiny plan-item-menu" {...t}>
                <MoreHorizontal size={14} />
              </button>
            )}
            items={[
              {
                label: "Add a sub-item",
                icon: <CornerDownRight size={14} />,
                onClick: () => {
                  const child = newItem();
                  update((it) => ({ ...it, children: [...it.children, child] }));
                  setEditing(child.id);
                },
              },
              item.state === "skipped"
                ? { label: "Don't skip", icon: <Undo2 size={14} />, onClick: () => setState("todo") }
                : {
                    label: "Skip…",
                    icon: <SkipForward size={14} />,
                    onClick: () => {
                      setState("skipped");
                      setReasonDraft("");
                    },
                  },
              { label: "Record as decision", icon: <Lightbulb size={14} />, onClick: () => onRecordDecision(item) },
              "divider",
              {
                label: "Delete",
                icon: <Trash2 size={14} />,
                danger: true,
                onClick: () => patchItems((items) => removeItem(items, item.id)),
              },
            ]}
          />
        )}
      </div>
      {item.state === "skipped" &&
        (reasonDraft !== null ? (
          <input
            autoFocus
            className="plan-reason-input"
            placeholder="Why is it skipped?"
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            onBlur={() => {
              update((it) => ({ ...it, reason: reasonDraft.trim() }));
              setReasonDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setReasonDraft(null);
            }}
          />
        ) : (
          <button className="plan-reason" onClick={() => setReasonDraft(item.reason)} title="Click to edit the reason">
            Skipped{item.reason ? `: ${item.reason}` : " — add a reason"}
          </button>
        ))}
      {item.children.length > 0 && (
        <div className="plan-children">
          {item.children.map((c) => (
            <ItemRow
              key={c.id}
              item={c}
              step={step}
              editing={editing}
              setEditing={setEditing}
              patchItems={patchItems}
              onRecordDecision={onRecordDecision}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionRow({
  question: q,
  patch,
  onDelete,
  onRecordDecision,
}: {
  question: PlanQuestion;
  patch: (fn: (q: PlanQuestion) => PlanQuestion) => void;
  onDelete: () => void;
  onRecordDecision: () => void;
}) {
  const [editingText, setEditingText] = useState<string | null>(null);
  return (
    <div className={cx("plan-question", q.resolved && "resolved")}>
      <div className="plan-item-row">
        <button
          className={cx("plan-check", q.resolved && "done")}
          title={q.resolved ? "Resolved — click to reopen" : "Mark resolved"}
          onClick={() => patch((x) => ({ ...x, resolved: !x.resolved }))}
        >
          {q.resolved && <Check size={11} strokeWidth={3.5} />}
        </button>
        {editingText !== null ? (
          <input
            autoFocus
            className="plan-question-input"
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            onBlur={() => {
              if (editingText.trim()) patch((x) => ({ ...x, text: editingText.trim() }));
              setEditingText(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditingText(null);
            }}
          />
        ) : (
          <div className="plan-item-text plan-question-text" onClick={() => setEditingText(q.text)}>
            <InlineMd text={q.text} />
          </div>
        )}
        {q.decision != null && (
          <button className="plan-decision" onClick={() => setView({ kind: "decisions" })} title="Open the decisions">
            <Lightbulb size={11} /> D-{q.decision}
          </button>
        )}
        <Menu
          align="right"
          trigger={(t) => (
            <button className="icon-btn tiny plan-item-menu" {...t}>
              <MoreHorizontal size={14} />
            </button>
          )}
          items={[
            { label: "Record as decision", icon: <Lightbulb size={14} />, onClick: onRecordDecision },
            "divider",
            { label: "Delete", icon: <Trash2 size={14} />, danger: true, onClick: onDelete },
          ]}
        />
      </div>
      <div className="plan-answer">
        <MarkdownField value={q.answer} onSave={(answer) => patch((x) => ({ ...x, answer }))} placeholder="Answer…" />
      </div>
    </div>
  );
}

/** Creates a plan board from a Markdown draft, pasted or opened from a file. */
export function PlanImportDialog({ onClose }: { onClose: () => void }) {
  const [markdown, setMarkdown] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<{
    title: string | null;
    steps: number;
    items: number;
    questions: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Shows what the draft becomes as it is typed or pasted.
  useEffect(() => {
    if (!markdown.trim()) return setPreview(null);
    const t = setTimeout(async () => {
      const { title, plan } = await planFromMarkdown(markdown);
      setPreview({
        title,
        steps: plan.steps.length,
        items: planProgress(plan).total,
        questions: plan.questions.length,
      });
    }, 200);
    return () => clearTimeout(t);
  }, [markdown]);

  const openFile = async () => {
    const path = await openDialog({
      multiple: false,
      title: "Open a plan",
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
    if (typeof path !== "string") return;
    const text = await readText(path);
    if (text != null) setMarkdown(text);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!markdown.trim() || busy) return;
    setBusy(true);
    try {
      const { title, plan } = await planFromMarkdown(markdown);
      await createBoard(name.trim() || title || "Untitled plan", plan);
      onClose();
    } catch (err) {
      toast(String(err), "error");
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={680}>
      <ModalHeader
        title="Plan from Markdown"
        subtitle="## headings become steps, - [ ] / - [x] items their checklist (nested by indentation), ~~struck~~ items are skipped. Other text becomes notes."
        onClose={onClose}
      />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>
            Name <em className="faint">— defaults to the Markdown's # title</em>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={preview?.title ?? "e.g. Issue #66 — input"}
          />
        </label>
        <div className="field">
          <span className="plan-import-label">
            Markdown
            <button type="button" className="btn small" onClick={openFile}>
              <FileUp size={13} /> Open a file…
            </button>
          </span>
          <textarea
            autoFocus
            rows={14}
            className="mono-area"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={
              "# Issue #66 — implementation plan\n\n## 1. New input module\n\n- [x] Add the target\n- [ ] key.hpp"
            }
          />
          {preview && (
            <div className="faint small">
              {preview.steps} step{preview.steps === 1 ? "" : "s"}, {preview.items} item{preview.items === 1 ? "" : "s"}
              {preview.questions ? `, ${preview.questions} question${preview.questions === 1 ? "" : "s"}` : ""}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!markdown.trim() || busy}>
            Create plan
          </button>
        </div>
      </form>
    </Modal>
  );
}
