# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.1] - 2026-10-07

### Fixed

- On macOS, shortcut hints show ⌘ instead of Ctrl: ⌘+Enter saves a task or a note, and ⌘+F jumps to the decision search.

## [1.7.0] - 2026-10-07

### Added

- **Archive**: put finished tasks away with *Archive* in the task dialog, or a whole column at once with *Archive all
  tasks* in its menu. The board's archive (the box in its header) lets you search them, restore them to their column,
  or delete them for good. Archived tasks still count as done.
- **Auto archive**: turn it on from the done column's menu to archive its tasks, and every task you move there from
  then on, with a notice saying so. While it's on, neither restoring nor undoing puts a task back in that column.
- The MCP server archives and restores tasks with `archive_tasks` and `restore_task`, and `search_tasks` still finds
  archived ones.
- **Automatic updates**: when a new version is out, an *Update* button appears in the title bar. It shows what's new
  since your version, and installs and restarts only when you say so. This works from the next release on.
- **Settings → Updates** checks for a new version on demand, and lets you turn off the check at startup.

### Changed

- **New icon**: an "A" drawn by a pencil, with a tick for its crossbar, a note and a planner, in place of the old
  board-like icon that looked too much like Trello's.
- A new note on a notes board starts in the color you last gave a note there, instead of always yellow.
- Settings' *What's new* is now part of the *Updates* tab.

- Big projects stay fast: Astali rereads only the boards that changed on disk, instead of every board of the
  project after each save.
- History keeps far more: editing a note or a plan no longer copies the whole board into it, so busy notes boards
  and plans stop pushing older changes out.
- The MCP server's `get_board` lists the first 20 tasks of the done column (`done_limit` changes it) and
  `search_tasks` the first 50 matches (`limit`), so big boards fit in an assistant's context. Both are much faster
  on large projects, and `search_tasks` can look in a single `board`.

### Security

- The GitHub token is kept in your system's credential store (Credential Manager, Keychain or Secret Service)
  instead of in Astali's settings file. A saved token moves there the first time you start this version.
- Undo refuses a history entry that would write files outside the vault, so a vault someone else tampered with
  can't use it to put files elsewhere on your computer.
- The MCP server refuses GitHub repository names that aren't real ones, so a tampered project can't send your
  token's requests to other GitHub endpoints.

### Fixed

- Boards made before 1.6.0 no longer move their done column to the rightmost column when you add or drag columns.

## [1.6.0] - 2026-10-06

### Added

- **Task links**: a task can block, be blocked by, or relate to any other task of the project, on any board, from the
  new *Links* section of the task dialog. Cards waiting on a task that isn't yet in its board's done column show
  *Blocked*.
- **Done column**: pick which column holds finished work with *Mark as done column* in its menu. The progress bar
  and blocked tasks follow it wherever you move it, so reordering or adding columns no longer changes them. Tasks
  are dragged into it rather than created there.
- **Board order**: drag boards in the sidebar by the grip that shows on hover to reorder them, or sort them all at once by name, age or kind from
  the new sort button beside *+*.
- **Move to board**: send a task to a column of another board from *Move to board…* in the task dialog. Its links
  come along, and tasks linked to it keep pointing at it.
- **Vault names**: give a vault a name of its own from *Rename vault…* in its menu or in *Settings*, without renaming
  its folder. The name is stored in the vault, so it follows it to other computers.
- **Drag in plans**: drag a step by its grip to reorder it, and drag an item to move it within its step, to
  another step, or under another item. Dropping an item on a step's header puts it at the end of that step.
- **What's new**: after an update, a badge in the title bar shows what changed since the version you used before.
  The last five releases are always in *Settings → What's new*.
- The MCP server lists each task's links in `get_board` and changes them with `link_tasks` and `unlink_tasks`.
- The MCP server marks the done column in `get_board` and can pick it with `update_column`.
- The MCP server reports the vault's name in `list_projects`.
- The MCP server moves a task to another board with `move_task` and its new `to_board` argument.

### Fixed

- Updating with the Windows installer no longer unpins Astali from the taskbar: it now installs over the
  previous version by default instead of uninstalling it first.
- The MCP server no longer stays on the vault it was registered with: it uses the vault in the repository the
  assistant runs in, or else the one open in Astali, and follows you when you switch. Re-register it once from
  *Settings → AI integration*.
- Renaming a column no longer leaves a stuck drag preview when you press Enter or type a space.

### Changed

- *Settings → AI integration* can register the MCP server for every repository or just one, and shows which vault the
  assistant will use. Asking the assistant to list projects tells you too.
- The task dialog no longer saves as you type: edits wait for *Save* (or Ctrl+Enter), and *Cancel* asks before
  dropping them.

## [1.5.0] - 2026-10-06

### Added

- **Help**: a *?* button in the title bar opens a short guided tour of the app, one page per feature.
- **GitHub token health**: Astali checks the saved GitHub token on startup and in Settings. An expired or revoked
  token puts a red dot on the settings icon, and a working one shows when it expires.
- **Notes boards**: *+ → Notes* makes an endless, zoomable board of post-its, each with a title, Markdown text, tags,
  linked issues and a color. Notes have a per-board character limit, show up in Activity and the Tags view, and are
  editable over MCP (`create_note`, `update_note`, `delete_note`).
- **Promote**: a note can be turned into a task, a plan step, a note on another board or a decision. The note is
  removed unless *Keep the note too* is ticked.
- **Seasonal themes**: an opt-in switch in *Settings → Appearance* recolors the app for Halloween, Christmas and
  Easter, in dark and light. Each season also adds a small festive scene to the vault and project lists.

### Changed

- Dialogs open centered in the window instead of near its top edge.

## [1.4.1] - 2026-10-04

### Fixed

- The Decisions view and plan boards are centered in wide windows instead of sticking to the left edge.

## [1.4.0] - 2026-10-04

### Added

- **Plan boards**: *+ → Plan* makes a board for an implementation plan, with a goal, linked issues, numbered steps
  and open questions. Each step has Markdown notes and a nested checklist whose items are to do, done or skipped.
- Plans can be created from a Markdown draft and copied back as Markdown, and an item or question can be recorded
  as a decision.
- MCP: plan tools (`create_plan`, `get_plan`, `update_plan`, `add_plan_step`, `add_plan_items`, …), and kanban-only
  tools explain that a plan has no columns.
- **Decisions** in the project sidebar: short notes on why the code is the way it is, numbered D-1, D-2… per
  project. Each has a title, a why, an optional rejected alternative, the code it is about, tags and linked issues.
- Decision search matches every word and ranks code references and titles first; a decision can be marked as
  replaced by a newer one.
- Decisions must fit a per-project character limit (500 by default), set in the project settings.
- Decisions are recorded in Activity, can be undone, and share the project's tags.
- MCP: `search_decisions`, `add_decision`, `update_decision` and `delete_decision`, with the same limit enforced.

### Changed

- Tag fields suggest tags as colored chips with usage counts, navigable with the keyboard.

### Fixed

- The Windows installer now ends running Astali MCP servers itself instead of stopping on them.
- Settings are never reset: they aren't saved before being read, and an unreadable file is kept aside.
- Files keep fields this version doesn't know about instead of dropping them on the next edit.
- `Esc` in a popover opened from a dialog closes just the popover.
- The vault's own `AGENTS.md` guide is refreshed when it describes an older file format.

## [1.3.0] - 2026-10-04

### Added

- **Tag colors**: click a tag to pick its color; colors are stored per project and shown the same everywhere.
- **Tag columns**: a column that shows the board's tasks carrying one or more tags. Dropping a task on it adds the
  tags, and the tasks stay in their own columns.
- **Tags view** in the project sidebar: every tag and GitHub label with its usage, where tags can be renamed,
  recolored or removed across all tasks.
- **Collapsible columns**: a column can shrink to a narrow strip showing its name and count.
- Tag suggestions in a task's tag field.
- MCP: tag columns in `create_column`, `update_column` and `get_board`, and tag colors in `update_project`.
- Astali is now licensed under the MIT License, shown in the installers before installing.
- **About** tab in Settings with the app version, paths and license.
- **Credits** tab in Settings listing every bundled third-party package with its license.

### Changed

- Task "labels" are now called tags and look clearly different from GitHub labels.
- Settings is split into tabs (General, Git, Connectors, AI integration, About).

## [1.2.0] - 2026-10-03

### Added

- **Activity history with undo**: every change, from the app or an AI agent over MCP, is recorded with who made it.
  Any entry can be undone, including deleted boards and projects.
- MCP tools `list_history` and `undo`, so an agent can review and revert its own changes.
- Bulk-add GitHub issues to a board, with checkboxes, range selection and *Select all*.
- MCP tool `add_issues_as_tasks` to add many cached issues to a column in one write.
- Repository info in the title bar: remote link, open pull request, branch, ahead/behind and changed files.
- **Label columns**: a read-only column showing the issues that carry a GitHub label. It follows renames on GitHub
  and turns into an ordinary column if the label is deleted.
- Issues and labels are polled for changes while a project is open, using cheap conditional requests.
- Syncing also caches repository labels, and the MCP tools support label columns.

### Changed

- Clicking **Astali** in the title bar returns to the welcome screen to choose a vault.

### Fixed

- The Claude Code registration command in Settings now works when pasted into PowerShell.

## [1.1.0] - 2026-10-03

### Added

- Recent vaults whose folder was moved or deleted are flagged on startup, with a **Remove** button.

### Changed

- A missing recent vault is flagged instead of silently dropped, so it can be re-checked later.

## [1.0.0] - 2026-10-03

First stable release.

### Added

- Local-first vault: projects, boards, columns and tasks stored as plain JSON, with an `AGENTS.md` guide for AI
  agents.
- Full create, edit and delete for projects, boards, columns and tasks, with drag and drop between columns.
- Tasks with title, Markdown description, priority, labels, due date, checklist and linked GitHub issue.
- Read-only GitHub integration: link repositories and add their cached issues to a board.
- Live reload of external edits to the vault.
- Any color for projects and columns, with presets, a custom picker and favorites.
- Horizontal board scrolling by wheel or by dragging.
- Dark, light or system theme, a custom title bar and keyboard shortcuts.
- Built-in MCP server (`astali mcp`) for managing the vault from AI agents.
- Git repository detection with an opt-in managed `.gitignore` block.
- Windows installers (MSI and NSIS).
