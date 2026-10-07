import { Sparkles } from "lucide-react";
import { useState } from "react";
import { RELEASES, type Release, releasesBetween } from "../lib/changelog";
import { dismissWhatsNew, useStore } from "../lib/store";
import { cx } from "../lib/util";
import { Markdown, Modal, ModalHeader } from "./ui";

/** Releases with their notes, newest first. */
export function ReleaseNotes({ releases }: { releases: Release[] }) {
  return (
    <div className="release-notes">
      {releases.map((r) => (
        <section key={r.version} className="release">
          <h3>
            {r.version === "Unreleased" ? "Unreleased" : `Version ${r.version}`}
            {r.date && <span className="faint small"> · {r.date}</span>}
          </h3>
          <Markdown>{r.body}</Markdown>
        </section>
      ))}
    </div>
  );
}

/** The last releases, for Settings. */
export function RecentReleases() {
  return <ReleaseNotes releases={RELEASES.slice(0, 5)} />;
}

/**
 * After an update: a badge that opens what changed, until it has been read. It sits in the title bar, and
 * also at the bottom of the welcome screen ("welcome"), where no vault is open yet.
 */
export function WhatsNewBadge({ place = "titlebar" }: { place?: "titlebar" | "welcome" }) {
  const whatsNew = useStore((s) => s.whatsNew);
  const [open, setOpen] = useState(false);
  if (!whatsNew) return null;
  const releases = releasesBetween(whatsNew.from, whatsNew.to);
  const close = () => {
    setOpen(false);
    dismissWhatsNew();
  };
  return (
    <>
      <button
        className={cx("whats-new-badge", place === "welcome" && "welcome")}
        onClick={() => setOpen(true)}
        title={`Astali was updated to ${whatsNew.to}: see what changed`}
      >
        <Sparkles size={13} /> {place === "welcome" ? `What's new in Astali ${whatsNew.to}` : "What's new"}
      </button>
      {open && (
        <Modal onClose={close} width={640}>
          <ModalHeader
            title={`What's new in Astali ${whatsNew.to}`}
            subtitle={whatsNew.from ? `Everything since ${whatsNew.from}, the version you used before.` : undefined}
            onClose={close}
          />
          <div className="whats-new-body">
            <ReleaseNotes releases={releases} />
          </div>
          <div className="modal-actions whats-new-actions">
            <span className="faint small">The last releases are also in Settings → Updates.</span>
            <button className="btn primary" onClick={close}>
              Got it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
