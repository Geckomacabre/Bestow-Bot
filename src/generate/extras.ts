import path from 'node:path';
import { createCanvas, GlobalFonts, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { avatar, NOTICE } from './discord.js';

/** /generate: TikTok follow notification, Among Us role card, Spotify lyrics, AI watermarks and the tier list image. */

const FONTS = path.resolve(import.meta.dir, '../../assets/fonts');
let ready = false;
function fonts() {
  if (ready) return;
  const reg = (file: string, name: string) => { try { GlobalFonts.registerFromPath(path.join(FONTS, file), name); } catch { /* sans-serif */ } };
  reg('display/Figtree-Regular.ttf', 'DGG'); reg('display/Figtree-SemiBold.ttf', 'DGGSemi'); reg('display/Figtree-Bold.ttf', 'DGGBold');
  reg('Circular.ttf', 'XCircular'); reg('twemoji.otf', 'Emoji');
  ready = true;
}
const f = (px: number, w: 'reg' | 'semi' | 'bold' = 'reg') => `${px}px ${w === 'bold' ? 'DGGBold' : w === 'semi' ? 'DGGSemi' : 'DGG'}, Emoji, sans-serif`;
const TAU = Math.PI * 2;

function fit(ctx: SKRSContext2D, text: string, maxW: number): string {
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  return t === text ? t : `${t.trimEnd()}…`;
}

// ─── TikTok ──────────────────────────────────────────────────────────────────

/** TikTok's activity row: "<name> started following you. 6d" with a red Follow back button. */
export function renderTikTokFollow(o: { name: string; avatar?: Image | null; ago: string; theme?: 'Dark' | 'Black' }): Buffer {
  fonts();
  const W = 600, H = 104, bg = o.theme === 'Black' ? '#000000' : '#121212';
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  avatar(ctx, o.avatar, 18, 20, 64, o.name);
  ctx.font = f(17, 'bold'); ctx.fillStyle = '#ffffff';
  const name = fit(ctx, o.name, 300);
  ctx.fillText(name, 98, 46);
  ctx.font = f(15); ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('started following you. ', 98, 72);
  const w = ctx.measureText('started following you. ').width;
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText(o.ago, 98 + w, 72);
  ctx.fillStyle = '#fe2c55'; ctx.beginPath(); ctx.roundRect(W - 142, 34, 124, 36, 4); ctx.fill();
  ctx.font = f(15, 'semi'); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('Follow back', W - 80, 58); ctx.textAlign = 'left';
  ctx.save(); ctx.globalAlpha = 0.5; ctx.font = f(10); ctx.fillStyle = '#8a8a8a'; ctx.textAlign = 'right'; ctx.fillText(NOTICE, W - 8, H - 6); ctx.restore();
  return c.toBuffer('image/png');
}

// ─── Among Us ────────────────────────────────────────────────────────────────

const IMPOSTOR = /impost|imposter|shapeshift|phantom|killer|traitor/i;
/** Role text colour: red for impostor-type roles, the crewmate cyan otherwise (a few known roles have their own). */
export function roleColor(role: string): string {
  if (IMPOSTOR.test(role)) return '#ff1919';
  const known: Record<string, string> = { engineer: '#f6b21b', scientist: '#00b3ff', 'guardian angel': '#d9d9d9', tracker: '#4e9a3e', noisemaker: '#e05bff' };
  return known[role.trim().toLowerCase()] ?? '#8cf3ff';
}

function crewmate(ctx: SKRSContext2D, x: number, y: number, s: number, color: string) {
  ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = s * 0.06;
  ctx.beginPath(); ctx.roundRect(x - s * 0.62, y - s * 0.15, s * 0.3, s * 0.6, s * 0.1); ctx.fill(); ctx.stroke(); // backpack
  ctx.beginPath(); ctx.moveTo(x - s * 0.35, y + s * 0.75); ctx.lineTo(x - s * 0.35, y - s * 0.2); ctx.quadraticCurveTo(x - s * 0.35, y - s * 0.75, x + s * 0.05, y - s * 0.75); ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.75, x + s * 0.45, y - s * 0.2);
  ctx.lineTo(x + s * 0.45, y + s * 0.75); ctx.lineTo(x + s * 0.12, y + s * 0.75); ctx.lineTo(x + s * 0.12, y + s * 0.5); ctx.lineTo(x - s * 0.05, y + s * 0.5); ctx.lineTo(x - s * 0.05, y + s * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke();
  const visor = ctx.createLinearGradient(0, y - s * 0.45, 0, y - s * 0.1); visor.addColorStop(0, '#d4f1ff'); visor.addColorStop(1, '#6aa7c3');
  ctx.fillStyle = visor; ctx.beginPath(); ctx.roundRect(x - s * 0.05, y - s * 0.48, s * 0.62, s * 0.36, s * 0.18); ctx.fill(); ctx.stroke();
}

/** The role reveal screen. With `frames` > 1, the title grows in and the stars drift (for a GIF). */
export function renderAmongUs(o: { role: string; description?: string | null }, frames = 1): Buffer[] {
  fonts();
  const W = 960, H = 540, col = roleColor(o.role), stars = Array.from({ length: 90 }, (_, k) => [(k * 97.13) % W, (k * 53.7 + (k % 7) * 31) % H, 0.5 + ((k * 13) % 10) / 10] as const);
  const bodies = ['#c51111', '#132ed1', '#117f2d', '#ed54ba', '#ef7d0d', '#f5f557', '#3f474e', '#d6e0f0'];
  const out: Buffer[] = [];
  for (let k = 0; k < frames; k++) {
    const t = frames > 1 ? k / (frames - 1) : 1;
    const c = createCanvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    for (const [sx, sy, r] of stars) { ctx.fillStyle = `rgba(255,255,255,${0.35 + r * 0.4})`; ctx.beginPath(); ctx.arc(((sx - t * 40 * r) % W + W) % W, sy, r, 0, TAU); ctx.fill(); }
    const grow = frames > 1 ? Math.min(1, 0.6 + t * 0.8) : 1;
    ctx.save(); ctx.translate(W / 2, 150); ctx.scale(grow, grow);
    ctx.font = f(92, 'bold'); ctx.textAlign = 'center';
    const title = fit(ctx, o.role.trim() || 'Impostor', W - 80);
    ctx.shadowColor = col; ctx.shadowBlur = 24; ctx.fillStyle = col; ctx.fillText(title, 0, 30);
    ctx.restore();
    if (o.description) {
      ctx.font = f(28, 'semi'); ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff';
      ctx.fillText(fit(ctx, o.description.trim(), W - 120), W / 2, 240);
    }
    ctx.textAlign = 'left';
    // The role's player in front, others behind in the dark
    const imp = IMPOSTOR.test(o.role);
    for (let n = 0; n < 4; n++) {
      const side = n % 2 ? 1 : -1, off = Math.floor(n / 2) + 1;
      ctx.globalAlpha = 0.35; crewmate(ctx, W / 2 + side * off * 120, 410, 70, bodies[(n + 2) % bodies.length]!); ctx.globalAlpha = 1;
    }
    crewmate(ctx, W / 2, 400, 110, imp ? '#c51111' : '#132ed1');
    ctx.save(); ctx.globalAlpha = 0.5; ctx.font = f(10); ctx.fillStyle = '#9a9a9a'; ctx.textAlign = 'right'; ctx.fillText(NOTICE.replace(' · not a real screenshot', ''), W - 8, H - 6); ctx.restore();
    out.push(c.toBuffer('image/png'));
  }
  return out;
}

// ─── Spotify lyrics ──────────────────────────────────────────────────────────

export const LYRIC_BACKGROUNDS = { Teal: '#0e6d6f', Forest: '#2f5d2a', Plum: '#6c2c5d', Midnight: '#1c2951', Rust: '#9b3d1d', Slate: '#4a5462' } as const;
export const LYRIC_SIZES = { Small: 30, Medium: 40, Large: 52 } as const;

/** Lines in Spotify's lyrics view: big bold Circular in white on a colour; *text* is italic. */
export function renderSpotifyLyrics(lines: string[], o: { size?: keyof typeof LYRIC_SIZES; background?: keyof typeof LYRIC_BACKGROUNDS } = {}): Buffer {
  fonts();
  const px = LYRIC_SIZES[o.size ?? 'Large'], bg = LYRIC_BACKGROUNDS[o.background ?? 'Teal'];
  const W = 900, P = 56, lh = Math.round(px * 1.28), maxW = W - P * 2;
  const font = (italic: boolean) => `${italic ? 'italic ' : ''}${px}px XCircular, DGGBold, Emoji, sans-serif`;
  const probe = createCanvas(4, 4).getContext('2d');
  // Wrap each line into rows of (text, italic) runs.
  type R = { t: string; it: boolean; x: number };
  const rows: R[][] = [];
  for (const line of lines.filter(l => l.trim())) {
    const runs = line.split(/(\*[^*]+\*)/).filter(Boolean).map(s => (s.startsWith('*') && s.endsWith('*') && s.length > 2 ? { t: s.slice(1, -1), it: true } : { t: s, it: false }));
    let row: R[] = [], x = 0;
    for (const run of runs) for (const word of run.t.split(/(\s+)/).filter(Boolean)) {
      probe.font = font(run.it);
      const w = probe.measureText(word).width;
      if (/^\s+$/.test(word)) { if (row.length) x += w; continue; }
      if (x + w > maxW && row.length) { rows.push(row); row = []; x = 0; }
      row.push({ t: word, it: run.it, x }); x += w;
    }
    if (row.length) rows.push(row);
  }
  const H = P * 2 + Math.max(1, rows.length) * lh;
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const shade = ctx.createLinearGradient(0, 0, 0, H); shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.18)'); ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  rows.forEach((row, k) => { for (const r of row) { ctx.font = font(r.it); ctx.fillText(r.t, P + r.x, P + k * lh + px); } });
  return c.toBuffer('image/png');
}

// ─── AI watermarks ───────────────────────────────────────────────────────────

/** Gemini's sparkle (four curved points), white, `size` px across. */
export function geminiMark(size: number): Buffer {
  const c = createCanvas(size, size), ctx = c.getContext('2d'), m = size / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = size * 0.08;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.moveTo(m, size * 0.04);
  for (const [px, py, qx, qy] of [[size * 0.96, m, m, m], [m, size * 0.96, m, m], [size * 0.04, m, m, m], [m, size * 0.04, m, m]] as const) ctx.quadraticCurveTo(qx, qy, px, py);
  ctx.closePath(); ctx.fill();
  return c.toBuffer('image/png');
}

/** Sora's mark: the cloud-knot logo and "Sora", white, about `h` px tall. */
export function soraMark(h: number): Buffer {
  fonts();
  const probe = createCanvas(4, 4).getContext('2d'); probe.font = f(h * 0.62, 'semi');
  const tw = probe.measureText('Sora').width, W = Math.ceil(h * 1.1 + tw + h * 0.2);
  const c = createCanvas(W, h), ctx = c.getContext('2d');
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = h * 0.1;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = h * 0.09;
  const cx = h * 0.5, cy = h * 0.5, r = h * 0.2;
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU - Math.PI / 2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75, r, 0, TAU); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = f(h * 0.62, 'semi'); ctx.fillText('Sora', h * 1.05, h * 0.72);
  return c.toBuffer('image/png');
}

// ─── Tier list ───────────────────────────────────────────────────────────────

export const TIERS = [['S', '#ff7f7f'], ['A', '#ffbf7f'], ['B', '#ffdf7f'], ['C', '#ffff7f'], ['D', '#bfff7f'], ['F', '#7fbfff']] as const;
export type Tier = (typeof TIERS)[number][0];

/** Tiermaker-style rows: a coloured label, then each person's avatar with their name under it. */
export function renderTierList(rows: Record<Tier, { name: string; avatar?: Image | null }[]>, title?: string): Buffer {
  fonts();
  const cell = 92, label = 110, perRow = 8, W = label + perRow * cell + 8;
  const heights = TIERS.map(([t]) => Math.max(1, Math.ceil(rows[t].length / perRow)) * cell);
  const top = title ? 56 : 0, H = top + heights.reduce((a, b) => a + b + 2, 0) + 18;
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a17'; ctx.fillRect(0, 0, W, H);
  if (title) { ctx.font = f(26, 'bold'); ctx.fillStyle = '#fff'; ctx.fillText(fit(ctx, title, W - 40), 20, 38); }
  let y = top;
  TIERS.forEach(([t, col], k) => {
    const h = heights[k]!;
    ctx.fillStyle = col; ctx.fillRect(0, y, label, h);
    ctx.fillStyle = '#1a1a17'; ctx.font = f(40, 'bold'); ctx.textAlign = 'center'; ctx.fillText(t, label / 2, y + h / 2 + 14); ctx.textAlign = 'left';
    ctx.fillStyle = '#2b2b27'; ctx.fillRect(label, y, W - label, h);
    rows[t].forEach((p, n) => {
      const x = label + 4 + (n % perRow) * cell, yy = y + Math.floor(n / perRow) * cell;
      if (p.avatar) ctx.drawImage(p.avatar, x + 12, yy + 6, 64, 64); else avatar(ctx, null, x + 12, yy + 6, 64, p.name);
      ctx.font = f(12, 'semi'); ctx.fillStyle = '#e8e8e8'; ctx.textAlign = 'center'; ctx.fillText(fit(ctx, p.name, cell - 8), x + cell / 2 - 2, yy + 84); ctx.textAlign = 'left';
    });
    y += h + 2;
  });
  return c.toBuffer('image/png');
}
