import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MessageFlags,
  SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getXpLeaderboard } from '../../utils/db';
import { cv2Text } from '../../utils/components.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const Level: Command = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Leveling and XP commands')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('leaderboard').setDescription('Show the top chatters by XP and level')
      .addIntegerOption(o => o.setName('limit').setDescription('Number of users to show (default 10, max 25)').setMinValue(1).setMaxValue(25))),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === 'leaderboard') {
      await interaction.deferReply();
      const limit = interaction.options.getInteger('limit') ?? 10;
      const rows = await getXpLeaderboard(guildId, limit);
      if (!rows.length) { await interaction.editReply(cv2Text('No XP data yet. Start chatting to earn XP!')); return; }
      const medals = ['🥇', '🥈', '🥉'];
      const lines = rows.map((row, i) => `${medals[i] ?? `**${i + 1}.**`} <@${row.user_id}> — **Level ${row.level}** (${row.xp.toLocaleString()} XP | ${row.total_messages.toLocaleString()} messages)`);
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Blurple)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🏆 XP Leaderboard**\n\n${lines.join('\n')}`));
      await interaction.editReply({ flags: IS_CV2, components: [container] });
    }
  },
};

export default Level;
