import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { MediaError, withWorkdir } from '../framework/media.js';

/**
 * /media download — fetch a video or audio track from a supported site with yt-dlp.
 *
 * Safety: yt-dlp will happily fetch arbitrary URLs through its generic extractor, so only an allow-list of well-known sites is accepted
 * (https only, no credentials). Playlists, live streams and long videos are refused; file size is capped to the server's upload limit.
 * Env: YTDLP_PATH (default "yt-dlp"), YTDLP_COOKIES (optional path to a cookies file — helps with sites that ask for login/bot checks).
 */

export const YTDLP = Bun.env.YTDLP_PATH ?? 'yt-dlp';
export const MAX_DURATION = 600; // seconds
export const TIMEOUT_MS = 150_000;

export const ALLOWED_HOSTS = [
  'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'twitter.com', 'x.com', 'reddit.com', 'redd.it', 'soundcloud.com', 'twitch.tv', 'vimeo.com', 'streamable.com',
  'dailymotion.com', 'bilibili.com', 'imgur.com', 'facebook.com', 'fb.watch', 'bsky.app', 'pinterest.com', 'tumblr.com', 'bandcamp.com', 'mixcloud.com', 'kick.com', 'medal.tv', 'clips.twitch.tv',
];

export function parseDownloadUrl(input: string): URL {
  let u: URL;
  try { u = new URL(input.trim()); } catch { throw new MediaError('That doesn\'t look like a link.'); }
  if (u.protocol !== 'https:') throw new MediaError('Only https links are supported.');
  if (u.username || u.password) throw new MediaError('Links with a username/password aren\'t supported.');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!ALLOWED_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) {
    throw new MediaError(`I can only download from a few well-known sites (${ALLOWED_HOSTS.slice(0, 8).join(', ')}…). That link isn't one of them.`);
  }
  if (u.port && u.port !== '443') throw new MediaError('That link uses an unusual port.');
  return u;
}

export type Mode = 'video' | 'audio';

/** yt-dlp arguments. `height` is the maximum video height for this attempt. */
export function buildArgs(url: string, o: { mode: Mode; maxBytes: number; dir: string; height?: number; cookies?: string }): string[] {
  const common = [
    '--ignore-config', '--no-playlist', '--no-warnings', '--no-progress', '--no-part', '--no-mtime', '--no-exec',
    '--socket-timeout', '15', '--retries', '2', '--fragment-retries', '2',
    '--max-filesize', String(o.maxBytes),
    '--match-filter', `!is_live & duration<=${MAX_DURATION}`,
    '-o', path.join(o.dir, 'out.%(ext)s'),
  ];
  if (o.cookies) common.push('--cookies', o.cookies);
  const kind = o.mode === 'audio'
    ? ['-x', '--audio-format', 'mp3', '--audio-quality', '5']
    : ['-f', `bv*[height<=${o.height ?? 720}]+ba/b[height<=${o.height ?? 720}]/b`, '--merge-output-format', 'mp4', '--remux-video', 'mp4'];
  return [...common, ...kind, '--', url];
}

export interface Runner { (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }): Promise<{ code: number; stdout: string; stderr: string }> }

const defaultRun: Runner = async (cmd, args, { cwd, timeoutMs }) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try { proc = Bun.spawn([cmd, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' }); } catch { throw new MediaError('The downloader (yt-dlp) isn\'t installed on this bot.'); }
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()]);
    return { code: await proc.exited, stdout, stderr };
  } finally { clearTimeout(timer); }
};

/** Turns yt-dlp's stderr into something a person can act on. */
export function explainFailure(stderr: string): string {
  const s = stderr.toLowerCase();
  if (/does not pass filter|is_live|live event|duration/.test(s)) return `That video is live or longer than ${MAX_DURATION / 60} minutes.`;
  if (/larger than max-filesize|file is larger/.test(s)) return 'That file is too big to upload here, even at low quality.';
  if (/sign in to confirm|not a bot|login required|log in|cookies|private video|members-only|age-restricted|confirm your age/.test(s)) return 'That site wants a login or a bot check for this video, so I can\'t fetch it.';
  if (/unsupported url/.test(s)) return 'That link isn\'t a video I can download.';
  if (/video unavailable|has been removed|does not exist|404|not available|deleted/.test(s)) return 'That video isn\'t available (removed, private or region-locked).';
  if (/http error 429|too many requests/.test(s)) return 'The site is rate-limiting me right now — try again in a few minutes.';
  if (/copyright|blocked/.test(s)) return 'That video is blocked and can\'t be downloaded.';
  return 'I couldn\'t download that. The site may have changed or blocked downloads.';
}

export interface Downloaded { file: string; name: string; bytes: number; height?: number; mode: Mode }

/** yt-dlp's metadata for a post — the fields reposts use. */
export interface PostInfo {
  title?: string; description?: string; uploader?: string; uploader_id?: string; uploader_url?: string; channel?: string; channel_url?: string;
  like_count?: number; comment_count?: number; view_count?: number; repost_count?: number; timestamp?: number; thumbnail?: string; webpage_url?: string; ext?: string;
}

/** Parses the JSON line yt-dlp prints with --dump-json (ignores any other output). */
export function parseInfoJson(stdout: string): PostInfo | null {
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { return JSON.parse(t) as PostInfo; } catch { /* next line */ }
  }
  return null;
}

/**
 * Downloads a post (video, or audio with mode 'audio') and returns its metadata too — used by the repost commands for
 * Instagram and Medal, whose pages need yt-dlp's extractors. Tries 720p, 480p, 360p until it fits.
 */
export async function downloadPost(input: string, o: { maxBytes: number; mode?: Mode; run?: Runner }): Promise<{ info: PostInfo; data: Buffer; ext: string }> {
  const url = parseDownloadUrl(input).toString();
  const run = o.run ?? defaultRun;
  const mode = o.mode ?? 'video';
  return withWorkdir(async dir => {
    let lastErr = '';
    for (const h of mode === 'audio' ? [undefined] : [720, 480, 360]) {
      const args = buildArgs(url, { mode, maxBytes: o.maxBytes, dir, height: h, cookies: Bun.env.YTDLP_COOKIES });
      args.splice(args.indexOf('--'), 0, '--dump-json', '--no-simulate');
      const r = await run(YTDLP, args, { cwd: dir, timeoutMs: TIMEOUT_MS });
      const files = (await readdir(dir)).filter(f => f.startsWith('out.') && !/\.(part|ytdl|json|jpg|webp|png)$/.test(f));
      const info = parseInfoJson(r.stdout);
      if (r.code === 0 && files.length && info) {
        const file = path.join(dir, files[0]!);
        if ((await stat(file)).size <= o.maxBytes) return { info, data: Buffer.from(await Bun.file(file).arrayBuffer()), ext: files[0]!.split('.').pop()! };
        lastErr = 'larger than max-filesize';
        continue;
      }
      lastErr = r.stderr;
      if (!/larger than max-filesize|file is larger/i.test(r.stderr)) break;
    }
    throw new MediaError(explainFailure(lastErr));
  });
}

/**
 * /soundcloud: a track URL, or a search (yt-dlp's `scsearch1:` prefix — a search, never a URL, so no allow-list is needed for it).
 * Audio comes back as MP3 with the track's metadata.
 */
export async function soundcloud(query: string, o: { maxBytes: number; run?: Runner }): Promise<{ info: PostInfo; data: Buffer }> {
  const q = query.trim();
  if (/^https?:\/\//i.test(q)) {
    const u = parseDownloadUrl(q);
    if (!/(^|\.)soundcloud\.com$/i.test(u.hostname)) throw new MediaError('That isn\'t a SoundCloud link.');
    const r = await downloadPost(u.toString(), { maxBytes: o.maxBytes, mode: 'audio', run: o.run });
    return { info: r.info, data: r.data };
  }
  if (!q || q.length > 200) throw new MediaError('Give me a song to search for.');
  const run = o.run ?? defaultRun;
  return withWorkdir(async dir => {
    const args = buildArgs('x', { mode: 'audio', maxBytes: o.maxBytes, dir, cookies: Bun.env.YTDLP_COOKIES });
    args.splice(args.indexOf('--'), 2, '--dump-json', '--no-simulate', '--', `scsearch1:${q}`);
    const r = await run(YTDLP, args, { cwd: dir, timeoutMs: TIMEOUT_MS });
    const files = (await readdir(dir)).filter(f => f.startsWith('out.') && !/\.(part|ytdl|json|jpg|webp|png)$/.test(f));
    const info = parseInfoJson(r.stdout);
    if (r.code !== 0) throw new MediaError(explainFailure(r.stderr));
    if (!files.length || !info) throw new MediaError(`No SoundCloud tracks found for **${q.slice(0, 80)}**.`);
    return { info, data: Buffer.from(await Bun.file(path.join(dir, files[0]!)).arrayBuffer()) };
  });
}

export const HEIGHTS = [1080, 720, 480, 360, 240, 144] as const;

/** The resolutions to try, best first: the requested one (default 720p) and then each smaller one, so an oversized file can shrink. */
export function heightLadder(max = 720): number[] {
  const start = HEIGHTS.find(h => h <= max) ?? 144;
  return HEIGHTS.filter(h => h <= start).slice(0, 3);
}

/**
 * Downloads to a temp dir and hands the file to `use` before the directory is cleaned up.
 * Video tries the requested height (default 720p), then smaller ones, until the result fits `maxBytes`.
 */
export async function downloadMedia<T>(input: string, o: { mode: Mode; maxBytes: number; maxHeight?: number; run?: Runner }, use: (d: Downloaded) => Promise<T>): Promise<T> {
  const url = parseDownloadUrl(input).toString();
  const run = o.run ?? defaultRun;
  const heights = o.mode === 'audio' ? [undefined] : heightLadder(o.maxHeight);
  return withWorkdir(async dir => {
    let lastErr = '';
    for (const h of heights) {
      const r = await run(YTDLP, buildArgs(url, { mode: o.mode, maxBytes: o.maxBytes, dir, height: h, cookies: Bun.env.YTDLP_COOKIES }), { cwd: dir, timeoutMs: TIMEOUT_MS });
      const files = (await readdir(dir)).filter(f => f.startsWith('out.') && !/\.(part|ytdl|json|jpg|webp|png)$/.test(f));
      if (r.code === 0 && files.length) {
        const file = path.join(dir, files[0]!);
        const bytes = (await stat(file)).size;
        if (bytes <= o.maxBytes) return use({ file, name: `download.${files[0]!.split('.').pop()}`, bytes, height: h, mode: o.mode });
        lastErr = 'larger than max-filesize';
        continue; // too big: try a smaller resolution
      }
      lastErr = r.stderr;
      if (!/larger than max-filesize|file is larger/i.test(r.stderr)) break; // only a size problem is worth retrying at lower quality
    }
    throw new MediaError(explainFailure(lastErr));
  });
}
