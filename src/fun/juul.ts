import { db } from '../utils/db.js';
import { withLock } from '../framework/mutex.js';
import { pick } from '../lookups/textfun.js';

/**
 * /juul — a joke virtual vape. Purely fictional: a battery that drains, puffs that count up, a flavour and a colour.
 * State is per user (global, not per server). Charging is lazy: we store when it started and work out the level on demand.
 */

export const MAX_BATTERY = 50;
/** 6 s per battery point → empty to full in 5 minutes. */
export const CHARGE_MS_PER_POINT = 6_000;

/** Heist's pods, in Heist's order. */
export const FLAVORS = ['Classic Menthol', 'Cool Cucumber', 'Classic Tobacco', 'Mango', 'Virginia Tobacco', 'Cool Mint', 'Fruit Medley', 'Creme Brulee', 'THC', 'Lychee', 'Apple'] as const;
/** Heist's skins and the accent each one gives the juul's cards. */
export const SKINS: Record<string, number> = { Default: 0x99aab5, Chrome: 0xc0c0c0, 'Matte Black': 0x23272a, 'Rose Gold': 0xb76e79, 'Icy White': 0xe8f4f8, Stealth: 0x2c2f33 };
export const NAME_MAX = 32;
/** Kept so juuls customised before skins existed still read back; no longer offered. */
export const COLORS: Record<string, { label: string; hex: number }> = {
  silver: { label: 'Silver', hex: 0xc0c0c0 }, black: { label: 'Black', hex: 0x23272a }, blurple: { label: 'Blurple', hex: 0x5865f2 }, pink: { label: 'Pink', hex: 0xff69b4 },
  teal: { label: 'Teal', hex: 0x1abc9c }, gold: { label: 'Gold', hex: 0xf1c40f }, red: { label: 'Red', hex: 0xed4245 }, green: { label: 'Green', hex: 0x57f287 }, purple: { label: 'Purple', hex: 0x9b59b6 },
};

export interface Juul { user_id: string; battery: number; puffs: number; flavor: string; color: string; name: string | null; skin: string; charging_since: number | null; last_hit: number | null }

/** Battery right now, counting charge accrued since it was plugged in. */
export function effectiveBattery(j: Pick<Juul, 'battery' | 'charging_since'>, now: number): number {
  if (j.charging_since == null) return j.battery;
  return Math.min(MAX_BATTERY, j.battery + Math.floor((now - j.charging_since) / CHARGE_MS_PER_POINT));
}
export const fullAt = (j: Pick<Juul, 'battery' | 'charging_since'>, now: number): number =>
  (j.charging_since ?? now) + (MAX_BATTERY - j.battery) * CHARGE_MS_PER_POINT;

async function row(userId: string): Promise<Juul> {
  await db`INSERT OR IGNORE INTO juul_state (user_id) VALUES (${userId})`;
  return (await db`SELECT * FROM juul_state WHERE user_id = ${userId}`)[0] as Juul;
}

export async function getJuul(userId: string): Promise<Juul> { return row(userId); }

export type ChargeResult =
  | { kind: 'full'; battery: number }
  | { kind: 'started'; battery: number; fullAt: number }
  | { kind: 'charging'; battery: number; fullAt: number };

export function charge(userId: string, now = Date.now()): Promise<ChargeResult> {
  return withLock(`juul:${userId}`, async () => {
    const j = await row(userId);
    const b = effectiveBattery(j, now);
    if (b >= MAX_BATTERY) {
      await db`UPDATE juul_state SET battery = ${MAX_BATTERY}, charging_since = NULL WHERE user_id = ${userId}`;
      return { kind: 'full', battery: MAX_BATTERY } as const;
    }
    if (j.charging_since != null) return { kind: 'charging', battery: b, fullAt: fullAt(j, now) } as const;
    await db`UPDATE juul_state SET charging_since = ${now} WHERE user_id = ${userId}`;
    return { kind: 'started', battery: b, fullAt: now + (MAX_BATTERY - b) * CHARGE_MS_PER_POINT } as const;
  });
}

export const CLOUDS = [
  '💨 You rip it and blow a thick cloud.', '💨 A perfect smoke ring drifts away.', '💨 *cough* …that one hit different.', '💨 You exhale a cloud shaped suspiciously like a dragon.',
  '💨 Smooth. Way too smooth.', '💨 You blow it out the side of your mouth like a movie villain.', '💨 The cloud smells like {flavor}.', '💨 A small, polite puff.', '💨 You French inhale. Nobody asked.',
  '💨 Cloud so big the smoke alarm looked at you.', '💨 You did a little trick. It was not impressive.', '💨 {flavor} fills the room.',
];
export const MILESTONES: Record<number, string> = { 10: 'Ten puffs. A promising start.', 50: 'Fifty puffs! You\'re getting the hang of this.', 100: '💯 One hundred puffs. Maybe go touch some grass?', 500: '🏆 500 puffs. The cloud remembers you.', 1000: '👑 1,000 puffs. Legendary lung capacity (fictional).' };

export type HitResult =
  | { ok: true; puffs: number; battery: number; flavor: string; color: string; cloud: string; milestone?: string; unplugged: boolean }
  | { ok: false; reason: 'dead'; battery: number; charging: boolean; fullAt?: number };

export function hit(userId: string, now = Date.now(), r: () => number = Math.random): Promise<HitResult> {
  return withLock(`juul:${userId}`, async () => {
    const j = await row(userId);
    const b = effectiveBattery(j, now);
    if (b <= 0) return { ok: false, reason: 'dead', battery: 0, charging: j.charging_since != null, fullAt: j.charging_since != null ? fullAt(j, now) : undefined } as const;
    const unplugged = j.charging_since != null;
    const left = b - 1, puffs = j.puffs + 1;
    await db`UPDATE juul_state SET battery = ${left}, puffs = ${puffs}, charging_since = NULL, last_hit = ${now} WHERE user_id = ${userId}`;
    const cloud = CLOUDS[Math.floor(r() * CLOUDS.length)]!.replace('{flavor}', j.flavor.toLowerCase());
    return { ok: true, puffs, battery: left, flavor: j.flavor, color: j.color, cloud, milestone: MILESTONES[puffs], unplugged } as const;
  });
}

export async function setFlavor(userId: string, flavor: string): Promise<void> {
  if (!(FLAVORS as readonly string[]).includes(flavor)) throw new Error('unknown flavor');
  await row(userId);
  await db`UPDATE juul_state SET flavor = ${flavor} WHERE user_id = ${userId}`;
}
export async function setColor(userId: string, color: string): Promise<void> {
  if (!Object.hasOwn(COLORS, color)) throw new Error('unknown color');
  await row(userId);
  await db`UPDATE juul_state SET color = ${color} WHERE user_id = ${userId}`;
}

/** Nickname (trimmed, no mentions/markdown that could ping or break the card; empty clears it) and/or skin. */
export async function customize(userId: string, o: { name?: string | null; skin?: string | null }): Promise<Juul> {
  await row(userId);
  if (o.skin != null) {
    if (!Object.hasOwn(SKINS, o.skin)) throw new Error('unknown skin');
    await db`UPDATE juul_state SET skin = ${o.skin} WHERE user_id = ${userId}`;
  }
  if (o.name != null) {
    const clean = o.name.replace(/[@#*_~`|<>\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    await db`UPDATE juul_state SET name = ${clean || null} WHERE user_id = ${userId}`;
  }
  return row(userId);
}

export const skinColor = (j: Pick<Juul, 'skin'>) => SKINS[j.skin] ?? SKINS.Default!;

/** Green / yellow / red square for the battery line. */
export const batteryDot = (level: number) => (level > MAX_BATTERY * 0.5 ? '🟩' : level > MAX_BATTERY * 0.2 ? '🟨' : '🟥');

export async function topPuffers(limit = 10): Promise<{ user_id: string; puffs: number }[]> {
  return (await db`SELECT user_id, puffs FROM juul_state WHERE puffs > 0 ORDER BY puffs DESC, user_id LIMIT ${limit}`) as { user_id: string; puffs: number }[];
}

/** Anything a user can do to erase their juul (used by /mydata delete). */
export async function deleteJuul(userId: string): Promise<void> { await db`DELETE FROM juul_state WHERE user_id = ${userId}`; }

/** ▰▰▰▱▱ style battery bar. */
export function batteryBar(level: number, width = 10): string {
  const on = Math.round((Math.max(0, Math.min(MAX_BATTERY, level)) / MAX_BATTERY) * width);
  return '▰'.repeat(on) + '▱'.repeat(width - on);
}

export const randomFlavor = () => pick(FLAVORS);
