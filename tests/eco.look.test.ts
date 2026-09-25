import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { adjustBalance, db, getEconomyConfig, getOrCreateEconomy, initDb, setEconomyConfig } from '../src/utils/db';
import { BANK_START_CAP, STREAK_BONUS_MAX, STREAK_GRACE_MS, getEco, nextStreak, saveStreak, streakBonus } from '../src/eco/core';
import { cashEmoji, cashIcon, displaySymbol, money, resetCashEmoji, syncCashEmoji } from '../src/eco/cashEmoji';
import { fakeInteraction, textOf } from './fakeInteraction';

const commands = (await import('../src/handlers/commandHandler')).default;
beforeAll(async () => { await initDb(); });
afterEach(() => resetCashEmoji());

let n = 0;
const uid = () => `look-${++n}-${Date.now()}`;
const fund = async (u: string, amount: number) => { await getOrCreateEconomy('global', u); await adjustBalance('global', u, amount, 'test'); };
/** Runs /eco (in a DM, so the economy is the global one) and returns everything it sent, plus the raw payloads. */
async function run(o: Parameters<typeof fakeInteraction>[0]) {
  const fi = fakeInteraction({ guildId: null, ...o });
  await commands.get('eco')!.run!(fi.interaction);
  return { text: fi.sent.map(textOf).join('\n'), sent: fi.sent };
}
const resetCooldown = (u: string) => db`DELETE FROM economy_cooldowns WHERE user_id = ${u}`;

describe('the cash icon', () => {
  test('💸 stands in until the art is uploaded, then the uploaded emoji is used', async () => {
    expect(cashEmoji()).toBe('💸');
    const created: string[] = [];
    const client: any = { application: { emojis: { fetch: async () => new Map(), create: async (o: { name: string }) => { created.push(o.name); return { id: '4242' }; } } } };
    await syncCashEmoji(client);
    expect(created).toHaveLength(1); expect(created[0]).toMatch(/^cash_[0-9a-f]{6}$/);
    expect(cashEmoji()).toBe(`<:${created[0]}:4242>`);
  });

  test('an icon that is already uploaded is reused, and an older one is removed', async () => {
    const icon = (await cashIcon())!;
    const deleted: string[] = [];
    const have = [{ name: icon.name, id: '7' }, { name: 'cash_abcdef', id: '8' }, { name: 'battery5_123456', id: '9' }];
    const client: any = { application: { emojis: {
      fetch: async () => new Map(have.map(e => [e.id, { ...e, delete: async () => { deleted.push(e.name); } }])),
      create: async () => { throw new Error('should not upload again'); },
    } } };
    await syncCashEmoji(client);
    expect(cashEmoji()).toBe(`<:${icon.name}:7>`);
    expect(deleted).toEqual(['cash_abcdef']); // the battery emoji is not ours to touch here
  });

  test('changed art gets a new name, and nothing happens without the file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cash-'));
    expect(await cashIcon(dir)).toBeNull();
    await syncCashEmoji({ application: { emojis: { fetch: async () => { throw new Error('not reached'); } } } } as any, dir); // no file: no calls
    await writeFile(path.join(dir, 'cash.png'), Buffer.from('one'));
    const a = (await cashIcon(dir))!.name;
    await writeFile(path.join(dir, 'cash.png'), Buffer.from('two'));
    expect((await cashIcon(dir))!.name).not.toBe(a);
  });

  test('the real art ships with the bot', async () => {
    const icon = await cashIcon();
    expect(icon).not.toBeNull();
    expect(icon!.data.subarray(1, 4).toString()).toBe('PNG');
  });

  test('money reads "💸 $1,234" for the cash icon and keeps a server\'s own symbol as it was', () => {
    expect(money(cashEmoji(), 1234)).toBe('💸 $1,234');
    expect(money('🍪', 1234)).toBe('🍪 1,234');
  });

  test('the default currency symbol shows as the icon; a chosen one and the stored value are left alone', async () => {
    expect((await getEconomyConfig('look-default')).currency_symbol).toBe(cashEmoji());
    expect(displaySymbol('🪙')).toBe(cashEmoji());
    await setEconomyConfig('look-custom', { currency_symbol: '🍪', currency_name: 'cookies' });
    expect((await getEconomyConfig('look-custom')).currency_symbol).toBe('🍪');
    expect((await getEconomyConfig('look-default', true)).currency_symbol).toBe('🪙'); // what the dashboard edits and saves back
  });
});

describe('claim results look like Heist\'s', () => {
  test('daily: a check mark, the mention, the streak and the reward in one line on a green bar', async () => {
    const u = uid();
    const { text, sent } = await run({ userId: u, sub: 'daily' });
    expect(text).toMatch(new RegExp(`^✔️ <@${u}>: Claimed your daily reward - \\*\\*Day 1\\*\\* streak \\(\\+0% bonus\\) - earned 💸 \\*\\*\\$[\\d,]+\\*\\*$`));
    const container = sent[0].components[0];
    expect(container.data.accent_color).toBe(0x57f287);
    expect(sent[0].allowedMentions).toEqual({ parse: [] });
  });

  test('the amount is what was paid', async () => {
    const u = uid();
    const { text } = await run({ userId: u, sub: 'daily' });
    const paid = Number(/\$([\d,]+)\*\*/.exec(text)![1]!.replace(/,/g, ''));
    expect((await getEco('global', u)).balance).toBe(paid);
  });

  test('beg: the story and the reward, "gave you 💸 $291."', async () => {
    const u = uid();
    const { text } = await run({ userId: u, sub: 'beg' });
    // The reward sits in different places in the different stories ("…gave you 💸 **$291**." / "…dropped 💸 **$291** in your hat.").
    expect(text).toMatch(new RegExp(`^✔️ <@${u}>: .+ 💸 \\*\\*\\$[\\d,]+\\*\\*.*\\.$`));
    expect(text).not.toContain('New balance');
  });

  test('work and the weekly/yearly claims read the same way', async () => {
    const u = uid();
    expect((await run({ userId: u, sub: 'work' })).text).toMatch(new RegExp(`^✔️ <@${u}>: You .+ and earned 💸 \\*\\*\\$[\\d,]+\\*\\*\\.$`));
    const weekly = fakeInteraction({ guildId: null, userId: u, sub: 'weekly' });
    await commands.get('community')!.run!(weekly.interaction);
    expect(weekly.sent.map(textOf).join('\n')).toMatch(new RegExp(`^✔️ <@${u}>: Claimed your weekly reward - earned 💸 \\*\\*\\$[\\d,]+\\*\\*$`));
  });

  test('a server with its own currency gets its own symbol, not the dollar sign', async () => {
    const u = uid();
    await setEconomyConfig('look-cookie-guild', { currency_symbol: '🍪', currency_name: 'cookies' });
    const fi = fakeInteraction({ guildId: 'look-cookie-guild', userId: u, sub: 'beg' });
    await commands.get('eco')!.run!(fi.interaction);
    const text = fi.sent.map(textOf).join('\n');
    expect(text).toMatch(/ 🍪 \*\*[\d,]+\*\*.*\.$/); expect(text).not.toContain('$');
  });

  test('claiming again before the cooldown ends says how long is left, privately', async () => {
    const u = uid();
    await run({ userId: u, sub: 'daily' });
    const { text, sent } = await run({ userId: u, sub: 'daily' });
    expect(text).toMatch(/already claimed your \*\*daily\*\*\. Come back in \*\*\d+h/);
    expect(sent[0].flags & 64).toBe(64); // ephemeral
  });
});

describe('daily streak', () => {
  test('the bonus is nothing on day 1, 2% for each day after, and stops at 50%', () => {
    expect([1, 2, 3, 10, 26, 27, 400].map(streakBonus)).toEqual([0, 0.02, 0.04, 0.18, 0.5, STREAK_BONUS_MAX, STREAK_BONUS_MAX]);
    expect(streakBonus(0)).toBe(0);
  });

  test('claiming again the next day makes it Day 2, and Day 2 pays the bonus', async () => {
    const u = uid();
    await run({ userId: u, sub: 'daily' });
    await resetCooldown(u);
    const { text } = await run({ userId: u, sub: 'daily' });
    expect(text).toContain('**Day 2** streak (+2% bonus)');
    await resetCooldown(u);
    expect((await run({ userId: u, sub: 'daily' })).text).toContain('**Day 3** streak (+4% bonus)');
  });

  test('a long gap starts over at Day 1', async () => {
    const u = uid();
    await saveStreak(u, 'daily', 9, Date.now() - STREAK_GRACE_MS - 60_000);
    expect((await run({ userId: u, sub: 'daily' })).text).toContain('**Day 1** streak (+0% bonus)');
    expect(await nextStreak(u, 'daily')).toBe(2);
  });

  test('a claim just inside the window keeps the streak', async () => {
    const u = uid();
    await saveStreak(u, 'daily', 4, Date.now() - STREAK_GRACE_MS + 60_000);
    expect(await nextStreak(u, 'daily')).toBe(5);
  });

  test('the bonus is really paid: a long streak earns more than the raw roll allows', async () => {
    const u = uid();
    await saveStreak(u, 'daily', 100, Date.now() - 21 * 3_600_000); // max bonus next: day 101 → +50%
    const { text } = await run({ userId: u, sub: 'daily' });
    expect(text).toContain('**Day 101** streak (+50% bonus)');
    const paid = Number(/\$([\d,]+)\*\*/.exec(text)![1]!.replace(/,/g, ''));
    expect(paid).toBeGreaterThanOrEqual(150); // at least 100 × 1.5 with the default 100–500 roll
    expect(paid).toBeLessThanOrEqual(750);
  });
});

describe('/eco bank upgrade asks first', () => {
  test('Confirm: the question, then the purchase, in the same message', async () => {
    const u = uid();
    await fund(u, 100);
    const { text, sent } = await run({ userId: u, group: 'bank', sub: 'upgrade', options: { amount: '5' } });
    const [question, done] = sent.map(textOf);
    expect(question).toContain('Confirm bank space purchase'); expect(question).toContain('Buy 💸 $5 of bank space for 💸 $5?');
    expect(done).toBe('Bank space bought\nBought 💸 $5 of bank space. New capacity: 💸 $5,005.');
    expect(text).toContain('$5,005');
    const e = await getEco('global', u);
    expect([e.balance, e.bank_cap]).toEqual([95, BANK_START_CAP + 5]);
  });

  test('the question has a green Confirm and a red Cancel button under the card', async () => {
    const u = uid();
    await fund(u, 100);
    const { sent } = await run({ userId: u, group: 'bank', sub: 'upgrade', options: { amount: '5' } });
    const buttons = sent[0].components.flatMap((c: any) => c.components ?? []).filter((b: any) => b.data?.custom_id);
    expect(buttons.map((b: any) => [b.data.label, b.data.style])).toEqual([['Confirm', 3], ['Cancel', 4]]);
    expect(sent[0].components[0].data.accent_color).toBeUndefined(); // a plain card, no coloured bar
  });

  test('Cancel spends nothing and says so', async () => {
    const u = uid();
    await fund(u, 100);
    const { sent } = await run({ userId: u, group: 'bank', sub: 'upgrade', options: { amount: '50' }, click: 'cancel' });
    expect(textOf(sent.at(-1))).toContain('Purchase cancelled');
    const e = await getEco('global', u);
    expect([e.balance, e.bank_cap]).toEqual([100, BANK_START_CAP]);
  });

  test('no answer spends nothing either', async () => {
    const u = uid();
    await fund(u, 100);
    const { sent } = await run({ userId: u, group: 'bank', sub: 'upgrade', options: { amount: '50' }, click: 'none' });
    expect(textOf(sent.at(-1))).toContain('nothing was bought');
    expect((await getEco('global', u)).balance).toBe(100);
  });

  test('too little cash is refused up front, without a question', async () => {
    const u = uid();
    await fund(u, 3);
    const { text, sent } = await run({ userId: u, group: 'bank', sub: 'upgrade', options: { amount: '10' } });
    expect(sent).toHaveLength(1); expect(text).toContain('only have 💸 $3');
    expect((await getEco('global', u)).bank_cap).toBe(BANK_START_CAP);
  });

  test('"all" buys every space you can afford', async () => {
    const u = uid();
    await fund(u, 300);
    const { text } = await run({ userId: u, group: 'bank', sub: 'upgrade', options: { amount: 'all' } });
    expect(text).toContain('Buy 💸 $300 of bank space for 💸 $300?');
    expect([(await getEco('global', u)).balance, (await getEco('global', u)).bank_cap]).toEqual([0, BANK_START_CAP + 300]);
  });
});
