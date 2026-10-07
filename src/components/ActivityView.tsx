import { Bot, ChevronRight, History, Redo2, Undo2, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  currentProject,
  loadHistory,
  orderedBoards,
  setView,
  showOnBoard,
  toast,
  undoChange,
  useStore,
} from "../lib/store";
import type { HistoryEntry } from "../lib/types";
import { cx, relativeTime } from "../lib/util";
import { EmptyState, confirm } from "./ui";

const CLIENT_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-ai": "Claude Desktop",
};

/** "claude-code" → "Claude Code"; unknown clients are title-cased. */
export function clientName(e: Pick<HistoryEntry, "by" | "client">) {
  if (e.by === "app") return "You";
  if (!e.client) return "AI agent";
  return CLIENT_NAMES[e.client] ?? e.client.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Undoes an entry; when some of it can't be (changed again since, or bound for an auto-archiving column), asks
 * whether to undo the rest.
 * Returns whether anything was undone.
 */
export async function undoWithConfirm(id: string, label = "Undo") {
  try {
    let r = await undoChange(id);
    if (!r.done) {
      const ok = await confirm({
        title: "Some of this can't be undone now",
        message: (
          <>
            <p>These parts will be left as they are:</p>
            <ul className="conflict-list">
              {r.conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        ),
        confirmLabel: `${label} the rest`,
      });
      if (!ok) return false;
      r = await undoChange(id, true);
    }
    toast(label === "Redo" ? "Redone" : label === "Restore" ? "Restored" : "Undone", "success");
    return true;
  } catch (e) {
    toast(String(e), "error");
    return false;
  }
}

function dayLabel(t: number) {
  const d = new Date(t);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

type Who = "all" | "app" | "mcp";

export function ActivityView({ boardId }: { boardId?: string }) {
  const project = useStore((s) => currentProject(s));
  const boards = useStore(useShallow((s) => orderedBoards(s)));
  const rev = useStore((s) => s.historyRev);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [who, setWho] = useState<Who>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const projectId = project?.project.id;

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    loadHistory({ project: projectId, board: boardId, limit: 300 })
      .then((list) => live && setEntries(list))
      .catch((e) => live && toast(`Could not read the history: ${e}`, "error"));
    return () => {
      live = false;
    };
  }, [projectId, boardId, rev]);

  const groups = useMemo(() => {
    const out: { day: string; items: HistoryEntry[] }[] = [];
    for (const e of entries ?? []) {
      if (who !== "all" && e.by !== who) continue;
      const day = dayLabel(e.t);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [entries, who]);

  if (!project) return null;
  const boardName = boardId ? boards.find((b) => b.id === boardId)?.name : undefined;

  const run = async (e: HistoryEntry) => {
    const redo = e.undone && e.undoneBy;
    setBusy(e.id);
    await undoWithConfirm(redo ? e.undoneBy! : e.id, redo ? "Redo" : "Undo");
    setBusy(null);
  };

  return (
    <div className="issues-view">
      <div className="board-header">
        <div className="board-title">
          <span className="board-name">Activity</span>
          <span className="board-desc">
            Every change to {boardName ? `“${boardName}”` : "this project"}, made here or by an AI agent. Undo any of
            them.
          </span>
        </div>
      </div>

      <div className="issues-filters">
        <div className="segmented">
          <button className={cx(who === "all" && "active")} onClick={() => setWho("all")}>
            Everyone
          </button>
          <button className={cx(who === "app" && "active")} onClick={() => setWho("app")}>
            <User size={14} /> You
          </button>
          <button className={cx(who === "mcp" && "active")} onClick={() => setWho("mcp")}>
            <Bot size={14} /> AI agents
          </button>
        </div>
        <select
          value={boardId ?? ""}
          onChange={(e) => setView({ kind: "activity", boardId: e.target.value || undefined })}
        >
          <option value="">All boards</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {entries === null ? null : groups.length === 0 ? (
        <EmptyState icon={<History size={28} />} title="Nothing here yet">
          <p className="muted">Changes to boards, columns and tasks will show up here as they happen.</p>
        </EmptyState>
      ) : (
        <div className="issues-list activity-list">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="activity-day">{g.day}</div>
              {g.items.map((e) => {
                const expandable = e.details.length > 1;
                const expanded = open === e.id;
                const onBoard = e.board && boards.some((b) => b.id === e.board!.id) && e.tasks.length > 0;
                return (
                  <div key={e.id} className={cx("activity-row", e.undone && "undone", expanded && "expanded")}>
                    <div className="activity-main">
                      <span className={cx("activity-avatar", e.by)} title={clientName(e)}>
                        {e.by === "mcp" ? <Bot size={14} /> : <User size={14} />}
                      </span>
                      <div className="activity-text">
                        <div className="activity-headline">
                          {expandable && (
                            <button
                              className="icon-btn tiny"
                              onClick={() => setOpen(expanded ? null : e.id)}
                              aria-label="Details"
                            >
                              <ChevronRight size={13} className="chevron" />
                            </button>
                          )}
                          {onBoard ? (
                            <button
                              className="link-text"
                              title="Show on the board"
                              onClick={() => showOnBoard(e.board!.id, e.tasks)}
                            >
                              {e.headline}
                            </button>
                          ) : (
                            <span>{e.headline}</span>
                          )}
                          {e.undoes && <span className="activity-tag">undo</span>}
                          {e.undone && <span className="activity-tag">undone</span>}
                        </div>
                        <div className="faint small">
                          {clientName(e)}
                          {e.tool && <span className="mono"> · {e.tool}</span>}
                          {!boardId && e.board && <> · {e.board.name}</>}
                          {" · "}
                          <span title={new Date(e.t).toLocaleString()}>{relativeTime(e.at)}</span>
                        </div>
                      </div>
                      <button
                        className="btn small ghost"
                        disabled={busy === e.id || (e.undone && !e.undoneBy)}
                        onClick={() => run(e)}
                        title={e.undone ? "Apply this change again" : "Revert this change"}
                      >
                        {e.undone ? <Redo2 size={13} /> : <Undo2 size={13} />} {e.undone ? "Redo" : "Undo"}
                      </button>
                    </div>
                    {expanded && (
                      <ul className="activity-details">
                        {e.details.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
