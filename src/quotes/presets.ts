import { db } from '../utils/db.js';
import { DISPLAY_FONTS } from '../generate/discord.js';
import { DEFAULT_QUOTE_STYLE, type QuoteStyle } from '../utils/quote.js';

/** /quotemessage config: named looks for your quotes, one of which is applied to Quote Message and /generate fake quote. */

export const MAX_PRESETS = 10;
export const MAX_PRESET_NAME = 32;
export const QUOTE_FONTS = ['M PLUS', ...DISPLAY_FONTS] as const;

export class PresetError extends Error {}

export async function initQuoteSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS quote_presets (
    user_id    TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    style      TEXT    NOT NULL,
    active     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, name)
  )`;
}

export interface Preset { name: string; style: QuoteStyle; active: boolean }

/** A stored style, with anything missing or unknown back to the default. */
export function parseStyle(json: string): QuoteStyle {
  let s: Partial<QuoteStyle> = {};
  try { s = JSON.parse(json) as Partial<QuoteStyle>; } catch { /* default */ }
  return {
    theme: s.theme === 'Light' ? 'Light' : 'Dark',
    font: (QUOTE_FONTS as readonly string[]).includes(s.font as string) ? s.font as QuoteStyle['font'] : DEFAULT_QUOTE_STYLE.font,
    grayscale: s.grayscale ?? DEFAULT_QUOTE_STYLE.grayscale,
    showHandle: s.showHandle ?? DEFAULT_QUOTE_STYLE.showHandle,
  };
}

const row = (r: { name: string; style: string; active: number }): Preset => ({ name: r.name, style: parseStyle(r.style), active: !!r.active });

export async function listPresets(userId: string): Promise<Preset[]> {
  return ((await db`SELECT name, style, active FROM quote_presets WHERE user_id = ${userId} ORDER BY created_at`) as { name: string; style: string; active: number }[]).map(row);
}
export async function getPreset(userId: string, name: string): Promise<Preset | null> {
  const r = ((await db`SELECT name, style, active FROM quote_presets WHERE user_id = ${userId} AND name = ${name}`) as { name: string; style: string; active: number }[])[0];
  return r ? row(r) : null;
}
/** The style your quotes use: your applied preset, else the classic look. */
export async function activeStyle(userId: string): Promise<QuoteStyle> {
  const r = ((await db`SELECT style FROM quote_presets WHERE user_id = ${userId} AND active = 1`) as { style: string }[])[0];
  return r ? parseStyle(r.style) : DEFAULT_QUOTE_STYLE;
}

export async function createPreset(userId: string, rawName: string): Promise<Preset> {
  const name = rawName.replace(/\s+/g, ' ').trim();
  if (!name) throw new PresetError('Give the preset a name.');
  if (name.length > MAX_PRESET_NAME) throw new PresetError(`Keep the name under ${MAX_PRESET_NAME} characters.`);
  const mine = await listPresets(userId);
  if (mine.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new PresetError(`You already have a preset called **${name}**.`);
  if (mine.length >= MAX_PRESETS) throw new PresetError(`You can have up to ${MAX_PRESETS} presets — delete one first.`);
  await db`INSERT INTO quote_presets (user_id, name, style, created_at) VALUES (${userId}, ${name}, ${JSON.stringify(DEFAULT_QUOTE_STYLE)}, ${Date.now()})`;
  return (await getPreset(userId, name))!;
}

export async function updatePreset(userId: string, name: string, patch: Partial<QuoteStyle>): Promise<Preset> {
  const p = await getPreset(userId, name);
  if (!p) throw new PresetError('That preset doesn\'t exist any more.');
  const style = parseStyle(JSON.stringify({ ...p.style, ...patch }));
  await db`UPDATE quote_presets SET style = ${JSON.stringify(style)} WHERE user_id = ${userId} AND name = ${name}`;
  return { ...p, style };
}

export async function deletePreset(userId: string, name: string): Promise<boolean> {
  const before = (await listPresets(userId)).length;
  await db`DELETE FROM quote_presets WHERE user_id = ${userId} AND name = ${name}`;
  return (await listPresets(userId)).length < before;
}

export async function applyPreset(userId: string, name: string): Promise<boolean> {
  if (!(await getPreset(userId, name))) return false;
  await db`UPDATE quote_presets SET active = CASE WHEN name = ${name} THEN 1 ELSE 0 END WHERE user_id = ${userId}`;
  return true;
}
