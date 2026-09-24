import figlet from 'figlet';
import { getJson } from '../framework/http.js';
import { LookupError } from './handler.js';
import { rand, randInt } from '../utils/random.js';

// ─── Markov chain ────────────────────────────────────────────────────────────

export function markov(input: string, words = 40, order = 2, r: () => number = rand): string {
  const toks = input.split(/\s+/).filter(Boolean);
  if (toks.length < 4) throw new LookupError('Give me at least a few words to learn from (a sentence or two).');
  const n = toks.length >= 12 ? order : 1;
  const table = new Map<string, string[]>();
  for (let i = 0; i < toks.length - n; i++) {
    const key = toks.slice(i, i + n).join(' ');
    table.set(key, [...(table.get(key) ?? []), toks[i + n]!]);
  }
  const keys = [...table.keys()];
  let state = keys[Math.floor(r() * keys.length)]!.split(' ');
  const out = [...state];
  while (out.length < words) {
    const next = table.get(state.join(' '));
    if (!next) { state = keys[Math.floor(r() * keys.length)]!.split(' '); continue; }
    const w = next[Math.floor(r() * next.length)]!;
    out.push(w);
    state = [...state.slice(1), w];
  }
  return out.slice(0, words).join(' ');
}

// ─── Bad translate ───────────────────────────────────────────────────────────

export const LANGS: Record<string, string> = {
  af: 'Afrikaans', ar: 'Arabic', bg: 'Bulgarian', ca: 'Catalan', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', es: 'Spanish', et: 'Estonian', fi: 'Finnish', fr: 'French',
  hi: 'Hindi', hu: 'Hungarian', id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', la: 'Latin', nl: 'Dutch', no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian',
  ru: 'Russian', sk: 'Slovak', sv: 'Swedish', sw: 'Swahili', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese', 'zh-CN': 'Chinese', cy: 'Welsh', eo: 'Esperanto', is: 'Icelandic',
};

export async function gtranslate(text: string, to: string, from = 'auto'): Promise<{ text: string; detected: string }> {
  const r = await getJson<[[string, string][], unknown, string]>(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`, { timeoutMs: 15_000 });
  const out = (r[0] ?? []).map(seg => seg[0]).join('');
  if (!out) throw new LookupError('The translator returned nothing.');
  return { text: out, detected: r[2] };
}

export function pickChain(count: number, r: () => number = rand): string[] {
  const codes = Object.keys(LANGS).filter(c => c !== 'en');
  const chain: string[] = [];
  while (chain.length < Math.min(count, codes.length)) {
    const c = codes[Math.floor(r() * codes.length)]!;
    if (!chain.includes(c)) chain.push(c);
  }
  return chain;
}

export async function badTranslate(text: string, chain: string[]): Promise<{ steps: { lang: string; text: string }[]; final: string }> {
  let cur = text;
  const steps: { lang: string; text: string }[] = [];
  for (const lang of [...chain, 'en']) {
    cur = (await gtranslate(cur, lang)).text;
    steps.push({ lang, text: cur });
  }
  return { steps, final: cur };
}

// ─── ASCII art ───────────────────────────────────────────────────────────────

type FigletFont = Parameters<typeof figlet.loadFontSync>[0];
export const ASCII_FONTS = ['Standard', 'Big', 'Slant', 'Small', 'Banner3', 'Doom', 'Ghost', 'Graffiti', 'Larry 3D', 'Bloody', 'Star Wars', 'Rectangles'] as const;

export function asciify(text: string, font = 'Standard', maxWidth = 60): string {
  const t = text.trim().slice(0, 30);
  if (!t) throw new LookupError('Give me some text to turn into ASCII art.');
  if (!(ASCII_FONTS as readonly string[]).includes(font)) throw new LookupError('Unknown font.');
  const art = figlet.textSync(t, { font: font as FigletFont, width: maxWidth, whitespaceBreak: true });
  return art.replace(/\s+$/gm, '').replace(/^\n+|\n+$/g, '');
}

// ─── Small pure helpers used by fun commands ─────────────────────────────────

/** Deterministic 0–100 from two ids/names, order-independent (for /ship). */
export function compatibility(a: string, b: string): number {
  const key = [a, b].sort().join('|');
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h >>> 0) % 101;
}
export const shipName = (a: string, b: string) => `${a.slice(0, Math.ceil(a.length / 2))}${b.slice(Math.floor(b.length / 2))}`;

export function heartBar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width);
  return '❤️'.repeat(filled) + '🖤'.repeat(width - filled);
}

/** 0–100 "rating" from a seed string that stays stable for a day. */
export function dailyRating(seed: string, day = new Date().toISOString().slice(0, 10)): number {
  return compatibility(seed, day);
}
export const pick = <T,>(arr: readonly T[]): T => arr[randInt(0, arr.length - 1)]!;
