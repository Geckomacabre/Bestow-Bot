import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { Sub, SubGroup } from '../../framework/group.js';
import { heistSpec, hsub, specDescription, type OptTweak } from '../../framework/heist.js';
import { BANK_SPACE_PRICE, BANK_START_CAP, getEco } from '../../eco/core.js';
import { BUSINESSES, INVESTMENTS, LAB, PROJECTS } from '../../eco/catalog.js';
import { AMOUNT_HELP, cv2Err, parseAmount } from './ui.js';
import { MINES_MAX, MINES_MIN } from '../../eco/stepgames.js';

/**
 * Heist's /eco and /eco-company, exactly: descriptions from Heist's list, and Heist's options on top of Bestow's handlers.
 * Where Heist takes something different (an amount like "all" or "10k" instead of a number, "red" / "17" as a roulette bet,
 * a business by name), an adapter works out the value the handler expects before it runs.
 */

type I = ChatInputCommandInteraction;
type Values = Record<string, unknown>;
/** Works out the handler's option values from Heist's; a string is an error to show instead. */
export type Prep = (i: I) => Promise<Values | string>;
interface Adapter { prep?: Prep; tweaks?: Record<string, OptTweak>; autocomplete?: (i: AutocompleteInteraction) => Promise<unknown> }

const GETTERS = new Set(['get', 'getString', 'getInteger', 'getNumber', 'getBoolean', 'getUser', 'getMember', 'getAttachment', 'getChannel', 'getRole', 'getMentionable']);

/** The interaction with some option values replaced (`undefined` = read the real option). */
export function withValues<T extends I>(i: T, values: Values): T {
  const bind = (t: object, p: string | symbol) => { const v = Reflect.get(t, p, t); return typeof v === 'function' ? v.bind(t) : v; };
  const opts = new Proxy(i.options as object, {
    get(t, p) {
      const fn = bind(t, p);
      if (typeof p !== 'string' || !GETTERS.has(p) || typeof fn !== 'function') return fn;
      return (name: string, ...rest: unknown[]) => (name in values && values[name] !== undefined ? values[name] ?? null : fn(name, ...rest));
    },
  });
  return new Proxy(i as object, { get(t, p) { return p === 'options' ? opts : bind(t, p); } }) as T;
}

// ─── Value helpers ───────────────────────────────────────────────────────────

const cash = async (i: I) => (await getEco(i.guildId ?? 'global', i.user.id)).balance;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, ' ').trim();

/** Heist's amount string ("500", "2.5k", "all", "half", "25%") → the number the handler asks for as `to`. */
export const amount = (to: string, max: (i: I) => Promise<number> = cash, opt = 'amount', required = true): Prep => async i => {
  const raw = i.options.getString(opt, required);
  if (raw == null) return { [to]: null };
  const v = parseAmount(raw, await max(i));
  return v == null ? `❌ That isn't an amount I can use. ${AMOUNT_HELP}.` : { [to]: v, ...(to !== opt ? { [opt]: undefined } : {}) };
};

/** A Heist choice name → the handler's value (case-insensitive; `map` for renamed ones). */
export const choice = (opt: string, map: Record<string, string> = {}): Prep => async i => {
  const v = i.options.getString(opt);
  return { [opt]: v == null ? null : map[v] ?? v.toLowerCase() };
};

/** A thing named in free text (a business, an investment, a project) → its catalog key. */
export function byName(catalog: Record<string, { name: string }>, what: string, opt = 'name'): Prep {
  return async i => {
    const q = norm(i.options.getString(opt, true));
    const key = Object.keys(catalog).find(k => k === q.replace(/ /g, '') || norm(catalog[k]!.name) === q) ?? Object.keys(catalog).find(k => norm(catalog[k]!.name).startsWith(q));
    return key ? { [opt]: key } : `❌ There's no ${what} called **${i.options.getString(opt, true).slice(0, 60)}**. Pick one from the list.`;
  };
}
const suggest = (catalog: Record<string, { name: string; emoji?: string; cost?: number; goal?: number }>) => async (i: AutocompleteInteraction) => {
  const q = norm(String(i.options.getFocused()));
  await i.respond(Object.values(catalog).filter(x => norm(x.name).includes(q)).slice(0, 25)
    .map(x => ({ name: `${x.emoji ? `${x.emoji} ` : ''}${x.name}${x.cost ? ` — ${x.cost.toLocaleString()}` : x.goal ? ` — goal ${x.goal.toLocaleString()}` : ''}`.slice(0, 100), value: x.name })));
};

/** Heist's roulette bet: red / black / even / odd / low (1-18) / high (19-36) / green / a number 0–36. */
export function rouletteBet(raw: string): { type: string; number: number | null } | null {
  const s = raw.trim().toLowerCase().replace(/[–—]/g, '-');
  const named: Record<string, string> = { red: 'red', r: 'red', black: 'black', b: 'black', even: 'even', odd: 'odd', low: 'low', '1-18': 'low', high: 'high', '19-36': 'high' };
  if (named[s]) return { type: named[s]!, number: null };
  if (s === 'green') return { type: 'number', number: 0 };
  if (/^\d{1,2}$/.test(s) && Number(s) <= 36) return { type: 'number', number: Number(s) };
  return null;
}

const both = (...preps: Prep[]): Prep => async i => {
  const out: Values = {};
  for (const p of preps) { const r = await p(i); if (typeof r === 'string') return r; Object.assign(out, r); }
  return out;
};

// ─── The mapping: Heist path → how to run Bestow's handler there ─────────────

const GAME_ODDS: Record<string, string> = { Dice: 'dice', Coinflip: 'flip', Roulette: 'roulette', Slots: 'slots', Ladder: 'ladder', Mines: 'mines', Blackjack: 'blackjack', 'Higher/Lower': 'higherlower', Towers: 'towers' };
const bankSpaces = async (i: I) => Math.max(0, (await getEco(i.guildId ?? 'global', i.user.id)).bank_cap - BANK_START_CAP);
const buyableSpaces = async (i: I) => Math.floor((await cash(i)) / BANK_SPACE_PRICE);

export const ADAPTERS: Record<string, Adapter> = {
  'eco bank upgrade': { prep: amount('amount', buyableSpaces) },
  'eco bank sell': { prep: amount('amount', bankSpaces) },
  'eco giveaway': { prep: async i => ({ amount: String(i.options.getInteger('amount', true)) }), tweaks: { amount: { min: 1 }, winners: { min: 1, max: 20 } } },
  'eco wallet-edit background': { prep: async i => {
    const d = i.options.getString('direction');
    if (d == null) return {};
    const v = d.trim().toLowerCase();
    return ['horizontal', 'vertical', 'diagonal'].includes(v) ? { direction: v } : '❌ Direction must be **Horizontal**, **Vertical** or **Diagonal**.';
  }, tweaks: { direction: { autocomplete: true } }, autocomplete: async i => { await i.respond(['Horizontal', 'Vertical', 'Diagonal'].map(n => ({ name: n, value: n }))); } },
  'eco wallet-edit avatar': { prep: choice('shape') },
  'eco games dice': { prep: amount('amount') },
  'eco games ladder': { prep: amount('amount') },
  'eco games higherlower': { prep: amount('amount') },
  'eco games mines': { prep: amount('amount'), tweaks: { count: { min: MINES_MIN, max: MINES_MAX } } },
  'eco games towers': { prep: both(amount('amount'), choice('difficulty')) },
  'eco games slots': { prep: amount('bet') },
  'eco games blackjack': { prep: amount('bet') },
  'eco games coinflip': { prep: amount('bet') },
  'eco games roulette': { prep: both(amount('bet'), async i => {
    const b = rouletteBet(i.options.getString('bet', true));
    return b ? { type: b.type, number: b.number } : '❌ Bet on **red**, **black**, **even**, **odd**, **low** (1-18), **high** (19-36), **green** or a number **0–36**.';
  }), tweaks: { bet: { maxLength: 10 } } },
  'eco games odds': { prep: choice('game', GAME_ODDS) },
  'eco card buy': { prep: choice('case_type'), tweaks: { amount: { min: 1, max: 100 } } },
  'eco card open': { prep: both(choice('case_type'), choice('category')), tweaks: { amount: { min: 1, max: 25 } } },
  'eco card list': {},
  'eco card unequip': { prep: choice('category') },
  'eco card upgrade': { prep: choice('category'), tweaks: { stars: { min: 1, max: 4 } } },
  'eco business buy': { prep: byName(BUSINESSES, 'business'), tweaks: { name: { autocomplete: true, maxLength: 40 } }, autocomplete: suggest(BUSINESSES) },
  'eco investment start': { prep: byName(INVESTMENTS, 'investment'), tweaks: { name: { autocomplete: true, maxLength: 40 } }, autocomplete: suggest(INVESTMENTS) },
  'eco lab ampoules': { prep: amount('amount', async i => Math.floor((await cash(i)) / LAB.ampoulePrice)) },
  'eco quest start': { prep: choice('difficulty') },
  'eco-company privacy': { prep: choice('privacy', { Public: 'open', Closed: 'invite', Request: 'request' }) },
  'eco-company project start': { prep: byName(PROJECTS, 'project'), tweaks: { name: { autocomplete: true, maxLength: 40 } }, autocomplete: suggest(PROJECTS) },
  'eco-company project collect': { prep: amount('amount', async () => Number.MAX_SAFE_INTEGER, 'amount', false) },
};

function adapt(path: string, sub: Sub): Sub {
  const a = ADAPTERS[path];
  if (!a) return { ...sub, description: specDescription(heistSpec(path)) }; // same options: only the wording changes
  const run = async (i: I) => {
    const v = a.prep ? await a.prep(i) : {};
    if (typeof v === 'string') { await i.reply(cv2Err(v)); return; }
    return sub.run(withValues(i, v));
  };
  return hsub(path, run, { tweaks: a.tweaks, autocomplete: a.autocomplete ?? sub.autocomplete, permissions: sub.permissions, guildOnly: sub.guildOnly, premium: sub.premium });
}

/** Re-mount the subs in `paths` (Heist paths under `prefix`); everything else stays as it is. */
export function conform(prefix: string, paths: readonly string[], tree: { subs: Sub[]; groups: SubGroup[] }): { subs: Sub[]; groups: SubGroup[] } {
  const want = new Set(paths);
  const fix = (path: string, s: Sub) => (want.has(path) ? adapt(path, s) : s);
  return {
    subs: tree.subs.map(s => fix(`${prefix} ${s.name}`, s)),
    groups: tree.groups.map(g => ({ ...g, subs: g.subs.map(s => fix(`${prefix} ${g.name} ${s.name}`, s)) })),
  };
}

/** Every /eco and /eco-company path whose Heist description or options differ from Bestow's original. */
export const DRIFTING = [
  'eco wallet', 'eco bank deposit', 'eco bank withdraw', 'eco bank upgrade', 'eco bank sell', 'eco transfer', 'eco bonus', 'eco beg', 'eco work', 'eco rob',
  'eco wallet-edit background', 'eco wallet-edit avatar', 'eco giveaway',
  'eco games dice', 'eco games coinflip', 'eco games roulette', 'eco games slots', 'eco games ladder', 'eco games mines', 'eco games blackjack',
  'eco games higherlower', 'eco games towers', 'eco games odds',
  'eco card buy', 'eco card open', 'eco card list', 'eco card unequip', 'eco card upgrade',
  'eco business buy', 'eco business sell', 'eco lab buy', 'eco lab ampoules', 'eco lab sell',
  'eco leaderboard global', 'eco leaderboard cash', 'eco leaderboard networth', 'eco quest start', 'eco quest stop', 'eco quest leaderboard', 'eco investment start',
  'eco-company create', 'eco-company delete', 'eco-company uprank', 'eco-company downrank', 'eco-company upgrade', 'eco-company privacy',
  'eco-company project start', 'eco-company project cancel', 'eco-company project collect',
] as const;
