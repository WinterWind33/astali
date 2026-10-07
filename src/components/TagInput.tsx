import { Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { orderedBoards, useStore } from "../lib/store";
import { collectTags, decisionList, tagKey } from "../lib/tags";
import { cx } from "../lib/util";
import { TagChip } from "./ui";

/** The project's tags (on tasks and decisions) with how many carry each, most used first. */
export function useProjectTags() {
  const packed = useStore(
    useShallow((s) => collectTags(orderedBoards(s), decisionList(s.decisions)).map((t) => `${t.name}\u0000${t.count}`)),
  );
  return packed.map((p) => {
    const [name, count] = p.split("\u0000");
    return { name, count: Number(count) };
  });
}

const MAX_SHOWN = 8;

/**
 * A tag field: the tags as chips, and an input whose suggestions are the project's tags drawn as the
 * chips they are (their color, how often they're used), plus a "new tag" row for anything else.
 * Arrows move through the suggestions, Enter or a click adds one, Esc closes them.
 */
export function TagInput({
  tags,
  onAdd,
  onRemove,
  onChipClick,
  chipTitle,
  placeholder = "Add a tag",
}: {
  tags: string[];
  /** Called with the tag spelled as the project already spells it, when it exists. */
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  onChipClick?: (tag: string, e: React.MouseEvent<HTMLElement>) => void;
  chipTitle?: string;
  placeholder?: string;
}) {
  const known = useProjectTags();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const has = (name: string) => tags.some((t) => tagKey(t) === tagKey(name));
  const q = tagKey(text);
  const shown = known
    .filter((t) => !has(t.name) && (!q || tagKey(t.name).includes(q)))
    // Tags starting with what was typed come before tags merely containing it.
    .sort((a, b) => Number(!tagKey(a.name).startsWith(q)) - Number(!tagKey(b.name).startsWith(q)) || b.count - a.count)
    .slice(0, MAX_SHOWN);
  const exact = known.find((t) => tagKey(t.name) === q);
  const canCreate = !!q && !exact && !has(text);
  const rows = [
    ...shown.map((t) => ({ name: t.name, count: t.count, isNew: false })),
    ...(canCreate ? [{ name: text.trim(), count: 0, isNew: true }] : []),
  ];
  const current = Math.min(active, rows.length - 1);

  useLayoutEffect(() => {
    if (!open || !boxRef.current) return;
    const place = () => {
      const r = boxRef.current!.getBoundingClientRect();
      const h = listRef.current?.offsetHeight ?? 0;
      const below = r.bottom + 4;
      setPos({
        top: below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below,
        left: r.left,
        width: r.width,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, rows.length, tags.length]);

  const add = (name: string) => {
    const n = name.trim();
    if (!n || has(n)) return;
    onAdd(known.find((t) => tagKey(t.name) === tagKey(n))?.name ?? n);
  };
  const commit = (name: string) => {
    add(name);
    setText("");
    setActive(0);
  };

  return (
    <div ref={boxRef} className="label-editor" onClick={() => boxRef.current?.querySelector("input")?.focus()}>
      {tags.map((t) => (
        <TagChip
          key={t}
          tag={t}
          title={chipTitle}
          onClick={onChipClick ? (e) => onChipClick(t, e) : () => {}}
          onRemove={() => onRemove(t)}
        />
      ))}
      <input
        placeholder={tags.length ? "Add…" : placeholder}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            if (rows.length) setActive((current + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            commit(open && rows[current] ? rows[current].name : text);
          } else if (e.key === ",") {
            e.preventDefault();
            commit(text);
          } else if (e.key === "Escape" && open && rows.length) {
            // Only the suggestions close; a second Esc reaches the dialog.
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "Backspace" && !text && tags.length) {
            onRemove(tags[tags.length - 1]);
          }
        }}
        onBlur={() => {
          setOpen(false);
          commit(text);
        }}
      />
      {open &&
        rows.length > 0 &&
        createPortal(
          <div
            ref={listRef}
            className="tag-suggest"
            style={
              pos ? { top: pos.top, left: pos.left, minWidth: Math.min(pos.width, 320) } : { visibility: "hidden" }
            }
            // Keep the focus in the input: picking a row must not blur it first.
            onMouseDown={(e) => e.preventDefault()}
          >
            {!q && <div className="tag-suggest-head">Project tags</div>}
            {rows.map((r, i) => (
              <button
                type="button"
                key={r.isNew ? "\u0000new" : r.name}
                className={cx("tag-suggest-row", i === current && "active")}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(r.name)}
              >
                {r.isNew && <Plus size={12} className="faint" />}
                <TagChip tag={r.name} title={r.name} onClick={() => commit(r.name)} />
                <span className="spacer" />
                <span className="tag-suggest-count">
                  {r.isNew ? "new tag" : `${r.count} use${r.count === 1 ? "" : "s"}`}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
