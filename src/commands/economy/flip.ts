import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getOrCreateEconomy, getEconomyConfig, adjustBalance, getGambleMultiplier, recordGameResult } from '../../utils/db';
import { awardBonusXp } from '../../utils/xpBonus.js';
import { rand, randInt } from '../../utils/random.js';
import { cv2Err } from '../../utils/components.js';
import { applyLossInsurance, insuranceLine, settleJackpot, jackpotLine } from '../../utils/gamble.js';
import { renderCoinFlipGif, FLIP_REVEAL_MS } from '../../utils/coinFlip.js';
import { postWithReveal } from '../../utils/casinoReveal.js';

const GIF_NAME = 'flip.gif';

const Flip: Command = {
  data: new SlashCommandBuilder()
    .setName('flip')
    .setDescription('Bet on a coin flip (50/50 — win doubles your bet)')
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
    const win = rand() < 0.5; // true 50/50 — no house edge
    const luckMult = win ? await getGambleMultiplier(guildId, userId) : 1;
    const winDelta = win ? Math.floor(bet * luckMult) : -bet;
    const { newBalance } = await adjustBalance(guildId, userId, winDelta);
    recordGameResult(guildId, userId, 'flip', win, bet).catch(() => {});
    const refund = win ? 0 : await applyLossInsurance(guildId, userId, bet);
    const jp = await settleJackpot(guildId, userId, bet, win ? 0 : bet);
    let xpLine = '';
    if (win) {
      const xpGiven = await awardBonusXp({
        guildId, userId, baseAmount: randInt(50, 100),
        client: interaction.client, channelId: interaction.channelId, isGame: true,
      });
      xpLine = xpGiven > 0 ? `\n+**${xpGiven} XP** earned!` : '\n*(Daily XP cap reached)*';
    }
    const gif = await renderCoinFlipGif(win ? 'heads' : 'tails');
    await postWithReveal({
      edit: (payload) => interaction.editReply(payload),
      gif, name: GIF_NAME, revealMs: FLIP_REVEAL_MS,
      suspense: { content: `**🪙 Coin Flip** — Bet: ${sym} ${bet.toLocaleString()}\nFlipping…`, color: Colors.Blurple },
      result: {
        content: `**${win ? '🪙 Heads!' : '🌑 Tails!'}**\n${win ? `You won **${sym} ${Math.floor(bet * luckMult).toLocaleString()}**!${luckMult > 1 ? ' *(🍀 Lucky Charm!)*' : ''}` : `You lost **${sym} ${bet.toLocaleString()}**.`}${insuranceLine(sym, refund)}\n**Balance:** ${sym} **${(newBalance + refund + jp.won).toLocaleString()}**${xpLine}${jackpotLine(sym, jp.won)}`,
        color: win ? Colors.Green : Colors.Red,
      },
    });
  },
};

export default Flip;
