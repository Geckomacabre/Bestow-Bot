import { beforeAll, describe, expect, test } from 'bun:test';
import { ChannelType, InteractionContextType } from 'discord.js';
import { db, initDb } from '../src/utils/db';
import * as udb from '../src/utils/db';
import { routeFor } from '../src/framework/router';
import { parseWhen, zonedToUtc } from '../src/groupchat/when';
import * as store from '../src/groupchat/store';
import { birthdayBoard, offsetLabel, refreshAllBirthdayPanels, refreshBirthdayPanel, timeBoard } from '../src/groupchat/boards';
import { botCanPost, placeOf, scopeOf } from '../src/groupchat/scope';
import { pickSome, splitChoices, NEVER, WOULD_YOU_RATHER } from '../src/groupchat/party';
import { zoneMatters } from '../src/groupchat/plans';
import { deliverReminder } from '../src/features/feeds';
import { deleteData } from '../src/privacy';
import { fakeInteraction, textOf } from './fakeInteraction';

/**
 * Bestow lives in group chats and DMs, where it can answer commands and buttons but can't read or post on its own. These cover the
 * group-chat features end to end: the time parser, the stores, and the panels driven by real button presses through the router.
 */
const commands = (await import('../src/handlers/commandHandler')).default;
beforeAll(async () => { await initDb(); });

let n = 0;
const uid = () => `gc-user-${++n}`;
const gdm = () => `gc-chan-${++n}`;

/** Every custom id on a payload (buttons and menus, inside containers too). */
function ids(p: any): string[] {
  const out: string[] = [];
  const walk = (c: any) => { if (!c) return; const d = c.data ?? c; if (d.custom_id) out.push(d.custom_id); for (const x of c.components ?? d.components ?? []) walk(x); };
  for (const c of p?.components ?? []) walk(c);
  return out;
}

/** A command run in a group chat (no server). */
function inGroup(o: { channelId: string; userId: string; sub: string; group?: string | null; options?: Record<string, string | number | boolean>; users?: Record<string, { id: string; username: string }> }) {
  const fi = fakeInteraction({ guildId: null, userId: o.userId, sub: o.sub, group: o.group ?? null, options: o.options, users: o.users });
  const reply = fi.interaction.reply.bind(fi.interaction);
  Object.assign(fi.interaction, {
    channelId: o.channelId, context: InteractionContextType.PrivateChannel, channel: { type: ChannelType.GroupDM }, locale: 'en-US', authorizingIntegrationOwners: { 1: o.userId },
    // Discord hands back the posted message, id and all.
    reply: async (p: unknown) => { const r: any = await reply(p as never); r.resource.message.id = r.id; return r; },
  });
  return fi;
}

/** A button press, menu choice or pop-up on a panel in a group chat. */
function press(o: { customId: string; userId: string; channelId: string; guildId?: string | null; values?: string[]; fields?: Record<string, string>; messageId?: string; kind?: 'button' | 'select' | 'modal'; client?: unknown }) {
  const kind = o.kind ?? 'button';
  const rec = { updates: [] as any[], replies: [] as any[], modals: [] as any[] };
  const i: any = {
    customId: o.customId, user: { id: o.userId }, guildId: o.guildId ?? null, channelId: o.channelId,
    context: o.guildId ? InteractionContextType.Guild : InteractionContextType.PrivateChannel, channel: { type: ChannelType.GroupDM },
    authorizingIntegrationOwners: { 1: o.userId }, message: { id: o.messageId ?? 'panel-msg' }, values: o.values ?? [], client: o.client,
    fields: { getTextInputValue: (k: string) => o.fields?.[k] ?? '' },
    isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select', isModalSubmit: () => kind === 'modal', isFromMessage: () => true,
    update: async (p: any) => { rec.updates.push(p); }, reply: async (p: any) => { rec.replies.push(p); }, showModal: async (m: any) => { rec.modals.push(m); },
  };
  return { i, rec, run: () => routeFor(o.customId)!(i) };
}

describe('reading plan times', () => {
  // Saturday 17 October 2026, 3pm in New York.
  const now = Date.UTC(2026, 9, 17, 19, 0);
  const z = 'America/New_York';
  const local = (q: string, zone = z, dayFirst = false) => {
    const r = parseWhen(q, zone, now, dayFirst);
    return r && { at: new Date(r.at).toISOString(), hasTime: r.hasTime };
  };
  test('days, times and both together, in the planner\'s timezone', () => {
    expect(local('friday 8pm')).toEqual({ at: '2026-10-24T00:00:00.000Z', hasTime: true });       // Fri 23 Oct, 8pm EDT
    expect(local('fri at 8:30 pm')!.at).toBe('2026-10-24T00:30:00.000Z');
    expect(local('tomorrow 19:30')!.at).toBe('2026-10-18T23:30:00.000Z');
    expect(local('tonight')!.at).toBe('2026-10-18T00:00:00.000Z');                                // today 8pm
    expect(local('tonight 9:30')!.at).toBe('2026-10-18T01:30:00.000Z');                           // the evening 9:30
    expect(local('8pm')!.at).toBe('2026-10-18T00:00:00.000Z');                                    // later today
    expect(local('1pm')!.at).toBe('2026-10-18T17:00:00.000Z');                                    // passed, so tomorrow
    expect(local('saturday 2pm')!.at).toBe('2026-10-24T18:00:00.000Z');                           // today's has passed
    expect(local('saturday 4pm')!.at).toBe('2026-10-17T20:00:00.000Z');                           // still ahead today
    expect(local('next saturday')).toEqual({ at: '2026-10-24T16:00:00.000Z', hasTime: false });  // a day only: noon, shown as a date
    expect(local('sat morning')!.at).toBe('2026-10-24T13:00:00.000Z');
    expect(local('noon tomorrow')!.at).toBe('2026-10-18T16:00:00.000Z');
  });
  test('dates, with the year rolling over once a date has gone by', () => {
    expect(local('dec 20')).toEqual({ at: '2026-12-20T17:00:00.000Z', hasTime: false });
    expect(local('20th of december')!.at).toBe('2026-12-20T17:00:00.000Z');
    expect(local('2026-12-20 18:00')!.at).toBe('2026-12-20T23:00:00.000Z');
    expect(local('jan 5 2027')!.at).toBe('2027-01-05T17:00:00.000Z');
    expect(local('mar 3')!.at).toBe('2027-03-03T17:00:00.000Z');
    expect(local('12/20')!.at).toBe('2026-12-20T17:00:00.000Z');
    expect(local('12/10', z, true)!.at).toBe('2027-10-12T16:00:00.000Z');                         // 12 October, already past this year
  });
  test('relative times and Discord timestamps need no timezone', () => {
    expect(local('in 2 hours')!.at).toBe('2026-10-17T21:00:00.000Z');
    expect(local('2h30m')!.at).toBe('2026-10-17T21:30:00.000Z');
    expect(local('<t:1800000000:F>')!.at).toBe(new Date(1800000000 * 1000).toISOString());
    expect(zoneMatters('in 2 hours')).toBe(false); expect(zoneMatters('8pm')).toBe(true); expect(zoneMatters('<t:1800000000:F>')).toBe(false);
  });
  test('other timezones and daylight saving', () => {
    expect(local('tomorrow 9am', 'Europe/London')!.at).toBe('2026-10-18T08:00:00.000Z');
    expect(local('8pm', 'Asia/Tokyo')!.at).toBe('2026-10-18T11:00:00.000Z');                       // it's already Sunday morning there
    expect(local('nov 2 9am')!.at).toBe('2026-11-02T14:00:00.000Z');                               // after the clocks go back
    expect(zonedToUtc(2026, 7, 1, 12, 0, 'Asia/Kolkata')).toBe(Date.UTC(2026, 6, 1, 6, 30));
  });
  test('refuses anything it can\'t read fully', () => {
    for (const q of ['', 'blah', 'friday blah', 'feb 30', '13pm', 'next week', '25:00', 'x'.repeat(80)]) expect(local(q), q).toBeNull();
  });
});

describe('where a command ran', () => {
  test('servers keep their own data; DMs and group chats key by channel', () => {
    expect(scopeOf({ guildId: 'g1', channelId: 'c1' })).toBe('g1'); expect(scopeOf({ guildId: null, channelId: 'c1' })).toBe('c1');
    expect(placeOf({ guildId: null, context: InteractionContextType.PrivateChannel, channel: { type: ChannelType.GroupDM } })).toBe('group');
    expect(placeOf({ guildId: null, context: InteractionContextType.PrivateChannel, channel: { type: ChannelType.DM } })).toBe('dm');
    expect(placeOf({ guildId: null, context: InteractionContextType.BotDM })).toBe('dm');
  });
  test('the bot can post by itself only in its DMs and servers it was added to', () => {
    expect(botCanPost({ guildId: null, channelId: 'c', context: InteractionContextType.PrivateChannel })).toBe(false);
    expect(botCanPost({ guildId: null, channelId: 'c', context: InteractionContextType.BotDM })).toBe(true);
    expect(botCanPost({ guildId: 'g', channelId: 'c', context: InteractionContextType.Guild, authorizingIntegrationOwners: { 1: 'u' } })).toBe(false);
    expect(botCanPost({ guildId: 'g', channelId: 'c', context: InteractionContextType.Guild, authorizingIntegrationOwners: { 0: 'g', 1: 'u' } })).toBe(true);
  });
});

describe('birthdays in a group chat', () => {
  test('/community birthday set saves it once and puts it on this chat\'s board; other chats only see it once added there', async () => {
    const chat = gdm(), other = gdm(), u = uid();
    const fi = inGroup({ channelId: chat, userId: u, group: 'birthday', sub: 'set', options: { month: 5, day: 17 } });
    await commands.get('community')!.run!(fi.interaction);
    expect(textOf(fi.last())).toContain('May 17th'); expect(textOf(fi.last())).toContain('/community birthday list');
    expect(await store.getPersonalBirthday(u)).toEqual({ month: 5, day: 17 });
    expect((await store.chatBirthdays(chat)).map(b => b.user_id)).toEqual([u]);
    expect(await store.chatBirthdays(other)).toEqual([]);
    // In the other chat, "Add mine" needs no pop-up: the birthday is already saved.
    const p = press({ customId: 'gc:bday:add', userId: u, channelId: other }); await p.run();
    expect(p.rec.modals).toHaveLength(0); expect(textOf(p.rec.updates[0])).toContain(`<@${u}>`); expect(textOf(p.rec.updates[0])).toContain('May 17th');
  });
  test('the board lists people soonest first, with Add mine / Refresh / Remove me', async () => {
    const chat = gdm(), a = uid(), b = uid();
    const now = Date.UTC(2026, 4, 10);
    await store.setPersonalBirthday(a, 5, 17); await store.joinBoard(chat, 'birthday', a);
    await store.setPersonalBirthday(b, 5, 10); await store.joinBoard(chat, 'birthday', b);
    const board = await birthdayBoard({ scope: chat, place: 'group', guildId: null }, now);
    const t = textOf(board);
    expect(t).toContain('Birthdays in this group chat'); expect(t).toContain(`**Today:** <@${b}>`); expect(t).toContain(`<@${a}> — **May 17th** · in 7 days`);
    expect(ids(board)).toEqual(['gc:bday:add', 'gc:bday:refresh', 'gc:bday:leave']);
    expect(board.allowedMentions).toEqual({ parse: [] });
  });
  test('Add mine asks once with a pop-up, Remove me takes you off', async () => {
    const chat = gdm(), u = uid();
    const add = press({ customId: 'gc:bday:add', userId: u, channelId: chat }); await add.run();
    expect(add.rec.modals).toHaveLength(1);
    const bad = press({ customId: 'gc:bday:modal', kind: 'modal', userId: u, channelId: chat, fields: { month: 'Febtober', day: '3' } }); await bad.run();
    expect(textOf(bad.rec.replies[0])).toContain('month'); expect(await store.getPersonalBirthday(u)).toBeNull();
    const feb = press({ customId: 'gc:bday:modal', kind: 'modal', userId: u, channelId: chat, fields: { month: 'feb', day: '30' } }); await feb.run();
    expect(textOf(feb.rec.replies[0])).toContain('only has 29 days');
    const ok = press({ customId: 'gc:bday:modal', kind: 'modal', userId: u, channelId: chat, fields: { month: 'march', day: '9' } }); await ok.run();
    expect(textOf(ok.rec.updates[0])).toContain('March 9th');
    const leave = press({ customId: 'gc:bday:leave', userId: u, channelId: chat }); await leave.run();
    expect(textOf(leave.rec.updates[0])).not.toContain(`<@${u}>`);
    expect(await store.getPersonalBirthday(u)).toEqual({ month: 3, day: 9 }); // still saved for their other chats
  });
  test('in a server it also goes on the server\'s own list; remove clears both', async () => {
    const g = `gc-guild-${++n}`, u = uid();
    const fi = fakeInteraction({ guildId: g, userId: u, group: 'birthday', sub: 'set', options: { month: 12, day: 1 } });
    await commands.get('community')!.run!(fi.interaction);
    expect(await udb.getBirthday(g, u)).toMatchObject({ month: 12, day: 1 }); expect(await store.getPersonalBirthday(u)).toEqual({ month: 12, day: 1 });
    const rm = fakeInteraction({ guildId: g, userId: u, group: 'birthday', sub: 'remove' });
    await commands.get('community')!.run!(rm.interaction);
    expect(await udb.getBirthday(g, u)).toBeNull(); expect(await store.getPersonalBirthday(u)).toBeNull();
  });
  test('view and list work outside servers', async () => {
    const chat = gdm(), u = uid(), friend = uid();
    await store.setPersonalBirthday(friend, 1, 2);
    const v = inGroup({ channelId: chat, userId: u, group: 'birthday', sub: 'view', users: { user: { id: friend, username: 'Friend' } } });
    await commands.get('community')!.run!(v.interaction);
    expect(textOf(v.last())).toContain('January 2nd');
    const l = inGroup({ channelId: chat, userId: u, group: 'birthday', sub: 'list' });
    await commands.get('community')!.run!(l.interaction);
    expect(ids(l.last())).toContain('gc:bday:add');
  });
});

describe('a server\'s live birthday panel', () => {
  /** A bot client with two channels that records what is posted, edited and deleted. */
  function fakeBot() {
    const messages = new Map<string, any>(), log: string[] = [];
    let seq = 0;
    const channel = (id: string) => ({
      id, isSendable: () => true, isDMBased: () => false, isTextBased: () => true,
      send: async (p: any) => { const mid = `live-${++n}-${++seq}`; messages.set(mid, p); log.push(`send ${id}`); return { id: mid }; },
      messages: {
        edit: async (mid: string, p: any) => { if (!messages.has(mid)) throw Object.assign(new Error('Unknown Message'), { code: 10008 }); messages.set(mid, p); log.push(`edit ${mid}`); },
        delete: async (mid: string) => { messages.delete(mid); log.push(`delete ${mid}`); },
      },
    });
    const channels = new Map([['chan-a', channel('chan-a')], ['chan-b', channel('chan-b')]]);
    const client = { channels: { fetch: async (id: string) => channels.get(id) ?? Promise.reject(Object.assign(new Error('Unknown Channel'), { code: 10003 })) } };
    return { client: client as any, messages, log };
  }
  /** /server birthdays <sub> run by an admin in a server where Bestow is a server bot. */
  function admin(g: string, bot: ReturnType<typeof fakeBot>, sub: string, o: { channel?: string; serverBot?: boolean; manage?: boolean } = {}) {
    const fi = fakeInteraction({ guildId: g, userId: uid(), group: 'birthdays', sub, manageGuild: o.manage ?? true });
    (fi.interaction.options as any).getChannel = () => (o.channel ? { id: o.channel } : null);
    Object.assign(fi.interaction, { client: bot.client, channelId: 'chan-a', context: InteractionContextType.Guild, authorizingIntegrationOwners: o.serverBot === false ? { 1: 'u' } : { 0: g } });
    return fi;
  }
  const textOfMsg = (bot: ReturnType<typeof fakeBot>, id: string) => textOf(bot.messages.get(id));

  test('posts once, then edits itself only when a birthday changes or the day turns over', async () => {
    const g = `gc-guild-${++n}`, bot = fakeBot(), friend = uid();
    const post = admin(g, bot, 'panel');
    await commands.get('server')!.run!(post.interaction);
    expect(textOf(post.last())).toContain('Birthday panel posted in <#chan-a>');
    const panel = (await store.getBirthdayPanel(g))!;
    expect(panel.channel_id).toBe('chan-a'); expect(bot.log).toEqual(['send chan-a']);
    expect(textOfMsg(bot, panel.message_id)).toContain('Updates by itself every day'); expect(ids(bot.messages.get(panel.message_id))).toContain('gc:bday:add');

    expect(await refreshBirthdayPanel(bot.client, g)).toBe('same'); // nothing changed: no edit
    const set = fakeInteraction({ guildId: g, userId: friend, group: 'birthday', sub: 'set', options: { month: 12, day: 25 } });
    (set.interaction as any).client = bot.client;
    await commands.get('community')!.run!(set.interaction);
    expect(bot.log).toEqual(['send chan-a', `edit ${panel.message_id}`]);
    expect(textOfMsg(bot, panel.message_id)).toContain(`<@${friend}> — **December 25th**`);

    const tomorrow = Date.now() + 86_400_000;
    expect(await refreshBirthdayPanel(bot.client, g, tomorrow)).toBe('edited'); // the countdown moved on
    expect(await refreshBirthdayPanel(bot.client, g, tomorrow)).toBe('same');
  });
  test('its own buttons keep it live; a button on another board in that server updates it too', async () => {
    const g = `gc-guild-${++n}`, bot = fakeBot(), u = uid();
    await commands.get('server')!.run!(admin(g, bot, 'panel').interaction);
    const panel = (await store.getBirthdayPanel(g))!;
    await store.setPersonalBirthday(u, 3, 3);
    const add = press({ customId: 'gc:bday:add', userId: u, channelId: 'chan-a', guildId: g, messageId: panel.message_id, client: bot.client }); await add.run();
    expect(textOf(add.rec.updates[0])).toContain('Updates by itself'); expect(textOf(add.rec.updates[0])).toContain(`<@${u}>`);
    expect(await refreshBirthdayPanel(bot.client, g)).toBe('same'); // the press already brought it up to date
    const elsewhere = press({ customId: 'gc:bday:leave', userId: u, channelId: 'chan-b', guildId: g, messageId: 'some-other-board', client: bot.client }); await elsewhere.run();
    expect(textOf(elsewhere.rec.updates[0])).not.toContain('Updates by itself'); // a one-off board doesn't claim to update itself
    expect(textOfMsg(bot, panel.message_id)).not.toContain(`<@${u}>`);
  });
  test('running it again moves it; panel-stop removes it; a deleted panel is forgotten', async () => {
    const g = `gc-guild-${++n}`, bot = fakeBot();
    await commands.get('server')!.run!(admin(g, bot, 'panel').interaction);
    const first = (await store.getBirthdayPanel(g))!;
    await commands.get('server')!.run!(admin(g, bot, 'panel', { channel: 'chan-b' }).interaction);
    const second = (await store.getBirthdayPanel(g))!;
    expect(second.channel_id).toBe('chan-b'); expect(bot.log).toContain(`delete ${first.message_id}`); expect(bot.messages.has(first.message_id)).toBe(false);

    const view = admin(g, bot, 'view'); await commands.get('server')!.run!(view.interaction);
    expect(textOf(view.last())).toContain('**Live panel:** <#chan-b>');

    const stop = admin(g, bot, 'panel-stop'); await commands.get('server')!.run!(stop.interaction);
    expect(textOf(stop.last())).toContain('removed'); expect(await store.getBirthdayPanel(g)).toBeNull(); expect(bot.messages.has(second.message_id)).toBe(false);
    const again = admin(g, bot, 'panel-stop'); await commands.get('server')!.run!(again.interaction);
    expect(textOf(again.last())).toContain('no birthday panel');

    await commands.get('server')!.run!(admin(g, bot, 'panel').interaction);
    const third = (await store.getBirthdayPanel(g))!;
    bot.messages.delete(third.message_id); // someone deleted the message
    await store.setPersonalBirthday(`gc-del-${n}`, 6, 6); await udb.setBirthday(g, `gc-del-${n}`, 6, 6);
    await refreshAllBirthdayPanels(bot.client);
    expect(await store.getBirthdayPanel(g)).toBeNull();
  });
  test('needs Manage Server, a channel it can post in, and the bot added to the server', async () => {
    const g = `gc-guild-${++n}`, bot = fakeBot();
    const member = admin(g, bot, 'panel', { manage: false }); await commands.get('server')!.run!(member.interaction);
    expect(textOf(member.last())).toContain('Manage Server');
    const userInstall = admin(g, bot, 'panel', { serverBot: false }); await commands.get('server')!.run!(userInstall.interaction);
    expect(textOf(userInstall.last())).toContain('added to this server as a bot');
    const missing = admin(g, bot, 'panel', { channel: 'chan-gone' }); await commands.get('server')!.run!(missing.interaction);
    expect(textOf(missing.last())).toContain('can\'t post in <#chan-gone>');
    expect(await store.getBirthdayPanel(g)).toBeNull(); expect(bot.log).toEqual([]);
  });
});

describe('the time board', () => {
  test('groups people by their clock, west to east, and asks for a timezone only once', async () => {
    const chat = gdm(), a = uid(), b = uid(), c = uid();
    await udb.setTimezone(a, 'America/New_York'); await udb.setTimezone(b, 'Asia/Kolkata'); await udb.setTimezone(c, 'America/Toronto');
    for (const u of [a, b, c]) await store.joinBoard(chat, 'timezone', u);
    const now = Date.UTC(2026, 0, 2, 15, 4);
    const t = textOf(await timeBoard({ scope: chat, place: 'group', guildId: null }, now));
    expect(t).toContain('Times in this group chat');
    expect(t).toContain(`\`10:04 AM\` Fri · **UTC-5** (New York, Toronto) — <@${a}> <@${c}>`);
    expect(t).toContain(`\`8:34 PM\` Fri · **UTC+5:30** (Kolkata) — <@${b}>`);
    expect(t.indexOf('UTC-5')).toBeLessThan(t.indexOf('UTC+5:30'));
    expect(offsetLabel(0)).toBe('UTC'); expect(offsetLabel(-210)).toBe('UTC-3:30');
  });
  test('Add me opens a pop-up when you have no timezone, and an unknown one is refused', async () => {
    const chat = gdm(), u = uid();
    const add = press({ customId: 'gc:tz:add', userId: u, channelId: chat }); await add.run();
    expect(add.rec.modals).toHaveLength(1);
    const bad = press({ customId: 'gc:tz:modal', kind: 'modal', userId: u, channelId: chat, fields: { zone: 'zzzz-nowhere' } }); await bad.run();
    expect(textOf(bad.rec.replies[0])).toContain('don\'t know that timezone');
    const ok = press({ customId: 'gc:tz:modal', kind: 'modal', userId: u, channelId: chat, fields: { zone: 'Tokyo' } }); await ok.run();
    expect((await udb.getTimezone(u))?.timezone).toBe('Asia/Tokyo'); expect(textOf(ok.rec.updates[0])).toContain(`<@${u}>`);
    const fi = inGroup({ channelId: chat, userId: u, sub: 'everyone' });
    await commands.get('timezone')!.run!(fi.interaction);
    expect(textOf(fi.last())).toContain('Tokyo');
  });
});

describe('plans', () => {
  test('/community plan new posts a panel; RSVPs toggle; only the planner can cancel, after confirming', async () => {
    const chat = gdm(), host = uid(), friend = uid();
    await udb.setTimezone(host, 'Europe/Paris');
    const fi = inGroup({ channelId: chat, userId: host, group: 'plan', sub: 'new', options: { title: 'Movie night', when: 'in 3 hours', details: 'Bring snacks' } });
    await commands.get('community')!.run!(fi.interaction);
    const panel = fi.sent[0];
    expect(textOf(panel)).toContain('📅 Movie night'); expect(textOf(panel)).toContain('Bring snacks');
    const plan = (await store.upcomingPlans(chat))[0]!;
    expect(plan.message_id).toBeTruthy(); expect(plan.all_day).toBe(0);
    expect(ids(panel)).toEqual(['going', 'maybe', 'no', 'remind', 'cancel'].map(a => `gc:plan:${plan.id}:${a}`));

    const going = press({ customId: `gc:plan:${plan.id}:going`, userId: friend, channelId: chat }); await going.run();
    expect(textOf(going.rec.updates[0])).toContain(`**Going (1)** <@${friend}>`);
    const maybe = press({ customId: `gc:plan:${plan.id}:maybe`, userId: friend, channelId: chat }); await maybe.run();
    expect(textOf(maybe.rec.updates[0])).toContain('**Going (0)**'); expect(textOf(maybe.rec.updates[0])).toContain(`**Maybe (1)** <@${friend}>`);
    const again = press({ customId: `gc:plan:${plan.id}:maybe`, userId: friend, channelId: chat }); await again.run();
    expect(textOf(again.rec.updates[0])).toContain('**Maybe (0)**');

    const sneaky = press({ customId: `gc:plan:${plan.id}:cancel`, userId: friend, channelId: chat }); await sneaky.run();
    expect(textOf(sneaky.rec.replies[0])).toContain('Only the person who made this plan');
    const elsewhere = press({ customId: `gc:plan:${plan.id}:going`, userId: friend, channelId: gdm() }); await elsewhere.run();
    expect(textOf(elsewhere.rec.replies[0])).toContain('another chat');

    const ask = press({ customId: `gc:plan:${plan.id}:cancel`, userId: host, channelId: chat }); await ask.run();
    expect(ids(ask.rec.updates[0])).toEqual([`gc:plan:${plan.id}:cancel-yes`, `gc:plan:${plan.id}:keep`]);
    const keep = press({ customId: `gc:plan:${plan.id}:keep`, userId: friend, channelId: chat }); await keep.run(); // anyone can back out of the question
    expect(ids(keep.rec.updates[0])).toContain(`gc:plan:${plan.id}:going`);
    const noYes = press({ customId: `gc:plan:${plan.id}:cancel-yes`, userId: friend, channelId: chat }); await noYes.run();
    expect(textOf(noYes.rec.replies[0])).toContain('Only the person'); expect(await store.getPlan(plan.id)).not.toBeNull();
    const yes = press({ customId: `gc:plan:${plan.id}:cancel-yes`, userId: host, channelId: chat }); await yes.run();
    expect(textOf(yes.rec.updates[0])).toContain('Cancelled by'); expect(ids(yes.rec.updates[0])).toEqual([]);
    expect(await store.getPlan(plan.id)).toBeNull(); expect(await store.planRsvps(plan.id)).toEqual([]);
  });
  test('Remind me sets one reminder 15 minutes before, by DM in a group chat', async () => {
    const chat = gdm(), host = uid(), friend = uid();
    const plan = await store.createPlan({ scope: chat, channelId: chat, title: 'Game night', startsAt: Date.now() + 2 * 3600_000, createdBy: host });
    const r = press({ customId: `gc:plan:${plan.id}:remind`, userId: friend, channelId: chat }); await r.run();
    expect(textOf(r.rec.replies[0])).toContain('in your DMs');
    const mine = await udb.getReminders(friend);
    expect(mine).toHaveLength(1); expect(mine[0]!.fires_at).toBe(plan.starts_at - 15 * 60_000); expect(mine[0]!.message).toContain('Game night');
    const twice = press({ customId: `gc:plan:${plan.id}:remind`, userId: friend, channelId: chat }); await twice.run();
    expect(textOf(twice.rec.replies[0])).toContain('already have a reminder'); expect(await udb.getReminders(friend)).toHaveLength(1);
  });
  test('times it can\'t read, past times and too many plans are refused', async () => {
    const chat = gdm(), u = uid();
    const bad = inGroup({ channelId: chat, userId: u, group: 'plan', sub: 'new', options: { title: 'x', when: 'whenever' } });
    await commands.get('community')!.run!(bad.interaction);
    expect(textOf(bad.last())).toContain('couldn\'t read');
    await expect(store.createPlan({ scope: chat, channelId: chat, title: 'Old', startsAt: Date.now() - 3600_000, createdBy: u })).rejects.toThrow('already passed');
    for (let k = 0; k < store.MAX_PLANS; k++) await store.createPlan({ scope: chat, channelId: chat, title: `P${k}`, startsAt: Date.now() + 3600_000, createdBy: u });
    await expect(store.createPlan({ scope: chat, channelId: chat, title: 'One more', startsAt: Date.now() + 3600_000, createdBy: u })).rejects.toThrow('upcoming plans');
    const list = inGroup({ channelId: chat, userId: u, group: 'plan', sub: 'list' });
    await commands.get('community')!.run!(list.interaction);
    expect(textOf(list.last())).toContain('P0');
  });
  test('a time read without a saved timezone says it used UTC', async () => {
    const chat = gdm(), u = uid();
    const fi = inGroup({ channelId: chat, userId: u, group: 'plan', sub: 'new', options: { title: 'Call', when: 'tomorrow 8pm' } });
    await commands.get('community')!.run!(fi.interaction);
    expect(textOf(fi.last())).toContain('as UTC');
  });
});

describe('shared lists', () => {
  test('add with the pop-up, tick from the menu, clear the ticked ones, then delete the empty list', async () => {
    const chat = gdm(), a = uid(), b = uid();
    const fi = inGroup({ channelId: chat, userId: a, sub: 'list', options: { name: 'Groceries' } });
    await commands.get('community')!.run!(fi.interaction);
    const list = (await store.findList(chat, 'groceries'))!;
    expect(textOf(fi.last())).toContain('📝 Groceries'); expect(ids(fi.last())).toEqual([`gc:list:${list.id}:add`, `gc:list:${list.id}:clear`, `gc:list:${list.id}:refresh`]);

    const open = press({ customId: `gc:list:${list.id}:add`, userId: b, channelId: chat }); await open.run();
    expect(open.rec.modals).toHaveLength(1);
    const add = press({ customId: `gc:list:${list.id}:modal`, kind: 'modal', userId: b, channelId: chat, fields: { items: 'Milk\n- Eggs\n\n*Bread*' } }); await add.run();
    const t = textOf(add.rec.updates[0]);
    expect(t).toContain('⬜ Milk'); expect(t).toContain('⬜ Eggs'); expect(t).toContain('⬜ \\*Bread\\*'); // markdown typed in an item is shown as typed
    expect(ids(add.rec.updates[0])[0]).toBe(`gc:list:${list.id}:tick`);

    const items = await store.listItems(list.id);
    const tick = press({ customId: `gc:list:${list.id}:tick`, kind: 'select', userId: a, channelId: chat, values: [String(items[1]!.id)] }); await tick.run();
    expect(textOf(tick.rec.updates[0])).toContain('✅ ~~Eggs~~');
    const clear = press({ customId: `gc:list:${list.id}:clear`, userId: a, channelId: chat }); await clear.run();
    expect(textOf(clear.rec.updates[0])).not.toContain('Eggs'); expect((await store.listItems(list.id)).map(x => x.text)).toEqual(['Milk', '*Bread*']);

    await store.toggleItems(list.id, (await store.listItems(list.id)).map(x => x.id)); await store.clearDone(list.id);
    const del = press({ customId: `gc:list:${list.id}:clear`, userId: a, channelId: chat }); await del.run();
    expect(textOf(del.rec.updates[0])).toContain('Deleted by'); expect(await store.getList(list.id)).toBeNull();
    const stale = press({ customId: `gc:list:${list.id}:refresh`, userId: a, channelId: chat }); await stale.run();
    expect(textOf(stale.rec.updates[0])).toContain('List deleted');
  });
  test('names are case-insensitive and limits are kept', async () => {
    const chat = gdm(), u = uid();
    const l = await store.openList(chat, 'Movies', u);
    expect((await store.openList(chat, 'MOVIES', u)).id).toBe(l.id);
    await expect(store.addItems(l.id, 'x'.repeat(store.MAX_ITEM_LEN + 1), u)).rejects.toThrow('characters');
    await expect(store.addItems(l.id, '   \n  ', u)).rejects.toThrow('Type something');
    await store.addItems(l.id, Array.from({ length: store.MAX_ITEMS }, (_, k) => `m${k}`).join('\n'), u);
    await expect(store.addItems(l.id, 'one too many', u)).rejects.toThrow(`up to ${store.MAX_ITEMS}`);
    for (let k = 1; k < store.MAX_LISTS; k++) await store.openList(chat, `L${k}`, u);
    await expect(store.openList(chat, 'Another', u)).rejects.toThrow(`${store.MAX_LISTS} lists`);
  });
});

describe('party games and picking', () => {
  test('never have I ever: answers toggle and show who; Next posts a new prompt', async () => {
    const chat = gdm(), a = uid(), b = uid();
    const fi = inGroup({ channelId: chat, userId: a, group: 'party', sub: 'neverhaveiever' });
    await commands.get('community')!.run!(fi.interaction);
    const id = ids(fi.last())[0]!; const k = Number(id.split(':')[2]);
    expect(textOf(fi.last())).toContain(NEVER[k]!);
    const msg = `nhie-${++n}`;
    const v1 = press({ customId: `gc:nhie:${k}:have`, userId: a, channelId: chat, messageId: msg }); await v1.run();
    const v2 = press({ customId: `gc:nhie:${k}:never`, userId: b, channelId: chat, messageId: msg }); await v2.run();
    expect(textOf(v2.rec.updates[0])).toContain(`**I have (1):** <@${a}>`); expect(textOf(v2.rec.updates[0])).toContain(`**Never (1):** <@${b}>`);
    const undo = press({ customId: `gc:nhie:${k}:have`, userId: a, channelId: chat, messageId: msg }); await undo.run();
    expect(textOf(undo.rec.updates[0])).toContain('**I have (0):**');
    const next = press({ customId: `gc:nhie:${k}:next`, userId: b, channelId: chat }); await next.run();
    expect(next.rec.replies).toHaveLength(1); expect(ids(next.rec.replies[0])[0]).not.toBe(`gc:nhie:${k}:have`);
  });
  test('would you rather votes with buttons (reactions don\'t work in group chats)', async () => {
    const chat = gdm(), a = uid();
    const fi = inGroup({ channelId: chat, userId: a, group: 'party', sub: 'wouldyourather' });
    await commands.get('community')!.run!(fi.interaction);
    const k = Number(ids(fi.last())[0]!.split(':')[1]);
    const msg = `wyr-${++n}`;
    const v = press({ customId: `wyr:${k}:b`, userId: a, channelId: chat, messageId: msg }); await v.run();
    expect(textOf(v.rec.updates[0])).toContain(`**${WOULD_YOU_RATHER[k]![1]}** (1)\n<@${a}>`);
  });
  test('truth or dare: the presser gets the prompt', async () => {
    const chat = gdm(), a = uid();
    const p = press({ customId: 'gc:tod:dare', userId: a, channelId: chat }); await p.run();
    expect(textOf(p.rec.replies[0])).toContain(`<@${a}>, your dare`);
  });
  test('pick: splits choices, picks distinct ones, and Pick again needs no storage', async () => {
    expect(splitChoices('pizza, sushi or tacos\nPizza; ramen | curry')).toEqual(['pizza', 'sushi', 'tacos', 'ramen', 'curry']);
    const two = pickSome(['a', 'b', 'c'], 2);
    expect(two).toHaveLength(2); expect(new Set(two).size).toBe(2); expect(pickSome(['a', 'b'], 9)).toHaveLength(2);
    const chat = gdm(), u = uid();
    const fi = inGroup({ channelId: chat, userId: u, group: 'party', sub: 'pick', options: { options: 'pizza, sushi, tacos' } });
    await commands.get('community')!.run!(fi.interaction);
    expect(['pizza', 'sushi', 'tacos'].some(c => textOf(fi.last()).includes(`## ${c}`))).toBe(true);
    expect(ids(fi.last())).toEqual(['gc:pick:1:pizza|sushi|tacos']);
    const again = press({ customId: 'gc:pick:1:pizza|sushi|tacos', userId: u, channelId: chat }); await again.run();
    expect(textOf(again.rec.updates[0])).toContain('out of 3');
    const one = inGroup({ channelId: chat, userId: u, group: 'party', sub: 'pick', options: { options: 'only this' } });
    await commands.get('community')!.run!(one.interaction);
    expect(textOf(one.last())).toContain('at least two');
  });
});

describe('server-only features that now work in group chats', () => {
  test('reputation is kept per chat', async () => {
    const chat = gdm(), other = gdm(), a = uid(), b = uid();
    const give = inGroup({ channelId: chat, userId: a, group: 'reputation', sub: 'give', users: { user: { id: b, username: 'B' } } });
    await commands.get('community')!.run!(give.interaction);
    expect(textOf(give.last())).toContain('They now have **1** rep');
    expect((await udb.getReputation(chat, b))?.points).toBe(1); expect(await udb.getReputation(other, b)).toBeNull();
    const soon = inGroup({ channelId: chat, userId: a, group: 'reputation', sub: 'give', users: { user: { id: b, username: 'B' } } });
    await commands.get('community')!.run!(soon.interaction);
    expect(textOf(soon.last())).toContain('must wait');
  });
  test('no /community command refuses to run in a group chat, except levels and roles (which need a server)', async () => {
    const serverOnly = new Set(['/community rank', '/community level leaderboard', '/community roles self']);
    const refused: string[] = [];
    // Hermetic: the lookups among these (weather, free games, jokes…) get an instant network failure instead of a real request.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('offline in tests'); }) as unknown as typeof fetch;
    const realError = console.error; console.error = () => {};
    try {
      for (const name of ['community']) {
        const j = commands.get(name)!.data.toJSON() as { options?: { type: number; name: string; options?: { type: number; name: string }[] }[] };
        for (const o of j.options ?? []) {
          const leaves = o.type === 2 ? (o.options ?? []).map(s => [o.name, s.name] as const) : [[null, o.name] as const];
          for (const [group, sub] of leaves) {
            const fi = inGroup({ channelId: gdm(), userId: uid(), group, sub });
            await Promise.race([commands.get(name)!.run!(fi.interaction).catch(() => {}), new Promise(r => setTimeout(r, 200))]);
            if (/only works in a server/.test(fi.sent.map(textOf).join('\n'))) refused.push(`/${name}${group ? ` ${group}` : ''} ${sub}`);
          }
        }
      }
    } finally { globalThis.fetch = realFetch; console.error = realError; }
    expect(refused.sort()).toEqual([...serverOnly].sort());
  });
});

describe('reminders', () => {
  const reminder = { id: 1, user_id: 'r-user', channel_id: 'group-dm', guild_id: null, message: 'hi @everyone', fires_at: 0, created_at: 0 };
  test('go to the channel when the bot can post there, else to the person\'s DMs', async () => {
    const sent: { to: string; payload: any }[] = [];
    const bot = (channelOk: boolean, dmOk = true) => ({
      channels: { fetch: async () => (channelOk ? { isSendable: () => true, send: async (p: any) => { sent.push({ to: 'channel', payload: p }); } } : Promise.reject(new Error('Missing Access'))) },
      users: { fetch: async () => ({ send: async (p: any) => { if (!dmOk) throw new Error('Cannot send messages to this user'); sent.push({ to: 'dm', payload: p }); } }) },
    }) as any;
    expect(await deliverReminder(bot(true), reminder)).toBe('channel');
    expect(await deliverReminder(bot(false), reminder)).toBe('dm');
    expect(await deliverReminder(bot(false, false), reminder)).toBeNull();
    expect(sent.map(s => s.to)).toEqual(['channel', 'dm']);
    expect(sent[0]!.payload.allowedMentions).toEqual({ users: ['r-user'] }); // what someone typed into a reminder can't ping @everyone
  });
  test('/community reminder set in a group chat says it will come by DM', async () => {
    const fi = inGroup({ channelId: gdm(), userId: uid(), group: 'reminder', sub: 'set', options: { time: '10m', message: 'stretch' } });
    await commands.get('community')!.run!(fi.interaction);
    expect(textOf(fi.last())).toContain('in your DMs');
  });
});

describe('privacy', () => {
  test('/privacy delete removes your birthday, boards, plans, answers and votes, and detaches your list items', async () => {
    const chat = gdm(), u = uid(), other = uid();
    await store.setPersonalBirthday(u, 7, 7); await store.joinBoard(chat, 'birthday', u); await store.joinBoard(chat, 'timezone', u);
    const mine = await store.createPlan({ scope: chat, channelId: chat, title: 'Mine', startsAt: Date.now() + 3600_000, createdBy: u });
    await store.toggleRsvp(mine.id, other, 'going');
    const theirs = await store.createPlan({ scope: chat, channelId: chat, title: 'Theirs', startsAt: Date.now() + 3600_000, createdBy: other });
    await store.toggleRsvp(theirs.id, u, 'maybe');
    const list = await store.openList(chat, `Trip ${n}`, u); await store.addItems(list.id, 'Tent', u);
    await store.toggleVote('some-msg', u, 'a');
    await deleteData(u);
    expect(await store.getPersonalBirthday(u)).toBeNull();
    expect(await store.onBoard(chat, 'birthday', u)).toBe(false); expect(await store.onBoard(chat, 'timezone', u)).toBe(false);
    expect(await store.getPlan(mine.id)).toBeNull(); expect(await store.getPlan(theirs.id)).not.toBeNull();
    expect(await store.planRsvps(theirs.id)).toEqual([]);
    expect(await store.votesOn('some-msg')).toEqual([]);
    const items = await store.listItems(list.id);
    expect(items.map(x => x.text)).toEqual(['Tent']); expect(items[0]!.added_by).toBeNull(); expect((await store.getList(list.id))!.created_by).toBeNull();
    expect(((await db`SELECT COUNT(*) AS n FROM group_plan_rsvps WHERE plan_id = ${mine.id}`) as { n: number }[])[0]!.n).toBe(0);
  });
});
