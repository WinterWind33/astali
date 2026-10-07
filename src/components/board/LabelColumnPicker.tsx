import { RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { liveLabel } from "../../lib/labelColumns";
import { addLabelColumn, currentProject, syncIssues, useStore } from "../../lib/store";
import { cx, repoKey } from "../../lib/util";
import { GhLabelChip, Popover } from "../ui";

/** Picks a label of one of the project's repositories to add as a live label column. */
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
  const [query, setQuery] = useState("");

  // A label can back only one live column per board.
  const bound = new Set(
    columns.flatMap((c) => {
      const src = liveLabel(c);
      return src ? [`${src.repo}|${src.labelId}`] : [];
    }),
  );
  const q = query.trim().toLowerCase();
  const groups = repos.map((r) => {
    const key = repoKey(r);
    const rc = issues.repos[key];
    const labels = (rc?.labels ?? []).filter(
      (l) => l.id != null && (!q || l.name.toLowerCase().includes(q) || l.description?.toLowerCase().includes(q)),
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
                    const taken = bound.has(`${g.key}|${l.id}`);
                    return (
                      <button
                        key={l.id}
                        className={cx("issue-picker-item", taken && "disabled")}
                        disabled={taken}
                        title={taken ? "This label already has a column on this board" : l.description || undefined}
                        onClick={() => {
                          addLabelColumn(boardId, g.key, l);
                          onAdded();
                          onClose();
                        }}
                      >
                        <GhLabelChip label={l} />
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
                : "Add a GitHub repository in project settings to bind columns to its labels."}
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
