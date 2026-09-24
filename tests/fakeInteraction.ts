import type { ChatInputCommandInteraction } from 'discord.js';

export interface FakeAttachment { url: string; name: string; contentType: string | null; size?: number }
export interface FakeOpts {
  options?: Record<string, string | number | boolean | null>;
  attachments?: Record<string, FakeAttachment>;
  /** Upload limit in bytes (default 10 MB). */
  limit?: number;
  userId?: string;
  guildId?: string | null;
  /** Make client.rest.post reject (simulates Discord refusing a voice message). */
  restFails?: boolean;
}

/** Just enough of a ChatInputCommandInteraction for the media/lookup handlers — records everything they send. */
export function fakeInteraction(o: FakeOpts = {}) {
  const sent: any[] = [];
  const restPosts: { route: string; options: any }[] = [];
  let deleted = false;
  const state = { deferred: false, replied: false };
  const val = (n: string) => (o.options && n in o.options ? o.options[n]! : null);
  const options = {
    getString: (n: string, req?: boolean) => { const v = val(n); if (v == null && req) throw new Error(`missing required option ${n}`); return v == null ? null : String(v); },
    getInteger: (n: string, req?: boolean) => { const v = val(n); if (v == null && req) throw new Error(`missing required option ${n}`); return v == null ? null : Number(v); },
    getNumber: (n: string, req?: boolean) => { const v = val(n); if (v == null && req) throw new Error(`missing required option ${n}`); return v == null ? null : Number(v); },
    getBoolean: (n: string) => { const v = val(n); return v == null ? null : Boolean(v); },
    getAttachment: (n: string, req?: boolean) => { const a = o.attachments?.[n] ?? null; if (!a && req) throw new Error(`missing required attachment ${n}`); return a ? { size: 1024, ...a } : null; },
    getUser: () => null,
    getSubcommand: () => 'test',
    getSubcommandGroup: () => null,
  };
  const interaction = {
    get deferred() { return state.deferred; },
    get replied() { return state.replied; },
    user: { id: o.userId ?? 'u-test', username: 'tester', displayName: 'Tester' },
    guildId: o.guildId === undefined ? 'g-test' : o.guildId,
    guild: null,
    channel: null,
    channelId: 'c-test',
    attachmentSizeLimit: o.limit ?? 10 * 1024 * 1024,
    client: {
      users: { fetch: async () => null },
      rest: { post: async (route: string, options: unknown) => { if (o.restFails) throw new Error('Missing Permissions'); restPosts.push({ route, options }); return {}; } },
    },
    options,
    deferReply: async () => { state.deferred = true; },
    reply: async (p: unknown) => { state.replied = true; sent.push(p); return {}; },
    editReply: async (p: unknown) => { sent.push(p); return {}; },
    followUp: async (p: unknown) => { sent.push(p); return {}; },
    deleteReply: async () => { deleted = true; },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, sent, restPosts, wasDeleted: () => deleted, last: () => sent.at(-1) };
}

/** Text content of whatever the handler last sent (plain content, or CV2 text blocks). */
export function textOf(payload: any): string {
  if (!payload) return '';
  const parts: string[] = [];
  if (typeof payload === 'string') parts.push(payload);
  if (payload.content) parts.push(payload.content);
  const walk = (c: any) => { if (!c) return; if (c.data?.content) parts.push(c.data.content); if (c.content) parts.push(c.content); for (const k of ['components']) for (const x of c.data?.[k] ?? c[k] ?? []) walk(x); };
  for (const c of payload.components ?? []) walk(c);
  return parts.join('\n');
}
