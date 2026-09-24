import { createCanvas, GlobalFonts, SKRSContext2D } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureFonts, drawBackground, roundedRect, encodeGif, PALETTE } from './casinoRender.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '../../assets/fonts');

let emojiReady = false;
function ensureEmoji() {
  if (emojiReady) return;
  try { GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'twemoji.otf'), 'Twe'); } catch { /* ignore */ }
  emojiReady = true;
}

// Symbol pool used purely for the blur between stops — the final symbols come
// from the caller (the game already decided them).
const POOL = ['🍒', '🍋', '🔔', '💎', '7️⃣'];

const W = 420;
const H = 220;
const REEL_W = 112;
const REEL_H = 132;
const REEL_Y = 52;
const GAP = 14;
const REELS = 3;
const TOTAL_W = REEL_W * REELS + GAP * (REELS - 1);
const LEFT = (W - TOTAL_W) / 2;

const FPS = 25;
// Reels stop left -> right, so the last symbol lands with a beat of suspense.
const STOP_AT = [26, 36, 46];
const SPIN_FRAMES = STOP_AT[REELS - 1]!;
const HOLD_FRAMES = 24;

function drawReel(
  ctx: SKRSContext2D, x: number, symbol: string, offset: number,
  spinning: boolean, highlight: boolean,
) {
  ctx.save();
  roundedRect(ctx, x, REEL_Y, REEL_W, REEL_H, 12);
  ctx.fillStyle = '#0b0f15';
  ctx.fill();
  ctx.lineWidth = highlight ? 3 : 1.5;
  ctx.strokeStyle = highlight ? PALETTE.gold : '#2b3543';
  ctx.stroke();
  ctx.clip();

  ctx.font = '58px Twe, CasinoB, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = x + REEL_W / 2;
  const cy = REEL_Y + REEL_H / 2;

  if (spinning) {
    // One symbol per cell, scrolling continuously downward. `scroll` is the
    // position within the current cell and `base` advances as cells pass, so
    // symbols glide instead of jumping or stacking on top of each other.
    const cell = REEL_H;
    const scroll = offset % cell;
    const base = Math.floor(offset / cell);
    ctx.globalAlpha = 0.8;
    for (let k = -1; k <= 1; k++) {
      const sy = cy + scroll + k * cell;
      const idx = (((base - k) % POOL.length) + POOL.length) % POOL.length;
      ctx.fillText(POOL[idx]!, cx, sy);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillText(symbol, cx, cy);
  }
  ctx.restore();
}

function renderFrames(symbols: string[], win: boolean): Buffer[] {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const frames: Buffer[] = [];
  const total = SPIN_FRAMES + HOLD_FRAMES;

  for (let i = 0; i < total; i++) {
    drawBackground(ctx, W, H);

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px CasinoB, sans-serif';
    ctx.fillStyle = PALETTE.gold;
    ctx.textBaseline = 'top';
    ctx.fillText('🎰 SLOTS', W / 2, 14);

    for (let r = 0; r < REELS; r++) {
      const spinning = i < STOP_AT[r]!;
      const x = LEFT + r * (REEL_W + GAP);
      drawReel(ctx, x, symbols[r]!, i * 34, spinning, !spinning && win);
    }

    if (i >= SPIN_FRAMES && win) {
      ctx.font = 'bold 19px CasinoB, sans-serif';
      ctx.fillStyle = PALETTE.gold;
      ctx.textBaseline = 'bottom';
      ctx.fillText('WINNER', W / 2, H - 10);
    }
    frames.push(canvas.toBuffer('image/png') as unknown as Buffer);
  }
  return frames;
}

/** Time until the last reel stops and the line is readable. */
export const SLOTS_REVEAL_MS = Math.round((SPIN_FRAMES / FPS) * 1000);

/** Animated slots: reels blur, then stop left→right on the given symbols. */
export async function renderSlotsGif(symbols: string[], win: boolean): Promise<Buffer> {
  ensureFonts();
  ensureEmoji();
  return encodeGif(renderFrames(symbols, win), { fps: FPS, colors: 64 });
}
