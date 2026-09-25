import { ComponentType, ContainerBuilder, type Interaction } from 'discord.js';
import { db } from '../utils/db.js';
import { premiumOf } from '../premium/index.js';
import { gateActive } from '../premium/wall.js';

/**
 * `/customize color`: a person's own accent color for the containers Bestow sends them.
 * Stored per user (a hex color, nothing else). When they run a command their reply/editReply/followUp are wrapped so every
 * container in the response takes their color. It's a Premium feature, so it stops applying if their Premium lapses.
 */

export async function initCustomizeSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS user_accent (
    user_id    TEXT    PRIMARY KEY,
    color      INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`;
}

export const HEX = /^#?([0-9a-f]{6})$/i;
/** "#ff8800" / "ff8800" → 0xff8800, or null. */
export function parseColor(input: string): number | null {
  const m = HEX.exec(input.trim());
  return m ? parseInt(m[1]!, 16) : null;
}
export const toHex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export async function getAccent(userId: string): Promise<number | null> {
  const r = (await db`SELECT color FROM user_accent WHERE user_id = ${userId}`) as { color: number }[];
  return r[0]?.color ?? null;
}
export async function setAccent(userId: string, color: number, now = Date.now()): Promise<void> {
  await db`INSERT INTO user_accent (user_id, color, updated_at) VALUES (${userId}, ${color}, ${now}) ON CONFLICT (user_id) DO UPDATE SET color = ${color}, updated_at = ${now}`;
}
export async function clearAccent(userId: string): Promise<boolean> {
  return ((await db`DELETE FROM user_accent WHERE user_id = ${userId} RETURNING 1`) as unknown[]).length > 0;
}

type Payload = { components?: unknown[] } | string | null | undefined;

/** Gives every container in a message payload the accent color (builders and raw JSON alike). Mutates and returns the payload. */
export function recolor<T extends Payload>(payload: T, color: number): T {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.components)) return payload;
  for (const c of payload.components as unknown[]) {
    if (c instanceof ContainerBuilder) c.setAccentColor(color);
    else if (c && typeof c === 'object' && (c as { type?: number }).type === ComponentType.Container) (c as { accent_color?: number }).accent_color = color;
  }
  return payload;
}

/** Wraps the interaction's reply methods so the person's accent color is applied. Does nothing for people without one. */
export async function useAccent(i: Interaction): Promise<void> {
  if (!('reply' in i) || !('user' in i)) return;
  const color = await getAccent(i.user.id);
  if (color == null) return;
  if (gateActive() && !(await premiumOf(i as unknown as Parameters<typeof premiumOf>[0])).premium) return;
  const target = i as unknown as Record<string, (p: Payload) => Promise<unknown>>;
  for (const k of ['reply', 'editReply', 'followUp'] as const) {
    const orig = target[k]?.bind(i);
    if (orig) target[k] = (p: Payload) => orig(recolor(p, color));
  }
}
