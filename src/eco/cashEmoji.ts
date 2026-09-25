import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Client } from 'discord.js';

/**
 * The cash icon in every money amount, like Heist's "💸 $3,148": the image at src/assets/images/cash.png is uploaded as one of
 * the bot's own application emojis (Discord only shows images inline in text as emojis) and takes the place of the default
 * currency symbol. It re-syncs on each start, so replaced art takes over by itself. Until it is uploaded (or if Discord refuses),
 * 💸 stands in. A server that picked its own currency symbol with /economyconfig keeps it.
 */

const DIR = path.resolve(import.meta.dir, '../assets/images');
/** The symbol every economy config starts with. */
export const DEFAULT_SYMBOL = '🪙';
const FALLBACK = '💸';
const OURS = /^cash_[0-9a-f]{6}$/;

let synced: string | null = null;

export const cashEmoji = () => synced ?? FALLBACK;
/** Forgets the synced emoji (tests). */
export const resetCashEmoji = () => { synced = null; };
/** The symbol to show for a stored one: the cash icon in place of the default, anything else as chosen. */
export const displaySymbol = (stored: string) => (stored === DEFAULT_SYMBOL ? cashEmoji() : stored);
/** "💸 $1,234" for the cash icon; a custom symbol reads "🍪 1,234". */
export const money = (sym: string, n: number) => `${sym} ${sym === cashEmoji() ? '$' : ''}${n.toLocaleString()}`;
/** The same with the amount in bold and the icon outside it, as Heist shows a reward: "💸 **$291**". */
export const moneyBold = (sym: string, n: number) => `${sym} **${sym === cashEmoji() ? '$' : ''}${n.toLocaleString()}**`;

/** The icon to upload, named with a short content hash so replaced art gets a new emoji — or null while cash.png isn't there. */
export async function cashIcon(dir = DIR): Promise<{ name: string; data: Buffer<ArrayBufferLike> } | null> {
  const f = Bun.file(path.join(dir, 'cash.png'));
  if (!(await f.exists())) return null;
  const data = Buffer.from(await f.arrayBuffer());
  return { name: `cash_${createHash('sha1').update(data).digest('hex').slice(0, 6)}`, data };
}

/** Upload the icon if it isn't there yet, remove an older one, and start using it. */
export async function syncCashEmoji(client: Client, dir = DIR): Promise<void> {
  const app = client.application;
  if (!app) return;
  const want = await cashIcon(dir);
  if (!want) return;
  let id: string | undefined;
  for (const e of (await app.emojis.fetch()).values()) {
    if (!e.name || !OURS.test(e.name)) continue;
    if (e.name === want.name) id = e.id;
    else await e.delete().catch(() => {}); // art was replaced
  }
  id ??= (await app.emojis.create({ attachment: want.data, name: want.name })).id;
  synced = `<:${want.name}:${id}>`;
}
