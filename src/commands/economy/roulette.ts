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
import { renderRouletteGif, ROULETTE_REVEAL_MS } from '../../utils/rouletteRender.js';
import { postWithReveal } from '../../utils/casinoReveal.js';

const GIF_NAME = 'roulette.gif';

// Standard European roulette red numbers
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

const Roulette: Command = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Spin the roulette wheel and bet on the outcome')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1))
    .addStringOption(o =>
      o.setName('type').setDescription('What to bet on').setRequired(true)
        .addChoices(
          { name: '🔴 Red (2x)', value: 'red' },
          { name: '⚫ Black (2x)', value: 'black' },
          { name: '🔢 Even (2x)', value: 'even' },
          { name: '🔢 Odd (2x)', value: 'odd' },
          { name: '⬇️ Low 1–18 (2x)', value: 'low' },
          { name: '⬆️ High 19–36 (2x)', value: 'high' },
          { name: '🎯 Single Number (35x)', value: 'number' },
        ))
    .addIntegerOption(o =>
      o.setName('number').setDescription('1–36 (only used with Single Number)').setMinValue(1).setMaxValue(36)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const bet = interaction.options.getInteger('bet', true);
    const type = interaction.options.getString('type', true);
    const targetNum = interaction.options.getInteger('number');

    if (type === 'number' && targetNum === null) {
      await interaction.reply(cv2Err('❌ Provide a number (0–36) when using **Single Number** type.')); return;
    }

    const [eco, cfg] = await Promise.all([getOrCreateEconomy(guildId, userId), getEconomyConfig(guildId)]);
    if (eco.balance < bet) {
      await interaction.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Balance: **${cfg.currency_symbol} ${eco.balance.toLocaleString()}**.`)); return;
    }

    await interaction.deferReply();
    const result = randInt(1, 36);
    let multiplier = 2;
    const wouldWin = (r: number) => {
      const red = RED.has(r);
      switch (type) {
        case 'red':    return red;
        case 'black':  return !red;
        case 'even':   return r % 2 === 0;
        case 'odd':    return r % 2 === 1;
        case 'low':    return r <= 18;
        case 'high':   return r >= 19;
        case 'number': return r === targetNum;
        default:       return false;
      }
    };
    if (type === 'number') multiplier = 36;
    // 36 numbers, no zero pocket — even-money bets are a true 50/50 and
    // single numbers pay 35:1 at 1-in-36 odds. Exactly fair.
    const isRed = RED.has(result);
    const colorEmoji = isRed ? '🔴' : '⚫';
    const colorName  = isRed ? 'Red' : 'Black';
    const win = wouldWin(result);

    const sym = cfg.currency_symbol;
    const luckMult = win ? await getGambleMultiplier(guildId, userId) : 1;
    const winnings = win ? Math.floor(bet * (multiplier - 1) * luckMult) : 0;
    const delta = win ? winnings : -bet;
    const { newBalance } = await adjustBalance(guildId, userId, delta);
    recordGameResult(guildId, userId, 'roulette', win, bet).catch(() => {});
    const refund = win ? 0 : await applyLossInsurance(guildId, userId, bet);
    const jp = await settleJackpot(guildId, userId, bet, win ? 0 : bet);

    let xpLine = '';
    if (win) {
      const base = type === 'number' ? 200 : randInt(50, 100);
      const xpGiven = await awardBonusXp({
        guildId, userId, baseAmount: base,
        client: interaction.client, channelId: interaction.channelId, isGame: true,
      });
      xpLine = xpGiven > 0 ? `\n+**${xpGiven} XP** earned!` : '\n*(Daily XP cap reached)*';
    }

    const betLabel: Record<string, string> = {
      red: 'Red', black: 'Black', even: 'Even', odd: 'Odd',
      low: 'Low (1–18)', high: 'High (19–36)', number: `Number ${targetNum}`,
    };

    const gif = await renderRouletteGif(result);
    await postWithReveal({
      edit: (payload) => interaction.editReply(payload),
      gif, name: GIF_NAME, revealMs: ROULETTE_REVEAL_MS,
      suspense: {
        content: `**🎡 Roulette** — Bet: ${sym} ${bet.toLocaleString()} on **${betLabel[type]}**\nNo more bets…`,
        color: Colors.Blurple,
      },
      result: {
        content:
          `**🎡 Roulette**\n` +
          `The ball landed on **${colorEmoji} ${result}** *(${colorName})*\n\n` +
          `Bet on: **${betLabel[type]}**\n` +
          (win
            ? `✅ You won **${sym} ${winnings.toLocaleString()}**!${luckMult > 1 ? ' *(🍀 Lucky Charm!)*' : ''}`
            : `❌ You lost **${sym} ${bet.toLocaleString()}**.${insuranceLine(sym, refund)}`) +
          `\n**Balance:** ${sym} **${(newBalance + refund + jp.won).toLocaleString()}**${xpLine}${jackpotLine(sym, jp.won)}`,
        color: win ? Colors.Green : Colors.Red,
      },
    });
  },
};

export default Roulette;
