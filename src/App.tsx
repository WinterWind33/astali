import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { SeasonArt } from "./components/SeasonArt";
import { HelpDialog } from "./components/HelpDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { TitleBar } from "./components/TitleBar";
import { ConfirmHost, Toasts } from "./components/ui";
import { init, pollIssues, refreshFromDisk, refreshRepo, useStore } from "./lib/store";
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

  useEffect(() => {
    init().then(checkForUpdateOnStartup);
    const unlisten = listen<string[]>("vault-changed", (e) => refreshFromDisk(e.payload));
    return () => {
      unlisten.then((f) => f());
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
      <TitleBar onOpenSettings={() => setSettingsOpen(true)} onOpenHelp={() => setHelpOpen(true)} />
      <main className="app-main">
        {ready && season && <SeasonArt season={season} variant={!vault || route.name === "home" ? "hero" : "faint"} />}
        {!ready ? null : !vault ? <Welcome /> : route.name === "home" ? <Home /> : <ProjectPage />}
      </main>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
