import { beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import * as ch from '../src/lookups/chain';
import { money, vsOf } from '../src/lookups/crypto';
import { addTracker, checkTrackers, stopTrackers, TTL_MS } from '../src/crypto/tracker';
import { parseDdgHtml, parseGrok, parseVqd, safeOf, timeRange } from '../src/lookups/search';
import { findAssets, localPath, parseDelay, scrollExpr } from '../src/lookups/website';
import { niceStep, shortNum, lineChart } from '../src/lookups/chart';

beforeAll(async () => { await initDb(); });

describe('chains', () => {
  test('address detection', () => {
    expect(ch.detectAddressChain('0x' + 'a'.repeat(40))).toBe('eth');
    expect(ch.detectAddressChain('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('btc');
    expect(ch.detectAddressChain('ltc1qg82xk5x7c8e6wcfntyqnxy0n6mzlpgsyqz9mym')).toBe('ltc');
    expect(ch.detectAddressChain('LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9')).toBe('ltc');
    expect(ch.detectAddressChain('DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L')).toBe('doge');
    expect(ch.detectAddressChain('XpESxaUmonkq8RaLLp46Brx2K39ggQe226')).toBe('dash');
    expect(ch.detectAddressChain('hello')).toBeNull();
    expect(ch.chainOf('Litecoin')).toBe('ltc'); expect(ch.chainOf(null)).toBeNull();
  });
  test('BlockCypher wallets: sent amounts are negative, unconfirmed first, no duplicates', () => {
    const w = ch.parseBcAddr('ltc', 'L1', { balance: 150_000_000, unconfirmed_balance: 0, final_balance: 150_000_000, n_tx: 2, total_received: 250_000_000, total_sent: 100_000_000,
      txrefs: [{ tx_hash: 'a', value: 100_000_000, tx_input_n: 0, confirmations: 10, confirmed: '2026-01-01T00:00:00Z' }, { tx_hash: 'b', value: 250_000_000, tx_input_n: -1, confirmations: 20 }],
      unconfirmed_txrefs: [{ tx_hash: 'c', value: 1, tx_input_n: -1 }] });
    expect(w.balance).toBe(1.5); expect(w.recent.map(r => [r.hash, r.amount, r.confirmations])).toEqual([['c', 1e-8, 0], ['a', -1, 10], ['b', 2.5, 20]]);
  });
  test('transactions from BlockCypher and Blockscout', () => {
    const t = ch.parseBcTx('btc', { hash: 'h', block_height: 5, confirmations: 3, confirmed: '2026-01-01T00:00:00Z', total: 50_000_000, fees: 1000, inputs: [{ addresses: ['x'] }, { addresses: ['x'] }], outputs: [{ addresses: ['y'], value: 1 }] });
    expect(t).toMatchObject({ chain: 'btc', status: 'confirmed', amount: 0.5, fee: 0.00001, from: ['x'], to: ['y'], block: 5 });
    expect(ch.parseBcTx('doge', { hash: 'p', block_height: -1, confirmations: 0, total: 0, fees: 0 }).status).toBe('pending');
    expect(ch.parseScoutTx({ hash: '0x1', status: 'error', block_number: 9, confirmations: 4, value: '1000000000000000000', from: { hash: '0xa' }, to: { hash: '0xb' } })).toMatchObject({ status: 'failed', amount: 1, confirmations: 4 });
    expect(ch.parseScoutTx({ hash: '0x2', result: 'pending', block_number: null, value: '0', from: { hash: '0xa' } }).status).toBe('pending');
  });
  test('gas and money formatting', () => {
    expect(ch.hexToGwei('0x3b9aca00')).toBe(1);
    expect(money(1234.5, 'eur')).toBe('€1,235'); expect(money(12.5, 'gbp')).toBe('£12.50'); expect(money(0.5, 'btc')).toBe('0.5 BTC'); expect(money(1500, 'jpy')).toBe('¥1,500');
    expect(vsOf('EUR')).toBe('eur'); expect(vsOf(null)).toBe('usd');
  });
});

describe('/crypto track', () => {
  const client = { channels: { fetch: async () => null }, users: { fetch: async () => ({ send: async (p: unknown) => { sent.push(p); } }) } } as never;
  const sent: unknown[] = [];
  test('limits, duplicates, and notifying once the target is reached', async () => {
    const u = 'trk-u';
    const base = { user_id: u, chain: 'btc' as const, target: 2, channel_id: null, created_at: Date.now() };
    expect(await addTracker({ ...base, txid: 't1' })).toMatchObject({ txid: 't1' });
    expect(await addTracker({ ...base, txid: 't1' })).toBe('duplicate');
    for (let n = 2; n <= 5; n++) await addTracker({ ...base, txid: `t${n}` });
    expect(await addTracker({ ...base, txid: 't6' })).toBe('limit');
    const conf: Record<string, number> = { t1: 2, t2: 1, t3: 5, t4: 0, t5: 0 };
    const fake = async (txid: string) => ({ chain: 'btc' as const, hash: txid, confirmations: conf[txid] ?? 0, amount: 1, from: [], to: [], status: 'confirmed' as const, explorer: 'https://x' });
    expect(await checkTrackers(client, Date.now(), fake as never)).toBe(2);
    expect(sent).toHaveLength(2);
    expect(await checkTrackers(client, Date.now() + TTL_MS + 1, fake as never)).toBe(3); // the rest expire
    expect(await stopTrackers(u)).toBe(0);
  });
});

describe('search', () => {
  test('DuckDuckGo HTML results unwrap redirect links and skip ads', () => {
    const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&amp;rut=x">Example <b>Site</b></a>
      <a class="result__snippet" href="x">A <b>great</b> site.</a>
      <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>`;
    expect(parseDdgHtml(html)).toEqual([{ title: 'Example Site', url: 'https://example.com/a?b=1', snippet: 'A great site.', source: 'DuckDuckGo' }]);
  });
  test('options: safesearch, time filters, vqd tokens, Grokipedia shapes', () => {
    expect(safeOf('Off')).toBe('off'); expect(safeOf(null)).toBe('moderate');
    expect(timeRange('d')).toBe('day'); expect(timeRange('week')).toBe('week'); expect(timeRange('x')).toBeNull();
    expect(parseVqd('...vqd="4-123456789012345678901234567890123456"...')).toBe('4-123456789012345678901234567890123456');
    expect(parseGrok({ results: [{ title: 'Mars', slug: 'Mars', snippet: 'The <b>fourth</b> planet', viewCount: '12' }] })).toEqual([{ title: 'Mars', slug: 'Mars', snippet: 'The fourth planet', url: 'https://grokipedia.com/page/Mars', views: 12 }]);
    expect(parseGrok({})).toEqual([]);
  });
});

describe('website helpers', () => {
  test('delay, asset discovery and local paths', () => {
    expect(parseDelay('3')).toBe(3); expect(parseDelay('2.5s')).toBe(2.5); expect(parseDelay('60')).toBe(10); expect(parseDelay(null)).toBe(0); expect(() => parseDelay('soon')).toThrow();
    expect(findAssets('<link rel="stylesheet" href="/a.css"><script src="https://cdn.x/y.js"></script><img src="i.png"><a href="/page">x</a><img src="data:image/png;base64,AA">', 'https://site.com/dir/')).toEqual(['https://site.com/a.css', 'https://cdn.x/y.js', 'https://site.com/dir/i.png']);
    expect(localPath(new URL('https://cdn.x/a/b.js?v=1'))).toBe('assets/cdn.x/a/b.js'); expect(localPath(new URL('https://x.com/'))).toBe('assets/x.com/index'); expect(localPath(new URL('https://x.com/../../etc/passwd'))).not.toContain('..');
  });
  test('scroll expressions per animation', () => {
    expect(scrollExpr('normal', 6)).toContain('cos'); expect(scrollExpr('fast', 6)).toBe('(ih-720)*min(1\\,t/6)'); expect(scrollExpr('speedy', 8)).toContain('floor(t/2)');
  });
  test('charts', () => {
    expect(niceStep(97)).toBe(20); expect(shortNum(1_500_000)).toBe('1.5M'); expect(shortNum(0.00012)).toBe('0.000120');
    const png = lineChart([{ label: 'A', color: '#fff', points: [{ x: 1, y: 1 }, { x: 2, y: 3 }] }], { title: 't' });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});

// Needs a local Chromium: RUN_BROWSER_TEST=1 CHROMIUM_PATH=/path/to/chrome bun test
const browser = Bun.env.RUN_BROWSER_TEST === '1' && Bun.env.CHROMIUM_PATH ? test : test.skip;
describe('headless browser (opt-in)', () => {
  browser('screenshot with a click, a scroll video, and private addresses stay blocked', async () => {
    Bun.env.ALLOW_PRIVATE_URLS = '1';
    let clicked = false, probed = false;
    const server = Bun.serve({ port: 0, fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === '/clicked') { clicked = true; return new Response('ok'); }
      return new Response(`<html><body style="margin:0"><div onclick="fetch('/clicked')" style="height:720px;background:#58f">x</div>${'<p style="height:200px">y</p>'.repeat(10)}</body></html>`, { headers: { 'content-type': 'text/html' } });
    } });
    const web = await import('../src/lookups/website');
    try {
      const s = await web.screenshot(`http://127.0.0.1:${server.port}/`, { click: true });
      expect(s.png.subarray(1, 4).toString()).toBe('PNG'); expect(clicked).toBe(true);
      const v = await web.scrollVideo(`http://127.0.0.1:${server.port}/`, 'short', 'fast');
      expect(v.mp4.subarray(4, 8).toString()).toBe('ftyp');
    } finally { server.stop(true); delete Bun.env.ALLOW_PRIVATE_URLS; }
    // With the escape hatch off, a public page can't pull a private address into the browser.
    const trap = Bun.serve({ port: 0, fetch() { probed = true; return new Response('secret'); } });
    const { withPage } = await import('../src/framework/browser');
    await withPage(async p => { await p.goto('data:text/html,<img src="http://127.0.0.1:' + trap.port + '/x">'); await Bun.sleep(1500); });
    trap.stop(true);
    expect(probed).toBe(false);
  }, 120_000);
});
