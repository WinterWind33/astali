import { EyeOff, GitBranch, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { dismissGitPrompt, setAutoSync, setGitIgnored, useStore } from "../lib/store";
import type { GitIgnoreMode, GitStatus } from "../lib/types";
import { cx } from "../lib/util";
import { Modal, ModalHeader } from "./ui";

/** Where the vault sits in the repo, e.g. "repo root" or "docs/kanban". */
const location = (git: GitStatus) => (git.vaultRel ? git.vaultRel : "the repository root");

const CHOICES: { mode: GitIgnoreMode; title: string; text: string }[] = [
  {
    mode: "cache",
    title: "Only Astali's cache",
    text: "Projects, boards, decisions and history are committed, so they travel with the repository. The GitHub issues cache, rebuilt on every sync, stays out.",
  },
  {
    mode: "vault",
    title: "The whole vault",
    text: "Nothing of Astali's is committed: your boards stay on this computer, out of the code's history.",
  },
];

const entriesOf = (git: GitStatus, mode: GitIgnoreMode) => (mode === "vault" ? git.vaultEntries : git.cacheEntries);

/** Lets the user pick what to git-ignore, showing exactly what will be written to .gitignore before doing it. */
export function GitIgnoreDialog({ git, onClose }: { git: GitStatus; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<GitIgnoreMode>(git.ignored ?? "cache");
  const entries = entriesOf(git, mode);
  // As git pathspecs: a wildcard folder only matches through the files under it ("kb/*/.cache/*").
  const untrack = entries.map((e) => `"${e.replace(/^\//, "").replace(/\*(.*)\/$/, "*$1/*")}"`).join(" ");

  return (
    <Modal onClose={onClose} width={580}>
      <ModalHeader
        title="Ignore Astali files in git"
        subtitle={<>This vault is in a git repository, at {location(git)}.</>}
        onClose={onClose}
      />
      <div className="form">
        <div className="field">
          <span>What should git ignore?</span>
          <div className="gitignore-choices">
            {CHOICES.map((c) => (
              <label key={c.mode} className={cx("gitignore-choice", mode === c.mode && "active")}>
                <input type="radio" name="gitignore" checked={mode === c.mode} onChange={() => setMode(c.mode)} />
                <span>
                  <b>{c.title}</b>
                  <span className="faint small">{c.text}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span>
            Lines written to <span className="mono">{git.gitignorePath}</span>
          </span>
          <pre className="gitignore-preview">
            {"# >>> Astali kanban (managed by the Astali app) >>>\n"}
            {entries.join("\n")}
            {"\n# <<< Astali kanban <<<"}
          </pre>
          <p className="faint small">
            The rest of your .gitignore is not touched. Astali keeps this block up to date as projects are added or
            removed, and you can change or remove it from Settings.
          </p>
          <p className="faint small">
            Files that were already committed stay tracked. To untrack them, run{" "}
            <span className="mono">git rm -r --cached {untrack}</span> from the repository root.
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || mode === git.ignored}
            autoFocus
            onClick={async () => {
              setBusy(true);
              await setGitIgnored(mode);
              onClose();
            }}
          >
            <EyeOff size={15} /> {git.ignored ? "Update .gitignore" : "Add to .gitignore"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Home-screen suggestion shown once a git repo is detected and nothing is ignored yet. */
export function GitBanner() {
  const git = useStore((s) => s.git);
  const vault = useStore((s) => s.vault);
  const dismissed = useStore((s) => (vault ? s.config.dismissedGitPrompts.includes(vault) : true));
  const [open, setOpen] = useState(false);

  if (!git || git.ignored || dismissed) return null;
  return (
    <>
      <div className="git-banner">
        <GitBranch size={17} />
        <div className="git-banner-text">
          <strong>This vault is inside a git repository</strong>
          <span className="muted small">
            Astali's files at {location(git)}, cache included, would be committed together with your code.
          </span>
        </div>
        <button className="btn primary small" onClick={() => setOpen(true)}>
          <EyeOff size={14} /> Git-ignore Astali files
        </button>
        <button className="icon-btn small" title="Don't ask again for this vault" onClick={dismissGitPrompt}>
          <X size={15} />
        </button>
      </div>
      {open && <GitIgnoreDialog git={git} onClose={() => setOpen(false)} />}
    </>
  );
}

const IGNORED_TEXT: Record<GitIgnoreMode | "none", string> = {
  vault: "The whole vault is git-ignored, and the block is kept in sync as projects change.",
  cache: "Only Astali's cache is git-ignored: projects, boards, decisions and history are committed.",
  none: "Nothing of Astali's is git-ignored, its cache included.",
};

/** Changes before an automatic sync, when the user hasn't picked a number yet. */
const AUTO_SYNC_DEFAULT = 5;
/** Matches `AUTO_SYNC_MAX` in settings.rs. */
const AUTO_SYNC_MAX = 1000;

/** Settings section: what's ignored, with change/remove, and automatic sync. Renders nothing outside a repo. */
export function GitSettings() {
  const git = useStore((s) => s.git);
  const autoSync = useStore((s) => (s.vault ? (s.config.gitAutoSync[s.vault] ?? 0) : 0));
  const [open, setOpen] = useState(false);
  if (!git) return null;
  return (
    <>
      <section>
        <h4>
          <GitBranch size={15} /> Git
        </h4>
        <p className="muted small">
          Repository detected at <span className="mono">{git.repoRoot}</span>
          {git.vaultRel && (
            <>
              {" "}
              (vault in <span className="mono">{git.vaultRel}</span>)
            </>
          )}
          . {IGNORED_TEXT[git.ignored ?? "none"]}
        </p>
        <div className="row gap">
          {git.ignored ? (
            <>
              <button className="btn" onClick={() => setOpen(true)}>
                <EyeOff size={15} /> Change what's ignored…
              </button>
              <button className="btn ghost" onClick={() => setGitIgnored(null)}>
                Remove from .gitignore
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => setOpen(true)}>
              <EyeOff size={15} /> Git-ignore Astali files…
            </button>
          )}
        </div>
        {open && <GitIgnoreDialog git={git} onClose={() => setOpen(false)} />}
      </section>
      {git.ignored !== "vault" && (
        <section>
          <h4>
            <RefreshCw size={15} /> Automatic sync
          </h4>
          <p className="muted small">
            The vault's files are committed with the repository, so its boards can travel through git to your other
            computers and to the people you work with. Astali can sync them for you: after the number of changes you
            pick, once you pause, it commits the vault's files, pulls and pushes. Other changes in the repository are
            never committed for you.
          </p>
          <AutoSyncField every={autoSync} />
        </section>
      )}
    </>
  );
}

/** On/off plus the number of changes; the number is saved once typed (Enter or leaving the field). */
function AutoSyncField({ every }: { every: number }) {
  const [draft, setDraft] = useState(String(every || AUTO_SYNC_DEFAULT));
  // Follow changes made elsewhere (an agent through the MCP server), keeping the number while it's off.
  useEffect(() => {
    if (every) setDraft(String(every));
  }, [every]);
  const parsed = () => {
    const n = Number(draft);
    return Number.isInteger(n) && n >= 1 && n <= AUTO_SYNC_MAX ? n : null;
  };
  const commit = () => {
    const n = parsed();
    if (n === null) return setDraft(String(every || AUTO_SYNC_DEFAULT));
    if (every && n !== every) setAutoSync(n);
  };
  return (
    <div className="row gap" style={{ color: "var(--text-dim)", fontSize: 12.5 }}>
      <label className="toggle">
        <input
          type="checkbox"
          checked={every > 0}
          onChange={(e) => setAutoSync(e.target.checked ? (parsed() ?? AUTO_SYNC_DEFAULT) : 0)}
        />
        Sync by itself after
      </label>
      <input
        type="number"
        min={1}
        max={AUTO_SYNC_MAX}
        style={{ width: "5em" }}
        aria-label="Changes before syncing"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      changes
    </div>
  );
}
