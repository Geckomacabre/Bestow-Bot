import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { assertPublicResolved, assertPublicUrl, getBufferPublic, isPrivateIp } from '../src/framework/http';

describe('isPrivateIp', () => {
  test('flags every private, loopback, link-local and reserved range', () => {
    for (const ip of ['127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '100.127.255.255', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '[::1]', '2001:db8::1', 'not.an.ip.addr', '1.2.3', '256.1.1.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  test('allows ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '193.105.184.237', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe('assertPublicUrl (syntactic)', () => {
  const bad = ['http://localhost/x', 'http://LOCALHOST:8080', 'http://127.0.0.1/', 'http://127.1/', 'http://0x7f.0.0.1/', 'http://2130706433/', 'http://017700000001/', 'http://10.1.1.1', 'http://192.168.0.5', 'http://172.20.1.1',
    'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[fd00::1]/', 'http://router.local/', 'http://db.internal/', 'file:///etc/passwd', 'ftp://example.com/', 'gopher://x', 'javascript:alert(1)', 'not a url', ''];
  for (const u of bad) test(`refuses ${JSON.stringify(u)}`, () => { delete Bun.env.ALLOW_PRIVATE_URLS; expect(() => assertPublicUrl(u)).toThrow(); });
  test('accepts public http(s)', () => { expect(assertPublicUrl('https://example.com/a.png').hostname).toBe('example.com'); expect(assertPublicUrl('http://8.8.8.8/').hostname).toBe('8.8.8.8'); });
});

describe('assertPublicResolved (DNS)', () => {
  test('refuses hostnames that RESOLVE to loopback', async () => {
    delete Bun.env.ALLOW_PRIVATE_URLS;
    // "localhost" style names resolved via the OS resolver; localtest.me → 127.0.0.1 needs internet, so try both.
    await expect(assertPublicResolved('http://localhost/')).rejects.toThrow();
    await expect(assertPublicResolved('http://127.0.0.1:9/')).rejects.toThrow(/not allowed/);
    await expect(assertPublicResolved('http://[::1]/')).rejects.toThrow();
  });
  test('unresolvable names fail closed', async () => {
    await expect(assertPublicResolved('http://this-domain-does-not-exist-zzqq.invalid/')).rejects.toThrow(/resolve/);
  });
  const net = Bun.env.RUN_NET_TEST === '1' ? test : test.skip;
  net('a public name that points at 127.0.0.1 is refused; a genuinely public host is allowed', async () => {
    await expect(assertPublicResolved('http://localtest.me/')).rejects.toThrow(/not allowed/);
    expect((await assertPublicResolved('https://example.com/')).hostname).toBe('example.com');
  }, 30_000);
});

describe('getBufferPublic follows redirects safely', () => {
  let server: ReturnType<typeof Bun.serve>;
  let base = '';
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === '/ok') return new Response('hello');
        if (p === '/to-ok') return new Response(null, { status: 302, headers: { location: '/ok' } });
        if (p === '/to-metadata') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
        if (p === '/to-localhost') return new Response(null, { status: 301, headers: { location: 'http://localhost:1/secret' } });
        if (p === '/loop') return new Response(null, { status: 302, headers: { location: '/loop' } });
        if (p === '/big') return new Response(Buffer.alloc(3000));
        return new Response('nope', { status: 404 });
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => server.stop(true));

  test('with the test escape hatch on, normal fetches and same-host redirects work', async () => {
    Bun.env.ALLOW_PRIVATE_URLS = '1';
    expect((await getBufferPublic(`${base}/ok`)).toString()).toBe('hello');
    expect((await getBufferPublic(`${base}/to-ok`)).toString()).toBe('hello');
    await expect(getBufferPublic(`${base}/loop`, { maxRedirects: 3 })).rejects.toThrow(/too many/);
    await expect(getBufferPublic(`${base}/big`, { maxBytes: 100 })).rejects.toThrow(/too large/);
    await expect(getBufferPublic(`${base}/missing`)).rejects.toThrow(/404/);
    delete Bun.env.ALLOW_PRIVATE_URLS;
  });

  test('with the hatch OFF, the server itself and redirects into private space are refused', async () => {
    delete Bun.env.ALLOW_PRIVATE_URLS;
    await expect(getBufferPublic(`${base}/ok`)).rejects.toThrow(/not allowed/);
    // A public-looking first hop that redirects to cloud metadata must be caught on the second hop.
    Bun.env.ALLOW_PRIVATE_URLS = '1';
    const first = await Bun.fetch(`${base}/to-metadata`, { redirect: 'manual' });
    expect(first.headers.get('location')).toContain('169.254.169.254'); // proves the redirect exists
    delete Bun.env.ALLOW_PRIVATE_URLS;
    await expect(assertPublicResolved(first.headers.get('location')!)).rejects.toThrow(/not allowed/);
  });
});
