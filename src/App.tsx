import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { GitConflictDialog } from "./components/GitPanel";
import { SeasonArt } from "./components/SeasonArt";
import { HelpDialog } from "./components/HelpDialog";
import { SearchDialog } from "./components/SearchDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { TitleBar } from "./components/TitleBar";
import { ConfirmHost, Toasts } from "./components/ui";
import { init, pollIssues, refreshFromDisk, refreshRepo, reloadConfig, useStore } from "./lib/store";
import { useResolvedTheme, useSeason } from "./lib/theme";
import { checkForUpdateOnStartup } from "./lib/updater";
import { Home } from "./pages/Home";
import { ProjectPage } from "./pages/ProjectPage";
import { Welcome } from "./pages/Welcome";

export default function App() {
  const ready = useStore((s) => s.ready);
  const vault = useStore((s) => s.vault);
  const route = useStore((s) => s.route);
  const theme = useResolvedTheme();
  const season = useSeason();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    init().then(checkForUpdateOnStartup);
    const unlisten = listen<string[]>("vault-changed", (e) => refreshFromDisk(e.payload));
    const unlistenConfig = listen("config-changed", () => reloadConfig());
    return () => {
      unlisten.then((f) => f());
      unlistenConfig.then((f) => f());
    };
  }, []);

  // Git state changes outside the vault folder too (commits, checkouts, edits to code), which the
  // watcher doesn't see: poll while the window is visible and refresh as soon as it regains focus.
  useEffect(() => {
    if (!vault) return;
    // The same tick checks GitHub for issue and label changes; pollIssues throttles itself to minutes.
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      refreshRepo();
      pollIssues();
    };
    const timer = setInterval(tick, 5000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [vault]);

  // Like a code editor: Ctrl/⌘+Shift+F searches everything, Ctrl/⌘+F the open view (or dialog) through its
  // own search box, marked `data-local-search`. A view without one gets the search of everything.
  useEffect(() => {
    if (!vault) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      if (e.shiftKey) return setSearchOpen(true);
      const modal = document.querySelector(".modal");
      const local = (modal ?? document).querySelector<HTMLInputElement>("input[data-local-search]");
      if (local) {
        local.focus();
        local.select();
      } else if (!modal) setSearchOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vault]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (season) document.documentElement.dataset.season = season;
    else delete document.documentElement.dataset.season;
  }, [season]);

  // Block the webview's default context menu outside text fields — feels more native.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("input, textarea, [contenteditable], .markdown")) e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);

  return (
    <div className="app">
      <TitleBar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <main className="app-main">
        {ready && season && <SeasonArt season={season} variant={!vault || route.name === "home" ? "hero" : "faint"} />}
        {!ready ? null : !vault ? <Welcome /> : route.name === "home" ? <Home /> : <ProjectPage />}
      </main>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {searchOpen && vault && <SearchDialog onClose={() => setSearchOpen(false)} />}
      <GitConflictDialog />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
