import type { ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction, UserSelectMenuInteraction } from 'discord.js';

/**
 * Buttons, select menus and modals are routed by the prefix of their customId ("tags:edit:…" → the handler registered for "tags:").
 * Modules register at import time, so a feature's components live next to the command that creates them.
 */

export type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | ModalSubmitInteraction;
type Handler = (i: ComponentInteraction) => Promise<unknown>;

const routes = new Map<string, Handler>();

export function onComponent(prefix: string, handler: Handler): void {
  if (!prefix.endsWith(':')) throw new Error(`[router] prefix "${prefix}" must end with ":"`);
  if (routes.has(prefix)) throw new Error(`[router] prefix "${prefix}" is already registered`);
  routes.set(prefix, handler);
}

/** The handler for a customId, if any (longest matching prefix wins). */
export function routeFor(customId: string): Handler | undefined {
  let best: string | undefined;
  for (const p of routes.keys()) if (customId.startsWith(p) && (!best || p.length > best.length)) best = p;
  return best ? routes.get(best) : undefined;
}
