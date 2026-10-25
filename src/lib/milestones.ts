import type { GhMilestone, IssueCache, MilestoneRef } from "./types";
import { formatDate } from "./util";

/** The cached milestone a task points at, if the cache has it. */
export function findMilestone(cache: IssueCache, ref: MilestoneRef | null | undefined): GhMilestone | undefined {
  return ref ? cache.repos[ref.repo]?.milestones?.find((m) => m.number === ref.number) : undefined;
}

/** Share of the milestone's issues that are closed, 0–100. */
export function milestoneProgress(m: GhMilestone): number {
  const total = m.openIssues + m.closedIssues;
  return total ? Math.round((m.closedIssues / total) * 100) : 0;
}

/** One line for a tooltip: progress, issues and due date. */
export function milestoneSummary(m: GhMilestone): string {
  const parts = [
    `${m.title} (${m.repo})`,
    m.state === "closed" ? "closed" : `${milestoneProgress(m)}% done`,
    `${m.closedIssues} of ${m.openIssues + m.closedIssues} issues closed`,
  ];
  if (m.dueOn) parts.push(`due ${formatDate(m.dueOn.slice(0, 10))}`);
  return parts.join(" · ");
}
