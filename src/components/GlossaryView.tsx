import { openUrl } from "@tauri-apps/plugin-opener";
import { BookA, ChevronDown, ChevronUp, ExternalLink, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { definitionLength, findTerm, searchTerms, sourceUrl, termLetter } from "../lib/glossary";
import {
  addTerm,
  decisionFits,
  deleteTerm,
  glossaryBoard,
  glossaryLimit,
  setView,
  toast,
  updateTerm,
  useStore,
  type TermInput,
} from "../lib/store";
import { tagKey } from "../lib/tags";
import type { GlossaryTerm } from "../lib/types";
import { MOD_KEY, cx, relativeTime } from "../lib/util";
import { TagInput } from "./TagInput";
import { EmptyState, Markdown, Modal, ModalHeader, TagChip, confirm } from "./ui";

/**
 * The project's glossary: the terms, acronyms and names it uses, A–Z. A definition longer than two
 * lines shows those two, the second fading out, until "Show more"; the search box finds a term by
 * its name first, then by tag, then by its definition.
 * Its board file is made when the first term is added (see `addTerm`).
 */
export function GlossaryView({ selected }: { selected?: string }) {
  const board = useStore((s) => glossaryBoard(s));
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<GlossaryTerm | "new" | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selected ? [selected] : []));
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" jumps back to the search box from anywhere in the view (Ctrl+F too, from App).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !typing) {
        if (document.querySelector(".modal")) return;
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A term opened from elsewhere (the Tags view) is shown in full.
  useEffect(() => {
    if (selected) setExpanded((cur) => (cur.has(selected) ? cur : new Set(cur).add(selected)));
  }, [selected]);

  const terms = useMemo(() => board?.terms ?? [], [board]);
  const shown = useMemo(() => searchTerms(terms, query), [terms, query]);

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // Without a query the list is A–Z, under a letter heading for each new initial.
  const headings = !query.trim();

  return (
    <div className="decisions-view glossary-view">
      <div className="board-header">
        <div className="board-title">
          <span className="board-name">Glossary</span>
          <span className="board-desc">
            {board?.description || "The terms, acronyms and names this project uses, and what they mean."}
          </span>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}>
          <Plus size={15} /> New term
        </button>
      </div>

      <div className="decisions-body">
        {terms.length > 0 && (
          <label className="search decisions-search">
            <Search size={14} />
            <input
              ref={searchRef}
              data-local-search
              autoFocus
              placeholder={`Search ${terms.length} term${terms.length === 1 ? "" : "s"}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
            {query && (
              <button className="icon-btn tiny" onClick={() => setQuery("")} title="Clear">
                <X size={13} />
              </button>
            )}
          </label>
        )}

        {terms.length === 0 ? (
          <EmptyState icon={<BookA size={28} />} title="No terms yet">
            <p className="muted">
              Write down the words this project uses: a term, an acronym or a name, and what it means. Searching here
              finds them again.
            </p>
            <button className="btn primary" onClick={() => setEditing("new")}>
              <Plus size={16} /> New term
            </button>
          </EmptyState>
        ) : (
          <div className="decisions-list">
            {shown.map((t, i) => (
              <div key={t.id} className="glossary-row">
                {headings && termLetter(t.term) !== (i > 0 ? termLetter(shown[i - 1].term) : "") && (
                  <div className="glossary-letter">{termLetter(t.term)}</div>
                )}
                <TermRow
                  term={t}
                  open={expanded.has(t.id)}
                  focused={t.id === selected}
                  onToggle={() => toggle(t.id)}
                  onEdit={() => setEditing(t)}
                  onDelete={() => deleteTerm(t.id)}
                  onSearch={setQuery}
                />
              </div>
            ))}
            {!shown.length && <div className="faint small decisions-note">Nothing matches “{query}”.</div>}
          </div>
        )}
      </div>

      {editing && (
        <TermDialog
          term={editing === "new" ? undefined : editing}
          terms={terms}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            if (editing === "new") {
              const id = addTerm(input);
              if (!id) return false;
              setQuery("");
              setView({ kind: "glossary", termId: id });
            } else if (!updateTerm(editing.id, input)) return false;
            return true;
          }}
          onOpen={(t) => {
            setEditing(null);
            setQuery("");
            setView({ kind: "glossary", termId: t.id });
          }}
        />
      )}
    </div>
  );
}

function TermRow({
  term: t,
  open,
  focused,
  onToggle,
  onEdit,
  onDelete,
  onSearch,
}: {
  term: GlossaryTerm;
  open: boolean;
  focused: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSearch: (q: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const definitionRef = useRef<HTMLDivElement>(null);
  // Whether the definition runs past the two lines shown while folded, measured as laid out.
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  useLayoutEffect(() => {
    const el = definitionRef.current;
    if (!el || open) return;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, t.definition]);
  const url = sourceUrl(t.source);

  return (
    <div ref={ref} className={cx("glossary-term", focused && "focused")}>
      <div className="glossary-term-head">
        <span className="glossary-term-name">{t.term}</span>
        {t.tags.map((tag) => (
          <TagChip key={tag} tag={tag} title="Find every term with this tag" onClick={() => onSearch(tag)} />
        ))}
        <span className="spacer" />
        <span className="glossary-term-actions">
          <button className="icon-btn tiny" title="Edit" onClick={onEdit}>
            <Pencil size={13} />
          </button>
          <button
            className="icon-btn tiny"
            title="Delete"
            onClick={async () => {
              const ok = await confirm({
                title: `Delete “${t.term}”?`,
                message: "You can undo this from Activity.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (ok) onDelete();
            }}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      {t.definition.trim() ? (
        <div ref={definitionRef} className={cx("glossary-definition", !open && "folded", long && !open && "fade")}>
          <Markdown>{t.definition}</Markdown>
        </div>
      ) : (
        <div className="faint small">No definition yet.</div>
      )}
      {(long || t.source.trim()) && (
        <div className="glossary-term-foot">
          {long && (
            <button className="link-text small" onClick={onToggle}>
              {open ? (
                <>
                  <ChevronUp size={13} /> Show less
                </>
              ) : (
                <>
                  <ChevronDown size={13} /> Show more
                </>
              )}
            </button>
          )}
          {t.source.trim() && (
            <span className="glossary-source faint small">
              Source:{" "}
              {url ? (
                <button className="link-text" title={url} onClick={() => openUrl(url)}>
                  {url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")} <ExternalLink size={11} />
                </button>
              ) : (
                t.source
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const fieldsOf = (t?: GlossaryTerm): TermInput => ({
  term: t?.term ?? "",
  definition: t?.definition ?? "",
  tags: t?.tags ?? [],
  source: t?.source ?? "",
});

/**
 * Writes a term: changes stay in the editor until Save (Ctrl+Enter). Closing with unsaved changes
 * asks first. A term the glossary already has can't be saved twice; the editor offers to open it.
 */
function TermDialog({
  term,
  terms,
  onSave,
  onClose,
  onOpen,
}: {
  term?: GlossaryTerm;
  terms: GlossaryTerm[];
  /** False when the glossary refused it. */
  onSave: (input: TermInput) => boolean;
  onClose: () => void;
  onOpen: (t: GlossaryTerm) => void;
}) {
  const [draft, setDraft] = useState<TermInput>(() => fieldsOf(term));
  const limit = useStore(glossaryLimit);
  const asking = useRef(false);
  const set = (patch: Partial<TermInput>) => setDraft((d) => ({ ...d, ...patch }));

  const clean = { ...draft, term: draft.term.trim().replace(/\s*\n\s*/g, " "), source: draft.source.trim() };
  const taken = clean.term ? findTerm(terms, clean.term, term?.id) : undefined;
  const dirty = JSON.stringify(draft) !== JSON.stringify(fieldsOf(term));
  const len = definitionLength(draft.definition.trim());
  const before = term ? definitionLength(term.definition) : null;
  const fits = decisionFits(len, before, limit);
  const canSave = !!clean.term && !taken && fits && (dirty || !term);

  const close = async () => {
    if (asking.current) return;
    if (dirty) {
      asking.current = true;
      const ok = await confirm({
        title: "Discard your changes?",
        message: "What you wrote in this term will be lost.",
        confirmLabel: "Discard",
        danger: true,
      });
      asking.current = false;
      if (!ok) return;
    }
    onClose();
  };
  const save = () => {
    if (!canSave) return;
    if (onSave({ ...clean, definition: clean.definition.trim() })) onClose();
    else toast("The term could not be saved", "error");
  };

  return (
    <Modal onClose={close} width={600}>
      <ModalHeader
        title={term ? `Edit “${term.term}”` : "New term"}
        subtitle="A term, an acronym or a name, and what it means in this project."
        onClose={close}
      />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <label className="field">
          <span>Term</span>
          <input
            autoFocus
            value={draft.term}
            onChange={(e) => set({ term: e.target.value })}
            placeholder="e.g. MCP, Photosynthesis, Bayes' theorem"
          />
        </label>
        {taken && (
          <div className="field-error">
            “{taken.term}” is already in the glossary.{" "}
            <button type="button" className="link-text" onClick={() => onOpen(taken)}>
              Open it
            </button>
          </div>
        )}
        <label className="field">
          <span>
            Definition <em className="faint">— Markdown</em>
          </span>
          <textarea
            rows={7}
            value={draft.definition}
            onChange={(e) => set({ definition: e.target.value })}
            placeholder="What it means, in your own words…"
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
              ? `This definition was written under a higher limit. It can stay as it is, but it can't grow: shorten it to at most ${before} characters.`
              : `${len - limit} character${len - limit === 1 ? "" : "s"} over this project's limit. Keep it to what the term means here; link the long version as the source.`}
          </div>
        )}
        <div className="decision-dialog-row">
          <div className="field">
            <span>Tags</span>
            <TagInput
              tags={draft.tags}
              chipTitle="Click × to remove"
              onAdd={(t) =>
                setDraft((d) =>
                  d.tags.some((x) => tagKey(x) === tagKey(t)) || !t.trim() ? d : { ...d, tags: [...d.tags, t.trim()] },
                )
              }
              onRemove={(t) => setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== t) }))}
            />
          </div>
          <label className="field">
            <span>
              Source <em className="faint">— optional</em>
            </span>
            <input
              value={draft.source}
              onChange={(e) => set({ source: e.target.value })}
              placeholder="https://… or a book, page 12"
            />
          </label>
        </div>
        <div className="modal-actions with-meta">
          <span className="faint small">
            {term ? `Updated ${relativeTime(term.updatedAt)}` : `${MOD_KEY}+Enter saves`}
          </span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!canSave}>
            {term ? "Save changes" : "Add term"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
