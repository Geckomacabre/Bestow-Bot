import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getBufferPublic } from '../framework/http.js';
import { ffmpeg, withWorkdir } from '../framework/media.js';
import { BrowserUnavailable, chromiumPath, withPage } from '../framework/browser.js';
import { makeZip } from '../framework/zip.js';
import { LookupError } from './handler.js';
import { normalizeWebUrl } from './net.js';

/** /website screenshot|scroll|download. A headless browser when CHROMIUM_PATH is set; otherwise thum.io for images. */

const THUM = 'https://image.thum.io/get';

/** "5", "2.5s", "3 seconds" → seconds (0–10). */
export function parseDelay(input: string | null | undefined): number {
  if (!input) return 0;
  const n = Number(/^\s*(\d+(?:\.\d+)?)/.exec(input)?.[1]);
  if (!Number.isFinite(n) || n < 0) throw new LookupError('`delay` is a number of seconds, like `3`.');
  return Math.min(10, n);
}

export async function screenshot(input: string, o: { delay?: number; click?: boolean } = {}): Promise<{ png: Buffer; url: string; engine: string }> {
  const url = normalizeWebUrl(input);
  if (chromiumPath()) {
    try {
      const png = await withPage(async p => {
        await p.goto(url);
        if (o.delay) await Bun.sleep(o.delay * 1000);
        if (o.click) { await p.click(p.width / 2, p.height / 2); await Bun.sleep(1200); }
        return p.screenshot();
      });
      return { png, url, engine: 'Bestow' };
    } catch (e) { if (!(e instanceof BrowserUnavailable)) throw new LookupError((e as Error).message.includes('not allowed') ? 'That address is not allowed.' : 'That page didn\'t load in time.'); }
  }
  if (o.click) throw new LookupError('Clicking needs the headless browser, which isn\'t installed on this bot. Try without `click`.');
  const wait = o.delay ? `wait/${Math.ceil(o.delay)}/` : '';
  const png = await getBufferPublic(`${THUM}/width/1280/crop/720/noanimate/${wait}${url}`, { timeoutMs: 45_000, maxBytes: 8 * 1024 * 1024 });
  if (png.length < 500) throw new LookupError('The screenshot service returned nothing for that page.');
  return { png, url, engine: 'thum.io' };
}

async function fullPage(url: string): Promise<Buffer> {
  if (chromiumPath()) {
    try { return await withPage(async p => { await p.goto(url); await Bun.sleep(800); return p.screenshot({ fullPage: true, maxHeight: 9000 }); }); }
    catch (e) { if (!(e instanceof BrowserUnavailable)) throw new LookupError('That page didn\'t load in time.'); }
  }
  return getBufferPublic(`${THUM}/width/1280/fullpage/noanimate/${url}`, { timeoutMs: 60_000, maxBytes: 20 * 1024 * 1024 });
}

export const LENGTHS: Record<string, number> = { short: 6, medium: 12, long: 20 };

/**
 * The crop filter's y offset over time t (seconds) for a video of `d` seconds; `ih` is the page height and 720 the viewport.
 * normal: eases in and out. fast: a steady scroll. speedy: four quick flicks with short pauses between them.
 */
export function scrollExpr(animation: string, d: number): string {
  const span = '(ih-720)';
  if (animation === 'fast') return `${span}*min(1\\,t/${d})`;
  if (animation === 'speedy') {
    const steps = 4, seg = d / steps;
    // Each segment: flick through a quarter of the page in its first half, then pause.
    return `${span}*min(1\\,(floor(t/${seg})+min(1\\,2*mod(t\\,${seg})/${seg}))/${steps})`;
  }
  return `${span}*(1-cos(PI*min(1\\,t/${d})))/2`;
}

export async function scrollVideo(input: string, length: string, animation: string): Promise<{ mp4: Buffer; url: string }> {
  const url = normalizeWebUrl(input);
  const png = await fullPage(url);
  const d = LENGTHS[length] ?? LENGTHS.medium!;
  return withWorkdir(async dir => {
    await writeFile(path.join(dir, 'page.png'), png);
    // Scale to 1280 wide, make sure it's at least one screen tall, then pan the 1280×720 window down it.
    await ffmpeg(['-loop', '1', '-framerate', '30', '-i', 'page.png', '-t', String(d + 1),
      '-vf', `scale=1280:-2,pad=1280:max(ih\\,720):0:0:white,crop=1280:720:0:'${scrollExpr(animation, d)}',format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-movflags', '+faststart', '-r', '30', 'scroll.mp4'], { cwd: dir, timeoutMs: 120_000 });
    return { mp4: await readFile(path.join(dir, 'scroll.mp4')), url };
  });
}

// ─── Download the page and its assets as a ZIP ───────────────────────────────

const ASSET_RE = /(?:<(?:script|img|source|video|audio|iframe|embed)\b[^>]*?\ssrc|<link\b[^>]*?\shref)\s*=\s*["']([^"'#]+)["']/gi;
const CSS_URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

/** Local path inside the ZIP for an asset URL: assets/<host>/<path>, with a file name even for directory URLs. */
export function localPath(u: URL): string {
  let p = decodeURIComponent(u.pathname).replace(/[^\w./-]+/g, '_');
  if (p.endsWith('/') || !p.split('/').pop()!.includes('.')) p = `${p.replace(/\/$/, '')}/index${u.pathname.endsWith('.css') ? '.css' : ''}`;
  return `assets/${u.hostname}${p.startsWith('/') ? '' : '/'}${p}`.replace(/\/{2,}/g, '/').replace(/\.\.+/g, '.');
}

export function findAssets(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(ASSET_RE)) {
    try { const u = new URL(m[1]!.trim(), base); if (/^https?:$/.test(u.protocol)) out.add(u.toString()); } catch { /* skip */ }
  }
  return [...out];
}

export async function downloadSite(input: string, o: { maxFiles?: number; maxBytes?: number } = {}): Promise<{ zip: Buffer; files: number; bytes: number; url: string }> {
  const url = normalizeWebUrl(input);
  const maxFiles = o.maxFiles ?? 60, maxBytes = o.maxBytes ?? 20 * 1024 * 1024;
  let html = (await getBufferPublic(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 20_000 })).toString('utf8');
  const entries: { name: string; data: Buffer }[] = [];
  let total = html.length;
  const assets = findAssets(html, url).slice(0, maxFiles);
  const got = await Promise.all(assets.map(a => getBufferPublic(a, { maxBytes: 5 * 1024 * 1024, timeoutMs: 20_000 }).then(b => [a, b] as const).catch(() => null)));
  for (const r of got) {
    if (!r) continue;
    const [a, buf] = r;
    if (total + buf.length > maxBytes) break;
    let data = buf;
    const local = localPath(new URL(a));
    if (/\.css(\?|$)/i.test(a)) {
      // Point url(...) references inside the stylesheet at absolute addresses so they still resolve from the saved copy.
      data = Buffer.from(buf.toString('utf8').replace(CSS_URL_RE, (m, ref: string) => { try { return `url("${new URL(ref, a).toString()}")`; } catch { return m; } }));
    }
    entries.push({ name: local, data });
    total += data.length;
    html = html.split(`"${a}"`).join(`"${local}"`);
    const rel = new URL(a).pathname;
    html = html.replace(new RegExp(`(["'])(${escapeRe(rel)})\\1`, 'g'), `$1${local}$1`);
  }
  entries.unshift({ name: 'index.html', data: Buffer.from(html) });
  return { zip: makeZip(entries), files: entries.length, bytes: total, url };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
