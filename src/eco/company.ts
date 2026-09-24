import { db, adjustBalance } from '../utils/db.js';
import { withLock } from '../framework/mutex.js';
import { COMPANY, PROJECTS } from './catalog.js';

export type Rank = 'member' | 'officer' | 'ceo';
export type Privacy = 'open' | 'request' | 'invite';

export interface Company {
  id: number; tag: string; name: string; owner_id: string; description: string; icon: string | null;
  privacy: Privacy; level: number; vault: number; created_at: number;
}
export interface Member { user_id: string; company_id: number; rank: Rank; joined_at: number; withdrawn_today: number; withdraw_day: string | null }

const RANK_ORDER: Record<Rank, number> = { member: 0, officer: 1, ceo: 2 };
export const rankIcon = (r: Rank) => (r === 'ceo' ? '👑' : r === 'officer' ? '⭐' : '👤');
export const memberCap = (level: number) => COMPANY.baseMembers + COMPANY.membersPerLevel * (level - 1);
export const upgradeCost = (level: number) => COMPANY.upgradeBase * 2 ** (level - 1);
const today = () => new Date().toISOString().slice(0, 10);
const coLock = (id: number) => `co:${id}`;

export const TAG_RE = /^[A-Za-z0-9]{2,5}$/;
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '&.\-]{1,22}[A-Za-z0-9.]$/;
export function validTag(t: string) { return TAG_RE.test(t); }
export function validName(n: string) { return NAME_RE.test(n) && n.length >= COMPANY.nameMin && n.length <= COMPANY.nameMax; }

type Fail<R extends string> = { ok: false; reason: R };
const fail = <R extends string>(reason: R): Fail<R> => ({ ok: false, reason });

// ─── Lookups ─────────────────────────────────────────────────────────────────

export async function getCompanyById(id: number): Promise<Company | null> {
  const [r] = await db`SELECT * FROM eco_company WHERE id = ${id}`;
  return (r as Company) ?? null;
}

export async function findCompany(nameOrTag: string): Promise<Company | null> {
  const [r] = await db`SELECT * FROM eco_company WHERE name = ${nameOrTag.trim()} COLLATE NOCASE OR tag = ${nameOrTag.trim()} COLLATE NOCASE LIMIT 1`;
  return (r as Company) ?? null;
}

export async function getMembership(userId: string): Promise<{ company: Company; member: Member } | null> {
  const [m] = await db`SELECT * FROM eco_company_member WHERE user_id = ${userId}`;
  if (!m) return null;
  const company = await getCompanyById((m as Member).company_id);
  return company ? { company, member: m as Member } : null;
}

export async function listMembers(companyId: number): Promise<Member[]> {
  return (await db`SELECT * FROM eco_company_member WHERE company_id = ${companyId}
    ORDER BY CASE rank WHEN 'ceo' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, joined_at ASC`) as Member[];
}

async function memberCount(companyId: number): Promise<number> {
  const [r] = await db`SELECT COUNT(*) AS n FROM eco_company_member WHERE company_id = ${companyId}`;
  return Number(r?.n ?? 0);
}

async function log(companyId: number, userId: string | null, action: string, amount = 0) {
  await db`INSERT INTO eco_company_log (company_id, user_id, action, amount, ts) VALUES (${companyId}, ${userId}, ${action}, ${amount}, ${Date.now()})`;
}

export async function companyLogs(companyId: number, limit = 15) {
  return (await db`SELECT user_id, action, amount, ts FROM eco_company_log WHERE company_id = ${companyId} ORDER BY id DESC LIMIT ${limit}`) as
    { user_id: string | null; action: string; amount: number; ts: number }[];
}

// ─── Create / delete / join / leave ──────────────────────────────────────────

export async function createCompany(guildId: string, ownerId: string, tag: string, name: string) {
  if (!validTag(tag)) return fail('tag');
  if (!validName(name)) return fail('name');
  return withLock(`eco:${ownerId}`, async () => {
    if (await getMembership(ownerId)) return fail('member');
    if (await findCompany(tag) || await findCompany(name)) return fail('taken');
    const paid = await adjustBalance(guildId, ownerId, -COMPANY.createCost, 'company:create');
    if (!paid.success) return { ok: false as const, reason: 'funds' as const, cash: paid.newBalance };
    try {
      const now = Date.now();
      const [c] = await db`INSERT INTO eco_company (tag, name, owner_id, created_at) VALUES (${tag}, ${name}, ${ownerId}, ${now}) RETURNING *`;
      await db`INSERT INTO eco_company_member (user_id, company_id, rank, joined_at) VALUES (${ownerId}, ${(c as Company).id}, 'ceo', ${now})`;
      await log((c as Company).id, ownerId, 'created');
      return { ok: true as const, company: c as Company, cash: paid.newBalance };
    } catch {
      await adjustBalance(guildId, ownerId, COMPANY.createCost, 'company:create:refund');
      return fail('taken');
    }
  });
}

/** Disband: the vault is split equally between all members (remainder to the CEO). */
export async function deleteCompany(guildId: string, ceoId: string) {
  const ms = await getMembership(ceoId);
  if (!ms) return fail('none');
  if (ms.member.rank !== 'ceo') return fail('perm');
  return withLock(coLock(ms.company.id), async () => {
    const co = await getCompanyById(ms.company.id);
    if (!co) return fail('none');
    const members = await listMembers(co.id);
    const each = Math.floor(co.vault / members.length);
    const remainder = co.vault - each * members.length;
    const gone = await db`DELETE FROM eco_company WHERE id = ${co.id} RETURNING id`;
    if (!gone.length) return fail('none');
    await db`DELETE FROM eco_company_member WHERE company_id = ${co.id}`;
    for (const t of ['eco_company_invite', 'eco_company_request', 'eco_company_project', 'eco_company_contrib', 'eco_company_log', 'eco_company_setting']) {
      await db.unsafe(`DELETE FROM ${t} WHERE company_id = ?`, [co.id]);
    }
    for (const m of members) {
      const share = each + (m.user_id === ceoId ? remainder : 0);
      if (share > 0) await adjustBalance(guildId, m.user_id, share, 'company:disband');
    }
    return { ok: true as const, company: co, each, members: members.length };
  });
}

export async function joinCompany(userId: string, nameOrTag: string) {
  return withLock(`eco:${userId}`, async () => {
    if (await getMembership(userId)) return fail('member');
    const co = await findCompany(nameOrTag);
    if (!co) return fail('unknown');
    return withLock(coLock(co.id), async () => {
      const [inv] = await db`SELECT 1 AS x FROM eco_company_invite WHERE company_id = ${co.id} AND user_id = ${userId}`;
      if (co.privacy !== 'open' && !inv) return { ok: false as const, reason: co.privacy === 'request' ? ('request-only' as const) : ('invite-only' as const) };
      if ((await memberCount(co.id)) >= memberCap(co.level)) return fail('full');
      await db`INSERT INTO eco_company_member (user_id, company_id, rank, joined_at) VALUES (${userId}, ${co.id}, 'member', ${Date.now()})`;
      await db`DELETE FROM eco_company_invite WHERE user_id = ${userId}`;
      await db`DELETE FROM eco_company_request WHERE user_id = ${userId}`;
      await log(co.id, userId, 'joined');
      return { ok: true as const, company: co };
    });
  });
}

export async function leaveCompany(userId: string) {
  const ms = await getMembership(userId);
  if (!ms) return fail('none');
  if (ms.member.rank === 'ceo') return fail('ceo');
  await db`DELETE FROM eco_company_member WHERE user_id = ${userId}`;
  await log(ms.company.id, userId, 'left');
  return { ok: true as const, company: ms.company };
}

export async function kickMember(actorId: string, targetId: string) {
  const a = await getMembership(actorId);
  if (!a) return fail('none');
  if (RANK_ORDER[a.member.rank] < RANK_ORDER.officer) return fail('perm');
  const [t] = await db`SELECT * FROM eco_company_member WHERE user_id = ${targetId} AND company_id = ${a.company.id}`;
  if (!t) return fail('not-member');
  if (actorId === targetId) return fail('self');
  if (RANK_ORDER[(t as Member).rank] >= RANK_ORDER[a.member.rank]) return fail('rank');
  await db`DELETE FROM eco_company_member WHERE user_id = ${targetId}`;
  await log(a.company.id, actorId, `kicked:${targetId}`);
  return { ok: true as const, company: a.company };
}

export async function changeRank(actorId: string, targetId: string, dir: 'up' | 'down') {
  const a = await getMembership(actorId);
  if (!a) return fail('none');
  if (a.member.rank !== 'ceo') return fail('perm');
  const [t] = await db`SELECT * FROM eco_company_member WHERE user_id = ${targetId} AND company_id = ${a.company.id}`;
  if (!t) return fail('not-member');
  const cur = (t as Member).rank;
  if (cur === 'ceo') return fail('self');
  const next: Rank = dir === 'up' ? 'officer' : 'member';
  if (cur === next) return fail(dir === 'up' ? 'already-top' : 'already-bottom');
  await db`UPDATE eco_company_member SET rank = ${next} WHERE user_id = ${targetId}`;
  await log(a.company.id, actorId, `${dir}rank:${targetId}`);
  return { ok: true as const, rank: next, company: a.company };
}

export async function transferOwnership(actorId: string, targetId: string) {
  const a = await getMembership(actorId);
  if (!a) return fail('none');
  if (a.member.rank !== 'ceo') return fail('perm');
  if (actorId === targetId) return fail('self');
  const [t] = await db`SELECT * FROM eco_company_member WHERE user_id = ${targetId} AND company_id = ${a.company.id}`;
  if (!t) return fail('not-member');
  await db`UPDATE eco_company_member SET rank = 'ceo' WHERE user_id = ${targetId}`;
  await db`UPDATE eco_company_member SET rank = 'officer' WHERE user_id = ${actorId}`;
  await db`UPDATE eco_company SET owner_id = ${targetId} WHERE id = ${a.company.id}`;
  await log(a.company.id, actorId, `transferred:${targetId}`);
  return { ok: true as const, company: a.company };
}

// ─── Invites & requests ──────────────────────────────────────────────────────

export async function inviteUser(actorId: string, targetId: string) {
  const a = await getMembership(actorId);
  if (!a) return fail('none');
  if (RANK_ORDER[a.member.rank] < RANK_ORDER.officer) return fail('perm');
  if (await getMembership(targetId)) return fail('in-company');
  if ((await memberCount(a.company.id)) >= memberCap(a.company.level)) return fail('full');
  await db`INSERT INTO eco_company_invite (company_id, user_id, created_at) VALUES (${a.company.id}, ${targetId}, ${Date.now()}) ON CONFLICT DO NOTHING`;
  return { ok: true as const, company: a.company };
}

export async function uninviteUser(actorId: string, targetId: string) {
  const a = await getMembership(actorId);
  if (!a) return fail('none');
  if (RANK_ORDER[a.member.rank] < RANK_ORDER.officer) return fail('perm');
  const gone = await db`DELETE FROM eco_company_invite WHERE company_id = ${a.company.id} AND user_id = ${targetId} RETURNING user_id`;
  return gone.length ? { ok: true as const } : fail('no-invite');
}

/** Sends a join request — or cancels it if one is already pending. */
export async function toggleRequest(userId: string, nameOrTag: string, text: string) {
  if (await getMembership(userId)) return fail('member');
  const co = await findCompany(nameOrTag);
  if (!co) return fail('unknown');
  const gone = await db`DELETE FROM eco_company_request WHERE company_id = ${co.id} AND user_id = ${userId} RETURNING user_id`;
  if (gone.length) return { ok: true as const, action: 'cancelled' as const, company: co };
  await db`INSERT INTO eco_company_request (company_id, user_id, text, created_at) VALUES (${co.id}, ${userId}, ${text.slice(0, 200)}, ${Date.now()})`;
  return { ok: true as const, action: 'sent' as const, company: co };
}

export async function listRequests(actorId: string) {
  const a = await getMembership(actorId);
  if (!a) return fail('none');
  if (RANK_ORDER[a.member.rank] < RANK_ORDER.officer) return fail('perm');
  const rows = await db`SELECT user_id, text, created_at FROM eco_company_request WHERE company_id = ${a.company.id} ORDER BY created_at ASC`;
  return { ok: true as const, requests: rows as { user_id: string; text: string; created_at: number }[], company: a.company };
}

export async function decideRequest(actorId: string, targetId: string, accept: boolean) {
  const a = await getMembership(actorId);
  if (!a) return fail('none');
  if (RANK_ORDER[a.member.rank] < RANK_ORDER.officer) return fail('perm');
  return withLock(coLock(a.company.id), async () => {
    const gone = await db`DELETE FROM eco_company_request WHERE company_id = ${a.company.id} AND user_id = ${targetId} RETURNING user_id`;
    if (!gone.length) return fail('no-request');
    if (!accept) return { ok: true as const, company: a.company };
    if (await getMembership(targetId)) return fail('in-company');
    if ((await memberCount(a.company.id)) >= memberCap(a.company.level)) return fail('full');
    await db`INSERT INTO eco_company_member (user_id, company_id, rank, joined_at) VALUES (${targetId}, ${a.company.id}, 'member', ${Date.now()})`;
    await db`DELETE FROM eco_company_request WHERE user_id = ${targetId}`;
    await db`DELETE FROM eco_company_invite WHERE user_id = ${targetId}`;
    await log(a.company.id, targetId, 'joined');
    return { ok: true as const, company: a.company };
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function ceoOf(userId: string) {
  const ms = await getMembership(userId);
  if (!ms) return fail('none');
  if (ms.member.rank !== 'ceo') return fail('perm');
  return { ok: true as const, ...ms };
}

export async function setPrivacy(userId: string, privacy: Privacy) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  await db`UPDATE eco_company SET privacy = ${privacy} WHERE id = ${c.company.id}`;
  return { ok: true as const };
}

export async function setDescription(userId: string, description: string) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  await db`UPDATE eco_company SET description = ${description.slice(0, COMPANY.descMax)} WHERE id = ${c.company.id}`;
  return { ok: true as const };
}

export async function renameCompany(userId: string, name: string) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  if (!validName(name)) return fail('name');
  const other = await findCompany(name);
  if (other && other.id !== c.company.id) return fail('taken');
  await db`UPDATE eco_company SET name = ${name} WHERE id = ${c.company.id}`;
  return { ok: true as const };
}

export async function retagCompany(userId: string, tag: string) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  if (!validTag(tag)) return fail('tag');
  const other = await findCompany(tag);
  if (other && other.id !== c.company.id) return fail('taken');
  await db`UPDATE eco_company SET tag = ${tag} WHERE id = ${c.company.id}`;
  return { ok: true as const };
}

export async function setIcon(userId: string, hasIcon: boolean) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  await db`UPDATE eco_company SET icon = ${hasIcon ? 'file' : null} WHERE id = ${c.company.id}`;
  return { ok: true as const, company: c.company };
}

export async function upgradeCompany(userId: string) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  return withLock(coLock(c.company.id), async () => {
    const co = (await getCompanyById(c.company.id))!;
    if (co.level >= COMPANY.maxLevel) return fail('max');
    const cost = upgradeCost(co.level);
    const rows = await db`UPDATE eco_company SET vault = vault - ${cost}, level = level + 1 WHERE id = ${co.id} AND vault >= ${cost} AND level = ${co.level} RETURNING level, vault`;
    if (!rows.length) return { ok: false as const, reason: 'funds' as const, cost, vault: co.vault };
    await log(co.id, userId, 'upgrade', cost);
    return { ok: true as const, level: rows[0].level as number, cost, cap: memberCap(rows[0].level as number) };
  });
}

// ─── Vault ───────────────────────────────────────────────────────────────────

export async function vaultDeposit(guildId: string, userId: string, amount: number) {
  const ms = await getMembership(userId);
  if (!ms) return fail('none');
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail('invalid');
  return withLock(coLock(ms.company.id), async () => {
    const paid = await adjustBalance(guildId, userId, -amount, 'company:deposit');
    if (!paid.success) return { ok: false as const, reason: 'funds' as const, cash: paid.newBalance };
    const [row] = await db`UPDATE eco_company SET vault = vault + ${amount} WHERE id = ${ms.company.id} RETURNING vault`;
    await log(ms.company.id, userId, 'deposit', amount);
    return { ok: true as const, vault: row.vault as number, cash: paid.newBalance };
  });
}

export async function setCeoLimit(userId: string, limit: number | null) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  await db`INSERT INTO eco_company_setting (company_id, ceo_daily_limit) VALUES (${c.company.id}, ${limit}) ON CONFLICT(company_id) DO UPDATE SET ceo_daily_limit = ${limit}`;
  return { ok: true as const };
}

async function spendLimit(companyId: number, member: Member, amount: number): Promise<{ ok: true } | { ok: false; left: number; limit: number }> {
  const [s] = await db`SELECT ceo_daily_limit FROM eco_company_setting WHERE company_id = ${companyId}`;
  const limit = s?.ceo_daily_limit as number | null | undefined;
  if (limit == null) return { ok: true };
  const used = member.withdraw_day === today() ? member.withdrawn_today : 0;
  if (used + amount > limit) return { ok: false, left: Math.max(0, limit - used), limit };
  return { ok: true };
}

async function recordSpend(member: Member, amount: number) {
  const used = member.withdraw_day === today() ? member.withdrawn_today : 0;
  await db`UPDATE eco_company_member SET withdrawn_today = ${used + amount}, withdraw_day = ${today()} WHERE user_id = ${member.user_id}`;
}

export async function vaultWithdraw(guildId: string, userId: string, amount: number) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail('invalid');
  return withLock(coLock(c.company.id), async () => {
    const lim = await spendLimit(c.company.id, c.member, amount);
    if (!lim.ok) return { ok: false as const, reason: 'limit' as const, left: lim.left, limit: lim.limit };
    const rows = await db`UPDATE eco_company SET vault = vault - ${amount} WHERE id = ${c.company.id} AND vault >= ${amount} RETURNING vault`;
    if (!rows.length) return { ok: false as const, reason: 'funds' as const };
    const { newBalance } = await adjustBalance(guildId, userId, amount, 'company:withdraw');
    await recordSpend(c.member, amount);
    await log(c.company.id, userId, 'withdraw', amount);
    return { ok: true as const, vault: rows[0].vault as number, cash: newBalance };
  });
}

export async function vaultBonus(guildId: string, userId: string, targetId: string, amount: number) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail('invalid');
  const [t] = await db`SELECT 1 AS x FROM eco_company_member WHERE user_id = ${targetId} AND company_id = ${c.company.id}`;
  if (!t) return fail('not-member');
  return withLock(coLock(c.company.id), async () => {
    const lim = await spendLimit(c.company.id, c.member, amount);
    if (!lim.ok) return { ok: false as const, reason: 'limit' as const, left: lim.left, limit: lim.limit };
    const rows = await db`UPDATE eco_company SET vault = vault - ${amount} WHERE id = ${c.company.id} AND vault >= ${amount} RETURNING vault`;
    if (!rows.length) return { ok: false as const, reason: 'funds' as const };
    await adjustBalance(guildId, targetId, amount, 'company:bonus');
    await recordSpend(c.member, amount);
    await log(c.company.id, userId, `bonus:${targetId}`, amount);
    return { ok: true as const, vault: rows[0].vault as number };
  });
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface Project { company_id: number; kind: string; goal: number; raised: number; status: 'funding' | 'active' | 'done'; started_at: number; ends_at: number | null; pool: number }

export async function getProject(companyId: number): Promise<Project | null> {
  const [r] = await db`SELECT * FROM eco_company_project WHERE company_id = ${companyId}`;
  return (r as Project) ?? null;
}

export async function projectContribs(companyId: number) {
  return (await db`SELECT user_id, amount, collected FROM eco_company_contrib WHERE company_id = ${companyId} ORDER BY amount DESC`) as { user_id: string; amount: number; collected: number }[];
}

export async function startProject(guildId: string, userId: string, kind: string) {
  const def = PROJECTS[kind];
  if (!def) return fail('unknown');
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  return withLock(coLock(c.company.id), async () => {
    const existing = await getProject(c.company.id);
    if (existing && existing.status !== 'done') return fail('active');
    if (existing) {
      // Sweep whatever the last project's contributors never collected into the vault.
      const contribs = await projectContribs(c.company.id);
      const unclaimed = contribs.reduce((s, x) => s + (Math.floor((existing.pool * x.amount) / existing.goal) - x.collected), 0);
      if (unclaimed > 0) await db`UPDATE eco_company SET vault = vault + ${unclaimed} WHERE id = ${c.company.id}`;
      await db`DELETE FROM eco_company_project WHERE company_id = ${c.company.id}`;
      await db`DELETE FROM eco_company_contrib WHERE company_id = ${c.company.id}`;
    }
    await db`INSERT INTO eco_company_project (company_id, kind, goal, raised, status, started_at) VALUES (${c.company.id}, ${kind}, ${def.goal}, 0, 'funding', ${Date.now()})`;
    await log(c.company.id, userId, `project:start:${kind}`);
    return { ok: true as const, def };
  });
}

export async function contributeProject(guildId: string, userId: string, amount: number) {
  const ms = await getMembership(userId);
  if (!ms) return fail('none');
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail('invalid');
  return withLock(coLock(ms.company.id), async () => {
    const p = await getProject(ms.company.id);
    if (!p || p.status !== 'funding') return fail('no-funding');
    const take = Math.min(amount, p.goal - p.raised);
    const paid = await adjustBalance(guildId, userId, -take, 'company:project');
    if (!paid.success) return { ok: false as const, reason: 'funds' as const, cash: paid.newBalance };
    const now = Date.now();
    const funded = p.raised + take >= p.goal;
    await db`UPDATE eco_company_project SET raised = raised + ${take}, status = ${funded ? 'active' : 'funding'}, ends_at = ${funded ? now + PROJECTS[p.kind]!.durationMs : null} WHERE company_id = ${ms.company.id}`;
    await db`INSERT INTO eco_company_contrib (company_id, user_id, amount) VALUES (${ms.company.id}, ${userId}, ${take})
             ON CONFLICT(company_id, user_id) DO UPDATE SET amount = amount + ${take}`;
    await log(ms.company.id, userId, 'project:contribute', take);
    return { ok: true as const, took: take, raised: p.raised + take, goal: p.goal, funded, cash: paid.newBalance };
  });
}

export async function completeProject(userId: string) {
  const ms = await getMembership(userId);
  if (!ms) return fail('none');
  return withLock(coLock(ms.company.id), async () => {
    const p = await getProject(ms.company.id);
    if (!p) return fail('no-project');
    if (p.status === 'funding') return fail('not-funded');
    if (p.status === 'done') return fail('already');
    if ((p.ends_at ?? 0) > Date.now()) return { ok: false as const, reason: 'pending' as const, endsAt: p.ends_at! };
    const pool = Math.floor(p.goal * PROJECTS[p.kind]!.yield);
    await db`UPDATE eco_company_project SET status = 'done', pool = ${pool} WHERE company_id = ${ms.company.id}`;
    await log(ms.company.id, userId, 'project:complete', pool);
    return { ok: true as const, pool, kind: p.kind };
  });
}

export async function collectProject(guildId: string, userId: string, max?: number | null) {
  const ms = await getMembership(userId);
  if (!ms) return fail('none');
  return withLock(coLock(ms.company.id), async () => {
    const p = await getProject(ms.company.id);
    if (!p || p.status !== 'done') return fail('not-done');
    const [c] = await db`SELECT amount, collected FROM eco_company_contrib WHERE company_id = ${ms.company.id} AND user_id = ${userId}`;
    if (!c) return fail('no-share');
    const entitled = Math.floor((p.pool * (c.amount as number)) / p.goal);
    let take = entitled - (c.collected as number);
    if (max && max > 0) take = Math.min(take, max);
    if (take <= 0) return fail('nothing');
    const rows = await db`UPDATE eco_company_contrib SET collected = collected + ${take} WHERE company_id = ${ms.company.id} AND user_id = ${userId} AND collected + ${take} <= ${entitled} RETURNING collected`;
    if (!rows.length) return fail('nothing');
    const { newBalance } = await adjustBalance(guildId, userId, take, 'company:project:collect');
    return { ok: true as const, took: take, cash: newBalance, left: entitled - (rows[0].collected as number) };
  });
}

export async function cancelProject(guildId: string, userId: string) {
  const c = await ceoOf(userId);
  if (!c.ok) return c;
  return withLock(coLock(c.company.id), async () => {
    const p = await getProject(c.company.id);
    if (!p) return fail('no-project');
    if (p.status !== 'funding') return fail('locked');
    const contribs = await projectContribs(c.company.id);
    await db`DELETE FROM eco_company_project WHERE company_id = ${c.company.id}`;
    await db`DELETE FROM eco_company_contrib WHERE company_id = ${c.company.id}`;
    for (const x of contribs) await adjustBalance(guildId, x.user_id, x.amount, 'company:project:refund');
    await log(c.company.id, userId, 'project:cancel');
    return { ok: true as const, refunded: contribs.reduce((s, x) => s + x.amount, 0), contributors: contribs.length };
  });
}

// ─── Leaderboards ────────────────────────────────────────────────────────────

export async function companyLeaderboard(kind: 'networth' | 'vault', limit = 10) {
  if (kind === 'vault') {
    return (await db`SELECT id, tag, name, vault AS value FROM eco_company ORDER BY vault DESC LIMIT ${limit}`) as { id: number; tag: string; name: string; value: number }[];
  }
  const { networthSql } = await import('./catalog.js');
  return (await db.unsafe(
    `SELECT c.id AS id, c.tag AS tag, c.name AS name, COALESCE(SUM(${networthSql()}), 0) AS value
     FROM eco_company c JOIN eco_company_member m ON m.company_id = c.id JOIN economy e ON e.user_id = m.user_id
     GROUP BY c.id ORDER BY value DESC LIMIT ?`, [limit])) as { id: number; tag: string; name: string; value: number }[];
}
