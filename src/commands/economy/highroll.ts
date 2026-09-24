import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getOrCreateEconomy, getEconomyConfig, adjustBalance, getGambleMultiplier, recordGameResult } from '../../utils/db';
import { awardBonusXp } from '../../utils/xpBonus.js';
import { randInt } from '../../utils/random.js';
import { cv2Err } from '../../utils/components.js';
import { applyLossInsurance, insuranceLine, settleJackpot, jackpotLine } from '../../utils/gamble.js';
import { renderHighRollGif, HIGHROLL_REVEAL_MS } from '../../utils/highRollRender.js';
import { postWithReveal } from '../../utils/casinoReveal.js';

const GIF_NAME = 'highroll.gif';

const HighRoll: Command = {
  data: new SlashCommandBuilder()
    .setName('highroll')
    .setDescription('Roll 1–100 against the bot — higher roll wins')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const bet = interaction.options.getInteger('bet', true);
    const [eco, cfg] = await Promise.all([getOrCreateEconomy(guildId, userId), getEconomyConfig(guildId)]);
    if (eco.balance < bet) {
      await interaction.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Your balance: **${cfg.currency_symbol} ${eco.balance.toLocaleString()}**.`)); return;
    }
    await interaction.deferReply();
    const sym = cfg.currency_symbol;
    const playerRoll = randInt(1, 100);
    const botRoll = randInt(1, 100);
    const win = playerRoll > botRoll, tie = playerRoll === botRoll;
    const luckMult = win ? await getGambleMultiplier(guildId, userId) : 1;
    const { newBalance } = await adjustBalance(guildId, userId, win ? Math.floor(bet * luckMult) : tie ? 0 : -bet);
    if (!tie) recordGameResult(guildId, userId, 'highroll', win, bet).catch(() => {});
    const refund = !win && !tie ? await applyLossInsurance(guildId, userId, bet) : 0;
    const jp = await settleJackpot(guildId, userId, bet, !win && !tie ? bet : 0);
    let xpLine = '';
    if (win) {
      const xpGiven = await awardBonusXp({
        guildId, userId, baseAmount: randInt(50, 100),
        client: interaction.client, channelId: interaction.channelId, isGame: true,
      });
      xpLine = xpGiven > 0 ? `\n+**${xpGiven} XP** earned!` : '\n*(Daily XP cap reached)*';
    }
    const result = tie ? `It's a tie! Your bet of **${sym} ${bet.toLocaleString()}** is refunded.` : win ? `You won **${sym} ${Math.floor(bet * luckMult).toLocaleString()}**!${luckMult > 1 ? ' *(🍀 Lucky Charm!)*' : ''}` : `You lost **${sym} ${bet.toLocaleString()}**.`;
    const gif = await renderHighRollGif(playerRoll, botRoll);
    await postWithReveal({
      edit: (payload) => interaction.editReply(payload),
      gif, name: GIF_NAME, revealMs: HIGHROLL_REVEAL_MS,
      suspense: { content: `**🎲 High Roll** — Bet: ${sym} ${bet.toLocaleString()}\nRolling…`, color: Colors.Blurple },
      result: {
        content: `**🎲 High Roll**\n**Your Roll:** ${playerRoll} | **Bot Roll:** ${botRoll}\n${result}${insuranceLine(sym, refund)}\n**Balance:** ${sym} **${(newBalance + refund + jp.won).toLocaleString()}**${xpLine}${jackpotLine(sym, jp.won)}`,
        color: win ? Colors.Green : tie ? Colors.Yellow : Colors.Red,
      },
    });
  },
};

export default HighRoll;
