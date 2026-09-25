/**
 * Static economy catalog: everything balance-related lives here as plain data so it can
 * be tuned in one place (and tested) without touching command code. No imports on purpose —
 * core.ts and the SQL helpers depend on this file, so it must not depend on them.
 */

const HOUR = 3_600_000;
const MIN = 60_000;

// ─── Businesses ─────────────────────────────────────────────────────────────

export interface BusinessDef { name: string; emoji: string; cost: number; perHour: number; blurb: string }

/** One business per player. Income accrues hourly for up to MAX_ACCRUAL_HOURS, then waits to be collected. */
export const BUSINESSES: Record<string, BusinessDef> = {
  lemonade:  { name: 'Lemonade Stand',   emoji: '🍋', cost: 2_000,     perHour: 40,      blurb: 'A folding table and a dream.' },
  foodtruck: { name: 'Food Truck',       emoji: '🚚', cost: 10_000,    perHour: 220,     blurb: 'Tacos on wheels.' },
  arcade:    { name: 'Arcade',           emoji: '🕹️', cost: 50_000,    perHour: 1_200,   blurb: 'Quarters, tokens and sticky floors.' },
  nightclub: { name: 'Nightclub',        emoji: '🪩', cost: 250_000,   perHour: 6_500,   blurb: 'Velvet rope, loud bass.' },
  casino:    { name: 'Casino',           emoji: '🎰', cost: 1_000_000, perHour: 27_000,  blurb: 'The house always wins (from you, this time).' },
  startup:   { name: 'Tech Startup',     emoji: '💻', cost: 5_000_000, perHour: 140_000, blurb: 'Disrupting something. Probably.' },
};
export const MAX_ACCRUAL_HOURS = 24;
/** Selling a business returns this share of its price. */
export const BUSINESS_SELL_REFUND = 0.5;

// ─── Laboratory ─────────────────────────────────────────────────────────────

export const LAB = {
  buyCost: 25_000,
  maxLevel: 10,
  /** Coins produced per hour at level L: perHourPerLevel * L. */
  perHourPerLevel: 100,
  /** Cost to upgrade from level L to L+1: upgradeCostPerLevel * L. */
  upgradeCostPerLevel: 30_000,
  ampoulePrice: 20,
  /** Each running hour consumes one ampoule; the lab stores up to this many per level. */
  ampoulesPerLevel: 24,
  sellRefund: 0.5,
  maxAccrualHours: 24,
} as const;

// ─── Investments ────────────────────────────────────────────────────────────

export interface InvestmentDef {
  name: string; emoji: string; cost: number; durationMs: number;
  /** Chance the investment pays off. */
  chance: number;
  /** Payout multiplier on success / on failure (fraction of cost returned). */
  win: number; lose: number;
  blurb: string;
}

export const INVESTMENTS: Record<string, InvestmentDef> = {
  bond:       { name: 'Savings Bond',  emoji: '🏦', cost: 1_000,  durationMs: 1 * HOUR,  chance: 1.0,  win: 1.05, lose: 1,   blurb: 'Boring. Safe. Guaranteed.' },
  index:      { name: 'Index Fund',    emoji: '📈', cost: 5_000,  durationMs: 6 * HOUR,  chance: 0.92, win: 1.25, lose: 0.8, blurb: 'Bet on the whole market.' },
  realestate: { name: 'Real Estate',   emoji: '🏠', cost: 25_000, durationMs: 24 * HOUR, chance: 0.85, win: 1.6,  lose: 0.5, blurb: 'Location, location, location.' },
  tech:       { name: 'Tech Stocks',   emoji: '🖥️', cost: 10_000, durationMs: 12 * HOUR, chance: 0.7,  win: 2.0,  lose: 0.3, blurb: 'Growth! (Sometimes.)' },
  crypto:     { name: 'Crypto',        emoji: '🪙', cost: 5_000,  durationMs: 4 * HOUR,  chance: 0.45, win: 3.5,  lose: 0,   blurb: 'To the moon — or the floor.' },
  moonshot:   { name: 'Moonshot Startup', emoji: '🚀', cost: 50_000, durationMs: 48 * HOUR, chance: 0.4, win: 4.5, lose: 0, blurb: 'Pre-revenue, post-hype.' },
};

// ─── Quests ─────────────────────────────────────────────────────────────────

export interface QuestTier { label: string; emoji: string; durationMs: number; min: number; max: number }

export const QUEST_TIERS: Record<string, QuestTier> = {
  easy:   { label: 'Easy',   emoji: '🟢', durationMs: 30 * MIN, min: 300,    max: 600 },
  medium: { label: 'Medium', emoji: '🟡', durationMs: 2 * HOUR, min: 1_500,  max: 2_500 },
  hard:   { label: 'Hard',   emoji: '🟠', durationMs: 6 * HOUR, min: 6_000,  max: 9_000 },
  insane: { label: 'Insane', emoji: '🔴', durationMs: 24 * HOUR, min: 40_000, max: 60_000 },
};

export const QUEST_TITLES = [
  'Escort a nervous merchant across the badlands',
  'Retrieve a stolen crown from a goblin market',
  'Clear the rats out of the tavern cellar',
  'Deliver a sealed letter to the mountain king',
  'Hunt the beast that has been eating the sheep',
  'Guard the caravan through the haunted forest',
  'Recover a lost family heirloom from the swamp',
  'Investigate strange lights above the old lighthouse',
  'Negotiate peace between two feuding guilds',
  'Map the caves beneath the sunken temple',
  'Chase a thief across the rooftops of the city',
  'Win a riddle contest against a sphinx',
];

// ─── Trading cards ──────────────────────────────────────────────────────────

export const CARD_CATEGORIES: Record<string, { name: string; emoji: string; effect: string; names: string[] }> = {
  business: {
    name: 'Business', emoji: '💼', effect: '+3% business income per ★',
    names: ['Corner Office', 'Board Seat', 'Franchise License', 'Golden Handshake', 'Company Card', 'Stock Options', 'Market Share', 'Merger Deal', 'Venture Fund', 'Brand Empire'],
  },
  lab: {
    name: 'Lab', emoji: '🧪', effect: '+3% lab output per ★',
    names: ['Petri Dish', 'Centrifuge', 'Bunsen Burner', 'Microscope', 'Clean Room', 'Particle Beam', 'Gene Splicer', 'Lab Coat', 'Research Grant', 'Nobel Medal'],
  },
  personal: {
    name: 'Personal', emoji: '👤', effect: '+2% from work, claims and quests per ★',
    names: ['Four-Leaf Clover', 'Coffee Machine', 'Promotion Letter', 'Lucky Coin', 'Mentor', 'Side Hustle', 'Piggy Bank', 'Rabbit\'s Foot', 'Ergonomic Chair', 'Money Tree'],
  },
};
/** Cards from before the Heist categories: kept in legacy_category, now Personal (see eco/schema.ts). */
export const LEGACY_CARD_CATEGORIES = ['fortune', 'career', 'rogue', 'guardian', 'banker'] as const;

export interface CaseDef { name: string; emoji: string; cost: number; /** odds for 1★..5★, sums to 1 */ odds: [number, number, number, number, number] }

export const CASES: Record<string, CaseDef> = {
  standard: { name: 'Standard', emoji: '📦', cost: 2_500,  odds: [0.40, 0.38, 0.16, 0.05, 0.01] },
  blackice: { name: 'Blackice', emoji: '🧊', cost: 10_000, odds: [0.10, 0.30, 0.35, 0.20, 0.05] },
};
/** Cases from before Heist's two: Basic and Premium became Standard, Legendary became Blackice. */
export const LEGACY_CASES: Record<string, string> = { basic: 'standard', premium: 'standard', legendary: 'blackice' };
/** Chance a pulled card is a holo (non-standard, can't be merged, double effect). */
export const HOLO_CHANCE = 0.02;
export const CARD_SHRED_VALUE = [0, 100, 400, 1_500, 6_000, 25_000] as const;
export const HOLO_SHRED_MULT = 3;
export const MERGE_COUNT = 10;
export const MAX_STARS = 5;

// ─── Companies ──────────────────────────────────────────────────────────────

export const COMPANY = {
  createCost: 50_000,
  maxLevel: 10,
  baseMembers: 10,
  membersPerLevel: 5,
  /** Vault cost to go from level L to L+1: upgradeBase * 2^(L-1). */
  upgradeBase: 100_000,
  tagMin: 2, tagMax: 5, nameMin: 3, nameMax: 24, descMax: 200,
} as const;

export interface ProjectDef { name: string; emoji: string; goal: number; durationMs: number; /** pool = goal * yield when it completes */ yield: number }

export const PROJECTS: Record<string, ProjectDef> = {
  warehouse:  { name: 'Warehouse',  emoji: '🏭', goal: 50_000,    durationMs: 12 * HOUR, yield: 1.3 },
  lab:        { name: 'R&D Lab',    emoji: '🧪', goal: 200_000,   durationMs: 24 * HOUR, yield: 1.35 },
  skyscraper: { name: 'Skyscraper', emoji: '🏙️', goal: 1_000_000, durationMs: 48 * HOUR, yield: 1.4 },
};

// ─── Bonuses ────────────────────────────────────────────────────────────────

export const BONUS = { min: 200, max: 1_000, cooldownMs: 6 * HOUR, joinBonus: 1_000 } as const;

/** SQL expression for a user's net worth (cash + bank + business price + lab investment), for alias `e` = economy. */
export function networthSql(): string {
  const cases = Object.entries(BUSINESSES).map(([k, b]) => `WHEN '${k}' THEN ${b.cost}`).join(' ');
  return `(e.balance + e.bank
    + COALESCE((SELECT CASE bz.kind ${cases} ELSE 0 END FROM eco_business bz WHERE bz.user_id = e.user_id), 0)
    + COALESCE((SELECT l.total_spent FROM eco_lab l WHERE l.user_id = e.user_id), 0))`;
}
