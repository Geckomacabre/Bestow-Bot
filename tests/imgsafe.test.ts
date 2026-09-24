import { describe, expect, test } from 'bun:test';
import { createCanvas } from '@napi-rs/canvas';
import { MediaError } from '../src/framework/media';
import { normalizeImage, safeLoadImage } from '../src/framework/imgsafe';
import { scanQrBuffer, makeQr } from '../src/lookups/qr';
import { toDataUri } from '../src/ai/vision';

/**
 * Regression tests for a real crash: @napi-rs/canvas' loadImage() segfaults the whole process on a truncated/corrupt PNG or JPEG.
 * If any of these ever reach the native decoder directly, this test file itself dies with a segfault instead of failing politely.
 */

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (w = 64, h = 48, fill = '#cc3333') => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, w, h); return c.toBuffer('image/png'); };

const hostile: Record<string, Buffer> = {
  'empty': Buffer.alloc(0),
  'plain text': Buffer.from('not an image at all'),
  'png signature only': SIG,
  'png signature + zeros': Buffer.concat([SIG, Buffer.alloc(40)]),
  'truncated real png': png(200, 200).subarray(0, 60),
  'png with flipped IDAT bytes': (() => { const b = Buffer.from(png(100, 100)); for (let i = 60; i < Math.min(b.length, 200); i++) b[i] = b[i]! ^ 0xff; return b; })(),
  'jpeg header + zeros': Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]),
  'gif header only': Buffer.from('GIF89a'),
  'html': Buffer.from('<html><script>alert(1)</script></html>'),
  'svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'),
  'random bytes': Buffer.from(crypto.getRandomValues(new Uint8Array(4096))),
};

describe('corrupt or hostile "images" never crash the process', () => {
  for (const [name, buf] of Object.entries(hostile)) {
    test(`normalizeImage rejects: ${name}`, async () => { await expect(normalizeImage(buf)).rejects.toThrow(MediaError); });
    test(`safeLoadImage rejects: ${name}`, async () => { await expect(safeLoadImage(buf)).rejects.toThrow(); });
    test(`QR scanner reports it politely: ${name}`, async () => { await expect(scanQrBuffer(buf)).rejects.toThrow(/image|QR/i); });
    test(`AI vision helper reports it politely: ${name}`, async () => { await expect(toDataUri(buf)).rejects.toThrow(); });
  }
});

describe('normalizeImage', () => {
  test('re-encodes a valid image to a clean PNG of the same size', async () => {
    const out = await normalizeImage(png(64, 48));
    expect(out.subarray(0, 8).equals(SIG)).toBe(true);
    const img = await safeLoadImage(png(64, 48)); expect(img.width).toBe(64); expect(img.height).toBe(48);
  });
  test('downsizes to maxSide keeping the aspect ratio, never upsizes', async () => {
    const big = await safeLoadImage(png(3000, 1500), { maxSide: 1000 }); expect(big.width).toBe(1000); expect(big.height).toBe(500);
    const small = await safeLoadImage(png(300, 150), { maxSide: 1000 }); expect(small.width).toBe(300); expect(small.height).toBe(150);
  });
  test('keeps transparency', async () => {
    const c = createCanvas(20, 20); c.getContext('2d').clearRect(0, 0, 20, 20);
    const img = await safeLoadImage(c.toBuffer('image/png'));
    const c2 = createCanvas(20, 20); const x = c2.getContext('2d'); x.drawImage(img, 0, 0);
    expect(x.getImageData(5, 5, 1, 1).data[3]).toBe(0);
  });
  test('pixel bombs are refused before decoding', async () => {
    await expect(normalizeImage(png(7000, 6000))).rejects.toThrow(/too large/);
  }, 60_000);
  test('a valid image still works end to end through the QR scanner and vision helper', async () => {
    expect(await scanQrBuffer(await makeQr('still works'))).toBe('still works');
    expect(await toDataUri(png(50, 50))).toStartWith('data:image/png;base64,');
  });
});
