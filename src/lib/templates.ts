import { join, listDir, readJson } from "./fs";
import type { Board, Task } from "./types";
import { META_DIR, normalizeBoard } from "./vault";
import { now, slugify, uid } from "./util";

/*
 * Board templates (D-20): a kanban board's columns, settings and, if wanted, its tasks, kept in the
 * vault under .astali/templates/ so every project can use them. A board made from one gets fresh ids.
 */

export interface BoardTemplate {
  schemaVersion: number;
  id: string;
  name: string;
  /** The board as saved: no ids of its own, archive, links, issues, milestones or due dates. */
  board: Pick<Board, "description" | "columns" | "tasks" | "doneColumn" | "autoArchive" | "autoDone">;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateEntry {
  template: BoardTemplate;
  /** File name inside .astali/templates/. */
  file: string;
}

export const templatesDir = (vault: string) => join(vault, META_DIR, "templates");
export const templateFile = (vault: string, file: string) => join(templatesDir(vault), file);
export const templateFileName = (t: BoardTemplate) => `${slugify(t.name)}-${t.id}.json`;

export async function loadTemplates(vault: string): Promise<TemplateEntry[]> {
  const files = (await listDir(templatesDir(vault))).filter((e) => !e.is_dir && e.name.endsWith(".json"));
  const out: TemplateEntry[] = [];
  for (const f of files) {
    const t = await readJson<BoardTemplate>(templateFile(vault, f.name));
    if (t?.id && t.name && t.board && Array.isArray(t.board.columns)) out.push({ template: t, file: f.name });
  }
  return out.sort((a, b) => a.template.name.localeCompare(b.template.name));
}

/** What a task keeps in a template: its words, tags, priority and checklist (all unchecked). */
function templateTask(t: Task): Task {
  const { links: _, milestone: __, ...rest } = t;
  return {
    ...rest,
    issue: null,
    dueDate: null,
    checklist: t.checklist.map((c) => ({ ...c, done: false })),
  };
}

/** A template of `board`, replacing `replaces` (same id and file) when given. */
export function templateFromBoard(board: Board, name: string, withTasks: boolean, replaces?: BoardTemplate) {
  const at = now();
  const template: BoardTemplate = {
    schemaVersion: 1,
    id: replaces?.id ?? uid(),
    name: name.trim(),
    board: {
      description: board.description,
      columns: board.columns.map((c) => ({ ...c, taskIds: withTasks ? c.taskIds : [] })),
      tasks: withTasks ? Object.fromEntries(Object.entries(board.tasks).map(([id, t]) => [id, templateTask(t)])) : {},
      ...(board.doneColumn ? { doneColumn: board.doneColumn } : {}),
      ...(board.autoArchive ? { autoArchive: true } : {}),
      ...(board.autoDone ? { autoDone: true } : {}),
    },
    createdAt: replaces?.createdAt ?? at,
    updatedAt: at,
  };
  return template;
}

/** A new board named `name` from the template, with ids of its own. */
export function boardFromTemplate(t: BoardTemplate, name: string): Board {
  const at = now();
  const cols = new Map(t.board.columns.map((c) => [c.id, uid()]));
  const tasks = new Map(Object.keys(t.board.tasks ?? {}).map((id) => [id, uid()]));
  return normalizeBoard({
    ...t.board,
    id: uid(),
    name,
    columns: t.board.columns.map((c) => ({
      ...c,
      id: cols.get(c.id)!,
      taskIds: c.taskIds.filter((id) => tasks.has(id)).map((id) => tasks.get(id)!),
    })),
    tasks: Object.fromEntries(
      Object.entries(t.board.tasks ?? {}).map(([id, task]) => [
        tasks.get(id)!,
        { ...templateTask(task), id: tasks.get(id)!, createdAt: at, updatedAt: at },
      ]),
    ),
    doneColumn: t.board.doneColumn ? cols.get(t.board.doneColumn) : undefined,
    createdAt: at,
    updatedAt: at,
  });
}
