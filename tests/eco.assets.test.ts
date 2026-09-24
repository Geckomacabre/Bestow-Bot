import { beforeAll, describe, expect, test } from 'bun:test';
import { db, initDb, adjustBalance, getOrCreateEconomy } from '../src/utils/db';
import { getEco } from '../src/eco/core';
import {
  businessPending, buyAmpoules, buyBusiness, buyLab, collectBusiness, collectLab, completeInvestment, completeQuest,
  getBusiness, getLab, labProducible, questLeaderboard, sellBusiness, sellLab, startInvestment, startQuest, stopQuest, upgradeLab,
} from '../src/eco/assets';
import { BUSINESSES, INVESTMENTS, LAB, QUEST_TIERS } from '../src/eco/catalog';

const G = 'g-assets';
let n = 0;
const uid = () => `a${++n}`;
const HOUR = 3_600_000;

async function fund(u: string, amount: number) {
  await getOrCreateEconomy(G, u);
  await adjustBalance(G, u, amount, 'test:fund');
}
const cash = async (u: string) => (await getEco(G, u)).balance;

beforeAll(async () => { await initDb(); });

describe('business', () => {
  test('buy charges the price once and refuses a second business', async () => {
    const u = uid();
    await fund(u, 10_000);
    const r = await buyBusiness(G, u, 'lemonade');
    expect(r.ok).toBe(true);
    expect(await cash(u)).toBe(10_000 - BUSINESSES.lemonade!.cost);
    expect(await buyBusiness(G, u, 'foodtruck')).toMatchObject({ ok: false, reason: 'owned' });
  });

  test('concurrent buys only ever create one business and charge once', async () => {
    const u = uid();
    await fund(u, 100_000);
    const rs = await Promise.all(Array.from({ length: 6 }, () => buyBusiness(G, u, 'lemonade')));
    expect(rs.filter(r => r.ok).length).toBe(1);
    expect(await cash(u)).toBe(100_000 - BUSINESSES.lemonade!.cost);
  });

  test('cannot buy without funds, or an unknown kind', async () => {
    const u = uid();
    await fund(u, 100);
    expect(await buyBusiness(G, u, 'lemonade')).toMatchObject({ ok: false, reason: 'funds' });
    expect(await buyBusiness(G, u, 'nope')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(await getBusiness(u)).toBeNull();
  });

  test('income accrues hourly and caps at 24h', () => {
    const per = BUSINESSES.arcade!.perHour;
    expect(businessPending('arcade', 0, HOUR * 2)).toBe(per * 2);
    expect(businessPending('arcade', 0, HOUR * 100)).toBe(per * 24);
    expect(businessPending('arcade', 5, 5)).toBe(0);
  });

  test('collect pays once even under concurrency', async () => {
    const u = uid();
    await fund(u, 5_000);
    await buyBusiness(G, u, 'lemonade');
    await db`UPDATE eco_business SET last_collected = ${Date.now() - 10 * HOUR} WHERE user_id = ${u}`;
    const before = await cash(u);
    const rs = await Promise.all(Array.from({ length: 5 }, () => collectBusiness(G, u)));
    expect(rs.filter(r => r.ok).length).toBe(1);
    const gained = (await cash(u)) - before;
    expect(gained).toBeGreaterThanOrEqual(BUSINESSES.lemonade!.perHour * 10 - 1);
    expect(gained).toBeLessThanOrEqual(BUSINESSES.lemonade!.perHour * 10 + 1);
  });

  test('sell refunds 50% of the price plus pending income', async () => {
    const u = uid();
    await fund(u, 5_000);
    await buyBusiness(G, u, 'lemonade');
    const before = await cash(u);
    const r = await sellBusiness(G, u);
    expect(r.ok).toBe(true);
    expect((await cash(u)) - before).toBeGreaterThanOrEqual(BUSINESSES.lemonade!.cost / 2);
    expect(await getBusiness(u)).toBeNull();
    expect(await sellBusiness(G, u)).toMatchObject({ ok: false });
  });
});

describe('lab', () => {
  test('buy, ampoules, collect and upgrade flow', async () => {
    const u = uid();
    await fund(u, 200_000);
    expect((await buyLab(G, u)).ok).toBe(true);
    expect(await buyLab(G, u)).toMatchObject({ ok: false, reason: 'owned' });

    const a = await buyAmpoules(G, u, 10);
    expect(a).toMatchObject({ ok: true, cost: 10 * LAB.ampoulePrice, ampoules: 10 });

    await db`UPDATE eco_lab SET last_collected = ${Date.now() - 4 * HOUR} WHERE user_id = ${u}`;
    const c = await collectLab(G, u);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.amount).toBeGreaterThanOrEqual(LAB.perHourPerLevel * 4 - 2);
      expect(c.used).toBe(4);
      expect(c.ampoulesLeft).toBe(6);
    }

    const up = await upgradeLab(G, u);
    expect(up).toMatchObject({ ok: true, level: 2, cost: LAB.upgradeCostPerLevel });
    expect((await getLab(u))!.total_spent).toBe(LAB.buyCost + LAB.upgradeCostPerLevel);
  });

  test('no ampoules → nothing to collect', async () => {
    const u = uid();
    await fund(u, 50_000);
    await buyLab(G, u);
    await db`UPDATE eco_lab SET last_collected = ${Date.now() - 5 * HOUR} WHERE user_id = ${u}`;
    expect(await collectLab(G, u)).toMatchObject({ ok: false, reason: 'no-ampoules' });
  });

  test('ampoule storage is limited by level', async () => {
    const u = uid();
    await fund(u, 100_000);
    await buyLab(G, u);
    expect(await buyAmpoules(G, u, LAB.ampoulesPerLevel + 1)).toMatchObject({ ok: false, reason: 'full' });
    expect((await buyAmpoules(G, u, LAB.ampoulesPerLevel)).ok).toBe(true);
  });

  test('production is bounded by ampoules and the accrual cap', () => {
    const now = 1_000 * HOUR;
    expect(labProducible({ ampoules: 3, last_collected: now - 10 * HOUR }, now)).toBe(3);
    expect(labProducible({ ampoules: 100, last_collected: now - 100 * HOUR }, now)).toBe(LAB.maxAccrualHours);
    expect(labProducible({ ampoules: 100, last_collected: now + 5 }, now)).toBe(0);
  });

  test('concurrent collects pay once', async () => {
    const u = uid();
    await fund(u, 50_000);
    await buyLab(G, u);
    await buyAmpoules(G, u, 10);
    await db`UPDATE eco_lab SET last_collected = ${Date.now() - 3 * HOUR} WHERE user_id = ${u}`;
    const rs = await Promise.all(Array.from({ length: 5 }, () => collectLab(G, u)));
    expect(rs.filter(r => r.ok).length).toBe(1);
  });

  test('sell refunds half of everything invested', async () => {
    const u = uid();
    await fund(u, 200_000);
    await buyLab(G, u);
    await upgradeLab(G, u);
    const before = await cash(u);
    const r = await sellLab(G, u);
    expect(r).toMatchObject({ ok: true, refund: Math.floor((LAB.buyCost + LAB.upgradeCostPerLevel) * LAB.sellRefund) });
    expect((await cash(u)) - before).toBe(Math.floor((LAB.buyCost + LAB.upgradeCostPerLevel) * LAB.sellRefund));
  });
});

describe('investments', () => {
  test('start locks the cost; one active at a time', async () => {
    const u = uid();
    await fund(u, 20_000);
    const r = await startInvestment(G, u, 'index');
    expect(r.ok).toBe(true);
    expect(await cash(u)).toBe(20_000 - INVESTMENTS.index!.cost);
    expect(await startInvestment(G, u, 'bond')).toMatchObject({ ok: false, reason: 'active' });
  });

  test('cannot complete before it matures', async () => {
    const u = uid();
    await fund(u, 20_000);
    await startInvestment(G, u, 'bond');
    expect(await completeInvestment(G, u)).toMatchObject({ ok: false, reason: 'pending' });
  });

  test('success pays cost × win; failure pays cost × lose', async () => {
    const u = uid();
    await fund(u, 20_000);
    await startInvestment(G, u, 'index');
    await db`UPDATE eco_investment SET ends_at = ${Date.now() - 1} WHERE user_id = ${u}`;
    const win = await completeInvestment(G, u, () => 0);          // 0 < chance → success
    expect(win).toMatchObject({ ok: true, success: true, payout: Math.floor(INVESTMENTS.index!.cost * INVESTMENTS.index!.win) });

    await startInvestment(G, u, 'crypto');
    await db`UPDATE eco_investment SET ends_at = ${Date.now() - 1} WHERE user_id = ${u}`;
    const lose = await completeInvestment(G, u, () => 0.999);      // ≥ chance → failure
    expect(lose).toMatchObject({ ok: true, success: false, payout: 0 });
  });

  test('completing twice only pays once', async () => {
    const u = uid();
    await fund(u, 20_000);
    await startInvestment(G, u, 'bond');
    await db`UPDATE eco_investment SET ends_at = ${Date.now() - 1} WHERE user_id = ${u}`;
    const rs = await Promise.all(Array.from({ length: 4 }, () => completeInvestment(G, u, () => 0)));
    expect(rs.filter(r => r.ok).length).toBe(1);
  });

  test('every investment has sane odds (EV between 1x and 3x, chance in (0,1])', () => {
    for (const [k, d] of Object.entries(INVESTMENTS)) {
      const ev = d.chance * d.win + (1 - d.chance) * d.lose;
      expect(d.chance, k).toBeGreaterThan(0);
      expect(d.chance, k).toBeLessThanOrEqual(1);
      expect(ev, k).toBeGreaterThan(1);
      expect(ev, k).toBeLessThan(3);
    }
  });
});

describe('quests', () => {
  test('start → wait → complete pays the rolled reward and records stats', async () => {
    const u = uid();
    await fund(u, 1);
    const s = await startQuest(u, 'easy');
    expect(s.ok).toBe(true);
    expect(await startQuest(u, 'hard')).toMatchObject({ ok: false, reason: 'active' });
    expect(await completeQuest(G, u)).toMatchObject({ ok: false, reason: 'pending' });

    await db`UPDATE eco_quest SET ends_at = ${Date.now() - 1} WHERE user_id = ${u}`;
    const c = await completeQuest(G, u);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.reward).toBeGreaterThanOrEqual(QUEST_TIERS.easy!.min);
      expect(c.reward).toBeLessThanOrEqual(QUEST_TIERS.easy!.max);
    }
    const lb = await questLeaderboard([u], 5);
    expect(lb[0]).toMatchObject({ user_id: u, completed: 1 });
  });

  test('concurrent completes pay once; stop cancels without reward', async () => {
    const u = uid();
    await startQuest(u, 'easy');
    await db`UPDATE eco_quest SET ends_at = ${Date.now() - 1} WHERE user_id = ${u}`;
    const rs = await Promise.all(Array.from({ length: 5 }, () => completeQuest(G, u)));
    expect(rs.filter(r => r.ok).length).toBe(1);

    const v = uid();
    await startQuest(v, 'medium');
    expect(await stopQuest(v)).toBe(true);
    expect(await stopQuest(v)).toBe(false);
    expect(await completeQuest(G, v)).toMatchObject({ ok: false, reason: 'none' });
  });

  test('unknown difficulty is refused', async () => {
    expect(await startQuest(uid(), 'nightmare')).toMatchObject({ ok: false, reason: 'unknown' });
  });
});

describe('catalog balance sanity', () => {
  test('every business pays back its price within 3 days of accrual', () => {
    for (const [k, b] of Object.entries(BUSINESSES)) {
      expect(b.cost / b.perHour, k).toBeLessThan(72);
      expect(b.cost / b.perHour, k).toBeGreaterThan(10);
    }
  });
});
