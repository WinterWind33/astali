import changelogText from "../../CHANGELOG.md?raw";

/*
 * The app's own CHANGELOG.md (Keep a Changelog), bundled at build time: "What's new" after an update and
 * the recent releases in Settings read it. A release is a "## [x.y.z] - date" section; "Unreleased" is
 * only shown in development builds.
 */

export interface Release {
  version: string;
  date: string | null;
  /** The section's Markdown, under its heading. */
  body: string;
}

/** The releases in a Keep a Changelog text, in its order. */
export function parseChangelog(text: string): Release[] {
  const out: Release[] = [];
  let current: Release | null = null;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^## \[([^\]]+)\](?:\s*-\s*(\S+))?/.exec(line);
    if (m) {
      current = { version: m[1], date: m[2] ?? null, body: "" };
      out.push(current);
    } else if (current && !/^\[[^\]]+\]:\s/.test(line)) {
      current.body += line + "\n";
    }
  }
  return out.map((r) => ({ ...r, body: r.body.trim() })).filter((r) => r.body);
}

/** Releases, newest first. */
export const RELEASES = parseChangelog(changelogText).filter((r) => r.version !== "Unreleased" || import.meta.env.DEV);

/** Compares "x.y.z" versions (a pre-release suffix is ignored): negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const nums = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [x, y] = [nums(a), nums(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/**
 * What changed since `from` (exclusive) up to `to` (inclusive), newest first. Without `from` (an update from
 * a version that didn't keep track) only `to` itself.
 */
export function releasesBetween(from: string | null, to: string, releases = RELEASES): Release[] {
  return releases.filter((r) => {
    if (r.version === "Unreleased") return false;
    if (compareVersions(r.version, to) > 0) return false;
    return from ? compareVersions(r.version, from) > 0 : compareVersions(r.version, to) === 0;
  });
}
