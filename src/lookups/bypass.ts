import { assertPublicResolved, HttpError, USER_AGENT } from '../framework/http.js';
import { LookupError } from './handler.js';

/**
 * /bypass: follows a short link (bit.ly, t.co, tinyurl, lnkd.in, discord.gg…) hop by hop to where it really goes, including
 * <meta refresh> and simple `location =` script redirects. Every hop is DNS-checked so a link can't point the bot at a private address.
 * Ad-gated "link lockers" that demand a captcha or a timer are reported as such rather than defeated.
 */

export const LOCKERS = ['linkvertise.com', 'link-to.net', 'direct-link.net', 'up-to-down.net', 'lootlinks.co', 'loot-link.com', 'work.ink', 'boost.ink', 'sub2unlock.com', 'rekonise.com', 'mboost.me'];

/** A redirect target written into an HTML page: <meta http-equiv="refresh" content="0; url=…"> or location.href = "…". */
export function htmlRedirect(html: string): string | null {
  const meta = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*?url\s*=\s*([^"'>\s]+)/i.exec(html)
    ?? /<meta[^>]+content\s*=\s*["'][^"']*?url\s*=\s*([^"'>\s]+)["'][^>]*http-equiv\s*=\s*["']?refresh/i.exec(html);
  if (meta) return meta[1]!.replace(/&amp;/g, '&');
  const js = /(?:window\.|document\.|top\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']|location\.replace\(\s*["'](https?:\/\/[^"']+)["']\s*\)/i.exec(html);
  return js ? (js[1] ?? js[2])! : null;
}

export const isLocker = (host: string) => LOCKERS.some(h => host === h || host.endsWith(`.${h}`));

export interface Hop { url: string; status: number }

export async function unshorten(input: string, maxHops = 10): Promise<{ final: string; hops: Hop[] }> {
  let url = (await assertPublicResolved(input.trim())).toString();
  const hops: Hop[] = [];
  for (let n = 0; n <= maxHops; n++) {
    const host = new URL(url).hostname.toLowerCase();
    if (isLocker(host)) throw new LookupError(`**${host}** is an ad-gated link locker. I don't get past those — open it yourself if you trust it.`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' } });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new LookupError('That link took too long to answer.');
      throw e;
    } finally { clearTimeout(timer); }
    hops.push({ url, status: res.status });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = (await assertPublicResolved(new URL(loc, url).toString())).toString();
      continue;
    }
    if (res.status >= 400 && hops.length === 1) throw new HttpError(res.status, url);
    // A small HTML page may still redirect by meta refresh or script.
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('html')) {
      const body = (await res.text()).slice(0, 64 * 1024);
      const next = htmlRedirect(body);
      if (next && next !== url) { url = (await assertPublicResolved(new URL(next, url).toString())).toString(); continue; }
    } else await res.body?.cancel();
    return { final: url, hops };
  }
  throw new LookupError('That link redirects too many times.');
}
