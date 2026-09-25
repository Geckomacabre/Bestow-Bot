import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, initDb } from '../src/utils/db';
import { DAY, createGift, extendPremium, hasPremium, isOwner, listGifts, newGiftCode, normalizeCode, premiumOf, premiumStatus, redeemGift, resetPremiumCache, revokePremium, setPremium } from '../src/premium/index';
import { applyEntitlement, reconcile } from '../src/premium/sync';
import { checkLimit, formatWait, limitMessage, resetLimits, usage } from '../src/ai/limits';
import { premiumSubs, giftSubs } from '../src/subcommands/premium/premium';
import { aiSubs } from '../src/subcommands/ai/ai';
import { deleteData } from '../src/privacy';
import type { Sub } from '../src/framework/group';
import { fakeInteraction, textOf } from './fakeInteraction';

const SKU = '900000000000000001', GIFT_SKU = '900000000000000002';
let n = 0;
const uid = () => `prem-user-${++n}`;
const find = (subs: Sub[], name: string) => subs.find(s => s.name === name)!;
const ent = (userId: string, o: Partial<{ skuId: string; active: boolean; endsTimestamp: number | null; id: string; consumed: boolean }> = {}) => {
  const calls = { consumed: 0 };
  return { id: o.id ?? `e-${++n}`, skuId: o.skuId ?? SKU, userId, endsTimestamp: o.endsTimestamp ?? null, deleted: false, consumed: o.consumed ?? false,
    isActive: () => o.active ?? true, consume: async () => { calls.consumed++; }, calls } as any;
};

// A mock OpenAI-compatible provider so the AI commands really run.
let server: ReturnType<typeof Bun.serve>;
let providerCalls = 0;

beforeAll(async () => {
  await initDb();
  server = Bun.serve({ port: 0, async fetch(req) { if (new URL(req.url).pathname.endsWith('/chat/completions')) { providerCalls++; await req.json(); return Response.json({ choices: [{ message: { content: 'mock answer' } }] }); } return new Response('no', { status: 404 }); } });
  Bun.env.LLM_BASE_URL = `http://127.0.0.1:${server.port}/v1`; Bun.env.LLM_MODEL = 'm';
});
afterAll(() => { server.stop(true); delete Bun.env.LLM_BASE_URL; delete Bun.env.LLM_MODEL; });
beforeEach(() => { resetLimits(); resetPremiumCache(); providerCalls = 0; delete Bun.env.PREMIUM_SKU_ID; delete Bun.env.PREMIUM_GIFT_SKU_ID; delete Bun.env.OWNER_IDS; delete Bun.env.AI_USER_LIMIT; delete Bun.env.AI_DAILY_LIMIT; delete Bun.env.AI_DISABLED; delete Bun.env.PREMIUM_GIFT_DAYS; });

describe('AI limit: 20 per hour free, unlimited with premium', () => {
  test('the free default is 20 per rolling hour, and it slides', () => {
    const T = 5_000_000;
    for (let i = 0; i < 20; i++) expect(checkLimit('free', T + i, false)).toMatchObject({ ok: true });
    expect(checkLimit('free', T + 100, false)).toMatchObject({ ok: false, reason: 'user' });
    expect(checkLimit('free', T + 3_600_001, false).ok).toBe(true); // the first request aged out of the window
  });
  test('premium has no per-user limit but still counts toward usage and the global cap / kill switch', () => {
    for (let i = 0; i < 500; i++) expect(checkLimit('prem', i, true).ok).toBe(true);
    expect(usage('prem', 600, true)).toMatchObject({ used: 500, limit: null, remaining: null });
    Bun.env.AI_DAILY_LIMIT = '3'; resetLimits();
    for (let i = 0; i < 3; i++) expect(checkLimit('p2', i, true).ok).toBe(true);
    expect(checkLimit('p3', 4, true)).toMatchObject({ ok: false, reason: 'global' });
    Bun.env.AI_DISABLED = '1'; expect(checkLimit('p4', 1, true)).toMatchObject({ ok: false, reason: 'disabled' });
  });
  test('usage reports where a free person stands', () => {
    for (let i = 0; i < 5; i++) checkLimit('u', 1000 + i, false);
    expect(usage('u', 2000, false)).toMatchObject({ used: 5, limit: 20, remaining: 15 });
    expect(usage('nobody', 2000, false)).toMatchObject({ used: 0, limit: 20, remaining: 20, resetsInMs: null });
  });
  test('the message names the limit and only advertises Premium once it can actually be bought', () => {
    const r = { ok: false as const, reason: 'user' as const, retryAfterMs: 5 * 60_000 };
    expect(limitMessage(r)).toContain('20 free AI requests'); expect(limitMessage(r)).not.toContain('/premium');
    Bun.env.PREMIUM_SKU_ID = SKU; expect(limitMessage(r)).toContain('/premium buy');
    expect(formatWait(30_000)).toBe('1 minute'); expect(formatWait(5 * 3_600_000)).toBe('5 hours');
  });
  test('END TO END: /ai ask stops a free user at their limit, and a premium user sails past it', async () => {
    Bun.env.AI_USER_LIMIT = '3'; Bun.env.PREMIUM_SKU_ID = SKU;
    const free = uid(), prem = uid(); await extendPremium(prem, 30, 'grant');
    const ask = async (userId: string) => { const fi = fakeInteraction({ userId, options: { question: 'hi there' } }); await find(aiSubs, 'ask').run(fi.interaction); return textOf(fi.last()); };
    for (let i = 0; i < 3; i++) expect(await ask(free)).toContain('mock answer');
    const blocked = await ask(free);
    expect(blocked).toContain('3 free AI requests'); expect(blocked).toContain('/premium buy'); expect(providerCalls).toBe(3);
    for (let i = 0; i < 8; i++) expect(await ask(prem)).toContain('mock answer');
    expect(providerCalls).toBe(11);
  });
  test('an entitlement Discord attaches to the interaction unlocks the limit immediately', async () => {
    Bun.env.AI_USER_LIMIT = '1'; Bun.env.PREMIUM_SKU_ID = SKU;
    const u = uid();
    const fi = () => { const f = fakeInteraction({ userId: u, options: { question: 'hey' } }); (f.interaction as any).entitlements = new Map([['1', ent(u)]]); return f; };
    for (let i = 0; i < 4; i++) { const f = fi(); await find(aiSubs, 'ask').run(f.interaction); expect(textOf(f.last())).toContain('mock answer'); }
    expect((await premiumStatus(u)).source).toBe('entitlement'); // remembered for the @mention path too
  });
});

describe('premium status', () => {
  test('grants stack, expire, and can be revoked', async () => {
    const u = uid(), T = 1_000_000_000_000;
    expect((await premiumStatus(u, { now: T })).premium).toBe(false);
    const e1 = await extendPremium(u, 30, 'grant', T); expect(e1).toBe(T + 30 * DAY);
    expect(await premiumStatus(u, { now: T + 29 * DAY })).toMatchObject({ premium: true, source: 'grant', expiresAt: T + 30 * DAY });
    const e2 = await extendPremium(u, 10, 'grant', T + 20 * DAY); expect(e2).toBe(T + 40 * DAY); // adds to the time left, not from now
    expect((await premiumStatus(u, { now: T + 41 * DAY })).premium).toBe(false);
    await extendPremium(u, 5, 'grant', T + 50 * DAY); expect((await premiumStatus(u, { now: T + 51 * DAY })).premium).toBe(true);
    expect(await revokePremium(u)).toBe(true); expect(await revokePremium(u)).toBe(false); expect((await premiumStatus(u, { now: T + 51 * DAY })).premium).toBe(false);
  });
  test('bot owners always have premium', async () => {
    Bun.env.OWNER_IDS = ' 111, 222 '; expect(isOwner('222')).toBe(true); expect(isOwner('333')).toBe(false);
    expect(await premiumStatus('111')).toMatchObject({ premium: true, source: 'owner' });
  });
  test('entitlements: only the right SKU, the right person, and only active ones count', async () => {
    Bun.env.PREMIUM_SKU_ID = SKU;
    const a = uid(), b = uid(), c = uid(), d = uid();
    expect((await premiumStatus(a, { entitlements: [ent(a)] })).premium).toBe(true);
    expect((await premiumStatus(b, { entitlements: [ent(b, { skuId: '1234' })] })).premium).toBe(false);
    expect((await premiumStatus(c, { entitlements: [ent(c, { active: false })] })).premium).toBe(false);
    expect((await premiumStatus(d, { entitlements: [ent('someone-else')] })).premium).toBe(false);
    Bun.env.PREMIUM_SKU_ID = ''; const e = uid(); expect((await premiumStatus(e, { entitlements: [ent(e)] })).premium).toBe(false); // no SKU configured → nothing to match
  });
  test('the @mention path asks Discord once, then caches for five minutes; an outage never blocks anyone', async () => {
    Bun.env.PREMIUM_SKU_ID = SKU;
    const u = uid(); let fetches = 0, active = true;
    const client: any = { application: { entitlements: { fetch: async () => { fetches++; if (!active) throw new Error('down'); return new Map([['1', ent(u)]]); } } } };
    const T = Date.now();
    expect((await premiumStatus(u, { client, now: T })).premium).toBe(true);
    await db`DELETE FROM premium_users WHERE user_id = ${u}`; resetPremiumCache();
    expect((await premiumStatus(u, { client, now: T })).premium).toBe(true); expect(fetches).toBe(2);
    await db`DELETE FROM premium_users WHERE user_id = ${u}`;
    expect((await premiumStatus(u, { client, now: T + 60_000 })).premium).toBe(true); expect(fetches).toBe(2); // cached
    const v = uid(); active = false; expect((await premiumStatus(v, { client, now: T })).premium).toBe(false);
  });
  test('premiumOf reads an interaction\'s own entitlement list', async () => {
    Bun.env.PREMIUM_SKU_ID = SKU; const u = uid();
    expect((await premiumOf({ user: { id: u }, entitlements: new Map([['1', ent(u)]]) as any })).premium).toBe(true);
    expect((await premiumOf({ user: { id: uid() } })).premium).toBe(false);
  });
});

describe('gift codes', () => {
  test('codes look right, are unique, and are forgiving to type', () => {
    const codes = new Set(Array.from({ length: 500 }, newGiftCode)); expect(codes.size).toBe(500);
    for (const c of codes) expect(c).toMatch(/^BSTW-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    for (const s of ['bstw-abcd-efgh-jklm', ' BSTW ABCD EFGH JKLM ', 'bstwabcdefghjklm', 'BSTW-ABCD-EFGH-JKLM']) expect(normalizeCode(s)).toBe('BSTW-ABCD-EFGH-JKLM');
    expect(normalizeCode('nonsense')).toBe('NONSENSE');
  });
  test('redeem: happy path adds days and stacks; each failure has its own reason', async () => {
    const buyer = uid(), friend = uid(), T = 2_000_000_000_000;
    const g = await createGift(buyer, { days: 30, now: T });
    expect(await redeemGift(g.code, buyer, T)).toEqual({ ok: false, reason: 'own' });
    expect(await redeemGift('BSTW-AAAA-BBBB-CCCC', friend, T)).toEqual({ ok: false, reason: 'invalid' });
    expect(await redeemGift('garbage', friend, T)).toEqual({ ok: false, reason: 'invalid' });
    expect(await redeemGift(g.code.toLowerCase(), friend, T)).toEqual({ ok: true, days: 30, expiresAt: T + 30 * DAY });
    expect(await redeemGift(g.code, uid(), T)).toEqual({ ok: false, reason: 'used' });
    const g2 = await createGift(buyer, { days: 30, now: T }); const r2 = await redeemGift(g2.code, friend, T + 10 * DAY);
    expect(r2).toEqual({ ok: true, days: 30, expiresAt: T + 60 * DAY }); // stacked onto the time left
    expect((await listGifts(buyer)).map(x => !!x.redeemed_by)).toEqual([true, true]);
  });
  test('a code can never be redeemed twice, even by many people at once', async () => {
    const g = await createGift(uid());
    const people = Array.from({ length: 12 }, uid);
    const results = await Promise.all(people.map(p => redeemGift(g.code, p)));
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => !r.ok && r.reason === 'used')).toHaveLength(11);
    const winners = await db`SELECT redeemed_by FROM premium_gifts WHERE code = ${g.code}`;
    expect(people).toContain((winners as any[])[0].redeemed_by);
    let premiumCount = 0; for (const p of people) if ((await premiumStatus(p)).premium) premiumCount++; expect(premiumCount).toBe(1);
  });
  test('a running subscription (or an owner) does not burn a gift they can\'t use', async () => {
    Bun.env.PREMIUM_SKU_ID = SKU;
    const sub = uid(), g = await createGift(uid()); await setPremium(sub, 'entitlement', null);
    expect(await redeemGift(g.code, sub)).toEqual({ ok: false, reason: 'active' });
    expect((await listGifts(g.buyer_id))[0]!.redeemed_by).toBeNull(); // still redeemable by someone else
    expect((await redeemGift(g.code, uid())).ok).toBe(true);
  });
  test('one purchase can only ever mint one code', async () => {
    const buyer = uid();
    const a = await createGift(buyer, { entitlementId: 'ENT-1' }), b = await createGift(buyer, { entitlementId: 'ENT-1' });
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(b.code).toBe(a.code);
    expect((await listGifts(buyer)).length).toBe(1);
    // Six simultaneous deliveries of the same purchase (live event + startup sync + retries): exactly one code, and nobody errors.
    const results = await Promise.all(Array.from({ length: 6 }, () => createGift(buyer, { entitlementId: 'ENT-2' })));
    expect(results.filter(r => r.created)).toHaveLength(1);
    expect(new Set(results.map(r => r.code)).size).toBe(1);
    expect((await listGifts(buyer)).length).toBe(2); // ENT-1 + ENT-2
  });
  test('gift length follows PREMIUM_GIFT_DAYS', async () => {
    Bun.env.PREMIUM_GIFT_DAYS = '7'; expect((await createGift(uid())).days).toBe(7);
    Bun.env.PREMIUM_GIFT_DAYS = 'nope'; expect((await createGift(uid())).days).toBe(30);
  });
});

describe('entitlement events and sync', () => {
  test('subscription start grants, subscription end revokes — but never removes a separate grant or gift', async () => {
    Bun.env.PREMIUM_SKU_ID = SKU;
    const u = uid();
    expect(await applyEntitlement(ent(u, { endsTimestamp: Date.now() + DAY }))).toBe('premium');
    expect((await premiumStatus(u)).source).toBe('entitlement');
    expect(await applyEntitlement(ent(u, { active: false }))).toBe('ended');
    expect((await premiumStatus(u)).premium).toBe(false);
    const g = uid(); await extendPremium(g, 30, 'grant');
    expect(await applyEntitlement(ent(g, { active: false }))).toBe('ended');
    expect((await premiumStatus(g)).source).toBe('grant'); // the owner's grant survives the subscription ending
  });
  test('a gift purchase mints one code, consumes the purchase, DMs the buyer once — replays do nothing', async () => {
    Bun.env.PREMIUM_GIFT_SKU_ID = GIFT_SKU;
    const buyer = uid(), dms: string[] = [], dm = async (id: string, c: string) => { dms.push(`${id}:${c}`); };
    const e = ent(buyer, { skuId: GIFT_SKU, id: 'GIFT-ENT-1' });
    expect(await applyEntitlement(e, { dm })).toBe('gift');
    expect(e.calls.consumed).toBe(1); expect(dms).toHaveLength(1); expect(dms[0]).toMatch(/BSTW-/);
    const e2 = ent(buyer, { skuId: GIFT_SKU, id: 'GIFT-ENT-1' });
    expect(await applyEntitlement(e2, { dm })).toBe('gift-existing');
    expect(dms).toHaveLength(1); expect((await listGifts(buyer)).length).toBe(1);
    expect(await applyEntitlement(ent(buyer, { skuId: GIFT_SKU, consumed: true }), { dm })).toBe('ignored'); // already consumed
  });
  test('unknown SKUs and entitlements with no user are ignored', async () => {
    Bun.env.PREMIUM_SKU_ID = SKU;
    expect(await applyEntitlement(ent(uid(), { skuId: 'other' }))).toBe('ignored');
    expect(await applyEntitlement({ ...ent(uid()), userId: null })).toBe('ignored');
  });
  test('reconcile pages through Discord\'s list and honours purchases made while the bot was offline', async () => {
    Bun.env.PREMIUM_SKU_ID = SKU; Bun.env.PREMIUM_GIFT_SKU_ID = GIFT_SKU;
    const subs = Array.from({ length: 105 }, () => ent(uid())); const gift = ent(uid(), { skuId: GIFT_SKU });
    const all = [...subs, gift]; const pages: string[] = []; const dms: string[] = [];
    const client: any = {
      users: { fetch: async (id: string) => ({ send: async (c: string) => { dms.push(id); return c; } }) },
      application: { entitlements: { fetch: async (o: any) => { pages.push(o.after ?? 'first'); const start = o.after ? all.findIndex(x => x.id === o.after) + 1 : 0; const slice = all.slice(start, start + 100); return new Map(slice.map(x => [x.id, x])); } } },
    };
    const r = await reconcile(client);
    expect(r).toEqual({ premium: 105, gifts: 1 }); expect(pages).toHaveLength(2); expect(dms).toHaveLength(1);
    for (const s of subs.slice(0, 3)) expect((await premiumStatus(s.userId)).premium).toBe(true);
    const again = await reconcile(client); expect(again.gifts).toBe(0); // idempotent
  });
  test('with nothing configured, sync does nothing', async () => { expect(await reconcile({ application: {} } as any)).toEqual({ premium: 0, gifts: 0 }); });
});

describe('/premium commands', () => {
  const run = async (subs: Sub[], name: string, o: { userId?: string; options?: Record<string, string | number>; users?: any; ents?: any[] } = {}) => {
    const fi = fakeInteraction({ userId: o.userId ?? uid(), options: o.options, users: o.users });
    if (o.ents) (fi.interaction as any).entitlements = new Map(o.ents.map((e, i) => [String(i), e]));
    await find(subs, name).run(fi.interaction);
    return { text: textOf(fi.last()), payload: fi.last(), fi };
  };
  const buttons = (payload: any) => JSON.stringify(payload.components.map((c: any) => c.toJSON()));
  test('everything is private (ephemeral) and honest when premium isn\'t on sale', async () => {
    for (const [subs, name] of [[premiumSubs, 'perks'], [premiumSubs, 'buy'], [giftSubs, 'buy'], [giftSubs, 'inventory']] as [Sub[], string][]) {
      const r = await run(subs, name); expect(r.payload.flags & 64, `${name} ephemeral`).toBeTruthy();
    }
    expect((await run(premiumSubs, 'buy')).text).toContain('isn\'t on sale yet'); expect((await run(giftSubs, 'buy')).text).toContain('aren\'t on sale yet');
    expect((await run(premiumSubs, 'perks')).text).toContain('Unlimited AI'); expect((await run(premiumSubs, 'perks')).text).toContain('20');
  });
  test('when configured, the buy flow shows Discord\'s own Premium purchase button for the right SKU', async () => {
    Bun.env.PREMIUM_SKU_ID = SKU; Bun.env.PREMIUM_GIFT_SKU_ID = GIFT_SKU;
    const b = await run(premiumSubs, 'buy'); expect(buttons(b.payload)).toContain(SKU); expect(buttons(b.payload)).toContain('"style":6'); // ButtonStyle.Premium
    const g = await run(giftSubs, 'buy'); expect(buttons(g.payload)).toContain(GIFT_SKU); expect(g.text).toContain('30 days');
  });
  test('people who already have premium are told so instead of being sold it again', async () => {
    Bun.env.PREMIUM_SKU_ID = SKU; const u = uid(); await extendPremium(u, 30, 'grant');
    const r = await run(premiumSubs, 'buy', { userId: u }); expect(r.text).toContain('already have Premium'); expect(buttons(r.payload)).not.toContain(SKU);
    expect((await run(premiumSubs, 'perks', { userId: u })).text).toContain('You have Premium');
  });
  test('inventory shows only your codes; redeem gives premium with friendly failures', async () => {
    const buyer = uid(), friend = uid(); const g = await createGift(buyer);
    expect((await run(giftSubs, 'inventory', { userId: buyer })).text).toContain(g.code);
    expect((await run(giftSubs, 'inventory', { userId: friend })).text).toContain('haven\'t bought any');
    expect((await run(giftSubs, 'redeem', { userId: buyer, options: { code: g.code } })).text).toContain('gift you bought yourself');
    expect((await run(giftSubs, 'redeem', { userId: friend, options: { code: 'nope' } })).text).toContain('isn\'t valid');
    expect((await run(giftSubs, 'redeem', { userId: friend, options: { code: g.code.toLowerCase() } })).text).toContain('Premium unlocked');
    expect((await run(giftSubs, 'redeem', { userId: uid(), options: { code: g.code } })).text).toContain('already been redeemed');
    expect((await run(giftSubs, 'inventory', { userId: buyer })).text).toContain('redeemed');
    expect((await premiumStatus(friend)).premium).toBe(true);
  });
  test('grant/revoke are owner-only', async () => {
    const target = uid(), users = { user: { id: target, username: 'T' } };
    expect((await run(premiumSubs, 'grant', { options: { days: 5 }, users })).text).toContain('Only the bot owner');
    expect((await premiumStatus(target)).premium).toBe(false);
    Bun.env.OWNER_IDS = 'boss-1';
    expect((await run(premiumSubs, 'grant', { userId: 'boss-1', options: { days: 5 }, users })).text).toContain('Granted **5 days**');
    expect((await premiumStatus(target)).premium).toBe(true);
    expect((await run(premiumSubs, 'revoke', { userId: 'boss-1', users })).text).toContain('Removed Premium');
    expect((await run(premiumSubs, 'revoke', { userId: 'boss-1', users })).text).toContain('no Premium record');
    expect((await run(premiumSubs, 'revoke', { users })).text).toContain('Only the bot owner');
  });
  test('syncrole explains itself when there is no support server configured', async () => {
    const r = await run(premiumSubs, 'syncrole'); expect(r.text).toContain('no support-server Premium role');
  });
});

describe('privacy', () => {
  test('/privacy delete erases premium records and gift codes tied to the person', async () => {
    const u = uid(); await extendPremium(u, 30, 'grant'); const g = await createGift(u);
    await deleteData(u);
    expect(await db`SELECT 1 FROM premium_users WHERE user_id = ${u}`).toHaveLength(0);
    expect(await db`SELECT 1 FROM premium_gifts WHERE code = ${g.code}`).toHaveLength(0);
    expect(hasPremium).toBeTruthy();
  });
});
