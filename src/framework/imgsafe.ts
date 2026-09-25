import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { loadImage, type Image } from '@napi-rs/canvas';
import { assertNotText, ffmpeg, MediaError, probe, withWorkdir } from './media.js';

/**
 * Safe decoding of images that a *user* supplied.
 *
 * Why this exists: @napi-rs/canvas' loadImage() hard-crashes the whole Bun process (segfault, not an exception) when it is
 * handed a truncated or corrupt PNG/JPEG. Anyone who can upload an image to a command could take the bot down. So untrusted
 * bytes are first decoded by ffmpeg in a separate process — a bad file just makes ffmpeg exit non-zero — and re-encoded to a
 * clean PNG (first frame only, capped size). Only that known-good PNG ever reaches the native decoder.
 */

export const MAX_PIXELS = 40_000_000;

const BAD = 'I couldn\'t read that as a valid image (it may be corrupt or an unsupported format).';

export async function normalizeImage(input: Buffer, opts: { maxSide?: number } = {}): Promise<Buffer> {
  const maxSide = Math.max(16, Math.min(8192, opts.maxSide ?? 2048));
  assertNotText(input); // SVG, playlists and scripts are refused before ffmpeg can interpret them
  return withWorkdir(async dir => {
    const src = path.join(dir, 'in.bin'), out = path.join(dir, 'out.png');
    await writeFile(src, input);
    let info;
    try { info = await probe(src, dir); } catch { throw new MediaError(BAD); }
    if (!info.hasVideo || !info.width || !info.height) throw new MediaError('That file isn\'t an image.');
    if (info.width * info.height > MAX_PIXELS) throw new MediaError('That image is too large to process.');
    try {
      await ffmpeg(['-y', '-i', src, '-frames:v', '1', '-vf', `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease:flags=bicubic,format=rgba`, '-c:v', 'png', out], { cwd: dir, timeoutMs: 30_000 });
      return await readFile(out);
    } catch (e) {
      if (e instanceof MediaError) throw e;
      throw new MediaError(BAD);
    }
  });
}

/** Drop-in replacement for loadImage() on untrusted bytes. */
export async function safeLoadImage(input: Buffer, opts: { maxSide?: number } = {}): Promise<Image> {
  return loadImage(await normalizeImage(input, opts));
}
