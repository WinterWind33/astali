/** Color math for the custom color picker. Hex strings are always normalized to "#rrggbb". */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** h in [0, 360), s and v in [0, 100]. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Accepts "#rgb", "#rrggbb", with or without "#"; returns "#rrggbb" or null. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/.test(s) ? "#" + s : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt((normalizeHex(hex) ?? "#000000").slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return (
    "#" +
    [r, g, b]
      .map((x) =>
        Math.round(clamp(x, 0, 255))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? (d / max) * 100 : 0, v: max * 100 };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const sn = clamp(s, 0, 100) / 100,
    vn = clamp(v, 0, 100) / 100;
  const c = vn * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = vn - c;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export const hexToHsv = (hex: string) => rgbToHsv(hexToRgb(hex));
export const hsvToHex = (hsv: Hsv) => rgbToHex(hsvToRgb(hsv));

/** Black or white, whichever reads better on top of `hex`. */
export function contrastText(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.179 ? "#111111" : "#ffffff";
}

/** h in [0, 360), s and l in [0, 100]. */
export function hslToHex(h: number, s: number, l: number): string {
  const sn = clamp(s, 0, 100) / 100,
    ln = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
}
