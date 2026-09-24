import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import { ensureFonts, drawBackground, encodeGif, PALETTE } from './casinoRender.js';

const W = 340;
const H = 250;
const CX = W / 2;
const COIN_R = 52;
const GROUND_Y = 126;      // coin's resting centre
const SHADOW_Y = 190;      // ground shadow, clear of the coin
const LABEL_Y = H - 22;    // result text, clear of both
const TOSS_H = 58;         // arc height (keeps the coin fully on-canvas)

const FPS = 25;
const SPIN_FRAMES = 42;   // toss + spin
const HOLD_FRAMES = 20;   // freeze on the result

// Only two possible outcomes, so each GIF is rendered once and reused forever —
// no per-flip render cost.
const cache = new Map<'heads' | 'tails', Buffer>();

function drawFace(ctx: SKRSContext2D, side: 'heads' | 'tails', squash: number) {
  const rx = COIN_R * Math.max(0.06, Math.abs(squash));
  const ry = COIN_R;

  // Rim
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = side === 'heads' ? '#d9a520' : '#7d8794';
  ctx.fill();

  // Face
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.82, ry * 0.82, 0, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(-rx, -ry, rx, ry);
  if (side === 'heads') { g.addColorStop(0, '#ffd76a'); g.addColorStop(1, '#e0a828'); }
  else { g.addColorStop(0, '#cfd8e3'); g.addColorStop(1, '#8b95a3'); }
  ctx.fillStyle = g;
  ctx.fill();

  // Only draw the glyph when the coin is face-on enough to read
  if (Math.abs(squash) > 0.45) {
    ctx.save();
    ctx.scale(Math.abs(squash), 1);
    ctx.font = 'bold 40px CasinoB, sans-serif';
    ctx.fillStyle = side === 'heads' ? '#6b4a06' : '#38414d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(side === 'heads' ? 'H' : 'T', 0, 2);
    ctx.restore();
  }
}

function renderFrames(result: 'heads' | 'tails'): Buffer[] {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const frames: Buffer[] = [];

  // Number of half-turns; parity is adjusted so the coin ends on `result`.
  const halfTurns = 9;

  for (let i = 0; i < SPIN_FRAMES + HOLD_FRAMES; i++) {
    const spinning = i < SPIN_FRAMES;
    const t = spinning ? i / SPIN_FRAMES : 1;

    drawBackground(ctx, W, H);

    // Shadow on the ground, tightening as the coin comes down
    const tossY = Math.sin(Math.PI * t) * TOSS_H;       // arc up then back down
    const cy = GROUND_Y - tossY;
    ctx.beginPath();
    ctx.ellipse(CX, SHADOW_Y, 34 - tossY * 0.22, 7 - tossY * 0.04, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.38 - tossY * 0.0035})`;
    ctx.fill();

    // Spin: ease out so it slows into its final face.
    const eased = 1 - Math.pow(1 - t, 2.4);
    const angle = eased * Math.PI * halfTurns;
    let squash = Math.cos(angle);
    // Land exactly face-on showing the winning side.
    if (!spinning) squash = 1;
    const showing: 'heads' | 'tails' = spinning
      ? ((squash >= 0) === (result === 'heads') ? 'heads' : 'tails')
      : result;

    ctx.save();
    ctx.translate(CX, cy);
    ctx.shadowColor = result === 'heads' ? 'rgba(255,215,106,0.5)' : 'rgba(180,190,205,0.4)';
    ctx.shadowBlur = spinning ? 10 : 22;
    drawFace(ctx, showing, squash);
    ctx.restore();

    if (!spinning) {
      ctx.font = 'bold 26px CasinoB, sans-serif';
      ctx.fillStyle = result === 'heads' ? PALETTE.gold : '#cfd8e3';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(result === 'heads' ? 'HEADS' : 'TAILS', CX, LABEL_Y);
    }

    frames.push(canvas.toBuffer('image/png') as unknown as Buffer);
  }
  return frames;
}

/** How long the coin is in the air before it lands face-up on the result. */
export const FLIP_REVEAL_MS = Math.round((SPIN_FRAMES / FPS) * 1000);

/** Animated coin flip landing on `result`. Cached — only two outcomes exist. */
export async function renderCoinFlipGif(result: 'heads' | 'tails'): Promise<Buffer> {
  const hit = cache.get(result);
  if (hit) return hit;
  ensureFonts();
  const gif = await encodeGif(renderFrames(result), { fps: FPS, colors: 48 });
  cache.set(result, gif);
  return gif;
}
