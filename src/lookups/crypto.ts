import { getJson } from '../framework/http.js';
import { LookupError } from './handler.js';

/** Crypto lookups: prices (CoinGecko), BTC/ETH wallets (Blockstream / Blockscout), fees (Blockscout + mempool.space). All keyless and read-only. */

const MIN = 60_000;

export const usd = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1) return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: a >= 1000 ? 0 : 2 });
  if (a === 0) return '$0';
  return `$${n.toPrecision(3)}`;
};
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(2)}%`);

/** Heist's currency choices. Fiat is shown with its symbol; BTC/ETH as amounts of that coin. */
export type Vs = 'usd' | 'eur' | 'gbp' | 'jpy' | 'btc' | 'eth';
export const vsOf = (choice: string | null | undefined): Vs => ((choice ?? 'USD').toLowerCase() as Vs);
export function money(n: number | null | undefined, vs: Vs = 'usd'): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (vs === 'usd') return usd(n);
  if (vs === 'btc' || vs === 'eth') return `${n.toLocaleString('en-US', { maximumSignificantDigits: 6 })} ${vs.toUpperCase()}`;
  const a = Math.abs(n);
  if (a > 0 && a < 1) return `${n.toPrecision(3)} ${vs.toUpperCase()}`;
  return n.toLocaleString('en-US', { style: 'currency', currency: vs.toUpperCase(), maximumFractionDigits: vs === 'jpy' || a >= 1000 ? 0 : 2 });
}

// ─── Prices ──────────────────────────────────────────────────────────────────

export interface Coin {
  id: string; symbol: string; name: string; image?: string; price: number; rank?: number; marketCap?: number; volume?: number; high24h?: number; low24h?: number;
  change24h?: number; change7d?: number; ath?: number; athChange?: number; supply?: number; maxSupply?: number | null;
}
interface CoinRaw {
  id: string; symbol: string; name: string; image?: string; current_price: number; market_cap_rank?: number; market_cap?: number; total_volume?: number; high_24h?: number; low_24h?: number;
  price_change_percentage_24h?: number; price_change_percentage_7d_in_currency?: number; ath?: number; ath_change_percentage?: number; circulating_supply?: number; max_supply?: number | null;
}
interface SearchRaw { coins: { id: string; name: string; symbol: string; market_cap_rank: number | null }[] }

export function parseCoin(r: CoinRaw): Coin {
  return {
    id: r.id, symbol: r.symbol.toUpperCase(), name: r.name, image: r.image, price: r.current_price, rank: r.market_cap_rank, marketCap: r.market_cap, volume: r.total_volume,
    high24h: r.high_24h, low24h: r.low_24h, change24h: r.price_change_percentage_24h, change7d: r.price_change_percentage_7d_in_currency, ath: r.ath, athChange: r.ath_change_percentage,
    supply: r.circulating_supply, maxSupply: r.max_supply,
  };
}

/** Exact symbol/id/name match wins (best market-cap rank first); otherwise the top search hit. */
export function pickCoin(query: string, coins: SearchRaw['coins']): string | undefined {
  const q = query.trim().toLowerCase();
  const ranked = [...coins].sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
  return (ranked.find(c => c.symbol.toLowerCase() === q || c.id === q || c.name.toLowerCase() === q) ?? coins[0])?.id;
}

export async function resolveCoinId(query: string): Promise<string> {
  const q = query.trim();
  if (!/^[\w .-]{1,40}$/.test(q)) throw new LookupError('Give me a coin name or ticker, like `bitcoin` or `eth`.');
  const r = await getJson<SearchRaw>(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`, { cacheMs: 10 * MIN });
  const id = pickCoin(q, r.coins ?? []);
  if (!id) throw new LookupError(`I couldn't find a coin called **${q}**.`);
  return id;
}

export async function coinPrice(query: string, vs: Vs = 'usd'): Promise<Coin> {
  const id = await resolveCoinId(query);
  const r = await getJson<CoinRaw[]>(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&ids=${encodeURIComponent(id)}&price_change_percentage=24h,7d`, { cacheMs: MIN });
  if (!r[0]) throw new LookupError(`I couldn't find price data for **${query}**.`);
  return parseCoin(r[0]);
}

export async function convertCoins(amount: number, from: string, to: string): Promise<{ from: Coin; to: Coin; result: number }> {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e15) throw new LookupError('That amount doesn\'t look right.');
  const [a, b] = await Promise.all([coinPrice(from), coinPrice(to)]);
  if (!b.price) throw new LookupError(`**${b.name}** has no price right now.`);
  return { from: a, to: b, result: (amount * a.price) / b.price };
}

export async function topCoins(n = 10, vs: Vs = 'usd'): Promise<Coin[]> {
  const r = await getJson<CoinRaw[]>(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${Math.max(1, Math.min(50, n))}&page=1&price_change_percentage=24h`, { cacheMs: 2 * MIN });
  return r.map(parseCoin);
}

/** Price history for a chart: [ms, price] pairs. */
export async function coinChart(query: string, vs: Vs = 'usd', days = 30): Promise<{ coin: Coin; points: { x: number; y: number }[] }> {
  const coin = await coinPrice(query, vs);
  const r = await getJson<{ prices?: [number, number][] }>(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coin.id)}/market_chart?vs_currency=${vs}&days=${days}`, { cacheMs: 10 * MIN });
  return { coin, points: (r.prices ?? []).map(([x, y]) => ({ x, y })) };
}

// ─── Wallets ─────────────────────────────────────────────────────────────────

export const isBtcAddress = (a: string) => /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a);
export const isEthAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

export const satsToBtc = (sats: number | bigint): string => {
  const s = BigInt(sats), neg = s < 0n, abs = neg ? -s : s;
  const whole = abs / 100_000_000n, frac = (abs % 100_000_000n).toString().padStart(8, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
};
/** Wei (as a decimal string) → ETH with up to 6 decimals, exact (BigInt, no float rounding). */
export const weiToEth = (wei: string | bigint, decimals = 6): string => {
  const w = BigInt(wei), scale = 10n ** BigInt(18 - decimals), r = (w + scale / 2n) / scale;
  const whole = r / 10n ** BigInt(decimals), frac = (r % 10n ** BigInt(decimals)).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};

export interface Wallet { chain: 'BTC' | 'ETH'; address: string; balance: string; usdValue?: number; txCount: number; extra: [string, string][]; explorer: string }

interface BtcRaw { chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }; mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number } }
export function parseBtc(address: string, r: BtcRaw, usdPrice?: number): Wallet {
  const confirmed = r.chain_stats.funded_txo_sum - r.chain_stats.spent_txo_sum;
  const pending = r.mempool_stats.funded_txo_sum - r.mempool_stats.spent_txo_sum;
  const bal = confirmed + pending;
  const extra: [string, string][] = [['Total received', `${satsToBtc(r.chain_stats.funded_txo_sum)} BTC`], ['Total sent', `${satsToBtc(r.chain_stats.spent_txo_sum)} BTC`]];
  if (r.mempool_stats.tx_count) extra.push(['Unconfirmed', `${r.mempool_stats.tx_count} tx (${satsToBtc(pending)} BTC)`]);
  return { chain: 'BTC', address, balance: `${satsToBtc(bal)} BTC`, usdValue: usdPrice ? (bal / 1e8) * usdPrice : undefined, txCount: r.chain_stats.tx_count + r.mempool_stats.tx_count, extra, explorer: `https://mempool.space/address/${address}` };
}

interface EthRaw { coin_balance: string | null; exchange_rate?: string | null; is_contract?: boolean; ens_domain_name?: string | null; name?: string | null; is_scam?: boolean }
interface EthCounters { transactions_count?: string; token_transfers_count?: string }
export function parseEth(address: string, r: EthRaw, c: EthCounters): Wallet {
  const wei = r.coin_balance ?? '0';
  const rate = r.exchange_rate ? Number(r.exchange_rate) : undefined;
  const extra: [string, string][] = [];
  if (r.ens_domain_name) extra.push(['ENS', r.ens_domain_name]);
  if (r.name) extra.push(['Name', r.name]);
  extra.push(['Type', r.is_contract ? 'Smart contract' : 'Wallet']);
  if (c.token_transfers_count) extra.push(['Token transfers', Number(c.token_transfers_count).toLocaleString('en-US')]);
  if (r.is_scam) extra.push(['⚠️ Flagged', 'Marked as a scam by the explorer']);
  return { chain: 'ETH', address, balance: `${weiToEth(wei)} ETH`, usdValue: rate ? (Number(weiToEth(wei, 9)) * rate) : undefined, txCount: Number(c.transactions_count ?? 0), extra, explorer: `https://etherscan.io/address/${address}` };
}

export async function wallet(input: string): Promise<Wallet> {
  const a = input.trim();
  if (isEthAddress(a)) {
    const [r, c] = await Promise.all([
      getJson<EthRaw>(`https://eth.blockscout.com/api/v2/addresses/${a}`, { cacheMs: MIN }),
      getJson<EthCounters>(`https://eth.blockscout.com/api/v2/addresses/${a}/counters`, { cacheMs: MIN }).catch(() => ({} as EthCounters)),
    ]);
    return parseEth(a, r, c);
  }
  if (isBtcAddress(a)) {
    const [r, price] = await Promise.all([
      getJson<BtcRaw>(`https://blockstream.info/api/address/${a}`, { cacheMs: MIN }),
      coinPrice('bitcoin').then(c => c.price).catch(() => undefined),
    ]);
    return parseBtc(a, r, price);
  }
  throw new LookupError('That isn\'t a Bitcoin or Ethereum address. (Bitcoin: `bc1…`/`1…`/`3…`, Ethereum: `0x…` + 40 hex characters.)');
}

// ─── Fees ────────────────────────────────────────────────────────────────────

export interface Gas { eth: { slow: number; average: number; fast: number } | null; ethPriceUsd?: number; btc: { fastest: number; halfHour: number; hour: number; economy: number } | null }
export async function gas(): Promise<Gas> {
  const [e, b] = await Promise.all([
    getJson<{ gas_prices?: { slow: number; average: number; fast: number }; coin_price?: string }>('https://eth.blockscout.com/api/v2/stats', { cacheMs: 30_000 }).catch(() => null),
    getJson<{ fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number }>('https://mempool.space/api/v1/fees/recommended', { cacheMs: 30_000 }).catch(() => null),
  ]);
  if (!e?.gas_prices && !b) throw new LookupError('Both fee services are unreachable right now.');
  return {
    eth: e?.gas_prices ?? null, ethPriceUsd: e?.coin_price ? Number(e.coin_price) : undefined,
    btc: b ? { fastest: b.fastestFee, halfHour: b.halfHourFee, hour: b.hourFee, economy: b.economyFee } : null,
  };
}
/** Cost in USD of a plain 21,000-gas ETH transfer at `gwei`. */
export const transferCostUsd = (gwei: number, ethUsd: number) => gwei * 1e-9 * 21_000 * ethUsd;
