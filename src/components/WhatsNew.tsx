import { Sparkles } from "lucide-react";
import { useState } from "react";
import { RELEASES, type Release, releasesBetween } from "../lib/changelog";
import { dismissWhatsNew, useStore } from "../lib/store";
import { cx } from "../lib/util";
import { Markdown, Modal, ModalHeader } from "./ui";

/** A release's body split at its "### Added" / "### Fixed"… headings; text before the first one has no kind. */
function releaseSections(body: string): { kind: string | null; text: string }[] {
  const out: { kind: string | null; text: string }[] = [{ kind: null, text: "" }];
  for (const line of body.split("\n")) {
    const m = /^###\s+(.+)$/.exec(line);
    if (m) out.push({ kind: m[1].trim(), text: "" });
    else out[out.length - 1].text += line + "\n";
  }
  return out.filter((s) => s.text.trim());
}

/** Releases with their notes, newest first. */
export function ReleaseNotes({ releases }: { releases: Release[] }) {
  return (
    <div className="release-notes">
      {releases.map((r) => (
        <section key={r.version} className="release">
          <header className="release-head">
            <h3>{r.version === "Unreleased" ? "Unreleased" : `Version ${r.version}`}</h3>
            {r.date && <span className="faint small">{r.date}</span>}
          </header>
          {releaseSections(r.body).map((s, i) => (
            <div key={i} className="release-section">
              {s.kind && <span className={cx("release-kind", s.kind.toLowerCase())}>{s.kind}</span>}
              <Markdown className="release-entries">{s.text}</Markdown>
            </div>
          ))}
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
