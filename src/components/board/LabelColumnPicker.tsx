import { RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { liveLabel } from "../../lib/labelColumns";
import { addLabelColumn, addViewColumn, currentProject, refreshViewBoard, syncIssues, useStore } from "../../lib/store";
import type { GhLabel } from "../../lib/types";
import { cx, repoKey } from "../../lib/util";
import { hasLabelColumn, isView, labelRules } from "../../lib/viewBoards";
import { GhLabelChip, Popover } from "../ui";

/**
 * Picks a label of one of the project's repositories to add as a column: a live label column, or on a view board a
 * column of rules, which match labels by name.
 */
export function LabelColumnPicker({
  boardId,
  anchor,
  onClose,
  onAdded,
}: {
  boardId: string;
  anchor: DOMRect;
  onClose: () => void;
  onAdded: () => void;
}) {
  const repos = useStore((s) => currentProject(s)?.project.repos ?? []);
  const issues = useStore((s) => s.issues);
  const syncing = useStore((s) => s.syncing);
  const columns = useStore((s) => s.boards[boardId]?.board.columns ?? []);
  const view = useStore((s) => isView(s.boards[boardId]?.board));
  const [query, setQuery] = useState("");

  // A label can back only one live column per board.
  const bound = new Set(
    columns.flatMap((c) => {
      const src = liveLabel(c);
      return src ? [`${src.repo}|${src.labelId}`] : [];
    }),
  );
  const isTaken = (repo: string, l: GhLabel) =>
    view ? hasLabelColumn(columns, repo, l.name) : bound.has(`${repo}|${l.id}`);
  const add = (repo: string, l: GhLabel) => {
    if (view) {
      addViewColumn(boardId, l.name, `#${l.color}`, labelRules(repo, l.name));
      refreshViewBoard(boardId);
    } else addLabelColumn(boardId, repo, l);
  };
  const q = query.trim().toLowerCase();
  const groups = repos.map((r) => {
    const key = repoKey(r);
    const rc = issues.repos[key];
    const labels = (rc?.labels ?? []).filter(
      (l) =>
        (view || l.id != null) && (!q || l.name.toLowerCase().includes(q) || l.description?.toLowerCase().includes(q)),
    );
    return { key, loaded: !!rc?.labels, error: rc?.error, labels };
  });
  const anyLoaded = groups.some((g) => g.loaded);

  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="issue-picker label-picker">
        {anyLoaded ? (
          <>
            <label className="search">
              <Search size={14} />
              <input autoFocus placeholder="Find a label" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="issue-picker-list">
              {groups.map((g) => (
                <div key={g.key}>
                  {repos.length > 1 && <div className="label-picker-repo">{g.key}</div>}
                  {!g.loaded && (
                    <div className="faint small label-picker-note">
                      {g.error ?? "Labels not loaded yet — sync issues"}
                    </div>
                  )}
                  {g.loaded && !g.labels.length && (
                    <div className="faint small label-picker-note">No matching labels</div>
                  )}
                  {g.labels.map((l) => {
                    const taken = isTaken(g.key, l);
                    return (
                      <button
                        key={l.id ?? l.name}
                        className={cx("issue-picker-item", taken && "disabled")}
                        disabled={taken}
                        title={taken ? "This label already has a column on this board" : l.description || undefined}
                        onClick={() => {
                          add(g.key, l);
                          onAdded();
                          onClose();
                        }}
                      >
                        <GhLabelChip label={l} source={g.key} />
                        <span className="issue-picker-title faint small">
                          {taken ? "Already on this board" : l.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="label-picker-empty">
            <p className="muted small">
              {repos.length
                ? "The repositories' labels haven't been loaded yet."
                : "Add a GitHub repository or GitLab project in project settings to bind columns to its labels."}
            </p>
            {repos.length > 0 && (
              <button className="btn small" disabled={syncing} onClick={() => syncIssues()}>
                <RefreshCw size={13} className={cx(syncing && "spin")} /> Sync issues
              </button>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}
