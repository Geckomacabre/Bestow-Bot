import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { db, initDb, getOrCreateEconomy, adjustBalance } from '../src/utils/db';
import { getEco } from '../src/eco/core';
import { wrapMessage } from '../src/eco/render';
import { backgroundPatch, getWalletStyle, setStyle, walletCardPng } from '../src/subcommands/eco/wallet';
import { PRESETS, applyColorsForm, applyStudioAction, handleStudioComponent, handleStudioModal, studioView } from '../src/subcommands/eco/studio';
import { heist, ourPaths } from '../scripts/parity';
import { fakeInteraction, textOf } from './fakeInteraction';

const commands = (await import('../src/handlers/commandHandler')).default;
beforeAll(async () => { await initDb(); });
afterEach(() => { for (const k of ['PREMIUM_SKU_ID', 'OWNER_IDS', 'SUPPORT_GUILD_ID', 'SUPPORT_INVITE']) delete Bun.env[k]; });

let n = 0;
const uid = () => `tree-user-${++n}`;
const run = async (o: Parameters<typeof fakeInteraction>[0], cmd = 'eco') => {
  const fi = fakeInteraction({ guildId: null, ...o });
  await commands.get(cmd)!.run!(fi.interaction);
  return { fi, text: fi.sent.map(textOf).join('\n') };
};
const cash = async (u: string) => (await getEco('global', u)).balance;
const fund = async (u: string, amount: number) => { await getOrCreateEconomy('global', u); await adjustBalance('global', u, amount, 'test'); };

interface J { name: string; description: string; options?: J[]; contexts?: number[]; type: number }
const desc = (path: string): string | undefined => {
  const [cmd, ...rest] = path.split(' ');
  let node: J | undefined = (commands.get(cmd!)!.data.toJSON() as unknown as J);
  for (const p of rest) node = node?.options?.find(o => o.name === p);
  return node?.description;
};

describe('the /eco tree matches Heist\'s', () => {
  test('every Heist economy command exists (except the one we deliberately replace)', async () => {
    const ours = await ourPaths();
    const want = heist.filter(h => h.type === 'slash' && /^eco(-company)? /.test(h.path)).map(h => h.path);
    expect(want.length).toBeGreaterThan(100);
    expect(want.filter(p => !ours.slash.has(p) && p !== 'eco slut')).toEqual([]);
    expect(ours.slash.has('eco hustle')).toBe(true); // stands in for /eco slut
  });
  test('/eco has at most 25 top-level entries and works in DMs and user installs; extras moved to /community', async () => {
    const j = commands.get('eco')!.data.toJSON() as unknown as J;
    expect(j.options!.length).toBe(25);
    for (const c of ['eco', 'eco-company', 'community']) expect((commands.get(c)!.data.toJSON() as unknown as J).contexts).toEqual([0, 1, 2]);
    const ours = await ourPaths();
    for (const p of ['community weekly', 'community yearly', 'community protection', 'community shop buy']) expect(ours.slash.has(p), p).toBe(true);
    for (const p of ['eco weekly', 'eco yearly', 'eco protection', 'eco shop buy', 'wallet avatar']) expect(ours.slash.has(p), p).toBe(false);
  });
  test('every Heist Premium economy command is marked Premium here, and nothing else is', async () => {
    const heistPremium = new Set(heist.filter(h => h.premium && h.path.startsWith('eco ')).map(h => h.path));
    const ours = await ourPaths();
    for (const p of ours.slash) if (p.startsWith('eco ') && !p.startsWith('eco giveaway')) expect(desc(p)!.startsWith('✨'), p).toBe(heistPremium.has(p));
  });
});

describe('Premium commands', () => {
  test('are open while Premium is not on sale', async () => {
    const u = uid();
    await run({ userId: u, sub: 'message', group: 'wallet-edit', options: { text: 'hello' } });
    expect((await getWalletStyle(u)).message).toBe('hello');
  });
  test('need Premium once a subscription SKU is configured — and change nothing when refused', async () => {
    Bun.env.PREMIUM_SKU_ID = '1234567890';
    const u = uid();
    const r = await run({ userId: u, sub: 'message', group: 'wallet-edit', options: { text: 'blocked' } });
    expect(r.text).toContain('Premium command'); expect((await getWalletStyle(u)).message).toBeNull();
    const m = await run({ userId: u, sub: 'monthly' });
    expect(m.text).toContain('Premium command'); expect(await cash(u)).toBe(0);
    // free commands are unaffected
    expect((await run({ userId: u, sub: 'daily' })).text).not.toContain('Premium command');
  });
  test('an owner (or anyone with Premium) gets through', async () => {
    Bun.env.PREMIUM_SKU_ID = '1234567890';
    const u = uid(); Bun.env.OWNER_IDS = u;
    await run({ userId: u, sub: 'message', group: 'wallet-edit', options: { text: 'welcome' } });
    expect((await getWalletStyle(u)).message).toBe('welcome');
    const m = await run({ userId: u, sub: 'monthly' }); expect(m.text).toContain('Monthly Reward'); expect(await cash(u)).toBeGreaterThan(0);
  });
});

describe('/eco hustle', () => {
  const withRandom = async <T,>(v: number, fn: () => Promise<T>) => { const o = Math.random; Math.random = () => v; try { return await fn(); } finally { Math.random = o; } };
  test('a win pays more than work and starts a cooldown', async () => {
    const u = uid();
    const r = await withRandom(0.1, () => run({ userId: u, sub: 'hustle' }));
    expect(r.text).toContain('earned'); expect(await cash(u)).toBeGreaterThan(0);
    const again = await run({ userId: u, sub: 'hustle' }); expect(again.text).toContain('still hustling');
  });
  test('a flop costs a little — never more than you have, and nothing when you are broke', async () => {
    const rich = uid(); await fund(rich, 1000);
    const r = await withRandom(0.99, () => run({ userId: rich, sub: 'hustle' }));
    expect(r.text).toContain('cost you'); const left = await cash(rich); expect(left).toBeLessThan(1000); expect(left).toBeGreaterThanOrEqual(750);
    const broke = uid();
    const b = await withRandom(0.99, () => run({ userId: broke, sub: 'hustle' }));
    expect(b.text).toContain('nothing to lose'); expect(await cash(broke)).toBe(0);
  });
});

describe('/eco joinbonus', () => {
  const joined = (member: boolean) => (fi: ReturnType<typeof fakeInteraction>) => {
    (fi.interaction.client as any).guilds.fetch = async () => ({ members: { fetch: async () => { if (!member) throw new Error('Unknown Member'); return {}; } } });
  };
  test('explains itself when no support server is configured', async () => {
    expect((await run({ userId: uid(), sub: 'joinbonus' })).text).toContain('no support server');
  });
  test('pays exactly once, only to members, and points non-members at the invite', async () => {
    Bun.env.SUPPORT_GUILD_ID = '111222333444555666'; Bun.env.SUPPORT_INVITE = 'https://discord.gg/example';
    const u = uid();
    const send = async (member: boolean) => { const fi = fakeInteraction({ guildId: null, userId: u, sub: 'joinbonus' }); joined(member)(fi); await commands.get('eco')!.run!(fi.interaction); return fi.sent.map(textOf).join('\n'); };
    const no = await send(false); expect(no).toContain('Join our support server'); expect(no).toContain('https://discord.gg/example'); expect(await cash(u)).toBe(0);
    expect(await send(true)).toContain('Welcome'); expect(await cash(u)).toBe(1000);
    expect(await send(true)).toContain('already claimed'); expect(await cash(u)).toBe(1000);
  });
});

describe('/eco history, graph and toggle-notifications', () => {
  test('you can look at someone else — unless they hid their wallet', async () => {
    const me = uid(), them = uid();
    await fund(them, 500);
    const users = { user: { id: them, username: 'Them' } };
    const open = await run({ userId: me, sub: 'history', options: {}, users }); expect(open.text).toContain('Recent transactions'); expect(open.text).toContain('Them');
    await setStyle(them, { hide_wallet: 1 });
    expect((await run({ userId: me, sub: 'history', users })).text).toContain('keeps their wallet private');
    expect((await run({ userId: me, sub: 'graph', users })).text).toContain('keeps their wallet private');
    expect((await run({ userId: them, sub: 'history' })).text).toContain('Recent transactions'); // your own is always visible to you
  });
  test('toggle-notifications flips the setting each time', async () => {
    const u = uid(); await fund(u, 1);
    const before = (await getEco('global', u)).notify_rob;
    const a = await run({ userId: u, sub: 'toggle-notifications' }); expect((await getEco('global', u)).notify_rob).toBe(before ? 0 : 1); expect(a.text).toMatch(/DM|off/);
    await run({ userId: u, sub: 'toggle-notifications' }); expect((await getEco('global', u)).notify_rob).toBe(before);
  });
});

describe('wallet-edit', () => {
  test('message: "-" clears it; a hidden avatar renders; gradient "none" removes the second colour', async () => {
    const u = uid();
    await run({ userId: u, sub: 'message', group: 'wallet-edit', options: { text: '  saving up  ' } }); expect((await getWalletStyle(u)).message).toBe('saving up');
    await run({ userId: u, sub: 'message', group: 'wallet-edit', options: { text: '-' } }); expect((await getWalletStyle(u)).message).toBeNull();
    await run({ userId: u, sub: 'avatar', group: 'wallet-edit', options: { shape: 'hidden' } }); expect((await getWalletStyle(u)).avatarShape).toBe('hidden');
    await run({ userId: u, sub: 'background', group: 'wallet-edit', options: { color: '#111827', gradient: '#222222' } });
    expect(await getWalletStyle(u)).toMatchObject({ bgColor: '#111827', bgColor2: '#222222' });
    await run({ userId: u, sub: 'background', group: 'wallet-edit', options: { gradient: 'none' } });
    expect(await getWalletStyle(u)).toMatchObject({ bgColor: '#111827', bgColor2: null });
    const bad = await run({ userId: u, sub: 'background', group: 'wallet-edit', options: { color: 'red' } }); expect(bad.text).toContain('hex'); expect((await getWalletStyle(u)).bgColor).toBe('#111827');
    const { png } = await walletCardPng({ id: u, username: 'u', displayName: 'U', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } as any, 'global', '🪙', {});
    expect([...png.subarray(1, 4)].map(c => String.fromCharCode(c)).join('')).toBe('PNG');
  });
  test('backgroundPatch validates colours', () => {
    expect(backgroundPatch({ color: '#ABCDEF', direction: 'vertical' })).toEqual({ patch: { bg_color: '#abcdef', bg_direction: 'vertical' } });
    expect(backgroundPatch({ gradient: 'NONE' }).patch).toEqual({ bg_color2: null });
    expect(backgroundPatch({ color: 'blue' }).error).toBeTruthy(); expect(backgroundPatch({ gradient: '#12' }).error).toBeTruthy();
  });
  test('long card messages wrap to at most two lines', () => {
    expect(wrapMessage('short')).toEqual(['short']);
    const two = wrapMessage('word '.repeat(19).trim()); expect(two).toHaveLength(2); for (const l of two) expect(l.length).toBeLessThanOrEqual(58);
    const unbroken = wrapMessage('x'.repeat(100)); expect(unbroken).toHaveLength(2); expect(unbroken[0]!.length).toBeLessThanOrEqual(58);
  });
});

describe('the studio', () => {
  test('controls change the saved style, clamp the overlay, and refuse unknown values', async () => {
    const u = uid();
    expect(await applyStudioAction(u, 'shape', 'hexagon')).toBe(true); expect((await getWalletStyle(u)).avatarShape).toBe('hexagon');
    expect(await applyStudioAction(u, 'shape', 'triangle')).toBe(false); expect(await applyStudioAction(u, 'preset', 'nope')).toBe(false);
    const p = PRESETS[1]!; expect(await applyStudioAction(u, 'preset', p.id)).toBe(true);
    expect(await getWalletStyle(u)).toMatchObject({ bgColor: p.from, bgColor2: p.to, textColor: p.text, bgDirection: 'diagonal' });
    for (let i = 0; i < 12; i++) await applyStudioAction(u, 'darker'); expect((await getWalletStyle(u)).opacity).toBe(0.9);
    for (let i = 0; i < 12; i++) await applyStudioAction(u, 'lighter'); expect((await getWalletStyle(u)).opacity).toBe(0);
    await applyStudioAction(u, 'privacy'); expect((await getWalletStyle(u)).hideWallet).toBe(true); await applyStudioAction(u, 'privacy'); expect((await getWalletStyle(u)).hideWallet).toBe(false);
    await applyStudioAction(u, 'reset'); expect(await getWalletStyle(u)).toMatchObject({ bgColor: null, avatarShape: 'circle', opacity: 0.55 });
  });
  test('the colours form validates every box and saves nothing on a mistake', async () => {
    const u = uid();
    expect(await applyColorsForm(u, {})).toContain('at least one');
    expect(await applyColorsForm(u, { bg: '#123456', text: 'nope' })).toContain('text'); expect((await getWalletStyle(u)).bgColor).toBeNull();
    expect(await applyColorsForm(u, { bg: '#123456', gradient: '#654321', text: '#ffffff', message: 'hi there' })).toBeNull();
    expect(await getWalletStyle(u)).toMatchObject({ bgColor: '#123456', bgColor2: '#654321', textColor: '#ffffff', message: 'hi there' });
    expect(await applyColorsForm(u, { message: '-' })).toBeNull(); expect((await getWalletStyle(u)).message).toBeNull();
  });
  test('the message carries only this owner\'s id and a fresh preview', async () => {
    const u = uid();
    const view = await studioView({ id: u, username: 'u', displayName: 'U', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } as any, 'global');
    const json = JSON.stringify(view.components.map(c => c.toJSON()));
    for (const a of ['shape', 'preset', 'colors', 'darker', 'lighter', 'privacy', 'reset']) expect(json).toContain(`ws:${u}:${a}`);
    expect(view.files).toHaveLength(1); expect(json).toContain(`attachment://${view.files[0]!.name}`); expect(view.attachments).toEqual([]);
  });

  const comp = (customId: string, userId: string, o: { values?: string[]; fields?: Record<string, string> } = {}) => {
    const log = { replies: [] as any[], edits: [] as any[], deferred: 0, modal: null as any };
    const i = {
      customId, user: { id: userId, username: 'u', displayName: 'U', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' }, guildId: null, client: {},
      values: o.values ?? [], fields: { getTextInputValue: (k: string) => o.fields?.[k] ?? '' },
      isStringSelectMenu: () => !!o.values, isFromMessage: () => true,
      reply: async (p: any) => { log.replies.push(p); }, deferUpdate: async () => { log.deferred++; }, deferReply: async () => { log.deferred++; },
      editReply: async (p: any) => { log.edits.push(p); }, followUp: async (p: any) => { log.replies.push(p); }, showModal: async (m: any) => { log.modal = m.toJSON(); },
    };
    return { i: i as any, log };
  };
  test('only the owner can use the controls', async () => {
    const owner = uid(), other = uid();
    const c = comp(`ws:${owner}:privacy`, other); await handleStudioComponent(c.i);
    expect(c.log.replies[0].content).toContain('belongs to someone else'); expect(c.log.edits).toHaveLength(0); expect((await getWalletStyle(owner)).hideWallet).toBe(false);
    const m = comp(`ws:${owner}:modal`, other, { fields: { bg: '#123456' } }); await handleStudioModal(m.i);
    expect(m.log.replies[0].content).toContain('belongs to someone else'); expect((await getWalletStyle(owner)).bgColor).toBeNull();
  });
  test('the owner\'s buttons, menus and form update the style and redraw the message', async () => {
    const u = uid();
    const b = comp(`ws:${u}:privacy`, u); await handleStudioComponent(b.i);
    expect((await getWalletStyle(u)).hideWallet).toBe(true); expect(b.log.deferred).toBe(1); expect(b.log.edits).toHaveLength(1);
    const s = comp(`ws:${u}:shape`, u, { values: ['square'] }); await handleStudioComponent(s.i);
    expect((await getWalletStyle(u)).avatarShape).toBe('square'); expect(s.log.edits).toHaveLength(1);
    const open = comp(`ws:${u}:colors`, u); await handleStudioComponent(open.i);
    expect(open.log.modal.custom_id).toBe(`ws:${u}:modal`); expect(open.log.modal.components.length).toBe(4);
    const f = comp(`ws:${u}:modal`, u, { fields: { bg: '#010203', gradient: '', text: '', message: 'ok' } }); await handleStudioModal(f.i);
    expect(await getWalletStyle(u)).toMatchObject({ bgColor: '#010203', message: 'ok' }); expect(f.log.edits).toHaveLength(1);
    const bad = comp(`ws:${u}:modal`, u, { fields: { bg: 'zzz', gradient: '', text: '', message: '' } }); await handleStudioModal(bad.i);
    expect(bad.log.replies[0].content).toContain('❌'); expect(bad.log.edits).toHaveLength(0);
    const unknown = comp(`ws:${u}:bogus`, u); await handleStudioComponent(unknown.i); expect(unknown.log.replies[0].content).toContain('reopen');
  });
  test('once Premium is on sale the studio\'s own controls need Premium too', async () => {
    Bun.env.PREMIUM_SKU_ID = '1234567890';
    const u = uid(); const c = comp(`ws:${u}:privacy`, u); await handleStudioComponent(c.i);
    expect(c.log.replies[0].content).toContain('Premium'); expect((await getWalletStyle(u)).hideWallet).toBe(false);
  });
});
