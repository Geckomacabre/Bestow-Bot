import { getJson, HttpError } from '../framework/http.js';
import { LookupError } from './handler.js';

/** TON blockchain via tonapi.io v2 (public; TONAPI_KEY raises the rate limit). Addresses and .ton domains both work. */

const API = 'https://tonapi.io/v2';
const headers = (): Record<string, string> => (Bun.env.TONAPI_KEY ? { Authorization: `Bearer ${Bun.env.TONAPI_KEY}` } : {});

async function ton<T>(path: string): Promise<T> {
  try { return await getJson<T>(`${API}${path}`, { headers: headers(), cacheMs: 60_000, timeoutMs: 15_000 }); }
  catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 400)) throw new LookupError('I couldn\'t find that TON address or domain.');
    throw e;
  }
}

/** Raw (0:abc…) and user-friendly (EQ…/UQ…) addresses, or a .ton / .t.me domain. */
export function cleanTonQuery(input: string): string {
  const s = input.trim();
  if (/^-?\d:[0-9a-fA-F]{64}$/.test(s) || /^[EUk0][Qf][A-Za-z0-9_-]{46}$/.test(s)) return s;
  const d = s.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (/^([a-z0-9-]{1,126}\.)+(ton|t\.me)$/.test(d) || /^[a-z0-9-]{4,126}$/.test(d)) return d.includes('.') ? d : `${d}.ton`;
  throw new LookupError('Give me a TON address (EQ…/UQ… or 0:…) or a .ton domain.');
}

export const nanoToTon = (n: number | string) => Number(BigInt(String(n))) / 1e9;
export const fmtTon = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 3 })} TON`;

export interface TonAccount { address: string; balance: number; status: string; name?: string; icon?: string; lastActivity?: number; isWallet: boolean; interfaces: string[]; memoRequired?: boolean; isScam?: boolean }

export function parseAccount(r: { address: string; balance: number; status: string; name?: string; icon?: string; last_activity?: number; is_wallet?: boolean; interfaces?: string[]; memo_required?: boolean; is_scam?: boolean }): TonAccount {
  return { address: r.address, balance: nanoToTon(r.balance), status: r.status, name: r.name, icon: r.icon, lastActivity: r.last_activity ? r.last_activity * 1000 : undefined, isWallet: !!r.is_wallet, interfaces: r.interfaces ?? [], memoRequired: r.memo_required, isScam: r.is_scam };
}

export async function account(input: string): Promise<TonAccount> {
  return parseAccount(await ton(`/accounts/${encodeURIComponent(cleanTonQuery(input))}`));
}

/** The address a user-friendly UI should show (tonapi returns raw 0:…; tonviewer accepts either). */
export const explorer = (addr: string) => `https://tonviewer.com/${encodeURIComponent(addr)}`;

export interface TonDns { domain: string; wallet?: string; walletName?: string; sites: string[]; owner?: string; expires?: number }

export async function dns(input: string): Promise<TonDns> {
  const domain = cleanTonQuery(input);
  if (!domain.includes('.')) throw new LookupError('Give me a domain like `foundation.ton`.');
  const [res, info] = await Promise.all([
    ton<{ wallet?: { address: string; name?: string }; sites?: string[] }>(`/dns/${encodeURIComponent(domain)}/resolve`).catch(() => ({ wallet: undefined, sites: [] as string[] })),
    ton<{ expiring_at?: number; item?: { owner?: { address: string } } }>(`/dns/${encodeURIComponent(domain)}`).catch(() => ({ expiring_at: undefined, item: undefined })),
  ]);
  if (!res.wallet && !info.item) throw new LookupError(`**${domain}** isn't registered.`);
  return { domain, wallet: res.wallet?.address, walletName: res.wallet?.name, sites: res.sites ?? [], owner: info.item?.owner?.address, expires: info.expiring_at ? info.expiring_at * 1000 : undefined };
}

export interface Jetton { name: string; symbol: string; amount: number; image?: string; usd?: number; verified: boolean }

export function parseJettons(r: { balances?: { balance: string; price?: { prices?: { USD?: number } }; jetton: { name: string; symbol: string; decimals: number; image?: string; verification?: string } }[] }): Jetton[] {
  return (r.balances ?? []).map(b => {
    const amount = Number(BigInt(b.balance)) / 10 ** (b.jetton.decimals ?? 9);
    const px = b.price?.prices?.USD;
    return { name: b.jetton.name, symbol: b.jetton.symbol, amount, image: b.jetton.image, usd: px != null ? amount * px : undefined, verified: b.jetton.verification === 'whitelist' };
  }).filter(j => j.amount > 0).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
}

export async function jettons(input: string): Promise<Jetton[]> {
  return parseJettons(await ton(`/accounts/${encodeURIComponent(cleanTonQuery(input))}/jettons?currencies=usd`));
}

export interface TonNft { name: string; collection?: string; image?: string; address: string; verified: boolean }

export function parseNfts(r: { nft_items?: { address: string; metadata?: { name?: string; image?: string }; collection?: { name?: string }; previews?: { resolution: string; url: string }[]; trust?: string }[] }): TonNft[] {
  return (r.nft_items ?? []).map(n => ({
    address: n.address, name: n.metadata?.name ?? 'Unnamed NFT', collection: n.collection?.name, verified: n.trust === 'whitelist',
    image: n.previews?.find(p => p.resolution === '500x500')?.url ?? n.previews?.at(-1)?.url ?? n.metadata?.image,
  }));
}

export async function nfts(input: string): Promise<TonNft[]> {
  return parseNfts(await ton(`/accounts/${encodeURIComponent(cleanTonQuery(input))}/nfts?limit=50&indirect_ownership=false`));
}

export interface TonEvent { id: string; time: number; lines: string[]; scam: boolean }

export function parseEvents(r: { events?: { event_id: string; timestamp: number; is_scam?: boolean; actions?: { type: string; status?: string; simple_preview?: { name?: string; description?: string; value?: string } }[] }[] }): TonEvent[] {
  return (r.events ?? []).map(e => ({
    id: e.event_id, time: e.timestamp * 1000, scam: !!e.is_scam,
    lines: (e.actions ?? []).map(a => `${a.status === 'failed' ? '❌ ' : ''}${a.simple_preview?.description ?? a.simple_preview?.name ?? a.type}`),
  }));
}

export async function events(input: string): Promise<TonEvent[]> {
  return parseEvents(await ton(`/accounts/${encodeURIComponent(cleanTonQuery(input))}/events?limit=10`));
}
