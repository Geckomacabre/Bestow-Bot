import { AttachmentBuilder, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { getBufferPublic } from '../../framework/http.js';
import { sendPages } from '../../framework/pages.js';
import { card, trunc } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import * as sp from '../../music/spotify.js';

const G = sp.SPOTIFY_GREEN;
const q = { query: { maxLength: 200 } };
const src = (t: { source: string }) => (t.source === 'deezer' ? ' · via Deezer' : '');

export default hgroup({
  name: 'spotify',
  subs: [
    hsub('spotify search', lookup(async i => {
      const hits = await sp.searchTracks(i.options.getString('query', true), 10);
      if (!hits.length) throw new LookupError('No songs found.');
      await sendPages(i, hits.map((t, n) => {
        const text = `### [${trunc(t.name, 80)}](${t.url})${t.explicit ? ' 🅴' : ''}\n**${trunc(t.artists.join(', '), 80)}**\n*${trunc(t.album, 80)}*\n-# ${n + 1} of ${hits.length} · ${sp.fmtMs(t.durationMs)}${t.releaseDate ? ` · ${t.releaseDate.slice(0, 4)}` : ''}${src(t)}`;
        const c = new ContainerBuilder().setAccentColor(G);
        if (t.image) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)).setThumbnailAccessory(new ThumbnailBuilder().setURL(t.image)));
        else c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        return { container: c };
      }));
    }), { tweaks: q }),
    hsub('spotify album', lookup(async i => {
      const a = await sp.album(i.options.getString('query', true));
      const lines = a.tracks.slice(0, 30).map(t => `\`${String(t.n).padStart(2)}\` ${trunc(t.name, 60)}${t.explicit ? ' 🅴' : ''} · ${sp.fmtMs(t.durationMs)}`);
      await i.editReply(card({
        title: a.name, url: a.url, color: G, thumbnail: a.image, description: `by **${a.artists.join(', ')}**\n\n${lines.join('\n')}${a.tracks.length > 30 ? `\n…and ${a.tracks.length - 30} more` : ''}`,
        fields: [['Released', a.releaseDate], ['Tracks', String(a.totalTracks)], ['Label', a.label]], footer: a.source === 'deezer' ? 'via Deezer' : undefined,
        links: [{ label: a.source === 'deezer' ? 'Open on Deezer' : 'Open on Spotify', url: a.url }],
      }));
    }), { tweaks: q }),
    hsub('spotify cover', lookup(async i => {
      const t = await sp.firstTrack(i.options.getString('query', true));
      if (!t.image) throw new LookupError('That track has no cover art.');
      await i.editReply(card({ title: t.album, url: t.url, color: G, image: t.image, description: `${t.name} — ${t.artists.join(', ')}`, links: [{ label: 'Full size', url: t.image }] }));
    }), { tweaks: q }),
    hsub('spotify preview', lookup(async i => {
      const t = await sp.firstTrack(i.options.getString('query', true));
      const url = await sp.previewUrl(t);
      if (!url) throw new LookupError('There\'s no 30-second preview for that track.');
      const mp3 = await getBufferPublic(url, { maxBytes: 3 * 1024 * 1024 });
      const name = `${t.artists[0]} - ${t.name}`.replace(/[^\w\- ]+/g, '').slice(0, 60) || 'preview';
      await i.editReply({ ...card({ title: `▶️ ${t.name}`, url: t.url, color: G, thumbnail: t.image, description: `**${t.artists.join(', ')}** · *${trunc(t.album, 60)}*`, footer: '30-second preview' }), files: [new AttachmentBuilder(mp3, { name: `${name}.mp3` })] });
    }), { tweaks: q }),
  ],
});
