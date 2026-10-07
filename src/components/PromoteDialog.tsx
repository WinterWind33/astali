import { ArrowUpRight, Kanban, Lightbulb, ListChecks, StickyNote } from "lucide-react";
import { useMemo, useState } from "react";
import { type PromoteIcon, type PromoteTarget, type Promotable, promoteTargets } from "../lib/promote";
import { toast, useStore } from "../lib/store";
import { DecisionDialog } from "./DecisionDialog";
import { Modal, ModalHeader } from "./ui";

const ICONS: Record<PromoteIcon, React.ReactNode> = {
  kanban: <Kanban size={14} />,
  plan: <ListChecks size={14} />,
  notes: <StickyNote size={14} />,
  decision: <Lightbulb size={14} />,
};

/**
 * Turns an item into another kind of item, anywhere in the project (see lib/promote.ts). The item
 * goes away afterwards (`onPromoted(false)`) unless "Keep" is ticked.
 */
export function PromoteDialog({
  item,
  noun,
  fromBoardId,
  onPromoted,
  onClose,
}: {
  item: Promotable;
  /** What is being promoted, e.g. "note". */
  noun: string;
  fromBoardId?: string;
  /** Called once the new item exists; `keep` says whether the original stays. */
  onPromoted: (keep: boolean) => void;
  onClose: () => void;
}) {
  // Recomputed when boards change, so a board created meanwhile shows up.
  const boards = useStore((s) => s.boards);
  const targets = useMemo(() => promoteTargets(fromBoardId), [boards, fromBoardId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [keep, setKeep] = useState(false);
  const [decision, setDecision] = useState(false);

  const groups = useMemo(() => {
    // Keyed by board, so two boards with the same name stay apart.
    const m = new Map<string, PromoteTarget[]>();
    for (const t of targets) m.set(t.boardId ?? t.group, [...(m.get(t.boardId ?? t.group) ?? []), t]);
    return [...m.entries()].map(([key, ts]) => [key, ts[0].group, ts] as const);
  }, [targets]);

  const done = (what: string) => {
    toast(`Promoted the ${noun} to ${what}${keep ? "" : `; the ${noun} was removed`}`, "success");
    onPromoted(keep);
    onClose();
  };

  const pick = (t: PromoteTarget) => {
    if (t.run === "dialog") return setDecision(true);
    const r = t.run(item);
    if (r) done(r.what);
    else toast(`Could not promote the ${noun} there`, "error");
  };

  if (decision)
    return (
      <DecisionDialog
        initial={{ title: item.title.trim(), why: item.body.trim(), tags: item.tags, issues: item.issues }}
        onClose={() => setDecision(false)}
        onCreated={(_, number) => done(`decision D-${number}`)}
      />
    );

  return (
    <Modal onClose={onClose} width={460}>
      <ModalHeader
        title={`Promote ${noun}`}
        subtitle={`Turn “${item.title.trim() || `this ${noun}`}” into something else.`}
        onClose={onClose}
      />
      <div className="promote-list">
        {groups.map(([key, group, ts]) => (
          <div key={key} className="promote-group">
            <div className="promote-group-head">{group}</div>
            {ts.map((t) => (
              <button
                key={t.id}
                className="promote-target"
                onClick={() => pick(t)}
                title={t.loses ? `The ${noun}'s ${t.loses} won't carry over` : undefined}
              >
                {ICONS[t.icon]}
                <span className="promote-target-label">{t.label}</span>
                {t.loses && <span className="faint small">drops {t.loses}</span>}
                <ArrowUpRight size={13} className="faint" />
              </button>
            ))}
          </div>
        ))}
      </div>
      <label className="promote-keep">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep the {noun} too
      </label>
    </Modal>
  );
}
