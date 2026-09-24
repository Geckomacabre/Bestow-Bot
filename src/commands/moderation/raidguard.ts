import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder,
  InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { findRecentRaidJoiners } from '../../features/raidguard/index.js';

const RaidGuard: Command = {
  data: new SlashCommandBuilder()
    .setName('raidguard')
    .setDescription('Raid detection tools')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s
      .setName('recent')
      .setDescription('List recently joined accounts, newest first — useful for spotting and banning raiders')
      .addIntegerOption(o => o.setName('minutes').setDescription('How far back to look (default 5, max 1440)').setMinValue(1).setMaxValue(1440))
      .addIntegerOption(o => o.setName('max_age_days').setDescription('Only show accounts younger than this many days (default: no filter)').setMinValue(1).setMaxValue(365))),

  async run(interaction: ChatInputCommandInteraction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply({ content: '❌ You need **Ban Members** to use this.', flags: MessageFlags.Ephemeral });
      return;
    }
    const minutes = interaction.options.getInteger('minutes') ?? 5;
    const maxAgeDays = interaction.options.getInteger('max_age_days');
    const windowMs = minutes * 60_000;
    const maxAgeMs = maxAgeDays ? maxAgeDays * 86_400_000 : Number.MAX_SAFE_INTEGER;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const joiners = findRecentRaidJoiners(interaction.guild!, windowMs, maxAgeMs);
    if (!joiners.length) {
      await interaction.editReply(`No members joined in the last **${minutes} minute${minutes === 1 ? '' : 's'}**${maxAgeDays ? ` with accounts under ${maxAgeDays}d old` : ''}.`);
      return;
    }

    const lines = joiners.slice(0, 25).map(m =>
      `<@${m.id}> \`${m.user.tag}\` — joined <t:${Math.floor((m.joinedTimestamp ?? 0) / 1000)}:R>, account created <t:${Math.floor(m.user.createdTimestamp / 1000)}:R>`
    );

    const embed = new EmbedBuilder()
      .setColor(Colors.Orange)
      .setTitle(`🔍 ${joiners.length} Recent Joiner${joiners.length === 1 ? '' : 's'}`)
      .setDescription(lines.join('\n') + (joiners.length > 25 ? `\n…and ${joiners.length - 25} more` : ''))
      .setFooter({ text: 'Ban with /ban — check for suspicious patterns (mass-similar usernames, no avatar, near-identical join times).' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default RaidGuard;
