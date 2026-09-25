import { db } from '../utils/db.js';

export async function initGiveawaySchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS giveaways (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT    NOT NULL,
    channel_id  TEXT    NOT NULL,
    message_id  TEXT,
    host_id     TEXT    NOT NULL,
    prize       TEXT    NOT NULL,
    winners     INTEGER NOT NULL DEFAULT 1,
    ends_at     INTEGER NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'active',
    image_url   TEXT,
    pot         INTEGER NOT NULL DEFAULT 0,
    winner_ids  TEXT    NOT NULL DEFAULT '[]',
    drawn       TEXT    NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_giveaways_due ON giveaways (status, ends_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_giveaways_message ON giveaways (message_id)`;
  await db`CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INTEGER NOT NULL,
    user_id     TEXT    NOT NULL,
    entered_at  INTEGER NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
  )`;
}
