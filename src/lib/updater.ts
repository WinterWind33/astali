import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { RELEASES } from "./changelog";
import { flushWrites } from "./fs";
import { toast, useStore } from "./store";

/**
 * Updates come from the public repo's latest release (`plugins.updater` in tauri.conf.json, D-10).
 * Astali only checks on its own; downloading and restarting wait for the user's click.
 */

interface UpdateState {
  /** The newer version found, if any. */
  available: string | null;
  /** The update's notes: changelog sections ("## [x.y.z] - date"), or plain Markdown. */
  notes: string | null;
  /** Set while the update downloads and installs: 0 to 1, or null when the size isn't known. */
  progress: number | null;
  installing: boolean;
  checking: boolean;
  /** Whether this copy updates itself; null until known. */
  supported: boolean | null;
}

export const useUpdate = create<UpdateState>(() => ({
  available: null,
  notes: null,
  progress: null,
  installing: false,
  checking: false,
  supported: null,
}));
const set = useUpdate.setState;

/** Downloads and installs the update found, reporting bytes received of the total (null if unknown). */
type Installer = (onProgress: (done: number, total: number | null) => void) => Promise<void>;
let install: Installer | null = null;
let restart: () => Promise<void> = relaunch;

/** Whether this copy updates itself (not a Linux .deb or .rpm, nor a dev build, which would update the installed app). */
async function supported() {
  if (import.meta.env.DEV) return false;
  return invoke<boolean>("updates_supported").catch(() => false);
}

supported().then((s) => set({ supported: s }));

/**
 * Asks the public repo whether a newer version exists. At startup it stays quiet when it can't tell
 * (offline, no release yet); a check from Settings says what happened.
 */
export async function checkForUpdate(manual = false) {
  if (useUpdate.getState().checking || useUpdate.getState().installing) return;
  if (!(await supported())) {
    if (manual)
      toast(
        import.meta.env.DEV
          ? "Dev builds don't check for updates: use the dev buttons to fake one."
          : "This copy of Astali is updated by your package manager.",
      );
    return;
  }
  set({ checking: true });
  try {
    const update = await check();
    if (!update) {
      if (manual) toast("You're on the latest version of Astali.", "success");
      return;
    }
    install = (onProgress) => {
      let done = 0;
      let total: number | null = null;
      return update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? null;
        else if (e.event === "Progress") onProgress((done += e.data.chunkLength), total);
      });
    };
    restart = relaunch;
    set({ available: update.version, notes: update.body?.trim() || null });
    if (manual) toast(`Astali ${update.version} is available.`, "success");
  } catch (e) {
    console.error("update check failed", e);
    if (manual) toast(`Couldn't check for updates: ${e}`, "error");
  } finally {
    set({ checking: false });
  }
}

/** The startup check, unless turned off in Settings. */
export function checkForUpdateOnStartup() {
  if (useStore.getState().config.checkForUpdates) checkForUpdate();
}

/** Downloads and installs the update, saving pending changes first, then restarts Astali. */
export async function installUpdate() {
  const { available, installing } = useUpdate.getState();
  if (!available || !install || installing) return;
  set({ installing: true, progress: 0 });
  try {
    await flushWrites();
    await install((done, total) => set({ progress: total ? Math.min(done / total, 1) : null }));
    await restart();
  } catch (e) {
    console.error("update failed", e);
    toast(`The update couldn't be installed: ${e}`, "error");
    set({ installing: false, progress: null });
  }
}

/** Dev builds only: offers a pretend update that downloads in a few seconds, or fails halfway. */
export function fakeUpdate(fail = false) {
  install = (onProgress) =>
    new Promise((resolve, reject) => {
      const total = 8_000_000;
      let done = 0;
      const timer = setInterval(() => {
        done += 400_000;
        onProgress(done, total);
        if (fail && done >= total / 2) {
          clearInterval(timer);
          reject("fake failure halfway through the download");
        } else if (done >= total) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  restart = async () => {
    toast("Fake update installed. A real one would restart Astali now.", "success");
    set({ available: null, notes: null, installing: false, progress: null });
  };
  // The notes a release would carry: this build's unreleased changes, as 9.9.9.
  const next = RELEASES.find((r) => r.version === "Unreleased");
  const notes = next ? `## [9.9.9] - ${new Date().toISOString().slice(0, 10)}\n\n${next.body}` : null;
  set({ available: "9.9.9", notes, installing: false, progress: null });
}
