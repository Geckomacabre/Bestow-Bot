import { createCanvas } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg } from '../src/framework/media';

/** Recognisable test media so distortions are visible when eyeballed: gradient, shapes, text, grid. */
export async function makeSamples(dir: string) {
  const c = createCanvas(640, 400);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 640, 400);
  grad.addColorStop(0, '#ff6b6b'); grad.addColorStop(0.5, '#feca57'); grad.addColorStop(1, '#48dbfb');
  g.fillStyle = grad; g.fillRect(0, 0, 640, 400);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  for (let x = 0; x <= 640; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 400); g.stroke(); }
  for (let y = 0; y <= 400; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(640, y); g.stroke(); }
  g.fillStyle = '#1e272e'; g.beginPath(); g.arc(200, 200, 90, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.fillText('ONYX', 380, 220);
  g.fillStyle = '#e84393'; g.fillRect(40, 40, 90, 60);
  await writeFile(path.join(dir, 'sample.png'), c.toBuffer('image/png'));

  // 2-second 15fps test-pattern video with a 440 Hz tone, plus a GIF made from it.
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'sample.mp4'], { cwd: dir });
  await ffmpeg(['-i', 'sample.mp4', '-vf', 'fps=10,scale=240:-1,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', 'sample.gif'], { cwd: dir });
  // Stereo music-ish signal for audio effects (two tones, 3s).
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-filter_complex', '[0][1]amerge=inputs=2', 'sample.wav'], { cwd: dir });
}
