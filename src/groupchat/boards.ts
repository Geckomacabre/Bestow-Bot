import { ActionRowBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { onComponent, type ComponentInteraction } from '../framework/router.js';
import * as db from '../utils/db.js';
import { resolveZone, validZone } from '../commands/utility/timezone.js';
import { button, daysUntil, oops, ordinal, panel, repaint, row } from './panel.js';
import { placeName, placeOf, scopeOf, type Place, type Where } from './scope.js';
import * as store from './store.js';
import { zonedParts } from './when.js';

/**
 * The birthday board and the time board: one shared message per chat that lists everyone who added themselves, with buttons to add
 * yourself (a pop-up asks for your birthday or timezone the first time), refresh it, or take yourself off.
 *  • In a group chat or DM, the board shows the people who pressed "Add me" there, using the birthday / timezone they saved once.
 *  • In a server, the birthday board is the server's own birthday list (the one /server birthdays announces), and the time board
 *    also includes anyone who set a time for that server with /config timezone.
 */

const GOLD = 0xf1c40f;
const CLOCK = 0x5865f2;

export interface BoardWhere { scope: string; place: Place; guildId: string | null }
export const whereOf = (i: Where): BoardWhere => ({ scope: scopeOf(i), place: placeOf(i), guildId: i.guildId });

// ─── Birthday board ───────────────────────────────────────────────────────────

async function boardBirthdays(w: BoardWhere): Promise<(store.Birthday & { user_id: string })[]> {
  return w.guildId ? db.getBirthdays(w.guildId) : store.chatBirthdays(w.scope);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function birthdayBoard(w: BoardWhere, now = Date.now()): Promise<any> {
  const list = (await boardBirthdays(w))
    .map(b => ({ ...b, days: daysUntil(b.month, b.day, now) }))
    .sort((a, b) => a.days - b.days || a.user_id.localeCompare(b.user_id));
  const today = list.filter(b => b.days === 0);
  const soon = list.filter(b => b.days > 0).slice(0, 20);
  const lines: string[] = [];
  if (today.length) lines.push(`🎉 **Today:** ${today.map(b => `<@${b.user_id}>`).join(', ')} — happy birthday!`, '');
  if (soon.length) {
    lines.push('**Coming up**');
    for (const b of soon) lines.push(`<@${b.user_id}> — **${store.MONTHS[b.month - 1]} ${ordinal(b.day)}** · ${b.days === 1 ? 'tomorrow' : `in ${b.days} days`}`);
    if (list.length - today.length > soon.length) lines.push(`…and ${list.length - today.length - soon.length} more`);
  }
  if (!list.length) lines.push('Nobody has added their birthday here yet.', 'Press **🎂 Add mine**: it asks for the day once, then shows it here.');
  const n = list.length;
  return panel({
    title: `🎂 Birthdays in ${placeName(w.place)}`,
    body: lines.join('\n'),
    footer: `${n} ${n === 1 ? 'person' : 'people'} · ${w.guildId ? 'Anyone in this server can add theirs.' : 'Your birthday only shows in the chats you add it to.'}`,
    color: GOLD,
    rows: [row(
      button('gc:bday:add', 'Add mine', ButtonStyle.Primary, '🎂'),
      button('gc:bday:refresh', 'Refresh', ButtonStyle.Secondary, '🔄'),
      button('gc:bday:leave', 'Remove me', ButtonStyle.Secondary),
    )],
  });
}

const birthdayModal = () => new ModalBuilder().setCustomId('gc:bday:modal').setTitle('Your birthday').addComponents(
  new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('month').setLabel('Month').setPlaceholder('May, or 5').setStyle(TextInputStyle.Short).setMaxLength(9).setRequired(true)),
  new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('day').setLabel('Day').setPlaceholder('17').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true)),
);

/** Saves someone's birthday and puts them on this chat's board (a server's list, or the chat's board). */
export async function addBirthdayHere(w: BoardWhere, userId: string, month: number, day: number): Promise<store.Birthday> {
  const b = await store.setPersonalBirthday(userId, month, day);
  if (w.guildId) await db.setBirthday(w.guildId, userId, b.month, b.day);
  else await store.joinBoard(w.scope, 'birthday', userId);
  return b;
}

onComponent('gc:bday:', async i => {
  const w = whereOf(i);
  const action = i.customId.slice('gc:bday:'.length);
  if (action === 'add') {
    const saved = (w.guildId ? await db.getBirthday(w.guildId, i.user.id) : null) ?? await store.getPersonalBirthday(i.user.id);
    if (!saved) { if (i.isButton()) await i.showModal(birthdayModal()); return; }
    await addBirthdayHere(w, i.user.id, saved.month, saved.day);
  } else if (action === 'modal' && i.isModalSubmit()) {
    const month = store.parseMonth(i.fields.getTextInputValue('month'));
    const day = Number(i.fields.getTextInputValue('day').trim());
    if (!month) return oops(i, 'I couldn\'t read that month. Type a name like "May" or a number from 1 to 12.');
    try { await addBirthdayHere(w, i.user.id, month, day); } catch (e) {
      if (e instanceof store.GroupError) return oops(i, e.message);
      throw e;
    }
  } else if (action === 'leave') {
    if (w.guildId) await db.removeBirthday(w.guildId, i.user.id);
    else await store.leaveBoard(w.scope, 'birthday', i.user.id);
  } else if (action !== 'refresh') return;
  await repaint(i, await birthdayBoard(w));
});

// ─── Time board ───────────────────────────────────────────────────────────────

/** "UTC", "UTC+2", "UTC-3:30". */
export function offsetLabel(minutes: number): string {
  if (!minutes) return 'UTC';
  const a = Math.abs(minutes);
  return `UTC${minutes > 0 ? '+' : '-'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

/** Minutes the clock in `zone` is ahead of UTC at `now`. */
export function offsetMinutes(zone: string, now = Date.now()): number {
  const p = zonedParts(now, zone);
  const minute = Math.floor(now / 60_000) * 60_000;
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - minute) / 60_000);
}

const cityOf = (zone: string) => zone.split('/').at(-1)!.replace(/_/g, ' ');

async function boardZones(w: BoardWhere): Promise<{ user_id: string; timezone: string }[]> {
  const mine = await store.chatTimezones(w.scope);
  if (!w.guildId) return mine;
  // A server's /config timezone entries too; a person's own saved timezone wins.
  const seen = new Set(mine.map(r => r.user_id));
  return [...mine, ...(await db.getGuildTimezones(w.guildId)).filter(r => !seen.has(r.user_id))];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function timeBoard(w: BoardWhere, now = Date.now()): Promise<any> {
  const groups = new Map<number, { zones: Set<string>; users: string[] }>();
  for (const r of await boardZones(w)) {
    if (!validZone(r.timezone)) continue;
    const off = offsetMinutes(r.timezone, now);
    const g = groups.get(off) ?? { zones: new Set<string>(), users: [] };
    g.zones.add(cityOf(r.timezone)); g.users.push(r.user_id);
    groups.set(off, g);
  }
  const lines = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([off, g]) => {
    const clock = new Date(now + off * 60_000);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true }).format(clock);
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(clock);
    const cities = [...g.zones].slice(0, 3).join(', ') + (g.zones.size > 3 ? '…' : '');
    return `\`${time}\` ${day} · **${offsetLabel(off)}** (${cities}) — ${g.users.map(u => `<@${u}>`).join(' ')}`;
  });
  const people = [...groups.values()].reduce((n, g) => n + g.users.length, 0);
  return panel({
    title: `🕒 Times in ${placeName(w.place)}`,
    body: lines.length ? lines.join('\n') : 'Nobody here has added their time yet.\nPress **🕒 Add me**: it asks for your timezone once (a city is fine).',
    footer: `${people} ${people === 1 ? 'person' : 'people'} · Updated <t:${Math.floor(now / 1000)}:R>, press 🔄 to update`,
    color: CLOCK,
    rows: [row(
      button('gc:tz:add', 'Add me', ButtonStyle.Primary, '🕒'),
      button('gc:tz:refresh', 'Refresh', ButtonStyle.Secondary, '🔄'),
      button('gc:tz:leave', 'Remove me', ButtonStyle.Secondary),
    )],
  });
}

const timezoneModal = () => new ModalBuilder().setCustomId('gc:tz:modal').setTitle('Your timezone').addComponents(
  new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('zone').setLabel('Timezone or city')
    .setPlaceholder('Tokyo, London, America/New_York, CET…').setStyle(TextInputStyle.Short).setMaxLength(64).setRequired(true)),
);

onComponent('gc:tz:', async (i: ComponentInteraction) => {
  const w = whereOf(i);
  const action = i.customId.slice('gc:tz:'.length);
  if (action === 'add') {
    if (!(await db.getTimezone(i.user.id))) { if (i.isButton()) await i.showModal(timezoneModal()); return; }
    await store.joinBoard(w.scope, 'timezone', i.user.id);
  } else if (action === 'modal' && i.isModalSubmit()) {
    const zone = resolveZone(i.fields.getTextInputValue('zone'));
    if (!zone) return oops(i, 'I don\'t know that timezone. Try a big city near you, like "Chicago" or "Berlin".');
    await db.setTimezone(i.user.id, zone);
    await store.joinBoard(w.scope, 'timezone', i.user.id);
  } else if (action === 'leave') {
    await store.leaveBoard(w.scope, 'timezone', i.user.id);
    if (w.guildId) await db.removeUserTimezone(w.guildId, i.user.id);
  } else if (action !== 'refresh') return;
  await repaint(i, await timeBoard(w));
});
