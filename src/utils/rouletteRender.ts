import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import { ensureFonts, drawBackground, encodeGif, PALETTE } from './casinoRender.js';

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// Numbers 1..36 laid out around the wheel (game has no zero pocket).
const ORDER = Array.from({ length: 36 }, (_, i) => i + 1);
const N = ORDER.length;
const SEG = (Math.PI * 2) / N;

const SIZE = 380;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_OUT = 176;   // outer rim
const R_NUM = 150;   // number ring
const R_IN = 120;    // inner hub edge
const R_BALL = 162;  // ball orbit radius

const FPS = 25;
const SPIN_FRAMES = 55;
const HOLD_FRAMES = 22;

const pocketColor = (n: number) => (RED.has(n) ? '#c0392b' : '#1c2128');

function drawWheel(ctx: SKRSContext2D, rot: number) {
  // Outer rim
  ctx.beginPath();
  ctx.arc(CX, CY, R_OUT + 8, 0, Math.PI * 2);
  ctx.fillStyle = '#3a2a15';
  ctx.fill();

  // Pockets
  for (let i = 0; i < N; i++) {
    const a0 = rot + i * SEG - SEG / 2 - Math.PI / 2;
    const a1 = a0 + SEG;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, R_OUT, a0, a1);
    ctx.closePath();
    ctx.fillStyle = pocketColor(ORDER[i]!);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#0a0d12';
    ctx.stroke();
  }

  // Numbers
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px CasinoB, sans-serif';
  ctx.fillStyle = '#f2ede3';
  for (let i = 0; i < N; i++) {
    const a = rot + i * SEG - Math.PI / 2;
    const x = CX + Math.cos(a) * R_NUM;
    const y = CY + Math.sin(a) * R_NUM;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(String(ORDER[i]), 0, 0);
    ctx.restore();
  }

  // Hub
  ctx.beginPath();
  ctx.arc(CX, CY, R_IN, 0, Math.PI * 2);
  const hub = ctx.createRadialGradient(CX, CY - 30, 10, CX, CY, R_IN);
  hub.addColorStop(0, '#5b4a2e');
  hub.addColorStop(1, '#2a2013');
  ctx.fillStyle = hub;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(CX, CY, 34, 0, Math.PI * 2);
  ctx.fillStyle = '#7d6a44';
  ctx.fill();
}

function drawBall(ctx: SKRSContext2D, angle: number, drop: number) {
  const r = R_BALL - drop * (R_BALL - R_NUM - 4);
  const x = CX + Math.cos(angle - Math.PI / 2) * r;
  const y = CY + Math.sin(angle - Math.PI / 2) * r;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#f5f6f8';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(x - 2, y - 2.4, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

function renderFrames(result: number): Buffer[] {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const frames: Buffer[] = [];

  const idx = ORDER.indexOf(result);
  // Final wheel rotation so the result pocket sits under the top pointer.
  const finalRot = -idx * SEG;
  const wheelTurns = 3;           // full spins before settling
  const ballTurns = 6;            // ball orbits (opposite dir), decelerating

  const total = SPIN_FRAMES + HOLD_FRAMES;
  for (let i = 0; i < total; i++) {
    const spinning = i < SPIN_FRAMES;
    const t = spinning ? i / SPIN_FRAMES : 1;
    const eased = 1 - Math.pow(1 - t, 3);   // ease-out cubic

    const rot = finalRot - (1 - eased) * wheelTurns * Math.PI * 2;
    const ballAngle = -(finalRot) + (1 - eased) * ballTurns * Math.PI * 2;
    // Ball drops from the rim into the pocket over the last third of the spin.
    const drop = spinning ? Math.max(0, (t - 0.66) / 0.34) : 1;

    drawBackground(ctx, SIZE, SIZE);
    drawWheel(ctx, rot);
    // On settle the ball sits exactly at the top pointer (the result pocket).
    drawBall(ctx, spinning ? ballAngle : 0, drop);

    // Top pointer
    ctx.beginPath();
    ctx.moveTo(CX, 10);
    ctx.lineTo(CX - 10, -6);
    ctx.lineTo(CX + 10, -6);
    ctx.closePath();
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();

    if (!spinning) {
      // Result chip in the centre
      ctx.beginPath();
      ctx.arc(CX, CY, 32, 0, Math.PI * 2);
      ctx.fillStyle = pocketColor(result);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.gold;
      ctx.stroke();
      ctx.font = 'bold 30px CasinoB, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(result), CX, CY + 1);
    }
    frames.push(canvas.toBuffer('image/png') as unknown as Buffer);
  }
  return frames;
}

/** How long the wheel spins before the ball settles into its pocket. */
export const ROULETTE_REVEAL_MS = Math.round((SPIN_FRAMES / FPS) * 1000);

/** Animated roulette: wheel + ball spin and settle on `result` (1–36). */
export async function renderRouletteGif(result: number): Promise<Buffer> {
  ensureFonts();
  return encodeGif(renderFrames(result), { fps: FPS, colors: 64 });
}
