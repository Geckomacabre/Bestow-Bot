import {
  ApplicationIntegrationType, AttachmentBuilder, ChatInputCommandInteraction,
  InteractionContextType, MessageFlags, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getXp, calcLevelFromXp, getXpConfig, getXpRank } from '../../utils/db';
import { buildRankCard } from '../../utils/rankCard.js';

const Rank: Command = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View your rank card')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addUserOption(o => o.setName('user').setDescription('User to check (default: yourself)')),

  async run(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    await interaction.deferReply();

    const xpRow = await getXp(interaction.guildId!, target.id);
    if (!xpRow || xpRow.xp === 0) {
      await interaction.editReply(
        target.id === interaction.user.id
          ? "You haven't earned any XP yet — start chatting!"
          : `**${target.username}** hasn't earned any XP yet.`
      );
      return;
    }

    const { level, currentXp, xpNeeded } = calcLevelFromXp(xpRow.xp);
    const rank = await getXpRank(interaction.guildId!, target.id);
    const cfg = await getXpConfig(interaction.guildId!);
    const avatarUrl = target.displayAvatarURL({ extension: 'png', size: 256 });

    const cardBuffer = await buildRankCard({
      username: target.displayName ?? target.username,
      avatarUrl,
      rank,
      level,
      currentXp,
      xpNeeded,
      backgroundUrl: cfg.background_url,
    });

    const attachment = new AttachmentBuilder(cardBuffer, { name: 'rank.png' });
    await interaction.editReply({ files: [attachment] });
  },
};

export default Rank;
