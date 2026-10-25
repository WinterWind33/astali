import { LayoutTemplate, Trash2 } from "lucide-react";
import { useState } from "react";
import { createBoardFromTemplate, deleteTemplate, saveBoardAsTemplate, toast, useStore } from "../lib/store";
import { cx } from "../lib/util";
import { confirm, Modal, ModalHeader } from "./ui";

/** Saves a kanban board as a template of the vault, with or without its tasks (D-20). */
export function SaveTemplateDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const board = useStore((s) => s.boards[boardId]?.board);
  const templates = useStore((s) => s.templates);
  const [name, setName] = useState(board?.name ?? "");
  const [withTasks, setWithTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!board) return null;
  const taskCount = Object.keys(board.tasks).length;
  const replaces = templates.find((e) => e.template.name.toLowerCase() === name.trim().toLowerCase());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await saveBoardAsTemplate(boardId, name, withTasks);
      toast(`Saved the template “${name.trim()}”`, "success");
      onClose();
    } catch (err) {
      toast(`Could not save the template: ${err}`, "error");
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={480}>
      <ModalHeader
        title="Save as template"
        subtitle={`New boards in any project of this vault can start from “${board.name}”.`}
        onClose={onClose}
      />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Template name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={withTasks}
            disabled={taskCount === 0}
            onChange={(e) => setWithTasks(e.target.checked)}
          />
          <span>
            Include its {taskCount} task{taskCount === 1 ? "" : "s"}
            <em className="faint"> — without issues, milestones, due dates or links; checklists start unchecked</em>
          </span>
        </label>
        <p className="faint small">
          Columns keep their colors, limits and views, and the done column keeps its settings.
          {replaces && <strong> This replaces the template “{replaces.template.name}”.</strong>}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!name.trim() || busy}>
            {replaces ? "Replace" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Picks one of the vault's templates and makes a board of the open project from it. */
export function NewFromTemplateDialog({ onClose }: { onClose: () => void }) {
  const templates = useStore((s) => s.templates);
  const [picked, setPicked] = useState(templates[0]?.template.id ?? "");
  const current = templates.find((e) => e.template.id === picked)?.template;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current || busy) return;
    setBusy(true);
    try {
      await createBoardFromTemplate(current.id, name);
      onClose();
    } catch (err) {
      toast(`Could not create the board: ${err}`, "error");
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    const ok = await confirm({
      title: `Delete the template “${label}”?`,
      message: "Boards already made from it stay as they are.",
      confirmLabel: "Delete template",
      danger: true,
    });
    if (!ok) return;
    await deleteTemplate(id).catch((err) => toast(`Could not delete the template: ${err}`, "error"));
    if (id === picked) setPicked(templates.find((e) => e.template.id !== id)?.template.id ?? "");
  };

  return (
    <Modal onClose={onClose} width={520}>
      <ModalHeader title="New board from a template" onClose={onClose} />
      <form className="form" onSubmit={submit}>
        {templates.length === 0 ? (
          <p className="faint">
            No templates yet. Open a kanban board's menu in the sidebar and choose <em>Save as template</em>.
          </p>
        ) : (
          <div className="template-list">
            {templates.map(({ template: t }) => {
              const tasks = Object.keys(t.board.tasks ?? {}).length;
              return (
                <div
                  key={t.id}
                  className={cx("template-item", t.id === picked && "active")}
                  onClick={() => setPicked(t.id)}
                >
                  <LayoutTemplate size={15} />
                  <div className="template-item-text">
                    <div className="template-item-name">{t.name}</div>
                    <div className="faint small">
                      {t.board.columns.map((c) => c.name).join(" · ")}
                      {tasks > 0 && ` — ${tasks} task${tasks === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn tiny"
                    title="Delete template"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(t.id, t.name);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {current && (
          <label className="field">
            <span>Board name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={current.name} />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!current || busy}>
            Create board
          </button>
        </div>
      </form>
    </Modal>
  );
}
