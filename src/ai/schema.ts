import { db } from '../utils/db.js';

/** AI feature tables. Everything here is opt-in data the person or a server admin entered on purpose. */
export async function initAiSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS ai_guild (
    guild_id TEXT PRIMARY KEY,
    enabled  INTEGER NOT NULL DEFAULT 1,
    persona  TEXT
  )`;
  await db`CREATE TABLE IF NOT EXISTS ai_persona (
    user_id TEXT PRIMARY KEY,
    persona TEXT NOT NULL
  )`;
  await db`CREATE TABLE IF NOT EXISTS ai_prefs (
    user_id        TEXT PRIMARY KEY,
    memory_enabled INTEGER NOT NULL DEFAULT 0
  )`;
  await db`CREATE TABLE IF NOT EXISTS ai_memory (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    note       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_ai_memory_user ON ai_memory (user_id)`;
  // /ai custom: the person's own AI — a name, the instructions they wrote, and the model they picked.
  await db`CREATE TABLE IF NOT EXISTS ai_custom (
    user_id      TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    instructions TEXT NOT NULL,
    model        TEXT,
    updated_at   INTEGER NOT NULL
  )`;
}
