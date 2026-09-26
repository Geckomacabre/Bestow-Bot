import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { MediaError, ffmpeg } from '../framework/media.js';
import type { Job, Out } from './effects.js';

/**
 * /media makesweet: the scenes come from MakeSweet itself (https://makesweet.com), through its API (https://api.makesweet.com):
 * `POST /make/<design>` with the pictures as multipart `images[]`, an optional `text` and the API key in an Authorization header.
 * It answers with the finished GIF. Env: MAKESWEET_API_KEY — a free key comes with a MakeSweet account (sign in on api.makesweet.com);
 * the account's plan decides how much can be rendered per day and which designs can be used.
 */

export const TEMPLATES = ['billboard', 'flag', 'flag2', 'rubiks', 'book', 'toaster', 'valentine', 'circuitboard', 'fortunecookie', 'backtattoo', 'heartlocket'] as const;
export type Template = (typeof TEMPLATES)[number];

/**
 * Heist's scene names → the design on makesweet.com, by the name the API knows it by (makesweet.com/my/<slug> shows it).
 * A free MakeSweet account can render ten designs — heart-locket, flag, billboard-cityscape, nesting-doll, circuit-board, bearplane,
 * fortune-cookie, gift-box, back-tattoo and rubiks-cube — so of these, `flag2`, `book`, `toaster` and `valentine` need MakeSweet Deluxe.
 */
export const SLUGS: Record<Template, string> = {
  billboard: 'billboard-cityscape', flag: 'flag', flag2: 'flag-wave', rubiks: 'rubiks-cube', book: 'single-minded-binder', toaster: 'toast', valentine: 'valentine-flowers',
  circuitboard: 'circuit-board', fortunecookie: 'fortune-cookie', backtattoo: 'back-tattoo', heartlocket: 'heart-locket',
};

export const API = 'https://api.makesweet.com/make';
const TIMEOUT_MS = 90_000;
/** Pictures are sent no bigger than this: MakeSweet draws them small, and a smaller upload is quicker. */
const MAX_SIDE = 1000;

/** Test hooks: another `fetch`, and a key that doesn't come from the environment. */
export const hooks: { fetch?: typeof fetch; key?: string } = {};

/** The first frame of the input as a PNG, at most MAX_SIDE px on its longer side. */
async function stillPng(job: Job, name: string): Promise<Buffer> {
  await ffmpeg(['-i', job.input, '-vf', `scale='min(${MAX_SIDE},iw)':'min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`, '-frames:v', '1', name], { cwd: job.dir });
  return readFile(path.join(job.dir, name));
}

/** What MakeSweet's refusal means for the person who ran the command. */
export function explain(status: number, body: string): string {
  let said = '';
  try { said = String((JSON.parse(body) as { error?: unknown }).error ?? ''); } catch { said = body.replace(/\s+/g, ' ').trim(); }
  said = said.slice(0, 200);
  if (status === 401) return 'MakeSweet didn\'t accept the bot\'s API key. Whoever runs the bot needs to check `MAKESWEET_API_KEY`.';
  if (status === 402) return 'That scene is a MakeSweet Deluxe design, and the account the bot uses is on the free plan. Try another scene.';
  if (status === 404) return 'MakeSweet doesn\'t have that scene any more.';
  if (status === 403) return `MakeSweet won't render that with the bot's account${said ? ` (“${said}”)` : ''}.`;
  if (status === 429) return 'The bot has used up its MakeSweet renders for now. Try again later.';
  if (status >= 500) return 'MakeSweet is having trouble right now. Try again in a moment.';
  return `MakeSweet couldn't make that${said ? `: “${said}”` : '.'}`;
}

/**
 * Asks MakeSweet to render `template` with the job's picture (and a second picture or a line of text, for the heart locket).
 * `output` MP4 converts MakeSweet's GIF, which is the only thing its API returns.
 */
export async function makesweet(job: Job, template: Template, o: { output?: 'gif' | 'mp4'; image2?: Job | null; text?: string | null } = {}): Promise<Out> {
  const key = (hooks.key ?? Bun.env.MAKESWEET_API_KEY ?? '').trim();
  if (!key) throw new MediaError('MakeSweet scenes need an API key, and this bot doesn\'t have one yet. Whoever runs the bot can get a free one at https://api.makesweet.com/ and set `MAKESWEET_API_KEY`.');

  const form = new FormData();
  form.append('images[]', new Blob([new Uint8Array(await stillPng(job, 'ms1.png'))], { type: 'image/png' }), 'image1.png');
  if (o.image2) form.append('images[]', new Blob([new Uint8Array(await stillPng(o.image2, 'ms2.png'))], { type: 'image/png' }), 'image2.png');
  const url = new URL(`${API}/${SLUGS[template]}`);
  const text = o.text?.replace(/\s+/g, ' ').trim();
  if (text) url.searchParams.set('text', text);

  let res: Response;
  try { res = await (hooks.fetch ?? fetch)(url, { method: 'POST', headers: { Authorization: key }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch (err) { throw new MediaError(/timed out|abort/i.test(String(err)) ? 'MakeSweet took too long to make that. Try again in a moment.' : 'I couldn\'t reach MakeSweet. Try again in a moment.'); }
  if (!res.ok) throw new MediaError(explain(res.status, await res.text().catch(() => '')));

  const gif = Buffer.from(await res.arrayBuffer());
  if (gif.subarray(0, 4).toString('latin1') !== 'GIF8') throw new MediaError('MakeSweet sent back something that isn\'t a picture. Try again in a moment.');
  await writeFile(path.join(job.dir, 'out.gif'), gif);
  if (o.output !== 'mp4') return { file: 'out.gif', name: `${template}.gif` };

  await ffmpeg(['-i', 'out.gif', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', '-movflags', '+faststart', 'out.mp4'], { cwd: job.dir, timeoutMs: 120_000 });
  return { file: 'out.mp4', name: `${template}.mp4` };
}
