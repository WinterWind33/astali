import { EyeOff, GitBranch, X } from "lucide-react";
import { useState } from "react";
import { dismissGitPrompt, setGitIgnored, useStore } from "../lib/store";
import type { GitStatus } from "../lib/types";
import { Modal, ModalHeader } from "./ui";

/** Where the vault sits in the repo, e.g. "repo root" or "docs/kanban". */
const location = (git: GitStatus) => (git.vaultRel ? git.vaultRel : "the repository root");

/** Shows exactly what will be written to .gitignore before doing it. */
export function GitIgnoreDialog({ git, onClose }: { git: GitStatus; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const tracked = git.entries.map((e) => `"${e.replace(/^\//, "")}"`).join(" ");

  return (
    <Modal onClose={onClose} width={560}>
      <ModalHeader
        title="Ignore Astali files in git"
        subtitle={<>This vault is in a git repository, at {location(git)}.</>}
        onClose={onClose}
      />
      <div className="form">
        <div className="field">
          <span>
            Lines added to <span className="mono">{git.gitignorePath}</span>
          </span>
          <pre className="gitignore-preview">
            {"# >>> Astali kanban (managed by the Astali app) >>>\n"}
            {git.entries.join("\n")}
            {"\n# <<< Astali kanban <<<"}
          </pre>
          <p className="faint small">
            The rest of your .gitignore is not touched. Astali keeps this block up to date as projects are added or
            removed, and you can remove it again from Settings.
          </p>
          <p className="faint small">
            Files that were already committed stay tracked. To untrack them, run{" "}
            <span className="mono">git rm -r --cached {tracked}</span> from the repository root.
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy}
            autoFocus
            onClick={async () => {
              setBusy(true);
              await setGitIgnored(true);
              onClose();
            }}
          >
            <EyeOff size={15} /> Add to .gitignore
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Home-screen suggestion shown once a git repo is detected and the files aren't ignored yet. */
export function GitBanner() {
  const git = useStore((s) => s.git);
  const vault = useStore((s) => s.vault);
  const dismissed = useStore((s) => (vault ? s.config.dismissedGitPrompts.includes(vault) : true));
  const [open, setOpen] = useState(false);

  if (!git || git.enabled || dismissed) return null;
  return (
    <>
      <div className="git-banner">
        <GitBranch size={17} />
        <div className="git-banner-text">
          <strong>This vault is inside a git repository</strong>
          <span className="muted small">
            Astali's files at {location(git)} would be committed together with your code.
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

/** Settings section: status plus add/remove. Renders nothing outside a repo. */
export function GitSettings() {
  const git = useStore((s) => s.git);
  const [open, setOpen] = useState(false);
  if (!git) return null;
  return (
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
        .{" "}
        {git.enabled
          ? "Astali's files are git-ignored, and the block is kept in sync as projects change."
          : "Astali's files are currently not ignored."}
      </p>
      <div className="row gap">
        {git.enabled ? (
          <button className="btn" onClick={() => setGitIgnored(false)}>
            Remove from .gitignore
          </button>
        ) : (
          <button className="btn primary" onClick={() => setOpen(true)}>
            <EyeOff size={15} /> Git-ignore Astali files…
          </button>
        )}
      </div>
      {open && <GitIgnoreDialog git={git} onClose={() => setOpen(false)} />}
    </section>
  );
}
