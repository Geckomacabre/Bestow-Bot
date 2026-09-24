import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getBufferPublic } from '../framework/http.js';
import { normalizeImage } from '../framework/imgsafe.js';
import { MediaError } from '../framework/media.js';
import { LookupError } from '../lookups/handler.js';

/**
 * Fetches an image safely (SSRF-checked, size-capped), decodes it in a separate process (so a corrupt file can't crash the bot — see
 * framework/imgsafe.ts), downsizes it, and returns a data URI so the AI provider never has to reach out to arbitrary URLs.
 */

export const MAX_FETCH = 12 * 1024 * 1024;
const MAX_SIDE = 1600;
const MAX_INLINE = 3 * 1024 * 1024;

export function sniffMime(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.length >= 6 && (b.subarray(0, 6).toString() === 'GIF87a' || b.subarray(0, 6).toString() === 'GIF89a')) return 'image/gif';
  return null;
}

export async function toDataUri(buf: Buffer): Promise<string> {
  if (!sniffMime(buf)) throw new LookupError('That doesn\'t look like a PNG, JPEG, WebP or GIF image.');
  let png: Buffer;
  try { png = await normalizeImage(buf, { maxSide: MAX_SIDE }); } catch (e) { throw new LookupError(e instanceof MediaError ? e.message : 'I couldn\'t read that image.'); }
  if (png.length <= MAX_INLINE) return `data:image/png;base64,${png.toString('base64')}`;
  // Big (photographic) image: JPEG is far smaller. The native decoder only ever sees the PNG that ffmpeg just produced.
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return `data:image/jpeg;base64,${c.toBuffer('image/jpeg', 85).toString('base64')}`;
}

export async function imageUrlToDataUri(url: string): Promise<string> {
  return toDataUri(await getBufferPublic(url, { maxBytes: MAX_FETCH, timeoutMs: 20_000 }));
}
