import { AttachmentBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Sub } from '../../framework/group.js';
import { getBuffer } from '../../framework/http.js';
import { card, compact, listCard, num, trunc, when } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import * as rbx from '../../lookups/roblox.js';

const RED = 0xe2231a;
const userOpt = (s: SlashCommandSubcommandBuilder, desc = 'Roblox username or ID') => s.addStringOption(o => o.setName('username').setDescription(desc).setRequired(true).setMaxLength(60));

export const robloxSubs: Sub[] = [
  {
    name: 'user', description: 'Get Roblox user information', options: s => userOpt(s),
    run: lookup(async i => {
      const u = await rbx.resolveUser(i.options.getString('username', true));
      const [c, av, groups] = await Promise.all([rbx.counts(u.id), rbx.avatarUrl(u.id, 'headshot').catch(() => null), rbx.userGroups(u.id).catch(() => [])]);
      await i.editReply(card({
        title: `${u.displayName}${u.name !== u.displayName ? ` (@${u.name})` : ''}${u.hasVerifiedBadge ? ' ✅' : ''}`, url: rbx.profileUrl(u.id), color: RED, thumbnail: av ?? undefined,
        description: u.description ? trunc(u.description, 400) : undefined,
        fields: [['ID', u.id], ['Created', `${when(u.created)} (${when(u.created, 'R')})`], ['Friends', num(c.friends)], ['Followers', compact(c.followers)], ['Following', compact(c.following)],
          ['Groups', groups.length], u.isBanned ? ['Status', '🚫 Banned'] : null],
        links: [{ label: 'Profile', url: rbx.profileUrl(u.id) }],
      }));
    }),
  },
  {
    name: 'avatar', description: 'View a Roblox user\'s current avatar',
    options: s => userOpt(s).addStringOption(o => o.setName('view').setDescription('Which crop (default full body)').addChoices({ name: 'Full body', value: 'full' }, { name: 'Bust', value: 'bust' }, { name: 'Headshot', value: 'headshot' })),
    run: lookup(async i => {
      const u = await rbx.resolveUser(i.options.getString('username', true));
      const url = await rbx.avatarUrl(u.id, (i.options.getString('view') ?? 'full') as rbx.ThumbKind);
      if (!url) throw new LookupError('That avatar isn\'t available right now (it may still be rendering — try again).');
      await i.editReply(card({ title: `${u.displayName}'s avatar`, url: rbx.profileUrl(u.id), color: RED, image: url }));
    }),
  },
  {
    name: 'blendavatars', description: 'Blend two Roblox avatar headshots side by side',
    options: s => userOpt(s, 'First username').addStringOption(o => o.setName('username2').setDescription('Second username').setRequired(true).setMaxLength(60)),
    run: lookup(async i => {
      const [a, b] = await Promise.all([rbx.resolveUser(i.options.getString('username', true)), rbx.resolveUser(i.options.getString('username2', true))]);
      const urls = await Promise.all([rbx.avatarUrl(a.id, 'headshot', '420x420'), rbx.avatarUrl(b.id, 'headshot', '420x420')]);
      if (!urls[0] || !urls[1]) throw new LookupError('One of those avatars isn\'t available right now.');
      const [imgA, imgB] = await Promise.all(urls.map(async u => loadImage(await getBuffer(u!, { maxBytes: 4 * 1024 * 1024 }))));
      const c = createCanvas(840, 420);
      const g = c.getContext('2d');
      g.drawImage(imgA!, 0, 0, 420, 420);
      g.drawImage(imgB!, 420, 0, 420, 420);
      // Soft seam so they read as one blended picture.
      const grad = g.createLinearGradient(380, 0, 460, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.25)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(380, 0, 80, 420);
      await i.editReply(card({ title: `${a.displayName} × ${b.displayName}`, color: RED, image: 'attachment://blend.png', files: [new AttachmentBuilder(c.toBuffer('image/png'), { name: 'blend.png' })] }));
    }),
  },
  {
    name: 'calctax', description: 'Calculate Robux marketplace tax',
    options: s => s.addIntegerOption(o => o.setName('amount').setDescription('Robux amount').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)),
    run: lookup(async i => {
      const amt = i.options.getInteger('amount', true);
      await i.editReply(card({
        title: 'Robux tax calculator', color: RED,
        description: `Roblox keeps **30%** of every marketplace sale.`,
        fields: [[`If you list it for R$ ${num(amt)}`, `you receive **R$ ${num(rbx.afterTax(amt))}**`], [`To receive R$ ${num(amt)}`, `list it for **R$ ${num(rbx.priceToReceive(amt))}**`]],
      }));
    }),
  },
  {
    name: 'devex', description: 'Calculate the USD value you\'d get from Developer Exchange',
    options: s => s.addIntegerOption(o => o.setName('amount').setDescription('Robux amount').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)),
    run: lookup(async i => {
      const amt = i.options.getInteger('amount', true);
      const rate = rbx.devexRate();
      await i.editReply(card({
        title: 'DevEx calculator', color: RED,
        fields: [['Robux', `R$ ${num(amt)}`], ['Value', `**$${rbx.robuxToUsd(amt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD**`], ['Rate', `$${rate} per R$`]],
        footer: 'Roblox sets the DevEx rate and it can change — this uses the bot\'s configured rate. DevEx also has eligibility requirements.',
      }));
    }),
  },
  {
    name: 'friends', description: 'View a Roblox user\'s friends list', options: s => userOpt(s),
    run: lookup(async i => {
      const u = await rbx.resolveUser(i.options.getString('username', true));
      const f = await rbx.friends(u.id);
      await i.editReply(listCard(`${u.displayName}'s friends (${f.length})`, f.slice(0, 40).map(x => `• [${x.displayName}](${rbx.profileUrl(x.id)}) (@${x.name})`).concat(f.length > 40 ? [`*…and ${f.length - 40} more*`] : []), { color: RED, links: [{ label: 'Profile', url: rbx.profileUrl(u.id) }] }));
    }),
  },
  {
    name: 'game', description: 'Get Roblox game information',
    options: s => s.addStringOption(o => o.setName('query').setDescription('Game name, place ID or universe ID').setRequired(true).setMaxLength(100)),
    run: lookup(async i => {
      const g = await rbx.resolveGame(i.options.getString('query', true));
      const icon = await rbx.gameIcon(g.id).catch(() => null);
      await i.editReply(card({
        title: g.name, url: rbx.gameUrl(g.rootPlaceId), color: RED, thumbnail: icon ?? undefined, description: g.description ? trunc(g.description, 500) : undefined,
        fields: [['Creator', g.creator?.name], ['Playing now', num(g.playing)], ['Visits', compact(g.visits)], ['Favorites', compact(g.favoritedCount)], ['Max players', g.maxPlayers], ['Genre', g.genre],
          ['Created', when(g.created)], ['Updated', when(g.updated, 'R')], ['Place ID', g.rootPlaceId]],
        links: [{ label: 'Play', url: rbx.gameUrl(g.rootPlaceId) }],
      }));
    }),
  },
  {
    name: 'games', description: 'View a Roblox user\'s created games', options: s => userOpt(s),
    run: lookup(async i => {
      const u = await rbx.resolveUser(i.options.getString('username', true));
      const games = await rbx.userGames(u.id);
      await i.editReply(listCard(`${u.displayName}'s games (${games.length})`, games.map(g => `• [${g.name}](${rbx.gameUrl(g.rootPlace?.id ?? g.id)}) — ${compact(g.placeVisits)} visits`), { color: RED }));
    }),
  },
  {
    name: 'group', description: 'Get Roblox group information',
    options: s => s.addStringOption(o => o.setName('name').setDescription('Group name or ID').setRequired(true).setMaxLength(100)),
    run: lookup(async i => {
      const g = await rbx.resolveGroup(i.options.getString('name', true));
      const icon = await rbx.groupIcon(g.id).catch(() => null);
      await i.editReply(card({
        title: `${g.name}${g.hasVerifiedBadge ? ' ✅' : ''}`, url: rbx.groupUrl(g.id), color: RED, thumbnail: icon ?? undefined, description: g.description ? trunc(g.description, 500) : undefined,
        fields: [['ID', g.id], ['Members', num(g.memberCount)], ['Owner', g.owner ? `[${g.owner.username}](${rbx.profileUrl(g.owner.userId)})` : 'None'], ['Public entry', g.publicEntryAllowed ? 'Yes' : 'No'], g.shout?.body ? ['Shout', trunc(g.shout.body, 200)] : null],
        links: [{ label: 'Group page', url: rbx.groupUrl(g.id) }],
      }));
    }),
  },
  {
    name: 'groups', description: 'View a Roblox user\'s joined groups', options: s => userOpt(s),
    run: lookup(async i => {
      const u = await rbx.resolveUser(i.options.getString('username', true));
      const gs = await rbx.userGroups(u.id);
      await i.editReply(listCard(`${u.displayName}'s groups (${gs.length})`, gs.slice(0, 30).map(x => `• [${x.group.name}](${rbx.groupUrl(x.group.id)}) — ${x.role.name}`).concat(gs.length > 30 ? [`*…and ${gs.length - 30} more*`] : []), { color: RED }));
    }),
  },
  {
    name: 'item', description: 'View a Roblox item\'s value and details (from Rolimons)',
    options: s => s.addStringOption(o => o.setName('query').setDescription('Item name, acronym or ID').setRequired(true).setMaxLength(100)),
    run: lookup(async i => {
      const q = i.options.getString('query', true);
      const item = rbx.findRolimons(await rbx.rolimonsItems(), q);
      if (!item) throw new LookupError(`I couldn't find a limited item matching **${q}**.`);
      const thumb = await rbx.assetThumb(item.id).catch(() => null);
      const tags = [item.projected ? '⚠️ Projected' : null, item.hyped ? '🔥 Hyped' : null, item.rare ? '💎 Rare' : null].filter(Boolean).join(' · ');
      await i.editReply(card({
        title: `${item.name}${item.acronym ? ` (${item.acronym})` : ''}`, url: rbx.itemUrl(item.id), color: RED, thumbnail: thumb ?? undefined,
        fields: [['RAP', `R$ ${num(item.rap)}`], ['Value', item.value >= 0 ? `R$ ${num(item.value)}` : 'Unvalued (uses RAP)'], ['Demand', rbx.demandName(item.demand)], ['Trend', rbx.trendName(item.trend)], tags ? ['Tags', tags] : null, ['ID', item.id]],
        links: [{ label: 'Catalog page', url: rbx.itemUrl(item.id) }, { label: 'Rolimons', url: `https://www.rolimons.com/item/${item.id}` }],
        footer: 'Values from Rolimons',
      }));
    }),
  },
  {
    name: 'asset', description: 'Fetch a Roblox asset by ID',
    options: s => s.addIntegerOption(o => o.setName('id').setDescription('Asset ID').setRequired(true).setMinValue(1)),
    run: lookup(async i => {
      const id = i.options.getInteger('id', true);
      const [a, thumb] = await Promise.all([rbx.assetDetails(id), rbx.assetThumb(id).catch(() => null)]);
      await i.editReply(card({
        title: a.Name, url: rbx.itemUrl(id), color: RED, image: thumb ?? undefined, description: a.Description ? trunc(a.Description, 400) : undefined,
        fields: [['ID', a.AssetId], ['Creator', a.Creator?.Name], ['Price', a.PriceInRobux == null ? 'Off sale / free' : `R$ ${num(a.PriceInRobux)}`], ['Sales', a.Sales ? num(a.Sales) : null], ['Created', when(a.Created)], ['Updated', when(a.Updated, 'R')]],
        links: [{ label: 'Catalog page', url: rbx.itemUrl(id) }],
      }));
    }),
  },
  {
    name: 'template', description: 'Grab the template for a classic Roblox shirt or pants',
    options: s => s.addIntegerOption(o => o.setName('assetid').setDescription('The shirt/pants item ID').setRequired(true).setMinValue(1)),
    run: lookup(async i => {
      const id = i.options.getInteger('assetid', true);
      const png = await rbx.templateImage(id);
      await i.editReply(card({ title: `Template for ${id}`, url: rbx.itemUrl(id), color: RED, image: 'attachment://template.png', files: [new AttachmentBuilder(png, { name: 'template.png' })] }));
    }),
  },
  {
    name: 'outfits', description: 'View a Roblox user\'s saved avatars', options: s => userOpt(s),
    run: lookup(async i => {
      const u = await rbx.resolveUser(i.options.getString('username', true));
      const o = await rbx.outfits(u.id);
      await i.editReply(listCard(`${u.displayName}'s outfits (${o.length}${o.length === 25 ? '+' : ''})`, o.map(x => `• ${x.name}`), { color: RED }));
    }),
  },
  {
    name: 'previousnames', description: 'View a Roblox user\'s past usernames', options: s => userOpt(s),
    run: lookup(async i => {
      const u = await rbx.resolveUser(i.options.getString('username', true));
      const names = await rbx.usernameHistory(u.id);
      await i.editReply(listCard(`Previous names of ${u.name}`, names.length ? names.map(n => `• ${n}`) : ['*No previous usernames.*'], { color: RED }));
    }),
  },
  {
    name: 'profilelink', description: 'Get Roblox user profile links',
    options: s => {
      userOpt(s, 'First user');
      for (let n = 2; n <= 5; n++) s.addStringOption(o => o.setName(`username${n}`).setDescription(`User ${n}`).setMaxLength(60));
      return s;
    },
    run: lookup(async i => {
      const names = ['username', 'username2', 'username3', 'username4', 'username5'].map(n => i.options.getString(n)).filter((x): x is string => !!x);
      const users = await Promise.all(names.map(rbx.resolveUser));
      await i.editReply(listCard('Profile links', users.map(u => `• [${u.displayName}](${rbx.profileUrl(u.id)}) — ${rbx.profileUrl(u.id)}`), { color: RED }));
    }),
  },
  {
    name: 'wearing', description: 'View what a Roblox user is currently wearing', options: s => userOpt(s),
    run: lookup(async i => {
      const u = await rbx.resolveUser(i.options.getString('username', true));
      const ids = (await rbx.wearing(u.id)).slice(0, 25);
      const items = await Promise.all(ids.map(id => rbx.assetDetails(id).catch(() => null)));
      const av = await rbx.avatarUrl(u.id, 'full').catch(() => null);
      await i.editReply(listCard(`${u.displayName} is wearing (${ids.length})`, items.map((a, n) => a ? `• [${a.Name}](${rbx.itemUrl(a.AssetId)})${a.PriceInRobux ? ` — R$ ${num(a.PriceInRobux)}` : ''}` : `• Item ${ids[n]}`), { color: RED, thumbnail: av ?? undefined }));
    }),
  },
];
