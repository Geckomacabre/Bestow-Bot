import { createHash } from 'node:crypto';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Client } from 'discord.js';
import { MAX_BATTERY } from './juul.js';

/**
 * The juul and battery icons in /juul replies, like Heist's: custom images sent as the bot's own application emojis (Discord only
 * shows images inline in text as emojis). The art lives at src/assets/images/juul/juul.png and battery.png (a full battery) —
 * juul.png is uploaded as-is and every battery level is cut from battery.png. Emojis re-sync on each start, so replaced art
 * takes over by itself. juul.png alone is enough: without battery.png the battery keeps its coloured squares. Until the art is
 * there and synced (or if Discord refuses), plain emoji stand in.
 */

const DIR = path.resolve(import.meta.dir, '../assets/images/juul');
/** Battery icons: 0 = empty … 5 = full, one bar per fifth. */
export const BATTERY_STEPS = 5;
const FALLBACK = { juul: '🖊️', battery: ['🟥', '🟥', '🟨', '🟩', '🟩', '🟩'] };

let synced: { juul: string; battery: string[] } | null = null;

export const juulEmoji = () => synced?.juul ?? FALLBACK.juul;
/** Forgets the synced emojis (tests). */
export const resetJuulEmojis = () => { synced = null; };
/** Bars shown for a battery level: 0 only when flat, otherwise at least one. */
export const batterySteps = (level: number) => (level <= 0 ? 0 : Math.min(BATTERY_STEPS, Math.ceil((level / MAX_BATTERY) * BATTERY_STEPS)));
export const batteryEmoji = (level: number) => (synced?.battery ?? FALLBACK.battery)[batterySteps(level)]!;

type RGBA = [number, number, number, number];
/** Charge colours by bars: red for one, amber for two, the art's own green from three up. */
const LOW: Record<number, RGBA> = { 1: [229, 72, 77, 255], 2: [245, 197, 24, 255] };

/**
 * One battery level from the full-battery art: the green fill is found by colour, cut down from the top to `steps`/5 of its height
 * (the cut-away part takes the colour of the gap just above the fill), and recoloured amber/red when low.
 */
export async function batteryLevel(full: Buffer, steps: number): Promise<Buffer> {
  const img = await loadImage(full);
  const c = createCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, img.width, img.height), d = id.data, W = img.width;
  const isFill = (k: number) => d[k + 3]! > 0 && d[k + 1]! > 90 && d[k + 1]! > d[k]! + 40 && d[k + 1]! > d[k + 2]! + 20;
  let minY = Infinity, maxY = -1, minX = Infinity, maxX = -1, n = 0, sr = 0, sg = 0, sb = 0;
  for (let k = 0; k < d.length; k += 4) if (isFill(k)) {
    const p = k / 4, x = p % W, y = Math.floor(p / W);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    n++; sr += d[k]!; sg += d[k + 1]!; sb += d[k + 2]!;
  }
  if (!n) return full; // no green fill found: use the art as it is
  const fillRGB = [sr / n, sg / n, sb / n];
  const gy = Math.max(0, minY - 2), gx = Math.round((minX + maxX) / 2), gk = (gy * W + gx) * 4;
  const gap: RGBA = [d[gk]!, d[gk + 1]!, d[gk + 2]!, d[gk + 3]!];
  const cut = maxY + 1 - ((maxY - minY + 1) * steps) / BATTERY_STEPS; // rows above this lose their charge
  const tint = LOW[steps];
  const greenness = (k: number) => Math.max(0, Math.min(1, (d[k + 1]! - Math.max(d[k]!, d[k + 2]!)) / Math.max(1, fillRGB[1]! - Math.max(fillRGB[0]!, fillRGB[2]!))));
  for (let k = 0; k < d.length; k += 4) {
    if (!isFill(k)) continue;
    const y = Math.floor(k / 4 / W), a = greenness(k);
    const to: RGBA | null = y < cut ? gap : tint ?? null;
    if (!to) continue;
    // Blend by how green the pixel is, so anti-aliased edges fade into the outline instead of leaving a green fringe.
    for (let ch = 0; ch < 4; ch++) d[k + ch] = Math.round(to[ch]! * a + d[k + ch]! * (1 - a));
  }
  g.putImageData(id, 0, 0);
  return c.toBuffer('image/png');
}

/**
 * The icon images to upload, named with a short content hash so replaced art gets new emojis — or null while juul.png isn't in
 * the repo yet (the plain emoji stay in use). battery.png is optional: without it only the juul icon is returned.
 */
export async function juulIcons(dir = DIR): Promise<{ name: string; data: Buffer<ArrayBufferLike> }[] | null> {
  const [jf, bf] = [Bun.file(path.join(dir, 'juul.png')), Bun.file(path.join(dir, 'battery.png'))];
  if (!(await jf.exists())) return null;
  const juul = Buffer.from(await jf.arrayBuffer());
  const hash = (b: Buffer) => createHash('sha1').update(b).digest('hex').slice(0, 6);
  const out: { name: string; data: Buffer<ArrayBufferLike> }[] = [{ name: `juul_${hash(juul)}`, data: juul }];
  if (!(await bf.exists())) return out;
  const full = Buffer.from(await bf.arrayBuffer());
  for (let s = 0; s <= BATTERY_STEPS; s++) {
    const data = s === BATTERY_STEPS ? full : await batteryLevel(full, s);
    out.push({ name: `battery${s}_${hash(data)}`, data });
  }
  return out;
}

const OURS = /^(juul|battery[0-5])_[0-9a-f]{6}$/;

/** Upload any missing icons as application emojis, remove stale ones, and start using them. */
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
  for (const w of want) {
    if (ids.has(w.name)) continue;
    const e = await app.emojis.create({ attachment: w.data, name: w.name });
    ids.set(w.name, e.id);
  }
  const tag = (name: string) => `<:${name}:${ids.get(name)}>`;
  synced = { juul: tag(want[0]!.name), battery: want.length > 1 ? want.slice(1).map(w => tag(w.name)) : FALLBACK.battery };
}
