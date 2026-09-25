import { AttachmentBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { hfrom, hsub } from '../../framework/heist.js';
import { makeZip } from '../../framework/zip.js';
import { card, compact, listCard, num, trunc, when } from '../../lookups/card.js';
import { lineChart } from '../../lookups/chart.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import * as rbx from '../../lookups/roblox.js';
import { robloxSubs } from './roblox.js';

/** /roblox exactly as Heist lists it: existing handlers under Heist's names, plus the lookups Heist has that Bestow didn't. */

const RED = 0xe2231a;
const old = (n: string) => robloxSubs.find(s => s.name === n)!;
const who = (i: ChatInputCommandInteraction) => rbx.resolveUser(i.options.getString('username', true));
const uname = { username: { maxLength: 60 } };

function robux(i: ChatInputCommandInteraction): number {
  const n = rbx.parseRobux(i.options.getString('amount', true));
  if (n == null) throw new LookupError('Give an amount of Robux like `1500`, `100k`, `1.5m` or `10b`.');
  return n;
}
function assetId(raw: string): number {
  const id = rbx.parseAssetId(raw);
  if (!id) throw new LookupError('Give an asset ID or a Roblox catalog link.');
  return id;
}

export const heistRobloxSubs: Sub[] = [
  hfrom('roblox profilelink', old('profilelink'), { alias: { username: 'username1' }, tweaks: { username1: { maxLength: 60 }, username2: { maxLength: 60 }, username3: { maxLength: 60 }, username4: { maxLength: 60 }, username5: { maxLength: 60 } } }),
  hsub('roblox britcheck', lookup(async i => {
    const u = await who(i);
    const r = await rbx.friendsHidden(u.id);
    const verdict = r.hidden ? '🙈 **Friends hidden.** The count is public but the list is empty — Roblox hides it for some regions (UK/Australia) and ages.'
      : (r.count ?? 0) === 0 ? '👤 **No friends to show** (the account has none, or hides everything).'
        : `👀 **Friends visible** — ${num(r.listed)} of ${num(r.count)} listed.`;
    await i.editReply(card({ title: `${u.displayName} (@${u.name})`, url: rbx.profileUrl(u.id), color: r.hidden ? 0xfee75c : RED, description: verdict, fields: [['Friend count', num(r.count)], ['Visible in list', num(r.listed)]] }));
  }), { tweaks: uname }),
  hfrom('roblox game', old('game'), { tweaks: { query: { maxLength: 100 } } }),
  hfrom('roblox group', old('group'), { tweaks: { name: { maxLength: 100 } } }),
  hsub('roblox user', lookup(async i => {
    const byId = i.options.getInteger('userid');
    const u = byId ? await rbx.userById(byId) : await who(i);
    const [c, av, groups] = await Promise.all([rbx.counts(u.id), rbx.avatarUrl(u.id, 'headshot').catch(() => null), rbx.userGroups(u.id).catch(() => [])]);
    await i.editReply(card({
      title: `${u.displayName}${u.name !== u.displayName ? ` (@${u.name})` : ''}${u.hasVerifiedBadge ? ' ✅' : ''}`, url: rbx.profileUrl(u.id), color: RED, thumbnail: av ?? undefined,
      description: u.description ? trunc(u.description, 400) : undefined,
      fields: [['ID', u.id], ['Created', `${when(u.created)} (${when(u.created, 'R')})`], ['Friends', num(c.friends)], ['Followers', compact(c.followers)], ['Following', compact(c.following)],
        ['Groups', groups.length], u.isBanned ? ['Status', '🚫 Banned'] : null],
      links: [{ label: 'Profile', url: rbx.profileUrl(u.id) }],
    }));
  }), { tweaks: { ...uname, userid: { min: 1 } } }),
  hfrom('roblox item', old('item'), { tweaks: { query: { maxLength: 100 } } }),
  hfrom('roblox previousnames', old('previousnames'), { tweaks: uname }),
  ...(['followers', 'following'] as const).map(which => hsub(`roblox ${which}`, lookup(async i => {
    const u = await who(i);
    const [list, c] = await Promise.all([rbx.followList(u.id, which === 'followers' ? 'followers' : 'followings'), rbx.counts(u.id)]);
    const total = which === 'followers' ? c.followers : c.following;
    await i.editReply(listCard(`${u.displayName}'s ${which} (${compact(total)})`, list.slice(0, 40).map(x => `• [${x.displayName}](${rbx.profileUrl(x.id)}) (@${x.name})`), { color: RED, links: [{ label: 'Profile', url: rbx.profileUrl(u.id) }], footer: total && total > list.length ? `Showing the latest ${list.length}` : undefined }));
  }), { tweaks: uname })),
  hfrom('roblox friends', old('friends'), { tweaks: uname }),
  hfrom('roblox groups', old('groups'), { tweaks: uname }),
  hfrom('roblox blendavatars', old('blendavatars'), { alias: { username: 'username1' }, tweaks: { username1: { maxLength: 60 }, username2: { maxLength: 60 } } }),
  hsub('roblox recentbadges', lookup(async i => {
    const u = await who(i);
    const b = await rbx.recentBadges(u.id, 15);
    await i.editReply(listCard(`${u.displayName}'s recent badges`, b.map(x => `• **${trunc(x.name, 60)}**${x.awardedDate ? ` — ${when(x.awardedDate, 'R')}` : ''}`), { color: RED, thumbnail: b[0]?.icon, links: [{ label: 'Profile', url: rbx.profileUrl(u.id) }] }));
  }), { tweaks: uname }),
  hfrom('roblox wearing', old('wearing'), { tweaks: uname }),
  hfrom('roblox games', old('games'), { tweaks: uname }),
  hsub('roblox necklaces', lookup(async i => {
    const u = await who(i);
    const n = await rbx.necklaces(u.id);
    await i.editReply(listCard(`${u.displayName}'s initial necklaces (${n.length})`, n.map(x => `• [${trunc(x.name, 70)}](${rbx.itemUrl(x.assetId)})`), { color: RED, footer: 'Searched the necklace slot of their public inventory.' }));
  }), { tweaks: uname }),
  hfrom('roblox outfits', old('outfits'), { tweaks: uname }),
  hsub('roblox devex', lookup(async i => {
    const amt = robux(i), rate = rbx.devexRate();
    await i.editReply(card({
      title: 'DevEx calculator', color: RED,
      fields: [['Robux', `R$ ${num(amt)}`], ['Value', `**$${rbx.robuxToUsd(amt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD**`], ['Rate', `$${rate} per R$`]],
      footer: 'Roblox sets the DevEx rate and it can change. DevEx also has eligibility requirements.',
    }));
  }), { tweaks: { amount: { maxLength: 20 } } }),
  hsub('roblox calctax', lookup(async i => {
    const amt = robux(i);
    await i.editReply(card({
      title: 'Robux tax calculator', color: RED, description: 'Roblox keeps **30%** of every marketplace sale.',
      fields: [[`If you list it for R$ ${num(amt)}`, `you receive **R$ ${num(rbx.afterTax(amt))}**`], [`To receive R$ ${num(amt)}`, `list it for **R$ ${num(rbx.priceToReceive(amt))}**`]],
    }));
  }), { tweaks: { amount: { maxLength: 20 } } }),
  hfrom('roblox avatar', old('avatar'), { tweaks: uname }),
  hsub('roblox template', lookup(async i => {
    const id = assetId(i.options.getString('assetid', true));
    const png = await rbx.templateImage(id);
    await i.editReply(card({ title: `Template for ${id}`, url: rbx.itemUrl(id), color: RED, image: 'attachment://template.png', files: [new AttachmentBuilder(png, { name: 'template.png' })] }));
  }), { tweaks: { assetid: { maxLength: 200, description: 'Shirt or pants ID, or its catalog link' } } }),
  hsub('roblox asset', lookup(async i => {
    const id = assetId(i.options.getString('id', true));
    const place = i.options.getString('placeid');
    const [a, thumb] = await Promise.all([rbx.assetDetails(id), rbx.assetThumb(id).catch(() => null)]);
    const placeId = place ? rbx.parseAssetId(place) : null;
    await i.editReply(card({
      title: a.Name, url: rbx.itemUrl(id), color: RED, image: thumb ?? undefined, description: a.Description ? trunc(a.Description, 400) : undefined,
      fields: [['ID', a.AssetId], ['Creator', a.Creator?.Name], ['Price', a.PriceInRobux == null ? 'Off sale / free' : `R$ ${num(a.PriceInRobux)}`], ['Sales', a.Sales ? num(a.Sales) : null],
        ['Created', when(a.Created)], ['Updated', when(a.Updated, 'R')], placeId ? ['Place', `[${placeId}](${rbx.gameUrl(placeId)})`] : null],
      links: [{ label: 'Catalog page', url: rbx.itemUrl(id) }, { label: 'Download', url: `https://assetdelivery.roblox.com/v1/asset?id=${id}` }],
    }));
  }), { tweaks: { id: { maxLength: 200 }, placeid: { maxLength: 200 } } }),
];

async function sendModel(i: ChatInputCommandInteraction, title: string, url: string, m: rbx.Manifest3d, preview: string | null) {
  const files = await rbx.modelFiles(m);
  const zip = makeZip(files);
  await i.editReply(card({
    title, url, color: RED, image: preview ?? undefined, description: `3D model: \`model.obj\` + \`model.mtl\` + ${files.length - 2} texture${files.length === 3 ? '' : 's'}. Open it in Blender, Windows 3D Viewer or any OBJ viewer.`,
    files: [new AttachmentBuilder(zip, { name: 'model.zip' })],
  }));
}

export const robloxRenderSubs: Sub[] = [
  hsub('roblox render asset', lookup(async i => {
    const id = assetId(i.options.getString('assetid', true));
    const [a, thumb] = await Promise.all([rbx.assetDetails(id), rbx.assetThumb(id).catch(() => null)]);
    await sendModel(i, `${a.Name} — 3D model`, rbx.itemUrl(id), await rbx.asset3d(id), thumb);
  }), { tweaks: { assetid: { maxLength: 200 } } }),
  hsub('roblox render avatar', lookup(async i => {
    const u = await who(i);
    await sendModel(i, `${u.displayName}'s avatar — 3D model`, rbx.profileUrl(u.id), await rbx.avatar3d(u.id), await rbx.avatarUrl(u.id, 'full').catch(() => null));
  }), { tweaks: uname }),
];

export const robloxHistorySubs: Sub[] = [
  hsub('roblox history user', lookup(async i => {
    const u = await who(i);
    const h = await rbx.gameHistory(u.id);
    await i.editReply(listCard(`${u.displayName}'s recent games`, h.map(g => `• [${trunc(g.name, 60)}](${rbx.gameUrl(g.rootPlaceId)})${g.lastBadge ? ` — ${when(g.lastBadge, 'R')}` : ''}\n  -# badge: ${trunc(g.badgeName, 60)}`), { color: RED, footer: 'Based on the badges they earned most recently.' }));
  }), { tweaks: uname }),
];

// ─── /rolimons ───────────────────────────────────────────────────────────────

const RANGES: Record<string, number> = { '1 Week': 7, '1 Month': 30, '3 Months': 91, '6 Months': 182, '1 Year': 365, 'All Time': Infinity };

export const rolimonsSubs: Sub[] = [
  hsub('rolimons user', lookup(async i => {
    const u = await who(i);
    const [p, av] = await Promise.all([rbx.rolimonsPlayer(u.id), rbx.avatarUrl(u.id, 'headshot').catch(() => null)]);
    const link = `https://www.rolimons.com/player/${u.id}`;
    await i.editReply(card({
      title: `${p.name || u.name}`, url: link, color: 0x0084dd, thumbnail: av ?? undefined,
      fields: [['Value', p.value != null ? `R$ ${num(p.value)}` : 'Hidden'], ['RAP', p.rap != null ? `R$ ${num(p.rap)}` : 'Hidden'], ['Rank', p.rank ? `#${num(p.rank)}` : null],
        ['Premium', p.premium ? 'Yes' : 'No'], p.privacy ? ['Inventory', '🔒 Private'] : null, p.terminated ? ['Status', '🚫 Terminated'] : null,
        ['Last online', p.lastOnline ? when(p.lastOnline, 'R') : null], ['Last seen in', p.lastLocation], ['Stats updated', p.updated ? when(p.updated, 'R') : null]],
      links: [{ label: 'Rolimons', url: link }, { label: 'Roblox profile', url: rbx.profileUrl(u.id) }],
    }));
  }), { tweaks: uname }),
  hsub('rolimons chart', lookup(async i => {
    const u = await who(i);
    const range = i.options.getString('range') ?? '1 Month';
    const days = RANGES[range] ?? 30;
    const all = await rbx.rolimonsChart(u.id);
    const since = Number.isFinite(days) ? Date.now() - days * 86_400_000 : 0;
    const pts = all.filter(p => p.t >= since);
    if (pts.length < 2) throw new LookupError('Rolimons doesn\'t have enough value history for that player in this range.');
    const png = lineChart([
      { label: 'Value', color: '#2ecc71', points: pts.map(p => ({ x: p.t, y: p.value })) },
      { label: 'RAP', color: '#3498db', points: pts.map(p => ({ x: p.t, y: p.rap })) },
    ], { title: `${u.name} · ${range}` });
    const last = pts.at(-1)!;
    await i.editReply(card({ title: `${u.displayName}'s value chart`, url: `https://www.rolimons.com/player/${u.id}`, color: 0x0084dd, image: 'attachment://chart.png', files: [new AttachmentBuilder(png, { name: 'chart.png' })],
      fields: [['Value', `R$ ${num(last.value)}`], ['RAP', `R$ ${num(last.rap)}`]], footer: 'Data from Rolimons' }));
  }), { tweaks: uname }),
];

