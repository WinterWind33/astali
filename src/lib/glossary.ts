import type { Board, GlossaryTerm } from "./types";
import { now, uid } from "./util";

/*
 * Glossary boards: the terms, acronyms and names a project uses, each with a Markdown definition,
 * tags and an optional source. One per project for now. The MCP server reads and writes them too
 * (src-tauri/src/mcp.rs), so the rules below (no two entries with the same term, the definition
 * within the project's `glossaryCharLimit`) must stay in step.
 */

/** A definition is a few lines, not an encyclopedia entry. */
export const GLOSSARY_LIMIT_DEFAULT = 300;
export const GLOSSARY_LIMIT_MIN = 50;
export const GLOSSARY_LIMIT_MAX = 5000;

/** A stored limit, or the default when it is missing or out of bounds. */
export function normalizeGlossaryLimit(n: unknown): number {
  return typeof n === "number" && Number.isInteger(n) && n >= GLOSSARY_LIMIT_MIN && n <= GLOSSARY_LIMIT_MAX
    ? n
    : GLOSSARY_LIMIT_DEFAULT;
}

/** Characters (code points, like Rust's `chars().count()`) of a definition counted against the limit. */
export const definitionLength = (definition: string) => [...definition].length;

export const isGlossary = (b: Pick<Board, "kind"> | undefined): boolean => b?.kind === "glossary";

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function normalizeTerm(v: Partial<GlossaryTerm>): GlossaryTerm {
  return {
    // Fields a newer version added are kept, like in vault.ts.
    ...v,
    id: str(v.id) || uid(),
    term: str(v.term),
    definition: str(v.definition),
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string" && !!t.trim()) : [],
    source: str(v.source),
    createdAt: v.createdAt ?? now(),
    updatedAt: v.updatedAt ?? now(),
  };
}

/** How terms are compared for sorting and for "already defined": case and accents don't count. */
export const termKey = (term: string) => term.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

const byTerm = (a: GlossaryTerm, b: GlossaryTerm) =>
  a.term.localeCompare(b.term, undefined, { sensitivity: "base", numeric: true });

/** Another entry of `terms` with the same term as `term`, ignoring `exceptId` (the one being edited). */
export const findTerm = (terms: GlossaryTerm[], term: string, exceptId?: string) =>
  terms.find((t) => t.id !== exceptId && termKey(t.term) === termKey(term));

/** The letter a term is listed under: A–Z, or "#" for anything else. */
export function termLetter(term: string): string {
  const c = termKey(term).charAt(0).toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
}

/**
 * How well a term matches every word of a query (0 = it doesn't): words found in the term weigh
 * most, then in its tags, then in its definition or source. Same scoring as the MCP server.
 */
function termScore(t: GlossaryTerm, tokens: string[]): number {
  const term = termKey(t.term);
  const tags = t.tags.map(termKey).join(" ");
  const rest = termKey(`${t.definition} ${t.source}`);
  let score = 0;
  for (const tok of tokens) {
    if (term.includes(tok)) score += 3;
    else if (tags.includes(tok)) score += 2;
    else if (rest.includes(tok)) score += 1;
    else return 0;
  }
  // The term itself, typed in full, comes first.
  return term === tokens.join(" ") ? score + 10 : score;
}

/** Terms matching every word of `query`, best first; all of them A–Z when the query is empty. */
export function searchTerms(terms: GlossaryTerm[], query: string): GlossaryTerm[] {
  const tokens = termKey(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...terms].sort(byTerm);
  return terms
    .map((t) => ({ t, score: termScore(t, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || byTerm(a.t, b.t))
    .map((x) => x.t);
}

/** A source that is a web address, shown as a link; anything else (a book, a lecture) is shown as text. */
export const sourceUrl = (source: string): string | null => {
  const s = source.trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
};
