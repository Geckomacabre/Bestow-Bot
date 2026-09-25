import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import { MAX_REPLIES, footerFor, getSession, handleReplyButton, handleReplyModal, render, replyLabel, resetSessions, sessionCount, slim, startConversation, usageLines } from '../src/ai/conversation';
import { checkLimit, resetLimits } from '../src/ai/limits';
import { extendPremium, resetPremiumCache } from '../src/premium/index';
import { LlmUnavailable, type ChatMessage } from '../src/services/llm';

beforeAll(async () => { await initDb(); });
beforeEach(() => { resetSessions(); resetLimits(); resetPremiumCache(); for (const k of ['PREMIUM_SKU_ID', 'AI_USER_LIMIT', 'AI_DAILY_LIMIT', 'AI_DISABLED', 'LLM_LABEL', 'OWNER_IDS']) delete Bun.env[k]; Bun.env.LLM_BASE_URL = 'http://x/v1'; Bun.env.LLM_MODEL = 'gpt-test'; });

let n = 0;
const uid = () => `conv-user-${++n}`;
const json = (payload: any) => JSON.stringify(payload.components.map((c: any) => c.toJSON()));
const text = (payload: any) => json(payload);
const sidOf = (payload: any) => /ai:reply:([0-9a-f]+)/.exec(json(payload))?.[1];

const start = (userId: string, o: Partial<Parameters<typeof startConversation>[1]> = {}) =>
  startConversation(userId, { title: 'why is the sky blue', system: 'SYS', user: { role: 'user', content: 'why is the sky blue' }, answer: 'Rayleigh scattering.', kind: 'chat', premium: false, ...o });

function fakeButton(userId: string, sid: string) {
  const out: { modal?: any; replies: any[] } = { replies: [] };
  const i: any = { customId: `ai:reply:${sid}`, user: { id: userId }, showModal: async (m: any) => { out.modal = m.toJSON(); }, reply: async (p: any) => { out.replies.push(p); } };
  return { i, out };
}

function fakeModal(userId: string, sid: string, value: string, o: { fromMessage?: boolean; ents?: any[] } = {}) {
  const log = { updates: [] as any[], followUps: [] as any[], edits: [] as any[], replies: [] as any[], deferred: 0 };
  const i: any = {
    customId: `ai:modal:${sid}`, user: { id: userId }, entitlements: o.ents ? new Map(o.ents.map((e, k) => [String(k), e])) : undefined,
    fields: { getTextInputValue: () => value }, isFromMessage: () => o.fromMessage ?? true,
    update: async (p: any) => { log.updates.push(p); }, followUp: async (p: any) => { log.followUps.push(p); return {}; }, editReply: async (p: any) => { log.edits.push(p); return {}; },
    reply: async (p: any) => { log.replies.push(p); }, deferReply: async () => { log.deferred++; },
  };
  return { i, log };
}

const chatStub = (answers: (string | Error)[]) => {
  const calls: { messages: ChatMessage[]; kind?: string }[] = [];
  return { calls, deps: { chat: async (messages: ChatMessage[], opts?: any) => { calls.push({ messages, kind: opts?.kind }); const a = answers.shift() ?? 'ok'; if (a instanceof Error) throw a; return a; } } };
};

describe('answer card', () => {
  test('title, answer, footer and a Reply 1/3 button', () => {
    Bun.env.LLM_LABEL = 'OpenAI GPT-Test';
    const p = start(uid());
    const t = text(p);
    expect(t).toContain('## why is the sky blue'); expect(t).toContain('Rayleigh scattering.'); expect(t).toContain('OpenAI GPT-Test'); expect(t).toContain('Results are AI generated');
    expect(t).toContain('Reply 1/3'); expect(sidOf(p)).toMatch(/^[0-9a-f]{12}$/);
    expect(p.flags & 32768).toBeTruthy(); expect(p.allowedMentions).toEqual({ parse: [] }); // Components V2, and it can never ping anyone
  });
  test('the label falls back to the model id; usage shows n/20 hourly after a request is counted', () => {
    const u = uid();
    checkLimit(u, Date.now(), false);
    expect(footerFor(u, 'chat', false)).toBe('gpt-test • 1/20 hourly • Results are AI generated');
    checkLimit(u, Date.now(), false); expect(footerFor(u, 'chat', false)).toContain('2/20 hourly');
  });
  test('the Premium nudge only appears once premium can be bought; premium users see "Premium" not a counter', () => {
    const u = uid();
    expect(footerFor(u, 'chat', false)).not.toContain('Premium');
    Bun.env.PREMIUM_SKU_ID = '123';
    expect(footerFor(u, 'chat', false)).toContain('Premium users get unlimited requests');
    expect(footerFor(u, 'chat', true)).toBe('gpt-test • Premium • Results are AI generated');
  });
  test('no button when the reply allowance is used up or the session is gone; long text is trimmed', () => {
    const v = { title: 't', answer: 'a'.repeat(9000), footer: 'f' };
    expect(json(render(v, 'abc', 0))).toContain('ai:reply:abc'); expect(json(render(v, 'abc', MAX_REPLIES))).not.toContain('ai:reply'); expect(json(render(v, null, 0))).not.toContain('ai:reply');
    expect(json(render(v, 'abc', 0)).length).toBeLessThan(5000); expect(json(render({ ...v, title: 'x'.repeat(500) }, null, 0))).toContain('…');
    expect([0, 1, 2].map(replyLabel)).toEqual(['Reply 1/3', 'Reply 2/3', 'Reply 3/3']);
  });
  test('sessions expire, and memory is bounded', () => {
    const p = start(uid()); const sid = sidOf(p)!; expect(getSession(sid)).toBeTruthy();
    getSession(sid)!.expires = Date.now() - 1; expect(getSession(sid)).toBeUndefined();
    for (let i = 0; i < 2100; i++) start(uid()); expect(sessionCount()).toBeLessThanOrEqual(2000);
  });
  test('huge images are not carried into follow-up turns; small ones are', () => {
    const big: ChatMessage = { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(2_000_000)}` } }] };
    const small: ChatMessage = { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] };
    expect(JSON.stringify(slim(big))).not.toContain('AAAAAAAA'); expect(JSON.stringify(slim(big))).toContain('large image'); expect(slim(small)).toEqual(small); expect(slim({ role: 'user', content: 'hi' })).toEqual({ role: 'user', content: 'hi' });
  });
});

describe('Reply button', () => {
  test('the owner gets an input box; anyone else is told it isn\'t theirs; expired conversations say so', async () => {
    const owner = uid(); const sid = sidOf(start(owner))!;
    const a = fakeButton(owner, sid); await handleReplyButton(a.i);
    expect(a.out.modal.custom_id).toBe(`ai:modal:${sid}`); expect(a.out.modal.title).toBe('Reply (1/3)'); expect(JSON.stringify(a.out.modal)).toContain('"max_length":1500');
    const b = fakeButton('someone-else', sid); await handleReplyButton(b.i);
    expect(b.out.modal).toBeUndefined(); expect(b.out.replies[0].content).toContain('Only <@' + owner + '>'); expect(b.out.replies[0].flags & 64).toBeTruthy();
    getSession(sid)!.expires = 0; const c = fakeButton(owner, sid); await handleReplyButton(c.i);
    expect(c.out.replies[0].content).toContain('expired'); expect(fakeButton(owner, 'nope').i.customId).toBe('ai:reply:nope');
    const d = fakeButton(owner, 'nope'); await handleReplyButton(d.i); expect(d.out.replies[0].content).toContain('expired');
  });
});

describe('continuing the conversation', () => {
  test('a reply takes the old button off, asks the model with the WHOLE conversation, and posts the next turn as Reply 2/3', async () => {
    const owner = uid(); const sid = sidOf(start(owner))!;
    checkLimit(owner, Date.now(), false); // the first answer already counted once
    const { calls, deps } = chatStub(['Because of scattering of blue light.']);
    const m = fakeModal(owner, sid, 'but why is sunset red?');
    await handleReplyModal(m.i, deps);
    expect(m.log.updates).toHaveLength(1); expect(json(m.log.updates[0])).not.toContain('ai:reply'); expect(json(m.log.updates[0])).toContain('Rayleigh scattering.'); // old card kept, button removed
    expect(calls).toHaveLength(1);
    expect(calls[0]!.messages.map(x => `${x.role}:${typeof x.content === 'string' ? x.content : '[parts]'}`)).toEqual(['system:SYS', 'user:why is the sky blue', 'assistant:Rayleigh scattering.', 'user:but why is sunset red?']);
    expect(m.log.followUps).toHaveLength(1);
    const t = text(m.log.followUps[0]); expect(t).toContain('## but why is sunset red?'); expect(t).toContain('Because of scattering of blue light.'); expect(t).toContain('Reply 2/3'); expect(t).toContain('2/20 hourly');
    expect(getSession(sid)!.replies).toBe(1); expect(getSession(sid)!.history).toHaveLength(4);
  });
  test('three replies are allowed, the third has no button, a fourth is refused', async () => {
    const owner = uid(); const sid = sidOf(start(owner))!; const { deps } = chatStub(['a1', 'a2', 'a3']);
    const labels: string[] = [];
    for (const q of ['q1', 'q2', 'q3']) { const m = fakeModal(owner, sid, q); await handleReplyModal(m.i, deps); labels.push(/Reply \d\/3/.exec(text(m.log.followUps[0]))?.[0] ?? 'none'); }
    expect(labels).toEqual(['Reply 2/3', 'Reply 3/3', 'none']);
    const late = fakeModal(owner, sid, 'q4'); await handleReplyModal(late.i, deps); expect(late.log.replies[0].content).toContain('reply limit'); expect(late.log.followUps).toHaveLength(0);
  });
  test('replies count against the free hourly limit, and premium is exempt', async () => {
    Bun.env.AI_USER_LIMIT = '2'; Bun.env.PREMIUM_SKU_ID = '1';
    const free = uid(); const fsid = sidOf(start(free))!; checkLimit(free, Date.now(), false);
    const s1 = chatStub(['ok']); const m1 = fakeModal(free, fsid, 'one'); await handleReplyModal(m1.i, s1.deps); expect(s1.calls).toHaveLength(1);
    const m2 = fakeModal(free, fsid, 'two'); await handleReplyModal(m2.i, s1.deps);
    expect(s1.calls).toHaveLength(1); expect(m2.log.replies[0].content).toContain('2 free AI requests'); expect(m2.log.replies[0].content).toContain('/premium buy'); expect(m2.log.updates).toHaveLength(0); // no chat call, message untouched
    const prem = uid(); await extendPremium(prem, 30, 'grant'); const psid = sidOf(start(prem, { premium: true }))!;
    const s2 = chatStub(['x', 'y', 'z']);
    for (const q of ['1', '2', '3']) { const m = fakeModal(prem, psid, q); await handleReplyModal(m.i, s2.deps); expect(text(m.log.followUps[0])).toContain('Premium'); }
    expect(s2.calls).toHaveLength(3);
  });
  test('the model failing puts the button back, refunds the request and explains privately', async () => {
    const owner = uid(); const sid = sidOf(start(owner))!; checkLimit(owner, Date.now(), false);
    const orig = console.error; console.error = () => {};
    const { deps } = chatStub([new Error('provider exploded')]);
    const m = fakeModal(owner, sid, 'hello?');
    try { await handleReplyModal(m.i, deps); } finally { console.error = orig; }
    expect(m.log.edits).toHaveLength(1); expect(json(m.log.edits[0])).toContain('Reply 1/3'); // original button restored
    expect(m.log.followUps[0].content).toContain('Reply button is back'); expect(m.log.followUps[0].content).not.toContain('exploded'); expect(m.log.followUps[0].flags & 64).toBeTruthy();
    expect(getSession(sid)!.replies).toBe(0); expect(getSession(sid)!.history).toHaveLength(2);
    // refunded: the person still has their full allowance apart from the first answer
    for (let i = 0; i < 19; i++) expect(checkLimit(owner, Date.now(), false).ok).toBe(true);
    expect(checkLimit(owner, Date.now(), false).ok).toBe(false);
    const retry = fakeModal(owner, sid, 'hello?'); resetLimits(); await handleReplyModal(retry.i, chatStub(['now it works']).deps); expect(text(retry.log.followUps[0])).toContain('now it works');
  });
  test('an unconfigured AI is explained, not shown as a crash', async () => {
    const owner = uid(); const sid = sidOf(start(owner))!;
    const m = fakeModal(owner, sid, 'hi'); await handleReplyModal(m.i, chatStub([new LlmUnavailable()]).deps);
    expect(m.log.followUps[0].content).toContain('isn\'t configured');
  });
  test('only the owner can submit; empty replies and double-submits are handled', async () => {
    const owner = uid(); const sid = sidOf(start(owner))!; const s = chatStub(['slow answer']);
    const stranger = fakeModal('intruder', sid, 'hijack'); await handleReplyModal(stranger.i, s.deps); expect(stranger.log.replies[0].content).toContain('belongs to someone else'); expect(s.calls).toHaveLength(0);
    const empty = fakeModal(owner, sid, '   '); await handleReplyModal(empty.i, s.deps); expect(empty.log.replies[0].content).toContain('empty'); expect(s.calls).toHaveLength(0);
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const slow = { chat: async () => { await gate; return 'slow answer'; } };
    const first = fakeModal(owner, sid, 'first'); const p1 = handleReplyModal(first.i, slow);
    await Bun.sleep(5);
    const second = fakeModal(owner, sid, 'second'); await handleReplyModal(second.i, slow); expect(second.log.replies[0].content).toContain('still answering');
    release(); await p1; expect(getSession(sid)!.replies).toBe(1);
  });
  test('a modal that isn\'t attached to a message still works (it defers instead of updating)', async () => {
    const owner = uid(); const sid = sidOf(start(owner))!;
    const m = fakeModal(owner, sid, 'hi', { fromMessage: false }); await handleReplyModal(m.i, chatStub(['fine']).deps);
    expect(m.log.deferred).toBe(1); expect(m.log.updates).toHaveLength(0); expect(m.log.followUps).toHaveLength(1);
  });
  test('the global router sends the button and the modal to these handlers', async () => {
    const { onInteraction } = await import('../src/events/onInteraction');
    const owner = uid(); const sid = sidOf(start(owner))!;
    const b = fakeButton(owner, sid);
    await onInteraction({ ...b.i, isAutocomplete: () => false, isButton: () => true, isModalSubmit: () => false } as any);
    expect(b.out.modal?.custom_id).toBe(`ai:modal:${sid}`);
    const m = fakeModal(owner, sid, 'via router');
    // The router uses the real chat client; a closed local port makes it fail fast, and the handler must fail cleanly (button restored).
    Bun.env.LLM_BASE_URL = 'http://127.0.0.1:9/v1';
    const orig = console.error; console.error = () => {};
    try { await onInteraction({ ...m.i, isAutocomplete: () => false, isButton: () => false, isModalSubmit: () => true } as any); } finally { console.error = orig; }
    expect(m.log.updates.length + m.log.replies.length).toBeGreaterThan(0);
  });
});

describe('/ai usage text', () => {
  test('free: how many used and left; premium: unlimited', () => {
    const u = uid(); for (let i = 0; i < 7; i++) checkLimit(u, 1000 + i, false);
    const free = usageLines(u, { premium: false, source: null, expiresAt: null }, 5000).join('\n');
    expect(free).toContain('7/20'); expect(free).toContain('13'); expect(free).toContain('drops off');
    expect(usageLines(uid(), { premium: false, source: null, expiresAt: null }).join('\n')).toContain('fresh');
    expect(usageLines(u, { premium: true, source: 'grant', expiresAt: Date.now() + 86_400_000 }).join('\n')).toContain('unlimited');
    Bun.env.PREMIUM_SKU_ID = '1'; expect(usageLines(u, { premium: false, source: null, expiresAt: null }).join('\n')).toContain('/premium buy');
  });
});
