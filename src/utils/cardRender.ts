import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import { ensureFonts, drawBackground, roundedRect, PALETTE } from './casinoRender.js';
import type { Card } from './cards.js';

const CARD_W = 76;
const CARD_H = 108;
const CARD_GAP = 10;
const PAD = 18;

const isRedSuit = (s: string) => s === '♥' || s === '♦';

/** Draws a single face-up card. `dim` fades cards that aren't being kept. */
function drawCard(ctx: SKRSContext2D, x: number, y: number, card: Card, opts: { dim?: boolean; glow?: boolean } = {}) {
  ctx.save();
  if (opts.dim) ctx.globalAlpha = 0.42;
  if (opts.glow) { ctx.shadowColor = PALETTE.gold; ctx.shadowBlur = 16; }

  roundedRect(ctx, x, y, CARD_W, CARD_H, 9);
  ctx.fillStyle = '#f7f4ee';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = opts.glow ? 3 : 1.5;
  ctx.strokeStyle = opts.glow ? PALETTE.gold : '#c9c2b4';
  ctx.stroke();

  const col = isRedSuit(card.suit) ? '#c0392b' : '#1b1f27';
  ctx.fillStyle = col;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 21px CasinoB, sans-serif';
  ctx.fillText(card.rank, x + 8, y + 7);

  // Big centre pip
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '40px CasinoB, sans-serif';
  ctx.fillText(card.suit, x + CARD_W / 2, y + CARD_H / 2 + 6);

  // Mirrored corner index
  ctx.save();
  ctx.translate(x + CARD_W - 8, y + CARD_H - 7);
  ctx.rotate(Math.PI);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 21px CasinoB, sans-serif';
  ctx.fillText(card.rank, 0, 0);
  ctx.restore();

  ctx.restore();
}

/** Draws a face-down card (dealer's hole card). */
function drawCardBack(ctx: SKRSContext2D, x: number, y: number) {
  roundedRect(ctx, x, y, CARD_W, CARD_H, 9);
  const g = ctx.createLinearGradient(x, y, x + CARD_W, y + CARD_H);
  g.addColorStop(0, '#2b3f63');
  g.addColorStop(1, '#16233a');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#54688f';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px CasinoB, sans-serif';
  ctx.fillStyle = '#7d94bf';
  ctx.fillText('★', x + CARD_W / 2, y + CARD_H / 2 + 2);
}

function rowWidth(n: number) { return n * CARD_W + (n - 1) * CARD_GAP; }

export interface HandRow {
  label: string;
  cards: Card[];
  /** Index-aligned flags: dim (not held) / glow (held or winning). */
  dim?: boolean[];
  glow?: boolean[];
  /** Render the card at this index face-down (dealer's hole card). */
  hideFrom?: number;
  /** Small text after the label, e.g. the hand value. */
  note?: string;
}

/**
 * Renders one or two hands as a table image. Used by blackjack (player/dealer)
 * and poker (single five-card hand with held cards highlighted). Static PNG —
 * these games are interactive, so a frame is drawn per decision rather than
 * baking one animation up front.
 */
export function renderTable(rows: HandRow[], title: string, footer?: string): Buffer {
  ensureFonts();
  const TITLE_H = 34;
  const ROW_H = CARD_H + 34;
  const widest = Math.max(...rows.map(r => rowWidth(Math.max(r.cards.length, 1))));
  const W = Math.max(widest + PAD * 2, 300);
  const H = TITLE_H + rows.length * ROW_H + PAD + (footer ? 26 : 0);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 20px CasinoB, sans-serif';
  ctx.fillStyle = PALETTE.gold;
  ctx.fillText(title, W / 2, TITLE_H / 2 + 4);

  rows.forEach((row, ri) => {
    const y = TITLE_H + ri * ROW_H + 8;
    ctx.textAlign = 'left';
    ctx.font = '14px CasinoB, sans-serif';
    ctx.fillStyle = PALETTE.dim;
    ctx.fillText(`${row.label}${row.note ? `  ${row.note}` : ''}`, PAD, y + 8);

    const startX = (W - rowWidth(Math.max(row.cards.length, 1))) / 2;
    row.cards.forEach((card, ci) => {
      const x = startX + ci * (CARD_W + CARD_GAP);
      const cy = y + 20;
      if (row.hideFrom !== undefined && ci >= row.hideFrom) drawCardBack(ctx, x, cy);
      else drawCard(ctx, x, cy, card, { dim: row.dim?.[ci], glow: row.glow?.[ci] });
    });
  });

  if (footer) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px CasinoB, sans-serif';
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(footer, W / 2, H - 16);
  }
  return canvas.toBuffer('image/png') as unknown as Buffer;
}
