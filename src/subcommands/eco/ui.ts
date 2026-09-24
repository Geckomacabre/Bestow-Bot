import { Colors, type ChatInputCommandInteraction } from 'discord.js';
import { getEconomyConfig, type IEconomyConfig } from '../../utils/db.js';
import { cv2Box, cv2Err } from '../../utils/components.js';

export { Colors, cv2Box, cv2Err };

export interface EcoCtx {
  guildId: string;
  userId: string;
  cfg: IEconomyConfig;
  sym: string;
  name: string;
  /** "🪙 1,234" */
  fmt: (n: number) => string;
}

export async function ecoCtx(i: ChatInputCommandInteraction): Promise<EcoCtx> {
  const guildId = i.guildId!;
  const cfg = await getEconomyConfig(guildId);
  const sym = cfg.currency_symbol;
  return { guildId, userId: i.user.id, cfg, sym, name: cfg.currency_name, fmt: n => `${sym} ${n.toLocaleString()}` };
}

/**
 * Parse a friendly amount: "500", "1,000", "2.5k", "1m", "all", "half", "25%".
 * `max` is what "all"/percentages are relative to. Returns null when it isn't a valid positive amount.
 */
export function parseAmount(input: string, max: number): number | null {
  const s = input.trim().toLowerCase().replace(/[, _]/g, '');
  if (!s) return null;
  if (s === 'all' || s === 'max') return max > 0 ? max : null;
  if (s === 'half') return max >= 2 ? Math.floor(max / 2) : null;
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(s);
  if (pct) {
    const v = Math.floor((max * Math.min(100, Number(pct[1]))) / 100);
    return v > 0 ? v : null;
  }
  const m = /^(\d+(?:\.\d+)?)([kmb]?)$/.exec(s);
  if (!m) return null;
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
  const v = Math.floor(Number(m[1]) * mult);
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}

export const AMOUNT_HELP = 'Amount: a number, 1k / 2.5m, 50%, half or all';

export function ago(ts: number): string {
  return `<t:${Math.floor(ts / 1000)}:R>`;
}

export function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString();
}
