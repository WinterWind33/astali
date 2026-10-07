import { ArrowUpDown, Check } from "lucide-react";
import { useState } from "react";
import type { TagSort } from "../lib/tags";
import { Menu } from "./ui";

const SORTS: { id: TagSort; label: string }[] = [
  { id: "most", label: "Most used" },
  { id: "least", label: "Least used" },
  { id: "az", label: "Name (A–Z)" },
  { id: "za", label: "Name (Z–A)" },
];
const SORT_KEY = "astali.tags.sort";

function loadSort(): TagSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return SORTS.some((x) => x.id === v) ? (v as TagSort) : "most";
  } catch {
    return "most";
  }
}

/** The order chosen for tag lists, remembered on this machine and shared by every list of tags. */
export function useTagSort(): [TagSort, (v: TagSort) => void] {
  const [sort, setSort] = useState<TagSort>(loadSort);
  const set = (v: TagSort) => {
    setSort(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      // Not remembered; the choice still applies while the list is open.
    }
  };
  return [sort, set];
}

/** Sort button for a list of tags, placed beside its search box. */
export function TagSortMenu({ sort, onChange }: { sort: TagSort; onChange: (v: TagSort) => void }) {
  return (
    <Menu
      align="right"
      trigger={(t) => (
        <button className="icon-btn small" title={`Sort: ${SORTS.find((x) => x.id === sort)!.label}`} {...t}>
          <ArrowUpDown size={14} />
        </button>
      )}
      items={SORTS.map((x) => ({
        label: x.label,
        icon: x.id === sort ? <Check size={14} /> : <i className="menu-check-space" />,
        onClick: () => onChange(x.id),
      }))}
    />
  );
}
