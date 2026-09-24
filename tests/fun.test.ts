import { beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import * as j from '../src/fun/juul';
import * as s from '../src/fun/social';
import { funGroups, funSubs } from '../src/subcommands/fun/fun';
import { toolsSubs } from '../src/subcommands/lookups/tools';
import { netSubs, cryptoSubs } from '../src/subcommands/lookups/net';
import type { Sub } from '../src/framework/group';
import { fakeInteraction, textOf } from './fakeInteraction';

beforeAll(async () => { await initDb(); });

let n = 0;
const uid = () => `juul-user-${++n}`;
const find = (subs: Sub[], name: string) => subs.find(x => x.name === name)!;
const juulSub = (name: string) => find(funGroups[0]!.subs, name);
const T0 = 1_800_000_000_000;

describe('juul logic', () => {
  test('a first hit matches the Heist text: "1 puffs total. Battery: 49/50"', async () => {
    const u = uid();
    const fi = fakeInteraction({ userId: u, displayName: 'Geckö' });
    await juulSub('hit').run(fi.interaction);
    expect(textOf(fi.last())).toContain('1 puffs total.** Battery: 49/50');
    expect(await j.hit(u, T0)).toMatchObject({ ok: true, puffs: 2, battery: 48 });
  });
  test('charging a full juul says so; a fresh user starts full', async () => {
    const u = uid();
    expect(await j.charge(u, T0)).toEqual({ kind: 'full', battery: 50 });
    const fi = fakeInteraction({ userId: u, displayName: 'Geckö' });
    await juulSub('charge').run(fi.interaction);
    expect(textOf(fi.last())).toContain("Geckö's juul is already fully charged.");
  });
  test('drains to dead after 50 hits, then refuses', async () => {
    const u = uid();
    for (let i = 0; i < 50; i++) expect((await j.hit(u, T0 + i)).ok).toBe(true);
    const dead = await j.hit(u, T0 + 100);
    expect(dead).toMatchObject({ ok: false, reason: 'dead', battery: 0, charging: false });
    expect((await j.getJuul(u)).puffs).toBe(50);
    const fi = fakeInteraction({ userId: u });
    await juulSub('hit').run(fi.interaction);
    expect(textOf(fi.last())).toContain('out of battery');
  });
  test('concurrent hits never overspend the battery or lose puffs', async () => {
    const u = uid();
    const rs = await Promise.all(Array.from({ length: 80 }, (_, i) => j.hit(u, T0 + i)));
    expect(rs.filter(r => r.ok)).toHaveLength(50);
    expect(rs.filter(r => !r.ok)).toHaveLength(30);
    const row = await j.getJuul(u);
    expect(row.puffs).toBe(50); expect(row.battery).toBe(0);
    const puffs = rs.filter((r): r is Extract<typeof r, { ok: true }> => r.ok).map(r => r.puffs).sort((a, b) => a - b);
    expect(puffs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1)); // every puff number handed out exactly once
  });
  test('charging is lazy: 6 s per point, hits unplug, full after 5 minutes', async () => {
    const u = uid();
    for (let i = 0; i < 50; i++) await j.hit(u, T0);
    const start = await j.charge(u, T0);
    expect(start).toEqual({ kind: 'started', battery: 0, fullAt: T0 + 300_000 });
    expect(await j.charge(u, T0 + 1000)).toMatchObject({ kind: 'charging', battery: 0, fullAt: T0 + 300_000 });
    expect(j.effectiveBattery(await j.getJuul(u), T0 + 60_000)).toBe(10);
    expect(j.effectiveBattery(await j.getJuul(u), T0 + 10_000_000)).toBe(50);
    const h = await j.hit(u, T0 + 60_000);
    expect(h).toMatchObject({ ok: true, battery: 9, unplugged: true });
    expect((await j.getJuul(u)).charging_since).toBeNull();
    expect(await j.charge(u, T0 + 61_000)).toMatchObject({ kind: 'started', battery: 9 });
    expect(await j.charge(u, T0 + 61_000 + 41 * 6000)).toEqual({ kind: 'full', battery: 50 });
    expect((await j.getJuul(u)).battery).toBe(50);
  });
  test('a dead juul that is charging tells you when it will be ready', async () => {
    const u = uid();
    for (let i = 0; i < 50; i++) await j.hit(u, T0);
    await j.charge(u, T0);
    expect(await j.hit(u, T0 + 3000)).toMatchObject({ ok: false, charging: true, fullAt: T0 + 300_000 });
  });
  test('concurrent charge presses only start one charge', async () => {
    const u = uid();
    await j.hit(u, T0);
    const rs = await Promise.all(Array.from({ length: 10 }, () => j.charge(u, T0)));
    expect(rs.filter(r => r.kind === 'started')).toHaveLength(1);
    expect(rs.filter(r => r.kind === 'charging')).toHaveLength(9);
  });
  test('milestones and cloud text', async () => {
    const u = uid();
    let last: Awaited<ReturnType<typeof j.hit>> | undefined;
    for (let i = 0; i < 10; i++) last = await j.hit(u, T0);
    expect(last).toMatchObject({ ok: true, puffs: 10, milestone: expect.stringContaining('Ten puffs') });
    for (const c of j.CLOUDS) expect(c.startsWith('💨')).toBe(true);
    const r = await j.hit(uid(), T0, () => 0.999999);
    expect(r.ok && r.cloud).toBeTruthy(); expect(r.ok && r.cloud).not.toContain('{flavor}');
  });
  test('flavour and colour: valid values stick, invalid ones are refused', async () => {
    const u = uid();
    await j.setFlavor(u, 'Cool Mint'); await j.setColor(u, 'pink');
    expect(await j.getJuul(u)).toMatchObject({ flavor: 'Cool Mint', color: 'pink' });
    await expect(j.setFlavor(u, 'Motor Oil')).rejects.toThrow(); await expect(j.setColor(u, 'constructor')).rejects.toThrow(); await expect(j.setColor(u, '__proto__')).rejects.toThrow();
    expect(await j.getJuul(u)).toMatchObject({ flavor: 'Cool Mint', color: 'pink' });
    expect(j.FLAVORS.length).toBeLessThanOrEqual(25); expect(Object.keys(j.COLORS).length).toBeLessThanOrEqual(25);
  });
  test('leaderboard orders by puffs; delete removes the row', async () => {
    const a = uid(), b = uid(), c = uid();
    for (let i = 0; i < 3; i++) await j.hit(a, T0);
    for (let i = 0; i < 7; i++) await j.hit(b, T0);
    await j.getJuul(c); // never puffed → excluded
    const top = (await j.topPuffers(500)).map(x => x.user_id);
    expect(top.indexOf(b)).toBeLessThan(top.indexOf(a)); expect(top).not.toContain(c);
    await j.deleteJuul(b);
    expect((await j.topPuffers(500)).map(x => x.user_id)).not.toContain(b);
    expect((await j.getJuul(b)).puffs).toBe(0); // re-created fresh
  });
  test('battery bar', () => { expect(j.batteryBar(50)).toBe('▰'.repeat(10)); expect(j.batteryBar(0)).toBe('▱'.repeat(10)); expect(j.batteryBar(25)).toBe('▰▰▰▰▰▱▱▱▱▱'); expect(j.batteryBar(999)).toBe('▰'.repeat(10)); });
});

describe('juul commands', () => {
  test('flavor, customize, stats and top render', async () => {
    const u = uid();
    let fi = fakeInteraction({ userId: u, options: { flavor: 'Mango' } }); await juulSub('flavor').run(fi.interaction); expect(textOf(fi.last())).toContain('Mango');
    fi = fakeInteraction({ userId: u, options: { color: 'blurple' } }); await juulSub('customize').run(fi.interaction); expect(textOf(fi.last())).toContain('Blurple');
    await j.hit(u, Date.now());
    fi = fakeInteraction({ userId: u, displayName: 'Geckö' }); await juulSub('stats').run(fi.interaction);
    const t = textOf(fi.last()); expect(t).toContain("Geckö's juul"); expect(t).toContain('49/50'); expect(t).toContain('Total puffs:** 1');
    fi = fakeInteraction({ userId: u }); await juulSub('top').run(fi.interaction); expect(textOf(fi.last())).toContain(`<@${u}>`);
  });
  test('stats for another user', async () => {
    const other = uid(); await j.hit(other, Date.now());
    const fi = fakeInteraction({ users: { user: { id: other, username: 'them', displayName: 'Them' } } });
    await juulSub('stats').run(fi.interaction);
    expect(textOf(fi.last())).toContain("Them's juul");
  });
});

describe('social commands', () => {
  test('ship is symmetric, in range, and names the pair', async () => {
    const run = async (a: string, b: string) => {
      const fi = fakeInteraction({ users: { user: { id: a, username: a, displayName: a }, other: { id: b, username: b, displayName: b } } });
      await find(funSubs, 'ship').run(fi.interaction);
      return textOf(fi.last());
    };
    const t1 = await run('alice', 'bobby'), t2 = await run('bobby', 'alice');
    const pct = (t: string) => Number(/## (\d+)%/.exec(t)![1]);
    expect(pct(t1)).toBe(pct(t2)); expect(pct(t1)).toBeGreaterThanOrEqual(0); expect(pct(t1)).toBeLessThanOrEqual(100);
    expect(t1).toContain('alice 💞 bobby'); expect(t1).toContain('Ship name:');
  });
  test('rate is stable within a day and has a comment for every score', () => {
    expect(s.rate('Pizza', '2026-01-01')).toBe(s.rate('  pizza ', '2026-01-01'));
    for (let p = 0; p <= 100; p++) { expect(s.rateLine(p)).toBeTruthy(); expect(s.shipLine(p)).toBeTruthy(); }
  });
  test('roast pings nobody but mentions the target; rizz and say are safe', async () => {
    let fi = fakeInteraction({ users: { user: { id: '42', username: 'vic' } } });
    await find(funSubs, 'roast').run(fi.interaction);
    expect(textOf(fi.last())).toContain('<@42>'); expect(fi.last().allowedMentions).toEqual({ parse: [] });
    fi = fakeInteraction({}); await find(funSubs, 'rizz').run(fi.interaction); expect(textOf(fi.last()).length).toBeGreaterThan(20);
    fi = fakeInteraction({ options: { text: '@everyone hello <@123>' } }); await find(funSubs, 'say').run(fi.interaction);
    expect(fi.last()).toMatchObject({ content: '@everyone hello <@123>', allowedMentions: { parse: [] } });
  });
  test('all roast templates address the target and contain no stray placeholders', () => {
    for (const r of s.ROASTS) { expect(r).toContain('{t}'); expect(s.fill(r, 'X')).not.toContain('{'); }
  });
  test('ascii, markov and the urban age gate work without the network', async () => {
    let fi = fakeInteraction({ options: { text: 'Hi', font: 'Small' } }); await find(funSubs, 'ascii').run(fi.interaction);
    expect(fi.last().content).toMatch(/^```\n[^]+\n```$/);
    fi = fakeInteraction({ options: { text: 'the cat sat on the mat and the dog sat on the log near the cat' } }); await find(funSubs, 'markov').run(fi.interaction);
    expect(textOf(fi.last())).toContain('Markov chain');
    for (const channel of [null, { nsfw: false }]) {
      fi = fakeInteraction({ options: { term: 'anything' }, channel }); await find(funSubs, 'urban').run(fi.interaction);
      expect(textOf(fi.last())).toContain('age-restricted');
    }
  });
});

describe('tools commands (offline paths)', () => {
  const run = async (name: string, options: Record<string, string | number>) => { const fi = fakeInteraction({ options }); await find(toolsSubs, name).run(fi.interaction); return fi; };

  test('math shows the answer, and friendly errors instead of stack traces', async () => {
    expect(textOf((await run('math', { expression: '2*(3+4)^2' })).last())).toContain('= 98');
    expect(textOf((await run('math', { expression: '1/0' })).last())).toContain('Division by zero');
    expect(textOf((await run('math', { expression: 'process.exit()' })).last())).toContain('❌');
  });
  test('color / palette / gradient attach a swatch PNG and report values', async () => {
    let fi = await run('color', { color: 'coral' }); let t = textOf(fi.last());
    expect(t).toContain('#FF7F50'); expect(t).toContain('RGB:** 255, 127, 80'); expect(fi.last().files).toHaveLength(1);
    const png = fi.last().files[0].attachment as Buffer; expect(png.subarray(1, 4).toString()).toBe('PNG');
    fi = await run('palette', { color: '#ff0000', scheme: 'triadic' }); t = textOf(fi.last()); expect(t).toContain('#FF0000'); expect(t).toContain('#00FF00'); expect(t).toContain('#0000FF');
    fi = await run('gradient', { from: '#000', to: '#fff', steps: 3 }); expect(textOf(fi.last())).toContain('#808080');
    fi = await run('color', { color: 'not-a-colour' }); expect(textOf(fi.last())).toContain("couldn't read that colour");
  });
  test('swatch pixels really are the requested colours', async () => {
    const { swatch } = await import('../src/lookups/swatch');
    const { loadImage, createCanvas } = await import('@napi-rs/canvas');
    const img = await loadImage(swatch([{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }], { blockWidth: 100, height: 60 }));
    const c = createCanvas(img.width, img.height), ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    expect(img.width).toBe(200);
    expect([...ctx.getImageData(10, 5, 1, 1).data]).toEqual([255, 0, 0, 255]); expect([...ctx.getImageData(190, 5, 1, 1).data]).toEqual([0, 0, 255, 255]);
  });
  test('convert handles units and nonsense', async () => {
    expect(textOf((await run('convert', { query: '72 f to c' })).last())).toContain('22.2222 °C');
    expect(textOf((await run('convert', { query: '5 blorp to zork' })).last())).toContain('❌');
  });
  test('qr command sends a scannable PNG', async () => {
    const fi = await run('qr', { text: 'https://example.com/onyx', color: '#1a3d8f' });
    const file = fi.last().files[0]; expect(file.name).toBe('qr.png');
    const { scanQrBuffer } = await import('../src/lookups/qr');
    expect(await scanQrBuffer(file.attachment as Buffer)).toBe('https://example.com/onyx');
    expect(textOf((await run('qr', { text: 'x', color: 'nope' })).last())).toContain('❌');
  });
  test('qr-scan reads a code from an attached image URL served locally', async () => {
    const { makeQr } = await import('../src/lookups/qr');
    const png = await makeQr('scan me');
    const server = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } }) });
    Bun.env.ALLOW_PRIVATE_URLS = '1';
    try {
      const fi = fakeInteraction({ attachments: { image: { url: `http://127.0.0.1:${server.port}/q.png`, name: 'q.png', contentType: 'image/png' } } });
      await find(toolsSubs, 'qr-scan').run(fi.interaction);
      expect(textOf(fi.last())).toContain('scan me');
    } finally { delete Bun.env.ALLOW_PRIVATE_URLS; server.stop(true); }
  });
  test('qr-scan refuses a private URL when the escape hatch is off', async () => {
    delete Bun.env.ALLOW_PRIVATE_URLS;
    const fi = fakeInteraction({ options: { url: 'http://127.0.0.1:9/x.png' } });
    await find(toolsSubs, 'qr-scan').run(fi.interaction);
    expect(textOf(fi.last())).toContain('❌');
  });
  test('net/crypto commands reject private or malformed input before any request', async () => {
    for (const [subs, name, options, want] of [
      [netSubs, 'ip', { target: '127.0.0.1' }, 'private'], [netSubs, 'ping', { host: '10.0.0.1' }, 'private'], [netSubs, 'dns', { domain: 'localhost' }, "doesn't look like"],
      [netSubs, 'website', { url: 'http://169.254.169.254/latest' }, 'private'], [cryptoSubs, 'wallet', { address: 'hello' }, 'Bitcoin or Ethereum'],
    ] as [Sub[], string, Record<string, string>, string][]) {
      const fi = fakeInteraction({ options }); await find(subs, name).run(fi.interaction);
      expect(textOf(fi.last()), `${name} ${JSON.stringify(options)}`).toContain(want);
    }
  });
});
