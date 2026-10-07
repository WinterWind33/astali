import { normalizeHex } from "./color";
import type { Board, Color, IssueRef, Note } from "./types";
import { isPreset, now, uid } from "./util";

/*
 * Notes boards: post-its placed freely on a board. Each holds a title and a Markdown description
 * that together fit the board's `noteLimit`, plus tags and linked issues. The MCP server reads them
 * too (src-tauri/src/mcp.rs), so the bounds below must stay in step with it.
 */

export const NOTE_LIMIT_DEFAULT = 280;
export const NOTE_LIMIT_MIN = 20;
export const NOTE_LIMIT_MAX = 5000;

/** Width of a note on the board; its height follows its content. */
export const NOTE_WIDTH = 220;

export const isNotes = (b: Pick<Board, "kind"> | undefined): boolean => b?.kind === "notes";

/** A kanban board: neither a plan nor a notes board. */
export const isKanban = (b: Pick<Board, "kind"> | undefined): boolean => !b?.kind;

/** A stored limit, or the default when it is missing or out of bounds. */
export function normalizeNoteLimit(n: unknown): number {
  return typeof n === "number" && Number.isInteger(n) && n >= NOTE_LIMIT_MIN && n <= NOTE_LIMIT_MAX
    ? n
    : NOTE_LIMIT_DEFAULT;
}

/** Characters (code points, like Rust's `chars().count()`) counted against the limit. */
export const noteLength = (n: Pick<Note, "title" | "description">) => [...n.title].length + [...n.description].length;

/** Cuts `text` to at most `max` characters (code points). */
export const clip = (text: string, max: number) => {
  const cp = [...text];
  return cp.length <= max ? text : cp.slice(0, Math.max(0, max)).join("");
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
// The board is endless, so positions may be negative.
const coord = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

export function normalizeNote(v: Partial<Note>): Note {
  return {
    // Fields a newer version added are kept, like in vault.ts.
    ...v,
    id: str(v.id) || uid(),
    title: str(v.title),
    description: str(v.description),
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string" && !!t.trim()) : [],
    issues: Array.isArray(v.issues)
      ? v.issues.filter((i): i is IssueRef => !!i && typeof i.repo === "string" && typeof i.number === "number")
      : [],
    color: normalizeNoteColor(v.color),
    x: coord(v.x),
    y: coord(v.y),
    createdAt: v.createdAt ?? now(),
    updatedAt: v.updatedAt ?? now(),
  };
}

/** A preset, a "#rrggbb" hex, or null (follow the first tag). */
export function normalizeNoteColor(c: unknown): Color | null {
  if (typeof c !== "string") return null;
  return isPreset(c) ? c : normalizeHex(c);
}

/** Plain post-it yellow, for a note with no color and no tags. */
export const NOTE_YELLOW = "#f2c94c";

export const newNote = (x: number, y: number): Note => normalizeNote({ x, y });

const lastColorKey = (boardId: string) => `astali.notes.lastColor.${boardId}`;

/** The color last given to a note on this board, for the next new note; null (yellow) if none. */
export function lastNoteColor(boardId: string): Color | null {
  try {
    return normalizeNoteColor(localStorage.getItem(lastColorKey(boardId)));
  } catch {
    return null;
  }
}

/** Remembers, on this machine, the color just given to a note; null goes back to yellow. */
export function rememberNoteColor(boardId: string, color: Color | null) {
  try {
    if (color) localStorage.setItem(lastColorKey(boardId), color);
    else localStorage.removeItem(lastColorKey(boardId));
  } catch {
    // Not remembered; new notes start yellow.
  }
}

export const isBlankNote = (n: Note) => !n.title.trim() && !n.description.trim() && !n.tags.length && !n.issues.length;
