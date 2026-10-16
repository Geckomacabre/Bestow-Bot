import { describe, expect, test } from 'bun:test';
import { blueskyPost, expandLinks, parseBskyUrl, pdsOf, type BskyGet, type BskyPostView } from '../src/lookups/bluesky';
import { facebedPage, facebookPost, parseFacebookUrl, unescapeMd } from '../src/lookups/facebook';
import { LookupError } from '../src/lookups/handler';
import { fediPost, fediversePost, parseFediUrl, type FediStatus } from '../src/lookups/mastodon';
import { parseRedditUrl, redditPost, redditRepost, type RedditPostData } from '../src/lookups/reddit';
import { googleTranslator, noTranslation, repostCard, sendRepost, sendRepostFast, statsLine, type RepostPost, type Translator } from '../src/lookups/repost';
import { READERS, repostLink } from '../src/lookups/repostlink';
import { parseThreadsUrl, threadsFromPage, threadsRepost } from '../src/lookups/threads';
import { fakeInteraction, textOf } from './fakeInteraction';
import { FACEBED } from './repost.fixtures';

const post = (over: Partial<RepostPost> = {}): RepostPost => ({
  site: 'X', color: 0, url: 'https://x.com/a/status/1', author: { name: 'A', handle: 'a' }, text: 'こんにちは世界', stats: [], media: [], ...over,
});

describe('reposts are translated into the reader\'s language', () => {
  const google = (detected: string, text = 'Hello world') => {
    const calls: string[] = [];
    return { calls, tr: googleTranslator(async (q, to) => { calls.push(`${to}:${q}`); return { text, detected }; }) };
  };

  test('a post in another language comes back translated, with the language it was in', async () => {
    const g = google('ja');
    expect(await g.tr(post(), 'en')).toEqual({ text: 'Hello world', from: 'ja' });
    expect(g.calls).toEqual(['en:こんにちは世界']);
  });

  test('nothing is sent for a post that says it is in the reader\'s language, or has no words in it', async () => {
    const g = google('ja');
    expect(await g.tr(post({ lang: 'en' }), 'en')).toBeNull();
    expect(await g.tr(post({ text: 'https://example.com @someone #tag 🔥 2026!' }), 'en')).toBeNull();
    expect(await g.tr(post({ text: undefined }), 'en')).toBeNull();
    expect(g.calls).toEqual([]);
  });

  test('a post Google finds is already in the reader\'s language (any variety of it), or a failure, gives no translation', async () => {
    expect(await google('en').tr(post({ text: 'Hello there' }), 'en')).toBeNull();
    expect(await google('zh-TW').tr(post({ text: '你好世界' }), 'zh-CN')).toBeNull();
    expect(await googleTranslator(async () => { throw new Error('down'); })(post(), 'en')).toBeNull();
  });

  test('REPOST_TRANSLATE=off turns it off', async () => {
    const g = google('ja');
    Bun.env.REPOST_TRANSLATE = 'off';
    try { expect(await g.tr(post(), 'en')).toBeNull(); } finally { delete Bun.env.REPOST_TRANSLATE; }
    expect(g.calls).toEqual([]);
  });

  test('the card shows the original, then the translation quoted under the language it came from', () => {
    const out = textOf(repostCard(post({ text: 'こんにちは\n世界' }), { files: [], items: [], skipped: [] }, { open: 'Open on X' }, { text: 'Hello\nworld', from: 'ja' }));
    expect(out).toContain('こんにちは\n世界\n-# 🌐 Translated from Japanese\n> Hello\n> world');
  });

  test('the translation is made in the language the invoker reads Discord in, alongside the media download', async () => {
    const fi = fakeInteraction({ guildId: null });
    (fi.interaction as { locale?: string }).locale = 'pt-BR';
    const asked: string[] = [];
    await sendRepost(fi.interaction, post(), { open: 'Open on X' }, { translate: async (_p, to) => { asked.push(to); return { text: 'Olá mundo', from: 'ja' }; } });
    expect(asked).toEqual(['pt']); expect(textOf(fi.sent[0])).toContain('> Olá mundo');
  });

  test('the quick card waits briefly for its translation; one that comes later is added afterwards', async () => {
    const links = { open: 'Open on X' };
    const fast = fakeInteraction({ guildId: null });
    await (await sendRepostFast(fast.interaction, post(), links, { translate: async () => ({ text: 'Hi', from: 'ja' }), attach: async () => ({ files: [], items: [], attached: 0 }) })).persisted;
    expect(fast.sent).toHaveLength(1); expect(textOf(fast.sent[0])).toContain('> Hi');

    const slow = fakeInteraction({ guildId: null });
    const gate = Promise.withResolvers<void>();
    const slowTr: Translator = async () => { await gate.promise; return { text: 'Hi', from: 'ja' }; };
    const { persisted } = await sendRepostFast(slow.interaction, post(), links, { translate: slowTr, waitMs: 5, attach: async () => ({ files: [], items: [], attached: 0 }) });
    expect(slow.sent).toHaveLength(1); expect(textOf(slow.sent[0])).not.toContain('Translated');
    gate.resolve(); await persisted;
    expect(slow.sent).toHaveLength(2); expect(textOf(slow.sent[1])).toContain('> Hi');
  });

  test('/repost translate:false leaves the post as it is', async () => {
    expect(await noTranslation(post(), 'en')).toBeNull();
  });
});

describe('Bluesky', () => {
  const did = 'did:plc:z72i7hdynmk6r22z27h6tvur';
  const short = 'example.com/some-lo...', text = `こんにちは! ${short} 🎉`;
  const start = Buffer.byteLength('こんにちは! '), end = start + Buffer.byteLength(short);
  const view = (embed: BskyPostView['embed'], over: Partial<BskyPostView> = {}): BskyPostView => ({
    uri: `at://${did}/app.bsky.feed.post/3lh5abcde2k2z`,
    author: { did, handle: 'bsky.app', displayName: 'Bluesky', avatar: 'https://cdn.bsky.app/img/avatar/plain/x/y@jpeg', verification: { verifiedStatus: 'valid' } },
    record: { text, createdAt: '2026-10-01T12:00:00.000Z', langs: ['ja'], facets: [{ index: { byteStart: start, byteEnd: end }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/some-long-path' }] }] },
    embed, replyCount: 12, repostCount: 34, likeCount: 5678, quoteCount: 2, bookmarkCount: 9, ...over,
  });
  const images = { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/x/1@jpeg', fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/x/1@jpeg' }, { fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/x/2@jpeg' }] };
  const video = { $type: 'app.bsky.embed.video#view', cid: 'bafkreivideo', playlist: 'https://video.bsky.app/watch/x/bafkreivideo/playlist.m3u8', thumbnail: 'https://video.bsky.app/watch/x/bafkreivideo/thumbnail.jpg' };
  const api = (answers: Record<string, unknown>) => {
    const seen: string[] = [];
    const get: BskyGet = async url => { seen.push(url); if (!(url in answers)) throw new Error(`not stubbed: ${url}`); return answers[url]; };
    return { get, seen };
  };
  const RESOLVE = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=bsky.app';
  const POSTS = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(`at://${did}/app.bsky.feed.post/3lh5abcde2k2z`)}`;

  test('post links, by handle or by DID', () => {
    expect(parseBskyUrl('https://bsky.app/profile/bsky.app/post/3lh5abcde2k2z')).toEqual({ actor: 'bsky.app', rkey: '3lh5abcde2k2z' });
    expect(parseBskyUrl(`https://bsky.app/profile/${did}/post/3lh5abcde2k2z?ref=x`)).toEqual({ actor: did, rkey: '3lh5abcde2k2z' });
    for (const bad of ['https://bsky.app/profile/bsky.app', 'https://evil.com/profile/a.b/post/x', 'https://bsky.app/profile/not a handle/post/3l']) expect(parseBskyUrl(bad), bad).toBeNull();
  });

  test('shortened links in the text are written out in full (the facets count UTF-8 bytes)', () => {
    expect(expandLinks(text, view(undefined).record.facets)).toBe('こんにちは! https://example.com/some-long-path 🎉');
    expect(expandLinks('abc', [{ index: { byteStart: 1, byteEnd: 99 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://x' }] }])).toBe('abc'); // out of range: left alone
  });

  test('a post with photos: author (verified), text, language, time, counts and the full-size photos', async () => {
    const a = api({ [RESOLVE]: { did }, [POSTS]: { posts: [view(images)] } });
    const p = await blueskyPost('https://bsky.app/profile/bsky.app/post/3lh5abcde2k2z', a.get);
    expect(a.seen).toEqual([RESOLVE, POSTS]); // no DID document needed without a video
    expect(p.author).toMatchObject({ name: 'Bluesky', handle: 'bsky.app', verified: true, url: 'https://bsky.app/profile/bsky.app' });
    expect(p.text).toBe('こんにちは! https://example.com/some-long-path 🎉'); expect(p.lang).toBe('ja');
    expect(p.createdAt).toBe(Date.parse('2026-10-01T12:00:00Z'));
    expect(statsLine(p.stats)).toBe('♡ 5.7k · 💬 12 · 🔁 34 · 🔖 9 · 2 quotes');
    expect(p.media.map(m => m.url)).toEqual(images.images.map(i => i.fullsize));
    expect(p.url).toBe('https://bsky.app/profile/bsky.app/post/3lh5abcde2k2z');
  });

  test('a video is linked as the uploaded MP4 on the poster\'s own server, found through their DID document', async () => {
    const a = api({ [POSTS]: { posts: [view(video, { labels: [{ val: 'graphic-media' }] })] }, [`https://plc.directory/${did}`]: { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://morel.us-east.host.bsky.network' }] } });
    const p = await blueskyPost(`https://bsky.app/profile/${did}/post/3lh5abcde2k2z`, a.get);
    expect(p.media).toEqual([{ type: 'video', url: `https://morel.us-east.host.bsky.network/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=bafkreivideo`, thumb: video.thumbnail }]);
    expect(p.sensitive).toBe(true);
  });

  test('a did:web document is fetched as a user-given address, and a server that isn\'t https is refused', async () => {
    const asked: [string, boolean | undefined][] = [];
    expect(await pdsOf('did:web:example.com', async (u, user) => { asked.push([u, user]); return { service: [{ id: '#atproto_pds', serviceEndpoint: 'http://10.0.0.1' }] }; })).toBeNull();
    expect(asked).toEqual([['https://example.com/.well-known/did.json', true]]);
  });

  test('a missing post, and a GIF from the picker', async () => {
    await expect(blueskyPost(`https://bsky.app/profile/${did}/post/3lh5abcde2k2z`, api({ [POSTS]: { posts: [] } }).get)).rejects.toBeInstanceOf(LookupError);
    const gif = { $type: 'app.bsky.embed.external#view', external: { uri: 'https://media.tenor.com/abc/cat.gif?hh=200&ww=300', title: 'cat' } };
    const p = await blueskyPost(`https://bsky.app/profile/${did}/post/3lh5abcde2k2z`, api({ [POSTS]: { posts: [view(gif)] } }).get);
    expect(p.media).toEqual([{ type: 'image', url: gif.external.uri }]);
  });
});

describe('Mastodon and the fediverse', () => {
  const status: FediStatus = {
    url: 'https://mastodon.social/@Gargron/113000000000000001', created_at: '2026-10-10T10:00:00.000Z', language: 'de', sensitive: false, spoiler_text: '',
    replies_count: 5, reblogs_count: 6, favourites_count: 70,
    content: '<p>Hallo Welt! <a href="https://example.com/x" rel="nofollow noopener" target="_blank"><span class="invisible">https://</span><span class="">example.com/x</span><span class="invisible"></span></a></p><p>Zweite &amp; Zeile<br />dritte</p>',
    account: { username: 'Gargron', acct: 'Gargron', display_name: 'Eugen :verified:', avatar: 'https://files.mastodon.social/a.jpg', url: 'https://mastodon.social/@Gargron', emojis: [{ shortcode: 'verified' }] },
    media_attachments: [{ type: 'image', url: 'https://files.mastodon.social/a.png', preview_url: 'https://files.mastodon.social/s.png' }, { type: 'audio', url: 'https://files.mastodon.social/a.mp3' }, { type: 'gifv', url: 'https://files.mastodon.social/g.mp4' }],
  };

  test('post links on any server, in Mastodon\'s, Pleroma\'s and Truth Social\'s shapes', () => {
    expect(parseFediUrl('https://mastodon.social/@Gargron/113000000000000001')).toEqual({ host: 'mastodon.social', id: '113000000000000001' });
    expect(parseFediUrl('https://hachyderm.io/users/someone/statuses/123')).toEqual({ host: 'hachyderm.io', id: '123' });
    expect(parseFediUrl('https://truthsocial.com/@user/posts/456')).toEqual({ host: 'truthsocial.com', id: '456' });
    expect(parseFediUrl('https://pleroma.site/notice/AbC123')).toEqual({ host: 'pleroma.site', id: 'AbC123' });
    for (const bad of ['https://mastodon.social/@Gargron', 'http://mastodon.social/@a/1', 'https://u:p@mastodon.social/@a/1', 'https://medium.com/@a/some-story-1a2b3c']) expect(parseFediUrl(bad), bad).toBeNull();
  });

  test('a status: name without custom emoji, full handle, text with whole links, language, counts, and photos and GIFs (not audio)', () => {
    const p = fediPost(status, 'mastodon.social')!;
    expect(p.author).toMatchObject({ name: 'Eugen', handle: 'Gargron@mastodon.social', avatar: 'https://files.mastodon.social/a.jpg' });
    expect(p.text).toBe('Hallo Welt! https://example.com/x\n\nZweite & Zeile\ndritte'); expect(p.lang).toBe('de');
    expect(statsLine(p.stats)).toBe('♡ 70 · 💬 5 · 🔁 6');
    expect(p.media.map(m => m.type)).toEqual(['image', 'video']);
    expect(p.site).toBe('mastodon.social');
  });

  test('a boost shows the boosted post; a content warning is kept and hides the media', () => {
    const boosted = fediPost({ ...status, content: '', account: { username: 'x', acct: 'x' }, reblog: { ...status, spoiler_text: 'spoilers', account: { ...status.account!, acct: 'friend@other.social' } } }, 'mastodon.social')!;
    expect(boosted.author.handle).toBe('friend@other.social'); expect(boosted.text).toStartWith('⚠️ spoilers\n\nHallo Welt!'); expect(boosted.sensitive).toBe(true);
  });

  test('the server named in the link is only contacted at a public address', async () => {
    const err = await fediversePost('https://localhost/@a/123').catch(e => e);
    expect(err).toBeInstanceOf(LookupError);
    const asked: string[] = [];
    await fediversePost('https://mastodon.social/@Gargron/113000000000000001', async u => { asked.push(u); return status; });
    expect(asked).toEqual(['https://mastodon.social/api/v1/statuses/113000000000000001']);
  });
});

describe('Reddit', () => {
  const base: RedditPostData = { id: 'abc123', title: 'My cat', author: 'spez', subreddit: 'cats', permalink: '/r/cats/comments/abc123/my_cat/', created_utc: 1760000000, score: 4321, num_comments: 87 };

  test('post, comment, gallery, short and share links', () => {
    expect(parseRedditUrl('https://www.reddit.com/r/cats/comments/abc123/my_cat/')).toEqual({ id: 'abc123' });
    expect(parseRedditUrl('https://old.reddit.com/r/cats/comments/abc123/my_cat/def456/')).toEqual({ id: 'abc123' });
    expect(parseRedditUrl('https://redd.it/abc123')).toEqual({ id: 'abc123' });
    expect(parseRedditUrl('https://www.reddit.com/gallery/abc123')).toEqual({ id: 'abc123' });
    expect(parseRedditUrl('https://www.reddit.com/r/cats/s/AbCdEf123')).toEqual({ share: 'https://www.reddit.com/r/cats/s/AbCdEf123' });
    for (const bad of ['https://www.reddit.com/r/cats/', 'https://reddit.com.evil.com/r/a/comments/abc123/', 'http://www.reddit.com/r/a/comments/abc123/']) expect(parseRedditUrl(bad), bad).toBeNull();
  });

  test('a photo post: the subreddit, u/author, the title and text, score and comments', () => {
    const p = redditPost({ ...base, selftext: '', post_hint: 'image', url: 'https://i.redd.it/x.jpg' });
    expect(p.author).toMatchObject({ name: 'r/cats', byline: 'u/spez', url: 'https://www.reddit.com/user/spez/' });
    expect(p.text).toBe('**My cat**'); expect(p.media).toEqual([{ type: 'image', url: 'https://i.redd.it/x.jpg' }]);
    expect(statsLine(p.stats)).toBe('⬆️ 4.3k · 💬 87'); expect(p.url).toBe('https://www.reddit.com/r/cats/comments/abc123/my_cat/');
    expect(textOf(repostCard(p, { files: [], items: [], skipped: [] }, { open: 'Open on Reddit' }))).toContain('### r/cats\nu/spez • <t:1760000000:R>');
  });

  test('a gallery, in its order, with animated items as video; NSFW is hidden', () => {
    const p = redditPost({ ...base, over_18: true, is_gallery: true, gallery_data: { items: [{ media_id: 'a' }, { media_id: 'b' }] }, media_metadata: { a: { e: 'Image', s: { u: 'https://preview.redd.it/a.jpg' } }, b: { e: 'AnimatedImage', s: { gif: 'https://i.redd.it/b.gif', mp4: 'https://preview.redd.it/b.mp4' } } } });
    expect(p.media).toEqual([{ type: 'image', url: 'https://preview.redd.it/a.jpg' }, { type: 'gif', url: 'https://preview.redd.it/b.mp4' }]); expect(p.sensitive).toBe(true);
  });

  test('a video with sound asks for a download (the silent stream stays as the fallback); one without plays as it is', () => {
    const v = (has_audio: boolean) => redditPost({ ...base, is_video: true, media: { reddit_video: { fallback_url: 'https://v.redd.it/x/DASH_720.mp4', has_audio } } });
    expect(v(true)).toMatchObject({ needsDownload: true, media: [{ type: 'video', url: 'https://v.redd.it/x/DASH_720.mp4' }] });
    expect(v(false).needsDownload).toBe(false);
  });

  test('a text post keeps its link and text; a crosspost shows the original\'s media', () => {
    expect(redditPost({ ...base, is_self: false, url: 'https://example.com/article', selftext: '' }).text).toBe('**My cat**\n\nhttps://example.com/article');
    expect(redditPost({ ...base, crosspost_parent_list: [{ id: 'zzz', post_hint: 'image', url: 'https://i.redd.it/orig.png' }] }).media[0]!.url).toBe('https://i.redd.it/orig.png');
  });

  test('a share link is followed to its post; a refusal names the fix', async () => {
    const asked: string[] = [];
    const p = await redditRepost('https://www.reddit.com/r/cats/s/AbCdEf123', {
      follow: async () => '/r/cats/comments/abc123/my_cat/?share_id=1', get: async path => { asked.push(path); return [{ data: { children: [{ data: { ...base, selftext: 'hi' } }] } }]; },
    });
    expect(asked).toEqual(['/comments/abc123?raw_json=1&limit=1']); expect(p.text).toBe('**My cat**\n\nhi');
    const { HttpError } = await import('../src/framework/http');
    const err = await redditRepost('https://redd.it/abc123', { get: async () => { throw new HttpError(403, 'x'); } }).catch(e => e);
    expect(err.message).toContain('REDDIT_CLIENT_ID');
  });
});

describe('Facebook (facebed)', () => {
  const page = (json: string) => `<html><head><meta property="og:title" content="x"/>\n<script id="discord:component-embed" type="application/json">${json}</script>\n</head></html>`;

  test('links facebed takes, and fb.watch short links', () => {
    expect(parseFacebookUrl('https://www.facebook.com/cafelumiere/posts/pfbid0abc')).toEqual({ path: 'cafelumiere/posts/pfbid0abc' });
    expect(parseFacebookUrl('https://m.facebook.com/story.php?story_fbid=1&id=2')).toEqual({ path: 'story.php?story_fbid=1&id=2' });
    expect(parseFacebookUrl('https://fb.watch/abcDEF123/')).toEqual({ short: 'https://fb.watch/abcDEF123/' });
    for (const bad of ['https://www.facebook.com/', 'https://facebook.com.evil.com/x/posts/1', 'http://www.facebook.com/x/posts/1']) expect(parseFacebookUrl(bad), bad).toBeNull();
  });

  test('facebed\'s markdown escapes come off, and its hashtag links become hashtags again', () => {
    expect(unescapeMd('Caf\\* \\[x\\] [#my\\_tag](https://www.facebook.com/hashtag/my_tag)\n\\> quote\n\\1. one')).toBe('Caf* [x] #my_tag\n> quote\n1. one');
  });

  test('a page\'s post: name (verified), avatar, caption, photos and a video in order, exact counts and time', () => {
    const p = facebedPage(page(FACEBED.photos), 'https://www.facebook.com/x')!;
    expect(p.author).toMatchObject({ name: 'Café *Lumière* [Paris]', url: 'https://www.facebook.com/cafelumiere', avatar: 'https://facebed.com/m/1234567890/a.jpg', verified: true });
    expect(p.text).toBe('Nouveau menu ce week-end ! #brunch #paris\nRéservez : https://example.com/r?a=1_b');
    expect(p.media.map(m => `${m.type} ${m.url}`)).toEqual(['image https://facebed.com/m/1234567890/0.jpg', 'image https://facebed.com/m/1234567890/1.jpg', 'video https://facebed.com/m/1234567890/2.mp4']);
    expect(p.stats.map(s => s.value)).toEqual([1234, 56, 7]); expect(p.createdAt).toBe(1760000000 * 1000);
    expect(p.url).toBe('https://www.facebook.com/cafelumiere/posts/pfbid0abc');
  });

  test('a group post that shares another: the group under the name, the shared post quoted, its media not taken as the post\'s', () => {
    const p = facebedPage(page(FACEBED.group), 'https://www.facebook.com/x')!;
    expect(p.author).toMatchObject({ name: 'Jane Doe', byline: '👥 Neighbours of Elm St', url: 'https://www.facebook.com/groups/123' });
    expect(p.text).toBe('Lost cat near the park - > call me\n\n🔁 Shared from **City News**\n> Road closed today');
    expect(p.media).toEqual([]); expect(p.stats.map(s => s.value)).toEqual([3, undefined, 0]);
  });

  test('a reel with no caption or counts', () => {
    const p = facebedPage(page(FACEBED.reel), 'https://www.facebook.com/reel/555')!;
    expect(p.text).toBeUndefined(); expect(p.createdAt).toBeUndefined(); expect(p.media).toEqual([{ type: 'video', url: 'https://facebed.com/m/f555/0.mp4' }]);
  });

  test('without the card, the Open Graph tags; facebed\'s "log in" page is no post', async () => {
    const og = '<meta property="og:title" content="Some Page"/><meta property="og:description" content="Hi &amp; bye"/><meta property="og:url" content="https://www.facebook.com/reel/1"/><meta property="og:video" content="https://video.xx.fbcdn.net/v.mp4"/>';
    expect(facebedPage(og, 'x')).toMatchObject({ author: { name: 'Some Page' }, text: 'Hi & bye', media: [{ type: 'video', url: 'https://video.xx.fbcdn.net/v.mp4' }] });
    const login = '<meta property="og:title" content="Log in or sign up to view"/><meta property="og:description" content="See posts, photos and more on Facebook."/>';
    await expect(facebookPost('https://www.facebook.com/x/posts/1', { get: async () => login })).rejects.toThrow('without a login');
  });

  test('the post is asked of facebed by its path', async () => {
    const asked: string[] = [];
    await facebookPost('https://www.facebook.com/cafelumiere/posts/pfbid0abc', { get: async u => { asked.push(u); return page(FACEBED.photos); } });
    expect(asked).toEqual(['https://facebed.com/cafelumiere/posts/pfbid0abc']);
  });
});

describe('Threads', () => {
  const media = {
    code: 'DAbCdEf1234', taken_at: 1760000000, like_count: 1500, caption: { text: 'Bonjour à tous' },
    text_post_app_info: { direct_reply_count: 20, repost_count: 3, quote_count: 0 },
    user: { username: 'zuck', profile_pic_url: 'https://scontent.cdninstagram.com/p.jpg', is_verified: true },
    image_versions2: { candidates: [] }, video_versions: null,
    carousel_media: [
      { image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/small.jpg', width: 320 }, { url: 'https://scontent.cdninstagram.com/big.jpg', width: 1440 }] }, video_versions: null },
      { image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/cover.jpg', width: 720 }] }, video_versions: [{ url: 'https://scontent.cdninstagram.com/v.mp4' }] },
    ],
  };
  const sjs = (data: unknown) => `<script type="application/json" data-content-len="1" data-sjs>${JSON.stringify(data)}</script>`;
  const html = `<html><head></head><body>${sjs({ require: [['other', { code: 'DAbCdEf1234' }]] })}${sjs({ require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { result: { data: { data: { edges: [{ node: { thread_items: [{ post: media }] } }] } } } } }]]] })}</body></html>`;

  test('post links on threads.net and threads.com', () => {
    expect(parseThreadsUrl('https://www.threads.net/@zuck/post/DAbCdEf1234')).toEqual({ user: 'zuck', code: 'DAbCdEf1234' });
    expect(parseThreadsUrl('https://www.threads.com/@zuck/post/DAbCdEf1234/media?x=1')).toEqual({ user: 'zuck', code: 'DAbCdEf1234' });
    expect(parseThreadsUrl('https://threads.com/t/DAbCdEf1234')).toEqual({ code: 'DAbCdEf1234' });
    expect(parseThreadsUrl('https://www.threads.com/@zuck')).toBeNull();
  });

  test('the post in the page\'s data: author (verified), caption, counts, time, and each carousel item at its best size', () => {
    const p = threadsFromPage(html, { code: 'DAbCdEf1234' })!;
    expect(p.author).toMatchObject({ name: 'zuck', handle: 'zuck', verified: true, avatar: 'https://scontent.cdninstagram.com/p.jpg' });
    expect(p.text).toBe('Bonjour à tous'); expect(p.createdAt).toBe(1760000000 * 1000);
    expect(statsLine(p.stats)).toBe('♡ 1.5k · 💬 20 · 🔁 3');
    expect(p.media).toEqual([{ type: 'image', url: 'https://scontent.cdninstagram.com/big.jpg' }, { type: 'video', url: 'https://scontent.cdninstagram.com/v.mp4', thumb: 'https://scontent.cdninstagram.com/cover.jpg' }]);
  });

  test('without the data, the Open Graph tags give the author and text (and a photo only when the card is a large one)', () => {
    const og = (card: string) => `<meta property="og:title" content="Mark Zuckerberg (@zuck) on Threads"><meta property="og:description" content="Hi &amp; hello"><meta property="og:image" content="https://scontent.cdninstagram.com/i.jpg"><meta name="twitter:card" content="${card}">`;
    expect(threadsFromPage(og('summary'), { code: 'DAbCdEf1234' })).toMatchObject({ author: { name: 'Mark Zuckerberg', handle: 'zuck' }, text: 'Hi & hello', media: [] });
    expect(threadsFromPage(og('summary_large_image'), { code: 'DAbCdEf1234' })!.media).toHaveLength(1);
  });

  test('a login page is reported plainly', async () => {
    await expect(threadsRepost('https://www.threads.com/@zuck/post/DAbCdEf1234', async () => ({ html: '<html></html>', url: 'https://www.threads.com/login/?next=x' }))).rejects.toThrow('login');
  });
});

describe('/repost picks the reader from the link', () => {
  const site = (link: string) => { const u = new URL(link); return READERS.find(r => r.test(u.hostname, u))?.site ?? null; };

  test('every supported site, and nothing else', () => {
    const cases: [string, string | null][] = [
      ['https://x.com/a/status/1', 'X'], ['https://mobile.twitter.com/a/status/1', 'X'], ['https://www.instagram.com/p/abc/', 'Instagram'], ['https://vm.tiktok.com/ZM1/', 'TikTok'],
      ['https://bsky.app/profile/a.b/post/3l', 'Bluesky'], ['https://www.threads.com/@a/post/abcde', 'Threads'], ['https://m.facebook.com/a/posts/1', 'Facebook'], ['https://fb.watch/abc/', 'Facebook'],
      ['https://old.reddit.com/r/a/comments/abc123/', 'Reddit'], ['https://redd.it/abc123', 'Reddit'], ['https://youtu.be/abc', 'YouTube'], ['https://clips.twitch.tv/abc', 'Twitch'],
      ['https://medal.tv/games/x/clips/1', 'Medal'], ['https://mastodon.social/@a/123', 'Mastodon'], ['https://instagram.com.evil.com/p/abc/', null], ['https://example.com/article', null],
    ];
    for (const [link, want] of cases) expect(site(link), link).toBe(want);
  });

  test('the post comes back with its button label; http is upgraded; an unknown site lists the ones that work', async () => {
    const seen: string[] = [];
    const readers = [{ site: 'Bluesky', test: (h: string) => h === 'bsky.app', read: async (l: string) => { seen.push(l); return { post: post({ site: 'Bluesky' }), quick: true }; } }];
    const r = await repostLink('http://bsky.app/profile/a.b/post/3l', { maxBytes: 1, readers });
    expect(seen).toEqual(['https://bsky.app/profile/a.b/post/3l']); expect(r.open).toBe('Open on Bluesky'); expect(r.quick).toBe(true);
    const err = await repostLink('https://example.com/x', { maxBytes: 1 }).catch(e => e);
    expect(err).toBeInstanceOf(LookupError); expect(err.message).toContain('Bluesky'); expect(err.message).toContain('Reddit');
    await expect(repostLink('not a link', { maxBytes: 1 })).rejects.toBeInstanceOf(LookupError);
  });
});
