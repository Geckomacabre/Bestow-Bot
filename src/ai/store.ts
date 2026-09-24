import { db } from '../utils/db.js';
/** Persistence for AI preferences: guild switch/persona, per-user persona, and the opt-in memory notes. (Privacy coverage: see src/privacy/registry.ts.) */

export const MAX_PERSONA = 500;
export const MAX_NOTES = 20;
export const MAX_NOTE = 200;

export class AiStoreError extends Error {}

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();

// ─── Guild ───────────────────────────────────────────────────────────────────

export interface GuildAi { enabled: boolean; persona: string | null }
export async function getGuildAi(guildId: string): Promise<GuildAi> {
  const r = ((await db`SELECT enabled, persona FROM ai_guild WHERE guild_id = ${guildId}`) as { enabled: number; persona: string | null }[])[0];
  return { enabled: r ? !!r.enabled : true, persona: r?.persona ?? null };
}
export async function setGuildEnabled(guildId: string, enabled: boolean): Promise<void> {
  await db`INSERT INTO ai_guild (guild_id, enabled) VALUES (${guildId}, ${enabled ? 1 : 0}) ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled`;
}
export async function setGuildPersona(guildId: string, persona: string | null): Promise<void> {
  const p = persona == null ? null : clean(persona);
  if (p && p.length > MAX_PERSONA) throw new AiStoreError(`Keep the persona under ${MAX_PERSONA} characters.`);
  await db`INSERT INTO ai_guild (guild_id, persona) VALUES (${guildId}, ${p || null}) ON CONFLICT(guild_id) DO UPDATE SET persona = excluded.persona`;
}

// ─── Persona (per user) ──────────────────────────────────────────────────────

export async function getPersona(userId: string): Promise<string | null> {
  return ((await db`SELECT persona FROM ai_persona WHERE user_id = ${userId}`) as { persona: string }[])[0]?.persona ?? null;
}
export async function setPersona(userId: string, persona: string): Promise<void> {
  const p = clean(persona);
  if (!p) throw new AiStoreError('The persona can\'t be empty.');
  if (p.length > MAX_PERSONA) throw new AiStoreError(`Keep the persona under ${MAX_PERSONA} characters.`);
  await db`INSERT INTO ai_persona (user_id, persona) VALUES (${userId}, ${p}) ON CONFLICT(user_id) DO UPDATE SET persona = excluded.persona`;
}
export async function clearPersona(userId: string): Promise<void> { await db`DELETE FROM ai_persona WHERE user_id = ${userId}`; }

// ─── Memory (opt-in, explicit notes only) ────────────────────────────────────

export async function memoryEnabled(userId: string): Promise<boolean> {
  return !!((await db`SELECT memory_enabled FROM ai_prefs WHERE user_id = ${userId}`) as { memory_enabled: number }[])[0]?.memory_enabled;
}
export async function setMemoryEnabled(userId: string, on: boolean): Promise<void> {
  await db`INSERT INTO ai_prefs (user_id, memory_enabled) VALUES (${userId}, ${on ? 1 : 0}) ON CONFLICT(user_id) DO UPDATE SET memory_enabled = excluded.memory_enabled`;
}

export interface Note { id: number; note: string; created_at: number }
export async function listNotes(userId: string): Promise<Note[]> {
  return (await db`SELECT id, note, created_at FROM ai_memory WHERE user_id = ${userId} ORDER BY id`) as Note[];
}
/** Notes are only ever added by the person, on request. Requires memory to be switched on. */
export async function addNote(userId: string, text: string, now = Date.now()): Promise<Note> {
  if (!(await memoryEnabled(userId))) throw new AiStoreError('Turn memory on first with `/ai memory on`.');
  const note = clean(text);
  if (!note) throw new AiStoreError('That note is empty.');
  if (note.length > MAX_NOTE) throw new AiStoreError(`Keep each note under ${MAX_NOTE} characters.`);
  // Atomic cap: insert only while under the limit.
  const rows = (await db`INSERT INTO ai_memory (user_id, note, created_at)
    SELECT ${userId}, ${note}, ${now} WHERE (SELECT COUNT(*) FROM ai_memory WHERE user_id = ${userId}) < ${MAX_NOTES} RETURNING id, note, created_at`) as Note[];
  if (!rows.length) throw new AiStoreError(`You've reached ${MAX_NOTES} notes. Remove one with \`/ai memory forget\` first.`);
  return rows[0]!;
}
export async function forgetNote(userId: string, id: number): Promise<boolean> {
  return ((await db`DELETE FROM ai_memory WHERE user_id = ${userId} AND id = ${id} RETURNING id`) as unknown[]).length > 0;
}
export async function clearNotes(userId: string): Promise<number> {
  return ((await db`DELETE FROM ai_memory WHERE user_id = ${userId} RETURNING id`) as unknown[]).length;
}
/** Turning memory off also erases the notes — "off" should mean gone, not hidden. */
export async function disableMemory(userId: string): Promise<number> {
  await setMemoryEnabled(userId, false);
  return clearNotes(userId);
}
/** Notes that may be shown to the model: only if memory is on. */
export async function notesForPrompt(userId: string): Promise<string[]> {
  return (await memoryEnabled(userId)) ? (await listNotes(userId)).map(n => n.note) : [];
}
