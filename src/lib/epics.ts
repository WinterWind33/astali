import type { EpicRef, GlEpic, IssueCache } from "./types";
import { formatDate, repoPath } from "./util";

/**
 * Every cached GitLab epic, once each: two projects of one group both bring that group's epics.
 * Open ones first, then by title.
 */
export function allEpics(cache: IssueCache): GlEpic[] {
  const seen = new Map<string, GlEpic>();
  for (const r of Object.values(cache.repos)) for (const e of r.epics ?? []) seen.set(epicKey(e), e);
  return [...seen.values()].sort((a, b) =>
    a.state === b.state ? a.title.localeCompare(b.title) : a.state === "open" ? -1 : 1,
  );
}

/** "gitlab:group/sub&5", the way an epic is written in GitLab without the provider. */
export const epicKey = (e: EpicRef) => `${e.group}&${e.iid}`;

/** How an epic reads on a chip when the cache doesn't have it: "sub&5". */
export const epicLabel = (e: EpicRef) => `${repoPath(e.group).split("/").pop()}&${e.iid}`;

/** The cached epic a task points at, if the cache has it. */
export function findEpic(cache: IssueCache, ref: EpicRef | null | undefined): GlEpic | undefined {
  if (!ref) return undefined;
  for (const r of Object.values(cache.repos)) {
    const e = r.epics?.find((x) => x.group === ref.group && x.iid === ref.iid);
    if (e) return e;
  }
  return undefined;
}

/** The cached issues in an epic, from every linked project (GitLab tells each issue's epic). */
export function epicIssueCounts(cache: IssueCache, ref: EpicRef): { open: number; closed: number } {
  let open = 0;
  let closed = 0;
  for (const r of Object.values(cache.repos))
    for (const i of r.issues)
      if (i.epic && i.epic.group === ref.group && i.epic.iid === ref.iid) i.state === "open" ? open++ : closed++;
  return { open, closed };
}

/** One line for a tooltip: group, state, the linked projects' issues in it, and dates. */
export function epicSummary(cache: IssueCache, e: GlEpic): string {
  const { open, closed } = epicIssueCounts(cache, e);
  const parts = [`${e.title} (${repoPath(e.group)}&${e.iid})`, e.state];
  if (open + closed) parts.push(`${closed} of ${open + closed} issues closed`);
  if (e.dueDate) parts.push(`due ${formatDate(e.dueDate)}`);
  return parts.join(" · ");
}
