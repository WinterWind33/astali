import type { Decision, IssueRef } from "./types";
import { issueKey, now, uid } from "./util";

/*
 * Decisions say why the code is the way it is, short enough to read in 30 seconds: the why and the
 * rejected alternative together must fit the project's limit. The MCP server enforces the same
 * rules (src-tauri/src/mcp.rs), so the bounds below must stay in step with it.
 */

export const DECISION_LIMIT_DEFAULT = 500;
export const DECISION_LIMIT_MIN = 50;
export const DECISION_LIMIT_MAX = 5000;

/** A stored limit, or the default when it is missing or out of bounds. */
export function normalizeDecisionLimit(n: unknown): number {
  return typeof n === "number" && Number.isInteger(n) && n >= DECISION_LIMIT_MIN && n <= DECISION_LIMIT_MAX
    ? n
    : DECISION_LIMIT_DEFAULT;
}

/** Characters (code points, like Rust's `chars().count()`) counted against the limit. */
export const decisionLength = (d: Pick<Decision, "why" | "rejected">) => [...d.why].length + [...d.rejected].length;

export const decisionRef = (d: Pick<Decision, "number">) => `D-${d.number}`;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function normalizeDecision(d: Partial<Decision>): Decision {
  return {
    // Fields a newer version added are kept, so saving here doesn't drop them.
    ...d,
    schemaVersion: 1,
    id: d.id ?? uid(),
    number: typeof d.number === "number" && d.number > 0 ? d.number : 0,
    title: d.title ?? "Untitled decision",
    why: d.why ?? "",
    rejected: d.rejected ?? "",
    about: strings(d.about),
    tags: strings(d.tags),
    issues: Array.isArray(d.issues)
      ? d.issues.filter((i): i is IssueRef => !!i && typeof i.repo === "string" && typeof i.number === "number")
      : [],
    replacedBy: typeof d.replacedBy === "number" ? d.replacedBy : null,
    createdAt: d.createdAt ?? now(),
    updatedAt: d.updatedAt ?? now(),
  };
}

export const decisionFileName = (d: Pick<Decision, "number" | "id">) => `d${d.number}-${d.id}.json`;

/**
 * How well a decision matches every word of a query (0 = it doesn't): words found in its code
 * references weigh most, then in its title, then anywhere else. Same scoring as the MCP server.
 */
export function decisionScore(d: Decision, tokens: string[]): number {
  const about = d.about.join(" ").toLowerCase();
  const title = d.title.toLowerCase();
  const rest = [d.why, d.rejected, d.tags.join(" "), d.issues.map(issueKey).join(" "), decisionRef(d), `d${d.number}`]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (about.includes(t)) score += 3;
    else if (title.includes(t)) score += 2;
    else if (rest.includes(t)) score += 1;
    else return 0;
  }
  return score;
}

export const queryTokens = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Matching decisions, best first; among equals current ones before replaced ones, then newest first. */
export function searchDecisions(all: Decision[], query: string): Decision[] {
  const tokens = queryTokens(query);
  return all
    .map((d) => ({ d, score: tokens.length ? decisionScore(d, tokens) : 1 }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || Number(a.d.replacedBy != null) - Number(b.d.replacedBy != null) || b.d.number - a.d.number,
    )
    .map((x) => x.d);
}
