import type { AutocompleteInteraction } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { card } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { findTimezoneMatch, offsetToString, searchTimezones } from '../../features/timezone/index.js';
import * as db from '../../utils/db.js';

/** A person's own timezone (the `timezones` table), usable anywhere — separate from a server's /config timezone board. */

export function validZone(name: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: name }); return true; } catch { return false; }
}

/** "America/New_York", a city, an abbreviation or an offset → an IANA zone name. */
export function resolveZone(input: string): string | null {
  const q = input.trim();
  if (!q) return null;
  if (validZone(q) && q.includes('/')) return q;
  const m = findTimezoneMatch(q);
  return m && validZone(m.name) ? m.name : (validZone(q) ? q : null);
}

export function describeTime(zone: string, now = new Date()): { time: string; date: string; offset: string } {
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
  const date = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value ?? '';
  return { time, date, offset: offset.replace('GMT', 'UTC') || 'UTC' };
}

async function zoneAutocomplete(i: AutocompleteInteraction) {
  const q = String(i.options.getFocused());
  const list = q.trim() ? searchTimezones(q) : searchTimezones('').filter(t => t.popular);
  await i.respond(list.slice(0, 25).map(t => ({ name: `${t.name.replace(/_/g, ' ')} (${offsetToString(t.offset)})`.slice(0, 100), value: t.name })));
}

const CLOCK = 0x5865f2;

export default hgroup({
  name: 'timezone',
  subs: [
    hsub('timezone set', lookup(async i => {
      const zone = resolveZone(i.options.getString('timezone', true));
      if (!zone) throw new LookupError('I don\'t know that timezone. Pick one from the list, or type a city like "Tokyo".');
      await db.setTimezone(i.user.id, zone);
      const t = describeTime(zone);
      await i.editReply(card({ title: '🕒 Timezone saved', color: CLOCK, description: `Your timezone is now **${zone.replace(/_/g, ' ')}** (${t.offset}).\nIt's **${t.time}** on ${t.date} there.`, footer: 'Others can see your time with /timezone view. Remove it any time with /privacy delete.' }));
    }), { autocomplete: zoneAutocomplete, tweaks: { timezone: { autocomplete: true, maxLength: 64 } } }),
    hsub('timezone view', lookup(async i => {
      const typed = i.options.getString('timezone');
      const user = i.options.getUser('user');
      let zone: string | null = null, who: string | null = null;
      if (typed) {
        zone = resolveZone(typed);
        if (!zone) throw new LookupError('I don\'t know that timezone.');
      } else {
        const target = user ?? i.user;
        zone = (await db.getTimezone(target.id))?.timezone ?? null;
        who = target.id === i.user.id ? 'You' : (target.displayName ?? target.username);
        if (!zone) throw new LookupError(target.id === i.user.id ? 'You haven\'t set a timezone yet — use `/timezone set`.' : `**${who}** hasn't set a timezone.`);
      }
      const t = describeTime(zone);
      await i.editReply(card({
        title: `🕒 ${t.time}`, color: CLOCK,
        description: `${who ? `${who === 'You' ? 'Your' : `**${who}**'s`} time · ` : ''}**${zone.replace(/_/g, ' ')}** (${t.offset})\n${t.date}`,
      }));
    }), { autocomplete: zoneAutocomplete, tweaks: { timezone: { autocomplete: true, maxLength: 64 } } }),
  ],
});
