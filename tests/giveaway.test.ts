import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, initDb, getOrCreateEconomy, adjustBalance } from '../src/utils/db';
import { formatDuration, parseDuration } from '../src/framework/duration';
import { GIVEAWAY_TAX, MAX_ACTIVE_PER_GUILD, attachMessage, cancelGiveaway, createGiveaway, dueGiveaways, editGiveaway, endGiveaway, entrants, entryCount, getGiveaway, listActive, payoutPerWinner, pickWinners, rerollGiveaway, toggleEntry, winnerList } from '../src/giveaway/core';
import { announcement, finishGiveaway, giveawayView, handleEnterButton, tick, type GwChannel } from '../src/giveaway/service';
import { ecoGiveawaySub, giveawaySubs } from '../src/subcommands/giveaway/giveaway';
import type { Sub } from '../src/framework/group';
import { DeleteRefused, deleteData, exportData } from '../src/privacy';
import { fakeInteraction, textOf } from './fakeInteraction';

beforeAll(async () => { await initDb(); });

const G = 'gw-guild';
let n = 0;
const uid = () => `gw-user-${++n}`;
const guild = () => `gw-g-${++n}`;
const cash = async (g: string, u: string) => ((await db`SELECT balance FROM economy WHERE user_id = ${u}`) as { balance: number }[])[0]?.balance ?? 0;
async function fund(g: string, u: string, amount: number) { await getOrCreateEconomy(g, u); await adjustBalance(g, u, amount, 'test'); }
const mk = async (o: Partial<Parameters<typeof createGiveaway>[0]> = {}) => {
  const r = await createGiveaway({ guildId: G + n, channelId: 'ch1', hostId: uid(), prize: 'A prize', winners: 1, durationMs: 60_000, ...o });
  if (!r.ok) throw new Error('create failed: ' + r.reason);
  return r.giveaway;
};
const enter = async (id: number, count: number) => { const u = Array.from({ length: count }, uid); for (const x of u) await toggleEntry(id, x); return u; };

describe('duration parsing', () => {
  test('understands the ways people write durations', () => {
    const ok: [string, number][] = [['30m', 1_800_000], ['90s', 90_000], ['2h30m', 9_000_000], ['1d', 86_400_000], ['1w2d', 9 * 86_400_000], ['1 hour 5 minutes', 3_900_000], ['1.5h', 5_400_000], ['5m and 10s', 310_000], ['2 DAYS', 172_800_000], ['1h, 30m', 5_400_000]];
    for (const [s, ms] of ok) expect(parseDuration(s), s).toBe(ms);
  });
  test('rejects everything that isn\'t a duration', () => {
    for (const s of ['', '   ', 'abc', '10', 'm', '10x', '-5m', '0m', '5m junk', '1h30', 'x'.repeat(100), '1 2 3', '5 minutes ago', 'NaN', 'Infinity']) expect(parseDuration(s), JSON.stringify(s)).toBeNull();
  });
  test('formats back to a short readable string', () => {
    expect(formatDuration(90_000)).toBe('1m 30s'); expect(formatDuration(86_400_000)).toBe('1d'); expect(formatDuration(3_723_000)).toBe('1h 2m 3s'); expect(formatDuration(500)).toBe('0s'); expect(formatDuration(30 * 86_400_000)).toBe('30d');
  });
});

describe('creating giveaways', () => {
  test('validates prize, winners and duration', async () => {
    const base = { guildId: guild(), channelId: 'c', hostId: uid(), prize: 'p', winners: 1, durationMs: 60_000 };
    expect(await createGiveaway({ ...base, prize: '   ' })).toEqual({ ok: false, reason: 'prize' });
    expect(await createGiveaway({ ...base, prize: 'x'.repeat(201) })).toEqual({ ok: false, reason: 'prize' });
    for (const w of [0, -1, 21, 1.5, NaN]) expect(await createGiveaway({ ...base, winners: w })).toEqual({ ok: false, reason: 'winners' });
    for (const d of [0, 29_999, 31 * 86_400_000, NaN, Infinity]) expect(await createGiveaway({ ...base, durationMs: d })).toEqual({ ok: false, reason: 'duration' });
    const ok = await createGiveaway({ ...base, prize: '  trimmed  ' }); expect(ok.ok && ok.giveaway.prize).toBe('trimmed');
  });
  test('a server can only have so many active giveaways at once', async () => {
    const g = guild();
    for (let i = 0; i < MAX_ACTIVE_PER_GUILD; i++) expect((await createGiveaway({ guildId: g, channelId: 'c', hostId: 'h', prize: `p${i}`, winners: 1, durationMs: 60_000 })).ok).toBe(true);
    expect(await createGiveaway({ guildId: g, channelId: 'c', hostId: 'h', prize: 'one too many', winners: 1, durationMs: 60_000 })).toEqual({ ok: false, reason: 'too-many' });
    expect((await listActive(g)).length).toBe(25);
    expect((await createGiveaway({ guildId: guild(), channelId: 'c', hostId: 'h', prize: 'other server', winners: 1, durationMs: 60_000 })).ok).toBe(true);
  });
  test('a funded giveaway takes the pot from the host up front, atomically, and refuses if they can\'t afford it', async () => {
    const host = uid(), g = guild(); await fund(g, host, 1000);
    expect(await createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'pot', winners: 1, durationMs: 60_000, pot: 5000 })).toEqual({ ok: false, reason: 'funds' });
    expect(await cash(g, host)).toBe(1000);
    const r = await createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'pot', winners: 1, durationMs: 60_000, pot: 600 }); expect(r.ok).toBe(true);
    expect(await cash(g, host)).toBe(400);
    // 5 parallel attempts to spend the remaining 400 on 300-coin pots: at most one can succeed
    const rs = await Promise.all(Array.from({ length: 5 }, () => createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'pot', winners: 1, durationMs: 60_000, pot: 300 })));
    expect(rs.filter(x => x.ok)).toHaveLength(1); expect(await cash(g, host)).toBe(100);
  });
});

describe('entering', () => {
  test('press to join, press again to leave; only while active', async () => {
    const g = await mk(); const u = uid();
    expect(await toggleEntry(g.id, u)).toBe('entered'); expect(await entryCount(g.id)).toBe(1);
    expect(await toggleEntry(g.id, u)).toBe('left'); expect(await entryCount(g.id)).toBe(0);
    expect(await toggleEntry(999_999, u)).toBe('missing');
    expect(await toggleEntry(g.id, u, g.ends_at + 1)).toBe('ended');
    await endGiveaway(g.id); expect(await toggleEntry(g.id, u)).toBe('ended');
  });
  test('many people entering at once are all counted exactly once', async () => {
    const g = await mk(); const people = Array.from({ length: 60 }, uid);
    await Promise.all(people.map(p => toggleEntry(g.id, p)));
    expect(await entryCount(g.id)).toBe(60); expect(new Set(await entrants(g.id)).size).toBe(60);
  });
  test('one person hammering the button never ends up in an impossible state', async () => {
    const g = await mk(); const u = uid();
    await Promise.all(Array.from({ length: 11 }, () => toggleEntry(g.id, u)));
    expect([0, 1]).toContain(await entryCount(g.id));
  });
});

describe('picking winners', () => {
  test('distinct, never more than the pool, and empty for an empty pool', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 100; i++) { const w = pickWinners(pool, 3); expect(new Set(w).size).toBe(3); for (const x of w) expect(pool).toContain(x); }
    expect(pickWinners(pool, 50).sort()).toEqual(pool); expect(pickWinners([], 3)).toEqual([]); expect(pickWinners(['a', 'a', 'a'], 2)).toEqual(['a']);
  });
  test('every entrant has a fair chance', () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 8000; i++) counts[pickWinners(['a', 'b', 'c', 'd'], 1)[0]!]!++;
    for (const v of Object.values(counts)) { expect(v).toBeGreaterThan(1700); expect(v).toBeLessThan(2300); }
  });
  test('is deterministic given a fixed random source', () => { let s = 1; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); const a = pickWinners(['x', 'y', 'z', 'w'], 2, r); s = 1; expect(pickWinners(['x', 'y', 'z', 'w'], 2, r)).toEqual(a); });
  test('payouts: pot minus 25% tax, split evenly, rounded down', () => {
    expect(GIVEAWAY_TAX).toBe(0.25); expect(payoutPerWinner(1000, 1)).toBe(750); expect(payoutPerWinner(1000, 3)).toBe(250); expect(payoutPerWinner(101, 2)).toBe(37); expect(payoutPerWinner(1000, 0)).toBe(0);
  });
});

describe('ending', () => {
  test('ends exactly once even if ten things try at the same moment', async () => {
    const g = await mk({ winners: 2 }); await enter(g.id, 8);
    const rs = await Promise.all(Array.from({ length: 10 }, () => endGiveaway(g.id)));
    expect(rs.filter(Boolean)).toHaveLength(1);
    const done = rs.find(Boolean)!; expect(done.winners).toHaveLength(2); expect(done.entries).toBe(8);
    const stored = await getGiveaway(g.id); expect(stored!.status).toBe('ended'); expect(winnerList(stored!)).toEqual(done.winners);
    for (const w of done.winners) expect(await entrants(g.id)).toContain(w);
  });
  test('winners are only people who entered; fewer entrants than winners is fine; nobody entered is fine', async () => {
    const a = await mk({ winners: 5 }); const three = await enter(a.id, 3); const ea = (await endGiveaway(a.id))!;
    expect(ea.winners.sort()).toEqual(three.sort());
    const b = await mk(); const eb = (await endGiveaway(b.id))!; expect(eb.winners).toEqual([]); expect(eb.entries).toBe(0);
    expect(await endGiveaway(b.id)).toBeUndefined(); expect(await endGiveaway(424242)).toBeUndefined();
  });
  test('MONEY: winners split the pot minus 25% tax, and every coin is accounted for', async () => {
    const g = guild(), host = uid(); await fund(g, host, 10_000);
    const r = await createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'coins', winners: 3, durationMs: 60_000, pot: 4000 }); if (!r.ok) throw new Error('x');
    expect(await cash(g, host)).toBe(6000);
    const people = await enter(r.giveaway.id, 5); for (const p of people) await getOrCreateEconomy(g, p);
    const before = await Promise.all(people.map(p => cash(g, p)));
    const e = (await endGiveaway(r.giveaway.id))!;
    expect(e.paid).toBe(3 * 1000);
    const after = await Promise.all(people.map(p => cash(g, p)));
    const gained = after.map((v, i) => v - before[i]!);
    expect(gained.filter(x => x === 1000)).toHaveLength(3); expect(gained.filter(x => x === 0)).toHaveLength(2);
    expect(await cash(g, host)).toBe(6000); // the host is not paid back when there are winners: 4000 → 3000 to winners + 1000 tax
  });
  test('MONEY: a funded giveaway nobody enters refunds the host in full', async () => {
    const g = guild(), host = uid(); await fund(g, host, 2000);
    const r = await createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'coins', winners: 1, durationMs: 60_000, pot: 1500 }); if (!r.ok) throw new Error('x');
    expect(await cash(g, host)).toBe(500);
    const e = (await endGiveaway(r.giveaway.id))!; expect(e.winners).toEqual([]); expect(await cash(g, host)).toBe(2000);
  });
  test('MONEY: ending and cancelling at the same instant pays out OR refunds — never both, never neither', async () => {
    for (let round = 0; round < 15; round++) {
      const g = guild(), host = uid(); await fund(g, host, 1000);
      const r = await createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'coins', winners: 1, durationMs: 60_000, pot: 1000 }); if (!r.ok) throw new Error('x');
      const [winner] = await enter(r.giveaway.id, 1); await getOrCreateEconomy(g, winner!);
      const [ended, cancelled] = await Promise.all([endGiveaway(r.giveaway.id), cancelGiveaway(r.giveaway.id)]);
      expect(Boolean(ended) !== Boolean(cancelled), 'exactly one of end/cancel wins').toBe(true);
      if (ended) { expect(await cash(g, winner!)).toBe(750); expect(await cash(g, host)).toBe(0); }
      else { expect(await cash(g, winner!)).toBe(0); expect(await cash(g, host)).toBe(1000); }
    }
  });
  test('cancelling: refunds a funded pot once, and only while active', async () => {
    const g = guild(), host = uid(); await fund(g, host, 800);
    const r = await createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'coins', winners: 1, durationMs: 60_000, pot: 800 }); if (!r.ok) throw new Error('x');
    expect((await Promise.all([cancelGiveaway(r.giveaway.id), cancelGiveaway(r.giveaway.id), cancelGiveaway(r.giveaway.id)])).filter(Boolean)).toHaveLength(1);
    expect(await cash(g, host)).toBe(800); expect((await getGiveaway(r.giveaway.id))!.status).toBe('cancelled'); expect(await endGiveaway(r.giveaway.id)).toBeUndefined();
  });
});

describe('reroll and edit', () => {
  test('reroll picks new people first, falls back to everyone, and is refused when it makes no sense', async () => {
    const g = await mk({ winners: 1 }); const people = await enter(g.id, 3);
    expect(await rerollGiveaway(g.id)).toEqual({ ok: false, reason: 'active' }); expect(await rerollGiveaway(31337)).toEqual({ ok: false, reason: 'missing' });
    const first = (await endGiveaway(g.id))!.winners[0]!;
    // Nobody wins twice until everyone has: with 3 entrants, the original winner and the two rerolls are all different people.
    const r1 = await rerollGiveaway(g.id), r2 = await rerollGiveaway(g.id);
    if (!r1.ok || !r2.ok) throw new Error('reroll failed');
    expect(new Set([first, r1.winners[0], r2.winners[0]]).size).toBe(3);
    expect((await rerollGiveaway(g.id)).ok).toBe(true); // pool exhausted: the draw starts over instead of refusing
    const solo = await mk(); const [only] = await enter(solo.id, 1); await endGiveaway(solo.id);
    const again = await rerollGiveaway(solo.id); expect(again).toEqual({ ok: true, winners: [only!] }); // one entrant: they can win again
    const empty = await mk(); await endGiveaway(empty.id); expect(await rerollGiveaway(empty.id)).toEqual({ ok: false, reason: 'no-entries' });
    expect(people).toHaveLength(3);
  });
  test('funded giveaways cannot be rerolled (the coins are already paid)', async () => {
    const g = guild(), host = uid(); await fund(g, host, 500);
    const r = await createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'coins', winners: 1, durationMs: 60_000, pot: 500 }); if (!r.ok) throw new Error('x');
    await enter(r.giveaway.id, 2); await endGiveaway(r.giveaway.id);
    expect(await rerollGiveaway(r.giveaway.id)).toEqual({ ok: false, reason: 'funded' });
  });
  test('edit changes an active giveaway only, and clamps winner counts', async () => {
    const g = await mk(); const later = Date.now() + 3_600_000;
    const e = await editGiveaway(g.id, { prize: '  New prize ', winners: 99, endsAt: later }); expect(e).toMatchObject({ prize: 'New prize', winners: 20, ends_at: later });
    expect(await editGiveaway(g.id, { winners: 0 })).toMatchObject({ winners: 1 });
    await endGiveaway(g.id); expect(await editGiveaway(g.id, { prize: 'too late' })).toBeUndefined(); expect(await editGiveaway(777_777, {})).toBeUndefined();
  });
});

describe('scheduler', () => {
  // The DB is shared across this file, and a tick ends everything overdue: start each test with nothing else active.
  beforeEach(async () => { await db`UPDATE giveaways SET status = 'cancelled' WHERE status = 'active'`; });
  const channel = () => {
    const log = { sent: [] as any[], edits: [] as any[] };
    const ch: GwChannel = { send: async p => { log.sent.push(p); return {}; }, messages: { fetch: async id => ({ id, edit: async p => { log.edits.push(p); return {}; } }) } };
    return { ch, log };
  };
  test('ends what is due, announces winners, edits the message, and leaves the rest alone', async () => {
    const due = await mk({ prize: 'Due prize', winners: 1 }), notDue = await mk({ prize: 'Later prize', durationMs: 3_600_000 });
    await attachMessage(due.id, 'msg-due'); await attachMessage(notDue.id, 'msg-later');
    const [w] = await enter(due.id, 1);
    const { ch, log } = channel();
    expect((await dueGiveaways(Date.now())).map(x => x.id)).not.toContain(due.id);
    const ended = await tick(async () => ch, due.ends_at + 1);
    expect(ended).toBeGreaterThanOrEqual(1);
    expect((await getGiveaway(due.id))!.status).toBe('ended'); expect((await getGiveaway(notDue.id))!.status).toBe('active');
    expect(log.sent).toHaveLength(1); expect(log.sent[0].content).toContain(`<@${w}>`); expect(log.sent[0].content).toContain('Due prize');
    expect(log.sent[0].allowedMentions).toEqual({ users: [w] }); expect(log.sent[0].reply).toMatchObject({ messageReference: 'msg-due' }); // only the winners can be pinged
    expect(JSON.stringify(log.edits[0].components.map((c: any) => c.toJSON()))).toContain('Winner');
    expect(await tick(async () => ch, due.ends_at + 1)).toBe(0); // a second pass does nothing
  });
  test('survives a missing channel and a broken channel without losing the result or other giveaways', async () => {
    const a = await mk({ channelId: 'gone' }), b = await mk({ channelId: 'boom' }), c = await mk({ channelId: 'fine' });
    await enter(a.id, 1); await enter(b.id, 1); await enter(c.id, 1);
    const good = channel(); const orig = console.error; console.error = () => {};
    try {
      await tick(async id => (id === 'gone' ? null : id === 'boom' ? { send: async () => { throw new Error('no perms'); }, messages: { fetch: async () => { throw new Error('gone'); } } } as GwChannel : good.ch), c.ends_at + 1);
    } finally { console.error = orig; }
    for (const g of [a, b, c]) expect((await getGiveaway(g.id))!.status).toBe('ended');
    expect(winnerList((await getGiveaway(a.id))!)).toHaveLength(1); expect(good.log.sent).toHaveLength(1);
  });
  test('finishGiveaway is safe to call twice', async () => {
    const g = await mk(); const { ch, log } = channel(); await enter(g.id, 2);
    await Promise.all([finishGiveaway(g.id, async () => ch), finishGiveaway(g.id, async () => ch)]);
    expect(log.sent).toHaveLength(1);
  });
});

describe('what people see', () => {
  const view = (g: any, entries = 0) => JSON.stringify(giveawayView(g, entries).components.map((c: any) => c.toJSON()));
  test('an active giveaway shows the prize, host, time, winners, entries and an Enter button', async () => {
    const g = await mk({ prize: 'Nitro', winners: 2, imageUrl: 'https://cdn.example.com/x.png' });
    const v = view(g, 1234); for (const s of ['Nitro', `<@${g.host_id}>`, 'Winners: **2**', 'Entries: **1,234**', `gw:enter:${g.id}`, 'Enter', 'cdn.example.com/x.png']) expect(v, s).toContain(s);
    expect(giveawayView(g, 0).allowedMentions).toEqual({ parse: [] });
    expect(view({ ...g, image_url: 'http://insecure/x.png' })).not.toContain('insecure'); // only https images
  });
  test('ended shows winners and no button; cancelled says so; funded ones mention the pool and tax', async () => {
    const g = await mk({ prize: 'Thing' });
    const ended = view({ ...g, status: 'ended', winner_ids: JSON.stringify(['1', '2']) }, 5); expect(ended).toContain('<@1>, <@2>'); expect(ended).not.toContain('gw:enter');
    expect(view({ ...g, status: 'ended' }, 0)).toContain('Nobody entered'); expect(view({ ...g, status: 'cancelled' })).toContain('cancelled');
    expect(view({ ...g, pot: 1000 })).toContain('25% tax');
  });
  test('announcement text', async () => {
    const g = await mk({ prize: 'A car' });
    expect(announcement({ giveaway: g, winners: ['1'], entries: 3, paid: 0 })).toBe(`🎉 Congratulations <@1>! You won **A car**. Hosted by <@${g.host_id}>.`);
    expect(announcement({ giveaway: { ...g, pot: 1000 }, winners: ['1', '2'], entries: 3, paid: 750 })).toContain('**375** each');
    expect(announcement({ giveaway: { ...g, pot: 1000 }, winners: [], entries: 0, paid: 0 })).toContain('refunded');
  });
  test('the Enter button: join and leave update the count; ended and missing give a private note', async () => {
    const g = await mk(); const u = uid();
    const press = async (id: number | string, userId = u) => {
      const log = { updates: [] as any[], followUps: [] as any[], replies: [] as any[] };
      await handleEnterButton({ customId: `gw:enter:${id}`, user: { id: userId }, update: async (p: any) => { log.updates.push(p); }, followUp: async (p: any) => { log.followUps.push(p); }, reply: async (p: any) => { log.replies.push(p); } } as any);
      return log;
    };
    const a = await press(g.id); expect(JSON.stringify(a.updates[0].components.map((c: any) => c.toJSON()))).toContain('Entries: **1**'); expect(a.followUps[0].content).toContain('You\'re in'); expect(a.followUps[0].flags & 64).toBeTruthy();
    const b = await press(g.id); expect(JSON.stringify(b.updates[0].components.map((c: any) => c.toJSON()))).toContain('Entries: **0**'); expect(b.followUps[0].content).toContain('left');
    await endGiveaway(g.id); expect((await press(g.id)).replies[0].content).toContain('already ended');
    expect((await press(88_888)).replies[0].content).toContain('can\'t find'); expect((await press('abc')).replies[0].content).toContain('invalid');
  });
});

describe('/giveaway commands', () => {
  const find = (subs: Sub[], name: string) => subs.find(s => s.name === name)!;
  const run = async (sub: Sub, o: { guildId?: string | null; installed?: boolean; options?: Record<string, string | number>; userId?: string; users?: any } = {}) => {
    const fi = fakeInteraction({ guildId: o.guildId === undefined ? G + 'cmd' : o.guildId, guildName: o.installed === false ? undefined : 'Test Server', userId: o.userId ?? uid(), options: o.options, users: o.users });
    await sub.run(fi.interaction); return { fi, text: fi.sent.map(textOf).join('\n') };
  };
  test('in a server Bestow is only installed for a person (not the server), giveaways explain why and how to fix it', async () => {
    for (const name of ['start', 'end', 'reroll', 'cancel', 'edit', 'list']) {
      const r = await run(find(giveawaySubs, name), { installed: false, options: { duration: '1h', winners: 1, prize: 'x', message_id: '1234567890123456' } });
      expect(r.text, name).toContain('added to this server'); expect(r.text).toContain('discord.com/oauth2/authorize');
    }
  });
  test('start posts the giveaway as the reply, records its message, and rejects bad durations', async () => {
    const host = uid();
    const ok = await run(find(giveawaySubs, 'start'), { userId: host, options: { duration: '2h', winners: 3, prize: 'A pizza' } });
    expect(ok.text).toContain('A pizza'); expect(ok.text).toContain('Winners: **3**');
    const g = (await listActive(G + 'cmd')).find(x => x.prize === 'A pizza')!; expect(g).toMatchObject({ host_id: host, winners: 3, channel_id: 'c-test' }); expect(g.message_id).toMatch(/^m\d+$/);
    const bad = await run(find(giveawaySubs, 'start'), { options: { duration: 'soon', winners: 1, prize: 'x' } }); expect(bad.text).toContain('The duration must be between');
    const tooLong = await run(find(giveawaySubs, 'start'), { options: { duration: '90d', winners: 1, prize: 'x' } }); expect(tooLong.text).toContain('The duration must be between');
  });
  test('end / reroll / cancel / edit find giveaways by message id or link, and never in another server', async () => {
    const g = await mk({ guildId: G + 'cmd', prize: 'Managed' }); await attachMessage(g.id, '555000111222333444'); await enter(g.id, 4);
    const link = 'https://discord.com/channels/1/2/555000111222333444';
    const e = await run(find(giveawaySubs, 'edit'), { options: { message_id: link, winners: 2, prize: 'Edited' } }); expect(e.text).toContain('updated'); expect((await getGiveaway(g.id))).toMatchObject({ winners: 2, prize: 'Edited' });
    const other = await run(find(giveawaySubs, 'end'), { guildId: 'some-other-guild', options: { message_id: '555000111222333444' } }); expect(other.text).toContain('couldn\'t find'); expect((await getGiveaway(g.id))!.status).toBe('active');
    const missing = await run(find(giveawaySubs, 'cancel'), { options: { message_id: 'not an id' } }); expect(missing.text).toContain('couldn\'t find');
    const early = await run(find(giveawaySubs, 'reroll'), { options: { message_id: '555000111222333444' } }); expect(early.text).toContain('still running');
    const end = await run(find(giveawaySubs, 'end'), { options: { message_id: link } }); expect(end.text).toContain('Ending'); expect((await getGiveaway(g.id))!.status).toBe('ended');
    const again = await run(find(giveawaySubs, 'end'), { options: { message_id: link } }); expect(again.text).toContain('already ended');
    const re = await run(find(giveawaySubs, 'reroll'), { options: { message_id: link, count: 2 } }); expect(re.text).toContain('New winners'); expect(re.fi.last().allowedMentions.users).toHaveLength(2);
    const late = await run(find(giveawaySubs, 'edit'), { options: { message_id: link, winners: 1 } }); expect(late.text).toContain('already ended');
  });
  test('cancel refunds a funded pot and says so', async () => {
    const g = guild(), host = uid(); await fund(g, host, 500);
    const r = await createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'coins', winners: 1, durationMs: 60_000, pot: 500 }); if (!r.ok) throw new Error('x'); await attachMessage(r.giveaway.id, '777000111222333444');
    const out = await run(find(giveawaySubs, 'cancel'), { guildId: g, options: { message_id: '777000111222333444' } }); expect(out.text).toContain('refunded'); expect(await cash(g, host)).toBe(500);
  });
  test('list shows only this server\'s active giveaways', async () => {
    const g = guild(); await mk({ guildId: g, prize: 'Mine' }); await mk({ guildId: guild(), prize: 'Theirs' });
    const r = await run(find(giveawaySubs, 'list'), { guildId: g }); expect(r.text).toContain('Mine'); expect(r.text).not.toContain('Theirs');
    expect((await run(find(giveawaySubs, 'list'), { guildId: guild() })).text).toContain('No active giveaways');
  });
  test('/eco giveaway: escrows the host\'s cash, and refuses tiny pots, bad durations and empty wallets', async () => {
    const g = guild(), host = uid(); await fund(g, host, 5000);
    const opts = { amount: '2000', winners: 2, duration: '1h' };
    const ok = await run(ecoGiveawaySub, { guildId: g, userId: host, options: opts }); expect(ok.text).toContain('Winners: **2**'); expect(ok.text).toContain('25% tax'); expect(await cash(g, host)).toBe(3000);
    expect((await run(ecoGiveawaySub, { guildId: g, userId: host, options: { ...opts, amount: '5' } })).text).toContain('smallest pot');
    expect((await run(ecoGiveawaySub, { guildId: g, userId: host, options: { ...opts, duration: 'later' } })).text).toContain('The duration must be between'); expect(await cash(g, host)).toBe(3000);
    const broke = uid(); expect((await run(ecoGiveawaySub, { guildId: g, userId: broke, options: opts })).text).toMatch(/smallest pot|afford/);
    expect((await run(ecoGiveawaySub, { guildId: g, installed: false, userId: host, options: opts })).text).toContain('added to this server');
  });
  test('the registered /giveaway command enforces Manage Server and refuses DMs', async () => {
    const cmd = (await import('../src/handlers/commandHandler')).default.get('giveaway')!;
    const dispatch = async (sub: string, o: { guildId?: string | null; manage?: boolean }) => {
      const fi = fakeInteraction({ guildId: o.guildId === undefined ? 'gx' : o.guildId, guildName: 'S', manageGuild: o.manage, sub, options: { duration: '1h', winners: 1, prize: 'p' } });
      await cmd.run!(fi.interaction); return fi.sent.map((p: any) => textOf(p)).join('\n');
    };
    expect(await dispatch('start', { manage: false })).toContain('Manage Server'); expect(await dispatch('start', { guildId: null })).toContain('only works in a server');
    expect(await dispatch('list', { manage: false })).toContain('No active giveaways'); // listing needs no special permission
  });
});

describe('privacy', () => {
  beforeEach(async () => { await db`UPDATE giveaways SET status = 'cancelled' WHERE status = 'active'`; });
  test('/privacy delete removes entries, blanks the host, and scrubs winner lists — without touching anyone else', async () => {
    const me = uid(), other = uid();
    const hosted = await mk({ hostId: me, winners: 2 });
    await toggleEntry(hosted.id, me); await toggleEntry(hosted.id, other);
    await endGiveaway(hosted.id, { rand: () => 0 });
    expect(winnerList((await getGiveaway(hosted.id))!).sort()).toEqual([me, other].sort());
    const exported = JSON.parse((await exportData(me)).data.toString()); expect(Object.keys(exported.tables)).toEqual(expect.arrayContaining(['giveaway_entries', 'giveaways']));
    const res = await deleteData(me);
    expect(res.deleted).toBeGreaterThanOrEqual(1); expect(res.anonymized).toBeGreaterThanOrEqual(1);
    const after = (await getGiveaway(hosted.id))!;
    expect(after.host_id).not.toBe(me); expect(after.winner_ids).not.toContain(me); expect(after.drawn).not.toContain(me);
    expect(winnerList(after)).toEqual([other]); expect(await entrants(hosted.id)).toEqual([other]);
  });
  test('deleting is refused while a money giveaway you host is still running, and nothing changes', async () => {
    const g = guild(), host = uid(); await fund(g, host, 700);
    const r = await createGiveaway({ guildId: g, channelId: 'c', hostId: host, prize: 'coins', winners: 1, durationMs: 60_000, pot: 700 }); if (!r.ok) throw new Error('x');
    await toggleEntry(r.giveaway.id, host);
    await expect(deleteData(host)).rejects.toBeInstanceOf(DeleteRefused);
    expect((await getGiveaway(r.giveaway.id))!.host_id).toBe(host); expect(await entrants(r.giveaway.id)).toEqual([host]);
    await cancelGiveaway(r.giveaway.id); // the coins come back, and now deleting works
    await deleteData(host);
    expect((await getGiveaway(r.giveaway.id))!.host_id).not.toBe(host);
  });
});
