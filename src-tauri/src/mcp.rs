//! Model Context Protocol server (stdio, JSON-RPC 2.0) that lets AI agents such as Claude
//! manage an Astali vault: projects, boards, columns, tasks, plans, decisions and cached GitHub issues.
//!
//! Run with `astali mcp [--vault <path>]`. Without `--vault`, it uses the vault in the repository
//! it was started in (see `vaultfs::find_vault_near`), or else the vault open in the desktop app,
//! looked up again on every call so it follows a switch. It edits the same JSON files the app
//! uses, and the app's folder watcher picks up the changes live.

use crate::history::{self, Actor};
use crate::plan;
use crate::vaultfs::{self, new_id, now_iso, slugify};
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

const PROTOCOL_VERSION: &str = "2025-06-18";
const COLORS: &[&str] = &[
    "slate", "violet", "blue", "cyan", "emerald", "lime", "amber", "orange", "rose", "pink",
];
const PRIORITIES: &[&str] = &["none", "low", "medium", "high", "urgent"];
/// Bounds and default of a project's `decisionCharLimit` (keep in step with `src/lib/decisions.ts`).
const DECISION_LIMIT_DEFAULT: u64 = 500;
const DECISION_LIMIT_MIN: u64 = 50;
const DECISION_LIMIT_MAX: u64 = 5000;

type R<T> = Result<T, String>;

/// Where the vault comes from: named with `--vault`, found in the repository, or open in the app.
#[derive(Clone, Copy, PartialEq)]
enum Source {
    Flag,
    Repo,
    App,
}

impl Source {
    fn describe(self) -> &'static str {
        match self {
            Source::Flag => "set with --vault when the server was registered",
            Source::Repo => "found in the repository the agent runs in",
            Source::App => "the vault open in the Astali app",
        }
    }
}

struct Ctx {
    /// Fixed for the session with `--vault` or by the repository; `None` follows the app.
    fixed: Option<PathBuf>,
    source: Source,
    /// The vault of the tool call in progress, so one call never spans two vaults.
    current: RefCell<Option<PathBuf>>,
    /// Client name from `initialize`, and the tool being called, for the history log.
    client: RefCell<Option<String>>,
    tool: RefCell<Option<String>>,
}

impl Ctx {
    fn vault(&self) -> R<PathBuf> {
        if let Some(v) = self.current.borrow().as_ref() {
            return Ok(v.clone());
        }
        self.lookup()
    }

    fn lookup(&self) -> R<PathBuf> {
        if let Some(v) = &self.fixed {
            return Ok(v.clone());
        }
        match vaultfs::last_vault_from_config() {
            Some(v) if v.is_dir() => Ok(v),
            Some(v) => Err(format!(
                "The vault last open in the Astali app no longer exists: {}",
                v.display()
            )),
            None => Err(
                "No vault is open in the Astali app. Open one there, or register the server with --vault <folder>."
                    .into(),
            ),
        }
    }

    fn actor(&self) -> Actor {
        Actor {
            by: "mcp".into(),
            client: self.client.borrow().clone(),
            tool: self.tool.borrow().clone(),
            undoes: None,
        }
    }

    fn write_json(&self, path: &std::path::Path, v: &Value) -> R<()> {
        history::write_json(&self.vault()?, path, v, &self.actor())
    }

    fn remove(&self, path: &std::path::Path) -> R<()> {
        history::remove(Some(&self.vault()?), path, &self.actor())
    }
}

pub fn run(args: &[String]) -> i32 {
    let mut vault: Option<PathBuf> = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--vault" {
            vault = it.next().map(PathBuf::from);
        }
    }
    if let Some(v) = &vault {
        if !v.is_dir() {
            eprintln!("astali mcp: vault folder does not exist: {}", v.display());
            return 2;
        }
    }
    let (fixed, source) = match vault {
        Some(v) => (Some(v), Source::Flag),
        None => match std::env::current_dir().ok().and_then(|d| vaultfs::find_vault_near(&d)) {
            Some(v) => (Some(v), Source::Repo),
            None => (None, Source::App),
        },
    };
    let ctx = Ctx {
        fixed,
        source,
        current: RefCell::new(None),
        client: RefCell::new(None),
        tool: RefCell::new(None),
    };
    let stdin = io::stdin();
    let mut out = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => handle(&ctx, &msg),
            Err(e) => {
                Some(json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":format!("Parse error: {e}")}}))
            }
        };
        if let Some(r) = response {
            let _ = writeln!(out, "{r}");
            let _ = out.flush();
        }
    }
    0
}

fn handle(ctx: &Ctx, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    // Notifications carry no id and get no response.
    let id = id?;
    let result: Result<Value, (i64, String)> = match method {
        "initialize" => {
            let info = &params["clientInfo"];
            *ctx.client.borrow_mut() = info["name"].as_str().or(info["title"].as_str()).map(String::from);
            Ok(json!({
                "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "astali", "title": "Astali Kanban", "version": env!("CARGO_PKG_VERSION") },
                "instructions": format!(
                    "Astali is a local kanban app. Vault: {} ({}). Hierarchy: project → boards → columns → tasks. \
                     Start with list_projects, then get_board to see columns and tasks. Projects, boards and \
                     columns can be referenced by id or by (case-insensitive) name. GitHub issues are read-only: \
                     use sync_issues to refresh the cache, list_issues to browse, add_issue_as_task to put one on a board \
                     (add_issues_as_tasks for many at once). A column created with a `label` is a live view of the \
                     cached issues carrying that GitHub label: get_board lists them as `issues`, and it can't hold tasks. \
                     Task `labels` are the project's own tags, separate from GitHub labels. A column created with `tags` \
                     is a live view of the board's tasks carrying any (or all) of those tags: get_board lists them as \
                     `taggedTasks` (with the column each is in), and it can't hold tasks either; tag a task to show it there. \
                     Tag colors are set per project with update_project `tag_colors`. \
                     Finished tasks can be archived (archive_tasks, restore_task): they leave the board and get_board, which \
                     counts them as `archived`, but search_tasks still finds them. A done column marked `autoArchive` archives \
                     every task moved into it. \
                     Decisions record why the code is the way it is: short notes numbered D-1, D-2… per project, each a \
                     title and a `why` (with an optional rejected alternative) kept under the project's character limit, \
                     plus `about`: the classes, functions or paths they explain. Before reworking code that looks odd, \
                     search_decisions for it (a class name or path is enough); when a design choice is settled, record it \
                     with add_decision. Code comments may point at one as `D-12`. \
                     A board is either a kanban board or a plan (`kind: \"plan\"` in list_boards): an implementation plan of \
                     ordered steps, each with notes and a checklist of nested items (todo, done, or skipped with a reason), \
                     plus open questions. Read one with get_plan (format \"markdown\" for a quick read), tick items off with \
                     update_plan_item as the work lands, and create one from a Markdown draft with create_plan. \
                     A board can also be a notes board (`kind: \"notes\"`): post-it notes (title, Markdown description \
                     under the board's noteLimit, tags, linked issues, color) the user arranges freely; get_board lists \
                     them, and create_note / update_note / delete_note change them. \
                     Tasks of a project can be linked, on the same board or across boards: one blocks another, or they \
                     relate. get_board shows each task's `blocks`, `blockedBy` and `relatesTo`; change them with \
                     link_tasks / unlink_tasks. A task is finished, and stops blocking others, once it is in its board's \
                     done column (`done: true` in get_board, picked with update_column). \
                     Every change is recorded in the vault's history: list_history shows what changed (by you, the user \
                     or other agents) and undo reverts an entry. Changes appear live in the desktop app.",
                    ctx.vault().map(|v| v.display().to_string()).unwrap_or_else(|_| "none open yet".into()),
                    ctx.source.describe()
                ),
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            *ctx.tool.borrow_mut() = Some(name.to_string());
            *ctx.current.borrow_mut() = ctx.lookup().ok();
            let res = call_tool(ctx, name, &args);
            *ctx.current.borrow_mut() = None;
            Ok(match res {
                Ok(v) => json!({ "content": [{ "type": "text", "text": pretty(&v) }], "isError": false }),
                Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
            })
        }
        _ => Err((-32601, format!("Method not found: {method}"))),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

fn pretty(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        _ => serde_json::to_string_pretty(v).unwrap_or_default(),
    }
}

// ------------------------------------------------------------------------------- tool schema

fn tool(name: &str, description: &str, props: Value, required: &[&str], kind: &str) -> Value {
    let annotations = match kind {
        "read" => json!({ "readOnlyHint": true }),
        "delete" => json!({ "destructiveHint": true }),
        _ => json!({ "readOnlyHint": false, "destructiveHint": false }),
    };
    json!({
        "name": name,
        "description": description,
        "inputSchema": { "type": "object", "properties": props, "required": required },
        "annotations": annotations,
    })
}

fn tools() -> Vec<Value> {
    let s = |d: &str| json!({ "type": "string", "description": d });
    let project = s("Project id, folder name, or name (case-insensitive)");
    let board = s("Board id or name (case-insensitive)");
    let column = s("Column id or name (case-insensitive)");
    let task = s("Task id (or exact title if unique on the board)");
    let color = json!({ "type": "string", "description": format!("A preset ({}) or any hex color \"#rrggbb\"", COLORS.join(", ")) });
    let priority = json!({ "type": "string", "enum": PRIORITIES });
    let labels = json!({ "type": "array", "items": { "type": "string" } });
    let position =
        json!({ "type": "integer", "minimum": 0, "description": "0-based index; omit to append at the end" });
    let issue = s("GitHub issue as \"owner/repo#123\" or an issue URL; empty string to unlink");
    let due = s("Due date YYYY-MM-DD, or empty string to clear");
    let decision = s("Decision as \"D-12\", its number, its id, or its exact title");
    let step = s("Step id, its number (\"3\"), or its exact title");
    let item = s("Item id (from get_plan), or its exact text if unique in the plan");
    let strings = |d: &str| json!({ "type": "array", "items": { "type": "string" }, "description": d });
    let note = s("Note id (from get_board), or its exact title if unique on the board");
    let note_color = json!({ "type": "string", "description": format!("A preset ({}) or a hex color \"#rrggbb\"; an empty string makes the note follow its first tag's color", COLORS.join(", ")) });
    let note_limit = json!({ "type": "integer", "minimum": NOTE_LIMIT_MIN, "maximum": NOTE_LIMIT_MAX,
                             "description": format!("Notes boards: most characters a note's title and description may hold together (default {NOTE_LIMIT_DEFAULT})") });
    let coord = json!({ "type": "integer", "description": "Position of the note's top-left corner on the board, in pixels (may be negative)" });

    vec![
        tool("list_projects", "List all projects in the vault with board counts and linked GitHub repos.", json!({}), &[], "read"),
        tool("create_project", "Create a project. It starts with one board named 'Main' with To Do / Doing / Done columns.",
            json!({ "name": s("Project name"), "description": s("Optional description"), "color": color,
                    "repos": { "type": "array", "items": { "type": "string" }, "description": "GitHub repos as owner/repo" } }),
            &["name"], "write"),
        tool("update_project", "Update a project's name, description, color, linked GitHub repos (repos replaces the whole list), tag colors or decision length limit.",
            json!({ "project": project, "name": s("New name"), "description": s("New description"), "color": color,
                    "repos": { "type": "array", "items": { "type": "string" } },
                    "decision_char_limit": { "type": "integer", "minimum": DECISION_LIMIT_MIN, "maximum": DECISION_LIMIT_MAX,
                        "description": "Most characters a decision's why and rejected alternative may hold together" },
                    "tag_colors": { "type": "object", "additionalProperties": { "type": "string" },
                        "description": format!("Colors of task tags, as {{ tag: color }}: a preset ({}) or a hex color; an empty string resets a tag to its automatic color. Merged into the existing colors.", COLORS.join(", ")) } }),
            &["project"], "write"),
        tool("delete_project", "Delete a project folder and all its boards (recorded in the history, so it can be restored with undo).",
            json!({ "project": project, "confirm": { "type": "boolean", "description": "Must be true" } }), &["project", "confirm"], "delete"),

        tool("list_boards", "List the boards of a project with per-column task counts.", json!({ "project": project }), &["project"], "read"),
        tool("get_board", "Get a board with its columns and tasks in display order. The done column lists only its first `done_limit` tasks, and says how many more it holds in `moreTasks`: use search_tasks with `column` to look through them.",
            json!({ "project": project, "board": board, "include_descriptions": { "type": "boolean", "description": "Include task descriptions (default true)" },
                    "done_limit": { "type": "integer", "minimum": 0, "description": "Most tasks to list from the done column (default 20, 0 for all)" } }),
            &["project", "board"], "read"),
        tool("create_board", "Create a board: a kanban board (columns default to To Do / Doing / Done), or with kind \"notes\" a board of post-it notes. Plans are made with create_plan.",
            json!({ "project": project, "name": s("Board name"), "description": s("Optional description"),
                    "kind": { "type": "string", "enum": ["kanban", "notes"], "description": "Default kanban" },
                    "columns": { "type": "array", "items": { "type": "string" }, "description": "Kanban only: optional custom column names" },
                    "note_limit": note_limit.clone() }),
            &["project", "name"], "write"),
        tool("update_board", "Rename a board, change its description, or a notes board's note length limit.",
            json!({ "project": project, "board": board, "name": s("New name"), "description": s("New description"), "note_limit": note_limit }),
            &["project", "board"], "write"),
        tool("delete_board", "Delete a board and its tasks (can be restored with undo).", json!({ "project": project, "board": board }), &["project", "board"], "delete"),

        tool("create_column",
            "Add a column to a board. With `label`, the column is a live view of the cached issues carrying that GitHub \
             label (open ones, unless show_closed): its name and color follow the label, and it can't hold tasks. \
             With `tags`, it is a live view of the board's tasks carrying those task tags (any of them, or all with \
             match: \"all\"); the tasks stay in their own columns and the column can't hold tasks.",
            json!({ "project": project, "board": board, "name": s("Column name (ignored with `label`; defaults to the tags with `tags`)"), "color": color, "position": position,
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "Task tags (case-insensitive) the column shows tasks for" },
                    "match": { "type": "string", "enum": ["any", "all"], "description": "With `tags`: tasks with any of the tags (default) or all of them" },
                    "wip_limit": { "type": "integer", "minimum": 1 },
                    "label": s("Name of a GitHub label of one of the project's repos (case-insensitive); needs a prior sync_issues"),
                    "repo": s("owner/repo the label belongs to; needed only when several repos have it"),
                    "show_closed": { "type": "boolean", "description": "With `label`: also show closed issues" } }),
            &["project", "board"], "write"),
        tool("update_column", "Rename a column, change its color, set its WIP limit (0 clears it), make it the board's done column, or change a tag column's tags.",
            json!({ "project": project, "board": board, "column": column, "name": s("New name"), "color": color,
                    "wip_limit": { "type": "integer", "minimum": 0 },
                    "done": { "type": "boolean", "description": "true makes this the board's done column (get_board marks it `done`): the progress bar counts its tasks, and tasks it holds no longer block others. Defaults to the last column that holds tasks." },
                    "auto_archive": { "type": "boolean", "description": "Done column only: true archives the tasks it holds and every task moved into it from then on (get_board marks it `autoArchive`); while it is on, restore_task and undo refuse to put tasks back there" },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "Tag columns only: the tags it shows tasks for" },
                    "match": { "type": "string", "enum": ["any", "all"], "description": "Tag columns only" } }),
            &["project", "board", "column"], "write"),
        tool("move_column", "Move a column to a new position.",
            json!({ "project": project, "board": board, "column": column, "position": position }),
            &["project", "board", "column", "position"], "write"),
        tool("delete_column", "Delete a column. Its tasks are moved to move_tasks_to if given, otherwise deleted.",
            json!({ "project": project, "board": board, "column": column, "move_tasks_to": s("Column to receive the tasks") }),
            &["project", "board", "column"], "delete"),

        tool("create_task", "Create a task (card). Defaults to the first column. Can link a GitHub issue.",
            json!({ "project": project, "board": board, "column": column, "title": s("Title"),
                    "description": s("Markdown description"), "priority": priority, "labels": labels,
                    "due_date": due, "issue": issue,
                    "checklist": { "type": "array", "items": { "type": "string" }, "description": "Checklist item texts" },
                    "position": position }),
            &["project", "board", "title"], "write"),
        tool("update_task", "Update fields of a task. Only provided fields change. checklist replaces the whole list.",
            json!({ "project": project, "board": board, "task": task, "title": s("Title"), "description": s("Markdown description"),
                    "priority": priority, "labels": labels, "due_date": due, "issue": issue,
                    "checklist": { "type": "array", "items": { "type": "object",
                        "properties": { "text": { "type": "string" }, "done": { "type": "boolean" } }, "required": ["text"] } } }),
            &["project", "board", "task"], "write"),
        tool("move_task",
            "Move a task to another column and/or position, on the same board or, with `to_board`, on another kanban board of the project (`column` is then that board's). A moved task keeps its id and links, and links to it follow it.",
            json!({ "project": project, "board": board, "task": task, "column": column, "position": position,
                    "to_board": s("Board to move the task to, id or name; defaults to `board`") }),
            &["project", "board", "task", "column"], "write"),
        tool("link_tasks",
            "Link two tasks of a project: `task` blocks `other`, is blocked_by it, or relates to it. `other` is on \
             `other_board` when given, else on the same board. Replaces any link the two already had.",
            json!({ "project": project, "board": board, "task": task,
                    "link": { "type": "string", "enum": ["blocks", "blocked_by", "relates"] },
                    "other": s("The other task: id (or exact title if unique on its board)"),
                    "other_board": s("Board of the other task, id or name; defaults to `board`") }),
            &["project", "board", "task", "link", "other"], "write"),
        tool("unlink_tasks", "Remove the link between two tasks, whichever way it goes.",
            json!({ "project": project, "board": board, "task": task, "other": s("The other task: id or exact title"),
                    "other_board": s("Board of the other task, id or name; defaults to `board`") }),
            &["project", "board", "task", "other"], "write"),
        tool("delete_task", "Delete a task (can be restored with undo).", json!({ "project": project, "board": board, "task": task }), &["project", "board", "task"], "delete"),
        tool("archive_tasks",
            "Put finished tasks away in the board's archive: they leave the board and get_board, but search_tasks still finds them (marked `archived`) and restore_task brings them back. Pass `tasks`, or `column` to archive all of its tasks.",
            json!({ "project": project, "board": board,
                    "tasks": { "type": "array", "items": { "type": "string" }, "description": "Task ids (or exact titles)" },
                    "column": s("Archive every task of this column, id or name (e.g. the done column)") }),
            &["project", "board"], "write"),
        tool("restore_task", "Bring an archived task back to the top of the column it was archived from (or the first column if that one is gone).",
            json!({ "project": project, "board": board, "task": s("Archived task id (or exact title)") }),
            &["project", "board", "task"], "write"),
        tool("create_note",
            "Pin a note on a notes board: a title and a Markdown description that together fit the board's noteLimit \
             (get_board shows it), plus the project's tags and linked issues. Without x/y it goes below the other notes.",
            json!({ "project": project, "board": board, "title": s("Title"), "description": s("Markdown"),
                    "tags": strings("The project's own tags (not GitHub labels)"), "issues": strings("GitHub issues as owner/repo#123 or URLs"),
                    "color": note_color.clone(), "x": coord.clone(), "y": coord.clone() }),
            &["project", "board"], "write"),
        tool("update_note", "Change a note. Only provided fields change; tags and issues replace the whole list. A note may not grow past the board's limit.",
            json!({ "project": project, "board": board, "note": note, "title": s("Title"), "description": s("Markdown"),
                    "tags": strings("The project's own tags"), "issues": strings("GitHub issues as owner/repo#123 or URLs"),
                    "color": note_color, "x": coord.clone(), "y": coord }),
            &["project", "board", "note"], "write"),
        tool("delete_note", "Delete a note (can be restored with undo).", json!({ "project": project, "board": board, "note": note }), &["project", "board", "note"], "delete"),
        tool("search_tasks", "Search tasks across boards (and optionally projects) by text, tag, priority or column name, archived ones included (marked `archived`; column \"Archived\" finds only those). `count` is how many match; only the first `limit` are listed.",
            json!({ "project": s("Limit to one project (optional)"), "query": s("Text matched against title and description"),
                    "label": s("Task tag to match (case-insensitive)"), "priority": priority, "column": s("Column name to match"),
                    "board": s("Limit to one board, id or name (optional)"),
                    "limit": { "type": "integer", "minimum": 1, "description": "Most tasks to list (default 50)" } }),
            &[], "read"),

        tool("search_decisions",
            "Find the project's decisions: why something in the code is the way it is. Every word of `query` must \
             appear in the decision (title, why, rejected alternative, code references, tags, linked issues, or its \
             number like \"D-12\"); matches on code references and titles come first. Without a query, lists them \
             newest first. Replaced decisions are included, marked with what replaced them.",
            json!({ "project": project, "query": s("Words to look for, e.g. a class name or path"), "tag": s("Only decisions with this tag"),
                    "include_replaced": { "type": "boolean", "description": "Default true" },
                    "limit": { "type": "integer", "minimum": 1, "description": "Default 20" } }),
            &["project"], "read"),
        tool("add_decision",
            "Record a decision: a short title and why it was made, readable in 30 seconds. `why` and `rejected` together \
             must fit the project's decision length limit (see list_projects; 500 characters unless changed): longer text \
             is refused, so keep to the reason. Decisions are numbered D-1, D-2… in order.",
            json!({ "project": project, "title": s("What was decided, e.g. \"Keyboard state is a sparse map\""),
                    "why": s("Why, in a few lines (markdown)"), "rejected": s("Optional: the alternative not taken, and why not"),
                    "about": strings("Code it explains: class or function names, file or folder paths"),
                    "tags": strings("The project's tags"), "issues": strings("GitHub issues as \"owner/repo#123\" or URLs") }),
            &["project", "title", "why"], "write"),
        tool("update_decision",
            "Change a decision. Only provided fields change; lists replace the whole list. `replaced_by` marks it as \
             superseded by another decision (empty string clears it). Text growing past the length limit is refused.",
            json!({ "project": project, "decision": decision, "title": s("Title"), "why": s("Why (markdown)"),
                    "rejected": s("Rejected alternative; empty string clears it"), "about": strings("Code references"),
                    "tags": strings("Tags"), "issues": strings("GitHub issues as \"owner/repo#123\" or URLs"),
                    "replaced_by": s("The decision replacing this one (\"D-14\"), or empty string") }),
            &["project", "decision"], "write"),
        tool("delete_decision", "Delete a decision (can be restored with undo). When a decision changed, prefer update_decision with replaced_by, which keeps the old reasoning findable.",
            json!({ "project": project, "decision": decision }), &["project", "decision"], "delete"),

        tool("create_plan",
            "Create a plan board: an implementation plan of ordered steps with checklists. Pass `markdown` to import a \
             draft: `## ` headings become steps (\"## 1. Title\" numbering is dropped), `- [ ]` / `- [x]` items their \
             checklist, nested by indentation, `- [x] ~~text~~ reason` a skipped item, other text the step's notes; a \
             `# ` title names the plan, text before the first step is its goal, a `## Open questions` list its questions.",
            json!({ "project": project, "name": s("Plan name (defaults to the Markdown's # title)"), "markdown": s("A plan drafted in Markdown"),
                    "goal": s("What the plan is for (markdown); overrides the Markdown's"),
                    "issues": strings("GitHub issues it is for, as \"owner/repo#123\" or URLs") }),
            &["project"], "write"),
        tool("get_plan", "Get a plan board: goal, linked issues, steps with their notes and items (with ids), open questions and progress.",
            json!({ "project": project, "board": board,
                    "format": { "type": "string", "enum": ["json", "markdown"], "description": "json (default, with ids) or markdown" } }),
            &["project", "board"], "read"),
        tool("update_plan", "Change a plan's goal, notes or linked issues (issues replaces the list).",
            json!({ "project": project, "board": board, "goal": s("Goal (markdown)"), "notes": s("Notes, e.g. known limits (markdown)"),
                    "issues": strings("GitHub issues as \"owner/repo#123\" or URLs") }),
            &["project", "board"], "write"),
        tool("add_plan_step", "Add a step to a plan, with optional notes and checklist items.",
            json!({ "project": project, "board": board, "title": s("Step title"), "notes": s("Notes (markdown)"),
                    "items": strings("Checklist item texts"), "position": position }),
            &["project", "board", "title"], "write"),
        tool("update_plan_step", "Rename a step, change its notes, move it, or delete it (with its items).",
            json!({ "project": project, "board": board, "step": step, "title": s("New title"), "notes": s("Notes (markdown)"),
                    "position": position, "delete": { "type": "boolean" } }),
            &["project", "board", "step"], "write"),
        tool("add_plan_items", "Add checklist items to a step: at its end, after an item, or as children of an item.",
            json!({ "project": project, "board": board, "step": step, "items": strings("Item texts (markdown)"),
                    "parent": s("Item id to nest them under"), "after": s("Item id to insert them after (same level)") }),
            &["project", "board", "step", "items"], "write"),
        tool("update_plan_item",
            "Change a plan item: mark it done, todo or skipped (give the reason), edit its text, point it at a decision \
             (\"D-12\"; empty string clears), or delete it with its children.",
            json!({ "project": project, "board": board, "item": item,
                    "state": { "type": "string", "enum": plan::STATES }, "reason": s("Why it was skipped"),
                    "text": s("New text"), "decision": s("\"D-12\", or empty string to clear"), "delete": { "type": "boolean" } }),
            &["project", "board", "item"], "write"),
        tool("add_plan_question", "Add an open question to a plan.",
            json!({ "project": project, "board": board, "text": s("The question") }), &["project", "board", "text"], "write"),
        tool("answer_plan_question",
            "Answer an open question of a plan (it is marked resolved unless resolved: false). When the answer is a \
             design decision worth keeping, record it with add_decision and pass its number as `decision`.",
            json!({ "project": project, "board": board, "question": s("Question id, or its exact text"), "answer": s("The answer"),
                    "resolved": { "type": "boolean" }, "decision": s("\"D-12\", or empty string to clear") }),
            &["project", "board", "question"], "write"),

        tool("sync_issues", "Fetch issues from the project's GitHub repos into the local cache (read-only on GitHub).",
            json!({ "project": project }), &["project"], "write"),
        tool("list_issues", "List cached GitHub issues of a project and where each is linked on boards.",
            json!({ "project": project, "state": { "type": "string", "enum": ["open", "closed", "all"] },
                    "query": s("Text filter"), "repo": s("owner/repo filter"),
                    "include_prs": { "type": "boolean" }, "limit": { "type": "integer", "minimum": 1 } }),
            &["project"], "read"),
        tool("add_issue_as_task", "Create a task from a cached GitHub issue, linked to it.",
            json!({ "project": project, "board": board, "column": column, "issue": issue }),
            &["project", "board", "issue"], "write"),
        tool("add_issues_as_tasks",
            "Bulk version of add_issue_as_task: create linked tasks for many cached GitHub issues in one write. \
             Pass either `issues` (explicit refs) or `all_matching: true` to take every cached issue matching the \
             same filters as list_issues. Issues already linked on any board of the project are skipped.",
            json!({ "project": project, "board": board, "column": column,
                    "issues": { "type": "array", "items": { "type": "string" }, "description": "Issues as \"owner/repo#123\" or URLs" },
                    "all_matching": { "type": "boolean", "description": "Add every cached issue matching the filters below" },
                    "state": { "type": "string", "enum": ["open", "closed", "all"], "description": "Filter for all_matching (default open)" },
                    "query": s("Text filter for all_matching"), "repo": s("owner/repo filter for all_matching"),
                    "include_prs": { "type": "boolean", "description": "Include pull requests with all_matching" } }),
            &["project", "board"], "write"),

        tool("list_history",
            "Recent changes to the vault, newest first: who made them (the app's user, or an MCP client and tool), \
             what changed, and whether they were undone. Use it to review what happened or to find an entry to undo.",
            json!({ "project": s("Limit to one project (optional)"), "board": s("Limit to one board of that project (optional)"),
                    "by": { "type": "string", "enum": ["app", "mcp"], "description": "Only changes made in the app, or only by MCP clients" },
                    "limit": { "type": "integer", "minimum": 1, "description": "Default 20" } }),
            &[], "read"),
        tool("undo",
            "Undo one history entry (from list_history) by reverting its changes on the current files. The undo is \
             recorded too, so undoing the undo redoes it. If something it touched was changed again since, nothing is \
             changed and the conflicts are listed; pass skip_conflicts: true to undo everything else.",
            json!({ "id": s("History entry id"), "skip_conflicts": { "type": "boolean" } }),
            &["id"], "write"),
    ]
}

// ------------------------------------------------------------------------------- arguments

fn arg_str<'a>(a: &'a Value, k: &str) -> Option<&'a str> {
    a.get(k).and_then(Value::as_str)
}

fn req_str<'a>(a: &'a Value, k: &str) -> R<&'a str> {
    arg_str(a, k)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("Missing required argument '{k}'"))
}

/// A preset name, or a hex color ("#rgb" / "#rrggbb", "#" optional) normalized to "#rrggbb".
fn parse_color(c: &str) -> Option<String> {
    let c = c.trim();
    if COLORS.contains(&c) {
        return Some(c.into());
    }
    let hex = c.strip_prefix('#').unwrap_or(c).to_ascii_lowercase();
    if !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }
    match hex.len() {
        6 => Some(format!("#{hex}")),
        3 => Some(format!("#{}", hex.chars().flat_map(|ch| [ch, ch]).collect::<String>())),
        _ => None,
    }
}

fn arg_color(a: &Value, k: &str) -> R<Option<String>> {
    match arg_str(a, k) {
        None => Ok(None),
        Some(c) => parse_color(c).map(Some).ok_or_else(|| {
            format!(
                "Unknown color '{c}'. Use a hex color like \"#3b82f6\" or one of: {}",
                COLORS.join(", ")
            )
        }),
    }
}

fn arg_priority(a: &Value) -> R<Option<String>> {
    match arg_str(a, "priority") {
        None => Ok(None),
        Some(p) if PRIORITIES.contains(&p) => Ok(Some(p.into())),
        Some(p) => Err(format!("Unknown priority '{p}'. Use one of: {}", PRIORITIES.join(", "))),
    }
}

fn arg_due(a: &Value) -> R<Option<Value>> {
    match arg_str(a, "due_date") {
        None => Ok(None),
        Some("") => Ok(Some(Value::Null)),
        Some(d) => {
            let ok = d.len() == 10
                && d.as_bytes()[4] == b'-'
                && d.as_bytes()[7] == b'-'
                && d.chars().filter(|c| c.is_ascii_digit()).count() == 8;
            if ok {
                Ok(Some(json!(d)))
            } else {
                Err(format!("due_date must be YYYY-MM-DD, got '{d}'"))
            }
        }
    }
}

fn parse_issue(s: &str) -> R<Value> {
    let s = s.trim();
    // https://github.com/owner/repo/issues/12 or .../pull/12
    if let Some(rest) = s.split("github.com/").nth(1) {
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() >= 4 {
            if let Ok(n) = parts[3].trim_end_matches(|c: char| !c.is_ascii_digit()).parse::<u64>() {
                return Ok(json!({ "repo": format!("{}/{}", parts[0], parts[1]), "number": n }));
            }
        }
    }
    if let Some((repo, num)) = s.split_once('#') {
        if repo.contains('/') {
            if let Ok(n) = num.parse::<u64>() {
                return Ok(json!({ "repo": repo, "number": n }));
            }
        }
    }
    Err(format!("Cannot parse issue '{s}'. Use owner/repo#123 or an issue URL."))
}

fn arg_issue(a: &Value) -> R<Option<Value>> {
    match arg_str(a, "issue") {
        None => Ok(None),
        Some("") => Ok(Some(Value::Null)),
        Some(s) => parse_issue(s).map(Some),
    }
}

fn arg_labels(a: &Value) -> Option<Value> {
    a.get("labels").and_then(Value::as_array).map(|arr| {
        Value::Array(
            arr.iter()
                .filter_map(Value::as_str)
                .map(|s| json!(s.trim()))
                .filter(|v| v != "")
                .collect(),
        )
    })
}

fn parse_repo(s: &str) -> R<Value> {
    let s = s.trim().trim_end_matches(".git").trim_end_matches('/');
    let s = s.split("github.com/").last().unwrap_or(s);
    let parts: Vec<&str> = s.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() == 2 {
        Ok(json!({ "owner": parts[0], "repo": parts[1] }))
    } else {
        Err(format!("Invalid repo '{s}'. Use owner/repo."))
    }
}

fn eq_ci(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

// ------------------------------------------------------------------------------- vault model

struct Proj {
    dir: String,
    path: PathBuf,
    data: Value,
}

struct BoardFile {
    path: PathBuf,
    data: Value,
}

fn load_projects(ctx: &Ctx) -> R<Vec<Proj>> {
    let mut out = vec![];
    for e in std::fs::read_dir(ctx.vault()?).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !e.path().is_dir() {
            continue;
        }
        let path = e.path().join("project.json");
        if let Ok(data) = vaultfs::read_json(&path) {
            out.push(Proj { dir: name, path, data });
        }
    }
    Ok(out)
}

fn find_project(ctx: &Ctx, q: &str) -> R<Proj> {
    let all = load_projects(ctx)?;
    let names: Vec<String> = all.iter().map(|p| s(&p.data, "name")).collect();
    all.into_iter()
        .find(|p| s(&p.data, "id") == q || eq_ci(&p.dir, q) || eq_ci(&s(&p.data, "name"), q))
        .ok_or_else(|| format!("Project '{q}' not found. Available: {}", list_or_none(&names)))
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

fn list_or_none(v: &[String]) -> String {
    if v.is_empty() {
        "(none)".into()
    } else {
        v.join(", ")
    }
}

fn boards_dir(p: &Proj) -> PathBuf {
    p.path.parent().unwrap().join("boards")
}

fn load_boards(p: &Proj) -> R<Vec<BoardFile>> {
    let dir = boards_dir(p);
    let mut out = vec![];
    if !dir.is_dir() {
        return Ok(out);
    }
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) == Some("json") {
            if let Ok(data) = vaultfs::read_json(&path) {
                out.push(BoardFile { path, data });
            }
        }
    }
    // Respect the order shown in the app's sidebar.
    let order: Vec<String> = p.data["boardOrder"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    out.sort_by_key(|b| {
        order
            .iter()
            .position(|id| *id == s(&b.data, "id"))
            .unwrap_or(usize::MAX)
    });
    Ok(out)
}

fn find_board(p: &Proj, q: &str) -> R<BoardFile> {
    let all = load_boards(p)?;
    let names: Vec<String> = all.iter().map(|b| s(&b.data, "name")).collect();
    all.into_iter()
        .find(|b| s(&b.data, "id") == q || eq_ci(&s(&b.data, "name"), q))
        .ok_or_else(|| {
            format!(
                "Board '{q}' not found in project '{}'. Available: {}",
                s(&p.data, "name"),
                list_or_none(&names)
            )
        })
}

fn columns_mut(b: &mut Value) -> &mut Vec<Value> {
    if !b["columns"].is_array() {
        b["columns"] = json!([]);
    }
    b["columns"].as_array_mut().unwrap()
}

fn tasks_mut(b: &mut Value) -> &mut Map<String, Value> {
    if !b["tasks"].is_object() {
        b["tasks"] = json!({});
    }
    b["tasks"].as_object_mut().unwrap()
}

fn is_plan(b: &Value) -> bool {
    b["kind"] == "plan"
}

fn is_notes(b: &Value) -> bool {
    b["kind"] == "notes"
}

/// Refuses plan and notes boards where only kanban boards make sense.
fn kanban(b: &Value) -> R<()> {
    if is_notes(b) {
        return Err(format!(
            "'{}' is a notes board: it holds post-it notes, not columns and tasks. Read them with get_board.",
            s(b, "name")
        ));
    }
    if is_plan(b) {
        return Err(format!("'{}' is a plan board: it has steps and checklist items, not columns and tasks. Use get_plan and the plan tools.", s(b, "name")));
    }
    Ok(())
}

fn find_column(b: &Value, q: &str) -> R<usize> {
    let cols = b["columns"].as_array().cloned().unwrap_or_default();
    cols.iter()
        .position(|c| s(c, "id") == q || eq_ci(&s(c, "name"), q))
        .ok_or_else(|| {
            let names: Vec<String> = cols.iter().map(|c| s(c, "name")).collect();
            format!("Column '{q}' not found. Available: {}", list_or_none(&names))
        })
}

/// The label a live label column mirrors: a `source` of kind "label" not yet found deleted. Such a
/// column shows the cached issues carrying the label and never holds tasks.
fn live_label(c: &Value) -> Option<&Value> {
    let src = &c["source"];
    (src["kind"] == "label" && src["deletedAt"].is_null()).then_some(src)
}

/// The tags of a tag column: a `source` of kind "tags". Such a column shows the board's tasks
/// carrying the tags (any of them, or all) and never holds tasks itself.
fn tag_source(c: &Value) -> Option<&Value> {
    let src = &c["source"];
    (src["kind"] == "tags").then_some(src)
}

/// A column whose cards are computed (a live label column or a tag column) rather than held.
fn view_column(c: &Value) -> bool {
    live_label(c).is_some() || tag_source(c).is_some()
}

/// Id of the board's done column: the one picked as such, else the last column that holds tasks
/// (as `doneColumn` in src/lib/labelColumns.ts).
pub(crate) fn done_column(b: &Value) -> Option<String> {
    let own: Vec<&Value> = b["columns"].as_array()?.iter().filter(|c| !view_column(c)).collect();
    own.iter()
        .find(|c| c["id"] == b["doneColumn"])
        .or(own.last())
        .map(|c| s(c, "id"))
}

/// Whether a task moved into column `col` goes straight to the archive: it is the done column of a board that
/// auto-archives (as `autoArchives` in src/lib/store.ts).
pub(crate) fn auto_archives(b: &Value, col: &str) -> bool {
    b["autoArchive"] == true && done_column(b).as_deref() == Some(col)
}

/// Puts a task at the front of the board's archive, as archived from column `from`.
fn push_archive(b: &mut Value, task: Value, from: &str) {
    let rest = b["archive"].as_array().cloned().unwrap_or_default();
    let entry = json!({ "task": task, "from": from, "at": now_iso() });
    b["archive"] = Value::Array(std::iter::once(entry).chain(rest).collect());
}

/// Saves the done column explicitly, so adding, moving or deleting columns can't change it (D-3).
fn pin_done(b: &mut Value) {
    if let Some(id) = done_column(b) {
        b["doneColumn"] = json!(id);
    }
}

fn str_list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
        .unwrap_or_default()
}

/// Trimmed, non-empty tags, without case-insensitive duplicates.
fn clean_tags(v: &Value) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for t in str_list(v).iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        if !out.iter().any(|o| eq_ci(o, t)) {
            out.push(t.to_string());
        }
    }
    out
}

fn tag_column_name(tags: &[String], all: bool) -> String {
    tags.join(if all { " + " } else { " / " })
}

/// Whether a task shows in a tag column.
fn has_tags(t: &Value, src: &Value) -> bool {
    let own = str_list(&t["labels"]);
    let has = |g: &String| own.iter().any(|l| eq_ci(l, g));
    let tags = str_list(&src["tags"]);
    !tags.is_empty()
        && if src["match"] == "all" {
            tags.iter().all(has)
        } else {
            tags.iter().any(has)
        }
}

fn arg_match(a: &Value) -> R<Option<&'static str>> {
    match arg_str(a, "match") {
        None | Some("") => Ok(None),
        Some("any") => Ok(Some("any")),
        Some("all") => Ok(Some("all")),
        Some(m) => Err(format!("Unknown match '{m}'. Use \"any\" or \"all\".")),
    }
}

/// A column that can hold tasks: `q` if given (refused when it is a live label or tag column), else the first such column.
fn task_column(b: &Value, q: Option<&str>) -> R<usize> {
    kanban(b)?;
    let cols = b["columns"].as_array().cloned().unwrap_or_default();
    match q.filter(|q| !q.is_empty()) {
        Some(q) => {
            let i = find_column(b, q)?;
            if let Some(src) = live_label(&cols[i]) {
                return Err(format!(
                    "Column '{}' shows the GitHub issues labeled '{}' in {} and can't hold tasks; use another column.",
                    s(&cols[i], "name"),
                    s(src, "name"),
                    s(src, "repo")
                ));
            }
            if let Some(src) = tag_source(&cols[i]) {
                return Err(format!(
                    "Column '{}' shows the board's tasks tagged {} and can't hold tasks; put the task in another column and give it the tag instead.",
                    s(&cols[i], "name"), str_list(&src["tags"]).join(", ")
                ));
            }
            Ok(i)
        }
        None => cols
            .iter()
            .position(|c| !view_column(c))
            .ok_or_else(|| "Board has no column that can hold tasks; create one first".into()),
    }
}

/// The cached issues a live label column shows, open ones first, most recently updated first.
fn label_issues(cache: &Value, src: &Value) -> Vec<Value> {
    let show_closed = src["showClosed"].as_bool().unwrap_or(false);
    let mut out: Vec<Value> = cache["repos"][s(src, "repo")]["issues"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| show_closed || i["state"] == "open")
        .filter(|i| {
            i["labels"].as_array().is_some_and(|ls| {
                ls.iter().any(|l| {
                    if l["id"].is_null() {
                        l["name"] == src["name"]
                    } else {
                        l["id"] == src["labelId"]
                    }
                })
            })
        })
        .collect();
    out.sort_by(|a, b| {
        (a["state"] != "open")
            .cmp(&(b["state"] != "open"))
            .then_with(|| s(b, "updatedAt").cmp(&s(a, "updatedAt")))
    });
    out
}

fn find_task(b: &Value, q: &str) -> R<String> {
    let tasks = b["tasks"].as_object().cloned().unwrap_or_default();
    if tasks.contains_key(q) {
        return Ok(q.to_string());
    }
    let matches: Vec<&String> = tasks
        .iter()
        .filter(|(_, t)| eq_ci(&s(t, "title"), q))
        .map(|(id, _)| id)
        .collect();
    match matches.len() {
        1 => Ok(matches[0].clone()),
        0 => Err(format!("Task '{q}' not found on board '{}'", s(b, "name"))),
        _ => Err(format!("Several tasks are titled '{q}'; use the task id")),
    }
}

fn remove_task_from_columns(b: &mut Value, task_id: &str) {
    for c in columns_mut(b) {
        if let Some(ids) = c["taskIds"].as_array_mut() {
            ids.retain(|v| v.as_str() != Some(task_id));
        }
    }
}

fn insert_at(arr: &mut Vec<Value>, pos: Option<u64>, v: Value) {
    let i = pos.map(|p| (p as usize).min(arr.len())).unwrap_or(arr.len());
    arr.insert(i, v);
}

fn new_column(name: &str, color: &str) -> Value {
    json!({ "id": new_id(), "name": name, "color": color, "wipLimit": null, "taskIds": [], "source": null })
}

/// A live column for the cached label named `label` (in `repo`, or the one project repo that has it).
fn label_column(p: &Proj, board: &Value, label: &str, repo: Option<&str>, show_closed: bool) -> R<Value> {
    let cache = vaultfs::read_json(&issue_cache_path(p)).unwrap_or(json!({ "repos": {} }));
    let repos = cache["repos"].as_object().cloned().unwrap_or_default();
    let found: Vec<(String, Value)> = repos
        .iter()
        .filter(|(k, _)| repo.is_none_or(|r| eq_ci(k, r)))
        .flat_map(|(k, rc)| {
            rc["labels"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|l| eq_ci(&s(l, "name"), label) && l["id"].is_u64())
                .map(move |l| (k.clone(), l))
        })
        .collect();
    let (repo, l) = match found.as_slice() {
        [one] => one.clone(),
        [] => {
            return Err(format!(
                "Label '{label}' not found in the cached labels{}. Run sync_issues first, or check the name.",
                repo.map(|r| format!(" of {r}")).unwrap_or_default()
            ))
        }
        many => {
            return Err(format!(
                "Label '{label}' exists in several repos ({}); pass `repo`.",
                many.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(", ")
            ))
        }
    };
    let taken = board["columns"].as_array().is_some_and(|cs| {
        cs.iter()
            .any(|c| live_label(c).is_some_and(|src| src["repo"] == json!(repo) && src["labelId"] == l["id"]))
    });
    if taken {
        return Err(format!(
            "This board already has a column for the label '{}' of {repo}",
            s(&l, "name")
        ));
    }
    let mut col = new_column(&s(&l, "name"), &format!("#{}", s(&l, "color")));
    col["source"] = json!({ "kind": "label", "repo": repo, "labelId": l["id"], "name": l["name"], "showClosed": show_closed, "deletedAt": null });
    Ok(col)
}

fn new_board(name: &str, description: &str, cols: Option<Vec<String>>) -> Value {
    let defaults = [("To Do", "slate"), ("Doing", "blue"), ("Done", "emerald")];
    let columns: Vec<Value> = match cols {
        Some(names) if !names.is_empty() => names.iter().map(|n| new_column(n, "slate")).collect(),
        _ => defaults.iter().map(|(n, c)| new_column(n, c)).collect(),
    };
    let t = now_iso();
    let mut b = json!({ "schemaVersion": 1, "id": new_id(), "name": name, "description": description,
                        "columns": columns, "tasks": {}, "createdAt": t, "updatedAt": t });
    pin_done(&mut b);
    b
}

fn save_board(ctx: &Ctx, b: &mut BoardFile) -> R<()> {
    prune_links(&mut b.data);
    b.data["updatedAt"] = json!(now_iso());
    ctx.write_json(&b.path, &b.data)
}

fn save_project(ctx: &Ctx, p: &mut Proj) -> R<()> {
    p.data["updatedAt"] = json!(now_iso());
    ctx.write_json(&p.path, &p.data)
}

fn board_summary(b: &Value) -> Value {
    if is_notes(b) {
        let n = b["notes"].as_array().map(Vec::len).unwrap_or(0);
        return json!({ "id": b["id"], "name": b["name"], "kind": "notes", "description": b["description"], "notes": n,
                       "updatedAt": b["updatedAt"] });
    }
    if is_plan(b) {
        let (done, total) = plan::plan_progress(&b["plan"]);
        let steps = b["plan"]["steps"].as_array().map(Vec::len).unwrap_or(0);
        return json!({ "id": b["id"], "name": b["name"], "kind": "plan", "description": b["description"], "steps": steps,
                       "progress": format!("{done}/{total} items done or skipped"), "updatedAt": b["updatedAt"] });
    }
    let cols: Vec<Value> = b["columns"].as_array().cloned().unwrap_or_default().iter()
        .map(|c| {
            let mut v = json!({ "id": c["id"], "name": c["name"], "tasks": c["taskIds"].as_array().map(|a| a.len()).unwrap_or(0) });
            if let Some(src) = live_label(c) { v["githubLabel"] = json!(format!("{}: {}", s(src, "repo"), s(src, "name"))); }
            if let Some(src) = tag_source(c) {
                v["tags"] = src["tags"].clone();
                v["match"] = src["match"].clone();
                v["tasks"] = json!(b["tasks"].as_object().map(|ts| ts.values().filter(|t| has_tags(t, src)).count()).unwrap_or(0));
            }
            v
        })
        .collect();
    json!({ "id": b["id"], "name": b["name"], "description": b["description"], "columns": cols, "updatedAt": b["updatedAt"] })
}

/// `boards`: every board of the task's project, for its links.
/// `(board id, task id)` of every task some link points at, so tasks no link touches skip the
/// project-wide scan of [`task_links`]: listing a big board stays linear.
fn link_targets(boards: &[Value]) -> HashSet<(String, String)> {
    boards
        .iter()
        .flat_map(|b| b["tasks"].as_object().into_iter().flatten())
        .flat_map(|(_, t)| links_of(t))
        .map(|l| (s(&l, "board"), s(&l, "task")))
        .collect()
}

/// Tasks get_board lists from a done column unless told otherwise.
const DONE_LIMIT: u64 = 20;
/// Tasks search_tasks lists unless told otherwise.
const SEARCH_LIMIT: u64 = 50;

fn task_view(
    boards: &[Value],
    targets: &HashSet<(String, String)>,
    board: &Value,
    t: &Value,
    with_description: bool,
) -> Value {
    let mut v = json!({ "id": t["id"], "title": t["title"], "priority": t["priority"], "labels": t["labels"],
                        "dueDate": t["dueDate"], "issue": t["issue"] });
    if !links_of(t).is_empty() || targets.contains(&(s(board, "id"), s(t, "id"))) {
        let (blocks, blocked_by, relates) = task_links(boards, &s(board, "id"), &s(t, "id"));
        for (k, l) in [("blocks", blocks), ("blockedBy", blocked_by), ("relatesTo", relates)] {
            if !l.is_empty() {
                v[k] = json!(l);
            }
        }
    }
    if let Some(cl) = t["checklist"].as_array() {
        if !cl.is_empty() {
            v["checklist"] = json!(cl);
        }
    }
    if with_description && !s(t, "description").is_empty() {
        v["description"] = t["description"].clone();
    }
    v
}

// Links between tasks of a project, stored once on the task they start from: `{ type: "blocks", board,
// task }` on the blocker, `{ type: "relates", board, task }` on either side. A pair has at most one link,
// `links` is left out when empty, and links to tasks that are gone are skipped. Same rules as src/lib/links.ts.

fn links_of(t: &Value) -> Vec<Value> {
    t["links"].as_array().cloned().unwrap_or_default()
}

fn put_links(t: &mut Value, links: Vec<Value>) {
    if links.is_empty() {
        if let Some(o) = t.as_object_mut() {
            o.remove("links");
        }
    } else {
        t["links"] = Value::Array(links);
    }
}

fn points_to(l: &Value, board: &str, task: &str) -> bool {
    s(l, "board") == board && s(l, "task") == task
}

/// What the task blocks, what blocks it and what it relates to, as `{ id, title, board }`, from both
/// sides, across `boards` (every board of the project).
fn task_links(boards: &[Value], board_id: &str, id: &str) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
    let (mut blocks, mut blocked_by, mut relates) = (vec![], vec![], vec![]);
    let find = |b: &str, t: &str| {
        boards
            .iter()
            .find(|x| s(x, "id") == b)
            .and_then(|x| x["tasks"].get(t).map(|t| (x, t)))
    };
    let brief = |b: &Value, t: &Value| json!({ "id": t["id"], "title": t["title"], "board": b["name"] });
    if let Some((_, me)) = find(board_id, id) {
        for l in links_of(me) {
            if points_to(&l, board_id, id) {
                continue;
            }
            let Some((b, other)) = find(&s(&l, "board"), &s(&l, "task")) else {
                continue;
            };
            if s(&l, "type") == "blocks" {
                blocks.push(brief(b, other))
            } else {
                relates.push(brief(b, other))
            }
        }
    }
    for b in boards {
        for (tid, t) in b["tasks"].as_object().into_iter().flatten() {
            if s(b, "id") == board_id && tid == id {
                continue;
            }
            for l in links_of(t).iter().filter(|l| points_to(l, board_id, id)) {
                if s(l, "type") == "blocks" {
                    blocked_by.push(brief(b, t));
                } else if !relates.contains(&brief(b, t)) {
                    relates.push(brief(b, t));
                }
            }
        }
    }
    (blocks, blocked_by, relates)
}

/// Removes whatever link two tasks have; `x` and `y` are (board index in `boards`, task id).
/// Returns the indexes of the boards that changed.
fn unlink_pair(boards: &mut [Value], x: (usize, &str), y: (usize, &str)) -> Vec<usize> {
    let mut changed = vec![];
    for (from, to) in [(x, y), (y, x)] {
        let to_board = s(&boards[to.0], "id");
        let Some(t) = tasks_mut(&mut boards[from.0]).get_mut(from.1) else {
            continue;
        };
        let mut links = links_of(t);
        let n = links.len();
        links.retain(|l| !points_to(l, &to_board, to.1));
        if links.len() != n {
            put_links(t, links);
            t["updatedAt"] = json!(now_iso());
            changed.push(from.0);
        }
    }
    changed
}

/// `move_task` to another board: the task keeps its id (unless `to` already has one like it) and links
/// to it on every board of the project follow it. Same rules as `moveTaskToBoard` in src/lib/store.ts.
fn move_task_to_board(ctx: &Ctx, p: &Proj, mut from: BoardFile, mut to: BoardFile, id: &str, a: &Value) -> R<Value> {
    kanban(&from.data)?;
    let ci = task_column(&to.data, Some(req_str(a, "column")?))?;
    let (from_id, to_id) = (s(&from.data, "id"), s(&to.data, "id"));
    let new = if to.data["tasks"].get(id).is_some() {
        new_id()
    } else {
        id.to_string()
    };
    let mut task = tasks_mut(&mut from.data).remove(id).ok_or("Task not found")?;
    remove_task_from_columns(&mut from.data, id);
    task["id"] = json!(new);
    task["updatedAt"] = json!(now_iso());
    let title = s(&task, "title");
    let col_id = s(&to.data["columns"][ci], "id");
    let col_name = s(&to.data["columns"][ci], "name");
    let archived = auto_archives(&to.data, &col_id);
    if archived {
        push_archive(&mut to.data, task, &col_id);
    } else {
        tasks_mut(&mut to.data).insert(new.clone(), task);
        let col = &mut columns_mut(&mut to.data)[ci];
        if !col["taskIds"].is_array() {
            col["taskIds"] = json!([]);
        }
        insert_at(
            col["taskIds"].as_array_mut().unwrap(),
            a.get("position").and_then(Value::as_u64),
            json!(new),
        );
    }
    // Before saving: saving `from` drops its links to tasks it no longer has.
    let (old, moved) = ((from_id.as_str(), id), (to_id.as_str(), new.as_str()));
    retarget_links(&mut from.data, old, moved);
    retarget_links(&mut to.data, old, moved);
    save_board(ctx, &mut to)?;
    save_board(ctx, &mut from)?;
    for mut f in load_boards(p)? {
        let fid = s(&f.data, "id");
        if fid != from_id && fid != to_id && retarget_links(&mut f.data, old, moved) {
            save_board(ctx, &mut f)?;
        }
    }
    let archived = if archived {
        ", which auto-archives: it is now in that board's archive"
    } else {
        ""
    };
    Ok(json!(format!(
        "Moved task '{title}' to '{}' · '{col_name}' (id {new}){archived}",
        s(&to.data, "name")
    )))
}

/// Points the board's links to task `old` (board id, task id) at `new` instead. Returns whether any changed.
fn retarget_links(b: &mut Value, old: (&str, &str), new: (&str, &str)) -> bool {
    let mut changed = false;
    for t in tasks_mut(b).values_mut() {
        let mut links = links_of(t);
        if !links.iter().any(|l| points_to(l, old.0, old.1)) {
            continue;
        }
        for l in links.iter_mut().filter(|l| points_to(l, old.0, old.1)) {
            l["board"] = json!(new.0);
            l["task"] = json!(new.1);
        }
        put_links(t, links);
        changed = true;
    }
    changed
}

/// Drops links to tasks of this same board that no longer exist. Links to other boards are left
/// alone (they are skipped when read), so undoing a deletion there brings them back.
fn prune_links(b: &mut Value) {
    let board_id = s(b, "id");
    // Links to an archived task stay, so restoring it brings them back.
    let archived: Vec<String> = b["archive"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|a| s(&a["task"], "id"))
        .collect();
    let Some(tasks) = b["tasks"].as_object_mut() else {
        return;
    };
    let ids: HashSet<String> = tasks.keys().cloned().chain(archived).collect();
    for (id, t) in tasks.iter_mut() {
        let links = links_of(t);
        let keep = |l: &Value| s(l, "board") != board_id || (ids.contains(&s(l, "task")) && s(l, "task") != *id);
        if !links.iter().all(keep) {
            put_links(t, links.into_iter().filter(|l| keep(l)).collect());
        }
    }
}

/// The boards of a link edit: `board`, and `other_board` when it is another one. Returns the files
/// and the index of the other task's board among them.
fn link_boards(p: &Proj, a: &Value) -> R<(Vec<BoardFile>, usize)> {
    let b = find_board(p, req_str(a, "board")?)?;
    kanban(&b.data)?;
    match arg_str(a, "other_board").filter(|o| !o.trim().is_empty()) {
        Some(q) => {
            let o = find_board(p, q)?;
            kanban(&o.data)?;
            if o.data["id"] == b.data["id"] {
                Ok((vec![b], 0))
            } else {
                Ok((vec![b, o], 1))
            }
        }
        None => Ok((vec![b], 0)),
    }
}

struct DecisionFile {
    path: PathBuf,
    data: Value,
}

fn decisions_dir(p: &Proj) -> PathBuf {
    p.path.parent().unwrap().join("decisions")
}

/// The project's decisions, by number.
fn load_decisions(p: &Proj) -> R<Vec<DecisionFile>> {
    let dir = decisions_dir(p);
    let mut out = vec![];
    if !dir.is_dir() {
        return Ok(out);
    }
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = e.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|x| x.to_str()) == Some("json") {
            if let Ok(data) = vaultfs::read_json(&path) {
                out.push(DecisionFile { path, data });
            }
        }
    }
    out.sort_by_key(|d| d.data["number"].as_u64().unwrap_or(0));
    Ok(out)
}

/// "D-12", "d12", "12", an id, or an exact title.
fn find_decision(p: &Proj, q: &str) -> R<DecisionFile> {
    let q = q.trim();
    let number = q
        .trim_start_matches(['D', 'd'])
        .trim_start_matches('-')
        .parse::<u64>()
        .ok();
    let mut all = load_decisions(p)?;
    if let Some(i) = all
        .iter()
        .position(|d| s(&d.data, "id") == q || number.is_some_and(|n| d.data["number"].as_u64() == Some(n)))
    {
        return Ok(all.swap_remove(i));
    }
    let mut titled: Vec<DecisionFile> = all.into_iter().filter(|d| eq_ci(&s(&d.data, "title"), q)).collect();
    match titled.len() {
        1 => Ok(titled.remove(0)),
        0 => Err(format!(
            "Decision '{q}' not found in project '{}'. Use search_decisions to find it.",
            s(&p.data, "name")
        )),
        _ => Err(format!("Several decisions are titled '{q}'; use its number (D-…)")),
    }
}

/// The project's limit on a decision's why + rejected alternative, in characters.
fn decision_limit(p: &Proj) -> u64 {
    p.data["decisionCharLimit"]
        .as_u64()
        .filter(|n| (DECISION_LIMIT_MIN..=DECISION_LIMIT_MAX).contains(n))
        .unwrap_or(DECISION_LIMIT_DEFAULT)
}

fn decision_len(d: &Value) -> u64 {
    (s(d, "why").chars().count() + s(d, "rejected").chars().count()) as u64
}

fn too_long(len: u64, limit: u64) -> String {
    format!(
        "Too long: the why and the rejected alternative hold {len} characters together, and this project's decisions \
         are limited to {limit}. Keep only the reason, so it can be read in 30 seconds."
    )
}

fn decision_ref(d: &Value) -> String {
    format!("D-{}", d["number"].as_u64().unwrap_or(0))
}

/// Trimmed, non-empty strings without exact duplicates.
fn clean_list(v: &Value) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for t in str_list(v).iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        if !out.iter().any(|o| o == t) {
            out.push(t.to_string());
        }
    }
    out
}

fn arg_issues(a: &Value) -> R<Option<Value>> {
    let Some(list) = a.get("issues").and_then(Value::as_array) else {
        return Ok(None);
    };
    let mut out: Vec<Value> = vec![];
    for i in list.iter().filter_map(Value::as_str).filter(|i| !i.trim().is_empty()) {
        let r = parse_issue(i)?;
        if !out.contains(&r) {
            out.push(r);
        }
    }
    Ok(Some(Value::Array(out)))
}

fn decision_view(d: &Value, all: &[DecisionFile]) -> Value {
    let mut v = json!({ "ref": decision_ref(d), "id": d["id"], "title": d["title"], "why": d["why"] });
    if !s(d, "rejected").is_empty() {
        v["rejected"] = d["rejected"].clone();
    }
    for k in ["about", "tags"] {
        if d[k].as_array().is_some_and(|a| !a.is_empty()) {
            v[k] = d[k].clone();
        }
    }
    if let Some(issues) = d["issues"].as_array().filter(|a| !a.is_empty()) {
        v["issues"] = json!(issues
            .iter()
            .map(|i| format!("{}#{}", s(i, "repo"), i["number"]))
            .collect::<Vec<_>>());
    }
    if let Some(by) = d["replacedBy"].as_u64() {
        let title = all
            .iter()
            .find(|o| o.data["number"].as_u64() == Some(by))
            .map(|o| s(&o.data, "title"))
            .unwrap_or_default();
        v["replacedBy"] = json!(format!("D-{by} {title}").trim_end());
    }
    v["createdAt"] = d["createdAt"].clone();
    v["updatedAt"] = d["updatedAt"].clone();
    v
}

/// How well a decision matches every token of a query (0 = not at all): code references weigh most, then the title.
fn decision_score(d: &Value, tokens: &[String]) -> u32 {
    let lower = |v: &Value| {
        str_list(v)
            .iter()
            .map(|x| x.to_lowercase())
            .collect::<Vec<_>>()
            .join(" ")
    };
    let about = lower(&d["about"]);
    let title = s(d, "title").to_lowercase();
    let issues: Vec<String> = d["issues"]
        .as_array()
        .map(|a| a.iter().map(|i| format!("{}#{}", s(i, "repo"), i["number"])).collect())
        .unwrap_or_default();
    let rest = format!(
        "{} {} {} {} {} d{}",
        s(d, "why"),
        s(d, "rejected"),
        lower(&d["tags"]),
        issues.join(" "),
        decision_ref(d),
        d["number"]
    )
    .to_lowercase();
    let mut score = 0;
    for t in tokens {
        score += if about.contains(t.as_str()) {
            3
        } else if title.contains(t.as_str()) {
            2
        } else if rest.contains(t.as_str()) {
            1
        } else {
            return 0;
        };
    }
    score
}

// ------------------------------------------------------------------------------- plans

fn plan_board(p: &Proj, q: &str) -> R<BoardFile> {
    let b = find_board(p, q)?;
    if !is_plan(&b.data) {
        let what = if is_notes(&b.data) {
            "a notes board"
        } else {
            "a kanban board"
        };
        return Err(format!("'{}' is {what}, not a plan; use get_board", s(&b.data, "name")));
    }
    Ok(b)
}

fn plan_mut(b: &mut BoardFile) -> &mut Value {
    if !b.data["plan"].is_object() {
        b.data["plan"] = plan::empty_plan();
    }
    &mut b.data["plan"]
}

fn steps_mut(b: &mut BoardFile) -> &mut Vec<Value> {
    let p = plan_mut(b);
    if !p["steps"].is_array() {
        p["steps"] = json!([]);
    }
    p["steps"].as_array_mut().unwrap()
}

/// A step by id, number ("3", 1-based as shown) or exact title.
fn find_step(b: &Value, q: &str) -> R<usize> {
    let steps = b["plan"]["steps"].as_array().cloned().unwrap_or_default();
    let q = q.trim();
    let n = q
        .trim_start_matches(|c: char| c.is_alphabetic() || c == ' ')
        .parse::<usize>()
        .ok();
    steps
        .iter()
        .position(|st| s(st, "id") == q || eq_ci(&s(st, "title"), q))
        .or_else(|| n.filter(|n| (1..=steps.len()).contains(n)).map(|n| n - 1))
        .ok_or_else(|| {
            format!(
                "Step '{q}' not found. Steps: {}",
                list_or_none(
                    &steps
                        .iter()
                        .enumerate()
                        .map(|(i, st)| format!("{}. {}", i + 1, s(st, "title")))
                        .collect::<Vec<_>>()
                )
            )
        })
}

/// An item by id, or by exact text when only one item has it: (step index, item id).
fn find_plan_item(b: &Value, q: &str) -> R<(usize, String)> {
    let mut by_text = vec![];
    for (i, st) in b["plan"]["steps"].as_array().into_iter().flatten().enumerate() {
        let mut all = vec![];
        plan::all_items(st["items"].as_array().map(Vec::as_slice).unwrap_or(&[]), &mut all);
        for (id, text) in all {
            if id == q {
                return Ok((i, id));
            }
            if eq_ci(&text, q) {
                by_text.push((i, id));
            }
        }
    }
    match by_text.len() {
        1 => Ok(by_text.remove(0)),
        0 => Err(format!("Item '{q}' not found; use an id from get_plan")),
        _ => Err(format!("Several items read '{q}'; use the id from get_plan")),
    }
}

fn step_items_mut(b: &mut BoardFile, step: usize) -> &mut Vec<Value> {
    let st = &mut steps_mut(b)[step];
    if !st["items"].is_array() {
        st["items"] = json!([]);
    }
    st["items"].as_array_mut().unwrap()
}

/// "D-12" / "12" → 12; "" → null.
fn arg_decision_ref(a: &Value) -> R<Option<Value>> {
    match arg_str(a, "decision").map(str::trim) {
        None => Ok(None),
        Some("") => Ok(Some(Value::Null)),
        Some(d) => d
            .trim_start_matches(['D', 'd'])
            .trim_start_matches('-')
            .parse::<u64>()
            .map(|n| Some(json!(n)))
            .map_err(|_| format!("decision must look like \"D-12\", got '{d}'")),
    }
}

fn item_view(it: &Value) -> Value {
    let mut v = json!({ "id": it["id"], "text": it["text"], "state": it["state"] });
    if !s(it, "reason").is_empty() {
        v["reason"] = it["reason"].clone();
    }
    if let Some(d) = it["decision"].as_u64() {
        v["decision"] = json!(format!("D-{d}"));
    }
    if let Some(ch) = it["children"].as_array().filter(|c| !c.is_empty()) {
        v["children"] = json!(ch.iter().map(item_view).collect::<Vec<_>>());
    }
    v
}

fn plan_view(b: &Value) -> Value {
    let plan = &b["plan"];
    let (done, total) = plan::plan_progress(plan);
    let steps: Vec<Value> = plan["steps"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, st)| {
            let items = st["items"].as_array().cloned().unwrap_or_default();
            let (d, t) = plan::progress(&items);
            let mut v =
                json!({ "number": i + 1, "id": st["id"], "title": st["title"], "progress": format!("{d}/{t}") });
            if !s(st, "notes").is_empty() {
                v["notes"] = st["notes"].clone();
            }
            v["items"] = json!(items.iter().map(item_view).collect::<Vec<_>>());
            v
        })
        .collect();
    let current = steps
        .iter()
        .find(|st| {
            let p = s(st, "progress");
            p.split_once('/').is_some_and(|(d, t)| d != t)
        })
        .map(|st| st["number"].clone());
    let issues: Vec<String> = plan["issues"]
        .as_array()
        .map(|a| a.iter().map(|i| format!("{}#{}", s(i, "repo"), i["number"])).collect())
        .unwrap_or_default();
    json!({ "id": b["id"], "name": b["name"], "kind": "plan", "description": b["description"], "issues": issues,
            "goal": plan["goal"], "progress": format!("{done}/{total} items done or skipped"), "currentStep": current,
            "steps": steps, "questions": plan["questions"], "notes": plan["notes"] })
}

const NOTE_LIMIT_DEFAULT: u64 = 280;
const NOTE_LIMIT_MIN: u64 = 20;
const NOTE_LIMIT_MAX: u64 = 5000;

fn notes_board(b: &Value) -> R<()> {
    if is_notes(b) {
        Ok(())
    } else {
        Err(format!(
            "'{}' is not a notes board; create one with create_board kind \"notes\"",
            s(b, "name")
        ))
    }
}

fn notes_mut(b: &mut Value) -> &mut Vec<Value> {
    if !b["notes"].is_array() {
        b["notes"] = json!([]);
    }
    b["notes"].as_array_mut().unwrap()
}

fn find_note(b: &Value, q: &str) -> R<usize> {
    let notes = b["notes"].as_array().cloned().unwrap_or_default();
    if let Some(i) = notes.iter().position(|n| s(n, "id") == q) {
        return Ok(i);
    }
    let by_title: Vec<usize> = notes
        .iter()
        .enumerate()
        .filter(|(_, n)| eq_ci(&s(n, "title"), q))
        .map(|(i, _)| i)
        .collect();
    match by_title.as_slice() {
        [i] => Ok(*i),
        [] => Err(format!(
            "Note '{q}' not found on '{}'. Use an id from get_board.",
            s(b, "name")
        )),
        _ => Err(format!("Several notes are titled '{q}'; use the id from get_board.")),
    }
}

/// Characters counted against the limit, like the app (code points).
fn note_length(n: &Value) -> usize {
    s(n, "title").chars().count() + s(n, "description").chars().count()
}

/// Refuses a note longer than the board's limit; one already over it (`old`) may stay but not grow.
fn note_fits(b: &Value, n: &Value, old: Option<&Value>) -> R<()> {
    let limit = b["noteLimit"]
        .as_u64()
        .filter(|l| (NOTE_LIMIT_MIN..=NOTE_LIMIT_MAX).contains(l))
        .unwrap_or(NOTE_LIMIT_DEFAULT) as usize;
    let room = limit.max(old.map(note_length).unwrap_or(0));
    let len = note_length(n);
    if len > room {
        return Err(format!(
            "The note's title and description are {len} characters; this board allows {limit}. Shorten it by {}.",
            len - room
        ));
    }
    Ok(())
}

fn arg_note_limit(a: &Value) -> R<Option<u64>> {
    match a.get("note_limit") {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_u64()
            .filter(|l| (NOTE_LIMIT_MIN..=NOTE_LIMIT_MAX).contains(l))
            .map(Some)
            .ok_or_else(|| format!("note_limit must be a whole number from {NOTE_LIMIT_MIN} to {NOTE_LIMIT_MAX}")),
    }
}

/// A color, or Null for "" (follow the first tag).
fn arg_note_color(a: &Value) -> R<Option<Value>> {
    match arg_str(a, "color") {
        Some(c) if c.trim().is_empty() => Ok(Some(Value::Null)),
        _ => Ok(arg_color(a, "color")?.map(|c| json!(c))),
    }
}

fn arg_strings(a: &Value, k: &str) -> Option<Value> {
    a.get(k).and_then(Value::as_array).map(|arr| {
        Value::Array(
            arr.iter()
                .filter_map(Value::as_str)
                .map(|s| json!(s.trim()))
                .filter(|v| v != "")
                .collect(),
        )
    })
}

/// A notes board's post-its in reading order (rows top to bottom, then left to right).
fn notes_view(b: &Value) -> Value {
    let mut notes = b["notes"].as_array().cloned().unwrap_or_default();
    notes.sort_by_key(|n| (n["y"].as_i64().unwrap_or(0) / 100, n["x"].as_i64().unwrap_or(0)));
    let notes: Vec<Value> = notes.iter().map(|n| {
        let issues: Vec<String> = n["issues"].as_array().map(|a| a.iter().map(|i| format!("{}#{}", s(i, "repo"), i["number"])).collect()).unwrap_or_default();
        let mut v = json!({ "id": n["id"], "title": n["title"], "description": n["description"], "tags": n["tags"], "issues": issues,
                            "x": n["x"], "y": n["y"] });
        if !n["color"].is_null() { v["color"] = n["color"].clone(); }
        v
    }).collect();
    json!({ "id": b["id"], "name": b["name"], "kind": "notes", "description": b["description"], "noteLimit": b["noteLimit"], "notes": notes })
}

fn issue_cache_path(p: &Proj) -> PathBuf {
    p.path.parent().unwrap().join(".cache").join("github-issues.json")
}

// ------------------------------------------------------------------------------- tools

/// Where each issue ("owner/repo#n") is linked on the project's boards.
fn issue_links(p: &Proj) -> R<HashMap<String, Vec<String>>> {
    let mut links: HashMap<String, Vec<String>> = HashMap::new();
    for b in load_boards(p)? {
        let tasks = b.data["tasks"].as_object().cloned().unwrap_or_default();
        for c in b.data["columns"].as_array().cloned().unwrap_or_default() {
            for id in c["taskIds"].as_array().cloned().unwrap_or_default() {
                if let Some(t) = id.as_str().and_then(|id| tasks.get(id)) {
                    if t["issue"].is_object() {
                        let k = format!("{}#{}", s(&t["issue"], "repo"), t["issue"]["number"]);
                        links.entry(k).or_default().push(format!(
                            "{} / {} (task {})",
                            s(&b.data, "name"),
                            s(&c, "name"),
                            s(t, "id")
                        ));
                    }
                }
            }
        }
    }
    Ok(links)
}

/// Cached issues matching the list_issues filters (`state`, `query`, `repo`, `include_prs`), as (repo key, issue).
fn filter_issues(cache: &Value, a: &Value) -> Vec<(String, Value)> {
    let state = arg_str(a, "state").unwrap_or("open");
    let query = arg_str(a, "query").unwrap_or("").to_lowercase();
    let repo_f = arg_str(a, "repo");
    let include_prs = a.get("include_prs").and_then(Value::as_bool).unwrap_or(false);
    let mut out = vec![];
    for (key, rc) in cache["repos"].as_object().cloned().unwrap_or_default() {
        if repo_f.is_some_and(|r| !eq_ci(r, &key)) {
            continue;
        }
        for i in rc["issues"].as_array().cloned().unwrap_or_default() {
            if !include_prs && i["isPullRequest"].as_bool() == Some(true) {
                continue;
            }
            if state != "all" && s(&i, "state") != state {
                continue;
            }
            if !query.is_empty()
                && !format!("{} {}", s(&i, "title"), s(&i, "body"))
                    .to_lowercase()
                    .contains(&query)
            {
                continue;
            }
            out.push((key.clone(), i));
        }
    }
    out
}

fn call_tool(ctx: &Ctx, name: &str, a: &Value) -> R<Value> {
    match name {
        "list_projects" => {
            let mut out = vec![];
            for p in load_projects(ctx)? {
                let boards = load_boards(&p)?;
                out.push(json!({
                    "id": p.data["id"], "name": p.data["name"], "folder": p.dir, "description": p.data["description"],
                    "color": p.data["color"], "repos": p.data["repos"], "tagColors": p.data.get("tagColors").cloned().unwrap_or(json!({})),
                    "boards": boards.iter().map(|b| json!({ "id": b.data["id"], "name": b.data["name"] })).collect::<Vec<_>>(),
                    "decisions": load_decisions(&p)?.len(), "decisionCharLimit": decision_limit(&p),
                }));
            }
            let vault = ctx.vault()?;
            // The name given to the vault in the app, if any (else it goes by its folder's name).
            let name = vaultfs::read_json(&vault.join(".astali").join("vault.json"))
                .ok()
                .and_then(|m| m["name"].as_str().map(str::to_string));
            Ok(
                json!({ "vault": vault.to_string_lossy(), "vaultName": name, "vaultSource": ctx.source.describe(), "projects": out }),
            )
        }
        "create_project" => {
            let name = req_str(a, "name")?.trim().to_string();
            let color = arg_color(a, "color")?.unwrap_or_else(|| "violet".into());
            let repos: Vec<Value> = a
                .get("repos")
                .and_then(Value::as_array)
                .map(|r| {
                    r.iter()
                        .filter_map(Value::as_str)
                        .map(parse_repo)
                        .collect::<R<Vec<_>>>()
                })
                .transpose()?
                .unwrap_or_default();
            let base = slugify(&name);
            let mut dir = base.clone();
            let mut i = 2;
            while ctx.vault()?.join(&dir).exists() {
                dir = format!("{base}-{i}");
                i += 1;
            }
            let board = new_board("Main", "", None);
            let t = now_iso();
            let project = json!({ "schemaVersion": 1, "id": new_id(), "name": name, "description": arg_str(a, "description").unwrap_or(""),
                                  "color": color, "repos": repos, "tagColors": {}, "decisionCharLimit": DECISION_LIMIT_DEFAULT,
                                  "boardOrder": [board["id"]], "createdAt": t, "updatedAt": t });
            let root = ctx.vault()?.join(&dir);
            ctx.write_json(&root.join("project.json"), &project)?;
            ctx.write_json(
                &root
                    .join("boards")
                    .join(format!("{}-{}.json", slugify("Main"), s(&board, "id"))),
                &board,
            )?;
            crate::gitignore::sync_if_enabled(&ctx.vault()?);
            Ok(json!({ "created": project, "folder": dir, "board": board_summary(&board) }))
        }
        "update_project" => {
            let mut p = find_project(ctx, req_str(a, "project")?)?;
            if let Some(n) = arg_str(a, "name").filter(|n| !n.trim().is_empty()) {
                p.data["name"] = json!(n.trim());
            }
            if let Some(d) = arg_str(a, "description") {
                p.data["description"] = json!(d);
            }
            if let Some(c) = arg_color(a, "color")? {
                p.data["color"] = json!(c);
            }
            if let Some(r) = a.get("repos").and_then(Value::as_array) {
                p.data["repos"] = Value::Array(
                    r.iter()
                        .filter_map(Value::as_str)
                        .map(parse_repo)
                        .collect::<R<Vec<_>>>()?,
                );
            }
            if let Some(l) = a.get("decision_char_limit").filter(|l| !l.is_null()) {
                match l
                    .as_u64()
                    .filter(|n| (DECISION_LIMIT_MIN..=DECISION_LIMIT_MAX).contains(n))
                {
                    Some(n) => p.data["decisionCharLimit"] = json!(n),
                    None => {
                        return Err(format!(
                        "decision_char_limit must be a whole number from {DECISION_LIMIT_MIN} to {DECISION_LIMIT_MAX}"
                    ))
                    }
                }
            }
            if let Some(tc) = a.get("tag_colors").and_then(Value::as_object) {
                if !p.data["tagColors"].is_object() {
                    p.data["tagColors"] = json!({});
                }
                for (tag, c) in tc {
                    let key = tag.trim().to_lowercase();
                    if key.is_empty() {
                        continue;
                    }
                    match c.as_str().map(str::trim) {
                        None | Some("") => {
                            p.data["tagColors"].as_object_mut().unwrap().remove(&key);
                        }
                        Some(c) => {
                            let c = parse_color(c).ok_or_else(|| format!("Unknown color '{c}' for tag '{tag}'. Use a hex color like \"#3b82f6\" or one of: {}", COLORS.join(", ")))?;
                            p.data["tagColors"][key] = json!(c);
                        }
                    }
                }
            }
            save_project(ctx, &mut p)?;
            Ok(json!({ "updated": p.data }))
        }
        "delete_project" => {
            if a.get("confirm").and_then(Value::as_bool) != Some(true) {
                return Err("Set confirm: true to delete a project".into());
            }
            let p = find_project(ctx, req_str(a, "project")?)?;
            ctx.remove(p.path.parent().unwrap())?;
            crate::gitignore::sync_if_enabled(&ctx.vault()?);
            Ok(json!(format!("Deleted project '{}'", s(&p.data, "name"))))
        }

        "list_boards" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            Ok(
                json!({ "project": p.data["name"], "boards": load_boards(&p)?.iter().map(|b| board_summary(&b.data)).collect::<Vec<_>>() }),
            )
        }
        "get_board" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let b = find_board(&p, req_str(a, "board")?)?;
            if is_plan(&b.data) {
                return Ok(plan_view(&b.data));
            }
            if is_notes(&b.data) {
                return Ok(notes_view(&b.data));
            }
            let with_desc = a.get("include_descriptions").and_then(Value::as_bool).unwrap_or(true);
            let done_limit = match a.get("done_limit").and_then(Value::as_u64).unwrap_or(DONE_LIMIT) {
                0 => usize::MAX,
                n => n as usize,
            };
            let all: Vec<Value> = load_boards(&p)?.into_iter().map(|x| x.data).collect();
            let targets = link_targets(&all);
            let tasks = b.data["tasks"].as_object().cloned().unwrap_or_default();
            let cache = vaultfs::read_json(&issue_cache_path(&p)).unwrap_or(json!({ "repos": {} }));
            let all_cols = b.data["columns"].as_array().cloned().unwrap_or_default();
            let done = done_column(&b.data);
            let columns: Vec<Value> = all_cols.iter().map(|c| {
                if let Some(src) = tag_source(c) {
                    let ts: Vec<Value> = all_cols.iter().filter(|h| !view_column(h)).flat_map(|h| {
                        str_list(&h["taskIds"]).into_iter().filter_map(|id| tasks.get(&id)).filter(|t| has_tags(t, src))
                            .map(|t| { let mut v = task_view(&all, &targets, &b.data, t, with_desc); v["column"] = h["name"].clone(); v }).collect::<Vec<_>>()
                    }).collect();
                    return json!({ "id": c["id"], "name": c["name"], "color": c["color"], "wipLimit": c["wipLimit"],
                                   "tags": src["tags"], "match": src["match"], "taggedTasks": ts });
                }
                if let Some(src) = live_label(c) {
                    let issues: Vec<Value> = label_issues(&cache, src).iter()
                        .map(|i| json!({ "ref": format!("{}#{}", s(i, "repo"), i["number"]), "title": i["title"], "state": i["state"], "url": i["url"] }))
                        .collect();
                    return json!({ "id": c["id"], "name": c["name"], "color": c["color"], "wipLimit": c["wipLimit"],
                                   "githubLabel": { "repo": src["repo"], "name": src["name"], "showClosed": src["showClosed"] }, "issues": issues });
                }
                let is_done = done.as_deref() == c["id"].as_str();
                let held: Vec<&Value> = c["taskIds"].as_array().into_iter().flatten().filter_map(|id| id.as_str().and_then(|id| tasks.get(id))).collect();
                // Finished work piles up over a year; the done column lists only its first few.
                let shown = if is_done { held.len().min(done_limit) } else { held.len() };
                let ts: Vec<Value> = held[..shown].iter().map(|t| task_view(&all, &targets, &b.data, t, with_desc)).collect();
                let mut v = json!({ "id": c["id"], "name": c["name"], "color": c["color"], "wipLimit": c["wipLimit"], "tasks": ts });
                if is_done { v["done"] = json!(true); }
                if is_done && b.data["autoArchive"] == true { v["autoArchive"] = json!(true); }
                if shown < held.len() { v["moreTasks"] = json!(held.len() - shown); }
                v
            }).collect();
            let mut out = json!({ "project": p.data["name"], "id": b.data["id"], "name": b.data["name"], "description": b.data["description"], "columns": columns });
            let archived = b.data["archive"].as_array().map_or(0, Vec::len);
            if archived > 0 {
                out["archived"] = json!(archived);
            }
            Ok(out)
        }
        "create_board" => {
            let mut p = find_project(ctx, req_str(a, "project")?)?;
            let name = req_str(a, "name")?.trim();
            let cols = a
                .get("columns")
                .and_then(Value::as_array)
                .map(|c| c.iter().filter_map(Value::as_str).map(String::from).collect());
            let mut board = new_board(name, arg_str(a, "description").unwrap_or(""), cols);
            match arg_str(a, "kind").unwrap_or("kanban") {
                "kanban" => {}
                "notes" => {
                    board["kind"] = json!("notes");
                    board["columns"] = json!([]);
                    board["notes"] = json!([]);
                    board["noteLimit"] = json!(arg_note_limit(a)?.unwrap_or(NOTE_LIMIT_DEFAULT));
                }
                k => {
                    return Err(format!(
                        "Unknown board kind '{k}'. Use \"kanban\" or \"notes\" (plans are made with create_plan)."
                    ))
                }
            }
            let path = boards_dir(&p).join(format!("{}-{}.json", slugify(name), s(&board, "id")));
            ctx.write_json(&path, &board)?;
            if let Some(order) = p.data["boardOrder"].as_array_mut() {
                order.push(board["id"].clone());
            } else {
                p.data["boardOrder"] = json!([board["id"]]);
            }
            save_project(ctx, &mut p)?;
            Ok(json!({ "created": board_summary(&board) }))
        }
        "update_board" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            if let Some(n) = arg_str(a, "name").filter(|n| !n.trim().is_empty()) {
                b.data["name"] = json!(n.trim());
            }
            if let Some(d) = arg_str(a, "description") {
                b.data["description"] = json!(d);
            }
            if let Some(l) = arg_note_limit(a)? {
                if !is_notes(&b.data) {
                    return Err(format!(
                        "'{}' is not a notes board; note_limit only applies to notes boards",
                        s(&b.data, "name")
                    ));
                }
                b.data["noteLimit"] = json!(l);
            }
            save_board(ctx, &mut b)?;
            Ok(json!({ "updated": board_summary(&b.data) }))
        }
        "delete_board" => {
            let mut p = find_project(ctx, req_str(a, "project")?)?;
            let b = find_board(&p, req_str(a, "board")?)?;
            ctx.remove(&b.path)?;
            let id = s(&b.data, "id");
            if let Some(order) = p.data["boardOrder"].as_array_mut() {
                order.retain(|v| v.as_str() != Some(&id));
            }
            save_project(ctx, &mut p)?;
            Ok(json!(format!("Deleted board '{}'", s(&b.data, "name"))))
        }

        "create_column" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            kanban(&b.data)?;
            let tags = a.get("tags").map(clean_tags).unwrap_or_default();
            let mut col = match arg_str(a, "label").map(str::trim).filter(|l| !l.is_empty()) {
                Some(_) if !tags.is_empty() => return Err("Pass either `label` or `tags`, not both".into()),
                Some(label) => label_column(
                    &p,
                    &b.data,
                    label,
                    arg_str(a, "repo"),
                    a.get("show_closed").and_then(Value::as_bool).unwrap_or(false),
                )?,
                None if !tags.is_empty() => {
                    let m = arg_match(a)?.unwrap_or("any");
                    let name = arg_str(a, "name")
                        .map(str::trim)
                        .filter(|n| !n.is_empty())
                        .map(String::from)
                        .unwrap_or_else(|| tag_column_name(&tags, m == "all"));
                    let color = match arg_color(a, "color")? {
                        Some(c) => c,
                        None => p.data["tagColors"][tags[0].to_lowercase()]
                            .as_str()
                            .map(String::from)
                            .unwrap_or_else(|| "slate".into()),
                    };
                    let mut col = new_column(&name, &color);
                    col["source"] = json!({ "kind": "tags", "tags": tags, "match": m });
                    col
                }
                None => new_column(
                    req_str(a, "name")?.trim(),
                    &arg_color(a, "color")?.unwrap_or_else(|| "slate".into()),
                ),
            };
            if let Some(w) = a.get("wip_limit").and_then(Value::as_u64).filter(|w| *w > 0) {
                col["wipLimit"] = json!(w);
            }
            pin_done(&mut b.data);
            insert_at(
                columns_mut(&mut b.data),
                a.get("position").and_then(Value::as_u64),
                col.clone(),
            );
            save_board(ctx, &mut b)?;
            Ok(json!({ "created": col }))
        }
        "update_column" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            let i = find_column(&b.data, req_str(a, "column")?)?;
            let color = arg_color(a, "color")?;
            if live_label(&b.data["columns"][i]).is_some()
                && (color.is_some() || arg_str(a, "name").is_some_and(|n| !n.trim().is_empty()))
            {
                return Err("A label column's name and color follow its GitHub label and can't be changed here".into());
            }
            let tags = a.get("tags").map(clean_tags);
            let m = arg_match(a)?;
            match a.get("done").and_then(Value::as_bool) {
                Some(true) if view_column(&b.data["columns"][i]) => {
                    return Err("A label or tag column can't be the done column: it holds no tasks".into())
                }
                Some(true) => b.data["doneColumn"] = b.data["columns"][i]["id"].clone(),
                Some(false) => return Err("A board always has a done column: mark another column done instead".into()),
                None => {}
            }
            if let Some(on) = a.get("auto_archive").and_then(Value::as_bool) {
                if done_column(&b.data).as_deref() != b.data["columns"][i]["id"].as_str() {
                    return Err("Only the done column can auto-archive".into());
                }
                if on {
                    // Turning it on archives what the column holds already, in its order.
                    let col_id = s(&b.data["columns"][i], "id");
                    for id in str_list(&b.data["columns"][i]["taskIds"]).into_iter().rev() {
                        if let Some(task) = tasks_mut(&mut b.data).remove(&id) {
                            push_archive(&mut b.data, task, &col_id);
                        }
                    }
                    b.data["columns"][i]["taskIds"] = json!([]);
                    b.data["autoArchive"] = json!(true);
                } else if let Some(o) = b.data.as_object_mut() {
                    o.remove("autoArchive");
                }
            }
            let c = &mut columns_mut(&mut b.data)[i];
            if tags.is_some() || m.is_some() {
                let Some(src) = tag_source(c).cloned() else {
                    return Err("`tags` and `match` apply only to tag columns (created with `tags`)".into());
                };
                let tags = match tags {
                    Some(t) if t.is_empty() => return Err("A tag column needs at least one tag".into()),
                    Some(t) => t,
                    None => str_list(&src["tags"]),
                };
                let m = m.unwrap_or(if src["match"] == "all" { "all" } else { "any" });
                // A column still named after its tags follows them.
                if s(c, "name") == tag_column_name(&str_list(&src["tags"]), src["match"] == "all") {
                    c["name"] = json!(tag_column_name(&tags, m == "all"));
                }
                c["source"] = json!({ "kind": "tags", "tags": tags, "match": m });
            }
            if let Some(n) = arg_str(a, "name").filter(|n| !n.trim().is_empty()) {
                c["name"] = json!(n.trim());
            }
            if let Some(col) = color {
                c["color"] = json!(col);
            }
            if let Some(w) = a.get("wip_limit").and_then(Value::as_u64) {
                c["wipLimit"] = if w == 0 { Value::Null } else { json!(w) };
            }
            let out = c.clone();
            save_board(ctx, &mut b)?;
            Ok(json!({ "updated": out }))
        }
        "move_column" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            let i = find_column(&b.data, req_str(a, "column")?)?;
            pin_done(&mut b.data);
            let cols = columns_mut(&mut b.data);
            let c = cols.remove(i);
            insert_at(cols, a.get("position").and_then(Value::as_u64), c);
            let order: Vec<String> = cols.iter().map(|c| s(c, "name")).collect();
            save_board(ctx, &mut b)?;
            Ok(json!({ "columns": order }))
        }
        "delete_column" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            let i = find_column(&b.data, req_str(a, "column")?)?;
            let target = arg_str(a, "move_tasks_to")
                .filter(|t| !t.is_empty())
                .map(|t| task_column(&b.data, Some(t)))
                .transpose()?;
            if target == Some(i) {
                return Err("move_tasks_to must be a different column".into());
            }
            pin_done(&mut b.data);
            let removed = columns_mut(&mut b.data).remove(i);
            let ids: Vec<Value> = removed["taskIds"].as_array().cloned().unwrap_or_default();
            match target {
                Some(t) => {
                    let t = if t > i { t - 1 } else { t };
                    let cols = columns_mut(&mut b.data);
                    if let Some(arr) = cols[t]["taskIds"].as_array_mut() {
                        arr.extend(ids.iter().cloned());
                    }
                }
                None => {
                    let tasks = tasks_mut(&mut b.data);
                    for id in &ids {
                        if let Some(id) = id.as_str() {
                            tasks.remove(id);
                        }
                    }
                }
            }
            // Deleting the done column hands the role to the last column that holds tasks.
            pin_done(&mut b.data);
            save_board(ctx, &mut b)?;
            Ok(json!(format!(
                "Deleted column '{}' ({} task(s) {})",
                s(&removed, "name"),
                ids.len(),
                if target.is_some() { "moved" } else { "deleted" }
            )))
        }

        "create_task" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            let ci = task_column(&b.data, arg_str(a, "column"))?;
            let t = now_iso();
            let checklist: Vec<Value> = a
                .get("checklist")
                .and_then(Value::as_array)
                .map(|c| {
                    c.iter()
                        .filter_map(Value::as_str)
                        .map(|text| json!({ "id": new_id(), "text": text, "done": false }))
                        .collect()
                })
                .unwrap_or_default();
            let task = json!({
                "id": new_id(), "title": req_str(a, "title")?.trim(), "description": arg_str(a, "description").unwrap_or(""),
                "priority": arg_priority(a)?.unwrap_or_else(|| "none".into()), "labels": arg_labels(a).unwrap_or(json!([])),
                "dueDate": arg_due(a)?.unwrap_or(Value::Null), "issue": arg_issue(a)?.unwrap_or(Value::Null),
                "checklist": checklist, "createdAt": t, "updatedAt": t,
            });
            let id = s(&task, "id");
            tasks_mut(&mut b.data).insert(id.clone(), task.clone());
            let col = &mut columns_mut(&mut b.data)[ci];
            let col_name = s(col, "name");
            if !col["taskIds"].is_array() {
                col["taskIds"] = json!([]);
            }
            insert_at(
                col["taskIds"].as_array_mut().unwrap(),
                a.get("position").and_then(Value::as_u64),
                json!(id),
            );
            save_board(ctx, &mut b)?;
            Ok(json!({ "created": task, "column": col_name }))
        }
        "update_task" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            let id = find_task(&b.data, req_str(a, "task")?)?;
            let priority = arg_priority(a)?;
            let due = arg_due(a)?;
            let issue = arg_issue(a)?;
            let t = tasks_mut(&mut b.data).get_mut(&id).unwrap();
            if let Some(v) = arg_str(a, "title").filter(|v| !v.trim().is_empty()) {
                t["title"] = json!(v.trim());
            }
            if let Some(v) = arg_str(a, "description") {
                t["description"] = json!(v);
            }
            if let Some(v) = priority {
                t["priority"] = json!(v);
            }
            if let Some(v) = arg_labels(a) {
                t["labels"] = v;
            }
            if let Some(v) = due {
                t["dueDate"] = v;
            }
            if let Some(v) = issue {
                t["issue"] = v;
            }
            if let Some(cl) = a.get("checklist").and_then(Value::as_array) {
                t["checklist"] = Value::Array(cl.iter().map(|i| json!({ "id": new_id(), "text": s(i, "text"), "done": i["done"].as_bool().unwrap_or(false) })).collect());
            }
            t["updatedAt"] = json!(now_iso());
            let out = t.clone();
            save_board(ctx, &mut b)?;
            Ok(json!({ "updated": out }))
        }
        "link_tasks" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let (mut files, oi) = link_boards(&p, a)?;
            let id = find_task(&files[0].data, req_str(a, "task")?)?;
            let other = find_task(&files[oi].data, req_str(a, "other")?)?;
            if oi == 0 && id == other {
                return Err("A task can't be linked to itself".into());
            }
            let link = req_str(a, "link")?;
            let ((from, from_id), (to, to_id), kind) = match link {
                "blocks" => ((0, &id), (oi, &other), "blocks"),
                "blocked_by" => ((oi, &other), (0, &id), "blocks"),
                "relates" => ((0, &id), (oi, &other), "relates"),
                _ => return Err("link must be blocks, blocked_by or relates".into()),
            };
            let mut datas: Vec<Value> = files.iter().map(|f| f.data.clone()).collect();
            unlink_pair(&mut datas, (0, &id), (oi, &other));
            let to_board = s(&datas[to], "id");
            let t = tasks_mut(&mut datas[from]).get_mut(from_id.as_str()).unwrap();
            let mut links = links_of(t);
            links.push(json!({ "type": kind, "board": to_board, "task": to_id }));
            put_links(t, links);
            t["updatedAt"] = json!(now_iso());
            let title = |i: usize, x: &str| s(&datas[i]["tasks"][x], "title");
            let msg = format!("“{}” {} “{}”", title(0, &id), link.replace('_', " "), title(oi, &other));
            for (f, d) in files.iter_mut().zip(datas) {
                if f.data != d {
                    f.data = d;
                    save_board(ctx, f)?;
                }
            }
            Ok(json!(msg))
        }
        "unlink_tasks" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let (mut files, oi) = link_boards(&p, a)?;
            let id = find_task(&files[0].data, req_str(a, "task")?)?;
            let other = find_task(&files[oi].data, req_str(a, "other")?)?;
            let mut datas: Vec<Value> = files.iter().map(|f| f.data.clone()).collect();
            let changed = unlink_pair(&mut datas, (0, &id), (oi, &other));
            if changed.is_empty() {
                return Err("Those tasks aren't linked".into());
            }
            for (f, d) in files.iter_mut().zip(datas) {
                if f.data != d {
                    f.data = d;
                    save_board(ctx, f)?;
                }
            }
            Ok(json!("Unlinked"))
        }
        "move_task" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            let id = find_task(&b.data, req_str(a, "task")?)?;
            if let Some(q) = arg_str(a, "to_board").filter(|q| !q.trim().is_empty()) {
                let to = find_board(&p, q)?;
                if to.data["id"] != b.data["id"] {
                    return move_task_to_board(ctx, &p, b, to, &id, a);
                }
            }
            let ci = task_column(&b.data, Some(req_str(a, "column")?))?;
            let col_id = s(&b.data["columns"][ci], "id");
            let held = b.data["columns"][ci]["taskIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|t| t == id.as_str()));
            // Moved into an auto-archiving done column (not just reordered there), it goes to the archive.
            if !held && auto_archives(&b.data, &col_id) {
                let mut task = tasks_mut(&mut b.data).remove(&id).ok_or("Task not found")?;
                task["updatedAt"] = json!(now_iso());
                remove_task_from_columns(&mut b.data, &id);
                push_archive(&mut b.data, task, &col_id);
                save_board(ctx, &mut b)?;
                return Ok(json!(format!(
                    "Moved task {id} to '{}', which auto-archives: it is now in the board's archive",
                    s(&b.data["columns"][ci], "name")
                )));
            }
            remove_task_from_columns(&mut b.data, &id);
            let col = &mut columns_mut(&mut b.data)[ci];
            let col_name = s(col, "name");
            if !col["taskIds"].is_array() {
                col["taskIds"] = json!([]);
            }
            insert_at(
                col["taskIds"].as_array_mut().unwrap(),
                a.get("position").and_then(Value::as_u64),
                json!(id),
            );
            if let Some(t) = tasks_mut(&mut b.data).get_mut(&id) {
                t["updatedAt"] = json!(now_iso());
            }
            save_board(ctx, &mut b)?;
            Ok(json!(format!("Moved task {id} to '{col_name}'")))
        }
        "delete_task" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            let id = find_task(&b.data, req_str(a, "task")?)?;
            let title = s(&b.data["tasks"][&id], "title");
            tasks_mut(&mut b.data).remove(&id);
            remove_task_from_columns(&mut b.data, &id);
            save_board(ctx, &mut b)?;
            Ok(json!(format!("Deleted task '{title}'")))
        }
        "archive_tasks" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            kanban(&b.data)?;
            let mut ids: Vec<String> = match a.get("tasks").and_then(Value::as_array) {
                Some(qs) => qs
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|q| find_task(&b.data, q))
                    .collect::<R<_>>()?,
                None => vec![],
            };
            if let Some(c) = arg_str(a, "column").filter(|c| !c.is_empty()) {
                let i = find_column(&b.data, c)?;
                ids.extend(str_list(&b.data["columns"][i]["taskIds"]));
            }
            if ids.is_empty() {
                return Err("Nothing to archive: pass `tasks`, or a `column` that holds tasks".into());
            }
            let at = now_iso();
            let mut put = vec![];
            for c in b.data["columns"].as_array().cloned().unwrap_or_default() {
                for id in str_list(&c["taskIds"]).into_iter().filter(|id| ids.contains(id)) {
                    if put.iter().any(|e: &Value| e["task"]["id"] == id.as_str()) {
                        continue;
                    }
                    put.push(json!({ "task": b.data["tasks"][&id].clone(), "from": c["id"], "at": at }));
                }
            }
            for e in &put {
                let id = s(&e["task"], "id");
                tasks_mut(&mut b.data).remove(&id);
                remove_task_from_columns(&mut b.data, &id);
            }
            let rest = b.data["archive"].as_array().cloned().unwrap_or_default();
            b.data["archive"] = Value::Array(put.iter().cloned().chain(rest).collect());
            save_board(ctx, &mut b)?;
            let titles: Vec<String> = put.iter().map(|e| s(&e["task"], "title")).collect();
            Ok(json!({ "archived": titles }))
        }
        "restore_task" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            kanban(&b.data)?;
            let q = req_str(a, "task")?;
            let list = b.data["archive"].as_array().cloned().unwrap_or_default();
            let hits: Vec<usize> = (0..list.len()).filter(|&i| s(&list[i]["task"], "id") == q).collect();
            let hits = if hits.is_empty() {
                (0..list.len())
                    .filter(|&i| eq_ci(&s(&list[i]["task"], "title"), q))
                    .collect()
            } else {
                hits
            };
            let i = match hits.as_slice() {
                [i] => *i,
                [] => return Err(format!("No archived task '{q}' on board '{}'", s(&b.data, "name"))),
                _ => {
                    return Err(format!(
                        "Several archived tasks are titled '{q}'; pass the id (search_tasks lists them)"
                    ))
                }
            };
            let entry = list[i].clone();
            let cols = b.data["columns"].as_array().cloned().unwrap_or_default();
            let to = cols
                .iter()
                .position(|c| c["id"] == entry["from"] && !view_column(c))
                .or_else(|| cols.iter().position(|c| !view_column(c)))
                .ok_or("The board has no column to restore the task to")?;
            if auto_archives(&b.data, &s(&cols[to], "id")) {
                return Err(format!("'{}' would go back to '{}', which auto-archives: turn that off first (update_column auto_archive false)",
                                   s(&entry["task"], "title"), s(&cols[to], "name")));
            }
            let id = s(&entry["task"], "id");
            tasks_mut(&mut b.data).insert(id.clone(), entry["task"].clone());
            if let Some(ids) = columns_mut(&mut b.data)[to]["taskIds"].as_array_mut() {
                ids.insert(0, json!(id));
            }
            let rest: Vec<Value> = list
                .into_iter()
                .enumerate()
                .filter(|(j, _)| *j != i)
                .map(|(_, e)| e)
                .collect();
            if rest.is_empty() {
                b.data.as_object_mut().map(|o| o.remove("archive"));
            } else {
                b.data["archive"] = Value::Array(rest);
            }
            save_board(ctx, &mut b)?;
            Ok(json!(format!(
                "Restored '{}' to '{}'",
                s(&entry["task"], "title"),
                s(&cols[to], "name")
            )))
        }
        "create_note" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            notes_board(&b.data)?;
            let t = now_iso();
            let notes = notes_mut(&mut b.data);
            // Without a position, below the lowest note so it doesn't cover another.
            let below = notes
                .iter()
                .map(|n| n["y"].as_i64().unwrap_or(0) + 200)
                .max()
                .map_or(40, |y| y + 24);
            let mut note = json!({ "id": new_id(), "title": arg_str(a, "title").unwrap_or("").trim(), "description": arg_str(a, "description").unwrap_or(""),
                                   "tags": arg_strings(a, "tags").unwrap_or(json!([])), "issues": arg_issues(a)?.unwrap_or(json!([])),
                                   "color": arg_note_color(a)?.unwrap_or(Value::Null),
                                   "x": a.get("x").and_then(Value::as_i64).unwrap_or(40), "y": a.get("y").and_then(Value::as_i64).unwrap_or(below),
                                   "createdAt": t, "updatedAt": t });
            if s(&note, "title").is_empty() && s(&note, "description").trim().is_empty() {
                return Err("A note needs a title or a description".into());
            }
            note_fits(&b.data, &note, None)?;
            notes_mut(&mut b.data).push(note.clone());
            note["length"] = json!(note_length(&note));
            save_board(ctx, &mut b)?;
            Ok(json!({ "created": note }))
        }
        "update_note" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            notes_board(&b.data)?;
            let i = find_note(&b.data, req_str(a, "note")?)?;
            let issues = arg_issues(a)?;
            let color = arg_note_color(a)?;
            let old = b.data["notes"][i].clone();
            let mut n = old.clone();
            if let Some(v) = arg_str(a, "title") {
                n["title"] = json!(v.trim());
            }
            if let Some(v) = arg_str(a, "description") {
                n["description"] = json!(v);
            }
            if let Some(v) = arg_strings(a, "tags") {
                n["tags"] = v;
            }
            if let Some(v) = issues {
                n["issues"] = v;
            }
            if let Some(v) = color {
                n["color"] = v;
            }
            if let Some(v) = a.get("x").and_then(Value::as_i64) {
                n["x"] = json!(v);
            }
            if let Some(v) = a.get("y").and_then(Value::as_i64) {
                n["y"] = json!(v);
            }
            note_fits(&b.data, &n, Some(&old))?;
            n["updatedAt"] = json!(now_iso());
            notes_mut(&mut b.data)[i] = n.clone();
            save_board(ctx, &mut b)?;
            Ok(json!({ "updated": n }))
        }
        "delete_note" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            notes_board(&b.data)?;
            let i = find_note(&b.data, req_str(a, "note")?)?;
            let n = notes_mut(&mut b.data).remove(i);
            save_board(ctx, &mut b)?;
            Ok(json!(format!("Deleted {}", crate::notes::note_name(&n))))
        }
        "search_tasks" => {
            let projects = match arg_str(a, "project").filter(|p| !p.is_empty()) {
                Some(q) => vec![find_project(ctx, q)?],
                None => load_projects(ctx)?,
            };
            let query = arg_str(a, "query").unwrap_or("").to_lowercase();
            let label = arg_str(a, "label").map(str::to_lowercase);
            let priority = arg_str(a, "priority");
            let column = arg_str(a, "column");
            let board = arg_str(a, "board").filter(|b| !b.is_empty());
            let limit = a
                .get("limit")
                .and_then(Value::as_u64)
                .filter(|l| *l > 0)
                .unwrap_or(SEARCH_LIMIT) as usize;
            let mut out = vec![];
            let mut count = 0;
            for p in &projects {
                let boards = load_boards(p)?;
                let only = board.map(|q| find_board(p, q)).transpose()?.map(|b| s(&b.data, "id"));
                let all: Vec<Value> = boards.iter().map(|x| x.data.clone()).collect();
                let targets = link_targets(&all);
                for b in boards {
                    if only.as_ref().is_some_and(|id| *id != s(&b.data, "id")) {
                        continue;
                    }
                    let tasks = b.data["tasks"].as_object().cloned().unwrap_or_default();
                    let cols = b.data["columns"].as_array().cloned().unwrap_or_default();
                    let col_name = |id: &Value| {
                        cols.iter()
                            .find(|c| c["id"] == *id)
                            .map(|c| c["name"].clone())
                            .unwrap_or(Value::Null)
                    };
                    // (task, column name, archived from) in board order, then the archive, which search still covers.
                    let mut found: Vec<(Value, Value, Option<Value>)> = vec![];
                    for c in &cols {
                        if column.is_some_and(|q| !eq_ci(&s(c, "name"), q)) {
                            continue;
                        }
                        for id in str_list(&c["taskIds"]) {
                            if let Some(t) = tasks.get(&id) {
                                found.push((t.clone(), c["name"].clone(), None));
                            }
                        }
                    }
                    if column.is_none_or(|q| eq_ci(q, "archived")) {
                        for e in b.data["archive"].as_array().into_iter().flatten() {
                            found.push((e["task"].clone(), json!("Archived"), Some(col_name(&e["from"]))));
                        }
                    }
                    for (t, col, from) in found {
                        let text = format!("{} {}", s(&t, "title"), s(&t, "description")).to_lowercase();
                        if !query.is_empty() && !text.contains(&query) {
                            continue;
                        }
                        if priority.is_some_and(|q| s(&t, "priority") != q) {
                            continue;
                        }
                        if let Some(l) = &label {
                            let has = t["labels"]
                                .as_array()
                                .map(|ls| {
                                    ls.iter()
                                        .any(|x| x.as_str().map(str::to_lowercase).as_deref() == Some(l.as_str()))
                                })
                                .unwrap_or(false);
                            if !has {
                                continue;
                            }
                        }
                        count += 1;
                        if out.len() >= limit {
                            continue;
                        }
                        let mut v = task_view(&all, &targets, &b.data, &t, false);
                        v["project"] = p.data["name"].clone();
                        v["board"] = b.data["name"].clone();
                        v["column"] = col;
                        if let Some(from) = from {
                            v["archived"] = json!(true);
                            v["archivedFrom"] = from;
                        }
                        out.push(v);
                    }
                }
            }
            Ok(json!({ "count": count, "shown": out.len(), "tasks": out }))
        }

        "search_decisions" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let all = load_decisions(&p)?;
            let tokens: Vec<String> = arg_str(a, "query")
                .unwrap_or("")
                .split_whitespace()
                .map(str::to_lowercase)
                .collect();
            let tag = arg_str(a, "tag").map(str::trim).filter(|t| !t.is_empty());
            let with_replaced = a.get("include_replaced").and_then(Value::as_bool).unwrap_or(true);
            let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(20) as usize;
            let mut hits: Vec<(u32, &DecisionFile)> = all
                .iter()
                .filter(|d| with_replaced || d.data["replacedBy"].is_null())
                .filter(|d| tag.is_none_or(|t| str_list(&d.data["tags"]).iter().any(|x| eq_ci(x, t))))
                .map(|d| {
                    (
                        if tokens.is_empty() {
                            1
                        } else {
                            decision_score(&d.data, &tokens)
                        },
                        d,
                    )
                })
                .filter(|(score, _)| *score > 0)
                .collect();
            // Best match first; among equals, current decisions before replaced ones, then newest first.
            hits.sort_by(|(sa, a), (sb, b)| {
                sb.cmp(sa)
                    .then_with(|| b.data["replacedBy"].is_null().cmp(&a.data["replacedBy"].is_null()))
                    .then_with(|| b.data["number"].as_u64().cmp(&a.data["number"].as_u64()))
            });
            let total = hits.len();
            let out: Vec<Value> = hits
                .into_iter()
                .take(limit)
                .map(|(_, d)| decision_view(&d.data, &all))
                .collect();
            Ok(json!({ "total": total, "shown": out.len(), "decisions": out }))
        }
        "add_decision" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let all = load_decisions(&p)?;
            let number = all.iter().filter_map(|d| d.data["number"].as_u64()).max().unwrap_or(0) + 1;
            let t = now_iso();
            let d = json!({
                "schemaVersion": 1, "id": new_id(), "number": number, "title": req_str(a, "title")?.trim().replace('\n', " "),
                "why": req_str(a, "why")?.trim(), "rejected": arg_str(a, "rejected").unwrap_or("").trim(),
                "about": a.get("about").map(clean_list).unwrap_or_default(), "tags": a.get("tags").map(clean_tags).unwrap_or_default(),
                "issues": arg_issues(a)?.unwrap_or(json!([])), "replacedBy": null, "createdAt": t, "updatedAt": t,
            });
            let (len, limit) = (decision_len(&d), decision_limit(&p));
            if len > limit {
                return Err(too_long(len, limit));
            }
            ctx.write_json(&decisions_dir(&p).join(format!("d{number}-{}.json", s(&d, "id"))), &d)?;
            Ok(json!({ "created": decision_view(&d, &all), "chars": len, "limit": limit }))
        }
        "update_decision" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut f = find_decision(&p, req_str(a, "decision")?)?;
            let issues = arg_issues(a)?;
            let replaced_by = match arg_str(a, "replaced_by").map(str::trim) {
                None => None,
                Some("") => Some(Value::Null),
                Some(q) => {
                    let other = find_decision(&p, q)?;
                    if s(&other.data, "id") == s(&f.data, "id") {
                        return Err("A decision can't replace itself".into());
                    }
                    Some(other.data["number"].clone())
                }
            };
            let before = decision_len(&f.data);
            let d = &mut f.data;
            if let Some(v) = arg_str(a, "title").filter(|v| !v.trim().is_empty()) {
                d["title"] = json!(v.trim().replace('\n', " "));
            }
            if let Some(v) = arg_str(a, "why") {
                if v.trim().is_empty() {
                    return Err("`why` can't be empty: it is the point of a decision".into());
                }
                d["why"] = json!(v.trim());
            }
            if let Some(v) = arg_str(a, "rejected") {
                d["rejected"] = json!(v.trim());
            }
            if let Some(v) = a.get("about") {
                d["about"] = json!(clean_list(v));
            }
            if let Some(v) = a.get("tags") {
                d["tags"] = json!(clean_tags(v));
            }
            if let Some(v) = issues {
                d["issues"] = v;
            }
            if let Some(v) = replaced_by {
                d["replacedBy"] = v;
            }
            // Text written under a higher limit is kept, but can't grow while it is over the current one.
            let (len, limit) = (decision_len(d), decision_limit(&p));
            if len > limit && len > before {
                return Err(too_long(len, limit));
            }
            d["updatedAt"] = json!(now_iso());
            ctx.write_json(&f.path, &f.data)?;
            Ok(json!({ "updated": decision_view(&f.data, &load_decisions(&p)?), "chars": len, "limit": limit }))
        }
        "delete_decision" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let f = find_decision(&p, req_str(a, "decision")?)?;
            ctx.remove(&f.path)?;
            Ok(json!(format!(
                "Deleted decision {} '{}'",
                decision_ref(&f.data),
                s(&f.data, "title")
            )))
        }

        "create_plan" => {
            let mut p = find_project(ctx, req_str(a, "project")?)?;
            let (title, mut plan) = match arg_str(a, "markdown").filter(|m| !m.trim().is_empty()) {
                Some(md) => plan::from_markdown(md),
                None => (None, plan::empty_plan()),
            };
            let name = arg_str(a, "name")
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(String::from)
                .or(title)
                .ok_or("Pass a `name`, or Markdown starting with a `# ` title")?;
            if let Some(g) = arg_str(a, "goal") {
                plan["goal"] = json!(g);
            }
            if let Some(i) = arg_issues(a)? {
                plan["issues"] = i;
            }
            let mut board = new_board(&name, "", Some(vec![]));
            board["columns"] = json!([]);
            board["kind"] = json!("plan");
            board["plan"] = plan;
            let path = boards_dir(&p).join(format!("{}-{}.json", slugify(&name), s(&board, "id")));
            ctx.write_json(&path, &board)?;
            if let Some(order) = p.data["boardOrder"].as_array_mut() {
                order.push(board["id"].clone());
            } else {
                p.data["boardOrder"] = json!([board["id"]]);
            }
            save_project(ctx, &mut p)?;
            Ok(json!({ "created": board_summary(&board) }))
        }
        "get_plan" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let b = plan_board(&p, req_str(a, "board")?)?;
            if arg_str(a, "format") == Some("markdown") {
                return Ok(json!(plan::to_markdown(&s(&b.data, "name"), &b.data["plan"])));
            }
            Ok(plan_view(&b.data))
        }
        "update_plan" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = plan_board(&p, req_str(a, "board")?)?;
            let issues = arg_issues(a)?;
            let plan = plan_mut(&mut b);
            if let Some(g) = arg_str(a, "goal") {
                plan["goal"] = json!(g);
            }
            if let Some(n) = arg_str(a, "notes") {
                plan["notes"] = json!(n);
            }
            if let Some(i) = issues {
                plan["issues"] = i;
            }
            save_board(ctx, &mut b)?;
            Ok(json!({ "updated": board_summary(&b.data) }))
        }
        "add_plan_step" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = plan_board(&p, req_str(a, "board")?)?;
            let items = a.get("items").map(clean_list).unwrap_or_default();
            let step = plan::new_step(req_str(a, "title")?, arg_str(a, "notes").unwrap_or(""), &items);
            insert_at(
                steps_mut(&mut b),
                a.get("position").and_then(Value::as_u64),
                step.clone(),
            );
            save_board(ctx, &mut b)?;
            Ok(json!({ "created": step }))
        }
        "update_plan_step" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = plan_board(&p, req_str(a, "board")?)?;
            let i = find_step(&b.data, req_str(a, "step")?)?;
            let steps = steps_mut(&mut b);
            if a.get("delete").and_then(Value::as_bool) == Some(true) {
                let gone = steps.remove(i);
                save_board(ctx, &mut b)?;
                return Ok(json!(format!("Deleted step '{}'", s(&gone, "title"))));
            }
            let mut st = steps.remove(i);
            if let Some(t) = arg_str(a, "title").filter(|t| !t.trim().is_empty()) {
                st["title"] = json!(t.trim());
            }
            if let Some(n) = arg_str(a, "notes") {
                st["notes"] = json!(n);
            }
            let pos = a.get("position").and_then(Value::as_u64).or(Some(i as u64));
            insert_at(steps, pos, st.clone());
            save_board(ctx, &mut b)?;
            Ok(json!({ "updated": { "id": st["id"], "title": st["title"], "notes": st["notes"] } }))
        }
        "add_plan_items" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = plan_board(&p, req_str(a, "board")?)?;
            let i = find_step(&b.data, req_str(a, "step")?)?;
            let texts = a.get("items").map(clean_list).unwrap_or_default();
            if texts.is_empty() {
                return Err("Pass at least one item text".into());
            }
            let new: Vec<Value> = texts.iter().map(|t| plan::new_item(t)).collect();
            let parent = arg_str(a, "parent").filter(|x| !x.is_empty()).map(String::from);
            let after = arg_str(a, "after").filter(|x| !x.is_empty()).map(String::from);
            let items = step_items_mut(&mut b, i);
            match (parent, after) {
                (Some(pid), _) => {
                    let parent =
                        plan::find_item_mut(items, &pid).ok_or_else(|| format!("Item '{pid}' is not in this step"))?;
                    if !parent["children"].is_array() {
                        parent["children"] = json!([]);
                    }
                    parent["children"].as_array_mut().unwrap().extend(new.iter().cloned());
                }
                (None, Some(aid)) => {
                    // Insert next to `aid`, at its own level.
                    fn insert_after(list: &mut Vec<Value>, id: &str, new: &[Value]) -> bool {
                        if let Some(i) = list.iter().position(|it| it["id"].as_str() == Some(id)) {
                            for (k, n) in new.iter().enumerate() {
                                list.insert(i + 1 + k, n.clone());
                            }
                            return true;
                        }
                        list.iter_mut().any(|it| {
                            it["children"]
                                .as_array_mut()
                                .is_some_and(|ch| insert_after(ch, id, new))
                        })
                    }
                    if !insert_after(items, &aid, &new) {
                        return Err(format!("Item '{aid}' is not in this step"));
                    }
                }
                (None, None) => items.extend(new.iter().cloned()),
            }
            save_board(ctx, &mut b)?;
            Ok(json!({ "added": new }))
        }
        "update_plan_item" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = plan_board(&p, req_str(a, "board")?)?;
            let (i, id) = find_plan_item(&b.data, req_str(a, "item")?)?;
            let state = match arg_str(a, "state") {
                None => None,
                Some(st) if plan::STATES.contains(&st) => Some(st),
                Some(st) => return Err(format!("Unknown state '{st}'. Use one of: {}", plan::STATES.join(", "))),
            };
            let decision = arg_decision_ref(a)?;
            let items = step_items_mut(&mut b, i);
            if a.get("delete").and_then(Value::as_bool) == Some(true) {
                let gone = plan::remove_item(items, &id).unwrap();
                save_board(ctx, &mut b)?;
                return Ok(json!(format!("Deleted '{}'", s(&gone, "text"))));
            }
            let it = plan::find_item_mut(items, &id).unwrap();
            if let Some(st) = state {
                it["state"] = json!(st);
                if st != "skipped" {
                    it["reason"] = json!("");
                }
            }
            if let Some(r) = arg_str(a, "reason") {
                it["reason"] = json!(r.trim());
            }
            if let Some(t) = arg_str(a, "text").filter(|t| !t.trim().is_empty()) {
                it["text"] = json!(t.trim());
            }
            if let Some(d) = decision {
                it["decision"] = d;
            }
            let out = item_view(it);
            save_board(ctx, &mut b)?;
            Ok(json!({ "updated": out }))
        }
        "add_plan_question" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = plan_board(&p, req_str(a, "board")?)?;
            let qn = json!({ "id": new_id(), "text": req_str(a, "text")?.trim(), "answer": "", "resolved": false, "decision": null });
            let plan = plan_mut(&mut b);
            if !plan["questions"].is_array() {
                plan["questions"] = json!([]);
            }
            plan["questions"].as_array_mut().unwrap().push(qn.clone());
            save_board(ctx, &mut b)?;
            Ok(json!({ "created": qn }))
        }
        "answer_plan_question" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = plan_board(&p, req_str(a, "board")?)?;
            let q = req_str(a, "question")?;
            let decision = arg_decision_ref(a)?;
            let plan = plan_mut(&mut b);
            let qs = plan["questions"].as_array_mut().ok_or("This plan has no questions")?;
            let qn = qs
                .iter_mut()
                .find(|x| s(x, "id") == q || eq_ci(&s(x, "text"), q))
                .ok_or_else(|| format!("Question '{q}' not found"))?;
            if let Some(ans) = arg_str(a, "answer") {
                qn["answer"] = json!(ans.trim());
            }
            qn["resolved"] = json!(a.get("resolved").and_then(Value::as_bool).unwrap_or(true));
            if let Some(d) = decision {
                qn["decision"] = d;
            }
            let out = qn.clone();
            save_board(ctx, &mut b)?;
            Ok(json!({ "updated": out }))
        }

        "sync_issues" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let token = vaultfs::github_token_from_config();
            let mut repos = Map::new();
            let mut report = vec![];
            for r in p.data["repos"].as_array().cloned().unwrap_or_default() {
                let key = format!("{}/{}", s(&r, "owner"), s(&r, "repo"));
                let (owner, name) = (s(&r, "owner"), s(&r, "repo"));
                let fetched = crate::gh::fetch_issues(&owner, &name, token.as_deref())
                    .and_then(|issues| Ok((issues, crate::gh::fetch_labels(&owner, &name, token.as_deref())?)));
                match fetched {
                    Ok((issues, labels)) => {
                        report.push(format!("{key}: {} issues, {} labels", issues.len(), labels.len()));
                        repos.insert(
                            key,
                            json!({ "fetchedAt": now_iso(), "issues": issues, "labels": labels }),
                        );
                    }
                    Err(e) => {
                        report.push(format!("{key}: ERROR {e}"));
                        repos.insert(key, json!({ "fetchedAt": now_iso(), "issues": [], "error": e }));
                    }
                }
            }
            if repos.is_empty() {
                return Err("Project has no GitHub repos. Add some with update_project.".into());
            }
            vaultfs::write_json(&issue_cache_path(&p), &json!({ "repos": repos }))?;
            Ok(json!({ "synced": report }))
        }
        "list_issues" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let cache = vaultfs::read_json(&issue_cache_path(&p)).unwrap_or(json!({ "repos": {} }));
            let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            let links = issue_links(&p)?;
            let mut out = vec![];
            let mut total = 0;
            for (key, i) in filter_issues(&cache, a) {
                total += 1;
                if out.len() >= limit {
                    continue;
                }
                let k = format!("{key}#{}", i["number"]);
                out.push(json!({
                    "ref": k, "title": i["title"], "state": i["state"], "labels": i["labels"].as_array().map(|ls| ls.iter().map(|l| l["name"].clone()).collect::<Vec<_>>()),
                    "author": i["author"], "url": i["url"], "updatedAt": i["updatedAt"], "linkedOn": links.get(&k),
                }));
            }
            let fetched: Vec<Value> = cache["repos"]
                .as_object()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| json!({ "repo": k, "fetchedAt": v["fetchedAt"], "error": v.get("error") }))
                        .collect()
                })
                .unwrap_or_default();
            Ok(json!({ "cache": fetched, "total": total, "shown": out.len(), "issues": out }))
        }
        "add_issue_as_task" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let iref = parse_issue(req_str(a, "issue")?)?;
            let cache = vaultfs::read_json(&issue_cache_path(&p)).unwrap_or(json!({ "repos": {} }));
            let repo = s(&iref, "repo");
            let issue = cache["repos"]
                .as_object()
                .and_then(|m| m.iter().find(|(k, _)| eq_ci(k, &repo)))
                .and_then(|(_, rc)| {
                    rc["issues"]
                        .as_array()
                        .and_then(|is| is.iter().find(|i| i["number"] == iref["number"]).cloned())
                })
                .ok_or_else(|| {
                    format!(
                        "Issue {repo}#{} is not in the cache. Run sync_issues first.",
                        iref["number"]
                    )
                })?;
            let args = json!({
                "project": req_str(a, "project")?, "board": req_str(a, "board")?, "column": arg_str(a, "column").unwrap_or(""),
                "title": issue["title"], "issue": format!("{}#{}", issue["repo"].as_str().unwrap_or(&repo), iref["number"]),
            });
            call_tool(ctx, "create_task", &args)
        }
        "add_issues_as_tasks" => {
            let p = find_project(ctx, req_str(a, "project")?)?;
            let mut b = find_board(&p, req_str(a, "board")?)?;
            let ci = task_column(&b.data, arg_str(a, "column"))?;
            let cache = vaultfs::read_json(&issue_cache_path(&p)).unwrap_or(json!({ "repos": {} }));

            // (canonical "owner/repo#n", title) of every requested issue that is in the cache.
            let mut picked: Vec<(String, Value)> = vec![];
            let mut not_cached = vec![];
            if let Some(refs) = a.get("issues").and_then(Value::as_array) {
                for r in refs {
                    let iref = parse_issue(r.as_str().ok_or("`issues` must be an array of strings")?)?;
                    let repo = s(&iref, "repo");
                    let found = cache["repos"]
                        .as_object()
                        .and_then(|m| m.iter().find(|(k, _)| eq_ci(k, &repo)))
                        .and_then(|(k, rc)| {
                            rc["issues"]
                                .as_array()
                                .and_then(|is| is.iter().find(|i| i["number"] == iref["number"]))
                                .map(|i| (format!("{k}#{}", i["number"]), i["title"].clone()))
                        });
                    match found {
                        Some(f) => picked.push(f),
                        None => not_cached.push(format!("{repo}#{}", iref["number"])),
                    }
                }
            } else if a.get("all_matching").and_then(Value::as_bool) == Some(true) {
                picked = filter_issues(&cache, a)
                    .into_iter()
                    .map(|(k, i)| (format!("{k}#{}", i["number"]), i["title"].clone()))
                    .collect();
            } else {
                return Err(
                    "Pass `issues` (a list of refs) or `all_matching: true` with list_issues-style filters.".into(),
                );
            }

            let mut linked: HashSet<String> = issue_links(&p)?.into_keys().collect();
            let t = now_iso();
            let mut ids = vec![];
            let mut skipped = 0;
            for (key, title) in picked {
                if !linked.insert(key.clone()) {
                    skipped += 1;
                    continue;
                }
                let (repo, num) = key.rsplit_once('#').unwrap();
                let task = json!({
                    "id": new_id(), "title": title.as_str().unwrap_or("").trim(), "description": "", "priority": "none",
                    "labels": [], "dueDate": null, "issue": { "repo": repo, "number": num.parse::<u64>().unwrap_or(0) },
                    "checklist": [], "createdAt": t, "updatedAt": t,
                });
                ids.push(json!(s(&task, "id")));
                tasks_mut(&mut b.data).insert(s(&task, "id"), task);
            }
            let col = &mut columns_mut(&mut b.data)[ci];
            let col_name = s(col, "name");
            if !ids.is_empty() {
                if !col["taskIds"].is_array() {
                    col["taskIds"] = json!([]);
                }
                col["taskIds"].as_array_mut().unwrap().extend(ids.iter().cloned());
                save_board(ctx, &mut b)?;
            }
            Ok(
                json!({ "added": ids.len(), "skippedAlreadyLinked": skipped, "notInCache": not_cached,
                       "board": b.data["name"], "column": col_name }),
            )
        }

        "list_history" => {
            let project = match arg_str(a, "project").filter(|p| !p.is_empty()) {
                Some(q) => Some(find_project(ctx, q)?),
                None => None,
            };
            let board = match (arg_str(a, "board").filter(|b| !b.is_empty()), &project) {
                (Some(q), Some(p)) => Some(s(&find_board(p, q)?.data, "id")),
                (Some(_), None) => return Err("Pass `project` together with `board`".into()),
                _ => None,
            };
            let project_id = project.as_ref().map(|p| s(&p.data, "id"));
            let filter = history::Filter {
                project: project_id.as_deref(),
                board: board.as_deref(),
                by: arg_str(a, "by"),
                limit: a.get("limit").and_then(Value::as_u64).unwrap_or(20) as usize,
            };
            let entries: Vec<Value> = history::list(&ctx.vault()?, &filter)
                .into_iter()
                .map(|mut e| {
                    if let Some(o) = e.as_object_mut() {
                        o.remove("t");
                        o.remove("ops");
                        o.remove("tasks");
                        if o.get("details").and_then(Value::as_array).is_some_and(|d| d.len() <= 1) {
                            o.remove("details");
                        }
                    }
                    e
                })
                .collect();
            Ok(json!({ "entries": entries }))
        }
        "undo" => {
            let id = req_str(a, "id")?;
            let skip = a.get("skip_conflicts").and_then(Value::as_bool).unwrap_or(false);
            let r = history::undo(&ctx.vault()?, id, skip, &ctx.actor())?;
            let conflicts: Vec<&str> = r["conflicts"]
                .as_array()
                .map(|c| c.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            if r["done"] == true {
                Ok(json!({ "undone": id, "leftAsIs": conflicts }))
            } else {
                Err(format!("Nothing was changed: some of it was modified again since.\n- {}\nPass skip_conflicts: true to undo the rest.", conflicts.join("\n- ")))
            }
        }
        _ => Err(format!("Unknown tool '{name}'")),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        call_tool, decision_score, done_column, parse_color, prune_links, task_links, unlink_pair, Ctx, Source,
    };
    use serde_json::json;
    use std::cell::RefCell;

    #[test]
    fn decision_search_needs_every_word_and_ranks_code_references_first() {
        let d = json!({ "number": 12, "title": "Keyboard state is a sparse map", "why": "Only keys with input are stored.",
                        "rejected": "", "about": ["keyboard_state", "src/tca-engine/input/"], "tags": ["input"], "issues": [] });
        let q = |s: &str| s.split_whitespace().map(str::to_lowercase).collect::<Vec<_>>();
        assert_eq!(decision_score(&d, &q("keyboard_state")), 3);
        assert_eq!(decision_score(&d, &q("sparse")), 2);
        assert_eq!(decision_score(&d, &q("stored")), 1);
        assert_eq!(decision_score(&d, &q("D-12")), 1);
        assert_eq!(decision_score(&d, &q("sparse vector")), 0);
    }

    #[test]
    fn links_read_from_both_sides_across_boards() {
        let mut one = json!({ "id": "one", "name": "One", "tasks": {
            "a": { "id": "a", "title": "A", "links": [{ "type": "blocks", "board": "two", "task": "b" },
                                                     { "type": "relates", "board": "one", "task": "gone" },
                                                     { "type": "relates", "board": "two", "task": "gone" }] },
        } });
        let two = json!({ "id": "two", "name": "Two", "tasks": {
            "b": { "id": "b", "title": "B", "links": [{ "type": "relates", "board": "two", "task": "c" }] },
            "c": { "id": "c", "title": "C" },
        } });
        let ids = |l: Vec<serde_json::Value>| {
            l.iter()
                .map(|t| t["id"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };
        let all = [one.clone(), two.clone()];
        let (blocks, blocked_by, relates) = task_links(&all, "two", "b");
        assert_eq!(
            (ids(blocks), ids(blocked_by), ids(relates)),
            (vec![], vec!["a".to_string()], vec!["c".to_string()])
        );
        assert_eq!(task_links(&all, "two", "b").1[0]["board"], "One");
        assert_eq!(ids(task_links(&all, "one", "a").0), vec!["b"]);
        // Only a link to a missing task of the same board is dropped.
        prune_links(&mut one);
        assert_eq!(one["tasks"]["a"]["links"].as_array().unwrap().len(), 2);
        let mut all = [one, two];
        assert_eq!(unlink_pair(&mut all, (1, "b"), (0, "a")), vec![0]);
        assert_eq!(
            all[0]["tasks"]["a"]["links"],
            json!([{ "type": "relates", "board": "two", "task": "gone" }])
        );
        assert!(unlink_pair(&mut all, (0, "a"), (1, "c")).is_empty());
    }

    #[test]
    fn a_task_moved_to_another_board_keeps_its_id_and_links() {
        let vault = std::env::temp_dir().join(format!("astali-move-test-{}", super::new_id()));
        let boards = vault.join("p").join("boards");
        std::fs::create_dir_all(&boards).unwrap();
        let write = |path: std::path::PathBuf, v: serde_json::Value| std::fs::write(path, v.to_string()).unwrap();
        write(
            vault.join("p").join("project.json"),
            json!({ "id": "p", "name": "P", "boardOrder": ["one", "two"] }),
        );
        write(
            boards.join("one.json"),
            json!({ "id": "one", "name": "One", "columns": [{ "id": "c1", "name": "To do", "taskIds": ["a", "b"] }],
            "tasks": { "a": { "id": "a", "title": "A", "links": [{ "type": "blocks", "board": "one", "task": "b" }] },
                       "b": { "id": "b", "title": "B", "links": [{ "type": "relates", "board": "one", "task": "a" }] } } }),
        );
        write(
            boards.join("two.json"),
            json!({ "id": "two", "name": "Two", "columns": [{ "id": "c2", "name": "Later", "taskIds": [] }], "tasks": {} }),
        );
        let ctx = Ctx {
            fixed: Some(vault.clone()),
            source: Source::Flag,
            current: RefCell::new(None),
            client: RefCell::new(None),
            tool: RefCell::new(None),
        };

        call_tool(
            &ctx,
            "move_task",
            &json!({ "project": "P", "board": "One", "task": "A", "column": "Later", "to_board": "Two" }),
        )
        .unwrap();
        let read = |f: &str| {
            serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(boards.join(f)).unwrap()).unwrap()
        };
        let (one, two) = (read("one.json"), read("two.json"));
        assert!(one["tasks"].get("a").is_none());
        assert_eq!(one["columns"][0]["taskIds"], json!(["b"]));
        assert_eq!(two["columns"][0]["taskIds"], json!(["a"]));
        // Its own link still points at B on board one; B's link to it follows it to board two.
        assert_eq!(
            two["tasks"]["a"]["links"],
            json!([{ "type": "blocks", "board": "one", "task": "b" }])
        );
        assert_eq!(
            one["tasks"]["b"]["links"],
            json!([{ "type": "relates", "board": "two", "task": "a" }])
        );
        assert!(call_tool(
            &ctx,
            "move_task",
            &json!({ "project": "P", "board": "Two", "task": "A", "column": "Nope", "to_board": "One" })
        )
        .is_err());
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn done_column_is_the_picked_one_else_the_last_holding_tasks() {
        let tag = json!({ "kind": "tags", "tags": ["x"], "match": "any" });
        let mut b = json!({ "columns": [{ "id": "todo", "source": null }, { "id": "done", "source": null }, { "id": "view", "source": tag }] });
        assert_eq!(done_column(&b).as_deref(), Some("done"));
        b["doneColumn"] = json!("todo");
        assert_eq!(done_column(&b).as_deref(), Some("todo"));
        b["doneColumn"] = json!("gone");
        assert_eq!(done_column(&b).as_deref(), Some("done"));
        b["doneColumn"] = json!("view");
        assert_eq!(done_column(&b).as_deref(), Some("done"));
    }

    #[test]
    fn adding_and_moving_columns_keeps_the_done_column() {
        let vault = std::env::temp_dir().join(format!("astali-done-test-{}", super::new_id()));
        let boards = vault.join("p").join("boards");
        std::fs::create_dir_all(&boards).unwrap();
        let write = |path: std::path::PathBuf, v: serde_json::Value| std::fs::write(path, v.to_string()).unwrap();
        write(
            vault.join("p").join("project.json"),
            json!({ "id": "p", "name": "P", "boardOrder": ["one"] }),
        );
        // Written before done columns were saved: "Done" is done only by being last.
        write(
            boards.join("one.json"),
            json!({ "id": "one", "name": "One", "tasks": {},
            "columns": [{ "id": "todo", "name": "To do", "taskIds": [] }, { "id": "done", "name": "Done", "taskIds": [] }] }),
        );
        let ctx = Ctx {
            fixed: Some(vault.clone()),
            source: Source::Flag,
            current: RefCell::new(None),
            client: RefCell::new(None),
            tool: RefCell::new(None),
        };
        let read = || {
            serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(boards.join("one.json")).unwrap())
                .unwrap()
        };

        call_tool(
            &ctx,
            "create_column",
            &json!({ "project": "P", "board": "One", "name": "Later" }),
        )
        .unwrap();
        assert_eq!(read()["doneColumn"], "done");
        call_tool(
            &ctx,
            "move_column",
            &json!({ "project": "P", "board": "One", "column": "Done", "position": 0 }),
        )
        .unwrap();
        assert_eq!(done_column(&read()).as_deref(), Some("done"));
        // Deleting the done column hands the role on, and it stays put afterwards.
        call_tool(
            &ctx,
            "delete_column",
            &json!({ "project": "P", "board": "One", "column": "Done" }),
        )
        .unwrap();
        let later = read()["columns"][1]["id"].clone();
        assert_eq!(read()["doneColumn"], later);
        call_tool(
            &ctx,
            "create_column",
            &json!({ "project": "P", "board": "One", "name": "Extra" }),
        )
        .unwrap();
        assert_eq!(read()["doneColumn"], later);
        let fresh = super::new_board("B", "", None);
        assert_eq!(fresh["doneColumn"], fresh["columns"][2]["id"]);
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn archived_tasks_leave_the_board_but_stay_searchable_and_linked() {
        let vault = std::env::temp_dir().join(format!("astali-archive-test-{}", super::new_id()));
        let boards = vault.join("p").join("boards");
        std::fs::create_dir_all(&boards).unwrap();
        let write = |path: std::path::PathBuf, v: serde_json::Value| std::fs::write(path, v.to_string()).unwrap();
        write(
            vault.join("p").join("project.json"),
            json!({ "id": "p", "name": "P", "boardOrder": ["one"] }),
        );
        write(
            boards.join("one.json"),
            json!({ "id": "one", "name": "One", "doneColumn": "done",
            "columns": [{ "id": "todo", "name": "To do", "taskIds": ["a"] }, { "id": "done", "name": "Done", "taskIds": ["b", "c"] }],
            "tasks": { "a": { "id": "a", "title": "Open", "links": [{ "type": "relates", "board": "one", "task": "b" }] },
                       "b": { "id": "b", "title": "Shipped", "description": "the parser" }, "c": { "id": "c", "title": "Also shipped" } } }),
        );
        let ctx = Ctx {
            fixed: Some(vault.clone()),
            source: Source::Flag,
            current: RefCell::new(None),
            client: RefCell::new(None),
            tool: RefCell::new(None),
        };
        let call = |name: &str, args: serde_json::Value| call_tool(&ctx, name, &args).unwrap();
        let read = || {
            serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(boards.join("one.json")).unwrap())
                .unwrap()
        };

        assert_eq!(
            call(
                "archive_tasks",
                json!({ "project": "P", "board": "One", "column": "Done" })
            )["archived"],
            json!(["Shipped", "Also shipped"])
        );
        let board = call("get_board", json!({ "project": "P", "board": "One" }));
        assert_eq!(board["archived"], 2);
        assert_eq!(board["columns"][1]["tasks"], json!([]));
        // The link to an archived task is kept, so it comes back with it.
        assert_eq!(
            read()["tasks"]["a"]["links"],
            json!([{ "type": "relates", "board": "one", "task": "b" }])
        );
        let found = call("search_tasks", json!({ "project": "P", "query": "parser" }));
        assert_eq!(
            (
                found["count"].clone(),
                found["tasks"][0]["archived"].clone(),
                found["tasks"][0]["archivedFrom"].clone()
            ),
            (json!(1), json!(true), json!("Done"))
        );
        assert_eq!(
            call("search_tasks", json!({ "project": "P", "column": "archived" }))["count"],
            2
        );

        call(
            "restore_task",
            json!({ "project": "P", "board": "One", "task": "Shipped" }),
        );
        let b = read();
        assert_eq!(b["columns"][1]["taskIds"], json!(["b"]));
        assert_eq!(b["archive"].as_array().unwrap().len(), 1);
        call("restore_task", json!({ "project": "P", "board": "One", "task": "c" }));
        assert!(read().get("archive").is_none());

        // An auto-archiving done column sends tasks moved into it to the archive; reordering it doesn't.
        assert!(call_tool(
            &ctx,
            "update_column",
            &json!({ "project": "P", "board": "One", "column": "To do", "auto_archive": true })
        )
        .is_err());
        // Turning it on archives what the column holds, in its order, and restoring waits until it's off.
        call(
            "update_column",
            json!({ "project": "P", "board": "One", "column": "Done", "auto_archive": true }),
        );
        assert_eq!(
            call("get_board", json!({ "project": "P", "board": "One" }))["columns"][1]["autoArchive"],
            true
        );
        let b = read();
        assert_eq!(b["columns"][1]["taskIds"], json!([]));
        assert_eq!(
            b["archive"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| e["task"]["id"].clone())
                .collect::<Vec<_>>(),
            [json!("c"), json!("b")]
        );
        assert!(call_tool(
            &ctx,
            "restore_task",
            &json!({ "project": "P", "board": "One", "task": "b" })
        )
        .is_err());
        // One archived from another column can still go back there.
        call(
            "archive_tasks",
            json!({ "project": "P", "board": "One", "tasks": ["Open"] }),
        );
        call(
            "restore_task",
            json!({ "project": "P", "board": "One", "task": "Open" }),
        );
        assert_eq!(read()["columns"][0]["taskIds"], json!(["a"]));
        call(
            "move_task",
            json!({ "project": "P", "board": "One", "task": "Open", "column": "Done" }),
        );
        let b = read();
        assert_eq!(
            (b["columns"][0]["taskIds"].clone(), b["tasks"].get("a").is_none()),
            (json!([]), true)
        );
        assert_eq!(
            (b["archive"][0]["task"]["id"].clone(), b["archive"][0]["from"].clone()),
            (json!("a"), json!("done"))
        );
        call(
            "update_column",
            json!({ "project": "P", "board": "One", "column": "Done", "auto_archive": false }),
        );
        assert!(read().get("autoArchive").is_none());
        // Off again, a task can be restored, and reordering within Done is just a reorder.
        call("restore_task", json!({ "project": "P", "board": "One", "task": "b" }));
        call("restore_task", json!({ "project": "P", "board": "One", "task": "c" }));
        call(
            "update_column",
            json!({ "project": "P", "board": "One", "column": "Done", "auto_archive": true }),
        );
        assert_eq!(read()["columns"][1]["taskIds"], json!([]));
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn colors_accept_presets_and_any_hex() {
        assert_eq!(parse_color("violet").as_deref(), Some("violet"));
        assert_eq!(parse_color("#3B82F6").as_deref(), Some("#3b82f6"));
        assert_eq!(parse_color("3b82f6").as_deref(), Some("#3b82f6"));
        assert_eq!(parse_color("#0aF").as_deref(), Some("#00aaff"));
        assert_eq!(parse_color("#000000").as_deref(), Some("#000000"));
        assert_eq!(parse_color("purple"), None);
        assert_eq!(parse_color("#12345"), None);
        assert_eq!(parse_color("#ggg"), None);
    }
}
