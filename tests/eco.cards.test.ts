import { beforeAll, describe, expect, test } from 'bun:test';
import { db, initDb, adjustBalance, getOrCreateEconomy } from '../src/utils/db';
import { getEco } from '../src/eco/core';
import {
  buyCases, equipCard, executeCardSale, executeCardTrade, getCases, listCards, mergeCards, openCases, rollStars, shredCard,
  shredValue, unequipCategory,
} from '../src/eco/cards';
import { CARD_CATEGORIES, CASES, MERGE_COUNT } from '../src/eco/catalog';
import { bankCapMultiplier, careerMultiplier, guardBonus, robBonus, fortuneMultiplier } from '../src/eco/effects';

const G = 'g-cards';
let n = 0;
const uid = () => `c${++n}`;

async function fund(u: string, amount: number) {
  await getOrCreateEconomy(G, u);
  await adjustBalance(G, u, amount, 'test:fund');
}
async function giveCard(owner: string, category: string, stars: number, standard = 1): Promise<number> {
  const [r] = await db`INSERT INTO eco_card (owner_id, category, name, stars, standard, equipped, created_at) VALUES (${owner}, ${category}, 'Test', ${stars}, ${standard}, 0, 0) RETURNING id`;
  return r.id as number;
}

beforeAll(async () => { await initDb(); });

describe('case odds', () => {
  test('every case sums to 1', () => {
    for (const [k, c] of Object.entries(CASES)) expect(c.odds.reduce((a, b) => a + b, 0), k).toBeCloseTo(1, 6);
  });

  test('rollStars maps cumulative probability to stars', () => {
    const odds = [0.5, 0.3, 0.15, 0.04, 0.01];
    expect(rollStars(odds, 0)).toBe(1);
    expect(rollStars(odds, 0.49)).toBe(1);
    expect(rollStars(odds, 0.5)).toBe(2);
    expect(rollStars(odds, 0.85)).toBe(4 - 1); // 0.5+0.3+0.15=0.95 → 3★ until 0.95
    expect(rollStars(odds, 0.96)).toBe(4);
    expect(rollStars(odds, 0.9999)).toBe(5);
    expect(rollStars(odds, 1)).toBe(5);
  });

  test('a big sample of pulls roughly matches the odds', async () => {
    const u = uid();
    await fund(u, 10_000_000);
    await buyCases('g', u, 'basic', 1); // creates the row
    await db`UPDATE eco_case SET qty = 4000 WHERE user_id = ${u} AND case_type = 'basic'`;
    const r = await openCases(u, 'basic', 4000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ones = r.cards.filter(c => c.stars === 1).length / r.cards.length;
      expect(ones).toBeGreaterThan(0.64);
      expect(ones).toBeLessThan(0.76);
    }
  }, 30_000);
});

describe('cases & opening', () => {
  test('buying charges once, opening consumes cases and creates cards', async () => {
    const u = uid();
    await fund(u, 10_000);
    const b = await buyCases(G, u, 'basic', 3);
    expect(b).toMatchObject({ ok: true, cost: CASES.basic!.cost * 3 });
    expect((await getEco(G, u)).balance).toBe(10_000 - CASES.basic!.cost * 3);
    expect(await getCases(u)).toEqual({ basic: 3 });

    const o = await openCases(u, 'basic', 2);
    expect(o.ok && o.cards.length).toBe(2);
    expect(await getCases(u)).toEqual({ basic: 1 });
    expect((await listCards(u)).length).toBe(2);
  });

  test('cannot open cases you do not have, or open more than you own', async () => {
    const u = uid();
    await fund(u, 5_000);
    expect(await openCases(u, 'basic', 1)).toMatchObject({ ok: false, reason: 'none' });
    await buyCases(G, u, 'basic', 1);
    expect(await openCases(u, 'basic', 2)).toMatchObject({ ok: false, reason: 'none' });
  });

  test('concurrent opens cannot create cards from cases you do not have', async () => {
    const u = uid();
    await fund(u, 5_000);
    await buyCases(G, u, 'basic', 2);
    const rs = await Promise.all(Array.from({ length: 6 }, () => openCases(u, 'basic', 1)));
    expect(rs.filter(r => r.ok).length).toBe(2);
    expect((await listCards(u)).length).toBe(2);
  });

  test('category filter forces the category; unknown category is refused', async () => {
    const u = uid();
    await fund(u, 5_000);
    await buyCases(G, u, 'basic', 3);
    const r = await openCases(u, 'basic', 3, 'rogue');
    expect(r.ok && r.cards.every(c => c.category === 'rogue')).toBe(true);
    expect(await openCases(u, 'basic', 1, 'nope')).toMatchObject({ ok: false, reason: 'category' });
  });

  test('cannot buy without money', async () => {
    const u = uid();
    await fund(u, 10);
    expect(await buyCases(G, u, 'legendary', 1)).toMatchObject({ ok: false, reason: 'funds' });
    expect(await getCases(u)).toEqual({});
  });
});

describe('equip & effects', () => {
  test('one equipped card per category; effects use stars (holo doubles)', async () => {
    const u = uid();
    const a = await giveCard(u, 'career', 2);
    const b = await giveCard(u, 'career', 5, 0); // holo 5★ → weight 10
    await equipCard(u, a);
    expect(await careerMultiplier(u)).toBeCloseTo(1.04, 6);
    await equipCard(u, b);
    expect(await careerMultiplier(u)).toBeCloseTo(1.2, 6);
    const cards = await listCards(u, 'career');
    expect(cards.filter(c => c.equipped).length).toBe(1);
    expect(await unequipCategory(u, 'career')).toBe(true);
    expect(await careerMultiplier(u)).toBe(1);
  });

  test('each category feeds its own bonus', async () => {
    const u = uid();
    await equipCard(u, await giveCard(u, 'rogue', 3));
    await equipCard(u, await giveCard(u, 'guardian', 2));
    await equipCard(u, await giveCard(u, 'banker', 4));
    await equipCard(u, await giveCard(u, 'fortune', 5));
    expect(await robBonus(u)).toBeCloseTo(0.09, 6);
    expect(await guardBonus(u)).toBeCloseTo(0.06, 6);
    expect(await bankCapMultiplier(u)).toBeCloseTo(1.4, 6);
    expect(await fortuneMultiplier(u)).toBeCloseTo(1.05, 6);
  });

  test('cannot equip someone else\'s card', async () => {
    const a = uid(), b = uid();
    const id = await giveCard(a, 'career', 1);
    expect(await equipCard(b, id)).toMatchObject({ ok: false, reason: 'notyours' });
  });
});

describe('merge & shred', () => {
  test('10 same-star standard cards merge into one star higher', async () => {
    const u = uid();
    for (let i = 0; i < MERGE_COUNT; i++) await giveCard(u, 'banker', 2);
    await giveCard(u, 'banker', 2, 0); // holo must not count
    const r = await mergeCards(u, 'banker', 2);
    expect(r.ok && r.card.stars).toBe(3);
    const left = await listCards(u, 'banker');
    expect(left.length).toBe(2); // 1 holo + 1 merged
    expect(left.some(c => c.stars === 2 && c.standard === 0)).toBe(true);
  });

  test('not enough cards / max stars / bad category', async () => {
    const u = uid();
    for (let i = 0; i < MERGE_COUNT - 1; i++) await giveCard(u, 'banker', 1);
    expect(await mergeCards(u, 'banker', 1)).toMatchObject({ ok: false, reason: 'few' });
    expect(await mergeCards(u, 'banker', 5)).toMatchObject({ ok: false, reason: 'max' });
    expect(await mergeCards(u, 'zzz', 1)).toMatchObject({ ok: false, reason: 'category' });
  });

  test('concurrent merges cannot spend the same cards twice', async () => {
    const u = uid();
    for (let i = 0; i < MERGE_COUNT; i++) await giveCard(u, 'fortune', 1);
    const rs = await Promise.all(Array.from({ length: 4 }, () => mergeCards(u, 'fortune', 1)));
    expect(rs.filter(r => r.ok).length).toBe(1);
  });

  test('shred pays by star and holo, once', async () => {
    const u = uid();
    await fund(u, 0);
    const id = await giveCard(u, 'rogue', 3, 0);
    const [r1, r2] = await Promise.all([shredCard(G, u, id), shredCard(G, u, id)]);
    expect([r1.ok, r2.ok].filter(Boolean).length).toBe(1);
    expect((await getEco(G, u)).balance).toBe(shredValue({ stars: 3, standard: 0 }));
  });
});

describe('sales & trades', () => {
  test('sale moves the card and the money; the card comes out unequipped', async () => {
    const seller = uid(), buyer = uid();
    await fund(buyer, 1000);
    await fund(seller, 0);
    const id = await giveCard(seller, 'career', 4);
    await equipCard(seller, id);
    expect(await executeCardSale(seller, buyer, id, 400, G)).toEqual({ ok: true });
    expect((await listCards(buyer)).map(c => [c.id, c.equipped])).toEqual([[id, 0]]);
    expect((await getEco(G, seller)).balance).toBe(400);
    expect((await getEco(G, buyer)).balance).toBe(600);
  });

  test('a sale the buyer cannot afford is rolled back completely', async () => {
    const seller = uid(), buyer = uid();
    await fund(buyer, 10);
    const id = await giveCard(seller, 'career', 1);
    expect(await executeCardSale(seller, buyer, id, 400, G)).toEqual({ ok: false, reason: 'funds' });
    expect((await listCards(seller)).length).toBe(1);
    expect((await listCards(buyer)).length).toBe(0);
  });

  test('a card that is no longer the seller\'s cannot be sold', async () => {
    const seller = uid(), buyer = uid(), other = uid();
    await fund(buyer, 1000);
    const id = await giveCard(other, 'career', 1);
    expect(await executeCardSale(seller, buyer, id, 5, G)).toEqual({ ok: false, reason: 'gone' });
    expect((await getEco(G, buyer)).balance).toBe(1000);
  });

  test('trade swaps two cards; a stale side aborts and restores', async () => {
    const a = uid(), b = uid();
    const ca = await giveCard(a, 'rogue', 2);
    const cb = await giveCard(b, 'guardian', 3);
    expect(await executeCardTrade(a, ca, b, cb)).toEqual({ ok: true });
    expect((await listCards(a)).map(c => c.id)).toEqual([cb]);
    expect((await listCards(b)).map(c => c.id)).toEqual([ca]);

    const c1 = await giveCard(a, 'rogue', 1);
    expect(await executeCardTrade(a, c1, b, 999_999)).toEqual({ ok: false, reason: 'gone' });
    expect((await listCards(a)).map(c => c.id).sort()).toEqual([cb, c1].sort());
  });
});

describe('catalog', () => {
  test('every category has enough unique names', () => {
    for (const [k, c] of Object.entries(CARD_CATEGORIES)) {
      expect(new Set(c.names).size, k).toBe(c.names.length);
      expect(c.names.length, k).toBeGreaterThanOrEqual(8);
    }
  });
});
