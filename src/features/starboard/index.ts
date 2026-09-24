import { MessageReaction, PartialMessageReaction, User, PartialUser, EmbedBuilder, Colors, TextChannel } from 'discord.js';
import * as db from '../../utils/db';

async function handleStarReaction(
  reaction: MessageReaction | PartialMessageReaction,
  _user: User | PartialUser,
) {
  if (!reaction.message.guildId) return;

  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  if (reaction.message.partial) { try { await reaction.message.fetch(); } catch { return; } }

  const guild = reaction.message.guild!;
  const config = await db.getStarboardConfig(guild.id);
  if (!config || !config.enabled || !config.channel_id) return;

  const configEmoji = config.emoji;
  const reactionEmoji = reaction.emoji.id
    ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
    : (reaction.emoji.name ?? '');

  if (reactionEmoji !== configEmoji) return;

  const msg = reaction.message;
  // Don't star messages in the starboard channel itself
  if (msg.channelId === config.channel_id) return;

  const starCount = reaction.count ?? 0;
  const starboardChannel = guild.channels.cache.get(config.channel_id) as TextChannel | null;
  if (!starboardChannel?.isTextBased()) return;

  const existing = await db.getStarboardPost(guild.id, msg.id);

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setAuthor({ name: msg.author?.username ?? 'Unknown', iconURL: msg.author?.displayAvatarURL() })
    .setDescription(msg.content || null)
    .addFields({ name: 'Source', value: `[Jump to message](${msg.url}) in <#${msg.channelId}>` })
    .setTimestamp(msg.createdAt);

  if (msg.attachments.size > 0) {
    const img = [...msg.attachments.values()].find(a => a.contentType?.startsWith('image/'));
    if (img) embed.setImage(img.url);
  }

  const content = `${configEmoji} **${starCount}** — <#${msg.channelId}>`;

  if (existing) {
    // Update star count on the existing starboard post
    await db.updateStarboardPostStars(guild.id, msg.id, starCount);
    const sbMsg = await starboardChannel.messages.fetch(existing.starboard_message_id).catch(() => null);
    if (sbMsg) await sbMsg.edit({ content, embeds: [embed] }).catch(() => {});
  } else if (starCount >= config.threshold) {
    // Post for the first time
    const sbMsg = await (starboardChannel as TextChannel).send({ content, embeds: [embed] }).catch(() => null);
    if (sbMsg) {
      await db.createStarboardPost(guild.id, msg.id, sbMsg.id, starCount);
    }
  }
}

const starboardModule = {
  name: 'starboard',
  handlers: {
    messageReactionAdd: async ({ data: [reaction, user] }: { data: [MessageReaction | PartialMessageReaction, User | PartialUser] }) => {
      await handleStarReaction(reaction, user);
    },
    messageReactionRemove: async ({ data: [reaction, user] }: { data: [MessageReaction | PartialMessageReaction, User | PartialUser] }) => {
      await handleStarReaction(reaction, user);
    },
  },
};

export default starboardModule;
