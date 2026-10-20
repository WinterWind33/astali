import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  Globe,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  closeConflicts,
  createBranch,
  gitCommit,
  gitPull,
  gitPush,
  listBranches,
  quickSync,
  resolveConflicts,
  showConflicts,
  switchBranch,
  useStore,
  vaultTracked,
} from "../lib/store";
import type { ChangedFile, GitBranches, RepoInfo } from "../lib/types";
import { cx } from "../lib/util";
import { Modal, ModalHeader } from "./ui";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const FILE_STATUS: Record<ChangedFile["status"], string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  U: "Untracked",
  C: "In conflict",
};

// An untracked folder comes as "dir/": keep its slash on the name.
const baseName = (p: string) => p.replace(/\/$/, "").split("/").pop() + (p.endsWith("/") ? "/" : "");
const dirName = (p: string) => p.replace(/\/$/, "").split("/").slice(0, -1).join("/");

function upstreamLine(r: RepoInfo): string {
  if (!r.branch) return `Detached at ${r.commit ?? "?"}: switch to a branch to commit and sync`;
  if (!r.upstream) return "Not published yet: Push or Sync publishes it";
  const sync = [r.ahead && `${plural(r.ahead, "commit")} to push`, r.behind && `${plural(r.behind, "commit")} to pull`]
    .filter(Boolean)
    .join(", ");
  return `${r.upstream}: ${sync || "up to date"}`;
}

/** The title bar's git panel: sync, pull, push, commit and branches of the vault's repository. */
export function GitPanel({ repo }: { repo: RepoInfo }) {
  const busy = useStore((s) => s.gitBusy);
  const tracked = useStore(vaultTracked);
  const autoSync = useStore((s) => (s.vault ? s.config.gitAutoSync[s.vault] : 0));
  const [message, setMessage] = useState("");
  const [all, setAll] = useState(!tracked);
  const [branchesOpen, setBranchesOpen] = useState(false);
  // The backend sends at most this many files.
  const capped = repo.files.length >= 200;

  // A switch (or new branch) closes the list again.
  useEffect(() => setBranchesOpen(false), [repo.branch]);

  return (
    <div className="git-panel">
      <div className="git-panel-head">
        <button
          className={cx("git-panel-branch", branchesOpen && "open")}
          onClick={() => setBranchesOpen((o) => !o)}
          title="Switch or create a branch"
          aria-expanded={branchesOpen}
        >
          <GitBranch size={15} />
          <strong>{repo.branch ?? repo.commit ?? "HEAD"}</strong>
          <ChevronDown size={14} className="git-panel-chevron" />
        </button>
        {busy && (
          <span className="git-panel-busy faint small">
            <Loader2 size={13} className="spin" /> {busy}
          </span>
        )}
      </div>
      {branchesOpen && <BranchPicker current={repo.branch} disabled={!!busy || repo.conflicted > 0} />}
      <p className="faint small git-panel-sub">{upstreamLine(repo)}</p>

      {repo.conflicted > 0 && (
        <div className="git-panel-conflict">
          <TriangleAlert size={15} />
          <span>{plural(repo.conflicted, "file")} in conflict</span>
          <button className="btn small" disabled={!!busy} onClick={showConflicts}>
            Settle…
          </button>
        </div>
      )}

      <div className="git-panel-actions">
        <button
          className="btn primary small"
          disabled={!!busy || !repo.branch || repo.conflicted > 0}
          onClick={() => quickSync()}
          title={
            tracked
              ? "Commit the vault's files, pull, then push"
              : "Pull, then push. The vault's files are git-ignored, so there is nothing of Astali's to commit."
          }
        >
          <RefreshCw size={13} /> Sync
        </button>
        <button
          className="btn small"
          disabled={!!busy || !repo.upstream || repo.conflicted > 0}
          onClick={gitPull}
          title="Merge the commits of the upstream branch"
        >
          <ArrowDownToLine size={13} /> Pull
        </button>
        <button
          className="btn small"
          disabled={!!busy || !repo.branch || repo.conflicted > 0}
          onClick={gitPush}
          title={repo.upstream ? `Push to ${repo.upstream}` : "Publish the branch to the remote"}
        >
          <ArrowUpToLine size={13} /> Push
        </button>
      </div>
      {tracked && (
        <p className="faint small git-panel-note">
          {autoSync
            ? `Syncs by itself every ${autoSync} changes. Change it in Settings → Git.`
            : "Automatic sync is off. Turn it on in Settings → Git."}
        </p>
      )}

      <div className="git-panel-section">
        <span className="git-panel-label">
          Changes{repo.files.length > 0 && ` (${repo.files.length}${capped ? "+" : ""})`}
        </span>
        {repo.files.length ? (
          <ul className="git-file-list">
            {repo.files.map((f) => (
              <li key={f.path} title={`${FILE_STATUS[f.status]}: ${f.path}`}>
                <span className={cx("git-file-status", `s-${f.status}`)}>{f.status}</span>
                <span className="git-file-name">{baseName(f.path)}</span>
                <span className="git-file-dir faint">{dirName(f.path)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="faint small">No uncommitted changes</span>
        )}
        {capped && <span className="faint small">…and more. Your git tool lists them all.</span>}
      </div>

      <div className="git-panel-section">
        <span className="git-panel-label">Commit</span>
        <textarea
          rows={2}
          value={message}
          placeholder="Commit message"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && message.trim())
              gitCommit(message, all).then((ok) => ok && setMessage(""));
          }}
        />
        <div className="row gap">
          {tracked ? (
            <label className="toggle" title="Off: only the vault's files. On: every change in the repository.">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
              Also commit changes outside the vault
            </label>
          ) : (
            <span className="faint small">Commits every change in the repository.</span>
          )}
          <span className="spacer" />
          <button
            className="btn small"
            disabled={!!busy || !message.trim() || repo.conflicted > 0}
            onClick={() => gitCommit(message, all).then((ok) => ok && setMessage(""))}
          >
            <GitCommitHorizontal size={13} /> Commit
          </button>
        </div>
      </div>
    </div>
  );
}

function BranchPicker({ current, disabled }: { current: string | null; disabled: boolean }) {
  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listBranches()
      .then(setBranches)
      .catch(() => setBranches({ local: [], remote: [] }));
  }, [current]);

  const q = filter.trim().toLowerCase();
  const match = (b: string) => b.toLowerCase().includes(q);
  const local = branches?.local.filter(match) ?? [];
  const remote = branches?.remote.filter(match) ?? [];
  const create = async () => {
    if (await createBranch(filter)) {
      setFilter("");
      setCreating(false);
    }
  };

  return (
    <div className="git-branch-drop">
      <div className="input-row">
        <input
          value={filter}
          autoFocus
          placeholder={creating ? "New branch name" : "Find a branch"}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && creating && filter.trim()) create();
          }}
        />
        {creating ? (
          <button className="btn small" disabled={disabled || !filter.trim()} onClick={create}>
            Create
          </button>
        ) : (
          <button
            className="btn small"
            disabled={disabled}
            onClick={() => setCreating(true)}
            title="Create a branch from the current commit and switch to it. Uncommitted changes come along."
          >
            <GitBranchPlus size={13} /> New
          </button>
        )}
      </div>
      {!creating && (
        <div className="git-branch-list">
          {!branches && <span className="faint small">Loading…</span>}
          {local.map((b) => (
            <button
              key={b}
              className={cx("git-branch", b === current && "current")}
              disabled={disabled || b === current}
              onClick={() => switchBranch(b)}
            >
              {b === current ? <Check size={13} /> : <GitBranch size={13} />}
              <span>{b}</span>
            </button>
          ))}
          {remote.map((b) => (
            <button
              key={b}
              className="git-branch"
              disabled={disabled}
              onClick={() => switchBranch(b, true)}
              title={`Check out ${b} as a local branch`}
            >
              <Globe size={13} />
              <span>{b}</span>
            </button>
          ))}
          {branches && !local.length && !remote.length && <span className="faint small">No branch matches</span>}
        </div>
      )}
      {creating && (
        <button className="btn ghost small" onClick={() => setCreating(false)}>
          Cancel
        </button>
      )}
    </div>
  );
}

/** Asks which side to keep after a pull stopped on conflicts. Closing it leaves the merge for later. */
export function GitConflictDialog() {
  const files = useStore((s) => s.gitConflicts);
  const busy = useStore((s) => s.gitBusy);
  if (!files) return null;
  const history = (f: string) => f.endsWith(".astali/history.jsonl");

  return (
    <Modal onClose={closeConflicts} width={560}>
      <ModalHeader
        title="The pull brought conflicts"
        subtitle="These files were changed both here and in the commits that came in. Pick which version to keep."
        onClose={closeConflicts}
      />
      <div className="form">
        {files.length ? (
          <ul className="git-conflict-files mono">
            {files.map((f) => (
              <li key={f}>
                {f}
                {history(f) && <span className="faint"> (both kept: it's Astali's change history)</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Astali couldn't list the files in conflict.</p>
        )}
        <p className="faint small">
          <strong>Keep incoming</strong> takes the pulled version of every file above, <strong>Keep mine</strong> the
          version you had. It applies to whole files, code included. <strong>Undo the pull</strong> puts everything back
          as it was before it. Close this to settle the conflicts in your own git tool instead.
        </p>
        <div className="modal-actions">
          <button className="btn ghost" disabled={!!busy} onClick={() => resolveConflicts("abort")}>
            <Undo2 size={15} /> Undo the pull
          </button>
          <span className="spacer" />
          <button className="btn" disabled={!!busy} onClick={() => resolveConflicts("local")}>
            Keep mine
          </button>
          <button className="btn primary" disabled={!!busy} autoFocus onClick={() => resolveConflicts("incoming")}>
            Keep incoming
          </button>
        </div>
      </div>
    </Modal>
  );
}
