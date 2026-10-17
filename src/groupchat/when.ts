import { parseDuration } from '../framework/duration.js';

/**
 * Reads a time the way people type it in a chat: "friday 8pm", "tomorrow 19:30", "sat morning", "in 2 hours", "dec 20", "2026-12-20 18:00"
 * or a Discord timestamp, in the timezone of the person typing it. Discord then shows the result to everyone in their own timezone.
 */

export interface When {
  at: number;
  /** False when only a day was given (it is then that day at noon, shown as a date). */
  hasTime: boolean;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Words that set a time of day when no clock time is given. */
const PART_OF_DAY: Record<string, number> = { morning: 9, afternoon: 15, evening: 19, tonight: 20 };

/** The wall-clock date and time in `zone` at instant `t` (month 1–12). */
export function zonedParts(t: number, zone: string): { y: number; m: number; d: number; h: number; mi: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute) };
}

/** The instant at which the clock in `zone` reads y-m-d h:mi (month 1–12). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, zone: string): number {
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let k = 0; k < 3; k++) {
    const p = zonedParts(t, zone);
    const diff = want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    if (!diff) break;
    t += diff;
  }
  return t;
}

const monthOf = (w: string) => (w.length >= 3 ? MONTHS.findIndex(m => m.startsWith(w)) + 1 : 0);
const weekdayOf = (w: string) => (w.length >= 3 ? WEEKDAYS.findIndex(d => d.startsWith(w)) : -1);
const validDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
const addDays = (y: number, m: number, d: number, n: number) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

/**
 * `dayFirst` reads 03/04 as 3 April (most of the world) instead of March 4 (the US). Returns null for anything it can't read fully —
 * a word left over means it would be guessing.
 */
export function parseWhen(input: string, zone: string, now = Date.now(), dayFirst = false): When | null {
  let s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s || s.length > 60) return null;

  const stamp = /^<t:(-?\d{1,13})(?::[a-z])?>$/i.exec(s);
  if (stamp) return { at: Number(stamp[1]) * 1000, hasTime: true };
  if (/^\d{10}$/.test(s)) return { at: Number(s) * 1000, hasTime: true };
  if (s === 'now') return { at: now, hasTime: true };
  const rel = parseDuration(s.replace(/^in /, '').replace(/ from now$/, ''));
  if (rel) return { at: now + rel, hasTime: true };

  s = ` ${s.replace(/,/g, ' ')} `.replace(/ (at|on|this|the|@)(?= )/g, '');
  /** Removes the first match of `re` (if `ok` accepts it) and returns it. */
  const take = (re: RegExp, ok: (m: RegExpExecArray) => boolean = () => true): RegExpExecArray | null => {
    const m = re.exec(s);
    if (!m || !ok(m)) return null;
    s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
    return m;
  };

  // "tonight" is today, in the evening.
  let partOfDay: number | null = null;
  if (take(/ tonight /)) { partOfDay = PART_OF_DAY.tonight!; s += ' today '; }

  // ── The time of day ──
  let hour: number | null = null, minute = 0;
  let m = take(/ (\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.|a|p) /);
  if (m) {
    const h = Number(m[1]); minute = Number(m[2] ?? 0);
    if (h < 1 || h > 12) return null;
    hour = (h % 12) + (m[3]!.startsWith('p') ? 12 : 0);
  } else if ((m = take(/ (\d{1,2}):(\d{2}) /))) {
    hour = Number(m[1]); minute = Number(m[2]);
  } else if ((m = take(/ (noon|midday|midnight) /))) {
    hour = m[1] === 'midnight' ? 0 : 12;
  }
  if (hour !== null && (hour > 23 || minute > 59)) return null;
  if ((m = take(/ (morning|afternoon|evening) /))) partOfDay = PART_OF_DAY[m[1]!]!;

  // ── The day ──
  const today = zonedParts(now, zone);
  let date: { y: number; m: number; d: number } | null = null;
  let weekday = -1, next = false, yearGiven = false;

  if ((m = take(/ (\d{4})-(\d{1,2})-(\d{1,2}) /))) {
    date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }; yearGiven = true;
  } else if ((m = take(/ (\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))? /))) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    date = { y: m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : today.y, m: dayFirst ? b : a, d: dayFirst ? a : b }; yearGiven = !!m[3];
  } else if ((m = take(/ ([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))? /, x => monthOf(x[1]!) > 0))) {
    date = { y: m[3] ? Number(m[3]) : today.y, m: monthOf(m[1]!), d: Number(m[2]) }; yearGiven = !!m[3];
  } else if ((m = take(/ (\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]{3,9})\.?(?: (\d{4}))? /, x => monthOf(x[2]!) > 0))) {
    date = { y: m[3] ? Number(m[3]) : today.y, m: monthOf(m[2]!), d: Number(m[1]) }; yearGiven = !!m[3];
  } else if (take(/ today /)) {
    date = { y: today.y, m: today.m, d: today.d };
  } else if (take(/ (tomorrow|tomorow|tmrw|tmr|tmw) /)) {
    date = addDays(today.y, today.m, today.d, 1);
  } else if ((m = take(/ (next )?([a-z]{3,9}) /, x => weekdayOf(x[2]!) >= 0))) {
    weekday = weekdayOf(m[2]!); next = !!m[1];
  }
  if (date && !validDate(date.y, date.m, date.d)) return null;
  if (s.trim()) return null; // something we couldn't read
  if (!date && weekday < 0 && hour === null && partOfDay === null) return null;

  // An evening word with a small clock time ("tonight 9:30") means the evening one.
  if (partOfDay !== null && partOfDay >= 15 && hour !== null && hour < 12) hour += 12;
  const hasTime = hour !== null || partOfDay !== null;
  const h = hour ?? partOfDay ?? 12, mi = hour !== null ? minute : 0;
  const at = (d: { y: number; m: number; d: number }) => zonedToUtc(d.y, d.m, d.d, h, mi, zone);

  if (weekday >= 0) {
    const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    let delta = (weekday - dow + 7) % 7;
    if (delta === 0 && (next || (hasTime && at(today) <= now))) delta = 7;
    return { at: at(addDays(today.y, today.m, today.d, delta)), hasTime };
  }
  if (!date) {
    // Only a time: today, or tomorrow once it has passed.
    const t = at(today);
    return { at: t > now ? t : at(addDays(today.y, today.m, today.d, 1)), hasTime };
  }
  // A day with no year that has already gone by this year means next year's.
  if (!yearGiven && at(date) < now - 86_400_000) date = { ...date, y: date.y + 1 };
  if (!validDate(date.y, date.m, date.d)) return null;
  return { at: at(date), hasTime };
}
