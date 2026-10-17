import { db } from '../utils/db.js';

/**
 * Data for the group-chat features (/group, and the birthday and time boards). Everything is keyed by a chat scope (see scope.ts):
 * a server id, or the channel id of a DM or group chat.
 *  • A person's birthday is saved once (user_birthdays) and shown on the boards of the chats they add themselves to (chat_members).
 *    Nobody shows on a chat's board until they press "Add me" there (or set it from that chat).
 *  • Plans with RSVPs, and shared lists, belong to the chat they were made in.
 *  • Button votes (would you rather, never have I ever) are kept per panel message for 30 days.
 */

export const BOARDS = ['birthday', 'timezone'] as const;
export type Board = (typeof BOARDS)[number];

export const MAX_LISTS = 20;
export const MAX_ITEMS = 50;
export const MAX_ITEM_LEN = 200;
export const MAX_LIST_NAME = 32;
export const MAX_PLANS = 25;
export const MAX_PLAN_TITLE = 100;
export const MAX_PLAN_DETAILS = 500;
/** A plan still counts as upcoming for this long after it starts. */
export const PLAN_GRACE_MS = 3 * 60 * 60_000;
/** Plans are tidied away this long after they started. */
const PLAN_KEEP_MS = 30 * 86_400_000;

export class GroupError extends Error {}

export async function initGroupSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS user_birthdays (
    user_id    TEXT    PRIMARY KEY,
    month      INTEGER NOT NULL,
    day        INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`;
  await db`CREATE TABLE IF NOT EXISTS chat_members (
    scope_id  TEXT    NOT NULL,
    board     TEXT    NOT NULL,
    user_id   TEXT    NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (scope_id, board, user_id)
  )`;
  await db`CREATE TABLE IF NOT EXISTS group_plans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_id   TEXT    NOT NULL,
    channel_id TEXT    NOT NULL,
    message_id TEXT,
    title      TEXT    NOT NULL,
    details    TEXT,
    starts_at  INTEGER NOT NULL,
    all_day    INTEGER NOT NULL DEFAULT 0,
    created_by TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  )`;
  await db`CREATE INDEX IF NOT EXISTS group_plans_scope ON group_plans (scope_id, starts_at)`;
  await db`CREATE TABLE IF NOT EXISTS group_plan_rsvps (
    plan_id    INTEGER NOT NULL REFERENCES group_plans(id) ON DELETE CASCADE,
    user_id    TEXT    NOT NULL,
    status     TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (plan_id, user_id)
  )`;
  await db`CREATE TABLE IF NOT EXISTS group_lists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_id   TEXT    NOT NULL,
    name       TEXT    NOT NULL COLLATE NOCASE,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (scope_id, name)
  )`;
  await db`CREATE TABLE IF NOT EXISTS chat_votes (
    message_id TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    choice     TEXT    NOT NULL,
    voted_at   INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
  )`;
  await db`CREATE TABLE IF NOT EXISTS group_list_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id    INTEGER NOT NULL REFERENCES group_lists(id) ON DELETE CASCADE,
    text       TEXT    NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    added_by   TEXT,
    created_at INTEGER NOT NULL
  )`;
}

// ─── Birthdays (one per person) ───────────────────────────────────────────────

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface Birthday { month: number; day: number }

export function checkBirthday(month: number, day: number): Birthday {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new GroupError('The month has to be 1–12 (or a month name).');
  if (!Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH[month - 1]!) throw new GroupError(`${MONTHS[month - 1]} only has ${DAYS_IN_MONTH[month - 1]} days.`);
  return { month, day };
}

/** "5", "05", "may", "May" → 5. */
export function parseMonth(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (/^\d{1,2}$/.test(s)) return Number(s);
  if (s.length < 3) return null;
  const i = MONTHS.findIndex(m => m.toLowerCase().startsWith(s));
  return i >= 0 ? i + 1 : null;
}

export async function setPersonalBirthday(userId: string, month: number, day: number, now = Date.now()): Promise<Birthday> {
  const b = checkBirthday(month, day);
  await db`INSERT INTO user_birthdays (user_id, month, day, updated_at) VALUES (${userId}, ${b.month}, ${b.day}, ${now})
    ON CONFLICT (user_id) DO UPDATE SET month = excluded.month, day = excluded.day, updated_at = excluded.updated_at`;
  return b;
}

export async function getPersonalBirthday(userId: string): Promise<Birthday | null> {
  const r = (await db`SELECT month, day FROM user_birthdays WHERE user_id = ${userId}`) as Birthday[];
  return r[0] ?? null;
}

/** Forgets the saved birthday and takes the person off every chat's birthday board. */
export async function removePersonalBirthday(userId: string): Promise<boolean> {
  const r = (await db`DELETE FROM user_birthdays WHERE user_id = ${userId} RETURNING 1`) as unknown[];
  await db`DELETE FROM chat_members WHERE board = 'birthday' AND user_id = ${userId}`;
  return r.length > 0;
}

// ─── Chat boards (who added themselves) ───────────────────────────────────────

export async function joinBoard(scope: string, board: Board, userId: string, now = Date.now()): Promise<void> {
  await db`INSERT INTO chat_members (scope_id, board, user_id, joined_at) VALUES (${scope}, ${board}, ${userId}, ${now}) ON CONFLICT DO NOTHING`;
}

export async function leaveBoard(scope: string, board: Board, userId: string): Promise<boolean> {
  return ((await db`DELETE FROM chat_members WHERE scope_id = ${scope} AND board = ${board} AND user_id = ${userId} RETURNING 1`) as unknown[]).length > 0;
}

export async function onBoard(scope: string, board: Board, userId: string): Promise<boolean> {
  return ((await db`SELECT 1 FROM chat_members WHERE scope_id = ${scope} AND board = ${board} AND user_id = ${userId}`) as unknown[]).length > 0;
}

/** Everyone on a chat's birthday board who has a birthday saved. */
export async function chatBirthdays(scope: string): Promise<(Birthday & { user_id: string })[]> {
  return (await db`SELECT m.user_id, b.month, b.day FROM chat_members m JOIN user_birthdays b ON b.user_id = m.user_id
    WHERE m.scope_id = ${scope} AND m.board = 'birthday'`) as (Birthday & { user_id: string })[];
}

/** Everyone on a chat's time board who has a timezone saved (/timezone set). */
export async function chatTimezones(scope: string): Promise<{ user_id: string; timezone: string }[]> {
  return (await db`SELECT m.user_id, t.timezone FROM chat_members m JOIN timezones t ON t.user_id = m.user_id
    WHERE m.scope_id = ${scope} AND m.board = 'timezone'`) as { user_id: string; timezone: string }[];
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export const RSVP = ['going', 'maybe', 'no'] as const;
export type RsvpStatus = (typeof RSVP)[number];

export interface Plan {
  id: number; scope_id: string; channel_id: string; message_id: string | null; title: string; details: string | null;
  starts_at: number; all_day: number; created_by: string; created_at: number;
}

export async function createPlan(o: { scope: string; channelId: string; title: string; details?: string | null; startsAt: number; allDay?: boolean; createdBy: string }, now = Date.now()): Promise<Plan> {
  const title = o.title.trim(), details = o.details?.trim() || null;
  if (!title) throw new GroupError('A plan needs a name.');
  if (title.length > MAX_PLAN_TITLE) throw new GroupError(`Plan names can be up to ${MAX_PLAN_TITLE} characters.`);
  if (details && details.length > MAX_PLAN_DETAILS) throw new GroupError(`Details can be up to ${MAX_PLAN_DETAILS} characters.`);
  if (o.startsAt < now - 60_000) throw new GroupError('That time has already passed.');
  await db`DELETE FROM group_plans WHERE starts_at < ${now - PLAN_KEEP_MS}`;
  await db`DELETE FROM group_plan_rsvps WHERE plan_id NOT IN (SELECT id FROM group_plans)`;
  if ((await upcomingPlans(o.scope, now)).length >= MAX_PLANS) throw new GroupError(`This chat already has ${MAX_PLANS} upcoming plans. Cancel one first.`);
  const r = (await db`INSERT INTO group_plans (scope_id, channel_id, title, details, starts_at, all_day, created_by, created_at)
    VALUES (${o.scope}, ${o.channelId}, ${title}, ${details}, ${o.startsAt}, ${o.allDay ? 1 : 0}, ${o.createdBy}, ${now}) RETURNING *`) as Plan[];
  return r[0]!;
}

export async function getPlan(id: number): Promise<Plan | null> {
  return ((await db`SELECT * FROM group_plans WHERE id = ${id}`) as Plan[])[0] ?? null;
}

export async function setPlanMessage(id: number, messageId: string): Promise<void> {
  await db`UPDATE group_plans SET message_id = ${messageId} WHERE id = ${id}`;
}

export async function deletePlan(id: number): Promise<void> {
  await db`DELETE FROM group_plan_rsvps WHERE plan_id = ${id}`;
  await db`DELETE FROM group_plans WHERE id = ${id}`;
}

export async function upcomingPlans(scope: string, now = Date.now()): Promise<Plan[]> {
  return (await db`SELECT * FROM group_plans WHERE scope_id = ${scope} AND starts_at >= ${now - PLAN_GRACE_MS} ORDER BY starts_at`) as Plan[];
}

/** Sets someone's answer; answering the same thing again takes it back. Returns their answer now. */
export async function toggleRsvp(planId: number, userId: string, status: RsvpStatus, now = Date.now()): Promise<RsvpStatus | null> {
  const cur = ((await db`SELECT status FROM group_plan_rsvps WHERE plan_id = ${planId} AND user_id = ${userId}`) as { status: RsvpStatus }[])[0]?.status;
  if (cur === status) {
    await db`DELETE FROM group_plan_rsvps WHERE plan_id = ${planId} AND user_id = ${userId}`;
    return null;
  }
  await db`INSERT INTO group_plan_rsvps (plan_id, user_id, status, updated_at) VALUES (${planId}, ${userId}, ${status}, ${now})
    ON CONFLICT (plan_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`;
  return status;
}

/** Answers in the order people gave them. */
export async function planRsvps(planId: number): Promise<{ user_id: string; status: RsvpStatus }[]> {
  return (await db`SELECT user_id, status FROM group_plan_rsvps WHERE plan_id = ${planId} ORDER BY updated_at, user_id`) as { user_id: string; status: RsvpStatus }[];
}

// ─── Shared lists ─────────────────────────────────────────────────────────────

export interface List { id: number; scope_id: string; name: string; created_by: string | null; created_at: number }
export interface Item { id: number; list_id: number; text: string; done: number; added_by: string | null; created_at: number }

export function checkListName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) throw new GroupError('A list needs a name.');
  if (name.length > MAX_LIST_NAME) throw new GroupError(`List names can be up to ${MAX_LIST_NAME} characters.`);
  return name;
}

export async function findList(scope: string, name: string): Promise<List | null> {
  return ((await db`SELECT * FROM group_lists WHERE scope_id = ${scope} AND name = ${checkListName(name)}`) as List[])[0] ?? null;
}

export async function getList(id: number): Promise<List | null> {
  return ((await db`SELECT * FROM group_lists WHERE id = ${id}`) as List[])[0] ?? null;
}

export async function chatLists(scope: string): Promise<(List & { items: number; open: number })[]> {
  return (await db`SELECT l.*, COUNT(i.id) AS items, COALESCE(SUM(CASE WHEN i.done = 0 THEN 1 ELSE 0 END), 0) AS open
    FROM group_lists l LEFT JOIN group_list_items i ON i.list_id = l.id WHERE l.scope_id = ${scope} GROUP BY l.id ORDER BY l.name`) as (List & { items: number; open: number })[];
}

export async function openList(scope: string, rawName: string, userId: string, now = Date.now()): Promise<List> {
  const name = checkListName(rawName);
  const existing = await findList(scope, name);
  if (existing) return existing;
  const n = ((await db`SELECT COUNT(*) AS n FROM group_lists WHERE scope_id = ${scope}`) as { n: number }[])[0]!.n;
  if (n >= MAX_LISTS) throw new GroupError(`This chat already has ${MAX_LISTS} lists. Empty one and clear it to delete it.`);
  const r = (await db`INSERT INTO group_lists (scope_id, name, created_by, created_at) VALUES (${scope}, ${name}, ${userId}, ${now})
    ON CONFLICT DO NOTHING RETURNING *`) as List[];
  return r[0] ?? (await findList(scope, name))!;
}

export async function listItems(listId: number): Promise<Item[]> {
  return (await db`SELECT * FROM group_list_items WHERE list_id = ${listId} ORDER BY id`) as Item[];
}

/** Adds one item per non-empty line. Returns how many were added. */
export async function addItems(listId: number, raw: string, userId: string, now = Date.now()): Promise<number> {
  const lines = raw.split(/\r?\n/).map(l => l.trim().replace(/^[-*•]\s+/, '')).filter(Boolean);
  if (!lines.length) throw new GroupError('Type something to add.');
  const long = lines.find(l => l.length > MAX_ITEM_LEN);
  if (long) throw new GroupError(`Items can be up to ${MAX_ITEM_LEN} characters.`);
  const have = ((await db`SELECT COUNT(*) AS n FROM group_list_items WHERE list_id = ${listId}`) as { n: number }[])[0]!.n;
  if (have + lines.length > MAX_ITEMS) throw new GroupError(`A list holds up to ${MAX_ITEMS} items (this one has ${have}). Clear the ticked ones first.`);
  for (const text of lines) await db`INSERT INTO group_list_items (list_id, text, added_by, created_at) VALUES (${listId}, ${text}, ${userId}, ${now})`;
  return lines.length;
}

/** Ticks the unticked ones and unticks the ticked ones. Returns how many changed. */
export async function toggleItems(listId: number, ids: number[]): Promise<number> {
  let n = 0;
  for (const id of ids) n += ((await db`UPDATE group_list_items SET done = 1 - done WHERE id = ${id} AND list_id = ${listId} RETURNING 1`) as unknown[]).length;
  return n;
}

/** Removes the ticked items; an already-empty list is deleted instead. */
export async function clearDone(listId: number): Promise<{ removed: number; deletedList: boolean }> {
  const items = await listItems(listId);
  if (!items.length) {
    await db`DELETE FROM group_lists WHERE id = ${listId}`;
    return { removed: 0, deletedList: true };
  }
  const r = (await db`DELETE FROM group_list_items WHERE list_id = ${listId} AND done = 1 RETURNING 1`) as unknown[];
  return { removed: r.length, deletedList: false };
}

// ─── Button votes (would you rather, never have I ever) ───────────────────────

/** Votes are tidied away this long after they were cast. */
const VOTE_KEEP_MS = 30 * 86_400_000;

/** Records a vote on a panel; voting for the same thing again takes it back. Returns the vote now. */
export async function toggleVote(messageId: string, userId: string, choice: string, now = Date.now()): Promise<string | null> {
  await db`DELETE FROM chat_votes WHERE voted_at < ${now - VOTE_KEEP_MS}`;
  const cur = ((await db`SELECT choice FROM chat_votes WHERE message_id = ${messageId} AND user_id = ${userId}`) as { choice: string }[])[0]?.choice;
  if (cur === choice) {
    await db`DELETE FROM chat_votes WHERE message_id = ${messageId} AND user_id = ${userId}`;
    return null;
  }
  await db`INSERT INTO chat_votes (message_id, user_id, choice, voted_at) VALUES (${messageId}, ${userId}, ${choice}, ${now})
    ON CONFLICT (message_id, user_id) DO UPDATE SET choice = excluded.choice, voted_at = excluded.voted_at`;
  return choice;
}

/** Votes on a panel, in the order they were cast. */
export async function votesOn(messageId: string): Promise<{ user_id: string; choice: string }[]> {
  return (await db`SELECT user_id, choice FROM chat_votes WHERE message_id = ${messageId} ORDER BY voted_at, user_id`) as { user_id: string; choice: string }[];
}
