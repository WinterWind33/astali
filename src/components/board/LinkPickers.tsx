import { Layers, Milestone, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { allEpics, epicLabel, epicSummary } from "../../lib/epics";
import { allMergeRequests, listedKey, mergeRequestSign } from "../../lib/mergeRequests";
import { milestoneProgress, milestoneSummary } from "../../lib/milestones";
import { useStore } from "../../lib/store";
import type { GhIssue, GhMilestone, GlEpic, Provider } from "../../lib/types";
import { cx, isGitlab, repoName } from "../../lib/util";
import { FetchUnlisted } from "../FetchUnlisted";
import { IssueStateIcon } from "../ui";

const ofProvider = (repo: string, provider?: Provider) => !provider || isGitlab(repo) === (provider === "gitlab");

/**
 * Picks a cached issue, or with `mergeRequests` a merge or pull request, of one host when `provider`
 * is given, leaving out `exclude` (`listedKey`s). `fetchUnlisted` also offers the numbers a capped
 * GitLab sync left out: only for tasks, whose links later syncs keep.
 */
export function IssuePicker({
  onPick,
  mergeRequests = false,
  fetchUnlisted = false,
  provider,
  exclude,
}: {
  onPick: (i: GhIssue) => void;
  mergeRequests?: boolean;
  fetchUnlisted?: boolean;
  provider?: Provider;
  exclude?: string[];
}) {
  const issues = useStore((s) => s.issues);
  const [q, setQ] = useState("");
  const noun = !mergeRequests ? "issues" : provider === "github" ? "pull requests" : "merge requests";
  const all = useMemo(
    () =>
      (mergeRequests
        ? allMergeRequests(issues)
        : Object.values(issues.repos)
            .flatMap((r) => r.issues)
            .filter((i) => !i.isPullRequest)
      ).filter((i) => ofProvider(i.repo, provider) && !exclude?.includes(listedKey(i))),
    [issues, mergeRequests, provider, exclude],
  );
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^[#!]/, "");
    return all
      .filter((i) => !s || i.title.toLowerCase().includes(s) || String(i.number).startsWith(s))
      .sort((a, b) => (a.state === b.state ? b.updatedAt.localeCompare(a.updatedAt) : a.state === "open" ? -1 : 1))
      .slice(0, 50);
  }, [all, q]);

  return (
    <div className="issue-picker">
      <label className="search">
        <Search size={14} />
        <input
          autoFocus
          placeholder={`Search ${noun} by title or #number`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div className="issue-picker-list">
        {all.length === 0 && <div className="faint small pad">No cached {noun}. Sync from the sidebar first.</div>}
        {shown.map((i) => (
          <button key={`${i.repo}#${i.number}`} className="issue-picker-item" onClick={() => onPick(i)}>
            <IssueStateIcon issue={i} size={14} />
            <span className="issue-picker-title">{i.title}</span>
            <span className="faint small">
              {mergeRequests ? mergeRequestSign(i.repo) : "#"}
              {i.number}
            </span>
          </button>
        ))}
        {fetchUnlisted && <FetchUnlisted query={q} mergeRequest={mergeRequests} onFetched={onPick} />}
      </div>
    </div>
  );
}

/** The cached milestones of one host's repositories, open ones first, except those of `takenRepos`. */
export function MilestonePicker({
  provider,
  takenRepos,
  onPick,
}: {
  provider: Provider;
  takenRepos: string[];
  onPick: (m: GhMilestone) => void;
}) {
  const issues = useStore((s) => s.issues);
  const [q, setQ] = useState("");
  const all = useMemo(
    () =>
      Object.values(issues.repos)
        .flatMap((r) => r.milestones ?? [])
        .filter((m) => ofProvider(m.repo, provider) && !takenRepos.includes(m.repo)),
    [issues, provider, takenRepos],
  );
  const multiRepo = new Set(all.map((m) => m.repo)).size > 1;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter((m) => !s || m.title.toLowerCase().includes(s))
      .sort((a, b) => (a.state === b.state ? a.title.localeCompare(b.title) : a.state === "open" ? -1 : 1));
  }, [all, q]);

  return (
    <div className="issue-picker">
      <label className="search">
        <Search size={14} />
        <input autoFocus placeholder="Search milestones" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="issue-picker-list">
        {all.length === 0 && <div className="faint small pad">No cached milestones. Sync from the sidebar first.</div>}
        {shown.map((m) => (
          <button
            key={`${m.repo}#${m.number}`}
            className={cx("issue-picker-item", m.state === "closed" && "faint")}
            onClick={() => onPick(m)}
            title={milestoneSummary(m)}
          >
            <Milestone size={14} />
            <span className="issue-picker-title">{m.title}</span>
            <span className="faint small">
              {multiRepo ? `${repoName(m.repo)} · ` : ""}
              {m.state === "closed" ? "closed" : `${milestoneProgress(m)}%`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The cached GitLab epics of the project's groups, open ones first, except those of `takenGroups`. */
export function EpicPicker({ takenGroups, onPick }: { takenGroups: string[]; onPick: (e: GlEpic) => void }) {
  const issues = useStore((s) => s.issues);
  const [q, setQ] = useState("");
  const all = useMemo(() => allEpics(issues).filter((e) => !takenGroups.includes(e.group)), [issues, takenGroups]);
  const multiGroup = new Set(all.map((e) => e.group)).size > 1;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^&/, "");
    return all.filter((e) => !s || e.title.toLowerCase().includes(s) || String(e.iid).startsWith(s));
  }, [all, q]);

  return (
    <div className="issue-picker">
      <label className="search">
        <Search size={14} />
        <input
          autoFocus
          placeholder="Search epics by title or &number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div className="issue-picker-list">
        {shown.map((e) => (
          <button
            key={`${e.group}&${e.iid}`}
            className={cx("issue-picker-item", e.state === "closed" && "faint")}
            onClick={() => onPick(e)}
            title={epicSummary(issues, e)}
          >
            <Layers size={14} />
            <span className="issue-picker-title">{e.title}</span>
            <span className="faint small">
              {multiGroup ? epicLabel(e) : `&${e.iid}`}
              {e.state === "closed" ? " · closed" : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
