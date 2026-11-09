import { Download } from "lucide-react";
import { useState } from "react";
import { currentProject, fetchUnlistedIssue, useStore } from "../lib/store";
import type { GhIssue } from "../lib/types";
import { repoKey, repoPath } from "../lib/util";

/**
 * When `query` is a number GitLab's capped sync didn't bring, offers to fetch it from each of the
 * project's GitLab projects.
 */
export function FetchUnlisted({
  query,
  mergeRequest = false,
  onFetched,
}: {
  query: string;
  mergeRequest?: boolean;
  onFetched?: (i: GhIssue) => void;
}) {
  const repos = useStore((s) => currentProject(s)?.project.repos);
  const cache = useStore((s) => s.issues);
  const [busy, setBusy] = useState("");
  const digits = query.trim().match(/^[#!]?(\d+)$/)?.[1];
  if (!digits) return null;
  const number = Number(digits);
  const sign = mergeRequest ? "!" : "#";
  const missing = (repos ?? [])
    .filter((r) => r.provider === "gitlab")
    .map(repoKey)
    .filter((k) => {
      const rc = cache.repos[k];
      return !(mergeRequest ? rc?.mergeRequests : rc?.issues)?.some((i) => i.number === number);
    });

  return (
    <>
      {missing.map((repo) => (
        <button
          key={repo}
          type="button"
          className="issue-picker-item"
          disabled={!!busy}
          onClick={async () => {
            setBusy(repo);
            const got = await fetchUnlistedIssue(repo, number, mergeRequest);
            setBusy("");
            if (got) onFetched?.(got);
          }}
        >
          <Download size={14} />
          <span className="issue-picker-title">
            {busy === repo ? "Fetching" : "Fetch"} {sign}
            {number} from {repoPath(repo)}
          </span>
        </button>
      ))}
    </>
  );
}
