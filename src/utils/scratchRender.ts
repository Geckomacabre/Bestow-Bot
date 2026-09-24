import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureFonts, drawBackground, roundedRect, PALETTE } from './casinoRender.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '../../assets/fonts');

let emojiReady = false;
function ensureEmoji() {
  if (emojiReady) return;
  try { GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'twemoji.otf'), 'Twe'); } catch { /* ignore */ }
  emojiReady = true;
}

const CELL = 92;
const GAP = 10;
const PAD = 20;
const TITLE_H = 40;
const GRID = CELL * 3 + GAP * 2;
const W = GRID + PAD * 2;
const H = GRID + PAD * 2 + TITLE_H;

/**
 * Renders the finished scratch card: the 3x3 grid of symbols with every cell
 * that formed the winning match lit up. Static PNG — the scratching itself is
 * already interactive via the buttons, so this is the payoff image rather than
 * an animation (which would mean re-uploading on all nine clicks).
 */
export function renderScratchCard(symbols: string[], winningEmoji: string | null): Buffer {
  ensureFonts();
  ensureEmoji();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 21px CasinoB, sans-serif';
  ctx.fillStyle = PALETTE.gold;
  ctx.fillText('🎟️ SCRATCH CARD', W / 2, TITLE_H / 2 + 6);

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const x = PAD + c * (CELL + GAP);
      const y = TITLE_H + PAD + r * (CELL + GAP);
      const isWinner = winningEmoji !== null && symbols[i] === winningEmoji;

      roundedRect(ctx, x, y, CELL, CELL, 12);
      // Keep winning cells DARK behind the symbol — a pale gold wash greys out
      // light emoji (💎/⭐) and makes the losers look brighter than the winners.
      ctx.fillStyle = isWinner ? '#1b1608' : '#0b0f15';
      ctx.fill();
      ctx.lineWidth = isWinner ? 3 : 1.5;
      ctx.strokeStyle = isWinner ? PALETTE.gold : '#2b3543';
      ctx.stroke();

      ctx.font = '46px Twe, CasinoB, sans-serif';
      ctx.globalAlpha = isWinner || winningEmoji === null ? 1 : 0.35;
      if (isWinner) { ctx.shadowColor = PALETTE.gold; ctx.shadowBlur = 14; }
      ctx.fillText(symbols[i] ?? '❓', x + CELL / 2, y + CELL / 2 + 2);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }
  return canvas.toBuffer('image/png') as unknown as Buffer;
}
