import { AttachmentBuilder } from 'discord.js';
import { hleaf } from '../../framework/heist.js';
import { mediaHandler, uploadLimit } from '../../framework/media.js';
import { makeVoiceMessage, sendVoiceMessage } from '../../framework/voicemessage.js';
import { card, compact, trunc, when } from '../../lookups/card.js';
import { soundcloud } from '../../media/download.js';

const ORANGE = 0xff5500;
const dur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : null);

export default hleaf('soundcloud', mediaHandler(async i => {
  const { info, data } = await soundcloud(i.options.getString('query', true), { maxBytes: Math.floor(uploadLimit(i) * 0.95) });
  const withStats = (i.options.getString('stats') ?? 'Yes') === 'Yes';
  const meta = info as typeof info & { duration?: number; repost_count?: number };
  const name = `${info.uploader ?? 'soundcloud'} - ${info.title ?? 'track'}`.replace(/[^\w\- ]+/g, '').slice(0, 60) || 'track';
  if (i.options.getBoolean('voicemessage')) {
    const vm = await makeVoiceMessage(data, 'mp3').catch(() => null);
    if (vm && (await sendVoiceMessage(i, vm))) { await i.deleteReply().catch(() => {}); return; }
  }
  await i.editReply({
    ...card({
      title: trunc(info.title ?? 'SoundCloud track', 100), url: info.webpage_url, color: ORANGE, thumbnail: info.thumbnail, description: info.uploader ? `by **${info.uploader}**` : undefined,
      fields: withStats ? [['Plays', info.view_count != null ? compact(info.view_count) : null], ['Likes', info.like_count != null ? compact(info.like_count) : null], ['Reposts', meta.repost_count != null ? compact(meta.repost_count) : null],
        ['Comments', info.comment_count != null ? compact(info.comment_count) : null], ['Length', dur(meta.duration)], ['Posted', info.timestamp ? when(info.timestamp * 1000) : null]] : [],
    }),
    files: [new AttachmentBuilder(data, { name: `${name}.mp3` })],
  });
}), { tweaks: { query: { maxLength: 300 } } });
