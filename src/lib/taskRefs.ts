import type { EpicRef, IssueRef, MilestoneRef, Task } from "./types";

type Refs = Partial<
  Pick<
    Task,
    | "issue"
    | "moreIssues"
    | "mergeRequest"
    | "moreMergeRequests"
    | "milestone"
    | "moreMilestones"
    | "epic"
    | "moreEpics"
  >
>;

// A task's first link of each kind stays in its own field, the others in a `more…` list, so what
// reads only the first (older versions, too) still finds it (D-24).
const all = <T>(first: T | null | undefined, more: T[] | undefined): T[] => [
  ...(first ? [first] : []),
  ...(Array.isArray(more) ? more : []),
];
const rest = <T>(list: T[]) => (list.length > 1 ? list.slice(1) : undefined);

export const taskIssues = (t: Refs): IssueRef[] => all(t.issue, t.moreIssues);
export const taskMergeRequests = (t: Refs): IssueRef[] => all(t.mergeRequest, t.moreMergeRequests);
export const taskMilestones = (t: Refs): MilestoneRef[] => all(t.milestone, t.moreMilestones);
export const taskEpics = (t: Refs): EpicRef[] => all(t.epic, t.moreEpics);

export const issuesPatch = (l: IssueRef[]) => ({ issue: l[0] ?? null, moreIssues: rest(l) });
export const mergeRequestsPatch = (l: IssueRef[]) => ({ mergeRequest: l[0] ?? null, moreMergeRequests: rest(l) });
export const milestonesPatch = (l: MilestoneRef[]) => ({ milestone: l[0] ?? null, moreMilestones: rest(l) });
export const epicsPatch = (l: EpicRef[]) => ({ epic: l[0] ?? null, moreEpics: rest(l) });
