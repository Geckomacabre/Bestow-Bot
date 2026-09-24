import { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import * as db from '../../utils/db';

async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  add: boolean,
) {
  if (user.bot) return;
  if (!reaction.message.guildId) return;

  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  if (reaction.message.partial) { try { await reaction.message.fetch(); } catch { return; } }

  const guild = reaction.message.guild;
  if (!guild) return;

  const emoji = reaction.emoji.id
    ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
    : (reaction.emoji.name ?? '');

  const rules = await db.getReactionRolesForMessage(guild.id, reaction.message.id);
  const rule = rules.find(r => r.emoji === emoji);
  if (!rule) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const role = guild.roles.cache.get(rule.role_id);
  if (!role) return;

  if (add) {
    await member.roles.add(role).catch(() => {});
  } else {
    await member.roles.remove(role).catch(() => {});
  }
}

const reactionRolesModule = {
  name: 'reactionroles',
  handlers: {
    messageReactionAdd: async ({ data: [reaction, user] }: { data: [MessageReaction | PartialMessageReaction, User | PartialUser] }) => {
      await handleReaction(reaction, user, true);
    },
    messageReactionRemove: async ({ data: [reaction, user] }: { data: [MessageReaction | PartialMessageReaction, User | PartialUser] }) => {
      await handleReaction(reaction, user, false);
    },
  },
};

export default reactionRolesModule;
