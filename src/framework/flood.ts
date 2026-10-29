import { MessageFlags, type RepliableInteraction } from 'discord.js';

/**
 * Keeps people from using the bot to flood a channel. Each limit is a sliding window of recent uses per key (a person or a channel);
 * slowDown() checks an interaction against the ones that apply before anything is posted, and answers only that person when one is
 * reached, so a warning never adds to the flood.
 */

export class RateWindow {
  private hits = new Map<string, number[]>();
  constructor(readonly max: number, readonly windowMs: number) {}

  /** How long until `key` may go again: 0 when it may now. Counts nothing. */
  wait(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    return recent.length < this.max ? 0 : this.windowMs - (now - recent[0]!);
  }

  /** Counts one use of `key`. */
  take(key: string, now = Date.now()): void {
    const recent = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5_000) for (const [k, ts] of this.hits) if (now - ts[ts.length - 1]! >= this.windowMs) this.hits.delete(k);
  }
}

/** Whether slowDown() applies the limits. The test suite turns them off (tests press buttons milliseconds apart); tests/flood.test.ts turns them back on. */
export const floodLimits = { enabled: true };

/** Slash commands, per person: a burst is fine, a stream of them isn't. */
export const COMMANDS = new RateWindow(6, 10_000);
/** Buttons that post a new message (a hint, a skip, the next prompt), per person. */
export const GAME_CLICKS = new RateWindow(1, 2_000);
/** Messages games post in one channel because someone pressed something. */
export const GAME_POSTS = new RateWindow(12, 30_000);
/** Rounds people start by hand in one channel (Next round, /guess); a game's own next round is not counted. */
export const ROUND_STARTS = new RateWindow(4, 60_000);

/**
 * Checks `i` against each [limit, key] pair. When any of them is reached, tells the person how long to wait (only they see it) and
 * returns true, counting nothing; otherwise counts a use on every one and returns false.
 */
export async function slowDown(i: RepliableInteraction, ...limits: [RateWindow, string][]): Promise<boolean> {
  if (!floodLimits.enabled) return false;
  const now = Date.now();
  const wait = Math.max(0, ...limits.map(([w, key]) => w.wait(key, now)));
  if (wait > 0) {
    await i.reply({ content: `⏳ Slow down — try again in **${Math.ceil(wait / 1000)}s**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  for (const [w, key] of limits) w.take(key, now);
  return false;
}
