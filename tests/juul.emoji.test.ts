import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { BATTERY_LEVELS, batteryEmoji, batteryLevel, batteryPercent, juulEmoji, juulIcons, resetJuulEmojis, syncJuulEmojis } from '../src/fun/juulEmoji';

/** A stand-in full battery: black outline, white gap, green fill in rows 32–107. */
function battery(): Buffer {
  const c = createCanvas(128, 128), g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(32, 20, 64, 100);
  g.fillStyle = '#fff'; g.fillRect(39, 27, 50, 86);
  g.fillStyle = '#1fc873'; g.fillRect(44, 32, 40, 76);
  return c.toBuffer('image/png');
}
/** A stand-in like the real art: rounded black outline, transparent inside, fill flush to the sides and bottom but with empty headroom on top. */
function headroomBattery(): Buffer {
  const c = createCanvas(96, 96), g = c.getContext('2d');
  g.strokeStyle = '#000'; g.lineWidth = 4; g.beginPath(); g.roundRect(30, 20, 36, 64, 6); g.stroke();
  g.fillStyle = '#00be64'; g.fillRect(32, 40, 32, 42); // rows 40–81; the inside runs from row 22, so there are 18 empty rows above
  return c.toBuffer('image/png');
}
async function pixel(png: Buffer, x: number, y: number) {
  const img = await loadImage(png), c = createCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return Array.from(g.getImageData(x, y, 1, 1).data);
}
const greenPixels = async (png: Buffer) => {
  const img = await loadImage(png), c = createCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data; let n = 0;
  for (let k = 0; k < d.length; k += 4) if (d[k + 3]! > 30 && d[k + 1]! - Math.max(d[k]!, d[k + 2]!) > 12) n++;
  return n;
};

afterEach(() => resetJuulEmojis());

describe('juul battery icons', () => {
  test('one icon per percent: flat is 0%, any charge shows at least 1%, full is 100%', () => {
    expect(BATTERY_LEVELS).toBe(100);
    expect([0, 1, 10, 25, 49, 50, 99].map(batteryPercent)).toEqual([0, 2, 20, 50, 98, 100, 100]);
    expect(batteryPercent(-5)).toBe(0);
  });
  test('until the art is synced, plain emoji stand in', () => {
    expect(juulEmoji()).toBe('🖊️');
    expect([batteryEmoji(50), batteryEmoji(15), batteryEmoji(5), batteryEmoji(0)]).toEqual(['🟩', '🟨', '🟥', '🟥']);
  });
  test('levels are cut from the full battery: emptied from the top, amber up to 40%, red up to 20%', async () => {
    const full = battery();
    const sixty = await batteryLevel(full, 60);
    expect(await pixel(sixty, 64, 36)).toEqual([255, 255, 255, 255]); // top of the fill → the white gap
    expect(await pixel(sixty, 64, 100)).toEqual([31, 200, 115, 255]); // bottom keeps the art's green
    expect((await pixel(await batteryLevel(full, 40), 64, 100)).slice(0, 3)).toEqual([245, 197, 24]);
    expect((await pixel(await batteryLevel(full, 41), 64, 100)).slice(0, 3)).toEqual([31, 200, 115]);
    expect((await pixel(await batteryLevel(full, 20), 64, 104)).slice(0, 3)).toEqual([229, 72, 77]);
    expect((await pixel(await batteryLevel(full, 21), 64, 104)).slice(0, 3)).toEqual([245, 197, 24]);
    const empty = await batteryLevel(full, 0);
    expect(await pixel(empty, 64, 100)).toEqual([255, 255, 255, 255]);
    expect(await pixel(empty, 34, 60)).toEqual([17, 17, 17, 255]); // the outline is untouched
  });
  test('the cut line falls between pixel rows, so neighbouring percents are different images', async () => {
    const full = battery();
    const levels = await Promise.all(Array.from({ length: 101 }, (_, p) => batteryLevel(full, p)));
    // 76 rows of fill can't give 101 whole-row images; the blended boundary row is what separates them.
    expect(new Set(levels.map(b => b.toString('base64'))).size).toBeGreaterThanOrEqual(95);
    // 47% puts the cut line a quarter of the way down row 72: that row is part green, part gap (white).
    const edge = await pixel(await batteryLevel(full, 47), 64, 72);
    expect(edge[1]).toBeGreaterThan(200); expect(edge[0]).toBeGreaterThan(31); expect(edge[0]).toBeLessThan(255);
  });
  test('the levels are monotonic: more charge never shows less green', async () => {
    const full = battery(); let last = -1;
    for (const p of [0, 10, 25, 40, 55, 70, 85, 100]) { const n = await greenPixels(await batteryLevel(full, p === 100 ? 100 : p)); expect(n).toBeGreaterThanOrEqual(last); last = n; }
  });
  test('the battery.png shipped in the repo is cut cleanly: an empty battery has no green left over', async () => {
    const art = await readFile(path.resolve(import.meta.dir, '../src/assets/images/juul/battery.png'));
    expect(await greenPixels(art)).toBeGreaterThan(300);
    expect(await greenPixels(await batteryLevel(art, 0))).toBeLessThan(12); // was ~270 before the fringe was handled
  });
  test('100% of the shipped art is a full battery: the fill reaches the top edge (the art itself leaves headroom)', async () => {
    const art = await readFile(path.resolve(import.meta.dir, '../src/assets/images/juul/battery.png'));
    const full = await batteryLevel(art, 100);
    expect(await greenPixels(full)).toBeGreaterThan(await greenPixels(art)); // it gained the rows the art left empty
    // The centre column is solid green from just under the top edge (row 19) to the last solid fill row (81; row 82 is the art's soft bottom edge): no empty band, no seam.
    for (let y = 19; y <= 81; y++) { const p = await pixel(full, 48, y); expect(p[3], `alpha at row ${y}`).toBe(255); expect(p[1], `green at row ${y}`).toBeGreaterThan(150); expect(p[0], `red at row ${y}`).toBeLessThan(40); }
    const seam = await pixel(art, 48, 26); expect(seam[3]).toBeLessThan(100); // the art's own soft top row is what used to show as a seam
    // ...and the outline is untouched: the top edge is still black.
    expect(await pixel(full, 48, 16)).toEqual([0, 0, 0, 255]);
  });
  test('the fill grows into the headroom only inside the outline: rounded corners stay clear, and every level is measured against the whole inside', async () => {
    const art = headroomBattery();
    expect((await pixel(art, 48, 30))[3]).toBe(0); // the stand-in has empty headroom above its fill, like the real art
    const full = await batteryLevel(art, 100);
    expect((await pixel(full, 48, 26)).slice(0, 3)).toEqual([0, 190, 100]); // headroom is now fill
    expect((await pixel(full, 28, 18))[3]).toBe(0); // the outer corner, outside the rounded outline, is still transparent
    expect((await pixel(full, 20, 50))[3]).toBe(0); expect((await pixel(full, 76, 50))[3]).toBe(0); // nothing painted outside the walls
    const half = await batteryLevel(art, 50);
    expect((await pixel(half, 48, 40))[3]).toBe(0); // above the middle of the inside: empty
    expect((await pixel(half, 48, 68)).slice(0, 3)).toEqual([0, 190, 100]); // below it: charged
    expect((await pixel(await batteryLevel(art, 0), 48, 70))[3]).toBe(0);
  });
  test('icons come only from the art in the folder: none without it, juul + 101 levels with it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'juul-art-'));
    expect(await juulIcons(dir)).toBeNull();
    const juul = createCanvas(64, 64).toBuffer('image/png');
    await writeFile(path.join(dir, 'juul.png'), juul); await writeFile(path.join(dir, 'battery.png'), battery());
    const icons = (await juulIcons(dir))!;
    expect(icons).toHaveLength(102);
    expect(icons.map(i => i.name.replace(/_[0-9a-f]{6}$/, ''))).toEqual(['juul', ...Array.from({ length: 101 }, (_, p) => `battery${p}`)]);
    for (const i of icons) expect(i.name.length).toBeLessThanOrEqual(32); // Discord's emoji name limit
    expect(icons[0]!.data.equals(juul)).toBe(true); // the juul art is uploaded untouched
    expect(icons[101]!.data.equals(battery())).toBe(true); // and so is the full battery (100%)
  }, 30_000);
});

/** Just enough of a Client for the emoji sync: the application's emoji list, and creating one. */
function fakeClient(existing: { id: string; name: string }[] = []) {
  const created: { name: string }[] = [], deleted: string[] = [];
  const have = new Map(existing.map(e => [e.id, { ...e, delete: async () => { deleted.push(e.id); } }]));
  const client = { application: { emojis: { fetch: async () => have, create: async (o: { name: string }) => { created.push(o); return { id: String(1000 + created.length - 1), name: o.name }; } } } };
  return { client: client as never, created, deleted };
}

describe('juul.png on its own', () => {
  test('is enough: only the juul icon is uploaded, the battery keeps its squares', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'juul-only-'));
    await writeFile(path.join(dir, 'juul.png'), createCanvas(40, 36).toBuffer('image/png'));
    const icons = (await juulIcons(dir))!;
    expect(icons).toHaveLength(1); expect(icons[0]!.name).toMatch(/^juul_[0-9a-f]{6}$/);
    const { client, created } = fakeClient();
    await syncJuulEmojis(client, dir);
    expect(created).toHaveLength(1);
    expect(juulEmoji()).toBe(`<:${created[0]!.name}:1000>`);
    expect([batteryEmoji(50), batteryEmoji(15), batteryEmoji(5)]).toEqual(['🟩', '🟨', '🟥']);
  });
  test('an emoji that is already uploaded is reused, and one from replaced art is removed', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'juul-reuse-'));
    await writeFile(path.join(dir, 'juul.png'), createCanvas(40, 36).toBuffer('image/png'));
    const name = (await juulIcons(dir))![0]!.name;
    const { client, created, deleted } = fakeClient([{ id: '55', name }, { id: '56', name: 'juul_aaaaaa' }, { id: '57', name: 'someone_elses' }]);
    await syncJuulEmojis(client, dir);
    expect(created).toHaveLength(0); expect(deleted).toEqual(['56']); expect(juulEmoji()).toBe(`<:${name}:55>`);
  });
  test('nothing changes without any art', async () => {
    const { client, created } = fakeClient();
    await syncJuulEmojis(client, await mkdtemp(path.join(os.tmpdir(), 'juul-none-')));
    expect(created).toHaveLength(0); expect(juulEmoji()).toBe('🖊️');
  });
  test('the juul.png shipped in the repo is a real image the sync will pick up', async () => {
    const icons = (await juulIcons())!;
    expect(icons[0]!.name).toMatch(/^juul_[0-9a-f]{6}$/);
    const img = await loadImage(icons[0]!.data);
    expect(img.width).toBeGreaterThan(8); expect(img.height).toBeGreaterThan(8);
  });
});

describe('with juul.png and battery.png', () => {
  test('all 102 icons are uploaded, the juul icon works straight away, and every battery percent gets its own emoji', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'juul-both-'));
    await writeFile(path.join(dir, 'juul.png'), createCanvas(40, 36).toBuffer('image/png')); await writeFile(path.join(dir, 'battery.png'), battery());
    const { client, created } = fakeClient();
    await syncJuulEmojis(client, dir);
    expect(created).toHaveLength(102);
    expect(juulEmoji()).toMatch(/^<:juul_[0-9a-f]{6}:1000>$/);
    // 50/50 is 100% → the last emoji created; 25/50 is 50% → the 51st battery emoji.
    expect(batteryEmoji(50)).toBe(`<:${created[101]!.name}:1101>`);
    expect(batteryEmoji(25)).toBe(`<:${created[51]!.name}:1051>`);
    expect(batteryEmoji(0)).toBe(`<:${created[1]!.name}:1001>`);
  }, 30_000);
  test('a sync that is cut short keeps the juul icon and carries on with what is missing next time', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'juul-cut-'));
    await writeFile(path.join(dir, 'juul.png'), createCanvas(40, 36).toBuffer('image/png')); await writeFile(path.join(dir, 'battery.png'), battery());
    const made: string[] = [];
    const client = { application: { emojis: { fetch: async () => new Map(), create: async (o: { name: string }) => { if (made.length >= 5) throw new Error('rate limited'); made.push(o.name); return { id: String(made.length), name: o.name }; } } } } as never;
    await expect(syncJuulEmojis(client, dir)).rejects.toThrow('rate limited');
    expect(juulEmoji()).toMatch(/^<:juul_[0-9a-f]{6}:1>$/); // the juul icon is already in use
    expect(batteryEmoji(50)).toBe('🟩'); // the batteries stay on squares until all of them are up
  }, 30_000);
});
