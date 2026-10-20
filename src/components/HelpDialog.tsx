import {
  BookA,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  FolderKanban,
  GitBranch,
  History,
  Kanban,
  Lightbulb,
  ListChecks,
  Search,
  Sparkles,
  SquareCheck,
  StickyNote,
  Tags,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx, MOD_KEY } from "../lib/util";
import { Modal, ModalHeader } from "./ui";

interface HelpPoint {
  /** A few words, shown in bold on their own line. */
  term: ReactNode;
  text: ReactNode;
}

interface HelpPage {
  title: string;
  icon: ReactNode;
  /** One or two sentences: what this part of the app is for. */
  lead: ReactNode;
  points: HelpPoint[];
  /** A hint worth knowing, set apart at the bottom. */
  tip?: ReactNode;
}

// Each page is a lead and a handful of short points, so it reads at a glance: a tour, not a manual.
const PAGES: HelpPage[] = [
  {
    title: "Welcome to Astali",
    icon: <Sparkles size={18} />,
    lead: <>A planner for projects, studies and everything in between. Free, offline, no account.</>,
    points: [
      {
        term: "Your vault",
        text: (
          <>
            A folder on your computer, picked the first time you start. Everything is saved there as plain files: back
            it up, sync it with a cloud drive or keep it in git. Edits made from outside show up right away.
          </>
        ),
      },
      {
        term: "The title bar",
        text: (
          <>
            Click the vault name to switch vault or go to all projects. The sun/moon changes the theme, the gear opens
            Settings.
          </>
        ),
      },
      {
        term: "Seasonal themes",
        text: <>Turn them on in Settings → General to dress the app up for Halloween, Christmas and Easter.</>,
      },
    ],
    tip: (
      <>
        Move between pages with <kbd>←</kbd> and <kbd>→</kbd>, or pick one on the left. The <b>?</b> button brings you
        back here.
      </>
    ),
  },
  {
    title: "Projects",
    icon: <FolderKanban size={18} />,
    lead: (
      <>
        A <b>project</b> groups everything about one goal: a course, a thesis, an app. Create one from the home page
        with <b>New project</b>.
      </>
    ),
    points: [
      {
        term: "Boards",
        text: (
          <>
            Kanban boards, plans and notes boards, in the sidebar. <b>+</b> makes a new one; a board's <b>⋯</b> menu
            renames, archives or deletes it. The number beside it counts what's left.
          </>
        ),
      },
      {
        term: "Project views",
        text: (
          <>
            <b>Activity</b>, <b>Tags</b>, <b>Decisions</b> and <b>Glossary</b> cover the whole project. <b>GitHub</b>{" "}
            appears once a repository is linked.
          </>
        ),
      },
      {
        term: "Settings",
        text: <>The gear beside the project name: name, color, linked repositories and limits.</>,
      },
      {
        term: "Archive and restore",
        text: (
          <>
            Archived boards wait behind the archive button next to <b>Boards</b>. A deleted project comes back from{" "}
            <b>Recently deleted</b> on the home page.
          </>
        ),
      },
    ],
  },
  {
    title: "Kanban boards",
    icon: <Kanban size={18} />,
    lead: (
      <>
        <b>Columns</b> of <b>tasks</b>. A new board starts with To Do, Doing and Done: move a task along as the work
        progresses.
      </>
    ),
    points: [
      {
        term: "Drag and drop",
        text: <>Drag tasks within or between columns. Drag a column by its header to reorder it.</>,
      },
      {
        term: "Add",
        text: (
          <>
            <b>Add task</b> at the bottom of a column, <b>Add column</b> at the end of the board.
          </>
        ),
      },
      {
        term: "Column menu",
        text: (
          <>
            Rename, recolor, sort its tasks, set a <b>WIP limit</b> (the count turns red when it's over) or collapse it.
            A collapsed column still takes dropped tasks; double-click to expand it.
          </>
        ),
      },
      {
        term: "Moving around",
        text: <>Scroll sideways with the mouse wheel, or drag empty space.</>,
      },
    ],
    tip: (
      <>
        Press <kbd>{MOD_KEY}+F</kbd> or <kbd>/</kbd> to filter the board's tasks.
      </>
    ),
  },
  {
    title: "Tasks",
    icon: <SquareCheck size={18} />,
    lead: <>Click a task to open its details. Changes are saved as you make them.</>,
    points: [
      {
        term: "Description",
        text: <>Written in Markdown: headings, lists, links, code.</>,
      },
      {
        term: "Priority and due date",
        text: <>Shown on the card. A due date turns amber when it's close and red once it's past.</>,
      },
      {
        term: "Checklist",
        text: <>Its progress shows on the card.</>,
      },
      {
        term: "Tags and issues",
        text: (
          <>
            Suggestions appear as you type: arrows move, <kbd>Enter</kbd> adds, <kbd>Esc</kbd> closes the list. A task
            can also link a GitHub issue.
          </>
        ),
      },
    ],
    tip: (
      <>
        Every change lands in <b>Activity</b>, so nothing is lost by mistake. <kbd>Esc</kbd> closes the details.
      </>
    ),
  },
  {
    title: "Tags",
    icon: <Tags size={18} />,
    lead: (
      <>Your own labels for tasks, notes and decisions: “exam”, “bug”, “reading”. Click a tag to change its color.</>
    ),
    points: [
      {
        term: "Tag columns",
        text: (
          <>
            <b>Add tag column</b> shows the board's unfinished tasks carrying some tags, while they stay in their own
            columns. Dropping a task on it tags the task.
          </>
        ),
      },
      {
        term: "The Tags view",
        text: (
          <>
            Lists every tag with how often it's used. Pick one to see its tasks across boards, rename it everywhere, or
            remove it.
          </>
        ),
      },
    ],
    tip: <>Tags are solid square chips; GitHub labels are outlined pills with the GitHub mark.</>,
  },
  {
    title: "Plans",
    icon: <ListChecks size={18} />,
    lead: (
      <>
        A <b>plan</b> (+ → Plan) is for work that goes in order: a feature, a thesis chapter, an exam schedule. A goal,
        numbered <b>steps</b> and <b>open questions</b>.
      </>
    ),
    points: [
      {
        term: "Steps",
        text: <>Notes and a checklist. Items are done, still to do, or skipped with a reason.</>,
      },
      {
        term: "Outline editing",
        text: (
          <>
            <kbd>Enter</kbd> adds an item, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> nest and un-nest, <kbd>Backspace</kbd>{" "}
            on an empty item removes it.
          </>
        ),
      },
      {
        term: "Progress",
        text: (
          <>
            The first step with work left is <b>Current</b>; finished steps fold away.
          </>
        ),
      },
      {
        term: "Decisions",
        text: (
          <>
            <b>Record as decision</b> turns an item or a question into a linked decision.
          </>
        ),
      },
    ],
    tip: (
      <>
        <b>+ → Plan from Markdown…</b> turns a draft into a plan: <code>##</code> headings become steps,{" "}
        <code>- [ ]</code> lines their checklist. <b>Copy as Markdown</b> writes it back out.
      </>
    ),
  },
  {
    title: "Notes boards",
    icon: <StickyNote size={18} />,
    lead: (
      <>
        A wall of post-its (+ → Notes) for ideas that aren't tasks yet: brainstorming, lecture notes, things to look
        into.
      </>
    ),
    points: [
      {
        term: "Moving around",
        text: (
          <>
            Drag the grid or scroll; <kbd>Ctrl</kbd>+scroll zooms.
          </>
        ),
      },
      {
        term: "New notes",
        text: <>The round + gives you a note that follows the pointer: click to pin it, blank, and write it later.</>,
      },
      {
        term: "Editing",
        text: (
          <>
            Double-click a note or use its pencil, then <b>Save</b> (<kbd>{MOD_KEY}+Enter</kbd>). Drag it to move it.
          </>
        ),
      },
      {
        term: "Color and tags",
        text: (
          <>A note without a color takes its first tag's. Notes stay short: the limit is in the board's settings.</>
        ),
      },
    ],
    tip: (
      <>
        Ready to act on an idea? <b>Promote</b> it with ↗: it becomes a task, a plan step, a decision or a glossary
        term.
      </>
    ),
  },
  {
    title: "Glossary",
    icon: <BookA size={18} />,
    lead: <>The words a project uses and what they mean: course terms, acronyms, names.</>,
    points: [
      {
        term: "New term",
        text: (
          <>
            A term and a short definition, with optional tags and a source: a link, or a book and page. Save with{" "}
            <kbd>{MOD_KEY}+Enter</kbd>.
          </>
        ),
      },
      {
        term: "Short on purpose",
        text: <>Definitions stay under 300 characters by default (project settings): link the long version.</>,
      },
      {
        term: "Find a term",
        text: (
          <>
            Terms are listed A–Z. The search box matches names first, then tags and definitions; <kbd>{MOD_KEY}+F</kbd>{" "}
            jumps to it.
          </>
        ),
      },
    ],
    tip: <>A note can become a term with Promote: its title is the term, its text the definition.</>,
  },
  {
    title: "Decisions",
    icon: <Lightbulb size={18} />,
    lead: (
      <>
        Record <i>why</i> something is the way it is, so nobody has to work it out again months later.
      </>
    ),
    points: [
      {
        term: "D-1, D-2…",
        text: <>A short title, the why, and optionally the alternative you turned down, under a character limit.</>,
      },
      {
        term: "About",
        text: <>Note what it explains, like a file or a class name, so searching for it finds the decision.</>,
      },
      {
        term: "Search",
        text: (
          <>
            Matches every word; <kbd>Enter</kbd> opens the best match.
          </>
        ),
      },
      {
        term: "Changed your mind?",
        text: (
          <>
            Mark the old decision as <b>replaced</b> by the new one.
          </>
        ),
      },
    ],
  },
  {
    title: "Search",
    icon: <Search size={18} />,
    lead: (
      <>
        Can't remember where you wrote something? <kbd>{MOD_KEY}+Shift+F</kbd>, or the search box in the title bar,
        looks through the whole project.
      </>
    ),
    points: [
      {
        term: "Everything",
        text: <>Tasks (archived too), notes, plan steps and items, decisions, glossary terms, tags and boards.</>,
      },
      {
        term: "Open in place",
        text: <>Pick a result to open it where it lives: the task, the note on its board, the plan step.</>,
      },
      {
        term: "Keyboard",
        text: (
          <>
            <kbd>↑</kbd> <kbd>↓</kbd> move through the results, <kbd>Enter</kbd> opens one, <kbd>Esc</kbd> closes.
          </>
        ),
      },
      {
        term: "Just this view",
        text: (
          <>
            <kbd>{MOD_KEY}+F</kbd> searches only where you are: the board's filter, Decisions, Glossary, Tags, Issues,
            or the open dialog.
          </>
        ),
      },
    ],
    tip: <>Tick “All projects” to look through every project of the vault.</>,
  },
  {
    title: "GitHub",
    icon: <CircleDot size={18} />,
    lead: (
      <>
        Link a project to GitHub repositories from its settings. Astali only <i>reads</i> issues and labels: it never
        changes them.
      </>
    ),
    points: [
      {
        term: "Issues",
        text: (
          <>
            Select some in the sidebar's Issues and <b>Add to board</b> to turn them into linked tasks. Shift-click
            selects a range.
          </>
        ),
      },
      {
        term: "Label columns",
        text: <>Always show the issues carrying a GitHub label, and follow it when it's renamed.</>,
      },
      {
        term: "Refresh",
        text: <>Issues refresh by themselves while the project is open; ↻ syncs right away.</>,
      },
    ],
    tip: (
      <>
        Private repositories, or more than 60 requests an hour? Add a token in <b>Settings → Connectors</b>.
      </>
    ),
  },
  {
    title: "Git",
    icon: <GitBranch size={18} />,
    lead: (
      <>
        When the vault is in a git repository, the title bar shows its branch, with commits to push (↑), to pull (↓) and
        changed files (●). Click it for the git panel.
      </>
    ),
    points: [
      {
        term: "Sync",
        text: (
          <>
            Commits the vault's files, pulls and pushes in one click. <b>Pull</b> and <b>Push</b> do one step at a time.
          </>
        ),
      },
      {
        term: "Commit",
        text: <>With your own message. Only the vault's files, unless you include the other changes.</>,
      },
      {
        term: "Branches",
        text: (
          <>
            Click the branch name at the top of the panel, then a branch to switch to it, or <b>New</b> to start one
            from where you are.
          </>
        ),
      },
      {
        term: "Conflicts",
        text: (
          <>
            <b>Keep incoming</b>, <b>Keep mine</b> or <b>Undo the pull</b>. The history keeps both sides.
          </>
        ),
      },
      {
        term: "What git ignores",
        text: (
          <>
            In <b>Settings → Git</b>: the whole vault, or only Astali's cache, so your boards are committed.
          </>
        ),
      },
    ],
    tip: (
      <>
        <b>Settings → Git → Automatic sync</b> syncs by itself after the number of changes you pick.
      </>
    ),
  },
  {
    title: "Activity and undo",
    icon: <History size={18} />,
    lead: <>Every change is recorded, yours and an AI assistant's, so there's always a way back.</>,
    points: [
      {
        term: "Activity",
        text: <>In the sidebar, by day, filtered by board or by who made the change. Click one to jump to it.</>,
      },
      {
        term: "Undo",
        text: <>Reverts an entry. If something changed since, Astali tells you what. Undoing can be undone too.</>,
      },
      {
        term: "Per board",
        text: <>The clock button in a board's header shows just that board's activity.</>,
      },
    ],
    tip: <>The history lives inside the vault, so it travels with it. Go ahead and experiment.</>,
  },
  {
    title: "Working with AI",
    icon: <Bot size={18} />,
    lead: (
      <>
        AI assistants such as Claude can use Astali through its built-in <b>MCP server</b>, and you see their changes
        appear live.
      </>
    ),
    points: [
      {
        term: "Set up once",
        text: (
          <>
            <b>Settings → AI integration</b> has a command for Claude Code and a snippet for Claude Desktop.
          </>
        ),
      },
      {
        term: "Ask for anything",
        text: <>“Turn my exam syllabus into a plan”, “add a task for each open bug”, “tick off what's done”.</>,
      },
      {
        term: "Reviewable",
        text: (
          <>
            Everything it does is in <b>Activity</b> under its name, ready to undo.
          </>
        ),
      },
    ],
    tip: <>Before changing code, an assistant can search your Decisions to learn why things are the way they are.</>,
  },
];

/** The ? button's guided tour: one short page per part of the app, with an index, back and next. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const page = PAGES[index];
  const last = index === PAGES.length - 1;
  const bodyRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [index]);

  return (
    <Modal onClose={onClose} width={820}>
      <ModalHeader
        title={
          <span className="help-title">
            {page.icon} {page.title}
          </span>
        }
        onClose={onClose}
      />
      <div className="help-layout">
        <nav className="help-nav">
          {PAGES.map((p, i) => (
            <button key={p.title} className={cx("help-nav-item", i === index && "active")} onClick={() => setIndex(i)}>
              {p.icon}
              <span>{p.title}</span>
            </button>
          ))}
        </nav>
        <div className="help-body" ref={bodyRef}>
          <p className="help-lead">{page.lead}</p>
          <ul className="help-points">
            {page.points.map((p, i) => (
              <li key={i}>
                <b>{p.term}</b>
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
          {page.tip && (
            <div className="help-tip">
              <Lightbulb size={15} />
              <span>{page.tip}</span>
            </div>
          )}
        </div>
      </div>
      <div className="help-footer">
        <button className="btn ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft size={15} /> Back
        </button>
        <span className="faint small">
          {index + 1} of {PAGES.length}
        </span>
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
