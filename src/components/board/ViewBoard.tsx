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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronsLeftRight,
  ChevronsRightLeft,
  Eye,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addViewColumn,
  currentProject,
  deleteColumn,
  moveColumn,
  patchBoard,
  refreshViewBoard,
  renameBoard,
  setColumnCollapsed,
  setView,
  syncIssues,
  updateBoardDescription,
  updateColumn,
  useStore,
} from "../../lib/store";
import type {
  Board,
  Color,
  Column,
  GhIssue,
  GhLabel,
  IssueRules,
  LabelRule,
  PresenceRule,
  QuerySource,
  RepoRef,
  ViewSort,
} from "../../lib/types";
import { mergeRequestsName } from "../../lib/mergeRequests";
import { colorHex, cx, isGitlab, providerName, repoKey, repoPath } from "../../lib/util";
import {
  cardKey,
  describeRules,
  emptyRules,
  issuePool,
  matchesRules,
  querySource,
  viewCards,
} from "../../lib/viewBoards";
import { ColorPicker } from "../ColorPicker";
import { EmptyState, GhLabelChip, InlineEdit, IssuePanel, Menu, Modal, ModalHeader, Popover, confirm } from "../ui";
import { issueMatches, useHorizontalPan } from "./BoardView";
import { IssueCard } from "./IssueCard";
import { LabelColumnPicker } from "./LabelColumnPicker";

/** A board that only shows GitHub and GitLab items picked by rules. Columns can be changed; cards can't. */
export function ViewBoard({ boardId }: { boardId: string }) {
  const board = useStore((s) => s.boards[boardId]?.board);
  const issues = useStore((s) => s.issues);
  const syncing = useStore((s) => s.syncing);
  const repos = useStore((s) => currentProject(s)?.project.repos);
  const [query, setQuery] = useState("");
  const [openIssue, setOpenIssue] = useState<GhIssue | null>(null);
  const [editing, setEditing] = useState<Column | "new" | null>(null);
  const [settings, setSettings] = useState(false);
  const [labelPicker, setLabelPicker] = useState<DOMRect | null>(null);
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  useHorizontalPan(strip);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const repoKeys = useMemo(() => (repos ?? []).map(repoKey), [repos]);
  const cards = useMemo(() => (board ? viewCards(board, issues, repoKeys) : {}), [board, issues, repoKeys]);
  const open = useCallback((i: GhIssue) => setOpenIssue(i), []);

  if (!board) return null;
  const total = new Set(Object.values(cards).flat().map(cardKey)).size;
  const q = query.trim();
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = board.columns.findIndex((c) => c.id === active.id);
    const to = board.columns.findIndex((c) => c.id === over.id);
    if (from !== -1 && to !== -1) moveColumn(boardId, from, to);
  };

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
            <span className="view-board-badge" title="Cards come from GitHub and GitLab and can't be changed here">
              <Eye size={13} /> View only
            </span>
            <span>
              {total} card{total === 1 ? "" : "s"}
            </span>
          </div>
          <label className="search">
            <Search size={15} />
            <input
              data-local-search
              placeholder="Filter cards"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="icon-btn tiny" onClick={() => setQuery("")}>
                <X size={13} />
              </button>
            )}
          </label>
          {!!repos?.length && (
            <button className="icon-btn" title="Sync issues" disabled={syncing} onClick={() => syncIssues()}>
              <RefreshCw size={16} className={cx(syncing && "spin")} />
            </button>
          )}
          <button className="icon-btn" title="Rules for the whole board" onClick={() => setSettings(true)}>
            <SlidersHorizontal size={16} />
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

      {!repos?.length ? (
        <EmptyState icon={<Eye size={28} />} title="No repositories to show">
          <p className="muted">Connect a GitHub repository or GitLab project in project settings to fill this board.</p>
        </EmptyState>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="board-columns" ref={setStrip}>
            <SortableContext items={board.columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
              {board.columns.map((c) => (
                <ViewColumn
                  key={c.id}
                  boardId={boardId}
                  column={c}
                  cards={(cards[c.id] ?? []).filter((i) => issueMatches(i, q))}
                  total={cards[c.id]?.length ?? 0}
                  filtering={!!q}
                  onOpen={open}
                  onEdit={() => setEditing(c)}
                />
              ))}
            </SortableContext>
            <div className="add-column-stack">
              <button className="add-column" onClick={() => setEditing("new")}>
                <Plus size={16} /> Add column
              </button>
              <button
                className="add-column secondary"
                title="A column that shows the GitHub or GitLab items carrying a label"
                onClick={(e) => setLabelPicker(e.currentTarget.getBoundingClientRect())}
              >
                <Tag size={14} /> Add label column
              </button>
            </div>
          </div>
        </DndContext>
      )}

      {editing && repos && (
        <ColumnDialog
          board={board}
          column={editing === "new" ? null : editing}
          repos={repos}
          onClose={() => setEditing(null)}
        />
      )}
      {settings && repos && <BoardRulesDialog board={board} repos={repos} onClose={() => setSettings(false)} />}
      {labelPicker && (
        <LabelColumnPicker
          boardId={boardId}
          anchor={labelPicker}
          onClose={() => setLabelPicker(null)}
          onAdded={() => setTimeout(() => strip?.scrollTo({ left: strip.scrollWidth, behavior: "smooth" }), 50)}
        />
      )}
      {openIssue && (
        <Modal onClose={() => setOpenIssue(null)} width={720}>
          <ModalHeader
            title={`${providerName(openIssue.repo)} ${
              !openIssue.isPullRequest ? "issue" : isGitlab(openIssue.repo) ? "merge request" : "pull request"
            }`}
            subtitle={`View only. Edit it on ${providerName(openIssue.repo)}.`}
            onClose={() => setOpenIssue(null)}
          />
          <div className="form">
            <IssuePanel issue={openIssue} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function ViewColumn({
  boardId,
  column,
  cards,
  total,
  filtering,
  onOpen,
  onEdit,
}: {
  boardId: string;
  column: Column;
  cards: GhIssue[];
  total: number;
  filtering: boolean;
  onOpen: (i: GhIssue) => void;
  onEdit: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: "column" },
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    "--c": colorHex(column.color),
  } as React.CSSProperties;
  const count = `${filtering && cards.length !== total ? `${cards.length}/` : ""}${total}`;
  const rules = querySource(column)?.rules;

  if (column.collapsed) {
    const expand = () => setColumnCollapsed(boardId, column.id, false);
    return (
      <div
        ref={setNodeRef}
        className={cx("column", "collapsed", isDragging && "dragging")}
        style={style}
        title={`${column.name}: ${total} card${total === 1 ? "" : "s"}. Double-click to expand.`}
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
        <span className="column-count">{count}</span>
        <span className="column-name column-collapsed-name">{column.name}</span>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} className={cx("column", isDragging && "dragging")} style={style}>
      <div className="column-head" {...attributes} {...listeners}>
        <span className="column-dot" />
        <span className="column-name" title={rules ? describeRules(rules) : undefined}>
          {column.name}
        </span>
        <span className="column-count">{count}</span>
        <span className="spacer" />
        <span onPointerDown={(e) => e.stopPropagation()}>
          <Menu
            align="right"
            trigger={(t) => (
              <button className="icon-btn tiny" {...t}>
                <MoreHorizontal size={15} />
              </button>
            )}
            items={[
              { label: "Edit column…", icon: <Pencil size={14} />, onClick: onEdit },
              {
                label: "Collapse",
                icon: <ChevronsRightLeft size={14} />,
                onClick: () => setColumnCollapsed(boardId, column.id, true),
              },
              "divider",
              {
                label: "Delete column",
                icon: <Trash2 size={14} />,
                danger: true,
                onClick: async () => {
                  const ok = await confirm({
                    title: `Delete “${column.name}”?`,
                    message: "Only the column is removed. Its issues stay as they are.",
                    confirmLabel: "Delete column",
                    danger: true,
                  });
                  if (ok) deleteColumn(boardId, column.id, null);
                },
              },
            ]}
          />
        </span>
      </div>
      <div className="column-body">
        {cards.map((i) => (
          <IssueCard key={cardKey(i)} issue={i} onOpen={() => onOpen(i)} />
        ))}
        {total === 0 && <div className="column-empty static">Nothing matches this column's rules</div>}
      </div>
    </div>
  );
}

/** Creates or edits a column; nothing changes until Save. */
function ColumnDialog({
  board,
  column,
  repos,
  onClose,
}: {
  board: Board;
  column: Column | null;
  repos: RepoRef[];
  onClose: () => void;
}) {
  const source = querySource(column ?? undefined);
  const [name, setName] = useState(column?.name ?? "");
  const [color, setColor] = useState<Color>(column?.color ?? "slate");
  const [rules, setRules] = useState<IssueRules>(source?.rules ?? emptyRules());
  const issues = useStore((s) => s.issues);
  const repoKeys = repos.map(repoKey);
  const matching = issuePool(issues, repoKeys).filter(
    (i) => matchesRules(i, board.viewRules ?? emptyRules()) && matchesRules(i, rules),
  ).length;
  const save = () => {
    if (!name.trim()) return;
    const next: QuerySource = { kind: "query", rules };
    if (column) updateColumn(board.id, column.id, { name: name.trim(), color, source: next });
    else addViewColumn(board.id, name, color, rules);
    onClose();
    refreshViewBoard(board.id);
  };
  return (
    <Modal onClose={onClose} width={640}>
      <ModalHeader
        title={column ? `Edit “${column.name}”` : "New column"}
        subtitle="Cards must pass the board's rules and these."
        onClose={onClose}
      />
      <div className="form">
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Needs review" />
        </label>
        <div className="field">
          <span>Color</span>
          <ColorPicker value={color} onChange={(c) => setColor(c)} />
        </div>
        <RulesEditor rules={rules} onChange={setRules} repos={repos} />
        <div className="modal-actions with-meta">
          <span className="muted small">
            {matching} card{matching === 1 ? "" : "s"} match so far
          </span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Edits what every card of the board must pass, and how cards are laid out; nothing changes until Save. */
function BoardRulesDialog({ board, repos, onClose }: { board: Board; repos: RepoRef[]; onClose: () => void }) {
  const [rules, setRules] = useState<IssueRules>(board.viewRules ?? emptyRules());
  const [sort, setSort] = useState<ViewSort>(board.viewSort ?? "updated");
  const [firstMatch, setFirstMatch] = useState(!!board.viewFirstMatch);
  const save = () => {
    patchBoard(board.id, ({ viewFirstMatch: _, ...b }) => ({
      ...b,
      viewRules: rules,
      viewSort: sort,
      ...(firstMatch ? { viewFirstMatch: true } : {}),
    }));
    onClose();
    refreshViewBoard(board.id);
  };
  return (
    <Modal onClose={onClose} width={640}>
      <ModalHeader title="Board rules" subtitle="Every card on this board must pass these." onClose={onClose} />
      <div className="form">
        <RulesEditor rules={rules} onChange={setRules} repos={repos} />
        <label className="field">
          <span>Sort cards by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as ViewSort)}>
            <option value="updated">Recently updated</option>
            <option value="created">Newest first</option>
            <option value="title">Title</option>
          </select>
        </label>
        <label className="rules-check">
          <input type="checkbox" checked={firstMatch} onChange={(e) => setFirstMatch(e.target.checked)} />
          Show each card only in the first column it matches
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

/** What the project's cached items offer as suggestions while typing rules. */
function useRuleOptions(repos: RepoRef[]) {
  const issues = useStore((s) => s.issues);
  return useMemo(() => {
    const unique = (list: string[]): TokenOption[] =>
      [...new Set(list)].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
    const caches = repos.map((r) => ({ key: repoKey(r), cache: issues.repos[repoKey(r)] }));
    // A label several projects share is offered once.
    const labels = (gitlab: boolean) => {
      const found = new Map<string, TokenOption>();
      for (const c of caches)
        if (isGitlab(c.key) === gitlab)
          for (const l of c.cache?.labels ?? [])
            if (!found.has(l.name.toLowerCase()))
              found.set(l.name.toLowerCase(), { name: l.name, label: l, repo: c.key });
      return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
    };
    const items = caches.flatMap((c) => [...(c.cache?.issues ?? []), ...(c.cache?.mergeRequests ?? [])]);
    return {
      github: labels(false),
      gitlab: labels(true),
      milestones: unique(caches.flatMap((c) => c.cache?.milestones?.map((m) => m.title) ?? [])),
      epics: unique(caches.flatMap((c) => c.cache?.epics?.map((e) => e.title) ?? [])),
      people: unique(items.flatMap((i) => i.assignees)),
      authors: unique(items.map((i) => i.author)),
    };
  }, [issues, repos]);
}

function RulesEditor({
  rules,
  onChange,
  repos,
}: {
  rules: IssueRules;
  onChange: (r: IssueRules) => void;
  repos: RepoRef[];
}) {
  const options = useRuleOptions(repos);
  const set = (patch: Partial<IssueRules>) => onChange({ ...rules, ...patch });
  const hasGitlab = repos.some((r) => r.provider === "gitlab");
  const hasGithub = repos.some((r) => r.provider !== "gitlab");
  const toggleRepo = (key: string) =>
    set({ repos: rules.repos.includes(key) ? rules.repos.filter((r) => r !== key) : [...rules.repos, key] });
  return (
    <div className="rules-editor">
      {repos.length > 1 && (
        <div className="field">
          <span>Repositories (none picked means all)</span>
          <div className="rules-repos">
            {repos.map((r) => {
              const key = repoKey(r);
              return (
                <button
                  key={key}
                  type="button"
                  className={cx("rules-repo", rules.repos.includes(key) && "active")}
                  onClick={() => toggleRepo(key)}
                >
                  {repoPath(key)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="rules-row">
        <div className="field">
          <span>Show</span>
          <Segmented
            value={rules.type}
            onChange={(type) => set({ type })}
            options={[
              ["issues", "Issues"],
              ["merge", mergeRequestsName(repos.map(repoKey))],
              ["both", "Both"],
            ]}
          />
        </div>
        <div className="field">
          <span>State</span>
          <Segmented
            value={rules.state}
            onChange={(state) => set({ state })}
            options={[
              ["open", "Open"],
              ["closed", "Closed"],
              ["all", "All"],
            ]}
          />
        </div>
      </div>
      {hasGitlab && (
        <LabelsField
          title="GitLab labels"
          rule={rules.gitlabLabels}
          options={options.gitlab}
          onChange={(gitlabLabels) => set({ gitlabLabels })}
        />
      )}
      {hasGithub && (
        <LabelsField
          title="GitHub labels"
          rule={rules.githubLabels}
          options={options.github}
          onChange={(githubLabels) => set({ githubLabels })}
        />
      )}
      {hasGitlab && hasGithub && (
        <p className="faint small">Labels picked for only one host show only that host's items.</p>
      )}
      <PresenceField
        title="Milestone"
        rule={rules.milestone}
        options={options.milestones}
        onChange={(milestone) => set({ milestone })}
      />
      {hasGitlab && (
        <PresenceField
          title="Epic (GitLab only)"
          rule={rules.epic}
          options={options.epics}
          onChange={(epic) => set({ epic })}
        />
      )}
      <div className="rules-row">
        <div className="field">
          <span>Assigned to any of</span>
          <TokenInput
            value={rules.assignees}
            options={options.people}
            placeholder="Anyone"
            onChange={(assignees) => set({ assignees })}
          />
        </div>
        <div className="field">
          <span>Written by any of</span>
          <TokenInput
            value={rules.authors}
            options={options.authors}
            placeholder="Anyone"
            onChange={(authors) => set({ authors })}
          />
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="segmented tiny">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={cx(value === v && "active")} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function LabelsField({
  title,
  rule,
  options,
  onChange,
}: {
  title: string;
  rule: LabelRule;
  options: TokenOption[];
  onChange: (r: LabelRule) => void;
}) {
  return (
    <div className="field">
      <span className="rules-field-head">
        {title}
        {rule.names.length > 1 && (
          <Segmented
            value={rule.match}
            onChange={(match) => onChange({ ...rule, match })}
            options={[
              ["any", "Any of"],
              ["all", "All of"],
            ]}
          />
        )}
      </span>
      <TokenInput
        strict
        value={rule.names}
        options={options}
        placeholder="Must carry…"
        emptyText={LABELS_EMPTY}
        onChange={(names) => onChange({ ...rule, names })}
      />
      <TokenInput
        strict
        value={rule.exclude}
        options={options}
        placeholder="Must not carry…"
        emptyText={LABELS_EMPTY}
        onChange={(exclude) => onChange({ ...rule, exclude })}
      />
    </div>
  );
}

function PresenceField({
  title,
  rule,
  options,
  onChange,
}: {
  title: string;
  rule: PresenceRule;
  options: TokenOption[];
  onChange: (r: PresenceRule) => void;
}) {
  return (
    <div className="field">
      <span className="rules-field-head">
        {title}
        <Segmented
          value={rule.mode}
          onChange={(mode) => onChange({ ...rule, mode })}
          options={[
            ["any", "Any"],
            ["has", "Has one"],
            ["none", "None"],
            ["is", "Is one of"],
          ]}
        />
      </span>
      {rule.mode === "is" && (
        <TokenInput
          value={rule.names}
          options={options}
          placeholder="Type a title and press Enter"
          onChange={(names) => onChange({ ...rule, names })}
        />
      )}
    </div>
  );
}

/** Something a rule can name; a label also says how to draw itself in the list. */
interface TokenOption {
  name: string;
  label?: GhLabel;
  repo?: string;
}

const LABELS_EMPTY = "No synced labels yet. Sync issues first.";
/** A big GitLab group has thousands of labels: the list shows this many until the search narrows it. */
const MAX_TOKEN_OPTIONS = 80;

/**
 * A list of names picked from a searchable list. With `strict` only the options can be picked; otherwise anything
 * typed is added on Enter or on leaving the field.
 */
function TokenInput({
  value,
  options,
  placeholder,
  onChange,
  strict = false,
  emptyText = "Nothing to suggest yet. Type a name and press Enter.",
}: {
  value: string[];
  options: TokenOption[];
  placeholder: string;
  onChange: (v: string[]) => void;
  strict?: boolean;
  emptyText?: string;
}) {
  // Without `strict`, Enter adds what was typed unless an option was reached with the arrows.
  const firstActive = strict ? 0 : -1;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(firstActive);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const lower = (s: string) => s.toLowerCase();
  const words = lower(text).split(/\s+/).filter(Boolean);
  const picked = new Set(value.map(lower));
  const matches = options.filter((o) => !picked.has(lower(o.name)) && words.every((w) => lower(o.name).includes(w)));
  const shown = matches.slice(0, MAX_TOKEN_OPTIONS);

  // Picking can wrap the field onto another line, which moves where the list belongs.
  useLayoutEffect(() => {
    setAnchor(open && boxRef.current ? boxRef.current.getBoundingClientRect() : null);
  }, [open, value.length]);
  useEffect(() => {
    listRef.current?.querySelector(".token-option.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // The list is placed once, so it can't follow the dialog scrolling beneath it.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  const pick = (name: string) => {
    if (!picked.has(lower(name))) onChange([...value, name]);
    setText("");
    setActive(firstActive);
  };
  const addTyped = () => {
    if (text.trim()) pick(text.trim());
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => Math.min(Math.max(strict ? 0 : -1, a + step), shown.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && shown[active]) pick(shown[active].name);
      else if (!strict) addTyped();
    } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };

  return (
    <div className="token-input" ref={boxRef} onClick={() => inputRef.current?.focus()}>
      {value.map((v) => (
        <span key={v} className="token">
          {v}
          <button type="button" title={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        spellCheck={false}
        autoComplete="off"
        value={text}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setActive(firstActive);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          if (strict) setText("");
          else addTyped();
        }}
        onKeyDown={onKeyDown}
      />
      {open && anchor && (
        <Popover anchor={anchor} onClose={close}>
          {/* Pressing the list, its scrollbar included, must leave the focus in the field. */}
          <div
            ref={listRef}
            className="token-menu"
            role="listbox"
            style={{ width: anchor.width }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {shown.map((o, i) => (
              <button
                key={o.name}
                type="button"
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                className={cx("token-option", i === active && "active")}
                onClick={() => pick(o.name)}
                onMouseMove={() => i !== active && setActive(i)}
              >
                {o.label ? <GhLabelChip label={o.label} source={o.repo} /> : o.name}
              </button>
            ))}
            {!shown.length && (
              <div className="faint small token-menu-note">
                {!options.length ? emptyText : strict ? `No synced label matches “${text.trim()}”` : "No matches"}
              </div>
            )}
            {matches.length > shown.length && (
              <div className="faint small token-menu-note">
                {matches.length - shown.length} more. Keep typing to narrow the list.
              </div>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
