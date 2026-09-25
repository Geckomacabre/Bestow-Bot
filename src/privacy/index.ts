import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { db } from '../utils/db.js';
import { withLock } from '../framework/mutex.js';
import { makeZip } from '../framework/zip.js';
import { walletBgPath } from '../eco/render.js';
import { REGISTRY, type PrivacyEntry } from './registry.js';

const ID = /^\d{5,25}$|^[\w-]{1,40}$/; // Discord snowflakes in production; tests use short ids

const where = (e: PrivacyEntry) => e.columns.map(c => `${c} = ?`).join(' OR ');
const params = (e: PrivacyEntry, userId: string) => e.columns.map(() => userId);

async function tableExists(name: string): Promise<boolean> {
  return ((await db.unsafe(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`, [name])) as unknown[]).length > 0;
}

export interface Summary { table: string; label: string; policy: PrivacyEntry['policy']; rows: number; note?: string }

/** How many rows of each kind we hold about this person (only tables that have any). */
export async function summarize(userId: string): Promise<Summary[]> {
  if (!ID.test(userId)) throw new Error('bad user id');
  const out: Summary[] = [];
  for (const e of REGISTRY) {
    if (!(await tableExists(e.table))) continue;
    const n = ((await db.unsafe(`SELECT COUNT(*) AS n FROM ${e.table} WHERE ${where(e)}`, params(e, userId))) as { n: number }[])[0]!.n;
    if (n > 0) out.push({ table: e.table, label: e.label, policy: e.policy, rows: n, note: e.note });
  }
  return out;
}

export interface ExportResult { name: string; data: Buffer; tables: number; rows: number }

/** Everything we store about the person, as JSON (zipped with their wallet background image if they uploaded one). */
export async function exportData(userId: string, now = new Date()): Promise<ExportResult> {
  if (!ID.test(userId)) throw new Error('bad user id');
  const tables: Record<string, unknown[]> = {};
  let rows = 0;
  for (const e of REGISTRY) {
    if (!(await tableExists(e.table))) continue;
    const r = (await db.unsafe(`SELECT * FROM ${e.table} WHERE ${where(e)}`, params(e, userId))) as Record<string, unknown>[];
    if (r.length) { tables[e.table] = r; rows += r.length; }
  }
  const json = Buffer.from(JSON.stringify({
    about: 'Everything this bot stores about you, as of the time below. Chat messages are never stored. See /privacy policy for details.',
    userId, generatedAt: now.toISOString(), tables,
  }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  const bg = walletBgPath(userId);
  if (existsSync(bg)) return { name: `my-data-${userId}.zip`, data: makeZip([{ name: 'data.json', data: json }, { name: 'wallet_background.png', data: readFileSync(bg) }], now), tables: Object.keys(tables).length, rows };
  return { name: `my-data-${userId}.json`, data: json, tables: Object.keys(tables).length, rows };
}

export class DeleteRefused extends Error {}

export interface DeleteResult { deleted: number; anonymized: number; kept: Summary[]; removedFile: boolean }

/** Deletes everything deletable. Refuses (changing nothing) while the person still owns a company that other people belong to. */
export async function deleteData(userId: string): Promise<DeleteResult> {
  if (!ID.test(userId)) throw new Error('bad user id');
  return withLock(`mydata:${userId}`, async () => {
    if (await tableExists('eco_company')) {
      const owned = (await db`SELECT id, name, tag FROM eco_company WHERE owner_id = ${userId}`) as { id: number; name: string; tag: string }[];
      for (const c of owned) {
        const others = ((await db`SELECT COUNT(*) AS n FROM eco_company_member WHERE company_id = ${c.id} AND user_id != ${userId}`) as { n: number }[])[0]!.n;
        if (others > 0) throw new DeleteRefused(`You own the company **${c.name}** [${c.tag}], which still has ${others} other member${others === 1 ? '' : 's'}. Transfer ownership or disband it first, then run this again.`);
      }
      // Sole-member companies go with their owner (their vault is part of their economy data).
      for (const c of owned) {
        for (const t of ['eco_company_member', 'eco_company_invite', 'eco_company_request', 'eco_company_contrib', 'eco_company_log', 'eco_company_project', 'eco_company_setting']) {
          if (await tableExists(t)) { try { await db.unsafe(`DELETE FROM ${t} WHERE company_id = ?`, [c.id]); } catch { /* table has no company_id */ } }
        }
        await db`DELETE FROM eco_company WHERE id = ${c.id}`;
      }
    }
    let deleted = 0, anonymized = 0;
    const kept: Summary[] = [];
    for (const e of REGISTRY) {
      if (!(await tableExists(e.table))) continue;
      const p = params(e, userId);
      if (e.policy === 'keep') {
        const n = ((await db.unsafe(`SELECT COUNT(*) AS n FROM ${e.table} WHERE ${where(e)}`, p)) as { n: number }[])[0]!.n;
        if (n) kept.push({ table: e.table, label: e.label, policy: 'keep', rows: n, note: e.note });
      } else if (e.policy === 'anonymize') {
        for (const c of e.columns) {
          const r = (await db.unsafe(`UPDATE ${e.table} SET ${c} = NULL WHERE ${c} = ? RETURNING 1`, [userId]).catch(async () => db.unsafe(`UPDATE ${e.table} SET ${c} = '0' WHERE ${c} = ? RETURNING 1`, [userId]))) as unknown[];
          anonymized += r.length;
        }
      } else {
        const r = (await db.unsafe(`DELETE FROM ${e.table} WHERE ${where(e)} RETURNING 1`, p)) as unknown[];
        deleted += r.length;
      }
    }
    const bg = walletBgPath(userId);
    const removedFile = existsSync(bg);
    if (removedFile) unlinkSync(bg);
    return { deleted, anonymized, kept, removedFile };
  });
}

/** The plain-language policy text shown by /privacy policy. Keep in sync with the registry and README. */
export const POLICY = {
  stores: [
    'Your Discord user ID, so your balance, level, reputation and settings stay yours across sessions.',
    'Things you deliberately give it: birthday, timezone, reminders, wallet style, juul flavour, trading cards and other game progress.',
    'Counters like how many messages you\'ve sent for levels — **never the text of your messages**.',
  ],
  neverStores: [
    'The content of chat messages (the few features that react to messages, like counting or @mention chat, read them in memory and discard them).',
    'Direct messages, email addresses, phone numbers, IP addresses or your location.',
  ],
  sharing: [
    'Your data is never sold, rented or shared for advertising or analytics. There is no tracking and no telemetry.',
    'Some commands send *what you type into that command* to a public service to get an answer: /crypto → CoinGecko, Blockstream, Blockscout, mempool.space · /net → Cloudflare DNS, ipwho.is, check-host.net, thum.io · /tools → LRCLIB, paste.rs (public paste), Wikipedia/your search instance, open.er-api.com, Google Translate, vxtwitter · /fun action → nekos.best · /roblox, /minecraft, /github, /steam, /valorant, /fortnite → those services\' public APIs.',
    'AI features (if the server\'s owner turned them on) send your prompt to the AI provider the bot owner configured.',
  ],
} as const;
