import { Check, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { addTagColumn, orderedBoards, updateColumn, useStore } from "../../lib/store";
import { collectTags, tagColumnName, tagKey, tagOrder } from "../../lib/tags";
import type { Column, TagSource } from "../../lib/types";
import { cx } from "../../lib/util";
import { TagSortMenu, useTagSort } from "../TagSortMenu";
import { Popover, TagChip } from "../ui";

const quoted = (tags: string[], word: string) =>
  tags.length < 2
    ? tags.map((t) => `“${t}”`).join("")
    : `${tags
        .slice(0, -1)
        .map((t) => `“${t}”`)
        .join(", ")} ${word} “${tags.at(-1)}”`;

/** What the column will show, in words, so "Any" and "All" explain themselves. */
function matchHint(picked: string[], match: TagSource["match"]) {
  if (!picked.length) return "Pick the tags whose tasks this column shows.";
  if (picked.length === 1)
    return `Shows the tasks tagged ${quoted(picked, "")}. Pick another tag to choose between any or all of them.`;
  return match === "any"
    ? `Shows the tasks tagged ${quoted(picked, "or")}: at least one of them is enough.`
    : `Shows only the tasks tagged ${quoted(picked, "and")}: every one of them is needed.`;
}

/**
 * Picks the tags of a tag column: adds a new one to the board, or, with `column`, edits that
 * column's tags (renaming it too while it is still named after them).
 */
export function TagColumnPicker({
  boardId,
  anchor,
  column,
  onClose,
  onAdded,
}: {
  boardId: string;
  anchor: DOMRect;
  column?: Column & { source: TagSource };
  onClose: () => void;
  onAdded?: () => void;
}) {
  const known = useStore(useShallow((s) => collectTags(orderedBoards(s)).map((t) => `${t.name}\u0000${t.count}`)));
  const [picked, setPicked] = useState<string[]>(column?.source.tags ?? []);
  const [match, setMatch] = useState<TagSource["match"]>(column?.source.match ?? "any");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useTagSort();

  const tags = known.map((k) => {
    const [name, count] = k.split("\u0000");
    return { name, count: Number(count) };
  });
  // Tags typed here that no task carries yet still count, so a column can be set up ahead of time.
  for (const p of picked) if (!tags.some((t) => tagKey(t.name) === tagKey(p))) tags.push({ name: p, count: 0 });
  const q = query.trim();
  const shown = tags
    .filter((t) => !q || tagKey(t.name).includes(tagKey(q)))
    .sort(
      tagOrder(
        sort,
        (t) => t.name,
        (t) => t.count,
      ),
    );
  const isPicked = (name: string) => picked.some((p) => tagKey(p) === tagKey(name));
  const toggle = (name: string) =>
    setPicked(isPicked(name) ? picked.filter((p) => tagKey(p) !== tagKey(name)) : [...picked, name]);
  const canCreate = q && !tags.some((t) => tagKey(t.name) === tagKey(q));
  // With a single tag "any" and "all" are the same thing.
  const effective = picked.length < 2 ? "any" : match;

  const submit = () => {
    if (!picked.length) return;
    if (column) {
      const source: TagSource = { ...column.source, tags: picked, match: effective };
      const named = column.name === tagColumnName(column.source);
      updateColumn(boardId, column.id, { source, ...(named ? { name: tagColumnName(source) } : {}) });
    } else {
      addTagColumn(boardId, picked, effective);
      onAdded?.();
    }
    onClose();
  };

  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="issue-picker tag-picker">
        <div className="search-row">
          <label className="search">
            <Search size={14} />
            <input
              autoFocus
              placeholder="Find or create a tag"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (canCreate) {
                  setPicked([...picked, q]);
                  setQuery("");
                } else if (shown.length === 1) toggle(shown[0].name);
                else submit();
              }}
            />
          </label>
          <TagSortMenu sort={sort} onChange={setSort} />
        </div>
        <div className="issue-picker-list">
          {shown.map((t) => (
            <button
              key={tagKey(t.name)}
              className={cx("issue-picker-item", isPicked(t.name) && "picked")}
              onClick={() => toggle(t.name)}
            >
              <span className="tag-picker-check">{isPicked(t.name) && <Check size={13} strokeWidth={3} />}</span>
              <TagChip tag={t.name} onClick={() => toggle(t.name)} title={t.name} />
              <span className="spacer" />
              <span className="faint small">{t.count ? `${t.count} task${t.count === 1 ? "" : "s"}` : "unused"}</span>
            </button>
          ))}
          {canCreate && (
            <button
              className="issue-picker-item"
              onClick={() => {
                setPicked([...picked, q]);
                setQuery("");
              }}
            >
              <span className="tag-picker-check">
                <Plus size={13} />
              </span>
              <span>
                Use new tag <strong>{q}</strong>
              </span>
            </button>
          )}
          {!shown.length && !canCreate && <div className="faint small pad">No tags yet. Type one to create it.</div>}
        </div>
        <div className="tag-picker-foot">
          <div className="segmented tiny">
            <button
              className={cx(effective === "any" && "active")}
              title="Show tasks carrying at least one of the picked tags"
              onClick={() => setMatch("any")}
            >
              Any tag
            </button>
            <button
              className={cx(effective === "all" && "active")}
              title={
                picked.length < 2
                  ? "Pick at least two tags to require all of them"
                  : "Show only tasks carrying every picked tag"
              }
              onClick={() => setMatch("all")}
              disabled={picked.length < 2}
            >
              All tags
            </button>
          </div>
          <span className="spacer" />
          <button className="btn primary small" disabled={!picked.length} onClick={submit}>
            {column ? "Save" : picked.length ? `Add column (${picked.length})` : "Add column"}
          </button>
        </div>
        <div className="tag-picker-hint faint small">{matchHint(picked, effective)}</div>
      </div>
    </Popover>
  );
}
