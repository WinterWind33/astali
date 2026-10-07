import { ArrowRight, Code2, Lightbulb, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { decisionLength, decisionRef, searchDecisions } from "../lib/decisions";
import { currentProject, deleteDecision, setView, useStore } from "../lib/store";
import type { Decision } from "../lib/types";
import { cx, issueKey, relativeTime } from "../lib/util";
import { DecisionDialog, IssueChip } from "./DecisionDialog";
import { EmptyState, Markdown, TagChip, confirm } from "./ui";

/**
 * The project's decisions: why the code is the way it is. Built for one loop: type a class name or
 * a path, find the decision, read the why, done. Picking one expands it in place.
 */
export function DecisionsView({ selected }: { selected?: string }) {
  const project = useStore((s) => currentProject(s)?.project);
  const decisions = useStore(useShallow((s) => Object.values(s.decisions).map((e) => e.decision)));
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Decision | "new" | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl+F (or "/") jumps back to the search box from anywhere in the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") || (e.key === "/" && !typing)) {
        if (document.querySelector(".modal")) return;
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => searchDecisions(decisions, query), [decisions, query]);
  const byNumber = useMemo(() => new Map(decisions.map((d) => [d.number, d])), [decisions]);

  if (!project) return null;
  const select = (id: string | undefined) => setView({ kind: "decisions", decisionId: id });
  const openNumber = (n: number) => {
    const d = byNumber.get(n);
    if (!d) return;
    // Make sure it is in the list, even if the search hides it.
    if (!shown.includes(d)) setQuery("");
    select(d.id);
  };

  return (
    <div className="decisions-view">
      <div className="board-header">
        <div className="board-title">
          <span className="board-name">Decisions</span>
          <span className="board-desc">
            Why the code is the way it is, in {project.decisionCharLimit} characters or less. Search for a class, a path
            or a word.
          </span>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}>
          <Plus size={15} /> New decision
        </button>
      </div>

      <div className="decisions-body">
        <label className="search decisions-search">
          <Search size={14} />
          <input
            ref={searchRef}
            autoFocus
            placeholder="keyboard_state, input/, D-12, sparse…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
              // Enter opens the best match.
              if (e.key === "Enter" && shown[0]) select(shown[0].id);
            }}
          />
          {query && (
            <button className="icon-btn tiny" onClick={() => setQuery("")} title="Clear">
              <X size={13} />
            </button>
          )}
        </label>

        {decisions.length === 0 ? (
          <EmptyState icon={<Lightbulb size={28} />} title="No decisions yet">
            <p className="muted">
              When you settle how something should work, write down why, in a few lines. Next time you wonder why a
              class looks the way it does, search for it here.
            </p>
            <button className="btn primary" onClick={() => setEditing("new")}>
              <Plus size={16} /> New decision
            </button>
          </EmptyState>
        ) : (
          <div className="decisions-list">
            {shown.map((d) => (
              <DecisionRow
                key={d.id}
                decision={d}
                open={d.id === selected}
                replacedBy={d.replacedBy != null ? byNumber.get(d.replacedBy) : undefined}
                replaces={decisions.filter((o) => o.replacedBy === d.number)}
                limit={project.decisionCharLimit}
                onToggle={() => select(d.id === selected ? undefined : d.id)}
                onEdit={() => setEditing(d)}
                onOpenNumber={openNumber}
                onSearch={setQuery}
              />
            ))}
            {!shown.length && <div className="faint small decisions-note">Nothing matches “{query}”.</div>}
          </div>
        )}
      </div>

      {editing && (
        <DecisionDialog
          decision={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onCreated={(id) => {
            setQuery("");
            select(id);
          }}
        />
      )}
    </div>
  );
}

function DecisionRow({
  decision: d,
  open,
  replacedBy,
  replaces,
  limit,
  onToggle,
  onEdit,
  onOpenNumber,
  onSearch,
}: {
  decision: Decision;
  open: boolean;
  replacedBy?: Decision;
  replaces: Decision[];
  limit: number;
  onToggle: () => void;
  onEdit: () => void;
  onOpenNumber: (n: number) => void;
  onSearch: (q: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest" });
  }, [open]);
  const firstLine = d.why.split("\n").find((l) => l.trim()) ?? "";
  const len = decisionLength(d);

  return (
    <div ref={ref} className={cx("decision", open && "open", d.replacedBy != null && "replaced")}>
      <button className="decision-head" onClick={onToggle}>
        <span className="decision-ref">{decisionRef(d)}</span>
        <span className="decision-head-text">
          <span className="decision-title">{d.title}</span>
          {!open && <span className="decision-line">{firstLine.replace(/[*_`#>]/g, "")}</span>}
        </span>
        {d.replacedBy != null && <span className="decision-badge">Replaced by D-{d.replacedBy}</span>}
        {!open &&
          d.about.slice(0, 2).map((a) => (
            <span key={a} className="code-ref small-ref">
              {a}
            </span>
          ))}
      </button>

      {open && (
        <div className="decision-body">
          {replacedBy && (
            <button className="decision-replaced" onClick={() => onOpenNumber(replacedBy.number)}>
              Replaced by <strong>{decisionRef(replacedBy)}</strong> {replacedBy.title} <ArrowRight size={13} />
            </button>
          )}
          <Markdown className="decision-why">{d.why}</Markdown>
          {d.rejected && (
            <div className="decision-rejected">
              <span className="decision-label">Not chosen</span>
              <Markdown>{d.rejected}</Markdown>
            </div>
          )}
          {(d.about.length > 0 || d.tags.length > 0 || d.issues.length > 0) && (
            <div className="decision-meta">
              {d.about.map((a) => (
                <button key={a} className="code-ref" title="Find every decision about this" onClick={() => onSearch(a)}>
                  <Code2 size={12} /> {a}
                </button>
              ))}
              {d.tags.map((t) => (
                <TagChip key={t} tag={t} title="Find every decision with this tag" onClick={() => onSearch(t)} />
              ))}
              {d.issues.map((i) => (
                <IssueChip key={issueKey(i)} issue={i} />
              ))}
            </div>
          )}
          {replaces.length > 0 && (
            <div className="decision-replaces faint small">
              Replaces{" "}
              {replaces.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ", "}
                  <button className="link-text" onClick={() => onOpenNumber(o.number)}>
                    {decisionRef(o)} {o.title}
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="decision-foot">
            <span className="faint small">
              Recorded {relativeTime(d.createdAt)}
              {d.updatedAt !== d.createdAt && ` · edited ${relativeTime(d.updatedAt)}`} ·{" "}
              <span className={cx(len > limit && "over")}>
                {len}/{limit} characters
              </span>
            </span>
            <span className="spacer" />
            <button className="btn small" onClick={onEdit}>
              <Pencil size={13} /> Edit
            </button>
            <button
              className="btn small danger-ghost"
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete ${decisionRef(d)}?`,
                  message: `“${d.title}” will be deleted. If you changed your mind about it, consider recording the new decision and marking this one as replaced, so the old reasoning stays findable. You can undo a delete from Activity.`,
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (ok) deleteDecision(d.id);
              }}
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
