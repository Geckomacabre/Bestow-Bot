import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Client } from 'discord.js';

/**
 * Custom emojis that stand in for common plain ones in the bot's own replies, for a bit of spice: the art in
 * src/assets/images/spice (picked from emoji.gg) is uploaded as the bot's own application emojis, which it can use anywhere,
 * and spice() swaps them in for ✅ ❌ ⚠️ 🎉 and the rest when cv2Text, cv2Err and card build a reply. Like the cash and juul
 * icons, they re-sync on each start (replaced art takes over by itself) and the plain emoji stays until they're there.
 *
 * Art (emoji.gg titles): yes success, no WrongMark, warn WarningPC, party HyperTada, trophy trophyping, fire Fire, wait 8104LoadingEmote,
 * heart blobhearts, cake cupcake, wave BlurpleBlobWave, dead BlobDead, laugh bloblaughing, money Coin, think blobthinking, eyes blobeyes,
 * sad blobcry.
 */

const DIR = path.resolve(import.meta.dir, '../assets/images/spice');
/** Plain emoji → the art that replaces it (a .gif is animated). Both spellings of emoji that come with and without U+FE0F. */
export const SPICE: Record<string, string> = {
  '✅': 'yes.gif', '❌': 'no.png', '⚠️': 'warn.gif', '⚠': 'warn.gif', '🎉': 'party.gif', '🏆': 'trophy.png', '🔥': 'fire.gif',
  '⏳': 'wait.gif', '❤️': 'heart.png', '❤': 'heart.png', '🎂': 'cake.png', '👋': 'wave.gif', '💀': 'dead.png', '😂': 'laugh.png',
  '💰': 'money.gif', '🤔': 'think.png', '👀': 'eyes.png', '😢': 'sad.png',
};
const OURS = /^spice_[a-z]+_[0-9a-f]{6}$/;

let synced = new Map<string, string>();
let pattern: RegExp | null = null;

/** Forgets the synced emojis (tests). */
export const resetSpice = () => { synced = new Map(); pattern = null; };

/**
 * Swaps the custom emojis in for plain ones, leaving `code` and ```code blocks``` alone. Text is unchanged until they're synced, and
 * when swapping would take it past `max` characters (each tag is ~35 characters; Discord caps a message's text at 4000).
 */
export function spice(text: string, max = 4000): string {
  if (!pattern || !text) return text;
  const out = text.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => (i % 2 ? part : part.replace(pattern!, m => synced.get(m) ?? m))).join('');
  return out.length <= max ? out : text;
}

/** The art to upload, each named with a short content hash so replaced art gets a new emoji. */
export async function spiceIcons(dir = DIR): Promise<{ file: string; name: string; animated: boolean; data: Buffer<ArrayBufferLike> }[]> {
  const out = [];
  for (const file of new Set(Object.values(SPICE))) {
    const f = Bun.file(path.join(dir, file));
    if (!(await f.exists())) continue;
    const data = Buffer.from(await f.arrayBuffer());
    out.push({ file, name: `spice_${file.split('.')[0]}_${createHash('sha1').update(data).digest('hex').slice(0, 6)}`, animated: file.endsWith('.gif'), data });
  }
  return out;
}

/** Use these emoji tags (file → `<:name:id>`) for spice(). */
export function useSpice(tags: Map<string, string>): void {
  synced = new Map(Object.entries(SPICE).flatMap(([plain, file]) => (tags.has(file) ? [[plain, tags.get(file)!] as const] : [])));
  // Longest first, so "⚠️" is matched whole before its bare "⚠".
  const keys = [...synced.keys()].sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  pattern = keys.length ? new RegExp(keys.join('|'), 'gu') : null;
}

/** Upload any missing art as application emojis, remove replaced ones, and start using them. */
export async function syncSpiceEmojis(client: Client, dir = DIR): Promise<void> {
  const app = client.application;
  if (!app) return;
  const want = await spiceIcons(dir);
  if (!want.length) return;
  const ids = new Map<string, string>();
  for (const e of (await app.emojis.fetch()).values()) {
    if (!e.name || !OURS.test(e.name)) continue;
    if (want.some(w => w.name === e.name)) ids.set(e.name, e.id);
    else await e.delete().catch(() => {}); // art was replaced
  }
  for (const w of want) if (!ids.has(w.name)) ids.set(w.name, (await app.emojis.create({ attachment: w.data, name: w.name })).id);
  useSpice(new Map(want.map(w => [w.file, `<${w.animated ? 'a' : ''}:${w.name}:${ids.get(w.name)}>`])));
}
