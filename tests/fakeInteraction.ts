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
  /** Users returned by getUser(name). */
  users?: Record<string, { id: string; username: string; displayName?: string }>;
  /** The channel the command ran in (e.g. { nsfw: true }); null = unknown. */
  channel?: { nsfw?: boolean } | null;
  /** Display name of the invoking user (default "Tester"). */
  displayName?: string;
  /** Whether the invoker has Manage Server (default false). */
  manageGuild?: boolean;
  guildName?: string;
  /** Subcommand / group names, for dispatching through a real registered command (`commands.get('eco').run(...)`). */
  sub?: string;
  group?: string | null;
  /** Which button of a Confirm / Cancel question gets pressed (default Confirm; 'none' = the time runs out). */
  click?: 'confirm' | 'cancel' | 'none';
}

/** Just enough of a ChatInputCommandInteraction for the media/lookup handlers — records everything they send. */
export function fakeInteraction(o: FakeOpts = {}) {
  const sent: any[] = [];
  const restPosts: { route: string; options: any }[] = [];
  let deleted = false;
  const state = { deferred: false, replied: false, deferFlags: 0 };
  let msgSeq = 0;
  const val = (n: string) => (o.options && n in o.options ? o.options[n]! : null);
  const options = {
    getString: (n: string, req?: boolean) => { const v = val(n); if (v == null && req) throw new Error(`missing required option ${n}`); return v == null ? null : String(v); },
    getInteger: (n: string, req?: boolean) => { const v = val(n); if (v == null && req) throw new Error(`missing required option ${n}`); return v == null ? null : Number(v); },
    getNumber: (n: string, req?: boolean) => { const v = val(n); if (v == null && req) throw new Error(`missing required option ${n}`); return v == null ? null : Number(v); },
    getBoolean: (n: string) => { const v = val(n); return v == null ? null : Boolean(v); },
    getAttachment: (n: string, req?: boolean) => { const a = o.attachments?.[n] ?? null; if (!a && req) throw new Error(`missing required attachment ${n}`); return a ? { size: 1024, ...a } : null; },
    getUser: (n: string, req?: boolean) => {
      const u = o.users?.[n] ?? null; if (!u && req) throw new Error(`missing required user ${n}`);
      return u ? { displayName: u.username, bot: false, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png', avatarURL: () => null, bannerURL: () => null, send: async () => ({}), ...u } : null;
    },
    getSubcommand: () => o.sub ?? 'test',
    getSubcommandGroup: () => o.group ?? null,
    getMember: () => null,
  };
  const interaction = {
    get deferred() { return state.deferred; },
    get replied() { return state.replied; },
    user: {
      id: o.userId ?? 'u-test', username: 'tester', displayName: o.displayName ?? 'Tester', bot: false,
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png', avatarURL: () => null, bannerURL: () => null,
      send: async () => ({}), toString() { return `<@${this.id}>`; },
    },
    guildId: o.guildId === undefined ? 'g-test' : o.guildId,
    guild: o.guildName ? { name: o.guildName } : null,
    inGuild: () => (o.guildId === undefined ? true : o.guildId !== null),
    memberPermissions: o.guildId === null ? null : { has: () => !!o.manageGuild },
    createdTimestamp: Date.now(),
    channel: o.channel ?? null,
    channelId: 'c-test',
    attachmentSizeLimit: o.limit ?? 10 * 1024 * 1024,
    client: {
      user: { id: '999000999000999000' },
      users: { fetch: async () => null },
      channels: { cache: new Map(), fetch: async () => null },
      guilds: { cache: new Map() },
      rest: { post: async (route: string, options: unknown) => { if (o.restFails) throw new Error('Missing Permissions'); restPosts.push({ route, options }); return {}; } },
    },
    options,
    deferReply: async (p?: { flags?: number }) => { state.deferred = true; state.deferFlags = p?.flags ?? 0; },
    // A reply with buttons can be answered: `click` says which one gets pressed ('none' = nobody answers before the timeout).
    reply: async (p: any) => {
      state.replied = true; sent.push(p);
      const message = {
        awaitMessageComponent: async () => {
          if ((o.click ?? 'confirm') === 'none') throw new Error('time');
          const want = o.click === 'cancel' ? 'Cancel' : 'Confirm';
          const b = (p?.components ?? []).flatMap((c: any) => c.components ?? []).find((x: any) => x?.data?.label === want);
          return { customId: b.data.custom_id, user: interaction.user, update: async (u: unknown) => { sent.push(u); } };
        },
      };
      return { id: `m${++msgSeq}`, resource: { message } };
    },
    editReply: async (p: unknown) => { sent.push(p); return { id: `m${++msgSeq}` }; },
    followUp: async (p: unknown) => { sent.push(p); return {}; },
    deleteReply: async () => { deleted = true; },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, sent, restPosts, wasDeleted: () => deleted, last: () => sent.at(-1), deferFlags: () => state.deferFlags };
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
