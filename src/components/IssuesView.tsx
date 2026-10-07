import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ChevronDown, CircleDot, ExternalLink, MessageSquare, Plus, RefreshCw, Search, X } from "lucide-react";
import { type InputHTMLAttributes, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isKanban } from "../lib/notes";
import {
  addIssueTasks,
  currentProject,
  linkedIssueIndex,
  orderedBoards,
  setView,
  syncIssues,
  toast,
  useStore,
} from "../lib/store";
import { isViewColumn } from "../lib/labelColumns";
import type { GhIssue } from "../lib/types";
import { cx, relativeTime } from "../lib/util";
import { EmptyState, GhLabelChip, IssueStateIcon, Markdown, Popover } from "./ui";

type StateFilter = "open" | "closed" | "all";

export function IssuesView() {
  const project = useStore((s) => currentProject(s));
  const issues = useStore((s) => s.issues);
  const boardsMap = useStore((s) => s.boards);
  const boards = useStore(useShallow((s) => orderedBoards(s)));
  const syncing = useStore((s) => s.syncing);
  const [state, setState] = useState<StateFilter>("open");
  const [repo, setRepo] = useState("all");
  const [query, setQuery] = useState("");
  const [prs, setPrs] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<{ issues: GhIssue[]; anchor: DOMRect } | null>(null);
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);

  const links = useMemo(() => linkedIssueIndex(boardsMap), [boardsMap]);
  const all = useMemo(() => Object.values(issues.repos).flatMap((r) => r.issues), [issues]);
  const repoKeys = Object.keys(issues.repos);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return all
      .filter((i) => prs || !i.isPullRequest)
      .filter((i) => state === "all" || i.state === state)
      .filter((i) => repo === "all" || i.repo === repo)
      .filter(
        (i) =>
          !q ||
          i.title.toLowerCase().includes(q) ||
          String(i.number) === q ||
          i.labels.some((l) => l.name.toLowerCase().includes(q)) ||
          i.author.toLowerCase().includes(q),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [all, prs, state, repo, query]);

  // Issues already on a board can't be added again, so they're not selectable.
  const selectable = useMemo(() => filtered.filter((i) => !links.has(issueKey(i))), [filtered, links]);
  const selectedIssues = useMemo(() => selectable.filter((i) => selected.has(issueKey(i))), [selectable, selected]);

  // A selection only makes sense for the list it was made in.
  useEffect(() => {
    setSelected(new Set());
    setRangeAnchor(null);
  }, [state, repo, query, prs]);

  const toggle = (i: GhIssue, shift: boolean) => {
    const key = issueKey(i);
    const on = !selected.has(key);
    const next = new Set(selected);
    const from = shift && rangeAnchor ? filtered.findIndex((x) => issueKey(x) === rangeAnchor) : -1;
    const to = filtered.indexOf(i);
    if (from >= 0) {
      for (const x of filtered.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (links.has(issueKey(x))) continue;
        if (on) next.add(issueKey(x));
        else next.delete(issueKey(x));
      }
    } else if (on) next.add(key);
    else next.delete(key);
    setSelected(next);
    setRangeAnchor(key);
  };

  const allSelected = selectable.length > 0 && selectedIssues.length === selectable.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map(issueKey)));

  const counts = useMemo(() => {
    const base = all.filter((i) => (prs || !i.isPullRequest) && (repo === "all" || i.repo === repo));
    return {
      open: base.filter((i) => i.state === "open").length,
      closed: base.filter((i) => i.state === "closed").length,
    };
  }, [all, prs, repo]);

  if (!project) return null;
  const errors = Object.entries(issues.repos).filter(([, r]) => r.error);

  return (
    <div className="issues-view">
      <div className="board-header">
        <div className="board-title">
          <span className="board-name">GitHub issues</span>
          <span className="board-desc">
            Read-only mirror of {project.project.repos.length} repo(s). Add issues to a board to track them as tasks.
          </span>
        </div>
        <div className="board-tools">
          <button className="btn" onClick={() => syncIssues()} disabled={syncing}>
            <RefreshCw size={15} className={cx(syncing && "spin")} /> {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      <div className="issues-filters">
        <div className="segmented">
          <button className={cx(state === "open" && "active")} onClick={() => setState("open")}>
            <CircleDot size={14} /> {counts.open} Open
          </button>
          <button className={cx(state === "closed" && "active")} onClick={() => setState("closed")}>
            <Check size={14} /> {counts.closed} Closed
          </button>
          <button className={cx(state === "all" && "active")} onClick={() => setState("all")}>
            All
          </button>
        </div>
        {repoKeys.length > 1 && (
          <select value={repo} onChange={(e) => setRepo(e.target.value)}>
            <option value="all">All repositories</option>
            {repoKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
        <label className="toggle">
          <input type="checkbox" checked={prs} onChange={(e) => setPrs(e.target.checked)} />
          <span>Pull requests</span>
        </label>
        <span className="spacer" />
        <label className="search">
          <Search size={15} />
          <input
            placeholder="Search title, #, label, author"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {errors.length > 0 && (
        <div className="banner error">
          {errors.map(([k, r]) => (
            <div key={k}>
              <strong>{k}</strong>: {r.error}
            </div>
          ))}
        </div>
      )}

      <div className="issues-list">
        {filtered.length > 0 && (
          <div className="issues-bulk">
            <label className="toggle">
              <Checkbox
                checked={allSelected}
                indeterminate={selectedIssues.length > 0 && !allSelected}
                disabled={selectable.length === 0}
                onChange={toggleAll}
              />
              <span>
                {selectedIssues.length > 0
                  ? `${selectedIssues.length.toLocaleString()} of ${selectable.length.toLocaleString()} selected`
                  : `Select all ${selectable.length.toLocaleString()} matching`}
              </span>
            </label>
            {selectedIssues.length > 0 && (
              <>
                <button
                  className="btn small primary"
                  disabled={boards.length === 0}
                  onClick={(e) =>
                    setAddFor({ issues: selectedIssues, anchor: e.currentTarget.getBoundingClientRect() })
                  }
                >
                  <Plus size={13} /> Add {selectedIssues.length.toLocaleString()} to board <ChevronDown size={12} />
                </button>
                <button className="btn small ghost" onClick={() => setSelected(new Set())}>
                  <X size={13} /> Clear
                </button>
              </>
            )}
            <span className="spacer" />
            <span className="faint small">Shift-click to select a range</span>
          </div>
        )}
        {all.length === 0 ? (
          <EmptyState icon={<CircleDot size={28} />} title={syncing ? "Fetching issues…" : "No issues cached yet"}>
            {!syncing && (
              <button className="btn primary" onClick={() => syncIssues()}>
                <RefreshCw size={15} /> Sync from GitHub
              </button>
            )}
          </EmptyState>
        ) : filtered.length === 0 ? (
          <div className="faint pad center">No issues match these filters.</div>
        ) : (
          filtered.slice(0, limit).map((i) => {
            const key = issueKey(i);
            const linkedOn = links.get(key);
            const open = expanded === key;
            return (
              <div key={key} className={cx("issue-row", open && "expanded", selected.has(key) && "selected")}>
                <div className="issue-row-main" onClick={() => setExpanded(open ? null : key)}>
                  <span className="issue-row-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={!linkedOn && selected.has(key)}
                      disabled={!!linkedOn}
                      title={linkedOn ? "Already on a board" : undefined}
                      onChange={(e) => toggle(i, (e.nativeEvent as MouseEvent).shiftKey)}
                    />
                  </span>
                  <IssueStateIcon issue={i} size={16} />
                  <div className="issue-row-text">
                    <div className="issue-row-title">
                      <span>{i.title}</span>
                      {i.labels.map((l) => (
                        <GhLabelChip key={l.name} label={l} repo={i.repo} />
                      ))}
                    </div>
                    <div className="issue-row-sub faint small">
                      {repoKeys.length > 1 && <span>{i.repo} </span>}#{i.number} · {i.author} · updated{" "}
                      {relativeTime(i.updatedAt)}
                      {i.milestone && <> · {i.milestone}</>}
                    </div>
                  </div>
                  <div className="issue-row-side" onClick={(e) => e.stopPropagation()}>
                    {i.comments > 0 && (
                      <span className="faint small comments">
                        <MessageSquare size={13} /> {i.comments}
                      </span>
                    )}
                    {i.assignees.length > 0 && <span className="faint small">@{i.assignees[0]}</span>}
                    {linkedOn ? (
                      <button
                        className="linked-pill"
                        title={linkedOn.map((l) => `${l.boardName} › ${l.columnName}`).join("\n")}
                        onClick={() => setView({ kind: "board", boardId: linkedOn[0].boardId })}
                      >
                        <Check size={12} /> {linkedOn[0].boardName} › {linkedOn[0].columnName}
                      </button>
                    ) : (
                      <button
                        className="btn small"
                        disabled={boards.length === 0}
                        onClick={(e) => setAddFor({ issues: [i], anchor: e.currentTarget.getBoundingClientRect() })}
                      >
                        <Plus size={13} /> Add to board <ChevronDown size={12} />
                      </button>
                    )}
                    <button className="icon-btn small" title="Open on GitHub" onClick={() => openUrl(i.url)}>
                      <ExternalLink size={14} />
                    </button>
                  </div>
                </div>
                {open && (
                  <div className="issue-row-body">
                    {i.body ? <Markdown>{i.body}</Markdown> : <p className="faint small">No description provided.</p>}
                  </div>
                )}
              </div>
            );
          })
        )}
        {filtered.length > limit && (
          <button className="btn ghost full" onClick={() => setLimit(limit + 100)}>
            Show more ({filtered.length - limit} remaining)
          </button>
        )}
      </div>

      {addFor && (
        <Popover anchor={addFor.anchor} align="right" onClose={() => setAddFor(null)}>
          <div className="menu add-to-board">
            {boards.filter(isKanban).map((b) => (
              <div key={b.id}>
                <div className="menu-heading">{b.name}</div>
                {b.columns
                  .filter((c) => !isViewColumn(c))
                  .map((c) => (
                    <button
                      key={c.id}
                      className="menu-item"
                      onClick={() => {
                        const { issues: picked } = addFor;
                        const added = addIssueTasks(b.id, c.id, picked);
                        const what = picked.length === 1 ? `#${picked[0].number}` : `${added.toLocaleString()} issues`;
                        const skipped = picked.length - added;
                        toast(
                          `Added ${what} to ${b.name} › ${c.name}${skipped > 0 && picked.length > 1 ? ` (${skipped} already there)` : ""}`,
                          "success",
                        );
                        setAddFor(null);
                        setSelected(new Set());
                      }}
                    >
                      <span>{c.name}</span>
                      <span className="faint small">{c.taskIds.length}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

function issueKey(i: GhIssue) {
  return `${i.repo}#${i.number}`;
}

function Checkbox({ indeterminate, ...props }: InputHTMLAttributes<HTMLInputElement> & { indeterminate: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" {...props} />;
}
