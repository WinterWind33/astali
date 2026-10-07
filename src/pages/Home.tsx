import {
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
import { EmptyState, Menu, confirm, Github } from "../components/ui";
import { closeVault, deleteProject, loadHistory, openProject, useStore } from "../lib/store";
import type { HistoryEntry, Project } from "../lib/types";
import { colorHex, relativeTime } from "../lib/util";

export function Home() {
  const projects = useStore((s) => s.projects);
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
              <input placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
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
        <EmptyState icon={<FolderKanban size={28} />} title="No projects yet">
          <p className="muted">Create your first project to start organizing work into boards.</p>
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
                    "divider",
                    {
                      label: "Delete project",
                      icon: <Trash2 size={14} />,
                      danger: true,
                      onClick: async () => {
                        const ok = await confirm({
                          title: `Delete “${p.name}”?`,
                          message:
                            "This deletes the project folder with all its boards and tasks. You can restore it from “Recently deleted” on this page.",
                          confirmLabel: "Delete project",
                          danger: true,
                        });
                        if (ok) deleteProject(p.id);
                      },
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
                  <span title={p.repos.map((r) => `${r.owner}/${r.repo}`).join("\n")}>
                    <Github size={13} /> {p.repos.length}
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

      <RecentlyDeleted />

      {dialog && <ProjectDialog project={dialog.project} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Deleted projects that are still in the history, with a way to bring them back. */
function RecentlyDeleted() {
  const rev = useStore((s) => s.historyRev);
  const projects = useStore((s) => s.projects);
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

  const shown = deleted.filter((e) => !projects.some((p) => p.project.id === e.project.id));
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
            deleted by {clientName(e) === "You" ? "you" : clientName(e)} {relativeTime(e.at)}
          </span>
          <span className="spacer" />
          <button className="btn small" onClick={() => undoWithConfirm(e.id, "Restore")}>
            <RotateCcw size={13} /> Restore
          </button>
        </div>
      ))}
    </div>
  );
}
