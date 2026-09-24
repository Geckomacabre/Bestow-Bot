import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AttachmentBuilder, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';
import { assertPublicUrl, getBuffer } from './http.js';
import { cv2Err } from '../utils/components.js';

/**
 * Shared plumbing for every command that turns user media into new media: safe download,
 * temp workdirs, ffprobe/ffmpeg with a timeout and a concurrency cap, and upload-size checks.
 */

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const FFMPEG_BIN = Bun.env.FFMPEG_PATH ?? 'ffmpeg';
export const FFPROBE_BIN = Bun.env.FFPROBE_PATH ?? 'ffprobe';
const MAX_CONCURRENT = Math.max(1, Number(Bun.env.FFMPEG_CONCURRENCY ?? 2));

let running = 0;
const waiters: (() => void)[] = [];
async function gated<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>(res => waiters.push(res));
  running++;
  try { return await fn(); } finally { running--; waiters.shift()?.(); }
}

export class MediaError extends Error {}

export async function withWorkdir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'onyx-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function run(bin: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn([bin, ...args], { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, opts.timeoutMs ?? 90_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (timedOut) throw new MediaError('That took too long to process — try a shorter or smaller file.');
    if (code !== 0) throw new MediaError(explain(stderr));
    return { stdout, stderr };
  } catch (err) {
    if (err instanceof MediaError) throw err;
    if ((err as { code?: string })?.code === 'ENOENT') throw new MediaError(`${bin} is not installed on the bot's host.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function explain(stderr: string): string {
  const lines = stderr.trim().split('\n').filter(Boolean);
  const last = lines.at(-1) ?? 'unknown error';
  if (/Invalid data found|moov atom not found|could not find codec/i.test(stderr)) return 'I couldn\'t read that file — is it a valid image/video/audio?';
  if (/does not contain any stream|Output file does not contain/i.test(stderr)) return 'That file doesn\'t contain the kind of stream this command needs (e.g. no audio track).';
  return `Processing failed: ${last.slice(0, 200)}`;
}

export function ffmpeg(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<void> {
  return gated(async () => { await run(FFMPEG_BIN, ['-hide_banner', '-loglevel', 'error', '-y', ...args], opts); });
}

export interface Probe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  frames: number;
  hasVideo: boolean;
  hasAudio: boolean;
  audioRate: number;
  format: string;
  size: number;
  /** Multi-frame image/video (gif, animated webp, mp4…). */
  animated: boolean;
  videoCodec?: string;
}

export async function probe(file: string, cwd?: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE_BIN, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { cwd, timeoutMs: 20_000 });
  const j = JSON.parse(stdout) as {
    streams?: { codec_type: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string; duration?: string; sample_rate?: string }[];
    format?: { duration?: string; size?: string; format_name?: string };
  };
  const v = j.streams?.find(s => s.codec_type === 'video');
  const a = j.streams?.find(s => s.codec_type === 'audio');
  const [n, d] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  const fps = d ? (n ?? 0) / d : 0;
  const duration = Number(v?.duration ?? j.format?.duration ?? 0) || Number(j.format?.duration ?? 0) || 0;
  const frames = Number(v?.nb_frames ?? 0) || Math.round(duration * fps);
  const still = /^(png_pipe|jpeg_pipe|image2|webp_pipe|bmp_pipe|tiff_pipe|ppm_pipe)$/.test(j.format?.format_name?.split(',')[0] ?? '') || ['png', 'mjpeg', 'bmp', 'tiff'].includes(v?.codec_name ?? '');
  return {
    duration, width: v?.width ?? 0, height: v?.height ?? 0, fps, frames,
    hasVideo: !!v, hasAudio: !!a, audioRate: Number(a?.sample_rate ?? 44100),
    format: j.format?.format_name ?? '', size: Number(j.format?.size ?? 0),
    animated: !!v && !still && (frames > 1 || duration > 0.1), videoCodec: v?.codec_name,
  };
}

// ─── Input resolution ────────────────────────────────────────────────────────

export type Kind = 'image' | 'video' | 'audio' | 'any';
export interface MediaRef { url: string; name: string; contentType: string | null }

const KIND_MIME: Record<Exclude<Kind, 'any'>, RegExp> = { image: /^image\//, video: /^(video\/|image\/gif)/, audio: /^(audio\/|video\/)/ };
const okKind = (ct: string | null | undefined, kind: Kind) => kind === 'any' || !ct || KIND_MIME[kind].test(ct);

/** Option names accepted for the attachment / URL, per kind. */
const ATTACH_NAMES: Record<Kind, string[]> = { image: ['image', 'media'], video: ['video', 'media'], audio: ['file', 'audio', 'media'], any: ['media', 'image', 'video', 'file'] };

export function mediaOptions(kind: Kind, sub: SlashCommandSubcommandBuilder, opts: { required?: boolean; extra?: string } = {}) {
  const label = kind === 'image' ? 'image' : kind === 'video' ? 'video/GIF' : kind === 'audio' ? 'audio/video' : 'media';
  const name = ATTACH_NAMES[kind][0]!;
  sub.addAttachmentOption(o => o.setName(name).setDescription(`Upload a ${label}${opts.extra ? ` ${opts.extra}` : ''}`).setRequired(!!opts.required));
  sub.addStringOption(o => o.setName('url').setDescription(`Or a link to a ${label} (default: the latest one in this channel)`));
  return sub;
}

/** attachment option → `url` option → latest matching media in the channel. */
export async function findMedia(interaction: ChatInputCommandInteraction, kind: Kind): Promise<MediaRef> {
  for (const n of ATTACH_NAMES[kind]) {
    const att = interaction.options.getAttachment(n);
    if (att) {
      if (!okKind(att.contentType, kind)) throw new MediaError(`That attachment isn't ${kind === 'any' ? 'media' : `a${kind === 'image' ? 'n' : ''} ${kind}`}.`);
      return { url: att.url, name: att.name, contentType: att.contentType };
    }
  }
  const url = interaction.options.getString('url');
  if (url) return { url: assertPublicUrl(url).toString(), name: path.basename(new URL(url).pathname) || 'media', contentType: null };

  const ch = interaction.channel;
  if (ch && 'messages' in ch) {
    try {
      const messages = await ch.messages.fetch({ limit: 25 });
      for (const [, msg] of messages) {
        for (const att of msg.attachments.values()) if (okKind(att.contentType, kind) && att.contentType) return { url: att.url, name: att.name, contentType: att.contentType };
        for (const e of msg.embeds) {
          const u = kind === 'video' || kind === 'audio' ? e.video?.url : e.image?.url ?? e.thumbnail?.url;
          if (u) return { url: u, name: 'embed', contentType: null };
        }
      }
    } catch { /* no history permission */ }
  }
  throw new MediaError(`I couldn't find ${kind === 'any' ? 'any media' : `a${kind === 'image' ? 'n' : ''} ${kind}`}. Attach one, paste a link, or run this near a recent one.`);
}

/** Download into `dir` (size-capped, SSRF-checked) and return the local filename. */
export async function download(ref: MediaRef, dir: string, base = 'input'): Promise<string> {
  const buf = await getBuffer(assertPublicUrl(ref.url).toString(), { maxBytes: MAX_INPUT_BYTES, timeoutMs: 30_000 });
  const ext = path.extname(ref.name).replace(/[^.\w]/g, '').slice(0, 6);
  const file = `${base}${ext || '.bin'}`;
  await writeFile(path.join(dir, file), buf);
  return file;
}

// ─── Output ──────────────────────────────────────────────────────────────────

export function uploadLimit(interaction: ChatInputCommandInteraction): number {
  return interaction.attachmentSizeLimit || 10 * 1024 * 1024;
}

export async function sendFile(interaction: ChatInputCommandInteraction, dir: string, file: string, opts: { content?: string; name?: string } = {}): Promise<void> {
  const full = path.join(dir, file);
  const size = (await stat(full)).size;
  const limit = uploadLimit(interaction);
  if (size > limit) throw new MediaError(`The result is ${(size / 1048576).toFixed(1)} MB, over this server's ${(limit / 1048576).toFixed(0)} MB upload limit. Try a shorter clip or a smaller file.`);
  const data = await readFile(full);
  await interaction.editReply({ content: opts.content ?? '', files: [new AttachmentBuilder(data, { name: opts.name ?? file })], components: [] });
}

export async function sendBuffer(interaction: ChatInputCommandInteraction, data: Buffer, name: string, content = ''): Promise<void> {
  const limit = uploadLimit(interaction);
  if (data.length > limit) throw new MediaError(`The result is ${(data.length / 1048576).toFixed(1)} MB, over the ${(limit / 1048576).toFixed(0)} MB upload limit.`);
  await interaction.editReply({ content, files: [new AttachmentBuilder(data, { name })], components: [] });
}

/**
 * Wrap a media handler: defer, run, and turn any failure into a friendly ephemeral-style error
 * (MediaError messages are safe to show; anything else is logged and summarised).
 */
export function mediaHandler(fn: (i: ChatInputCommandInteraction) => Promise<void>) {
  return async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    try {
      await fn(interaction);
    } catch (err) {
      const msg = err instanceof MediaError || (err instanceof Error && /too large|timed out|not a valid|not allowed|Only http/i.test(err.message))
        ? (err as Error).message
        : 'Something went wrong while processing that.';
      if (!(err instanceof MediaError)) console.error('[media]', err);
      await interaction.editReply({ ...cv2Err(`❌ ${msg}`), files: [] }).catch(() => {});
    }
  };
}

// ─── Small helpers shared by filters ─────────────────────────────────────────

/** Clamp a probed dimension pair so the longest side is ≤ max, keeping both even (required by yuv420p). */
export function fitEven(w: number, h: number, max: number): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2);
  return { w: even(w), h: even(h) };
}

export const GIF_PALETTE = 'split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
