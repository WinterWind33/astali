import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronRight, ExternalLink, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cx } from "../lib/util";

/** Shape of src/generated/third-party-licenses.json, written by scripts/gen-licenses.mjs. */
interface ThirdParty {
  packages: {
    ecosystem: "npm" | "cargo";
    name: string;
    version: string;
    license: string | null;
    author?: string;
    url: string;
    files: { file: string; text: number }[];
  }[];
  texts: string[];
}

type Filter = "all" | "npm" | "cargo";

function PackageRow({ pkg, texts }: { pkg: ThirdParty["packages"][number]; texts: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cx("credit", open && "open")}>
      <button className="credit-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={14} className="credit-chevron" />
        <span className="credit-name">{pkg.name}</span>
        <span className="faint small mono">{pkg.version}</span>
        <span className="credit-license">{pkg.license ?? "Unknown"}</span>
      </button>
      {open && (
        <div className="credit-body">
          <div className="row gap small">
            {pkg.author && <span className="muted">{pkg.author}</span>}
            <button className="link-btn" onClick={() => openUrl(pkg.url)}>
              <ExternalLink size={12} /> {pkg.url.replace(/^https?:\/\//, "")}
            </button>
          </div>
          {pkg.files.map((f) => (
            <div key={f.file}>
              <div className="faint small mono">{f.file}</div>
              <pre className="credit-text">{texts[f.text]}</pre>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/** Settings tab crediting the open-source software shipped in the app, with each license's text. */
export function CreditsSettings() {
  const [data, setData] = useState<ThirdParty | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    // ~1 MB of license text: loaded only when the tab is opened.
    import("../generated/third-party-licenses.json").then((m) => setData(m.default as unknown as ThirdParty));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.packages ?? []).filter(
      (p) =>
        (filter === "all" || p.ecosystem === filter) &&
        (!q || p.name.toLowerCase().includes(q) || (p.license ?? "").toLowerCase().includes(q)),
    );
  }, [data, query, filter]);

  const count = (e: Filter) => data?.packages.filter((p) => e === "all" || p.ecosystem === e).length ?? 0;

  return (
    <section>
      <h4>Third-party software</h4>
      <p className="muted small">
        Astali is built with Tauri, React, Lucide icons, the Inter typeface and many other open-source packages. The
        software below is included in this app and is used under the license shown for each package; click one to read
        its license text.
      </p>
      <div className="credits-toolbar">
        <div className="segmented small">
          {(
            [
              ["all", "All"],
              ["npm", "JavaScript"],
              ["cargo", "Rust"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={cx(filter === id && "active")} onClick={() => setFilter(id)}>
              {label} <span className="faint">{count(id)}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or license"
            spellCheck={false}
          />
        </label>
      </div>
      {!data ? (
        <p className="faint small">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="faint small">No package matches.</p>
      ) : (
        <ul className="credits">
          {shown.map((p) => (
            <PackageRow key={`${p.ecosystem}:${p.name}@${p.version}`} pkg={p} texts={data.texts} />
          ))}
        </ul>
      )}
    </section>
  );
}
