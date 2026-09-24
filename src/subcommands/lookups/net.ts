import { AttachmentBuilder } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { card, compact, num, trunc } from '../../lookups/card.js';
import { lookup } from '../../lookups/handler.js';
import * as n from '../../lookups/net.js';
import * as c from '../../lookups/crypto.js';

const str = (name: string, d: string, max = 200, required = true) => (s: import('discord.js').SlashCommandSubcommandBuilder) =>
  s.addStringOption(o => o.setName(name).setDescription(d).setRequired(required).setMaxLength(max));

// ─── /net ────────────────────────────────────────────────────────────────────

export const netSubs: Sub[] = [
  {
    name: 'dns', description: 'Look up DNS records for a domain',
    options: s => s.addStringOption(o => o.setName('domain').setDescription('Domain name, e.g. example.com').setRequired(true).setMaxLength(253))
      .addStringOption(o => o.setName('type').setDescription('Record type (default A)').addChoices(...n.DNS_TYPES.map(t => ({ name: t, value: t })))),
    run: lookup(async i => {
      const type = (i.options.getString('type') ?? 'A') as n.DnsType;
      const r = await n.dnsLookup(i.options.getString('domain', true), type);
      const lines = r.records.slice(0, 25).map(x => `${x.type.padEnd(6)} ${String(x.ttl).padStart(6)}s  ${trunc(x.data, 120)}`);
      await i.editReply(card({
        title: `DNS · ${r.name}`, color: r.records.length ? 0x5865f2 : 0x99aab5,
        description: r.records.length ? `\`\`\`\n${lines.join('\n')}\n\`\`\`${r.records.length > 25 ? `\n…and ${r.records.length - 25} more` : ''}` : `*No ${r.type} records.*`,
        fields: [['Status', r.status], r.dnssec ? ['DNSSEC', '✅ validated'] : null], footer: 'via Cloudflare DNS-over-HTTPS',
      }));
    }),
  },
  {
    name: 'ip', description: 'Look up where an IP address or domain is located', options: str('target', 'An IP address or domain', 253),
    run: lookup(async i => {
      const r = await n.ipLookup(i.options.getString('target', true));
      await i.editReply(card({
        title: `${r.flag ?? '🌐'} ${r.ip}`, color: 0x5865f2,
        fields: [r.resolvedFrom ? ['Resolved from', r.resolvedFrom] : null, ['Type', r.type], ['Location', [r.city, r.region, r.country].filter(Boolean).join(', ')], ['Postal code', r.postal],
          ['Coordinates', r.lat != null ? `${r.lat.toFixed(2)}, ${r.lon?.toFixed(2)}` : null], ['Timezone', r.timezone ? `${r.timezone} (UTC${r.utc})` : null],
          ['ISP', r.isp], ['Organisation', r.org], ['ASN', r.asn ? `AS${r.asn}` : null], ['Domain', r.domain]],
        footer: 'Approximate location — accuracy is usually city-level at best.',
        links: r.lat != null ? [{ label: 'Open map', url: `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=8/${r.lat}/${r.lon}` }] : [],
      }));
    }),
  },
  {
    name: 'ping', description: 'Ping a host from servers around the world', options: str('host', 'Domain or IP address', 253),
    run: lookup(async i => {
      const r = await n.ping(i.options.getString('host', true));
      const lines = r.nodes.map(x => `${x.ok === 0 ? '🔴' : x.ok < x.sent ? '🟡' : '🟢'} **${x.country}, ${x.city}** — ${x.avgMs != null ? `${x.avgMs.toFixed(x.avgMs < 10 ? 1 : 0)} ms` : 'no reply'} (${x.ok}/${x.sent})`);
      const up = r.nodes.filter(x => x.ok > 0).length;
      await i.editReply(card({
        title: `Ping · ${r.host}`, url: r.link, color: up === r.nodes.length ? 0x57f287 : up ? 0xfee75c : 0xed4245,
        description: lines.join('\n'), footer: `Reachable from ${up}/${r.nodes.length} locations · via check-host.net`,
      }));
    }),
  },
  {
    name: 'website', description: 'Take a screenshot of a web page', options: str('url', 'The page address', 500),
    run: lookup(async i => {
      const { png, url } = await n.screenshot(i.options.getString('url', true));
      await i.editReply(card({ title: trunc(new URL(url).hostname, 100), url, color: 0x5865f2, image: 'attachment://site.png', files: [new AttachmentBuilder(png, { name: 'site.png' })], footer: 'Screenshot by thum.io — I don\'t control what the page shows.' }));
    }),
  },
];

// ─── /crypto ─────────────────────────────────────────────────────────────────

export const cryptoSubs: Sub[] = [
  {
    name: 'price', description: 'Get the price and stats of a cryptocurrency', options: str('coin', 'Name or ticker, e.g. bitcoin or eth', 40),
    run: lookup(async i => {
      const k = await c.coinPrice(i.options.getString('coin', true));
      await i.editReply(card({
        title: `${k.name} (${k.symbol})`, url: `https://www.coingecko.com/en/coins/${k.id}`, color: (k.change24h ?? 0) >= 0 ? 0x57f287 : 0xed4245, thumbnail: k.image,
        fields: [['Price', c.usd(k.price)], ['24h', c.pct(k.change24h)], ['7d', c.pct(k.change7d)], ['24h range', k.low24h != null ? `${c.usd(k.low24h)} – ${c.usd(k.high24h)}` : null],
          ['Market cap', k.marketCap ? `$${compact(k.marketCap)}` : null], ['Volume (24h)', k.volume ? `$${compact(k.volume)}` : null], ['Rank', k.rank ? `#${k.rank}` : null],
          ['Supply', k.supply ? `${compact(Math.round(k.supply))}${k.maxSupply ? ` / ${compact(Math.round(k.maxSupply))}` : ''}` : null], ['All-time high', k.ath ? `${c.usd(k.ath)} (${c.pct(k.athChange)})` : null]],
        footer: 'Data from CoinGecko. Not financial advice.',
      }));
    }),
  },
  {
    name: 'top', description: 'Show the top cryptocurrencies by market cap',
    run: lookup(async i => {
      const coins = await c.topCoins(10);
      await i.editReply(card({
        title: 'Top cryptocurrencies', color: 0xf7931a,
        description: coins.map(k => `**${k.rank}.** ${k.name} (${k.symbol}) — ${c.usd(k.price)} ${c.pct(k.change24h)}`).join('\n'), footer: 'Data from CoinGecko. Not financial advice.',
      }));
    }),
  },
  {
    name: 'wallet', description: 'Look up a Bitcoin or Ethereum wallet balance', options: str('address', 'A Bitcoin (bc1…/1…/3…) or Ethereum (0x…) address', 100),
    run: lookup(async i => {
      const w = await c.wallet(i.options.getString('address', true));
      await i.editReply(card({
        title: `${w.chain === 'BTC' ? '₿ Bitcoin' : 'Ξ Ethereum'} wallet`, url: w.explorer, color: w.chain === 'BTC' ? 0xf7931a : 0x627eea,
        description: `\`${w.address}\``, fields: [['Balance', w.balance], ['Value', w.usdValue != null ? c.usd(w.usdValue) : null], ['Transactions', num(w.txCount)], ...w.extra],
        links: [{ label: 'View on explorer', url: w.explorer }], footer: 'Public blockchain data.',
      }));
    }),
  },
  {
    name: 'gas', description: 'Current Bitcoin and Ethereum network fees',
    run: lookup(async i => {
      const g = await c.gas();
      const fields: [string, string][] = [];
      if (g.eth) fields.push(['Ξ Ethereum (gwei)', `🐢 ${g.eth.slow} · 🚶 ${g.eth.average} · 🚀 ${g.eth.fast}${g.ethPriceUsd ? `\nA plain transfer costs ≈ ${c.usd(c.transferCostUsd(g.eth.average, g.ethPriceUsd))}` : ''}`]);
      if (g.btc) fields.push(['₿ Bitcoin (sat/vB)', `🐢 ${g.btc.economy} · 🚶 ${g.btc.hour} · 🏃 ${g.btc.halfHour} · 🚀 ${g.btc.fastest}`]);
      await i.editReply(card({ title: 'Network fees', color: 0x5865f2, fields, footer: 'Blockscout · mempool.space' }));
    }),
  },
  {
    name: 'convert', description: 'Convert an amount between two cryptocurrencies',
    options: s => s.addNumberOption(o => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(0))
      .addStringOption(o => o.setName('from').setDescription('Coin to convert from').setRequired(true).setMaxLength(40))
      .addStringOption(o => o.setName('to').setDescription('Coin to convert to').setRequired(true).setMaxLength(40)),
    run: lookup(async i => {
      const amount = i.options.getNumber('amount', true);
      const r = await c.convertCoins(amount, i.options.getString('from', true), i.options.getString('to', true));
      await i.editReply(card({
        title: 'Crypto conversion', color: 0x5865f2, thumbnail: r.to.image,
        description: `**${amount.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${r.from.symbol}** ≈ **${r.result.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${r.to.symbol}**`,
        fields: [[`${r.from.symbol} price`, c.usd(r.from.price)], [`${r.to.symbol} price`, c.usd(r.to.price)]], footer: 'Data from CoinGecko. Not financial advice.',
      }));
    }),
  },
];
