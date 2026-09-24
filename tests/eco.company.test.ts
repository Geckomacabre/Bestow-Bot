import { beforeAll, describe, expect, test } from 'bun:test';
import { db, initDb, adjustBalance, getOrCreateEconomy } from '../src/utils/db';
import { getEco } from '../src/eco/core';
import {
  cancelProject, changeRank, collectProject, companyLeaderboard, completeProject, contributeProject, createCompany, decideRequest,
  deleteCompany, getCompanyById, getMembership, getProject, inviteUser, joinCompany, kickMember, leaveCompany, listMembers,
  memberCap, setCeoLimit, setPrivacy, startProject, toggleRequest, transferOwnership, upgradeCompany, upgradeCost, validName,
  validTag, vaultBonus, vaultDeposit, vaultWithdraw, uninviteUser, renameCompany,
} from '../src/eco/company';
import { COMPANY, PROJECTS } from '../src/eco/catalog';

const G = 'g-co';
let n = 0;
const uid = () => `k${++n}`;
const tagN = () => `T${(++n).toString(36)}`.slice(0, 5).toUpperCase();

async function fund(u: string, amount: number) {
  await getOrCreateEconomy(G, u);
  await adjustBalance(G, u, amount, 'test:fund');
}
const cash = async (u: string) => (await getEco(G, u)).balance;

/** A company with a funded CEO. */
async function mk(opts: { privacy?: 'open' | 'request' | 'invite' } = {}) {
  const ceo = uid();
  await fund(ceo, COMPANY.createCost + 5_000_000);
  const tag = tagN();
  const r = await createCompany(G, ceo, tag, `Co ${tag}`);
  if (!r.ok) throw new Error(`setup failed: ${r.reason}`);
  if (opts.privacy) await setPrivacy(ceo, opts.privacy);
  return { ceo, id: r.company.id, tag, name: r.company.name };
}
async function joiner(name: string, money = 100_000) {
  const u = uid();
  await fund(u, money);
  const r = await joinCompany(u, name);
  if (!r.ok) throw new Error(`join failed: ${r.reason}`);
  return u;
}

beforeAll(async () => { await initDb(); });

describe('validation', () => {
  test('tags and names', () => {
    expect(validTag('AB')).toBe(true);
    expect(validTag('A')).toBe(false);
    expect(validTag('ABCDEF')).toBe(false);
    expect(validTag('A_B')).toBe(false);
    expect(validName('Acme Corp')).toBe(true);
    expect(validName('ab')).toBe(false);
    expect(validName('x'.repeat(25))).toBe(false);
    expect(validName(' bad')).toBe(false);
    expect(validName('<script>')).toBe(false);
  });
  test('member cap and upgrade cost scale with level', () => {
    expect(memberCap(1)).toBe(COMPANY.baseMembers);
    expect(memberCap(3)).toBe(COMPANY.baseMembers + 2 * COMPANY.membersPerLevel);
    expect(upgradeCost(2)).toBe(2 * upgradeCost(1));
  });
});

describe('create / delete', () => {
  test('creating charges the fee, makes the caller CEO, and blocks duplicates', async () => {
    const u = uid();
    await fund(u, COMPANY.createCost);
    const t = tagN();
    const r = await createCompany(G, u, t, `Acme ${t}`);
    expect(r.ok).toBe(true);
    expect(await cash(u)).toBe(0);
    expect((await getMembership(u))!.member.rank).toBe('ceo');

    const v = uid();
    await fund(v, COMPANY.createCost);
    expect(await createCompany(G, v, t, 'Another Name')).toMatchObject({ ok: false, reason: 'taken' });
    expect(await createCompany(G, v, 'ZZ9', `acme ${t.toLowerCase()}`)).toMatchObject({ ok: false, reason: 'taken' }); // case-insensitive
    expect(await cash(v)).toBe(COMPANY.createCost); // not charged
    expect(await createCompany(G, u, 'QQ1', 'Second Co')).toMatchObject({ ok: false, reason: 'member' });
  });

  test('cannot create without money; bad tag/name rejected before charging', async () => {
    const u = uid();
    await fund(u, 10);
    expect(await createCompany(G, u, 'OKAY', 'Poor Co')).toMatchObject({ ok: false, reason: 'funds' });
    expect(await createCompany(G, u, 'X', 'Poor Co')).toMatchObject({ ok: false, reason: 'tag' });
    expect(await createCompany(G, u, 'OKAY', '!')).toMatchObject({ ok: false, reason: 'name' });
  });

  test('concurrent creates with the same tag: exactly one wins, the loser is refunded', async () => {
    const users = [uid(), uid(), uid()];
    for (const u of users) await fund(u, COMPANY.createCost);
    const t = tagN();
    const rs = await Promise.all(users.map((u, i) => createCompany(G, u, t, `Race ${t} ${i}`)));
    expect(rs.filter(r => r.ok).length).toBe(1);
    for (let i = 0; i < users.length; i++) expect(await cash(users[i]!)).toBe(rs[i]!.ok ? 0 : COMPANY.createCost);
  });

  test('disbanding splits the vault equally, remainder to the CEO, and removes everything', async () => {
    const { ceo, id, name } = await mk({ privacy: 'open' });
    const a = await joiner(name), b = await joiner(name);
    await vaultDeposit(G, ceo, 1000);
    const before = [await cash(ceo), await cash(a), await cash(b)];
    const r = await deleteCompany(G, ceo);
    expect(r).toMatchObject({ ok: true, each: 333, members: 3 });
    expect(await cash(a)).toBe(before[1]! + 333);
    expect(await cash(b)).toBe(before[2]! + 333);
    expect(await cash(ceo)).toBe(before[0]! + 333 + 1); // remainder
    expect(await getCompanyById(id)).toBeNull();
    expect(await getMembership(a)).toBeNull();
  });

  test('only the CEO can disband', async () => {
    const { name } = await mk({ privacy: 'open' });
    const m = await joiner(name);
    expect(await deleteCompany(G, m)).toMatchObject({ ok: false, reason: 'perm' });
  });
});

describe('joining', () => {
  test('open companies can be joined; capacity is enforced', async () => {
    const { name } = await mk({ privacy: 'open' });
    for (let i = 0; i < COMPANY.baseMembers - 1; i++) await joiner(name);
    const late = uid();
    expect(await joinCompany(late, name)).toMatchObject({ ok: false, reason: 'full' });
  });

  test('request-only and invite-only companies refuse a direct join', async () => {
    const r = await mk({ privacy: 'request' });
    const i = await mk({ privacy: 'invite' });
    const u = uid();
    expect(await joinCompany(u, r.name)).toMatchObject({ ok: false, reason: 'request-only' });
    expect(await joinCompany(u, i.name)).toMatchObject({ ok: false, reason: 'invite-only' });
  });

  test('an invite lets the user join regardless of privacy, and can be withdrawn', async () => {
    const { ceo, name } = await mk({ privacy: 'invite' });
    const u = uid(), w = uid();
    expect((await inviteUser(ceo, u)).ok).toBe(true);
    expect((await inviteUser(ceo, w)).ok).toBe(true);
    expect((await uninviteUser(ceo, w)).ok).toBe(true);
    expect(await joinCompany(w, name)).toMatchObject({ ok: false, reason: 'invite-only' });
    expect((await joinCompany(u, name)).ok).toBe(true);
  });

  test('requests can be sent, cancelled, accepted and denied', async () => {
    const { ceo, name } = await mk({ privacy: 'request' });
    const a = uid(), b = uid();
    expect(await toggleRequest(a, name, 'hi')).toMatchObject({ ok: true, action: 'sent' });
    expect(await toggleRequest(a, name, 'hi')).toMatchObject({ ok: true, action: 'cancelled' });
    await toggleRequest(a, name, 'let me in');
    await toggleRequest(b, name, 'me too');
    expect((await decideRequest(ceo, a, true)).ok).toBe(true);
    expect((await getMembership(a))!.member.rank).toBe('member');
    expect((await decideRequest(ceo, b, false)).ok).toBe(true);
    expect(await getMembership(b)).toBeNull();
    expect(await decideRequest(ceo, b, true)).toMatchObject({ ok: false, reason: 'no-request' });
  });

  test('a user can only be in one company', async () => {
    const a = await mk({ privacy: 'open' });
    const b = await mk({ privacy: 'open' });
    const u = await joiner(a.name);
    expect(await joinCompany(u, b.name)).toMatchObject({ ok: false, reason: 'member' });
  });
});

describe('ranks & moderation', () => {
  test('uprank/downrank/kick follow the hierarchy', async () => {
    const { ceo, name } = await mk({ privacy: 'open' });
    const a = await joiner(name), b = await joiner(name);
    expect((await changeRank(ceo, a, 'up')).ok).toBe(true);
    expect(await changeRank(ceo, a, 'up')).toMatchObject({ ok: false, reason: 'already-top' });
    expect(await changeRank(a, b, 'up')).toMatchObject({ ok: false, reason: 'perm' });
    expect(await kickMember(a, ceo)).toMatchObject({ ok: false, reason: 'rank' });
    expect((await kickMember(a, b)).ok).toBe(true);
    expect(await getMembership(b)).toBeNull();
    expect(await changeRank(ceo, a, 'down')).toMatchObject({ ok: true, rank: 'member' });
    expect(await kickMember(a, ceo)).toMatchObject({ ok: false, reason: 'perm' });
  });

  test('the CEO cannot leave; members can; ownership transfers', async () => {
    const { ceo, name, id } = await mk({ privacy: 'open' });
    const a = await joiner(name);
    expect(await leaveCompany(ceo)).toMatchObject({ ok: false, reason: 'ceo' });
    expect((await transferOwnership(ceo, a)).ok).toBe(true);
    expect((await getMembership(a))!.member.rank).toBe('ceo');
    expect((await getMembership(ceo))!.member.rank).toBe('officer');
    expect((await getCompanyById(id))!.owner_id).toBe(a);
    expect((await leaveCompany(ceo)).ok).toBe(true);
  });

  test('rename respects uniqueness', async () => {
    const a = await mk(), b = await mk();
    expect(await renameCompany(a.ceo, b.name)).toMatchObject({ ok: false, reason: 'taken' });
    expect((await renameCompany(a.ceo, `Renamed ${a.tag}`)).ok).toBe(true);
  });
});

describe('vault', () => {
  test('deposits move cash into the vault; only the CEO can withdraw', async () => {
    const { ceo, name, id } = await mk({ privacy: 'open' });
    const m = await joiner(name, 5000);
    const r = await vaultDeposit(G, m, 2000);
    expect(r).toMatchObject({ ok: true, vault: 2000, cash: 3000 });
    expect(await vaultWithdraw(G, m, 100)).toMatchObject({ ok: false, reason: 'perm' });
    const before = await cash(ceo);
    expect(await vaultWithdraw(G, ceo, 500)).toMatchObject({ ok: true, vault: 1500 });
    expect(await cash(ceo)).toBe(before + 500);
    expect((await getCompanyById(id))!.vault).toBe(1500);
  });

  test('cannot deposit more than you hold or withdraw more than the vault', async () => {
    const { ceo } = await mk();
    await vaultDeposit(G, ceo, 100);
    expect(await vaultWithdraw(G, ceo, 101)).toMatchObject({ ok: false, reason: 'funds' });
    expect(await vaultDeposit(G, uid(), 5)).toMatchObject({ ok: false });
    const poor = await mk();
    await getOrCreateEconomy(G, poor.ceo);
    await db`UPDATE economy SET balance = 0 WHERE user_id = ${poor.ceo}`;
    expect(await vaultDeposit(G, poor.ceo, 50)).toMatchObject({ ok: false, reason: 'funds' });
  });

  test('concurrent withdrawals never overdraw the vault', async () => {
    const { ceo, id } = await mk();
    await vaultDeposit(G, ceo, 1000);
    const rs = await Promise.all(Array.from({ length: 10 }, () => vaultWithdraw(G, ceo, 300)));
    expect(rs.filter(r => r.ok).length).toBe(3);
    expect((await getCompanyById(id))!.vault).toBe(100);
  });

  test('the CEO daily limit caps withdrawals and bonuses combined', async () => {
    const { ceo, name } = await mk({ privacy: 'open' });
    const m = await joiner(name);
    await vaultDeposit(G, ceo, 10_000);
    await setCeoLimit(ceo, 1000);
    expect((await vaultWithdraw(G, ceo, 600)).ok).toBe(true);
    expect(await vaultBonus(G, ceo, m, 500)).toMatchObject({ ok: false, reason: 'limit', left: 400 });
    expect((await vaultBonus(G, ceo, m, 400)).ok).toBe(true);
    expect(await vaultWithdraw(G, ceo, 1)).toMatchObject({ ok: false, reason: 'limit', left: 0 });
    await setCeoLimit(ceo, null);
    expect((await vaultWithdraw(G, ceo, 1)).ok).toBe(true);
  });

  test('bonus must go to a member of the same company', async () => {
    const { ceo } = await mk();
    await vaultDeposit(G, ceo, 1000);
    expect(await vaultBonus(G, ceo, uid(), 10)).toMatchObject({ ok: false, reason: 'not-member' });
  });

  test('upgrade spends the vault and raises the member cap', async () => {
    const { ceo, id } = await mk();
    expect(await upgradeCompany(ceo)).toMatchObject({ ok: false, reason: 'funds' });
    await vaultDeposit(G, ceo, upgradeCost(1));
    expect(await upgradeCompany(ceo)).toMatchObject({ ok: true, level: 2, cap: memberCap(2) });
    expect((await getCompanyById(id))!.vault).toBe(0);
  });
});

describe('projects', () => {
  test('fund → wait → complete → everyone collects their share', async () => {
    const { ceo, name, id } = await mk({ privacy: 'open' });
    const a = await joiner(name, 1_000_000);
    expect((await startProject(G, ceo, 'warehouse')).ok).toBe(true);
    expect(await startProject(G, ceo, 'lab')).toMatchObject({ ok: false, reason: 'active' });

    const goal = PROJECTS.warehouse!.goal;
    expect((await contributeProject(G, ceo, goal * 0.6)).ok).toBe(true);
    const last = await contributeProject(G, a, goal); // over-contributing is capped at the remainder
    expect(last).toMatchObject({ ok: true, took: goal * 0.4, funded: true });
    expect((await getProject(id))!.status).toBe('active');

    expect(await completeProject(a)).toMatchObject({ ok: false, reason: 'pending' });
    await db`UPDATE eco_company_project SET ends_at = ${Date.now() - 1} WHERE company_id = ${id}`;
    const done = await completeProject(a);
    expect(done).toMatchObject({ ok: true, pool: Math.floor(goal * PROJECTS.warehouse!.yield) });

    const beforeA = await cash(a), beforeC = await cash(ceo);
    const ca = await collectProject(G, a);
    const cc = await collectProject(G, ceo);
    expect(ca).toMatchObject({ ok: true, took: Math.floor((Math.floor(goal * 1.3) * goal * 0.4) / goal) });
    expect(cc.ok).toBe(true);
    expect((await cash(a)) - beforeA).toBe(ca.ok ? ca.took : -1);
    expect((await cash(ceo)) - beforeC).toBe(cc.ok ? cc.took : -1);
    expect(await collectProject(G, a)).toMatchObject({ ok: false, reason: 'nothing' });
  });

  test('concurrent contributions never exceed the goal', async () => {
    const { ceo, name, id } = await mk({ privacy: 'open' });
    const users = [ceo];
    for (let i = 0; i < 4; i++) users.push(await joiner(name, 1_000_000));
    await startProject(G, ceo, 'warehouse');
    const goal = PROJECTS.warehouse!.goal;
    await Promise.all(users.map(u => contributeProject(G, u, goal)));
    const p = (await getProject(id))!;
    expect(p.raised).toBe(goal);
    expect(p.status).toBe('active');
  });

  test('cancelling a funding project refunds everyone', async () => {
    const { ceo, name } = await mk({ privacy: 'open' });
    const a = await joiner(name, 100_000);
    await startProject(G, ceo, 'warehouse');
    await contributeProject(G, a, 7000);
    const before = await cash(a);
    const r = await cancelProject(G, ceo);
    expect(r).toMatchObject({ ok: true, refunded: 7000, contributors: 1 });
    expect(await cash(a)).toBe(before + 7000);
    expect(await cancelProject(G, ceo)).toMatchObject({ ok: false, reason: 'no-project' });
  });

  test('only the CEO starts projects; unknown kinds refused', async () => {
    const { ceo, name } = await mk({ privacy: 'open' });
    const m = await joiner(name);
    expect(await startProject(G, m, 'warehouse')).toMatchObject({ ok: false, reason: 'perm' });
    expect(await startProject(G, ceo, 'nope')).toMatchObject({ ok: false, reason: 'unknown' });
  });

  test('every project yields a profit', () => {
    for (const [k, p] of Object.entries(PROJECTS)) expect(p.yield, k).toBeGreaterThan(1);
  });
});

describe('leaderboard', () => {
  test('ranks by vault and by member net worth', async () => {
    const a = await mk(), b = await mk();
    await vaultDeposit(G, a.ceo, 100);
    await vaultDeposit(G, b.ceo, 900_000);
    const byVault = await companyLeaderboard('vault', 100);
    expect(byVault.findIndex(r => r.id === b.id)).toBeLessThan(byVault.findIndex(r => r.id === a.id));
    const byWorth = await companyLeaderboard('networth', 100);
    expect(byWorth.some(r => r.id === a.id)).toBe(true);
    expect((await listMembers(a.id)).length).toBe(1);
  });
});
