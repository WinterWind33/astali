import { invoke } from "@tauri-apps/api/core";
import type { BranchPr, GhIssue, GhLabel, GhMilestone, IssueComment, RepoRef } from "./types";
import { repoKey, validPath } from "./util";

const API = "https://api.github.com";
const MAX_PAGES = 10; // 1000 issues per repo is plenty for a board

export class GitHubError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

function apiHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

function mapLabel(l: Raw): GhLabel {
  if (typeof l === "string") return { name: l, color: "8b949e" };
  return { id: l.id, name: l.name, color: (l.color ?? "8b949e").toLowerCase(), description: l.description ?? "" };
}

function httpError(res: Response, key: string): GitHubError {
  if (res.status === 404) return new GitHubError(`${key} not found (private repos need a token)`, 404);
  if (res.status === 401) return new GitHubError("GitHub token is invalid or expired", 401);
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : "later";
    return new GitHubError(`Rate limit hit — retry after ${when}, or add a token in Settings`, res.status);
  }
  return new GitHubError(`GitHub responded ${res.status} for ${key}`, res.status);
}

/** Fetches every page of a list endpoint (100 per page, up to MAX_PAGES). */
async function fetchAllPages(key: string, url: string, token: string): Promise<Raw[]> {
  const all: Raw[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: Response;
    try {
      // "no-cache" revalidates instead of serving GitHub's 60 s cached copy; the 304s are free.
      res = await fetch(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`, {
        headers: apiHeaders(token),
        cache: "no-cache",
      });
    } catch {
      throw new GitHubError("Network error — are you online?");
    }
    if (!res.ok) throw httpError(res, key);
    const batch = (await res.json()) as Raw[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

function mapIssue(repo: string, i: Raw): GhIssue {
  return {
    repo,
    number: i.number,
    title: i.title ?? "",
    body: i.body ?? "",
    state: i.state === "closed" ? "closed" : "open",
    stateReason: i.state_reason ?? null,
    url: i.html_url,
    isPullRequest: !!i.pull_request,
    labels: (i.labels ?? []).map(mapLabel),
    author: i.user?.login ?? "ghost",
    authorAvatar: i.user?.avatar_url ?? "",
    assignees: (i.assignees ?? []).map((a: Raw) => a.login),
    comments: i.comments ?? 0,
    milestone: i.milestone?.title ?? null,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    closedAt: i.closed_at ?? null,
  };
}

/**
 * The API URL of "owner/repo", refused unless both are names GitHub allows. They come from the vault, which may be
 * someone else's, and a name like ".." would point the request, and the token, at another endpoint.
 */
function repoApi(repo: string): string {
  const parts = repo.split("/");
  if (parts.length !== 2 || !validPath(parts)) throw new GitHubError(`Invalid repo '${repo}'`);
  return `${API}/repos/${repo}`;
}

const repoUrl = (ref: RepoRef) => repoApi(`${ref.owner}/${ref.repo}`);

/** Read-only: fetches every issue (and PR) of a repository. Never writes to GitHub. */
export async function fetchRepoIssues(ref: RepoRef, token: string): Promise<GhIssue[]> {
  const key = repoKey(ref);
  const raw = await fetchAllPages(key, `${repoUrl(ref)}/issues?state=all&sort=updated`, token);
  return raw.map((i) => mapIssue(key, i));
}

/** Most result pages one search reads. */
const MAX_SEARCH_PAGES = 3;

/**
 * Read-only: the repository's issues or pull requests found by a search, most recently updated first. Search has
 * its own, tight rate limit, so each page read takes one from `budget`, and reading stops when none are left.
 */
export async function searchRepoIssues(
  repo: string,
  query: string,
  token: string,
  budget: { left: number },
): Promise<GhIssue[]> {
  const out: GhIssue[] = [];
  for (let page = 1; page <= MAX_SEARCH_PAGES && budget.left > 0; page++) {
    budget.left--;
    let res: Response;
    try {
      res = await fetch(`${API}/search/issues?q=${encodeURIComponent(query)}&sort=updated&per_page=100&page=${page}`, {
        headers: apiHeaders(token),
        cache: "no-cache",
      });
    } catch {
      throw new GitHubError("Network error — are you online?");
    }
    if (!res.ok) throw httpError(res, repo);
    const items = ((await res.json()) as { items: Raw[] }).items;
    out.push(...items.map((i) => mapIssue(repo, i)));
    if (items.length < 100) break;
  }
  return out;
}

/** Read-only: every label of a repository, with the ids that stay the same across renames. */
export async function fetchRepoLabels(ref: RepoRef, token: string): Promise<GhLabel[]> {
  return (await fetchAllPages(repoKey(ref), `${repoUrl(ref)}/labels`, token)).map(mapLabel);
}

/** Read-only: every milestone of a repository, open and closed. */
export async function fetchRepoMilestones(ref: RepoRef, token: string): Promise<GhMilestone[]> {
  const key = repoKey(ref);
  return (await fetchAllPages(key, `${repoUrl(ref)}/milestones?state=all`, token)).map((m) => ({
    repo: key,
    number: m.number,
    title: m.title ?? "",
    description: m.description ?? "",
    state: m.state === "closed" ? "closed" : "open",
    dueOn: m.due_on ?? null,
    openIssues: m.open_issues ?? 0,
    closedIssues: m.closed_issues ?? 0,
    url: m.html_url,
  }));
}

/** Read-only: the comments of an issue (or pull request), oldest first. */
export async function fetchIssueComments(repo: string, number: number, token: string): Promise<IssueComment[]> {
  const raw = await fetchAllPages(repo, `${repoApi(repo)}/issues/${number}/comments`, token);
  return raw.map((c) => ({
    id: c.id,
    author: c.user?.login ?? "ghost",
    authorAvatar: c.user?.avatar_url ?? "",
    body: c.body ?? "",
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    url: c.html_url,
  }));
}

/** ETags of the probe requests, by URL. */
const etags = new Map<string, string>();

/**
 * Read-only and cheap: whether the repository's issues or labels changed since the last probe.
 * Uses conditional requests, which GitHub answers with 304 (not counted against the rate limit
 * when authenticated) when nothing changed. The most recently updated issue covers any issue being
 * created, edited, labeled or closed; the label list covers renames, recolors and deletions.
 * "error" when GitHub couldn't be asked (offline, rate-limited, no access).
 */
export async function repoChanged(ref: RepoRef, token: string): Promise<"changed" | "same" | "error"> {
  let base: string;
  try {
    base = repoUrl(ref);
  } catch {
    return "error";
  }
  const urls = [
    `${base}/issues?state=all&sort=updated&per_page=1`,
    `${base}/labels?per_page=100`,
    `${base}/milestones?state=all&per_page=100`,
  ];
  const results = await Promise.all(
    urls.map(async (url) => {
      const headers = apiHeaders(token);
      const tag = etags.get(url);
      if (tag) headers["If-None-Match"] = tag;
      try {
        // Bypass the webview's HTTP cache, which would turn a 304 into a cached 200.
        const res = await fetch(url, { headers, cache: "no-store" });
        if (res.status === 304) return "same";
        if (!res.ok) return "error";
        const next = res.headers.get("etag");
        if (next) etags.set(url, next);
        return "changed";
      } catch {
        return "error";
      }
    }),
  );
  return results.includes("error") ? "error" : results.includes("changed") ? "changed" : "same";
}

/** Read-only: the open pull request whose head is `head` ("owner:branch") in `repo` ("owner/repo"), if any. */
export async function fetchBranchPr(repo: string, head: string, token: string): Promise<BranchPr | null> {
  const url = `${repoApi(repo)}/pulls?state=open&per_page=1&head=${encodeURIComponent(head)}`;
  const res = await fetch(url, { headers: apiHeaders(token) });
  if (!res.ok) throw new GitHubError(`GitHub responded ${res.status} for ${repo}`, res.status);
  const [pr] = (await res.json()) as Raw[];
  return pr ? { repo, number: pr.number, title: pr.title ?? "", url: pr.html_url, draft: !!pr.draft } : null;
}

/** GitHub's "2026-11-01 12:00:00 UTC" (or "… -0700") as an ISO date; null when absent or unreadable. */
function parseGithubDate(s: string | null): string | null {
  const m = s?.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) (UTC|[+-]\d{4})$/);
  if (!m) return null;
  const zone = m[3] === "UTC" ? "Z" : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const d = new Date(`${m[1]}T${m[2]}${zone}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Whether GitHub accepts the token, and when it expires (null when it never does). Asked by the
 * backend, as GitHub hides the expiry header from the webview. Throws when GitHub couldn't be asked.
 */
export async function fetchTokenStatus(token: string): Promise<{ valid: boolean; expiresAt: string | null }> {
  const r = await invoke<{ valid: boolean; expiresAt: string | null }>("github_token_status", { token: token.trim() });
  return { valid: r.valid, expiresAt: parseGithubDate(r.expiresAt) };
}
