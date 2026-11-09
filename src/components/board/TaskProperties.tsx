import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Calendar,
  CircleDot,
  GitPullRequest,
  Layers,
  Link2Off,
  Milestone,
  Palette,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { allEpics, epicLabel, epicSummary, findEpic } from "../../lib/epics";
import {
  findMergeRequest,
  mergeRequestKey,
  mergeRequestLabel,
  mergeRequestSummary,
  mergeRequestUrl,
} from "../../lib/mergeRequests";
import { findMilestone, milestoneProgress, milestoneSummary } from "../../lib/milestones";
import { currentProject, useStore } from "../../lib/store";
import {
  epicsPatch,
  issuesPatch,
  mergeRequestsPatch,
  milestonesPatch,
  taskEpics,
  taskIssues,
  taskMergeRequests,
  taskMilestones,
} from "../../lib/taskRefs";
import type { EpicRef, GhIssue, IssueRef, MilestoneRef, Provider, Task } from "../../lib/types";
import { colorHex, cx, isGitlab, isPreset, issueKey, issueUrl, repoKey, repoName } from "../../lib/util";
import { ColorPicker } from "../ColorPicker";
import { Github, Gitlab, IssueStateIcon, Popover, ProviderMark } from "../ui";
import { EpicPicker, IssuePicker, MilestonePicker } from "./LinkPickers";

type Fields = Pick<
  Task,
  | "title"
  | "dueDate"
  | "color"
  | "issue"
  | "moreIssues"
  | "mergeRequest"
  | "moreMergeRequests"
  | "milestone"
  | "moreMilestones"
  | "epic"
  | "moreEpics"
>;
type Kind = "issue" | "mergeRequest" | "milestone" | "epic";

const PROVIDERS: Provider[] = ["github", "gitlab"];
const PROVIDER_LABEL: Record<Provider, string> = { github: "GitHub", gitlab: "GitLab" };
const providerOf = (repo: string): Provider => (isGitlab(repo) ? "gitlab" : "github");
const sameRef = (a: IssueRef, b: IssueRef) => a.repo === b.repo && a.number === b.number;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The task's optional properties, grouped by topic, and the menu that adds more: planning fields, and
 * what the project's linked hosts offer. A property shows once it has a value.
 */
export function TaskProperties({ draft, update }: { draft: Fields; update: (patch: Partial<Fields>) => void }) {
  const cache = useStore((s) => s.issues);
  const repos = useStore((s) => currentProject(s)?.project.repos);
  const [addAnchor, setAddAnchor] = useState<DOMRect | null>(null);
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null);
  const [picker, setPicker] = useState<{ kind: Kind; provider: Provider; anchor: DOMRect } | null>(null);
  // Due date is added empty, then filled in; the others are added by picking a value.
  const [dueAdded, setDueAdded] = useState(false);

  const issues = taskIssues(draft);
  const mergeRequests = taskMergeRequests(draft);
  const milestones = taskMilestones(draft);
  const epics = taskEpics(draft);
  const hasPlanning = draft.dueDate || dueAdded || draft.color;

  const issueKeys = useMemo(() => issues.map(issueKey), [draft.issue, draft.moreIssues]);
  const mergeRequestKeys = useMemo(
    () => mergeRequests.map(mergeRequestKey),
    [draft.mergeRequest, draft.moreMergeRequests],
  );
  const takenRepos = useMemo(() => milestones.map((m) => m.repo), [draft.milestone, draft.moreMilestones]);
  const takenGroups = useMemo(() => epics.map((e) => e.group), [draft.epic, draft.moreEpics]);

  const projectRepos = (repos ?? []).map(repoKey);
  const hostRepos = (p: Provider) => projectRepos.filter((r) => providerOf(r) === p);
  const hosts = PROVIDERS.filter((p) => hostRepos(p).length > 0);
  const canAddEpic = allEpics(cache).some((e) => !takenGroups.includes(e.group));

  const linkIssue = (i: GhIssue) => {
    setPicker(null);
    if (issues.some((x) => sameRef(x, i))) return;
    // A GitLab issue in an epic brings the epic along, unless the task already has one of that group.
    const epic = i.epic && !takenGroups.includes(i.epic.group) ? { group: i.epic.group, iid: i.epic.iid } : null;
    update({
      ...issuesPatch([...issues, { repo: i.repo, number: i.number }]),
      ...(epic ? epicsPatch([...epics, epic]) : {}),
      ...(draft.title === "Untitled" || !draft.title ? { title: i.title } : {}),
    });
  };

  const unlinkIssue = (r: IssueRef) => update(issuesPatch(issues.filter((x) => !sameRef(x, r))));
  const unlinkMergeRequest = (r: IssueRef) => update(mergeRequestsPatch(mergeRequests.filter((x) => !sameRef(x, r))));
  const unlinkMilestone = (r: MilestoneRef) => update(milestonesPatch(milestones.filter((x) => !sameRef(x, r))));
  const unlinkEpic = (r: EpicRef) => update(epicsPatch(epics.filter((x) => x.group !== r.group || x.iid !== r.iid)));

  /** Closes the menu and runs the chosen entry from where the menu was opened. */
  const choose = (run: (anchor: DOMRect) => void) => () => {
    const anchor = addAnchor;
    setAddAnchor(null);
    if (anchor) run(anchor);
  };
  const addLink = (kind: Kind, provider: Provider) => choose((anchor) => setPicker({ kind, provider, anchor }));

  const planningItems: MenuItem[] = [
    ...(draft.dueDate || dueAdded
      ? []
      : [{ key: "due", icon: <Calendar size={14} />, label: "Due date", run: choose(() => setDueAdded(true)) }]),
    ...(draft.color
      ? []
      : [{ key: "color", icon: <Palette size={14} />, label: "Color", run: choose(setColorAnchor) }]),
  ];
  const hostItems = (p: Provider): MenuItem[] => {
    const freeRepo = hostRepos(p).some((r) => !takenRepos.includes(r));
    return [
      { key: "issue", icon: <CircleDot size={14} />, label: "Issue", run: addLink("issue", p) },
      {
        key: "mr",
        icon: <GitPullRequest size={14} />,
        label: p === "github" ? "Pull request" : "Merge request",
        run: addLink("mergeRequest", p),
      },
      ...(freeRepo
        ? [{ key: "milestone", icon: <Milestone size={14} />, label: "Milestone", run: addLink("milestone", p) }]
        : []),
      ...(p === "gitlab" && canAddEpic
        ? [{ key: "epic", icon: <Layers size={14} />, label: "Epic", run: addLink("epic", p) }]
        : []),
    ];
  };

  return (
    <>
      {hasPlanning && (
        <div className="prop">
          <div className="prop-label">
            <SlidersHorizontal size={14} /> Planning
          </div>
          {(draft.dueDate || dueAdded) && (
            <div className="input-row">
              <Calendar size={14} className="faint" />
              <input
                type="date"
                aria-label="Due date"
                autoFocus={dueAdded && !draft.dueDate}
                value={draft.dueDate ?? ""}
                onChange={(e) => update({ dueDate: e.target.value || null })}
              />
              <button
                className="icon-btn small"
                title="Remove due date"
                onClick={() => {
                  update({ dueDate: null });
                  setDueAdded(false);
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {draft.color && (
            <div className="task-color-row">
              <button className="btn small" onClick={(e) => setColorAnchor(e.currentTarget.getBoundingClientRect())}>
                <span className="task-color-dot" style={{ "--c": colorHex(draft.color) } as React.CSSProperties} />
                {isPreset(draft.color) ? capitalize(draft.color) : draft.color}
              </button>
              <button className="icon-btn small" onClick={() => update({ color: null })} title="No color">
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {PROVIDERS.map((p) => {
        const hostIssues = issues.filter((r) => providerOf(r.repo) === p);
        const hostMergeRequests = mergeRequests.filter((r) => providerOf(r.repo) === p);
        const hostMilestones = milestones.filter((r) => providerOf(r.repo) === p);
        const hostEpics = p === "gitlab" ? epics : [];
        if (!hostIssues.length && !hostMergeRequests.length && !hostMilestones.length && !hostEpics.length) return null;
        return (
          <div className="prop" key={p}>
            <div className="prop-label">
              {p === "gitlab" ? <Gitlab size={14} /> : <Github size={14} />} {PROVIDER_LABEL[p]}
            </div>
            <LinkKind one="Issue" many="Issues" count={hostIssues.length}>
              {hostIssues.map((r) => (
                <IssueLink key={issueKey(r)} link={r} onUnlink={() => unlinkIssue(r)} />
              ))}
            </LinkKind>
            <LinkKind
              one={p === "github" ? "Pull request" : "Merge request"}
              many={p === "github" ? "Pull requests" : "Merge requests"}
              count={hostMergeRequests.length}
            >
              {hostMergeRequests.map((r) => (
                <MergeRequestLink key={mergeRequestKey(r)} link={r} onUnlink={() => unlinkMergeRequest(r)} />
              ))}
            </LinkKind>
            <LinkKind one="Milestone" many="Milestones" count={hostMilestones.length}>
              {hostMilestones.map((r) => (
                <MilestoneLink key={issueKey(r)} link={r} onUnlink={() => unlinkMilestone(r)} />
              ))}
            </LinkKind>
            <LinkKind one="Epic" many="Epics" count={hostEpics.length}>
              {hostEpics.map((r) => (
                <EpicLink key={epicLabel(r)} link={r} onUnlink={() => unlinkEpic(r)} />
              ))}
            </LinkKind>
          </div>
        );
      })}

      <button className="btn small full" onClick={(e) => setAddAnchor(e.currentTarget.getBoundingClientRect())}>
        <Plus size={14} /> Add property
      </button>

      {addAnchor && (
        <Popover anchor={addAnchor} align="right" onClose={() => setAddAnchor(null)}>
          <div className="board-column-picker">
            <MenuGroup title="Planning" items={planningItems} />
            {hosts.map((p) => (
              <MenuGroup key={p} title={PROVIDER_LABEL[p]} items={hostItems(p)} />
            ))}
            {hosts.length === 0 && (
              <div className="faint small pad">
                Link a GitHub or GitLab repository in project settings to add issues, merge requests and milestones.
              </div>
            )}
          </div>
        </Popover>
      )}
      {colorAnchor && (
        <Popover anchor={colorAnchor} align="right" onClose={() => setColorAnchor(null)}>
          <div className="popover-pad">
            <ColorPicker
              value={draft.color ?? null}
              onChange={(c, picked) => {
                update({ color: c });
                if (picked) setColorAnchor(null);
              }}
            />
          </div>
        </Popover>
      )}
      {picker && (
        <Popover anchor={picker.anchor} align="right" onClose={() => setPicker(null)}>
          {picker.kind === "issue" && (
            <IssuePicker
              provider={picker.provider}
              exclude={issueKeys}
              fetchUnlisted={picker.provider === "gitlab"}
              onPick={linkIssue}
            />
          )}
          {picker.kind === "mergeRequest" && (
            <IssuePicker
              mergeRequests
              provider={picker.provider}
              exclude={mergeRequestKeys}
              fetchUnlisted={picker.provider === "gitlab"}
              onPick={(i) => {
                setPicker(null);
                if (!mergeRequests.some((x) => sameRef(x, i)))
                  update(mergeRequestsPatch([...mergeRequests, { repo: i.repo, number: i.number }]));
              }}
            />
          )}
          {picker.kind === "milestone" && (
            <MilestonePicker
              provider={picker.provider}
              takenRepos={takenRepos}
              onPick={(m) => {
                setPicker(null);
                update(milestonesPatch([...milestones, { repo: m.repo, number: m.number }]));
              }}
            />
          )}
          {picker.kind === "epic" && (
            <EpicPicker
              takenGroups={takenGroups}
              onPick={(e) => {
                setPicker(null);
                update(epicsPatch([...epics, { group: e.group, iid: e.iid }]));
              }}
            />
          )}
        </Popover>
      )}
    </>
  );
}

interface MenuItem {
  key: string;
  icon: ReactNode;
  label: string;
  run: () => void;
}

function MenuGroup({ title, items }: { title: string; items: MenuItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="promote-group">
      <div className="promote-group-head">{title}</div>
      {items.map((i) => (
        <button key={i.key} className="promote-target" onClick={i.run}>
          <span className="faint">{i.icon}</span>
          <span className="promote-target-label">{i.label}</span>
        </button>
      ))}
    </div>
  );
}

/** One kind of link within a host's group, under a caption naming it. */
function LinkKind({ one, many, count, children }: { one: string; many: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="task-link-kind">
      <div className="task-link-kind-label">{count === 1 ? one : many}</div>
      {children}
    </div>
  );
}

function UnlinkButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn tiny" title="Unlink" onClick={onClick}>
      <Link2Off size={13} />
    </button>
  );
}

function IssueLink({ link, onUnlink }: { link: IssueRef; onUnlink: () => void }) {
  const issue = useStore((s) => s.issues.repos[link.repo]?.issues.find((i) => i.number === link.number));
  return (
    <div className="linked-issue-chip" title={issue ? issue.title : issueKey(link)}>
      {issue ? <IssueStateIcon issue={issue} size={14} /> : <ProviderMark repo={link.repo} size={14} />}
      <button className="link-text" onClick={() => openUrl(issue?.url ?? issueUrl(link))}>
        {repoName(link.repo)}#{link.number}
      </button>
      <UnlinkButton onClick={onUnlink} />
    </div>
  );
}

function MergeRequestLink({ link, onUnlink }: { link: IssueRef; onUnlink: () => void }) {
  const mergeRequest = useStore((s) => findMergeRequest(s.issues, link));
  return (
    <div className="linked-issue-chip" title={mergeRequestSummary(mergeRequest)}>
      {mergeRequest ? <IssueStateIcon issue={mergeRequest} size={14} /> : <ProviderMark repo={link.repo} size={14} />}
      <button className="link-text" onClick={() => openUrl(mergeRequest?.url ?? mergeRequestUrl(link))}>
        {mergeRequestLabel(link)}
      </button>
      <UnlinkButton onClick={onUnlink} />
    </div>
  );
}

function MilestoneLink({ link, onUnlink }: { link: MilestoneRef; onUnlink: () => void }) {
  const milestone = useStore((s) => findMilestone(s.issues, link));
  return (
    <div
      className={cx("linked-issue-chip", "milestone-chip", milestone?.state)}
      title={milestone ? milestoneSummary(milestone) : "Not in the local cache — sync issues"}
    >
      <Milestone size={14} />
      {milestone ? (
        <button className="link-text" onClick={() => openUrl(milestone.url)}>
          {milestone.title}
        </button>
      ) : (
        <span>
          {repoName(link.repo)} milestone {link.number}
        </span>
      )}
      {milestone && <span className="milestone-progress">{milestoneProgress(milestone)}%</span>}
      <UnlinkButton onClick={onUnlink} />
    </div>
  );
}

function EpicLink({ link, onUnlink }: { link: EpicRef; onUnlink: () => void }) {
  const cache = useStore((s) => s.issues);
  const epic = findEpic(cache, link);
  return (
    <div
      className={cx("linked-issue-chip", "milestone-chip", epic?.state)}
      title={epic ? epicSummary(cache, epic) : "Not in the local cache — sync issues"}
    >
      <Layers size={14} />
      {epic ? (
        <button className="link-text" onClick={() => openUrl(epic.url)}>
          {epic.title}
        </button>
      ) : (
        <span>{epicLabel(link)}</span>
      )}
      <UnlinkButton onClick={onUnlink} />
    </div>
  );
}
