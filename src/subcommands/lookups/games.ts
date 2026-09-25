import type { Sub } from '../../framework/group.js';
import { card, compact, listCard, num, trunc, when } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import * as g from '../../lookups/games.js';
import { AttachmentBuilder } from 'discord.js';

const str = (n: string, d: string, max = 100, required = true) => (s: import('discord.js').SlashCommandSubcommandBuilder) =>
  s.addStringOption(o => o.setName(n).setDescription(d).setRequired(required).setMaxLength(max));

// ─── Minecraft ───────────────────────────────────────────────────────────────

export const minecraftSubs: Sub[] = [
  {
    name: 'server', description: 'Get Minecraft server information',
    options: s => s.addStringOption(o => o.setName('address').setDescription('Server address, e.g. play.example.com').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('edition').setDescription('Java (default) or Bedrock').addChoices({ name: 'Java', value: 'java' }, { name: 'Bedrock', value: 'bedrock' })),
    run: lookup(async i => {
      const edition = i.options.getString('edition') as 'java' | 'bedrock' | null;
      let s = await g.mcServer(i.options.getString('address', true), edition ?? 'java');
      // No edition given (Heist has no such option): a server that doesn't answer as Java may be a Bedrock one.
      if (!edition && !s.online) { const b = await g.mcServer(i.options.getString('address', true), 'bedrock').catch(() => null); if (b?.online) s = b; }
      const files: AttachmentBuilder[] = [];
      let thumb: string | undefined;
      if (s.iconDataUri?.startsWith('data:image/png;base64,')) {
        files.push(new AttachmentBuilder(Buffer.from(s.iconDataUri.split(',')[1]!, 'base64'), { name: 'icon.png' }));
        thumb = 'attachment://icon.png';
      }
      await i.editReply(card({
        title: `${s.online ? '🟢' : '🔴'} ${s.hostname ?? i.options.getString('address', true)}`, color: s.online ? 0x57f287 : 0xed4245, thumbnail: thumb, files,
        description: s.motd ? `\`\`\`\n${trunc(s.motd, 300)}\n\`\`\`` : undefined,
        fields: s.online
          ? [['Players', s.players ? `${num(s.players.online)} / ${num(s.players.max)}` : null], ['Version', s.version], ['Software', s.software], ['Edition', s.edition === 'bedrock' ? 'Bedrock' : 'Java'], ['Address', s.ip ? `${s.ip}:${s.port}` : null],
            s.players?.list?.length ? ['Online now', trunc(s.players.list.slice(0, 15).join(', '), 300)] : null]
          : [['Status', 'Offline or not answering pings'], ['Edition', s.edition === 'bedrock' ? 'Bedrock' : 'Java']],
        footer: s.eulaBlocked ? 'This server is blocked by Mojang for EULA violations.' : undefined,
      }));
    }),
  },
  {
    name: 'skin', description: 'View a Minecraft player\'s skin', options: str('username', 'Minecraft username'),
    run: lookup(async i => {
      const p = await g.mcPlayer(i.options.getString('username', true));
      await i.editReply(card({ title: `${p.name}'s skin`, color: 0x62b47a, image: g.mcBody(p.id), thumbnail: g.mcHead(p.id), links: [{ label: 'Download skin', url: g.mcSkin(p.id) }, { label: 'NameMC', url: `https://namemc.com/profile/${p.name}` }] }));
    }),
  },
  {
    name: 'user', description: 'Get Minecraft user information', options: str('username', 'Minecraft username'),
    run: lookup(async i => {
      const p = await g.mcPlayer(i.options.getString('username', true));
      await i.editReply(card({
        title: p.name, color: 0x62b47a, thumbnail: g.mcHead(p.id), image: g.mcBody(p.id),
        fields: [['UUID', `\`${p.id}\``], ['Name history', p.nameHistory.length > 1 ? p.nameHistory.map(h => h.name).join(' → ') : 'No previous names']],
        links: [{ label: 'NameMC', url: `https://namemc.com/profile/${p.name}` }, { label: 'Skin file', url: g.mcSkin(p.id) }],
      }));
    }),
  },
];

// ─── GitHub ──────────────────────────────────────────────────────────────────

export const githubSubs: Sub[] = [
  {
    name: 'repo', description: 'Look up a GitHub repository', options: str('repo', 'owner/name or a GitHub link'),
    run: lookup(async i => {
      const r = await g.ghRepo(i.options.getString('repo', true));
      await i.editReply(card({
        title: r.full_name, url: r.html_url, color: 0x24292f, thumbnail: r.owner.avatar_url, description: r.description ?? undefined,
        fields: [['⭐ Stars', compact(r.stargazers_count)], ['🍴 Forks', compact(r.forks_count)], ['👀 Watchers', compact(r.watchers_count)], ['🐛 Open issues', num(r.open_issues_count)], ['Language', r.language],
          ['License', r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : r.license?.name], ['Size', `${(r.size / 1024).toFixed(1)} MB`], ['Default branch', r.default_branch],
          ['Created', when(r.created_at)], ['Last push', when(r.pushed_at, 'R')], r.topics?.length ? ['Topics', r.topics.slice(0, 8).map(t => `\`${t}\``).join(' ')] : null,
          r.archived ? ['Status', '📦 Archived'] : null, r.fork ? ['Type', 'Fork'] : null],
        links: [{ label: 'Repository', url: r.html_url }, ...(r.homepage && /^https?:/.test(r.homepage) ? [{ label: 'Homepage', url: r.homepage }] : [])],
      }));
    }),
  },
  {
    name: 'user', description: 'Look up a GitHub user\'s profile', options: str('username', 'GitHub username'),
    run: lookup(async i => {
      const u = await g.ghUser(i.options.getString('username', true));
      await i.editReply(card({
        title: `${u.name ?? u.login}${u.name ? ` (@${u.login})` : ''}`, url: u.html_url, color: 0x24292f, thumbnail: u.avatar_url, description: u.bio ?? undefined,
        fields: [['Followers', compact(u.followers)], ['Following', compact(u.following)], ['Repositories', num(u.public_repos)], ['Gists', num(u.public_gists)], ['Company', u.company], ['Location', u.location],
          ['Website', u.blog ? (/^https?:/.test(u.blog) ? u.blog : `https://${u.blog}`) : null], ['Twitter/X', u.twitter_username ? `@${u.twitter_username}` : null], ['Joined', when(u.created_at)], ['Type', u.type]],
        links: [{ label: 'Profile', url: u.html_url }],
      }));
    }),
  },
];

// ─── Steam ───────────────────────────────────────────────────────────────────

export const steamSubs: Sub[] = [
  {
    name: 'game', description: 'Search for a game on Steam', options: str('query', 'Game name or Steam app ID'),
    run: lookup(async i => {
      const a = await g.steamApp(i.options.getString('query', true));
      const url = `https://store.steampowered.com/app/${a.id}`;
      await i.editReply(card({
        title: a.name, url, color: 0x1b2838, image: a.header, description: a.short ? trunc(a.short, 450) : undefined,
        fields: [['Price', a.free ? 'Free to play' : a.price ? `${a.price}${a.discount ? ` (~~${a.initialPrice}~~ −${a.discount}%)` : ''}` : 'Not available'], ['Playing now', a.players != null ? num(a.players) : null],
          ['Metacritic', a.metacritic], ['Release', a.release], ['Developer', a.developers.join(', ')], ['Publisher', a.publishers.join(', ')], ['Genres', a.genres.join(', ')], ['Platforms', a.platforms.join(', ')],
          ['Reviews', a.recommendations ? `${compact(a.recommendations)} recommendations` : null]],
        links: [{ label: 'Store page', url }, { label: 'Open in Steam', url: `https://store.steampowered.com/app/${a.id}?utm_source=bestow` }],
      }));
    }),
  },
];

// ─── Valorant ────────────────────────────────────────────────────────────────

const VR = 0xff4655;
const hexColor = (h?: string) => (h && /^[0-9a-f]{6}/i.test(h) ? parseInt(h.slice(0, 6), 16) : VR);

export const valorantSubs: Sub[] = [
  {
    name: 'agents', description: 'Browse all Valorant agents (or look one up)', options: str('agent', 'An agent to look up (leave empty for the list)', 40, false),
    run: lookup(async i => {
      const agents = await g.vAgents();
      const q = i.options.getString('agent');
      if (!q) {
        const byRole = new Map<string, string[]>();
        for (const a of agents) byRole.set(a.role?.displayName ?? 'Other', [...(byRole.get(a.role?.displayName ?? 'Other') ?? []), a.displayName]);
        await i.editReply(card({ title: `Valorant agents (${agents.length})`, color: VR, fields: [...byRole.entries()].map(([r, n]) => [r, n.sort().join(', ')] as [string, string]), footer: 'Use /valorant agents agent:<name> for abilities' }));
        return;
      }
      const a = g.findByName(agents, q);
      if (!a) throw new LookupError(`I couldn't find an agent called **${q}**.`);
      await i.editReply(card({
        title: a.displayName, color: hexColor(a.backgroundGradientColors?.[0]), thumbnail: a.displayIcon, image: a.fullPortrait ?? a.bustPortrait, description: a.description,
        fields: [['Role', a.role?.displayName], ...a.abilities.filter(x => x.displayName).map(x => [x.slot.replace('Ability1', 'C').replace('Ability2', 'Q').replace('Grenade', 'E').replace('Ultimate', 'X'), `**${x.displayName}** — ${trunc(x.description, 160)}`] as [string, string])],
      }));
    }),
  },
  {
    name: 'maps', description: 'Browse all playable Valorant maps (or look one up)', options: str('map', 'A map to look up (leave empty for the list)', 40, false),
    run: lookup(async i => {
      const maps = (await g.vMaps()).filter(m => m.tacticalDescription || m.displayIcon);
      const q = i.options.getString('map');
      if (!q) { await i.editReply(listCard(`Valorant maps (${maps.length})`, maps.map(m => `• **${m.displayName}**${m.tacticalDescription ? ` — ${m.tacticalDescription}` : ''}`), { color: VR })); return; }
      const m = g.findByName(maps, q);
      if (!m) throw new LookupError(`I couldn't find a map called **${q}**.`);
      await i.editReply(card({ title: m.displayName, color: VR, image: m.splash ?? m.listViewIcon ?? undefined, thumbnail: m.displayIcon ?? undefined, fields: [['Sites', m.tacticalDescription], ['Coordinates', m.coordinates], ['Callouts', m.callouts ? m.callouts.length : null]] }));
    }),
  },
  {
    name: 'seasons', description: 'Browse Valorant seasons and episodes',
    run: lookup(async i => {
      const timeline = g.seasonTimeline(await g.vSeasons());
      const lines = timeline.slice(-8).map(t => {
        const acts = t.acts.map(a => (a.current ? `**${a.act.displayName}** ◀` : a.act.displayName)).join(' · ');
        return `${t.current ? '🟢' : '⚪'} **${t.episode.displayName}** (${when(t.episode.startTime)}–${when(t.episode.endTime)})${acts ? `\n> ${acts}` : ''}`;
      });
      await i.editReply(listCard('Valorant seasons', lines, { color: VR, footer: 'Latest 8 episodes · ◀ marks the current act' }));
    }),
  },
  {
    name: 'skin', description: 'Show info about a Valorant weapon skin', options: str('name', 'Skin name, e.g. Reaver Vandal'),
    run: lookup(async i => {
      const q = i.options.getString('name', true);
      const hit = g.findSkin(await g.vWeapons(), q);
      if (!hit) throw new LookupError(`I couldn't find a skin called **${q}**.`);
      const tier = (await g.vTiers()).find(t => t.uuid === hit.skin.contentTierUuid);
      await i.editReply(card({
        title: hit.skin.displayName, color: hexColor(tier?.highlightColor), thumbnail: tier?.displayIcon, image: hit.skin.displayIcon ?? hit.skin.wallpaper ?? undefined,
        fields: [['Weapon', hit.weapon.displayName], ['Tier', tier?.displayName], ['Chromas', hit.skin.chromas?.length ?? null], ['Levels', hit.skin.levels?.length ?? null]],
      }));
    }),
  },
  {
    name: 'weapon', description: 'Show info about a Valorant weapon', options: str('name', 'Weapon name, e.g. Vandal'),
    run: lookup(async i => {
      const q = i.options.getString('name', true);
      const w = g.findByName(await g.vWeapons(), q);
      if (!w) throw new LookupError(`I couldn't find a weapon called **${q}**.`);
      const st = w.weaponStats;
      const dmg = st?.damageRanges?.[0];
      await i.editReply(card({
        title: w.displayName, color: VR, image: w.displayIcon,
        fields: [['Category', w.category.replace('EEquippableCategory::', '')], ['Cost', w.shopData ? `${num(w.shopData.cost)} credits` : 'Free'], st ? ['Fire rate', `${st.fireRate}/s`] : null, st ? ['Magazine', st.magazineSize] : null,
          st ? ['Reload', `${st.reloadTimeSeconds}s`] : null, st ? ['Equip', `${st.equipTimeSeconds}s`] : null, st ? ['Wall penetration', st.wallPenetration.replace('EWallPenetrationDisplayType::', '')] : null,
          dmg ? ['Damage (head/body/leg)', `${dmg.headDamage} / ${dmg.bodyDamage} / ${dmg.legDamage}`] : null, ['Skins', w.skins.length]],
      }));
    }),
  },
];

// ─── Fortnite ────────────────────────────────────────────────────────────────

const FN = 0x7d5fff;
export const fortniteSubs: Sub[] = [
  {
    name: 'cosmetic', description: 'Look up a Fortnite cosmetic', options: str('name', 'Cosmetic name, e.g. Renegade Raider'),
    run: lookup(async i => {
      const c = await g.fnCosmetic(i.options.getString('name', true));
      await i.editReply(card({
        title: c.name, color: FN, image: c.images?.featured ?? c.images?.icon, thumbnail: c.images?.smallIcon, description: c.description,
        fields: [['Type', c.type?.displayValue], ['Rarity', c.rarity?.displayValue], ['Introduced', c.introduction?.text], ['Set', c.set?.text], ['Added', when(c.added)]],
      }));
    }),
  },
  { name: 'map', description: 'View the Fortnite map', run: lookup(async i => { const m = await g.fnMap(); await i.editReply(card({ title: 'Fortnite map', color: FN, image: m.images.pois, footer: `${m.pois.length} points of interest` })); }) },
  {
    name: 'shop', description: 'View today\'s Fortnite item shop',
    run: lookup(async i => {
      const shop = await g.fnShop();
      const sections = g.shopSections(shop);
      await i.editReply(card({
        title: `Fortnite item shop — ${when(shop.date)}`, color: FN,
        fields: sections.map(s => [`${s.name} (${s.total})`, s.lines.join('\n')] as [string, string]),
        footer: `${shop.entries.length} offers in total`,
      }));
    }),
  },
];

// ─── YouTube ─────────────────────────────────────────────────────────────────

export const youtubeSubs: Sub[] = [
  {
    name: 'search', description: 'Search YouTube videos', options: str('query', 'What to search for', 120),
    run: lookup(async i => {
      const res = await g.ytSearch(i.options.getString('query', true), 6);
      if (!res.length) throw new LookupError('No videos found.');
      await i.editReply(listCard(`YouTube: ${trunc(i.options.getString('query', true), 60)}`, res.map(r => `• [${trunc(r.title, 90)}](${r.url}) — ${r.channel ?? 'unknown'} · ${g.fmtDuration(r.duration)}${r.views ? ` · ${compact(r.views)} views` : ''}`), { color: 0xff0000, thumbnail: `https://i.ytimg.com/vi/${res[0]!.id}/hqdefault.jpg` }));
    }),
  },
];
