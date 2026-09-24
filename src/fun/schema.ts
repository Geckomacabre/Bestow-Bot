import { db } from '../utils/db.js';

/** Tables for the joke/social commands. Idempotent — safe to run on every start. */
export async function initFunSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS juul_state (
    user_id        TEXT    PRIMARY KEY,
    battery        INTEGER NOT NULL DEFAULT 50,
    puffs          INTEGER NOT NULL DEFAULT 0,
    flavor         TEXT    NOT NULL DEFAULT 'Mango',
    color          TEXT    NOT NULL DEFAULT 'silver',
    charging_since INTEGER,
    last_hit       INTEGER
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_juul_puffs ON juul_state (puffs DESC)`;
}
