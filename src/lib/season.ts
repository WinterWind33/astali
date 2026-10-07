/** A holiday theme that recolors the app on top of dark or light. */
export type Season = "halloween" | "christmas" | "easter";

export const SEASON_LABEL: Record<Season, string> = {
  halloween: "Halloween",
  christmas: "Christmas",
  easter: "Easter",
};

/** Western Easter Sunday of the given year (anonymous Gregorian computus). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const DAY = 24 * 60 * 60 * 1000;

/** The holiday a local date falls in: all of October, all of December, Palm Sunday to Easter Monday. */
export function seasonOn(date: Date): Season | null {
  const month = date.getMonth();
  if (month === 9) return "halloween";
  if (month === 11) return "christmas";
  const today = new Date(date.getFullYear(), month, date.getDate());
  // Rounded, so a daylight-saving change in between doesn't shift the window by an hour.
  const fromEaster = Math.round((today.getTime() - easterSunday(date.getFullYear()).getTime()) / DAY);
  if (fromEaster >= -7 && fromEaster <= 1) return "easter";
  return null;
}
