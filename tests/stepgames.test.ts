import { describe, expect, test } from 'bun:test';
import {
  DICE_TIE_CHANCE, DICE_WIN_CHANCE, DICE_WIN_MULT, LADDER_CHANCES, MINES_MAX, MINES_TILES, TOWER_MODES, TOWER_ROWS, chanceHigher, chanceLower,
  drawRank, fairMultiplier, hiloGuess, ladderClimb, ladderMultiplier, minesMultiplier, minesReveal, minesSurvival, newMines, newTowers,
  oddsText, pickDistinct, roll2d6, towersMultiplier, towersPick,
} from '../src/eco/stepgames';

/** Deterministic RNG from a list of values in [0,1). */
const seq = (...vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]!; };

describe('fair multipliers', () => {
  test('inverse of probability, floored to 2dp', () => {
    expect(fairMultiplier(0.5)).toBe(2);
    expect(fairMultiplier(1 / 3)).toBe(3);
    expect(fairMultiplier(0.9)).toBe(1.11);
    expect(fairMultiplier(0)).toBe(0);
  });
});

describe('mines', () => {
  test('survival probability matches hand-computed values', () => {
    expect(minesSurvival(1, 1)).toBeCloseTo(19 / 20, 10);
    expect(minesSurvival(5, 2)).toBeCloseTo((15 / 20) * (14 / 19), 10);
    expect(minesSurvival(3, 0)).toBe(1);
  });
  test('multipliers grow with every tile and with the mine count', () => {
    for (const m of [1, 3, 8, 15]) {
      let prev = 0;
      for (let k = 1; k <= MINES_TILES - m; k++) {
        const x = minesMultiplier(m, k);
        expect(x).toBeGreaterThanOrEqual(prev);
        prev = x;
      }
    }
    expect(minesMultiplier(10, 2)).toBeGreaterThan(minesMultiplier(2, 2));
    expect(minesMultiplier(5, 0)).toBe(0);
  });
  test('expected value of any cash-out target is ≤ 1 and ≈ 1 (no house edge)', () => {
    for (const m of [1, 4, 9]) for (const k of [1, 2, 3, 5]) {
      const ev = minesSurvival(m, k) * minesMultiplier(m, k);
      expect(ev).toBeLessThanOrEqual(1 + 1e-9);
      expect(ev).toBeGreaterThan(0.97);
    }
  });
  test('boards contain exactly the requested distinct mines', () => {
    for (const m of [1, 7, MINES_MAX]) {
      const s = newMines(m);
      expect(s.mines.size).toBe(m);
      for (const t of s.mines) { expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThan(MINES_TILES); }
    }
  });
  test('mines are uniformly placed (each tile hit ~m/N of the time)', () => {
    const hits = new Array(MINES_TILES).fill(0);
    const trials = 20_000;
    for (let i = 0; i < trials; i++) for (const t of newMines(4).mines) hits[t]++;
    for (const h of hits) expect(h / trials).toBeGreaterThan(0.17), expect(h / trials).toBeLessThan(0.23);
  });
  test('reveal flow: safe → bust, repeats are invalid, clearing the board wins', () => {
    const s = newMines(2, seq(0, 0)); // mines at positions chosen by the fixed rng
    const safe = [...Array(MINES_TILES).keys()].filter(t => !s.mines.has(t));
    expect(minesReveal(s, safe[0]!)).toBe('safe');
    expect(minesReveal(s, safe[0]!)).toBe('invalid');
    expect(minesReveal(s, 99)).toBe('invalid');
    for (const t of safe.slice(1, -1)) minesReveal(s, t);
    expect(minesReveal(s, safe.at(-1)!)).toBe('clear');
    const s2 = newMines(2);
    expect(minesReveal(s2, [...s2.mines][0]!)).toBe('bust');
  });
  test('pickDistinct never repeats', () => {
    for (let i = 0; i < 200; i++) expect(pickDistinct(20, 19).size).toBe(19);
  });
});

describe('towers', () => {
  test('multiplier per row is (tiles/safe)^rows, fair', () => {
    expect(towersMultiplier('medium', 3)).toBe(8);
    expect(towersMultiplier('hard', 2)).toBe(9);
    expect(towersMultiplier('easy', 1)).toBe(1.5);
    expect(towersMultiplier('easy', 0)).toBe(0);
    expect(towersMultiplier('nope', 2)).toBe(0);
  });
  test('layout: every row has exactly `safe` safe tiles', () => {
    for (const [mode, m] of Object.entries(TOWER_MODES)) {
      const t = newTowers(mode);
      expect(t.layout.length).toBe(TOWER_ROWS);
      for (const row of t.layout) expect(row.size).toBe(m.safe);
    }
  });
  test('picking through the tower', () => {
    const t = newTowers('medium');
    const safeIdx = (r: number) => [...t.layout[r]!][0]!;
    for (let r = 0; r < TOWER_ROWS - 1; r++) expect(towersPick(t, safeIdx(r))).toBe('safe');
    expect(towersPick(t, safeIdx(TOWER_ROWS - 1))).toBe('clear');
    expect(towersPick(t, 0)).toBe('invalid');
    const b = newTowers('medium');
    expect(towersPick(b, [0, 1].find(x => !b.layout[0]!.has(x))!)).toBe('bust');
    expect(towersPick(newTowers('easy'), 3)).toBe('invalid');
  });
});

describe('ladder', () => {
  test('multipliers are the inverse of the cumulative chance', () => {
    expect(ladderMultiplier(0)).toBe(0);
    expect(ladderMultiplier(1)).toBe(fairMultiplier(0.9));
    expect(ladderMultiplier(2)).toBe(fairMultiplier(0.9 * 0.8));
    expect(ladderMultiplier(LADDER_CHANCES.length)).toBeGreaterThan(200);
  });
  test('climb outcomes follow the rung chance', () => {
    expect(ladderClimb(0, () => 0.89)).toBe('up');
    expect(ladderClimb(0, () => 0.9)).toBe('fall');
    expect(ladderClimb(LADDER_CHANCES.length - 1, () => 0)).toBe('top');
  });
  test('simulated return of "always climb 3 rungs then cash out" ≈ 1', () => {
    let total = 0;
    const trials = 60_000;
    for (let i = 0; i < trials; i++) {
      let rung = 0, alive = true;
      while (rung < 3 && alive) { if (ladderClimb(rung) === 'fall') alive = false; else rung++; }
      if (alive) total += ladderMultiplier(3);
    }
    expect(total / trials).toBeGreaterThan(0.93);
    expect(total / trials).toBeLessThan(1.07);
  });
});

describe('higher / lower', () => {
  test('chances are complementary except for ties', () => {
    for (let r = 1; r <= 13; r++) expect(chanceHigher(r) + chanceLower(r) + 1 / 13).toBeCloseTo(1, 10);
    expect(chanceLower(1)).toBe(0);
    expect(chanceHigher(13)).toBe(0);
  });
  test('resolution and payout step', () => {
    const win = hiloGuess(5, 'higher', () => 0.9);   // rank 12
    expect(win).toMatchObject({ next: 12, win: true });
    expect(win.step).toBe(fairMultiplier(8 / 13));
    expect(hiloGuess(5, 'higher', () => 0.31)).toMatchObject({ next: 5, win: false }); // tie loses
    expect(hiloGuess(5, 'lower', () => 0)).toMatchObject({ next: 1, win: true });
  });
  test('cards are uniform 1..13', () => {
    const c = new Array(14).fill(0);
    for (let i = 0; i < 26_000; i++) c[drawRank()]++;
    expect(c[0]).toBe(0);
    for (let r = 1; r <= 13; r++) expect(c[r]!).toBeGreaterThan(1700), expect(c[r]!).toBeLessThan(2300);
  });
});

describe('dice', () => {
  test('exact win/tie odds and fair RTP', () => {
    let win = 0, tie = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) for (let d = 1; d <= 6; d++) {
      const p = a + b, h = c + d;
      if (p > h) win++; else if (p === h) tie++;
    }
    expect(win / 1296).toBeCloseTo(DICE_WIN_CHANCE, 10);
    expect(tie / 1296).toBeCloseTo(DICE_TIE_CHANCE, 10);
    expect(DICE_WIN_CHANCE * DICE_WIN_MULT + DICE_TIE_CHANCE).toBeCloseTo(1, 10);
  });
  test('rolls stay in range', () => {
    for (let i = 0; i < 500; i++) { const r = roll2d6(); expect(r).toBeGreaterThanOrEqual(2); expect(r).toBeLessThanOrEqual(12); }
  });
});

describe('odds text', () => {
  test('every game has an explanation', () => {
    for (const g of ['mines', 'towers', 'ladder', 'higherlower', 'dice', 'flip', 'highroll', 'slots', 'roulette', 'blackjack', 'crash', 'poker', 'scratch', 'plinko']) {
      expect(oddsText(g).length, g).toBeGreaterThan(20);
      expect(oddsText(g), g).not.toContain('Unknown');
    }
    expect(oddsText('zzz')).toContain('Unknown');
  });
});
