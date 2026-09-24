import {
  ApplicationIntegrationType, ChatInputCommandInteraction, EmbedBuilder,
  InteractionContextType, PermissionFlagsBits, SlashCommandBuilder,
  Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, MessageFlags,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import * as db from '../../utils/db';
import { endGiveawayById, filterEligibleEntries } from '../../features/giveaway/index';

function parseDuration(s: string): number | null {
  const re = /^(\d+)(s|m|h|d)$/i;
  const m = re.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1]);
  const units: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * (units[m[2].toLowerCase()] ?? 0) || null;
}

function relativeTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const Giveaway: Command = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s =>
      s.setName('start').setDescription('Start a giveaway')
        .addStringOption(o => o.setName('prize').setDescription('What you\'re giving away').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('How long (e.g. 1h, 30m, 2d)').setRequired(true))
        .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1).setMaxValue(20))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (defaults to current)')))
    .addSubcommand(s =>
      s.setName('end').setDescription('End a giveaway early')
        .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('reroll').setDescription('Reroll winners for an ended giveaway')
        .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('list').setDescription('List active giveaways'))
    .addSubcommand(s =>
      s.setName('entries').setDescription('View who has entered a giveaway')
        .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true))) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need **Manage Server** to start giveaways.', flags: MessageFlags.Ephemeral });
      }

      const prize = interaction.options.getString('prize', true);
      const durationStr = interaction.options.getString('duration', true);
      const winners = interaction.options.getInteger('winners', true);
      const channelOpt = interaction.options.getChannel('channel');

      const ms = parseDuration(durationStr);
      if (!ms) return interaction.reply({ content: 'Invalid duration. Use formats like `1h`, `30m`, `2d`.', flags: MessageFlags.Ephemeral });

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetChannel = (channelOpt ?? interaction.channel) as TextChannel;
      const endsAt = Date.now() + ms;
      const giveaway = await db.createGiveaway(interaction.guildId!, targetChannel.id, interaction.user.id, prize, winners, endsAt);

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle(`🎉 GIVEAWAY — ${prize}`)
        .setDescription(`Click the button below to enter!\n\nEnds: <t:${Math.floor(endsAt / 1000)}:R>`)
        .addFields(
          { name: 'Winners', value: winners.toString(), inline: true },
          { name: 'Duration', value: relativeTime(ms), inline: true },
          { name: 'Hosted by', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setTimestamp(endsAt);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway_enter_${giveaway.id}`)
          .setLabel('🎉 Enter')
          .setStyle(ButtonStyle.Primary),
      );

      const msg = await targetChannel.send({ embeds: [embed], components: [row] });
      await db.updateGiveawayMessageId(giveaway.id, msg.id);
      return interaction.editReply(`✅ Giveaway started! [Jump to message](${msg.url}) (ID: **${giveaway.id}**)`);
    }

    if (sub === 'end') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need **Manage Server** to end giveaways.', flags: MessageFlags.Ephemeral });
      }
      const id = interaction.options.getInteger('id', true);
      const g = await db.getGiveaway(id, interaction.guildId!);
      if (!g) return interaction.reply({ content: 'Giveaway not found.', flags: MessageFlags.Ephemeral });
      if (g.ended) return interaction.reply({ content: 'That giveaway has already ended.', flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await endGiveawayById(interaction.client as any, g);
      return interaction.editReply('✅ Giveaway ended.');
    }

    if (sub === 'reroll') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need **Manage Server** to reroll giveaways.', flags: MessageFlags.Ephemeral });
      }
      const id = interaction.options.getInteger('id', true);
      const g = await db.getGiveaway(id, interaction.guildId!);
      if (!g) return interaction.reply({ content: 'Giveaway not found.', flags: MessageFlags.Ephemeral });
      if (!g.ended) return interaction.reply({ content: 'This giveaway has not ended yet. Use `/giveaway end` first.', flags: MessageFlags.Ephemeral });

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const entries = await db.getGiveawayEntries(id);
      const eligibleEntries = await filterEligibleEntries(interaction.guild!, entries);
      if (!eligibleEntries.length) return interaction.editReply('No eligible entries to reroll from (entrants may have left the server).');

      const count = Math.min(g.winner_count, eligibleEntries.length);
      const shuffled = [...eligibleEntries].sort(() => Math.random() - 0.5);
      const winners = shuffled.slice(0, count).map(id => `<@${id}>`).join(', ');

      const channel = interaction.guild!.channels.cache.get(g.channel_id) as TextChannel | null;
      await channel?.send({ content: `🎊 **Rerolled!** New winner${count > 1 ? 's' : ''}: ${winners} — **${g.prize}**!` }).catch(() => {});
      return interaction.editReply(`✅ Rerolled: ${winners}`);
    }

    if (sub === 'entries') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need **Manage Server** to view giveaway entries.', flags: MessageFlags.Ephemeral });
      }
      const id = interaction.options.getInteger('id', true);
      const g = await db.getGiveaway(id, interaction.guildId!);
      if (!g) return interaction.reply({ content: 'Giveaway not found.', flags: MessageFlags.Ephemeral });

      const entries = await db.getGiveawayEntries(id);
      if (!entries.length) {
        return interaction.reply({ content: `**${g.prize}** (ID ${id}) has no entries yet.`, flags: MessageFlags.Ephemeral });
      }

      const header = `**${entries.length}** ${entries.length === 1 ? 'entry' : 'entries'}\n\n`;
      const mentions = entries.map(uid => `<@${uid}>`);
      let list = mentions.join(', ');
      // Embed descriptions cap at 4096 chars — truncate large entrant lists instead of erroring.
      if (header.length + list.length > 4096) {
        let acc = '';
        let shown = 0;
        for (const m of mentions) {
          const candidate = acc ? `${acc}, ${m}` : m;
          if (header.length + candidate.length + 30 > 4096) break;
          acc = candidate;
          shown++;
        }
        list = `${acc}, *…and ${entries.length - shown} more*`;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle(`🎉 Entries — ${g.prize}`)
        .setDescription(header + list)
        .setFooter({ text: `Giveaway ID ${id}${g.ended ? ' • Ended' : ''}` });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'list') {
      const active = await db.getActiveGiveaways(interaction.guildId!);
      if (!active.length) return interaction.reply({ content: 'No active giveaways.', flags: MessageFlags.Ephemeral });

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('🎉 Active Giveaways')
        .setDescription(active.map(g =>
          `**ID ${g.id}** — **${g.prize}** in <#${g.channel_id}> • Ends <t:${Math.floor(g.ends_at / 1000)}:R>`,
        ).join('\n'));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};

export default Giveaway;
