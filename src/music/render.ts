import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { getBufferPublic } from '../framework/http.js';
import { safeLoadImage } from '../framework/imgsafe.js';

/** Last.fm images: the album collage and the "image" now-playing card. Art is decoded through safeLoadImage (never loadImage directly). */

async function art(url?: string) {
  if (!url) return null;
  try { return await safeLoadImage(await getBufferPublic(url, { maxBytes: 4 * 1024 * 1024, timeoutMs: 15_000 })); } catch { return null; }
}

function fitText(g: SKRSContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** n×n grid of album covers with the album and artist written over each (like the classic Last.fm collage). */
export async function collage(items: { name: string; artist?: string; image?: string; plays: number }[], n: 3 | 4 | 5): Promise<Buffer> {
  const cell = n === 5 ? 240 : 300, W = cell * n;
  const c = createCanvas(W, W), g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, W, W);
  const imgs = await Promise.all(items.slice(0, n * n).map(x => art(x.image)));
  items.slice(0, n * n).forEach((x, k) => {
    const cx = (k % n) * cell, cy = Math.floor(k / n) * cell;
    const img = imgs[k];
    if (img) g.drawImage(img, cx, cy, cell, cell);
    else { g.fillStyle = `hsl(${(k * 47) % 360},25%,22%)`; g.fillRect(cx, cy, cell, cell); }
    const grad = g.createLinearGradient(0, cy + cell - 70, 0, cy + cell);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = grad; g.fillRect(cx, cy + cell - 70, cell, 70);
    g.fillStyle = '#fff'; g.font = `bold ${n === 5 ? 15 : 17}px sans-serif`;
    g.fillText(fitText(g, x.name, cell - 16), cx + 8, cy + cell - 30);
    g.fillStyle = '#ccc'; g.font = `${n === 5 ? 13 : 14}px sans-serif`;
    g.fillText(fitText(g, `${x.artist ?? ''}${x.artist ? ' · ' : ''}${x.plays} plays`, cell - 16), cx + 8, cy + cell - 11);
  });
  return c.toBuffer('image/png');
}

/** 900×300 card: blurred art background, the cover, track, artist, album and a status line. */
export async function nowPlayingCard(t: { name: string; artist: string; album?: string; image?: string; user: string; nowPlaying: boolean; plays?: number }): Promise<Buffer> {
  const W = 900, H = 300;
  const c = createCanvas(W, H), g = c.getContext('2d');
  const img = await art(t.image);
  g.fillStyle = '#1e1f22'; g.fillRect(0, 0, W, H);
  if (img) {
    g.filter = 'blur(28px) brightness(0.45)';
    g.drawImage(img, -50, -300, W + 100, W + 100);
    g.filter = 'none';
    g.drawImage(img, 30, 30, 240, 240);
  } else { g.fillStyle = '#2b2d31'; g.fillRect(30, 30, 240, 240); g.fillStyle = '#6d6f78'; g.font = 'bold 90px sans-serif'; g.textAlign = 'center'; g.fillText('♪', 150, 185); g.textAlign = 'left'; }
  const x = 300, max = W - x - 30;
  g.fillStyle = '#b5bac1'; g.font = 'bold 18px sans-serif';
  g.fillText(fitText(g, `${t.nowPlaying ? '▶  NOW PLAYING' : '⏮  LAST PLAYED'} · ${t.user}`, max), x, 70);
  g.fillStyle = '#ffffff'; g.font = 'bold 40px sans-serif'; g.fillText(fitText(g, t.name, max), x, 130);
  g.fillStyle = '#dbdee1'; g.font = '28px sans-serif'; g.fillText(fitText(g, t.artist, max), x, 175);
  if (t.album) { g.fillStyle = '#949ba4'; g.font = 'italic 22px sans-serif'; g.fillText(fitText(g, t.album, max), x, 215); }
  if (t.plays != null) { g.fillStyle = '#d51007'; g.font = 'bold 18px sans-serif'; g.fillText(`${t.plays.toLocaleString('en-US')} plays`, x, 262); }
  return c.toBuffer('image/png');
}
