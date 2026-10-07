import { normalizeHex } from "./color";
import type { Color, ColorKey, IssueRef, RepoRef } from "./types";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function uid(len = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const now = () => new Date().toISOString();

/** How shortcut hints name the modifier key: ⌘ on macOS, where shortcuts also take Cmd, else Ctrl. */
export const MOD_KEY = /Mac/i.test(navigator.userAgent) ? "⌘" : "Ctrl";

export function slugify(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "untitled"
  );
}

export const COLORS: Record<ColorKey, string> = {
  slate: "#94a3b8",
  violet: "#a78bfa",
  blue: "#60a5fa",
  cyan: "#22d3ee",
  emerald: "#34d399",
  lime: "#a3e635",
  amber: "#fbbf24",
  orange: "#fb923c",
  rose: "#fb7185",
  pink: "#f472b6",
};

export const COLOR_KEYS = Object.keys(COLORS) as ColorKey[];

export const isPreset = (c: Color | undefined): c is ColorKey => !!c && Object.hasOwn(COLORS, c);

/** Resolves a preset key or custom hex to "#rrggbb". */
export const colorHex = (c: Color | undefined): string => (isPreset(c) ? COLORS[c] : (normalizeHex(c) ?? COLORS.slate));

/** A stored color value: preset keys stay as-is, anything else must be a valid hex. */
export const normalizeColor = (c: unknown, fallback: ColorKey): Color =>
  typeof c === "string" && isPreset(c) ? c : (normalizeHex(c as string) ?? fallback);

export const repoKey = (r: RepoRef) => `${r.owner}/${r.repo}`;
export const issueKey = (r: IssueRef) => `${r.repo}#${r.number}`;

/** Accepts "owner/repo", "github.com/owner/repo", full URLs, and ".git" suffixes. */
export function parseRepo(input: string): RepoRef | null {
  const s = input
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const m = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/i) ?? s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const abs = Math.abs(diff);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const sign = diff > 0 ? -1 : 1;
  if (abs < 60) return "just now";
  if (abs < 3600) return fmt.format(sign * Math.round(abs / 60), "minute");
  if (abs < 86400) return fmt.format(sign * Math.round(abs / 3600), "hour");
  if (abs < 86400 * 30) return fmt.format(sign * Math.round(abs / 86400), "day");
  if (abs < 86400 * 365) return fmt.format(sign * Math.round(abs / (86400 * 30)), "month");
  return fmt.format(sign * Math.round(abs / (86400 * 365)), "year");
}

export function formatDate(d: string): string {
  return new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Due-date status relative to today (date-only strings, local time). */
export function dueStatus(d: string | null): "overdue" | "soon" | "later" | null {
  if (!d) return null;
  const due = new Date(d + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = (due - today.getTime()) / 86400000;
  if (days < 0) return "overdue";
  if (days <= 2) return "soon";
  return "later";
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
