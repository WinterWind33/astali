import { Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  githubAuthOverride,
  githubTokenProblem,
  setGithubAuthOverride,
  setGithubToken,
  toast,
  useStore,
  type GithubAuthOverride,
} from "../lib/store";
import { cx } from "../lib/util";
import { Github } from "./ui";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** One external service in the Connectors tab. New services (GitLab, …) get their own card. */
function ConnectorCard({
  icon,
  name,
  description,
  status,
  active,
  danger,
  children,
}: {
  icon: ReactNode;
  name: string;
  description: ReactNode;
  status: string;
  active: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="connector-card">
      <div className="connector-head">
        <span className="connector-icon">{icon}</span>
        <div className="connector-title">
          <h4>{name}</h4>
          <p className="muted small">{description}</p>
        </div>
        <span className={cx("connector-status", active && "active", danger && "danger")}>{status}</span>
      </div>
      <div className="connector-body">{children}</div>
    </div>
  );
}

function GithubConnector() {
  const saved = useStore((s) => s.config.githubToken);
  const auth = useStore((s) => s.githubAuth);
  const problem = useStore(githubTokenProblem);
  const expired = problem && (auth?.state === "expired" || auth?.state === "ok");
  const daysLeft = auth?.expiresAt ? Math.ceil((Date.parse(auth.expiresAt) - Date.now()) / 86_400_000) : null;
  const [token, setToken] = useState(saved);
  const [show, setShow] = useState(false);

  return (
    <ConnectorCard
      icon={<Github size={20} />}
      name="GitHub"
      description="Issues and labels of the repositories linked to your projects."
      status={problem ? (expired ? "Token expired" : "Token invalid") : saved ? "Token set" : "Public access"}
      active={!!saved && !problem}
      danger={problem}
    >
      <p className="muted small">
        Optional personal access token (read-only scope is enough). Needed for private repos and raises the rate limit
        from 60 to 5000 requests/hour. Kept in your system's credential store (Credential Manager, Keychain or Secret
        Service), never inside the vault.
      </p>
      <div className="input-row">
        <input
          type={show ? "text" : "password"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          spellCheck={false}
        />
        <button className="icon-btn" onClick={() => setShow(!show)} title={show ? "Hide" : "Show"}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          className="btn primary"
          disabled={token === saved}
          onClick={() => {
            setGithubToken(token.trim());
            toast("GitHub token saved", "success");
          }}
        >
          Save
        </button>
      </div>
      {problem ? (
        <p className="connector-error small">
          {expired
            ? `This token expired${auth?.expiresAt ? ` on ${longDate(auth.expiresAt)}` : ""}.`
            : "GitHub no longer accepts this token: it may have been revoked or mistyped."}{" "}
          GitHub issues won't sync until you paste a new one above.
        </p>
      ) : (
        auth?.expiresAt &&
        daysLeft !== null && (
          <p className={cx("small", daysLeft <= 7 ? "connector-warning" : "faint")}>
            Expires on {longDate(auth.expiresAt)}
            {daysLeft <= 7 && ` — in ${daysLeft === 1 ? "a day" : `${daysLeft} days`}`}.
          </p>
        )
      )}
      {import.meta.env.DEV && <DevTokenPicker />}
    </ConnectorCard>
  );
}

/** Dev builds only: forces a token state whatever GitHub says, to try the dots and messages. */
function DevTokenPicker() {
  const [override, setOverride] = useState(githubAuthOverride);
  return (
    <div className="row gap">
      <span className="small faint">Dev: force token state</span>
      <div className="segmented tiny">
        {(["auto", "valid", "expiring", "expired", "invalid"] as GithubAuthOverride[]).map((o) => (
          <button
            key={o}
            className={cx(override === o && "active")}
            onClick={() => {
              setOverride(o);
              setGithubAuthOverride(o);
            }}
          >
            {o[0].toUpperCase() + o.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Settings tab listing every connector. */
export function ConnectorsSettings() {
  return (
    <section>
      <h4>Connectors</h4>
      <p className="muted small">Services Astali reads issues from.</p>
      <div className="connector-list">
        <GithubConnector />
      </div>
    </section>
  );
}
