import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MessageFlags } from 'discord.js';
import { COMMANDS, floodLimits, GAME_CLICKS, GAME_POSTS, RateWindow, ROUND_STARTS, slowDown } from '../src/framework/flood';
import { fakeInteraction } from './fakeInteraction';

beforeAll(() => { floodLimits.enabled = true; });
afterAll(() => { floodLimits.enabled = false; });

describe('rate windows', () => {
  test('up to `max` uses in the window, then a wait until the oldest one leaves it', () => {
    const w = new RateWindow(3, 1000);
    for (const t of [0, 100, 200]) { expect(w.wait('a', t)).toBe(0); w.take('a', t); }
    expect(w.wait('a', 300)).toBe(700);
    expect(w.wait('b', 300)).toBe(0); // keys are separate
    expect(w.wait('a', 1000)).toBe(0); // the first use has left the window
  });

  test('the limits: a burst of commands is fine, a stream is not; one round started by hand at a time, a few a minute', () => {
    expect([COMMANDS.max, COMMANDS.windowMs, GAME_CLICKS.max, GAME_CLICKS.windowMs, GAME_POSTS.max, GAME_POSTS.windowMs, ROUND_STARTS.max, ROUND_STARTS.windowMs])
      .toEqual([6, 10_000, 1, 2_000, 12, 30_000, 4, 60_000]);
  });
});

describe('slowDown', () => {
  test('lets a press through and counts it on every limit', async () => {
    const a = new RateWindow(1, 60_000), b = new RateWindow(5, 60_000);
    const fi = fakeInteraction({ guildId: null });
    expect(await slowDown(fi.interaction, [a, 'u1'], [b, 'c1'])).toBe(false);
    expect(fi.sent).toHaveLength(0);
    expect(a.wait('u1')).toBeGreaterThan(0); expect(b.wait('c1')).toBe(0);
  });

  test('a press over any limit is refused with a note only the presser sees, and nothing is counted', async () => {
    const a = new RateWindow(1, 60_000), b = new RateWindow(2, 60_000);
    b.take('c1'); b.take('c1');
    const fi = fakeInteraction({ guildId: null });
    expect(await slowDown(fi.interaction, [a, 'u1'], [b, 'c1'])).toBe(true);
    expect(fi.sent).toHaveLength(1);
    expect(fi.sent[0].content).toMatch(/^⏳ Slow down — try again in \*\*\d+s\*\*\.$/);
    expect(fi.sent[0].flags).toBe(MessageFlags.Ephemeral);
    expect(a.wait('u1')).toBe(0); // the refused press didn't use up the person's turn
  });

  test('Next round pressed over and over in one channel: four rounds a minute, then a wait (from different people too)', async () => {
    const rounds = new RateWindow(ROUND_STARTS.max, ROUND_STARTS.windowMs);
    const results: boolean[] = [];
    for (let k = 0; k < 6; k++) results.push(await slowDown(fakeInteraction({ guildId: null, userId: `p${k}` }).interaction, [rounds, 'chan']));
    expect(results).toEqual([false, false, false, false, true, true]);
  });
});
