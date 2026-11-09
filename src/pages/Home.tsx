import {
  Archive,
  FolderKanban,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clientName, undoWithConfirm } from "../components/ActivityView";
import { GitBanner } from "../components/GitIgnore";
import { ProjectDialog } from "../components/ProjectDialog";
import { EmptyState, Menu, confirm, Github, Gitlab } from "../components/ui";
import {
  archiveProject,
  closeVault,
  deleteProject,
  loadHistory,
  openProject,
  purgeDeletedProject,
  restoreProject,
  useStore,
} from "../lib/store";
import type { HistoryEntry, Project } from "../lib/types";
import { colorHex, relativeTime, repoKey, repoPath } from "../lib/util";

/** How long a deleted project can be restored; matches `RESTORE_WINDOW_MS` in history.rs. */
const RESTORE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

async function confirmDelete(p: Project) {
  const ok = await confirm({
    title: `Delete “${p.name}”?`,
    message: `This deletes the project folder with all its boards and tasks. You can restore it from “Recently deleted” on this page for ${RESTORE_DAYS} days; after that it is permanently deleted.`,
    confirmLabel: "Delete project",
    danger: true,
  });
  if (ok) deleteProject(p.id);
}

async function confirmPurge(id: string, name: string) {
  const ok = await confirm({
    title: `Permanently delete “${name}”?`,
    message: "This removes the project and its history from this vault right away. It can't be restored afterwards.",
    confirmLabel: "Delete now",
    danger: true,
  });
  if (ok) purgeDeletedProject(id, name);
}

export function Home() {
  const projects = useStore((s) => s.projects);
  const hasArchived = useStore((s) => s.archivedProjects.length > 0);
  const vault = useStore((s) => s.vault);
  const [dialog, setDialog] = useState<{ project?: Project } | null>(null);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? projects.filter((p) => `${p.project.name} ${p.project.description}`.toLowerCase().includes(q))
      : projects;
  }, [projects, query]);

  return (
    <div className="home">
      <div className="home-header">
        <div>
          <h1>Projects</h1>
          <p className="muted mono small">{vault}</p>
        </div>
        <div className="home-actions">
          {projects.length > 3 && (
            <label className="search">
              <Search size={15} />
              <input
                data-local-search
                placeholder="Search projects"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          <button className="btn ghost" onClick={() => closeVault()} title="Close this vault and choose another">
            <LogOut size={15} /> Close vault
          </button>
          <button className="btn primary" onClick={() => setDialog({})}>
            <Plus size={16} /> New project
          </button>
        </div>
      </div>

      <GitBanner />

      {projects.length === 0 ? (
        <EmptyState icon={<FolderKanban size={28} />} title={hasArchived ? "No active projects" : "No projects yet"}>
          <p className="muted">
            {hasArchived
              ? "Your archived projects are below. Create a new one, or restore one to keep working on it."
              : "Create your first project to start organizing work into boards."}
          </p>
          <button className="btn primary" onClick={() => setDialog({})}>
            <Plus size={16} /> Create a project
          </button>
        </EmptyState>
      ) : (
        <div className="project-grid">
          {shown.map(({ project: p }) => (
            <div
              key={p.id}
              className="project-card"
              style={{ "--c": colorHex(p.color) } as React.CSSProperties}
              onClick={() => openProject(p.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && openProject(p.id)}
            >
              <div className="project-card-top">
                <div className="project-avatar">{p.name.slice(0, 1).toUpperCase()}</div>
                <Menu
                  align="right"
                  trigger={(t) => (
                    <button className="icon-btn small card-menu" {...t}>
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                  items={[
                    { label: "Edit project", icon: <Pencil size={14} />, onClick: () => setDialog({ project: p }) },
                    { label: "Archive project", icon: <Archive size={14} />, onClick: () => archiveProject(p.id) },
                    "divider",
                    {
                      label: "Delete project",
                      icon: <Trash2 size={14} />,
                      danger: true,
                      onClick: () => confirmDelete(p),
                    },
                  ]}
                />
              </div>
              <h3>{p.name}</h3>
              <p className="project-desc">{p.description || <span className="faint">No description</span>}</p>
              <div className="project-meta">
                <span>
                  <LayoutGrid size={13} /> {p.boardOrder.length} {p.boardOrder.length === 1 ? "board" : "boards"}
                </span>
                {p.repos.length > 0 && (
                  <span title={p.repos.map((r) => repoPath(repoKey(r))).join("\n")}>
                    {p.repos.every((r) => r.provider === "gitlab") ? <Gitlab size={13} /> : <Github size={13} />}{" "}
                    {p.repos.length}
                  </span>
                )}
                <span className="spacer" />
                <span className="faint">{relativeTime(p.updatedAt)}</span>
              </div>
            </div>
          ))}
          <button className="project-card new" onClick={() => setDialog({})}>
            <Plus size={22} />
            <span>New project</span>
          </button>
        </div>
      )}

      <ArchivedProjects />
      <RecentlyDeleted />

      {dialog && <ProjectDialog project={dialog.project} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Projects put away from the grid, most recently archived first. */
function ArchivedProjects() {
  const archived = useStore((s) => s.archivedProjects);
  if (!archived.length) return null;
  const sorted = archived.map((e) => e.project).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  return (
    <div className="recently-deleted">
      <div className="sidebar-label">
        <span>Archived</span>
      </div>
      {sorted.map((p) => (
        <div key={p.id} className="recently-deleted-row">
          <Archive size={14} className="faint" />
          <span className="recently-deleted-name">{p.name}</span>
          <span className="faint small">archived {relativeTime(p.archivedAt ?? p.updatedAt)}</span>
          <span className="spacer" />
          <button className="btn small" onClick={() => restoreProject(p.id)}>
            <RotateCcw size={13} /> Restore
          </button>
          <button
            className="icon-btn small"
            title="Delete project"
            aria-label="Delete"
            onClick={() => confirmDelete(p)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** "in 12 days", counted from the later of the deletion and the day the 30-day rule reached this vault. */
function timeLeft(deletedAt: number, since: number) {
  const days = Math.ceil((Math.max(deletedAt, since) + RESTORE_DAYS * DAY_MS - Date.now()) / DAY_MS);
  return days <= 0 ? "soon" : days === 1 ? "in 1 day" : `in ${days} days`;
}

/** Deleted projects that are still in the history, with a way to bring them back. */
function RecentlyDeleted() {
  const rev = useStore((s) => s.historyRev);
  const projects = useStore((s) => s.projects);
  const archived = useStore((s) => s.archivedProjects);
  const since = useStore((s) => (s.vault ? (s.config.deletedProjectsSince[s.vault] ?? 0) : 0));
  const [deleted, setDeleted] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let live = true;
    loadHistory({ limit: 2000 })
      .then((list) => live && setDeleted(list.filter((e) => e.ops.includes("project.delete") && !e.undone)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rev]);

  const shown = deleted.filter((e) => ![...projects, ...archived].some((p) => p.project.id === e.project.id));
  if (!shown.length) return null;
  return (
    <div className="recently-deleted">
      <div className="sidebar-label">
        <span>Recently deleted</span>
      </div>
      {shown.slice(0, 8).map((e) => (
        <div key={e.id} className="recently-deleted-row">
          <Trash2 size={14} className="faint" />
          <span className="recently-deleted-name">{e.project.name}</span>
          <span className="faint small">
            deleted by {clientName(e) === "You" ? "you" : clientName(e)} {relativeTime(e.at)} ·{" "}
            <span className="recently-deleted-expiry">permanently deleted {timeLeft(e.t, since)}</span>
          </span>
          <span className="spacer" />
          <button className="btn small" onClick={() => undoWithConfirm(e.id, "Restore")}>
            <RotateCcw size={13} /> Restore
          </button>
          <button className="btn small danger" onClick={() => confirmPurge(e.project.id, e.project.name)}>
            <Trash2 size={13} /> Delete now
          </button>
        </div>
      ))}
    </div>
  );
}
