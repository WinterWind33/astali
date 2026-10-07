import { openUrl } from "@tauri-apps/plugin-opener";
import { Link2, X } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { decisionLength, decisionRef } from "../lib/decisions";
import { createDecision, currentProject, decisionFits, toast, updateDecision, useStore } from "../lib/store";
import { tagKey } from "../lib/tags";
import type { Decision, GhIssue, IssueRef } from "../lib/types";
import { cx, issueKey } from "../lib/util";
import { IssuePicker } from "./board/TaskDialog";
import { TagInput } from "./TagInput";
import { Github, IssueStateIcon, Modal, ModalHeader, Popover } from "./ui";

/** Adds `text` to `list` unless it is empty or already there (`key` decides what "already there" means). */
function addTo(list: string[], text: string, key: (s: string) => string = (s) => s) {
  const t = text.trim();
  return t && !list.some((x) => key(x) === key(t)) ? [...list, t] : list;
}

/** Writes a new decision, or edits one. Saving is refused while the text is over the project's limit. */
export function DecisionDialog({
  decision,
  initial,
  onClose,
  onCreated,
}: {
  decision?: Decision;
  /** Starting values for a new decision (e.g. from a plan's question). */
  initial?: Partial<Pick<Decision, "title" | "why" | "rejected" | "about" | "tags" | "issues">>;
  onClose: () => void;
  onCreated?: (id: string, number: number) => void;
}) {
  const start = decision ?? initial;
  const project = useStore((s) => currentProject(s)?.project);
  const others = useStore(
    useShallow((s) =>
      Object.values(s.decisions)
        .map((e) => e.decision)
        .filter((d) => d.id !== decision?.id)
        .sort((a, b) => b.number - a.number),
    ),
  );
  const [title, setTitle] = useState(start?.title ?? "");
  const [why, setWhy] = useState(start?.why ?? "");
  const [rejected, setRejected] = useState(start?.rejected ?? "");
  const [about, setAbout] = useState<string[]>(start?.about ?? []);
  const [aboutInput, setAboutInput] = useState("");
  const [tags, setTags] = useState<string[]>(start?.tags ?? []);
  const [issues, setIssues] = useState<IssueRef[]>(start?.issues ?? []);
  const [replacedBy, setReplacedBy] = useState<number | null>(decision?.replacedBy ?? null);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [busy, setBusy] = useState(false);

  if (!project) return null;
  const limit = project.decisionCharLimit;
  const len = decisionLength({ why, rejected });
  const before = decision ? decisionLength(decision) : null;
  const fits = decisionFits(len, before, limit);
  const canSave = !!title.trim() && !!why.trim() && fits && !busy;

  const linkIssue = (i: GhIssue) => {
    if (!issues.some((x) => x.repo === i.repo && x.number === i.number))
      setIssues([...issues, { repo: i.repo, number: i.number }]);
    setPicker(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    // Text typed in a chip field but not added yet is almost certainly meant to be included.
    const data = {
      title: title.trim().replace(/\s*\n\s*/g, " "),
      why: why.trim(),
      rejected: rejected.trim(),
      about: addTo(about, aboutInput),
      tags,
      issues,
    };
    setBusy(true);
    try {
      if (decision) {
        if (!updateDecision(decision.id, { ...data, replacedBy }))
          throw new Error("The decision is over the length limit");
        onClose();
      } else {
        const id = await createDecision(data);
        if (!id) throw new Error("The decision is over the length limit");
        onClose();
        onCreated?.(id, useStore.getState().decisions[id].decision.number);
      }
    } catch (err) {
      toast(String(err), "error");
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={620}>
      <ModalHeader
        title={decision ? `Edit ${decisionRef(decision)}` : "New decision"}
        subtitle="What you decided and why, short enough to read in 30 seconds."
        onClose={onClose}
      />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Decision</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Keyboard state is a sparse map"
          />
        </label>
        <label className="field">
          <span>
            Why <em className="faint">— Markdown</em>
          </span>
          <textarea
            rows={5}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Only keys that saw input are stored, so consuming a key is just erasing it…"
          />
        </label>
        <label className="field">
          <span>
            Not chosen <em className="faint">— optional: the alternative you rejected, and why</em>
          </span>
          <textarea
            rows={2}
            value={rejected}
            onChange={(e) => setRejected(e.target.value)}
            placeholder="A fixed array per key: …"
          />
        </label>
        <div className={cx("decision-counter", !fits && "over")}>
          <div className="progress-bar">
            <span style={{ width: `${Math.min(100, (len / limit) * 100)}%` }} />
          </div>
          <span>
            {len}/{limit}
          </span>
        </div>
        {!fits && (
          <div className="field-error">
            {before != null && before > limit
              ? `This decision was written under a higher limit. It can stay as it is, but it can't grow: shorten it to at most ${before} characters.`
              : `${len - limit} character${len - limit === 1 ? "" : "s"} over this project's limit. Keep only the reason; details belong in the code or the issue.`}
          </div>
        )}

        <div className="field">
          <span>
            About <em className="faint">— the code it explains, so searching for it finds this</em>
          </span>
          <div className="label-editor">
            {about.map((a) => (
              <span key={a} className="code-ref removable">
                {a}
                <button type="button" aria-label={`Remove ${a}`} onClick={() => setAbout(about.filter((x) => x !== a))}>
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              className="mono-input"
              placeholder={about.length ? "Add…" : "keyboard_state, src/input/keyboard-state.hpp…"}
              value={aboutInput}
              onChange={(e) => setAboutInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  setAbout(addTo(about, aboutInput));
                  setAboutInput("");
                }
                if (e.key === "Backspace" && !aboutInput && about.length) setAbout(about.slice(0, -1));
              }}
              onBlur={() => {
                setAbout(addTo(about, aboutInput));
                setAboutInput("");
              }}
            />
          </div>
        </div>

        <div className="decision-dialog-row">
          <div className="field">
            <span>Tags</span>
            <TagInput
              tags={tags}
              chipTitle="Click × to remove"
              onAdd={(t) => setTags((cur) => addTo(cur, t, tagKey))}
              onRemove={(t) => setTags((cur) => cur.filter((x) => x !== t))}
            />
          </div>

          {project.repos.length > 0 && (
            <div className="field">
              <span>GitHub issues</span>
              <div className="decision-issues">
                {issues.map((i) => (
                  <IssueChip key={issueKey(i)} issue={i} onRemove={() => setIssues(issues.filter((x) => x !== i))} />
                ))}
                <button
                  type="button"
                  className="btn small"
                  onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
                >
                  <Link2 size={13} /> Link issue
                </button>
              </div>
            </div>
          )}
        </div>

        {decision && others.length > 0 && (
          <label className="field">
            <span>
              Replaced by <em className="faint">— when you changed your mind, point to the decision that took over</em>
            </span>
            <select
              value={replacedBy ?? ""}
              onChange={(e) => setReplacedBy(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Still current</option>
              {others.map((d) => (
                <option key={d.id} value={d.number}>
                  {decisionRef(d)} {d.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!canSave}>
            {decision ? "Save changes" : "Record decision"}
          </button>
        </div>
      </form>

      {picker && (
        <Popover anchor={picker} align="right" onClose={() => setPicker(null)}>
          <IssuePicker onPick={linkIssue} />
        </Popover>
      )}
    </Modal>
  );
}

/** A linked GitHub issue: its state when cached, opening it on GitHub on click. */
export function IssueChip({ issue, onRemove }: { issue: IssueRef; onRemove?: () => void }) {
  const cached = useStore((s) => s.issues.repos[issue.repo]?.issues.find((i) => i.number === issue.number));
  return (
    <span className="issue-chip" title={cached ? `${issueKey(issue)} — ${cached.title}` : issueKey(issue)}>
      <button
        type="button"
        onClick={() => openUrl(cached?.url ?? `https://github.com/${issue.repo}/issues/${issue.number}`)}
      >
        {cached ? <IssueStateIcon issue={cached} size={12} /> : <Github size={12} />}
        {issue.repo.split("/")[1]}#{issue.number}
      </button>
      {onRemove && (
        <button type="button" className="issue-chip-remove" aria-label="Unlink" onClick={onRemove}>
          <X size={11} />
        </button>
      )}
    </span>
  );
}
