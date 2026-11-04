import { Plus, X } from "lucide-react";
import { useState } from "react";
import { DECISION_LIMIT_DEFAULT, DECISION_LIMIT_MAX, DECISION_LIMIT_MIN } from "../lib/decisions";
import { GLOSSARY_LIMIT_DEFAULT, GLOSSARY_LIMIT_MAX, GLOSSARY_LIMIT_MIN } from "../lib/glossary";
import { createProject, openProject, toast, updateProject } from "../lib/store";
import type { Color, Project, Provider, RepoRef } from "../lib/types";
import { cx, parseRepo, repoKey, repoPath } from "../lib/util";
import { ColorPicker } from "./ColorPicker";
import { Modal, ModalHeader, ProviderMark } from "./ui";

/**
 * The repository typed in the field. A URL says where it is; a bare path ("group/project") is
 * read as the provider picked next to the field, since it could be either.
 */
function readRepo(input: string, provider: Provider): RepoRef | null {
  const s = input.trim();
  if (provider === "gitlab" && !/github\.com|^gitlab:|gitlab\.com/i.test(s)) return parseRepo(`gitlab:${s}`);
  return parseRepo(s);
}

export function ProjectDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState<Color>(project?.color ?? "violet");
  const [repos, setRepos] = useState<RepoRef[]>(project?.repos ?? []);
  const [repoInput, setRepoInput] = useState("");
  const [repoError, setRepoError] = useState("");
  const [provider, setProvider] = useState<Provider>("github");
  const [limitInput, setLimitInput] = useState(String(project?.decisionCharLimit ?? DECISION_LIMIT_DEFAULT));
  const limit = /^\d+$/.test(limitInput.trim()) ? Number(limitInput.trim()) : NaN;
  const limitValid = Number.isInteger(limit) && limit >= DECISION_LIMIT_MIN && limit <= DECISION_LIMIT_MAX;
  const [glossaryInput, setGlossaryInput] = useState(String(project?.glossaryCharLimit ?? GLOSSARY_LIMIT_DEFAULT));
  const glossaryLimit = /^\d+$/.test(glossaryInput.trim()) ? Number(glossaryInput.trim()) : NaN;
  const glossaryValid =
    Number.isInteger(glossaryLimit) && glossaryLimit >= GLOSSARY_LIMIT_MIN && glossaryLimit <= GLOSSARY_LIMIT_MAX;
  const [busy, setBusy] = useState(false);

  const addRepo = () => {
    if (!repoInput.trim()) return;
    const r = readRepo(repoInput, provider);
    if (!r)
      return setRepoError(
        provider === "gitlab"
          ? "Use group/project (groups may nest) or a gitlab.com URL"
          : "Use owner/repo or a GitHub URL",
      );
    if (repos.some((x) => repoKey(x).toLowerCase() === repoKey(r).toLowerCase())) return setRepoError("Already added");
    setRepos([...repos, r]);
    setRepoInput("");
    setRepoError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !limitValid || !glossaryValid || busy) return;
    // A repo typed but not "added" is almost certainly meant to be included.
    let finalRepos = repos;
    const pendingRepo = readRepo(repoInput, provider);
    if (pendingRepo && !repos.some((x) => repoKey(x) === repoKey(pendingRepo))) finalRepos = [...repos, pendingRepo];
    setBusy(true);
    try {
      const data = {
        name: name.trim(),
        description: description.trim(),
        color,
        repos: finalRepos,
        decisionCharLimit: limit,
        glossaryCharLimit: glossaryLimit,
      };
      if (project) {
        updateProject(project.id, data);
        onClose();
      } else {
        const id = await createProject(data);
        onClose();
        await openProject(id);
      }
    } catch (err) {
      toast(String(err), "error");
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={520}>
      <ModalHeader title={project ? "Edit project" : "New project"} onClose={onClose} />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website relaunch" />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about?"
          />
        </label>
        <div className="field">
          <span>Color</span>
          <ColorPicker value={color} onChange={(c) => setColor(c)} />
        </div>
        <div className="field">
          <span>
            Repositories <em className="faint">— GitHub or gitlab.com; issues are imported read-only</em>
          </span>
          {repos.length > 0 && (
            <div className="repo-list">
              {repos.map((r) => (
                <div key={repoKey(r)} className="repo-chip">
                  <ProviderMark repo={repoKey(r)} size={14} />
                  <span>{repoPath(repoKey(r))}</span>
                  <button
                    type="button"
                    className="icon-btn small"
                    onClick={() => setRepos(repos.filter((x) => x !== r))}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="input-row">
            <div className="segmented tiny" role="radiogroup" aria-label="Where the repository is">
              {(["github", "gitlab"] as Provider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={cx(provider === p && "active")}
                  onClick={() => {
                    setProvider(p);
                    setRepoError("");
                  }}
                >
                  {p === "github" ? "GitHub" : "GitLab"}
                </button>
              ))}
            </div>
            <input
              value={repoInput}
              onChange={(e) => {
                setRepoInput(e.target.value);
                setRepoError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRepo();
                }
              }}
              placeholder={
                provider === "gitlab"
                  ? "group/project or https://gitlab.com/group/project"
                  : "owner/repo or https://github.com/owner/repo"
              }
            />
            <button type="button" className="btn" onClick={addRepo}>
              <Plus size={15} /> Add
            </button>
          </div>
          {repoError && <div className="field-error">{repoError}</div>}
        </div>
        <label className="field">
          <span>
            Decision length limit{" "}
            <em className="faint">— characters for a decision's why and rejected alternative together</em>
          </span>
          <input
            className="limit-input"
            inputMode="numeric"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            onBlur={() => limitValid && setLimitInput(String(limit))}
          />
          {!limitValid && (
            <div className="field-error">
              Enter a whole number from {DECISION_LIMIT_MIN} to {DECISION_LIMIT_MAX} (default {DECISION_LIMIT_DEFAULT}).
            </div>
          )}
        </label>
        <label className="field">
          <span>
            Glossary length limit <em className="faint">— characters for a term's definition</em>
          </span>
          <input
            className="limit-input"
            inputMode="numeric"
            value={glossaryInput}
            onChange={(e) => setGlossaryInput(e.target.value)}
            onBlur={() => glossaryValid && setGlossaryInput(String(glossaryLimit))}
          />
          {!glossaryValid && (
            <div className="field-error">
              Enter a whole number from {GLOSSARY_LIMIT_MIN} to {GLOSSARY_LIMIT_MAX} (default {GLOSSARY_LIMIT_DEFAULT}).
            </div>
          )}
        </label>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!name.trim() || !limitValid || busy}>
            {project ? "Save changes" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
