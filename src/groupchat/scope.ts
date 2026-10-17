import { ApplicationIntegrationType, ChannelType, InteractionContextType, type APIAuthorizingIntegrationOwnersMap } from 'discord.js';

/**
 * Bestow is mostly used where it is NOT a server bot: group chats, DMs, and servers it was only added to someone's account for.
 * There it can answer commands and buttons, but it can't read the chat or post in it by itself. Features that keep data for
 * "this chat" key it with scopeOf(): a server keeps its data per server (as it always has), and a DM or group chat — which has no
 * server — keys it by its channel. Server ids and channel ids are both snowflakes, so the two never clash.
 */

export interface Where {
  guildId: string | null;
  channelId: string | null;
  context?: InteractionContextType | null;
  channel?: { type?: ChannelType } | null;
  authorizingIntegrationOwners?: APIAuthorizingIntegrationOwnersMap;
}

export const scopeOf = (i: Pick<Where, 'guildId' | 'channelId'>): string => i.guildId ?? i.channelId ?? '';

export type Place = 'server' | 'group' | 'dm';

/** A DM is the bot's own DMs or a 1:1 DM between two people; Discord calls both of those and group chats "private channels". */
export function placeOf(i: Pick<Where, 'guildId' | 'context' | 'channel'>): Place {
  if (i.guildId) return 'server';
  return i.context === InteractionContextType.BotDM || i.channel?.type === ChannelType.DM ? 'dm' : 'group';
}

/** "this server", "this group chat", "this DM". */
export const placeName = (p: Place): string => (p === 'server' ? 'this server' : p === 'dm' ? 'this DM' : 'this group chat');

/**
 * Whether the bot can send a message to this channel on its own later (a reminder, an announcement): in its DMs, and in servers it
 * was added to as a bot. Not in group chats, and not in servers where it is only installed on someone's account.
 */
export function botCanPost(i: Where): boolean {
  if (i.context === InteractionContextType.BotDM) return true;
  if (!i.guildId) return false;
  const owners = i.authorizingIntegrationOwners;
  return !owners || owners[ApplicationIntegrationType.GuildInstall] !== undefined;
}
