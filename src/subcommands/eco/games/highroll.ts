import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../../interfaces/command';
import { getEconomyConfig, getGambleMultiplier } from '../../../utils/db';
import { randInt } from '../../../utils/random.js';
import { cv2Err } from '../../../utils/components.js';
import { stake } from '../../../eco/core.js';
import { settleRound } from '../../../eco/round.js';
import { fortuneMultiplier } from '../../../eco/effects.js';
import { renderHighRollGif, HIGHROLL_REVEAL_MS } from '../../../utils/highRollRender.js';
import { postWithReveal } from '../../../utils/casinoReveal.js';

const GIF_NAME = 'highroll.gif';

const HighRoll: Command = {
  data: new SlashCommandBuilder()
    .setName('highroll')
    .setDescription('Roll 1–100 against the bot — higher roll wins')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = (interaction.guildId ?? 'global');
    const userId = interaction.user.id;
    const bet = interaction.options.getInteger('bet', true);
    const cfg = await getEconomyConfig(guildId);
    const staked = await stake(guildId, userId, bet, 'highroll');
    if (!staked.success) {
      await interaction.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Your balance: **${cfg.currency_symbol} ${staked.newBalance.toLocaleString()}**.`)); return;
    }
    await interaction.deferReply();
    const sym = cfg.currency_symbol;
    const playerRoll = randInt(1, 100);
    const botRoll = randInt(1, 100);
    const win = playerRoll > botRoll, tie = playerRoll === botRoll;
    const luckMult = win ? (await getGambleMultiplier(guildId, userId)) * (await fortuneMultiplier(userId)) : 1;
    const round = await settleRound({
      guildId, userId, game: 'highroll', bet,
      returned: win ? bet + Math.floor(bet * luckMult) : tie ? bet : 0, won: win,
      xp: win ? randInt(50, 100) : undefined,
      client: interaction.client, channelId: interaction.channelId, currencySymbol: sym,
    });
    const result = tie ? `It's a tie! Your bet of **${sym} ${bet.toLocaleString()}** is refunded.` : win ? `You won **${sym} ${Math.floor(bet * luckMult).toLocaleString()}**!${luckMult > 1 ? ' *(🍀 Lucky Charm!)*' : ''}` : `You lost **${sym} ${bet.toLocaleString()}**.`;
    const gif = await renderHighRollGif(playerRoll, botRoll);
    await postWithReveal({
      edit: (payload) => interaction.editReply(payload),
      gif, name: GIF_NAME, revealMs: HIGHROLL_REVEAL_MS,
      suspense: { content: `**🎲 High Roll** — Bet: ${sym} ${bet.toLocaleString()}\nRolling…`, color: Colors.Blurple },
      result: {
        content: `**🎲 High Roll**\n**Your Roll:** ${playerRoll} | **Bot Roll:** ${botRoll}\n${result}${round.insuranceText}\n**Balance:** ${sym} **${round.balance.toLocaleString()}**${round.xpText}${round.jackpotText}`,
        color: win ? Colors.Green : tie ? Colors.Yellow : Colors.Red,
      },
    });
  },
};

export default HighRoll;
