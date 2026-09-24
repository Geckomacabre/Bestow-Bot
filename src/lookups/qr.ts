import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { LookupError } from './handler.js';
import { getBufferPublic } from '../framework/http.js';

/** QR code generation (PNG) and scanning (from an image URL/attachment). */

export const QR_MAX = 1000;

export async function makeQr(text: string, opts: { dark?: string; light?: string; size?: number } = {}): Promise<Buffer> {
  if (!text.trim()) throw new LookupError('Give me some text or a link to encode.');
  if (text.length > QR_MAX) throw new LookupError(`That's too long for a QR code (limit ${QR_MAX} characters).`);
  const size = Math.min(1024, Math.max(128, opts.size ?? 512));
  return QRCode.toBuffer(text, { type: 'png', width: size, margin: 2, errorCorrectionLevel: text.length > 300 ? 'L' : 'M', color: { dark: opts.dark ?? '#000000', light: opts.light ?? '#ffffff' } });
}

/** Decodes a QR code from an image. Tries normal and inverted colours at 1×, then upscaled and downscaled (small / noisy codes).
 *  Note: jsQR's 'onlyInvert' mode throws in the current release, so 'attemptBoth' is used instead. */
export async function scanQrBuffer(buf: Buffer): Promise<string> {
  let img;
  try { img = await loadImage(buf); } catch { throw new LookupError('I couldn\'t read that as an image.'); }
  if (img.width * img.height > 40_000_000) throw new LookupError('That image is too large to scan.');
  for (const scale of [1, 2, 0.5]) {
    const w = Math.max(64, Math.min(2400, Math.round(img.width * scale))), h = Math.max(64, Math.min(2400, Math.round(img.height * scale)));
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    let r: ReturnType<typeof jsQR> = null;
    try { r = jsQR(data.data as unknown as Uint8ClampedArray, w, h, { inversionAttempts: 'attemptBoth' }); } catch { /* jsQR throws on flat/degenerate images instead of returning null */ }
    if (r?.data) return r.data;
  }
  throw new LookupError('I couldn\'t find a QR code in that image. Try a sharper, closer picture.');
}

export async function scanQrUrl(url: string): Promise<string> {
  return scanQrBuffer(await getBufferPublic(url, { maxBytes: 10 * 1024 * 1024, timeoutMs: 15_000 }));
}
