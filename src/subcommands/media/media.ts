import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import {
  MediaError, download, ffmpeg, findMedia, mediaHandler, mediaOptions, probe, sendBuffer, sendFile, withWorkdir, type Kind,
} from '../../framework/media.js';
import { makeZip } from '../../framework/zip.js';
import { cv2Box } from '../../utils/components.js';
import * as fx from '../../media/effects.js';
import { AUDIO_EFFECTS } from '../../media/effects.js';

const Blurple = 0x5865f2;

/** Build a Sub whose handler downloads the media, probes it and hands a Job to `fn`. */
function mediaSub(kind: Kind, name: string, description: string, opts: {
  /** Required/optional options specific to this command (added BEFORE the media options so required ones stay first). */
  extra?: (s: SlashCommandSubcommandBuilder) => unknown;
  fn: (i: ChatInputCommandInteraction, job: fx.Job) => Promise<fx.Out | { data: Buffer; name: string; content?: string }>;
}): Sub {
  return {
    name, description,
    options: s => { opts.extra?.(s); mediaOptions(kind, s); },
    run: mediaHandler(async i => {
      await withWorkdir(async dir => {
        const ref = await findMedia(i, kind);
        const file = await download(ref, dir);
        const job = await fx.makeJob(dir, file);
        const out = await opts.fn(i, job);
        if ('data' in out) await sendBuffer(i, out.data, out.name, out.content);
        else await sendFile(i, dir, out.file, { name: out.name });
      });
    }),
  };
}

const posChoices = fx.POSITIONS.map(p => ({ name: p.replace('-', ' '), value: p }));
const wmOptions = (s: SlashCommandSubcommandBuilder) => s
  .addStringOption(o => o.setName('text').setDescription('Watermark text').setRequired(true).setMaxLength(100))
  .addStringOption(o => o.setName('position').setDescription('Where it goes (default bottom right)').addChoices(...posChoices))
  .addIntegerOption(o => o.setName('opacity').setDescription('5–100 (default 60)').setMinValue(5).setMaxValue(100))
  .addStringOption(o => o.setName('color').setDescription('Hex colour, e.g. #ffffff'))
  .addIntegerOption(o => o.setName('size').setDescription('Text size 1–30 (default 6)').setMinValue(1).setMaxValue(30));
const wmArgs = (i: ChatInputCommandInteraction) => ({
  position: (i.options.getString('position') ?? 'bottom-right') as fx.Position,
  opacity: i.options.getInteger('opacity') ?? 60,
  size: i.options.getInteger('size') ?? 6,
  color: i.options.getString('color') ?? '#ffffff',
});

// ─── /media image ────────────────────────────────────────────────────────────

export const imageSubs: Sub[] = [
  mediaSub('image', 'blur', 'Apply gaussian blur', { extra: s => s.addIntegerOption(o => o.setName('strength').setDescription('1–40 (default 8)').setMinValue(1).setMaxValue(40)), fn: (i, j) => fx.blur(j, i.options.getInteger('strength') ?? 8) }),
  mediaSub('image', 'pixelate', 'Pixelate an image', { extra: s => s.addIntegerOption(o => o.setName('size').setDescription('Pixel size 2–64 (default 16)').setMinValue(2).setMaxValue(64)), fn: (i, j) => fx.pixelate(j, i.options.getInteger('size') ?? 16) }),
  mediaSub('image', 'invert', 'Invert image colors', { fn: (_i, j) => fx.invert(j) }),
  mediaSub('image', 'grayscale', 'Convert an image to black & white', { fn: (_i, j) => fx.grayscale(j) }),
  mediaSub('image', 'flip', 'Flip or mirror an image', {
    extra: s => s.addStringOption(o => o.setName('direction').setDescription('Which way (default horizontal)').addChoices({ name: 'Horizontal (mirror)', value: 'horizontal' }, { name: 'Vertical (upside down)', value: 'vertical' }, { name: 'Both', value: 'both' })),
    fn: (i, j) => fx.flip(j, (i.options.getString('direction') ?? 'horizontal') as 'horizontal' | 'vertical' | 'both'),
  }),
  mediaSub('image', 'rotate', 'Rotate an image', { extra: s => s.addIntegerOption(o => o.setName('degrees').setDescription('Clockwise degrees (default 90)').setMinValue(-360).setMaxValue(360)), fn: (i, j) => fx.rotate(j, i.options.getInteger('degrees') ?? 90) }),
  mediaSub('image', 'fisheye', 'Apply fisheye lens distortion', { fn: (_i, j) => fx.fisheye(j) }),
  mediaSub('image', 'zoomblur', 'Radial motion blur zooming from the center', { extra: s => s.addIntegerOption(o => o.setName('power').setDescription('1–10 (default 5)').setMinValue(1).setMaxValue(10)), fn: (i, j) => fx.zoomBlur(j, i.options.getInteger('power') ?? 5) }),
  mediaSub('image', 'deepfry', 'Deepfry an image', { fn: (_i, j) => fx.deepfry(j) }),
  mediaSub('image', 'spin', 'Make an image spin', { fn: (_i, j) => fx.spin(j) }),
  mediaSub('image', 'pingpong', 'Make a GIF bounce back and forth', { fn: (_i, j) => fx.pingpong(j) }),
  mediaSub('image', 'togif', 'Convert an image or video to a GIF', { fn: (_i, j) => fx.toGif(j) }),
  mediaSub('image', 'caption', 'Add a caption bar to an image or GIF', {
    extra: s => s.addStringOption(o => o.setName('caption').setDescription('The caption text').setRequired(true).setMaxLength(300)).addBooleanOption(o => o.setName('caption_bottom').setDescription('Put the caption below instead of above')),
    fn: (i, j) => fx.caption(j, i.options.getString('caption', true), i.options.getBoolean('caption_bottom') ?? false),
  }),
  mediaSub('image', 'meme', 'Add top/bottom impact text to an image', {
    extra: s => s.addStringOption(o => o.setName('top').setDescription('Top text').setMaxLength(120)).addStringOption(o => o.setName('bottom').setDescription('Bottom text').setMaxLength(120)),
    fn: (i, j) => fx.meme(j, i.options.getString('top') ?? '', i.options.getString('bottom') ?? ''),
  }),
  mediaSub('image', 'watermark', 'Add a text watermark to an image', { extra: wmOptions, fn: (i, j) => fx.watermark(j, i.options.getString('text', true), wmArgs(i)) }),
  {
    name: 'overlay', description: 'Overlay one image on top of another',
    options: s => s
      .addAttachmentOption(o => o.setName('base').setDescription('The background image or GIF').setRequired(true))
      .addAttachmentOption(o => o.setName('overlay').setDescription('The image to put on top').setRequired(true))
      .addIntegerOption(o => o.setName('opacity').setDescription('0–100 (default 100)').setMinValue(0).setMaxValue(100))
      .addIntegerOption(o => o.setName('x').setDescription('Horizontal position 0–100% (default 50)').setMinValue(0).setMaxValue(100))
      .addIntegerOption(o => o.setName('y').setDescription('Vertical position 0–100% (default 50)').setMinValue(0).setMaxValue(100))
      .addIntegerOption(o => o.setName('scale').setDescription('Overlay width as % of the base (default 40)').setMinValue(1).setMaxValue(100)),
    run: mediaHandler(async i => {
      const base = i.options.getAttachment('base', true), over = i.options.getAttachment('overlay', true);
      for (const a of [base, over]) if (!a.contentType?.startsWith('image/')) throw new MediaError('Both attachments must be images.');
      await withWorkdir(async dir => {
        const baseFile = await download({ url: base.url, name: base.name, contentType: base.contentType }, dir, 'base');
        const overFile = await download({ url: over.url, name: over.name, contentType: over.contentType }, dir, 'over');
        const job = await fx.makeJob(dir, baseFile);
        const out = await fx.overlay(job, overFile, {
          opacity: i.options.getInteger('opacity') ?? 100, x: i.options.getInteger('x') ?? 50, y: i.options.getInteger('y') ?? 50, scale: i.options.getInteger('scale') ?? 40,
        });
        await sendFile(i, dir, out.file, { name: out.name });
      });
    }),
  },
];

// ─── /media video ────────────────────────────────────────────────────────────

export const videoSubs: Sub[] = [
  mediaSub('video', 'caption', 'Add a caption bar to a video', {
    extra: s => s.addStringOption(o => o.setName('caption').setDescription('The caption text').setRequired(true).setMaxLength(300)).addBooleanOption(o => o.setName('bottom').setDescription('Put the caption below instead of above')),
    fn: (i, j) => fx.caption(j, i.options.getString('caption', true), i.options.getBoolean('bottom') ?? false, true),
  }),
  mediaSub('video', 'crop', 'Crop a video to an aspect ratio', {
    extra: s => s
      .addStringOption(o => o.setName('ratio').setDescription('e.g. 16:9, 1:1, 9:16').setRequired(true))
      .addStringOption(o => o.setName('anchor').setDescription('Which part to keep (default center)').addChoices(...['center', 'top', 'bottom', 'left', 'right'].map(v => ({ name: v, value: v })))),
    fn: (i, j) => fx.videoCrop(j, i.options.getString('ratio', true), (i.options.getString('anchor') ?? 'center') as fx.Anchor),
  }),
  mediaSub('video', 'resize', 'Resize a video', { extra: s => s.addNumberOption(o => o.setName('scale').setDescription('Size multiplier 0.1–2 (default 0.5)').setMinValue(0.1).setMaxValue(2)), fn: (i, j) => fx.videoResize(j, i.options.getNumber('scale') ?? 0.5) }),
  mediaSub('video', 'reverse', 'Reverse a video or GIF', { fn: (_i, j) => fx.videoReverse(j) }),
  mediaSub('video', 'rotate', 'Rotate a video', { extra: s => s.addIntegerOption(o => o.setName('degrees').setDescription('Clockwise degrees (default 90)').setMinValue(-360).setMaxValue(360)), fn: (i, j) => fx.videoRotate(j, i.options.getInteger('degrees') ?? 90) }),
  mediaSub('video', 'scramble', 'Scramble the frames of a video or GIF', { fn: (_i, j) => fx.videoScramble(j) }),
  mediaSub('video', 'speed', 'Speed up or slow down a video', { extra: s => s.addNumberOption(o => o.setName('multiplier').setDescription('0.25–4 (default 2)').setMinValue(0.25).setMaxValue(4)), fn: (i, j) => fx.videoSpeed(j, i.options.getNumber('multiplier') ?? 2) }),
  mediaSub('video', 'togif', 'Convert a video to a GIF', { fn: (_i, j) => fx.toGif(j) }),
  mediaSub('video', 'watermark', 'Add a text watermark to a video', { extra: wmOptions, fn: (i, j) => fx.watermark(j, i.options.getString('text', true), wmArgs(i), true) }),
];

// ─── /media (direct) ─────────────────────────────────────────────────────────

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

export const mediaDirectSubs: Sub[] = [
  {
    name: 'info', description: 'Get info about an image, GIF, video or audio file',
    options: s => mediaOptions('any', s),
    run: mediaHandler(async i => {
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
    }),
  },
  {
    name: 'frames', description: 'Extract the frames of a GIF or video as a ZIP',
    options: s => mediaOptions('any', s),
    run: mediaHandler(async i => {
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
    }),
  },
  {
    name: 'addaudio', description: 'Combine a still image with an audio file into a video',
    options: s => s
      .addAttachmentOption(o => o.setName('image').setDescription('The picture').setRequired(true))
      .addAttachmentOption(o => o.setName('audio').setDescription('The audio (or a video to take its sound from)').setRequired(true))
      .addIntegerOption(o => o.setName('volume').setDescription('Volume % (default 100)').setMinValue(0).setMaxValue(300))
      .addNumberOption(o => o.setName('start').setDescription('Start the audio at this second').setMinValue(0))
      .addNumberOption(o => o.setName('end').setDescription('Stop the audio at this second').setMinValue(0)),
    run: mediaHandler(async i => {
      const img = i.options.getAttachment('image', true), aud = i.options.getAttachment('audio', true);
      if (!img.contentType?.startsWith('image/')) throw new MediaError('`image` must be an image.');
      if (!/^(audio|video)\//.test(aud.contentType ?? '')) throw new MediaError('`audio` must be an audio or video file.');
      await withWorkdir(async dir => {
        const imgFile = await download({ url: img.url, name: img.name, contentType: img.contentType }, dir, 'pic');
        const audFile = await download({ url: aud.url, name: aud.name, contentType: aud.contentType }, dir, 'sound');
        const info = await probe(audFile, dir);
        if (!info.hasAudio) throw new MediaError('That audio file has no sound in it.');
        const out = await fx.imageWithAudio(dir, imgFile, audFile, {
          loop: false, volume: i.options.getInteger('volume') ?? 100, start: i.options.getNumber('start') ?? 0, end: i.options.getNumber('end') ?? 0,
        });
        await sendFile(i, dir, out.file, { name: out.name });
      });
    }),
  },
];

// ─── /audio ──────────────────────────────────────────────────────────────────

export const audioSubs: Sub[] = AUDIO_EFFECTS.map(e => mediaSub('audio', e.value, e.description, {
  extra: e.value === 'earrape' ? (s => s.addIntegerOption(o => o.setName('level').setDescription('How bad 1–5 (default 3)').setMinValue(1).setMaxValue(5))) : undefined,
  fn: async (i, j) => fx.audioEffect(j, e.value, e.value === 'earrape' ? (i.options.getInteger('level') ?? 3) : 3),
}));
