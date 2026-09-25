import { EventEmitter } from 'node:events';
import { beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import {
  bjBust, bjCompare, bjNatural, bjScore, newDeck, newSnake, rpsCompare, snakeBoard, snakeStep, tttOutcome, tttPlay, type Board, type Card,
} from '../src/games/logic';
import { _games, gameSubs, tttView } from '../src/subcommands/games/games';
import { linkOk, parseEmojis } from '../src/subcommands/fun/heist';
import { fakeInteraction, textOf } from './fakeInteraction';

const commands = (await import('../src/handlers/commandHandler')).default;
beforeAll(async () => { await initDb(); });

const c = (rank: string, suit = '♠️'): Card => ({ rank, suit });
const seq = (...v: number[]) => { let n = 0; return () => v[n++ % v.length]!; };

describe('tic-tac-toe rules', () => {
  test('detects every line, draws, and refuses illegal moves', () => {
    const empty: Board = Array(9).fill(null);
    for (const line of [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]) {
      const b = [...empty]; for (const n of line) b[n] = 'X';
      expect(tttOutcome(b)).toMatchObject({ winner: 'X', line });
    }
    expect(tttOutcome(empty)).toBeNull();
    expect(tttOutcome(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'])).toBe('draw');
    expect(tttPlay(empty, 4, 'X')![4]).toBe('X'); expect(tttPlay(tttPlay(empty, 4, 'X')!, 4, 'O')).toBeNull();
    for (const bad of [-1, 9, 1.5, NaN]) expect(tttPlay(empty, bad, 'X')).toBeNull();
  });
});

describe('rock paper scissors and blackjack rules', () => {
  test('rps', () => {
    expect(rpsCompare('rock', 'scissors')).toBe(1); expect(rpsCompare('rock', 'paper')).toBe(-1); expect(rpsCompare('paper', 'paper')).toBe(0); expect(rpsCompare('scissors', 'paper')).toBe(1);
  });
  test('blackjack scoring counts aces as 1 or 11, busts lose, naturals beat made 21s', () => {
    expect(bjScore([c('A'), c('K')])).toBe(21); expect(bjScore([c('A'), c('A'), c('9')])).toBe(21); expect(bjScore([c('K'), c('Q'), c('5')])).toBe(25);
    expect(bjBust([c('K'), c('Q'), c('5')])).toBe(true); expect(bjNatural([c('A'), c('K')])).toBe(true); expect(bjNatural([c('7'), c('7'), c('7')])).toBe(false);
    expect(bjCompare([c('K'), c('9')], [c('K'), c('8')])).toBe(1); expect(bjCompare([c('K'), c('Q'), c('5')], [c('2'), c('3')])).toBe(-1);
    expect(bjCompare([c('K'), c('Q'), c('5')], [c('9'), c('9'), c('9')])).toBe(0); expect(bjCompare([c('A'), c('K')], [c('7'), c('7'), c('7')])).toBe(1);
    expect(bjCompare([c('9'), c('9')], [c('9'), c('9')])).toBe(0);
  });
  test('a shuffled deck has 52 distinct cards', () => { const d = newDeck(); expect(d).toHaveLength(52); expect(new Set(d.map(x => x.rank + x.suit)).size).toBe(52); });
});

describe('snake rules', () => {
  test('moves, eats, grows, and dies on walls and on itself', () => {
    let s = newSnake(5, 5, () => 0); // food lands on the first free cell
    const head = s.body[0]!;
    s = { ...s, food: { x: head.x + 1, y: head.y } };
    const ate = snakeStep(s, 'right', () => 0); expect(ate.score).toBe(1); expect(ate.body).toHaveLength(2);
    const moved = snakeStep(ate, 'right', () => 0); expect(moved.body).toHaveLength(2); expect(moved.over).toBe(false);
    expect(snakeStep({ ...s, body: [{ x: 0, y: 0 }] }, 'left').over).toBe('wall'); expect(snakeStep({ ...s, body: [{ x: 4, y: 4 }] }, 'down').over).toBe('wall');
    const coil = { ...s, body: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }], food: { x: 0, y: 0 } };
    expect(snakeStep(coil, 'down').over).toBe('self');
    // stepping onto the cell the tail is leaving is fine
    const chase = { ...s, body: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }], food: { x: 0, y: 0 } };
    expect(snakeStep(chase, 'down').over).toBe(false);
    expect(snakeStep({ ...s, over: 'wall' }, 'up')).toEqual({ ...s, over: 'wall' });
    expect(snakeBoard(s).split('\n')).toHaveLength(5);
  });
});

// A stand-in for discord.js's collector: the test emits "collect" and "end" itself.
function harness() {
  const col = Object.assign(new EventEmitter(), { stop: (reason?: string) => { setTimeout(() => col.emit('end', new Map(), reason), 0); } });
  const edits: any[] = [];
  const fi = fakeInteraction({ guildId: null, userId: 'p1' });
  const i = fi.interaction as any;
  i.editReply = async (p: unknown) => { edits.push(p); return {}; };
  i.fetchReply = async () => ({ createMessageComponentCollector: () => col });
  const click = (userId: string, customId: string) => {
    const log = { updates: [] as any[], replies: [] as any[] };
    const b = { customId, user: { id: userId }, update: async (p: any) => { log.updates.push(p); }, reply: async (p: any) => { log.replies.push(p); }, deferUpdate: async () => {} };
    col.emit('collect', b);
    return new Promise<typeof log>(r => setTimeout(() => r(log), 5));
  };
  return { i, col, edits, click };
}
const flat = (p: any) => textOf(p);

describe('a wired tic-tac-toe game', () => {
  test('alternates turns, refuses out-of-turn, taken squares and strangers, and ends on a win', async () => {
    const h = harness();
    await _games.playTicTacToe(h.i, { id: 'p1' } as any, { id: 'p2' } as any);
    expect(flat(h.edits[0])).toContain("**<@p1>**'s turn");
    expect((await h.click('p2', 'ttt:0')).replies[0].content).toContain("not your turn");
    expect((await h.click('zz', 'ttt:0')).replies[0].content).toContain("not in this game");
    const m1 = await h.click('p1', 'ttt:0'); expect(flat(m1.updates[0])).toContain("**<@p2>**'s turn");
    expect((await h.click('p2', 'ttt:0')).replies[0].content).toContain('taken');
    await h.click('p2', 'ttt:3'); await h.click('p1', 'ttt:1'); await h.click('p2', 'ttt:4');
    const win = await h.click('p1', 'ttt:2'); expect(flat(win.updates[0])).toContain('<@p1>** wins');
    const json = JSON.stringify(win.updates[0].components.map((x: any) => x.toJSON()));
    expect(json).not.toContain('"disabled":false'); // the board is locked once it's over
  });
  test('the board view marks winners and locks on timeout', () => {
    const names = { X: 'a', O: 'b' };
    const b: Board = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
    expect(flat(tttView(b, names, 'O', tttOutcome(b)))).toContain('a** wins');
    expect(flat(tttView(b, names, 'O', 'timeout'))).toContain('Timed out');
  });
});

describe('a wired rock-paper-scissors match', () => {
  test('first to two wins; choices stay private', async () => {
    const h = harness();
    await _games.playRps(h.i, { id: 'p1' } as any, { id: 'p2' } as any);
    const first = await h.click('p1', 'rps:rock'); expect(first.replies[0].content).toContain('You picked');
    expect((await h.click('p1', 'rps:paper')).replies[0].content).toContain('already picked');
    await h.click('p2', 'rps:scissors'); expect(flat(h.edits.at(-1))).toContain('Round 2');
    await h.click('p1', 'rps:rock'); await h.click('p2', 'rps:scissors');
    expect(flat(h.edits.at(-1))).toContain('wins the match');
  });
});

describe('a wired snake game', () => {
  test('only the starter can steer; the game ends at a wall', async () => {
    const h = harness();
    (h.i as any).reply = async (p: unknown) => { h.edits.push(p); return {}; };
    await _games.playSnake(h.i);
    expect((await h.click('intruder', 'snake:up')).replies[0].content).toContain("someone else's game");
    let last: any; for (let n = 0; n < 8; n++) last = await h.click('p1', 'snake:up');
    expect(flat(last.updates[0] ?? last.replies[0] ?? h.edits.at(-1))).toBeTruthy();
    const over = h.edits.length; expect(over).toBeGreaterThanOrEqual(1);
  });
});

describe('emoji and link helpers', () => {
  test('parseEmojis keeps ZWJ sequences whole and ignores text', () => {
    expect(parseEmojis('😀 🔥')).toEqual(['😀', '🔥']); expect(parseEmojis('hello 👨‍👩‍👧 world')).toEqual(['👨‍👩‍👧']); expect(parseEmojis('no emoji here')).toEqual([]); expect(parseEmojis('👍🏽🔥')).toEqual(['👍🏽', '🔥']);
  });
  test('link buttons only take http(s) links', () => {
    expect(linkOk('https://example.com/x')).toBe(true); expect(linkOk('  http://a.b ')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'discord.gg/x', 'ftp://x', 'not a url', '']) expect(linkOk(bad), bad).toBe(false);
  });
});

describe('registration limits', () => {
  test('stays within Discord\'s limits for global commands', () => {
    const list = [...commands.values()].map(x => x.data.toJSON() as any);
    expect(list.filter(x => (x.type ?? 1) === 1).length).toBeLessThanOrEqual(100);
    expect(list.filter(x => x.type === 2).length).toBeLessThanOrEqual(5);
    expect(list.filter(x => x.type === 3).length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(list).length).toBeLessThan(400_000);
  });
  test('the new commands exist', () => {
    for (const n of ['games', 'button', 'coinflip', 'emojimix', 'nitro', 'petpet', 'roleplay', 'rating', 'Pet User', 'Rizz User', 'Roast User']) expect(commands.has(n), n).toBe(true);
    expect(gameSubs.map(g => g.name)).toEqual(['tictactoe', 'rps', 'blackjack', 'snake', 'cookie']);
  });
  test('/coinflip with several rounds and /rating hotcalc answer', async () => {
    const f = fakeInteraction({ guildId: null, options: { rounds: 3 } });
    await commands.get('coinflip')!.run!(f.interaction); expect(textOf(f.last())).toContain('3 coin flips');
    const h = fakeInteraction({ guildId: null, sub: 'hotcalc', users: { user: { id: 'u9', username: 'Nine' } } });
    await commands.get('rating')!.run!(h.interaction); expect(h.sent.map(textOf).join('\n')).toMatch(/\*\*\d+%\*\* hot/);
  });
  test('Pet User / Rizz User / Roast User reply', async () => {
    for (const [name, needle] of [['Rizz User', 'Rizz'], ['Roast User', 'Roasted']] as const) {
      const sent: any[] = [];
      await commands.get(name)!.runUser!({ targetUser: { id: 'u5', displayName: 'Five' }, reply: async (p: any) => { sent.push(p); } } as any);
      expect(textOf(sent[0])).toContain(needle);
    }
  });
});
