import { describe, expect, test } from 'bun:test';
import * as rbx from '../src/lookups/roblox';
import { robloxSubs } from '../src/subcommands/lookups/roblox';
import { card, compact, listCard, num, trunc, when } from '../src/lookups/card';
import { fakeInteraction, textOf } from './fakeInteraction';

const net = Bun.env.RUN_NET_TEST === '1' ? test : test.skip;

describe('calculators', () => {
  test('marketplace tax is 30% and the reverse always covers the target', () => {
    expect(rbx.afterTax(100)).toBe(70);
    expect(rbx.afterTax(1)).toBe(0);
    for (const want of [1, 7, 70, 999, 12345]) expect(rbx.afterTax(rbx.priceToReceive(want))).toBeGreaterThanOrEqual(want);
    expect(rbx.priceToReceive(70)).toBe(100);
  });
  test('devex uses the configurable rate', () => {
    expect(rbx.robuxToUsd(1000, 0.0038)).toBeCloseTo(3.8, 6);
    Bun.env.ROBLOX_DEVEX_RATE = '0.005';
    expect(rbx.devexRate()).toBe(0.005);
    delete Bun.env.ROBLOX_DEVEX_RATE;
    expect(rbx.devexRate()).toBe(0.0038);
  });
});

describe('rolimons parsing', () => {
  const sample = { items: { '1028606': ['Red Baseball Cap', '', 1326, -1, 1326, -1, -1, -1, -1, -1], '1029025': ['The Classic ROBLOX Fedora', 'CF', 76000, 90000, 76000, 3, 3, 1, -1, 1] } };
  const items = rbx.parseRolimons(sample);
  test('maps the array columns', () => {
    expect(items[0]).toMatchObject({ id: 1028606, name: 'Red Baseball Cap', rap: 1326, value: -1, demand: -1, projected: false });
    expect(items[1]).toMatchObject({ id: 1029025, acronym: 'CF', value: 90000, demand: 3, trend: 3, projected: true, hyped: false, rare: true });
    expect(rbx.demandName(3)).toBe('High');
    expect(rbx.demandName(-1)).toBe('—');
    expect(rbx.trendName(3)).toBe('Raising');
  });
  test('finds by id, exact name, acronym and partial name', () => {
    expect(rbx.findRolimons(items, '1029025')!.acronym).toBe('CF');
    expect(rbx.findRolimons(items, 'red baseball cap')!.id).toBe(1028606);
    expect(rbx.findRolimons(items, 'cf')!.id).toBe(1029025);
    expect(rbx.findRolimons(items, 'fedora')!.id).toBe(1029025);
    expect(rbx.findRolimons(items, 'nothing like this')).toBeNull();
  });
});

describe('card helpers', () => {
  test('formatters', () => {
    expect(num(1234567)).toBe('1,234,567');
    expect(num(null)).toBe('—');
    expect(compact(950)).toBe('950');
    expect(compact(12_345)).toBe('12.3K');
    expect(compact(4_560_000)).toBe('4.56M');
    expect(compact(44_827_561_398)).toBe('44.83B');
    expect(trunc('abcdefghij', 5)).toBe('abcd…');
    expect(when('2006-03-08T17:17:52.9Z')).toMatch(/^<t:\d+:D>$/);
    expect(when(1_700_000_000)).toBe('<t:1700000000:D>');   // epoch seconds
    expect(when(1_700_000_000_000)).toBe('<t:1700000000:D>'); // epoch ms
    expect(when(undefined)).toBe('—');
  });
  test('card skips empty fields, links the title and caps length', () => {
    const c = card({ title: 'T', url: 'https://x.test', fields: [['A', 1], ['B', null], false, ['C', ''], ['D', 'ok']], footer: 'foot', links: [{ label: 'Go', url: 'https://x.test' }, { label: 'Bad', url: 'javascript:alert(1)' }] });
    const t = textOf(c);
    expect(t).toContain('[T](https://x.test)');
    expect(t).toContain('**A:** 1');
    expect(t).toContain('**D:** ok');
    expect(t).not.toContain('**B:**');
    expect(t).not.toContain('**C:**');
    const container = c.components[0].toJSON();
    const row = container.components.find((x: any) => x.type === 1);
    expect(row.components).toHaveLength(1);           // the javascript: link was dropped
    const huge = textOf(card({ title: 'x', description: 'y'.repeat(9000) }));
    expect(huge.length).toBeLessThan(4000);
  });
  test('listCard handles an empty list', () => {
    expect(textOf(listCard('Nothing', []))).toContain('Nothing to show');
  });
});

describe('command wiring', () => {
  test('every subcommand has a name, description, and a handler', () => {
    const names = robloxSubs.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(17);
    for (const s of robloxSubs) { expect(s.description.length).toBeGreaterThan(5); expect(typeof s.run).toBe('function'); }
  });
  test('calctax runs end to end offline', async () => {
    const f = fakeInteraction({ options: { amount: 1000 } });
    await robloxSubs.find(s => s.name === 'calctax')!.run(f.interaction);
    const t = textOf(f.last());
    expect(t).toContain('R$ 700');
    expect(t).toContain('R$ 1,429');
  });
  test('devex runs end to end offline', async () => {
    const f = fakeInteraction({ options: { amount: 10_000 } });
    await robloxSubs.find(s => s.name === 'devex')!.run(f.interaction);
    expect(textOf(f.last())).toContain('$38.00');
  });
});

// Live checks against the real Roblox API (run with RUN_NET_TEST=1) — these verify the response shapes the parsers rely on.
describe('live Roblox API (opt-in)', () => {
  net('resolves a user by name and by id, with counts and avatar', async () => {
    const u = await rbx.resolveUser('builderman');
    expect(u).toMatchObject({ id: 156, name: 'builderman' });
    expect((await rbx.resolveUser('156')).name).toBe('builderman');
    const c = await rbx.counts(156);
    expect(c.followers).toBeGreaterThan(1000);
    expect(await rbx.avatarUrl(156, 'headshot')).toMatch(/^https:\/\/tr\.rbxcdn\.com/);
  }, 30_000);
  net('unknown user gives a friendly error', async () => {
    await expect(rbx.resolveUser('zzzzzz_no_such_user_zzzzzz_123')).rejects.toBeInstanceOf(rbx.RobloxNotFound);
  }, 30_000);
  net('groups, group by name, group icon', async () => {
    const gs = await rbx.userGroups(156);
    expect(gs.length).toBeGreaterThan(0);
    expect(gs[0]!.group.name).toBeTruthy();
    const g = await rbx.resolveGroup('1200769');
    expect(g.memberCount).toBeGreaterThan(0);
    expect(await rbx.groupIcon(1200769)).toMatch(/^https:/);
    expect((await rbx.resolveGroup('roblox')).id).toBeGreaterThan(0);
  }, 30_000);
  net('game by place id, by name, with an icon', async () => {
    const byPlace = await rbx.resolveGame('920587237');
    expect(byPlace.name).toContain('Adopt Me');
    const byName = await rbx.resolveGame('adopt me');
    expect(byName.playing).toBeGreaterThan(0);
    expect(await rbx.gameIcon(byPlace.id)).toMatch(/^https:/);
  }, 30_000);
  net('asset details and template extraction', async () => {
    const a = await rbx.assetDetails(1028606);
    expect(a.Name).toBe('Red Baseball Cap');
    const png = await rbx.templateImage(607785311);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  }, 30_000);
  net('rolimons items load and search', async () => {
    const items = await rbx.rolimonsItems();
    expect(items.length).toBeGreaterThan(1000);
    expect(rbx.findRolimons(items, 'dominus')).not.toBeNull();
  }, 30_000);
  net('friends list resolves names, username history works, wearing works', async () => {
    const f = await rbx.friends(261);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]!.name).toBeTruthy();
    expect(Array.isArray(await rbx.usernameHistory(156))).toBe(true);
    expect((await rbx.wearing(156)).length).toBeGreaterThan(0);
    expect((await rbx.outfits(156)).length).toBeGreaterThan(0);
  }, 40_000);
});
