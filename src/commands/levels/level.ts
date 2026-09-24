import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MessageFlags,
  SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getXp, calcLevelFromXp, getXpLeaderboard } from '../../utils/db';
import { cv2Text } from '../../utils/components.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const Level: Command = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Leveling and XP commands')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('rank').setDescription('View your or another user\'s level and XP')
      .addUserOption(o => o.setName('user').setDescription('User to check (default: yourself)')))
    .addSubcommand(s => s.setName('leaderboard').setDescription('Show the top chatters by XP and level')
      .addIntegerOption(o => o.setName('limit').setDescription('Number of users to show (default 10, max 25)').setMinValue(1).setMaxValue(25))),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === 'rank') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const xpRow = await getXp(guildId, target.id);
      if (!xpRow || xpRow.xp === 0) {
        await interaction.reply({ ...cv2Text(target.id === interaction.user.id ? 'You haven\'t earned any XP yet — start chatting!' : `**${target.username}** hasn't earned any XP yet.`), flags: IS_CV2 | MessageFlags.Ephemeral });
        return;
      }
      const { level, currentXp, xpNeeded } = calcLevelFromXp(xpRow.xp);
      const progressPct = Math.round((currentXp / xpNeeded) * 100);
      const filled = Math.round(progressPct / 5);
      const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Blurple)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**${target.username} — Level ${level}**\n\n\`[${bar}]\` ${currentXp} / ${xpNeeded} XP (${progressPct}%)\n\n**Total XP:** ${xpRow.xp.toLocaleString()} | **Messages:** ${xpRow.total_messages.toLocaleString()}\n**Next Level:** Need **${(xpNeeded - currentXp).toLocaleString()}** more XP for level ${level + 1}`
        ));
      await interaction.reply({ flags: IS_CV2, components: [container] });
      return;
    }

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
