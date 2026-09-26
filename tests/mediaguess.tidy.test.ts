import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import {
  GUESS_INPUT, GUESS_MODAL, activeGames, cancelPendingNext, castVoteSkip, hooks, startInteractiveRound, stopGame, submitGuess, tidyAtEnd,
  type InteractiveHost, type MediaEntry, type RoundEdit, type RoundPayload,
} from '../src/utils/mediagame';
import mediaguessModule from '../src/features/mediaguess';
import guessCommand from '../src/commands/fun/guess';
import hintCommand from '../src/legacy/mediaguess/hint';
import voteskipCommand from '../src/legacy/mediaguess/voteskip';

beforeAll(async () => { await initDb(); });

const media: MediaEntry = { id: 7, type: 'movie', title: 'Heat', year: 1995, genre: 'Crime', director: 'Michael Mann', cast: 'Al Pacino', synopsis: 'A heist crew.', tagline: null, stills: ['https://img/1.jpg', 'https://img/2.jpg'] };
const second: MediaEntry = { ...media, id: 8, title: 'Ronin', stills: ['https://img/3.jpg'] };
let n = 0;
const made: string[] = [];
const chan = () => { const c = `tidy-chat-${++n}`; made.push(c); return c; };
afterEach(() => {
  hooks.fetchEntry = undefined; hooks.roundMs = undefined; hooks.nextDelayMs = undefined;
  for (const c of made) { cancelPendingNext(c); const s = activeGames.get(c); if (s?.interactive) clearTimeout(s.interactive.timer); activeGames.delete(c); }
  made.length = 0;
});

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
const via = (h: InteractiveHost, key: string): InteractiveHost => ({ ...h, via: key });
const settle = () => Bun.sleep(15);
/** Stand-ins for the messages people post into a round; `gone` records the order they were removed in. */
const trail = () => { const gone: string[] = []; return { gone, msg: (k: string) => async () => { gone.push(k); } }; };

describe('tidying up after a round', () => {
  test('nothing is removed while the round is on; a correct answer takes every guess, hint and vote away and leaves the result', async () => {
    stub(); const { h, edits } = host(); await startInteractiveRound(h, 'movie');
    const t = trail();
    tidyAtEnd(h.channelId, 'a', t.msg('a')); tidyAtEnd(h.channelId, 'b', t.msg('b')); tidyAtEnd(h.channelId, 'c', t.msg('c'));
    await settle(); expect(t.gone).toEqual([]);
    await submitGuess(h.channelId, 'heat', { id: 'u1', name: 'Sam' }, h.client);
    await settle(); expect(t.gone.sort()).toEqual(['a', 'b', 'c']);
    expect(edits[0]!.payload.content).toContain('got it'); // the round's own message is the record
  });

  test('a skip, a timeout and a stop tidy up the same way', async () => {
    stub(); const t = trail();
    const a = host(chan(), 'starter'); await startInteractiveRound(a.h, 'movie'); tidyAtEnd(a.h.channelId, 'skip', t.msg('skip'));
    await castVoteSkip(a.h.channelId, 'starter', a.h.client);
    hooks.roundMs = 20; const b = host(); await startInteractiveRound(b.h, 'movie'); tidyAtEnd(b.h.channelId, 'timeout', t.msg('timeout'));
    await Bun.sleep(80);
    hooks.roundMs = undefined;
    const c = host(); await startInteractiveRound(c.h, 'movie'); tidyAtEnd(c.h.channelId, 'stop', t.msg('stop'));
    await stopGame(c.h.channelId, c.h.client);
    await settle(); expect(t.gone.sort()).toEqual(['skip', 'stop', 'timeout']);
  });

  test('the reply of the interaction that posts the next round stays until that round is up — then it goes too', async () => {
    hooks.nextDelayMs = 30; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    const b = host(a.h.channelId, 'starter'); hooks.fetchEntry = async () => second;
    const t = trail();
    tidyAtEnd(a.h.channelId, 'other', t.msg('other'));
    tidyAtEnd(a.h.channelId, 'winner', async () => { t.gone.push(`winner (round 2 posted: ${b.posts.length === 1})`); });
    await submitGuess(a.h.channelId, 'heat', { id: 'u1', name: 'Sam' }, a.h.client, via(b.h, 'winner'));
    await settle(); expect(t.gone).toEqual(['other']); // the winner's reply has to outlive the wait, or it could not post round 2
    await Bun.sleep(120);
    expect(b.posts).toHaveLength(1); expect(t.gone).toEqual(['other', 'winner (round 2 posted: true)']);
  });

  test('if the game is stopped in the gap before the next round, the held reply goes as well and nothing starts', async () => {
    hooks.nextDelayMs = 200; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    const b = host(a.h.channelId); const t = trail();
    tidyAtEnd(a.h.channelId, 'winner', t.msg('winner'));
    await submitGuess(a.h.channelId, 'heat', { id: 'u1', name: 'Sam' }, a.h.client, via(b.h, 'winner'));
    await settle(); expect(t.gone).toEqual([]);
    expect(await stopGame(a.h.channelId, a.h.client)).toBe('pending');
    await settle(); expect(t.gone).toEqual(['winner']); expect(b.posts).toHaveLength(0);
  });

  test('and if the next round cannot be loaded, it is not left behind either', async () => {
    hooks.nextDelayMs = 20; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    hooks.fetchEntry = async () => null; const t = trail();
    tidyAtEnd(a.h.channelId, 'winner', t.msg('winner'));
    await submitGuess(a.h.channelId, 'heat', { id: 'u1', name: 'Sam' }, a.h.client, via(host(a.h.channelId).h, 'winner'));
    await Bun.sleep(120); expect(t.gone).toEqual(['winner']);
  });

  test('each round has its own trail: what was tidied is not removed twice, and the next round\'s messages go when it ends', async () => {
    hooks.nextDelayMs = 20; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    const b = host(a.h.channelId, 'starter'); const t = trail(); hooks.fetchEntry = async () => second;
    tidyAtEnd(a.h.channelId, 'r1', t.msg('r1'));
    await submitGuess(a.h.channelId, 'heat', { id: 'u1', name: 'Sam' }, a.h.client, via(b.h, 'k'));
    await Bun.sleep(120); expect(t.gone).toEqual(['r1']);
    tidyAtEnd(a.h.channelId, 'r2', t.msg('r2')); // now in round 2
    await castVoteSkip(a.h.channelId, 'starter', a.h.client);
    await settle(); expect(t.gone).toEqual(['r1', 'r2']);
  });

  test('a message that cannot be removed (already gone, or its 15 minutes are up) does not hold anything else up', async () => {
    stub(); const { h } = host(); await startInteractiveRound(h, 'movie'); const t = trail();
    tidyAtEnd(h.channelId, 'bad-sync', () => { throw new Error('Unknown Message'); });
    tidyAtEnd(h.channelId, 'bad-async', () => Promise.reject(new Error('Unknown Webhook')));
    tidyAtEnd(h.channelId, 'ok', t.msg('ok'));
    await submitGuess(h.channelId, 'heat', { id: 'u1', name: 'Sam' }, h.client);
    await settle(); expect(t.gone).toEqual(['ok']);
  });

  test('where there is no group-chat round nothing is kept for later', async () => {
    const t = trail();
    tidyAtEnd(chan(), 'nobody', t.msg('nobody')); // no round at all
    const dm = chan(); activeGames.set(dm, { guildId: null, channelId: dm, type: 'movie', media, hintOrder: [0], hintsUsed: 0, lastHintAt: 0, voteskips: new Set(), messageId: 'm', startedAt: Date.now(), answered: false });
    tidyAtEnd(dm, 'dm', t.msg('dm')); // a DM round is played in the chat itself
    expect(activeGames.get(dm)!.interactive).toBeUndefined();
    await settle(); expect(t.gone).toEqual([]);
  });
});

describe('what the buttons and commands leave in the chat', () => {
  /** A fake interaction that records when its reply is deleted, and what it has followed up with. */
  const fake = (id: string, extra: Record<string, unknown> = {}) => {
    const log = { deleted: 0, edits: [] as any[], followUps: [] as any[] };
    const i: any = {
      id, client: {}, user: { id: `user-${id}`, username: 'sam', globalName: 'Sam' }, member: null, guildId: null, message: { content: '' },
      deferReply: async () => {}, editReply: async (p: any) => { log.edits.push(p); return {}; }, deleteReply: async () => { log.deleted++; },
      followUp: async (p: any) => { log.followUps.push(p); return { id: `f-${id}-${log.followUps.length}` }; }, webhook: { editMessage: async () => ({}) },
      deferUpdate: async () => {}, reply: async () => ({}), update: async () => ({}),
      ...extra,
    };
    return { i, log };
  };
  const dispatch = (i: any) => mediaguessModule.handlers.interactionCreate!({ data: [i] } as any);
  const modalOf = (id: string, channelId: string, text: string) => fake(id, { isModalSubmit: () => true, customId: GUESS_MODAL, channelId, fields: { getTextInputValue: (k: string) => (k === GUESS_INPUT ? text : '') } });
  const buttonOf = (id: string, channelId: string, customId: string) => fake(id, { isModalSubmit: () => false, isButton: () => true, customId, channelId });

  test('wrong guesses, a hint and a skip vote are all gone once someone gets it right — the winner\'s reply goes when the next round is up', async () => {
    hooks.nextDelayMs = 40; stub(); const { h } = host(); await startInteractiveRound(h, 'movie'); hooks.fetchEntry = async () => second;
    const wrong1 = modalOf('w1', h.channelId, 'Casablanca'), wrong2 = modalOf('w2', h.channelId, 'Alien'), hint = buttonOf('h1', h.channelId, 'mg_hint'), vote = buttonOf('v1', h.channelId, 'mg_voteskip');
    await dispatch(wrong1.i); await dispatch(wrong2.i); await dispatch(hint.i); await dispatch(vote.i);
    expect([wrong1, wrong2, hint, vote].map(x => x.log.deleted)).toEqual([0, 0, 0, 0]); // nothing is removed mid-round
    const right = modalOf('r1', h.channelId, 'heat'); await dispatch(right.i);
    await Bun.sleep(15);
    expect([wrong1, wrong2, hint, vote].map(x => x.log.deleted)).toEqual([1, 1, 1, 1]);
    expect(right.log.deleted).toBe(0); expect(right.log.followUps).toHaveLength(0); // still waiting to post round 2 through this reply
    await Bun.sleep(150);
    expect(right.log.followUps).toHaveLength(1); expect(right.log.deleted).toBe(1);
  });

  test('/guess, /voteskip and /hint replies are tidied like the buttons\' are', async () => {
    stub(); const { h } = host(undefined, 'starter'); await startInteractiveRound(h, 'movie');
    const g = fake('cg', { channelId: h.channelId, options: { getString: () => 'Casablanca' } }); await guessCommand.run!(g.i);
    const hint = fake('ch', { channelId: h.channelId }); await hintCommand.run!(hint.i);
    const vote = fake('cv', { channelId: h.channelId, user: { id: 'friend', username: 'f' } }); await voteskipCommand.run!(vote.i);
    expect([g, hint, vote].map(x => x.log.deleted)).toEqual([0, 0, 0]);
    await castVoteSkip(h.channelId, 'starter', h.client); // the starter ends the round
    await Bun.sleep(15);
    expect([g, hint, vote].map(x => x.log.deleted)).toEqual([1, 1, 1]);
  });

  test('an answer with no game running is not registered — there is nothing to wait for', async () => {
    const late = modalOf('l1', chan(), 'heat'); await dispatch(late.i);
    expect(late.log.edits[0].content).toContain('no active guessing game'); expect(late.log.deleted).toBe(0);
  });

  test('a stopped game clears its guesses as well', async () => {
    stub(); const { h } = host(); await startInteractiveRound(h, 'movie');
    const w = modalOf('w9', h.channelId, 'Casablanca'); await dispatch(w.i);
    await dispatch(buttonOf('s1', h.channelId, 'mg_stop:movie').i);
    await Bun.sleep(15); expect(w.log.deleted).toBe(1);
  });

  test('a reply that was tidied away before its handler answered is not an error', async () => {
    stub(); const { h } = host(); await startInteractiveRound(h, 'movie');
    let release: () => void = () => {};
    const slow = modalOf('slow', h.channelId, 'Casablanca');
    slow.i.deferReply = async () => { await new Promise<void>(r => { release = r; }); }; // still acknowledging while the round ends
    slow.i.editReply = async () => { throw new Error('Unknown Webhook'); }; // and by then the reply is gone
    const pending = dispatch(slow.i);
    await Bun.sleep(5); await castVoteSkip(h.channelId, 'starter', h.client); release();
    await expect(pending).resolves.toBeUndefined();
  });
});
