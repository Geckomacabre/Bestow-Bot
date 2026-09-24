/** Colour parsing, conversion, palettes and gradients (pure). */

export interface RGB { r: number; g: number; b: number }
export class ColorError extends Error {}

const NAMED: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', lime: '00ff00', green: '008000', blue: '0000ff', yellow: 'ffff00', cyan: '00ffff', aqua: '00ffff', magenta: 'ff00ff', fuchsia: 'ff00ff',
  gray: '808080', grey: '808080', silver: 'c0c0c0', maroon: '800000', olive: '808000', purple: '800080', teal: '008080', navy: '000080', orange: 'ffa500', pink: 'ffc0cb', hotpink: 'ff69b4',
  gold: 'ffd700', brown: 'a52a2a', coral: 'ff7f50', crimson: 'dc143c', indigo: '4b0082', violet: 'ee82ee', turquoise: '40e0d0', salmon: 'fa8072', khaki: 'f0e68c', lavender: 'e6e6fa',
  beige: 'f5f5dc', tan: 'd2b48c', skyblue: '87ceeb', royalblue: '4169e1', tomato: 'ff6347', orchid: 'da70d6', chocolate: 'd2691e', slategray: '708090', blurple: '5865f2',
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
export const toHex = ({ r, g, b }: RGB) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function parseColor(input: string): RGB {
  const s = input.trim().toLowerCase().replace(/^#/, '#');
  let m: RegExpExecArray | null;
  if ((m = /^#?([0-9a-f]{6})$/.exec(s))) { const n = parseInt(m[1]!, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
  if ((m = /^#?([0-9a-f]{3})$/.exec(s))) { const [r, g, b] = [...m[1]!].map(c => parseInt(c + c, 16)); return { r: r!, g: g!, b: b! }; }
  if ((m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(s))) {
    const [r, g, b] = [m[1]!, m[2]!, m[3]!].map(Number);
    if ([r, g, b].some(v => v! > 255)) throw new ColorError('RGB values go from 0 to 255.');
    return { r: r!, g: g!, b: b! };
  }
  if ((m = /^hsla?\(\s*(-?[\d.]+)\s*(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(s))) return hslToRgb({ h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) });
  if ((m = /^(\d{1,8})$/.exec(s)) && Number(m[1]) <= 0xffffff) { const n = Number(m[1]); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; } // Discord-style decimal colour
  const key = s.replace(/[\s_-]/g, '');
  if (Object.hasOwn(NAMED, key)) return parseColor(NAMED[key]!);
  throw new ColorError('I couldn\'t read that colour. Try a hex code (`#ff6b6b`), `rgb(255,107,107)`, `hsl(0,100%,71%)` or a name like `coral`.');
}

export interface HSL { h: number; s: number; l: number }
export function rgbToHsl({ r, g, b }: RGB): HSL {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6; else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export function hslToRgb({ h, s, l }: HSL): RGB {
  const H = ((h % 360) + 360) % 360, S = clamp(s, 0, 100) / 100, L = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((H / 60) % 2) - 1)), m = L - c / 2;
  const [r, g, b] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r! + m) * 255), g: Math.round((g! + m) * 255), b: Math.round((b! + m) * 255) };
}
export function rgbToCmyk({ r, g, b }: RGB) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const k = 1 - Math.max(R, G, B);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return { c: Math.round(((1 - R - k) / (1 - k)) * 100), m: Math.round(((1 - G - k) / (1 - k)) * 100), y: Math.round(((1 - B - k) / (1 - k)) * 100), k: Math.round(k * 100) };
}

/** WCAG relative luminance and contrast ratio. */
export function luminance({ r, g, b }: RGB): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
export const readableOn = (bg: RGB): 'black' | 'white' => (contrast(bg, { r: 0, g: 0, b: 0 }) >= contrast(bg, { r: 255, g: 255, b: 255 }) ? 'black' : 'white');

export type Scheme = 'complementary' | 'triadic' | 'analogous' | 'split-complementary' | 'tetradic' | 'monochrome';
export function palette(c: RGB, scheme: Scheme): RGB[] {
  const { h, s, l } = rgbToHsl(c);
  const rot = (d: number) => hslToRgb({ h: h + d, s, l });
  switch (scheme) {
    case 'complementary': return [c, rot(180)];
    case 'triadic': return [c, rot(120), rot(240)];
    case 'analogous': return [rot(-30), c, rot(30)];
    case 'split-complementary': return [c, rot(150), rot(210)];
    case 'tetradic': return [c, rot(90), rot(180), rot(270)];
    case 'monochrome': return [15, 30, 50, 70, 85].map(ll => hslToRgb({ h, s, l: ll }));
  }
}

/** `steps` colours from a to b inclusive (linear interpolation in RGB). */
export function gradient(a: RGB, b: RGB, steps: number): RGB[] {
  const n = clamp(Math.round(steps), 2, 30);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) };
  });
}
export const toDecimal = ({ r, g, b }: RGB) => (r << 16) | (g << 8) | b;
