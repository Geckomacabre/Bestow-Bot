import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { InteractionContextType } from 'discord.js';
import { initDb } from '../src/utils/db';
import {
  GUESS_BUTTON, GUESS_INPUT, GUESS_MODAL, INTERACTIVE_NEXT_PREFIX, activeGames, buildRound, castVoteSkip, hooks, requestHint, roundBusy, safeName, startInteractiveRound, submitGuess,
  type InteractiveHost, type MediaEntry, type RoundEdit, type RoundPayload,
} from '../src/utils/mediagame';
import mediaguessModule from '../src/features/mediaguess';
import guess from '../src/legacy/mediaguess/guess';

beforeAll(async () => { await initDb(); });

const media: MediaEntry = { id: 7, type: 'movie', title: 'Heat', year: 1995, genre: 'Crime', director: 'Michael Mann', cast: 'Al Pacino', synopsis: 'A heist crew.', tagline: null, stills: ['https://img/1.jpg', 'https://img/2.jpg'] };
let n = 0;
const chan = () => `group-dm-${++n}`;
afterEach(() => { hooks.fetchEntry = undefined; hooks.roundMs = undefined; for (const [k, s] of activeGames) { if (s.interactive) clearTimeout(s.interactive.timer); if (k.startsWith('group-dm-')) activeGames.delete(k); } });

const ids = (p: { components?: any[] }) => (p.components ?? []).flatMap((r: any) => r.toJSON().components.map((c: any) => c.custom_id));

/** A host that records what would be posted and edited through the interaction's webhook. */
function host(channelId = chan(), userId = 'starter') {
  const posts: RoundPayload[] = [], edits: { id: string; payload: RoundEdit }[] = [];
  const h: InteractiveHost = {
    client: {} as never, channelId, userId,
    send: async p => { posts.push(p); return { id: `msg-${posts.length}` }; },
    edit: async (id, payload) => { edits.push({ id, payload }); },
  };
  return { h, posts, edits };
}
const stub = () => { hooks.fetchEntry = async () => media; };

describe('starting an interactive round', () => {
  test('posts the round with Guess, Hint and Skip, and the round is live in that channel', async () => {
    stub(); const { h, posts } = host();
    expect(await startInteractiveRound(h, 'movie')).toBe(true);
    expect(ids(posts[0]!)).toEqual([GUESS_BUTTON, 'mg_hint', 'mg_voteskip']);
    const embed = posts[0]!.embeds[0]!.toJSON();
    expect(embed.description).toContain('Press **Guess**'); expect(embed.description).toContain('anyone here can play'); expect(embed.image?.url).toBe('https://img/1.jpg');
    const state = activeGames.get(h.channelId)!;
    expect(state.interactive?.ownerId).toBe('starter'); expect(state.guildId).toBeNull(); expect(state.messageId).toBe('msg-1');
  });
  test('refuses a second round in the same channel, and reads as busy while one is loading', async () => {
    let release = () => {};
    hooks.fetchEntry = () => new Promise(r => { release = () => r(media); });
    const a = host(), first = startInteractiveRound(a.h, 'movie');
    expect(roundBusy(a.h.channelId)).toBe(true);
    expect(await startInteractiveRound(host(a.h.channelId).h, 'movie')).toBe(false);
    release(); expect(await first).toBe(true);
    expect(await startInteractiveRound(host(a.h.channelId).h, 'movie')).toBe(false); // now it is live
  });
  test('reports failure — and leaves no round behind — when nothing could be fetched or posted', async () => {
    hooks.fetchEntry = async () => null;
    const a = host(); expect(await startInteractiveRound(a.h, 'movie')).toBe(false); expect(roundBusy(a.h.channelId)).toBe(false);
    stub(); const b = host(); b.h.send = async () => null;
    expect(await startInteractiveRound(b.h, 'movie')).toBe(false); expect(roundBusy(b.h.channelId)).toBe(false);
  });
  test('the three modes tell people how to answer, and only interactive rounds have a Guess button', async () => {
    const d = (mode: 'guild' | 'dm' | 'interactive') => buildRound('movie', media, mode);
    expect(ids((await d('interactive'))!)).toContain(GUESS_BUTTON);
    for (const m of ['guild', 'dm'] as const) expect(ids((await d(m))!)).not.toContain(GUESS_BUTTON);
    expect((await d('dm'))!.embeds[0]!.toJSON().description).toContain('Type your answer here');
    expect((await d('guild'))!.embeds[0]!.toJSON().description).toContain('Type your answer in chat');
    expect(ids((await d('guild'))!)).toEqual(['mg_hint', 'mg_voteskip']);
  });
  test('a music round without a playable clip is not started', async () => {
    hooks.fetchEntry = async () => ({ ...media, type: 'music', audioPreview: undefined });
    const a = host(); expect(await startInteractiveRound(a.h, 'music')).toBe(false); expect(roundBusy(a.h.channelId)).toBe(false);
  });
});

describe('guessing', () => {
  test('wrong, close and very close guesses change nothing; a correct one rewrites the round with the winner and a Next round button', async () => {
    stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    const who = { id: 'u2', name: 'Sam' };
    expect(await submitGuess(h.channelId, 'Casablanca', who, h.client)).toBe('wrong');
    expect(await submitGuess(h.channelId, 'Hea', who, h.client)).toMatch(/close/);
    expect(activeGames.has(h.channelId)).toBe(true); expect(edits).toHaveLength(0);
    expect(await submitGuess(h.channelId, '  heat  ', who, h.client)).toBe('correct');
    expect(activeGames.has(h.channelId)).toBe(false);
    expect(edits).toHaveLength(1); expect(edits[0]!.id).toBe('msg-1');
    expect(edits[0]!.payload.content).toBe('🎉 **Sam** got it! The movie was **Heat**.');
    expect(edits[0]!.payload.embeds).toEqual([]); expect(edits[0]!.payload.attachments).toEqual([]);
    expect(ids(edits[0]!.payload)).toEqual([`${INTERACTIVE_NEXT_PREFIX}movie`]);
    expect(await submitGuess(h.channelId, 'heat', who, h.client)).toBe('no-round'); // the round is over
  });
  test('when several people get it right at once only the first wins', async () => {
    stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    const results = await Promise.all(['u1', 'u2', 'u3'].map(id => submitGuess(h.channelId, 'Heat', { id, name: id }, h.client)));
    expect(results.filter(r => r === 'correct')).toHaveLength(1); expect(results.filter(r => r === 'no-round')).toHaveLength(2);
    expect(edits).toHaveLength(1);
  });
  test('a winner\'s name cannot inject markdown into the announcement', async () => {
    stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    await submitGuess(h.channelId, 'heat', { id: 'u1', name: '**hi** [x](https://evil.example)' }, h.client);
    const text = edits[0]!.payload.content!;
    expect(text).not.toMatch(/(?<!\\)\[x\]\(/); // the bracket is escaped, so no masked link is formed
    expect(text).toContain('\\[x]'); expect(text).toContain('\\*\\*hi\\*\\*');
  });
  test('nor can it mention people or ping everyone', () => {
    const s = safeName('<@123456789> <#5> @everyone @here');
    expect(s).not.toContain('<'); expect(s).not.toContain('@everyone'); expect(s).not.toContain('@here'); expect(s).not.toMatch(/@[a-z]/);
    expect(safeName('x'.repeat(200))).toHaveLength(40); expect(safeName('Sam G')).toBe('Sam G');
  });
  test('hints work the same as in a DM, shared by everyone in the chat and without a cooldown', async () => {
    stub(); const { h } = host(); await startInteractiveRound(h, 'movie');
    const first = await requestHint(h.channelId, 'u1'), second = await requestHint(h.channelId, 'u2');
    expect(first?.embeds?.[0]?.toJSON().title).toMatch(/Hint #1/); expect(second?.embeds?.[0]?.toJSON().title).toMatch(/Hint #2/);
  });
});

describe('giving up and running out of time', () => {
  test('skipping reveals the answer through the same message', async () => {
    stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    expect((await castVoteSkip(h.channelId, 'starter', h.client)).content).toBe('⏭️ Round skipped.');
    expect(edits[0]!.payload.content).toBe('⏭️ Skipped! The movie was **Heat**.'); expect(activeGames.has(h.channelId)).toBe(false);
  });
  test('a round that nobody wins ends by itself and says so', async () => {
    stub(); hooks.roundMs = 25; const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    await Bun.sleep(120);
    expect(activeGames.has(h.channelId)).toBe(false); expect(edits).toHaveLength(1);
    expect(edits[0]!.payload.content).toBe('⌛ Time\'s up! The movie was **Heat**.');
  });
  test('a win cancels the timer, so a finished round is never announced twice', async () => {
    stub(); hooks.roundMs = 40; const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    await submitGuess(h.channelId, 'heat', { id: 'u1', name: 'u1' }, h.client);
    await Bun.sleep(120); expect(edits).toHaveLength(1);
  });
  test('an edit that Discord refuses (expired token) does not crash the resolve', async () => {
    stub(); const { h } = host(); h.edit = async () => { throw new Error('Invalid Webhook Token'); };
    await startInteractiveRound(h, 'movie');
    expect(await submitGuess(h.channelId, 'heat', { id: 'u1', name: 'u1' }, h.client)).toBe('correct');
    expect(activeGames.has(h.channelId)).toBe(false);
  });
});

describe('the buttons and the pop-up box', () => {
  const button = (customId: string, channelId: string, userId = 'u1') => {
    const out = { replies: [] as any[], modal: null as any, updates: [] as any[], followUps: [] as any[], webhookEdits: [] as any[] };
    const i: any = {
      isModalSubmit: () => false, isButton: () => true, customId, channelId, user: { id: userId }, client: {}, guildId: null,
      reply: async (p: any) => { out.replies.push(p); }, showModal: async (m: any) => { out.modal = m.toJSON(); }, update: async (p: any) => { out.updates.push(p); },
      editReply: async (p: any) => { out.updates.push(p); }, followUp: async (p: any) => { out.followUps.push(p); return { id: `f${out.followUps.length}` }; },
      webhook: { editMessage: async (id: string, p: any) => { out.webhookEdits.push({ id, p }); } },
    };
    return { i, out };
  };
  const modal = (channelId: string, text: string, userId = 'u1') => {
    const out = { replies: [] as any[] };
    const i: any = { isModalSubmit: () => true, customId: GUESS_MODAL, channelId, user: { id: userId, username: 'sam', globalName: 'Sam G' }, member: null, client: {}, fields: { getTextInputValue: (k: string) => (k === GUESS_INPUT ? text : '') }, reply: async (p: any) => { out.replies.push(p); } };
    return { i, out };
  };
  const dispatch = (i: any) => mediaguessModule.handlers.interactionCreate!({ data: [i] } as any);

  test('Guess opens a box with one text field', async () => {
    stub(); const { h } = host(); await startInteractiveRound(h, 'movie');
    const b = button(GUESS_BUTTON, h.channelId); await dispatch(b.i);
    expect(b.out.modal.custom_id).toBe(GUESS_MODAL); expect(b.out.modal.title).toBe('Guess the movie');
    expect(b.out.modal.components[0].components[0]).toMatchObject({ custom_id: GUESS_INPUT, max_length: 100, required: true });
  });
  test('Guess on a round that is over says so instead of opening a box', async () => {
    const b = button(GUESS_BUTTON, chan()); await dispatch(b.i);
    expect(b.out.modal).toBeNull(); expect(b.out.replies[0].content).toContain('no active guessing game');
  });
  test('the box answers privately: not quite, close, or correct — and a correct one ends the round for everyone', async () => {
    stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    const wrong = modal(h.channelId, 'Casablanca'); await dispatch(wrong.i);
    expect(wrong.out.replies[0].content).toContain('Not quite'); expect(wrong.out.replies[0].flags).toBeTruthy(); // ephemeral
    const close = modal(h.channelId, 'Hea'); await dispatch(close.i); expect(close.out.replies[0].content).toMatch(/Close|Very close/);
    const right = modal(h.channelId, 'heat'); await dispatch(right.i);
    expect(right.out.replies[0].content).toContain('you got it'); expect(edits[0]!.payload.content).toBe('🎉 **Sam G** got it! The movie was **Heat**.');
    const late = modal(h.channelId, 'heat'); await dispatch(late.i); expect(late.out.replies[0].content).toContain('no active guessing game');
  });
  test('only the person who started the round can skip it', async () => {
    stub(); const { h, edits } = host(undefined, 'starter'); await startInteractiveRound(h, 'movie');
    const other = button('mg_voteskip', h.channelId, 'someone-else'); await dispatch(other.i);
    expect(other.out.replies[0].content).toContain('Only <@starter> can skip'); expect(activeGames.has(h.channelId)).toBe(true); expect(edits).toHaveLength(0);
    const owner = button('mg_voteskip', h.channelId, 'starter'); await dispatch(owner.i);
    expect(activeGames.has(h.channelId)).toBe(false); expect(edits[0]!.payload.content).toContain('Skipped');
  });
  test('Next round refuses while a round is live, and otherwise takes the button off and posts a new round as a follow-up', async () => {
    stub(); const { h } = host(); await startInteractiveRound(h, 'movie');
    const busy = button(`${INTERACTIVE_NEXT_PREFIX}movie`, h.channelId); await dispatch(busy.i);
    expect(busy.out.replies[0].content).toContain('already a round going');
    activeGames.delete(h.channelId); clearTimeout(0 as never);
    Bun.env.TMDB_API_KEY = 'test'; const next = button(`${INTERACTIVE_NEXT_PREFIX}movie`, h.channelId, 'fresh-starter'); await dispatch(next.i); delete Bun.env.TMDB_API_KEY;
    expect(next.out.updates[0]).toEqual({ components: [] }); expect(next.out.followUps).toHaveLength(1);
    expect(ids(next.out.followUps[0])).toEqual([GUESS_BUTTON, 'mg_hint', 'mg_voteskip']);
    expect(activeGames.get(h.channelId)?.interactive?.ownerId).toBe('fresh-starter'); // whoever pressed Next round now owns the skip
  });
});

describe('/community guess', () => {
  const run = async (context: InteractionContextType, o: { key?: boolean; failFetch?: boolean } = {}) => {
    if (o.key !== false) Bun.env.TMDB_API_KEY = 'test'; else delete Bun.env.TMDB_API_KEY;
    o.failFetch ? (hooks.fetchEntry = async () => null) : stub();
    const out = { replies: [] as any[], edits: [] as any[], deferred: [] as any[], webhookEdits: [] as any[] };
    const channelId = chan();
    const i: any = {
      context, channelId, user: { id: 'starter' }, client: {}, options: { getString: () => 'movie' },
      reply: async (p: any) => { out.replies.push(p); }, deferReply: async (p?: any) => { out.deferred.push(p ?? {}); },
      editReply: async (p: any) => { out.edits.push(p); return { id: 'round-msg' }; }, webhook: { editMessage: async (id: string, p: any) => { out.webhookEdits.push({ id, p }); } },
    };
    try { await guess.run(i); } finally { delete Bun.env.TMDB_API_KEY; }
    return { out, channelId };
  };
  test('in a group DM, a server the bot is not in, or a server channel: the round is the reply, visible to everyone', async () => {
    for (const ctx of [InteractionContextType.PrivateChannel, InteractionContextType.Guild]) {
      const { out, channelId } = await run(ctx);
      expect(out.deferred).toEqual([{}]); // public — not ephemeral, so the whole chat can play
      expect(ids(out.edits[0])).toEqual([GUESS_BUTTON, 'mg_hint', 'mg_voteskip']);
      expect(activeGames.get(channelId)?.interactive?.ownerId).toBe('starter');
    }
  });
  test('the reply is the round message: later edits go through the interaction\'s webhook', async () => {
    const { out, channelId } = await run(InteractionContextType.PrivateChannel);
    await submitGuess(channelId, 'heat', { id: 'u9', name: 'Sam' }, {} as never);
    expect(out.webhookEdits).toHaveLength(1); expect(out.webhookEdits[0].id).toBe('round-msg'); expect(out.webhookEdits[0].p.content).toContain('Sam');
  });
  test('says so when the round cannot be loaded, and when the mode has no API key', async () => {
    expect((await run(InteractionContextType.PrivateChannel, { failFetch: true })).out.edits[0]).toContain('couldn\'t load a round');
    expect((await run(InteractionContextType.PrivateChannel, { key: false })).out.replies[0].content).toContain('TMDB_API_KEY');
  });
  test('a round already going in the channel is refused politely', async () => {
    stub(); Bun.env.TMDB_API_KEY = 'test'; const { h } = host(); await startInteractiveRound(h, 'movie');
    const replies: any[] = [];
    await guess.run({ context: InteractionContextType.PrivateChannel, channelId: h.channelId, user: { id: 'x' }, client: {}, options: { getString: () => 'movie' }, reply: async (p: any) => { replies.push(p); } } as any);
    delete Bun.env.TMDB_API_KEY; expect(replies[0].content).toContain('already a round going');
  });
});
