import {
  ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, Colors, ComponentType, ContainerBuilder,
  InteractionContextType, Message, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../../interfaces/command';
import { getEconomyConfig, getGambleMultiplier } from '../../../utils/db';
import { rand } from '../../../utils/random.js';
import { cv2Err, IS_CV2 } from '../../../utils/components.js';
import { stake } from '../../../eco/core.js';
import { settleRound } from '../../../eco/round.js';
import { renderPlinkoGif, ROWS, PLINKO_REVEAL_MS } from '../../../utils/plinkoBoard.js';
import { postWithReveal, mediaPanel } from '../../../utils/casinoReveal.js';

// Landing bucket k follows a binomial distribution: P(k) = C(10,k)/1024, i.e.
// 0.098% 0.977% 4.395% 11.719% 20.508% 24.609% (then mirrored).
// Tuned against exactly those odds for an RTP of 1.000000 — dead fair, no
// house edge (see the project's fairness rule). Don't change one without
// re-checking that sum(P[k] * MULTS[k]) stays 1.0.
//
// The previous 12-row table topped out at 120x/25x, but those two buckets hit
// under once in 150 drops while eating ~20% of the entire payout budget — so
// 85% of drops landed in a dull 0.2x-1.2x band and players never saw a real
// win. Spending that budget on the reachable tiers instead makes 3x+ land
// ~1 in 9 drops (was 1 in 26) and 8x+ ~1 in 46 (was 1 in 157), while the two
// most common buckets actually got *kinder* (0.2->0.25, 0.3->0.35).
const MULTS = [48, 8, 3, 1.2, 0.35, 0.25, 0.35, 1.2, 3, 8, 48];
const GIF_NAME = 'plinko.gif';

// Decides the drop with crypto RNG (project rule: never Math.random() for
// gambling). Returns the per-row ±1 bounces; the renderer animates a path that
// is guaranteed to end in `bucket`, so what you watch is what pays.
function dropBall(): { steps: number[]; bucket: number } {
  const steps: number[] = [];
  let bucket = 0;
  for (let r = 0; r < ROWS; r++) {
    if (rand() < 0.5) { steps.push(1); bucket++; } else { steps.push(-1); }
  }
  return { steps, bucket };
}

type DropResult = { gif: Buffer; content: string; accentColor: number; bet: number; sym: string };

async function playDrop(
  bet: number, guildId: string, userId: string,
  cfg: Awaited<ReturnType<typeof getEconomyConfig>>,
  client: ChatInputCommandInteraction['client'], channelId: string,
): Promise<DropResult> {
  const sym = cfg.currency_symbol;
  const { steps, bucket } = dropBall();
  const multiplier = MULTS[bucket]!;

  const gif = await renderPlinkoGif(steps, MULTS, bucket);

  const luckMult = (await getGambleMultiplier(guildId, userId));
  const winnings = Math.floor(bet * multiplier * luckMult);
  const profit = winnings > bet;
  // Partial losses count — the worst bucket still returns 0.25x, so insurance
  // covers what was actually lost rather than the whole bet.
  const round = await settleRound({
    guildId, userId, game: 'plinko', bet, returned: winnings, won: winnings >= bet,
    insuredLoss: winnings < bet ? bet - winnings : 0,
    xp: profit ? Math.min(50 + Math.floor(multiplier * 5), 200) : undefined,
    client, channelId, currencySymbol: sym,
  });

  const label = multiplier >= 48 ? '🚨 **JACKPOT!** Dead on the edge!'
    : multiplier >= 8 ? '🔥 **Huge hit!**'
    : multiplier >= 3 ? '**Big hit!**'
    : multiplier > 1 ? 'Nice — that pays.'
    : 'Straight down the middle…';
  const resultLine = winnings > bet
    ? `**${multiplier}x** — you won **${sym} ${winnings.toLocaleString()}**!${luckMult > 1 ? ' *(🍀 Lucky Charm!)*' : ''}`
    : winnings === bet
      ? `**${multiplier}x** — you broke even.`
      : `**${multiplier}x** — you got **${sym} ${winnings.toLocaleString()}** back, losing **${sym} ${(bet - winnings).toLocaleString()}**.${round.insuranceText}`;

  const content = `**🎲 Plinko** — Bet: ${sym} ${bet.toLocaleString()}\n${label}\n${resultLine}\n**Balance:** ${sym} **${round.balance.toLocaleString()}**${round.xpText}${round.jackpotText}`;
  const accentColor = profit ? Colors.Gold : winnings === bet ? Colors.Yellow : Colors.Red;
  return { gif, content, accentColor, bet, sym };
}

const againButton = (disabled: boolean) => new ButtonBuilder()
  .setCustomId('plinko_again').setLabel('🎲 Drop Again')
  .setStyle(ButtonStyle.Primary).setDisabled(disabled);

// Posts the drop, then reveals the payout once the ball has landed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showDrop(r: DropResult, edit: (p: any) => Promise<any>) {
  return postWithReveal({
    edit, gif: r.gif, name: GIF_NAME, revealMs: PLINKO_REVEAL_MS,
    suspense: { content: `**🎲 Plinko** — Bet: ${r.sym} ${r.bet.toLocaleString()}\nDropping…`, color: Colors.Blurple },
    result: { content: r.content, color: r.accentColor },
    button: againButton,
  });
}

const Plinko: Command = {
  data: new SlashCommandBuilder()
    .setName('plinko')
    .setDescription('Drop a ball down the Plinko board — the edges pay 120x!')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = (interaction.guildId ?? 'global');
    const userId = interaction.user.id;
    const bet = interaction.options.getInteger('bet', true);
    const cfg = await getEconomyConfig(guildId);
    const staked = await stake(guildId, userId, bet, 'plinko');
    if (!staked.success) {
      await interaction.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Your balance: **${cfg.currency_symbol} ${staked.newBalance.toLocaleString()}**.`)); return;
    }

    await interaction.deferReply();
    let last = await playDrop(bet, guildId, userId, cfg, interaction.client, interaction.channelId);
    let shown = await showDrop(last, (p) => interaction.editReply(p));
    const msg = shown.msg as Message;

    // Keeps the session in one message, like /slots — idle-based so an actively
    // playing user isn't cut off after a fixed window.
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: btn => btn.user.id === userId && btn.customId === 'plinko_again',
      idle: 5 * 60_000,
      time: 30 * 60_000,
    });

    collector.on('collect', async (btn) => {
      await btn.deferUpdate();
      const staked2 = await stake(guildId, userId, bet, 'plinko');
      if (!staked2.success) {
        collector.stop('broke');
        // Not cv2Err() — that bakes in the Ephemeral flag, which can't apply
        // after deferUpdate() already committed to a public message edit.
        const container = new ContainerBuilder().setAccentColor(Colors.Red).addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`❌ Not enough ${cfg.currency_name} to drop again — need **${cfg.currency_symbol} ${bet.toLocaleString()}**, you have **${cfg.currency_symbol} ${staked2.newBalance.toLocaleString()}**.`),
        );
        await btn.editReply({ flags: IS_CV2, components: [container], files: [] }).catch(() => {});
        return;
      }
      last = await playDrop(bet, guildId, userId, cfg, interaction.client, interaction.channelId);
      shown = await showDrop(last, (p) => btn.editReply(p));
    });

    collector.on('end', async (_c, reason) => {
      if (reason === 'broke') return;
      // Re-use the already-uploaded GIF URL so expiring the button doesn't
      // re-upload the file (which would replay the animation).
      await interaction.editReply({
        flags: IS_CV2,
        components: [mediaPanel(last.content, last.accentColor, shown.mediaUrl, againButton(true))],
      }).catch(() => {});
    });
  },
};

export default Plinko;
