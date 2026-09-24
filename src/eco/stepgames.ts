import { rand, randInt } from '../utils/random.js';

/**
 * Pure logic for the "push your luck" games (mines, towers, ladder, higher/lower) and dice.
 * House edge is zero — like the rest of the casino, every multiplier is the exact inverse of the
 * probability of getting there, so any cash-out strategy has an expected return of 1.0×.
 * (A slice of every loss still feeds the shared jackpot, see utils/gamble.ts.)
 */

/** A multiplier is 1 / P(reaching this point). Rounded down to 2 dp so the player is never paid more than fair. */
export const fairMultiplier = (probability: number) => (probability <= 0 ? 0 : Math.floor((1 / probability) * 100) / 100);

// ─── Mines ───────────────────────────────────────────────────────────────────

export const MINES_ROWS = 4;
export const MINES_COLS = 5;
export const MINES_TILES = MINES_ROWS * MINES_COLS;
export const MINES_MIN = 1;
export const MINES_MAX = MINES_TILES - 1;

/** Probability of clearing `revealed` tiles in a row with `mines` hidden among `MINES_TILES`. */
export function minesSurvival(mines: number, revealed: number): number {
  let p = 1;
  for (let i = 0; i < revealed; i++) p *= (MINES_TILES - mines - i) / (MINES_TILES - i);
  return p;
}
export const minesMultiplier = (mines: number, revealed: number) => (revealed <= 0 ? 0 : fairMultiplier(minesSurvival(mines, revealed)));

/** `count` distinct positions in [0, size) chosen with crypto randomness (partial Fisher–Yates). */
export function pickDistinct(size: number, count: number, r: () => number = rand): Set<number> {
  const pool = Array.from({ length: size }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(r() * (size - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return new Set(pool.slice(0, count));
}

export interface MinesState { mines: Set<number>; mineCount: number; revealed: Set<number> }
export function newMines(mineCount: number, r: () => number = rand): MinesState {
  return { mines: pickDistinct(MINES_TILES, mineCount, r), mineCount, revealed: new Set() };
}
/** Returns 'bust' if the tile is a mine, 'safe' otherwise (idempotent for already-revealed tiles), 'clear' when every safe tile is open. */
export function minesReveal(s: MinesState, tile: number): 'bust' | 'safe' | 'clear' | 'invalid' {
  if (tile < 0 || tile >= MINES_TILES) return 'invalid';
  if (s.revealed.has(tile)) return 'invalid';
  if (s.mines.has(tile)) return 'bust';
  s.revealed.add(tile);
  return s.revealed.size === MINES_TILES - s.mineCount ? 'clear' : 'safe';
}

// ─── Towers ──────────────────────────────────────────────────────────────────

export const TOWER_ROWS = 5;
export const TOWER_MODES: Record<string, { label: string; tiles: number; safe: number }> = {
  easy:   { label: 'Easy (2 of 3 safe)',   tiles: 3, safe: 2 },
  medium: { label: 'Medium (1 of 2 safe)', tiles: 2, safe: 1 },
  hard:   { label: 'Hard (1 of 3 safe)',   tiles: 3, safe: 1 },
};
export const towersMultiplier = (mode: string, rowsCleared: number) => {
  const m = TOWER_MODES[mode];
  return !m || rowsCleared <= 0 ? 0 : fairMultiplier(Math.pow(m.safe / m.tiles, rowsCleared));
};

export interface TowersState { mode: string; layout: Set<number>[]; picks: number[] }
export function newTowers(mode: string, r: () => number = rand): TowersState {
  const m = TOWER_MODES[mode]!;
  return { mode, layout: Array.from({ length: TOWER_ROWS }, () => pickDistinct(m.tiles, m.safe, r)), picks: [] };
}
export function towersPick(s: TowersState, tile: number): 'bust' | 'safe' | 'clear' | 'invalid' {
  const m = TOWER_MODES[s.mode]!;
  if (tile < 0 || tile >= m.tiles || s.picks.length >= TOWER_ROWS) return 'invalid';
  const row = s.picks.length;
  s.picks.push(tile);
  if (!s.layout[row]!.has(tile)) return 'bust';
  return s.picks.length === TOWER_ROWS ? 'clear' : 'safe';
}

// ─── Ladder ──────────────────────────────────────────────────────────────────

/** Chance of surviving each successive rung. */
export const LADDER_CHANCES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2] as const;
export const ladderMultiplier = (rungs: number) => {
  if (rungs <= 0) return 0;
  let p = 1;
  for (let i = 0; i < rungs; i++) p *= LADDER_CHANCES[i]!;
  return fairMultiplier(p);
};
export function ladderClimb(rung: number, r: () => number = rand): 'fall' | 'up' | 'top' {
  if (r() >= LADDER_CHANCES[rung]!) return 'fall';
  return rung + 1 >= LADDER_CHANCES.length ? 'top' : 'up';
}

// ─── Higher / Lower ──────────────────────────────────────────────────────────

export const CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const drawRank = (r: () => number = rand) => Math.floor(r() * 13) + 1; // 1..13
export const rankName = (rank: number) => CARD_RANKS[rank - 1]!;

/** Chance the next (independent) card is strictly higher / lower. Ties lose both guesses. */
export const chanceHigher = (rank: number) => (13 - rank) / 13;
export const chanceLower = (rank: number) => (rank - 1) / 13;

export function hiloGuess(current: number, guess: 'higher' | 'lower', r: () => number = rand) {
  const next = drawRank(r);
  const win = guess === 'higher' ? next > current : next < current;
  const p = guess === 'higher' ? chanceHigher(current) : chanceLower(current);
  return { next, win, step: fairMultiplier(p) };
}

// ─── Dice (2d6 vs the house) ─────────────────────────────────────────────────

export const roll2d6 = () => randInt(1, 6) + randInt(1, 6);
/** 2d6 vs 2d6 over all 1296 outcomes: player wins 575, ties 146, loses 575. */
export const DICE_WIN_CHANCE = 575 / 1296;
export const DICE_TIE_CHANCE = 146 / 1296;
/** A win pays 2× (stake back + equal profit); a tie is a push. RTP = 575/1296·2 + 146/1296 = 1. */
export const DICE_WIN_MULT = 2;

// ─── Odds text (/eco games odds) ─────────────────────────────────────────────

export function oddsText(game: string): string {
  switch (game) {
    case 'mines': {
      const sample = [1, 3, 5, 10].map(m => `${m} mine${m > 1 ? 's' : ''}: first tile ×${minesMultiplier(m, 1)}, 3 tiles ×${minesMultiplier(m, 3)}`).join('\n');
      return `A ${MINES_ROWS}×${MINES_COLS} grid hides your chosen number of mines. Each safe tile raises the multiplier; cash out any time after the first tile. Hit a mine and you lose the bet.\n${sample}`;
    }
    case 'towers': {
      return Object.entries(TOWER_MODES).map(([k, m]) => `**${m.label}**: 5 rows → ${[1, 2, 3, 4, 5].map(r => `×${towersMultiplier(k, r)}`).join(', ')}`).join('\n');
    }
    case 'ladder': {
      return `Climb rung by rung — each climb has a fixed chance of holding: ${LADDER_CHANCES.map(c => `${Math.round(c * 100)}%`).join(' → ')}.\nCash-out multipliers: ${LADDER_CHANCES.map((_, i) => `×${ladderMultiplier(i + 1)}`).join(', ')}.`;
    }
    case 'higherlower':
      return 'A card (A–K) is shown. Guess whether the next card is higher or lower — ties lose. Each right guess multiplies your stake by the inverse of its probability, and you can cash out after any correct guess.';
    case 'dice':
      return `You and the house each roll two dice. Higher total wins ×${DICE_WIN_MULT}; a tie is a push. Win chance ${(DICE_WIN_CHANCE * 100).toFixed(1)}%, tie ${(DICE_TIE_CHANCE * 100).toFixed(1)}%.`;
    case 'flip': return 'A true 50/50. Win doubles your bet.';
    case 'highroll': return 'You and the bot each roll 1–100. Higher roll wins ×2; a tie refunds the bet.';
    case 'slots': return 'Pairs: 🍒 ½× | 🍋 1× | 🔔 1.5× | 💎 2× | 7️⃣ 3×. Triples: 🍒 4× | 🍋 7× | 🔔 12× | 💎 25× | 7️⃣ 75×.';
    case 'roulette': return 'Red/black, odd/even and low/high pay ×2 (a true 50/50 — there is no zero). A single number pays ×36 at 1-in-36 odds.';
    case 'blackjack': return 'Dealer stands on 17. Blackjack pays 1.5×. Hit, stand or double down.';
    case 'crash': return 'The multiplier drifts up and down and can crash to zero at any tick. Cash out before it does — every strategy is fair over time.';
    case 'poker': return 'Jacks or Better video poker. Royal Flush 250×, Straight Flush 50×, Four of a Kind 25×, Full House 9×, Flush 6×, Straight 4×, Three of a Kind 3×, Two Pair 2×, Jacks or Better 1×.';
    case 'scratch': return 'Match 4 of the same symbol among 9 cells: 🍒 1× | 🍋 2× | 🔔 3× | 🍇 6× | ⭐ 12× | 💎 25×.';
    case 'plinko': return 'Ten rows of pegs: the buckets pay 48× 8× 3× 1.2× 0.35× 0.25× (mirrored). Dead fair odds.';
    default: return 'Unknown game.';
  }
}
