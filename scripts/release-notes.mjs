// Release notes from CHANGELOG.md, for the release workflow.
//
//   node scripts/release-notes.mjs 1.7.0       that version's section, without its heading (the GitHub release page)
//   node scripts/release-notes.mjs --recent 10  the 10 newest released sections, headings included (latest.json's
//                                               notes: the update dialog shows those since the installed version)
//
// Exits with an error when the version has no section, so a release can't go out without its notes.
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** "## [x.y.z] - date" sections, newest first, skipping Unreleased and the link references. */
const releases = [];
let current = null;
for (const line of text.split("\n")) {
  const m = /^## \[([^\]]+)\](?:\s*-\s*(\S+))?/.exec(line);
  if (m) {
    current = m[1] === "Unreleased" ? null : { heading: line, version: m[1], body: "" };
    if (current) releases.push(current);
  } else if (current && !/^\[[^\]]+\]:\s/.test(line)) {
    current.body += line + "\n";
  }
}

const [arg, count] = process.argv.slice(2);
if (arg === "--recent") {
  const n = parseInt(count, 10) || 10;
  console.log(releases.slice(0, n).map((r) => `${r.heading}\n\n${r.body.trim()}`).join("\n\n"));
} else if (arg) {
  const release = releases.find((r) => r.version === arg);
  if (!release?.body.trim()) {
    console.error(`CHANGELOG.md has no "## [${arg}] - date" section with notes.`);
    process.exit(1);
  }
  console.log(release.body.trim());
} else {
  console.error("Usage: node scripts/release-notes.mjs <version> | --recent <count>");
  process.exit(2);
}
