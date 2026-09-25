import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const FONTS_DIR = path.resolve(import.meta.dir, '../../assets/fonts');
export const WALLET_BG_DIR = path.resolve(import.meta.dir, '../../data/wallet_bg');

let fontsReady = false;
export function ensureFonts() {
  if (fontsReady) return;
  try {
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'mplus.ttf'), 'Rank');
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'bold.ttf'), 'RankB');
  } catch { /* fonts missing: fall back to sans-serif */ }
  fontsReady = true;
}

export function ensureWalletBgDir() {
  if (!existsSync(WALLET_BG_DIR)) mkdirSync(WALLET_BG_DIR, { recursive: true });
}

export function walletBgPath(userId: string): string {
  return path.join(WALLET_BG_DIR, `${userId.replace(/\D/g, '')}.png`);
}

export const HEX_RE = /^#?([0-9a-f]{6})$/i;
export function normHex(input: string): string | null {
  const m = HEX_RE.exec(input.trim());
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

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

export type AvatarShape = 'circle' | 'square' | 'rounded' | 'hexagon' | 'hidden';
export const AVATAR_SHAPES: AvatarShape[] = ['circle', 'rounded', 'square', 'hexagon', 'hidden'];

/** Splits a card message into at most two lines (~58 characters each), breaking on spaces where it can. */
export function wrapMessage(msg: string, width = 58): string[] {
  const text = msg.trim();
  if (text.length <= width) return [text];
  let cut = text.lastIndexOf(' ', width);
  if (cut < width * 0.5) cut = width;
  const first = text.slice(0, cut).trimEnd(), rest = text.slice(cut).trimStart();
  return [first, rest.length > width ? rest.slice(0, width - 1) + '…' : rest];
}

function avatarPath(ctx: SKRSContext2D, shape: AvatarShape, cx: number, cy: number, size: number) {
  const r = size / 2;
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
  else if (shape === 'square') ctx.rect(cx - r, cy - r, size, size);
  else if (shape === 'rounded') roundedRect(ctx, cx - r, cy - r, size, size, size * 0.22);
  else {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
}

export interface WalletStyle {
  avatarShape: AvatarShape;
  bgColor: string | null;
  bgColor2: string | null;
  bgDirection: 'horizontal' | 'vertical' | 'diagonal';
  hasBgImage: boolean;
  opacity: number;
  textColor: string | null;
  message: string | null;
  hideWallet: boolean;
}

export const DEFAULT_STYLE: WalletStyle = {
  avatarShape: 'circle', bgColor: null, bgColor2: null, bgDirection: 'horizontal',
  hasBgImage: false, opacity: 0.55, textColor: null, message: null, hideWallet: false,
};

export interface WalletCardOpts {
  userId: string;
  username: string;
  avatarUrl: string;
  currencySymbol: string;
  cash: number;
  bank: number;
  bankCap: number;
  networth: number;
  businessName: string | null;
  labLevel: number | null;
  companyTag: string | null;
  style: WalletStyle;
  /** Hide balances (privacy setting, and the viewer isn't the owner). */
  hidden: boolean;
}

const W = 800, H = 280;
const fmt = (n: number) => n.toLocaleString('en-US');

export async function renderWalletCard(o: WalletCardOpts): Promise<Buffer> {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const accent = o.style.textColor ?? '#4DD0E1';
  const text = o.style.textColor ?? '#ffffff';

  // ── Background ────────────────────────────────────────────────────────────
  ctx.save();
  roundedRect(ctx, 0, 0, W, H, 26);
  ctx.clip();
  let drewImage = false;
  if (o.style.hasBgImage) {
    try {
      const bg = await loadImage(walletBgPath(o.userId));
      const s = Math.max(W / bg.width, H / bg.height);
      ctx.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
      drewImage = true;
    } catch { /* file gone: fall through to colour */ }
  }
  if (!drewImage) {
    const c1 = o.style.bgColor ?? '#0d0d1a';
    const c2 = o.style.bgColor2 ?? (o.style.bgColor ? o.style.bgColor : '#1a1a2e');
    const [x1, y1, x2, y2] = o.style.bgDirection === 'vertical' ? [0, 0, 0, H] : o.style.bgDirection === 'diagonal' ? [0, 0, W, H] : [0, 0, W, 0];
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = `rgba(0,0,0,${Math.min(0.9, Math.max(0, o.style.opacity))})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // ── Avatar ────────────────────────────────────────────────────────────────
  const AV = 120, AX = 30 + AV / 2, AY = 30 + AV / 2;
  const showAvatar = o.style.avatarShape !== 'hidden';
  if (showAvatar) try {
    const avatar = await loadImage(o.avatarUrl);
    ctx.save();
    avatarPath(ctx, o.style.avatarShape, AX, AY, AV);
    ctx.clip();
    ctx.drawImage(avatar, AX - AV / 2, AY - AV / 2, AV, AV);
    ctx.restore();
    avatarPath(ctx, o.style.avatarShape, AX, AY, AV + 6);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.stroke();
  } catch { /* no avatar */ }

  // ── Title ─────────────────────────────────────────────────────────────────
  const TX = showAvatar ? 175 : 40;
  ctx.fillStyle = text;
  ctx.font = 'bold 32px RankB, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(o.username.length > 22 ? o.username.slice(0, 21) + '…' : o.username, TX, 62);
  if (o.companyTag) {
    ctx.font = 'bold 17px RankB, sans-serif';
    const w = ctx.measureText(`[${o.companyTag}]`).width;
    ctx.fillStyle = accent;
    ctx.fillText(`[${o.companyTag}]`, W - w - 28, 44);
  }

  // ── Balance rows ──────────────────────────────────────────────────────────
  const sym = o.currencySymbol;
  const rows: [string, string][] = o.hidden
    ? [['Net worth', '🔒 hidden'], ['Cash', '🔒 hidden'], ['Bank', '🔒 hidden']]
    : [
        ['Net worth', `${sym} ${fmt(o.networth)}`],
        ['Cash', `${sym} ${fmt(o.cash)}`],
        ['Bank', `${sym} ${fmt(o.bank)} / ${fmt(o.bankCap)}`],
      ];
  let y = 108;
  for (const [label, value] of rows) {
    ctx.fillStyle = accent;
    ctx.font = '17px Rank, sans-serif';
    ctx.fillText(label.toUpperCase(), TX, y);
    ctx.fillStyle = text;
    ctx.font = label === 'Net worth' ? 'bold 30px RankB, sans-serif' : 'bold 22px RankB, sans-serif';
    ctx.fillText(value, TX + 150, y + (label === 'Net worth' ? 2 : 0));
    y += label === 'Net worth' ? 40 : 34;
  }

  // ── Assets + message ──────────────────────────────────────────────────────
  const assets = [o.businessName ? `🏢 ${o.businessName}` : null, o.labLevel ? `🧪 Lab Lv.${o.labLevel}` : null].filter(Boolean).join('   ');
  ctx.fillStyle = text;
  ctx.globalAlpha = 0.85;
  ctx.font = '18px Rank, sans-serif';
  const msgLines = o.style.message ? wrapMessage(o.style.message) : [];
  if (assets) ctx.fillText(assets, 30, msgLines.length > 1 ? 206 : 214);
  if (msgLines.length) {
    ctx.font = 'italic 19px Rank, sans-serif';
    const last = msgLines.length - 1;
    msgLines.forEach((line, n) => ctx.fillText(`${n === 0 ? '“' : ''}${line}${n === last ? '”' : ''}`, 30, 252 - (last - n) * 22));
  }
  ctx.globalAlpha = 1;
  return canvas.toBuffer('image/png') as unknown as Buffer;
}

// ─── Wealth graph ────────────────────────────────────────────────────────────

export async function renderWealthGraph(opts: { title: string; series: { day: string; total: number }[]; symbol: string }): Promise<Buffer> {
  ensureFonts();
  const GW = 800, GH = 380;
  const canvas = createCanvas(GW, GH);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, GH);
  g.addColorStop(0, '#12122a');
  g.addColorStop(1, '#0a0a18');
  ctx.fillStyle = g;
  roundedRect(ctx, 0, 0, GW, GH, 22);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 24px RankB, sans-serif';
  ctx.fillText(opts.title, 34, 44);

  const pad = { l: 90, r: 40, t: 78, b: 56 };
  const cw = GW - pad.l - pad.r, ch = GH - pad.t - pad.b;
  const vals = opts.series.map(p => p.total);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min = Math.max(0, min - 1); max = max + 1; }
  const span = max - min;
  min = Math.max(0, min - span * 0.1);
  max = max + span * 0.1;

  // grid + y labels
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '14px Rank, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const yy = pad.t + (ch * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(GW - pad.r, yy); ctx.stroke();
    const v = max - ((max - min) * i) / 4;
    const label = v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v));
    ctx.fillText(label, pad.l - 10, yy + 5);
  }

  const n = opts.series.length;
  const px = (i: number) => pad.l + (n === 1 ? cw / 2 : (cw * i) / (n - 1));
  const py = (v: number) => pad.t + ch - ((v - min) / (max - min)) * ch;

  // area
  ctx.beginPath();
  opts.series.forEach((p, i) => (i === 0 ? ctx.moveTo(px(i), py(p.total)) : ctx.lineTo(px(i), py(p.total))));
  ctx.lineTo(px(n - 1), pad.t + ch);
  ctx.lineTo(px(0), pad.t + ch);
  ctx.closePath();
  const area = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
  area.addColorStop(0, 'rgba(77,208,225,0.35)');
  area.addColorStop(1, 'rgba(77,208,225,0)');
  ctx.fillStyle = area;
  ctx.fill();

  // line + points
  ctx.beginPath();
  opts.series.forEach((p, i) => (i === 0 ? ctx.moveTo(px(i), py(p.total)) : ctx.lineTo(px(i), py(p.total))));
  ctx.strokeStyle = '#4DD0E1';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = 'center';
  opts.series.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(px(i), py(p.total), 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#4DD0E1'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px Rank, sans-serif';
    ctx.fillText(p.day, px(i), GH - 24);
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '13px Rank, sans-serif';
  ctx.fillText(`Cash + bank, end of day (${opts.symbol})`, 34, GH - 24);
  return canvas.toBuffer('image/png') as unknown as Buffer;
}
