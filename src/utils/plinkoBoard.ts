import { createCanvas, GlobalFonts, SKRSContext2D } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '../../assets/fonts');

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  try {
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'mplus.ttf'), 'Plinko');
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'bold.ttf'), 'PlinkoB');
  } catch { /* fall back to system fonts */ }
  fontsReady = true;
}

// 10 bounces -> 11 buckets. Fewer rows than a "classic" 12 on purpose: the
// binomial gets sharper with every extra row, and at 12 the middle three
// buckets swallowed 61% of all drops, so anything good was unreachable.
export const ROWS = 10;
const HALF_UNITS = 2 * ROWS;             // ball x lives on 0..24 half-units
const START_X = ROWS;                    // enters dead centre

const W = 460;
const H = 560;
const PAD_X = 26;
const TOP_Y = 40;
const BUCKET_H = 46;
const BUCKET_Y = H - BUCKET_H - 14;
const ROW_H = (BUCKET_Y - TOP_Y) / (ROWS + 1);
const UNIT = (W - PAD_X * 2) / HALF_UNITS;
const BALL_R = 7;

const FPS = 25;
const FRAMES_PER_ROW = 5;                // 12 rows * 5 = 60 frames (~2.4s)
const HOLD_FRAMES = 22;                  // freeze on the result at the end

const px = (x: number) => PAD_X + x * UNIT;
const py = (row: number) => TOP_Y + row * ROW_H;

// Colour per multiplier tier — hot at the edges, cold in the middle.
function bucketColor(mult: number): string {
  if (mult >= 100) return '#ff3d5a';
  if (mult >= 20) return '#ff8a3d';
  if (mult >= 4) return '#ffc93d';
  if (mult >= 2) return '#8ee06b';
  if (mult >= 1) return '#4dd0e1';
  if (mult >= 0.3) return '#5a6b7d';
  return '#3c4756';
}

function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Builds the ball's on-screen path. The landing bucket is decided by the caller
 * (fair binomial RNG) and passed in as `steps` — this only interpolates a
 * smooth, physical-looking descent that is guaranteed to end in that bucket, so
 * the animation can look organic without affecting the odds.
 */
function buildTrajectory(steps: number[]): { x: number; y: number; squash: number }[] {
  const pts: { x: number; y: number; squash: number }[] = [];
  let x = START_X;

  for (let r = 0; r < steps.length; r++) {
    const nx = x + steps[r]!;
    const y0 = r, y1 = r + 1;
    for (let f = 0; f < FRAMES_PER_ROW; f++) {
      const t = f / FRAMES_PER_ROW;
      // Horizontal: ease-out so it darts off the peg then settles.
      const hx = x + (nx - x) * (1 - Math.pow(1 - t, 2.2));
      // Vertical: accelerate under "gravity" across the row.
      const vy = y0 + (y1 - y0) * (t * t * 0.72 + t * 0.28);
      // Squash just after bouncing off a peg, easing back to round. Skipped on
      // the first row — the ball hasn't hit anything yet when it's released.
      const squash = r > 0 && t < 0.3 ? 1 - (0.3 - t) * 0.7 : 1;
      pts.push({ x: hx, y: vy, squash });
    }
    x = nx;
  }

  // Settle into the bucket with a small dampened bounce.
  const restY = ROWS + 0.62;
  const bounce = [0.24, 0.44, 0.30, 0.50, 0.56, 0.60, restY - ROWS];
  for (const b of bounce) pts.push({ x, y: ROWS + b, squash: 1 });
  for (let i = 0; i < HOLD_FRAMES; i++) pts.push({ x, y: restY, squash: 1 });
  return pts;
}

function drawFrame(
  ctx: SKRSContext2D, mults: number[], bucket: number,
  ball: { x: number; y: number; squash: number }, trail: { x: number; y: number }[],
  landed: boolean,
) {
  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0e1116');
  bg.addColorStop(1, '#171d26');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Pegs
  for (let r = 1; r <= ROWS; r++) {
    for (let hx = START_X - r; hx <= START_X + r; hx += 2) {
      const cx = px(hx), cy = py(r);
      ctx.beginPath();
      ctx.arc(cx, cy, 3.1, 0, Math.PI * 2);
      ctx.fillStyle = '#5b6879';
      ctx.fill();
    }
  }

  // Buckets
  const bw = UNIT * 2 - 3;
  for (let k = 0; k <= ROWS; k++) {
    const cx = px(k * 2);
    const col = bucketColor(mults[k]!);
    const win = landed && k === bucket;
    ctx.globalAlpha = win ? 1 : 0.82;
    roundedRect(ctx, cx - bw / 2, BUCKET_Y, bw, BUCKET_H, 6);
    ctx.fillStyle = win ? col : col + '33';
    ctx.fill();
    ctx.lineWidth = win ? 2.5 : 1;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const label = mults[k]! >= 1 ? `${mults[k]}x` : `${mults[k]}x`;
    ctx.font = `${win ? 'bold ' : ''}13px PlinkoB, sans-serif`;
    ctx.fillStyle = win ? '#0e1116' : col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, BUCKET_Y + BUCKET_H / 2);
  }

  // Trail
  trail.forEach((t, i) => {
    const a = ((i + 1) / (trail.length + 1)) * 0.5;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(px(t.x), py(t.y), BALL_R * (0.45 + a), 0, Math.PI * 2);
    ctx.fillStyle = '#ffd76a';
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Ball (with squash on peg contact + glow)
  const bx = px(ball.x), by = py(ball.y);
  ctx.save();
  ctx.translate(bx, by);
  ctx.scale(1 / ball.squash, ball.squash);
  ctx.shadowColor = '#ffcf4d';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd76a';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(-2.2, -2.4, BALL_R * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = '#fff6d0';
  ctx.fill();
  ctx.restore();
}

/** How long the ball falls (incl. its settle bounce) before it comes to rest. */
export const PLINKO_REVEAL_MS = Math.round(((ROWS * FRAMES_PER_ROW + 7) / FPS) * 1000);

/**
 * Renders the whole drop and encodes it as an animated GIF (plays once, then
 * holds on the result). `steps` are the per-row ±1 bounces already decided by
 * the caller's fair RNG.
 */
export async function renderPlinkoGif(steps: number[], mults: number[], bucket: number): Promise<Buffer> {
  ensureFonts();
  const traj = buildTrajectory(steps);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const frames: Buffer[] = [];
  for (let i = 0; i < traj.length; i++) {
    const trail = traj.slice(Math.max(0, i - 3), i).map(p => ({ x: p.x, y: p.y }));
    drawFrame(ctx, mults, bucket, traj[i]!, trail, i >= traj.length - HOLD_FRAMES - 7);
    frames.push(canvas.toBuffer('image/png') as unknown as Buffer);
  }
  return encodeGif(frames);
}

// Pipes PNG frames through ffmpeg (already in the image) into a palette-
// optimised GIF. -loop -1 plays it once instead of looping forever.
function encodeGif(frames: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-f', 'image2pipe', '-vcodec', 'png', '-r', String(FPS), '-i', 'pipe:0',
      '-filter_complex', '[0:v] split [a][b];[a] palettegen=max_colors=64 [p];[b][p] paletteuse=dither=bayer:bayer_scale=3',
      '-loop', '-1', '-f', 'gif', 'pipe:1',
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
