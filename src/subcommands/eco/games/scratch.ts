import {
  ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, Colors, ComponentType, InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../../interfaces/command';
import { getEconomyConfig, getGambleMultiplier } from '../../../utils/db';
import { randInt } from '../../../utils/random.js';
import { cv2Err } from '../../../utils/components.js';
import { buildGamePanel } from '../../../utils/gamble.js';
import { stake } from '../../../eco/core.js';
import { settleRound } from '../../../eco/round.js';
import { fortuneMultiplier } from '../../../eco/effects.js';
import { renderScratchCard } from '../../../utils/scratchRender.js';
import { mediaPanel } from '../../../utils/casinoReveal.js';
import { AttachmentBuilder } from 'discord.js';
import { IS_CV2 } from '../../../utils/components.js';

const CARD_NAME = 'scratch.png';

// Paytable tuned to ~99% RTP with a 52% hit rate: you need FOUR of the same
// symbol among the 9 cells. 4 cherries = money back; everything rarer profits.
const SYMBOLS = [
  { emoji: '🍒', mult: 1,  weight: 30 },
  { emoji: '🍋', mult: 2,  weight: 25 },
  { emoji: '🔔', mult: 3,  weight: 20 }, // was 🍊 — too easily confused with 🍋 at small size
  { emoji: '🍇', mult: 6,  weight: 12 },
  { emoji: '⭐', mult: 12, weight: 8  },
  { emoji: '💎', mult: 25, weight: 5  },
];
const MATCH_NEEDED = 4;
const TOTAL_WEIGHT = SYMBOLS.reduce((s, sym) => s + sym.weight, 0);
const LEGEND = '*Match 4+: 🍒 1x | 🍋 2x | 🔔 3x | 🍇 6x | ⭐ 12x | 💎 25x*';

function pickSymbol(): string {
  let r = randInt(1, TOTAL_WEIGHT);
  for (const sym of SYMBOLS) { r -= sym.weight; if (r <= 0) return sym.emoji; }
  return SYMBOLS[0]!.emoji;
}

function generateGrid(): string[] {
  return Array.from({ length: 9 }, () => pickSymbol());
}

function buildGrid(symbols: string[], revealed: boolean[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let r = 0; r < 3; r++) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      Array.from({ length: 3 }, (_, c) => {
        const i = r * 3 + c;
        return new ButtonBuilder()
          .setCustomId(`sc_${i}`)
          .setLabel(revealed[i] ? (symbols[i] ?? '❓') : '❓')
          .setStyle(revealed[i] ? ButtonStyle.Secondary : ButtonStyle.Primary)
          .setDisabled(revealed[i]);
      })
    ));
  }
  return rows;
}

function checkWin(symbols: string[]): { emoji: string; count: number; mult: number } | null {
  const counts = new Map<string, number>();
  for (const s of symbols) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: { emoji: string; count: number; mult: number } | null = null;
  for (const [emoji, count] of counts) {
    if (count < MATCH_NEEDED) continue;
    const mult = SYMBOLS.find(s => s.emoji === emoji)?.mult ?? 0;
    if (!best || mult > best.mult) best = { emoji, count, mult };
  }
  return best;
}

async function resolveGame(
  symbols: string[], bet: number,
  guildId: string, userId: string, cfg: Awaited<ReturnType<typeof getEconomyConfig>>,
  client: ChatInputCommandInteraction['client'], channelId: string,
): Promise<{ content: string; win: boolean; winEmoji: string | null }> {
  const win = checkWin(symbols);
  const sym = cfg.currency_symbol;
  // The card's price was taken up-front; a winning card pays back price × multiplier.
  const luckMult = win ? (await getGambleMultiplier(guildId, userId)) * (await fortuneMultiplier(userId)) : 1;
  const winAmount = win ? Math.floor(bet * win.mult * luckMult) : 0;
  const round = await settleRound({
    guildId, userId, game: 'scratch', bet, returned: winAmount, won: !!win,
    xp: win ? Math.floor(50 * win.mult) : undefined,
    client, channelId, currencySymbol: sym,
  });
  let line = '';
  if (win) {
    const boostLine = luckMult > 1.0 ? ` *(🍀 ${luckMult.toFixed(2)}x boost!)*` : '';
    line = `\n🎉 **${win.emoji} × ${win.count}!** You won **${sym} ${winAmount.toLocaleString()}**!${boostLine}${round.xpText}`;
  } else {
    line = `\n😢 No match — better luck next time!${round.insuranceText}`;
  }
  return {
    content: `🎟️ **Scratch Card** — ${sym} ${bet.toLocaleString()}${line}\n**Balance:** ${sym} ${round.balance.toLocaleString()}\n${LEGEND}${round.jackpotText}`,
    win: !!win,
    winEmoji: win?.emoji ?? null,
  };
}

// Final payoff image: the full grid with the matching symbols lit up.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function finishedCard(content: string, win: boolean, symbols: string[], winEmoji: string | null): any {
  const png = renderScratchCard(symbols, winEmoji);
  return {
    flags: IS_CV2,
    components: [mediaPanel(content, win ? Colors.Green : Colors.Red, `attachment://${CARD_NAME}`)],
    files: [new AttachmentBuilder(png, { name: CARD_NAME })],
  };
}

const Scratch: Command = {
  data: new SlashCommandBuilder()
    .setName('scratch')
    .setDescription('Buy a scratch card — reveal all 9 symbols and match 3 to win!')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addIntegerOption(o => o.setName('bet').setDescription('Cost of the scratch card').setRequired(true).setMinValue(1)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = (interaction.guildId ?? 'global');
    const userId = interaction.user.id;
    const bet = interaction.options.getInteger('bet', true);

    const cfg = await getEconomyConfig(guildId);
    const staked = await stake(guildId, userId, bet, 'scratch');
    if (!staked.success) {
      await interaction.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Balance: **${cfg.currency_symbol} ${staked.newBalance.toLocaleString()}**.`)); return;
    }

    const symbols = generateGrid();
    const revealed = new Array<boolean>(9).fill(false);

    await interaction.deferReply();
    const msg = await interaction.editReply(buildGamePanel(
      `🎟️ **Scratch Card** — ${cfg.currency_symbol} ${bet.toLocaleString()}\nClick cells to reveal! Match **4** of the same symbol to win.\n${LEGEND}`,
      Colors.Blurple, buildGrid(symbols, revealed),
    ));

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: btn => btn.user.id === userId,
      time: 120_000,
    });

    collector.on('collect', async (btn) => {
      await btn.deferUpdate();
      const i = parseInt(btn.customId.split('_')[1] ?? '0');
      revealed[i] = true;

      if (revealed.every(r => r)) {
        collector.stop('done');
        const { content, win, winEmoji } = await resolveGame(symbols, bet, guildId, userId, cfg, interaction.client, interaction.channelId);
        await interaction.editReply(finishedCard(content, win, symbols, winEmoji)).catch(() => {});
      } else {
        await interaction.editReply(buildGamePanel(
          `🎟️ **Scratch Card** — ${cfg.currency_symbol} ${bet.toLocaleString()}\nClick cells to reveal! Match **4** of the same symbol to win.\n${LEGEND}`,
          Colors.Blurple, buildGrid(symbols, revealed),
        )).catch(() => {});
      }
    });

    collector.on('end', async (_c, reason) => {
      if (reason !== 'done') {
        revealed.fill(true);
        const { content, win, winEmoji } = await resolveGame(symbols, bet, guildId, userId, cfg, interaction.client, interaction.channelId);
        await interaction.editReply(finishedCard(`*(Timed out — auto-revealed)*\n${content}`, win, symbols, winEmoji)).catch(() => {});
      }
    });
  },
};

export default Scratch;
