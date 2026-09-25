import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { displaySymbol } from '../eco/cashEmoji';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IConfig = { guild_id: string };

export type ICounting = {
  guild_id: string;
  channel_id: string;
  count: number;
  highscore?: number;
  last_msg?: { message_id: string; author_id: string; number: number; failed?: boolean } | null;
};

export type IRoleCommand = {
  id: number;
  guild_id: string;
  name: string;
  role_id: string;
  group_name: string | null;
  require_roles: string;
  ignore_roles: string;
};

export type IReputation = {
  guild_id: string;
  user_id: string;
  points: number;
};

export type IRepConfig = {
  guild_id: string;
  cooldown_seconds: number;
};

export type IReminder = {
  id: number;
  user_id: string;
  channel_id: string;
  guild_id: string | null;
  message: string;
  fires_at: number;
  created_at: number;
};

export type ICustomCommand = {
  id: number;
  guild_id: string;
  name: string;
  trigger_type: 'command' | 'startswith' | 'contains' | 'regex' | 'exact';
  trigger: string;
  response: string;
  enabled: number;
  created_by: string;
};

export type ITwitchFeed = {
  id: number;
  guild_id: string;
  channel_id: string;
  twitch_username: string;
  message: string | null;
  live: number;
  last_checked: number | null;
};

export type IYoutubeFeed = {
  id: number;
  guild_id: string;
  channel_id: string;
  youtube_channel_id: string;
  youtube_channel_name: string | null;
  last_video_id: string | null;
  message: string | null;
};

export type IRedditFeed = {
  id: number;
  guild_id: string;
  channel_id: string;
  subreddit: string;
  nsfw: number;
  last_post_id: string | null;
};

export type IRssFeed = {
  id: number;
  guild_id: string;
  channel_id: string;
  feed_url: string;
  last_item_id: string | null;
};

export type IServerStat = {
  guild_id: string;
  hour_bucket: number;
  messages: number;
  joins: number;
  leaves: number;
};

export type IStreamingConfig = {
  guild_id: string;
  announce_channel_id: string | null;
  give_role_id: string | null;
  message: string;
};

export type IRsvpEvent = {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  title: string;
  description: string | null;
  starts_at: number;
  created_by: string;
  created_at: number;
};

export type IRsvpResponse = {
  event_id: number;
  user_id: string;
  status: 'attending' | 'declined' | 'maybe';
};

export type IScheduledTask = {
  id: number;
  type: string;
  guild_id: string | null;
  user_id: string | null;
  channel_id: string | null;
  data: string | null;
  fires_at: number;
  fired: number;
};

export type IEconomy = {
  user_id: string;
  balance: number;
  total_earned: number;
};

export type IEconomyConfig = {
  guild_id: string;
  currency_name: string;
  currency_symbol: string;
  starting_balance: number;
  daily_min: number;
  daily_max: number;
  weekly_min: number;
  weekly_max: number;
  monthly_min: number;
  monthly_max: number;
  yearly_min: number;
  yearly_max: number;
  work_min: number;
  work_max: number;
  lottery_channel_id: string | null;
  lottery_enabled: number;
  lottery_prize: number;
};

export type IEconomyProtection = {
  guild_id: string;
  user_id: string;
  expires_at: number;
};

export type IEconomyBoost = {
  id: number;
  guild_id: string;
  user_id: string;
  type: string;
  multiplier: number;
  expires_at: number;
};

export type IXp = {
  guild_id: string;
  user_id: string;
  xp: number;
  level: number;
  total_messages: number;
};

export type IXpConfig = {
  guild_id: string;
  enabled: number;
  xp_min: number;
  xp_max: number;
  cooldown_seconds: number;
  level_up_channel_id: string | null;
  level_up_message: string;
  level_up_announce: number;
  background_url: string | null;
};

export type ILevelRole = {
  id: number;
  guild_id: string;
  level: number;
  role_id: string;
};

export type IFreeGameConfig = {
  guild_id: string;
  channel_id: string | null;
  platforms: string; // JSON array e.g. '["epic","steam","gog"]'
  ping_role_id: string | null;
};

export type IFreeGamePosted = {
  id: number;
  guild_id: string;
  game_id: string;
  posted_at: number;
};

export type IBirthday = {
  guild_id: string;
  user_id: string;
  month: number;
  day: number;
};

export type IBirthdayConfig = {
  guild_id: string;
  channel_id: string | null;
  enabled: number;
};

export type ITimezone = {
  user_id: string;
  timezone: string;
};

export type ITimezoneMessage = {
  guild_id: string;
  channel_id: string;
  message_id: string;
};

export type IStatChannel = {
  id: number;
  guild_id: string;
  channel_id: string;
  type: string;
  label: string;
};

export type IReactionRole = {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string;
  emoji: string;
  role_id: string;
};

export type ITopicChannel = {
  id: number;
  guild_id: string;
  channel_id: string;
  interval_seconds: number;
  last_posted: number;
  mode: 'sequential' | 'random';
};

export type ITopic = {
  id: number;
  guild_id: string;
  channel_id: string;
  text: string;
  order_index: number;
};

export type IStarboardConfig = {
  guild_id: string;
  channel_id: string | null;
  threshold: number;
  emoji: string;
  enabled: number;
};

export type IStarboardPost = {
  id: number;
  guild_id: string;
  source_message_id: string;
  starboard_message_id: string;
  stars: number;
};

// ─── DB instance ─────────────────────────────────────────────────────────────

// DB_PATH overrides the location (':memory:' for tests). Default is <project>/data/db.sqlite,
// absolute so the working directory can never silently point us at an empty database.
const DB_PATH = Bun.env.DB_PATH ?? path.resolve(import.meta.dir, '../../data/db.sqlite');
if (DB_PATH !== ':memory:') {
  // A live SQLite DB (+WAL) inside a synced folder gets corrupted — refuse to start there.
  if (/onedrive|dropbox|google drive/i.test(DB_PATH) && Bun.env.ALLOW_SYNCED_DB !== '1') {
    throw new Error(`Refusing to open the database inside a synced folder (${DB_PATH}). Move the project or set DB_PATH.`);
  }
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
export const db = new SQL({ adapter: 'sqlite', filename: DB_PATH });

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initDb() {
  if (db.options.adapter === 'sqlite') {
    try {
      await db`PRAGMA foreign_keys = ON;`;
      await db`PRAGMA journal_mode = WAL;`;
      await db`PRAGMA busy_timeout = 5000;`;
      await db`PRAGMA wal_autocheckpoint = 1000;`;
      await db`PRAGMA synchronous = NORMAL;`;
    } catch (err) {
      console.error('Failed to set PRAGMA settings:', err);
    }
  }

  await db`CREATE TABLE IF NOT EXISTS config (guild_id TEXT PRIMARY KEY)`;

  await db`CREATE TABLE IF NOT EXISTS counting (
    channel_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    highscore  INTEGER NOT NULL DEFAULT 0,
    last_msg   TEXT DEFAULT '{}',
    FOREIGN KEY (guild_id) REFERENCES config(guild_id) ON DELETE CASCADE
  )`;

  await db`CREATE TABLE IF NOT EXISTS rolecommands (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT NOT NULL,
    name          TEXT NOT NULL,
    role_id       TEXT NOT NULL,
    group_name    TEXT,
    require_roles TEXT NOT NULL DEFAULT '[]',
    ignore_roles  TEXT NOT NULL DEFAULT '[]'
  )`;

  await db`CREATE TABLE IF NOT EXISTS reputation (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    points   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS rep_config (
    guild_id         TEXT PRIMARY KEY,
    cooldown_seconds INTEGER NOT NULL DEFAULT 3600
  )`;

  await db`CREATE TABLE IF NOT EXISTS rep_cooldowns (
    guild_id     TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    to_user_id   TEXT NOT NULL,
    last_rep     INTEGER NOT NULL,
    PRIMARY KEY (guild_id, from_user_id, to_user_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS reminders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id   TEXT,
    message    TEXT NOT NULL,
    fires_at   INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`;

  await db`CREATE TABLE IF NOT EXISTS custom_commands (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    name         TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger      TEXT NOT NULL,
    response     TEXT NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT NOT NULL
  )`;

  await db`CREATE TABLE IF NOT EXISTS twitch_feeds (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL,
    channel_id       TEXT NOT NULL,
    twitch_username  TEXT NOT NULL,
    message          TEXT,
    live             INTEGER NOT NULL DEFAULT 0,
    last_checked     INTEGER
  )`;

  await db`CREATE TABLE IF NOT EXISTS youtube_feeds (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id             TEXT NOT NULL,
    channel_id           TEXT NOT NULL,
    youtube_channel_id   TEXT NOT NULL,
    youtube_channel_name TEXT,
    last_video_id        TEXT,
    message              TEXT
  )`;

  await db`CREATE TABLE IF NOT EXISTS reddit_feeds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    channel_id   TEXT NOT NULL,
    subreddit    TEXT NOT NULL,
    nsfw         INTEGER NOT NULL DEFAULT 0,
    last_post_id TEXT
  )`;

  await db`CREATE TABLE IF NOT EXISTS rss_feeds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    channel_id   TEXT NOT NULL,
    feed_url     TEXT NOT NULL,
    last_item_id TEXT
  )`;

  await db`CREATE TABLE IF NOT EXISTS serverstats (
    guild_id    TEXT NOT NULL,
    hour_bucket INTEGER NOT NULL,
    messages    INTEGER NOT NULL DEFAULT 0,
    joins       INTEGER NOT NULL DEFAULT 0,
    leaves      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, hour_bucket)
  )`;

  await db`CREATE TABLE IF NOT EXISTS streaming_config (
    guild_id           TEXT PRIMARY KEY,
    announce_channel_id TEXT,
    give_role_id       TEXT,
    message            TEXT NOT NULL DEFAULT 'Now live: **{username}** is streaming **{game}**!\n{url}'
  )`;

  await db`CREATE TABLE IF NOT EXISTS rsvp_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT,
    title       TEXT NOT NULL,
    description TEXT,
    starts_at   INTEGER NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  )`;

  await db`CREATE TABLE IF NOT EXISTS rsvp_responses (
    event_id INTEGER NOT NULL,
    user_id  TEXT NOT NULL,
    status   TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    guild_id   TEXT,
    user_id    TEXT,
    channel_id TEXT,
    data       TEXT,
    fires_at   INTEGER NOT NULL,
    fired      INTEGER NOT NULL DEFAULT 0
  )`;

  // Migrate economy + cooldowns from per-guild to global (user-only) schema
  {
    const economyCols = await db`PRAGMA table_info(economy)` as any[];
    if (economyCols.length === 0) {
      await db`CREATE TABLE economy (
        user_id      TEXT PRIMARY KEY,
        balance      INTEGER NOT NULL DEFAULT 0,
        total_earned INTEGER NOT NULL DEFAULT 0
      )`;
    } else if (economyCols.some((c: any) => c.name === 'guild_id')) {
      await db`CREATE TABLE economy_v2 (
        user_id      TEXT PRIMARY KEY,
        balance      INTEGER NOT NULL DEFAULT 0,
        total_earned INTEGER NOT NULL DEFAULT 0
      )`;
      await db`INSERT OR IGNORE INTO economy_v2 (user_id, balance, total_earned)
        SELECT user_id, MAX(balance), SUM(total_earned) FROM economy GROUP BY user_id`;
      await db`DROP TABLE economy`;
      await db`ALTER TABLE economy_v2 RENAME TO economy`;
    }
  }

  await db`CREATE TABLE IF NOT EXISTS economy_config (
    guild_id         TEXT PRIMARY KEY,
    currency_name    TEXT NOT NULL DEFAULT 'coins',
    currency_symbol  TEXT NOT NULL DEFAULT '🪙',
    starting_balance INTEGER NOT NULL DEFAULT 0,
    daily_min        INTEGER NOT NULL DEFAULT 100,
    daily_max        INTEGER NOT NULL DEFAULT 500,
    weekly_min       INTEGER NOT NULL DEFAULT 500,
    weekly_max       INTEGER NOT NULL DEFAULT 2000,
    monthly_min      INTEGER NOT NULL DEFAULT 2000,
    monthly_max      INTEGER NOT NULL DEFAULT 8000,
    yearly_min       INTEGER NOT NULL DEFAULT 25000,
    yearly_max       INTEGER NOT NULL DEFAULT 100000,
    work_min         INTEGER NOT NULL DEFAULT 50,
    work_max         INTEGER NOT NULL DEFAULT 200
  )`;

  {
    const cooldownCols = await db`PRAGMA table_info(economy_cooldowns)` as any[];
    if (cooldownCols.length === 0) {
      await db`CREATE TABLE economy_cooldowns (
        user_id   TEXT NOT NULL,
        type      TEXT NOT NULL,
        last_used INTEGER NOT NULL,
        PRIMARY KEY (user_id, type)
      )`;
    } else if (cooldownCols.some((c: any) => c.name === 'guild_id')) {
      await db`CREATE TABLE economy_cooldowns_v2 (
        user_id   TEXT NOT NULL,
        type      TEXT NOT NULL,
        last_used INTEGER NOT NULL,
        PRIMARY KEY (user_id, type)
      )`;
      await db`INSERT OR IGNORE INTO economy_cooldowns_v2 (user_id, type, last_used)
        SELECT user_id, type, MAX(last_used) FROM economy_cooldowns GROUP BY user_id, type`;
      await db`DROP TABLE economy_cooldowns`;
      await db`ALTER TABLE economy_cooldowns_v2 RENAME TO economy_cooldowns`;
    }
  }

  await db`CREATE TABLE IF NOT EXISTS xp (
    guild_id       TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    xp             INTEGER NOT NULL DEFAULT 0,
    level          INTEGER NOT NULL DEFAULT 0,
    total_messages INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS xp_config (
    guild_id            TEXT PRIMARY KEY,
    enabled             INTEGER NOT NULL DEFAULT 1,
    xp_min              INTEGER NOT NULL DEFAULT 15,
    xp_max              INTEGER NOT NULL DEFAULT 25,
    cooldown_seconds    INTEGER NOT NULL DEFAULT 60,
    level_up_channel_id TEXT,
    level_up_message    TEXT NOT NULL DEFAULT 'GG {user}, you just advanced to **level {level}**! 🎉',
    level_up_announce   INTEGER NOT NULL DEFAULT 1
  )`;

  // Migrations for existing installations
  try { await db`ALTER TABLE economy_config ADD COLUMN weekly_min INTEGER NOT NULL DEFAULT 500`; } catch {}
  try { await db`ALTER TABLE economy_config ADD COLUMN weekly_max INTEGER NOT NULL DEFAULT 2000`; } catch {}
  try { await db`ALTER TABLE economy_config ADD COLUMN monthly_min INTEGER NOT NULL DEFAULT 2000`; } catch {}
  try { await db`ALTER TABLE economy_config ADD COLUMN monthly_max INTEGER NOT NULL DEFAULT 8000`; } catch {}
  try { await db`ALTER TABLE economy_config ADD COLUMN yearly_min INTEGER NOT NULL DEFAULT 25000`; } catch {}
  try { await db`ALTER TABLE economy_config ADD COLUMN yearly_max INTEGER NOT NULL DEFAULT 100000`; } catch {}
  try { await db`ALTER TABLE xp_config ADD COLUMN level_up_announce INTEGER NOT NULL DEFAULT 1`; } catch {}
  try { await db`ALTER TABLE xp_config ADD COLUMN background_url TEXT`; } catch {}

  await db`CREATE TABLE IF NOT EXISTS level_roles (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    level    INTEGER NOT NULL,
    role_id  TEXT NOT NULL
  )`;

  await db`CREATE TABLE IF NOT EXISTS free_game_config (
    guild_id     TEXT PRIMARY KEY,
    channel_id   TEXT,
    platforms    TEXT NOT NULL DEFAULT '["epic","steam","gog"]',
    ping_role_id TEXT
  )`;

  await db`CREATE TABLE IF NOT EXISTS free_game_posted (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id  TEXT NOT NULL,
    game_id   TEXT NOT NULL,
    posted_at INTEGER NOT NULL,
    UNIQUE(guild_id, game_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS birthdays (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    month    INTEGER NOT NULL,
    day      INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS birthday_config (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT,
    enabled    INTEGER NOT NULL DEFAULT 1
  )`;

  await db`CREATE TABLE IF NOT EXISTS timezones (
    user_id  TEXT PRIMARY KEY,
    timezone TEXT NOT NULL
  )`;

  await db`CREATE TABLE IF NOT EXISTS timezone_user (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    timezone TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS timezone_message (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL
  )`;

  await db`CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    content    TEXT NOT NULL,
    owner_id   TEXT NOT NULL,
    uses       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE (guild_id, name)
  )`;

  await db`CREATE TABLE IF NOT EXISTS stat_channels (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    type       TEXT NOT NULL,
    label      TEXT NOT NULL
  )`;

  await db`CREATE TABLE IF NOT EXISTS reaction_roles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    role_id    TEXT NOT NULL,
    UNIQUE(guild_id, message_id, emoji)
  )`;

  await db`CREATE TABLE IF NOT EXISTS topic_channels (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL,
    channel_id       TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL DEFAULT 86400,
    last_posted      INTEGER NOT NULL DEFAULT 0,
    mode             TEXT NOT NULL DEFAULT 'sequential',
    UNIQUE(guild_id, channel_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS topics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    text        TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0
  )`;

  await db`CREATE TABLE IF NOT EXISTS starboard_config (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT,
    threshold  INTEGER NOT NULL DEFAULT 3,
    emoji      TEXT NOT NULL DEFAULT '⭐',
    enabled    INTEGER NOT NULL DEFAULT 1
  )`;

  await db`CREATE TABLE IF NOT EXISTS starboard_posts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id            TEXT NOT NULL,
    source_message_id   TEXT NOT NULL,
    starboard_message_id TEXT NOT NULL,
    stars               INTEGER NOT NULL DEFAULT 0,
    UNIQUE(guild_id, source_message_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS bot_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`;

  await db`CREATE TABLE IF NOT EXISTS news_config (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    category   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    UNIQUE(guild_id, category)
  )`;

  await db`CREATE TABLE IF NOT EXISTS news_posted (
    guild_id  TEXT NOT NULL,
    item_id   TEXT NOT NULL,
    posted_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, item_id)
  )`;

  await db`CREATE TABLE IF NOT EXISTS mediaguess_config (
    guild_id         TEXT PRIMARY KEY,
    movie_channel_id TEXT,
    tv_channel_id    TEXT
  )`;
  try { await db`ALTER TABLE mediaguess_config ADD COLUMN game_channel_id TEXT`; } catch {}
  try { await db`ALTER TABLE mediaguess_config ADD COLUMN music_channel_id TEXT`; } catch {}

  // Persists the in-progress round per channel so a bot restart resumes the
  // current round instead of discarding it and starting a new one.
  await db`CREATE TABLE IF NOT EXISTS mediaguess_rounds (
    channel_id   TEXT PRIMARY KEY,
    guild_id     TEXT NOT NULL,
    type         TEXT NOT NULL,
    media        TEXT NOT NULL,
    hint_order   TEXT NOT NULL,
    hints_used   INTEGER NOT NULL DEFAULT 0,
    message_id   TEXT,
    started_at   INTEGER NOT NULL,
    last_hint_at INTEGER NOT NULL DEFAULT 0
  )`;
  try { await db`ALTER TABLE mediaguess_rounds ADD COLUMN user_hints TEXT NOT NULL DEFAULT '{}'`; } catch {}

  await db`CREATE TABLE IF NOT EXISTS economy_protection (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`;

  // Sticky messages: one per channel, re-posted so it stays at the bottom.
  await db`CREATE TABLE IF NOT EXISTS sticky_messages (
    guild_id    TEXT NOT NULL,
    channel_id  TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    message_id  TEXT,
    embed       INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT,
    created_at  INTEGER NOT NULL
  )`;
  // 'text' stickies show `content` verbatim; 'jackpot' ones rebuild their text
  // from the live pot on every repost, so the figure is never stale.
  try { await db`ALTER TABLE sticky_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'`; } catch {}

  // Progressive jackpot: a shared pot fed by a slice of every loss across all
  // casino games, paid out whole when someone hits it. Coins are redistributed,
  // never removed — the house takes nothing.
  await db`CREATE TABLE IF NOT EXISTS jackpot (
    guild_id    TEXT PRIMARY KEY,
    amount      INTEGER NOT NULL DEFAULT 0,
    seed        INTEGER NOT NULL DEFAULT 5000,
    last_winner TEXT,
    last_amount INTEGER NOT NULL DEFAULT 0,
    last_won_at INTEGER
  )`;

  await db`CREATE TABLE IF NOT EXISTS economy_boosts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    type       TEXT NOT NULL,
    multiplier REAL NOT NULL DEFAULT 1.0,
    expires_at INTEGER NOT NULL
  )`;

  // Tracks the last time ANYONE in a guild claimed a given command (work/daily/
  // beg) — separate from the per-user economy_cooldowns table — so a growing
  // drought bonus can be offered to whoever breaks the dry spell.
  await db`CREATE TABLE IF NOT EXISTS economy_drought (
    guild_id  TEXT NOT NULL,
    type      TEXT NOT NULL,
    last_used INTEGER NOT NULL,
    PRIMARY KEY (guild_id, type)
  )`;

  try { await db`ALTER TABLE economy_config ADD COLUMN lottery_channel_id TEXT`; } catch {}
  try { await db`ALTER TABLE economy_config ADD COLUMN lottery_enabled INTEGER NOT NULL DEFAULT 0`; } catch {}
  try { await db`ALTER TABLE economy_config ADD COLUMN lottery_prize INTEGER NOT NULL DEFAULT 50000`; } catch {}
  // Migrate existing rows still at the old 1 000 default
  try { await db`UPDATE economy_config SET lottery_prize = 50000 WHERE lottery_prize = 1000`; } catch {}

  await db`CREATE TABLE IF NOT EXISTS game_stats (
    guild_id      TEXT    NOT NULL,
    user_id       TEXT    NOT NULL,
    game          TEXT    NOT NULL,
    wins          INTEGER NOT NULL DEFAULT 0,
    losses        INTEGER NOT NULL DEFAULT 0,
    total_wagered INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, game)
  )`;

  await db`CREATE TABLE IF NOT EXISTS game_xp_daily (
    guild_id TEXT    NOT NULL,
    user_id  TEXT    NOT NULL,
    date     TEXT    NOT NULL,
    total    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, date)
  )`;
  try { await db`DELETE FROM game_xp_daily WHERE date < date('now', '-7 days')`; } catch {}

  // Bestow additions (ledger, bank, businesses, cards, companies …). Dynamic import: the
  // schema module needs `db` from this file, so a static import would be circular.
  const { initEcoSchema } = await import('../eco/schema.js');
  await initEcoSchema();
  const { initFunSchema } = await import('../fun/schema.js');
  await initFunSchema();
  const { initAiSchema } = await import('../ai/schema.js');
  await initAiSchema();
  const { initHeistSchemas } = await import('../heist/schema.js');
  await initHeistSchemas();
}

export async function closeDb(): Promise<void> {
  if (db.options.adapter === 'sqlite') {
    try {
      await db`PRAGMA wal_checkpoint(TRUNCATE);`;
    } catch (err) {
      console.error('Failed to checkpoint WAL on shutdown:', err);
    }
  }
  await db.close();
}

// ─── News feeds ───────────────────────────────────────────────────────────────

export type INewsConfig = { id: number; guild_id: string; category: string; channel_id: string };

export async function setNewsConfig(guild_id: string, category: string, channel_id: string): Promise<void> {
  await ensureConfig(guild_id);
  await db`INSERT INTO news_config (guild_id, category, channel_id) VALUES (${guild_id}, ${category}, ${channel_id})
    ON CONFLICT(guild_id, category) DO UPDATE SET channel_id = excluded.channel_id`;
}

export async function removeNewsConfig(guild_id: string, category: string): Promise<boolean> {
  const result = await db`DELETE FROM news_config WHERE guild_id = ${guild_id} AND category = ${category} RETURNING id`;
  return result.length > 0;
}

export async function getNewsConfigs(guild_id: string): Promise<INewsConfig[]> {
  const rows = await db`SELECT * FROM news_config WHERE guild_id = ${guild_id}`;
  return rows as INewsConfig[];
}

export async function getAllNewsConfigs(): Promise<INewsConfig[]> {
  const rows = await db`SELECT * FROM news_config`;
  return rows as INewsConfig[];
}

export async function isNewsPosted(guild_id: string, item_id: string): Promise<boolean> {
  const [row] = await db`SELECT 1 FROM news_posted WHERE guild_id = ${guild_id} AND item_id = ${item_id}`;
  return !!row;
}

export async function markNewsPosted(guild_id: string, item_id: string): Promise<void> {
  await db`INSERT OR IGNORE INTO news_posted (guild_id, item_id, posted_at) VALUES (${guild_id}, ${item_id}, ${Date.now()})`;
}

export async function pruneOldNews(cutoffMs: number): Promise<void> {
  await db`DELETE FROM news_posted WHERE posted_at < ${cutoffMs}`;
}

// ─── Media guessing game ──────────────────────────────────────────────────────

export type IMediaGuessConfig = {
  guild_id: string;
  movie_channel_id: string | null;
  tv_channel_id: string | null;
  game_channel_id: string | null;
  music_channel_id: string | null;
};

export async function getMediaGuessConfig(guild_id: string): Promise<IMediaGuessConfig | null> {
  const [row] = await db`SELECT * FROM mediaguess_config WHERE guild_id = ${guild_id}`;
  return row ? (row as IMediaGuessConfig) : null;
}

const MEDIAGUESS_COLUMN: Record<'movie' | 'tv' | 'game' | 'music', string> = {
  movie: 'movie_channel_id', tv: 'tv_channel_id', game: 'game_channel_id', music: 'music_channel_id',
};

export async function setMediaGuessConfig(guild_id: string, type: 'movie' | 'tv' | 'game' | 'music', channel_id: string | null): Promise<void> {
  await ensureConfig(guild_id);
  const column = MEDIAGUESS_COLUMN[type];
  await db`INSERT INTO mediaguess_config (guild_id, ${db(column)}) VALUES (${guild_id}, ${channel_id})
    ON CONFLICT(guild_id) DO UPDATE SET ${db(column)} = excluded.${db(column)}`;
}

export type IMediaGuessRound = {
  channel_id: string;
  guild_id: string;
  type: string;
  media: string;       // JSON-serialized MediaEntry
  hint_order: string;  // JSON-serialized number[]
  hints_used: number;  // how many hints have been revealed this round (shared, not per-user)
  message_id: string | null;
  started_at: number;
  last_hint_at: number; // timestamp of the last hint reveal, for the shared cooldown
  user_hints: string;   // vestigial — hints were briefly per-user, kept for schema compat, always '{}'
};

export async function saveMediaGuessRound(row: IMediaGuessRound): Promise<void> {
  await db`
    INSERT INTO mediaguess_rounds (channel_id, guild_id, type, media, hint_order, hints_used, message_id, started_at, last_hint_at, user_hints)
    VALUES (${row.channel_id}, ${row.guild_id}, ${row.type}, ${row.media}, ${row.hint_order}, ${row.hints_used}, ${row.message_id}, ${row.started_at}, ${row.last_hint_at}, ${row.user_hints})
    ON CONFLICT(channel_id) DO UPDATE SET
      guild_id = excluded.guild_id, type = excluded.type, media = excluded.media,
      hint_order = excluded.hint_order, hints_used = excluded.hints_used,
      message_id = excluded.message_id, started_at = excluded.started_at, last_hint_at = excluded.last_hint_at,
      user_hints = excluded.user_hints
  `;
}

export async function getAllMediaGuessRounds(): Promise<IMediaGuessRound[]> {
  const rows = await db`SELECT * FROM mediaguess_rounds`;
  return rows as IMediaGuessRound[];
}

export async function deleteMediaGuessRound(channel_id: string): Promise<void> {
  await db`DELETE FROM mediaguess_rounds WHERE channel_id = ${channel_id}`;
}

export async function getAllMediaGuessConfigs(): Promise<IMediaGuessConfig[]> {
  const rows = await db`SELECT * FROM mediaguess_config
    WHERE movie_channel_id IS NOT NULL OR tv_channel_id IS NOT NULL
       OR game_channel_id IS NOT NULL OR music_channel_id IS NOT NULL`;
  return rows as IMediaGuessConfig[];
}

// ─── Bot config ───────────────────────────────────────────────────────────────

export async function getBotConfig(key: string): Promise<string | null> {
  const [row] = await db`SELECT value FROM bot_config WHERE key = ${key}`;
  return row ? (row.value as string) : null;
}

export async function setBotConfig(key: string, value: string): Promise<void> {
  await db`INSERT INTO bot_config (key, value) VALUES (${key}, ${value})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
}

export async function deleteBotConfig(key: string): Promise<void> {
  await db`DELETE FROM bot_config WHERE key = ${key}`;
}

// ─── Guild cleanup ────────────────────────────────────────────────────────────

/** Deletes everything a server configured when the bot is removed from it. */
export async function removeGuild(guild_id: string) {
  await db`DELETE FROM config WHERE guild_id = ${guild_id}`;
  for (const table of [
    'counting', 'rolecommands', 'reputation', 'rep_config', 'rep_cooldowns', 'reminders',
    'custom_commands', 'twitch_feeds', 'youtube_feeds', 'reddit_feeds', 'rss_feeds', 'serverstats',
    'streaming_config', 'rsvp_events', 'economy_config', 'xp', 'xp_config', 'level_roles',
    'free_game_config', 'free_game_posted', 'birthdays', 'birthday_config', 'timezone_user', 'timezone_message',
    'stat_channels', 'reaction_roles', 'topic_channels', 'topics', 'starboard_config', 'starboard_posts',
    'tags', 'news_config', 'mediaguess_rounds', 'mediaguess_config', 'economy_drought',
  ]) {
    await db`DELETE FROM ${db(table)} WHERE guild_id = ${guild_id}`.catch(() => {});
  }
}

export async function ensureConfig(guild_id: string) {
  await db`INSERT INTO config (guild_id) VALUES (${guild_id}) ON CONFLICT(guild_id) DO NOTHING`;
}

// ─── Counting ─────────────────────────────────────────────────────────────────

export async function getCounting(channel_id: string): Promise<ICounting | null> {
  const [row] = await db`SELECT * FROM counting WHERE channel_id = ${channel_id}`;
  if (!row) return null;
  return {
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    count: row.count,
    highscore: row.highscore,
    last_msg: row.last_msg && row.last_msg !== '{}' ? JSON.parse(row.last_msg) : undefined,
  };
}

export async function setCounting(
  channel_id: string,
  guild_id: string,
  count = 0,
  highscore = 0,
  last_msg?: { message_id: string; author_id: string; number: number }
) {
  await ensureConfig(guild_id);
  const lastMsgStr = last_msg ? JSON.stringify(last_msg) : '{}';
  await db`
    INSERT INTO counting (channel_id, guild_id, count, highscore, last_msg)
    VALUES (${channel_id}, ${guild_id}, ${count}, ${highscore}, ${lastMsgStr})
    ON CONFLICT(channel_id) DO UPDATE SET
      count = excluded.count, highscore = excluded.highscore, last_msg = excluded.last_msg
  `;
}

export async function updateCounting(
  channel_id: string,
  fields: Partial<Pick<ICounting, 'count' | 'highscore' | 'last_msg'>>
) {
  await db`
    UPDATE counting SET
      count     = ${fields.count     !== undefined ? fields.count     : db`count`},
      highscore = ${fields.highscore !== undefined ? fields.highscore : db`highscore`},
      last_msg  = ${fields.last_msg  !== undefined ? JSON.stringify(fields.last_msg) : db`last_msg`}
    WHERE channel_id = ${channel_id}
  `;
}

export async function unsetCounting(channel_id: string) {
  await db`DELETE FROM counting WHERE channel_id = ${channel_id}`;
}

export async function removeCountingByChannelId(guild_id: string, channel_id: string) {
  await db`DELETE FROM counting WHERE channel_id = ${channel_id} AND guild_id = ${guild_id}`;
}

// ─── Mod config ───────────────────────────────────────────────────────────────

// ─── Warnings ─────────────────────────────────────────────────────────────────

// ─── Automod ──────────────────────────────────────────────────────────────────

// ─── Log config ───────────────────────────────────────────────────────────────

// ─── Antiphishing ─────────────────────────────────────────────────────────────

// ─── Autorole ─────────────────────────────────────────────────────────────────

// ─── Role commands ────────────────────────────────────────────────────────────

export async function getRoleCommands(guild_id: string): Promise<IRoleCommand[]> {
  const rows = await db`SELECT * FROM rolecommands WHERE guild_id = ${guild_id} ORDER BY name`;
  return rows as IRoleCommand[];
}

export async function addRoleCommand(guild_id: string, name: string, role_id: string, group_name: string | null = null): Promise<IRoleCommand> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO rolecommands (guild_id, name, role_id, group_name)
    VALUES (${guild_id}, ${name}, ${role_id}, ${group_name})
    RETURNING *
  `;
  return row as IRoleCommand;
}

export async function removeRoleCommand(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM rolecommands WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function getRoleCommandByName(guild_id: string, name: string): Promise<IRoleCommand | null> {
  const [row] = await db`SELECT * FROM rolecommands WHERE guild_id = ${guild_id} AND LOWER(name) = LOWER(${name})`;
  return (row as IRoleCommand) || null;
}

// ─── Voice roles ──────────────────────────────────────────────────────────────

// ─── Reputation ───────────────────────────────────────────────────────────────

export async function getReputation(guild_id: string, user_id: string): Promise<IReputation | null> {
  const [row] = await db`SELECT * FROM reputation WHERE guild_id = ${guild_id} AND user_id = ${user_id}`;
  return (row as IReputation) || null;
}

export async function adjustReputation(guild_id: string, user_id: string, delta: number): Promise<number> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO reputation (guild_id, user_id, points) VALUES (${guild_id}, ${user_id}, ${delta})
    ON CONFLICT(guild_id, user_id) DO UPDATE SET points = points + ${delta}
    RETURNING points
  `;
  return row.points as number;
}

export async function getRepLeaderboard(guild_id: string, limit = 10): Promise<(IReputation & { rank: number })[]> {
  const rows = await db`
    SELECT *, RANK() OVER (ORDER BY points DESC) as rank
    FROM reputation WHERE guild_id = ${guild_id}
    ORDER BY points DESC LIMIT ${limit}
  `;
  return rows as (IReputation & { rank: number })[];
}

export async function getRepConfig(guild_id: string): Promise<IRepConfig> {
  const [row] = await db`SELECT * FROM rep_config WHERE guild_id = ${guild_id}`;
  return (row as IRepConfig) || { guild_id, cooldown_seconds: 3600 };
}

export async function checkRepCooldown(guild_id: string, from_user_id: string, to_user_id: string): Promise<number> {
  const [row] = await db`
    SELECT last_rep FROM rep_cooldowns
    WHERE guild_id = ${guild_id} AND from_user_id = ${from_user_id} AND to_user_id = ${to_user_id}
  `;
  return row ? (row.last_rep as number) : 0;
}

export async function setRepCooldown(guild_id: string, from_user_id: string, to_user_id: string) {
  await db`
    INSERT INTO rep_cooldowns (guild_id, from_user_id, to_user_id, last_rep)
    VALUES (${guild_id}, ${from_user_id}, ${to_user_id}, ${Date.now()})
    ON CONFLICT(guild_id, from_user_id, to_user_id) DO UPDATE SET last_rep = excluded.last_rep
  `;
}

// ─── Tickets ──────────────────────────────────────────────────────────────────

// ─── Stream VC request-to-join ──────────────────────────────────────────────────

// Only guilds that have somewhere to post results — a log channel configured.
// ─── Reminders ────────────────────────────────────────────────────────────────

export async function createReminder(user_id: string, channel_id: string, guild_id: string | null, message: string, fires_at: number): Promise<IReminder> {
  const [row] = await db`
    INSERT INTO reminders (user_id, channel_id, guild_id, message, fires_at, created_at)
    VALUES (${user_id}, ${channel_id}, ${guild_id}, ${message}, ${fires_at}, ${Date.now()})
    RETURNING *
  `;
  return row as IReminder;
}

export async function getReminders(user_id: string): Promise<IReminder[]> {
  const rows = await db`SELECT * FROM reminders WHERE user_id = ${user_id} ORDER BY fires_at ASC`;
  return rows as IReminder[];
}

export async function deleteReminder(id: number, user_id: string): Promise<boolean> {
  const result = await db`DELETE FROM reminders WHERE id = ${id} AND user_id = ${user_id} RETURNING id`;
  return result.length > 0;
}

export async function getPendingReminders(before: number): Promise<IReminder[]> {
  const rows = await db`SELECT * FROM reminders WHERE fires_at <= ${before}`;
  return rows as IReminder[];
}

export async function fireReminder(id: number) {
  await db`DELETE FROM reminders WHERE id = ${id}`;
}

// ─── Custom commands ──────────────────────────────────────────────────────────

export async function getCustomCommands(guild_id: string): Promise<ICustomCommand[]> {
  const rows = await db`SELECT * FROM custom_commands WHERE guild_id = ${guild_id} AND enabled = 1 ORDER BY name`;
  return rows as ICustomCommand[];
}

export async function getAllCustomCommands(guild_id: string): Promise<ICustomCommand[]> {
  const rows = await db`SELECT * FROM custom_commands WHERE guild_id = ${guild_id} ORDER BY name`;
  return rows as ICustomCommand[];
}

export async function createCustomCommand(
  guild_id: string, name: string, trigger_type: ICustomCommand['trigger_type'],
  trigger: string, response: string, created_by: string
): Promise<ICustomCommand> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO custom_commands (guild_id, name, trigger_type, trigger, response, created_by)
    VALUES (${guild_id}, ${name}, ${trigger_type}, ${trigger}, ${response}, ${created_by})
    RETURNING *
  `;
  return row as ICustomCommand;
}

export async function editCustomCommand(id: number, guild_id: string, response: string): Promise<boolean> {
  const result = await db`UPDATE custom_commands SET response = ${response} WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function deleteCustomCommand(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM custom_commands WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function toggleCustomCommand(id: number, guild_id: string, enabled: boolean) {
  await db`UPDATE custom_commands SET enabled = ${enabled ? 1 : 0} WHERE id = ${id} AND guild_id = ${guild_id}`;
}

// ─── Twitch feeds ─────────────────────────────────────────────────────────────

export async function getTwitchFeeds(guild_id: string): Promise<ITwitchFeed[]> {
  const rows = await db`SELECT * FROM twitch_feeds WHERE guild_id = ${guild_id}`;
  return rows as ITwitchFeed[];
}

export async function getAllTwitchFeeds(): Promise<ITwitchFeed[]> {
  const rows = await db`SELECT * FROM twitch_feeds`;
  return rows as ITwitchFeed[];
}

export async function addTwitchFeed(guild_id: string, channel_id: string, twitch_username: string, message: string | null = null): Promise<ITwitchFeed> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO twitch_feeds (guild_id, channel_id, twitch_username, message)
    VALUES (${guild_id}, ${channel_id}, ${twitch_username.toLowerCase()}, ${message})
    RETURNING *
  `;
  return row as ITwitchFeed;
}

export async function removeTwitchFeed(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM twitch_feeds WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function updateTwitchFeedStatus(id: number, live: boolean) {
  await db`UPDATE twitch_feeds SET live = ${live ? 1 : 0}, last_checked = ${Date.now()} WHERE id = ${id}`;
}

// ─── YouTube feeds ────────────────────────────────────────────────────────────

export async function getYoutubeFeeds(guild_id: string): Promise<IYoutubeFeed[]> {
  const rows = await db`SELECT * FROM youtube_feeds WHERE guild_id = ${guild_id}`;
  return rows as IYoutubeFeed[];
}

export async function getAllYoutubeFeeds(): Promise<IYoutubeFeed[]> {
  const rows = await db`SELECT * FROM youtube_feeds`;
  return rows as IYoutubeFeed[];
}

export async function addYoutubeFeed(guild_id: string, channel_id: string, youtube_channel_id: string, youtube_channel_name: string | null, message: string | null = null): Promise<IYoutubeFeed> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO youtube_feeds (guild_id, channel_id, youtube_channel_id, youtube_channel_name, message)
    VALUES (${guild_id}, ${channel_id}, ${youtube_channel_id}, ${youtube_channel_name}, ${message})
    RETURNING *
  `;
  return row as IYoutubeFeed;
}

export async function removeYoutubeFeed(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM youtube_feeds WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function updateYoutubeLastVideo(id: number, video_id: string) {
  await db`UPDATE youtube_feeds SET last_video_id = ${video_id} WHERE id = ${id}`;
}

// ─── Reddit feeds ─────────────────────────────────────────────────────────────

export async function getRedditFeeds(guild_id: string): Promise<IRedditFeed[]> {
  const rows = await db`SELECT * FROM reddit_feeds WHERE guild_id = ${guild_id}`;
  return rows as IRedditFeed[];
}

export async function getAllRedditFeeds(): Promise<IRedditFeed[]> {
  const rows = await db`SELECT * FROM reddit_feeds`;
  return rows as IRedditFeed[];
}

export async function addRedditFeed(guild_id: string, channel_id: string, subreddit: string, nsfw = false): Promise<IRedditFeed> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO reddit_feeds (guild_id, channel_id, subreddit, nsfw)
    VALUES (${guild_id}, ${channel_id}, ${subreddit.toLowerCase()}, ${nsfw ? 1 : 0})
    RETURNING *
  `;
  return row as IRedditFeed;
}

export async function removeRedditFeed(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM reddit_feeds WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function updateRedditLastPost(id: number, post_id: string) {
  await db`UPDATE reddit_feeds SET last_post_id = ${post_id} WHERE id = ${id}`;
}

// ─── RSS feeds ────────────────────────────────────────────────────────────────

export async function getRssFeeds(guild_id: string): Promise<IRssFeed[]> {
  const rows = await db`SELECT * FROM rss_feeds WHERE guild_id = ${guild_id}`;
  return rows as IRssFeed[];
}

export async function getAllRssFeeds(): Promise<IRssFeed[]> {
  const rows = await db`SELECT * FROM rss_feeds`;
  return rows as IRssFeed[];
}

export async function addRssFeed(guild_id: string, channel_id: string, feed_url: string): Promise<IRssFeed> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO rss_feeds (guild_id, channel_id, feed_url)
    VALUES (${guild_id}, ${channel_id}, ${feed_url})
    RETURNING *
  `;
  return row as IRssFeed;
}

export async function removeRssFeed(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM rss_feeds WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function updateRssLastItem(id: number, item_id: string) {
  await db`UPDATE rss_feeds SET last_item_id = ${item_id} WHERE id = ${id}`;
}

// ─── Server stats ─────────────────────────────────────────────────────────────

export async function incrementStat(guild_id: string, field: 'messages' | 'joins' | 'leaves') {
  await ensureConfig(guild_id);
  const bucket = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  // Upsert the row first so we can do a safe named-column update
  await db`INSERT OR IGNORE INTO serverstats (guild_id, hour_bucket) VALUES (${guild_id}, ${bucket})`;
  if (field === 'messages') await db`UPDATE serverstats SET messages = messages + 1 WHERE guild_id = ${guild_id} AND hour_bucket = ${bucket}`;
  else if (field === 'joins') await db`UPDATE serverstats SET joins = joins + 1 WHERE guild_id = ${guild_id} AND hour_bucket = ${bucket}`;
  else await db`UPDATE serverstats SET leaves = leaves + 1 WHERE guild_id = ${guild_id} AND hour_bucket = ${bucket}`;
}

export async function getServerStats(guild_id: string, hours = 24): Promise<IServerStat[]> {
  const since = (Math.floor(Date.now() / 3_600_000) - hours) * 3_600_000;
  const rows = await db`SELECT * FROM serverstats WHERE guild_id = ${guild_id} AND hour_bucket >= ${since} ORDER BY hour_bucket DESC`;
  return rows as IServerStat[];
}

// ─── Streaming config ─────────────────────────────────────────────────────────

export async function getStreamingConfig(guild_id: string): Promise<IStreamingConfig | null> {
  const [row] = await db`SELECT * FROM streaming_config WHERE guild_id = ${guild_id}`;
  return (row as IStreamingConfig) || null;
}

export async function setStreamingConfig(guild_id: string, fields: Partial<Omit<IStreamingConfig, 'guild_id'>>) {
  await ensureConfig(guild_id);
  await db`
    INSERT INTO streaming_config (guild_id, announce_channel_id, give_role_id, message)
    VALUES (${guild_id}, ${fields.announce_channel_id ?? null}, ${fields.give_role_id ?? null}, ${fields.message ?? 'Now live: **{username}** is streaming **{game}**!\n{url}'})
    ON CONFLICT(guild_id) DO UPDATE SET
      announce_channel_id = COALESCE(excluded.announce_channel_id, announce_channel_id),
      give_role_id = COALESCE(excluded.give_role_id, give_role_id),
      message = COALESCE(excluded.message, message)
  `;
}

// ─── RSVP ─────────────────────────────────────────────────────────────────────

export async function createRsvpEvent(guild_id: string, channel_id: string, title: string, description: string | null, starts_at: number, created_by: string): Promise<IRsvpEvent> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO rsvp_events (guild_id, channel_id, title, description, starts_at, created_by, created_at)
    VALUES (${guild_id}, ${channel_id}, ${title}, ${description}, ${starts_at}, ${created_by}, ${Date.now()})
    RETURNING *
  `;
  return row as IRsvpEvent;
}

export async function getRsvpEvent(id: number, guild_id: string): Promise<IRsvpEvent | null> {
  const [row] = await db`SELECT * FROM rsvp_events WHERE id = ${id} AND guild_id = ${guild_id}`;
  return (row as IRsvpEvent) || null;
}

export async function listRsvpEvents(guild_id: string): Promise<IRsvpEvent[]> {
  const rows = await db`SELECT * FROM rsvp_events WHERE guild_id = ${guild_id} AND starts_at >= ${Date.now()} ORDER BY starts_at`;
  return rows as IRsvpEvent[];
}

export async function setRsvpResponse(event_id: number, user_id: string, status: IRsvpResponse['status']) {
  await db`
    INSERT INTO rsvp_responses (event_id, user_id, status) VALUES (${event_id}, ${user_id}, ${status})
    ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status
  `;
}

export async function getRsvpResponses(event_id: number): Promise<IRsvpResponse[]> {
  const rows = await db`SELECT * FROM rsvp_responses WHERE event_id = ${event_id}`;
  return rows as IRsvpResponse[];
}

export async function updateRsvpMessageId(id: number, message_id: string) {
  await db`UPDATE rsvp_events SET message_id = ${message_id} WHERE id = ${id}`;
}

// ─── Scheduled tasks ──────────────────────────────────────────────────────────

export async function createScheduledTask(
  type: string,
  fires_at: number,
  opts: { guild_id?: string; user_id?: string; channel_id?: string; data?: object }
): Promise<IScheduledTask> {
  const [row] = await db`
    INSERT INTO scheduled_tasks (type, guild_id, user_id, channel_id, data, fires_at)
    VALUES (${type}, ${opts.guild_id ?? null}, ${opts.user_id ?? null}, ${opts.channel_id ?? null}, ${opts.data ? JSON.stringify(opts.data) : null}, ${fires_at})
    RETURNING *
  `;
  return row as IScheduledTask;
}

export async function getPendingScheduledTasks(before: number): Promise<IScheduledTask[]> {
  const rows = await db`SELECT * FROM scheduled_tasks WHERE fired = 0 AND fires_at <= ${before}`;
  return rows as IScheduledTask[];
}

export async function markScheduledTaskFired(id: number) {
  await db`UPDATE scheduled_tasks SET fired = 1 WHERE id = ${id}`;
}

export async function deleteScheduledTask(id: number) {
  await db`DELETE FROM scheduled_tasks WHERE id = ${id}`;
}

// ─── XP level formula (MEE6-style) ───────────────────────────────────────────

export function xpForLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

export function calcLevelFromXp(totalXp: number): { level: number; currentXp: number; xpNeeded: number } {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return { level, currentXp: remaining, xpNeeded: xpForLevel(level) };
}

// ─── Economy ──────────────────────────────────────────────────────────────────

/**
 * A server's economy settings. In Discord replies the default currency symbol shows as the cash icon (see eco/cashEmoji.ts);
 * `raw` keeps what is stored, for the web dashboard, which can neither show that emoji nor save it back.
 */
export async function getEconomyConfig(guild_id: string, raw = false): Promise<IEconomyConfig> {
  const cfg = await storedEconomyConfig(guild_id);
  return raw ? cfg : { ...cfg, currency_symbol: displaySymbol(cfg.currency_symbol) };
}

async function storedEconomyConfig(guild_id: string): Promise<IEconomyConfig> {
  const [row] = await db`SELECT * FROM economy_config WHERE guild_id = ${guild_id}`;
  return (row as IEconomyConfig) || {
    guild_id, currency_name: 'coins', currency_symbol: '🪙',
    starting_balance: 0,
    daily_min: 100, daily_max: 500,
    weekly_min: 500, weekly_max: 2000,
    monthly_min: 2000, monthly_max: 8000,
    yearly_min: 25000, yearly_max: 100000,
    work_min: 50, work_max: 200,
    lottery_channel_id: null, lottery_enabled: 0, lottery_prize: 50000,
  };
}

export async function setEconomyConfig(guild_id: string, fields: Partial<Omit<IEconomyConfig, 'guild_id'>>) {
  await ensureConfig(guild_id);
  await db`INSERT OR IGNORE INTO economy_config (guild_id) VALUES (${guild_id})`;
  if (fields.currency_name !== undefined) await db`UPDATE economy_config SET currency_name = ${fields.currency_name} WHERE guild_id = ${guild_id}`;
  if (fields.currency_symbol !== undefined) await db`UPDATE economy_config SET currency_symbol = ${fields.currency_symbol} WHERE guild_id = ${guild_id}`;
  if (fields.starting_balance !== undefined) await db`UPDATE economy_config SET starting_balance = ${fields.starting_balance} WHERE guild_id = ${guild_id}`;
  if (fields.daily_min !== undefined) await db`UPDATE economy_config SET daily_min = ${fields.daily_min} WHERE guild_id = ${guild_id}`;
  if (fields.daily_max !== undefined) await db`UPDATE economy_config SET daily_max = ${fields.daily_max} WHERE guild_id = ${guild_id}`;
  if (fields.weekly_min !== undefined) await db`UPDATE economy_config SET weekly_min = ${fields.weekly_min} WHERE guild_id = ${guild_id}`;
  if (fields.weekly_max !== undefined) await db`UPDATE economy_config SET weekly_max = ${fields.weekly_max} WHERE guild_id = ${guild_id}`;
  if (fields.monthly_min !== undefined) await db`UPDATE economy_config SET monthly_min = ${fields.monthly_min} WHERE guild_id = ${guild_id}`;
  if (fields.monthly_max !== undefined) await db`UPDATE economy_config SET monthly_max = ${fields.monthly_max} WHERE guild_id = ${guild_id}`;
  if (fields.yearly_min !== undefined) await db`UPDATE economy_config SET yearly_min = ${fields.yearly_min} WHERE guild_id = ${guild_id}`;
  if (fields.yearly_max !== undefined) await db`UPDATE economy_config SET yearly_max = ${fields.yearly_max} WHERE guild_id = ${guild_id}`;
  if (fields.work_min !== undefined) await db`UPDATE economy_config SET work_min = ${fields.work_min} WHERE guild_id = ${guild_id}`;
  if (fields.work_max !== undefined) await db`UPDATE economy_config SET work_max = ${fields.work_max} WHERE guild_id = ${guild_id}`;
}

export async function getOrCreateEconomy(guild_id: string, user_id: string): Promise<IEconomy> {
  const [existing] = await db`SELECT * FROM economy WHERE user_id = ${user_id}`;
  if (existing) return existing as IEconomy;
  await ensureConfig(guild_id);
  const cfg = await getEconomyConfig(guild_id);
  const [row] = await db`
    INSERT INTO economy (user_id, balance, total_earned)
    VALUES (${user_id}, ${cfg.starting_balance}, ${cfg.starting_balance})
    ON CONFLICT(user_id) DO UPDATE SET user_id = user_id
    RETURNING *
  `;
  return row as IEconomy;
}

/**
 * Add/remove cash atomically. One guarded UPDATE does the check and the write together,
 * so concurrent commands can neither lose an update nor overdraw the wallet (the old
 * read → compute → write version did both). Every change is recorded in eco_ledger.
 */
export async function adjustBalance(
  guild_id: string, user_id: string, delta: number, reason = 'misc', ref: string | null = null,
): Promise<{ success: boolean; newBalance: number }> {
  if (!Number.isSafeInteger(delta)) throw new Error(`adjustBalance: delta must be a safe integer (got ${delta})`);
  await getOrCreateEconomy(guild_id, user_id);
  const earned = delta > 0 ? delta : 0;
  const rows = await db`
    UPDATE economy SET balance = balance + ${delta}, total_earned = total_earned + ${earned}
    WHERE user_id = ${user_id} AND balance + ${delta} >= 0
    RETURNING balance
  `;
  if (rows.length === 0) {
    const [cur] = await db`SELECT balance FROM economy WHERE user_id = ${user_id}`;
    return { success: false, newBalance: (cur?.balance as number) ?? 0 };
  }
  const newBalance = rows[0].balance as number;
  if (delta !== 0) {
    await db`INSERT INTO eco_ledger (user_id, delta, balance_after, reason, ref, ts)
             VALUES (${user_id}, ${delta}, ${newBalance}, ${reason}, ${ref}, ${Date.now()})`;
  }
  return { success: true, newBalance };
}

export async function getEconomyLeaderboard(userIds: string[], limit = 10): Promise<IEconomy[]> {
  if (!userIds.length) return [];
  const idsJson = JSON.stringify(userIds);
  const rows = await db`
    SELECT e.* FROM economy e
    INNER JOIN json_each(${idsJson}) j ON e.user_id = j.value
    ORDER BY e.balance DESC LIMIT ${limit}
  `;
  return rows as IEconomy[];
}

export async function getEconomyCooldown(user_id: string, type: string): Promise<number> {
  const [row] = await db`SELECT last_used FROM economy_cooldowns WHERE user_id = ${user_id} AND type = ${type}`;
  return row ? (row.last_used as number) : 0;
}

export async function setEconomyCooldown(user_id: string, type: string) {
  await db`
    INSERT INTO economy_cooldowns (user_id, type, last_used) VALUES (${user_id}, ${type}, ${Date.now()})
    ON CONFLICT(user_id, type) DO UPDATE SET last_used = excluded.last_used
  `;
}

/** Clear a cooldown entirely (Time Skip shop item). */
export async function resetEconomyCooldown(user_id: string, type: string): Promise<void> {
  await db`DELETE FROM economy_cooldowns WHERE user_id = ${user_id} AND type = ${type}`;
}

// ─── Economy Drought (guild-wide "no one's claimed this in a while") ───────────

/** 0 if no one in the guild has ever claimed this command type. */
export async function getGuildDroughtClaim(guild_id: string, type: string): Promise<number> {
  const [row] = await db`SELECT last_used FROM economy_drought WHERE guild_id = ${guild_id} AND type = ${type}`;
  return row ? (row.last_used as number) : 0;
}

export async function setGuildDroughtClaim(guild_id: string, type: string): Promise<void> {
  await db`
    INSERT INTO economy_drought (guild_id, type, last_used) VALUES (${guild_id}, ${type}, ${Date.now()})
    ON CONFLICT(guild_id, type) DO UPDATE SET last_used = excluded.last_used
  `;
}

// ─── Economy Protection ────────────────────────────────────────────────────────

export async function getProtection(guild_id: string, user_id: string): Promise<number | null> {
  const [row] = await db`SELECT expires_at FROM economy_protection WHERE guild_id = ${guild_id} AND user_id = ${user_id} AND expires_at > ${Date.now()}`;
  return row ? (row.expires_at as number) : null;
}

export async function setProtection(guild_id: string, user_id: string, expires_at: number): Promise<void> {
  await db`
    INSERT INTO economy_protection (guild_id, user_id, expires_at) VALUES (${guild_id}, ${user_id}, ${expires_at})
    ON CONFLICT(guild_id, user_id) DO UPDATE SET expires_at = CASE WHEN excluded.expires_at > economy_protection.expires_at THEN excluded.expires_at ELSE economy_protection.expires_at END
  `;
}

// ─── Economy Boosts ───────────────────────────────────────────────────────────

export async function getActiveBoost(guild_id: string, user_id: string, type: string): Promise<IEconomyBoost | null> {
  const [row] = await db`
    SELECT * FROM economy_boosts
    WHERE guild_id = ${guild_id} AND user_id = ${user_id} AND type = ${type} AND expires_at > ${Date.now()}
    ORDER BY expires_at DESC LIMIT 1
  `;
  return (row as IEconomyBoost) || null;
}

export async function addBoost(guild_id: string, user_id: string, type: string, multiplier: number, expires_at: number): Promise<void> {
  await db`INSERT INTO economy_boosts (guild_id, user_id, type, multiplier, expires_at) VALUES (${guild_id}, ${user_id}, ${type}, ${multiplier}, ${expires_at})`;
}

/** Consume a one-shot boost (Goon Squad, Insurance, Second Chance). Returns true if one was active and used. */
export async function consumeBoost(guild_id: string, user_id: string, type: string): Promise<boolean> {
  const boost = await getActiveBoost(guild_id, user_id, type);
  if (!boost) return false;
  await db`DELETE FROM economy_boosts WHERE id = ${boost.id}`;
  return true;
}

/** Remove all boosts of a type for a guild — used to expire Loaded Dice after each lottery draw. */
export async function clearGuildBoosts(guild_id: string, type: string): Promise<void> {
  await db`DELETE FROM economy_boosts WHERE guild_id = ${guild_id} AND type = ${type}`;
}

export async function getGambleMultiplier(guild_id: string, user_id: string): Promise<number> {
  const boost = await getActiveBoost(guild_id, user_id, 'luck');
  return boost?.multiplier ?? 1.0;
}

export async function getXpMultiplier(guild_id: string, user_id: string): Promise<number> {
  const boost = await getActiveBoost(guild_id, user_id, 'xp');
  return boost?.multiplier ?? 1.0;
}

// ─── Lottery ──────────────────────────────────────────────────────────────────

export async function getLotteryConfigs(): Promise<Array<{ guild_id: string; lottery_channel_id: string; lottery_prize: number }>> {
  const rows = await db`SELECT guild_id, lottery_channel_id, lottery_prize FROM economy_config WHERE lottery_enabled = 1 AND lottery_channel_id IS NOT NULL`;
  return rows as any[];
}

export async function getLotteryLastRun(guild_id: string): Promise<string | null> {
  const [row] = await db`SELECT value FROM bot_config WHERE key = ${'lottery_last_' + guild_id}`;
  return (row?.value as string) ?? null;
}

export async function setLotteryLastRun(guild_id: string, date: string): Promise<void> {
  await db`INSERT INTO bot_config (key, value) VALUES (${'lottery_last_' + guild_id}, ${date})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
}

// Stores "channelId:messageId" of the last winner announcement so it can be deleted
// before the next one posts (channel is included in case the lottery channel is reconfigured).
export async function getLotteryLastMessage(guild_id: string): Promise<{ channelId: string; messageId: string } | null> {
  const [row] = await db`SELECT value FROM bot_config WHERE key = ${'lottery_msg_' + guild_id}`;
  if (!row) return null;
  const [channelId, messageId] = (row.value as string).split(':');
  return channelId && messageId ? { channelId, messageId } : null;
}

export async function setLotteryLastMessage(guild_id: string, channel_id: string, message_id: string): Promise<void> {
  const value = `${channel_id}:${message_id}`;
  await db`INSERT INTO bot_config (key, value) VALUES (${'lottery_msg_' + guild_id}, ${value})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
}

// Stores "winnerId:prize" for today's draw so a reroll can claw back the prize
// from the outgoing winner before picking a replacement.
export async function getLotteryLastWinner(guild_id: string): Promise<{ winnerId: string; prize: number } | null> {
  const [row] = await db`SELECT value FROM bot_config WHERE key = ${'lottery_winner_' + guild_id}`;
  if (!row) return null;
  const [winnerId, prizeStr] = (row.value as string).split(':');
  const prize = Number(prizeStr);
  return winnerId && Number.isFinite(prize) ? { winnerId, prize } : null;
}

export async function setLotteryLastWinner(guild_id: string, winner_id: string, prize: number): Promise<void> {
  const value = `${winner_id}:${prize}`;
  await db`INSERT INTO bot_config (key, value) VALUES (${'lottery_winner_' + guild_id}, ${value})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
}

export async function getRandomLotteryWinner(guild_id: string, eligibleIds?: Set<string>): Promise<string | null> {
  const rows = await db`SELECT user_id FROM xp WHERE guild_id = ${guild_id}`;
  // xp rows persist after a member leaves — restrict to current members so we
  // never draw someone Discord can no longer resolve a mention for.
  const candidates = eligibleIds
    ? (rows as Array<{ user_id: string }>).filter(r => eligibleIds.has(r.user_id))
    : (rows as Array<{ user_id: string }>);
  if (!candidates.length) return null;
  // Loaded Dice holders get a second entry — double the chance to win.
  const boosted = await db`
    SELECT DISTINCT user_id FROM economy_boosts
    WHERE guild_id = ${guild_id} AND type = 'lotto' AND expires_at > ${Date.now()}
  `;
  const boostedIds = new Set((boosted as Array<{ user_id: string }>).map(r => r.user_id));
  const pool: string[] = [];
  for (const r of candidates) {
    pool.push(r.user_id);
    if (boostedIds.has(r.user_id)) pool.push(r.user_id);
  }
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

export async function setLotteryConfig(guild_id: string, channel_id: string | null, enabled: boolean): Promise<void> {
  await ensureConfig(guild_id);
  await db`INSERT INTO economy_config (guild_id, lottery_channel_id, lottery_enabled)
    VALUES (${guild_id}, ${channel_id}, ${enabled ? 1 : 0})
    ON CONFLICT(guild_id) DO UPDATE SET lottery_channel_id = excluded.lottery_channel_id, lottery_enabled = excluded.lottery_enabled`;
}

// ─── Game stats ───────────────────────────────────────────────────────────────

export async function recordGameResult(
  guild_id: string, user_id: string, game: string, won: boolean, wagered: number,
): Promise<void> {
  await db`
    INSERT INTO game_stats (guild_id, user_id, game, wins, losses, total_wagered)
    VALUES (${guild_id}, ${user_id}, ${game}, ${won ? 1 : 0}, ${won ? 0 : 1}, ${wagered})
    ON CONFLICT(guild_id, user_id, game) DO UPDATE SET
      wins          = wins + ${won ? 1 : 0},
      losses        = losses + ${won ? 0 : 1},
      total_wagered = total_wagered + ${wagered}
  `;
}

export async function getGameLeaderboard(
  guild_id: string, game: string, limit = 10,
): Promise<{ user_id: string; wins: number; losses: number; total_wagered: number }[]> {
  const rows = await db`
    SELECT user_id, wins, losses, total_wagered
    FROM game_stats
    WHERE guild_id = ${guild_id} AND game = ${game}
    ORDER BY wins DESC, losses ASC
    LIMIT ${limit}
  `;
  return rows as any[];
}

// ─── Game XP daily cap (DB-backed so it survives restarts) ────────────────────

export async function getGameXpUsedToday(guild_id: string, user_id: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const [row] = await db`
    SELECT total FROM game_xp_daily
    WHERE guild_id = ${guild_id} AND user_id = ${user_id} AND date = ${today}
  `;
  return (row?.total as number) ?? 0;
}

export async function addGameXpToday(guild_id: string, user_id: string, amount: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db`
    INSERT INTO game_xp_daily (guild_id, user_id, date, total)
    VALUES (${guild_id}, ${user_id}, ${today}, ${amount})
    ON CONFLICT(guild_id, user_id, date) DO UPDATE SET total = total + ${amount}
  `;
}

// ─── XP / Levels ─────────────────────────────────────────────────────────────

export async function getXp(guild_id: string, user_id: string): Promise<IXp | null> {
  const [row] = await db`SELECT * FROM xp WHERE guild_id = ${guild_id} AND user_id = ${user_id}`;
  return (row as IXp) || null;
}

export async function addXp(
  guild_id: string, user_id: string, amount: number, countMessage = true
): Promise<{ row: IXp; oldLevel: number }> {
  await ensureConfig(guild_id);
  const existing = await getXp(guild_id, user_id);
  const oldLevel = existing?.level ?? 0;
  const newXp = (existing?.xp ?? 0) + amount;
  const { level: newLevel } = calcLevelFromXp(newXp);
  const msgIncrement = countMessage ? 1 : 0;
  const [row] = await db`
    INSERT INTO xp (guild_id, user_id, xp, level, total_messages)
    VALUES (${guild_id}, ${user_id}, ${amount}, ${newLevel}, ${msgIncrement})
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      xp = xp + ${amount},
      level = ${newLevel},
      total_messages = total_messages + ${msgIncrement}
    RETURNING *
  `;
  return { row: row as IXp, oldLevel };
}

export async function getXpConfig(guild_id: string): Promise<IXpConfig> {
  const [row] = await db`SELECT * FROM xp_config WHERE guild_id = ${guild_id}`;
  return (row as IXpConfig) || {
    guild_id, enabled: 1, xp_min: 15, xp_max: 25, cooldown_seconds: 60,
    level_up_channel_id: null,
    level_up_message: 'GG {user}, you just advanced to **level {level}**! 🎉',
    level_up_announce: 1,
    background_url: null,
  };
}

export async function setXpConfig(guild_id: string, fields: Partial<Omit<IXpConfig, 'guild_id'>>) {
  await ensureConfig(guild_id);
  await db`INSERT OR IGNORE INTO xp_config (guild_id) VALUES (${guild_id})`;
  if (fields.enabled !== undefined) await db`UPDATE xp_config SET enabled = ${fields.enabled} WHERE guild_id = ${guild_id}`;
  if (fields.xp_min !== undefined) await db`UPDATE xp_config SET xp_min = ${fields.xp_min} WHERE guild_id = ${guild_id}`;
  if (fields.xp_max !== undefined) await db`UPDATE xp_config SET xp_max = ${fields.xp_max} WHERE guild_id = ${guild_id}`;
  if (fields.cooldown_seconds !== undefined) await db`UPDATE xp_config SET cooldown_seconds = ${fields.cooldown_seconds} WHERE guild_id = ${guild_id}`;
  if (fields.level_up_channel_id !== undefined) await db`UPDATE xp_config SET level_up_channel_id = ${fields.level_up_channel_id} WHERE guild_id = ${guild_id}`;
  if (fields.level_up_message !== undefined) await db`UPDATE xp_config SET level_up_message = ${fields.level_up_message} WHERE guild_id = ${guild_id}`;
  if (fields.level_up_announce !== undefined) await db`UPDATE xp_config SET level_up_announce = ${fields.level_up_announce} WHERE guild_id = ${guild_id}`;
  if (fields.background_url !== undefined) await db`UPDATE xp_config SET background_url = ${fields.background_url} WHERE guild_id = ${guild_id}`;
}

export async function getXpRank(guild_id: string, user_id: string): Promise<number> {
  const [row] = await db`
    SELECT COUNT(*) + 1 AS rank FROM xp
    WHERE guild_id = ${guild_id}
    AND xp > (SELECT COALESCE(xp, 0) FROM xp WHERE guild_id = ${guild_id} AND user_id = ${user_id})
  `;
  return (row as any)?.rank ?? 1;
}

export async function getXpLeaderboard(guild_id: string, limit = 10): Promise<IXp[]> {
  const rows = await db`SELECT * FROM xp WHERE guild_id = ${guild_id} ORDER BY xp DESC LIMIT ${limit}`;
  return rows as IXp[];
}

export async function getLevelRoles(guild_id: string): Promise<ILevelRole[]> {
  const rows = await db`SELECT * FROM level_roles WHERE guild_id = ${guild_id} ORDER BY level ASC`;
  return rows as ILevelRole[];
}

export async function addLevelRole(guild_id: string, level: number, role_id: string): Promise<ILevelRole> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO level_roles (guild_id, level, role_id) VALUES (${guild_id}, ${level}, ${role_id})
    RETURNING *
  `;
  return row as ILevelRole;
}

export async function removeLevelRole(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM level_roles WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

// ─── Free game tracker ────────────────────────────────────────────────────────

export async function getFreeGameConfig(guild_id: string): Promise<IFreeGameConfig | null> {
  const [row] = await db`SELECT * FROM free_game_config WHERE guild_id = ${guild_id}`;
  return (row as IFreeGameConfig) || null;
}

export async function getAllFreeGameConfigs(): Promise<IFreeGameConfig[]> {
  const rows = await db`SELECT * FROM free_game_config WHERE channel_id IS NOT NULL`;
  return rows as IFreeGameConfig[];
}

export async function setFreeGameConfig(guild_id: string, fields: Partial<Omit<IFreeGameConfig, 'guild_id'>>) {
  await ensureConfig(guild_id);
  await db`INSERT OR IGNORE INTO free_game_config (guild_id) VALUES (${guild_id})`;
  if (fields.channel_id !== undefined) await db`UPDATE free_game_config SET channel_id = ${fields.channel_id} WHERE guild_id = ${guild_id}`;
  if (fields.platforms !== undefined) await db`UPDATE free_game_config SET platforms = ${fields.platforms} WHERE guild_id = ${guild_id}`;
  if (fields.ping_role_id !== undefined) await db`UPDATE free_game_config SET ping_role_id = ${fields.ping_role_id} WHERE guild_id = ${guild_id}`;
}

export async function hasFreeGameBeenPosted(guild_id: string, game_id: string): Promise<boolean> {
  const [row] = await db`SELECT id FROM free_game_posted WHERE guild_id = ${guild_id} AND game_id = ${game_id}`;
  return !!row;
}

export async function markFreeGamePosted(guild_id: string, game_id: string) {
  await db`
    INSERT OR IGNORE INTO free_game_posted (guild_id, game_id, posted_at)
    VALUES (${guild_id}, ${game_id}, ${Date.now()})
  `;
}

// ─── Birthdays ────────────────────────────────────────────────────────────────

export async function setBirthday(guild_id: string, user_id: string, month: number, day: number) {
  await ensureConfig(guild_id);
  await db`
    INSERT INTO birthdays (guild_id, user_id, month, day) VALUES (${guild_id}, ${user_id}, ${month}, ${day})
    ON CONFLICT(guild_id, user_id) DO UPDATE SET month = excluded.month, day = excluded.day
  `;
}

export async function removeBirthday(guild_id: string, user_id: string) {
  await db`DELETE FROM birthdays WHERE guild_id = ${guild_id} AND user_id = ${user_id}`;
}

export async function getBirthday(guild_id: string, user_id: string): Promise<IBirthday | null> {
  const [row] = await db`SELECT * FROM birthdays WHERE guild_id = ${guild_id} AND user_id = ${user_id}`;
  return (row as IBirthday) || null;
}

export async function getBirthdays(guild_id: string): Promise<IBirthday[]> {
  const rows = await db`SELECT * FROM birthdays WHERE guild_id = ${guild_id} ORDER BY month, day`;
  return rows as IBirthday[];
}

export async function getTodaysBirthdays(month: number, day: number): Promise<IBirthday[]> {
  const rows = await db`SELECT * FROM birthdays WHERE month = ${month} AND day = ${day}`;
  return rows as IBirthday[];
}

export async function getBirthdayConfig(guild_id: string): Promise<IBirthdayConfig> {
  const [row] = await db`SELECT * FROM birthday_config WHERE guild_id = ${guild_id}`;
  return (row as IBirthdayConfig) || { guild_id, channel_id: null, enabled: 1 };
}

export async function setBirthdayConfig(guild_id: string, fields: Partial<Omit<IBirthdayConfig, 'guild_id'>>) {
  await ensureConfig(guild_id);
  await db`INSERT OR IGNORE INTO birthday_config (guild_id) VALUES (${guild_id})`;
  if (fields.channel_id !== undefined) await db`UPDATE birthday_config SET channel_id = ${fields.channel_id} WHERE guild_id = ${guild_id}`;
  if (fields.enabled !== undefined) await db`UPDATE birthday_config SET enabled = ${fields.enabled} WHERE guild_id = ${guild_id}`;
}

// ─── Timezones ────────────────────────────────────────────────────────────────

export async function setTimezone(user_id: string, timezone: string) {
  await db`
    INSERT INTO timezones (user_id, timezone) VALUES (${user_id}, ${timezone})
    ON CONFLICT(user_id) DO UPDATE SET timezone = excluded.timezone
  `;
}

export async function removeTimezone(user_id: string) {
  await db`DELETE FROM timezones WHERE user_id = ${user_id}`;
}

export async function getTimezone(user_id: string): Promise<ITimezone | null> {
  const [row] = await db`SELECT * FROM timezones WHERE user_id = ${user_id}`;
  return (row as ITimezone) || null;
}

// ─── Guild timezone (per-guild, with autocomplete + live message) ─────────────

export async function setUserTimezone(guild_id: string, user_id: string, timezone: string): Promise<void> {
  await ensureConfig(guild_id);
  await db`
    INSERT INTO timezone_user (guild_id, user_id, timezone) VALUES (${guild_id}, ${user_id}, ${timezone})
    ON CONFLICT(guild_id, user_id) DO UPDATE SET timezone = excluded.timezone
  `;
}

export async function removeUserTimezone(guild_id: string, user_id: string): Promise<boolean> {
  const result = await db`DELETE FROM timezone_user WHERE guild_id = ${guild_id} AND user_id = ${user_id}`;
  return result.changes != null && result.changes > 0;
}

export async function getUserTimezone(guild_id: string, user_id: string): Promise<string | null> {
  const result = await db`SELECT timezone FROM timezone_user WHERE guild_id = ${guild_id} AND user_id = ${user_id}`;
  return result.length > 0 ? result[0].timezone : null;
}

export async function getGuildTimezones(guild_id: string): Promise<{ user_id: string; timezone: string }[]> {
  const result = await db`SELECT user_id, timezone FROM timezone_user WHERE guild_id = ${guild_id}`;
  return Array.isArray(result) ? result : [];
}

export async function removeGuildTimezones(guild_id: string): Promise<void> {
  await db`DELETE FROM timezone_user WHERE guild_id = ${guild_id}`;
}

export async function removeUserTimezonesEverywhere(user_id: string): Promise<void> {
  await db`DELETE FROM timezone_user WHERE user_id = ${user_id}`;
}

export async function setGuildTimezoneMessage(guild_id: string, channel_id: string, message_id: string): Promise<void> {
  await ensureConfig(guild_id);
  await db`
    INSERT INTO timezone_message (guild_id, channel_id, message_id)
    VALUES (${guild_id}, ${channel_id}, ${message_id})
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id
  `;
}

export async function removeGuildTimezoneMessageByMsgId(guild_id: string, message_id: string): Promise<void> {
  await db`DELETE FROM timezone_message WHERE guild_id = ${guild_id} AND message_id = ${message_id}`;
}

export async function removeGuildTimezoneMessageByChannelId(guild_id: string, channel_id: string): Promise<void> {
  await db`DELETE FROM timezone_message WHERE guild_id = ${guild_id} AND channel_id = ${channel_id}`;
}

export async function getGuildTimezoneMessage(guild_id: string): Promise<{ channel_id: string; message_id: string } | null> {
  const result = await db`SELECT channel_id, message_id FROM timezone_message WHERE guild_id = ${guild_id}`;
  if (result.length === 0) return null;
  return { channel_id: result[0].channel_id, message_id: result[0].message_id };
}

export async function getTimezoneMessages(): Promise<{ channel_id: string; message_id: string; guild_id: string }[]> {
  const result = await db`SELECT channel_id, message_id, guild_id FROM timezone_message`;
  return Array.isArray(result) ? result : [];
}

// ─── Welcome config ───────────────────────────────────────────────────────────

// ─── Verify config ────────────────────────────────────────────────────────────

// ─── Stat channels ────────────────────────────────────────────────────────────

export async function getStatChannels(guild_id: string): Promise<IStatChannel[]> {
  const rows = await db`SELECT * FROM stat_channels WHERE guild_id = ${guild_id}`;
  return rows as IStatChannel[];
}

export async function getAllStatChannels(): Promise<IStatChannel[]> {
  const rows = await db`SELECT * FROM stat_channels`;
  return rows as IStatChannel[];
}

export async function addStatChannel(guild_id: string, channel_id: string, type: string, label: string): Promise<IStatChannel> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO stat_channels (guild_id, channel_id, type, label) VALUES (${guild_id}, ${channel_id}, ${type}, ${label})
    RETURNING *
  `;
  return row as IStatChannel;
}

export async function removeStatChannel(guild_id: string, channel_id: string): Promise<boolean> {
  const result = await db`DELETE FROM stat_channels WHERE guild_id = ${guild_id} AND channel_id = ${channel_id} RETURNING id`;
  return result.length > 0;
}

export async function removeStatChannelById(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM stat_channels WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function removeLevelRoleByRoleId(guild_id: string, role_id: string): Promise<boolean> {
  const result = await db`DELETE FROM level_roles WHERE guild_id = ${guild_id} AND role_id = ${role_id} RETURNING id`;
  return result.length > 0;
}

// ─── Reaction roles ───────────────────────────────────────────────────────────

export async function getReactionRoles(guild_id: string): Promise<IReactionRole[]> {
  const rows = await db`SELECT * FROM reaction_roles WHERE guild_id = ${guild_id}`;
  return rows as IReactionRole[];
}

export async function getReactionRolesForMessage(guild_id: string, message_id: string): Promise<IReactionRole[]> {
  const rows = await db`SELECT * FROM reaction_roles WHERE guild_id = ${guild_id} AND message_id = ${message_id}`;
  return rows as IReactionRole[];
}

export async function addReactionRole(
  guild_id: string, channel_id: string, message_id: string, emoji: string, role_id: string
): Promise<IReactionRole> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id)
    VALUES (${guild_id}, ${channel_id}, ${message_id}, ${emoji}, ${role_id})
    ON CONFLICT(guild_id, message_id, emoji) DO UPDATE SET role_id = excluded.role_id
    RETURNING *
  `;
  return row as IReactionRole;
}

export async function removeReactionRole(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM reaction_roles WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function clearReactionRolesForMessage(guild_id: string, message_id: string) {
  await db`DELETE FROM reaction_roles WHERE guild_id = ${guild_id} AND message_id = ${message_id}`;
}

// ─── Topic channels ───────────────────────────────────────────────────────────

export async function getTopicChannel(guild_id: string, channel_id: string): Promise<ITopicChannel | null> {
  const [row] = await db`SELECT * FROM topic_channels WHERE guild_id = ${guild_id} AND channel_id = ${channel_id}`;
  return (row as ITopicChannel) || null;
}

export async function getAllTopicChannels(): Promise<ITopicChannel[]> {
  const rows = await db`SELECT * FROM topic_channels`;
  return rows as ITopicChannel[];
}

export async function getTopicChannelsForGuild(guild_id: string): Promise<ITopicChannel[]> {
  const rows = await db`SELECT * FROM topic_channels WHERE guild_id = ${guild_id}`;
  return rows as ITopicChannel[];
}

export async function setTopicChannel(
  guild_id: string, channel_id: string, interval_seconds: number, mode: 'sequential' | 'random'
): Promise<ITopicChannel> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO topic_channels (guild_id, channel_id, interval_seconds, mode)
    VALUES (${guild_id}, ${channel_id}, ${interval_seconds}, ${mode})
    ON CONFLICT(guild_id, channel_id) DO UPDATE SET
      interval_seconds = excluded.interval_seconds,
      mode = excluded.mode
    RETURNING *
  `;
  return row as ITopicChannel;
}

export async function removeTopicChannel(guild_id: string, channel_id: string): Promise<boolean> {
  const result = await db`DELETE FROM topic_channels WHERE guild_id = ${guild_id} AND channel_id = ${channel_id} RETURNING id`;
  return result.length > 0;
}

export async function updateTopicLastPosted(id: number) {
  await db`UPDATE topic_channels SET last_posted = ${Date.now()} WHERE id = ${id}`;
}

export async function getTopics(guild_id: string, channel_id: string): Promise<ITopic[]> {
  const rows = await db`SELECT * FROM topics WHERE guild_id = ${guild_id} AND channel_id = ${channel_id} ORDER BY order_index, id`;
  return rows as ITopic[];
}

export async function addTopic(guild_id: string, channel_id: string, text: string): Promise<ITopic> {
  await ensureConfig(guild_id);
  const existing = await getTopics(guild_id, channel_id);
  const order_index = existing.length;
  const [row] = await db`
    INSERT INTO topics (guild_id, channel_id, text, order_index)
    VALUES (${guild_id}, ${channel_id}, ${text}, ${order_index})
    RETURNING *
  `;
  return row as ITopic;
}

export async function removeTopic(id: number, guild_id: string): Promise<boolean> {
  const result = await db`DELETE FROM topics WHERE id = ${id} AND guild_id = ${guild_id} RETURNING id`;
  return result.length > 0;
}

export async function getNextTopic(guild_id: string, channel_id: string, mode: string): Promise<ITopic | null> {
  const topics = await getTopics(guild_id, channel_id);
  if (!topics.length) return null;
  if (mode === 'random') return topics[Math.floor(Math.random() * topics.length)];
  // Sequential: find the one with the lowest order_index that hasn't been used most recently
  // Simple: rotate through by cycling order_index
  return topics[0];
}

export async function rotateTopic(guild_id: string, channel_id: string) {
  // Move the first topic to the end (increment all others, or just reorder)
  const topics = await getTopics(guild_id, channel_id);
  if (topics.length <= 1) return;
  const first = topics[0];
  await db`UPDATE topics SET order_index = ${topics.length} WHERE id = ${first.id}`;
  // Decrement others
  for (const t of topics.slice(1)) {
    await db`UPDATE topics SET order_index = ${t.order_index - 1} WHERE id = ${t.id}`;
  }
}

// ─── Starboard ────────────────────────────────────────────────────────────────

export async function getStarboardConfig(guild_id: string): Promise<IStarboardConfig | null> {
  const [row] = await db`SELECT * FROM starboard_config WHERE guild_id = ${guild_id}`;
  return (row as IStarboardConfig) || null;
}

export async function setStarboardConfig(guild_id: string, fields: Partial<Omit<IStarboardConfig, 'guild_id'>>) {
  await ensureConfig(guild_id);
  await db`INSERT OR IGNORE INTO starboard_config (guild_id) VALUES (${guild_id})`;
  if (fields.channel_id !== undefined) await db`UPDATE starboard_config SET channel_id = ${fields.channel_id} WHERE guild_id = ${guild_id}`;
  if (fields.threshold !== undefined) await db`UPDATE starboard_config SET threshold = ${fields.threshold} WHERE guild_id = ${guild_id}`;
  if (fields.emoji !== undefined) await db`UPDATE starboard_config SET emoji = ${fields.emoji} WHERE guild_id = ${guild_id}`;
  if (fields.enabled !== undefined) await db`UPDATE starboard_config SET enabled = ${fields.enabled} WHERE guild_id = ${guild_id}`;
}

export async function getStarboardPost(guild_id: string, source_message_id: string): Promise<IStarboardPost | null> {
  const [row] = await db`SELECT * FROM starboard_posts WHERE guild_id = ${guild_id} AND source_message_id = ${source_message_id}`;
  return (row as IStarboardPost) || null;
}

export async function createStarboardPost(guild_id: string, source_message_id: string, starboard_message_id: string, stars: number): Promise<IStarboardPost> {
  const [row] = await db`
    INSERT INTO starboard_posts (guild_id, source_message_id, starboard_message_id, stars)
    VALUES (${guild_id}, ${source_message_id}, ${starboard_message_id}, ${stars})
    ON CONFLICT(guild_id, source_message_id) DO UPDATE SET stars = excluded.stars, starboard_message_id = excluded.starboard_message_id
    RETURNING *
  `;
  return row as IStarboardPost;
}

export async function updateStarboardPostStars(guild_id: string, source_message_id: string, stars: number) {
  await db`UPDATE starboard_posts SET stars = ${stars} WHERE guild_id = ${guild_id} AND source_message_id = ${source_message_id}`;
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export type ITag = {
  id: number;
  guild_id: string;
  name: string;
  content: string;
  owner_id: string;
  uses: number;
  created_at: number;
};

export async function getTag(guild_id: string, name: string): Promise<ITag | null> {
  const [row] = await db`SELECT * FROM tags WHERE guild_id = ${guild_id} AND name = ${name.toLowerCase()}`;
  return (row as ITag) || null;
}

export async function createTag(guild_id: string, name: string, content: string, owner_id: string): Promise<ITag | null> {
  await ensureConfig(guild_id);
  const [row] = await db`
    INSERT INTO tags (guild_id, name, content, owner_id) VALUES (${guild_id}, ${name.toLowerCase()}, ${content}, ${owner_id})
    ON CONFLICT DO NOTHING RETURNING *`;
  return (row as ITag) || null;
}

export async function editTag(guild_id: string, name: string, content: string, editor_id: string): Promise<boolean> {
  const result = await db`
    UPDATE tags SET content = ${content}
    WHERE guild_id = ${guild_id} AND name = ${name.toLowerCase()} AND owner_id = ${editor_id}`;
  return result.count > 0;
}

export async function deleteTag(guild_id: string, name: string, requester_id: string, is_mod = false): Promise<boolean> {
  const clause = is_mod
    ? await db`DELETE FROM tags WHERE guild_id = ${guild_id} AND name = ${name.toLowerCase()}`
    : await db`DELETE FROM tags WHERE guild_id = ${guild_id} AND name = ${name.toLowerCase()} AND owner_id = ${requester_id}`;
  return clause.count > 0;
}

export async function incrementTagUses(guild_id: string, name: string) {
  await db`UPDATE tags SET uses = uses + 1 WHERE guild_id = ${guild_id} AND name = ${name.toLowerCase()}`;
}

export async function listTags(guild_id: string): Promise<ITag[]> {
  const rows = await db`SELECT * FROM tags WHERE guild_id = ${guild_id} ORDER BY name ASC`;
  return rows as ITag[];
}

// ─── Sticky messages ──────────────────────────────────────────────────────────

export type StickyKind = 'text' | 'jackpot';

export type IStickyMessage = {
  guild_id: string;
  channel_id: string;
  content: string;
  message_id: string | null;
  embed: number;
  created_by: string | null;
  created_at: number;
  /** 'text' = verbatim content; 'jackpot' = rebuilt from the live pot. */
  kind: StickyKind;
};

export async function getSticky(channel_id: string): Promise<IStickyMessage | null> {
  const [row] = await db`SELECT * FROM sticky_messages WHERE channel_id = ${channel_id}`;
  return (row as IStickyMessage) ?? null;
}

export async function getGuildStickies(guild_id: string): Promise<IStickyMessage[]> {
  const rows = await db`SELECT * FROM sticky_messages WHERE guild_id = ${guild_id}`;
  return rows as IStickyMessage[];
}

/** Every sticky of a given kind, across all guilds — used by the refresh timer. */
export async function getStickiesByKind(kind: StickyKind): Promise<IStickyMessage[]> {
  const rows = await db`SELECT * FROM sticky_messages WHERE kind = ${kind}`;
  return rows as IStickyMessage[];
}

export async function setSticky(
  guild_id: string, channel_id: string, content: string, embed: boolean, created_by: string,
  kind: StickyKind = 'text',
): Promise<void> {
  await db`
    INSERT INTO sticky_messages (guild_id, channel_id, content, embed, created_by, created_at, kind)
    VALUES (${guild_id}, ${channel_id}, ${content}, ${embed ? 1 : 0}, ${created_by}, ${Date.now()}, ${kind})
    ON CONFLICT(channel_id) DO UPDATE SET
      content = ${content}, embed = ${embed ? 1 : 0}, created_by = ${created_by},
      created_at = ${Date.now()}, kind = ${kind}`;
}

/** Records the id of the currently-posted sticky so it can be deleted on repost. */
export async function setStickyMessageId(channel_id: string, message_id: string | null): Promise<void> {
  await db`UPDATE sticky_messages SET message_id = ${message_id} WHERE channel_id = ${channel_id}`;
}

export async function removeSticky(channel_id: string): Promise<boolean> {
  const rows = await db`DELETE FROM sticky_messages WHERE channel_id = ${channel_id} RETURNING channel_id`;
  return rows.length > 0;
}

// ─── Progressive jackpot ──────────────────────────────────────────────────────

export type IJackpot = {
  guild_id: string;
  amount: number;
  seed: number;
  last_winner: string | null;
  last_amount: number;
  last_won_at: number | null;
};

export async function getJackpot(guild_id: string): Promise<IJackpot> {
  const [row] = await db`SELECT * FROM jackpot WHERE guild_id = ${guild_id}`;
  if (row) return row as IJackpot;
  const [created] = await db`
    INSERT INTO jackpot (guild_id) VALUES (${guild_id})
    ON CONFLICT(guild_id) DO UPDATE SET guild_id = ${guild_id}
    RETURNING *`;
  return created as IJackpot;
}

/** Adds a slice of a loss to the pot. Returns the new total. */
export async function addToJackpot(guild_id: string, amount: number): Promise<number> {
  if (amount <= 0) return (await getJackpot(guild_id)).amount;
  await getJackpot(guild_id);
  const [row] = await db`
    UPDATE jackpot SET amount = amount + ${amount} WHERE guild_id = ${guild_id}
    RETURNING amount`;
  return (row as { amount: number })?.amount ?? 0;
}

/**
 * Pays the whole pot to a winner and resets it to the seed. Returns the amount
 * won (0 if the pot was empty). The balance credit is done by the caller so it
 * can be folded into that game's payout line.
 */
export async function claimJackpot(guild_id: string, user_id: string): Promise<number> {
  const jp = await getJackpot(guild_id);
  const won = jp.amount;
  if (won <= 0) return 0;
  await db`
    UPDATE jackpot
    SET amount = seed, last_winner = ${user_id}, last_amount = ${won}, last_won_at = ${Date.now()}
    WHERE guild_id = ${guild_id}`;
  return won;
}
