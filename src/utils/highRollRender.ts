import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import { ensureFonts, drawBackground, roundedRect, encodeGif, PALETTE } from './casinoRender.js';
import { randInt } from './random.js';

const W = 440;
const H = 220;
const PANEL_W = 176;
const PANEL_H = 118;
const PANEL_Y = 46;
const GAP = 28;
const LEFT_X = (W - PANEL_W * 2 - GAP) / 2;
const RIGHT_X = LEFT_X + PANEL_W + GAP;

const FPS = 25;
const SPIN_FRAMES = 34;   // both counters blur through numbers
const HOLD_FRAMES = 24;   // settle on the result

function drawPanel(
  ctx: SKRSContext2D, x: number, title: string, value: number,
  state: 'spin' | 'win' | 'lose' | 'tie',
) {
  const col = state === 'win' ? PALETTE.win : state === 'lose' ? PALETTE.lose
    : state === 'tie' ? PALETTE.gold : PALETTE.dim;

  roundedRect(ctx, x, PANEL_Y, PANEL_W, PANEL_H, 14);
  ctx.fillStyle = '#10151c';
  ctx.fill();
  ctx.lineWidth = state === 'spin' ? 1.5 : 3;
  ctx.strokeStyle = col;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = '15px CasinoB, sans-serif';
  ctx.fillStyle = col;
  ctx.textBaseline = 'top';
  ctx.fillText(title, x + PANEL_W / 2, PANEL_Y + 12);

  ctx.font = 'bold 56px CasinoB, sans-serif';
  ctx.fillStyle = state === 'spin' ? '#9fb0c3' : PALETTE.text;
  ctx.textBaseline = 'middle';
  if (state === 'win' || state === 'tie') { ctx.shadowColor = col; ctx.shadowBlur = 18; }
  ctx.fillText(String(value), x + PANEL_W / 2, PANEL_Y + PANEL_H / 2 + 12);
  ctx.shadowBlur = 0;
}

function renderFrames(player: number, bot: number): Buffer[] {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const frames: Buffer[] = [];
  const total = SPIN_FRAMES + HOLD_FRAMES;

  const win = player > bot, tie = player === bot;
  const pState = tie ? 'tie' : win ? 'win' : 'lose';
  const bState = tie ? 'tie' : win ? 'lose' : 'win';

  for (let i = 0; i < total; i++) {
    const spinning = i < SPIN_FRAMES;
    drawBackground(ctx, W, H);

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px CasinoB, sans-serif';
    ctx.fillStyle = PALETTE.gold;
    ctx.textBaseline = 'top';
    ctx.fillText('🎲 HIGH ROLL', W / 2, 12);

    // Counters slow down as they approach the end (ease-out), so it reads as
    // "rolling" rather than a static flicker.
    const t = i / SPIN_FRAMES;
    const settleP = spinning && randInt(0, 100) < t * t * 100 ? false : spinning;
    const pv = spinning && settleP ? randInt(1, 100) : player;
    const bv = spinning && settleP ? randInt(1, 100) : bot;

    drawPanel(ctx, LEFT_X, 'YOU', pv, spinning ? 'spin' : pState);
    drawPanel(ctx, RIGHT_X, 'BOT', bv, spinning ? 'spin' : bState);

    if (!spinning) {
      ctx.font = 'bold 20px CasinoB, sans-serif';
      ctx.fillStyle = tie ? PALETTE.gold : win ? PALETTE.win : PALETTE.lose;
      ctx.textBaseline = 'bottom';
      ctx.fillText(tie ? "IT'S A TIE" : win ? 'YOU WIN' : 'YOU LOSE', W / 2, H - 8);
    }
    frames.push(canvas.toBuffer('image/png') as unknown as Buffer);
  }
  return frames;
}

/** How long the counters spin before locking on the final rolls. */
export const HIGHROLL_REVEAL_MS = Math.round((SPIN_FRAMES / FPS) * 1000);

/** Animated High Roll: two counters spin, then lock on the given values. */
export async function renderHighRollGif(player: number, bot: number): Promise<Buffer> {
  ensureFonts();
  return encodeGif(renderFrames(player, bot), { fps: FPS, colors: 48 });
}
