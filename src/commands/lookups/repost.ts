import { defineLeaf } from '../../framework/group.js';
import { uploadLimit } from '../../framework/media.js';
import { lookup } from '../../lookups/handler.js';
import { noTranslation, sendRepost, sendRepostFast } from '../../lookups/repost.js';
import { repostLink } from '../../lookups/repostlink.js';

/** /repost <url> — the repost card for a link from any site Bestow can read (see lookups/repostlink.ts). */
export default defineLeaf({
  name: 'repost',
  description: 'Repost a post from X, Instagram, TikTok, Bluesky, Threads, Facebook, Reddit, Mastodon and more',
  options: b => b
    .addStringOption(o => o.setName('url').setDescription('A link to the post').setRequired(true).setMaxLength(500))
    .addBooleanOption(o => o.setName('translate').setDescription('Translate the post into your Discord language when it\'s in another (default: yes)')),
  run: lookup(async i => {
    const r = await repostLink(i.options.getString('url', true), { maxBytes: Math.floor(uploadLimit(i) * 0.95) });
    const links = { open: r.open, authorUrl: r.post.author.url };
    const o = i.options.getBoolean('translate') === false ? { translate: noTranslation } : {};
    if (r.quick) await sendRepostFast(i, r.post, links, o);
    else await sendRepost(i, r.post, links, o);
  }),
});
