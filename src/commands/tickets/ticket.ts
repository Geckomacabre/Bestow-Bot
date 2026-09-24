import {
  ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  ChannelType, ContainerBuilder, ChatInputCommandInteraction, Colors,
  EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits,
  SlashCommandBuilder, TextChannel, TextDisplayBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';
import { archiveTicket, buildModPanel, canCloseTicket, isTicketAdmin } from '../../utils/tickets.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const Ticket: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage support tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub => sub.setName('create').setDescription('Open a new support ticket')
      .addStringOption(o => o.setName('topic').setDescription('Brief description of your issue')))
    .addSubcommand(sub => sub.setName('close').setDescription('Close this ticket'))
    .addSubcommand(sub => sub.setName('delete').setDescription('Permanently delete this ticket channel'))
    .addSubcommand(sub => sub.setName('add').setDescription('Add a user to this ticket')
      .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove a user from this ticket')
      .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)))
    .addSubcommand(sub => sub.setName('panel').setDescription('Post a ticket panel with an Open Ticket button')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post the panel in').setRequired(true))
      .addStringOption(o => o.setName('title').setDescription('Panel title'))
      .addStringOption(o => o.setName('description').setDescription('Panel description')))
    .addSubcommand(sub => sub.setName('ratings').setDescription('View support ratings for a staff member')
      .addUserOption(o => o.setName('user').setDescription('Staff member to check (defaults to yourself)')))
    .addSubcommand(sub => sub.setName('redirect').setDescription('Post a "wrong channel" redirect panel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post this in').setRequired(true)))
    .addSubcommandGroup(g => g.setName('config').setDescription('Configure the ticket system')
      .addSubcommand(sub => sub.setName('set').setDescription('Set ticket system settings')
        .addChannelOption(o => o.setName('category').setDescription('Category for ticket channels').addChannelTypes(ChannelType.GuildCategory))
        .addChannelOption(o => o.setName('log').setDescription('Channel to log closed tickets'))
        .addRoleOption(o => o.setName('support').setDescription('Support role added to all tickets')))
      .addSubcommand(sub => sub.setName('view').setDescription('View current ticket settings'))) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ── Config ──────────────────────────────────────────────────────────────
    if (group === 'config') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '❌ You need **Manage Server** to configure tickets.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (sub === 'set') {
        const category = interaction.options.getChannel('category');
        const log = interaction.options.getChannel('log');
        const support = interaction.options.getRole('support');
        await db.setTicketConfig(interaction.guildId!, { category_id: category?.id, log_channel_id: log?.id, support_role_id: support?.id });
        await interaction.editReply('✅ Ticket settings updated.');
      } else {
        const cfg = await db.getTicketConfig(interaction.guildId!);
        if (!cfg) { await interaction.editReply('Ticket system not configured yet.'); return; }
        const embed = new EmbedBuilder()
          .setColor(Colors.Blue)
          .setTitle('Ticket Config')
          .addFields(
            { name: 'Category', value: cfg.category_id ? `<#${cfg.category_id}>` : 'Not set', inline: true },
            { name: 'Log Channel', value: cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : 'Not set', inline: true },
            { name: 'Support Role', value: cfg.support_role_id ? `<@&${cfg.support_role_id}>` : 'Not set', inline: true },
            { name: 'Next Ticket #', value: String(cfg.next_ticket_num), inline: true },
          );
        await interaction.editReply({ embeds: [embed] });
      }
      return;
    }

    // ── Panel ────────────────────────────────────────────────────────────────
    if (sub === 'panel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '❌ You need **Manage Server** to post a ticket panel.', flags: MessageFlags.Ephemeral });
        return;
      }
      const channel = interaction.options.getChannel('channel', true) as TextChannel;
      const title = interaction.options.getString('title') ?? '🎫 Support Tickets';
      const description = interaction.options.getString('description') ?? 'Click the button below to open a support ticket. Our team will be with you shortly.';
      const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(Colors.Blurple);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('ticket:open').setLabel('Open a Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
      );
      try {
        await channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Ticket panel posted in <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
      } catch {
        await interaction.reply({ content: '❌ Could not post in that channel. Check my permissions.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    // ── Ratings ──────────────────────────────────────────────────────────────────
    if (sub === 'ratings') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const rows = await db.getModRatings(interaction.guildId!, target.id);
      if (!rows.length) {
        await interaction.editReply(`No ratings found for <@${target.id}>.`);
        return;
      }
      const avg = rows.reduce((s, r) => s + r.rating, 0) / rows.length;
      const breakdown = [1, 2, 3, 4, 5].map(n => {
        const count = rows.filter(r => r.rating === n).length;
        return `${'⭐'.repeat(n)} — **${count}**`;
      }).join('\n');
      const recent = rows.slice(0, 5).map(r =>
        `Ticket #${r.ticket_num}: ${'⭐'.repeat(r.rating)} — ${r.topic ?? 'No topic'}`
      ).join('\n');
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Support Ratings — ${target.username}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: 'Average Rating', value: `${'⭐'.repeat(Math.round(avg))} (${avg.toFixed(1)}/5 from ${rows.length} ticket${rows.length !== 1 ? 's' : ''})` },
          { name: 'Breakdown', value: breakdown, inline: true },
          { name: 'Recent Tickets', value: recent },
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── Redirect panel ───────────────────────────────────────────────────────
    if (sub === 'redirect') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '❌ You need **Manage Server** to post a redirect panel.', flags: MessageFlags.Ephemeral });
        return;
      }
      const postChannel = interaction.options.getChannel('channel', true) as TextChannel;
      const guildId = interaction.guildId!;

      const REDIRECT_CHANNELS = [
        { id: '1171282431018545242', label: 'Admin Support' },
        { id: '1520475113764421804', label: 'Bug Reports' },
        { id: '1474066766849245270', label: 'AI Support' },
      ];

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('Hello there!')
        .setDescription(
          `🔴 This channel is not intended for support queries. All support-related matters should be discussed within the appropriate support channels.\n\n` +
          `🟡 Please use the buttons below to navigate to the relevant support channel.`
        )
        .setFooter({ text: `Sent by ${interaction.guild!.members.me!.displayName}`, iconURL: interaction.client.user.displayAvatarURL() });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        REDIRECT_CHANNELS.map(({ id, label }) =>
          new ButtonBuilder()
            .setLabel(label)
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${guildId}/${id}`)
        )
      );

      try {
        await postChannel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Redirect panel posted in <#${postChannel.id}>.`, flags: MessageFlags.Ephemeral });
      } catch {
        await interaction.reply({ content: '❌ Could not post in that channel.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ── Create ───────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const topic = interaction.options.getString('topic') ?? 'No topic specified';
      const cfg = await db.getTicketConfig(interaction.guildId!);
      const permOverwrites: any[] = [
        { id: interaction.guildId!, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: interaction.guild!.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
      ];
      if (cfg?.support_role_id) permOverwrites.push({ id: cfg.support_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
      await db.ensureConfig(interaction.guildId!);
      await db.db`INSERT OR IGNORE INTO ticket_config (guild_id) VALUES (${interaction.guildId!})`;
      const cfgNow = await db.getTicketConfig(interaction.guildId!);
      const ticketNum = cfgNow?.next_ticket_num ?? 1;
      const channelOptions: any = { name: `ticket-${ticketNum}`, permissionOverwrites: permOverwrites, topic: `Ticket by ${interaction.user.tag} — ${topic}` };
      if (cfg?.category_id) channelOptions.parent = cfg.category_id;
      const channel = await interaction.guild!.channels.create(channelOptions) as TextChannel;
      const ticket = await db.createTicket(interaction.guildId!, channel.id, interaction.user.id, topic);

      await channel.send(`${cfg?.support_role_id ? `<@&${cfg.support_role_id}> ` : ''}<@${interaction.user.id}>`);
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
      const modRows = buildModPanel(channel.id);
      await channel.send({ embeds: [embed], components: modRows });
      await interaction.editReply(`✅ Your ticket has been created: <#${channel.id}>`);

    // ── Close ────────────────────────────────────────────────────────────────
    } else if (sub === 'close') {
      const ticket = await db.getTicketByChannel(interaction.channelId);
      if (!ticket) { await interaction.editReply('This channel is not an open ticket.'); return; }
      const check = canCloseTicket(interaction, ticket);
      if (!check.allowed) { await interaction.editReply(check.reason); return; }
      await db.closeTicket(interaction.channelId);
      await interaction.editReply('✅ Ticket closed. Generating transcript and deleting channel...');
      const cfg = await db.getTicketConfig(ticket.guild_id);
      await archiveTicket(interaction.channel as TextChannel, ticket, cfg, interaction.client);

    // ── Delete ───────────────────────────────────────────────────────────────
    } else if (sub === 'delete') {
      if (!isTicketAdmin(interaction)) {
        await interaction.editReply('❌ You need **Manage Server** to delete a ticket channel.');
        return;
      }
      const ticket = await db.getTicketByChannelAny(interaction.channelId);
      if (!ticket) { await interaction.editReply('No ticket record found for this channel.'); return; }
      await interaction.editReply('🗑️ Deleting channel in 3 seconds...');
      setTimeout(() => interaction.channel?.delete().catch(() => {}), 3000);

    // ── Add/Remove ───────────────────────────────────────────────────────────
    } else if (sub === 'add') {
      const user = interaction.options.getUser('user', true);
      await (interaction.channel as TextChannel | null)?.permissionOverwrites.create(user.id, { ViewChannel: true, SendMessages: true }).catch(() => {});
      await interaction.editReply(`✅ Added <@${user.id}> to this ticket.`);
    } else if (sub === 'remove') {
      const user = interaction.options.getUser('user', true);
      await (interaction.channel as TextChannel | null)?.permissionOverwrites.delete(user.id).catch(() => {});
      await interaction.editReply(`✅ Removed <@${user.id}> from this ticket.`);
    }
  },
};

export default Ticket;
