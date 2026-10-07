import { getVersion } from "@tauri-apps/api/app";
import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { parseChangelog, releasesBetween } from "../lib/changelog";
import { installUpdate, useUpdate } from "../lib/updater";
import { Markdown, Modal, ModalHeader } from "./ui";
import { ReleaseNotes } from "./WhatsNew";

/** Title bar button for a newer version: nothing is downloaded until it's clicked and confirmed. */
export function UpdateBadge() {
  const { available, installing, progress } = useUpdate();
  const [open, setOpen] = useState(false);
  if (!available) return null;

  if (installing) {
    return (
      <span className="whats-new-badge update-badge busy" title="Astali restarts when the update is installed">
        <LoaderCircle size={13} className="spin" />
        {progress === null ? "Updating…" : progress < 1 ? `Downloading ${Math.round(progress * 100)}%` : "Installing…"}
      </span>
    );
  }

  return (
    <>
      <button
        className="whats-new-badge update-badge"
        onClick={() => setOpen(true)}
        title={`Astali ${available} is available: see what's in it`}
      >
        <Download size={13} /> Update to {available}
      </button>
      {open && <UpdateDialog version={available} onClose={() => setOpen(false)} />}
    </>
  );
}

/** What the update brings, and the button that installs it. */
export function UpdateDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const notes = useUpdate((s) => s.notes);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    getVersion()
      .then(setCurrent)
      .catch(() => {});
  }, []);

  // Changelog-style notes cover several releases: show those since the version in use.
  const releases = notes ? releasesBetween(current, version, parseChangelog(notes)) : [];

  return (
    <Modal onClose={onClose} width={640}>
      <ModalHeader
        title={`Astali ${version} is available`}
        subtitle={current ? `You have ${current}.` : undefined}
        onClose={onClose}
      />
      <div className="whats-new-body">
        {releases.length > 0 ? (
          <ReleaseNotes releases={releases} />
        ) : notes ? (
          <Markdown>{notes}</Markdown>
        ) : (
          <p className="muted">This release came without notes. After the update, What's new shows what changed.</p>
        )}
      </div>
      <div className="modal-actions whats-new-actions">
        <span className="faint small">
          Astali saves your boards and restarts. Close any editor with unsaved changes first.
        </span>
        <div className="row gap">
          <button className="btn ghost" onClick={onClose}>
            Not now
          </button>
          <button
            className="btn primary"
            autoFocus
            onClick={() => {
              onClose();
              installUpdate();
            }}
          >
            Update and restart
          </button>
        </div>
      </div>
    </Modal>
  );
}
