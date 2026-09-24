import { describe, expect, test } from 'bun:test';
import * as g from '../src/lookups/games';
import { minecraftSubs, githubSubs, steamSubs, valorantSubs, fortniteSubs, youtubeSubs } from '../src/subcommands/lookups/games';
import { fakeInteraction, textOf } from './fakeInteraction';

const net = Bun.env.RUN_NET_TEST === '1' ? test : test.skip;

describe('minecraft parsing', () => {
  test('address cleaning accepts hosts and ports, rejects junk', () => {
    expect(g.cleanAddress('play.example.com')).toBe('play.example.com');
    expect(g.cleanAddress('https://play.example.com:25566/path')).toBe('play.example.com:25566');
    for (const bad of ['', 'no spaces here', 'a'.repeat(200), 'host;rm -rf', '../etc/passwd', 'host:99999999', 'host:70000', '..', '.host', 'host..com', '-bad.com']) expect(() => g.cleanAddress(bad), bad).toThrow();
  });
  test('parses an online server', () => {
    const s = g.parseMcServer({ online: true, hostname: 'play.x', ip: '1.2.3.4', port: 25565, version: '1.20', motd: { clean: [' Hello ', '', 'World'] }, players: { online: 5, max: 100, list: [{ name: 'a' }, { name: 'b' }] }, icon: 'data:image/png;base64,AAAA' }, 'java');
    expect(s).toMatchObject({ online: true, motd: 'Hello\nWorld', players: { online: 5, max: 100, list: ['a', 'b'] }, iconDataUri: 'data:image/png;base64,AAAA' });
    expect(g.parseMcServer({ online: false }, 'bedrock')).toMatchObject({ online: false, edition: 'bedrock', motd: '' });
  });
  test('player names are validated before any request', async () => {
    await expect(g.mcPlayer('bad name!')).rejects.toThrow(/3–16/);
  });
});

describe('github parsing', () => {
  test('repo references from names and links', () => {
    expect(g.parseRepoRef('oven-sh/bun')).toEqual({ owner: 'oven-sh', repo: 'bun' });
    expect(g.parseRepoRef('https://github.com/torvalds/linux/tree/master')).toEqual({ owner: 'torvalds', repo: 'linux' });
    expect(g.parseRepoRef('https://github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' });
    expect(g.parseRepoRef('a/b.js')).toEqual({ owner: 'a', repo: 'b.js' });
    for (const bad of ['justaname', '', 'a/b/c d', '../../etc']) expect(() => g.parseRepoRef(bad), bad).toThrow();
  });
  test('usernames are validated', async () => {
    await expect(g.ghUser('not a user')).rejects.toThrow(/valid GitHub username/);
  });
});

describe('steam parsing', () => {
  test('decodes entities/HTML and maps price, platforms, genres', () => {
    const app = g.parseSteamApp({ success: true, data: { name: 'Portal 2', steam_appid: 620, short_description: 'The &quot;Perpetual&quot; <b>Testing</b><br>Initiative', is_free: false, developers: ['Valve'], price_overview: { final_formatted: '$1.99', initial_formatted: '$9.99', discount_percent: 80 }, genres: [{ description: 'Action' }], platforms: { windows: true, mac: false, linux: true }, metacritic: { score: 95 }, required_age: '0' } });
    expect(app).toMatchObject({ id: 620, name: 'Portal 2', short: 'The "Perpetual" Testing\nInitiative', price: '$1.99', discount: 80, platforms: ['Windows', 'Linux'], genres: ['Action'], metacritic: 95 });
    expect(g.parseSteamApp({ success: false })).toBeNull();
  });
  test('stripHtml', () => { expect(g.stripHtml('a&amp;b <i>c</i>')).toBe('a&b c'); });
});

describe('valorant logic', () => {
  test('name matching prefers exact, then prefix, then substring', () => {
    const items = [{ displayName: 'Vandal' }, { displayName: 'Vandalized Skin' }, { displayName: 'Phantom' }];
    expect(g.findByName(items, 'vandal')!.displayName).toBe('Vandal');
    expect(g.findByName(items, 'vand')!.displayName).toBe('Vandal');
    expect(g.findByName(items, 'ntom')!.displayName).toBe('Phantom');
    expect(g.findByName(items, 'zzz')).toBeNull();
  });
  test('skin search spans weapons', () => {
    const weapons = [{ uuid: '1', displayName: 'Vandal', category: 'c', skins: [{ uuid: 'a', displayName: 'Reaver Vandal' }] }, { uuid: '2', displayName: 'Phantom', category: 'c', skins: [{ uuid: 'b', displayName: 'Reaver Phantom' }] }] as g.VWeapon[];
    expect(g.findSkin(weapons, 'reaver phantom')!.weapon.displayName).toBe('Phantom');
    expect(g.findSkin(weapons, 'reaver')!.skin.uuid).toBe('a');
    expect(g.findSkin(weapons, 'nope')).toBeNull();
  });
  test('season timeline groups acts under episodes and marks the current one', () => {
    const now = Date.parse('2026-03-01T00:00:00Z');
    const mk = (uuid: string, name: string, s: string, e: string, parent?: string) => ({ uuid, displayName: name, startTime: s, endTime: e, parentUuid: parent ?? null });
    const t = g.seasonTimeline([
      mk('e1', 'Episode 1', '2025-01-01T00:00:00Z', '2025-12-31T00:00:00Z'), mk('a1', 'Act I', '2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z', 'e1'), mk('a2', 'Act II', '2025-06-01T00:00:00Z', '2025-12-31T00:00:00Z', 'e1'),
      mk('e2', 'Episode 2', '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'), mk('a3', 'Act III', '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z', 'e2'),
      mk('solo', 'Closed Beta', '2020-01-01T00:00:00Z', '2020-02-01T00:00:00Z'),
    ], now);
    expect(t.map(x => x.episode.displayName)).toEqual(['Episode 1', 'Episode 2']);
    expect(t[1]!.current).toBe(true);
    expect(t[1]!.acts[0]!.current).toBe(true);
    expect(t[0]!.acts.map(a => a.act.displayName)).toEqual(['Act I', 'Act II']);
  });
});

describe('fortnite shop parsing', () => {
  test('groups by section, labels bundles, flags sales', () => {
    const s = g.shopSections({ date: 'x', entries: [
      { regularPrice: 1500, finalPrice: 1500, layout: { name: 'Featured' }, brItems: [{ name: 'Skin A' }] },
      { regularPrice: 1200, finalPrice: 800, layout: { name: 'Featured' }, brItems: [{ name: 'Pickaxe B' }] },
      { regularPrice: 2500, finalPrice: 2500, layout: { name: 'Bundles' }, bundle: { name: 'Mega Bundle' } },
      { regularPrice: 1, finalPrice: 1, layout: { name: 'Empty' } },
    ] });
    expect(s[0]).toMatchObject({ name: 'Featured', total: 2 });
    expect(s[0]!.lines[1]).toContain('(sale)');
    expect(s.find(x => x.name === 'Bundles')!.lines[0]).toContain('Mega Bundle');
    expect(s.find(x => x.name === 'Empty')).toBeUndefined();
  });
});

describe('youtube parsing', () => {
  test('parses yt-dlp json lines and ignores noise', () => {
    const out = ['WARNING: something', JSON.stringify({ id: 'abc', title: 'Song', channel: 'Chan', duration: 215, view_count: 1234 }), 'not json', JSON.stringify({ id: 'def', title: 'Other', uploader: 'Up' }), '{broken'].join('\n');
    const r = g.parseYtLines(out);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ id: 'abc', title: 'Song', channel: 'Chan', duration: 215, url: 'https://www.youtube.com/watch?v=abc' });
    expect(r[1]!.channel).toBe('Up');
  });
  test('duration formatting', () => {
    expect(g.fmtDuration(65)).toBe('1:05');
    expect(g.fmtDuration(3725)).toBe('1:02:05');
    expect(g.fmtDuration(undefined)).toBe('live');
  });
});

// ── Live end-to-end: every command handler against the real service (RUN_NET_TEST=1) ──
const find = (subs: { name: string; run: (i: any) => Promise<unknown> }[], name: string) => subs.find(s => s.name === name)!;
async function go(subs: Parameters<typeof find>[0], name: string, options: Record<string, string | number>) {
  const f = fakeInteraction({ options });
  await find(subs, name).run(f.interaction);
  const p = f.last();
  return { p, text: textOf(p), failed: textOf(p).startsWith('❌') };
}

describe('live command handlers (opt-in)', () => {
  net('minecraft: user, skin, server', async () => {
    const u = await go(minecraftSubs, 'user', { username: 'Notch' });
    expect(u.failed, u.text).toBe(false);
    expect(u.text).toContain('069a79f4');
    expect((await go(minecraftSubs, 'skin', { username: 'jeb_' })).failed).toBe(false);
    const s = await go(minecraftSubs, 'server', { address: 'play.cubecraft.net' });
    expect(s.failed, s.text).toBe(false);
    expect((await go(minecraftSubs, 'user', { username: 'zz_nope_zz_qq' })).text).toContain('no Minecraft player');
  }, 60_000);

  net('github: repo, user, not found', async () => {
    const r = await go(githubSubs, 'repo', { repo: 'oven-sh/bun' });
    expect(r.failed, r.text).toBe(false);
    expect(r.text).toContain('oven-sh/bun');
    expect((await go(githubSubs, 'user', { username: 'octocat' })).text).toContain('octocat');
    expect((await go(githubSubs, 'repo', { repo: 'oven-sh/definitely-not-a-repo-zz' })).text).toContain('couldn\'t find');
  }, 60_000);

  net('steam: by name and by id', async () => {
    const a = await go(steamSubs, 'game', { query: 'portal 2' });
    expect(a.failed, a.text).toBe(false);
    expect(a.text).toContain('Portal 2');
    expect((await go(steamSubs, 'game', { query: '620' })).text).toContain('Portal 2');
    expect((await go(steamSubs, 'game', { query: 'zzzzzzqqqqxxxx nothing' })).text).toContain('couldn\'t find');
  }, 60_000);

  net('valorant: agents (list + detail), maps, seasons, skin, weapon', async () => {
    const list = await go(valorantSubs, 'agents', {});
    expect(list.text).toContain('Duelist');
    const jett = await go(valorantSubs, 'agents', { agent: 'jett' });
    expect(jett.failed, jett.text).toBe(false);
    expect(jett.text).toContain('Jett');
    expect((await go(valorantSubs, 'maps', {})).text).toContain('Ascent');
    expect((await go(valorantSubs, 'maps', { map: 'ascent' })).failed).toBe(false);
    const se = await go(valorantSubs, 'seasons', {});
    expect(se.failed, se.text).toBe(false);
    expect(se.text).toMatch(/Episode|EPISODE/);
    const skin = await go(valorantSubs, 'skin', { name: 'reaver vandal' });
    expect(skin.text).toContain('Reaver Vandal');
    const w = await go(valorantSubs, 'weapon', { name: 'vandal' });
    expect(w.text).toContain('Vandal');
    expect(w.text).toContain('Magazine');
  }, 120_000);

  net('fortnite: cosmetic, map, shop', async () => {
    const c = await go(fortniteSubs, 'cosmetic', { name: 'renegade raider' });
    expect(c.failed, c.text).toBe(false);
    expect((await go(fortniteSubs, 'map', {})).failed).toBe(false);
    const shop = await go(fortniteSubs, 'shop', {});
    expect(shop.failed, shop.text).toBe(false);
    expect(shop.text).toContain('V-Bucks');
    expect((await go(fortniteSubs, 'cosmetic', { name: 'zzzz no such item qqq' })).text).toContain('couldn\'t find');
  }, 120_000);

  net('youtube: search through yt-dlp', async () => {
    if (!Bun.which('yt-dlp')) return;
    const r = await go(youtubeSubs, 'search', { query: 'lofi hip hop' });
    expect(r.failed, r.text).toBe(false);
    expect(r.text).toContain('youtube.com/watch');
  }, 90_000);
});
