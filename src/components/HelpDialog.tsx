import {
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  FolderKanban,
  History,
  Kanban,
  Lightbulb,
  ListChecks,
  Sparkles,
  SquareCheck,
  StickyNote,
  Tags,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "../lib/util";
import { Modal, ModalHeader } from "./ui";

interface HelpPage {
  title: string;
  icon: ReactNode;
  body: ReactNode;
}

// Each page stays around 1000 characters: a short read, not a manual.
const PAGES: HelpPage[] = [
  {
    title: "Welcome to Astali",
    icon: <Sparkles size={18} />,
    body: (
      <>
        <p>
          Astali is a planner for projects, studies and everything in between. It's free, works offline and needs no
          account.
        </p>
        <p>
          Everything lives in your <b>vault</b>: a folder on your computer that you pick the first time you start.
          Projects, boards and tasks are saved there as plain files, so you can back them up, sync them with a cloud
          drive or keep them in a git repository. Edits made to those files from outside show up in the app right away.
        </p>
        <p>
          The <b>title bar</b> is always at hand: click the vault name to switch vault or jump to all projects, the
          sun/moon cycles between dark, light and system theme, and the gear opens <b>Settings</b>.
        </p>
        <p>
          In <b>Settings → General</b> you can also turn on seasonal themes, which dress the app up for Halloween,
          Christmas and Easter.
        </p>
        <p>
          Use the arrows below (or ← and → on your keyboard) to move between pages. You can come back any time with the
          ? button.
        </p>
      </>
    ),
  },
  {
    title: "Projects",
    icon: <FolderKanban size={18} />,
    body: (
      <>
        <p>
          A <b>project</b> groups everything about one goal: a course, a thesis, an app. The home page lists them;
          create one with <b>New project</b> and give it a name, a color and an optional description.
        </p>
        <p>Open a project and its sidebar shows:</p>
        <ul>
          <li>
            <b>Boards</b>: kanban boards, plans and notes boards. The <b>+</b> next to the heading makes a new one, and
            each board's <b>⋯</b> menu renames or deletes it. The number beside a board counts its tasks, notes or plan
            items left.
          </li>
          <li>
            <b>Activity</b>, <b>Tags</b> and <b>Decisions</b>, views that cover the whole project.
          </li>
          <li>
            <b>GitHub</b>, when the project is linked to a repository.
          </li>
        </ul>
        <p>
          The gear beside the project name opens its settings: name, color, linked repositories and limits. A deleted
          project can be brought back from <b>Recently deleted</b> on the home page. With more than three projects, a
          search box helps you find the one you want.
        </p>
      </>
    ),
  },
  {
    title: "Kanban boards",
    icon: <Kanban size={18} />,
    body: (
      <>
        <p>
          A kanban board is made of <b>columns</b>, and each column holds <b>tasks</b>. A new board starts with To Do,
          Doing and Done; move a task along as the work progresses.
        </p>
        <ul>
          <li>Drag tasks within a column or between columns. Drag a column by its header to reorder it.</li>
          <li>
            <b>Add task</b> at the bottom of a column creates a task there; <b>Add column</b> at the end of the board
            adds a column.
          </li>
          <li>
            A column's <b>⋯</b> menu renames and recolors it, sets a <b>WIP limit</b> (its task count turns red when it
            holds too many tasks), collapses it into a thin strip, or deletes it.
          </li>
          <li>
            A collapsed column still takes the tasks dropped on it; double-click it to expand it again. Columns can have
            any color: a preset, a favorite or one of your own.
          </li>
          <li>
            Scroll the board sideways with the mouse wheel, or by dragging empty space. Press <kbd>/</kbd> to filter the
            tasks.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Tasks",
    icon: <SquareCheck size={18} />,
    body: (
      <>
        <p>Click a task to open its details. A task can have:</p>
        <ul>
          <li>a title and a description written in Markdown (headings, lists, links, code)</li>
          <li>a priority, from low to urgent, shown as an icon on the card</li>
          <li>a due date, which turns amber on the card when it's close and red once it's past</li>
          <li>a checklist, with its progress shown on the card</li>
          <li>tags, and a linked GitHub issue</li>
        </ul>
        <p>
          In the tags field, suggestions appear as colored chips: the arrow keys move through them, <kbd>Enter</kbd>{" "}
          adds one and <kbd>Esc</kbd> closes the list without closing the task. Clicking a tag on a card opens it in the
          Tags view.
        </p>
        <p>
          Changes are saved as you make them, and every one of them is recorded in <b>Activity</b>, so nothing is lost
          by mistake; several edits in a row to the same field count as a single entry. <kbd>Esc</kbd> closes the
          details.
        </p>
      </>
    ),
  },
  {
    title: "Tags",
    icon: <Tags size={18} />,
    body: (
      <>
        <p>
          <b>Tags</b> are your own labels for tasks, notes and decisions: “exam”, “bug”, “reading”. Type them in a
          task's details; the field suggests the tags the project already uses. Click a tag to change its color.
        </p>
        <p>
          A <b>tag column</b> (<b>Add tag column</b>, below Add column) always shows the board's tasks carrying some
          tags (any or all of them), while the tasks stay in their own columns. Dropping a task on it gives the task
          those tags, and each card says which column it really lives in.
        </p>
        <p>
          The <b>Tags</b> view in the sidebar lists every tag of the project with how often it's used. Pick one to see
          all its tasks across boards, rename it everywhere at once, or remove it. The sort button orders tags by use or
          by name.
        </p>
        <p>
          Don't confuse them with GitHub labels: tags are solid square chips, while GitHub labels are outlined pills
          with the GitHub mark.
        </p>
      </>
    ),
  },
  {
    title: "Plans",
    icon: <ListChecks size={18} />,
    body: (
      <>
        <p>
          A <b>plan</b> (+ → Plan) is for work that goes in order: a feature, a thesis chapter, an exam schedule. It has
          a goal, numbered <b>steps</b> and <b>open questions</b>.
        </p>
        <ul>
          <li>Each step has notes and a checklist. Items can be done, still to do, or skipped with a reason.</li>
          <li>
            Checklists edit like an outline: <kbd>Enter</kbd> adds an item, <kbd>Tab</kbd> and <kbd>Shift+Tab</kbd> nest
            and un-nest, <kbd>Backspace</kbd> on an empty item removes it.
          </li>
          <li>
            The first step with work left is marked <b>Current</b> and finished steps fold away. Progress shows for each
            step and for the whole plan, and the sidebar counts the items left.
          </li>
          <li>
            <b>Record as decision</b> on an item or a question turns it into a decision linked to it.
          </li>
        </ul>
        <p>
          Already wrote it down? <b>+ → Plan from Markdown…</b> turns a draft into a plan: <code>##</code> headings
          become steps and <code>- [ ]</code> lines their checklist. <b>Copy as Markdown</b> writes it back out as text,
          ready to share.
        </p>
      </>
    ),
  },
  {
    title: "Notes boards",
    icon: <StickyNote size={18} />,
    body: (
      <>
        <p>
          A <b>notes board</b> (+ → Notes) is a wall of post-its for ideas that aren't tasks yet: brainstorming, lecture
          notes, things to look into.
        </p>
        <ul>
          <li>
            Drag the grid or scroll to move around; <kbd>Ctrl</kbd>+scroll zooms.
          </li>
          <li>The round + button gives you a note that follows the pointer: click to pin it, then write.</li>
          <li>
            Drag a note to move it; double-click it or use its pencil to edit it, then <b>Save</b> (
            <kbd>Ctrl+Enter</kbd>).
          </li>
          <li>
            A note can have a color from its palette, tags and linked GitHub issues. Without a color it takes its first
            tag's.
          </li>
          <li>Notes have a short character limit, so they stay notes. Change it in the board's settings.</li>
        </ul>
        <p>
          When an idea is ready, <b>promote</b> it with its ↗ button: it becomes a task on a board, a step of a plan, a
          note elsewhere or a decision. Tick <b>Keep the note too</b> if you want it to stay on the board.
        </p>
      </>
    ),
  },
  {
    title: "Decisions",
    icon: <Lightbulb size={18} />,
    body: (
      <>
        <p>
          <b>Decisions</b> record <i>why</i> something is the way it is, so that you, or whoever picks up the project,
          don't have to work it out again months later.
        </p>
        <p>
          Each one is numbered (D-1, D-2…) and has a short title, the <b>why</b>, and optionally the alternative you
          turned down, kept under a character limit (500 by default, set in the project settings) so it stays short.
          Note what it's about, like a file or a class name, so that searching for it finds the decision.
        </p>
        <p>
          The search box matches every word; <kbd>Enter</kbd> opens the best match, and <kbd>/</kbd> or{" "}
          <kbd>Ctrl+F</kbd> jumps back to it. Decisions share the project's tags and can link GitHub issues. When you
          change your mind, mark the old decision as <b>replaced</b> by the new one. A plan item or question can also
          become a decision with
          <b> Record as decision</b>.
        </p>
      </>
    ),
  },
  {
    title: "GitHub",
    icon: <CircleDot size={18} />,
    body: (
      <>
        <p>
          Link a project to one or more GitHub repositories from its settings (<b>+ Connect a repository</b> in the
          sidebar). Astali only ever <i>reads</i> from GitHub: it never changes anything there.
        </p>
        <ul>
          <li>
            <b>Issues</b> in the sidebar lists the repositories' issues. Select some and <b>Add to board</b> to turn
            them into linked tasks. Shift-click selects a range, and issues already on a board can't be added twice.
          </li>
          <li>
            A <b>label column</b> (<b>Add label column</b> on a board) always shows the issues carrying a GitHub label,
            and follows it when it's renamed.
          </li>
          <li>Issues refresh by themselves while the project is open; the ↻ button syncs right away.</li>
        </ul>
        <p>
          Without a token, GitHub allows 60 requests an hour. For private repositories, or to raise that to 5000, add a
          personal access token under <b>Settings → Connectors</b>. A red dot on the gear means it expired.
        </p>
      </>
    ),
  },
  {
    title: "Activity and undo",
    icon: <History size={18} />,
    body: (
      <>
        <p>
          Every change is recorded: yours, and those made by an AI assistant. <b>Activity</b> in the sidebar lists them
          by day, and you can filter them by board or by who made them.
        </p>
        <ul>
          <li>Click an entry to jump to the board with the affected cards highlighted.</li>
          <li>The clock button in a board's header shows just that board's activity.</li>
          <li>
            <b>Undo</b> reverts it. If something was changed again since, Astali tells you what and lets you undo the
            rest. Undoing is recorded too, so you can redo it the same way.
          </li>
          <li>A deleted board can be restored from Activity, and a deleted project from the home page.</li>
        </ul>
        <p>
          The history is kept inside the vault, so it travels with it. So go ahead and experiment: there's always a way
          back.
        </p>
      </>
    ),
  },
  {
    title: "Working with AI",
    icon: <Bot size={18} />,
    body: (
      <>
        <p>
          Astali can be used by AI assistants such as Claude, through a built-in <b>MCP server</b>. Once it's set up,
          you can ask the assistant to create a board, split a goal into tasks, write a study plan or tick off what's
          done, and you'll see the changes appear live.
        </p>
        <p>
          <b>Settings → AI integration</b> has a command to copy for Claude Code and a snippet for Claude Desktop. You
          only need to do it once. In a repository with a vault inside, the assistant uses that vault; anywhere else, it
          uses the one open in Astali and follows you when you switch.
        </p>
        <p>
          Try asking it to “turn my exam syllabus into a plan” or “add a task for each open bug”. Before changing code,
          an assistant can also search your <b>Decisions</b> to learn why things are the way they are.
        </p>
        <p>
          Everything the assistant does is recorded in <b>Activity</b> under its name, so you can review it and undo
          whatever you don't like.
        </p>
      </>
    ),
  },
];

/** The ? button's guided tour: one short page per part of the app, with back and next. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const page = PAGES[index];
  const last = index === PAGES.length - 1;

  useEffect(() => {
    // Captured, so the arrows turn pages instead of reaching the board behind the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.stopPropagation();
      setIndex((i) => Math.min(Math.max(i + (e.key === "ArrowRight" ? 1 : -1), 0), PAGES.length - 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <Modal onClose={onClose} width={600}>
      <ModalHeader
        title={
          <span className="help-title">
            {page.icon} {page.title}
          </span>
        }
        onClose={onClose}
      />
      <div className="help-body">{page.body}</div>
      <div className="help-footer">
        <button className="btn ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft size={15} /> Back
        </button>
        <div className="help-dots">
          {PAGES.map((p, i) => (
            <button
              key={p.title}
              className={cx("help-dot", i === index && "active")}
              onClick={() => setIndex(i)}
              title={p.title}
              aria-label={p.title}
            />
          ))}
        </div>
        {last ? (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <button className="btn primary" onClick={() => setIndex(index + 1)}>
            Next <ChevronRight size={15} />
          </button>
        )}
      </div>
    </Modal>
  );
}
