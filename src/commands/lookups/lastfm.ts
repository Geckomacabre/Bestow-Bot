import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, ModalBuilder, SectionBuilder, TextDisplayBuilder, TextInputBuilder,
  TextInputStyle, ThumbnailBuilder, type ChatInputCommandInteraction,
} from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { onComponent } from '../../framework/router.js';
import { card, listCard, num, trunc, when } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { cv2Box, cv2Err } from '../../utils/components.js';
import * as lf from '../../music/lastfm.js';
import * as sp from '../../music/spotify.js';
import { collage, nowPlayingCard } from '../../music/render.js';

const RED = lf.LASTFM_RED;
const priv = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/** Whose Last.fm: a typed username, else the member's (or your own) linked account. */
async function who(i: ChatInputCommandInteraction): Promise<string> {
  const typed = i.options.getString('username');
  if (typed) {
    if (!lf.USERNAME_RE.test(typed.trim())) throw new LookupError('That isn\'t a valid Last.fm username.');
    return typed.trim();
  }
  const member = i.options.getUser('member');
  const target = member ?? i.user;
  const l = await lf.linked(target.id);
  if (!l) throw new LookupError(member && member.id !== i.user.id ? `**${member.displayName ?? member.username}** hasn't linked Last.fm.` : 'Link your Last.fm first with `/lastfm login` (or pass a username).');
  return l.username;
}

const profile = (u: string) => `https://www.last.fm/user/${encodeURIComponent(u)}`;
const trackLine = (t: lf.Track) => `**[${trunc(t.name, 60)}](${t.url})** by ${trunc(t.artist, 40)}`;

// ─── Login ───────────────────────────────────────────────────────────────────

onComponent('lfm:', async i => {
  if (i.isButton() && i.customId.startsWith('lfm:done:')) {
    try {
      const s = await lf.sessionFor(i.customId.slice('lfm:done:'.length));
      await lf.link(i.user.id, s.username, s.key);
      await i.update({ components: [new ContainerBuilder().setAccentColor(RED).addTextDisplayComponents(new TextDisplayBuilder().setContent(`✅ Linked to **[${s.username}](${profile(s.username)})**. Try \`/lastfm nowplaying\`.`))] });
    } catch (e) {
      await i.reply({ content: `❌ ${(e as Error).message || 'Approve Bestow on the Last.fm page first, then press the button again.'}`, flags: MessageFlags.Ephemeral });
    }
  } else if (i.isModalSubmit() && i.customId === 'lfm:user') {
    const name = i.fields.getTextInputValue('username').trim();
    if (!lf.USERNAME_RE.test(name)) { await i.reply({ content: '❌ That isn\'t a valid Last.fm username.', flags: MessageFlags.Ephemeral }); return; }
    try {
      const u = await lf.userInfo(name);
      await lf.link(i.user.id, u.name, null);
      await i.reply({ ...cv2Box(`✅ Linked to **[${u.name}](${u.url})** (${num(u.playcount)} scrobbles).`, RED), flags: priv });
    } catch (e) { await i.reply({ content: `❌ ${(e as Error).message}`, flags: MessageFlags.Ephemeral }); }
  }
});

async function login(i: ChatInputCommandInteraction) {
  if (!lf.lastfmKey()) { await i.reply({ ...cv2Err('❌ Last.fm isn\'t set up on this bot (LASTFM_API_KEY).'), flags: priv }); return; }
  if (!lf.lastfmSecret()) {
    await i.showModal(new ModalBuilder().setCustomId('lfm:user').setTitle('Link your Last.fm').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('username').setLabel('Your Last.fm username').setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(15).setRequired(true))));
    return;
  }
  const { token, url } = await lf.authToken();
  const c = new ContainerBuilder().setAccentColor(RED)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🔗 Link Last.fm\n1. Press **Authorize** and approve Bestow on Last.fm.\n2. Come back and press **Done**.\n-# The link is valid for an hour. Bestow only reads your scrobbles and can love/unlove tracks when you ask.'))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Authorize').setURL(url),
      new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel('Done').setCustomId(`lfm:done:${token}`)));
  await i.reply({ flags: priv, components: [c] });
}

// ─── Now playing ─────────────────────────────────────────────────────────────

async function nowPlaying(i: ChatInputCommandInteraction) {
  const user = await who(i);
  const prefs = await lf.linked(i.user.id);
  const style = i.options.getString('style') ?? prefs?.np_style ?? 'default';
  const wantCanvas = i.options.getBoolean('canvas') ?? !!prefs?.np_canvas;
  const { tracks, total } = await lf.recent(user, 1);
  const t = tracks[0];
  if (!t) throw new LookupError(`**${user}** hasn't scrobbled anything yet.`);
  const info = await lf.trackInfo(t.artist, t.name, user).catch(() => null);
  const status = `${t.nowPlaying ? '▶ Now playing' : `Last played ${t.date ? when(t.date, 'R') : ''}`} · ${user}`;
  const stats = `${info?.userplays != null ? `${num(info.userplays)} plays · ` : ''}${num(total)} scrobbles${info?.loved || t.loved ? ' · ❤️' : ''}`;
  const canvasNote = wantCanvas ? '\n-# Spotify Canvas animations aren\'t available to bots, so this shows the album art.' : '';

  if (style === 'compact') { await i.editReply({ content: `🎵 ${trackLine(t)}${t.album ? ` · *${trunc(t.album, 50)}*` : ''} — ${status}`, allowedMentions: { parse: [] } }); return; }
  if (style === 'image') {
    const png = await nowPlayingCard({ ...t, user, plays: info?.userplays });
    await i.editReply({ content: '', files: [new AttachmentBuilder(png, { name: 'nowplaying.png' })] });
    return;
  }
  if (style === 'classic') {
    await i.editReply(card({ title: status, url: profile(user), color: RED, thumbnail: t.image ?? info?.image, fields: [['Track', `[${t.name}](${t.url})`], ['Artist', t.artist], ['Album', t.album ?? info?.album]], footer: `${stats}${info?.tags.length ? ` · ${info.tags.join(', ')}` : ''}` }));
    return;
  }
  const body = `-# ${status}\n### [${trunc(t.name, 80)}](${t.url})\n**${trunc(t.artist, 60)}**${t.album ? `\n*${trunc(t.album, 60)}*` : ''}\n-# ${stats}${canvasNote}`;
  const c = new ContainerBuilder().setAccentColor(RED);
  const img = t.image ?? info?.image;
  if (img) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(body)).setThumbnailAccessory(new ThumbnailBuilder().setURL(img)));
  else c.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  await i.editReply({ flags: MessageFlags.IsComponentsV2, components: [c], allowedMentions: { parse: [] } });
}

async function currentOrLast(user: string): Promise<lf.Track> {
  const t = (await lf.recent(user, 1)).tracks[0];
  if (!t) throw new LookupError('Nothing has been scrobbled yet.');
  return t;
}

async function loveCmd(i: ChatInputCommandInteraction, on: boolean) {
  const l = await lf.linked(i.user.id);
  if (!l) throw new LookupError('Link your Last.fm first with `/lastfm login`.');
  if (!l.session_key) throw new LookupError('Loving tracks needs the full Last.fm login — run `/lastfm login` again.');
  const typed = i.options.getString('track');
  let artist: string, track: string;
  if (typed) {
    ({ artist, track } = lf.splitTrack(typed));
    if (!artist) artist = (await lf.searchTrackArtist(track)) ?? '';
    if (!artist) throw new LookupError('I couldn\'t tell who that\'s by — write it as `Artist - Track`.');
  } else ({ artist, name: track } = await currentOrLast(l.username));
  await lf.love(l.session_key, artist, track, on);
  await i.editReply(cv2Box(`${on ? '❤️ Loved' : '💔 Unloved'} **${trunc(track, 80)}** by ${trunc(artist, 60)}.`, RED));
}

function topSub(kind: 'artists' | 'tracks' | 'albums') {
  return hsub(`lastfm top${kind}`, lookup(async i => {
    const user = await who(i);
    const period = i.options.getString('period') ?? 'overall';
    const items = await lf.top(kind, user, period, 10);
    await i.editReply(listCard(`${user}'s top ${kind} · ${period}`, items.map(x => `**${x.rank}.** [${trunc(x.name, 60)}](${x.url})${x.artist ? ` — ${trunc(x.artist, 40)}` : ''} · ${num(x.plays)} plays`), { color: RED, thumbnail: items[0]?.image, links: [{ label: 'Profile', url: profile(user) }] }));
  }));
}

export default hgroup({
  name: 'lastfm',
  subs: [
    hsub('lastfm login', login),
    hsub('lastfm logout', async i => {
      const ok = await lf.unlink(i.user.id);
      await i.reply({ ...(ok ? cv2Box('✅ Unlinked your Last.fm account.', RED) : cv2Err('❌ You haven\'t linked Last.fm.')), flags: priv });
    }),
    hsub('lastfm nowplaying', lookup(nowPlaying), { tweaks: { username: { maxLength: 15, description: 'Last.fm username (default: yours)' } } }),
    hsub('lastfm spotify', lookup(async i => {
      const t = await currentOrLast(await who(i));
      const hit = await sp.searchTracks(`${t.name} ${t.artist}`, 1).then(r => r[0]).catch(() => null);
      const url = hit?.url ?? `https://open.spotify.com/search/${encodeURIComponent(`${t.artist} ${t.name}`)}`;
      await i.editReply(card({ title: hit ? hit.name : t.name, url, color: sp.SPOTIFY_GREEN, thumbnail: hit?.image ?? t.image, description: `by **${hit?.artists.join(', ') ?? t.artist}**${hit?.album ? `\n*${hit.album}*` : ''}`,
        links: [{ label: hit?.source === 'deezer' ? 'Open on Deezer' : 'Open on Spotify', url }] }));
    }), { tweaks: { username: { maxLength: 15, description: 'Last.fm username (default: yours)' } } }),
    hsub('lastfm latest', lookup(async i => {
      const user = await who(i);
      const { tracks, total } = await lf.recent(user, 10);
      await i.editReply(listCard(`${user}'s latest scrobbles`, tracks.map(t => `${t.nowPlaying ? '▶️' : '•'} ${trackLine(t)}${t.date ? ` — ${when(t.date, 'R')}` : ''}`), { color: RED, thumbnail: tracks[0]?.image, footer: `${num(total)} scrobbles`, links: [{ label: 'Profile', url: profile(user) }] }));
    }), { tweaks: { username: { maxLength: 15 } } }),
    hsub('lastfm np-style', async i => {
      const ok = await lf.setNpStyle(i.user.id, i.options.getString('style', true), i.options.getString('canvas', true) === 'enabled');
      await i.reply({ ...(ok ? cv2Box(`✅ \`/lastfm nowplaying\` will use the **${i.options.getString('style', true)}** style.`, RED) : cv2Err('❌ Link your Last.fm first with `/lastfm login`.')), flags: priv });
    }),
    hsub('lastfm love', lookup(i => loveCmd(i, true)), { tweaks: { track: { maxLength: 200 } } }),
    hsub('lastfm unlove', lookup(i => loveCmd(i, false)), { tweaks: { track: { maxLength: 200 } } }),
    hsub('lastfm loved', lookup(async i => {
      const user = await who(i);
      const { tracks, total } = await lf.loved(user, 15);
      await i.editReply(listCard(`${user}'s loved tracks (${num(total)})`, tracks.map(t => `❤️ ${trackLine(t)}${t.date ? ` — ${when(t.date, 'R')}` : ''}`), { color: RED, links: [{ label: 'Profile', url: profile(user) }] }));
    })),
    hsub('lastfm cover', lookup(async i => {
      const user = await who(i);
      const t = await currentOrLast(user);
      const img = t.image ?? (await lf.trackInfo(t.artist, t.name).catch(() => null))?.image;
      if (!img) throw new LookupError('That track has no album art on Last.fm.');
      const big = img.replace(/\/\d+x\d+\//, '/').replace('/i/u/300x300/', '/i/u/');
      await i.editReply(card({ title: t.album ?? t.name, url: t.url, color: RED, image: big, description: `${t.name} — ${t.artist}`, links: [{ label: 'Full size', url: big }] }));
    })),
    hsub('lastfm artistplays', lookup(async i => {
      const user = await who(i);
      const a = await lf.artistPlays(i.options.getString('artist', true), user);
      await i.editReply(card({ title: a.name, url: a.url, color: RED, thumbnail: a.image, description: `**${user}** has scrobbled **${a.name}** **${num(a.userplays)}** time${a.userplays === 1 ? '' : 's'}.` }));
    }), { tweaks: { artist: { maxLength: 100 } } }),
    hsub('lastfm trackplays', lookup(async i => {
      const user = await who(i);
      const track = i.options.getString('track', true);
      const artist = i.options.getString('artist') ?? (await lf.searchTrackArtist(track));
      if (!artist) throw new LookupError('I couldn\'t find that track — add the `artist`.');
      const t = await lf.trackInfo(artist, track, user);
      await i.editReply(card({ title: `${track} — ${artist}`, url: t.url, color: RED, thumbnail: t.image, description: `**${user}** has scrobbled this **${num(t.userplays ?? 0)}** time${t.userplays === 1 ? '' : 's'}.${t.loved ? ' ❤️' : ''}` }));
    }), { tweaks: { track: { maxLength: 100 }, artist: { maxLength: 100 } } }),
    hsub('lastfm year', lookup(async i => {
      const user = await who(i);
      const year = Number(i.options.getString('year', true).trim());
      const now = new Date().getUTCFullYear();
      if (!Number.isInteger(year) || year < 2002 || year > now) throw new LookupError(`Pick a year between 2002 and ${now}.`);
      const s = await lf.yearStats(user, year);
      const list = (xs: lf.TopItem[]) => xs.map((x, n) => `${n + 1}. ${trunc(x.name, 50)}${x.artist ? ` — ${trunc(x.artist, 30)}` : ''} (${num(x.plays)})`).join('\n') || '—';
      await i.editReply(card({ title: `${user}'s ${year}`, url: profile(user), color: RED, description: `**${num(s.scrobbles)}** scrobbles`, fields: [['Top artists', list(s.artists)], ['Top tracks', list(s.tracks)], ['Top albums', list(s.albums)]] }));
    }), { tweaks: { year: { maxLength: 4 } } }),
    hsub('lastfm taste', lookup(async i => {
      const other = i.options.getUser('member', true);
      const me = await lf.linked(i.user.id), them = await lf.linked(other.id);
      if (!me) throw new LookupError('Link your Last.fm first with `/lastfm login`.');
      if (!them) throw new LookupError(`**${other.displayName ?? other.username}** hasn't linked Last.fm.`);
      const [a, b] = await Promise.all([lf.top('artists', me.username, 'overall', 100), lf.top('artists', them.username, 'overall', 100)]);
      const t = lf.tasteScore(a, b);
      await i.editReply(card({ title: `${me.username} × ${them.username}`, color: RED, description: `## ${t.score}% taste match\n${t.shared.length} artists in common (of each other's top 100).`,
        fields: [['Shared favourites', t.shared.slice(0, 10).map(x => `• **${trunc(x.name, 40)}** — ${num(x.a)} vs ${num(x.b)} plays`).join('\n') || 'None 😶']] }));
    })),
    topSub('artists'), topSub('tracks'), topSub('albums'),
    hsub('lastfm collage', lookup(async i => {
      const user = await who(i);
      const n = Number((i.options.getString('size') ?? '3×3')[0]) as 3 | 4 | 5;
      const period = i.options.getString('period') ?? '7 days';
      const items = await lf.top('albums', user, period, n * n);
      if (!items.length) throw new LookupError('No albums scrobbled in that period.');
      const png = await collage(items, n);
      await i.editReply({ ...card({ title: `${user}'s ${n}×${n} · ${period}`, url: profile(user), color: RED, image: 'attachment://collage.png' }), files: [new AttachmentBuilder(png, { name: 'collage.png' })] });
    })),
  ],
});
