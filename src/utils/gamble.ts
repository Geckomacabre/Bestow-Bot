import { ActionRowBuilder, ButtonBuilder, ContainerBuilder, TextDisplayBuilder } from 'discord.js';
import { getActiveBoost, consumeBoost, adjustBalance, addToJackpot, claimJackpot } from './db.js';
import { IS_CV2 } from './components.js';
import { rand } from './random.js';

// ─── Progressive jackpot ──────────────────────────────────────────────────────

/** Share of every loss that feeds the shared pot. */
export const JACKPOT_LOSS_CUT = 0.05;
/**
 * Odds of hitting the jackpot on a single bet: bet / ODDS_DIVISOR, so a bigger
 * bet buys proportionally better odds — the same way it contributes more to the
 * pot. Capped so a whale can't buy a near-certain hit.
 */
const JACKPOT_ODDS_DIVISOR = 500_000;
const JACKPOT_MAX_CHANCE = 0.005;
/** The pot must be worth winning before it can be hit. */
const JACKPOT_MIN_POT = 1_000;

export interface JackpotOutcome {
  /** Amount added to the pot from this loss. */
  contributed: number;
  /** Amount won (0 when not hit). Already credited to the player. */
  won: number;
}

/**
 * Handles the shared jackpot for one bet: feeds a slice of any loss into the
 * pot, then rolls for a hit.
 *
 * Coins only move between players — the pot is funded by losses and paid back
 * out in full, so nothing is skimmed out of the economy. It does mean each
 * game's own RTP sits a little under 1.0, with the difference returned through
 * the jackpot.
 *
 * @param netLoss How much the player actually lost on this bet (0 if they won).
 */
export async function settleJackpot(
  guildId: string, userId: string, bet: number, netLoss: number,
): Promise<JackpotOutcome> {
  let contributed = 0;
  if (netLoss > 0) {
    contributed = Math.floor(netLoss * JACKPOT_LOSS_CUT);
    if (contributed > 0) await addToJackpot(guildId, contributed);
  }

  const chance = Math.min(bet / JACKPOT_ODDS_DIVISOR, JACKPOT_MAX_CHANCE);
  if (rand() >= chance) return { contributed, won: 0 };

  // Won — but only if the pot is actually worth something.
  const { getJackpot } = await import('./db.js');
  const pot = await getJackpot(guildId);
  if (pot.amount < JACKPOT_MIN_POT) return { contributed, won: 0 };

  const won = await claimJackpot(guildId, userId);
  if (won > 0) await adjustBalance(guildId, userId, won);
  return { contributed, won };
}

/**
 * The jackpot panel text. Shared by /jackpot and the live jackpot sticky so
 * both always read the same — and so the sticky can rebuild it from the current
 * pot on every repost rather than showing whatever it said when it was set.
 */
export async function formatJackpotMessage(guildId: string): Promise<string> {
  const { getJackpot, getEconomyConfig } = await import('./db.js');
  const [jp, cfg] = await Promise.all([getJackpot(guildId), getEconomyConfig(guildId)]);
  const sym = cfg.currency_symbol;

  const last = jp.last_winner && jp.last_won_at
    ? `\n\n🏆 Last won by <@${jp.last_winner}> — **${sym} ${jp.last_amount.toLocaleString()}** <t:${Math.floor(jp.last_won_at / 1000)}:R>`
    : '\n\n*Nobody has hit it yet.*';

  return (
    `## 🎰 Progressive Jackpot\n\n` +
    `### ${sym} ${jp.amount.toLocaleString()}\n` +
    `Every casino game feeds the pot — **${Math.round(JACKPOT_LOSS_CUT * 100)}%** of every loss goes in, ` +
    `and any bet can hit it. Bigger bets have proportionally better odds.\n` +
    `Win it and the whole pool is yours; it resets to ${sym} ${jp.seed.toLocaleString()} and starts climbing again.` +
    last
  );
}

/** Banner appended to a game's result when the jackpot lands. */
export function jackpotLine(sym: string, won: number): string {
  return won > 0
    ? `\n\n🎰💥 **MEGA JACKPOT!** You hit the pool and won **${sym} ${won.toLocaleString()}**!`
    : '';
}

/**
 * Gambling Insurance (shop one-shot): if the user holds an unused policy,
 * consume it and refund half the lost bet. Returns the refund amount (0 when
 * no policy was active). Call AFTER the loss has been applied to the balance;
 * add the returned amount to any balance figure you display.
 */
export async function applyLossInsurance(guildId: string, userId: string, lostAmount: number): Promise<number> {
  const policy = await getActiveBoost(guildId, userId, 'insurance');
  if (!policy) return 0;
  await consumeBoost(guildId, userId, 'insurance');
  const refund = Math.floor(lostAmount / 2);
  if (refund > 0) await adjustBalance(guildId, userId, refund);
  return refund;
}

/** Message line appended to a loss when insurance paid out. */
export function insuranceLine(sym: string, refund: number): string {
  return refund > 0 ? `\n🛡️ **Gambling Insurance** paid out — **${sym} ${refund.toLocaleString()}** refunded.` : '';
}

/**
 * Shared Components-V2 game panel: an accent-colored card with the game's
 * text, optionally with a button row nested inside the same card (rather
 * than a separate plain-content message) so every gambling game has the
 * same polished look — win/loss color coding, no bare-text messages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGamePanel(content: string, accentColor: number, rows?: ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<ButtonBuilder>[]): any {
  const container = new ContainerBuilder().setAccentColor(accentColor).addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  if (rows) container.addActionRowComponents(...(Array.isArray(rows) ? rows : [rows]));
  return { flags: IS_CV2, components: [container] };
}
