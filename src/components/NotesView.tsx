import {
  ArrowUpRight,
  History,
  Link2,
  Maximize,
  Minus,
  Palette,
  Pencil,
  Plus,
  Settings2,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  NOTE_LIMIT_MAX,
  NOTE_LIMIT_MIN,
  NOTE_WIDTH,
  NOTE_YELLOW,
  isBlankNote,
  lastNoteColor,
  newNote,
  noteLength,
  normalizeNoteLimit,
  rememberNoteColor,
} from "../lib/notes";
import type { Promotable } from "../lib/promote";
import {
  addNote,
  currentProject,
  deleteNote,
  renameBoard,
  setNoteLimit,
  setView,
  updateBoardDescription,
  updateNote,
  useStore,
} from "../lib/store";
import { tagColor } from "../lib/tags";
import type { Color, GhIssue, Note, Project } from "../lib/types";
import { colorHex, cx, issueKey, MOD_KEY, relativeTime } from "../lib/util";
import { ColorPicker } from "./ColorPicker";
import { PromoteDialog } from "./PromoteDialog";
import { IssueChip } from "./DecisionDialog";
import { IssuePicker } from "./board/TaskDialog";
import { TagInput } from "./TagInput";
import { InlineEdit, Markdown, Modal, Popover, TagChip, confirm } from "./ui";

/** The note's own color, else its first tag's, else post-it yellow; as "#rrggbb". */
const noteColor = (n: Pick<Note, "color" | "tags">, tagColors: Project["tagColors"] | undefined) =>
  n.color ? colorHex(n.color) : n.tags.length ? tagColor(n.tags[0], tagColors) : NOTE_YELLOW;

const asPromotable = (n: Note): Promotable => ({ title: n.title, body: n.description, tags: n.tags, issues: n.issues });

/** What the note editor changes; everything else about a note stays as it is. */
type NoteFields = Pick<Note, "title" | "description" | "tags" | "issues" | "color">;
const fieldsOf = (n: Note): NoteFields => ({
  title: n.title,
  description: n.description,
  tags: n.tags,
  issues: n.issues,
  color: n.color,
});

/** Pointer travel before a press on a note becomes a drag. */
const DRAG_SLOP = 4;
const GRID = 24;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Where the board is looked at: the screen offset of the board's origin, and the zoom. */
interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Each board's camera, kept while the app runs so coming back to a board finds it as it was left. */
const cameras = new Map<string, Camera>();

/**
 * A board of post-its on an endless grid. Drag the grid (or scroll) to move around, Ctrl+scroll or
 * the zoom controls to zoom. The + button spawns a note under the pointer; a click pins it there and
 * opens it for writing. Notes are dragged anywhere; double-clicking one edits it.
 */
export function NotesView({ boardId, focusNote }: { boardId: string; focusNote?: string }) {
  const board = useStore((s) => s.boards[boardId]?.board);
  const tagColors = useStore((s) => currentProject(s)?.project.tagColors);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [cam, setCamState] = useState<Camera>(() => cameras.get(boardId) ?? { x: 40, y: 40, zoom: 1 });
  const camRef = useRef(cam);
  const setCam = (c: Camera) => {
    camRef.current = c;
    cameras.set(boardId, c);
    setCamState(c);
  };
  /** The note open in the editor: an existing one, or a new one not on the board until it's saved. */
  const [editing, setEditing] = useState<{ note: Note; isNew: boolean } | null>(null);
  /** A new note following the pointer, in board coordinates, until a click pins it. */
  const [placing, setPlacing] = useState<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [settings, setSettings] = useState<DOMRect | null>(null);
  const [coloring, setColoring] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  /** The note being dragged and where it is now; written to the board on release. */
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  /** Board coordinates of a point on the screen. */
  const toBoard = (clientX: number, clientY: number) => {
    const r = viewportRef.current!.getBoundingClientRect();
    const c = camRef.current;
    return { x: (clientX - r.left - c.x) / c.zoom, y: (clientY - r.top - c.y) / c.zoom };
  };
  /** Where a new note sits when the pointer is at (clientX, clientY): hanging just below it. */
  const ghostAt = (clientX: number, clientY: number) => {
    const p = toBoard(clientX, clientY);
    return { x: Math.round(p.x - NOTE_WIDTH / 2), y: Math.round(p.y - 14) };
  };

  /** Zooms keeping the board point under (clientX, clientY) where it is. */
  const zoomAt = (zoom: number, clientX?: number, clientY?: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sx = (clientX ?? r.left + r.width / 2) - r.left;
    const sy = (clientY ?? r.top + r.height / 2) - r.top;
    const c = camRef.current;
    const z = clampZoom(zoom);
    setCam({ x: sx - ((sx - c.x) / c.zoom) * z, y: sy - ((sy - c.y) / c.zoom) * z, zoom: z });
  };

  /** Frames every note, zooming out if needed (never in past 100%). */
  const fit = () => {
    const el = viewportRef.current;
    const ns = board?.notes ?? [];
    if (!el || !ns.length) return setCam({ x: 40, y: 40, zoom: 1 });
    const h = (id: string) => (el.querySelector(`[data-note="${id}"]`) as HTMLElement | null)?.offsetHeight ?? 160;
    const minX = Math.min(...ns.map((n) => n.x));
    const minY = Math.min(...ns.map((n) => n.y));
    const maxX = Math.max(...ns.map((n) => n.x + NOTE_WIDTH));
    const maxY = Math.max(...ns.map((n) => n.y + h(n.id)));
    const pad = 48;
    const zoom = clampZoom(
      Math.min(1, (el.clientWidth - pad * 2) / (maxX - minX), (el.clientHeight - pad * 2) / (maxY - minY)),
    );
    setCam({
      x: (el.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (el.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
      zoom,
    });
  };

  // Scrolling moves around the board, Ctrl+scroll (or a pinch) zooms. Not a React handler: it must
  // be able to stop the page from scrolling or zooming.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camRef.current;
      if (e.ctrlKey) return zoomAt(c.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      setCam({ ...c, x: c.x - dx, y: c.y - dy });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // While placing, the new note follows the pointer; Esc gives up.
  useEffect(() => {
    if (!placing) return;
    const move = (e: PointerEvent) => setPlacing(ghostAt(e.clientX, e.clientY));
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPlacing(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", key, true);
    };
  }, [!!placing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from elsewhere (e.g. the Tags view) on one note: bring it into view and open it.
  useLayoutEffect(() => {
    const n = focusNote && board?.notes?.find((x) => x.id === focusNote);
    const el = viewportRef.current;
    if (!n || !el) return;
    const zoom = camRef.current.zoom;
    setCam({ x: el.clientWidth / 2 - (n.x + NOTE_WIDTH / 2) * zoom, y: el.clientHeight / 3 - n.y * zoom, zoom });
    setEditing({ note: n, isNew: false });
  }, [focusNote]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!board?.notes) return null;
  const notes = board.notes;
  const limit = normalizeNoteLimit(board.noteLimit);

  const startNoteDrag = (e: React.PointerEvent, note: Note) => {
    if (
      e.button !== 0 ||
      placing ||
      (e.target as HTMLElement).closest("button, a, input, textarea, .task-label, .issue-chip")
    )
      return;
    e.stopPropagation();
    const start = { px: e.clientX, py: e.clientY };
    const zoom = camRef.current.zoom;
    const at = (ev: PointerEvent) => ({
      x: Math.round(note.x + (ev.clientX - start.px) / zoom),
      y: Math.round(note.y + (ev.clientY - start.py) / zoom),
    });
    let moving = false;
    const move = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - start.px, ev.clientY - start.py) < DRAG_SLOP) return;
      moving = true;
      setDrag({ id: note.id, ...at(ev) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!moving || ev.type === "pointercancel") return;
      const p = at(ev);
      if (p.x !== note.x || p.y !== note.y) updateNote(boardId, note.id, p);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** A press on the grid: pins the note being placed, else starts moving around the board. */
  const onViewportDown = (e: React.PointerEvent) => {
    if (placing) {
      if (e.button !== 0) return setPlacing(null);
      const at = ghostAt(e.clientX, e.clientY);
      setPlacing(null);
      setEditing({ note: { ...newNote(at.x, at.y), color: lastNoteColor(boardId) }, isNew: true });
      return;
    }
    // A press on a note's buttons or links is theirs (dragging the note itself stops here already).
    if ((e.button !== 0 && e.button !== 1) || (e.target as HTMLElement).closest(".note")) return;
    e.preventDefault();
    const start = { px: e.clientX, py: e.clientY, cam: camRef.current };
    setPanning(true);
    const move = (ev: PointerEvent) =>
      setCam({ ...start.cam, x: start.cam.x + ev.clientX - start.px, y: start.cam.y + ev.clientY - start.py });
    const up = () => {
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const save = (f: NoteFields): string | null => {
    if (!editing) return null;
    const { note, isNew } = editing;
    setEditing(null);
    if (f.color !== note.color) rememberNoteColor(boardId, f.color);
    if (isNew) return addNote(boardId, note.x, note.y, f);
    updateNote(boardId, note.id, f);
    return note.id;
  };

  const promotingNote = promoting ? notes.find((n) => n.id === promoting) : undefined;
  const grid = GRID * cam.zoom;

  return (
    <div className="notes-view">
      <div className="board-header">
        <div className="board-title">
          <InlineEdit value={board.name} onSave={(v) => renameBoard(boardId, v)} className="board-name" />
          <InlineEdit
            value={board.description}
            onSave={(v) => updateBoardDescription(boardId, v)}
            placeholder="Add a description…"
            className="board-desc"
          />
        </div>
        <div className="board-tools">
          <span className="board-stats faint small">
            {notes.length} note{notes.length === 1 ? "" : "s"}
          </span>
          <button
            className="icon-btn"
            title="Board settings"
            onClick={(e) => setSettings(e.currentTarget.getBoundingClientRect())}
          >
            <Settings2 size={16} />
          </button>
          <button
            className="icon-btn"
            title="Activity on this board"
            onClick={() => setView({ kind: "activity", boardId })}
          >
            <History size={16} />
          </button>
        </div>
      </div>

      <div className="notes-stage">
        <div
          ref={viewportRef}
          className={cx("notes-viewport", panning && "panning", placing && "placing")}
          style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }}
          onPointerDown={onViewportDown}
          onAuxClick={(e) => e.preventDefault()}
        >
          <div className="notes-world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` }}>
            {notes.map((n) => {
              const at = drag?.id === n.id ? drag : n;
              return (
                <NoteCard
                  key={n.id}
                  note={n}
                  color={noteColor(n, tagColors)}
                  x={at.x}
                  y={at.y}
                  dragging={drag?.id === n.id}
                  onPointerDown={(e) => startNoteDrag(e, n)}
                  onEdit={() => setEditing({ note: n, isNew: false })}
                  onColor={(anchor) => setColoring({ id: n.id, anchor })}
                  onPromote={() => setPromoting(n.id)}
                  onDelete={async () => {
                    const ok = await confirm({
                      title: "Delete this note?",
                      message: `${n.title.trim() ? `“${n.title.trim()}”` : "The note"} will be deleted. You can undo this from Activity.`,
                      confirmLabel: "Delete",
                      danger: true,
                    });
                    if (ok) deleteNote(boardId, n.id);
                  }}
                />
              );
            })}
            {placing && (
              <div
                className="note ghost"
                style={
                  {
                    left: placing.x,
                    top: placing.y,
                    width: NOTE_WIDTH,
                    "--c": noteColor({ color: lastNoteColor(boardId), tags: [] }, tagColors),
                  } as React.CSSProperties
                }
              >
                <div className="note-title">New note</div>
                <div className="note-body faint">Click to pin it here</div>
              </div>
            )}
          </div>
        </div>

        {notes.length === 0 && !placing && (
          <div className="notes-empty">
            <StickyNote size={26} />
            <div>Press + to pin your first note.</div>
          </div>
        )}
        {placing && <div className="notes-hint">Click to pin the note · Esc to cancel</div>}

        <div className="notes-zoom">
          <button
            className="icon-btn small"
            title="Zoom out (Ctrl+scroll)"
            onClick={() => zoomAt(cam.zoom / 1.25)}
            disabled={cam.zoom <= ZOOM_MIN}
          >
            <Minus size={15} />
          </button>
          <button className="notes-zoom-level" title="Back to 100%" onClick={() => zoomAt(1)}>
            {Math.round(cam.zoom * 100)}%
          </button>
          <button
            className="icon-btn small"
            title="Zoom in (Ctrl+scroll)"
            onClick={() => zoomAt(cam.zoom * 1.25)}
            disabled={cam.zoom >= ZOOM_MAX}
          >
            <Plus size={15} />
          </button>
          <span className="notes-zoom-sep" />
          <button className="icon-btn small" title="Show every note" onClick={fit}>
            <Maximize size={14} />
          </button>
        </div>

        <button
          className={cx("notes-fab", placing && "active")}
          title={placing ? "Cancel" : "New note"}
          onClick={(e) => (placing ? setPlacing(null) : setPlacing(ghostAt(e.clientX, e.clientY)))}
        >
          <Plus size={28} strokeWidth={2.4} />
        </button>
      </div>

      {editing && (
        <NoteEditor
          key={editing.note.id}
          note={editing.note}
          isNew={editing.isNew}
          limit={limit}
          onSave={save}
          onCancel={() => setEditing(null)}
          onPromote={(f) => {
            const id = save(f);
            if (id) setPromoting(id);
          }}
          onDelete={() => {
            deleteNote(boardId, editing.note.id);
            setEditing(null);
          }}
        />
      )}
      {coloring && (
        <Popover anchor={coloring.anchor} onClose={() => setColoring(null)}>
          <NoteColorPicker
            note={notes.find((n) => n.id === coloring.id)}
            onChange={(color, done) => {
              updateNote(boardId, coloring.id, { color });
              rememberNoteColor(boardId, color);
              if (done) setColoring(null);
            }}
          />
        </Popover>
      )}
      {promotingNote && (
        <PromoteDialog
          item={asPromotable(promotingNote)}
          noun="note"
          fromBoardId={boardId}
          onPromoted={(keep) => !keep && deleteNote(boardId, promotingNote.id)}
          onClose={() => setPromoting(null)}
        />
      )}
      {settings && (
        <Popover anchor={settings} align="right" onClose={() => setSettings(null)}>
          <NotesSettings limit={limit} onSave={(l) => setNoteLimit(boardId, l)} />
        </Popover>
      )}
    </div>
  );
}

function NoteCard({
  note,
  color,
  x,
  y,
  dragging,
  onPointerDown,
  onEdit,
  onColor,
  onPromote,
  onDelete,
}: {
  note: Note;
  /** What tints the note, as "#rrggbb". */
  color: string;
  x: number;
  y: number;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onEdit: () => void;
  onColor: (anchor: DOMRect) => void;
  onPromote: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-note={note.id}
      className={cx("note", dragging && "dragging")}
      style={{ left: x, top: y, width: NOTE_WIDTH, "--c": color } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      <div className="note-actions">
        <button
          className="icon-btn tiny"
          title="Color"
          onClick={(e) => onColor(e.currentTarget.getBoundingClientRect())}
        >
          <Palette size={12} />
        </button>
        <button className="icon-btn tiny" title="Promote to a task, a step, a decision…" onClick={onPromote}>
          <ArrowUpRight size={12} />
        </button>
        <button className="icon-btn tiny" title="Edit" onClick={onEdit}>
          <Pencil size={12} />
        </button>
        <button className="icon-btn tiny" title="Delete" onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </div>
      {note.title.trim() && <div className="note-title">{note.title}</div>}
      {note.description.trim() ? (
        <Markdown className="note-body">{note.description}</Markdown>
      ) : (
        !note.title.trim() && <div className="note-body faint">Empty note</div>
      )}
      {(note.tags.length > 0 || note.issues.length > 0) && (
        <div className="note-foot">
          {note.tags.map((t) => (
            <TagChip key={t} tag={t} />
          ))}
          {note.issues.map((i) => (
            <IssueChip key={issueKey(i)} issue={i} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Writes a note: changes stay in the editor until Save (Ctrl+Enter). Closing with unsaved changes
 * asks first.
 */
function NoteEditor({
  note,
  isNew,
  limit,
  onSave,
  onCancel,
  onPromote,
  onDelete,
}: {
  note: Note;
  isNew: boolean;
  limit: number;
  onSave: (f: NoteFields) => void;
  onCancel: () => void;
  /** Saves, then promotes the note. */
  onPromote: (f: NoteFields) => void;
  onDelete: () => void;
}) {
  const hasRepos = useStore((s) => (currentProject(s)?.project.repos.length ?? 0) > 0);
  const tagColors = useStore((s) => currentProject(s)?.project.tagColors);
  const [draft, setDraft] = useState<NoteFields>(() => fieldsOf(note));
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">(note.description ? "preview" : "edit");
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const asking = useRef(false);
  const set = (patch: Partial<NoteFields>) => setDraft((d) => ({ ...d, ...patch }));

  const len = noteLength(draft);
  // A note written under a higher limit may stay as long as it is, but not grow.
  const room = isNew ? limit : Math.max(limit, noteLength(note));
  const fits = len <= room;
  const blank = isBlankNote({ ...note, ...draft });
  const dirty = JSON.stringify(draft) !== JSON.stringify(fieldsOf(note));
  const canSave = fits && !blank && (dirty || isNew);

  const close = async () => {
    if (asking.current) return;
    if (dirty && !blank) {
      asking.current = true;
      const ok = await confirm({
        title: "Discard your changes?",
        message: "What you wrote in this note will be lost.",
        confirmLabel: "Discard",
        danger: true,
      });
      asking.current = false;
      if (!ok) return;
    }
    onCancel();
  };
  const save = () => canSave && onSave(draft);

  const linkIssue = (i: GhIssue) => {
    if (!draft.issues.some((x) => x.repo === i.repo && x.number === i.number))
      set({ issues: [...draft.issues, { repo: i.repo, number: i.number }] });
    setPicker(null);
  };

  return (
    <Modal onClose={close} width={560} className="note-dialog">
      <div
        className="note-dialog-body"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <div className="note-dialog-top">
          <button
            className="note-color-btn"
            style={{ background: noteColor(draft, tagColors) }}
            title={draft.color ? "Color" : "Color (following the first tag)"}
            onClick={(e) => setColorAnchor(e.currentTarget.getBoundingClientRect())}
          />
          <input
            autoFocus={!note.title && !note.description}
            className="note-dialog-title"
            value={draft.title}
            placeholder={isNew ? "New note" : "Title"}
            onChange={(e) => set({ title: e.target.value.replace(/\n/g, " ") })}
          />
          <button className="icon-btn" onClick={close} aria-label="Close" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="section-head">
          <span>Description</span>
          <div className="segmented tiny">
            <button className={cx(mode === "edit" && "active")} onClick={() => setMode("edit")}>
              Write
            </button>
            <button className={cx(mode === "preview" && "active")} onClick={() => setMode("preview")}>
              Preview
            </button>
          </div>
        </div>
        {mode === "edit" ? (
          <AutoTextarea
            className="note-dialog-desc"
            value={draft.description}
            placeholder="Write the note… Markdown supported."
            onChange={(e) => set({ description: e.target.value })}
          />
        ) : draft.description ? (
          <div className="desc-preview" onDoubleClick={() => setMode("edit")}>
            <Markdown>{draft.description}</Markdown>
          </div>
        ) : (
          <button className="desc-empty" onClick={() => setMode("edit")}>
            Add a description…
          </button>
        )}
        <div className={cx("decision-counter", "note-counter", !fits && "over")}>
          <div className="progress-bar">
            <span style={{ width: `${Math.min(100, (len / limit) * 100)}%` }} />
          </div>
          <span title="Characters in the title and description, and this board's limit">
            {len}/{limit}
          </span>
        </div>
        {!fits && (
          <div className="field-error">
            {room > limit
              ? `This note was written under a higher limit. It can stay as it is, but it can't grow: keep it to at most ${room} characters.`
              : `${len - limit} character${len - limit === 1 ? "" : "s"} over this board's limit.`}
          </div>
        )}

        <div className="field">
          <span className="note-dialog-label">Tags</span>
          <TagInput
            tags={draft.tags}
            onAdd={(t) => set({ tags: [...draft.tags, t] })}
            onRemove={(t) => set({ tags: draft.tags.filter((x) => x !== t) })}
          />
        </div>

        <div className="field">
          <span className="note-dialog-label">GitHub issues</span>
          <div className="note-dialog-issues">
            {draft.issues.map((i) => (
              <IssueChip
                key={issueKey(i)}
                issue={i}
                onRemove={() => set({ issues: draft.issues.filter((x) => issueKey(x) !== issueKey(i)) })}
              />
            ))}
            {hasRepos ? (
              <button className="btn ghost small" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}>
                <Link2 size={13} /> Link issue
              </button>
            ) : (
              !draft.issues.length && (
                <span className="faint small">Add a GitHub repository to the project to link its issues.</span>
              )
            )}
          </div>
        </div>

        <div className="note-dialog-foot">
          {!isNew && (
            <>
              <button
                className="btn danger-ghost small"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Delete this note?",
                    message: "You can undo this from Activity.",
                    confirmLabel: "Delete",
                    danger: true,
                  });
                  if (ok) onDelete();
                }}
              >
                <Trash2 size={13} /> Delete
              </button>
              <button
                className="btn ghost small"
                disabled={!fits || blank}
                onClick={() => onPromote(draft)}
                title={
                  dirty
                    ? "Save, then turn this note into a task, a plan step, a decision…"
                    : "Turn this note into a task, a plan step, a decision…"
                }
              >
                <ArrowUpRight size={13} /> Promote…
              </button>
            </>
          )}
          <span className="spacer" />
          <span className="faint small note-dialog-meta">
            {isNew ? `${MOD_KEY}+Enter saves` : `Updated ${relativeTime(note.updatedAt)}`}
          </span>
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!canSave}>
            {isNew ? "Pin note" : "Save"}
          </button>
        </div>
      </div>
      {picker && (
        <Popover anchor={picker} align="left" onClose={() => setPicker(null)}>
          <IssuePicker onPick={linkIssue} />
        </Popover>
      )}
      {colorAnchor && (
        <Popover anchor={colorAnchor} onClose={() => setColorAnchor(null)}>
          <NoteColorPicker
            note={draft}
            onChange={(color, done) => {
              set({ color });
              if (done) setColorAnchor(null);
            }}
          />
        </Popover>
      )}
    </Modal>
  );
}

/** The color picker, plus a way back to following the first tag. */
function NoteColorPicker({
  note,
  onChange,
}: {
  note: Pick<Note, "color" | "tags"> | undefined;
  onChange: (c: Color | null, done: boolean) => void;
}) {
  const tagColors = useStore((s) => currentProject(s)?.project.tagColors);
  if (!note) return null;
  return (
    <div className="popover-pad tag-menu">
      <ColorPicker value={note.color ?? noteColor(note, tagColors)} onChange={onChange} />
      {note.color && (
        <button className="btn ghost small full" onClick={() => onChange(null, true)}>
          {note.tags.length ? `Follow the tag “${note.tags[0]}”` : "Back to plain yellow"}
        </button>
      )}
    </div>
  );
}

function NotesSettings({ limit, onSave }: { limit: number; onSave: (limit: number) => void }) {
  const [input, setInput] = useState(String(limit));
  const n = /^\d+$/.test(input.trim()) ? Number(input.trim()) : NaN;
  const valid = Number.isInteger(n) && n >= NOTE_LIMIT_MIN && n <= NOTE_LIMIT_MAX;
  useEffect(() => setInput(String(limit)), [limit]);
  return (
    <form
      className="popover-pad notes-settings"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(n);
      }}
    >
      <label className="field">
        <span>
          Note length limit <em className="faint">— characters for a note's title and description together</em>
        </span>
        <input
          className="limit-input"
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => valid && n !== limit && onSave(n)}
        />
      </label>
      {!valid && (
        <div className="field-error">
          Between {NOTE_LIMIT_MIN} and {NOTE_LIMIT_MAX}.
        </div>
      )}
      <div className="faint small">Notes already longer stay as they are, but can't grow.</div>
    </form>
  );
}

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [props.value]);
  return <textarea ref={ref} rows={3} {...props} />;
}
