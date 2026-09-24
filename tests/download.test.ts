import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ALLOWED_HOSTS, MAX_DURATION, buildArgs, downloadMedia, explainFailure, parseDownloadUrl, type Runner } from '../src/media/download';
import { MediaError } from '../src/framework/media';

const live = Bun.env.RUN_NET_TEST === '1' ? test : test.skip;

describe('URL allow-list', () => {
  test('accepts real hosts and their subdomains', () => {
    for (const u of ['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://youtu.be/jNQXAC9IVRw', 'https://m.youtube.com/watch?v=x', 'https://vm.tiktok.com/abc', 'https://x.com/user/status/1', 'https://twitter.com/u/status/1',
      'https://www.reddit.com/r/x/comments/1/', 'https://v.redd.it/abc', 'https://soundcloud.com/a/b', 'https://clips.twitch.tv/Foo', 'https://www.instagram.com/reel/abc/', 'https://YOUTUBE.COM/watch?v=1', 'https://youtube.com./watch?v=1'])
      expect(() => parseDownloadUrl(u), u).not.toThrow();
  });
  test('refuses everything else: other hosts, look-alikes, credentials, odd ports, non-https, internal addresses', () => {
    const bad = ['http://youtube.com/watch?v=1', 'https://evil.com/video.mp4', 'https://youtube.com.evil.com/watch', 'https://evil-youtube.com/', 'https://notyoutube.com/', 'https://youtube.com@evil.com/x',
      'https://user:pw@youtube.com/x', 'https://youtube.com:8443/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'ftp://youtube.com/x', 'file:///etc/passwd', 'javascript:alert(1)', '-o /etc/passwd', '', 'not a url',
      'https://example.com/redirect?to=https://youtube.com', 'https://x.com.attacker.io/'];
    for (const u of bad) expect(() => parseDownloadUrl(u), u).toThrow(MediaError);
    expect(ALLOWED_HOSTS.every(h => !h.includes('/') && !h.startsWith('.'))).toBe(true);
  });
});

describe('yt-dlp arguments', () => {
  const base = { maxBytes: 10_000_000, dir: '/tmp/x' };
  test('always non-interactive, single video, size- and duration-capped, and the URL comes last after "--"', () => {
    const a = buildArgs('https://youtu.be/abc', { ...base, mode: 'video' });
    for (const f of ['--ignore-config', '--no-playlist', '--no-exec', '--max-filesize']) expect(a).toContain(f);
    expect(a[a.indexOf('--max-filesize') + 1]).toBe('10000000');
    expect(a[a.indexOf('--match-filter') + 1]).toBe(`!is_live & duration<=${MAX_DURATION}`);
    expect(a.at(-2)).toBe('--'); expect(a.at(-1)).toBe('https://youtu.be/abc');
    expect(a.join(' ')).toContain('bv*[height<=720]+ba/b[height<=720]/b'); expect(a).toContain('mp4');
  });
  test('height ladder, audio mode and cookies', () => {
    expect(buildArgs('https://youtu.be/a', { ...base, mode: 'video', height: 360 }).join(' ')).toContain('height<=360');
    const au = buildArgs('https://youtu.be/a', { ...base, mode: 'audio' }); expect(au).toContain('-x'); expect(au).toContain('mp3'); expect(au.join(' ')).not.toContain('height');
    expect(buildArgs('https://youtu.be/a', { ...base, mode: 'video', cookies: '/c.txt' })).toEqual(expect.arrayContaining(['--cookies', '/c.txt']));
    expect(buildArgs('https://youtu.be/a', { ...base, mode: 'video' })).not.toContain('--cookies');
  });
});

describe('downloadMedia (with a fake yt-dlp)', () => {
  const fakeRun = (script: (call: number, cwd: string, args: string[]) => Promise<{ code: number; stderr?: string }>): { run: Runner; calls: string[][] } => {
    const calls: string[][] = [];
    return { calls, run: async (_c, args, { cwd }) => { calls.push(args); const r = await script(calls.length, cwd, args); return { code: r.code, stdout: '', stderr: r.stderr ?? '' }; } };
  };
  test('hands the file to the callback, then cleans the temp directory', async () => {
    let dirSeen = '';
    const { run } = fakeRun(async (_n, cwd) => { await writeFile(path.join(cwd, 'out.mp4'), Buffer.alloc(1000, 1)); return { code: 0 }; });
    const got = await downloadMedia('https://youtu.be/abc', { mode: 'video', maxBytes: 5000, run }, async d => { dirSeen = path.dirname(d.file); expect(existsSync(d.file)).toBe(true); return { bytes: d.bytes, name: d.name, height: d.height }; });
    expect(got).toEqual({ bytes: 1000, name: 'download.mp4', height: 720 }); expect(existsSync(dirSeen)).toBe(false);
  });
  test('too big at 720p → retries 480p, then 360p, and reports the height that fit', async () => {
    const { run, calls } = fakeRun(async (n, cwd) => { await writeFile(path.join(cwd, 'out.mp4'), Buffer.alloc(n === 1 ? 9000 : n === 2 ? 6000 : 2000)); return { code: 0 }; });
    const r = await downloadMedia('https://youtu.be/abc', { mode: 'video', maxBytes: 5000, run }, async d => d.height);
    expect(r).toBe(360); expect(calls).toHaveLength(3); expect(calls[1]!.join(' ')).toContain('height<=480'); expect(calls[2]!.join(' ')).toContain('height<=360');
  });
  test('still too big at 360p → a clear "too big" message', async () => {
    const { run, calls } = fakeRun(async (_n, cwd) => { await writeFile(path.join(cwd, 'out.mp4'), Buffer.alloc(9000)); return { code: 0 }; });
    await expect(downloadMedia('https://youtu.be/abc', { mode: 'video', maxBytes: 5000, run }, async () => 1)).rejects.toThrow(/too big/); expect(calls).toHaveLength(3);
  });
  test('yt-dlp reporting a size problem also retries; other failures do not (one attempt only)', async () => {
    const big = fakeRun(async (n, cwd) => { if (n === 1) return { code: 101, stderr: 'File is larger than max-filesize' }; await writeFile(path.join(cwd, 'out.mp4'), Buffer.alloc(100)); return { code: 0 }; });
    expect(await downloadMedia('https://youtu.be/a', { mode: 'video', maxBytes: 5000, run: big.run }, async d => d.height)).toBe(480);
    const blocked = fakeRun(async () => ({ code: 1, stderr: 'ERROR: Sign in to confirm you’re not a bot' }));
    await expect(downloadMedia('https://youtu.be/a', { mode: 'video', maxBytes: 5000, run: blocked.run }, async () => 1)).rejects.toThrow(/login or a bot check/); expect(blocked.calls).toHaveLength(1);
  });
  test('audio mode makes one attempt and names the file by its extension', async () => {
    const { run, calls } = fakeRun(async (_n, cwd) => { await writeFile(path.join(cwd, 'out.mp3'), Buffer.alloc(500)); await writeFile(path.join(cwd, 'out.jpg'), Buffer.alloc(9)); return { code: 0 }; });
    const r = await downloadMedia('https://soundcloud.com/a/b', { mode: 'audio', maxBytes: 5000, run }, async d => d.name);
    expect(r).toBe('download.mp3'); expect(calls).toHaveLength(1);
  });
  test('success exit code but no file (e.g. filtered out) is an error, not a crash', async () => {
    await expect(downloadMedia('https://youtu.be/a', { mode: 'video', maxBytes: 5000, run: fakeRun(async () => ({ code: 0 })).run }, async () => 1)).rejects.toThrow(MediaError);
  });
  test('a missing yt-dlp binary gives a friendly message', async () => {
    const run: Runner = async () => { throw new MediaError('The downloader (yt-dlp) isn\'t installed on this bot.'); };
    await expect(downloadMedia('https://youtu.be/a', { mode: 'video', maxBytes: 5000, run }, async () => 1)).rejects.toThrow(/isn't installed/);
  });
  test('bad links are rejected before anything runs', async () => {
    let ran = false; const run: Runner = async () => { ran = true; return { code: 0, stdout: '', stderr: '' }; };
    await expect(downloadMedia('https://evil.com/x', { mode: 'video', maxBytes: 5000, run }, async () => 1)).rejects.toThrow(MediaError); expect(ran).toBe(false);
  });
  test('failure explanations', () => {
    const cases: [string, RegExp][] = [['ERROR: [youtube] x: Sign in to confirm you’re not a bot', /login or a bot check/], ['Private video. Sign in if you\'ve been granted access', /login or a bot check/], ['does not pass filter (!is_live & duration<=600), skipping ..', /live or longer/],
      ['ERROR: Unsupported URL: https://x', /isn't a video/], ['Video unavailable. This video has been removed', /isn't available/], ['HTTP Error 429: Too Many Requests', /rate-limiting/], ['something weird', /couldn't download/], ['', /couldn't download/]];
    for (const [s, re] of cases) expect(explainFailure(s), s).toMatch(re);
  });
});

describe('live yt-dlp (RUN_NET_TEST=1)', () => {
  live('downloads a short video and its audio within the size cap', async () => {
    const v = await downloadMedia('https://www.youtube.com/watch?v=jNQXAC9IVRw', { mode: 'video', maxBytes: 10_000_000 }, async d => ({ name: d.name, bytes: d.bytes, head: (await readFile(d.file)).subarray(4, 8).toString() }));
    expect(v.name).toBe('download.mp4'); expect(v.bytes).toBeGreaterThan(10_000); expect(v.bytes).toBeLessThanOrEqual(10_000_000); expect(v.head).toBe('ftyp');
    const a = await downloadMedia('https://www.youtube.com/watch?v=jNQXAC9IVRw', { mode: 'audio', maxBytes: 10_000_000 }, async d => ({ name: d.name, bytes: d.bytes }));
    expect(a.name).toBe('download.mp3'); expect(a.bytes).toBeGreaterThan(5_000);
  }, 180_000);
  live('long/live/unsupported content is refused with a clear message', async () => {
    await expect(downloadMedia('https://www.youtube.com/watch?v=aqz-KE-bpKQ', { mode: 'video', maxBytes: 1_000_000 }, async () => 1)).rejects.toThrow(MediaError);
  }, 180_000);
});
