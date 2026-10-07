import { getName, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  Bot,
  Check,
  Copy,
  Download,
  FolderOpen,
  GitBranch,
  Info,
  LogOut,
  Monitor,
  Moon,
  Plug,
  RefreshCw,
  ScrollText,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import appIcon from "../../src-tauri/icons/app-icon.svg";
import licenseText from "../../LICENSE?raw";
import { SEASON_LABEL } from "../lib/season";
import {
  checkGithubToken,
  closeVault,
  githubTokenProblem,
  pickVault,
  refreshGit,
  renameVault,
  setCheckForUpdates,
  setSeasonalThemes,
  setTheme,
  toast,
  useStore,
} from "../lib/store";
import { checkForUpdate, fakeUpdate, useUpdate } from "../lib/updater";
import { folderName } from "../lib/vault";
import { setSeasonOverride, type SeasonOverride, useSeason, useSeasonOverride } from "../lib/theme";
import { GitSettings } from "./GitIgnore";
import { cx } from "../lib/util";
import { ConnectorsSettings } from "./Connectors";
import { CreditsSettings } from "./Credits";
import { UpdateDialog } from "./UpdateBadge";
import { RecentReleases } from "./WhatsNew";
import { Modal, ModalHeader } from "./ui";

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <pre>{text}</pre>
      <button
        className="icon-btn small"
        title="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

type SettingsTab = "general" | "git" | "connectors" | "mcp" | "updates" | "about" | "credits";

interface AppInfo {
  name: string;
  version: string;
  tauri: string;
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.config);
  const season = useSeason();
  const vault = useStore((s) => s.vault);
  const git = useStore((s) => s.git);
  const tokenProblem = useStore(githubTokenProblem);
  const update = useUpdate((s) => s.available);
  const [active, setActive] = useState<SettingsTab>("general");
  const [exe, setExe] = useState("astali.exe");
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [showLicense, setShowLicense] = useState(false);

  useEffect(() => {
    invoke<string>("exe_path")
      .then(setExe)
      .catch(() => {});
    Promise.all([getName(), getVersion(), getTauriVersion()])
      .then(([name, version, tauri]) => setInfo({ name, version, tauri }))
      .catch(() => {});
    refreshGit(); // pick up a repo created or a .gitignore edited since the vault was opened
    checkGithubToken(); // or a token that expired or was revoked since
  }, []);

  // The Git tab only exists while the vault is inside a repository.
  const current = active === "git" && !git ? "general" : active;
  const tabs: { id: SettingsTab; label: string; icon: ReactNode; alert?: boolean }[] = [
    { id: "general", label: "General", icon: <SlidersHorizontal size={15} /> },
    ...(git ? [{ id: "git" as const, label: "Git", icon: <GitBranch size={15} /> }] : []),
    { id: "connectors", label: "Connectors", icon: <Plug size={15} />, alert: tokenProblem },
    { id: "mcp", label: "AI integration", icon: <Bot size={15} /> },
    { id: "updates", label: "Updates", icon: <RefreshCw size={15} />, alert: !!update },
    { id: "about", label: "About", icon: <Info size={15} /> },
    { id: "credits", label: "Credits", icon: <ScrollText size={15} /> },
  ];

  return (
    <Modal onClose={onClose} width={780}>
      <ModalHeader title="Settings" onClose={onClose} />
      <div className="settings">
        <nav className="settings-tabs" role="tablist" aria-orientation="vertical">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={current === t.id}
              className={cx("settings-tab", current === t.id && "active")}
              onClick={() => setActive(t.id)}
            >
              {t.icon} {t.label}
              {t.alert && <span className="alert-dot inline" />}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {current === "general" && (
            <>
              <section>
                <h4>Appearance</h4>
                <div className="segmented">
                  <button className={cx(config.theme === "dark" && "active")} onClick={() => setTheme("dark")}>
                    <Moon size={14} /> Dark
                  </button>
                  <button className={cx(config.theme === "light" && "active")} onClick={() => setTheme("light")}>
                    <Sun size={14} /> Light
                  </button>
                  <button className={cx(config.theme === "system" && "active")} onClick={() => setTheme("system")}>
                    <Monitor size={14} /> Sync with system
                  </button>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={config.seasonalThemes}
                    onChange={(e) => setSeasonalThemes(e.target.checked)}
                  />
                  Seasonal themes
                </label>
                <p className="small faint">
                  Halloween all October, Christmas all December, Easter from Palm Sunday to Easter Monday, in dark or
                  light alike.{" "}
                  {season ? `${SEASON_LABEL[season]} is on now.` : config.seasonalThemes ? "No holiday right now." : ""}
                </p>
                {import.meta.env.DEV && <DevSeasonPicker />}
              </section>

              <section>
                <h4>Vault</h4>
                <div className="vault-row">
                  <FolderOpen size={16} />
                  <span className="mono small">{vault ?? "No vault open"}</span>
                </div>
                {vault && <VaultNameField key={vault} vault={vault} />}
                <div className="row gap">
                  <button
                    className="btn"
                    onClick={() =>
                      pickVault()
                        .then(onClose)
                        .catch((e) => toast(String(e), "error"))
                    }
                  >
                    <FolderOpen size={15} /> Switch vault…
                  </button>
                  {vault && (
                    <button
                      className="btn ghost"
                      onClick={() => {
                        closeVault();
                        onClose();
                      }}
                    >
                      <LogOut size={15} /> Close vault
                    </button>
                  )}
                </div>
              </section>
            </>
          )}

          {current === "git" && <GitSettings />}

          {current === "connectors" && <ConnectorsSettings />}

          {current === "mcp" && <AiSettings exe={exe} />}

          {current === "credits" && <CreditsSettings />}

          {current === "updates" && (
            <>
              <UpdateSettings version={info?.version ?? null} />
              <section>
                <h4>What's new</h4>
                <p className="faint small">The last releases of Astali.</p>
                <RecentReleases />
              </section>
            </>
          )}

          {current === "about" && (
            <section className="about">
              <img className="about-icon" src={appIcon} alt="" />
              <div>
                <h3>{info?.name ?? "Astali"}</h3>
                <p className="muted small">A local-first planning app: kanban boards, plans, notes and decisions</p>
                <p className="small about-free">Free and open source — no ads, no paywall.</p>
              </div>
              <dl className="about-facts">
                <dt>Version</dt>
                <dd className="mono">{info?.version ?? "…"}</dd>
                <dt>Tauri</dt>
                <dd className="mono">{info?.tauri ?? "…"}</dd>
                <dt>Executable</dt>
                <dd className="mono">{exe}</dd>
                <dt>Vault</dt>
                <dd className="mono">{vault ?? "No vault open"}</dd>
                <dt>License</dt>
                <dd>
                  MIT ·{" "}
                  <button className="link-btn" onClick={() => setShowLicense(!showLicense)}>
                    {showLicense ? "Hide license" : "View license"}
                  </button>{" "}
                  ·{" "}
                  <button className="link-btn" onClick={() => setActive("credits")}>
                    Third-party credits
                  </button>
                </dd>
              </dl>
              {showLicense && <pre className="credit-text about-license">{licenseText}</pre>}
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The open vault's name, saved with its button; empty means the folder's name. */
function VaultNameField({ vault }: { vault: string }) {
  const saved = useStore((s) => s.config.vaultNames[vault] ?? "");
  const [name, setName] = useState(saved);
  const changed = name.trim() !== saved;
  const save = () =>
    renameVault(name)
      .then(() =>
        toast(name.trim() ? `Vault renamed to “${name.trim()}”` : "Vault goes by its folder's name again", "success"),
      )
      .catch((e) => toast(`Could not rename the vault: ${e}`, "error"));
  return (
    <label className="field vault-name-field">
      <span>
        Name <em className="faint">— stored in the vault; leave empty to use the folder's name</em>
      </span>
      <div className="input-row">
        <input
          value={name}
          placeholder={folderName(vault)}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && changed && save()}
        />
        <button className="btn" disabled={!changed} onClick={save}>
          Save
        </button>
      </div>
    </label>
  );
}

/** The AI integration tab: how to register the MCP server, and which vault it will use. */
function AiSettings({ exe }: { exe: string }) {
  const vault = useStore((s) => s.vault);
  const git = useStore((s) => s.git);
  const [client, setClient] = useState<"code" | "desktop">("code");
  const [scope, setScope] = useState<"all" | "repo">("all");

  // `"--"` is quoted because PowerShell swallows a bare `--` when `claude` is the npm .ps1 shim,
  // which makes claude parse `--vault` as its own option. Quoted, it works in cmd and bash too.
  const claudeCode =
    scope === "all"
      ? `claude mcp add astali --scope user "--" "${exe}" mcp`
      : `claude mcp add astali --scope local "--" "${exe}" mcp --vault "${vault ?? "<vault folder>"}"`;
  const claudeDesktop = JSON.stringify({ mcpServers: { astali: { command: exe, args: ["mcp"] } } }, null, 2);
  const repo = git?.repoRoot;

  return (
    <>
      <section>
        <h4>
          <Bot size={15} /> AI integration (MCP)
        </h4>
        <p className="muted small">
          Astali includes a Model Context Protocol server, so Claude can create and manage projects, boards, columns and
          tasks. Changes show up here live. Register it once:
        </p>
        <div className="segmented small">
          <button className={cx(client === "code" && "active")} onClick={() => setClient("code")}>
            Claude Code
          </button>
          <button className={cx(client === "desktop" && "active")} onClick={() => setClient("desktop")}>
            Claude Desktop
          </button>
        </div>
        {client === "code" ? (
          <>
            <div className="segmented tiny">
              <button className={cx(scope === "all" && "active")} onClick={() => setScope("all")}>
                Every repository
              </button>
              <button className={cx(scope === "repo" && "active")} disabled={!vault} onClick={() => setScope("repo")}>
                This repository only
              </button>
            </div>
            <CopyBlock text={claudeCode} />
            <p className="faint small">
              {scope === "all" ? (
                "Registers Astali for all your projects; each one gets the right vault, as shown below."
              ) : (
                <>
                  Run it in <span className="mono">{repo ?? "the folder you start Claude Code in"}</span>. Claude Code
                  will use this vault there, whatever is open in Astali.
                </>
              )}{" "}
              Registered it before Astali 1.6? Run <span className="mono">claude mcp remove astali --scope user</span>{" "}
              first, or it stays on the vault it was given.
            </p>
          </>
        ) : (
          <>
            <p className="muted small">
              Add to <span className="mono">claude_desktop_config.json</span> (Settings → Developer → Edit config):
            </p>
            <CopyBlock text={claudeDesktop} />
          </>
        )}
      </section>

      <section>
        <h4>Which vault the assistant uses</h4>
        <ul className="vault-rules small">
          <li>
            The one in the repository Claude Code runs in.{" "}
            {repo ? (
              <>
                In <span className="mono">{repo}</span>, that's this vault.
              </>
            ) : (
              "This vault isn't in a repository."
            )}
          </li>
          <li>
            Anywhere else, and in Claude Desktop, the vault open in Astali:{" "}
            {vault ? <span className="mono">{vault}</span> : "none right now"}. Switch vaults here and it follows.
          </li>
          <li>
            Unless it was registered with <span className="mono">--vault</span>, which always wins.
          </li>
        </ul>
        <p className="faint small">
          Ask the assistant to list your projects and it says which vault it's using. Agents can also read{" "}
          <span className="mono">AGENTS.md</span> in the vault for the file format.
        </p>
      </section>
    </>
  );
}

/** Whether Astali looks for a newer version at startup, and a check on demand. */
function UpdateSettings({ version }: { version: string | null }) {
  const checkOnStart = useStore((s) => s.config.checkForUpdates);
  const { supported, checking, available } = useUpdate();
  const [open, setOpen] = useState(false);
  return (
    <section>
      <h4>Updates</h4>
      {version && <p className="small muted">You have Astali {version}.</p>}
      {supported === false && !import.meta.env.DEV ? (
        <p className="small faint">This copy of Astali is updated by your package manager.</p>
      ) : (
        <>
          <label className="toggle">
            <input type="checkbox" checked={checkOnStart} onChange={(e) => setCheckForUpdates(e.target.checked)} />
            Check for updates when Astali starts
          </label>
          <p className="small faint">
            Astali asks GitHub whether a newer version exists. Nothing is downloaded until you choose to update.
          </p>
          <div className="row gap">
            {available ? (
              <button className="btn primary" onClick={() => setOpen(true)}>
                <Download size={15} /> See what's in {available}
              </button>
            ) : (
              <button className="btn" disabled={checking} onClick={() => checkForUpdate(true)}>
                <RefreshCw size={15} className={cx(checking && "spin")} /> Check now
              </button>
            )}
          </div>
          {open && available && <UpdateDialog version={available} onClose={() => setOpen(false)} />}
        </>
      )}
      {import.meta.env.DEV && (
        <div className="row gap">
          <span className="small faint">Dev: fake an update</span>
          <button className="btn small" onClick={() => fakeUpdate()}>
            Works
          </button>
          <button className="btn small" onClick={() => fakeUpdate(true)}>
            Fails halfway
          </button>
        </div>
      )}
    </section>
  );
}

/** Dev builds only: forces a season whatever the date, to work on the palettes. */
function DevSeasonPicker() {
  const override = useSeasonOverride();
  return (
    <div className="row gap">
      <span className="small faint">Dev: force a season</span>
      <div className="segmented tiny">
        {(["auto", "none", "halloween", "christmas", "easter"] as SeasonOverride[]).map((o) => (
          <button key={o} className={cx(override === o && "active")} onClick={() => setSeasonOverride(o)}>
            {o === "auto" ? "Auto" : o === "none" ? "None" : SEASON_LABEL[o]}
          </button>
        ))}
      </div>
    </div>
  );
}
