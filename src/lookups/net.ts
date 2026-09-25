import { isIP } from 'node:net';
import { getBufferPublic, getJson, isPrivateIp } from '../framework/http.js';
import { LookupError } from './handler.js';

/** Network lookups: DNS (Cloudflare DoH), IP geolocation (ipwho.is), ping (check-host.net), page screenshots (thum.io). */

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z]{2,63}$/i;

/** Accepts a bare host, a URL, or host:port and returns the lowercase hostname (or IP). Throws LookupError otherwise. */
export function cleanHost(input: string): string {
  let s = input.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '').replace(/^[^@]*@/, '');
  if (s.startsWith('[')) { const end = s.indexOf(']'); s = end > 0 ? s.slice(1, end) : s; } else if ((s.match(/:/g) ?? []).length === 1) s = s.replace(/:\d+$/, '');
  s = s.toLowerCase().replace(/\.$/, '');
  if (isIP(s) || HOSTNAME.test(s)) return s;
  throw new LookupError('That doesn\'t look like a domain or IP address. Try `example.com` or `1.1.1.1`.');
}

export function assertPublicHost(host: string): void {
  if (Bun.env.NODE_ENV === 'test' && Bun.env.ALLOW_PRIVATE_URLS === '1') return; // same test-only escape hatch as assertPublicUrl
  if (isIP(host) && isPrivateIp(host)) throw new LookupError('That\'s a private or reserved address — I only look up public hosts.');
  if (!isIP(host) && /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) throw new LookupError('That\'s a private hostname — I only look up public hosts.');
}

// ─── DNS ─────────────────────────────────────────────────────────────────────

export const DNS_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA', 'SRV', 'PTR'] as const;
export type DnsType = (typeof DNS_TYPES)[number];
const TYPE_NUM: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 257: 'CAA' };
const RCODE = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'];

export interface DnsRecord { type: string; ttl: number; data: string }
export interface DnsResult { name: string; type: string; status: string; records: DnsRecord[]; dnssec: boolean }

interface DohRaw { Status: number; AD?: boolean; Answer?: { name: string; type: number; TTL: number; data: string }[] }

export function parseDoh(name: string, type: string, raw: DohRaw): DnsResult {
  return {
    name, type, status: RCODE[raw.Status] ?? `RCODE ${raw.Status}`, dnssec: !!raw.AD,
    records: (raw.Answer ?? []).map(a => ({ type: TYPE_NUM[a.type] ?? String(a.type), ttl: a.TTL, data: a.type === 16 ? a.data.replace(/^"|"$/g, '').replace(/" "/g, '') : a.data })),
  };
}

export const reverseName = (ip: string): string => {
  const v = isIP(ip);
  if (v === 4) return `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
  if (v === 6) {
    const [head, tail = ''] = ip.split('::');
    const h = head!.split(':').filter(Boolean), t = tail.split(':').filter(Boolean);
    const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : ip.split(':');
    return `${groups.map(g => g.padStart(4, '0')).join('').split('').reverse().join('.')}.ip6.arpa`;
  }
  throw new LookupError('That isn\'t an IP address.');
};

export type Resolver = 'cloudflare' | 'google';
const DOH: Record<Resolver, string> = { cloudflare: 'https://cloudflare-dns.com/dns-query', google: 'https://dns.google/resolve' };
export const resolverLabel = (r: Resolver) => (r === 'google' ? 'Google DNS' : 'Cloudflare DNS');

export async function dnsLookup(input: string, type: DnsType = 'A', resolver: Resolver = 'cloudflare'): Promise<DnsResult> {
  let name = type === 'PTR' ? input.trim() : cleanHost(input);
  if (type === 'PTR') { name = isIP(name) ? reverseName(name) : cleanHost(name); }
  if (type !== 'PTR' && isIP(name)) throw new LookupError('DNS records are looked up by domain name. Use type `PTR` to reverse-lookup an IP.');
  const raw = await getJson<DohRaw>(`${DOH[resolver]}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: 'application/dns-json' }, cacheMs: 60_000 });
  return parseDoh(name, type, raw);
}

/** Heist-style lookup: the common record types in one go (an IP gets its reverse PTR name instead). */
export const OVERVIEW_TYPES: DnsType[] = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA'];
export async function dnsOverview(input: string, resolver: Resolver = 'cloudflare'): Promise<{ name: string; status: string; dnssec: boolean; records: DnsRecord[] }> {
  if (isIP(input.trim())) { const r = await dnsLookup(input, 'PTR', resolver); return { name: r.name, status: r.status, dnssec: r.dnssec, records: r.records }; }
  const results = await Promise.all(OVERVIEW_TYPES.map(t => dnsLookup(input, t, resolver)));
  const seen = new Set<string>();
  const records = results.flatMap(r => r.records).filter(r => { const k = `${r.type}|${r.data}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { name: results[0]!.name, status: results.find(r => r.status !== 'NOERROR')?.status ?? 'NOERROR', dnssec: results.every(r => r.dnssec), records };
}

// ─── IP geolocation ──────────────────────────────────────────────────────────

export interface IpInfo {
  ip: string; type: string; country?: string; countryCode?: string; flag?: string; region?: string; city?: string; postal?: string; lat?: number; lon?: number;
  timezone?: string; utc?: string; asn?: number; org?: string; isp?: string; domain?: string; continent?: string;
}

interface IpwhoRaw {
  success: boolean; message?: string; ip: string; type: string; continent?: string; country?: string; country_code?: string; region?: string; city?: string; postal?: string; latitude?: number; longitude?: number;
  flag?: { emoji?: string }; connection?: { asn?: number; org?: string; isp?: string; domain?: string }; timezone?: { id?: string; utc?: string };
}

export function parseIpwho(raw: IpwhoRaw): IpInfo {
  if (!raw.success) throw new LookupError(raw.message && /invalid/i.test(raw.message) ? 'That isn\'t a valid IP address.' : 'I couldn\'t look up that IP.');
  return {
    ip: raw.ip, type: raw.type, country: raw.country, countryCode: raw.country_code, flag: raw.flag?.emoji, region: raw.region, city: raw.city, postal: raw.postal,
    lat: raw.latitude, lon: raw.longitude, timezone: raw.timezone?.id, utc: raw.timezone?.utc, asn: raw.connection?.asn, org: raw.connection?.org, isp: raw.connection?.isp,
    domain: raw.connection?.domain, continent: raw.continent,
  };
}

/** Looks up an IP, or a domain (resolved to its first A/AAAA record first). Returns the info plus the IP it resolved from. */
export async function ipLookup(input: string): Promise<IpInfo & { resolvedFrom?: string }> {
  const host = cleanHost(input);
  assertPublicHost(host);
  let ip = host, resolvedFrom: string | undefined;
  if (!isIP(host)) {
    const d = await dnsLookup(host, 'A');
    const a = d.records.find(r => r.type === 'A') ?? (await dnsLookup(host, 'AAAA')).records.find(r => r.type === 'AAAA');
    if (!a) throw new LookupError(`**${host}** has no address records.`);
    ip = a.data; resolvedFrom = host;
    if (isPrivateIp(ip)) throw new LookupError(`**${host}** points at a private address.`);
  }
  const raw = await getJson<IpwhoRaw>(`https://ipwho.is/${encodeURIComponent(ip)}`, { cacheMs: 10 * 60_000 });
  return { ...parseIpwho(raw), resolvedFrom };
}

// ─── Ping (check-host.net) ───────────────────────────────────────────────────

export interface PingNode { node: string; country: string; city: string; sent: number; ok: number; avgMs?: number; ip?: string }

type PingRaw = Record<string, [string, number, string?][][] | null>;
type NodesRaw = Record<string, [string, string, string, string?, string?]>;

export function parsePing(nodes: NodesRaw, result: PingRaw): PingNode[] {
  const out: PingNode[] = [];
  for (const [node, meta] of Object.entries(nodes)) {
    const r = result[node];
    if (!r || !r[0]) continue; // still running
    const probes = r[0];
    const oks = probes.filter(p => p[0] === 'OK');
    out.push({
      node, country: meta[1], city: meta[2], sent: probes.length, ok: oks.length,
      avgMs: oks.length ? (oks.reduce((s, p) => s + p[1], 0) / oks.length) * 1000 : undefined,
      ip: probes.find(p => p[2])?.[2],
    });
  }
  return out;
}

export async function ping(input: string): Promise<{ host: string; nodes: PingNode[]; link: string }> {
  const host = cleanHost(input);
  assertPublicHost(host);
  const h = { Accept: 'application/json' };
  const start = await getJson<{ ok: number; request_id: string; nodes: NodesRaw; permanent_link: string; error?: string }>(
    `https://check-host.net/check-ping?host=${encodeURIComponent(host)}&max_nodes=4`, { headers: h, timeoutMs: 15_000 });
  if (!start.ok || !start.request_id) throw new LookupError('The ping service refused that host.');
  let nodes: PingNode[] = [];
  for (let i = 0; i < 8; i++) {
    await Bun.sleep(i === 0 ? 3000 : 1500);
    nodes = parsePing(start.nodes, await getJson<PingRaw>(`https://check-host.net/check-result/${start.request_id}`, { headers: h, timeoutMs: 10_000 }));
    if (nodes.length >= Object.keys(start.nodes).length) break;
  }
  if (!nodes.length) throw new LookupError('The ping nodes didn\'t answer in time. Try again in a moment.');
  return { host, nodes, link: start.permanent_link };
}

// ─── Website screenshot (thum.io) ────────────────────────────────────────────

/** Normalises user input to an http(s) URL and refuses private targets (checked again after redirects by getBufferPublic). */
export function normalizeWebUrl(input: string): string {
  let s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { throw new LookupError('That doesn\'t look like a web address.'); }
  if (!/^https?:$/.test(u.protocol)) throw new LookupError('Only http and https pages can be captured.');
  if (u.username || u.password) throw new LookupError('Links with a username/password aren\'t supported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!isIP(host) && !HOSTNAME.test(host)) throw new LookupError('That doesn\'t look like a web address.');
  assertPublicHost(host.toLowerCase());
  return u.toString();
}

export async function screenshot(input: string): Promise<{ png: Buffer; url: string }> {
  const url = normalizeWebUrl(input);
  const png = await getBufferPublic(`https://image.thum.io/get/width/1280/crop/720/noanimate/${url}`, { timeoutMs: 40_000, maxBytes: 8 * 1024 * 1024 });
  if (png.length < 500) throw new LookupError('The screenshot service returned nothing for that page.');
  return { png, url };
}
