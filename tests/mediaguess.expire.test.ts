import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import {
  RESULT_LIFETIME_MS, activeGames, cancelPendingNext, castVoteSkip, deleteLater, hooks, resolveGame, startInteractiveRound, stopGame, submitGuess,
  type GameState, type InteractiveHost, type MediaEntry, type RoundEdit, type RoundPayload,
} from '../src/utils/mediagame';
import mediaguessModule from '../src/features/mediaguess';

beforeAll(async () => { await initDb(); });

const media: MediaEntry = { id: 7, type: 'movie', title: 'Heat', year: 1995, genre: 'Crime', director: 'Michael Mann', cast: 'Al Pacino', synopsis: 'A heist crew.', tagline: null, stills: ['https://img/1.jpg'] };
let n = 0;
const made: string[] = [];
const chan = () => { const c = `expire-chat-${++n}`; made.push(c); return c; };
afterEach(() => {
  hooks.fetchEntry = undefined; hooks.roundMs = undefined; hooks.nextDelayMs = undefined; hooks.resultMs = undefined;
  for (const c of made) { cancelPendingNext(c); const s = activeGames.get(c); if (s?.interactive) clearTimeout(s.interactive.timer); activeGames.delete(c); }
  made.length = 0;
});
const stub = () => { hooks.fetchEntry = async () => media; };

/** A group-chat host: records what it posts, edits and deletes. `removeFails` makes its deletions fail (its interaction's 15 minutes are up). */
function host(o: { removeFails?: boolean; noRemove?: boolean } = {}, channelId = chan(), userId = 'starter') {
  const posts: RoundPayload[] = [], edits: { id: string; payload: RoundEdit }[] = [], removed: string[] = [];
  const h: InteractiveHost = {
    client: {} as never, channelId, userId,
    send: async p => { posts.push(p); return { id: `msg-${posts.length}` }; },
    edit: async (id, payload) => { edits.push({ id, payload }); },
    ...(o.noRemove ? {} : { remove: async id => { if (o.removeFails) throw new Error('Invalid Webhook Token'); removed.push(id); } }),
  };
  return { h, posts, edits, removed };
}

describe('a finished group-chat round is deleted after a few minutes', () => {
  test('the wait is five minutes', () => {
    expect(RESULT_LIFETIME_MS).toBe(5 * 60_000);
  });

  test('the result stays for the wait, then the round\'s message is deleted once', async () => {
    hooks.resultMs = 60; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    await submitGuess(a.h.channelId, 'heat', { id: 'u1', name: 'Sam' }, a.h.client);
    expect(a.edits[0]!.payload.content).toContain('got it');
    await Bun.sleep(20); expect(a.removed).toEqual([]); // still on show
    await Bun.sleep(120); expect(a.removed).toEqual(['msg-1']);
  });

  test('a skip, a stop and a timeout clear up the same way', async () => {
    hooks.resultMs = 30; stub();
    const skip = host({}, chan(), 'starter'); await startInteractiveRound(skip.h, 'movie'); await castVoteSkip(skip.h.channelId, 'starter', skip.h.client);
    const stop = host(); await startInteractiveRound(stop.h, 'movie'); await stopGame(stop.h.channelId, stop.h.client);
    hooks.roundMs = 20; const late = host(); await startInteractiveRound(late.h, 'movie');
    await Bun.sleep(150);
    expect([skip.removed, stop.removed, late.removed]).toEqual([['msg-1'], ['msg-1'], ['msg-1']]);
  });

  test('the round in play is never deleted, only a finished one', async () => {
    hooks.resultMs = 20; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    await Bun.sleep(100); expect(a.removed).toEqual([]); expect(activeGames.has(a.h.channelId)).toBe(true);
  });

  test('when the round\'s own interaction has expired, the one that ended it deletes the message instead', async () => {
    hooks.resultMs = 30; stub(); const starter = host({ removeFails: true }); await startInteractiveRound(starter.h, 'movie');
    const finisher = host({}, starter.h.channelId);
    await submitGuess(starter.h.channelId, 'heat', { id: 'u1', name: 'Sam' }, starter.h.client, finisher.h);
    await Bun.sleep(150); expect(starter.removed).toEqual([]); expect(finisher.removed).toEqual(['msg-1']);
  });

  test('a host that cannot delete, or a failure on both sides, is left quietly', async () => {
    hooks.resultMs = 20; stub();
    const none = host({ noRemove: true }); await startInteractiveRound(none.h, 'movie'); await castVoteSkip(none.h.channelId, 'starter', none.h.client);
    const both = host({ removeFails: true }); await startInteractiveRound(both.h, 'movie');
    await submitGuess(both.h.channelId, 'heat', { id: 'u1', name: 'Sam' }, both.h.client, host({ removeFails: true }, both.h.channelId).h);
    await Bun.sleep(100); // nothing thrown, nothing left running
    expect(none.removed).toEqual([]); expect(both.removed).toEqual([]);
  });

  test('the next round\'s result goes on its own clock', async () => {
    hooks.resultMs = 40; hooks.nextDelayMs = 10; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    const next = host({}, a.h.channelId, 'starter');
    await submitGuess(a.h.channelId, 'heat', { id: 'u1', name: 'Sam' }, a.h.client, next.h);
    await Bun.sleep(30); expect(next.posts).toHaveLength(1); expect(a.removed).toEqual([]); // round 2 is up; round 1's result has not run out yet
    await Bun.sleep(100); expect(a.removed).toEqual(['msg-1']);
    await castVoteSkip(a.h.channelId, 'starter', a.h.client);
    await Bun.sleep(120); expect(next.removed).toEqual(['msg-1']);
  });
});

describe('a finished DM round is deleted after a few minutes', () => {
  /** A DM channel whose messages know when they have been deleted. */
  function dmClient() {
    const sent: { content?: string; deleted: boolean }[] = [];
    const channel = {
      isSendable: () => true,
      send: async (p: any) => { const m = { content: p.content, deleted: false, id: `m${sent.length + 1}`, delete: async () => { m.deleted = true; } }; sent.push(m); return m; },
      messages: { fetch: async () => ({ delete: async () => {} }) },
    };
    return { client: { channels: { fetch: async () => channel }, user: { id: 'bot1' } } as any, sent };
  }
  const dmRound = (guildId: string | null = null): GameState => {
    const state: GameState = { guildId, channelId: chan(), type: 'movie', media, hintOrder: [0], hintsUsed: 0, lastHintAt: 0, voteskips: new Set(), messageId: 'round-msg', startedAt: Date.now(), answered: false };
    activeGames.set(state.channelId, state); return state;
  };

  test('the result (and the Stop game one) goes after the wait', async () => {
    hooks.resultMs = 40; hooks.nextDelayMs = 500; const c = dmClient(), s = dmRound();
    await resolveGame(s, c.client, { id: 'u1', name: 'Sam' }, 'correct');
    expect(c.sent).toHaveLength(1); expect(c.sent[0]!.deleted).toBe(false);
    await Bun.sleep(150); expect(c.sent[0]!.deleted).toBe(true);
    const t = dmRound(); await stopGame(t.channelId, c.client);
    await Bun.sleep(150); expect(c.sent[1]!.content).toContain('Game stopped'); expect(c.sent[1]!.deleted).toBe(true);
  });

  test('a server round\'s results are left where they are', async () => {
    hooks.resultMs = 20; const c = dmClient(), s = dmRound('guild-1');
    await resolveGame(s, c.client, { id: 'u1', name: 'Sam' }, 'skip');
    await Bun.sleep(100); expect(c.sent[0]!.deleted).toBe(false);
  });
});

describe('the note that says the game was stopped', () => {
  test('goes too, through the interaction that posted it', async () => {
    hooks.resultMs = 30; stub(); const a = host(); await startInteractiveRound(a.h, 'movie');
    const removed: string[] = [];
    const btn: any = {
      isModalSubmit: () => false, isButton: () => true, customId: 'mg_stop:movie', channelId: a.h.channelId, id: 'stop-1', client: {}, guildId: null, message: { content: '' },
      user: { id: 'u1', username: 'sam', globalName: 'Sam' }, member: null,
      deferUpdate: async () => {}, editReply: async () => ({}), followUp: async () => ({ id: 'note-1' }),
      webhook: { editMessage: async () => ({}), deleteMessage: async (id: string) => { removed.push(id); } },
    };
    await mediaguessModule.handlers.interactionCreate!({ data: [btn] } as any);
    await Bun.sleep(10); expect(removed).toEqual([]);
    await Bun.sleep(150); expect(removed).toEqual(['note-1']);
  });

  test('deleteLater never throws, whatever the deletion does', async () => {
    hooks.resultMs = 5;
    deleteLater(() => { throw new Error('sync'); });
    deleteLater(() => Promise.reject(new Error('async')));
    await Bun.sleep(40); // reaching here without an unhandled rejection is the assertion
    expect(true).toBe(true);
  });
});
