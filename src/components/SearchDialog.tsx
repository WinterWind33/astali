import {
  Archive,
  BookA,
  FolderKanban,
  Kanban,
  Lightbulb,
  ListChecks,
  Search,
  SquareCheck,
  StickyNote,
  Tag,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SEARCH_GROUPS,
  fold,
  queryTokens,
  searchProject,
  snippet,
  type SearchHit,
  type SearchKind,
  type SearchSource,
} from "../lib/search";
import { openProject, setView, toast, useStore } from "../lib/store";
import { decisionList } from "../lib/tags";
import type { ProjectView } from "../lib/types";
import { cx, MOD_KEY } from "../lib/util";
import { loadBoards, loadDecisions } from "../lib/vault";
import { Modal } from "./ui";

/** Hits shown per group before "Show more". */
const GROUP_LIMIT = 5;

const KIND_ICON: Record<SearchKind, ReactNode> = {
  task: <SquareCheck size={15} />,
  note: <StickyNote size={15} />,
  plan: <ListChecks size={15} />,
  decision: <Lightbulb size={15} />,
  term: <BookA size={15} />,
  tag: <Tag size={15} />,
  board: <Kanban size={15} />,
};

/** The title bar's search box: opens the search dialog. */
export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="titlebar-search" onClick={onClick} title={`Search everything (${MOD_KEY}+Shift+F)`}>
      <Search size={13} />
      <span>Search</span>
      <kbd>{MOD_KEY}+Shift+F</kbd>
    </button>
  );
}

/** The other projects of the vault, read from disk once per dialog (the store holds only the open one). */
function useOtherProjects(enabled: boolean, except: string | null): SearchSource[] | null {
  const vault = useStore((s) => s.vault);
  const projects = useStore((s) => s.projects);
  const [sources, setSources] = useState<SearchSource[] | null>(null);
  useEffect(() => {
    if (!enabled || !vault || sources) return;
    let live = true;
    Promise.all(
      projects
        .filter((p) => p.project.id !== except)
        .map(async ({ project, dir }) => {
          const [boards, decisions] = await Promise.all([loadBoards(vault, dir), loadDecisions(vault, dir)]);
          return {
            projectId: project.id,
            projectName: project.name,
            boards: boards.map((e) => e.board).filter((b) => !b.archivedAt),
            decisions: decisionList(decisions),
          };
        }),
    )
      .then((s) => live && setSources(s))
      .catch((e) => toast(`Could not read the other projects: ${e}`, "error"));
    return () => {
      live = false;
    };
  }, [enabled, vault, projects, except, sources]);
  return enabled ? sources : [];
}

/** `text` with the query's words marked, when folding keeps it the same length. */
function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  const folded = fold(text);
  if (folded.length !== text.length || !tokens.length) return <>{text}</>;
  const marks = new Array<boolean>(text.length).fill(false);
  for (const t of tokens)
    for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + 1)) marks.fill(true, i, i + t.length);
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && marks[j] === marks[i]) j++;
    parts.push(marks[i] ? <mark key={i}>{text.slice(i, j)}</mark> : text.slice(i, j));
    i = j;
  }
  return <>{parts}</>;
}

/** Shows a hit where it lives, opening its project first when it's another one. */
async function openHit(hit: SearchHit) {
  const route = useStore.getState().route;
  if (route.name !== "project" || route.projectId !== hit.projectId) {
    await openProject(hit.projectId, hit.view);
  } else if (hit.view.kind === "board" && JSON.stringify(route.view) === JSON.stringify(hit.view)) {
    // Already there: step off the step, note or archived task for a moment, so it is brought into view again.
    const view: ProjectView = hit.view;
    setView({ kind: "board", boardId: hit.view.boardId });
    setTimeout(() => setView(view));
  } else {
    setView(hit.view);
  }
  if (hit.task) useStore.setState({ pendingTask: hit.task });
}

/**
 * Search the project (or every project of the vault) from one place: tasks, notes, plans, decisions,
 * glossary terms, tags and boards. A result opens where it lives.
 */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const route = useStore((s) => s.route);
  const projects = useStore((s) => s.projects);
  const boards = useStore((s) => s.boards);
  const decisions = useStore((s) => s.decisions);
  const currentId = route.name === "project" ? route.projectId : null;
  const [query, setQuery] = useState("");
  // On the home page there is no project open, so search covers them all.
  const [allChoice, setAllChoice] = useState(false);
  const all = allChoice || !currentId;
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<Set<SearchKind>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(query);
  const others = useOtherProjects(all, currentId);

  const current = useMemo((): SearchSource | null => {
    const p = projects.find((x) => x.project.id === currentId);
    if (!p) return null;
    return {
      projectId: p.project.id,
      projectName: p.project.name,
      boards: Object.values(boards).map((e) => e.board),
      decisions: decisionList(decisions),
    };
  }, [projects, currentId, boards, decisions]);

  const tokens = useMemo(() => queryTokens(deferred), [deferred]);
  const groups = useMemo(() => {
    const sources = [...(current ? [current] : []), ...(others ?? [])];
    const names = new Map(sources.map((s) => [s.projectId, s.projectName]));
    const hits = sources.flatMap((s) => searchProject(s, deferred));
    if (sources.length > 1) for (const h of hits) h.where = `${names.get(h.projectId)} › ${h.where}`;
    // A stable sort keeps the current project's hits first among equals.
    hits.sort((a, b) => b.score - a.score);
    return SEARCH_GROUPS.map((g) => ({ ...g, hits: hits.filter((h) => h.kind === g.kind) })).filter(
      (g) => g.hits.length,
    );
  }, [current, others, deferred]);

  const shown = groups.map((g) => ({
    ...g,
    visible: expanded.has(g.kind) ? g.hits : g.hits.slice(0, GROUP_LIMIT),
  }));
  const flat = shown.flatMap((g) => g.visible);
  const total = groups.reduce((n, g) => n + g.hits.length, 0);

  useEffect(() => {
    setActive(0);
    setExpanded(new Set());
  }, [deferred, all]);

  useEffect(() => {
    listRef.current?.querySelector(".search-hit.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const open = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onClose();
    openHit(hit).catch((e) => toast(String(e), "error"));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = flat.length;
      if (n) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(flat[active]);
    }
  };

  const loading = all && others === null;
  let index = -1;

  return (
    <Modal onClose={onClose} width={640} className="search-dialog">
      <div className="search-dialog-head">
        <Search size={17} />
        <input
          autoFocus
          data-local-search
          placeholder={all ? "Search every project" : "Search this project"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
        {currentId && projects.length > 1 && (
          <label className="search-scope" title="Also look through the vault's other projects">
            <input type="checkbox" checked={allChoice} onChange={(e) => setAllChoice(e.target.checked)} />
            All projects
          </label>
        )}
      </div>
      <div className="search-results" ref={listRef}>
        {!tokens.length ? (
          <div className="search-empty">
            Tasks, archived ones too, notes, plan steps and items, decisions, glossary terms, tags and boards.
          </div>
        ) : loading ? (
          <div className="search-empty">Reading the other projects…</div>
        ) : total === 0 ? (
          <div className="search-empty">Nothing matches “{deferred.trim()}”.</div>
        ) : (
          shown.map((g) => (
            <section key={g.kind} className="search-group">
              <h4>
                {g.title} <span className="faint">{g.hits.length}</span>
              </h4>
              {g.visible.map((h) => {
                const i = ++index;
                const excerpt = h.matched && snippet(tokens, h.matched);
                return (
                  <button
                    key={h.key}
                    className={cx("search-hit", i === active && "active", h.faded && "faded")}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => open(h)}
                  >
                    <span className="search-hit-icon">
                      {h.key.startsWith("archived:") ? <Archive size={15} /> : KIND_ICON[h.kind]}
                    </span>
                    <span className="search-hit-main">
                      <span className="search-hit-title">
                        <Highlight text={h.title} tokens={tokens} />
                      </span>
                      {excerpt && (
                        <span className="search-hit-snippet">
                          <Highlight text={excerpt} tokens={tokens} />
                        </span>
                      )}
                    </span>
                    <span className="search-hit-where">
                      {h.projectId !== currentId && <FolderKanban size={12} />}
                      {h.where}
                    </span>
                  </button>
                );
              })}
              {g.hits.length > g.visible.length && (
                <button className="search-more" onClick={() => setExpanded(new Set(expanded).add(g.kind))}>
                  Show {g.hits.length - g.visible.length} more
                </button>
              )}
            </section>
          ))
        )}
      </div>
      <div className="search-foot faint small">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> to move
        </span>
        <span>
          <kbd>Enter</kbd> to open
        </span>
        <span>
          <kbd>Esc</kbd> to close
        </span>
      </div>
    </Modal>
  );
}
