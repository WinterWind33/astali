import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitPullRequest,
  Info,
  MessageSquare,
  X,
} from "lucide-react";
import {
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { create } from "zustand";
import { currentProject, setView, useStore } from "../lib/store";
import { tagColor } from "../lib/tags";
import type { GhIssue, GhLabel } from "../lib/types";
import { cx, relativeTime } from "../lib/util";

// ---------------------------------------------------------------- Modal

export function Modal({
  onClose,
  children,
  width = 520,
  className,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A popover or tag suggestions open over the dialog take the Esc first.
      if (e.key === "Escape" && !document.querySelector(".popover, .tag-suggest")) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("modal", className)} style={{ width }} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        <X size={18} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Confirm (promise based)

interface ConfirmReq {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ req: ConfirmReq | null }>(() => ({ req: null }));

export function confirm(opts: Omit<ConfirmReq, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ req: { ...opts, resolve } }));
}

export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req);
  if (!req) return null;
  const done = (ok: boolean) => {
    req.resolve(ok);
    useConfirmStore.setState({ req: null });
  };
  return (
    <Modal onClose={() => done(false)} width={420}>
      <div className="confirm">
        <h2>{req.title}</h2>
        {req.message && <div className="muted">{req.message}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => done(false)}>
            Cancel
          </button>
          <button className={cx("btn", req.danger ? "danger" : "primary")} autoFocus onClick={() => done(true)}>
            {req.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Menu (dropdown)

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hint?: string;
  title?: string;
}

export function Menu({
  trigger,
  items,
  align = "left",
}: {
  trigger: (props: { onClick: (e: React.MouseEvent) => void; "aria-expanded": boolean }) => ReactNode;
  items: (MenuItem | "divider")[];
  align?: "left" | "right";
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      {trigger({
        onClick: (e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect());
        },
        "aria-expanded": !!anchor,
      })}
      {anchor && (
        <Popover anchor={anchor} align={align} onClose={() => setAnchor(null)}>
          <div className="menu">
            {items.map((it, i) =>
              it === "divider" ? (
                <div key={i} className="menu-divider" />
              ) : (
                <button
                  key={i}
                  className={cx("menu-item", it.danger && "danger")}
                  title={it.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAnchor(null);
                    it.onClick();
                  }}
                >
                  {it.icon}
                  <span>{it.label}</span>
                  {it.hint && <kbd>{it.hint}</kbd>}
                </button>
              ),
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Fixed-position layer anchored to a rect; flips/clamps to stay on screen. */
export function Popover({
  anchor,
  align = "left",
  onClose,
  children,
}: {
  anchor: DOMRect;
  align?: "left" | "right";
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchor.bottom + 6, left: anchor.left, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      let left = align === "right" ? anchor.right - r.width : anchor.left;
      let top = anchor.bottom + 6;
      if (top + r.height > window.innerHeight - 8) top = Math.max(8, anchor.top - r.height - 6);
      left = Math.min(Math.max(8, left), window.innerWidth - r.width - 8);
      setPos({ top, left, visible: true });
    };
    place();
    // Content can grow after opening (e.g. the custom color editor); keep it on screen.
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, align]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="popover"
      style={{ top: pos.top, left: pos.left, opacity: pos.visible ? 1 : 0 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- Inline edit

export function InlineEdit({
  value,
  onSave,
  className,
  placeholder,
  editing: editingProp,
  onEditingChange,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
  editing?: boolean;
  onEditingChange?: (e: boolean) => void;
}) {
  const [editingState, setEditingState] = useState(false);
  const editing = editingProp ?? editingState;
  const setEditing = (e: boolean) => (onEditingChange ? onEditingChange(e) : setEditingState(e));
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (editing) setDraft(value);
  }, [editing, value]);

  if (!editing) {
    return (
      <span
        className={cx("inline-edit", className)}
        onDoubleClick={() => setEditing(true)}
        title="Double-click to rename"
      >
        {value || <span className="muted">{placeholder}</span>}
      </span>
    );
  }
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
  };
  return (
    <input
      className={cx("inline-edit-input", className)}
      value={draft}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: ReactKeyboardEvent) => {
        // Keys stay in the field: inside a sortable handle (a column head), Enter or Space would start a keyboard drag.
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

// ---------------------------------------------------------------- Markdown

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cx("markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // GitHub issue bodies mix in raw HTML; render it, but sanitized (no scripts, no handlers).
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) openUrl(href);
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------- GitHub bits

export function IssueStateIcon({
  issue,
  size = 15,
}: {
  issue: Pick<GhIssue, "state" | "isPullRequest" | "stateReason">;
  size?: number;
}) {
  if (issue.isPullRequest) return <GitPullRequest size={size} className={cx("issue-icon", issue.state)} />;
  if (issue.state === "closed")
    return (
      <CheckCircle2
        size={size}
        className={cx("issue-icon", issue.stateReason === "not_planned" ? "not-planned" : "closed")}
      />
    );
  return <CircleDot size={size} className="issue-icon open" />;
}

/**
 * A label of a GitHub repository, in GitHub's style (a bordered pill with the GitHub mark) so it
 * never passes for one of the project's own tags. With `repo`, clicking it lists everything
 * carrying the label in the Tags view.
 */
export function GhLabelChip({ label, repo }: { label: GhLabel; repo?: string }) {
  const style = { "--c": `#${label.color}` } as React.CSSProperties;
  const title = `GitHub label${repo ? ` of ${repo}` : ""}${label.description ? ` — ${label.description}` : ""}`;
  if (!repo)
    return (
      <span className="gh-label" style={style} title={title}>
        <Github size={9} className="gh-label-mark" />
        {label.name}
      </span>
    );
  return (
    <button
      type="button"
      className="gh-label clickable"
      style={style}
      title={`${title}
Click to see everything labeled “${label.name}”`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        setView({ kind: "tags", tag: { kind: "label", repo, name: label.name } });
      }}
    >
      <Github size={9} className="gh-label-mark" />
      {label.name}
    </button>
  );
}

/** The current project's color for a tag, as "#rrggbb". */
export function useTagColor(tag: string) {
  return useStore((s) => tagColor(tag, currentProject(s)?.project.tagColors));
}

/**
 * One of the project's own task tags, in the tag's color. Clicking it runs `onClick`, or by default
 * opens the Tags view on it; `onRemove` adds a remove button.
 */
export function TagChip({
  tag,
  onClick,
  onRemove,
  title,
}: {
  tag: string;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onRemove?: () => void;
  title?: string;
}) {
  const color = useTagColor(tag);
  return (
    <span
      className={cx("task-label", onRemove && "removable")}
      style={{ "--c": color } as React.CSSProperties}
      title={title ?? `Tag — click to see every task tagged “${tag}”`}
      role="button"
      tabIndex={-1}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick(e);
        else setView({ kind: "tags", tag: { kind: "tag", name: tag } });
      }}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${tag}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={11} />
        </button>
      )}
    </span>
  );
}

/** A cached issue's header, labels and body, with a button to open it on GitHub. */
export function IssuePanel({ issue }: { issue: GhIssue }) {
  return (
    <div className="issue-panel">
      <div className="issue-panel-head">
        <IssueStateIcon issue={issue} size={18} />
        <div className="issue-panel-title">
          <div>
            {issue.title} <span className="faint">#{issue.number}</span>
          </div>
          <div className="faint small">
            {issue.repo} · opened by {issue.author} {relativeTime(issue.createdAt)}
            {issue.comments > 0 && (
              <>
                {" "}
                · <MessageSquare size={11} /> {issue.comments}
              </>
            )}
            {issue.milestone && <> · milestone {issue.milestone}</>}
          </div>
        </div>
        <button className="btn small" onClick={() => openUrl(issue.url)}>
          <ExternalLink size={13} /> Open
        </button>
      </div>
      {issue.labels.length > 0 && (
        <div className="issue-labels">
          {issue.labels.map((l) => (
            <GhLabelChip key={l.name} label={l} repo={issue.repo} />
          ))}
        </div>
      )}
      {issue.body ? (
        <Markdown className="issue-body">{issue.body}</Markdown>
      ) : (
        <p className="faint small">No description provided.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Toasts

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={cx("toast", t.kind)}>
          {t.kind === "error" ? (
            <AlertCircle size={16} />
          ) : t.kind === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <Info size={16} />
          )}
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- misc

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** The app icon (src-tauri/icons/app-icon.svg): an "A" drawn by a pencil, with a tick for its crossbar, a note and a planner,
 *  in the theme's colors. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <defs>
        {/* In user space, so the outlines below match the tile behind them. */}
        <linearGradient id="logo-g" gradientUnits="userSpaceOnUse" x1="64" y1="64" x2="960" y2="960">
          <stop offset="0" style={{ stopColor: "var(--logo-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--logo-b)" }} />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="220" fill="url(#logo-g)" />
      <g transform="translate(26 8)">
        <path d="M388 680 L512 380" stroke="#fff" strokeWidth="46" strokeLinecap="round" />
        <g transform="translate(512 380) rotate(-22.46)">
          <rect x="-31" y="-30" width="62" height="371" rx="8" fill="#fff" />
          <rect x="8" y="-30" width="23" height="371" fill="#e4e4e7" />
          <rect x="-31" y="16" width="62" height="22" fill="#d4d4d8" />
          <path d="M-31 341 L0 416 L31 341Z" fill="#f4f4f5" />
          <path d="M-10.5 390 L0 416 L10.5 390Z" fill="#a1a1aa" />
        </g>
        <path
          d="M464 572 L498 606 L553 541"
          fill="none"
          stroke="#d4d4d8"
          strokeWidth="38"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g transform="translate(512 296) rotate(4)">
          <path
            d="M-57 -75 H57 Q75 -75 75 -57 V33 L33 75 H-57 Q-75 75 -75 57 V-57 Q-75 -75 -57 -75Z"
            fill="#fff"
            stroke="url(#logo-g)"
            strokeWidth="16"
            strokeLinejoin="round"
          />
          <path d="M33 75 V47 Q33 33 47 33 H75Z" fill="#d4d4d8" />
        </g>
        <g transform="translate(352 706) rotate(-6)">
          <rect
            x="-70"
            y="-80"
            width="140"
            height="160"
            rx="20"
            fill="#fff"
            stroke="url(#logo-g)"
            strokeWidth="16"
            strokeLinejoin="round"
          />
          <rect x="-62" y="-72" width="22" height="144" rx="10" fill="#e4e4e7" />
          <g fill="#d4d4d8" stroke="url(#logo-g)" strokeWidth="8">
            <rect x="-37" y="-102" width="18" height="46" rx="9" />
            <rect x="-9" y="-102" width="18" height="46" rx="9" />
            <rect x="19" y="-102" width="18" height="46" rx="9" />
          </g>
        </g>
      </g>
    </svg>
  );
}

/** GitHub mark (lucide no longer ships brand icons). Sized and colored like a lucide icon. */
export function Github({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
