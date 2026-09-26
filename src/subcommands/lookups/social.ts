import { AttachmentBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { hsub } from '../../framework/heist.js';
import { getBufferPublic } from '../../framework/http.js';
import { uploadLimit } from '../../framework/media.js';
import { sendPages } from '../../framework/pages.js';
import { card, compact, listCard, num, trunc, when } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { sendRepost, shortCount, VERIFIED, ytdlpPost, type RepostPost } from '../../lookups/repost.js';
import { instagramRepost, instagramShortcode } from '../../lookups/instaloader.js';
import * as x from '../../lookups/x.js';
import * as tt from '../../lookups/tiktok.js';
import * as so from '../../lookups/social.js';
import * as tw from '../../lookups/twitch.js';
import * as ton from '../../lookups/ton.js';
import * as tg from '../../lookups/telegram.js';
import * as hd from '../../lookups/henrik.js';
import * as g from '../../lookups/games.js';
import { downloadPost } from '../../media/download.js';
import { ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } from 'discord.js';

const url500 = { url: { maxLength: 500 } };
const user60 = { username: { maxLength: 60 } };

// ─── X ───────────────────────────────────────────────────────────────────────

export const xSubs: Sub[] = [
  hsub('x repost', lookup(async i => {
    const p = await x.xPost(i.options.getString('url', true));
    await sendRepost(i, p, { open: 'Open on X', authorUrl: p.author.url });
  }), { tweaks: url500 }),
  hsub('x user', lookup(async i => {
    const u = await x.xUser(i.options.getString('username', true));
    await i.editReply(card({
      title: `${u.name}${u.verified ? ` ${VERIFIED}` : ''}${u.protected ? ' 🔒' : ''}`, url: `https://x.com/${u.handle}`, color: x.X_BLUE, thumbnail: u.avatar, image: u.banner,
      description: [`@${u.handle}`, u.description].filter(Boolean).join('\n'),
      fields: [['Followers', compact(u.followers)], ['Following', compact(u.following)], ['Posts', compact(u.posts)], ['Likes', compact(u.likes)], ['Media', compact(u.media)],
        ['Location', u.location], ['Website', u.website], ['Joined', u.joined ? `${when(u.joined)} (${when(u.joined, 'R')})` : null]],
      links: [{ label: 'Open on X', url: `https://x.com/${u.handle}` }],
    }));
  }), { tweaks: { username: { maxLength: 60 } } }),
];

// ─── TikTok ──────────────────────────────────────────────────────────────────

export const tiktokSubs: Sub[] = [
  hsub('tiktok user', lookup(async i => {
    const u = await tt.tiktokUser(i.options.getString('username', true));
    await i.editReply(card({
      title: `${u.name}${u.verified ? ` ${VERIFIED}` : ''}${u.private ? ' 🔒' : ''}`, url: `https://www.tiktok.com/@${u.handle}`, color: tt.TIKTOK_PINK, thumbnail: u.avatar,
      description: [`@${u.handle}`, u.bio].filter(Boolean).join('\n'),
      fields: [['Followers', compact(u.followers)], ['Following', compact(u.following)], ['Likes', compact(u.likes)], ['Videos', compact(u.videos)], ['Friends', u.friends != null ? compact(u.friends) : null], ['Link', u.link]],
      links: [{ label: 'Open on TikTok', url: `https://www.tiktok.com/@${u.handle}` }],
    }));
  }), { tweaks: user60 }),
  hsub('tiktok posts', lookup(async i => {
    const handle = tt.cleanUser(i.options.getString('username', true));
    const posts = await tt.tiktokPosts(handle, i.options.getInteger('count') ?? 20);
    if (!posts.length) throw new LookupError('That account has no public posts.');
    await sendPages(i, posts.map((p, n) => {
      const c = new ContainerBuilder().setAccentColor(tt.TIKTOK_PINK);
      const text = `### [@${handle}](https://www.tiktok.com/@${handle}) · post ${n + 1} of ${posts.length}\n${trunc(p.title, 600)}\n-# ▶️ ${shortCount(p.plays ?? 0)} · ♡ ${shortCount(p.likes ?? 0)} · 💬 ${shortCount(p.comments ?? 0)}${p.created ? ` · ${when(p.created, 'R')}` : ''}\n[Open on TikTok](${p.url})`;
      if (p.cover) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)).setThumbnailAccessory(new ThumbnailBuilder().setURL(p.cover)));
      else c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      return { container: c };
    }));
  }), { tweaks: { ...user60, count: { min: 1, max: 40 } } }),
  hsub('tiktok repost', lookup(async i => {
    const { post } = await tt.tiktokPost(i.options.getString('url', true));
    await sendRepost(i, post, { open: 'Open on TikTok', authorUrl: post.author.url });
  }), { tweaks: url500 }),
  hsub('tiktok sound', lookup(async i => {
    const { sound, post } = await tt.tiktokPost(i.options.getString('url', true));
    if (!sound) throw new LookupError('That post has no sound I can rip.');
    const mp3 = await getBufferPublic(sound.url, { maxBytes: Math.floor(uploadLimit(i) * 0.95), timeoutMs: 45_000 });
    const name = `${sound.title}`.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'sound';
    await i.editReply({ ...card({ title: `🎵 ${trunc(sound.title, 100)}`, url: post.url, color: tt.TIKTOK_PINK, thumbnail: sound.cover, description: sound.author ? `by ${sound.author}` : undefined }), files: [new AttachmentBuilder(mp3, { name: `${name}.mp3` })] });
  }), { tweaks: url500 }),
];

// ─── Instagram (✨) and Medal: yt-dlp does the fetching ─────────────────────

export const instagramSubs: Sub[] = [
  hsub('instagram user', lookup(async i => {
    const u = await so.instagramUser(i.options.getString('username', true));
    await i.editReply(card({
      title: `${u.name ?? u.username}${u.verified ? ` ${VERIFIED}` : ''}${u.private ? ' 🔒' : ''}`, url: `https://www.instagram.com/${u.username}/`, color: 0xe1306c, thumbnail: u.avatar,
      description: [`@${u.username}`, u.category, u.bio].filter(Boolean).join('\n'),
      fields: [['Followers', compact(u.followers)], ['Following', compact(u.following)], ['Posts', compact(u.posts)], ['Link', u.link]],
      links: [{ label: 'Open on Instagram', url: `https://www.instagram.com/${u.username}/` }],
    }));
  }), { tweaks: user60 }),
  hsub('instagram repost', lookup(async i => {
    const link = i.options.getString('url', true);
    if (!instagramShortcode(link)) throw new LookupError('Send an Instagram post or reel link like `https://www.instagram.com/reel/…`.');
    const post = await instagramRepost(link, { maxBytes: Math.floor(uploadLimit(i) * 0.95) });
    await sendRepost(i, post, { open: 'Open on Instagram', authorUrl: post.author.url });
  }), { tweaks: url500 }),
];

export const medalSubs: Sub[] = [
  hsub('medaltv repost', lookup(async i => {
    const link = i.options.getString('url', true);
    if (!/^https:\/\/(www\.)?medal\.tv\//i.test(link.trim())) throw new LookupError('Send a Medal clip link like `https://medal.tv/games/…/clips/…`.');
    const r = await downloadPost(link, { maxBytes: Math.floor(uploadLimit(i) * 0.95) });
    await sendRepost(i, ytdlpPost('Medal', 0xffb800, r.info, r, link), { open: 'Open on Medal', authorUrl: r.info.uploader_url });
  }), { tweaks: url500 }),
];

// ─── Snapchat, Cash App, bio pages ───────────────────────────────────────────

export const snapchatSubs: Sub[] = [
  hsub('snapchat user', lookup(async i => {
    const u = await so.snapchatUser(i.options.getString('username', true));
    const link = `https://www.snapchat.com/add/${u.username}`;
    await i.editReply(card({
      title: u.name ?? u.username, url: link, color: 0xfffc00, thumbnail: u.avatar, image: u.snapcode,
      description: [`@${u.username}`, u.bio].filter(Boolean).join('\n'),
      fields: [['Subscribers', u.subscribers != null ? compact(u.subscribers) : null], ['Website', u.website], ['Profile', u.public ? 'Public profile' : 'Personal account']],
      links: [{ label: 'Add on Snapchat', url: link }],
    }));
  }), { tweaks: user60 }),
];

export const cashappSubs: Sub[] = [
  hsub('cashapp user', lookup(async i => {
    const u = await so.cashappUser(i.options.getString('cashtag', true));
    const link = `https://cash.app/${u.cashtag}`;
    await i.editReply(card({
      title: `${u.name ?? u.cashtag}${u.verified ? ` ${VERIFIED}` : ''}`, url: link, color: u.accent && /^#[0-9a-f]{6}$/i.test(u.accent) ? parseInt(u.accent.slice(1), 16) : 0x00d632, thumbnail: u.avatar,
      description: u.cashtag, links: [{ label: 'Open on Cash App', url: link }],
    }));
  }), { tweaks: { cashtag: { maxLength: 30 } } }),
];

export const bioSubs: Sub[] = [
  hsub('bio gunslol', lookup(async i => {
    const p = await so.bioPage('guns.lol', i.options.getString('username', true));
    await i.editReply(card({ title: p.title ?? p.username, url: p.url, color: 0x9b59b6, thumbnail: p.image, description: p.description, footer: 'From their public guns.lol page', links: [{ label: 'Open page', url: p.url }] }));
  }), { tweaks: { username: { maxLength: 40 } } }),
  hsub('bio hauntgg', lookup(async i => {
    const username = i.options.getString('username');
    if (!username) {
      if (i.options.getUser('discord') || i.options.getInteger('uid') != null || i.options.getString('objectid')) throw new LookupError('haunt.gg only exposes public pages by username, so I can look people up by `username` only.');
      throw new LookupError('Give me a haunt.gg `username`.');
    }
    const p = await so.bioPage('haunt.gg', username);
    await i.editReply(card({ title: p.title ?? p.username, url: p.url, color: 0x8b0000, thumbnail: p.image, description: p.description, footer: 'From their public haunt.gg page', links: [{ label: 'Open page', url: p.url }] }));
  }), { tweaks: { username: { maxLength: 40 }, objectid: { maxLength: 24 } } }),
];

// ─── Pinterest and /get ──────────────────────────────────────────────────────

const PIN_RED = 0xe60023;

function pinPage(p: so.Pin, n: number, total: number, query: string) {
  const c = new ContainerBuilder().setAccentColor(PIN_RED)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### [${trunc(p.title ?? query, 90)}](${p.url})\n-# ${n + 1} of ${total}${p.pinnerName ? ` · by ${p.pinnerName}` : ''}${p.saves ? ` · 📌 ${shortCount(p.saves)}` : ''}`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(p.image!)));
  return { container: c };
}

export const pinterestSubs: Sub[] = [
  hsub('pinterest search', lookup(async i => {
    const q = i.options.getString('query', true);
    const pins = await so.pinterestSearch(q);
    await sendPages(i, pins.map((p, n) => pinPage(p, n, pins.length, q)));
  }), { tweaks: { query: { maxLength: 100 } } }),
  hsub('pinterest pin', lookup(async i => {
    const p = await so.pinterestPin(i.options.getString('url', true));
    await i.editReply(card({
      title: p.title ?? 'Pinterest pin', url: p.url, color: PIN_RED, image: p.image, description: p.description ? trunc(p.description, 800) : undefined,
      fields: [['By', p.pinnerName ? `${p.pinnerName}${p.pinner ? ` (@${p.pinner})` : ''}` : null], ['Board', p.board], ['Saves', p.saves != null ? num(p.saves) : null], ['Size', p.width ? `${p.width}×${p.height}` : null], ['Created', p.created ? when(p.created) : null], ['Links to', p.link]],
      links: [{ label: 'Open pin', url: p.url }, ...(p.image ? [{ label: 'Full image', url: p.image }] : []), ...(p.video ? [{ label: 'Video', url: p.video }] : [])],
    }));
  }), { tweaks: url500 }),
];

async function randomPin(i: ChatInputCommandInteraction, kind: 'pfp' | 'banner') {
  const style = i.options.getString('style', true);
  const pins = await so.pinterestSearch(style.toLowerCase(), 50);
  const fitting = pins.filter(p => (p.width && p.height ? (kind === 'pfp' ? Math.abs(p.width / p.height - 1) < 0.35 : p.width / p.height > 1.6) : true));
  const p = (fitting.length ? fitting : pins)[Math.floor(Math.random() * (fitting.length || pins.length))]!;
  await i.editReply(card({ title: style, url: p.url, color: PIN_RED, image: p.image, footer: 'From Pinterest', links: [{ label: 'Open pin', url: p.url }, { label: 'Full image', url: p.image! }] }));
}

export const getSubs: Sub[] = [
  hsub('get pfp', lookup(i => randomPin(i, 'pfp'))),
  hsub('get banner', lookup(i => randomPin(i, 'banner'))),
];

// ─── Twitch ──────────────────────────────────────────────────────────────────

const PURPLE = 0x9146ff;
export const twitchSubs: Sub[] = [
  hsub('twitch user', lookup(async i => {
    const u = await tw.twitchUser(i.options.getString('username', true));
    const link = `https://twitch.tv/${u.login}`;
    await i.editReply(card({
      title: u.name, url: link, color: PURPLE, thumbnail: u.avatar, image: u.offlineImage, description: u.description,
      fields: [['Followers', u.followers != null ? compact(u.followers) : null], ['Type', u.type], ['Last category', u.game], ['Stream title', u.title], ['Created', `${when(u.created)} (${when(u.created, 'R')})`], ['ID', u.id]],
      links: [{ label: 'Open on Twitch', url: link }],
    }));
  }), { tweaks: user60 }),
  hsub('twitch live', lookup(async i => {
    const login = tw.cleanLogin(i.options.getString('username', true));
    const s = await tw.twitchLive(login);
    if (!s) throw new LookupError(`**${login}** isn't live right now.`);
    await i.editReply(card({
      title: `🔴 ${s.user} is live`, url: `https://twitch.tv/${s.login}`, color: PURPLE, image: s.thumbnail, description: s.title,
      fields: [['Playing', s.game], ['Viewers', num(s.viewers)], ['Started', when(s.started, 'R')], s.tags.length ? ['Tags', s.tags.slice(0, 8).join(', ')] : null],
      links: [{ label: 'Watch', url: `https://twitch.tv/${s.login}` }],
    }));
  }), { tweaks: user60 }),
];

// ─── TON ─────────────────────────────────────────────────────────────────────

const TON_BLUE = 0x0098ea;
const q200 = { query: { maxLength: 200 } };
export const tonSubs: Sub[] = [
  hsub('ton address', lookup(async i => {
    const a = await ton.account(i.options.getString('query', true));
    await i.editReply(card({
      title: a.name ?? 'TON account', url: ton.explorer(a.address), color: a.isScam ? 0xed4245 : TON_BLUE, thumbnail: a.icon,
      description: `\`${a.address}\``, fields: [['Balance', ton.fmtTon(a.balance)], ['Status', a.status], ['Type', a.isWallet ? `Wallet${a.interfaces.length ? ` (${a.interfaces.join(', ')})` : ''}` : (a.interfaces.join(', ') || 'Contract')],
        ['Last activity', a.lastActivity ? when(a.lastActivity, 'R') : null], a.isScam ? ['⚠️', 'Flagged as a scam'] : null],
      links: [{ label: 'Tonviewer', url: ton.explorer(a.address) }],
    }));
  }), { tweaks: q200 }),
  hsub('ton dns', lookup(async i => {
    const d = await ton.dns(i.options.getString('domain', true));
    await i.editReply(card({
      title: d.domain, url: `https://dns.ton.org/#${encodeURIComponent(d.domain.replace(/\.ton$/, ''))}`, color: TON_BLUE,
      fields: [['Wallet', d.wallet ? `\`${d.wallet}\`${d.walletName ? ` (${d.walletName})` : ''}` : 'Not set'], ['Owner', d.owner ? `\`${d.owner}\`` : null], ['Site', d.sites.length ? d.sites.join(', ') : null], ['Expires', d.expires ? `${when(d.expires)} (${when(d.expires, 'R')})` : null]],
      links: d.wallet ? [{ label: 'Wallet on Tonviewer', url: ton.explorer(d.wallet) }] : [],
    }));
  }), { tweaks: { domain: { maxLength: 130 } } }),
  hsub('ton jettons', lookup(async i => {
    const q = i.options.getString('query', true);
    const js = await ton.jettons(q);
    await i.editReply(listCard(`Jettons held (${js.length})`, js.slice(0, 25).map(j => `• **${trunc(j.name, 40)}** — ${j.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${j.symbol}${j.usd != null ? ` (≈ $${j.usd.toLocaleString('en-US', { maximumFractionDigits: 2 })})` : ''}${j.verified ? ' ✅' : ''}`), { color: TON_BLUE, footer: 'Data from tonapi.io' }));
  }), { tweaks: q200 }),
  hsub('ton nfts', lookup(async i => {
    const ns = await ton.nfts(i.options.getString('query', true));
    if (!ns.length) throw new LookupError('That address holds no NFTs.');
    await sendPages(i, ns.map((n, k) => {
      const c = new ContainerBuilder().setAccentColor(TON_BLUE).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### [${trunc(n.name, 80)}](${ton.explorer(n.address)})\n-# ${k + 1} of ${ns.length}${n.collection ? ` · ${trunc(n.collection, 60)}` : ''}${n.verified ? ' ✅' : ''}`));
      if (n.image && /^https:\/\//.test(n.image)) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(n.image)));
      return { container: c };
    }));
  }), { tweaks: q200 }),
  hsub('ton events', lookup(async i => {
    const ev = await ton.events(i.options.getString('query', true));
    await i.editReply(listCard('Recent transactions', ev.map(e => `${e.scam ? '⚠️ ' : ''}${when(e.time, 'R')} — ${trunc(e.lines.join('; '), 180)}`), { color: TON_BLUE, footer: 'Data from tonapi.io' }));
  }), { tweaks: q200 }),
];

// ─── Telegram ────────────────────────────────────────────────────────────────

const TG = 0x229ed9;
async function tgProfile(i: ChatInputCommandInteraction, input: string, want: tg.PageKind[] | null, extended: boolean) {
  const p = await tg.page(input);
  if (want && !want.includes(p.kind)) throw new LookupError(`**@${p.handle}** is a ${p.kind === 'unknown' ? 'different kind of account' : p.kind}, not a ${want.join(' or ')}.`);
  const link = `https://t.me/${p.handle}`;
  const posts = extended && p.kind === 'channel' ? await tg.recentPosts(p.handle) : [];
  await i.editReply(card({
    title: `${p.title}${p.verified ? ` ${VERIFIED}` : ''}`, url: link, color: TG, thumbnail: p.photo,
    description: [`@${p.handle} · ${p.kind}`, p.description ? trunc(p.description, extended ? 1500 : 400) : null].filter(Boolean).join('\n'),
    fields: [['Subscribers', p.subscribers != null ? num(p.subscribers) : null], ['Members', p.members != null ? num(p.members) : null], ['Online', p.online != null ? num(p.online) : null],
      posts.length ? ['Latest posts', posts.slice(-3).reverse().map(x => `• [${trunc(x.text || (x.hasVideo ? '🎬 video' : x.photo ? '🖼️ photo' : 'post'), 90)}](${x.link})${x.views ? ` — 👁️ ${x.views}` : ''}`).join('\n')] : null],
    links: [{ label: p.kind === 'bot' ? 'Start bot' : 'Open in Telegram', url: link }],
  }));
}

export const telegramSubs: Sub[] = [
  hsub('telegram user', lookup(i => tgProfile(i, i.options.getString('username', true), ['user', 'bot'], false)), { tweaks: { username: { maxLength: 40 } } }),
  hsub('telegram group', lookup(i => tgProfile(i, i.options.getString('handle', true), ['group', 'channel'], !!i.options.getBoolean('extended'))), { tweaks: { handle: { maxLength: 40 } } }),
  hsub('telegram channel', lookup(i => tgProfile(i, i.options.getString('handle', true), ['channel'], !!i.options.getBoolean('extended'))), { tweaks: { handle: { maxLength: 40 } } }),
  hsub('telegram giftinfo', lookup(async i => {
    const gft = await tg.gift(i.options.getString('slug', true));
    await i.editReply(card({ title: gft.title, url: `https://t.me/nft/${gft.slug}`, color: TG, image: gft.image, fields: gft.attributes.map(([k, v]) => [k, trunc(v, 200)] as [string, string]), links: [{ label: 'Open in Telegram', url: `https://t.me/nft/${gft.slug}` }] }));
  }), { tweaks: { slug: { maxLength: 60 } } }),
  hsub('telegram bot', lookup(i => tgProfile(i, i.options.getString('username', true), ['bot'], false)), { tweaks: { username: { maxLength: 40 } } }),
  hsub('telegram message', lookup(async i => {
    const m = await tg.message(i.options.getString('link', true));
    await i.editReply(card({
      title: m.author ?? `@${m.channel}`, url: m.link, color: TG, image: m.photo, description: m.text ? trunc(m.text, 2000) : (m.hasVideo ? '🎬 *Video message*' : '*No text.*'),
      fields: [['Chat', `@${m.channel}`], ['Posted', m.date ? `${when(m.date, 'f')}` : null], ['Views', m.views]], links: [{ label: 'Open message', url: m.link }],
    }));
  }), { tweaks: { link: { maxLength: 200 } } }),
];

// ─── Valorant (player data), Fortnite user, Minecraft random server ──────────

const VR = 0xff4655;
const plat = (i: ChatInputCommandInteraction): hd.Platform[] => { const p = i.options.getString('platform'); return p === 'Console' ? ['console'] : p === 'PC' ? ['pc'] : ['pc', 'console']; };
const riot = (i: ChatInputCommandInteraction) => hd.cleanRiot(i.options.getString('name', true), i.options.getString('tag', true));

export const valorantPlayerSubs: Sub[] = [
  hsub('valorant user', lookup(async i => {
    const { name, tag } = riot(i);
    const a = await hd.vAccount(name, tag);
    const platform = plat(i)[0]!;
    const [rank, matches] = await Promise.all([hd.vRank(a.region, platform, a.name, a.tag), hd.vMatches(a.region, platform, a.name, a.tag, a.puuid, 5)]);
    await i.editReply(card({
      title: `${a.name}#${a.tag}`, url: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(`${a.name}#${a.tag}`)}/overview`, color: VR, thumbnail: a.card, image: a.cardWide,
      fields: [['Level', num(a.level)], ['Region', a.region.toUpperCase()], ['Rank', rank ? `**${rank.tier}** · ${rank.rr} RR${rank.lastChange != null ? ` (${rank.lastChange >= 0 ? '+' : ''}${rank.lastChange})` : ''}` : 'Unrated'], ['Peak', rank?.peak],
        matches.length ? ['Recent matches', matches.map(m => `${m.won == null ? '▫️' : m.won ? '🟩' : '🟥'} **${m.map}** ${m.mode}${m.agent ? ` · ${m.agent}` : ''}${m.kills != null ? ` · ${m.kills}/${m.deaths}/${m.assists}` : ''}${m.rounds ? ` · ${m.rounds}` : ''}`).join('\n')] : null],
      footer: 'Data from HenrikDev',
    }));
  }), { tweaks: { name: { maxLength: 16 }, tag: { maxLength: 5 } } }),
  hsub('valorant store', lookup(async i => {
    const bundles = await hd.vStore();
    if (!bundles.length) throw new LookupError('There are no featured bundles right now.');
    const info = await Promise.all(bundles.map(b => hd.bundleInfo(b.uuid)));
    await sendPages(i, bundles.map((b, n) => {
      const c = new ContainerBuilder().setAccentColor(VR).addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${info[n]?.name ?? 'Featured bundle'}\n**${num(b.price)} VP** · ends ${when(Date.now() + b.secondsLeft * 1000, 'R')}\n${b.items.filter(x => x.name).slice(0, 10).map(x => `• ${x.name}${x.price ? ` — ${num(x.price)} VP` : ''}`).join('\n')}`));
      if (info[n]?.image) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(info[n]!.image!)));
      return { container: c };
    }));
  })),
  hsub('valorant match', lookup(async i => {
    const region = i.options.getString('region')?.toLowerCase();
    const m = await hd.vMatch(i.options.getString('matchid', true), region);
    const table = (t: hd.Scoreboard['teams'][number]) => `**${t.name}${t.won ? ' 🏆' : ''}${t.rounds != null ? ` — ${t.rounds}` : ''}**\n\`\`\`\n${t.players.map(p => `${trunc(`${p.name}#${p.tag}`, 18).padEnd(18)} ${trunc(p.agent ?? '', 9).padEnd(9)} ${`${p.kills}/${p.deaths}/${p.assists}`.padEnd(9)} ${p.score}`).join('\n')}\n\`\`\``;
    await i.editReply(card({ title: `${m.map} · ${m.mode}`, color: VR, description: m.teams.map(table).join('\n'), footer: `${m.started ? new Date(m.started).toUTCString() : ''} · K/D/A and combat score · HenrikDev` }));
  }), { tweaks: { matchid: { maxLength: 40 } } }),
  hsub('valorant history', lookup(async i => {
    const { name, tag } = riot(i);
    const a = await hd.vAccount(name, tag);
    let rows: hd.VHistoryRow[] = [];
    for (const p of plat(i)) { rows = await hd.vHistory(a.region, p, a.name, a.tag).catch(() => []); if (rows.length) break; }
    if (!rows.length) throw new LookupError('No ranked games found for that player.');
    await i.editReply(listCard(`${a.name}#${a.tag} — ranked history`, rows.slice(0, 20).map(r => `${r.change >= 0 ? '🟩' : '🟥'} **${r.change >= 0 ? '+' : ''}${r.change}** → ${r.tier} ${r.rr} RR${r.map ? ` · ${r.map}` : ''}${r.date ? ` · ${when(r.date, 'R')}` : ''}`), { color: VR, footer: 'Data from HenrikDev' }));
  }), { tweaks: { name: { maxLength: 16 }, tag: { maxLength: 5 } } }),
];

export const fortniteUserSub: Sub = hsub('fortnite user', lookup(async i => {
  const s = await g.fnStats(i.options.getString('username', true));
  await i.editReply(card({
    title: s.name, color: 0x9d4dbb, image: s.image,
    fields: [['Wins', num(s.wins)], ['Win rate', `${s.winRate.toFixed(1)}%`], ['Kills', num(s.kills)], ['K/D', s.kd.toFixed(2)], ['Matches', num(s.matches)], ['Top 10', s.top10 != null ? num(s.top10) : null], ['Time played', `${Math.round(s.minutes / 60).toLocaleString('en-US')} h`], ['Battle pass', s.level ? `Level ${s.level}` : null]],
    footer: 'Data from fortnite-api.com',
  }));
}), { tweaks: { username: { maxLength: 40 } } });

/** Big, long-running public servers (Java unless noted). /minecraft randomserver pings a random one and shows it live. */
export const MC_SERVERS = ['mc.hypixel.net', 'play.cubecraft.net', 'play.wynncraft.com', '2b2t.org', 'mc.gamster.org', 'play.pika-network.net', 'hub.opblocks.com', 'play.jartexnetwork.com', 'mc.mineheroes.net', 'play.minesaga.org', 'play.manacube.com', 'mc.complex-gaming.com', 'play.mineville.org', 'play.blossomcraft.org', 'play.vulengate.com'];

export const minecraftRandomSub: Sub = hsub('minecraft randomserver', lookup(async i => {
  const pool = [...MC_SERVERS].sort(() => Math.random() - 0.5);
  for (const addr of pool.slice(0, 4)) {
    const s = await g.mcServer(addr).catch(() => null);
    if (!s?.online) continue;
    const files: AttachmentBuilder[] = [];
    if (s.iconDataUri?.startsWith('data:image/png;base64,')) files.push(new AttachmentBuilder(Buffer.from(s.iconDataUri.split(',')[1]!, 'base64'), { name: 'icon.png' }));
    await i.editReply(card({
      title: `🟢 ${addr}`, color: 0x62b47a, thumbnail: files.length ? 'attachment://icon.png' : undefined, files,
      description: s.motd ? `\`\`\`\n${trunc(s.motd, 300)}\n\`\`\`` : undefined,
      fields: [['Players', s.players ? `${num(s.players.online)} / ${num(s.players.max)}` : null], ['Version', s.version], ['Address', `\`${addr}\``]],
    }));
    return;
  }
  throw new LookupError('None of the servers I tried answered — try again.');
}));

