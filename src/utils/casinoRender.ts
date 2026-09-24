import { GlobalFonts, SKRSContext2D } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '../../assets/fonts');

let fontsReady = false;
/** Registers the fonts the casino renderers draw with (idempotent). */
export function ensureFonts() {
  if (fontsReady) return;
  try {
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'mplus.ttf'), 'Casino');
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'bold.ttf'), 'CasinoB');
  } catch { /* fall back to system fonts */ }
  fontsReady = true;
}

/** Shared accent palette so every game's art reads as one set. */
export const PALETTE = {
  bgTop: '#0e1116',
  bgBottom: '#171d26',
  gold: '#ffd76a',
  goldLight: '#fff6d0',
  win: '#8ee06b',
  lose: '#ff5c6c',
  dim: '#5b6879',
  text: '#e6edf3',
};

export function drawBackground(ctx: SKRSContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, PALETTE.bgTop);
  bg.addColorStop(1, PALETTE.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
}

export function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface GifOptions {
  fps?: number;
  /** false (default) plays once and holds the last frame; true loops forever. */
  loop?: boolean;
  colors?: number;
}

/**
 * Pipes PNG frames through ffmpeg (already in the image) into a palette-
 * optimised GIF. Shared by every casino game renderer.
 */
export function encodeGif(frames: Buffer[], opts: GifOptions = {}): Promise<Buffer> {
  const { fps = 25, loop = false, colors = 64 } = opts;
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-f', 'image2pipe', '-vcodec', 'png', '-r', String(fps), '-i', 'pipe:0',
      '-filter_complex', `[0:v] split [a][b];[a] palettegen=max_colors=${colors} [p];[b][p] paletteuse=dither=bayer:bayer_scale=3`,
      '-loop', loop ? '0' : '-1', '-f', 'gif', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const out: Buffer[] = [];
    let err = '';
    ff.stdout.on('data', (c) => out.push(c));
    ff.stderr.on('data', (c) => { err += c.toString(); });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0 && out.length) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`));
    });

    for (const f of frames) ff.stdin.write(f);
    ff.stdin.end();
  });
}
