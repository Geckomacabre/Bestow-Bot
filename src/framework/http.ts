/** Small fetch wrapper shared by all the lookup commands: timeout, UA, error shape, TTL cache. */

export const USER_AGENT = 'OnyxBot/1.0 (Discord bot; +https://github.com/)';

export class HttpError extends Error {
  constructor(public status: number, public url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

export interface HttpOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: BodyInit | null;
  /** Abort after this many ms (default 10s). */
  timeoutMs?: number;
  /** Cache successful GET responses for this long. */
  cacheMs?: number;
}

const CACHE_MAX = 500;
const cache = new Map<string, { at: number; ttl: number; value: unknown }>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) { cache.delete(key); return undefined; }
  return hit.value as T;
}

function cacheSet(key: string, ttl: number, value: unknown) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), ttl, value });
}

async function request(url: string, opts: HttpOptions): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...opts.headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new HttpError(res.status, url);
    return res;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as Error)?.name === 'AbortError') throw new Error(`Request timed out (${url})`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const key = opts.cacheMs ? `json:${opts.method ?? 'GET'}:${url}` : '';
  if (key) { const hit = cacheGet<T>(key); if (hit !== undefined) return hit; }
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  const data = (await res.json()) as T;
  if (key) cacheSet(key, opts.cacheMs!, data);
  return data;
}

export async function getText(url: string, opts: HttpOptions = {}): Promise<string> {
  const key = opts.cacheMs ? `text:${url}` : '';
  if (key) { const hit = cacheGet<string>(key); if (hit !== undefined) return hit; }
  const res = await request(url, opts);
  const text = await res.text();
  if (key) cacheSet(key, opts.cacheMs!, text);
  return text;
}

export async function getBuffer(url: string, opts: HttpOptions & { maxBytes?: number } = {}): Promise<Buffer> {
  const res = await request(url, opts);
  const max = opts.maxBytes ?? 25 * 1024 * 1024;
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len && len > max) throw new Error(`File too large (${(len / 1048576).toFixed(1)} MB, limit ${(max / 1048576).toFixed(0)} MB)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error(`File too large (${(buf.length / 1048576).toFixed(1)} MB, limit ${(max / 1048576).toFixed(0)} MB)`);
  return buf;
}

export async function postJson<T = unknown>(url: string, body: unknown, opts: HttpOptions = {}): Promise<T> {
  const res = await request(url, {
    ...opts,
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...opts.headers },
  });
  return (await res.json()) as T;
}

/** Only allow public http(s) URLs — blocks localhost/private ranges so user-supplied URLs can't probe the host network. */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('That is not a valid URL.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) links are supported.');
  // Test-only escape hatch so integration tests can serve fixtures from localhost. Ignored outside NODE_ENV=test.
  if (Bun.env.NODE_ENV === 'test' && Bun.env.ALLOW_PRIVATE_URLS === '1') return u;
  const h = u.hostname.toLowerCase();
  const privateHost =
    h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
    /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '::1' || h.startsWith('[') || /^fc|^fd|^fe80/.test(h);
  if (privateHost) throw new Error('That address is not allowed.');
  return u;
}
