import { describe, expect, test } from 'bun:test';
import { drift, heist, missing, readParity } from '../scripts/parity';

/**
 * Bestow has every Heist command, with Heist's descriptions and options. A command Bestow deliberately doesn't offer must be
 * listed with a reason in docs/heist-parity.json → declined; nothing may sit in notYet.
 */
describe('Heist parity', () => {
  test('every Heist command is built or declined with a reason', async () => {
    expect((await missing()).map(h => h.path)).toEqual([]);
    const p = readParity();
    expect(p.notYet).toEqual([]);
    for (const [path, why] of Object.entries(p.declined)) {
      expect(heist.some(h => h.path === path), `declined "${path}" isn't a Heist command`).toBe(true);
      expect(why.length, `declined "${path}" needs a reason`).toBeGreaterThan(20);
    }
  });
  test('built commands have Heist\'s exact descriptions and options', async () => {
    expect(await drift()).toEqual([]);
  }, 30_000);
});
