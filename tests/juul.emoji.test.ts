import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { batteryEmoji, batteryLevel, batterySteps, juulEmoji, juulIcons } from '../src/fun/juulEmoji';

/** A stand-in full battery: black outline, white gap, green fill in rows 32–107. */
function battery(): Buffer {
  const c = createCanvas(128, 128), g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(32, 20, 64, 100);
  g.fillStyle = '#fff'; g.fillRect(39, 27, 50, 86);
  g.fillStyle = '#1fc873'; g.fillRect(44, 32, 40, 76);
  return c.toBuffer('image/png');
}
async function pixel(png: Buffer, x: number, y: number) {
  const img = await loadImage(png), c = createCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return Array.from(g.getImageData(x, y, 1, 1).data);
}

describe('juul battery icons', () => {
  test('bars per battery level: flat is empty, any charge shows at least one bar', () => {
    expect([0, 1, 10, 11, 20, 21, 30, 47, 50].map(batterySteps)).toEqual([0, 1, 1, 2, 2, 3, 3, 5, 5]);
  });
  test('until the art is synced, plain emoji stand in', () => {
    expect(juulEmoji()).toBe('🖊️');
    expect([batteryEmoji(50), batteryEmoji(15), batteryEmoji(5), batteryEmoji(0)]).toEqual(['🟩', '🟨', '🟥', '🟥']);
  });
  test('levels are cut from the full battery: emptied from the top, amber at two bars, red at one', async () => {
    const full = battery();
    const three = await batteryLevel(full, 3);
    expect(await pixel(three, 64, 36)).toEqual([255, 255, 255, 255]); // top of the fill → the white gap
    expect(await pixel(three, 64, 100)).toEqual([31, 200, 115, 255]); // bottom keeps the art's green
    expect((await pixel(await batteryLevel(full, 2), 64, 100)).slice(0, 3)).toEqual([245, 197, 24]);
    expect((await pixel(await batteryLevel(full, 1), 64, 104)).slice(0, 3)).toEqual([229, 72, 77]);
    const empty = await batteryLevel(full, 0);
    expect(await pixel(empty, 64, 100)).toEqual([255, 255, 255, 255]);
    expect(await pixel(empty, 34, 60)).toEqual([17, 17, 17, 255]); // the outline is untouched
  });
  test('icons come only from the art in the folder: none without it, juul + six levels with it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'juul-art-'));
    expect(await juulIcons(dir)).toBeNull();
    const juul = createCanvas(64, 64).toBuffer('image/png');
    await writeFile(path.join(dir, 'juul.png'), juul); await writeFile(path.join(dir, 'battery.png'), battery());
    const icons = (await juulIcons(dir))!;
    expect(icons.map(i => i.name.replace(/_[0-9a-f]{6}$/, ''))).toEqual(['juul', 'battery0', 'battery1', 'battery2', 'battery3', 'battery4', 'battery5']);
    expect(icons[0]!.data.equals(juul)).toBe(true); // the juul art is uploaded untouched
    expect(icons[6]!.data.equals(battery())).toBe(true); // and so is the full battery
  });
});
