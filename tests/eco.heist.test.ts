import { beforeAll, describe, expect, test } from 'bun:test';
import { initDb, getOrCreateEconomy, adjustBalance } from '../src/utils/db';
import { BANK_START_CAP, getEco } from '../src/eco/core';
import { getCases } from '../src/eco/cards';
import { getBusiness } from '../src/eco/assets';
import { rouletteBet, withValues } from '../src/subcommands/eco/heist';
import { heistSpec, specDescription } from '../src/framework/heist';
import { fakeInteraction, textOf } from './fakeInteraction';

const commands = (await import('../src/handlers/commandHandler')).default;
beforeAll(async () => { await initDb(); });

let n = 0;
const uid = () => `eh-${++n}-${Date.now()}`;
const fund = async (u: string, amount: number) => { await getOrCreateEconomy('global', u); await adjustBalance('global', u, amount, 'test'); };
const run = async (o: Parameters<typeof fakeInteraction>[0], cmd = 'eco') => {
  const fi = fakeInteraction({ guildId: null, ...o });
  await commands.get(cmd)!.run!(fi.interaction);
  return fi.sent.map(textOf).join('\n');
};

describe('Heist-style inputs', () => {
  test('roulette bets: colours, parity, halves, green and numbers', () => {
    expect(rouletteBet('Red')).toEqual({ type: 'red', number: null });
    expect(rouletteBet('1-18')).toEqual({ type: 'low', number: null });
    expect(rouletteBet('19–36')).toEqual({ type: 'high', number: null });
    expect(rouletteBet('green')).toEqual({ type: 'number', number: 0 });
    expect(rouletteBet('17')).toEqual({ type: 'number', number: 17 });
    expect([rouletteBet('37'), rouletteBet('purple')]).toEqual([null, null]);
  });
  test('withValues answers the handler\'s option names and passes the rest through', () => {
    const fi = fakeInteraction({ options: { amount: 'all', side: 'Tails' } });
    const i = withValues(fi.interaction, { bet: 500, gone: null });
    expect(i.options.getInteger('bet', true)).toBe(500);
    expect(i.options.getString('gone')).toBeNull();
    expect(i.options.getString('side')).toBe('Tails');
    expect(i.user.id).toBe(fi.interaction.user.id);
  });
  test('descriptions are Heist\'s', () => {
    const j = commands.get('eco')!.data.toJSON() as { options: { name: string; description: string }[] };
    expect(j.options.find(o => o.name === 'work')!.description).toBe(specDescription(heistSpec('eco work')));
  });
});

describe('through /eco', () => {
  test('bank upgrade takes "all" (spaces you can afford)', async () => {
    const u = uid();
    await fund(u, 300);
    await run({ userId: u, group: 'bank', sub: 'upgrade', options: { amount: 'all' } });
    const e = await getEco('global', u);
    expect([e.balance, e.bank_cap]).toEqual([0, BANK_START_CAP + 300]);
  });
  test('a bad amount or roulette bet is explained, and nothing is spent', async () => {
    const u = uid();
    await fund(u, 1000);
    expect(await run({ userId: u, group: 'games', sub: 'roulette', options: { amount: 'lots', bet: 'red' } })).toContain('isn\'t an amount');
    expect(await run({ userId: u, group: 'games', sub: 'roulette', options: { amount: '10', bet: 'purple' } })).toContain('Bet on');
    expect((await getEco('global', u)).balance).toBe(1000);
  });
  test('cards and businesses by Heist\'s names', async () => {
    const u = uid();
    await fund(u, 1_000_000);
    await run({ userId: u, group: 'card', sub: 'buy', options: { case_type: 'Blackice', amount: 2 } });
    expect(await getCases(u)).toEqual({ blackice: 2 });
    await run({ userId: u, group: 'business', sub: 'buy', options: { name: 'lemonade' } });
    expect((await getBusiness(u))?.kind).toBe('lemonade');
    expect(await run({ userId: u, group: 'investment', sub: 'start', options: { name: 'beanie babies' } })).toContain('no investment called');
  });
  test('odds for a Heist game name', async () => {
    expect(await run({ group: 'games', sub: 'odds', options: { game: 'Higher/Lower' } })).toMatch(/higher|lower/i);
  });
});
