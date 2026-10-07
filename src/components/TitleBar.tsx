import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  FolderOpen,
  FolderX,
  Egg,
  Ghost,
  History,
  LayoutGrid,
  LogOut,
  Minus,
  Monitor,
  Moon,
  Pencil,
  Settings,
  Square,
  Sun,
  TreePine,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { flushWrites } from "../lib/fs";
import {
  closeVault,
  currentProject,
  githubTokenProblem,
  goHome,
  openRecentVault,
  pickVault,
  setTheme,
  setView,
  toast,
  useStore,
} from "../lib/store";
import { SEASON_LABEL, type Season } from "../lib/season";
import { useSeason } from "../lib/theme";
import type { Theme } from "../lib/types";
import { colorHex } from "../lib/util";
import { vaultName as nameOf } from "../lib/vault";
import { RepoStatus } from "./RepoStatus";
import { UpdateBadge } from "./UpdateBadge";
import { Logo, Menu, type MenuItem } from "./ui";
import { VaultNameDialog } from "./VaultNameDialog";
import { WhatsNewBadge } from "./WhatsNew";

const THEME_CYCLE: Record<Theme, { next: Theme; label: string; icon: React.ReactNode }> = {
  dark: { next: "light", label: "Dark", icon: <Moon size={15} /> },
  light: { next: "system", label: "Light", icon: <Sun size={15} /> },
  system: { next: "dark", label: "Sync with system", icon: <Monitor size={15} /> },
};

const SEASON_ICON: Record<Season, React.ReactNode> = {
  halloween: <Ghost size={15} />,
  christmas: <TreePine size={15} />,
  easter: <Egg size={15} />,
};

export function TitleBar({ onOpenSettings, onOpenHelp }: { onOpenSettings: () => void; onOpenHelp: () => void }) {
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);
  const vault = useStore((s) => s.vault);
  const route = useStore((s) => s.route);
  const project = useStore((s) => currentProject(s));
  const boards = useStore((s) => s.boards);
  const tokenProblem = useStore(githubTokenProblem);
  const theme = useStore((s) => s.config.theme);
  const recentVaults = useStore((s) => s.config.recentVaults);
  const vaultNames = useStore((s) => s.config.vaultNames);
  const [renaming, setRenaming] = useState(false);
  const missingVaults = useStore((s) => s.missingVaults);
  const season = useSeason();

  useEffect(() => {
    win.isMaximized().then(setMaximized);
    const un = win.onResized(() => win.isMaximized().then(setMaximized));
    return () => {
      un.then((f) => f());
    };
  }, [win]);

  const vaultName = vault && nameOf(vault, vaultNames);
  const view = route.name === "project" ? route.view : null;
  const boardName =
    view?.kind === "board" ? boards[view.boardId]?.board.name : view?.kind === "issues" ? "GitHub issues" : null;
  const themeInfo = THEME_CYCLE[theme] ?? THEME_CYCLE.dark;

  const vaultItems: (MenuItem | "divider")[] = [
    { label: "All projects", icon: <LayoutGrid size={14} />, onClick: goHome },
    "divider",
    {
      label: "Open another vault…",
      icon: <FolderOpen size={14} />,
      onClick: () => pickVault().catch((e) => toast(String(e), "error")),
    },
    ...recentVaults
      .filter((v) => v !== vault)
      .slice(0, 5)
      .map((v): MenuItem => {
        const missing = missingVaults.includes(v);
        return {
          label: nameOf(v, vaultNames) + (missing ? " (not found)" : ""),
          title: missing
            ? `${v}
This folder can't be found. It may have been renamed, moved or deleted.`
            : v,
          icon: missing ? <FolderX size={14} /> : <History size={14} />,
          danger: missing,
          onClick: () => openRecentVault(v).catch((e) => toast(String(e), "error")),
        };
      }),
    "divider",
    { label: "Rename vault…", icon: <Pencil size={14} />, onClick: () => setRenaming(true) },
    { label: "Close vault", icon: <LogOut size={14} />, onClick: () => closeVault() },
  ];

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <button className="titlebar-brand" onClick={() => vault && closeVault()} title="Choose a vault">
          <Logo size={18} />
          <span>Astali</span>
        </button>
        {vaultName && (
          <nav className="crumbs" data-tauri-drag-region>
            <ChevronRight size={14} className="crumb-sep" />
            <Menu
              items={vaultItems}
              trigger={(t) => (
                <button className="crumb" title={`Vault: ${vault}\nSwitch, rename or close it`} {...t}>
                  {vaultName}
                  <ChevronDown size={13} className="crumb-caret" />
                </button>
              )}
            />
            {project && (
              <>
                <ChevronRight size={14} className="crumb-sep" />
                <button
                  className="crumb"
                  onClick={() => {
                    const first = project.project.boardOrder.find((id) => boards[id]);
                    if (first) setView({ kind: "board", boardId: first });
                  }}
                >
                  <span className="dot" style={{ background: colorHex(project.project.color) }} />
                  {project.project.name}
                </button>
              </>
            )}
            {boardName && (
              <>
                <ChevronRight size={14} className="crumb-sep" />
                <span className="crumb current">{boardName}</span>
              </>
            )}
          </nav>
        )}
      </div>
      <div className="titlebar-right">
        <UpdateBadge />
        <WhatsNewBadge />
        <RepoStatus />
        {season && (
          <span
            className="titlebar-tool season-badge"
            title={`${SEASON_LABEL[season]} theme (seasonal themes are on in Settings)`}
          >
            {SEASON_ICON[season]}
          </span>
        )}
        <button
          className="titlebar-tool"
          onClick={() => setTheme(themeInfo.next)}
          title={`Theme: ${themeInfo.label} (click for ${THEME_CYCLE[themeInfo.next].label})`}
        >
          {themeInfo.icon}
        </button>
        <button className="titlebar-tool" onClick={onOpenHelp} title="Help: how Astali works">
          <CircleHelp size={15} />
        </button>
        <button
          className="titlebar-tool"
          onClick={onOpenSettings}
          title={tokenProblem ? "Settings — your GitHub token needs replacing" : "Settings"}
        >
          <Settings size={15} />
          {tokenProblem && <span className="alert-dot" />}
        </button>
        <div className="window-controls">
          <button onClick={() => win.minimize()} aria-label="Minimize">
            <Minus size={16} />
          </button>
          <button onClick={() => win.toggleMaximize()} aria-label="Maximize">
            {maximized ? <Copy size={13} style={{ transform: "scaleX(-1)" }} /> : <Square size={12} />}
          </button>
          <button
            className="close"
            onClick={async () => {
              await flushWrites().catch(() => {});
              win.close();
            }}
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>
      </div>
      {renaming && <VaultNameDialog onClose={() => setRenaming(false)} />}
    </header>
  );
}
