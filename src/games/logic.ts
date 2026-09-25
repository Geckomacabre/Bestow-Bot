/** Pure rules for the /games minigames. No Discord here, so every rule can be tested directly. */

export type Rand = () => number;
export const defaultRand: Rand = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x1_0000_0000;
export const randInt = (n: number, rand: Rand = defaultRand) => Math.floor(rand() * n);

// ─── Tic-tac-toe ─────────────────────────────────────────────────────────────

export type Mark = 'X' | 'O';
export type Cell = Mark | null;
export type Board = Cell[]; // 9 cells, row-major

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]] as const;

export function tttOutcome(b: Board): { winner: Mark; line: readonly number[] } | 'draw' | null {
  for (const l of LINES) {
    const [a, c, d] = l;
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { winner: b[a]!, line: l };
  }
  return b.every(Boolean) ? 'draw' : null;
}

/** Places `mark` on an empty cell; returns a new board, or null if the move is illegal. */
export function tttPlay(b: Board, cell: number, mark: Mark): Board | null {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || b[cell]) return null;
  const next = [...b]; next[cell] = mark; return next;
}

// ─── Rock paper scissors ─────────────────────────────────────────────────────

export type Rps = 'rock' | 'paper' | 'scissors';
export const RPS: Rps[] = ['rock', 'paper', 'scissors'];
export const RPS_EMOJI: Record<Rps, string> = { rock: '🪨', paper: '📄', scissors: '✂️' };
const BEATS: Record<Rps, Rps> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** 1 = a wins, -1 = b wins, 0 = tie. */
export const rpsCompare = (a: Rps, b: Rps): 1 | -1 | 0 => (a === b ? 0 : BEATS[a] === b ? 1 : -1);

// ─── Blackjack (head to head) ────────────────────────────────────────────────

export type Card = { rank: string; suit: string };
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function newDeck(rand: Rand = defaultRand): Card[] {
  const d = SUITS.flatMap(suit => RANKS.map(rank => ({ rank, suit })));
  for (let i = d.length - 1; i > 0; i--) { const j = randInt(i + 1, rand); [d[i], d[j]] = [d[j]!, d[i]!]; }
  return d;
}

/** Best blackjack total: aces count 11 unless that busts. */
export function bjScore(hand: Card[]): number {
  let total = 0, aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') { aces++; total += 11; } else total += ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
export const bjBust = (hand: Card[]) => bjScore(hand) > 21;
export const bjNatural = (hand: Card[]) => hand.length === 2 && bjScore(hand) === 21;
export const showHand = (hand: Card[]) => hand.map(c => `\`${c.rank}${c.suit}\``).join(' ');

/** 1 = a wins, -1 = b wins, 0 = push. A bust always loses; a natural 21 beats a made 21. */
export function bjCompare(a: Card[], b: Card[]): 1 | -1 | 0 {
  const sa = bjScore(a), sb = bjScore(b);
  if (sa > 21 && sb > 21) return 0;
  if (sa > 21) return -1;
  if (sb > 21) return 1;
  if (sa !== sb) return sa > sb ? 1 : -1;
  if (sa === 21 && bjNatural(a) !== bjNatural(b)) return bjNatural(a) ? 1 : -1;
  return 0;
}

// ─── Snake (one move per button press) ───────────────────────────────────────

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Pt = { x: number; y: number };
export interface Snake { w: number; h: number; body: Pt[]; food: Pt; score: number; over: false | 'wall' | 'self' | 'won' }
const D: Record<Dir, Pt> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

function placeFood(s: Pick<Snake, 'w' | 'h' | 'body'>, rand: Rand): Pt | null {
  const free: Pt[] = [];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (!s.body.some(p => p.x === x && p.y === y)) free.push({ x, y });
  return free.length ? free[randInt(free.length, rand)]! : null;
}

export function newSnake(w = 9, h = 7, rand: Rand = defaultRand): Snake {
  const body = [{ x: Math.floor(w / 2), y: Math.floor(h / 2) }];
  return { w, h, body, food: placeFood({ w, h, body }, rand)!, score: 0, over: false };
}

/** Moves the head one cell. Eating grows the snake; walls and your own body end the game. Returns a new state. */
export function snakeStep(s: Snake, dir: Dir, rand: Rand = defaultRand): Snake {
  if (s.over) return s;
  const head = s.body[0]!;
  const nx = head.x + D[dir].x, ny = head.y + D[dir].y;
  if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) return { ...s, over: 'wall' };
  const eats = nx === s.food.x && ny === s.food.y;
  const body = [{ x: nx, y: ny }, ...s.body];
  if (!eats) body.pop();
  // Compare against the body as it will be after moving (the tail cell is free when not eating).
  if (body.slice(1).some(p => p.x === nx && p.y === ny)) return { ...s, over: 'self' };
  if (!eats) return { ...s, body };
  const food = placeFood({ w: s.w, h: s.h, body }, rand);
  return food ? { ...s, body, food, score: s.score + 1 } : { ...s, body, score: s.score + 1, over: 'won' };
}

export function snakeBoard(s: Snake): string {
  const rows: string[] = [];
  for (let y = 0; y < s.h; y++) {
    let row = '';
    for (let x = 0; x < s.w; x++) {
      const i = s.body.findIndex(p => p.x === x && p.y === y);
      row += i === 0 ? (s.over ? '💥' : '🟢') : i > 0 ? '🟩' : x === s.food.x && y === s.food.y ? '🍎' : '⬛';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
