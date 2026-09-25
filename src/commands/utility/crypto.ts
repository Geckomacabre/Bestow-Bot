import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { card, compact, listCard, num, trunc, when } from '../../lookups/card.js';
import { lineChart, shortNum } from '../../lookups/chart.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import * as c from '../../lookups/crypto.js';
import * as ch from '../../lookups/chain.js';
import { addTracker, MAX_PER_USER, stopTrackers } from '../../crypto/tracker.js';
import { premiumWall } from '../../premium/wall.js';
import { cv2Box, cv2Err } from '../../utils/components.js';

const NOTE = 'Data from CoinGecko. Not financial advice.';
const coinOpt = { coin: { maxLength: 40 } };

export default hgroup({
  name: 'crypto',
  subs: [
    hsub('crypto track', async i => {
      const chain = ch.chainOf(i.options.getString('coin', true))!;
      const txid = i.options.getString('txid', true).trim();
      const confirmations = i.options.getInteger('confirmations');
      // Heist marks a custom confirmation count as a ✨ Premium option; everyone gets the default of 1.
      if (confirmations != null && confirmations !== 1 && (await premiumWall(i))) return;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      let tx: ch.TxInfo;
      try { tx = await ch.txInfo(txid, chain); } catch (e) { await i.editReply(cv2Err(`❌ ${(e as Error).message}`)); return; }
      const target = confirmations ?? 1;
      if (tx.status === 'failed') { await i.editReply(cv2Err('❌ That transaction failed — there\'s nothing to wait for.')); return; }
      if (tx.confirmations >= target) { await i.editReply(cv2Box(`✅ That transaction already has **${tx.confirmations}** confirmation${tx.confirmations === 1 ? '' : 's'}.`, ch.CHAIN_COLOR[chain])); return; }
      const r = await addTracker({ user_id: i.user.id, chain, txid: tx.hash, target, channel_id: i.channelId ?? null, created_at: Date.now() });
      if (r === 'limit') { await i.editReply(cv2Err(`❌ You're already tracking ${MAX_PER_USER} transactions. Use \`/crypto stoptrack\` to clear them.`)); return; }
      if (r === 'duplicate') { await i.editReply(cv2Err('❌ You\'re already tracking that transaction.')); return; }
      await i.editReply(cv2Box(`👀 Tracking your ${ch.CHAIN_NAMES[chain]} transaction until it has **${target}** confirmation${target === 1 ? '' : 's'} (now ${tx.confirmations}). I'll ping you here, or DM you if I can't post here.`, ch.CHAIN_COLOR[chain]));
    }, { tweaks: { txid: { maxLength: 80 }, confirmations: { min: 1, max: 100 } } }),
    hsub('crypto stoptrack', async i => {
      const n = await stopTrackers(i.user.id);
      await i.reply({ ...(n ? cv2Box(`🛑 Stopped ${n} tracker${n === 1 ? '' : 's'}.`, 0x5865f2) : cv2Err('❌ You aren\'t tracking any transactions.')), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }),
    hsub('crypto wallet', lookup(async i => {
      const w = await ch.walletInfo(i.options.getString('address', true), ch.chainOf(i.options.getString('chain')));
      const sym = ch.CHAIN_SYMBOL[w.chain];
      const price = await c.coinPrice(ch.COINGECKO_ID[w.chain]).then(p => p.price).catch(() => undefined);
      await i.editReply(card({
        title: `${ch.CHAIN_NAMES[w.chain]} wallet`, url: w.explorer, color: ch.CHAIN_COLOR[w.chain], description: `\`${w.address}\``,
        fields: [['Balance', ch.fmtCoin(w.balance, sym)], ['Value', price != null ? c.usd(w.balance * price) : null], w.unconfirmed ? ['Unconfirmed', ch.fmtCoin(w.unconfirmed, sym)] : null,
          ['Transactions', num(w.txCount)], w.received != null ? ['Total received', ch.fmtCoin(w.received, sym)] : null, w.sent != null ? ['Total sent', ch.fmtCoin(w.sent, sym)] : null, ...w.extra,
          w.recent.length ? ['Recent', w.recent.map(t => `${t.amount < 0 ? '📤' : '📥'} ${ch.fmtCoin(Math.abs(t.amount), sym)} — ${t.confirmations ? `${compact(t.confirmations)} conf.` : 'pending'}${t.time ? ` · ${when(t.time, 'R')}` : ''}`).join('\n')] : null],
        links: [{ label: 'View on explorer', url: w.explorer }], footer: 'Public blockchain data.',
      }));
    }), { tweaks: { address: { maxLength: 100 } } }),
    hsub('crypto transaction', lookup(async i => {
      const t = await ch.txInfo(i.options.getString('hash', true), ch.chainOf(i.options.getString('chain')));
      const sym = ch.CHAIN_SYMBOL[t.chain];
      const addrs = (xs: string[]) => (xs.length ? xs.slice(0, 3).map(a => `\`${trunc(a, 48)}\``).join('\n') + (xs.length > 3 ? `\n…and ${xs.length - 3} more` : '') : null);
      await i.editReply(card({
        title: `${ch.CHAIN_NAMES[t.chain]} transaction`, url: t.explorer, color: t.status === 'failed' ? 0xed4245 : ch.CHAIN_COLOR[t.chain], description: `\`${t.hash}\``,
        fields: [['Status', t.status === 'confirmed' ? `✅ Confirmed (${num(t.confirmations)})` : t.status === 'pending' ? '⏳ Pending' : '❌ Failed'], ['Amount', ch.fmtCoin(t.amount, sym)], ['Fee', t.fee != null ? ch.fmtCoin(t.fee, sym) : null],
          ['Block', t.block != null ? num(t.block) : null], ['Time', t.time ? `${when(t.time, 'f')}` : null], ['From', addrs(t.from)], ['To', addrs(t.to)]],
        links: [{ label: 'View on explorer', url: t.explorer }],
      }));
    }), { tweaks: { hash: { maxLength: 80 } } }),
    hsub('crypto gas', lookup(async i => {
      const g = await ch.evmGas(i.options.getString('chain') ?? 'Ethereum');
      await i.editReply(card({
        title: `⛽ ${g.chain} gas`, url: g.explorer, color: 0x627eea,
        fields: [['Gas price', `${g.gwei < 1 ? g.gwei.toFixed(4) : g.gwei.toFixed(2)} gwei`], ['Plain transfer (21k gas)', g.transferUsd != null ? `≈ ${c.usd(g.transferUsd)}` : null], [`${g.symbol} price`, g.priceUsd != null ? c.usd(g.priceUsd) : null]],
        footer: 'Live from the network\'s public RPC.',
      }));
    })),
    hsub('crypto price', lookup(async i => {
      const vs = c.vsOf(i.options.getString('currency'));
      const k = await c.coinPrice(i.options.getString('coin', true), vs);
      const m = (n?: number | null) => c.money(n, vs);
      await i.editReply(card({
        title: `${k.name} (${k.symbol})`, url: `https://www.coingecko.com/en/coins/${k.id}`, color: (k.change24h ?? 0) >= 0 ? 0x57f287 : 0xed4245, thumbnail: k.image,
        fields: [['Price', m(k.price)], ['24h', c.pct(k.change24h)], ['7d', c.pct(k.change7d)], ['24h range', k.low24h != null ? `${m(k.low24h)} – ${m(k.high24h)}` : null],
          ['Market cap', k.marketCap ? `${shortNum(k.marketCap)} ${vs.toUpperCase()}` : null], ['Volume (24h)', k.volume ? `${shortNum(k.volume)} ${vs.toUpperCase()}` : null], ['Rank', k.rank ? `#${k.rank}` : null],
          ['Supply', k.supply ? `${compact(Math.round(k.supply))}${k.maxSupply ? ` / ${compact(Math.round(k.maxSupply))}` : ''}` : null], ['All-time high', k.ath ? `${m(k.ath)} (${c.pct(k.athChange)})` : null]],
        footer: NOTE,
      }));
    }), { tweaks: coinOpt }),
    hsub('crypto rates', lookup(async i => {
      const vs = c.vsOf(i.options.getString('currency'));
      const coins = await c.topCoins(i.options.getInteger('count') ?? 10, vs);
      await i.editReply(listCard('Top cryptocurrencies', coins.map(k => `**${k.rank}.** ${k.name} (${k.symbol}) — ${c.money(k.price, vs)} ${c.pct(k.change24h)}`), { color: 0xf7931a, footer: NOTE }));
    }), { tweaks: { count: { min: 5, max: 50 } } }),
    hsub('crypto chart', lookup(async i => {
      const vs = c.vsOf(i.options.getString('currency'));
      const { coin, points } = await c.coinChart(i.options.getString('coin', true), vs, 30);
      if (points.length < 2) throw new LookupError('There isn\'t enough price history to chart.');
      const png = lineChart([{ label: `${coin.symbol}/${vs.toUpperCase()}`, color: (coin.change7d ?? 0) >= 0 ? '#57f287' : '#ed4245', points }], { title: `${coin.name} · 30 days`, yLabel: n => shortNum(n) });
      await i.editReply(card({
        title: `${coin.name} (${coin.symbol})`, url: `https://www.coingecko.com/en/coins/${coin.id}`, color: 0xf7931a, thumbnail: coin.image, image: 'attachment://chart.png', files: [new AttachmentBuilder(png, { name: 'chart.png' })],
        fields: [['Price', c.money(coin.price, vs)], ['24h', c.pct(coin.change24h)], ['7d', c.pct(coin.change7d)]], footer: NOTE,
      }));
    }), { tweaks: coinOpt }),
  ],
});
