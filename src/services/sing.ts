import { withLock } from '../framework/mutex.js';
import { MediaError } from '../framework/media.js';

/**
 * Text → sung song, through a locally hosted ACE-Step 1.5 server (free, open source, runs on your own GPU).
 * Start it with `uv run acestep-api` (port 8001) and set ACESTEP_URL if it isn't on localhost.
 * Contract: POST /release_task → task_id; POST /query_result {task_id_list} → status 0 running / 1 done / 2 failed;
 * GET <file> (e.g. /v1/audio?path=…) → the audio.
 */

export const SING_MIN_SECONDS = 10;
export const SING_MAX_SECONDS = Number(Bun.env.SING_MAX_SECONDS ?? 60);
/** Every song is this long (keeps generation quick on a modest GPU). Override with SING_SECONDS. */
export const SING_SECONDS = Math.min(SING_MAX_SECONDS, Math.max(SING_MIN_SECONDS, Number(Bun.env.SING_SECONDS ?? 30)));
export const SING_MAX_QUEUE = 3;
export const SING_COOLDOWN_MS = Number(Bun.env.SING_COOLDOWN_MS ?? 2 * 60_000);

export const singConfig = () => ({
  base: (Bun.env.ACESTEP_URL ?? 'http://127.0.0.1:8001').replace(/\/+$/, ''),
  key: Bun.env.ACESTEP_API_KEY ?? '',
  timeoutMs: Number(Bun.env.SING_TIMEOUT_MS ?? 15 * 60_000),
  pollMs: Number(Bun.env.SING_POLL_MS ?? 3000),
});

const headers = (json = false): Record<string, string> => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(singConfig().key ? { Authorization: `Bearer ${singConfig().key}` } : {}),
});

async function api<T>(path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const { base } = singConfig();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new MediaError(`The singing service answered ${res.status}.`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof MediaError) throw err;
    throw new MediaError('Singing isn\'t available: I can\'t reach the music model on this bot\'s host. (The owner needs to start ACE-Step — see the README.)');
  } finally {
    clearTimeout(t);
  }
}

export async function singHealthy(): Promise<boolean> {
  try {
    const r = await api<{ data?: { status?: string } }>('/health', { headers: headers() }, 4000);
    return r.data?.status === 'ok';
  } catch { return false; }
}

export interface SingRequest {
  /** Genre / mood / instrumentation description. */
  style: string;
  lyrics: string;
  /** Defaults to SING_SECONDS (30). Clamped to the allowed range. */
  seconds?: number;
  language?: string;
}

export interface SingResult { mp3: Buffer; seconds: number; bpm?: number; key?: string }

interface Task<T> { code?: number; data?: T }
type QueryItem = { task_id: string; status: number; result?: string };

/** Strip section-less lyric junk and cap length so the model isn't fed a novel. */
export function normalizeLyrics(lyrics: string): string {
  const cleaned = lyrics.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1800);
  // ACE-Step expects structure tags like [verse] / [chorus]; add one if the user gave bare lines.
  return /\[[a-z][^\]]*\]/i.test(cleaned) ? cleaned : `[verse]\n${cleaned}`;
}

export function parseQueryResult(raw: string | undefined): { file?: string; bpm?: number; key?: string; duration?: number } {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  const first = (Array.isArray(parsed) ? parsed[0] : parsed) as { file?: string; metas?: { bpm?: number; keyscale?: string; duration?: number } } | undefined;
  return { file: first?.file, bpm: first?.metas?.bpm, key: first?.metas?.keyscale, duration: first?.metas?.duration };
}

export async function generateSong(req: SingRequest, onProgress?: (msg: string) => void): Promise<SingResult> {
  const cfg = singConfig();
  const seconds = Math.min(SING_MAX_SECONDS, Math.max(SING_MIN_SECONDS, Math.round(req.seconds ?? SING_SECONDS)));
  const submit = await api<Task<{ task_id: string; queue_position?: number }>>('/release_task', {
    method: 'POST', headers: headers(true),
    body: JSON.stringify({
      prompt: req.style, lyrics: normalizeLyrics(req.lyrics), audio_duration: seconds, inference_steps: 8, batch_size: 1,
      use_random_seed: true, thinking: false, vocal_language: req.language ?? 'en', audio_format: 'mp3', task_type: 'text2music',
    }),
  });
  const taskId = submit.data?.task_id;
  if (!taskId) throw new MediaError('The singing service didn\'t accept the job.');
  onProgress?.(`queued${submit.data?.queue_position ? ` (position ${submit.data.queue_position})` : ''}`);

  const deadline = Date.now() + cfg.timeoutMs;
  while (Date.now() < deadline) {
    await Bun.sleep(cfg.pollMs);
    const q = await api<Task<QueryItem[]>>('/query_result', { method: 'POST', headers: headers(true), body: JSON.stringify({ task_id_list: [taskId] }) });
    const item = q.data?.find(x => x.task_id === taskId) ?? q.data?.[0];
    if (!item || item.status === 0) { onProgress?.('composing'); continue; }
    if (item.status === 2) throw new MediaError('The music model failed to make that song — try different lyrics or a shorter length.');
    const r = parseQueryResult(item.result);
    if (!r.file) throw new MediaError('The song finished but I couldn\'t find the audio file.');
    const url = /^https?:/i.test(r.file) ? r.file : `${cfg.base}${r.file.startsWith('/') ? '' : '/'}${r.file}`;
    const res = await fetch(url, { headers: headers() }).catch(() => null);
    if (!res?.ok) throw new MediaError('The song finished but I couldn\'t download it.');
    return { mp3: Buffer.from(await res.arrayBuffer()), seconds: r.duration ?? seconds, bpm: r.bpm, key: r.key };
  }
  throw new MediaError('That took too long — the music model may be busy. Try a shorter song.');
}

// ─── Queue & cooldown ────────────────────────────────────────────────────────

let waiting = 0;
const lastSing = new Map<string, number>();

/** Single-flight: the GPU makes one song at a time; at most SING_MAX_QUEUE requests wait. */
export async function queuedSong<T>(fn: () => Promise<T>): Promise<T> {
  if (waiting >= SING_MAX_QUEUE) throw new MediaError(`The music studio is busy (${waiting} songs in the queue). Try again in a few minutes.`);
  waiting++;
  try { return await withLock('sing:gpu', fn); } finally { waiting--; }
}
export const queueLength = () => waiting;

export function singCooldown(userId: string, now = Date.now()): number {
  const wait = (lastSing.get(userId) ?? 0) + SING_COOLDOWN_MS - now;
  if (wait > 0) return wait;
  lastSing.set(userId, now);
  return 0;
}
export const refundSingCooldown = (userId: string) => { lastSing.delete(userId); };
