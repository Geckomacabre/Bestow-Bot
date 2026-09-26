import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { MediaError, assertNotText, ffmpeg, probe, withWorkdir, type Probe } from '../framework/media.js';

/**
 * Makes a video small enough to upload: one H.264 encode aimed at the size limit (the bitrate is what the limit allows for the clip's
 * length), with the picture scaled down when there is little room. Used for reposts, where the original is often a little over the
 * limit — a 720p reel is typically 12–13 MB against Discord's 10 MB.
 */

export const AUDIO_KBPS = 64;
/** Each attempt aims for this share of the limit; the second is for when the first came out over (encoders overshoot a little). */
export const ATTEMPTS = [0.88, 0.7];
/** Below this much video bitrate the result is too poor to be worth posting. */
export const MIN_VIDEO_KBPS = 90;
const TIMEOUT_MS = 90_000;

/** The video bitrate (kbit/s) that fits `maxBytes` at this length, or null when there is no sensible room for one. */
export function videoKbps(maxBytes: number, seconds: number, share: number, hasAudio: boolean): number | null {
  if (!(seconds > 0)) return null;
  const kbps = Math.floor((maxBytes * share * 8) / 1000 / seconds - (hasAudio ? AUDIO_KBPS : 0));
  return kbps >= MIN_VIDEO_KBPS ? kbps : null;
}

/** ffmpeg arguments for one attempt. */
export function shrinkArgs(kbps: number, hasAudio: boolean): string[] {
  const cap = kbps < 450 ? 480 : 720; // the shorter side of the picture, in pixels
  const scale = `scale='if(gte(iw,ih),-2,min(${cap},iw))':'if(gte(iw,ih),min(${cap},ih),-2)'`;
  return [
    '-i', 'in.mp4', '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : []),
    '-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-b:v', `${kbps}k`, '-maxrate', `${Math.floor(kbps * 1.15)}k`, '-bufsize', `${kbps * 2}k`,
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2'] : []), '-movflags', '+faststart', 'out.mp4',
  ];
}

export interface ShrinkDeps { probe?: (file: string, cwd?: string) => Promise<Probe>; ffmpeg?: (args: string[], o: { cwd: string; timeoutMs: number }) => Promise<void> }

/** Re-encodes `data` (an mp4) to fit `maxBytes`, or throws a MediaError saying why it can't. */
export async function shrinkVideo(data: Buffer, maxBytes: number, deps: ShrinkDeps = {}): Promise<Buffer> {
  assertNotText(data);
  return withWorkdir(async dir => {
    const input = path.join(dir, 'in.mp4');
    await writeFile(input, data);
    const info = await (deps.probe ?? probe)(input, dir);
    if (!info.hasVideo) throw new MediaError('That file has no video in it.');
    for (const share of ATTEMPTS) {
      const kbps = videoKbps(maxBytes, info.duration, share, info.hasAudio);
      if (kbps === null) break;
      await (deps.ffmpeg ?? ffmpeg)(shrinkArgs(kbps, info.hasAudio), { cwd: dir, timeoutMs: TIMEOUT_MS });
      const out = await readFile(path.join(dir, 'out.mp4'));
      if (out.length <= maxBytes) return out;
    }
    throw new MediaError('That video is too long to fit the upload limit without ruining it.');
  });
}
