import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { messageMenu } from '../../framework/menu.js';
import { generateQuote } from '../../utils/quote.js';
import { activeStyle } from '../../quotes/presets.js';

/** Right-click a message → Apps → Quote Message. */
export default messageMenu('Quote Message', async interaction => {
  const msg = interaction.targetMessage;
  if (!msg.content.trim()) {
    await interaction.reply({ content: '❌ That message has no text to quote.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  // Resolve Discord mentions; keep **bold** and *italic* for rendering, strip other formatting
  let text = msg.content;
  for (const [id, user] of msg.mentions.users) {
    const member = await interaction.guild?.members.fetch(id).catch(() => null);
    const name = member?.displayName ?? user.globalName ?? user.username;
    text = text.replace(new RegExp(`<@!?${id}>`, 'g'), `@${name}`);
  }
  for (const [id, role] of msg.mentions.roles) {
    text = text.replace(new RegExp(`<@&${id}>`, 'g'), `@${role.name}`);
  }
  for (const [id] of msg.mentions.channels) {
    const ch = interaction.guild?.channels.cache.get(id);
    text = text.replace(new RegExp(`<#${id}>`, 'g'), `#${(ch as any)?.name ?? 'channel'}`);
  }
  text = text
    .replace(/__(.*?)__/gs, '$1')
    .replace(/~~(.*?)~~/gs, '$1')
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
    .replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, '')
    .trim();

  const author = msg.author;
  let avatarUrl: string | null = null;
  if (interaction.inGuild()) {
    const member = await interaction.guild?.members.fetch(author.id).catch(() => null);
    avatarUrl = member?.displayAvatarURL({ size: 1024, extension: 'png' })
      ?? author.displayAvatarURL({ size: 1024, extension: 'png' });
  } else {
    avatarUrl = author.displayAvatarURL({ size: 1024, extension: 'png' });
  }

  // Pomelo accounts show @username; legacy accounts show username#discriminator
  const disc = author.discriminator;
  const handle = disc && disc !== '0' ? `${author.username}#${disc}` : `@${author.username}`;

  const buf = await generateQuote({
    text,
    authorName: msg.member?.displayName ?? author.globalName ?? author.username,
    authorHandle: handle,
    authorAvatarUrl: avatarUrl,
    style: await activeStyle(interaction.user.id), // the quoter's applied preset (/quotemessage config)
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`remove_quote:${interaction.user.id}`)
      .setLabel('Remove my Quote')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️')
  );

  await interaction.editReply({
    files: [new AttachmentBuilder(buf, { name: 'quote.png' })],
    components: [row],
  });
});
