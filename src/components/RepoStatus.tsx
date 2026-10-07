import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  GitPullRequestDraft,
  Globe,
} from "lucide-react";
import { useStore } from "../lib/store";
import type { RepoInfo } from "../lib/types";
import { Github } from "./ui";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describe(r: RepoInfo): string {
  const lines = [r.branch ? `Branch: ${r.branch}` : `Detached HEAD at ${r.commit ?? "?"}`];
  if (r.branch && r.commit) lines.push(`Commit: ${r.commit}`);
  if (!r.commit) lines.push("No commits yet");
  if (r.upstream) {
    const sync =
      r.ahead || r.behind
        ? [r.ahead && `${plural(r.ahead, "commit")} to push`, r.behind && `${plural(r.behind, "commit")} to pull`]
            .filter(Boolean)
            .join(", ")
        : "up to date";
    lines.push(`Upstream: ${r.upstream} (${sync})`);
  } else if (r.branch) {
    lines.push("No upstream branch");
  }
  const changes = [
    r.conflicted && `${r.conflicted} conflicted`,
    r.staged && `${r.staged} staged`,
    r.modified && `${r.modified} modified`,
    r.untracked && `${r.untracked} untracked`,
  ].filter(Boolean);
  lines.push(changes.length ? `Changes: ${changes.join(", ")}` : "Working tree clean");
  return lines.join("\n");
}

/**
 * Title-bar group for the vault's repository: link to the remote, the branch's open pull request
 * (if any) and the branch state. Renders nothing outside a repo.
 */
export function RepoStatus() {
  const repo = useStore((s) => s.repo);
  const pr = useStore((s) => s.pr);
  if (!repo) return null;

  const changes = repo.staged + repo.modified + repo.untracked + repo.conflicted;
  const tone = repo.conflicted ? "conflict" : changes ? "dirty" : "clean";
  const remote = repo.remote;

  return (
    <div className="repo-group">
      {remote && (
        <button className="repo-link" onClick={() => openUrl(remote.url)} title={`Open ${remote.url}`}>
          {remote.url.startsWith("https://github.com/") ? <Github size={13} /> : <Globe size={13} />}
          <span className="repo-name">{remote.short}</span>
        </button>
      )}
      {pr && (
        <button
          className={`repo-link repo-pr${pr.draft ? " draft" : ""}`}
          onClick={() => openUrl(pr.url)}
          title={`${pr.draft ? "Draft pull request" : "Pull request"} #${pr.number} in ${pr.repo}\n${pr.title}`}
        >
          {pr.draft ? <GitPullRequestDraft size={14} /> : <GitPullRequest size={14} />}#{pr.number}
        </button>
      )}
      <div className="repo-status" title={describe(repo)}>
        {repo.branch ? <GitBranch size={14} /> : <GitCommitHorizontal size={14} />}
        <span className="repo-branch">{repo.branch ?? repo.commit ?? "HEAD"}</span>
        {repo.ahead > 0 && (
          <span className="repo-count">
            <ArrowUp size={12} />
            {repo.ahead}
          </span>
        )}
        {repo.behind > 0 && (
          <span className="repo-count">
            <ArrowDown size={12} />
            {repo.behind}
          </span>
        )}
        {changes > 0 && (
          <span className={`repo-count repo-${tone}`}>
            <span className="repo-dot" />
            {changes}
          </span>
        )}
      </div>
    </div>
  );
}
