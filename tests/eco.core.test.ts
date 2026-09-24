import { beforeAll, describe, expect, test } from 'bun:test';
import { db, initDb, adjustBalance, getOrCreateEconomy } from '../src/utils/db';
import {
  bankDeposit, bankSell, bankUpgrade, bankWithdraw, claimCooldown, getEco, getHistory, getWealthSeries,
  getWallet, leaderboard, moveCash, stake, payout, transferFromBank, BANK_START_CAP, TRANSFER_TAX,
} from '../src/eco/core';
import { BUSINESSES } from '../src/eco/catalog';

const G = 'g1';
let n = 0;
const uid = () => `u${++n}`;

async function fund(user: string, amount: number) {
  await getOrCreateEconomy(G, user);
  await adjustBalance(G, user, amount, 'test:fund');
}

beforeAll(async () => { await initDb(); });

describe('adjustBalance', () => {
  test('concurrent credits are never lost', async () => {
    const u = uid();
    await Promise.all(Array.from({ length: 50 }, () => adjustBalance(G, u, 10)));
    expect((await getEco(G, u)).balance).toBe(500);
  });

  test('concurrent debits can never overdraw', async () => {
    const u = uid();
    await fund(u, 100);
    const results = await Promise.all(Array.from({ length: 20 }, () => adjustBalance(G, u, -10)));
    expect(results.filter(r => r.success).length).toBe(10);
    expect((await getEco(G, u)).balance).toBe(0);
  });

  test('rejects an overdraw and leaves the balance alone', async () => {
    const u = uid();
    await fund(u, 50);
    const r = await adjustBalance(G, u, -51);
    expect(r.success).toBe(false);
    expect(r.newBalance).toBe(50);
  });

  test('rejects non-integers', async () => {
    const u = uid();
    await expect(adjustBalance(G, u, 1.5)).rejects.toThrow();
    await expect(adjustBalance(G, u, NaN)).rejects.toThrow();
  });

  test('every change is written to the ledger', async () => {
    const u = uid();
    await adjustBalance(G, u, 100, 'test:a');
    await adjustBalance(G, u, -30, 'test:b');
    const rows = await db`SELECT delta, balance_after, reason FROM eco_ledger WHERE user_id = ${u} ORDER BY id`;
    expect(rows.map((r: any) => [r.delta, r.balance_after, r.reason])).toEqual([[100, 100, 'test:a'], [-30, 70, 'test:b']]);
  });
});

describe('stakes', () => {
  test('only one of two simultaneous full-balance bets is accepted', async () => {
    const u = uid();
    await fund(u, 1000);
    const [a, b] = await Promise.all([stake(G, u, 1000, 'slots'), stake(G, u, 1000, 'blackjack')]);
    expect([a.success, b.success].filter(Boolean).length).toBe(1);
    expect((await getEco(G, u)).balance).toBe(0);
  });

  test('payout returns stake plus winnings', async () => {
    const u = uid();
    await fund(u, 500);
    await stake(G, u, 500, 'flip');
    const bal = await payout(G, u, 1000, 'flip');
    expect(bal).toBe(1000);
  });

  test('zero / negative / fractional stakes are refused', async () => {
    const u = uid();
    await fund(u, 100);
    expect((await stake(G, u, 0, 'x')).success).toBe(false);
    expect((await stake(G, u, -5, 'x')).success).toBe(false);
    expect((await stake(G, u, 2.5, 'x')).success).toBe(false);
    expect((await getEco(G, u)).balance).toBe(100);
  });
});

describe('claimCooldown', () => {
  test('exactly one of many simultaneous claims succeeds', async () => {
    const u = uid();
    const results = await Promise.all(Array.from({ length: 25 }, () => claimCooldown(u, 'daily', 60_000)));
    expect(results.filter(r => r.ok).length).toBe(1);
    const denied = results.find(r => !r.ok);
    expect(denied && !denied.ok && denied.remainingMs > 0 && denied.remainingMs <= 60_000).toBe(true);
  });

  test('a claim is available again after the cooldown', async () => {
    const u = uid();
    await claimCooldown(u, 'work', 10_000);
    await db`UPDATE economy_cooldowns SET last_used = ${Date.now() - 20_000} WHERE user_id = ${u} AND type = 'work'`;
    expect((await claimCooldown(u, 'work', 10_000)).ok).toBe(true);
  });

  test('different cooldown types are independent', async () => {
    const u = uid();
    expect((await claimCooldown(u, 'daily', 60_000)).ok).toBe(true);
    expect((await claimCooldown(u, 'weekly', 60_000)).ok).toBe(true);
  });
});

describe('bank', () => {
  test('deposit and withdraw move money between cash and bank', async () => {
    const u = uid();
    await fund(u, 1000);
    const d = await bankDeposit(G, u, 600);
    expect(d).toMatchObject({ ok: true, cash: 400, bank: 600 });
    const w = await bankWithdraw(G, u, 100);
    expect(w).toMatchObject({ ok: true, cash: 500, bank: 500 });
  });

  test('cannot deposit more than you hold or more than the cap', async () => {
    const u = uid();
    await fund(u, 10_000);
    expect(await bankDeposit(G, u, 20_000)).toMatchObject({ ok: false, reason: 'funds' });
    expect(await bankDeposit(G, u, BANK_START_CAP + 1)).toMatchObject({ ok: false, reason: 'space' });
    expect(await bankDeposit(G, u, BANK_START_CAP)).toMatchObject({ ok: true });
  });

  test('cannot withdraw more than is banked', async () => {
    const u = uid();
    await fund(u, 100);
    await bankDeposit(G, u, 50);
    expect(await bankWithdraw(G, u, 51)).toMatchObject({ ok: false, reason: 'funds' });
  });

  test('concurrent deposits never exceed cash or cap', async () => {
    const u = uid();
    await fund(u, 1000);
    await Promise.all(Array.from({ length: 30 }, () => bankDeposit(G, u, 100)));
    const e = await getEco(G, u);
    expect(e.balance + e.bank).toBe(1000);
    expect(e.bank).toBe(1000);
  });

  test('upgrade costs 1 per space; selling returns 10% and never drops below start cap or stored money', async () => {
    const u = uid();
    await fund(u, 10_000);
    expect(await bankUpgrade(G, u, 1000)).toMatchObject({ ok: true, cash: 9000, bankCap: BANK_START_CAP + 1000 });
    expect(await bankSell(G, u, 500)).toMatchObject({ ok: true, refund: 50, bankCap: BANK_START_CAP + 500 });
    expect(await bankSell(G, u, 600)).toMatchObject({ ok: false, reason: 'space' }); // would go below start cap
    await bankDeposit(G, u, BANK_START_CAP + 500);
    expect(await bankSell(G, u, 1)).toMatchObject({ ok: false, reason: 'space' }); // would drop below stored money
  });

  test('cannot upgrade without the cash', async () => {
    const u = uid();
    await fund(u, 10);
    expect(await bankUpgrade(G, u, 100)).toMatchObject({ ok: false, reason: 'funds' });
  });
});

describe('transfers', () => {
  test('bank → cash with 25% tax; total money drops by exactly the tax', async () => {
    const a = uid(), b = uid();
    await fund(a, 1000);
    await bankDeposit(G, a, 1000);
    const r = await transferFromBank(G, a, b, 400);
    expect(r).toEqual({ ok: true, sent: 400, tax: 100, received: 300 });
    expect((await getEco(G, a)).bank).toBe(600);
    expect((await getEco(G, b)).balance).toBe(300);
    expect(TRANSFER_TAX).toBe(0.25);
  });

  test('cannot send money you do not have banked (cash does not count)', async () => {
    const a = uid(), b = uid();
    await fund(a, 1000);
    expect(await transferFromBank(G, a, b, 100)).toEqual({ ok: false, reason: 'funds' });
  });

  test('concurrent transfers cannot overdraw the sender', async () => {
    const a = uid(), b = uid();
    await fund(a, 1000);
    await bankDeposit(G, a, 1000);
    const rs = await Promise.all(Array.from({ length: 10 }, () => transferFromBank(G, a, b, 300)));
    expect(rs.filter(r => r.ok).length).toBe(3);
    expect((await getEco(G, a)).bank).toBe(100);
    expect((await getEco(G, b)).balance).toBe(3 * 225);
  });

  test('self transfers and non-positive amounts are refused', async () => {
    const a = uid();
    await fund(a, 100);
    await bankDeposit(G, a, 100);
    expect(await transferFromBank(G, a, a, 10)).toEqual({ ok: false, reason: 'self' });
    expect(await transferFromBank(G, a, uid(), 0)).toEqual({ ok: false, reason: 'invalid' });
  });

  test('moveCash is all-or-nothing', async () => {
    const a = uid(), b = uid();
    await fund(a, 100);
    expect(await moveCash(G, a, b, 101, 'test')).toBe(false);
    expect((await getEco(G, a)).balance).toBe(100);
    expect((await getEco(G, b)).balance).toBe(0);
    expect(await moveCash(G, a, b, 60, 'test')).toBe(true);
    expect((await getEco(G, a)).balance).toBe(40);
    expect((await getEco(G, b)).balance).toBe(60);
  });

  test('concurrent robberies cannot take more than the victim holds', async () => {
    const victim = uid();
    await fund(victim, 1000);
    const thieves = Array.from({ length: 8 }, () => uid());
    await Promise.all(thieves.map(t => moveCash(G, victim, t, 300, 'rob')));
    const total = (await Promise.all(thieves.map(t => getEco(G, t)))).reduce((s, e) => s + e.balance, 0);
    expect((await getEco(G, victim)).balance + total).toBe(1000);
    expect((await getEco(G, victim)).balance).toBeGreaterThanOrEqual(0);
  });
});

describe('wallet, history, leaderboard', () => {
  test('net worth includes bank, business and lab', async () => {
    const u = uid();
    await fund(u, 1000);
    await bankDeposit(G, u, 400);
    await db`INSERT INTO eco_business (user_id, kind, bought_at, last_collected) VALUES (${u}, 'lemonade', 0, 0)`;
    await db`INSERT INTO eco_lab (user_id, level, ampoules, bought_at, last_collected, total_spent) VALUES (${u}, 1, 0, 0, 0, 25000)`;
    const w = await getWallet(G, u);
    expect(w.networth).toBe(600 + 400 + BUSINESSES.lemonade!.cost + 25_000);
    const lb = await leaderboard('networth', [u], 5);
    expect(lb[0]).toMatchObject({ user_id: u, value: w.networth });
  });

  test('leaderboard only includes the requested users', async () => {
    const a = uid(), b = uid();
    await fund(a, 5000); await fund(b, 9000);
    const lb = await leaderboard('cash', [a], 10);
    expect(lb.map(r => r.user_id)).toEqual([a]);
  });

  test('history shows newest first and hides internal bank echoes', async () => {
    const u = uid();
    await fund(u, 1000);
    await bankDeposit(G, u, 300);
    await adjustBalance(G, u, 50, 'work');
    const h = await getHistory(u, 10);
    expect(h[0]).toMatchObject({ reason: 'work', delta: 50 });
    expect(h.filter(e => e.reason.startsWith('bank:')).length).toBe(0);
    expect(h.some(e => e.where === 'bank' && e.reason === 'deposit' && e.delta === 300)).toBe(true);
  });

  test('wealth series ends at current total and is unaffected by deposits', async () => {
    const u = uid();
    await fund(u, 1000);
    await bankDeposit(G, u, 500);
    await adjustBalance(G, u, 200, 'work');
    const s = await getWealthSeries(G, u, 3);
    expect(s.length).toBe(3);
    expect(s[2]!.total).toBe(1200);
  });
});
