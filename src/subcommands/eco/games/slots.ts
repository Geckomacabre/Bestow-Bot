import {
  ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, Colors, ComponentType, ContainerBuilder,
  InteractionContextType, Message, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../../interfaces/command';
import { getEconomyConfig, getGambleMultiplier } from '../../../utils/db';
import { randInt } from '../../../utils/random.js';
import { cv2Err, IS_CV2 } from '../../../utils/components.js';
import { stake } from '../../../eco/core.js';
import { settleRound } from '../../../eco/round.js';
import { renderSlotsGif, SLOTS_REVEAL_MS } from '../../../utils/slotsRender.js';
import { postWithReveal, mediaPanel } from '../../../utils/casinoReveal.js';

const GIF_NAME = 'slots.gif';

const REEL = ['🍒','🍒','🍒','🍒','🍒','🍋','🍋','🍋','🍋','🔔','🔔','🔔','💎','💎','7️⃣'];
// Paytable tuned to 99.97% RTP with a 60% hit rate (pairs pay too).
// A 🍒 pair returns half the bet, a 🍋 pair refunds it — everything above is profit.
const TRIPLE_MULT: Record<string, number> = { '🍒': 4, '🍋': 7, '🔔': 12, '💎': 25, '7️⃣': 75 };
const PAIR_MULT:   Record<string, number> = { '🍒': 0.5, '🍋': 1, '🔔': 1.5, '💎': 2, '7️⃣': 3 };
const LEGEND = '*Pairs: 🍒 ½x | 🍋 1x | 🔔 1.5x | 💎 2x | 7️⃣ 3x — Triples: 🍒 4x | 🍋 7x | 🔔 12x | 💎 25x | 7️⃣ 75x*';

function spinReel() { return REEL[randInt(0, REEL.length - 1)]!; }

// Builds the CV2 card, with the "Spin Again" button nested inside the same
// container so the panel keeps its accent-colored, boxed look.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPanel(content: string, accentColor: number, disabled = false): any {
  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .addActionRowComponents(row => row.addComponents(
      new ButtonBuilder().setCustomId('slots_again').setLabel('🔄 Spin Again').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    ));
  return { flags: IS_CV2, components: [container] };
}

type SpinResult = { content: string; accentColor: number; gif: Buffer; bet: number; sym: string };

const againButton = (disabled: boolean) => new ButtonBuilder()
  .setCustomId('slots_again').setLabel('🔄 Spin Again')
  .setStyle(ButtonStyle.Primary).setDisabled(disabled);

// Posts the spin, then reveals the payout once the reels have stopped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showSpin(r: SpinResult, edit: (p: any) => Promise<any>) {
  return postWithReveal({
    edit, gif: r.gif, name: GIF_NAME, revealMs: SLOTS_REVEAL_MS,
    suspense: { content: `**🎰 Slots** — Bet: ${r.sym} ${r.bet.toLocaleString()}\nSpinning…`, color: Colors.Blurple },
    result: { content: r.content, color: r.accentColor },
    button: againButton,
  });
}

// Resolves a single spin (bet already validated by the caller) — factored
// out so both the initial command and the "Spin Again" button reuse
// identical logic.
async function playSpin(
  bet: number, guildId: string, userId: string,
  cfg: Awaited<ReturnType<typeof getEconomyConfig>>,
  client: ChatInputCommandInteraction['client'], channelId: string,
): Promise<SpinResult> {
  const sym = cfg.currency_symbol;
  const reels = [spinReel(), spinReel(), spinReel()];

  const isTriple = reels[0] === reels[1] && reels[1] === reels[2];
  let pairSymbol: string | null = null;
  if (!isTriple) {
    if (reels[0] === reels[1] || reels[0] === reels[2]) pairSymbol = reels[0]!;
    else if (reels[1] === reels[2]) pairSymbol = reels[1]!;
  }
  const multiplier = isTriple ? TRIPLE_MULT[reels[0]!]! : pairSymbol ? PAIR_MULT[pairSymbol]! : 0;

  const luckMult = multiplier > 0 ? (await getGambleMultiplier(guildId, userId)) : 1;
  const winnings = Math.floor(bet * multiplier * luckMult);
  const profit = winnings > bet;
  // The stake was taken by the caller before the spin; this pays back whatever the reels returned.
  const round = await settleRound({
    guildId, userId, game: 'slots', bet, returned: winnings, won: winnings >= bet,
    xp: profit ? Math.min(50 + Math.floor(multiplier * 20), 200) : undefined,
    client, channelId, currencySymbol: sym,
  });

  const label = isTriple
    ? `**JACKPOT!** Triple ${reels[0]}`
    : pairSymbol
      ? `**Pair of ${pairSymbol}!**`
      : 'No match — better luck next time!';
  const resultLine = multiplier === 0
    ? `You lost **${sym} ${bet.toLocaleString()}**.${round.insuranceText}`
    : winnings >= bet
      ? `**${multiplier}x** — you won **${sym} ${winnings.toLocaleString()}**!${luckMult > 1 ? ' *(🍀 Lucky Charm!)*' : ''}`
      : `**${multiplier}x** — you got **${sym} ${winnings.toLocaleString()}** back.`;

  const content = `**🎰 Slots** — Bet: ${sym} ${bet.toLocaleString()}\n${reels.join(' ｜ ')}\n${label}\n${resultLine}\n**Balance:** ${sym} **${round.balance.toLocaleString()}**\n${LEGEND}${round.xpText}${round.jackpotText}`;
  const accentColor = profit ? Colors.Gold : multiplier > 0 ? Colors.Yellow : Colors.Red;
  const gif = await renderSlotsGif(reels as string[], multiplier > 0);
  return { content, accentColor, gif, bet, sym };
}

const Slots: Command = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Spin the slot machine — pairs pay, triples pay big!')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = (interaction.guildId ?? 'global');
    const userId = interaction.user.id;
    const bet = interaction.options.getInteger('bet', true);
    const cfg = await getEconomyConfig(guildId);
    const staked = await stake(guildId, userId, bet, 'slots');
    if (!staked.success) {
      await interaction.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Your balance: **${cfg.currency_symbol} ${staked.newBalance.toLocaleString()}**.`)); return;
    }

    await interaction.deferReply();
    let last = await playSpin(bet, guildId, userId, cfg, interaction.client, interaction.channelId);
    let shown = await showSpin(last, (p) => interaction.editReply(p));
    const msg = shown.msg as Message;

    // Keeps the whole session in one message instead of a new one per spin.
    // idle-based so an actively-playing user isn't cut off after a fixed
    // 2 minutes — the button only expires after a stretch of inactivity.
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: btn => btn.user.id === userId && btn.customId === 'slots_again',
      idle: 5 * 60_000,
      time: 30 * 60_000,
    });

    collector.on('collect', async (btn) => {
      await btn.deferUpdate();
      const staked2 = await stake(guildId, userId, bet, 'slots');
      if (!staked2.success) {
        collector.stop('broke');
        // Not cv2Err() — that bakes in the Ephemeral flag, which can't apply
        // after deferUpdate() already committed to a public message edit.
        const container = new ContainerBuilder().setAccentColor(Colors.Red).addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`❌ Not enough ${cfg.currency_name} to spin again — need **${cfg.currency_symbol} ${bet.toLocaleString()}**, you have **${cfg.currency_symbol} ${staked2.newBalance.toLocaleString()}**.`),
        );
        await btn.editReply({ flags: IS_CV2, components: [container] }).catch(() => {});
        return;
      }
      last = await playSpin(bet, guildId, userId, cfg, interaction.client, interaction.channelId);
      shown = await showSpin(last, (p) => btn.editReply(p));
    });

    collector.on('end', async (_c, reason) => {
      if (reason === 'broke') return;
      // Re-use the uploaded GIF URL so expiring the button doesn't re-upload
      // the file (which would replay the animation).
      await interaction.editReply({
        flags: IS_CV2,
        components: [mediaPanel(last.content, last.accentColor, shown.mediaUrl, againButton(true))],
      }).catch(() => {});
    });
  },
};

export default Slots;
