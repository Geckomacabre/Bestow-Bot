import { randomBytes } from 'node:crypto';
import { db } from '../utils/db.js';

/**
 * /tags: a person's own text snippets, usable in any server or DM (unlike a server's legacy `tags` table).
 * Export makes a one-use code (valid 24h) that anyone holding it can import once — for moving tags between accounts or sharing a set.
 */

export const MAX_TAGS = 100;
export const MAX_TEXT = 2000;
export const EXPORT_TTL_MS = 24 * 60 * 60_000;
export const NAME_RE = /^[\p{L}\p{N}_-]{1,32}$/u;

export interface UserTag { user_id: string; name: string; content: string; uses: number; created_at: number; updated_at: number }

export async function initTagsSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS user_tags (
    user_id    TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    uses       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, name)
  )`;
  await db`CREATE TABLE IF NOT EXISTS tag_exports (
    code       TEXT    PRIMARY KEY,
    user_id    TEXT    NOT NULL,
    payload    TEXT    NOT NULL,
    expires_at INTEGER NOT NULL
  )`;
}

export class TagError extends Error {}

export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');

export function checkName(raw: string): string {
  const n = normName(raw);
  if (!NAME_RE.test(n)) throw new TagError('Tag names are 1–32 letters, numbers, `-` or `_`.');
  return n;
}

export async function listTags(userId: string): Promise<UserTag[]> {
  return (await db`SELECT * FROM user_tags WHERE user_id = ${userId} ORDER BY name`) as UserTag[];
}

export async function getTag(userId: string, name: string): Promise<UserTag | null> {
  const r = (await db`SELECT * FROM user_tags WHERE user_id = ${userId} AND name = ${normName(name)}`) as UserTag[];
  return r[0] ?? null;
}

export async function createTag(userId: string, rawName: string, content: string, now = Date.now()): Promise<UserTag> {
  const name = checkName(rawName);
  if (!content.trim()) throw new TagError('A tag needs some text.');
  if (content.length > MAX_TEXT) throw new TagError(`Tags can be up to ${MAX_TEXT} characters.`);
  const count = ((await db`SELECT COUNT(*) AS n FROM user_tags WHERE user_id = ${userId}`) as { n: number }[])[0]!.n;
  if (count >= MAX_TAGS) throw new TagError(`You can have up to ${MAX_TAGS} tags. Delete one first.`);
  const r = (await db`INSERT INTO user_tags (user_id, name, content, created_at, updated_at) VALUES (${userId}, ${name}, ${content}, ${now}, ${now})
    ON CONFLICT (user_id, name) DO NOTHING RETURNING *`) as UserTag[];
  if (!r[0]) throw new TagError(`You already have a tag called \`${name}\`. Use /tags edit to change it.`);
  return r[0];
}

export async function editTag(userId: string, name: string, content: string, now = Date.now()): Promise<boolean> {
  if (!content.trim()) throw new TagError('A tag needs some text.');
  if (content.length > MAX_TEXT) throw new TagError(`Tags can be up to ${MAX_TEXT} characters.`);
  return ((await db`UPDATE user_tags SET content = ${content}, updated_at = ${now} WHERE user_id = ${userId} AND name = ${normName(name)} RETURNING 1`) as unknown[]).length > 0;
}

export async function deleteTag(userId: string, name: string): Promise<boolean> {
  return ((await db`DELETE FROM user_tags WHERE user_id = ${userId} AND name = ${normName(name)} RETURNING 1`) as unknown[]).length > 0;
}

export async function useTag(userId: string, name: string): Promise<UserTag | null> {
  const r = (await db`UPDATE user_tags SET uses = uses + 1 WHERE user_id = ${userId} AND name = ${normName(name)} RETURNING *`) as UserTag[];
  return r[0] ?? null;
}

/** e.g. "TAGS-7K2Q-9XMA-B4TD" — unambiguous characters only. */
export function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(12);
  const chars = [...b].map(x => alphabet[x % alphabet.length]).join('');
  return `TAGS-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export async function exportTags(userId: string, now = Date.now()): Promise<{ code: string; count: number }> {
  const tags = await listTags(userId);
  if (!tags.length) throw new TagError('You don\'t have any tags to export.');
  await db`DELETE FROM tag_exports WHERE expires_at < ${now}`;
  const code = newCode();
  await db`INSERT INTO tag_exports (code, user_id, payload, expires_at) VALUES (${code}, ${userId}, ${JSON.stringify(tags.map(t => ({ name: t.name, content: t.content })))}, ${now + EXPORT_TTL_MS})`;
  return { code, count: tags.length };
}

/** Consumes the code (one use) and copies its tags in; names you already have are skipped, never overwritten. */
export async function importTags(userId: string, rawCode: string, now = Date.now()): Promise<{ added: number; skipped: string[] }> {
  const code = rawCode.trim().toUpperCase();
  const r = (await db`DELETE FROM tag_exports WHERE code = ${code} RETURNING payload, expires_at`) as { payload: string; expires_at: number }[];
  const row = r[0];
  if (!row || row.expires_at < now) throw new TagError('That code is invalid, already used, or expired (codes last 24 hours).');
  const items = JSON.parse(row.payload) as { name: string; content: string }[];
  let added = 0;
  const skipped: string[] = [];
  for (const t of items) {
    try { await createTag(userId, t.name, t.content, now); added++; } catch { skipped.push(t.name); }
  }
  return { added, skipped };
}
