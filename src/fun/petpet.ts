import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { safeLoadImage } from '../framework/imgsafe.js';
import { encodeGif } from '../utils/casinoRender.js';

/** The "pet pet" meme: a hand pats an avatar, which squashes under each pat. Drawn from scratch, so there are no sprite assets to ship. */

export const SIZE = 128;
export const FRAMES = 10;
const FPS = 20;

const SKIN = '#f4c7a1', SKIN_DARK = '#d79f77';

function hand(ctx: SKRSContext2D, cx: number, top: number) {
  ctx.lineWidth = 2; ctx.strokeStyle = SKIN_DARK; ctx.fillStyle = SKIN;
  const rr = (x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke(); };
  for (let n = 0; n < 4; n++) rr(cx - 26 + n * 14, top + 14, 12, 30 - (n === 0 || n === 3 ? 6 : 0), 6); // fingers
  rr(cx - 32, top, 64, 28, 12);                                                                       // palm
  rr(cx + 22, top + 12, 24, 12, 6);                                                                    // thumb
}

/** One frame: `press` runs 0 (hand up, avatar round) → 1 (hand down, avatar squashed). */
export function drawFrame(ctx: SKRSContext2D, avatar: Awaited<ReturnType<typeof safeLoadImage>>, press: number) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  const w = 92 + 14 * press, h = 92 - 24 * press;
  const x = (SIZE - w) / 2, y = SIZE - h - 4;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.3); ctx.clip();
  ctx.drawImage(avatar, x, y, w, h);
  ctx.restore();
  hand(ctx, SIZE / 2 + 2, y - 28 + 12 * press);
}

/** The looping pet-pet GIF for an avatar image (any format the image loader accepts). */
export async function petpetGif(avatarBytes: Buffer): Promise<Buffer> {
  const avatar = await safeLoadImage(avatarBytes, { maxSide: 512 });
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const frames: Buffer[] = [];
  for (let k = 0; k < FRAMES; k++) {
    const press = (Math.sin((k / FRAMES) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    drawFrame(ctx, avatar, press);
    frames.push(canvas.toBuffer('image/png') as unknown as Buffer);
  }
  return encodeGif(frames, { fps: FPS, loop: true, colors: 128 });
}
