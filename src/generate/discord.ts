import path from 'node:path';
import { createCanvas, GlobalFonts, type Image, type SKRSContext2D } from '@napi-rs/canvas';

/**
 * Discord-looking images for /generate fake …: messages (with replies, mention highlights, reactions, images, clan tags and
 * display-name fonts), a voice channel, a Trust & Safety report, an Apply-to-Join card and a friend request. Pure renderers:
 * everything they draw (avatars, badges, pictures) is passed in already loaded, so they're testable without the network.
 *
 * Every image carries a small "not a real screenshot" line so a joke can't be passed off as evidence against a real person.
 */

const FONTS = path.resolve(import.meta.dir, '../../assets/fonts');
let ready = false;
function fonts() {
  if (ready) return;
  const reg = (file: string, name: string) => { try { GlobalFonts.registerFromPath(path.join(FONTS, file), name); } catch { /* falls back to sans-serif */ } };
  reg('display/Figtree-Regular.ttf', 'DGG'); reg('display/Figtree-SemiBold.ttf', 'DGGSemi'); reg('display/Figtree-Bold.ttf', 'DGGBold');
  reg('display/ZillaSlab-Bold.ttf', 'DTempo'); reg('display/CherryBombOne-Regular.ttf', 'DSakura'); reg('display/Chicle-Regular.ttf', 'DJellybean');
  reg('display/MuseoModerno-Bold.ttf', 'DModern'); reg('display/MedievalSharp.ttf', 'DMedieval'); reg('display/PixelifySans-SemiBold.ttf', 'D8Bit');
  reg('display/PirataOne-Regular.ttf', 'DVampyre'); reg('twemoji.otf', 'Emoji');
  ready = true;
}

import { NOTICE } from './render.js';
export { NOTICE };

// ─── Fonts, themes, text ─────────────────────────────────────────────────────

/** Discord's display-name fonts, in Heist's order. */
export const DISPLAY_FONTS = ['gg sans', 'Tempo', 'Sakura', 'Jellybean', 'Modern', 'Medieval', '8Bit', 'Vampyre'] as const;
export type DisplayFont = (typeof DISPLAY_FONTS)[number];
const FAMILY: Record<DisplayFont, string> = { 'gg sans': 'DGGSemi', Tempo: 'DTempo', Sakura: 'DSakura', Jellybean: 'DJellybean', Modern: 'DModern', Medieval: 'DMedieval', '8Bit': 'D8Bit', Vampyre: 'DVampyre' };
/** Discord's `display_name_styles.font_id` values (as datamined) → the style's name. */
export const FONT_IDS: Record<number, DisplayFont> = { 11: 'gg sans', 12: 'Tempo', 3: 'Sakura', 4: 'Jellybean', 6: 'Modern', 7: 'Medieval', 8: '8Bit', 10: 'Vampyre' };

const f = (px: number, w: 'reg' | 'semi' | 'bold' = 'reg', italic = false) => `${italic ? 'italic ' : ''}${px}px ${w === 'bold' ? 'DGGBold' : w === 'semi' ? 'DGGSemi' : 'DGG'}, Emoji, sans-serif`;
const nameFont = (px: number, font: DisplayFont = 'gg sans') => `${px}px ${FAMILY[font]}, Emoji, sans-serif`;

export const THEMES = {
  Dark: { bg: '#1a1a1e', panel: '#121214', card: '#242429', text: '#dfe0e2', muted: '#94959c', name: '#f2f3f5', chip: '#2c2d32', line: '#3f4147', link: '#00a8fc' },
  Ash: { bg: '#323339', panel: '#2b2d31', card: '#393a41', text: '#dbdee1', muted: '#949ba4', name: '#f2f3f5', chip: '#3f4148', line: '#4e5058', link: '#00a8fc' },
  Onyx: { bg: '#070709', panel: '#000000', card: '#141417', text: '#dfe0e2', muted: '#8d8e96', name: '#f2f3f5', chip: '#1c1c20', line: '#2c2d32', link: '#00a8fc' },
  Black: { bg: '#000000', panel: '#000000', card: '#111113', text: '#dfe0e2', muted: '#8d8e96', name: '#f2f3f5', chip: '#1a1a1e', line: '#2a2a2f', link: '#00a8fc' },
  Light: { bg: '#ffffff', panel: '#f2f3f5', card: '#f2f3f5', text: '#313338', muted: '#5c5e66', name: '#060607', chip: '#e3e5e8', line: '#d4d7dc', link: '#006ce7' },
} as const;
export type DTheme = keyof typeof THEMES;
type Th = { [K in keyof (typeof THEMES)['Dark']]: string };
const dark = (t: DTheme) => t !== 'Light';

export interface Person {
  name: string;
  /** Role colour (or null for the theme's default). */
  color?: string | null;
  /** Display-name gradient (two colours), from the user's name style. */
  gradient?: [string, string] | null;
  font?: DisplayFont;
  avatar?: Image | null;
  /** Clan tag chip: the 4-character tag and its badge. */
  tag?: { text: string; badge?: Image | null } | null;
  bot?: boolean;
}

/** "13:33" → "Today at 13:33"; any other text as given; nothing → now, like Discord shows it. */
export function stamp(custom: string | null | undefined, now = new Date()): string {
  const t = custom?.trim();
  if (t) return /^\d{1,2}:\d{2}(\s?[ap]m)?$/i.test(t) ? `Today at ${t}` : t.slice(0, 40);
  return `Today at ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/** "💀:3 😭:3" → [{ 💀, 3 }, { 😭, 3 }] (a bare emoji counts 1). */
export function parseReactions(s: string | null | undefined): { emoji: string; count: number }[] {
  if (!s) return [];
  return s.trim().split(/\s+/).map(p => {
    const m = /^(.+?)(?::(\d{1,6}))?$/.exec(p);
    return m ? { emoji: m[1]!.slice(0, 16), count: Math.max(1, Number(m[2] ?? 1)) } : null;
  }).filter((r): r is { emoji: string; count: number } => !!r).slice(0, 20);
}

// Inline markdown: **bold**, *italic* / _italic_, `code`, @mentions.
interface Run { text: string; bold?: boolean; italic?: boolean; code?: boolean; mention?: boolean }
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|@[\w.]{2,32})/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**')) runs.push({ text: t.slice(2, -2), bold: true });
    else if (t.startsWith('`')) runs.push({ text: t.slice(1, -1), code: true });
    else if (t.startsWith('@')) runs.push({ text: t, mention: true });
    else runs.push({ text: t.slice(1, -1), italic: true });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

interface Piece extends Run { w: number; x: number }
type Line = Piece[];
const runFont = (r: Run, px: number) => (r.code ? `${px - 2}px "DejaVu Sans Mono", monospace` : f(px, r.bold ? 'bold' : r.mention ? 'semi' : 'reg', r.italic));

/** Word-wrap styled runs to `maxW`. Newlines break lines. */
function layout(ctx: SKRSContext2D, text: string, px: number, maxW: number): Line[] {
  const lines: Line[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line: Line = [], x = 0;
    for (const run of parseInline(para)) {
      for (const word of run.text.split(/(\s+)/)) {
        if (!word) continue;
        ctx.font = runFont(run, px);
        let w = ctx.measureText(word).width;
        if (/^\s+$/.test(word)) { if (line.length) { line.push({ ...run, text: ' ', w: ctx.measureText(' ').width, x }); x += ctx.measureText(' ').width; } continue; }
        let rest = word;
        while (w > maxW) { // a single word wider than the line: split it
          let n = rest.length;
          while (n > 1 && ctx.measureText(rest.slice(0, n)).width > maxW - x) n--;
          if (x > 0 && n <= 1) { lines.push(line); line = []; x = 0; continue; }
          const part = rest.slice(0, n);
          line.push({ ...run, text: part, w: ctx.measureText(part).width, x });
          lines.push(line); line = []; x = 0;
          rest = rest.slice(n); w = ctx.measureText(rest).width;
        }
        if (x + w > maxW && line.length) {
          while (line.length && /^\s+$/.test(line.at(-1)!.text)) line.pop();
          lines.push(line); line = []; x = 0;
        }
        line.push({ ...run, text: rest, w, x }); x += w;
      }
    }
    lines.push(line);
  }
  return lines;
}
const lineWidth = (l: Line) => (l.length ? l.at(-1)!.x + l.at(-1)!.w : 0);

function drawLines(ctx: SKRSContext2D, lines: Line[], x: number, y: number, px: number, lh: number, th: Th, theme: DTheme) {
  lines.forEach((line, k) => {
    const base = y + k * lh + px;
    for (const p of line) {
      if (p.code) { ctx.fillStyle = dark(theme) ? '#2b2d31' : '#e3e5e8'; roundRect(ctx, x + p.x - 1, base - px + 1, p.w + 2, px + 4, 4); ctx.fill(); }
      if (p.mention) { ctx.fillStyle = dark(theme) ? 'rgba(88,101,242,0.3)' : 'rgba(88,101,242,0.15)'; roundRect(ctx, x + p.x - 1, base - px + 1, p.w + 2, px + 5, 3); ctx.fill(); }
      ctx.font = runFont(p, px);
      ctx.fillStyle = p.mention ? (dark(theme) ? '#c9cdfb' : '#505cdc') : th.text;
      ctx.fillText(p.text, x + p.x, base);
    }
  });
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

const FALLBACK_AVATAR = ['#5865f2', '#757e8a', '#3ba55c', '#faa61a', '#ed4245', '#eb459e'];
export function avatar(ctx: SKRSContext2D, img: Image | null | undefined, x: number, y: number, size: number, seed = '') {
  ctx.save();
  ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  if (img) ctx.drawImage(img, x, y, size, size);
  else {
    ctx.fillStyle = FALLBACK_AVATAR[[...seed].reduce((h, c) => h + c.charCodeAt(0), 0) % FALLBACK_AVATAR.length]!; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#fff'; ctx.font = f(size * 0.45, 'bold'); ctx.textAlign = 'center'; ctx.fillText(seed.slice(0, 1).toUpperCase() || '?', x + size / 2, y + size * 0.66); ctx.textAlign = 'left';
  }
  ctx.restore();
}

/** Display name in its font and colour (gradient if the style has one); returns the width drawn. */
function drawName(ctx: SKRSContext2D, p: Person, x: number, base: number, px: number, th: Th): number {
  ctx.font = nameFont(px, p.font);
  const w = ctx.measureText(p.name).width;
  if (p.gradient) { const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, p.gradient[0]); g.addColorStop(1, p.gradient[1]); ctx.fillStyle = g; }
  else ctx.fillStyle = p.color ?? th.name;
  ctx.fillText(p.name, x, base);
  return w;
}

function nameWidth(ctx: SKRSContext2D, p: Person, px: number) { ctx.font = nameFont(px, p.font); return ctx.measureText(p.name).width; }

/** Clan tag chip (badge + tag) after a name; returns its width (0 if none). */
function tagChip(ctx: SKRSContext2D, tag: Person['tag'], x: number, base: number, th: Th, draw = true): number {
  if (!tag?.text) return 0;
  ctx.font = f(12, 'semi');
  const tw = ctx.measureText(tag.text).width, w = (tag.badge ? 18 : 6) + tw + 6;
  if (draw) {
    ctx.fillStyle = th.chip; roundRect(ctx, x, base - 13, w, 18, 4); ctx.fill();
    if (tag.badge) ctx.drawImage(tag.badge, x + 4, base - 10, 12, 12);
    ctx.fillStyle = th.name; ctx.fillText(tag.text, x + (tag.badge ? 18 : 6), base);
  }
  return w;
}

function botChip(ctx: SKRSContext2D, x: number, base: number, draw = true): number {
  ctx.font = f(10, 'bold');
  const w = ctx.measureText('APP').width + 8;
  if (draw) { ctx.fillStyle = '#5865f2'; roundRect(ctx, x, base - 11, w, 15, 3); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText('APP', x + 4, base); }
  return w;
}

function notice(ctx: SKRSContext2D, W: number, H: number, th: Th) {
  ctx.save(); ctx.globalAlpha = 0.55; ctx.font = f(10); ctx.fillStyle = th.muted; ctx.textAlign = 'right'; ctx.fillText(NOTICE, W - 8, H - 6); ctx.restore();
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface Msg {
  who: Person;
  text: string;
  time?: string;
  reply?: { who: Person; text: string };
  image?: Image | null;
  mention?: boolean;
  reactions?: { emoji: string; count: number }[];
}

const PX = 16, LH = 22, LEFT = 72, MAX_W = 940;

/** One or more Discord messages; consecutive ones from the same person (without a reply) group under one header. */
export function renderMessages(msgs: Msg[], o: { theme?: DTheme } = {}): Buffer {
  fonts();
  const theme = o.theme ?? 'Dark', th = THEMES[theme];
  const probe = createCanvas(4, 4).getContext('2d');
  const textMax = MAX_W - LEFT - 24;

  // Layout pass: heights and the widest thing, so short messages give a snug image.
  type Row = { m: Msg; head: boolean; lines: Line[]; img?: { w: number; h: number }; h: number; top: number };
  const rows: Row[] = [];
  let y = 16, widest = 0;
  msgs.forEach((m, k) => {
    const prev = msgs[k - 1];
    const head = !prev || prev.who.name !== m.who.name || !!m.reply;
    const lines = m.text.trim() ? layout(probe, m.text.slice(0, 2000), PX, textMax) : [];
    let h = (head && k ? 17 : 0) + (m.reply ? 22 : 0) + (head ? LH : 0) + lines.length * LH;
    widest = Math.max(widest, ...lines.map(lineWidth));
    if (head) widest = Math.max(widest, nameWidth(probe, m.who, PX) + tagChip(probe, m.who.tag, 0, 0, th, false) + 150);
    let img: Row['img'];
    if (m.image) {
      const s = Math.min(1, 400 / m.image.width, 320 / m.image.height);
      img = { w: Math.round(m.image.width * s), h: Math.round(m.image.height * s) };
      h += img.h + 8; widest = Math.max(widest, img.w);
    }
    if (m.reactions?.length) h += 32;
    if (m.reply) { probe.font = f(14); widest = Math.max(widest, Math.min(textMax, probe.measureText(m.reply.text).width + nameWidth(probe, m.reply.who, 14) + 40)); }
    rows.push({ m, head, lines, img, h: h + 2, top: y });
    y += h + 2;
  });
  const W = Math.round(Math.min(MAX_W, Math.max(440, LEFT + widest + 32))), H = y + 20;

  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
  for (const r of rows) {
    let cy = r.top + (r.head && r !== rows[0] ? 17 : 0);
    const { m } = r;
    if (m.mention) {
      ctx.fillStyle = dark(theme) ? 'rgba(240,178,50,0.1)' : 'rgba(250,168,26,0.1)'; ctx.fillRect(0, cy - 2, W, r.h - (cy - r.top) + 2);
      ctx.fillStyle = '#f0b232'; ctx.fillRect(0, cy - 2, 2, r.h - (cy - r.top) + 2);
    }
    if (m.reply) {
      ctx.strokeStyle = th.line; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(38, cy + 24); ctx.lineTo(38, cy + 13); ctx.quadraticCurveTo(38, cy + 7, 44, cy + 7); ctx.lineTo(68, cy + 7); ctx.stroke();
      avatar(ctx, m.reply.who.avatar, LEFT, cy, 16, m.reply.who.name);
      const nw = drawName(ctx, { ...m.reply.who, name: `@${m.reply.who.name}` }, LEFT + 20, cy + 13, 14, th);
      ctx.font = f(14); ctx.fillStyle = dark(theme) ? '#b5bac1' : '#4e5058';
      let t = m.reply.text.replace(/\s+/g, ' ');
      const room = W - (LEFT + 24 + nw) - 20;
      const full = t;
      while (t.length > 1 && ctx.measureText(t).width > room) t = t.slice(0, -1);
      ctx.fillText(t + (t !== full ? '…' : ''), LEFT + 24 + nw, cy + 13);
      cy += 22;
    }
    if (r.head) {
      avatar(ctx, m.who.avatar, 16, cy + 2, 40, m.who.name);
      let x = LEFT + drawName(ctx, m.who, LEFT, cy + 17, PX, th) + 4;
      if (m.who.bot) x += botChip(ctx, x, cy + 17) + 4;
      x += tagChip(ctx, m.who.tag, x, cy + 17, th);
      if (m.who.tag?.text) x += 4;
      ctx.font = f(12); ctx.fillStyle = th.muted; ctx.fillText(m.time ?? stamp(null), x + 2, cy + 17);
      cy += LH;
    }
    drawLines(ctx, r.lines, LEFT, cy, PX, LH, th, theme);
    cy += r.lines.length * LH;
    if (m.image && r.img) {
      ctx.save(); roundRect(ctx, LEFT, cy + 6, r.img.w, r.img.h, 8); ctx.clip(); ctx.drawImage(m.image, LEFT, cy + 6, r.img.w, r.img.h); ctx.restore();
      cy += r.img.h + 8;
    }
    if (m.reactions?.length) {
      let x = LEFT;
      for (const re of m.reactions) {
        ctx.font = f(14, 'semi');
        const cw = ctx.measureText(String(re.count)).width, w = 8 + 18 + 6 + cw + 8;
        if (x + w > W - 12) break;
        ctx.fillStyle = th.chip; roundRect(ctx, x, cy + 6, w, 26, 8); ctx.fill();
        ctx.font = `17px Emoji, ${f(17)}`; ctx.fillStyle = th.text; ctx.fillText(re.emoji, x + 8, cy + 25);
        ctx.font = f(14, 'semi'); ctx.fillStyle = dark(theme) ? '#b5bac1' : '#4e5058'; ctx.fillText(String(re.count), x + 8 + 18 + 6, cy + 24);
        x += w + 4;
      }
    }
  }
  notice(ctx, W, H, th);
  return c.toBuffer('image/png');
}

// ─── Voice channel ───────────────────────────────────────────────────────────

/** A voice channel in the sidebar with the people in it (the first one speaking). */
export function renderVoice(channel: string, people: Person[], o: { theme?: DTheme } = {}): Buffer {
  fonts();
  const th = THEMES[o.theme ?? 'Dark'];
  const W = 320, H = 16 + 34 + people.length * 32 + 24;
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = th.panel; ctx.fillRect(0, 0, W, H);
  // Speaker icon + channel name
  const sx = 16, sy = 26;
  ctx.fillStyle = th.muted;
  ctx.beginPath(); ctx.moveTo(sx, sy - 3); ctx.lineTo(sx + 4, sy - 3); ctx.lineTo(sx + 9, sy - 8); ctx.lineTo(sx + 9, sy + 8); ctx.lineTo(sx + 4, sy + 3); ctx.lineTo(sx, sy + 3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = th.muted; ctx.lineWidth = 1.8;
  for (const r of [5, 9]) { ctx.beginPath(); ctx.arc(sx + 9, sy, r, -Math.PI / 3.2, Math.PI / 3.2); ctx.stroke(); }
  ctx.font = f(16, 'semi'); ctx.fillStyle = th.name;
  let name = channel.trim() || 'General';
  while (name.length > 1 && ctx.measureText(name).width > W - 60) name = name.slice(0, -1);
  ctx.fillText(name, 44, sy + 6);
  people.forEach((p, k) => {
    const y = 50 + k * 32;
    if (k === 0) { ctx.strokeStyle = '#23a55a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(44 + 12, y + 12, 13.5, 0, Math.PI * 2); ctx.stroke(); }
    avatar(ctx, p.avatar, 44, y, 24, p.name);
    ctx.font = nameFont(14, p.font); ctx.fillStyle = k === 0 ? th.name : th.muted;
    let n = p.name;
    while (n.length > 1 && ctx.measureText(n).width > W - 100) n = n.slice(0, -1);
    ctx.fillText(n, 76, y + 17);
  });
  notice(ctx, W, H, th);
  return c.toBuffer('image/png');
}

// ─── Trust & Safety report ───────────────────────────────────────────────────

/** Discord's report review screen: the verdict, the rule, and the reported message under "Recent activity". */
export function renderReport(o: { who: Person; message: string; reason: string; time?: string; theme?: 'Dark' | 'Onyx' | 'Light' }): Buffer {
  fonts();
  const theme = o.theme ?? 'Dark', th = THEMES[theme];
  const W = 560, P = 28, probe = createCanvas(4, 4).getContext('2d');
  const body = `We reviewed your report and found that this content violates Discord's Community Guidelines for ${o.reason.trim() || 'child self-endangerment'}. We've taken action on the account.`;
  probe.font = f(15);
  const bodyLines = layout(probe, body, 15, W - P * 2);
  const msgLines = layout(probe, o.message.slice(0, 600), 15, W - P * 2 - 72);
  const H = P + 48 + 34 + bodyLines.length * 21 + 26 + 22 + 16 + 22 + msgLines.length * 21 + 26 + 44 + P;
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
  let y = P;
  // Shield
  ctx.fillStyle = '#5865f2';
  ctx.beginPath(); ctx.moveTo(P + 20, y); ctx.lineTo(P + 38, y + 7); ctx.quadraticCurveTo(P + 38, y + 32, P + 20, y + 42); ctx.quadraticCurveTo(P + 2, y + 32, P + 2, y + 7); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(P + 12, y + 21); ctx.lineTo(P + 18, y + 27); ctx.lineTo(P + 29, y + 15); ctx.stroke();
  ctx.font = f(12, 'bold'); ctx.fillStyle = th.muted; ctx.fillText('DISCORD TRUST & SAFETY', P + 52, y + 16);
  ctx.font = f(20, 'bold'); ctx.fillStyle = th.name; ctx.fillText('Your report was reviewed', P + 52, y + 40);
  y += 48 + 18;
  drawLines(ctx, bodyLines, P, y, 15, 21, th, theme); y += bodyLines.length * 21 + 26;
  ctx.font = f(12, 'bold'); ctx.fillStyle = th.muted; ctx.fillText('RECENT ACTIVITY', P, y); y += 14;
  const boxH = 22 + 16 + msgLines.length * 21 + 12;
  ctx.fillStyle = th.card; roundRect(ctx, P, y, W - P * 2, boxH, 8); ctx.fill();
  avatar(ctx, o.who.avatar, P + 14, y + 14, 40, o.who.name);
  let x = P + 68 + drawName(ctx, o.who, P + 68, y + 30, 15, th) + 6;
  x += tagChip(ctx, o.who.tag, x, y + 30, th);
  ctx.font = f(12); ctx.fillStyle = th.muted; ctx.fillText(o.time ?? stamp(null), x + (o.who.tag?.text ? 6 : 0), y + 30);
  drawLines(ctx, msgLines, P + 68, y + 36, 15, 21, th, theme);
  y += boxH + 26;
  ctx.fillStyle = '#5865f2'; roundRect(ctx, W - P - 120, y, 120, 38, 8); ctx.fill();
  ctx.font = f(14, 'semi'); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('Got it', W - P - 60, y + 24); ctx.textAlign = 'left';
  notice(ctx, W, H, th);
  return c.toBuffer('image/png');
}

// ─── Apply to Join ───────────────────────────────────────────────────────────

/** A member application as a server's moderators see it: pending (Approve/Reject), approved, or rejected with a reason. */
export function renderApplication(o: { who: Person; handle: string; joined: string; question: string; answer: string; status?: 'Approved' | 'Rejected' | null; reason?: string | null }): Buffer {
  fonts();
  const th = THEMES.Dark, W = 560, P = 24, probe = createCanvas(4, 4).getContext('2d');
  probe.font = f(15);
  const q = layout(probe, o.question.slice(0, 300), 14, W - P * 2), a = layout(probe, o.answer.slice(0, 1000), 15, W - P * 2);
  const reason = o.status === 'Rejected' && o.reason ? layout(probe, `Reason: ${o.reason.slice(0, 300)}`, 14, W - P * 2 - 20) : [];
  const H = P + 64 + 22 + 1 + 20 + q.length * 20 + 8 + a.length * 21 + 22 + (reason.length ? reason.length * 20 + 26 : 0) + 40 + P;
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = th.card; ctx.fillRect(0, 0, W, H);
  let y = P;
  avatar(ctx, o.who.avatar, P, y, 64, o.who.name);
  drawName(ctx, o.who, P + 80, y + 28, 20, th);
  ctx.font = f(14); ctx.fillStyle = th.muted; ctx.fillText(`${o.handle} · Joined Discord ${o.joined}`, P + 80, y + 52);
  y += 64 + 22;
  ctx.fillStyle = th.line; ctx.fillRect(P, y, W - P * 2, 1); y += 20;
  ctx.fillStyle = th.muted; drawLines(ctx, q.map(l => l.map(p => ({ ...p, bold: true }))), P, y - 4, 14, 20, { ...th, text: th.muted }, 'Dark'); y += q.length * 20 + 8;
  drawLines(ctx, a, P, y - 4, 15, 21, th, 'Dark'); y += a.length * 21 + 22;
  if (o.status === 'Approved' || o.status === 'Rejected') {
    const ok = o.status === 'Approved', col = ok ? '#23a55a' : '#f23f43';
    ctx.fillStyle = ok ? 'rgba(35,165,90,0.16)' : 'rgba(242,63,67,0.16)'; roundRect(ctx, P, y, 120, 32, 16); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); // drawn: the UI fonts have no ✓/✕
    if (ok) { ctx.moveTo(P + 15, y + 16); ctx.lineTo(P + 19, y + 20); ctx.lineTo(P + 26, y + 12); } else { ctx.moveTo(P + 15, y + 11); ctx.lineTo(P + 24, y + 20); ctx.moveTo(P + 24, y + 11); ctx.lineTo(P + 15, y + 20); }
    ctx.stroke();
    ctx.font = f(14, 'semi'); ctx.fillStyle = col; ctx.fillText(o.status, P + 34, y + 21);
    if (reason.length) { y += 44; drawLines(ctx, reason, P, y - 4, 14, 20, { ...th, text: th.muted }, 'Dark'); }
  } else {
    ctx.fillStyle = '#f23f43'; roundRect(ctx, W - P - 212, y, 100, 36, 8); ctx.fill();
    ctx.fillStyle = '#248046'; roundRect(ctx, W - P - 100, y, 100, 36, 8); ctx.fill();
    ctx.font = f(14, 'semi'); ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText('Reject', W - P - 162, y + 23); ctx.fillText('Approve', W - P - 50, y + 23); ctx.textAlign = 'left';
    ctx.font = f(13); ctx.fillStyle = th.muted; ctx.fillText('Pending review', P, y + 23);
  }
  notice(ctx, W, H, th);
  return c.toBuffer('image/png');
}

// ─── Friend request ──────────────────────────────────────────────────────────

/** The notification: "<name> sent you a friend request." with Accept / Ignore and how long ago. */
export function renderFriendRequest(o: { who: Person; age: string }): Buffer {
  fonts();
  const th = THEMES.Dark, W = 460, H = 128;
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = th.card; ctx.fillRect(0, 0, W, H);
  avatar(ctx, o.who.avatar, 18, 18, 48, o.who.name);
  // Friend-request badge on the avatar
  ctx.fillStyle = '#5865f2'; ctx.beginPath(); ctx.arc(58, 58, 11, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = th.card; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(58, 55, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(58, 64, 5.5, Math.PI, 0); ctx.fill();
  const nw = drawName(ctx, o.who, 80, 36, 16, th);
  ctx.font = f(15); ctx.fillStyle = th.text; ctx.fillText(' sent you a friend request.', 80 + nw, 36);
  ctx.font = f(12); ctx.fillStyle = th.muted; ctx.textAlign = 'right'; ctx.fillText(o.age, W - 16, 22); ctx.textAlign = 'left';
  ctx.fillStyle = '#248046'; roundRect(ctx, 80, 54, 96, 34, 8); ctx.fill();
  ctx.fillStyle = '#4e5058'; roundRect(ctx, 184, 54, 96, 34, 8); ctx.fill();
  ctx.font = f(14, 'semi'); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('Accept', 128, 76); ctx.fillText('Ignore', 232, 76); ctx.textAlign = 'left';
  notice(ctx, W, H, th);
  return c.toBuffer('image/png');
}
