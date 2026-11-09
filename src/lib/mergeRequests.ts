import type { GhIssue, IssueCache, IssueRef } from "./types";
import { isGitlab, issueKey, repoName, repoUrl } from "./util";

/**
 * Merge requests are found apart from issues: GitLab numbers the two separately, so "!12" and "#12"
 * can both exist. GitHub's pull requests share the issues' numbers and arrive in their list.
 */
export function findMergeRequest(cache: IssueCache, ref: IssueRef | null | undefined): GhIssue | undefined {
  if (!ref) return undefined;
  const rc = cache.repos[ref.repo];
  return (rc?.mergeRequests ?? rc?.issues.filter((i) => i.isPullRequest))?.find((i) => i.number === ref.number);
}

/** Every cached merge request and pull request. */
export function allMergeRequests(cache: IssueCache): GhIssue[] {
  return Object.values(cache.repos).flatMap((r) => r.mergeRequests ?? r.issues.filter((i) => i.isPullRequest));
}

/** The sign before a merge request's number: "!" on GitLab, "#" on GitHub. */
export const mergeRequestSign = (repo: string) => (isGitlab(repo) ? "!" : "#");

type Listed = Pick<GhIssue, "repo" | "number" | "isPullRequest">;

/** The sign before the number of an issue or merge request in a list. */
export const listedSign = (i: Listed) => (i.isPullRequest ? mergeRequestSign(i.repo) : "#");

export const mergeRequestKey = (r: IssueRef) => `${r.repo}${mergeRequestSign(r.repo)}${r.number}`;

/** Tells apart GitLab's "!12" and "#12", which are different things. */
export const listedKey = (i: Listed) => (i.isPullRequest ? mergeRequestKey(i) : issueKey(i));

/** What these repositories call their merge requests: it depends on where they are hosted. */
export function mergeRequestsName(repos: string[]) {
  const gitlab = repos.filter(isGitlab).length;
  if (gitlab === 0) return "Pull requests";
  return gitlab === repos.length ? "Merge requests" : "Pull and merge requests";
}

/** How a merge request reads on a chip: "project!12". */
export const mergeRequestLabel = (r: IssueRef) => `${repoName(r.repo)}${mergeRequestSign(r.repo)}${r.number}`;

/** The web page of a merge request, for when the cache doesn't have it. */
export const mergeRequestUrl = (r: IssueRef) =>
  `${repoUrl(r.repo)}/${isGitlab(r.repo) ? "-/merge_requests" : "pull"}/${r.number}`;

/** One line for a tooltip. */
export const mergeRequestSummary = (m: GhIssue | undefined) =>
  m ? `${m.title}${m.stateReason === "merged" ? " (merged)" : ""}` : "Not in the local cache — sync issues";
