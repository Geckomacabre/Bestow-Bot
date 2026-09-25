/**
 * Renders every media effect against generated samples so the results can be eyeballed.
 *   bun scripts/media-demo.ts <outDir>
 */
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import * as fx from '../src/media/effects';
import { makeSamples } from '../tests/fixtures';

const outDir = path.resolve(Bun.argv[2] ?? './media-demo');
mkdirSync(outDir, { recursive: true });
const dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-demo-'));
await makeSamples(dir);
const job = (f: string) => fx.makeJob(dir, f);
const save = (name: string, out: fx.Out) => { const dest = path.join(outDir, `${name}${path.extname(out.file)}`); copyFileSync(path.join(dir, out.file), dest); console.log('✔', name); };

copyFileSync(path.join(dir, 'sample.png'), path.join(outDir, '00-original.png'));
const stills: [string, () => Promise<fx.Out>][] = [
  ['blur', async () => fx.blur(await job('sample.png'), 10)],
  ['invert', async () => fx.invert(await job('sample.png'))],
  ['grayscale', async () => fx.grayscale(await job('sample.png'))],
  ['flip', async () => fx.flip(await job('sample.png'), 'horizontal')],
  ['pixelate', async () => fx.pixelate(await job('sample.png'), 16)],
  ['rotate45', async () => fx.rotate(await job('sample.png'), 45)],
  ['fisheye', async () => fx.fisheye(await job('sample.png'))],
  ['zoomblur', async () => fx.zoomBlur(await job('sample.png'), 6)],
  ['deepfry', async () => fx.deepfry(await job('sample.png'))],
  ['caption', async () => fx.caption(await job('sample.png'), 'when the bot finally works and you did not have to fix anything')],
  ['caption-bottom', async () => fx.caption(await job('sample.png'), 'bottom caption', true)],
  ['meme', async () => fx.meme(await job('sample.png'), 'one does not simply', 'ship a discord bot')],
  ['watermark', async () => fx.watermark(await job('sample.png'), '@bestow', { position: 'bottom-right', opacity: 70, size: 6, color: '#ffffff' })],
];
for (const [n, f] of stills) { try { save(n, await f()); } catch (e) { console.log('✘', n, (e as Error).message); } }
