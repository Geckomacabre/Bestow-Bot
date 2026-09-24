import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { awardBonusXp } from '../../utils/xpBonus.js';
import { Command } from '../../interfaces/command';

const REP_XP = 75;

const Rep: Command = {
  data: new SlashCommandBuilder()
    .setName('rep')
    .setDescription('Give or check reputation points')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub => sub
      .setName('give')
      .setDescription('Give a reputation point to a user')
      .addUserOption(o => o.setName('user').setDescription('User to rep').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View reputation for a user')
      .addUserOption(o => o.setName('user').setDescription('User to check (defaults to you)'))
    )
    .addSubcommand(sub => sub
      .setName('leaderboard')
      .setDescription('View the top 10 reputation holders')
    ),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply();

    if (sub === 'give') {
      const target = interaction.options.getUser('user', true);
      if (target.id === interaction.user.id) { await interaction.editReply('You cannot rep yourself.'); return; }
      if (target.bot) { await interaction.editReply('You cannot rep a bot.'); return; }

      const cfg = await db.getRepConfig(interaction.guildId!);
      const lastRep = await db.checkRepCooldown(interaction.guildId!, interaction.user.id, target.id);
      const cooldownMs = cfg.cooldown_seconds * 1000;
      if (lastRep && Date.now() - lastRep < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (Date.now() - lastRep)) / 60000);
        await interaction.editReply(`⏰ You must wait **${remaining}** more minute(s) before repping ${target.username} again.`);
        return;
      }

      const newPoints = await db.adjustReputation(interaction.guildId!, target.id, 1);
      await db.setRepCooldown(interaction.guildId!, interaction.user.id, target.id);
      const xpGiven = await awardBonusXp({
        guildId: interaction.guildId!, userId: target.id, baseAmount: REP_XP,
        client: interaction.client, channelId: interaction.channelId,
      });
      const xpNote = xpGiven > 0 ? ` (+${xpGiven} XP to ${target.username})` : '';
      await interaction.editReply(`✅ Gave +1 rep to **${target.username}**! They now have **${newPoints}** rep.${xpNote}`);

    } else if (sub === 'view') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const rep = await db.getReputation(interaction.guildId!, target.id);
      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setThumbnail(target.displayAvatarURL())
        .setTitle(`${target.username}'s Reputation`)
        .setDescription(`**${rep?.points ?? 0}** reputation point(s)`);
      await interaction.editReply({ embeds: [embed] });

    } else {
      const board = await db.getRepLeaderboard(interaction.guildId!, 10);
      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('Reputation Leaderboard')
        .setDescription(
          board.map(r => `**#${r.rank}** <@${r.user_id}> — **${r.points}** rep`).join('\n') || 'No reputation data yet.'
        );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

export default Rep;
