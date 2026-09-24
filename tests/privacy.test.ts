import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { db, initDb, adjustBalance, getOrCreateEconomy } from '../src/utils/db';
import { EXEMPT, REGISTRY, registerPrivacy } from '../src/privacy/registry';
import { DeleteRefused, deleteData, exportData, summarize } from '../src/privacy';
import { WALLET_BG_DIR, walletBgPath } from '../src/eco/render';
import { privacySubs } from '../src/subcommands/privacy/privacy';
import { fakeInteraction, textOf } from './fakeInteraction';

beforeAll(async () => { await initDb(); });

let n = 0;
const uid = () => `9${String(++n).padStart(8, '0')}${Date.now() % 1000}`.slice(0, 18);
const G = 'guild-priv';

async function seed(u: string) {
  await getOrCreateEconomy(G, u);
  await adjustBalance(G, u, 500, 'test:seed');
  await db`INSERT INTO birthdays (guild_id, user_id, month, day) VALUES (${G}, ${u}, 5, 17)`;
  await db`INSERT INTO timezones (user_id, timezone) VALUES (${u}, 'Europe/Paris')`;
  await db`INSERT INTO reminders (user_id, channel_id, guild_id, message, fires_at, created_at) VALUES (${u}, 'c1', ${G}, 'buy milk', 9999999999, 1)`;
  await db`INSERT INTO xp (guild_id, user_id, xp, level, total_messages) VALUES (${G}, ${u}, 120, 3, 42)`;
  await db`INSERT INTO warnings (guild_id, user_id, mod_id, reason, created_at) VALUES (${G}, ${u}, 'mod1', 'spam', 1)`;
  await db`INSERT INTO tags (guild_id, name, content, owner_id, uses, created_at) VALUES (${G}, ${`tag-${u}`}, 'hello', ${u}, 0, 1)`;
  await db`INSERT OR REPLACE INTO jackpot (guild_id, amount, seed, last_winner) VALUES (${`jp-${u}`}, 1000, 1000, ${u})`;
  await db`INSERT INTO rep_cooldowns (guild_id, from_user_id, to_user_id, last_rep) VALUES (${G}, ${u}, 'someone-else', 1)`;
  await db`INSERT OR REPLACE INTO juul_state (user_id, puffs) VALUES (${u}, 7)`;
}
const count = async (table: string, col: string, u: string) => ((await db.unsafe(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, [u])) as { n: number }[])[0]!.n;

describe('registry coverage (fails when someone adds a table with a user column and forgets privacy)', () => {
  const USER_COL = /^(user_id|owner_id|from_user_id|to_user_id|author_id|member_id|claimed_by|last_winner|mod_id|target_id|creator_id|invited_by|reporter_id)$/;
  test('every table with a user-identifying column is registered or explicitly exempted with a reason', async () => {
    const tables = (await db`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`) as { name: string }[];
    const registered = new Set(REGISTRY.map(e => e.table));
    const missing: string[] = [];
    for (const t of tables) {
      const cols = ((await db.unsafe(`PRAGMA table_info(${t.name})`)) as { name: string }[]).map(c => c.name);
      const userCols = cols.filter(c => USER_COL.test(c));
      if (userCols.length && !registered.has(t.name) && !EXEMPT[t.name]) missing.push(`${t.name} (${userCols.join(', ')})`);
    }
    expect(missing, `Add these to src/privacy/registry.ts: ${missing.join('; ')}`).toEqual([]);
  });
  test('every registry entry names a real table and real columns, with a note where required', async () => {
    for (const e of REGISTRY) {
      const cols = ((await db.unsafe(`PRAGMA table_info(${e.table})`)) as { name: string }[]).map(c => c.name);
      expect(cols.length, `table ${e.table} exists`).toBeGreaterThan(0);
      for (const c of e.columns) expect(cols, `${e.table}.${c}`).toContain(c);
      if (e.policy !== 'delete') expect(e.note, `${e.table} needs a note`).toBeTruthy();
      expect(/^[a-z_]+$/.test(e.table) && e.columns.every(c => /^[a-z_]+$/.test(c)), 'identifiers are plain').toBe(true);
    }
    expect(new Set(REGISTRY.map(e => e.table)).size).toBe(REGISTRY.length);
    for (const [t, why] of Object.entries(EXEMPT)) { expect(why.length).toBeGreaterThan(10); expect(((await db.unsafe(`PRAGMA table_info(${t})`)) as unknown[]).length, `exempt ${t} exists`).toBeGreaterThan(0); }
  });
  test('no table stores chat message content (only IDs and counters)', async () => {
    // Columns that legitimately hold text a person or server wrote on purpose. Anything new must be reviewed and added here.
    const allowed = new Set(['automod_rules.action_reason', 'custom_commands.name', 'eco_bank_ledger.reason', 'eco_ledger.reason', 'eco_company.description', 'eco_company_request.text', 'eco_wallet_style.message', 'mod_cases.reason',
      'reminders.message', 'rsvp_events.description', 'scheduled_tasks.data', 'sticky_messages.content', 'streaming_config.message', 'tags.content', 'topics.text', 'twitch_feeds.message', 'warnings.reason',
      'welcome_config.message', 'welcome_config.dm_message', 'welcome_config.leave_message', 'welcome_config.ban_message', 'xp_config.level_up_message', 'youtube_feeds.message', 'economy_config.currency_name']);
    const tables = (await db`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`) as { name: string }[];
    const suspicious: string[] = [];
    for (const t of tables) for (const c of (await db.unsafe(`PRAGMA table_info(${t.name})`)) as { name: string }[]) {
      if (/(^|_)(content|text|message|body)$/.test(c.name) && !/_id$/.test(c.name) && !allowed.has(`${t.name}.${c.name}`)) suspicious.push(`${t.name}.${c.name}`);
    }
    expect(suspicious, 'New free-text column: is it chat content? If it is user/server-authored config, add it to the allow-list.').toEqual([]);
  });
});

describe('export', () => {
  test('contains only this person\'s rows, across tables, as valid JSON', async () => {
    const a = uid(), b = uid(); await seed(a); await seed(b);
    const r = await exportData(a, new Date('2026-01-01T00:00:00Z'));
    expect(r.name).toBe(`my-data-${a}.json`);
    const j = JSON.parse(r.data.toString());
    expect(j.userId).toBe(a); expect(j.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    for (const t of ['economy', 'birthdays', 'timezones', 'reminders', 'xp', 'warnings', 'tags', 'juul_state', 'rep_cooldowns']) expect(j.tables[t], t).toBeTruthy();
    expect(JSON.stringify(j)).not.toContain(b);
    expect(j.tables.reminders[0].message).toBe('buy milk'); expect(j.tables.economy[0].balance).toBe(500);
    expect(r.rows).toBe(Object.values(j.tables as Record<string, unknown[]>).reduce((s, x) => s + x.length, 0));
  });
  test('a person with no data gets an empty but valid export', async () => {
    const r = await exportData('12345678901234567');
    expect(JSON.parse(r.data.toString()).tables).toEqual({}); expect(r.rows).toBe(0);
  });
  test('includes the wallet background in a zip when there is one', async () => {
    const u = uid(); mkdirSync(WALLET_BG_DIR, { recursive: true }); writeFileSync(walletBgPath(u), Buffer.from('fakepng'));
    const r = await exportData(u);
    expect(r.name).toBe(`my-data-${u}.zip`); expect(r.data.subarray(0, 2).toString()).toBe('PK');
    expect(r.data.includes(Buffer.from('wallet_background.png'))).toBe(true); expect(r.data.includes(Buffer.from('data.json'))).toBe(true);
    await deleteData(u);
  });
});

describe('delete', () => {
  test('removes their data everywhere, leaves other people untouched, keeps and reports server records', async () => {
    const a = uid(), b = uid(); await seed(a); await seed(b);
    const before = await summarize(a);
    expect(before.map(s => s.table)).toEqual(expect.arrayContaining(['economy', 'xp', 'warnings', 'juul_state']));
    const r = await deleteData(a);
    expect(r.deleted).toBeGreaterThan(5); expect(r.anonymized).toBe(2); // jackpot last_winner + tag owner
    expect(r.kept.map(k => k.table)).toEqual(['warnings']);
    for (const [t, c] of [['economy', 'user_id'], ['birthdays', 'user_id'], ['timezones', 'user_id'], ['reminders', 'user_id'], ['xp', 'user_id'], ['juul_state', 'user_id'], ['eco_ledger', 'user_id'], ['rep_cooldowns', 'from_user_id']] as const)
      expect(await count(t, c, a), `${t} cleared`).toBe(0);
    expect(await count('warnings', 'user_id', a)).toBe(1);             // the server's record stays
    expect(await count('tags', 'owner_id', a)).toBe(0);                 // detached…
    expect(await count('tags', 'name', `tag-${a}`)).toBe(1);            // …but the tag itself remains
    expect(await count('jackpot', 'last_winner', a)).toBe(0);
    for (const [t, c] of [['economy', 'user_id'], ['birthdays', 'user_id'], ['reminders', 'user_id'], ['xp', 'user_id'], ['juul_state', 'user_id'], ['tags', 'owner_id']] as const) expect(await count(t, c, b), `${t} of b intact`).toBe(1);
    expect((await summarize(a)).map(s => s.table)).toEqual(['warnings']);
  });
  test('is idempotent and removes the wallet background file', async () => {
    const u = uid(); await seed(u);
    mkdirSync(WALLET_BG_DIR, { recursive: true }); writeFileSync(walletBgPath(u), Buffer.from('x'));
    expect((await deleteData(u)).removedFile).toBe(true); expect(existsSync(walletBgPath(u))).toBe(false);
    const again = await deleteData(u);
    expect(again).toMatchObject({ deleted: 0, anonymized: 0, removedFile: false });
  });
  test('refuses (and changes nothing) while you own a company with other members; removes a solo company', async () => {
    const owner = uid(), member = uid(); await seed(owner);
    const c = ((await db`INSERT INTO eco_company (tag, name, owner_id, created_at) VALUES (${'TST' + n}, 'Test Co', ${owner}, 1) RETURNING id`) as { id: number }[])[0]!.id;
    await db`INSERT INTO eco_company_member (user_id, company_id, rank, joined_at) VALUES (${owner}, ${c}, 'owner', 1)`;
    await db`INSERT INTO eco_company_member (user_id, company_id, rank, joined_at) VALUES (${member}, ${c}, 'member', 1)`;
    await expect(deleteData(owner)).rejects.toThrow(DeleteRefused);
    expect(await count('economy', 'user_id', owner)).toBe(1); expect(await count('eco_company', 'owner_id', owner)).toBe(1); // nothing changed
    await db`DELETE FROM eco_company_member WHERE user_id = ${member}`;
    await deleteData(owner);
    expect(await count('eco_company', 'owner_id', owner)).toBe(0); expect(await count('eco_company_member', 'company_id', String(c))).toBe(0); expect(await count('economy', 'user_id', owner)).toBe(0);
  });
  test('rejects malicious ids before touching SQL', async () => {
    for (const bad of ["x' OR '1'='1", '1; DROP TABLE economy', '', 'a b', '../etc', 'x'.repeat(100)]) {
      await expect(deleteData(bad), bad).rejects.toThrow('bad user id'); await expect(exportData(bad), bad).rejects.toThrow('bad user id'); await expect(summarize(bad), bad).rejects.toThrow('bad user id');
    }
    expect(((await db`SELECT COUNT(*) AS n FROM economy`) as { n: number }[])[0]!.n).toBeGreaterThan(0);
  });
  test('concurrent deletes and new activity never leave the DB inconsistent', async () => {
    const u = uid(); await seed(u);
    await Promise.all([deleteData(u), deleteData(u), deleteData(u)]);
    expect(await count('economy', 'user_id', u)).toBe(0);
  });
  test('registerPrivacy lets optional modules add tables', async () => {
    await db`CREATE TABLE IF NOT EXISTS zz_extra (user_id TEXT, note TEXT)`;
    registerPrivacy({ table: 'zz_extra', columns: ['user_id'], label: 'Extra', policy: 'delete' });
    const u = uid(); await db`INSERT INTO zz_extra VALUES (${u}, 'hi')`;
    expect((await summarize(u)).map(s => s.table)).toContain('zz_extra');
    await deleteData(u); expect(await count('zz_extra', 'user_id', u)).toBe(0);
    REGISTRY.splice(REGISTRY.findIndex(e => e.table === 'zz_extra'), 1); await db`DROP TABLE zz_extra`;
  });
});

describe('/privacy commands', () => {
  const sub = (name: string) => privacySubs.find(s => s.name === name)!;
  test('policy is private and mentions the key promises', async () => {
    const fi = fakeInteraction(); await sub('policy').run(fi.interaction);
    const t = textOf(fi.last()); expect(t).toContain('never the text of your messages'); expect(t).toContain('never sold'.replace('never sold', 'never sold'));
    expect(fi.last().flags & 64).toBeTruthy(); // ephemeral
  });
  test('data lists categories with counts; export attaches a file', async () => {
    const u = uid(); await seed(u);
    let fi = fakeInteraction({ userId: u }); await sub('data').run(fi.interaction);
    expect(textOf(fi.last())).toContain('Balance, bank and lifetime totals'); expect(textOf(fi.last())).toContain('Warnings from server staff');
    fi = fakeInteraction({ userId: u }); await sub('export').run(fi.interaction);
    expect(fi.last().files[0].name).toBe(`my-data-${u}.json`); expect(fi.last().content).toContain('rows across');
    await deleteData(u);
  });
  test('delete with nothing to delete says so and asks nothing', async () => {
    const fi = fakeInteraction({ userId: '55555555555555555' }); await sub('delete').run(fi.interaction);
    expect(fi.last().content).toContain('nothing of yours to delete');
  });
});
