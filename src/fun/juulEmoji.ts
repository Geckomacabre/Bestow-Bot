import { createHash } from 'node:crypto';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Client } from 'discord.js';
import { MAX_BATTERY } from './juul.js';

/**
 * The juul and battery icons in /juul replies, like Heist's: custom images sent as the bot's own application emojis (Discord only
 * shows images inline in text as emojis). The art lives at src/assets/images/juul/juul.png and battery.png (a full battery) —
 * juul.png is uploaded as-is and every battery level, one per percent (0–100), is cut from battery.png. Emojis re-sync on each
 * start, so replaced art takes over by itself. juul.png alone is enough: without battery.png the battery keeps its coloured
 * squares. Until the art is there and synced (or if Discord refuses), plain emoji stand in.
 */

const DIR = path.resolve(import.meta.dir, '../assets/images/juul');
/** Battery icons: one per percent, 0 = empty … 100 = full. */
export const BATTERY_LEVELS = 100;
/** Charge at or below these fractions is drawn red / amber; above the second, the art's own green. */
const RED_UP_TO = 0.2, AMBER_UP_TO = 0.4;
const FALLBACK = { juul: '🖊️', battery: Array.from({ length: BATTERY_LEVELS + 1 }, (_, p) => (p <= RED_UP_TO * 100 ? '🟥' : p <= AMBER_UP_TO * 100 ? '🟨' : '🟩')) };

let synced: { juul: string; battery: string[] } | null = null;

export const juulEmoji = () => synced?.juul ?? FALLBACK.juul;
/** Forgets the synced emojis (tests). */
export const resetJuulEmojis = () => { synced = null; };
/** Percent shown for a battery level: 0 only when flat, otherwise at least 1. */
export const batteryPercent = (level: number) => (level <= 0 ? 0 : Math.max(1, Math.min(BATTERY_LEVELS, Math.round((level / MAX_BATTERY) * BATTERY_LEVELS))));
export const batteryEmoji = (level: number) => (synced?.battery ?? FALLBACK.battery)[batteryPercent(level)]!;

type RGBA = [number, number, number, number];
const RED: RGBA = [229, 72, 77, 255], AMBER: RGBA = [245, 197, 24, 255];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * One battery level from the full-battery art. `percent` is 0–100.
 *
 * The green fill is found by colour and cut down from the top to `percent` of its height; the cut-away part takes the colour of the
 * gap just above the fill, and what is left turns red (≤20%) or amber (≤40%). The cut line is not snapped to whole pixel rows — the
 * row it falls in is blended by how much of it is above the line — so every percent is a slightly different image.
 *
 * Each pixel is treated as `fill × a + rest × (1 − a)` where `a` is how green it is, so the edges where the fill meets the outline
 * (partly green, partly dark) are recoloured in proportion instead of leaving a green fringe behind.
 */
export async function batteryLevel(full: Buffer, percent: number): Promise<Buffer> {
  const img = await loadImage(full);
  const c = createCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, img.width, img.height), d = id.data, W = img.width;
  const core = (k: number) => d[k + 3]! > 0 && d[k + 1]! > 90 && d[k + 1]! > d[k]! + 40 && d[k + 1]! > d[k + 2]! + 20;
  let coreMinY = Infinity, minX = Infinity, maxX = -1, n = 0;
  const fill = [0, 0, 0, 0];
  for (let k = 0; k < d.length; k += 4) if (core(k)) {
    const p = k / 4, x = p % W;
    coreMinY = Math.min(coreMinY, Math.floor(p / W)); minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    n++; for (let ch = 0; ch < 4; ch++) fill[ch]! += d[k + ch]!;
  }
  if (!n) return full; // no green fill found: use the art as it is
  for (let ch = 0; ch < 4; ch++) fill[ch]! /= n;
  const spread = Math.max(1, fill[1]! - Math.max(fill[0]!, fill[2]!));
  const greenness = (k: number) => clamp((d[k + 1]! - Math.max(d[k]!, d[k + 2]!)) / spread, 0, 1);
  // The fill's rows include its anti-aliased edge rows (partly green, partly outline), so an emptied battery leaves none of it behind.
  let minY = Infinity, maxY = -1;
  for (let k = 0; k < d.length; k += 4) if (greenness(k) > 0.15) { const y = Math.floor(k / 4 / W); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const gy = Math.max(0, coreMinY - 2), gx = Math.round((minX + maxX) / 2), gk = (gy * W + gx) * 4;
  const gap: RGBA = [d[gk]!, d[gk + 1]!, d[gk + 2]!, d[gk + 3]!];
  const fraction = clamp(percent, 0, 100) / 100;
  const cut = maxY + 1 - (maxY - minY + 1) * fraction; // the line above which the fill is empty (a fractional row)
  const tint = fraction <= 0 ? null : fraction <= RED_UP_TO ? RED : fraction <= AMBER_UP_TO ? AMBER : null;
  for (let k = 0; k < d.length; k += 4) {
    const a = greenness(k);
    if (a < 0.04) continue; // not part of the fill
    const e = clamp(cut - Math.floor(k / 4 / W), 0, 1); // how much of this row is above the cut line
    for (let ch = 0; ch < 4; ch++) {
      const charged = tint ? tint[ch]! : fill[ch]!;
      const to = charged * (1 - e) + gap[ch]! * e;
      d[k + ch] = clamp(Math.round(d[k + ch]! + (to - fill[ch]!) * a), 0, 255);
    }
  }
  g.putImageData(id, 0, 0);
  return c.toBuffer('image/png');
}

/**
 * The icon images to upload, named with a short content hash so replaced art gets new emojis — or null while juul.png isn't in
 * the repo yet (the plain emoji stay in use). battery.png is optional: without it only the juul icon is returned, and with it the
 * 101 battery levels (0–100%) follow.
 */
export async function juulIcons(dir = DIR): Promise<{ name: string; data: Buffer<ArrayBufferLike> }[] | null> {
  const [jf, bf] = [Bun.file(path.join(dir, 'juul.png')), Bun.file(path.join(dir, 'battery.png'))];
  if (!(await jf.exists())) return null;
  const juul = Buffer.from(await jf.arrayBuffer());
  const hash = (b: Buffer) => createHash('sha1').update(b).digest('hex').slice(0, 6);
  const out: { name: string; data: Buffer<ArrayBufferLike> }[] = [{ name: `juul_${hash(juul)}`, data: juul }];
  if (!(await bf.exists())) return out;
  const full = Buffer.from(await bf.arrayBuffer());
  for (let p = 0; p <= BATTERY_LEVELS; p++) {
    const data = p === BATTERY_LEVELS ? full : await batteryLevel(full, p);
    out.push({ name: `battery${p}_${hash(data)}`, data });
  }
  return out;
}

const OURS = /^(juul|battery\d{1,3})_[0-9a-f]{6}$/;

/**
 * Upload any missing icons as application emojis, remove stale ones, and start using them. The juul icon is usable as soon as it
 * exists; the battery levels take over once all of them are uploaded (Discord's rate limits can make the first upload slow, and
 * a start that is cut short simply carries on with what is missing next time).
 */
export async function syncJuulEmojis(client: Client, dir = DIR): Promise<void> {
  const app = client.application;
  if (!app) return;
  const want = await juulIcons(dir);
  if (!want) return;
  const have = await app.emojis.fetch();
  const ids = new Map<string, string>();
  for (const e of have.values()) {
    if (!e.name || !OURS.test(e.name)) continue;
    if (want.some(w => w.name === e.name)) ids.set(e.name, e.id);
    else await e.delete().catch(() => {}); // art was replaced
  }
  const tag = (name: string) => `<:${name}:${ids.get(name)}>`;
  for (const [n, w] of want.entries()) {
    if (!ids.has(w.name)) ids.set(w.name, (await app.emojis.create({ attachment: w.data, name: w.name })).id);
    if (n === 0) synced = { juul: tag(w.name), battery: FALLBACK.battery }; // the juul icon is ready before the batteries are
  }
  if (want.length > 1) synced = { juul: tag(want[0]!.name), battery: want.slice(1).map(w => tag(w.name)) };
}
