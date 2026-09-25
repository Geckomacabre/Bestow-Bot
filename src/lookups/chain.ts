import { getJson, postJson, HttpError } from '../framework/http.js';
import { LookupError } from './handler.js';
import { isBtcAddress, isEthAddress, weiToEth } from './crypto.js';

/**
 * Wallets, transactions and fees across the chains Heist lists.
 *  - Bitcoin, Litecoin, Dogecoin, Dash: BlockCypher (keyless; BLOCKCYPHER_TOKEN raises the rate limit).
 *  - Ethereum: Blockscout.
 *  - Gas for EVM chains: each network's public JSON-RPC (eth_gasPrice).
 */

export type Chain = 'btc' | 'ltc' | 'doge' | 'dash' | 'eth';
export const CHAIN_NAMES: Record<Chain, string> = { btc: 'Bitcoin', ltc: 'Litecoin', doge: 'Dogecoin', dash: 'Dash', eth: 'Ethereum' };
export const CHAIN_SYMBOL: Record<Chain, string> = { btc: 'BTC', ltc: 'LTC', doge: 'DOGE', dash: 'DASH', eth: 'ETH' };
export const CHAIN_COLOR: Record<Chain, number> = { btc: 0xf7931a, ltc: 0x345d9d, doge: 0xc2a633, dash: 0x008ce7, eth: 0x627eea };
export const COINGECKO_ID: Record<Chain, string> = { btc: 'bitcoin', ltc: 'litecoin', doge: 'dogecoin', dash: 'dash', eth: 'ethereum' };

export const chainOf = (choice: string | null | undefined): Chain | null =>
  choice ? ((Object.entries(CHAIN_NAMES).find(([, n]) => n.toLowerCase() === choice.toLowerCase())?.[0] as Chain | undefined) ?? null) : null;

export const isLtcAddress = (a: string) => /^(ltc1[a-z0-9]{25,87}|[LM][a-km-zA-HJ-NP-Z1-9]{26,33})$/.test(a);
export const isDogeAddress = (a: string) => /^[DA9][1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
export const isDashAddress = (a: string) => /^X[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);

/** The chain an address belongs to (Bitcoin wins the `3…` P2SH overlap with Litecoin unless a chain is chosen). */
export function detectAddressChain(a: string): Chain | null {
  if (isEthAddress(a)) return 'eth';
  if (isBtcAddress(a)) return 'btc';
  if (isLtcAddress(a)) return 'ltc';
  if (isDashAddress(a)) return 'dash';
  if (isDogeAddress(a)) return 'doge';
  return null;
}

const bc = (chain: Exclude<Chain, 'eth'>, path: string) => {
  const token = Bun.env.BLOCKCYPHER_TOKEN ? `${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(Bun.env.BLOCKCYPHER_TOKEN)}` : '';
  return getJson<unknown>(`https://api.blockcypher.com/v1/${chain}/main${path}${token}`, { cacheMs: 30_000, timeoutMs: 15_000 }).catch(e => {
    if (e instanceof HttpError && (e.status === 404 || e.status === 400)) throw new LookupError(`I couldn't find that on the ${CHAIN_NAMES[chain]} blockchain.`);
    if (e instanceof HttpError && e.status === 429) throw new LookupError('The blockchain API is rate-limiting me — try again in a minute.');
    throw e;
  });
};

export const fromSats = (n: number) => n / 1e8;
export const fmtCoin = (n: number, sym: string) => `${n.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${sym}`;

export interface WalletInfo { chain: Chain; address: string; balance: number; unconfirmed: number; received?: number; sent?: number; txCount: number; recent: { hash: string; amount: number; confirmations: number; time?: number }[]; explorer: string; extra: [string, string][] }

interface BcAddr { balance: number; unconfirmed_balance: number; final_balance: number; n_tx: number; total_received: number; total_sent: number; txrefs?: { tx_hash: string; value: number; tx_input_n: number; confirmations: number; confirmed?: string }[]; unconfirmed_txrefs?: { tx_hash: string; value: number; tx_input_n: number; received?: string }[] }

export function parseBcAddr(chain: Exclude<Chain, 'eth'>, address: string, r: BcAddr): WalletInfo {
  const refs = [...(r.unconfirmed_txrefs ?? []).map(t => ({ ...t, confirmations: 0, confirmed: t.received })), ...(r.txrefs ?? [])];
  const seen = new Set<string>();
  const recent = refs.filter(t => (seen.has(t.tx_hash) ? false : (seen.add(t.tx_hash), true))).slice(0, 5)
    .map(t => ({ hash: t.tx_hash, amount: fromSats(t.tx_input_n >= 0 ? -t.value : t.value), confirmations: t.confirmations, time: t.confirmed ? Date.parse(t.confirmed) : undefined }));
  return {
    chain, address, balance: fromSats(r.final_balance), unconfirmed: fromSats(r.unconfirmed_balance), received: fromSats(r.total_received), sent: fromSats(r.total_sent), txCount: r.n_tx, recent,
    explorer: `https://live.blockcypher.com/${chain}/address/${address}/`, extra: [],
  };
}

export async function walletInfo(address: string, chainChoice: Chain | null): Promise<WalletInfo> {
  const a = address.trim();
  const chain = chainChoice ?? detectAddressChain(a);
  if (!chain) throw new LookupError('I can\'t tell which blockchain that address is on — pick the `chain`.');
  if (chain === 'eth') {
    if (!isEthAddress(a)) throw new LookupError('That isn\'t an Ethereum address (0x + 40 hex characters).');
    const [r, c, txs] = await Promise.all([
      getJson<{ coin_balance: string | null; ens_domain_name?: string | null; is_contract?: boolean; is_scam?: boolean }>(`https://eth.blockscout.com/api/v2/addresses/${a}`, { cacheMs: 30_000 }),
      getJson<{ transactions_count?: string }>(`https://eth.blockscout.com/api/v2/addresses/${a}/counters`, { cacheMs: 30_000 }).catch(() => ({} as { transactions_count?: string })),
      getJson<{ items?: { hash: string; value: string; from: { hash: string }; confirmations?: number; timestamp?: string }[] }>(`https://eth.blockscout.com/api/v2/addresses/${a}/transactions`, { cacheMs: 30_000 }).catch(() => ({ items: [] })),
    ]);
    const extra: [string, string][] = [];
    if (r.ens_domain_name) extra.push(['ENS', r.ens_domain_name]);
    extra.push(['Type', r.is_contract ? 'Smart contract' : 'Wallet']);
    if (r.is_scam) extra.push(['⚠️ Flagged', 'Marked as a scam by the explorer']);
    return {
      chain, address: a, balance: Number(weiToEth(r.coin_balance ?? '0', 9)), unconfirmed: 0, txCount: Number(c.transactions_count ?? 0), extra,
      recent: (txs.items ?? []).slice(0, 5).map(t => ({ hash: t.hash, amount: Number(weiToEth(t.value, 9)) * (t.from.hash.toLowerCase() === a.toLowerCase() ? -1 : 1), confirmations: t.confirmations ?? 0, time: t.timestamp ? Date.parse(t.timestamp) : undefined })),
      explorer: `https://etherscan.io/address/${a}`,
    };
  }
  return parseBcAddr(chain, a, (await bc(chain, `/addrs/${encodeURIComponent(a)}?limit=10`)) as BcAddr);
}

export interface TxInfo { chain: Chain; hash: string; confirmations: number; block?: number; time?: number; amount: number; fee?: number; from: string[]; to: string[]; status: 'confirmed' | 'pending' | 'failed'; explorer: string }

interface BcTx { hash: string; block_height: number; confirmations: number; confirmed?: string; received?: string; total: number; fees: number; inputs?: { addresses?: string[] }[]; outputs?: { addresses?: string[]; value: number }[] }

export function parseBcTx(chain: Exclude<Chain, 'eth'>, r: BcTx): TxInfo {
  return {
    chain, hash: r.hash, confirmations: r.confirmations ?? 0, block: r.block_height > 0 ? r.block_height : undefined, time: Date.parse(r.confirmed ?? r.received ?? '') || undefined,
    amount: fromSats(r.total), fee: fromSats(r.fees), from: [...new Set((r.inputs ?? []).flatMap(x => x.addresses ?? []))], to: [...new Set((r.outputs ?? []).flatMap(x => x.addresses ?? []))],
    status: (r.confirmations ?? 0) > 0 ? 'confirmed' : 'pending', explorer: `https://live.blockcypher.com/${chain}/tx/${r.hash}/`,
  };
}

interface ScoutTx { hash: string; status?: string | null; result?: string; block_number?: number | null; block?: number | null; confirmations?: number; timestamp?: string | null; value: string; fee?: { value?: string } | null; from: { hash: string }; to?: { hash: string } | null }

export function parseScoutTx(r: ScoutTx): TxInfo {
  const pending = r.result === 'pending' || (r.block_number ?? r.block) == null;
  return {
    chain: 'eth', hash: r.hash, confirmations: r.confirmations ?? 0, block: (r.block_number ?? r.block) ?? undefined, time: r.timestamp ? Date.parse(r.timestamp) : undefined,
    amount: Number(weiToEth(r.value, 9)), fee: r.fee?.value ? Number(weiToEth(r.fee.value, 9)) : undefined, from: [r.from.hash], to: r.to?.hash ? [r.to.hash] : [],
    status: pending ? 'pending' : r.status === 'error' ? 'failed' : 'confirmed', explorer: `https://etherscan.io/tx/${r.hash}`,
  };
}

export async function txInfo(hash: string, chainChoice: Chain | null): Promise<TxInfo> {
  const h = hash.trim();
  const isEvm = /^0x[0-9a-fA-F]{64}$/.test(h);
  if (!isEvm && !/^[0-9a-fA-F]{64}$/.test(h)) throw new LookupError('A transaction hash is 64 hex characters (Ethereum ones start with 0x).');
  if (chainChoice === 'eth' || (!chainChoice && isEvm)) {
    if (!isEvm) throw new LookupError('Ethereum transaction hashes start with 0x.');
    try { return parseScoutTx(await getJson<ScoutTx>(`https://eth.blockscout.com/api/v2/transactions/${h}`, { cacheMs: 15_000 })); }
    catch (e) { if (e instanceof HttpError && (e.status === 404 || e.status === 422)) throw new LookupError('I couldn\'t find that Ethereum transaction.'); throw e; }
  }
  const tries: Exclude<Chain, 'eth'>[] = chainChoice ? [chainChoice] : ['btc', 'ltc', 'doge', 'dash'];
  for (const c of tries) {
    try { return parseBcTx(c, (await bc(c, `/txs/${h}?limit=50`)) as BcTx); }
    catch (e) { if (!(e instanceof LookupError) || tries.length === 1) throw e; }
  }
  throw new LookupError('I couldn\'t find that transaction on Bitcoin, Litecoin, Dogecoin or Dash.');
}

// ─── Gas on EVM chains ───────────────────────────────────────────────────────

export const EVM: Record<string, { rpc: string; symbol: string; coingecko: string; explorer: string }> = {
  'Ethereum': { rpc: 'https://cloudflare-eth.com', symbol: 'ETH', coingecko: 'ethereum', explorer: 'https://etherscan.io/gastracker' },
  'Polygon': { rpc: 'https://polygon-rpc.com', symbol: 'POL', coingecko: 'polygon-ecosystem-token', explorer: 'https://polygonscan.com/gastracker' },
  'BNB Chain': { rpc: 'https://bsc-dataseed.bnbchain.org', symbol: 'BNB', coingecko: 'binancecoin', explorer: 'https://bscscan.com/gastracker' },
  'Arbitrum': { rpc: 'https://arb1.arbitrum.io/rpc', symbol: 'ETH', coingecko: 'ethereum', explorer: 'https://arbiscan.io' },
  'Optimism': { rpc: 'https://mainnet.optimism.io', symbol: 'ETH', coingecko: 'ethereum', explorer: 'https://optimistic.etherscan.io' },
  'Base': { rpc: 'https://mainnet.base.org', symbol: 'ETH', coingecko: 'ethereum', explorer: 'https://basescan.org' },
  'Avalanche': { rpc: 'https://api.avax.network/ext/bc/C/rpc', symbol: 'AVAX', coingecko: 'avalanche-2', explorer: 'https://snowtrace.io' },
};

export const hexToGwei = (hex: string) => Number(BigInt(hex)) / 1e9;

export async function evmGas(chain: string): Promise<{ chain: string; gwei: number; symbol: string; priceUsd?: number; transferUsd?: number; explorer: string }> {
  const c = EVM[chain] ?? EVM.Ethereum!;
  const name = EVM[chain] ? chain : 'Ethereum';
  const [r, price] = await Promise.all([
    postJson<{ result?: string; error?: { message: string } }>(c.rpc, { jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }, { timeoutMs: 10_000 }),
    getJson<Record<string, { usd?: number }>>(`https://api.coingecko.com/api/v3/simple/price?ids=${c.coingecko}&vs_currencies=usd`, { cacheMs: 60_000 }).then(p => p[c.coingecko]?.usd).catch(() => undefined),
  ]);
  if (!r.result) throw new LookupError(`${name}'s network didn't answer.`);
  const gwei = hexToGwei(r.result);
  return { chain: name, gwei, symbol: c.symbol, priceUsd: price, transferUsd: price ? gwei * 1e-9 * 21_000 * price : undefined, explorer: c.explorer };
}
