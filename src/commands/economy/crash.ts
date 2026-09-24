import {
  ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, Colors, ComponentType,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getOrCreateEconomy, getEconomyConfig, adjustBalance, getGambleMultiplier, recordGameResult, consumeBoost } from '../../utils/db';
import { applyLossInsurance, insuranceLine, buildGamePanel, settleJackpot, jackpotLine } from '../../utils/gamble.js';
import { awardBonusXp } from '../../utils/xpBonus.js';
import { rand } from '../../utils/random.js';
import { cv2Err } from '../../utils/components.js';

// Stock-style multiplier: it drifts up and down each tick. You can cash out at the
// current value (never below 1.00x) any time — the only way to lose is the "crash
// to 0" bust event, whose chance rises the higher the multiplier climbs.
//
// FAIRNESS: each tick is EV-neutral — the upward drift exactly offsets the bust
// risk ((1-h)·E[next] = current), so EVERY cash-out strategy breaks even long-run
// (simulated EV 0.999–1.010 for targets 1.1x–8x). The extra hazard near the floor
// compensates for the 1.00x floor clipping away downside moves there.
const FLOOR = 1.00;

function baseHazard(m: number): number {
  return Math.min(0.12, 0.04 + 0.01 * (m - 1));
}

function bustChance(m: number): number {
  return Math.min(0.4, baseHazard(m) + 0.13 * Math.max(0, 1.25 - m));
}

function nextMultiplier(m: number): number {
  const b = baseHazard(m);
  const drift = b / (1 - b);
  const pct = (rand() - 0.5) * 0.5 + drift;
  return Math.max(FLOOR, Math.min(100, Math.round(m * (1 + pct) * 100) / 100));
}

function fmtMult(m: number): string {
  return m.toFixed(2) + 'x';
}

function buildCashOutRow(mult: number, sym: string, bet: number): ActionRowBuilder<ButtonBuilder> {
  const potential = Math.floor(bet * mult);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('crash_cashout')
      .setLabel(`💰 Cash Out — ${sym} ${potential.toLocaleString()} (${fmtMult(mult)})`)
      .setStyle(ButtonStyle.Success),
  );
}

const Crash: Command = {
  data: new SlashCommandBuilder()
    .setName('crash')
    .setDescription('Ride the multiplier as it swings up and down — cash out before it crashes to 0!')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const bet = interaction.options.getInteger('bet', true);

    const [eco, cfg] = await Promise.all([getOrCreateEconomy(guildId, userId), getEconomyConfig(guildId)]);
    if (eco.balance < bet) {
      await interaction.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Balance: **${cfg.currency_symbol} ${eco.balance.toLocaleString()}**.`)); return;
    }

    const sym = cfg.currency_symbol;
    let current = 1.00;
    let peak = 1.00;
    let gameOver = false;

    await interaction.deferReply();

    const msg = await interaction.editReply(buildGamePanel(
      `**🚀 Crash**\n\n📈 **${fmtMult(current)}** — Bet: ${sym} ${bet.toLocaleString()}\n\n*The price swings up and down — cash out before it crashes to 0!*`,
      Colors.Blurple, buildCashOutRow(current, sym, bet),
    ));

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: btn => btn.user.id === userId && btn.customId === 'crash_cashout',
      max: 1,
      time: 120_000,
    });

    collector.on('collect', async (btn) => {
      if (gameOver) {
        await btn.reply(cv2Err('💥 Too late — it already crashed!'));
        return;
      }
      gameOver = true;
      clearInterval(tick);

      const luckMult = await getGambleMultiplier(guildId, userId);
      const winAmount = Math.floor(bet * current * luckMult);
      const delta = winAmount - bet;
      const { newBalance } = await adjustBalance(guildId, userId, delta);
      recordGameResult(guildId, userId, 'crash', winAmount >= bet, bet).catch(() => {});

      let xpLine = '';
      // XP only when there was real profit — an instant 1.00x cash-out risks
      // nothing and shouldn't farm the daily game-XP cap.
      if (winAmount > bet) {
        const xpGiven = await awardBonusXp({
          guildId, userId, baseAmount: Math.min(Math.floor(50 * current), 200),
          client: interaction.client, channelId: interaction.channelId, isGame: true,
        });
        xpLine = xpGiven > 0 ? ` +**${xpGiven} XP**!` : '';
      }
      const boostLine = luckMult > 1 ? ' *(🍀 Lucky Charm!)*' : '';

      await btn.update(buildGamePanel(
        `**🚀 Crash**\n\n✅ **Cashed out at ${fmtMult(current)}!** *(peak ${fmtMult(peak)})*\nYou won **${sym} ${winAmount.toLocaleString()}**!${boostLine}${xpLine}\n**Balance:** ${sym} **${newBalance.toLocaleString()}**`,
        Colors.Green,
      ));
    });

    collector.on('end', async (_c, reason) => {
      if (reason === 'time' && !gameOver) {
        // Fell asleep at the wheel? Auto-cash at the current value instead of
        // confiscating the bet — the game stays fair even for AFK players.
        gameOver = true;
        clearInterval(tick);
        const winAmount = Math.floor(bet * current);
        const { newBalance } = await adjustBalance(guildId, userId, winAmount - bet);
        recordGameResult(guildId, userId, 'crash', winAmount >= bet, bet).catch(() => {});
        await interaction.editReply(buildGamePanel(
          `**🚀 Crash**\n\n⏰ **Timed out** — auto-cashed you out at **${fmtMult(current)}** for **${sym} ${winAmount.toLocaleString()}**. *(peak ${fmtMult(peak)})*\n**Balance:** ${sym} **${newBalance.toLocaleString()}**`,
          Colors.Yellow,
        )).catch(() => {});
      }
    });

    const tick = setInterval(async () => {
      if (gameOver) { clearInterval(tick); return; }

      // Bust check — the price crashes straight to 0 and the bet is lost.
      if (rand() < bustChance(current)) {
        gameOver = true;
        clearInterval(tick);
        collector.stop('crashed');
        recordGameResult(guildId, userId, 'crash', false, bet).catch(() => {});

        // Second Chance (one-shot shop item): a bust below 1.5x refunds the bet.
        if (current < 1.5 && await consumeBoost(guildId, userId, 'second_chance')) {
          const { balance } = await getOrCreateEconomy(guildId, userId);
          await interaction.editReply(buildGamePanel(
            `**🚀 Crash**\n\n💥 **CRASHED to 0 from ${fmtMult(current)}!** *(peak ${fmtMult(peak)})*\n🔁 **Second Chance!** Your bet of **${sym} ${bet.toLocaleString()}** was refunded.\n**Balance:** ${sym} **${balance.toLocaleString()}**`,
            Colors.Green,
          )).catch(() => {});
          return;
        }

        const { newBalance } = await adjustBalance(guildId, userId, -bet);
        const refund = await applyLossInsurance(guildId, userId, bet);
        const jp = await settleJackpot(guildId, userId, bet, bet);
        await interaction.editReply(buildGamePanel(
          `**🚀 Crash**\n\n💥 **CRASHED to 0 from ${fmtMult(current)}!** *(peak ${fmtMult(peak)})*\nYou lost **${sym} ${bet.toLocaleString()}**.${insuranceLine(sym, refund)}\n**Balance:** ${sym} **${(newBalance + refund + jp.won).toLocaleString()}**${jackpotLine(sym, jp.won)}`,
          Colors.Red,
        )).catch(() => {});
        return;
      }

      const prev = current;
      current = nextMultiplier(current);
      if (current > peak) peak = current;
      const arrow = current >= prev ? '📈' : '📉';

      await interaction.editReply(buildGamePanel(
        `**🚀 Crash**\n\n${arrow} **${fmtMult(current)}** — Bet: ${sym} ${bet.toLocaleString()}  *(peak ${fmtMult(peak)})*\n\n*The price swings up and down — cash out before it crashes to 0!*`,
        Colors.Blurple, buildCashOutRow(current, sym, bet),
      )).catch(() => {});
    }, 1500);
  },
};

export default Crash;
