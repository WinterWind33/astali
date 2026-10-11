# Astali vault

This folder is an Astali kanban vault. Everything is plain JSON; the Astali desktop app watches
this folder and reloads live, so edits made here (by hand or by an AI agent) appear instantly.
The app keeps this guide up to date and rewrites it when the format changes, so don't keep notes in it.

**Preferred for AI agents:** use the Astali MCP server (`astali mcp --vault <this folder>`), which
validates input and keeps files consistent. Editing the JSON directly also works if you follow the rules below.

## Layout

- `<project-folder>/project.json` — one folder per project (any folder name; not starting with ".")
- `<project-folder>/boards/*.json` — one file per board
- `<project-folder>/decisions/*.json` — one file per decision (why the code is the way it is)
- `<project-folder>/.cache/github-issues.json` — read-only cache of GitHub issues (regenerated on sync)
- `.astali/vault.json` — marks the folder as a vault; its optional `name` is the vault's name in the app (else the folder's).
- `.astali/history.jsonl` — change history written by the app and the MCP server (don't edit it). Edits made
  directly to the JSON files are not recorded there, so they can't be undone from the app

## project.json
`{ schemaVersion: 1, id, name, description, color, repos: [{owner, repo}], tagColors: { [tag lowercase]: color }, decisionCharLimit: number, glossaryCharLimit: number, boardOrder: [boardId...], createdAt, updatedAt }`

`tagColors` holds the colors picked for task tags (`Task.labels`); tags not listed get a color derived from their name.
`decisionCharLimit` (a whole number from 50 to 5000, default 500) caps a decision's `why` + `rejected`, in characters.
`glossaryCharLimit` (a whole number from 50 to 5000, default 300) caps a glossary term's `definition`, in characters.

## decision file (`decisions/d<number>-<id>.json`)
`{ schemaVersion: 1, id, number, title, why (markdown), rejected, about: [string], tags: [string], issues: [{repo: "owner/name", number}], replacedBy: number|null, createdAt, updatedAt }`

- `number` is shown as D-<number>: unique in the project, the next one is the highest + 1.
- `about` lists the code the decision explains (class or function names, paths); search matches it first.
- `replacedBy` is the number of the decision that superseded this one.
- Keep `why` + `rejected` within the project's `decisionCharLimit`.

## board file
`{ schemaVersion: 1, id, name, description, columns: [Column], doneColumn?: columnId, autoArchive?: true, tasks: { [taskId]: Task }, archive?: [{ task: Task, from: columnId, at }], createdAt, updatedAt }`

`archive` holds finished tasks put away from the board, newest first: they are in no column and not in `tasks`,
`from` is the column they left (restoring puts them back there), and they count as done.

`doneColumn` is the column where finished work ends up: the progress bar counts its tasks, and a task blocked by
one of them isn't blocked any more. When it is absent, or names a column that is gone, the last column that holds
tasks is the done column.
With `autoArchive: true`, a task moved into the done column goes straight to the archive (`from` is the done column).

A board with `kind: "plan"` is an implementation plan instead: its `columns` and `tasks` stay empty and it holds
`plan: { goal (markdown), issues: [{repo, number}], steps: [Step], questions: [Question], notes (markdown) }`:

- Step: `{ id, title, notes (markdown), items: [Item] }` — steps are shown numbered, in this order.
- Item: `{ id, text (markdown), state: "todo"|"done"|"skipped", reason (why it was skipped), decision: number|null, children: [Item] }`
- Question: `{ id, text, answer, resolved: boolean, decision: number|null }` — `decision` is a decision's number (D-<number>).

A board with `kind: "notes"` is a board of post-its instead: its `columns` and `tasks` stay empty and it holds
`noteLimit: number` (most characters a note's title and description may hold together) and `notes: [Note]`:

- Note: `{ id, title, description (markdown), tags: [string] (the project's tags), issues: [{repo, number}], color: null|Color, x, y, createdAt, updatedAt }`
  — `color` null follows the note's first tag (plain yellow without tags).
  — `x`/`y` are the note's top-left corner in pixels (the board is endless: they may be negative); later notes are drawn over earlier ones.

A board with `kind: "glossary"` holds the terms, acronyms and names the project uses instead. A project has at most
one; the app shows it as its own sidebar entry, not as a board, and makes the file with the first term. Its
`columns` and `tasks` stay empty and it holds `terms: [Term]`, in the order they were added:

- Term: `{ id, term, definition (markdown), tags: [string] (the project's tags), source (a URL, or any text such as a book and page; "" for none), createdAt, updatedAt }`
  — no two terms of a glossary are the same, ignoring case and accents; keep `definition` within the project's `glossaryCharLimit`.

- Column: `{ id, name, color, wipLimit: number|null, collapsed?: true, taskIds: [taskId...], source: null|LabelSource|TagSource }` — order of `taskIds` is the card order.
  `collapsed` is only written while the column is collapsed to a narrow strip on the board.
- LabelSource: `{ kind: "label", repo: "owner/name", labelId: number, name, showClosed: boolean, deletedAt: ISO|null }`.
  While `deletedAt` is null the column is a live view of the cached issues carrying that GitHub label: the app
  computes its cards, keeps `taskIds` empty and keeps `name`/`color` in step with the label. Don't put tasks in it.
- TagSource: `{ kind: "tags", tags: [string], match: "any"|"all" }`. The column is a live view of the board's tasks
  carrying any (or all) of the tags, case-insensitively; the tasks stay in their own columns. `taskIds` stays empty.
- Task: `{ id, title, description (markdown), priority: "none"|"low"|"medium"|"high"|"urgent", labels: [string] (the task's tags),
  dueDate: "YYYY-MM-DD"|null, issue: {repo: "owner/name", number}|null, checklist: [{id, text, done}],
  links?: [{type: "blocks"|"relates", board: <board id>, task: <task id>}], createdAt, updatedAt }`.
  A link is stored once, on the task it starts from ("blocked by" is the other task's "blocks"); a pair of tasks has
  at most one link, and `links` is left out when empty.
- Colors: a preset (slate, violet, blue, cyan, emerald, lime, amber, orange, rose, pink) or any hex color "#rrggbb".

## Rules
- Every task must be listed in exactly one column's `taskIds`.
- IDs are short random lowercase alphanumeric strings and must be unique.
- Timestamps are ISO-8601. Bump `updatedAt` when you change something.
- Keep JSON valid (2-space indent). Never write to `.cache/`.
