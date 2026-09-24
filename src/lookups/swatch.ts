import { createCanvas } from '@napi-rs/canvas';
import { ensureFonts } from '../eco/render.js';
import { readableOn, toHex, type RGB } from './color.js';

/** A horizontal strip of colour blocks, each labelled with its hex code — used by /tools color, palette and gradient. */
export function swatch(colors: RGB[], opts: { height?: number; blockWidth?: number } = {}): Buffer {
  ensureFonts();
  const n = Math.min(30, Math.max(1, colors.length));
  const h = opts.height ?? 140;
  const bw = opts.blockWidth ?? (n <= 6 ? 130 : n <= 12 ? 80 : 40);
  const c = createCanvas(bw * n, h);
  const ctx = c.getContext('2d');
  colors.slice(0, n).forEach((col, i) => {
    ctx.fillStyle = toHex(col);
    ctx.fillRect(i * bw, 0, bw, h);
    if (bw >= 70) {
      ctx.fillStyle = readableOn(col) === 'black' ? '#000000cc' : '#ffffffdd';
      ctx.font = `bold ${bw >= 120 ? 18 : 13}px RankB, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(toHex(col).toUpperCase(), i * bw + bw / 2, h - 16);
    }
  });
  return c.toBuffer('image/png');
}
