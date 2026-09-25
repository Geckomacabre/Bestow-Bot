import { describe, expect, test } from 'bun:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { pixelsOf, sample, squareToQuad, toPng, type Pixels } from '../src/media/anim';
import { addAudioGraph, ADD_AUDIO_EFFECTS, carveWidth, globeFrame, magikPixels, motivateFrame, swirlPixels } from '../src/media/fx2';
import { SCENES, TEMPLATES } from '../src/media/makesweet';
import { pixelSize } from '../src/media/effects';

/** A 64×48 test card: red left half, blue right half, a white stripe down the middle. */
function card(w = 64, h = 48): Pixels {
  const c = createCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#f00'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#00f'; g.fillRect(w / 2, 0, w / 2, h); g.fillStyle = '#fff'; g.fillRect(w / 2 - 2, 0, 4, h);
  return pixelsOf(c);
}
const px = (p: Pixels, x: number, y: number) => Array.from(p.data.subarray((y * p.w + x) * 4, (y * p.w + x) * 4 + 4));
const isPng = (b: Buffer) => b.subarray(1, 4).toString() === 'PNG';

describe('geometry and pixels', () => {
  test('the homography sends the unit square to the quad corners', () => {
    const H = squareToQuad([[10, 20], [110, 5], [120, 90], [0, 100]]);
    for (const [[u, v], want] of [[[0, 0], [10, 20]], [[1, 0], [110, 5]], [[1, 1], [120, 90]], [[0, 1], [0, 100]]] as const) {
      const [x, y] = H(u, v); expect(x).toBeCloseTo(want[0], 6); expect(y).toBeCloseTo(want[1], 6);
    }
  });
  test('bilinear sampling blends neighbours and clamps at the edges', () => {
    // A single row: the row below is clamped to the same row rather than read past the end.
    const p: Pixels = { w: 2, h: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 200, 100, 50, 255]) }, out = new Uint8ClampedArray(4);
    sample(p, 0.5, 0, out, 0); expect(Array.from(out)).toEqual([100, 50, 25, 255]);
    sample(p, -5, 9, out, 0); expect(Array.from(out)).toEqual([0, 0, 0, 255]);
  });
});

describe('swirl, globe, magik', () => {
  test('a zero swirl changes nothing; a real one moves pixels but leaves the corners', () => {
    const p = card();
    expect(swirlPixels(p, 0).data).toEqual(p.data);
    const s = swirlPixels(p, 2);
    expect(s.data).not.toEqual(p.data);
    expect(px(s, 0, 0)).toEqual(px(p, 0, 0));
  });
  test('the globe is round: transparent corners, opaque centre, and it turns', () => {
    const f0 = globeFrame(card(), 64, 0), f1 = globeFrame(card(), 64, 0.25);
    expect(px(f0, 0, 0)[3]).toBe(0);
    expect(px(f0, 32, 32)[3]).toBe(255);
    expect(f0.data).not.toEqual(f1.data);
  });
  test('seam carving removes exactly the asked-for columns, and magik keeps the size', () => {
    const p = card();
    const c = carveWidth(p, 10);
    expect([c.w, c.h, c.data.length]).toEqual([54, 48, 54 * 48 * 4]);
    // The stripe in the middle is where the energy is — carving goes round it.
    expect(Array.from({ length: c.w }, (_, x) => px(c, x, 10)).some(([r, g, b]) => r! > 200 && g! > 200 && b! > 200)).toBe(true);
    const m = magikPixels(p, 0.3);
    expect([m.w, m.h]).toEqual([64, 48]);
  });
});

describe('posters and add-audio graphs', () => {
  test('motivate draws a framed poster with title and subtitle', async () => {
    const img = await loadImage(toPng(card()));
    const png = motivateFrame(img, 'Teamwork', 'makes the dream work');
    expect(isPng(png)).toBe(true);
    const bare = motivateFrame(img, 'Only a title', '');
    expect(bare.length).toBeGreaterThan(100);
  });
  test('every Heist addaudio effect has a video graph ending in [v]', () => {
    for (const e of [...ADD_AUDIO_EFFECTS, null]) {
      const g = addAudioGraph(e, 640, 480, 6);
      expect(g, String(e)).toMatch(/\[v\]$/);
      expect(g).toStartWith('[0:v]scale=640:480');
    }
    expect(addAudioGraph('Blurred to Clear', 640, 480, 6)).toContain('xfade=transition=fade');
    expect(addAudioGraph('Slide Up', 640, 480, 6)).toContain('slideup');
  });
  test('pixelate sizes are relative to the picture', () => {
    expect(pixelSize(960, 480, 'Small')).toBe(10);
    expect(pixelSize(960, 480, 'Large')).toBe(40);
    expect(pixelSize(20, 20, 'Small')).toBe(2);
  });
});

describe('makesweet scenes', () => {
  /** A plain-colour picture, to tell whether a scene really draws the input. */
  const plain = (color: string) => { const c = createCanvas(160, 120), g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 160, 120); return loadImage(c.toBuffer('image/png')); };
  for (const t of TEMPLATES) {
    test(`${t}: a loop of same-sized PNG frames that shows the picture`, async () => {
      const img = await loadImage(toPng(card(160, 120)));
      const t0 = performance.now();
      const frames = await SCENES[t](img, t === 'heartlocket' ? img : null, t === 'heartlocket' ? null : 'hi');
      expect(performance.now() - t0).toBeLessThan(15_000);
      expect(frames.length).toBeGreaterThanOrEqual(20);
      expect(frames.every(isPng)).toBe(true);
      const size = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];
      expect(new Set(frames.map(f => size(f).join('x'))).size).toBe(1);
      expect(frames.some(f => !f.equals(frames[0]!))).toBe(true); // it animates
      // The picture is really in there: a different picture gives different frames.
      const [green, magenta] = [await plain('#0f0'), await plain('#f0f')];
      const a = await SCENES[t](green, t === 'heartlocket' ? green : null, null), b = await SCENES[t](magenta, t === 'heartlocket' ? magenta : null, null);
      expect(a.some((f, k) => !f.equals(b[k]!))).toBe(true);
    }, 60_000);
  }
});
