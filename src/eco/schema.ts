import { db } from '../utils/db.js';

/**
 * Tables added on top of Jade's original economy: transaction ledger, bank,
 * businesses, labs, investments, quests, trading cards, companies and the
 * customisable wallet card. All idempotent — safe to run on every start.
 */
export async function initEcoSchema(): Promise<void> {
  // ── Ledger ────────────────────────────────────────────────────────────────
  await db`CREATE TABLE IF NOT EXISTS eco_ledger (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL,
    delta         INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason        TEXT    NOT NULL DEFAULT 'misc',
    ref           TEXT,
    ts            INTEGER NOT NULL
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_eco_ledger_user_ts ON eco_ledger (user_id, ts)`;

  // ── Bank (columns on the existing economy table) ──────────────────────────
  for (const col of [
    `bank INTEGER NOT NULL DEFAULT 0`,
    `bank_cap INTEGER NOT NULL DEFAULT 5000`,
    `notify_rob INTEGER NOT NULL DEFAULT 1`,
    `total_lost INTEGER NOT NULL DEFAULT 0`,
  ]) {
    try { await db.unsafe(`ALTER TABLE economy ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  await db`CREATE INDEX IF NOT EXISTS idx_economy_balance ON economy (balance)`;

  await db`CREATE TABLE IF NOT EXISTS eco_bank_ledger (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT    NOT NULL,
    delta   INTEGER NOT NULL,
    bank_after INTEGER NOT NULL,
    reason  TEXT    NOT NULL,
    ts      INTEGER NOT NULL
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_eco_bank_ledger_user_ts ON eco_bank_ledger (user_id, ts)`;

  // ── Businesses (one per user) ─────────────────────────────────────────────
  await db`CREATE TABLE IF NOT EXISTS eco_business (
    user_id        TEXT PRIMARY KEY,
    kind           TEXT    NOT NULL,
    bought_at      INTEGER NOT NULL,
    last_collected INTEGER NOT NULL
  )`;

  // ── Labs (one per user) ───────────────────────────────────────────────────
  await db`CREATE TABLE IF NOT EXISTS eco_lab (
    user_id        TEXT PRIMARY KEY,
    level          INTEGER NOT NULL DEFAULT 1,
    ampoules       INTEGER NOT NULL DEFAULT 0,
    bought_at      INTEGER NOT NULL,
    last_collected INTEGER NOT NULL,
    total_spent    INTEGER NOT NULL DEFAULT 0
  )`;

  // ── Investments (one active per user) ─────────────────────────────────────
  await db`CREATE TABLE IF NOT EXISTS eco_investment (
    user_id    TEXT PRIMARY KEY,
    kind       TEXT    NOT NULL,
    cost       INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ends_at    INTEGER NOT NULL
  )`;

  // ── Quests (one active per user) + stats ──────────────────────────────────
  await db`CREATE TABLE IF NOT EXISTS eco_quest (
    user_id    TEXT PRIMARY KEY,
    difficulty TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    reward     INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ends_at    INTEGER NOT NULL
  )`;
  await db`CREATE TABLE IF NOT EXISTS eco_quest_stats (
    user_id       TEXT PRIMARY KEY,
    completed     INTEGER NOT NULL DEFAULT 0,
    total_earned  INTEGER NOT NULL DEFAULT 0
  )`;

  // ── Trading cards ─────────────────────────────────────────────────────────
  await db`CREATE TABLE IF NOT EXISTS eco_card (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   TEXT    NOT NULL,
    category   TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    stars      INTEGER NOT NULL DEFAULT 1,
    standard   INTEGER NOT NULL DEFAULT 1,
    equipped   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_eco_card_owner ON eco_card (owner_id, category)`;
  await db`CREATE TABLE IF NOT EXISTS eco_case (
    user_id   TEXT    NOT NULL,
    case_type TEXT    NOT NULL,
    qty       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, case_type)
  )`;

  // ── Companies ─────────────────────────────────────────────────────────────
  await db`CREATE TABLE IF NOT EXISTS eco_company (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tag         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    owner_id    TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    icon        TEXT,
    privacy     TEXT    NOT NULL DEFAULT 'request',
    level       INTEGER NOT NULL DEFAULT 1,
    vault       INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  )`;
  await db`CREATE TABLE IF NOT EXISTS eco_company_member (
    user_id          TEXT PRIMARY KEY,
    company_id       INTEGER NOT NULL,
    rank             TEXT    NOT NULL DEFAULT 'member',
    joined_at        INTEGER NOT NULL,
    withdrawn_today  INTEGER NOT NULL DEFAULT 0,
    withdraw_day     TEXT
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_company_member_co ON eco_company_member (company_id)`;
  await db`CREATE TABLE IF NOT EXISTS eco_company_invite (
    company_id INTEGER NOT NULL,
    user_id    TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (company_id, user_id)
  )`;
  await db`CREATE TABLE IF NOT EXISTS eco_company_request (
    company_id INTEGER NOT NULL,
    user_id    TEXT    NOT NULL,
    text       TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (company_id, user_id)
  )`;
  await db`CREATE TABLE IF NOT EXISTS eco_company_project (
    company_id  INTEGER PRIMARY KEY,
    kind        TEXT    NOT NULL,
    goal        INTEGER NOT NULL,
    raised      INTEGER NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'funding',
    started_at  INTEGER NOT NULL,
    ends_at     INTEGER,
    pool        INTEGER NOT NULL DEFAULT 0
  )`;
  await db`CREATE TABLE IF NOT EXISTS eco_company_contrib (
    company_id INTEGER NOT NULL,
    user_id    TEXT    NOT NULL,
    amount     INTEGER NOT NULL DEFAULT 0,
    collected  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, user_id)
  )`;
  await db`CREATE TABLE IF NOT EXISTS eco_company_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id    TEXT,
    action     TEXT    NOT NULL,
    amount     INTEGER NOT NULL DEFAULT 0,
    ts         INTEGER NOT NULL
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_company_log ON eco_company_log (company_id, ts)`;
  await db`CREATE TABLE IF NOT EXISTS eco_company_setting (
    company_id       INTEGER PRIMARY KEY,
    ceo_daily_limit  INTEGER
  )`;

  // ── Wallet card customisation ─────────────────────────────────────────────
  await db`CREATE TABLE IF NOT EXISTS eco_wallet_style (
    user_id      TEXT PRIMARY KEY,
    avatar_shape TEXT    NOT NULL DEFAULT 'circle',
    bg_color     TEXT,
    bg_color2    TEXT,
    bg_direction TEXT    NOT NULL DEFAULT 'horizontal',
    has_bg_image INTEGER NOT NULL DEFAULT 0,
    opacity      REAL    NOT NULL DEFAULT 0.55,
    text_color   TEXT,
    message      TEXT,
    hide_wallet  INTEGER NOT NULL DEFAULT 0
  )`;

  // ── Misc one-time / periodic bonus + per-user prefs ───────────────────────
  await db`CREATE TABLE IF NOT EXISTS eco_bonus_claim (
    user_id TEXT NOT NULL,
    kind    TEXT NOT NULL,
    at      INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind)
  )`;
}
