import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '../../assets/fonts');

// Make it a Quote uses M PLUS as its default font (mplus.ttf = regular, bold.ttf = bold weight).
const REG = 'MIQ';
const BLD = 'MIQB';

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'mplus.ttf'), REG);
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'bold.ttf'), BLD);
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'twemoji.otf'), 'Twemoji');
  fontsRegistered = true;
}

type Seg = { text: string; bold: boolean; italic: boolean };

function parseInline(text: string): Seg[] {
  const segs: Seg[] = [];
  let bold = false, italic = false, last = 0;
  const re = /(\*{1,3})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), bold, italic });
    const len = m[1].length;
    if (len === 3) { bold = !bold; italic = !italic; }
    else if (len === 2) bold = !bold;
    else italic = !italic;
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ text: text.slice(last), bold, italic });
  return segs.filter(s => s.text.length > 0);
}

function segFont(bold: boolean, italic: boolean, size: number): string {
  const fam = bold ? BLD : REG;
  return `${italic ? 'italic ' : ''}${size}px ${fam}, Twemoji`;
}

function stripMarkers(text: string): string {
  return text.replace(/\*{1,3}/g, '');
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number, fontSize: number, maxLines = 7): string[] {
  const lines: string[] = [];
  ctx.font = `${fontSize}px ${REG}`;
  for (const para of text.split('\n')) {
    if (!para.trim()) continue;
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(stripMarkers(test)).width > maxWidth && line) {
        lines.push(line);
        if (lines.length >= maxLines) return lines;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      lines.push(line);
      if (lines.length >= maxLines) return lines;
    }
  }
  return lines;
}

// Draw a line centered at cx, honoring **bold** / *italic* segments.
function drawLine(ctx: SKRSContext2D, line: string, cx: number, y: number, size: number) {
  const segs = parseInline(line);
  ctx.save();
  ctx.textAlign = 'left';
  let totalW = 0;
  for (const seg of segs) {
    ctx.font = segFont(seg.bold, seg.italic, size);
    totalW += ctx.measureText(seg.text).width;
  }
  let x = cx - totalW / 2;
  for (const seg of segs) {
    ctx.font = segFont(seg.bold, seg.italic, size);
    ctx.fillText(seg.text, x, y);
    x += ctx.measureText(seg.text).width;
  }
  ctx.restore();
}

export async function generateQuote(opts: {
  text: string;
  authorName: string;
  authorHandle: string;
  authorAvatarUrl: string | null;
}): Promise<Buffer> {
  ensureFonts();
  const { text, authorName, authorHandle, authorAvatarUrl } = opts;

  const W = 1200;
  const H = 628;
  const BG = '#000000';
  // Avatar is clipped to AVATAR_W and the fade reaches PURE black exactly at AVATAR_W,
  // so the clip edge is hidden under solid black — no visible vertical seam.
  const AVATAR_W = 620;
  const TEXT_LEFT = 575;
  const TEXT_CX = TEXT_LEFT + Math.round((W - TEXT_LEFT) / 2); // ~887
  const TEXT_MAX_W = W - TEXT_LEFT - 45;
  const FONT_SIZE = 56;
  const LINE_H = FONT_SIZE * 1.4;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  if (authorAvatarUrl) {
    try {
      const img = await loadImage(authorAvatarUrl.replace(/\?.*$/, '') + '?size=1024');
      // Cover-fill the clip region by height so the avatar fills full card height
      const scale = Math.max(AVATAR_W / img.width, H / img.height);
      const sw = img.width * scale;
      const sh = img.height * scale;
      const sx = (AVATAR_W - sw) / 2;
      const sy = (H - sh) / 2;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, AVATAR_W, H);
      ctx.clip();
      ctx.drawImage(img, sx, sy, sw, sh);

      // In-place grayscale on the avatar region (slightly brightened so the logo reads bright/white)
      const imageData = ctx.getImageData(0, 0, AVATAR_W, H);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        gray = Math.min(255, Math.round(gray * 1.12 + 6));
        d[i] = d[i + 1] = d[i + 2] = gray;
      }
      ctx.putImageData(imageData, 0, 0);

      // Diagonal fade that "comes from the top-right": the axis is tilted up toward the
      // right, so the full-black boundary sits further left at the top than the bottom.
      // Black lands well before the text column at every height, hiding the clip edge.
      const fade = ctx.createLinearGradient(0, 95, AVATAR_W, -55);
      fade.addColorStop(0.0,  'rgba(0,0,0,0.20)'); // subtle left vignette
      fade.addColorStop(0.10, 'rgba(0,0,0,0.05)');
      fade.addColorStop(0.22, 'rgba(0,0,0,0)');    // brightest (logo)
      fade.addColorStop(0.36, 'rgba(0,0,0,0)');
      fade.addColorStop(0.50, 'rgba(0,0,0,0.45)');
      fade.addColorStop(0.64, 'rgba(0,0,0,0.9)');
      fade.addColorStop(0.72, 'rgba(0,0,0,1)');
      fade.addColorStop(1.0,  'rgba(0,0,0,1)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, AVATAR_W, H);
      ctx.restore();
    } catch { /* avatar unavailable */ }
  }

  // Quote text — supports **bold** and *italic*, centered vertically around the middle
  ctx.fillStyle = '#ffffff';
  const truncated = text.length > 300 ? text.slice(0, 297) + '…' : text;
  const lines = wrapText(ctx, truncated, TEXT_MAX_W, FONT_SIZE);
  const quoteBlockH = lines.length * LINE_H;
  let y = Math.round((H - quoteBlockH) / 2) + FONT_SIZE;
  for (const line of lines) {
    drawLine(ctx, line, TEXT_CX, y, FONT_SIZE);
    y += LINE_H;
  }

  // Author name (italic), tucked close under the last quote line
  const authorY = y - LINE_H + 56;
  ctx.textAlign = 'center';
  ctx.font = `italic 32px ${REG}, Twemoji`;
  ctx.fillStyle = '#e0e0e0';
  ctx.fillText(`- ${authorName}`, TEXT_CX, authorY);

  // Handle (@username for pomelo accounts, username#discriminator for legacy)
  ctx.font = `24px ${REG}, Twemoji`;
  ctx.fillStyle = '#8a8a8a';
  ctx.fillText(authorHandle, TEXT_CX, authorY + 38);

  // Watermark
  ctx.textAlign = 'right';
  ctx.font = `16px ${REG}`;
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillText('Make it a Quote', W - 18, H - 18);

  return Buffer.from(canvas.toBuffer('image/png'));
}
