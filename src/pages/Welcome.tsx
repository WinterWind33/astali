import { FolderOpen, FolderX, Sparkles, X, Zap } from "lucide-react";
import { useEffect } from "react";
import { checkRecentVaults, forgetRecentVault, openRecentVault, pickVault, toast, useStore } from "../lib/store";
import { cx } from "../lib/util";
import { vaultName } from "../lib/vault";
import { Logo, Github } from "../components/ui";
import { WhatsNewBadge } from "../components/WhatsNew";

export function Welcome() {
  const recent = useStore((s) => s.config.recentVaults);
  const names = useStore((s) => s.config.vaultNames);
  const missing = useStore((s) => s.missingVaults);

  // Re-check whenever this screen appears, e.g. after closing a vault.
  useEffect(() => {
    checkRecentVaults();
  }, []);

  return (
    <div className="welcome">
      <div className="welcome-glow" />
      <div className="welcome-card">
        <Logo size={56} />
        <h1>Welcome to Astali</h1>
        <p className="muted">A calm, local-first planner: kanban boards, plans, notes, decisions and more.</p>
        <button className="btn primary large" onClick={() => pickVault().catch((e) => toast(String(e), "error"))}>
          <FolderOpen size={18} />
          Open or create a vault
        </button>

        <div className="welcome-features">
          <div>
            <Zap size={16} />
            <span>Plain JSON files, live-reloaded</span>
          </div>
          <div>
            <Github size={16} />
            <span>Read-only GitHub issue import</span>
          </div>
          <div>
            <Sparkles size={16} />
            <span>Built-in MCP server for Claude</span>
          </div>
        </div>

        {recent.length > 0 && (
          <div className="recent">
            <div className="section-label">Recent vaults</div>
            {recent.map((v) => {
              const isMissing = missing.includes(v);
              return (
                <div key={v} className={cx("recent-item", isMissing && "missing")}>
                  <button
                    className="recent-open"
                    onClick={() => openRecentVault(v).catch((e) => toast(String(e), "error"))}
                    title={isMissing ? "Folder not found. Click to check again." : undefined}
                  >
                    {isMissing ? <FolderX size={15} /> : <FolderOpen size={15} />}
                    <span className="recent-name">{vaultName(v, names)}</span>
                    <span className="recent-path">{v}</span>
                    {isMissing && (
                      <span className="recent-missing-note">
                        This folder can't be found. It may have been renamed, moved or deleted. Remove it from this
                        list, or open it again from its new location.
                      </span>
                    )}
                  </button>
                  {isMissing ? (
                    <button
                      className="recent-remove"
                      onClick={() => forgetRecentVault(v)}
                      title="Remove from recent vaults"
                    >
                      <X size={12} />
                      Remove
                    </button>
                  ) : (
                    <button className="icon-btn small" onClick={() => forgetRecentVault(v)} title="Remove from list">
                      <X size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <WhatsNewBadge place="welcome" />
      </div>
    </div>
  );
}
