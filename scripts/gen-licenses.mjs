// Collects the license of every third-party package shipped in the app — the npm production
// dependencies bundled into the frontend and the Rust crates linked into the binary — and writes
// them to src/generated/third-party-licenses.json for the Credits tab in Settings.
//
// Run with `npm run licenses` (also part of `npm run build`). Needs `npm` and `cargo` on PATH.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src", "generated", "third-party-licenses.json");

const LICENSE_FILE = /^(licen[sc]e|copying|notice|copyright|unlicense)([-._].*)?$/i;

/** Distinct license texts, so the many identical Apache-2.0 copies are stored once. */
const texts = [];
const textIndex = new Map();

function addText(text) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const key = createHash("sha1").update(normalized).digest("hex");
  if (!textIndex.has(key)) {
    textIndex.set(key, texts.length);
    texts.push(normalized);
  }
  return textIndex.get(key);
}

function licenseTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => ({ file: f, text: addText(readFileSync(join(dir, f), "utf8")) }));
}

function run(command, cwd) {
  // A fixed command line run through the shell, so Windows resolves npm.cmd.
  return execSync(command, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function repoUrl(repository) {
  const url = typeof repository === "string" ? repository : repository?.url;
  if (!url) return undefined;
  return url
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/^([\w-]+\/[\w.-]+)$/, "https://github.com/$1");
}

// ---------------------------------------------------------------- npm

function npmPackages() {
  const paths = run("npm ls --omit=dev --all --parseable", root)
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p && resolve(p) !== root);
  const seen = new Map();
  for (const dir of paths) {
    const pkgFile = join(dir, "package.json");
    if (!existsSync(pkgFile)) continue;
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    const id = `${pkg.name}@${pkg.version}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      ecosystem: "npm",
      name: pkg.name,
      version: pkg.version,
      license: typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? null),
      author: typeof pkg.author === "string" ? pkg.author : pkg.author?.name,
      url: repoUrl(pkg.repository) ?? pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}`,
      files: licenseTexts(dir),
    });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- cargo

function cargoPackages() {
  const meta = JSON.parse(run("cargo metadata --format-version 1 --locked", join(root, "src-tauri")));
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));

  // Walk from the app crate through normal and build dependencies; dev-dependencies never ship.
  const reached = new Set();
  const stack = [meta.resolve.root];
  while (stack.length) {
    const id = stack.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind !== "dev")) stack.push(dep.pkg);
    }
  }
  reached.delete(meta.resolve.root);

  // The standard library is linked into the binary too, but isn't a crate in the dependency graph.
  const rustc = run("rustc --version", root).match(/rustc (\S+)/)?.[1] ?? "";
  const std = {
    ecosystem: "cargo",
    name: "Rust standard library",
    version: rustc,
    license: "MIT OR Apache-2.0",
    author: "The Rust Project Developers",
    url: "https://github.com/rust-lang/rust",
    files: [],
  };

  return [
    std,
    ...[...reached].map((id) => {
      const p = byId.get(id);
      return {
        ecosystem: "cargo",
        name: p.name,
        version: p.version,
        license: p.license ?? (p.license_file ? `See ${p.license_file}` : null),
        author: p.authors?.[0]?.replace(/\s*<.*>$/, ""),
        url: p.repository ?? p.homepage ?? `https://crates.io/crates/${p.name}`,
        files: licenseTexts(dirname(p.manifest_path)),
      };
    }),
  ];
}

// ---------------------------------------------------------------- packages without a license file

// Some crates (mostly platform bindings) declare a license but don't ship its text. They get the
// standard text of the license they declare (the first one we have, for an `OR` choice).
const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const BSD3 = (holder) => `BSD 3-Clause License

Copyright (c) ${holder}

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following
   disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following
   disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote
   products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

/** The full Apache-2.0 / MPL-2.0 texts carry no holder, so they are taken from a package that ships them. */
function shippedText(pattern) {
  const i = texts.findIndex((t) => pattern.test(t.slice(0, 300)));
  return i < 0 ? undefined : i;
}

function fallbackText(pkg) {
  const ids = (pkg.license ?? "").split(/\s+OR\s+|\s*\/\s*|[()]/).map((s) => s.trim());
  const holder = pkg.author ?? `the ${pkg.name} authors`;
  if (ids.includes("MIT")) return { file: "MIT (standard text)", text: addText(MIT(holder)) };
  if (ids.includes("BSD-3-Clause")) return { file: "BSD-3-Clause (standard text)", text: addText(BSD3(holder)) };
  const shipped = [
    ["Apache-2.0", /^\s*Apache License\s+Version 2\.0/],
    ["MPL-2.0", /^\s*Mozilla Public License,? Version 2\.0/],
  ];
  for (const [id, pattern] of shipped) {
    const text = ids.includes(id) ? shippedText(pattern) : undefined;
    if (text !== undefined) return { file: `${id} (standard text)`, text };
  }
  return undefined;
}

// ---------------------------------------------------------------- write

const packages = [...npmPackages(), ...cargoPackages()];
for (const pkg of packages) {
  if (pkg.files.length) continue;
  const fallback = fallbackText(pkg);
  if (fallback) pkg.files.push(fallback);
}
packages.sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }),
);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ packages, texts }) + "\n");

const missing = packages.filter((p) => p.files.length === 0);
console.log(
  `third-party licenses: ${packages.length} packages, ${texts.length} distinct texts -> ${out}` +
    (missing.length ? `\n  no license text found (${missing.length}): ${missing.map((p) => p.name).join(", ")}` : ""),
);
