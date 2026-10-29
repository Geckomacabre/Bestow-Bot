import { MessageFlags, MessageReaction, PartialMessageReaction, User, PartialUser, TextChannel } from 'discord.js';
import { card } from '../../lookups/card.js';
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

  const img = [...msg.attachments.values()].find(a => a.contentType?.startsWith('image/'));
  const post = card({
    lead: `${configEmoji} **${starCount}** · <#${msg.channelId}>`, color: 0xfee75c,
    author: { name: msg.member?.displayName ?? msg.author?.username ?? 'Unknown', icon: msg.author?.displayAvatarURL() },
    description: msg.content || null, image: img?.url, timestamp: msg.createdAt,
    links: [{ label: 'Jump to message', url: msg.url }],
  });

  if (existing) {
    // Update star count on the existing starboard post. One posted before the cards were cv2 is an embed: the edit turns it into a
    // card, clearing its old text and embed (Discord lets an edit add the cv2 flag, never take it away).
    await db.updateStarboardPostStars(guild.id, msg.id, starCount);
    const sbMsg = await starboardChannel.messages.fetch(existing.starboard_message_id).catch(() => null);
    if (sbMsg) await sbMsg.edit(sbMsg.flags.has(MessageFlags.IsComponentsV2) ? post : { ...post, content: null, embeds: [] }).catch(() => {});
  } else if (starCount >= config.threshold) {
    // Post for the first time
    const sbMsg = await (starboardChannel as TextChannel).send(post).catch(() => null);
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
