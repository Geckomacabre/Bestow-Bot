import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { InteractionContextType } from 'discord.js';
import { initDb } from '../src/utils/db';
import {
  GUESS_BUTTON, GUESS_INPUT, GUESS_MODAL, INTERACTIVE_NEXT_PREFIX, activeGames, buildRound, cancelPendingNext, castVoteSkip, hooks, requestHint, roundBusy, safeName, startInteractiveRound,
  stopGame, submitGuess, type InteractiveHost, type MediaEntry, type RoundEdit, type RoundPayload,
} from '../src/utils/mediagame';
import mediaguessModule from '../src/features/mediaguess';
import guess from '../src/legacy/mediaguess/guess';
import guessCommand from '../src/commands/fun/guess';

beforeAll(async () => { await initDb(); });

const media: MediaEntry = { id: 7, type: 'movie', title: 'Heat', year: 1995, genre: 'Crime', director: 'Michael Mann', cast: 'Al Pacino', synopsis: 'A heist crew.', tagline: null, stills: ['https://img/1.jpg', 'https://img/2.jpg'] };
const second: MediaEntry = { ...media, id: 8, title: 'Ronin', stills: ['https://img/3.jpg'] };
let n = 0;
const made: string[] = [];
const chan = () => { const c = `group-dm-${++n}`; made.push(c); return c; };
afterEach(() => {
  hooks.fetchEntry = undefined; hooks.roundMs = undefined; hooks.nextDelayMs = undefined;
  for (const c of made) { cancelPendingNext(c); const s = activeGames.get(c); if (s?.interactive) clearTimeout(s.interactive.timer); activeGames.delete(c); }
  made.length = 0;
});

const ids = (p: { components?: any[] }) => (p.components ?? []).flatMap((r: any) => r.toJSON().components.map((c: any) => c.custom_id));
const ROUND_BUTTONS = [GUESS_BUTTON, 'mg_hint', 'mg_voteskip', 'mg_stop:movie'];

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
  test('posts the round with Guess, Hint, Skip and Stop game, and the round is live in that channel', async () => {
    stub(); const { h, posts } = host();
    expect(await startInteractiveRound(h, 'movie')).toBe(true);
    expect(ids(posts[0]!)).toEqual(ROUND_BUTTONS);
    const embed = posts[0]!.embeds[0]!.toJSON();
    expect(embed.description).toContain('Press **Guess**'); expect(embed.description).toContain('/guess'); expect(embed.description).toContain('anyone here can play');
    expect(embed.description).toContain('Stop game'); expect(embed.image?.url).toBe('https://img/1.jpg');
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
    expect(ids((await d('guild'))!)).toEqual(['mg_hint', 'mg_voteskip']); // server channels are stopped by an admin, not by a button
    expect(ids((await d('dm'))!)).toEqual(['mg_hint', 'mg_voteskip', 'mg_stop:movie']);
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
    expect(ids(edits[0]!.payload)).toEqual([`${INTERACTIVE_NEXT_PREFIX}movie`]); // no follow-on host: the game ends here, with a way to start again
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
  test('a round that nobody wins ends by itself, says so, and the game ends with it', async () => {
    stub(); hooks.roundMs = 25; const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    await Bun.sleep(120);
    expect(activeGames.has(h.channelId)).toBe(false); expect(edits).toHaveLength(1);
    expect(edits[0]!.payload.content).toBe('⌛ Time\'s up! The movie was **Heat**.\n-# Nobody answered for a while, so the game has ended.');
    expect(ids(edits[0]!.payload)).toEqual([`${INTERACTIVE_NEXT_PREFIX}movie`]); expect(roundBusy(h.channelId)).toBe(false);
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

describe('the game keeps going until someone stops it', () => {
  test('after a right answer the next round is posted through the answering interaction, round after round, and the starter stays the owner', async () => {
    hooks.nextDelayMs = 25; let served = 0; hooks.fetchEntry = async () => (served++ % 2 === 0 ? media : second);
    const a = host(chan(), 'starter'); await startInteractiveRound(a.h, 'movie');
    const b = host(a.h.channelId, 'answerer-1'), c = host(a.h.channelId, 'answerer-2');
    await submitGuess(a.h.channelId, 'heat', { id: 'answerer-1', name: 'Sam' }, a.h.client, b.h);
    // Right away: the result carries a Stop button, says what happens next, and the channel reads as busy.
    expect(a.edits[0]!.payload.content).toBe('🎉 **Sam** got it! The movie was **Heat**.\n-# Next round in 0 seconds — press ⏹️ Stop game to end it.'); // (0 seconds only because this test shortens the delay)
    expect(ids(a.edits[0]!.payload)).toEqual(['mg_stop:movie']); expect(roundBusy(a.h.channelId)).toBe(true);
    await Bun.sleep(150);
    // Round 2 was posted through the answering interaction (b), not the one that started the game.
    expect(b.posts).toHaveLength(1); expect(ids(b.posts[0]!)).toEqual(ROUND_BUTTONS); expect(a.posts).toHaveLength(1);
    const round2 = activeGames.get(a.h.channelId)!;
    expect(round2.media.title).toBe('Ronin'); expect(round2.interactive?.ownerId).toBe('starter'); expect(round2.messageId).toBe('msg-1');
    // ...and it is edited through b too. Answer it, and round 3 comes through c.
    await submitGuess(a.h.channelId, 'ronin', { id: 'answerer-2', name: 'Alex' }, a.h.client, c.h);
    expect(b.edits[0]!.payload.content).toContain('**Alex** got it! The movie was **Ronin**.');
    await Bun.sleep(150);
    expect(c.posts).toHaveLength(1); expect(activeGames.get(a.h.channelId)!.media.title).toBe('Heat'); expect(activeGames.get(a.h.channelId)!.interactive?.ownerId).toBe('starter');
  });
  test('a skip by the starter goes on to the next round too', async () => {
    hooks.nextDelayMs = 25; hooks.fetchEntry = async () => second;
    const a = host(); stub(); await startInteractiveRound(a.h, 'movie'); hooks.fetchEntry = async () => second;
    const b = host(a.h.channelId);
    await castVoteSkip(a.h.channelId, 'starter', a.h.client, b.h);
    expect(a.edits[0]!.payload.content).toContain('⏭️ Skipped! The movie was **Heat**.'); expect(a.edits[0]!.payload.content).toContain('Next round in');
    await Bun.sleep(150);
    expect(b.posts).toHaveLength(1); expect(activeGames.get(a.h.channelId)!.media.title).toBe('Ronin');
  });
  test('Stop game during a round reveals the answer, offers a way to start again, and nothing follows', async () => {
    hooks.nextDelayMs = 25; stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    expect(await stopGame(h.channelId, h.client)).toBe('round');
    expect(edits[0]!.payload.content).toBe('⏹️ Game stopped! The movie was **Heat**.');
    expect(ids(edits[0]!.payload)).toEqual([`${INTERACTIVE_NEXT_PREFIX}movie`]);
    await Bun.sleep(100); expect(activeGames.has(h.channelId)).toBe(false); expect(roundBusy(h.channelId)).toBe(false);
    expect(await stopGame(h.channelId, h.client)).toBe('nothing');
  });
  test('Stop game in the gap between rounds calls off the one that was about to start', async () => {
    hooks.nextDelayMs = 60; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    const b = host(a.h.channelId);
    await submitGuess(a.h.channelId, 'heat', { id: 'u1', name: 'u1' }, a.h.client, b.h);
    expect(roundBusy(a.h.channelId)).toBe(true);
    expect(await stopGame(a.h.channelId, a.h.client)).toBe('pending');
    await Bun.sleep(160);
    expect(b.posts).toHaveLength(0); expect(activeGames.has(a.h.channelId)).toBe(false); expect(roundBusy(a.h.channelId)).toBe(false);
  });
  test('if the next round cannot be loaded, the result gets a Next round button instead of a dead Stop button', async () => {
    hooks.nextDelayMs = 25; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    hooks.fetchEntry = async () => null;
    await submitGuess(a.h.channelId, 'heat', { id: 'u1', name: 'u1' }, a.h.client, host(a.h.channelId).h);
    await Bun.sleep(150);
    expect(a.edits).toHaveLength(2); expect(ids(a.edits[1]!.payload)).toEqual([`${INTERACTIVE_NEXT_PREFIX}movie`]); expect(roundBusy(a.h.channelId)).toBe(false);
  });
  test('a server round is left alone: only an admin stops those', async () => {
    const h = host(); activeGames.set(h.h.channelId, { guildId: 'g1', channelId: h.h.channelId, type: 'movie', media, hintOrder: [0], hintsUsed: 0, lastHintAt: 0, voteskips: new Set(), messageId: 'm', startedAt: Date.now(), answered: false });
    expect(await stopGame(h.h.channelId, h.h.client)).toBe('nothing'); expect(activeGames.has(h.h.channelId)).toBe(true);
  });
});

describe('the buttons and the pop-up box', () => {
  const button = (customId: string, channelId: string, userId = 'u1', o: { context?: InteractionContextType; content?: string } = {}) => {
    const out = { replies: [] as any[], modal: null as any, updates: [] as any[], followUps: [] as any[], webhookEdits: [] as any[], deferred: [] as any[], deferredUpdate: 0 };
    const i: any = {
      isModalSubmit: () => false, isButton: () => true, customId, channelId, user: { id: userId, username: 'u', globalName: 'U' }, member: null, client: {}, guildId: null, context: o.context ?? InteractionContextType.PrivateChannel,
      message: { content: o.content ?? '' },
      reply: async (p: any) => { out.replies.push(p); }, showModal: async (m: any) => { out.modal = m.toJSON(); }, update: async (p: any) => { out.updates.push(p); },
      deferReply: async (p: any) => { out.deferred.push(p); }, deferUpdate: async () => { out.deferredUpdate++; },
      editReply: async (p: any) => { out.updates.push(p); }, followUp: async (p: any) => { out.followUps.push(p); return { id: `f${out.followUps.length}` }; },
      webhook: { editMessage: async (id: string, p: any) => { out.webhookEdits.push({ id, p }); } },
    };
    return { i, out };
  };
  const modal = (channelId: string, text: string, userId = 'u1') => {
    const out = { edits: [] as any[], deferred: [] as any[], followUps: [] as any[], webhookEdits: [] as any[] };
    const i: any = {
      isModalSubmit: () => true, customId: GUESS_MODAL, channelId, user: { id: userId, username: 'sam', globalName: 'Sam G' }, member: null, client: {}, fields: { getTextInputValue: (k: string) => (k === GUESS_INPUT ? text : '') },
      deferReply: async (p: any) => { out.deferred.push(p); }, editReply: async (p: any) => { out.edits.push(p); },
      followUp: async (p: any) => { out.followUps.push(p); return { id: `f${out.followUps.length}` }; }, webhook: { editMessage: async (id: string, p: any) => { out.webhookEdits.push({ id, p }); } },
    };
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
  test('the box acknowledges first, then answers privately — and a correct answer ends the round for everyone and the game goes on', async () => {
    hooks.nextDelayMs = 25; stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    const wrong = modal(h.channelId, 'Casablanca'); await dispatch(wrong.i);
    expect(wrong.out.deferred[0]?.flags).toBeFalsy(); // public: not ephemeral
    expect(wrong.out.edits[0].content).toBe('**Sam G** guessed **Casablanca** — ❌ not quite.');
    const close = modal(h.channelId, 'Hea'); await dispatch(close.i); expect(close.out.edits[0].content).toMatch(/guessed \*\*Hea\*\* — (‼️ very close|❗ close)!/);
    hooks.fetchEntry = async () => second;
    const right = modal(h.channelId, 'heat'); await dispatch(right.i);
    expect(right.out.edits[0].content).toBe('**Sam G** guessed **heat** — ✅ correct!'); expect(edits[0]!.payload.content).toContain('**Sam G** got it! The movie was **Heat**.');
    await Bun.sleep(150);
    expect(right.out.followUps).toHaveLength(1); expect(ids(right.out.followUps[0])).toEqual(ROUND_BUTTONS); // round 2 came through the answering interaction
    const late = modal('somewhere-else', 'heat'); await dispatch(late.i); expect(late.out.edits[0].content).toContain('no active guessing game');
  });
  test('the person who started the game can skip a round on their own — no vote, no other players — and the game goes straight on', async () => {
    hooks.nextDelayMs = 25; stub(); const { h, edits } = host(undefined, 'starter'); await startInteractiveRound(h, 'movie');
    hooks.fetchEntry = async () => second;
    const owner = button('mg_voteskip', h.channelId, 'starter'); await dispatch(owner.i);
    expect(owner.out.deferred[0]?.flags).toBeFalsy(); expect(owner.out.updates[0]).toEqual({ content: '⏭️ **U** skipped the round.', allowedMentions: { parse: [] } });
    expect(edits[0]!.payload.content).toContain('Skipped'); await Bun.sleep(150);
    expect(owner.out.followUps).toHaveLength(1); expect(activeGames.get(h.channelId)!.media.title).toBe('Ronin');
  });
  test('anyone else needs two people to vote: one vote is only recorded, the second (different) person skips it', async () => {
    hooks.nextDelayMs = 25; stub(); const { h, edits } = host(undefined, 'starter'); await startInteractiveRound(h, 'movie');
    const first = button('mg_voteskip', h.channelId, 'friend-1'); await dispatch(first.i);
    expect(first.out.updates[0].content).toContain('Skip vote recorded: **1/2**'); expect(first.out.updates[0].content).toContain('the person who started the game can skip on their own');
    expect(activeGames.has(h.channelId)).toBe(true); expect(edits).toHaveLength(0);
    const again = button('mg_voteskip', h.channelId, 'friend-1'); await dispatch(again.i); // the same person twice is still one vote
    expect(again.out.updates[0].content).toContain('already voted'); expect(activeGames.has(h.channelId)).toBe(true);
    hooks.fetchEntry = async () => second;
    const second2 = button('mg_voteskip', h.channelId, 'friend-2'); await dispatch(second2.i);
    expect(second2.out.updates[0].content).toBe('⏭️ **2/2** skip votes — skipping this round!');
    expect(edits[0]!.payload.content).toContain('⏭️ Skipped! The movie was **Heat**.'); await Bun.sleep(150);
    expect(second2.out.followUps).toHaveLength(1); expect(activeGames.get(h.channelId)!.media.title).toBe('Ronin'); // the game goes on, through the voter's interaction
    expect(activeGames.get(h.channelId)!.voteskips.size).toBe(0); // the next round starts with no votes
  });
  test('the votes are public messages, like everything else in the game', async () => {
    stub(); const { h } = host(undefined, 'starter'); await startInteractiveRound(h, 'movie');
    const v = button('mg_voteskip', h.channelId, 'friend-1'); await dispatch(v.i);
    expect(v.out.deferred[0]?.flags).toBeFalsy(); expect(v.out.updates[0].flags).toBeUndefined();
  });
  test('Stop game ends a live round, tells the chat who stopped it, and nothing follows', async () => {
    stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    const stop = button('mg_stop:movie', h.channelId, 'u7'); await dispatch(stop.i);
    expect(stop.out.deferredUpdate).toBe(1); expect(edits[0]!.payload.content).toBe('⏹️ Game stopped! The movie was **Heat**.');
    expect(stop.out.followUps[0].content).toBe('⏹️ **U** stopped the game.'); expect(stop.out.followUps[0].allowedMentions).toEqual({ parse: [] });
    expect(activeGames.has(h.channelId)).toBe(false);
  });
  test('Stop game between rounds turns that result\'s Stop button into a way to play again', async () => {
    hooks.nextDelayMs = 200; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    await submitGuess(a.h.channelId, 'heat', { id: 'u1', name: 'u1' }, a.h.client, host(a.h.channelId).h);
    const stop = button('mg_stop:movie', a.h.channelId, 'u7', { content: '🎉 **u1** got it!' }); await dispatch(stop.i);
    expect(stop.out.updates[0].content).toBe('🎉 **u1** got it!\n⏹️ Game stopped.'); expect(ids(stop.out.updates[0])).toEqual([`${INTERACTIVE_NEXT_PREFIX}movie`]);
    const dm = button('mg_stop:movie', 'dm-x', 'u7'); await dispatch(dm.i); // nothing to stop: told privately
    expect(dm.out.followUps[0].content).toContain('no game running');
    hooks.nextDelayMs = 200; const b = host(); await startInteractiveRound(b.h, 'movie');
    await submitGuess(b.h.channelId, 'heat', { id: 'u1', name: 'u1' }, b.h.client, host(b.h.channelId).h);
    const inDm = button('mg_stop:movie', b.h.channelId, 'u7', { context: InteractionContextType.BotDM }); await dispatch(inDm.i);
    expect(ids(inDm.out.updates[0])).toEqual(['mg_next:movie']); // in a DM with the bot, "play again" is the DM-style button
  });
  test('Next round refuses while a round is live or about to start, and otherwise posts a new round as a follow-up', async () => {
    stub(); const { h } = host(); await startInteractiveRound(h, 'movie');
    const busy = button(`${INTERACTIVE_NEXT_PREFIX}movie`, h.channelId); await dispatch(busy.i);
    expect(busy.out.replies[0].content).toContain('already a round going');
    activeGames.delete(h.channelId); clearTimeout(0 as never);
    Bun.env.TMDB_API_KEY = 'test'; const next = button(`${INTERACTIVE_NEXT_PREFIX}movie`, h.channelId, 'fresh-starter'); await dispatch(next.i); delete Bun.env.TMDB_API_KEY;
    expect(next.out.updates[0]).toEqual({ components: [] }); expect(next.out.followUps).toHaveLength(1);
    expect(ids(next.out.followUps[0])).toEqual(ROUND_BUTTONS);
    expect(activeGames.get(h.channelId)?.interactive?.ownerId).toBe('fresh-starter'); // whoever pressed Next round now owns the skip
  });
});

describe('/guess <answer>', () => {
  const run = async (channelId: string, answer: string, userId = 'u1') => {
    const out = { replies: [] as any[], edits: [] as any[], deferred: [] as any[], followUps: [] as any[], webhookEdits: [] as any[] };
    const i: any = {
      channelId, user: { id: userId, username: 'sam', globalName: 'Sam G' }, member: null, client: {}, options: { getString: () => answer },
      reply: async (p: any) => { out.replies.push(p); }, deferReply: async (p: any) => { out.deferred.push(p); }, editReply: async (p: any) => { out.edits.push(p); },
      followUp: async (p: any) => { out.followUps.push(p); return { id: `f${out.followUps.length}` }; }, webhook: { editMessage: async (id: string, p: any) => { out.webhookEdits.push({ id, p }); } },
    };
    await guessCommand.run!(i);
    return out;
  };
  test('is the fast way to answer: a private answer for wrong and close guesses, and a right one wins the round', async () => {
    hooks.nextDelayMs = 25; stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    const wrong = await run(h.channelId, 'Casablanca'); expect(wrong.deferred[0]?.flags).toBeFalsy(); expect(wrong.edits[0].content).toBe('**Sam G** guessed **Casablanca** — ❌ not quite.');
    expect((await run(h.channelId, 'Hea')).edits[0].content).toMatch(/guessed \*\*Hea\*\* — (‼️ very close|❗ close)!/);
    hooks.fetchEntry = async () => second;
    const right = await run(h.channelId, 'heat'); expect(right.edits[0].content).toBe('**Sam G** guessed **heat** — ✅ correct!');
    expect(edits[0]!.payload.content).toContain('**Sam G** got it!');
    await Bun.sleep(150);
    expect(right.followUps).toHaveLength(1); expect(ids(right.followUps[0])).toEqual(ROUND_BUTTONS); // the next round is posted through this command's follow-up
  });
  test('with no round going it says how to start one', async () => {
    expect((await run(chan(), 'anything')).edits[0].content).toContain('`/community guess`');
  });
  test('is refused for a server round, which is played by typing in the channel', async () => {
    const c = chan(); activeGames.set(c, { guildId: 'g1', channelId: c, type: 'movie', media, hintOrder: [0], hintsUsed: 0, lastHintAt: 0, voteskips: new Set(), messageId: 'm', startedAt: Date.now(), answered: false });
    const out = await run(c, 'heat'); expect(out.replies[0].content).toContain('typing your answer in the chat'); expect(activeGames.has(c)).toBe(true);
  });
  test('is registered as a slash command that works everywhere', () => {
    const j = guessCommand.data.toJSON() as any;
    expect(j.name).toBe('guess'); expect(j.options[0]).toMatchObject({ name: 'answer', required: true, max_length: 100 });
    expect(j.integration_types).toEqual([0, 1]); expect(j.contexts).toEqual([0, 1, 2]);
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
      expect(ids(out.edits[0])).toEqual(ROUND_BUTTONS);
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
  test('a game already going (or about to start its next round) in the channel is refused politely', async () => {
    stub(); Bun.env.TMDB_API_KEY = 'test'; const { h } = host(); await startInteractiveRound(h, 'movie');
    const replies: any[] = [];
    await guess.run({ context: InteractionContextType.PrivateChannel, channelId: h.channelId, user: { id: 'x' }, client: {}, options: { getString: () => 'movie' }, reply: async (p: any) => { replies.push(p); } } as any);
    delete Bun.env.TMDB_API_KEY; expect(replies[0].content).toContain('already a round going');
  });
});

describe('every reply from the guessing game is public', () => {
  test('nothing in the game\'s source asks for a private (ephemeral) reply', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(import.meta.dir, '..');
    const files = ['src/features/mediaguess/index.ts', 'src/commands/fun/guess.ts', 'src/utils/mediagame.ts',
      ...readdirSync(path.join(root, 'src/legacy/mediaguess')).map(f => `src/legacy/mediaguess/${f}`)];
    for (const f of files) expect(readFileSync(path.join(root, f), 'utf8'), f).not.toMatch(/Ephemeral|ephemeral/);
  });

  test('a whole game — start, guesses, hints, skip, stop, and the refusals — never sends a private reply', async () => {
    const PRIVATE = 64; // MessageFlags.Ephemeral
    const isPrivate = (p: any) => !!p && typeof p === 'object' && (Number(p.flags ?? 0) & PRIVATE) !== 0;
    hooks.nextDelayMs = 20; stub(); Bun.env.TMDB_API_KEY = 'test';
    const sent: any[] = [];
    const record = (fn?: (p: any) => any) => async (p: any) => { sent.push(p); return fn ? fn(p) : {}; };
    const fake = (extra: Record<string, unknown>) => ({ client: {}, user: { id: 'u1', username: 'sam', globalName: 'Sam' }, member: null, guildId: null, message: { content: '' }, webhook: { editMessage: async () => ({}) },
      reply: record(), deferReply: record(), editReply: record(), followUp: record(() => ({ id: 'f1' })), deferUpdate: async () => {}, update: record(), ...extra }) as any;
    const dispatch = (i: any) => mediaguessModule.handlers.interactionCreate!({ data: [i] } as any);

    // Start a game the way the command does, then play it.
    const ch = chan();
    await guess.run(fake({ context: InteractionContextType.PrivateChannel, channelId: ch, options: { getString: () => 'movie' }, editReply: record(() => ({ id: 'round-msg' })) }));
    await guessCommand.run!(fake({ channelId: ch, options: { getString: () => 'Casablanca' } }));
    await guessCommand.run!(fake({ channelId: ch, options: { getString: () => 'Hea' } }));
    await dispatch(fake({ isModalSubmit: () => false, isButton: () => true, customId: 'mg_hint', channelId: ch }));
    await dispatch(fake({ isModalSubmit: () => false, isButton: () => true, customId: 'mg_voteskip', channelId: ch, user: { id: 'intruder', username: 'x' } })); // not the starter
    await dispatch(fake({ isModalSubmit: () => true, customId: GUESS_MODAL, channelId: ch, fields: { getTextInputValue: () => 'Casablanca' } }));
    await guessCommand.run!(fake({ channelId: ch, options: { getString: () => 'heat' } })); // a right answer
    await dispatch(fake({ isModalSubmit: () => false, isButton: () => true, customId: 'mg_stop:movie', channelId: ch, context: InteractionContextType.PrivateChannel })); // stop between rounds
    await dispatch(fake({ isModalSubmit: () => false, isButton: () => true, customId: 'mg_stop:movie', channelId: chan(), context: InteractionContextType.PrivateChannel })); // nothing to stop
    await dispatch(fake({ isModalSubmit: () => false, isButton: () => true, customId: GUESS_BUTTON, channelId: chan() })); // no round to guess in
    await guessCommand.run!(fake({ channelId: chan(), options: { getString: () => 'anything' } })); // no round
    await guess.run(fake({ context: InteractionContextType.PrivateChannel, channelId: ch, options: { getString: () => 'movie' } })); // a game is already going
    delete Bun.env.TMDB_API_KEY;
    await guess.run(fake({ context: InteractionContextType.PrivateChannel, channelId: chan(), options: { getString: () => 'movie' } })); // no API key
    expect(sent.length).toBeGreaterThan(10);
    const privateOnes = sent.filter(isPrivate);
    expect(privateOnes, `these replies were private: ${JSON.stringify(privateOnes).slice(0, 300)}`).toEqual([]);
  });
});

describe('skipping in a group-chat game (the engine)', () => {
  test('the starter skips alone; anyone else needs two votes; a starter\'s vote is never needed', async () => {
    hooks.nextDelayMs = 25; stub(); const a = host(chan(), 'starter'); await startInteractiveRound(a.h, 'movie');
    expect(await castVoteSkip(a.h.channelId, 'friend-1', a.h.client)).toEqual({ content: '🗳️ Skip vote recorded: **1/2**. Need **1** more person to skip — or the person who started the game can skip on their own.' });
    expect(activeGames.has(a.h.channelId)).toBe(true);
    expect(await castVoteSkip(a.h.channelId, 'starter', a.h.client)).toEqual({ content: '⏭️ Round skipped.' }); // the starter needs no one
    expect(activeGames.has(a.h.channelId)).toBe(false); expect(a.edits[0]!.payload.content).toContain('Skipped');
  });
  test('two different people skip it, and a vote from the last round does not carry into the next', async () => {
    hooks.nextDelayMs = 25; hooks.fetchEntry = async () => second; stub(); const a = host(chan(), 'starter'); await startInteractiveRound(a.h, 'movie');
    hooks.fetchEntry = async () => second;
    const b = host(a.h.channelId);
    await castVoteSkip(a.h.channelId, 'friend-1', a.h.client, b.h);
    expect((await castVoteSkip(a.h.channelId, 'friend-2', a.h.client, b.h)).content).toBe('⏭️ **2/2** skip votes — skipping this round!');
    await Bun.sleep(120);
    expect(activeGames.get(a.h.channelId)!.media.title).toBe('Ronin');
    expect((await castVoteSkip(a.h.channelId, 'friend-1', a.h.client, b.h)).content).toContain('**1/2**'); // friend-1's earlier vote was for the last round
  });
  test('a server round and a DM round keep their own rules', async () => {
    const dmState = { guildId: null, channelId: chan(), type: 'movie' as const, media, hintOrder: [0], hintsUsed: 0, lastHintAt: 0, voteskips: new Set<string>(), messageId: 'm', startedAt: Date.now(), answered: false };
    activeGames.set(dmState.channelId, dmState);
    const f = { client: { channels: { fetch: async () => ({ isSendable: () => true, send: async () => ({ id: 'x' }), messages: { fetch: async () => ({ delete: async () => {} }) } }) } } as any };
    expect((await castVoteSkip(dmState.channelId, 'anyone', f.client)).content).toBe('⏭️ Round skipped.'); // a DM round: skipped on the spot
    cancelPendingNext(dmState.channelId);
    const guildState = { ...dmState, guildId: 'g1', channelId: chan(), answered: false, voteskips: new Set<string>(), startedAt: Date.now() };
    activeGames.set(guildState.channelId, guildState);
    expect((await castVoteSkip(guildState.channelId, 'anyone', f.client)).content).toContain('isn\'t available yet'); // a server round: vote, after the delay
  });
});

describe('/voteskip follows the same rules', () => {
  const voteskip = async () => (await import('../src/legacy/mediaguess/voteskip')).default;
  const run = async (channelId: string, userId: string) => {
    const out = { deferred: [] as any[], edits: [] as any[], followUps: [] as any[] };
    const i: any = { channelId, user: { id: userId, username: 'u', globalName: 'U' }, client: {}, member: null, deferReply: async (p: any) => { out.deferred.push(p); }, editReply: async (p: any) => { out.edits.push(p); },
      followUp: async (p: any) => { out.followUps.push(p); return { id: 'f1' }; }, webhook: { editMessage: async () => ({}) } };
    await (await voteskip()).run!(i);
    return out;
  };
  test('a friend\'s single vote is recorded; two friends skip; the starter skips alone — all publicly, and the game goes on', async () => {
    hooks.nextDelayMs = 25; stub(); const a = host(chan(), 'starter'); await startInteractiveRound(a.h, 'movie');
    const one = await run(a.h.channelId, 'friend-1'); expect(one.deferred[0]?.flags).toBeFalsy(); expect(one.edits[0].content).toContain('**1/2**');
    hooks.fetchEntry = async () => second;
    const two = await run(a.h.channelId, 'friend-2'); expect(two.edits[0].content).toContain('**2/2**');
    await Bun.sleep(120); expect(two.followUps).toHaveLength(1); expect(activeGames.get(a.h.channelId)!.media.title).toBe('Ronin');
    const owner = await run(a.h.channelId, 'starter'); expect(owner.edits[0].content).toBe('⏭️ Round skipped.');
  });
});

describe('guesses are shown publicly, so they are made safe', () => {
  test('a guess cannot carry a link, a mention or a ping', async () => {
    const { guessLine } = await import('../src/features/mediaguess');
    const line = guessLine('Sam', '[free nitro](https://evil.example) <@123456789> @everyone', 'wrong');
    expect(line).not.toMatch(/(?<!\\)\[free nitro\]\(/); expect(line).not.toContain('<@'); expect(line).not.toContain('@everyone');
    expect(guessLine('Sam', 'Heat', 'correct')).toBe('**Sam** guessed **Heat** — ✅ correct!');
    expect(guessLine('Sam', 'x', 'no-round')).toContain('/community guess');
  });
});
