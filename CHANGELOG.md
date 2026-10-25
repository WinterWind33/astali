# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.10.0] - 2026-10-25

### Added

- **Finish closed issues**: from the done column's menu, tasks move there by themselves when their GitHub issue closes.
- **Milestones**: link a task to a GitHub milestone and see its progress and due date on the card.
- **Board templates**: save a kanban board as a template, with or without its tasks, and start new boards from it.
- **Board groups**: gather boards under a folder, placed anywhere in the sidebar, and fold it away when you don't need it.
- **Multi-selection**: Ctrl/⌘-click or Shift-click cards to tag, prioritize, date, move, archive or delete them together.
- An AI agent can do the same through the MCP server: finish closed issues, link milestones, use templates and groups.

### Changed

- Astali reads and writes only inside the open vault, keeping the rest of your computer out of reach.
- Saving and reading boards is faster on big vaults.

## [1.9.0] - 2026-10-19

### Added

- **Git panel**: click the branch in the title bar to sync, pull, push and commit without leaving Astali.
- **Sync** commits the vault, pulls and pushes in one click, publishing a new branch if needed.
- Switch to any local or remote branch, or start a new one, from the git panel's branch name.
- The git panel lists the files with uncommitted changes.
- Commits take only the vault's files, unless you include the rest of the repository.
- On a conflicting pull, choose to keep the incoming versions, keep yours, or undo the pull.
- **Automatic sync**: Astali can sync by itself every few changes, from *Settings → Git*.
- An AI agent can change Astali's settings for you with the MCP server's `get_settings` and `update_settings`.
- **Boards archive**: archive a finished board from its menu; it waits, with its tasks, behind the archive button
  next to *Boards*.
- The MCP server archives and restores boards with `archive_board` and `restore_board`.
- **Search**: press Ctrl+Shift+F (⌘⇧F), or click the search box in the title bar, to find anything in the project.
  A result opens where it lives.
- Search can look through every project of the vault at once.
- Ctrl+F (⌘F) searches just the view or dialog you're in.
- An AI agent can search everything the same way with the MCP server's `search` tool.
- Git-ignore only Astali's cache, so your boards and projects are committed without the intermediate files.

### Changed

- The tutorials are easier to read: a short summary and a few points per page, with every page listed on the side.
- *What's new* gives each entry more room and colors added, changed and fixed items apart.

### Fixed

- The home page's board count no longer counts the glossary.
- Menus, pickers and the git panel close when you click elsewhere or switch windows.

## [1.8.0] - 2026-10-11

### Added

- **Glossary**: keep the terms, acronyms and names a project uses, with what they mean, from the sidebar.
- Glossary definitions stay short, 300 characters unless you change it in the project settings.
- A glossary term can have tags and a source, and a note can be promoted to a term.
- The MCP server reads and edits the glossary with `search_terms`, `create_term`, `update_term` and `delete_term`.
- An AI agent can make a new vault with `create_vault` and keep it out of commits with `set_gitignore`.
- Sort a column's tasks by priority, name, creation or due date from its menu.

### Changed

- Tag columns leave out finished tasks.
- A note can be blank, as a marker or to fill in later.
- Pinning a new note no longer opens the editor, so you can pin several in a row.
- The pointer turns into a hand over a note only while you drag it.

### Fixed

- Clicking empty board space adds the task you're typing, even on boards wider than the window.
- Undoing a move of several tasks within a column restores their order.
- Promoting a note no longer blanks the window when the vault has a board kind this version doesn't know.
- If something unexpected goes wrong, Astali shows the error and a Reload button instead of a blank window.
- A Markdown plan keeps a step whose title mentions a question, such as "Research question".
- On Linux, the AppImage's AI integration command keeps working after Astali restarts.

## [1.7.1] - 2026-10-07

### Fixed

- On macOS, shortcut hints show ⌘ instead of Ctrl.

## [1.7.0] - 2026-10-07

### Added

- **Archive**: put finished tasks away from the task dialog, or a whole column from its menu. The board's archive
  lets you search, restore or delete them.
- **Auto archive**: the done column can archive every task moved into it.
- The MCP server archives and restores tasks with `archive_tasks` and `restore_task`.
- **Automatic updates**: an *Update* button appears in the title bar when a new version is out, and installs only
  when you say so.
- *Settings → Updates* checks for a new version on demand.

### Changed

- **New icon**: a pencil-drawn "A", in place of the old one that looked too much like Trello's.
- A new note starts in the color you last used on that board.
- *What's new* moved into *Settings → Updates*.
- Big projects stay fast: Astali rereads only the boards that changed on disk.
- History keeps far more, since editing a note or plan no longer copies the whole board.
- The MCP server's `get_board` and `search_tasks` list fewer items by default, so big boards fit an assistant's
  context.

### Security

- The GitHub token is kept in your system's credential store instead of Astali's settings file.
- Undo refuses history entries that would write outside the vault.
- The MCP server refuses fake GitHub repository names, so a tampered project can't redirect your token.

### Fixed

- Boards made before 1.6.0 keep their done column when you add or drag columns.

## [1.6.0] - 2026-10-06

### Added

- **Task links**: a task can block, or relate to, any other task of the project. Cards waiting on another show
  *Blocked*.
- **Done column**: pick which column holds finished work from its menu.
- **Board order**: drag boards in the sidebar, or sort them by name, age or kind.
- **Move to board**: send a task to another board, links and all.
- **Vault names**: give a vault its own name without renaming its folder.
- **Drag in plans**: drag steps to reorder them, and items within or across steps.
- **What's new**: after an update, a title bar badge shows what changed.
- The MCP server reads and changes task links with `get_board`, `link_tasks` and `unlink_tasks`.
- The MCP server shows and picks the done column with `get_board` and `update_column`.
- The MCP server reports the vault's name in `list_projects`.
- The MCP server moves a task to another board with `move_task`'s `to_board`.

### Fixed

- Updating with the Windows installer no longer unpins Astali from the taskbar.
- The MCP server follows the vault you're working in instead of the one it was registered with. Re-register it once
  from *Settings → AI integration*.
- Renaming a column no longer leaves a stuck drag preview.

### Changed

- *Settings → AI integration* registers the MCP server for every repository or just one.
- The task dialog waits for *Save* (or Ctrl+Enter) instead of saving as you type.

## [1.5.0] - 2026-10-06

### Added

- **Help**: a *?* button in the title bar opens a short tour of the app.
- **GitHub token health**: a red dot on the settings icon warns when the token expires or is revoked.
- **Notes boards**: an endless, zoomable board of post-its with Markdown, tags, issues and colors.
- The MCP server edits notes with `create_note`, `update_note` and `delete_note`.
- **Promote**: turn a note into a task, a plan step, another note or a decision.
- **Seasonal themes**: an opt-in look for Halloween, Christmas and Easter.

### Changed

- Dialogs open centered in the window.

## [1.4.1] - 2026-10-04

### Fixed

- The Decisions view and plan boards are centered in wide windows.

## [1.4.0] - 2026-10-04

### Added

- **Plan boards**: an implementation plan with a goal, numbered steps, nested checklists and open questions.
- Plans can be imported from Markdown and copied back as Markdown.
- The MCP server creates, reads and updates plans (`create_plan`, `get_plan`, `update_plan_item`, …).
- **Decisions**: short, numbered notes on why the code is the way it is, in the project sidebar.
- Decision search matches every word, and a decision can be marked as replaced by a newer one.
- Decisions stay under a character limit, 500 unless you change it in the project settings.
- Decisions show in Activity, can be undone and share the project's tags.
- The MCP server manages decisions with `search_decisions`, `add_decision`, `update_decision` and `delete_decision`.

### Changed

- Tag fields suggest tags as colored chips you can pick with the keyboard.

### Fixed

- The Windows installer stops running MCP servers itself.
- Settings are never reset, even when the file can't be read.
- Files keep fields this version doesn't know about.
- `Esc` in a popover closes just the popover, not its dialog.
- The vault's `AGENTS.md` guide is refreshed when it's out of date.

## [1.3.0] - 2026-10-04

### Added

- **Tag colors**: click a tag to pick its color.
- **Tag columns**: a column showing the board's tasks with some tags; dropping a task on it adds them.
- **Tags view**: every tag and GitHub label with its usage, to rename, recolor or remove.
- **Collapsible columns**: shrink a column to a narrow strip.
- Tag suggestions in a task's tag field.
- The MCP server supports tag columns and tag colors.
- Astali is now licensed under the MIT License.
- **About** tab in Settings with the version, paths and license.
- **Credits** tab in Settings listing every bundled package and its license.

### Changed

- Task "labels" are now called tags and look different from GitHub labels.
- Settings is split into tabs.

## [1.2.0] - 2026-10-03

### Added

- **Activity history with undo**: every change, yours or an AI agent's, is recorded and can be undone.
- The MCP server's `list_history` and `undo` let an agent review and revert its changes.
- Add many GitHub issues to a board at once.
- The MCP server's `add_issues_as_tasks` adds many issues in one go.
- The title bar shows the repository's branch, pull request, ahead/behind and changed files.
- **Label columns**: a read-only column of the issues carrying a GitHub label.
- Issues and labels refresh by themselves while a project is open.
- The MCP server supports label columns.

### Changed

- Clicking **Astali** in the title bar goes back to choosing a vault.

### Fixed

- The Claude Code registration command in Settings works in PowerShell.

## [1.1.0] - 2026-10-03

### Added

- Recent vaults that were moved or deleted are flagged, with a **Remove** button.

### Changed

- A missing recent vault is flagged instead of silently dropped.

## [1.0.0] - 2026-10-03

First stable release.

### Added

- A local vault of projects, boards, columns and tasks stored as plain JSON files.
- Create, edit, delete and drag projects, boards, columns and tasks.
- Tasks with a Markdown description, priority, labels, due date, checklist and GitHub issue.
- Read-only GitHub integration: add a linked repository's issues to a board.
- Edits made to the vault from outside show up live.
- Any color for projects and columns, with presets and favorites.
- Scroll boards sideways with the wheel or by dragging.
- Dark, light or system theme.
- A built-in MCP server (`astali mcp`) so AI agents can manage the vault.
- Opt-in `.gitignore` block when the vault is in a git repository.
- Windows installers (MSI and NSIS).
