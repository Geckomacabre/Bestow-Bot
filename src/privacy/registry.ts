/**
 * The single source of truth for "what does this bot store about a person?".
 *
 * Every table that has a column identifying a user MUST appear here, either as
 *  - `delete`  : rows are removed by /privacy delete,
 *  - `anonymize`: the row belongs to a server (a tag, a jackpot history) so the user id is blanked instead,
 *  - `keep`    : a server-owned record the person can export but not delete (none exist today; the machinery is kept for future use),
 * and tests/privacy.test.ts fails if a new table with a user column is added without an entry, so nothing can slip through unnoticed.
 */

export type Policy = 'delete' | 'anonymize' | 'keep';

export interface PrivacyEntry {
  table: string;
  /** Columns that identify the person (any match → row is theirs). */
  columns: string[];
  label: string;
  policy: Policy;
  /** For `keep`: why it is retained. For `anonymize`: what happens. */
  note?: string;
}

const del = (table: string, label: string, ...columns: string[]): PrivacyEntry => ({ table, columns: columns.length ? columns : ['user_id'], label, policy: 'delete' });

export const REGISTRY: PrivacyEntry[] = [
  // Economy
  del('economy', 'Balance, bank and lifetime totals'), del('eco_ledger', 'Transaction history'), del('eco_bank_ledger', 'Bank history'), del('eco_bonus_claim', 'One-time bonuses claimed'),
  del('eco_business', 'Businesses'), del('eco_lab', 'Labs'), del('eco_investment', 'Investments'), del('eco_quest', 'Quests'), del('eco_quest_stats', 'Quest stats'),
  del('eco_case', 'Cases'), del('eco_card', 'Trading cards', 'owner_id'), del('eco_wallet_style', 'Wallet card style'),
  del('eco_company_member', 'Company memberships'), del('eco_company_contrib', 'Company contributions'), del('eco_company_log', 'Company activity'), del('eco_company_invite', 'Company invites'), del('eco_company_request', 'Company join requests'),
  del('economy_boosts', 'Boosts'), del('economy_cooldowns', 'Command cooldowns'), del('economy_protection', 'Robbery protection'), del('game_stats', 'Game statistics'), del('game_xp_daily', 'Daily game XP'),
  { table: 'jackpot', columns: ['last_winner'], label: 'Last jackpot winner', policy: 'anonymize', note: 'the server\'s jackpot history keeps the amount but not who won' },
  // Levels, social
  del('xp', 'Levels and message counts (counts only — never message text)'), del('reputation', 'Reputation'), del('rep_cooldowns', 'Reputation cooldowns', 'from_user_id', 'to_user_id'),
  // Things you entered yourself
  del('birthdays', 'Birthday'), del('timezones', 'Timezone'), del('timezone_user', 'Per-server timezone'), del('reminders', 'Reminders'), del('scheduled_tasks', 'Scheduled tasks'), del('rsvp_responses', 'Event RSVPs'),
  // Fun
  del('juul_state', 'Juul'),
  // Your own tags (/tags) and any unused export codes for them
  del('user_tags', 'Your tags'), del('tag_exports', 'Tag export codes you made'),
  // /lastfm login (your Last.fm username, login key and display preferences)
  del('lastfm_users', 'Your linked Last.fm account'),
  // /crypto track (transaction hashes you asked to watch)
  del('crypto_trackers', 'Crypto transactions you are tracking'),
  // /me and /donate
  del('bestow_users', 'Your Bestow UID, first-use date and command count'), del('donations', 'Donations you submitted'),
  // A server setting that remembers which admin set it up
  { table: 'ping_on_join', columns: ['created_by'], label: 'Ping-on-join channels you set up', policy: 'anonymize', note: 'the server keeps its setting; you are removed as the admin who created it' },
  // AI — all opt-in, entered by the person
  del('ai_persona', 'Your AI persona'), del('ai_prefs', 'AI memory preference'), del('ai_memory', 'AI memory notes you saved'),
  // Premium — a local mirror of your subscription/grant, plus gift codes you bought or redeemed
  del('user_accent', 'Your accent color (/customize color)'), del('premium_users', 'Premium status'), del('premium_gifts', 'Premium gift codes', 'buyer_id', 'redeemed_by'),
  // Giveaways: entries are yours (deleted); a giveaway you hosted belongs to its server, so only your id is blanked. Your id inside the winner lists is scrubbed by deleteData.
  del('giveaway_entries', 'Giveaway entries'),
  { table: 'giveaways', columns: ['host_id'], label: 'Giveaways you hosted', policy: 'anonymize', note: 'the giveaway and its result stay for the server; you are removed as its host and from its winner lists' },
  // Content you authored for a server: kept for the server, detached from you
  { table: 'tags', columns: ['owner_id'], label: 'Tags you created', policy: 'anonymize', note: 'the tag stays for the server; you are removed as its owner' },
];

/**
 * Tables that mention a user-ish column but are covered elsewhere or are not personal data about a person:
 * the tests require every user-column table to be in REGISTRY *or* here, with a reason.
 */
export const EXEMPT: Record<string, string> = {
  'eco_company': 'owner_id: shared company; deletion is refused while you own one (transfer or disband first)',
  'mediaguess_rounds': 'transient game state; user_hints is a counter map for the current round and is cleared when the round ends',
  'twitch_feeds': 'twitch_username is a streamer the server follows',
};

/** Extra registry entries added at runtime by optional modules (e.g. AI memory). */
export function registerPrivacy(entry: PrivacyEntry): void {
  const i = REGISTRY.findIndex(e => e.table === entry.table);
  if (i >= 0) REGISTRY[i] = entry; else REGISTRY.push(entry);
}
