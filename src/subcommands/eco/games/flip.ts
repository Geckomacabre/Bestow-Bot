import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../../interfaces/command';
import { getEconomyConfig, getGambleMultiplier } from '../../../utils/db';
import { rand, randInt } from '../../../utils/random.js';
import { cv2Err } from '../../../utils/components.js';
import { stake } from '../../../eco/core.js';
import { settleRound } from '../../../eco/round.js';
import { fortuneMultiplier } from '../../../eco/effects.js';
import { renderCoinFlipGif, FLIP_REVEAL_MS } from '../../../utils/coinFlip.js';
import { postWithReveal } from '../../../utils/casinoReveal.js';

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
    const cfg = await getEconomyConfig(guildId);
    const staked = await stake(guildId, userId, bet, 'flip');
    if (!staked.success) {
      await interaction.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Your balance: **${cfg.currency_symbol} ${staked.newBalance.toLocaleString()}**.`)); return;
    }
    await interaction.deferReply();
    const sym = cfg.currency_symbol;
    const win = rand() < 0.5; // true 50/50 — no house edge
    const luckMult = win ? (await getGambleMultiplier(guildId, userId)) * (await fortuneMultiplier(userId)) : 1;
    const round = await settleRound({
      guildId, userId, game: 'flip', bet, returned: win ? bet + Math.floor(bet * luckMult) : 0, won: win,
      xp: win ? randInt(50, 100) : undefined,
      client: interaction.client, channelId: interaction.channelId, currencySymbol: sym,
    });
    const gif = await renderCoinFlipGif(win ? 'heads' : 'tails');
    await postWithReveal({
      edit: (payload) => interaction.editReply(payload),
      gif, name: GIF_NAME, revealMs: FLIP_REVEAL_MS,
      suspense: { content: `**🪙 Coin Flip** — Bet: ${sym} ${bet.toLocaleString()}\nFlipping…`, color: Colors.Blurple },
      result: {
        content: `**${win ? '🪙 Heads!' : '🌑 Tails!'}**\n${win ? `You won **${sym} ${Math.floor(bet * luckMult).toLocaleString()}**!${luckMult > 1 ? ' *(🍀 Lucky Charm!)*' : ''}` : `You lost **${sym} ${bet.toLocaleString()}**.`}${round.insuranceText}\n**Balance:** ${sym} **${round.balance.toLocaleString()}**${round.xpText}${round.jackpotText}`,
        color: win ? Colors.Green : Colors.Red,
      },
    });
  },
};

export default Flip;
