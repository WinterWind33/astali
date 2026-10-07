import { useSyncExternalStore } from "react";
import { type Season, seasonOn } from "./season";
import { useStore } from "./store";

const query = window.matchMedia("(prefers-color-scheme: dark)");

function subscribe(onChange: () => void) {
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The OS color scheme, kept up to date when the user switches it while the app runs. */
export const useSystemTheme = () => useSyncExternalStore(subscribe, () => (query.matches ? "dark" : "light"));

/** The theme actually applied: the user's choice, or the OS scheme when set to "system". */
export function useResolvedTheme(): "dark" | "light" {
  const theme = useStore((s) => s.config.theme);
  const system = useSystemTheme();
  return theme === "system" ? system : theme;
}

// The date is checked every minute and on focus, so a season starts or ends while the app stays open.
function subscribeClock(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  window.addEventListener("focus", onChange);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", onChange);
  };
}

/** Today's holiday, or null when seasonal themes are off or it's an ordinary day. */
export function useSeason(): Season | null {
  const enabled = useStore((s) => s.config.seasonalThemes);
  const season = useSyncExternalStore(subscribeClock, () => seasonOn(new Date()));
  // DEV is a build-time constant, so the hook order never changes and release builds drop the override.
  const override = import.meta.env.DEV ? useSeasonOverride() : "auto";
  if (override !== "auto") return override === "none" ? null : override;
  return enabled ? season : null;
}

/* Dev builds only: force a season whatever the date or the setting, to work on the palettes.
   Kept in localStorage rather than the config, so it never reaches a real settings file. */

export type SeasonOverride = "auto" | "none" | Season;

const OVERRIDE_KEY = "astali.dev.season";
const overrideListeners = new Set<() => void>();

function readOverride(): SeasonOverride {
  try {
    return (localStorage.getItem(OVERRIDE_KEY) as SeasonOverride | null) ?? "auto";
  } catch {
    return "auto";
  }
}

export function setSeasonOverride(value: SeasonOverride) {
  try {
    if (value === "auto") localStorage.removeItem(OVERRIDE_KEY);
    else localStorage.setItem(OVERRIDE_KEY, value);
  } catch {
    // Storage blocked: the override just won't stick.
  }
  overrideListeners.forEach((f) => f());
}

function subscribeOverride(onChange: () => void) {
  overrideListeners.add(onChange);
  return () => overrideListeners.delete(onChange);
}

export const useSeasonOverride = () => useSyncExternalStore(subscribeOverride, readOverride);
