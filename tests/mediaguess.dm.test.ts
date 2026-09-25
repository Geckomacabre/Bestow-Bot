import { beforeAll, describe, expect, test } from 'bun:test';
import { InteractionContextType } from 'discord.js';
import { initDb } from '../src/utils/db';
import { activeGames, castVoteSkip, requestHint, type GameState, type MediaEntry } from '../src/utils/mediagame';
import mediaguessModule from '../src/features/mediaguess';
import guess from '../src/legacy/mediaguess/guess';
import { shouldRespond } from '../src/ai/chat';

beforeAll(async () => { await initDb(); });

const media: MediaEntry = { id: 1, type: 'movie', title: 'Heat', year: 1995, genre: 'Crime', director: 'Michael Mann', cast: 'Al Pacino', synopsis: 'A heist crew.', tagline: null, stills: ['https://img/1.jpg'] };
let n = 0;
function round(o: Partial<GameState> = {}): GameState {
  const state: GameState = { guildId: null, channelId: `dm-${++n}`, type: 'movie', media, hintOrder: [0, 1, 2, 3, 4], hintsUsed: 0, lastHintAt: 0, voteskips: new Set(), messageId: 'round-msg', startedAt: Date.now(), answered: false, ...o };
  activeGames.set(state.channelId, state);
  return state;
}
/** A client whose only channel records what gets posted in it. */
function fakeClient() {
  const sent: any[] = []; let deleted = 0;
  const channel = { isSendable: () => true, send: async (p: any) => { sent.push(typeof p === 'string' ? { content: p } : p); return { id: `m${sent.length}` }; }, messages: { fetch: async () => ({ delete: async () => { deleted++; } }) } };
  return { client: { channels: { fetch: async () => channel }, user: { id: 'bot1' } } as any, sent, deleted: () => deleted };
}
const customIds = (p: any) => (p.components ?? []).flatMap((r: any) => r.toJSON().components.map((c: any) => c.custom_id));

describe('solo guessing rounds in DMs', () => {
  test('skip is instant: no vote, no 5-minute wait, and the answer comes with a Next round button instead of an auto-restart', async () => {
    const f = fakeClient(), state = round();
    expect(await castVoteSkip(state.channelId, 'u1', f.client)).toEqual({ content: '⏭️ Round skipped.', ephemeral: true });
    expect(activeGames.has(state.channelId)).toBe(false);
    expect(f.deleted()).toBe(1);
    expect(f.sent[0].content).toBe('⏭️ Skipped! The movie was **Heat**.');
    expect(customIds(f.sent[0])).toEqual(['mg_next:movie']);
  });

  test('server rounds still need the vote and the delay', async () => {
    const f = fakeClient(), state = round({ guildId: 'g1' });
    expect((await castVoteSkip(state.channelId, 'u1', f.client)).content).toContain('isn\'t available yet');
    expect(activeGames.has(state.channelId)).toBe(true);
    activeGames.delete(state.channelId);
  });

  test('hints have no cooldown in a DM, but keep it in servers', async () => {
    const dm = round({ hintsUsed: 1, lastHintAt: Date.now() });
    const hint = await requestHint(dm.channelId, 'u1');
    expect(hint?.embeds?.[0]?.toJSON().title).toBe('💡 Movie Hint #2 (Title Letters)');
    const guild = round({ guildId: 'g1', hintsUsed: 1, lastHintAt: Date.now() });
    expect((await requestHint(guild.channelId, 'u1'))?.content).toContain('on cooldown');
    activeGames.delete(dm.channelId); activeGames.delete(guild.channelId);
  });

  test('a DM guess is heard, and a right one wins without touching server XP', async () => {
    const f = fakeClient(), state = round(), reacts: string[] = [];
    const message: any = { guildId: null, channelId: state.channelId, author: { id: 'u1', bot: false, username: 'sam' }, member: null, content: 'heat', react: async (e: string) => { reacts.push(e); }, reply: async () => { throw new Error('no XP reply in DMs'); } };
    await mediaguessModule.handlers.messageCreate!({ data: [message], bot: f.client } as any);
    expect(reacts).toEqual(['✅']);
    expect(f.sent[0].content).toBe('🎉 You got it! The movie was **Heat**!');
    expect(customIds(f.sent[0])).toEqual(['mg_next:movie']);
  });

  test('the AI chat stays out of a live round unless it is @mentioned', async () => {
    const state = round();
    const msg = (mention: boolean): any => ({ guildId: null, channelId: state.channelId, author: { bot: false }, system: false, client: { user: { id: 'bot1' } }, mentions: { users: { has: () => mention } } });
    expect(await shouldRespond(msg(false))).toBe(false);
    expect(await shouldRespond(msg(true))).toBe(true);
    activeGames.delete(state.channelId);
    expect(await shouldRespond(msg(false))).toBe(true);
  });

  test('Next round refuses while a round is live', async () => {
    const state = round(), replies: any[] = [];
    const btn: any = { isModalSubmit: () => false, isButton: () => true, customId: 'mg_next:movie', guildId: null, channelId: state.channelId, reply: async (p: any) => { replies.push(p); } };
    await mediaguessModule.handlers.interactionCreate!({ data: [btn] } as any);
    expect(replies[0].content).toContain('already a round going');
    activeGames.delete(state.channelId);
  });
});

describe('/community guess', () => {
  const run = async (context: InteractionContextType, inGuild: boolean, env: Record<string, string | undefined> = {}) => {
    const saved = { ...Bun.env }; Object.assign(Bun.env, env); for (const [k, v] of Object.entries(env)) if (v === undefined) delete Bun.env[k];
    const replies: any[] = [];
    const i: any = { context, inGuild: () => inGuild, channelId: `c-${++n}`, options: { getString: () => 'movie' }, reply: async (p: any) => { replies.push(p); } };
    try { await guess.run(i); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete Bun.env[k]; else Bun.env[k] = saved[k]; } }
    return replies;
  };
  // Outside a DM with the bot the round is played with buttons and a pop-up box: see mediaguess.interactive.test.ts.
  test('says so when the mode has no API key', async () => {
    expect((await run(InteractionContextType.BotDM, false, { TMDB_API_KEY: undefined }))[0].content).toContain('TMDB_API_KEY');
  });
});

describe('round start guard', () => {
  test('a second start while one is loading is refused, and the channel reads as busy meanwhile', async () => {
    const { startGame, roundBusy } = await import('../src/utils/mediagame');
    const saved = Bun.env.TMDB_API_KEY; delete Bun.env.TMDB_API_KEY; // the fetch fails fast without a key
    const f = fakeClient(), ch = `busy-${++n}`;
    const first = startGame(null, ch, 'movie', f.client);
    expect(roundBusy(ch)).toBe(true);
    expect(await startGame(null, ch, 'movie', f.client)).toBe(false);
    expect(await first).toBe(false);
    expect(roundBusy(ch)).toBe(false);
    if (saved !== undefined) Bun.env.TMDB_API_KEY = saved;
  });
});
