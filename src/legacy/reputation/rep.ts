import {
  ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { card } from '../../lookups/card.js';
import * as db from '../../utils/db';
import { awardBonusXp } from '../../utils/xpBonus.js';
import { Command } from '../../interfaces/command';
import { placeName, placeOf, scopeOf } from '../../groupchat/scope.js';

const REP_XP = 75;

/** Reputation is kept per server, and per chat in DMs and group chats (see groupchat/scope.ts). XP only exists in servers. */
const Rep: Command = {
  data: new SlashCommandBuilder()
    .setName('rep')
    .setDescription('Give or check reputation points')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
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
    const scope = scopeOf(interaction);
    await interaction.deferReply();

    if (sub === 'give') {
      const target = interaction.options.getUser('user', true);
      if (target.id === interaction.user.id) { await interaction.editReply('You cannot rep yourself.'); return; }
      if (target.bot) { await interaction.editReply('You cannot rep a bot.'); return; }

      const cfg = await db.getRepConfig(scope);
      const lastRep = await db.checkRepCooldown(scope, interaction.user.id, target.id);
      const cooldownMs = cfg.cooldown_seconds * 1000;
      if (lastRep && Date.now() - lastRep < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (Date.now() - lastRep)) / 60000);
        await interaction.editReply(`⏰ You must wait **${remaining}** more minute(s) before repping ${target.username} again.`);
        return;
      }

      const newPoints = await db.adjustReputation(scope, target.id, 1);
      await db.setRepCooldown(scope, interaction.user.id, target.id);
      const xpGiven = interaction.guildId ? await awardBonusXp({
        guildId: interaction.guildId, userId: target.id, baseAmount: REP_XP,
        client: interaction.client, channelId: interaction.channelId,
      }) : 0;
      const xpNote = xpGiven > 0 ? ` (+${xpGiven} XP to ${target.username})` : '';
      await interaction.editReply(`✅ Gave +1 rep to **${target.username}**! They now have **${newPoints}** rep.${xpNote}`);

    } else if (sub === 'view') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const rep = await db.getReputation(scope, target.id);
      const points = rep?.points ?? 0;
      await interaction.editReply(card({
        title: `${target.username}'s reputation`, thumbnail: target.displayAvatarURL(),
        description: `⭐ **${points}** rep point${points === 1 ? '' : 's'} in ${placeName(placeOf(interaction))}`,
      }));

    } else {
      const board = await db.getRepLeaderboard(scope, 10);
      const medal = (rank: number) => ['🥇', '🥈', '🥉'][rank - 1] ?? `**#${rank}**`;
      await interaction.editReply(card({
        title: 'Reputation leaderboard', footer: `Counted separately in each server and chat · this is ${placeName(placeOf(interaction))}`,
        description: board.map(r => `${medal(r.rank)} <@${r.user_id}> · **${r.points}** rep`).join('\n') || 'No reputation data yet.',
      }));
    }
  },
};

export default Rep;
