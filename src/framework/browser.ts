import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertPublicResolved } from './http.js';

/**
 * A minimal headless Chromium driver over the DevTools protocol — enough for screenshots, a click, full-page captures and scrolling.
 * Enabled by CHROMIUM_PATH (the Docker image installs Chromium). One page at a time; each job gets a fresh profile that is deleted after.
 *
 * Safety: every request the page makes (including redirects and sub-resources) is intercepted, and anything that isn't a public
 * http(s) address is refused — so a page can't make the bot's browser reach localhost, the LAN or cloud metadata. WebSockets are blocked.
 */

export const chromiumPath = () => Bun.env.CHROMIUM_PATH || null;
export class BrowserUnavailable extends Error {}

type Msg = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };

let busy: Promise<unknown> = Promise.resolve();

export interface Page {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  goto(url: string, timeoutMs?: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  screenshot(o?: { fullPage?: boolean; maxHeight?: number }): Promise<Buffer>;
  evaluate<T>(expression: string): Promise<T>;
  width: number; height: number;
}

async function isAllowed(url: string, cache: Map<string, boolean>): Promise<boolean> {
  if (/^(data|blob|about):/i.test(url)) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  let host: string;
  try { host = new URL(url).host; } catch { return false; }
  if (cache.has(host)) return cache.get(host)!;
  const ok = await assertPublicResolved(url).then(() => true, () => false);
  cache.set(host, ok);
  return ok;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>, o: { width?: number; height?: number; timeoutMs?: number } = {}): Promise<T> {
  const bin = chromiumPath();
  if (!bin) throw new BrowserUnavailable('A headless browser isn\'t installed on this bot (CHROMIUM_PATH).');
  const run = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-chrome-'));
    const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
      '--disable-background-networking', '--disable-sync', `--user-data-dir=${dir}`, '--remote-debugging-port=0',
      // Chromium's own sandbox can't start as root or inside most containers; the Docker image sets CHROMIUM_NO_SANDBOX=1 (the container is the isolation).
      ...(process.getuid?.() === 0 || Bun.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), 'about:blank'];
    const proc = Bun.spawn([bin, ...args], { stdout: 'ignore', stderr: 'pipe' });
    const hard = setTimeout(() => proc.kill(), o.timeoutMs ?? 90_000);
    let ws: WebSocket | null = null;
    try {
      // Chromium prints "DevTools listening on ws://…" on stderr once it's ready.
      const wsUrl = await new Promise<string>((resolve, reject) => {
        const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
        let buf = '';
        const t = setTimeout(() => reject(new BrowserUnavailable('The browser didn\'t start.')), 20_000);
        (async () => {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) { clearTimeout(t); reject(new BrowserUnavailable('The browser exited before it was ready.')); return; }
            buf += new TextDecoder().decode(value);
            const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
            if (m) { clearTimeout(t); resolve(m[1]!); reader.releaseLock(); return; }
          }
        })().catch(reject);
      });
      ws = new WebSocket(wsUrl);
      await new Promise<void>((res, rej) => { ws!.onopen = () => res(); ws!.onerror = () => rej(new BrowserUnavailable('Couldn\'t connect to the browser.')); });
      let seq = 0;
      const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
      const listeners: ((m: Msg) => void)[] = [];
      ws.onmessage = ev => {
        const m = JSON.parse(String(ev.data)) as Msg;
        if (m.id != null && pending.has(m.id)) { const p = pending.get(m.id)!; pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result ?? {}); return; }
        for (const l of listeners) l(m);
      };
      const raw = <R>(method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<R>((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve: resolve as (v: Record<string, unknown>) => void, reject });
        ws!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
      const { targetInfos } = await raw<{ targetInfos: { targetId: string; type: string }[] }>('Target.getTargets');
      const target = targetInfos.find(t => t.type === 'page')?.targetId ?? (await raw<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })).targetId;
      const { sessionId } = await raw<{ sessionId: string }>('Target.attachToTarget', { targetId: target, flatten: true });
      const send = <R = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}) => raw<R>(method, params, sessionId);
      const width = o.width ?? 1280, height = o.height ?? 720;

      const hostOk = new Map<string, boolean>();
      listeners.push(m => {
        if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
        const p = m.params as { requestId: string; request: { url: string } };
        void isAllowed(p.request.url, hostOk).then(ok => (ok ? send('Fetch.continueRequest', { requestId: p.requestId }) : send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'AccessDenied' }))).catch(() => {});
      });
      await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
      await send('Network.enable');
      await send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*'] });
      await send('Page.enable');
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

      const page: Page = {
        width, height, send,
        async goto(url, timeoutMs = 25_000) {
          if (!(await isAllowed(url, hostOk))) throw new Error('That address is not allowed.');
          const loaded = new Promise<void>(res => { listeners.push(m => { if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) res(); }); });
          const r = await send<{ errorText?: string }>('Page.navigate', { url });
          if (r.errorText) throw new Error(r.errorText.includes('ERR_BLOCKED') || r.errorText.includes('ACCESS_DENIED') ? 'That address is not allowed.' : `The page didn't load (${r.errorText}).`);
          await Promise.race([loaded, Bun.sleep(timeoutMs)]);
        },
        async click(x, y) {
          for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
        },
        async evaluate<R>(expression: string) {
          const r = await send<{ result?: { value?: R } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          return r.result?.value as R;
        },
        async screenshot(so = {}) {
          if (!so.fullPage) return Buffer.from((await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })).data, 'base64');
          const m = await send<{ cssContentSize?: { height: number }; contentSize?: { height: number } }>('Page.getLayoutMetrics');
          const h = Math.min(so.maxHeight ?? 8000, Math.ceil((m.cssContentSize ?? m.contentSize)?.height ?? height));
          return Buffer.from((await send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.max(height, h), scale: 1 } })).data, 'base64');
        },
      };
      return await fn(page);
    } finally {
      clearTimeout(hard);
      try { ws?.close(); } catch { /* already closed */ }
      proc.kill();
      await proc.exited.catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
  const job = busy.then(run, run);
  busy = job.catch(() => {});
  return job;
}
