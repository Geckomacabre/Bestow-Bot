import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MessageFlags,
  SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import {
  getEconomyConfig, getEconomyLeaderboard,
} from '../../utils/db';
import { cv2Text } from '../../utils/components.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const Economy: Command = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Economy commands')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('leaderboard').setDescription('Show the richest users in the server')
      .addIntegerOption(o => o.setName('limit').setDescription('Number of users to show (default 10, max 25)').setMinValue(1).setMaxValue(25))),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === 'leaderboard') {
      await interaction.deferReply();
      const limit = interaction.options.getInteger('limit') ?? 10;
      let members = interaction.guild!.members.cache;
      if (members.size <= 1) members = await interaction.guild!.members.fetch();
      const memberIds = [...members.keys()];
      const [rows, cfg] = await Promise.all([getEconomyLeaderboard(memberIds, limit), getEconomyConfig(guildId)]);
      if (!rows.length) { await interaction.editReply(cv2Text('No economy data yet. Start earning with `/daily` and `/work`!')); return; }
      const medals = ['🥇', '🥈', '🥉'];
      const lines = rows.map((row, i) => `${medals[i] ?? `**${i + 1}.**`} <@${row.user_id}> — ${cfg.currency_symbol} **${row.balance.toLocaleString()}**`);
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Gold)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${cfg.currency_symbol} Richest Users**\n\n${lines.join('\n')}`));
      await interaction.editReply({ flags: IS_CV2, components: [container] });
      return;
    }
  },
};

export default Economy;
