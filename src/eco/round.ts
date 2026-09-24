import type { Client } from 'discord.js';
import { recordGameResult } from '../utils/db.js';
import { applyLossInsurance, insuranceLine, jackpotLine, settleJackpot } from '../utils/gamble.js';
import { awardBonusXp } from '../utils/xpBonus.js';
import { noteLoss, payout } from './core.js';

/**
 * Shared ending for every casino-style round. The stake was already taken with stake()
 * when the round started; this pays back whatever the player gets (stake + winnings,
 * or 0 on a loss) and applies the side effects every game shares.
 */
export interface RoundInput {
  guildId: string;
  userId: string;
  game: string;
  bet: number;
  /** Total credited back: 0 = lost, bet = push, more than bet = won. */
  returned: number;
  /** Count this round as a win in game stats (default: returned > bet). */
  won?: boolean;
  /** XP to award on a win (base amount before boosts); omit for none. */
  xp?: number;
  /** Amount Gambling Insurance may cover (default: the whole bet on a total loss, nothing otherwise). */
  insuredLoss?: number;
  client: Client;
  channelId: string;
  currencySymbol: string;
}

export interface RoundResult {
  /** Balance after everything, including insurance refund and jackpot. */
  balance: number;
  refund: number;
  jackpotWon: number;
  insuranceText: string;
  jackpotText: string;
  xpText: string;
  profit: number;
}

export async function settleRound(r: RoundInput): Promise<RoundResult> {
  const { guildId, userId, game, bet, returned, currencySymbol: sym } = r;
  const won = r.won ?? returned > bet;
  const push = returned === bet;
  const netLoss = Math.max(0, bet - returned);

  let balance = await payout(guildId, userId, returned, game, push ? 'push' : 'win');
  if (netLoss > 0) await noteLoss(userId, netLoss);
  if (!push) recordGameResult(guildId, userId, game, won, bet).catch(() => {});

  const insurable = r.insuredLoss ?? (returned === 0 ? bet : 0);
  const refund = insurable > 0 ? await applyLossInsurance(guildId, userId, insurable) : 0;
  const jp = await settleJackpot(guildId, userId, bet, netLoss);
  balance += refund + jp.won;

  let xpText = '';
  if (won && r.xp) {
    const given = await awardBonusXp({ guildId, userId, baseAmount: r.xp, client: r.client, channelId: r.channelId, isGame: true });
    xpText = given > 0 ? `\n+**${given} XP** earned!` : '\n*(Daily XP cap reached)*';
  }

  return {
    balance,
    refund,
    jackpotWon: jp.won,
    insuranceText: insuranceLine(sym, refund),
    jackpotText: jackpotLine(sym, jp.won),
    xpText,
    profit: returned - bet,
  };
}
