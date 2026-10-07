import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ExternalLink,
  Kanban,
  Lightbulb,
  Link2,
  MoreHorizontal,
  Pencil,
  Search,
  StickyNote,
  Tags,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isViewColumn } from "../lib/labelColumns";
import {
  currentProject,
  deleteTag,
  linkedIssueIndex,
  orderedBoards,
  renameTag,
  setTagColor,
  setView,
  showOnBoard,
  toast,
  useStore,
} from "../lib/store";
import { decisionRef } from "../lib/decisions";
import { collectTags, decisionList, defaultTagColor, hasTag, tagKey, tagOrder } from "../lib/tags";
import type { Board, Decision, GhIssue, GhLabel, IssueRef, TagRef, Task } from "../lib/types";
import { colorHex, cx, issueKey, relativeTime } from "../lib/util";
import { ColorPicker } from "./ColorPicker";
import { TagSortMenu, useTagSort } from "./TagSortMenu";
import { PriorityIcon } from "./board/TaskCard";
import { TaskDialog } from "./board/TaskDialog";
import {
  EmptyState,
  GhLabelChip,
  Github,
  InlineEdit,
  IssuePanel,
  IssueStateIcon,
  Menu,
  Modal,
  ModalHeader,
  Popover,
  TagChip,
  confirm,
  useTagColor,
} from "./ui";

interface RepoLabel {
  repo: string;
  label: GhLabel;
  /** Cached issues carrying it, open and closed. */
  issues: GhIssue[];
}

const sameRef = (a: TagRef | undefined, b: TagRef) =>
  !!a &&
  a.kind === b.kind &&
  tagKey(a.name) === tagKey(b.name) &&
  (a.kind === "tag" || (b.kind === "label" && a.repo === b.repo));

/**
 * Every tag of the project's tasks and every label of its GitHub repositories, in two clearly
 * separate lists. Picking one lists everything carrying it: tasks across all boards for a tag,
 * cached issues (and the tasks they are linked to) for a GitHub label.
 */
export function TagsView({ selected }: { selected?: TagRef }) {
  const project = useStore((s) => currentProject(s)?.project);
  const boards = useStore(useShallow((s) => orderedBoards(s)));
  const decisionMap = useStore((s) => s.decisions);
  const decisions = useMemo(() => decisionList(decisionMap), [decisionMap]);
  const issues = useStore((s) => s.issues);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useTagSort();

  const tags = useMemo(() => collectTags(boards, decisions), [boards, decisions]);
  const labels = useMemo(() => {
    const out: RepoLabel[] = [];
    for (const r of project?.repos ?? []) {
      const key = `${r.owner}/${r.repo}`;
      const rc = issues.repos[key];
      if (!rc) continue;
      const byName = new Map<string, RepoLabel>();
      for (const l of rc.labels ?? []) byName.set(tagKey(l.name), { repo: key, label: l, issues: [] });
      for (const i of rc.issues)
        for (const l of i.labels) {
          const e = byName.get(tagKey(l.name)) ?? { repo: key, label: l, issues: [] };
          e.issues.push(i);
          byName.set(tagKey(l.name), e);
        }
      out.push(
        ...[...byName.values()].sort(
          (a, b) => b.issues.length - a.issues.length || a.label.name.localeCompare(b.label.name),
        ),
      );
    }
    return out;
  }, [project?.repos, issues]);

  if (!project) return null;
  const q = tagKey(query);
  const shownTags = tags
    .filter((t) => !q || tagKey(t.name).includes(q))
    .sort(
      tagOrder(
        sort,
        (t) => t.name,
        (t) => t.count,
      ),
    );
  // Labels stay grouped by repository; the order applies within each one.
  const repoOrder = new Map(project.repos.map((r, i) => [`${r.owner}/${r.repo}`, i]));
  const labelOrder = tagOrder<RepoLabel>(
    sort,
    (l) => l.label.name,
    (l) => l.issues.length,
  );
  const shownLabels = labels
    .filter((l) => !q || tagKey(l.label.name).includes(q))
    .sort((a, b) => (repoOrder.get(a.repo) ?? 0) - (repoOrder.get(b.repo) ?? 0) || labelOrder(a, b));
  const multiRepo = project.repos.length > 1;

  // Without a choice, open the most used tag (or label).
  const current: TagRef | undefined =
    selected ??
    (tags[0]
      ? { kind: "tag", name: tags[0].name }
      : labels[0]
        ? { kind: "label", repo: labels[0].repo, name: labels[0].label.name }
        : undefined);
  const currentLabel =
    current?.kind === "label"
      ? labels.find((l) => l.repo === current.repo && tagKey(l.label.name) === tagKey(current.name))
      : undefined;
  const select = (tag: TagRef) => setView({ kind: "tags", tag });

  return (
    <div className="tags-view">
      <div className="board-header">
        <div className="board-title">
          <span className="board-name">Tags</span>
          <span className="board-desc">
            Your tags on tasks and decisions
            {project.repos.length ? ", and the labels of the project's GitHub repositories" : ""}. Pick one to see
            everything carrying it.
          </span>
        </div>
      </div>

      <div className="tags-layout">
        <aside className="tags-list">
          <div className="search-row">
            <label className="search">
              <Search size={14} />
              <input placeholder="Find a tag or label" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <TagSortMenu sort={sort} onChange={setSort} />
          </div>
          <div className="tags-list-scroll">
            <div className="tags-list-head">
              <Tags size={13} /> Tags <span className="faint">{tags.length}</span>
            </div>
            {shownTags.map((t) => (
              <TagRow
                key={tagKey(t.name)}
                name={t.name}
                count={t.count}
                active={sameRef(current, { kind: "tag", name: t.name })}
                onClick={() => select({ kind: "tag", name: t.name })}
              />
            ))}
            {!tags.length && (
              <div className="faint small tags-list-note">No tags yet. Add some to tasks or decisions.</div>
            )}
            {!!tags.length && !shownTags.length && <div className="faint small tags-list-note">No matching tags</div>}

            {project.repos.length > 0 && (
              <>
                <div className="tags-list-head gh">
                  <Github size={13} /> GitHub labels <span className="faint">{labels.length}</span>
                </div>
                {shownLabels.map((l, i) => (
                  <div key={`${l.repo}|${l.label.name}`}>
                    {multiRepo && l.repo !== shownLabels[i - 1]?.repo && <div className="tags-list-repo">{l.repo}</div>}
                    <button
                      className={cx(
                        "tags-row",
                        sameRef(current, { kind: "label", repo: l.repo, name: l.label.name }) && "active",
                      )}
                      onClick={() => select({ kind: "label", repo: l.repo, name: l.label.name })}
                    >
                      <GhLabelChip label={l.label} />
                      <span className="spacer" />
                      <span className="tags-row-count" title="Cached issues and pull requests with this label">
                        {l.issues.length}
                      </span>
                    </button>
                  </div>
                ))}
                {!labels.length && (
                  <div className="faint small tags-list-note">Labels appear after the issues are synced.</div>
                )}
                {!!labels.length && !shownLabels.length && (
                  <div className="faint small tags-list-note">No matching labels</div>
                )}
              </>
            )}
          </div>
        </aside>

        <section className="tags-detail">
          {current?.kind === "tag" ? (
            <TagDetail
              key={tagKey(current.name)}
              name={tags.find((t) => tagKey(t.name) === tagKey(current.name))?.name ?? current.name}
              boards={boards}
              decisions={decisions}
              sameLabels={labels.filter((l) => tagKey(l.label.name) === tagKey(current.name))}
            />
          ) : currentLabel ? (
            <LabelDetail
              key={`${currentLabel.repo}|${currentLabel.label.name}`}
              entry={currentLabel}
              sameTag={tags.find((t) => tagKey(t.name) === tagKey(currentLabel.label.name))?.name}
            />
          ) : current?.kind === "label" ? (
            <EmptyState icon={<Github size={28} />} title={`“${current.name}” isn't a label of ${current.repo}`}>
              <p className="muted">It may have been deleted on GitHub, or the issues haven't been synced yet.</p>
            </EmptyState>
          ) : (
            <EmptyState icon={<Tags size={28} />} title="No tags yet">
              <p className="muted">
                Open a task and type in its Tags field. Tags you add show up here, with their color and every task
                carrying them.
              </p>
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

function TagRow({
  name,
  count,
  active,
  onClick,
}: {
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const color = useTagColor(name);
  return (
    <button className={cx("tags-row", active && "active")} onClick={onClick}>
      <span className="tags-row-dot" style={{ background: color }} />
      <span className="tags-row-name">{name}</span>
      <span className="spacer" />
      <span className="tags-row-count">{count}</span>
    </button>
  );
}

/** Where each task carrying a tag is, board by board in sidebar order. */
function tasksWith(boards: Board[], has: (t: Task) => boolean) {
  return boards
    .map((b) => ({
      board: b,
      rows: b.columns
        .filter((c) => !isViewColumn(c))
        .flatMap((c) =>
          c.taskIds.filter((id) => b.tasks[id] && has(b.tasks[id])).map((id) => ({ task: b.tasks[id], column: c })),
        ),
    }))
    .filter((g) => g.rows.length);
}

/** "3 tasks, 1 note and 2 decisions", leaving out what is zero (but never saying nothing). */
function itemCount(c: { tasks: number; decisions: number; notes: number }) {
  const parts = [];
  if (c.tasks || (!c.decisions && !c.notes)) parts.push(`${c.tasks} task${c.tasks === 1 ? "" : "s"}`);
  if (c.notes) parts.push(`${c.notes} note${c.notes === 1 ? "" : "s"}`);
  if (c.decisions) parts.push(`${c.decisions} decision${c.decisions === 1 ? "" : "s"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}

function TagDetail({
  name,
  boards,
  decisions,
  sameLabels,
}: {
  name: string;
  boards: Board[];
  decisions: Decision[];
  sameLabels: RepoLabel[];
}) {
  const picked = useStore((s) => currentProject(s)?.project.tagColors[tagKey(name)]);
  const color = useTagColor(name);
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [open, setOpen] = useState<{ boardId: string; taskId: string } | null>(null);
  const groups = useMemo(() => tasksWith(boards, (t) => hasTag(t, name)), [boards, name]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const tagged = useMemo(
    () => decisions.filter((d) => d.tags.some((t) => tagKey(t) === tagKey(name))).sort((a, b) => b.number - a.number),
    [decisions, name],
  );
  const noteGroups = useMemo(
    () =>
      boards
        .map((b) => ({
          board: b,
          notes: (b.notes ?? []).filter((n) => n.tags.some((t) => tagKey(t) === tagKey(name))),
        }))
        .filter((g) => g.notes.length),
    [boards, name],
  );
  const noteTotal = noteGroups.reduce((n, g) => n + g.notes.length, 0);
  const counts = { tasks: total, decisions: tagged.length, notes: noteTotal };

  const rename = (to: string) => {
    const n = renameTag(name, to);
    toast(
      `Renamed tag “${name}” to “${to}”${n.tasks || n.decisions || n.notes ? ` on ${itemCount(n)}` : ""}`,
      "success",
    );
    setView({ kind: "tags", tag: { kind: "tag", name: to } });
  };

  return (
    <div className="tags-detail-inner">
      <div className="tags-detail-head">
        <button
          className="tags-color-btn"
          style={{ background: color }}
          title="Change color"
          onClick={(e) => setColorAnchor(e.currentTarget.getBoundingClientRect())}
        />
        <div className="tags-detail-title">
          <InlineEdit
            value={name}
            onSave={rename}
            editing={renaming}
            onEditingChange={setRenaming}
            className="tags-detail-name"
          />
          <div className="faint small">
            Tag · {itemCount(counts)}
            {groups.length > 1 ? ` (tasks on ${groups.length} boards)` : ""}
          </div>
        </div>
        <span className="spacer" />
        <Menu
          align="right"
          trigger={(t) => (
            <button className="icon-btn" {...t}>
              <MoreHorizontal size={16} />
            </button>
          )}
          items={[
            { label: "Rename", icon: <Pencil size={14} />, onClick: () => setRenaming(true) },
            "divider",
            {
              label: tagged.length || noteTotal ? "Remove from everything" : "Remove from all tasks",
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: async () => {
                const ok = await confirm({
                  title: `Remove the tag “${name}”?`,
                  message: `It will be taken off ${itemCount(counts)}. You can undo this from Activity.`,
                  confirmLabel: "Remove tag",
                  danger: true,
                });
                if (!ok) return;
                deleteTag(name);
                setView({ kind: "tags" });
              },
            },
          ]}
        />
      </div>

      {sameLabels.length > 0 && (
        <div className="tags-hint">
          <Github size={13} />
          <span>GitHub also has a label with this name. It is separate from the tag:</span>
          {sameLabels.map((l) => (
            <GhLabelChip key={l.repo} label={l.label} repo={l.repo} />
          ))}
        </div>
      )}

      {tagged.length > 0 && (
        <div className="tags-group">
          <button className="tags-group-head" onClick={() => setView({ kind: "decisions" })}>
            <Lightbulb size={14} /> Decisions <span className="faint">{tagged.length}</span>
          </button>
          {tagged.map((d) => (
            <div
              key={d.id}
              className={cx("tags-task", d.replacedBy != null && "replaced")}
              onClick={() => setView({ kind: "decisions", decisionId: d.id })}
            >
              <span className="decision-ref">{decisionRef(d)}</span>
              <div className="tags-task-text">
                <div className="tags-task-title">{d.title}</div>
                <div className="faint small tags-task-line">{d.why.split("\n").find((l) => l.trim())}</div>
              </div>
              {d.replacedBy != null && <span className="decision-badge">Replaced by D-{d.replacedBy}</span>}
            </div>
          ))}
        </div>
      )}

      {noteGroups.map((g) => (
        <div key={g.board.id} className="tags-group">
          <button className="tags-group-head" onClick={() => setView({ kind: "board", boardId: g.board.id })}>
            <StickyNote size={14} /> {g.board.name} <span className="faint">{g.notes.length}</span>
          </button>
          {g.notes.map((n) => (
            <div
              key={n.id}
              className="tags-task"
              onClick={() => setView({ kind: "board", boardId: g.board.id, noteId: n.id })}
            >
              <StickyNote size={14} className="faint" />
              <div className="tags-task-text">
                <div className="tags-task-title">{n.title.trim() || "Untitled note"}</div>
                {n.description.trim() && (
                  <div className="faint small tags-task-line">{n.description.split("\n").find((l) => l.trim())}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      {total === 0 && tagged.length === 0 && noteTotal === 0 ? (
        <div className="faint pad center">Nothing carries this tag any more.</div>
      ) : (
        groups.map((g) => (
          <div key={g.board.id} className="tags-group">
            <button className="tags-group-head" onClick={() => setView({ kind: "board", boardId: g.board.id })}>
              <Kanban size={14} /> {g.board.name} <span className="faint">{g.rows.length}</span>
            </button>
            {g.rows.map(({ task, column }) => (
              <TaskRow
                key={task.id}
                task={task}
                columnName={column.name}
                columnColor={colorHex(column.color)}
                hideTag={name}
                onOpen={() => setOpen({ boardId: g.board.id, taskId: task.id })}
                onShow={() => showOnBoard(g.board.id, [task.id])}
              />
            ))}
          </div>
        ))
      )}

      {colorAnchor && (
        <Popover anchor={colorAnchor} onClose={() => setColorAnchor(null)}>
          <div className="popover-pad tag-menu">
            <ColorPicker
              value={picked ?? defaultTagColor(name)}
              onChange={(c, done) => {
                setTagColor(name, c);
                if (done) setColorAnchor(null);
              }}
            />
            {picked && (
              <button className="btn ghost small full" onClick={() => setTagColor(name, null)}>
                Reset to the automatic color
              </button>
            )}
          </div>
        </Popover>
      )}
      {open && <TaskDialog boardId={open.boardId} taskId={open.taskId} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TaskRow({
  task,
  columnName,
  columnColor,
  hideTag,
  onOpen,
  onShow,
}: {
  task: Task;
  columnName: string;
  columnColor: string;
  hideTag?: string;
  onOpen: () => void;
  onShow: () => void;
}) {
  const issue = useStore((s) =>
    task.issue ? s.issues.repos[task.issue.repo]?.issues.find((i) => i.number === task.issue!.number) : undefined,
  );
  const others = task.labels.filter((l) => !hideTag || tagKey(l) !== tagKey(hideTag));
  return (
    <div className="tags-task" onClick={onOpen}>
      {task.priority !== "none" ? <PriorityIcon priority={task.priority} /> : <span className="tags-task-noprio" />}
      <div className="tags-task-text">
        <div className="tags-task-title">{task.title}</div>
        {(others.length > 0 || task.issue) && (
          <div className="task-labels">
            {others.map((l) => (
              <TagChip key={l} tag={l} />
            ))}
            {task.issue && (
              <span className={cx("task-issue", issue?.state)}>
                {issue ? <IssueStateIcon issue={issue} size={12} /> : <Github size={12} />}
                {task.issue.repo.split("/")[1]}#{task.issue.number}
              </span>
            )}
          </div>
        )}
      </div>
      <span className="column-pill" style={{ "--c": columnColor } as React.CSSProperties}>
        {columnName}
      </span>
      <button
        className="icon-btn small"
        title="Show on the board"
        onClick={(e) => {
          e.stopPropagation();
          onShow();
        }}
      >
        <Kanban size={14} />
      </button>
    </div>
  );
}

function LabelDetail({ entry, sameTag }: { entry: RepoLabel; sameTag?: string }) {
  const boardsMap = useStore((s) => s.boards);
  const links = useMemo(() => linkedIssueIndex(boardsMap), [boardsMap]);
  const [closed, setClosed] = useState(false);
  const [openIssue, setOpenIssue] = useState<IssueRef | null>(null);
  const [openTask, setOpenTask] = useState<{ boardId: string; taskId: string } | null>(null);
  const { label, repo } = entry;
  const openCount = entry.issues.filter((i) => i.state === "open").length;
  const shown = entry.issues
    .filter((i) => closed || i.state === "open")
    .sort((a, b) => (a.state === b.state ? b.updatedAt.localeCompare(a.updatedAt) : a.state === "open" ? -1 : 1));
  const issue = openIssue && entry.issues.find((i) => i.repo === openIssue.repo && i.number === openIssue.number);

  return (
    <div className="tags-detail-inner">
      <div className="tags-detail-head">
        <span
          className="tags-color-btn static"
          style={{ background: `#${label.color}` }}
          title="Colors of GitHub labels are set on GitHub"
        />
        <div className="tags-detail-title">
          <div className="tags-detail-name">{label.name}</div>
          <div className="faint small">
            <Github size={11} /> GitHub label of {repo} · {openCount} open, {entry.issues.length - openCount} closed
            {label.description ? ` · ${label.description}` : ""}
          </div>
        </div>
        <span className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
          <span>Closed</span>
        </label>
        <button
          className="btn small"
          onClick={() => openUrl(`https://github.com/${repo}/labels/${encodeURIComponent(label.name)}`)}
        >
          <ExternalLink size={13} /> GitHub
        </button>
      </div>

      {sameTag && (
        <div className="tags-hint">
          <Tags size={13} />
          <span>Your tasks also use a tag with this name. It is separate from the GitHub label:</span>
          <TagChip tag={sameTag} />
        </div>
      )}

      {shown.length === 0 ? (
        <div className="faint pad center">No {closed ? "" : "open "}issues carry this label.</div>
      ) : (
        <div className="tags-group">
          {shown.map((i) => {
            const linked = links.get(issueKey(i));
            return (
              <div
                key={issueKey(i)}
                className="tags-task"
                onClick={() =>
                  linked
                    ? setOpenTask({ boardId: linked[0].boardId, taskId: linked[0].taskId })
                    : setOpenIssue({ repo: i.repo, number: i.number })
                }
              >
                <IssueStateIcon issue={i} size={15} />
                <div className="tags-task-text">
                  <div className="tags-task-title">
                    {i.title} <span className="faint">#{i.number}</span>
                  </div>
                  <div className="faint small">
                    {i.author} · updated {relativeTime(i.updatedAt)}
                    {i.assignees.length > 0 && <> · @{i.assignees.join(", @")}</>}
                  </div>
                </div>
                {linked && (
                  <span
                    className="linked-pill"
                    title={linked.map((l) => `${l.boardName} › ${l.columnName}`).join("\n")}
                  >
                    <Link2 size={12} /> {linked[0].boardName} › {linked[0].columnName}
                  </span>
                )}
                <button
                  className="icon-btn small"
                  title="Open on GitHub"
                  onClick={(e) => {
                    e.stopPropagation();
                    openUrl(i.url);
                  }}
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {issue && (
        <Modal onClose={() => setOpenIssue(null)} width={720}>
          <ModalHeader
            title="GitHub issue"
            subtitle="Not on a board yet. Add it from the Issues view, or edit it on GitHub."
            onClose={() => setOpenIssue(null)}
          />
          <div className="form">
            <IssuePanel issue={issue} />
          </div>
        </Modal>
      )}
      {openTask && <TaskDialog boardId={openTask.boardId} taskId={openTask.taskId} onClose={() => setOpenTask(null)} />}
    </div>
  );
}
