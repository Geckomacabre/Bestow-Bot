import { describe, expect, test } from 'bun:test';
import { parseAmount } from '../src/subcommands/eco/ui';

describe('parseAmount', () => {
  test('plain numbers and separators', () => {
    expect(parseAmount('500', 1000)).toBe(500);
    expect(parseAmount('1,000', 0)).toBe(1000);
    expect(parseAmount(' 2 500 ', 0)).toBe(2500);
  });
  test('suffixes', () => {
    expect(parseAmount('1k', 0)).toBe(1000);
    expect(parseAmount('2.5k', 0)).toBe(2500);
    expect(parseAmount('1.5m', 0)).toBe(1_500_000);
    expect(parseAmount('2B', 0)).toBe(2_000_000_000);
  });
  test('all / half / percent are relative to max', () => {
    expect(parseAmount('all', 750)).toBe(750);
    expect(parseAmount('MAX', 750)).toBe(750);
    expect(parseAmount('half', 751)).toBe(375);
    expect(parseAmount('25%', 1000)).toBe(250);
    expect(parseAmount('150%', 1000)).toBe(1000); // clamped
  });
  test('rejects nonsense and non-positive values', () => {
    for (const bad of ['', 'abc', '-5', '0', '1.2.3', 'all ', '1e9', '5x']) {
      const r = parseAmount(bad, bad === 'all ' ? 0 : 100);
      expect(r === null || (bad === 'all ' && r === null)).toBe(true);
    }
    expect(parseAmount('all', 0)).toBeNull();
    expect(parseAmount('half', 1)).toBeNull();
    expect(parseAmount('0.4%', 100)).toBeNull();
  });
});
