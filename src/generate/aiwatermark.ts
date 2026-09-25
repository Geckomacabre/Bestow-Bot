import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg, fitEven, GIF_PALETTE } from '../framework/media.js';
import type { Job, Out } from '../media/effects.js';
import { geminiMark, soraMark } from './extras.js';

/**
 * /generate fake ai-watermark: Gemini's sparkle or Sora's mark on a picture, GIF or video. Static: in the chosen corner.
 * Animated (Sora only): the mark hops between spots every two seconds, like on Sora videos — a still becomes an 8-second GIF.
 */

export type Brand = 'Gemini' | 'Sora AI';
export type Corner = 'Top Left' | 'Top Right' | 'Bottom Left' | 'Bottom Right';

/** Overlay x/y for a corner, `m` px in from the edges. */
export function cornerXY(corner: Corner, m: number): [string, string] {
  const x = corner.endsWith('Left') ? String(m) : `W-w-${m}`, y = corner.startsWith('Top') ? String(m) : `H-h-${m}`;
  return [x, y];
}

/** Sora's hop: bottom-left → top-right → middle-right → bottom-right, two seconds each. */
export const HOP_X = "if(lt(mod(t,8),2),W*0.05,if(lt(mod(t,8),4),W-w-W*0.05,if(lt(mod(t,8),6),W-w-W*0.06,W-w-W*0.05)))";
export const HOP_Y = "if(lt(mod(t,8),2),H-h-H*0.06,if(lt(mod(t,8),4),H*0.06,if(lt(mod(t,8),6),(H-h)/2,H-h-H*0.06)))";

export async function aiWatermark(job: Job, o: { brand: Brand; corner?: Corner; opacity?: number; animate?: boolean | null }): Promise<Out> {
  const { info } = job;
  const video = info.animated && !/gif/.test(info.format);
  const animate = o.brand === 'Sora AI' && (o.animate ?? video);
  const cap = fitEven(info.width, info.height, video ? 1280 : info.animated || animate ? 480 : 1600);
  const short = Math.min(cap.w, cap.h);
  const mark = o.brand === 'Gemini' ? geminiMark(Math.max(18, Math.round(short * 0.07))) : soraMark(Math.max(16, Math.round(short * 0.06)));
  await writeFile(path.join(job.dir, 'mark.png'), mark);
  const alpha = Math.min(1, Math.max(0.1, o.opacity ?? 1));
  const [x, y] = animate ? [HOP_X, HOP_Y] : cornerXY(o.corner ?? 'Bottom Right', Math.round(short * 0.03));
  const graph = `[0:v]scale=${cap.w}:${cap.h},setsar=1[b];[1:v]format=rgba,colorchannelmixer=aa=${alpha}[m];[b][m]overlay=x='${x}':y='${y}':format=auto`;
  if (video) {
    await ffmpeg(['-t', '30', '-i', job.input, '-i', 'mark.png', '-filter_complex', `${graph},format=yuv420p[v]`, '-map', '[v]', '-map', '0:a?',
      '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'out.mp4'], { cwd: job.dir, timeoutMs: 180_000 });
    return { file: 'out.mp4', name: 'watermarked.mp4' };
  }
  if (info.animated || animate) {
    const still = !info.animated;
    await ffmpeg([...(still ? ['-loop', '1', '-framerate', '10', '-t', '8'] : ['-t', '30']), '-i', job.input, '-i', 'mark.png',
      '-filter_complex', `${graph},${GIF_PALETTE}`, '-loop', '0', 'out.gif'], { cwd: job.dir, timeoutMs: 180_000 });
    return { file: 'out.gif', name: 'watermarked.gif' };
  }
  await ffmpeg(['-i', job.input, '-i', 'mark.png', '-filter_complex', graph, '-frames:v', '1', 'out.png'], { cwd: job.dir });
  return { file: 'out.png', name: 'watermarked.png' };
}
