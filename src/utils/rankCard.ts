import { createCanvas, GlobalFonts, loadImage, SKRSContext2D } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '../../assets/fonts');

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  try {
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'mplus.ttf'), 'Rank');
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'bold.ttf'), 'RankB');
  } catch {}
  fontsReady = true;
}

const W = 700;
const H = 190;
const ACCENT = '#4DD0E1';
const AVATAR_SIZE = 110;
const AVATAR_CX = 35 + AVATAR_SIZE / 2;
const AVATAR_CY = H / 2;

function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export async function buildRankCard(opts: {
  username: string;
  avatarUrl: string;
  rank: number;
  level: number;
  currentXp: number;
  xpNeeded: number;
  backgroundUrl?: string | null;
}): Promise<Buffer> {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.save();
  roundedRect(ctx, 0, 0, W, H, 22);
  ctx.clip();

  if (opts.backgroundUrl) {
    try {
      const bg = await loadImage(opts.backgroundUrl);
      const scale = Math.max(W / bg.width, H / bg.height);
      const bw = bg.width * scale, bh = bg.height * scale;
      ctx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
    } catch {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    // Gradient fallback
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0d0d1a');
    grad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // Dark overlay so text is always readable
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // ── Avatar ──────────────────────────────────────────────────────────────────
  try {
    const avatar = await loadImage(opts.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, AVATAR_CX - AVATAR_SIZE / 2, AVATAR_CY - AVATAR_SIZE / 2, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
    // Accent ring
    ctx.beginPath();
    ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_SIZE / 2 + 3, 0, Math.PI * 2);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 4;
    ctx.stroke();
  } catch {}

  const TEXT_X = 175;

  // ── RANK badge (top-right) ───────────────────────────────────────────────────
  const rankLabel = `RANK #${opts.rank}`;
  ctx.font = `bold 17px RankB, sans-serif`;
  const rankW = ctx.measureText(rankLabel).width + 22;
  const BADGE_X = W - rankW - 18;
  const BADGE_Y = 16;
  roundedRect(ctx, BADGE_X, BADGE_Y, rankW, 30, 7);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.fillText(rankLabel, BADGE_X + rankW / 2, BADGE_Y + 20);
  ctx.textAlign = 'left';

  // ── Username ─────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#fff';
  ctx.font = `bold 30px RankB, sans-serif`;
  ctx.fillText(opts.username, TEXT_X, 72);

  // ── Progress bar ─────────────────────────────────────────────────────────────
  const LEVEL_R = 22;
  const BAR_X = TEXT_X + LEVEL_R * 2 + 8;
  const BAR_Y = 105;
  const BAR_H = 26;
  const BAR_W = W - BAR_X - LEVEL_R * 2 - 28;
  const SEGS = 10;
  const GAP = 4;
  const segW = (BAR_W - (SEGS - 1) * GAP) / SEGS;
  const progress = Math.min(opts.currentXp / opts.xpNeeded, 1);
  const filled = Math.round(progress * SEGS);

  // Current level circle
  const lvlCX = TEXT_X + LEVEL_R;
  const lvlCY = BAR_Y + BAR_H / 2;
  ctx.beginPath();
  ctx.arc(lvlCX, lvlCY, LEVEL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2a3e';
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold 15px RankB, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(String(opts.level), lvlCX, lvlCY + 5);

  // Segments
  for (let i = 0; i < SEGS; i++) {
    const sx = BAR_X + i * (segW + GAP);
    roundedRect(ctx, sx, BAR_Y, segW, BAR_H, 4);
    ctx.fillStyle = i < filled ? ACCENT : '#2a2a3e';
    ctx.fill();
  }

  // Next level circle
  const nextCX = BAR_X + BAR_W + LEVEL_R + 6;
  ctx.beginPath();
  ctx.arc(nextCX, lvlCY, LEVEL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2a3e';
  ctx.fill();
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#aaa';
  ctx.font = `bold 15px RankB, sans-serif`;
  ctx.fillText(String(opts.level + 1), nextCX, lvlCY + 5);

  // XP text below bar
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ccc';
  ctx.font = `16px Rank, sans-serif`;
  ctx.fillText(`${opts.currentXp.toLocaleString()} / ${opts.xpNeeded.toLocaleString()}`, BAR_X + BAR_W / 2, BAR_Y + BAR_H + 22);

  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png') as unknown as Buffer;
}
