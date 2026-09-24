import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle,
  EmbedBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction,
  PermissionFlagsBits, TextChannel, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { EventModule } from '../feature';
import { cv2Text } from '../../utils/components.js';
import { archiveTicket, buildModPanel, fetchAllMessages, buildTranscriptFile, canCloseTicket, isTicketStaff } from '../../utils/tickets.js';

async function createTicketChannel(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  topic: string,
  db: any,
): Promise<TextChannel> {
  const guildId = interaction.guildId!;
  const cfg = await db.getTicketConfig(guildId);

  const permOverwrites: any[] = [
    { id: guildId, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    { id: interaction.guild!.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ];
  if (cfg?.support_role_id) permOverwrites.push({ id: cfg.support_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

  await db.ensureConfig(guildId);
  await db.db`INSERT OR IGNORE INTO ticket_config (guild_id) VALUES (${guildId})`;
  const cfgNow = await db.getTicketConfig(guildId);
  const ticketNum = cfgNow?.next_ticket_num ?? 1;

  const opts: any = {
    name: `ticket-${ticketNum}`,
    permissionOverwrites: permOverwrites,
    topic: `Ticket by ${interaction.user.tag} — ${topic}`,
  };
  if (cfg?.category_id) opts.parent = cfg.category_id;

  const channel = await interaction.guild!.channels.create(opts) as TextChannel;
  await db.createTicket(guildId, channel.id, interaction.user.id, topic);

  // Ping mention
  await channel.send(`${cfg?.support_role_id ? `<@&${cfg.support_role_id}> ` : ''}<@${interaction.user.id}>`);

  // Welcome embed
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
    .setTitle('New Ticket!')
    .setDescription(
      `Hello **${interaction.user.username}**, this is your ticket!\n` +
      `Please provide details about your problem below. Support will be with you shortly.\n\n` +
      `You may ping a support member once after 30 minutes of no response; avoid mass-pinging.\n\n` +
      `Staff can manage this ticket using the **Staff Panel** button.`
    )
    .addFields({ name: 'Ticket Subject', value: `\`\`\`${topic}\`\`\`` })
    .setFooter({ text: interaction.guild!.name, iconURL: interaction.guild!.iconURL() ?? undefined })
    .setTimestamp();

  // Staff panel buttons
  const modRows = buildModPanel(channel.id);
  await channel.send({ embeds: [embed], components: modRows });

  return channel;
}

const ticketsModule: EventModule = {
  name: 'tickets',
  handlers: {
    interactionCreate: async ({ data: [interaction], db, bot }) => {

      // ── Button interactions ──────────────────────────────────────────────
      if ((interaction as any).isButton()) {
        const btn = interaction as ButtonInteraction;

        // Panel button → show modal
        if (btn.customId === 'ticket:open') {
          const modal = new ModalBuilder()
            .setCustomId('ticket:modal')
            .setTitle('Open a Support Ticket')
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId('topic')
                  .setLabel('What do you need help with?')
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder('Briefly describe your issue...')
                  .setMaxLength(200)
                  .setRequired(true)
              )
            );
          await btn.showModal(modal);
          return;
        }

        // Claim ticket
        if (btn.customId.startsWith('ticket:claim:')) {
          const channelId = btn.customId.split(':')[2];
          if (btn.channelId !== channelId) return;
          await btn.deferReply({ flags: MessageFlags.Ephemeral });
          const ticket = await db.getTicketByChannel(channelId);
          if (!ticket) { await btn.editReply('This is not an open ticket.'); return; }
          const cfg = await db.getTicketConfig(ticket.guild_id);
          if (!isTicketStaff(btn, cfg)) { await btn.editReply('❌ Only support staff can claim tickets.'); return; }
          if (ticket.claimed_by) { await btn.editReply(`This ticket is already claimed by <@${ticket.claimed_by}>.`); return; }
          await db.claimTicket(channelId, btn.user.id);
          if (cfg?.support_role_id) {
            await (btn.channel as TextChannel).permissionOverwrites.delete(cfg.support_role_id).catch(() => {});
          }
          await (btn.channel as TextChannel).permissionOverwrites.create(btn.user.id, { ViewChannel: true, SendMessages: true }).catch(() => {});
          await (btn.channel as TextChannel).setTopic(`Ticket by <@${ticket.user_id}> — Claimed by ${btn.user.username}`).catch(() => {});
          await (btn.channel as TextChannel | null)?.send(`🙋 Ticket claimed by <@${btn.user.id}>.`).catch(() => {});
          await btn.editReply('✅ You have claimed this ticket.');
          return;
        }

        // Save transcript (without closing)
        if (btn.customId.startsWith('ticket:save:')) {
          const channelId = btn.customId.split(':')[2];
          if (btn.channelId !== channelId) return;
          await btn.deferReply({ flags: MessageFlags.Ephemeral });
          const ticket = await db.getTicketByChannelAny(channelId);
          if (!ticket) { await btn.editReply('No ticket record found.'); return; }
          const cfg = await db.getTicketConfig(ticket.guild_id);
          if (!cfg?.log_channel_id) { await btn.editReply('No log channel configured. Use `/ticket config set log:#channel` first.'); return; }
          const messages = await fetchAllMessages(btn.channel as TextChannel);
          const file = buildTranscriptFile(ticket, messages);
          try {
            const logCh = await bot.channels.fetch(cfg.log_channel_id) as TextChannel;
            await logCh.send({ content: `💾 **Ticket #${ticket.ticket_num}** transcript saved by <@${btn.user.id}>`, files: [file] });
            await btn.editReply('✅ Transcript saved to the log channel.');
          } catch {
            await btn.editReply('❌ Could not post to log channel.');
          }
          return;
        }

        // Close ticket
        if (btn.customId.startsWith('ticket:close:')) {
          const channelId = btn.customId.split(':')[2];
          if (btn.channelId !== channelId) return;
          await btn.deferReply({ flags: MessageFlags.Ephemeral });
          const ticket = await db.getTicketByChannel(channelId);
          if (!ticket) { await btn.editReply('This channel is not an open ticket.'); return; }
          const check = canCloseTicket(btn, ticket);
          if (!check.allowed) { await btn.editReply(check.reason); return; }
          await db.closeTicket(channelId);
          await btn.editReply('✅ Ticket closed. Generating transcript and deleting channel...');
          const cfg = await db.getTicketConfig(ticket.guild_id);
          await archiveTicket(btn.channel as TextChannel, ticket, cfg, bot);
          return;
        }

        // Rating buttons — delete channel immediately after rating
        if (btn.customId.startsWith('ticket:rate:')) {
          const parts = btn.customId.split(':');
          const rating = parseInt(parts[2]);
          const channelId = parts[3];
          if (isNaN(rating) || rating < 1 || rating > 5) return;
          if (btn.channelId !== channelId) return;
          await btn.deferUpdate();
          await db.rateTicket(channelId, rating);
          await btn.editReply({ content: `${'⭐'.repeat(rating)} Thanks for your feedback! This channel will be deleted in 5 seconds.`, components: [] });
          setTimeout(() => (btn.channel as TextChannel)?.delete().catch(() => {}), 5000);
          return;
        }
      }

      // ── Modal submit: create ticket ──────────────────────────────────────
      if ((interaction as any).isModalSubmit()) {
        const modal = interaction as ModalSubmitInteraction;
        if (modal.customId !== 'ticket:modal') return;
        await modal.deferReply({ flags: MessageFlags.Ephemeral });
        const topic = modal.fields.getTextInputValue('topic') || 'No topic specified';
        try {
          const channel = await createTicketChannel(modal as any, topic, db);
          await modal.editReply(`✅ Your ticket has been created: <#${channel.id}>`);
        } catch (err) {
          console.error('[tickets] create error:', err);
          await modal.editReply('❌ Could not create ticket. Make sure the bot has permission to create channels.');
        }
      }
    },
  },
};

export default ticketsModule;
