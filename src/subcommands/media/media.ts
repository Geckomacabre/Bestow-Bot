import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Sub, SubGroup } from '../../framework/group.js';
import { hsub, type OptTweak } from '../../framework/heist.js';
import { MediaError, download, ffmpeg, findMedia, mediaHandler, probe, sendBuffer, sendFile, withWorkdir, type Kind } from '../../framework/media.js';
import { makeZip } from '../../framework/zip.js';
import { cv2Box } from '../../utils/components.js';
import * as fx from '../../media/effects.js';
import * as fx2 from '../../media/fx2.js';
import { makesweet, TEMPLATES } from '../../media/makesweet.js';

/** /media (image, video, makesweet, ahshit, frames, info) and /audio, with Heist's options exactly (docs/heist-spec.json). */

const Blurple = 0x5865f2;
type I = ChatInputCommandInteraction;
type Result = fx.Out | { data: Buffer; name: string; content?: string };

/**
 * A handler that finds the command's media (attachment → `url` → the latest one in the channel), downloads and probes it, and
 * uploads whatever `fn` makes from it. `visual` refuses sound-only files up front for the picture/video tools.
 */
function withMedia(kind: Kind, fn: (i: I, job: fx.Job) => Promise<Result>, o: { visual?: boolean } = {}) {
  return mediaHandler(async i => {
    await withWorkdir(async dir => {
      const ref = await findMedia(i, kind);
      const job = await fx.makeJob(dir, await download(ref, dir));
      if ((o.visual ?? kind !== 'audio') && !job.info.hasVideo) throw new MediaError('That needs an image, GIF or video — it has no picture.');
      const out = await fn(i, job);
      if ('data' in out) await sendBuffer(i, out.data, out.name, out.content);
      else await sendFile(i, dir, out.file, { name: out.name });
    });
  });
}

const togif = (i: I) => i.options.getBoolean('togif') ?? false;
const between = (min: number, max: number): OptTweak => ({ min, max });

// ─── Watermark (image + video share Heist's options) ─────────────────────────

const WM_POSITION: Record<string, fx.Position> = { 'Bottom Right': 'bottom-right', 'Bottom Left': 'bottom-left', 'Top Right': 'top-right', 'Top Left': 'top-left', 'Center': 'center' };
const wmOpts = (i: I): fx.WatermarkOpts => ({
  position: WM_POSITION[i.options.getString('position') ?? ''] ?? 'bottom-right',
  opacity: i.options.getNumber('opacity') ?? 0.8,
  size: i.options.getInteger('size'),
  color: fx.WATERMARK_COLORS[i.options.getString('color') ?? ''] ?? fx.WATERMARK_COLORS.Black!,
  font: i.options.getString('font') ?? 'Impact',
  audio: i.options.getBoolean('audio') ?? true,
});
const wmTweaks: Record<string, OptTweak> = { opacity: between(0.1, 1), size: between(8, 400), text: { maxLength: 120 } };

// ─── /media image ────────────────────────────────────────────────────────────

const image = (name: string, fn: (i: I, job: fx.Job) => Promise<Result>, o: { kind?: Kind; tweaks?: Record<string, OptTweak> } = {}) =>
  hsub(`media image ${name}`, withMedia(o.kind ?? 'image', fn, { visual: true }), { tweaks: o.tweaks });

const FLIP: Record<string, 'horizontal' | 'vertical'> = { 'Horizontal (mirror)': 'horizontal', 'Vertical (upside down)': 'vertical' };

export const imageSubs: Sub[] = [
  image('speechbubble', (i, j) => fx2.speechbubble(j, i.options.getString('engine') === 'Flux' ? 'flux' : 'heist', { togif: togif(i) })),
  image('caption', (i, j) => fx.caption(j, i.options.getString('caption', true), { bottomText: i.options.getString('caption_bottom') ?? '', togif: togif(i) }),
    { tweaks: { caption: { maxLength: 300 }, caption_bottom: { maxLength: 300 } } }),
  image('grayscale', (i, j) => fx.grayscale(j, { togif: togif(i) })),
  image('pixelate', (i, j) => {
    const size = (i.options.getString('size') ?? 'Medium') as keyof typeof fx.PIXELATE_BLOCKS;
    return fx.pixelate(j, fx.pixelSize(j.info.width, j.info.height, size in fx.PIXELATE_BLOCKS ? size : 'Medium'), { togif: togif(i) });
  }, { tweaks: { size: { description: 'Pixel size' } } }),
  image('invert', (i, j) => fx.invert(j, { togif: togif(i) })),
  image('deepfry', (_i, j) => fx.deepfry(j)),
  image('magik', (i, j) => fx2.magik(j, i.options.getBoolean('gifmagik') ?? false), { kind: 'any' }),
  image('spin', (_i, j) => fx.spin(j)),
  image('pingpong', (_i, j) => fx.pingpong(j)),
  image('fisheye', (_i, j) => fx.fisheye(j)),
  hsub('media image overlay', mediaHandler(async i => {
    const base = i.options.getAttachment('base', true), over = i.options.getAttachment('overlay', true);
    for (const a of [base, over]) if (!a.contentType?.startsWith('image/')) throw new MediaError('Both attachments must be images.');
    await withWorkdir(async dir => {
      const baseFile = await download({ url: base.url, name: base.name, contentType: base.contentType }, dir, 'base');
      const overFile = await download({ url: over.url, name: over.name, contentType: over.contentType }, dir, 'over');
      const out = await fx.overlay(await fx.makeJob(dir, baseFile), overFile, {
        opacity: i.options.getNumber('opacity') ?? 1, x: i.options.getInteger('x') ?? 0, y: i.options.getInteger('y') ?? 0, scale: i.options.getNumber('scale') ?? 1,
      });
      await sendFile(i, dir, out.file, { name: out.name });
    });
  }), { tweaks: { opacity: between(0, 1), x: between(0, 10_000), y: between(0, 10_000), scale: between(0.1, 5) } }),
  image('flip', (i, j) => fx.flip(j, FLIP[i.options.getString('direction') ?? ''] ?? 'horizontal', { togif: togif(i) })),
  image('meme', (i, j) => {
    const [top = '', bottom = ''] = (i.options.getString('text') ?? '').split('|').map(s => s.trim());
    return fx.meme(j, top, bottom);
  }, { tweaks: { text: { maxLength: 240 } } }),
  image('motivate', (i, j) => fx2.motivate(j, i.options.getString('text') ?? ''), { tweaks: { text: { maxLength: 200 } } }),
  image('zoomblur', (i, j) => fx.zoomBlur(j, i.options.getNumber('power') ?? 2), { tweaks: { power: between(-10, 10) } }),
  image('blur', (i, j) => fx.blur(j, i.options.getNumber('strength') ?? 5), { tweaks: { strength: between(0.1, 20) } }),
  image('rotate', (i, j) => fx.rotate(j, i.options.getInteger('degrees') ?? 90), { tweaks: { degrees: { description: 'Clockwise rotation' } } }),
  image('watermark', (i, j) => fx.watermark(j, i.options.getString('text') ?? i.client.user?.username ?? 'Bestow', wmOpts(i)), { tweaks: wmTweaks }),
  image('swirl', (i, j) => fx2.swirl(j, i.options.getNumber('strength') ?? 1), { tweaks: { strength: between(-5, 5) } }),
  image('globe', (_i, j) => fx2.globe(j)),
  image('togif', (_i, j) => fx.toGif(j)),
  hsub('media image addaudio', mediaHandler(async i => {
    const img = i.options.getAttachment('image', true), aud = i.options.getAttachment('audio', true);
    if (!img.contentType?.startsWith('image/')) throw new MediaError('`image` must be an image.');
    if (!/^(audio|video)\//.test(aud.contentType ?? '')) throw new MediaError('`audio` must be an audio file.');
    await withWorkdir(async dir => {
      const imgFile = await download({ url: img.url, name: img.name, contentType: img.contentType }, dir, 'pic');
      const audFile = await download({ url: aud.url, name: aud.name, contentType: aud.contentType }, dir, 'sound');
      if (!(await probe(audFile, dir)).hasAudio) throw new MediaError('That audio file has no sound in it.');
      const out = await fx2.imageWithAudio2(dir, imgFile, audFile, {
        loop: i.options.getInteger('loop') ?? 1, volume: i.options.getNumber('volume') ?? 1,
        start: i.options.getNumber('start') ?? 0, end: i.options.getNumber('end') ?? 0, effect: i.options.getString('effect'),
      });
      await sendFile(i, dir, out.file, { name: out.name });
    });
  }), { tweaks: { loop: between(1, 5), volume: between(0.1, 2), start: between(0, 3600), end: between(0, 3600) } }),
];

// ─── /media video (✨ Premium, per Heist) ─────────────────────────────────────

const videoOpts = (i: I): fx.VideoOpts => ({ audio: i.options.getBoolean('audio') ?? true });
const wantsGif = (i: I) => i.options.getString('output') === 'GIF';

/** A video tool: the effect renders an MP4, which becomes a GIF when `output: GIF` is picked. */
const video = (name: string, fn: (i: I, job: fx.Job) => Promise<fx.Out>, o: { kind?: Kind; tweaks?: Record<string, OptTweak> } = {}) =>
  hsub(`media video ${name}`, withMedia(o.kind ?? 'video', async (i, j) => {
    const out = await fn(i, j);
    return wantsGif(i) && out.file.endsWith('.mp4') ? fx.mp4ToGif(j.dir, out) : out;
  }, { visual: true }), { tweaks: o.tweaks });

const ANCHOR: Record<string, fx.Anchor> = { 'Center (default)': 'center', Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' };

export const videoSubs: Sub[] = [
  video('speechbubble', (i, j) => fx2.speechbubble(j, i.options.getString('style') === 'Flux' ? 'flux' : 'heist', { video: true, output: wantsGif(i) ? 'gif' : 'mp4', audio: videoOpts(i).audio })),
  video('togif', (_i, j) => fx.toGif(j)),
  video('caption', (i, j) => fx.caption(j, i.options.getString('caption', true), { bottom: i.options.getBoolean('bottom') ?? false, video: true, ...videoOpts(i) }), { tweaks: { caption: { maxLength: 300 } } }),
  video('reverse', (i, j) => fx.videoReverse(j, videoOpts(i))),
  video('resize', (i, j) => fx.videoResize(j, i.options.getNumber('scale') ?? 0.5, videoOpts(i)), { tweaks: { scale: between(0.1, 4) } }),
  video('speed', (i, j) => fx.videoSpeed(j, parseFloat(i.options.getString('multiplier') ?? '2') || 2, videoOpts(i))),
  video('rotate', (i, j) => fx.videoRotate(j, i.options.getInteger('degrees') ?? 90, videoOpts(i)), { kind: 'any', tweaks: { degrees: { description: 'Clockwise rotation' } } }),
  video('scramble', (i, j) => fx.videoScramble(j, videoOpts(i))),
  video('watermark', (i, j) => fx.watermark(j, i.options.getString('text', true), wmOpts(i), true), { tweaks: wmTweaks }),
  video('crop', (i, j) => fx.videoCrop(j, (i.options.getString('ratio') ?? '1:1').split(' ')[0]!, ANCHOR[i.options.getString('anchor') ?? ''] ?? 'center', videoOpts(i))),
];

// ─── /media makesweet ────────────────────────────────────────────────────────

export const makesweetSubs: Sub[] = TEMPLATES.map(t => hsub(`media makesweet ${t}`, withMedia('image', async (i, job) => {
  const second = t === 'heartlocket' ? i.options.getAttachment('image2') : null;
  const text = t === 'heartlocket' ? i.options.getString('text') : null;
  if (second && text) throw new MediaError('Use either `image2` or `text` for the other side of the locket, not both.');
  let image2 = null;
  if (second) {
    if (!second.contentType?.startsWith('image/')) throw new MediaError('`image2` must be an image.');
    const file = await download({ url: second.url, name: second.name, contentType: second.contentType }, job.dir, 'second');
    image2 = await fx.makeJob(job.dir, file);
  }
  return makesweet(job, t, { output: i.options.getString('output') === 'MP4' ? 'mp4' : 'gif', image2, text });
}, { visual: true }), t === 'heartlocket' ? { tweaks: { text: { maxLength: 30 } } } : {}));

// ─── /media (direct) ─────────────────────────────────────────────────────────

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

export const mediaDirectSubs: Sub[] = [
  hsub('media ahshit', mediaHandler(async i => {
    await withWorkdir(async dir => {
      // Plain /media ahshit sends the clip itself (green screen, with its audio), as Heist does. Only a picture you attach or
      // link gets CJ keyed over it — no guessing from the channel's recent messages.
      const given = !!(i.options.getAttachment('image') || i.options.getString('url'));
      const job = given ? await fx.makeJob(dir, await download(await findMedia(i, 'any'), dir)) : null;
      if (job && !job.info.hasVideo) throw new MediaError('That needs an image, GIF or video — it has no picture.');
      const out = await fx2.ahshit(job, dir);
      await sendFile(i, dir, out.file, { name: out.name });
    });
  })),
  hsub('media frames', mediaHandler(async i => {
    await withWorkdir(async dir => {
      const ref = await findMedia(i, 'any');
      const file = await download(ref, dir);
      const job = await fx.makeJob(dir, file);
      if (!job.info.hasVideo) throw new MediaError('That file has no video frames — give me a GIF or a video.');
      if (!job.info.animated) throw new MediaError('That has only one frame — give me a GIF or a video.');
      if (job.info.duration > 30) throw new MediaError('That\'s longer than 30 seconds — trim it first.');
      const fps = job.info.fps > 0 ? job.info.fps : 10;
      const step = Math.max(1, Math.ceil((job.info.frames || job.info.duration * fps) / 100)); // ≤100 frames
      const cap = Math.max(job.info.width, job.info.height) > 640 ? 'scale=640:-2,' : '';
      await ffmpeg(['-i', file, '-vf', `${cap}select='not(mod(n\\,${step}))'`, '-vsync', 'vfr', 'frame_%03d.png'], { cwd: dir });
      const names = (await readdir(dir)).filter(n => /^frame_\d+\.png$/.test(n)).sort();
      if (!names.length) throw new MediaError('I couldn\'t extract any frames from that.');
      const zip = makeZip(await Promise.all(names.map(async n => ({ name: n, data: await readFile(path.join(dir, n)) }))));
      await sendBuffer(i, zip, 'frames.zip', `🎞️ ${names.length} frame${names.length === 1 ? '' : 's'}${step > 1 ? ` (every ${step}${step === 2 ? 'nd' : 'th'} frame)` : ''}`);
    });
  })),
  hsub('media info', mediaHandler(async i => {
    await withWorkdir(async dir => {
      const ref = await findMedia(i, 'any');
      const file = await download(ref, dir);
      const p = await probe(file, dir);
      const kind = p.hasVideo ? (p.animated ? (p.duration > 0 && p.format.includes('gif') ? 'GIF' : 'Video') : 'Image') : 'Audio';
      const lines = [
        `**Type:** ${kind}${p.videoCodec ? ` (${p.videoCodec})` : ''}`,
        p.hasVideo ? `**Resolution:** ${p.width}×${p.height}` : null,
        p.animated ? `**Duration:** ${p.duration.toFixed(2)}s · **FPS:** ${p.fps.toFixed(1)} · **Frames:** ${p.frames}` : p.hasAudio && !p.hasVideo ? `**Duration:** ${p.duration.toFixed(2)}s` : null,
        p.hasAudio ? `**Audio:** ${p.audioRate} Hz` : (p.hasVideo ? '**Audio:** none' : null),
        `**Size:** ${fmtSize(p.size || (await readFile(path.join(dir, file))).length)}`,
      ].filter(Boolean);
      await i.editReply(cv2Box(`ℹ️ **${ref.name}**\n${lines.join('\n')}`, Blurple));
    });
  })),
];

export const mediaGroups: SubGroup[] = [
  { name: 'image', description: 'Image & GIF effects', subs: imageSubs },
  { name: 'video', description: '✨ Video tools', subs: videoSubs },
  { name: 'makesweet', description: 'Put your image into an animated scene', subs: makesweetSubs },
];

// ─── /audio ──────────────────────────────────────────────────────────────────

/** Heist's three earrape levels on the acrusher scale effects.ts uses (1–5). */
const EARRAPE: Record<number, number> = { 1: 2, 2: 3, 3: 5 };
const AUDIO_ORDER: fx.AudioEffect[] = ['nightcore', 'bassboost', 'earrape', 'lofi', 'phonk', 'reverse', 'slowedandreverb', '8d', 'spatial'];

export const audioSubs: Sub[] = AUDIO_ORDER.map(e => hsub(`audio ${e}`, withMedia('audio', (i, j) =>
  fx.audioEffect(j, e, e === 'earrape' ? (EARRAPE[i.options.getInteger('level') ?? 2] ?? 3) : 3))));
