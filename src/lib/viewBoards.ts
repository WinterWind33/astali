import type {
  Board,
  Column,
  GhIssue,
  IssueCache,
  IssueRules,
  LabelRule,
  PresenceRule,
  QuerySource,
  RepoCache,
  RepoRef,
  ViewSort,
} from "./types";

/*
 * View boards hold only rules. Their cards are the cached GitHub and GitLab items passing the board's rules and
 * their column's. A sync's lists are capped, so for a repository past its cap, each column also asks the host for
 * what it may match: a rough query, since hosts filter differently, whose results still go through the exact
 * rules here (D-25).
 */

export const isView = (b: Pick<Board, "kind"> | undefined): boolean => b?.kind === "view";

const isGitlabRepo = (repo: string) => repo.startsWith("gitlab:");

const emptyLabels = (): LabelRule => ({ names: [], match: "any", exclude: [] });

/** Rules that let everything through, which is where a column starts. */
export const emptyRules = (): IssueRules => ({
  repos: [],
  type: "both",
  state: "all",
  githubLabels: emptyLabels(),
  gitlabLabels: emptyLabels(),
  milestone: { mode: "any", names: [] },
  epic: { mode: "any", names: [] },
  assignees: [],
  authors: [],
});

/** The rules of a new board: its open issues. */
export const newViewRules = (): IssueRules => ({ ...emptyRules(), type: "issues", state: "open" });

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ]
    : [];

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

function normalizeLabels(raw: Partial<LabelRule> | undefined): LabelRule {
  return {
    names: strings(raw?.names),
    match: oneOf(raw?.match, ["any", "all"], "any"),
    exclude: strings(raw?.exclude),
  };
}

function normalizePresence(raw: Partial<PresenceRule> | undefined): PresenceRule {
  return { mode: oneOf(raw?.mode, ["any", "has", "none", "is"], "any"), names: strings(raw?.names) };
}

/** Rules read from a vault file, which may be hand-edited or come from a newer version. */
export function normalizeRules(raw: unknown): IssueRules {
  const r = (raw ?? {}) as Partial<IssueRules>;
  return {
    repos: strings(r.repos),
    type: oneOf(r.type, ["issues", "merge", "both"], "both"),
    state: oneOf(r.state, ["open", "closed", "all"], "all"),
    githubLabels: normalizeLabels(r.githubLabels),
    gitlabLabels: normalizeLabels(r.gitlabLabels),
    milestone: normalizePresence(r.milestone),
    epic: normalizePresence(r.epic),
    assignees: strings(r.assignees),
    authors: strings(r.authors),
  };
}

export const normalizeViewSort = (v: unknown): ViewSort => oneOf(v, ["updated", "created", "title"], "updated");

export function normalizeQuerySource(raw: object): QuerySource {
  return { kind: "query", rules: normalizeRules((raw as Partial<QuerySource>).rules) };
}

export function querySource(c: Pick<Column, "source"> | undefined): QuerySource | null {
  return c?.source?.kind === "query" ? c.source : null;
}

const lower = (s: string) => s.toLowerCase();

/** The rules of a column showing the items of one repository that carry a label. */
export function labelRules(repo: string, label: string): IssueRules {
  const labels: LabelRule = { ...emptyLabels(), names: [label] };
  return {
    ...emptyRules(),
    repos: [repo],
    ...(isGitlabRepo(repo) ? { gitlabLabels: labels } : { githubLabels: labels }),
  };
}

/** Whether one of these columns already shows just this label of this repository. */
export function hasLabelColumn(columns: Column[], repo: string, label: string): boolean {
  return columns.some((c) => {
    const r = querySource(c)?.rules;
    if (r?.repos.length !== 1 || r.repos[0] !== repo) return false;
    const { names } = isGitlabRepo(repo) ? r.gitlabLabels : r.githubLabels;
    return names.length === 1 && lower(names[0]) === lower(label);
  });
}

function labelsPass(i: GhIssue, rule: LabelRule) {
  const have = new Set(i.labels.map((l) => lower(l.name)));
  if (rule.exclude.some((n) => have.has(lower(n)))) return false;
  if (!rule.names.length) return true;
  return rule.match === "all"
    ? rule.names.every((n) => have.has(lower(n)))
    : rule.names.some((n) => have.has(lower(n)));
}

function presencePass(value: string | null | undefined, rule: PresenceRule) {
  if (rule.mode === "any") return true;
  if (rule.mode === "has") return !!value;
  if (rule.mode === "none") return !value;
  return !!value && rule.names.some((n) => lower(n) === lower(value));
}

const anyOf = (wanted: string[], have: string[]) =>
  !wanted.length || wanted.some((w) => have.some((h) => lower(h) === lower(w)));

/** Labels picked for one host only mean that host's items: the other's can't carry them. */
const hostAllowed = (gitlab: boolean, r: IssueRules) =>
  (gitlab ? r.gitlabLabels : r.githubLabels).names.length > 0 ||
  (gitlab ? r.githubLabels : r.gitlabLabels).names.length === 0;

export function matchesRules(i: GhIssue, r: IssueRules): boolean {
  if (r.repos.length && !r.repos.includes(i.repo)) return false;
  if (r.type === "issues" && i.isPullRequest) return false;
  if (r.type === "merge" && !i.isPullRequest) return false;
  if (r.state !== "all" && i.state !== r.state) return false;
  const gitlab = isGitlabRepo(i.repo);
  if (!hostAllowed(gitlab, r)) return false;
  if (!labelsPass(i, gitlab ? r.gitlabLabels : r.githubLabels)) return false;
  if (!presencePass(i.milestone, r.milestone)) return false;
  // GitHub has no epics, so an epic rule says nothing about its issues.
  if (gitlab && !presencePass(i.epic?.title, r.epic)) return false;
  return anyOf(r.assignees, i.assignees) && anyOf(r.authors, [i.author]);
}

/** Identifies a card: a GitLab issue and merge request can share a number (D-23). */
export const cardKey = (i: GhIssue) => `${i.repo}${i.isPullRequest ? "!" : "#"}${i.number}`;

const SORTS: Record<ViewSort, (a: GhIssue, b: GhIssue) => number> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }),
};

/** Every cached issue and merge request of these repositories. */
export function issuePool(cache: IssueCache, repos: string[]): GhIssue[] {
  return repos.flatMap((r) => [...(cache.repos[r]?.issues ?? []), ...(cache.repos[r]?.mergeRequests ?? [])]);
}

/** The cards of each column of a view board, sorted, by column id. */
export function viewCards(board: Board, cache: IssueCache, repos: string[]): Record<string, GhIssue[]> {
  const rules = board.viewRules ?? emptyRules();
  const pool = issuePool(cache, repos)
    .filter((i) => matchesRules(i, rules))
    .sort(SORTS[board.viewSort ?? "updated"]);
  const taken = new Set<string>();
  const out: Record<string, GhIssue[]> = {};
  for (const c of board.columns) {
    const src = querySource(c);
    if (!src) continue;
    out[c.id] = pool.filter((i) => matchesRules(i, src.rules) && !(board.viewFirstMatch && taken.has(cardKey(i))));
    if (board.viewFirstMatch) for (const i of out[c.id]) taken.add(cardKey(i));
  }
  return out;
}

/** The rules in words, for a column's tooltip. */
export function describeRules(r: IssueRules): string {
  const parts: string[] = [];
  if (r.type !== "both") parts.push(r.type === "issues" ? "issues" : "merge requests");
  if (r.state !== "all") parts.push(r.state);
  const labels = (host: string, l: LabelRule) => {
    if (l.names.length) parts.push(`${host} labels: ${l.names.join(l.match === "all" ? " and " : " or ")}`);
    if (l.exclude.length) parts.push(`no ${host} label ${l.exclude.join(", ")}`);
  };
  labels("GitLab", r.gitlabLabels);
  labels("GitHub", r.githubLabels);
  const presence = (what: string, p: PresenceRule) => {
    if (p.mode === "has") parts.push(`has a ${what}`);
    if (p.mode === "none") parts.push(`no ${what}`);
    if (p.mode === "is") parts.push(`${what}: ${p.names.join(" or ")}`);
  };
  presence("milestone", r.milestone);
  presence("epic", r.epic);
  if (r.assignees.length) parts.push(`assigned to ${r.assignees.join(" or ")}`);
  if (r.authors.length) parts.push(`by ${r.authors.join(" or ")}`);
  if (r.repos.length) parts.push(`in ${r.repos.length} repositor${r.repos.length === 1 ? "y" : "ies"}`);
  return parts.length ? parts.join(" · ") : "Everything on the board";
}

// ---------------------------------------------------------------- past the sync's caps

/** How many items a sync lists per repository (see MAX_PAGES and MAX_MR_PAGES of github.ts and gl.rs). */
export const GITHUB_ISSUE_CAP = 1000;
export const GITLAB_ISSUE_CAP = 1000;
export const GITLAB_MR_CAP = 300;

type Listed = Pick<RepoCache, "issues" | "mergeRequests">;

export const issuesAtCap = (r: RepoRef, c: Listed) =>
  c.issues.length >= (r.provider === "gitlab" ? GITLAB_ISSUE_CAP : GITHUB_ISSUE_CAP);

export const mergeRequestsAtCap = (c: Listed) => (c.mergeRequests?.length ?? 0) >= GITLAB_MR_CAP;

/** A view board's rules, once per column: what each column's remote queries are built from. */
export function remoteRules(board: Board): [IssueRules, IssueRules][] {
  const rules = board.viewRules ?? emptyRules();
  return board.columns.flatMap((c): [IssueRules, IssueRules][] => {
    const src = querySource(c);
    return src ? [[rules, src.rules]] : [];
  });
}

const inScope = (repo: string, r: IssueRules) => !r.repos.length || r.repos.includes(repo);

/** The kinds of item both rules allow. */
function kinds(a: IssueRules, b: IssueRules): boolean[] {
  const merge = a.type !== "issues" && b.type !== "issues";
  const issues = a.type !== "merge" && b.type !== "merge";
  return [...(issues ? [false] : []), ...(merge ? [true] : [])];
}

/** The state both rules allow; null when none can pass both. */
function jointState(a: IssueRules, b: IssueRules): IssueRules["state"] | null {
  if (a.state !== "all" && b.state !== "all" && a.state !== b.state) return null;
  return a.state !== "all" ? a.state : b.state;
}

/** GitHub refuses longer search queries. */
const GITHUB_QUERY_MAX = 256;

/** A rule's value in a GitHub search; null when it can't be written there. */
const quoted = (s: string) => (s.includes('"') ? null : `"${s}"`);

function githubLabelClauses(rule: LabelRule): string[] {
  const out = rule.exclude.flatMap((n) => {
    const q = quoted(n);
    return q ? [`-label:${q}`] : [];
  });
  const names = rule.names.map(quoted);
  if (!names.length || names.some((n) => !n)) return out;
  return rule.match === "all" || names.length === 1
    ? [...out, ...names.map((n) => `label:${n}`)]
    : [...out, `label:${names.join(",")}`];
}

/**
 * GitHub searches finding what a column may match in `repo`: a superset, as what search can't express is left out
 * for the exact rules. None when nothing narrows them, since the listing already holds that much.
 */
export function githubQueries(repo: string, a: IssueRules, b: IssueRules): string[] {
  const state = jointState(a, b);
  if (!state || !inScope(repo, a) || !inScope(repo, b) || !hostAllowed(false, a) || !hostAllowed(false, b)) return [];
  const clauses = [...githubLabelClauses(a.githubLabels), ...githubLabelClauses(b.githubLabels)];
  const single = (key: string, lists: string[][]) => {
    const value = lists.find((l) => l.length === 1)?.[0];
    const q = value && quoted(value);
    if (q) clauses.push(`${key}:${q}`);
  };
  const milestones = [a.milestone, b.milestone].filter((m) => m.mode === "is").map((m) => m.names);
  single("milestone", milestones);
  single("assignee", [a.assignees, b.assignees]);
  single("author", [a.authors, b.authors]);
  if (!clauses.length && state !== "open") return [];
  const base = [`repo:${repo}`, ...(state === "all" ? [] : [`is:${state}`]), ...clauses].join(" ");
  return kinds(a, b)
    .map((merge) => `${base} is:${merge ? "pull-request" : "issue"}`)
    .filter((q) => q.length <= GITHUB_QUERY_MAX);
}

export interface GitlabQuery {
  mergeRequest: boolean;
  params: [string, string][];
}

/** GitLab's list API can only ask for all of some labels, so "any of" takes one query per label, up to this many. */
const GITLAB_ANY_LABELS_MAX = 5;

/** Like `githubQueries`, as parameters of GitLab's issue and merge request lists. */
export function gitlabQueries(repo: string, a: IssueRules, b: IssueRules): GitlabQuery[] {
  const state = jointState(a, b);
  if (!state || !inScope(repo, a) || !inScope(repo, b) || !hostAllowed(true, a) || !hostAllowed(true, b)) return [];
  // GitLab separates label names with commas, so a name holding one is left to the exact rules.
  const usable = (n: string) => !n.includes(",");
  const all = new Set<string>();
  const not = new Set<string>();
  let any: string[] = [];
  for (const rule of [a.gitlabLabels, b.gitlabLabels]) {
    rule.exclude.filter(usable).forEach((n) => not.add(n));
    const names = rule.names.filter(usable);
    if (names.length !== rule.names.length) continue;
    if (rule.match === "all" || names.length === 1) names.forEach((n) => all.add(n));
    else if (!any.length && names.length <= GITLAB_ANY_LABELS_MAX) any = names;
  }
  const shared: [string, string][] = [];
  if (state !== "all") shared.push(["state", state === "open" ? "opened" : "closed"]);
  if (not.size) shared.push(["not[labels]", [...not].join(",")]);
  const presence = (key: string, rules: PresenceRule[], named: boolean, out: [string, string][]) => {
    const rule = rules.find((r) => r.mode !== "any");
    if (rule?.mode === "has") out.push([key, "Any"]);
    if (rule?.mode === "none") out.push([key, "None"]);
    if (rule?.mode === "is" && named && rule.names.length === 1) out.push([key, rule.names[0]]);
  };
  presence("milestone", [a.milestone, b.milestone], true, shared);
  const one = (key: string, lists: string[][]) => {
    const value = lists.find((l) => l.length === 1)?.[0];
    if (value) shared.push([key, value]);
  };
  one("assignee_username", [a.assignees, b.assignees]);
  one("author_username", [a.authors, b.authors]);
  const labelSets = any.length ? any.map((n) => [...all, n]) : [[...all]];
  return kinds(a, b).flatMap((mergeRequest) =>
    labelSets.flatMap((labels) => {
      const params: [string, string][] = [...shared];
      if (labels.length) params.push(["labels", labels.join(",")]);
      // Merge requests aren't in epics, and the epic's id isn't known from its title.
      if (!mergeRequest) presence("epic_id", [a.epic, b.epic], false, params);
      const narrowed = params.some(([k]) => k !== "state") || state === "open";
      return narrowed ? [{ mergeRequest, params }] : [];
    }),
  );
}

/** `list` plus what `found` adds to it. */
export function mergeFound(list: GhIssue[], found: GhIssue[]): GhIssue[] {
  const have = new Set(list.map((i) => i.number));
  const added = found.filter((i) => !have.has(i.number) && have.add(i.number));
  return added.length ? [...list, ...added] : list;
}
