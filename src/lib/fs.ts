import { invoke } from "@tauri-apps/api/core";

export interface DirEntry {
  name: string;
  is_dir: boolean;
}

export function join(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter(Boolean)
    .join("/");
}

/** Normalizes separators so paths from the watcher compare equal to paths we build. */
export const normPath = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export const readText = (path: string) => invoke<string | null>("read_text", { path });
export const writeText = (path: string, contents: string) => invoke<void>("write_text", { path, contents });
export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });
export const removePath = (path: string) => invoke<void>("remove_path", { path });
export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });

export async function readJson<T>(path: string): Promise<T | null> {
  const text = await readText(path);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    console.error(`Invalid JSON in ${path}`, e);
    return null;
  }
}

export const toJson = (data: unknown) => JSON.stringify(data, null, 2) + "\n";

// ---- Self-write tracking ---------------------------------------------------------------
// The vault watcher reports every change, including our own. We remember the last content we
// wrote per file so external edits (Claude via MCP, a text editor, a sync tool) can be told
// apart from echoes of our own writes.

const lastWritten = new Map<string, string>();

export function isOwnWrite(path: string, content: string | null): boolean {
  return lastWritten.get(normPath(path)) === content;
}

// ---- Debounced, per-file serialized writes -------------------------------------------
// Rapid edits (e.g. dragging cards around) collapse into a single write, and writes to the
// same file never overlap.

const pending = new Map<string, { timer: number; data: unknown }>();
const chains = new Map<string, Promise<void>>();
let onError: (path: string, e: unknown) => void = (p, e) => console.error("write failed", p, e);

export function setWriteErrorHandler(fn: typeof onError) {
  onError = fn;
}

function enqueue(path: string, data: unknown): Promise<void> {
  const text = toJson(data);
  lastWritten.set(normPath(path), text);
  const prev = chains.get(path) ?? Promise.resolve();
  const next = prev.then(() => writeText(path, text)).catch((e) => onError(path, e));
  chains.set(path, next);
  return next;
}

export function scheduleWrite(path: string, data: unknown, delay = 250) {
  const existing = pending.get(path);
  if (existing) clearTimeout(existing.timer);
  const timer = window.setTimeout(() => {
    pending.delete(path);
    enqueue(path, data);
  }, delay);
  pending.set(path, { timer, data });
}

export function hasPendingWrite(path: string) {
  return pending.has(path);
}

export async function writeNow(path: string, data: unknown) {
  cancelWrites(path);
  await enqueue(path, data);
}

/** Drops pending writes for a path, or for everything under it when it is a folder. */
export function cancelWrites(prefix: string) {
  for (const [path, p] of pending) {
    if (path === prefix || path.startsWith(prefix + "/")) {
      clearTimeout(p.timer);
      pending.delete(path);
    }
  }
}

export async function flushWrites() {
  for (const [path, p] of [...pending.entries()]) {
    clearTimeout(p.timer);
    pending.delete(path);
    enqueue(path, p.data);
  }
  await Promise.all([...chains.values()]);
}
