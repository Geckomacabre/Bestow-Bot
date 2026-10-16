import { downloadPost, type Runner } from '../media/download.js';
import { blueskyPost } from './bluesky.js';
import { facebookPost } from './facebook.js';
import { LookupError } from './handler.js';
import { instagramRepost } from './instaloader.js';
import { fediversePost, parseFediUrl } from './mastodon.js';
import { redditRepost } from './reddit.js';
import { ytdlpPost, type RepostPost } from './repost.js';
import { threadsRepost } from './threads.js';
import { tiktokRepost } from './tiktok.js';
import { xPost } from './x.js';

/**
 * /repost: one command for a link from any site Bestow can repost. The link's site picks the reader (the same ones /x, /instagram and
 * /tiktok repost use, plus Bluesky, Threads, Facebook, Reddit and the fediverse); video sites without a reader of their own go to yt-dlp,
 * within /download's list of sites. `quick` says the card can go out with links to the media before any is downloaded.
 */

export interface LinkRepost { post: RepostPost; quick: boolean }
export interface ReadOptions { maxBytes: number; run?: Runner }
type Reader = (link: string, o: ReadOptions) => Promise<LinkRepost>;

const is = (...domains: string[]) => (host: string) => domains.some(d => host === d || host.endsWith(`.${d}`));

/** A video post read by yt-dlp: its file and what yt-dlp knows of it (title and description, likes, comments, views). */
async function viaYtdlp(link: string, site: string, color: number, o: ReadOptions): Promise<LinkRepost> {
  const r = await downloadPost(link, { maxBytes: o.maxBytes, run: o.run });
  const post = ytdlpPost(site, color, r.info, r, link);
  const title = r.info.title?.trim(), desc = r.info.description?.trim();
  if (title && desc && !desc.startsWith(title)) post.text = `**${title}**\n${desc}`;
  return { post, quick: false };
}

/** Video sites only yt-dlp reads: the site's name and colour. */
const VIDEO_SITES: [(host: string) => boolean, string, number][] = [
  [is('youtube.com', 'youtu.be'), 'YouTube', 0xff0000],
  [is('twitch.tv'), 'Twitch', 0x9146ff],
  [is('vimeo.com'), 'Vimeo', 0x1ab7ea],
  [is('streamable.com'), 'Streamable', 0x0f90fa],
  [is('dailymotion.com'), 'Dailymotion', 0x0066dc],
  [is('bilibili.com'), 'Bilibili', 0x00a1d6],
  [is('imgur.com'), 'Imgur', 0x1bb76e],
  [is('pinterest.com'), 'Pinterest', 0xe60023],
  [is('tumblr.com'), 'Tumblr', 0x36465d],
  [is('kick.com'), 'Kick', 0x53fc18],
  [is('medal.tv'), 'Medal', 0xffb800],
];

/** A Facebook link to a video, which yt-dlp can still fetch when facebed can't read the post. */
const FACEBOOK_VIDEO = /^https:\/\/(fb\.watch\/|(www\.|m\.|web\.)?facebook\.com\/(reel\/|watch|share\/[rv]\/|[^/]+\/videos\/))/i;

export const READERS: { site: string; test: (host: string, url: URL) => boolean; read: Reader }[] = [
  { site: 'X', test: is('x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'), read: async link => ({ post: await xPost(link), quick: false }) },
  { site: 'Instagram', test: is('instagram.com'), read: async (link, o) => ({ post: await instagramRepost(link, { maxBytes: o.maxBytes, ytdlpRun: o.run }), quick: true }) },
  { site: 'TikTok', test: is('tiktok.com'), read: link => tiktokRepost(link) },
  { site: 'Bluesky', test: is('bsky.app'), read: async link => ({ post: await blueskyPost(link), quick: true }) },
  { site: 'Threads', test: is('threads.net', 'threads.com'), read: async link => ({ post: await threadsRepost(link), quick: true }) },
  {
    site: 'Facebook', test: is('facebook.com', 'fb.watch'),
    read: async (link, o) => {
      try { return { post: await facebookPost(link), quick: true }; }
      catch (err) { if (FACEBOOK_VIDEO.test(link)) return viaYtdlp(link, 'Facebook', 0x0866ff, o).catch(() => { throw err; }); throw err; }
    },
  },
  {
    site: 'Reddit', test: is('reddit.com', 'redd.it'),
    read: async (link, o) => {
      const { needsDownload, ...post } = await redditRepost(link);
      if (!needsDownload) return { post, quick: true };
      // A video with sound: yt-dlp joins its picture and sound; if it can't, the silent video is shown.
      const dl = await downloadPost(post.url, { maxBytes: o.maxBytes, run: o.run }).catch(() => null);
      if (dl) post.media = [{ type: 'video', url: post.url, data: dl.data, ext: dl.ext }];
      return { post, quick: !dl };
    },
  },
  ...VIDEO_SITES.map(([test, site, color]) => ({ site, test, read: (link: string, o: ReadOptions) => viaYtdlp(link, site, color, o) })),
  { site: 'Mastodon', test: (_h: string, url: URL) => !!parseFediUrl(url.toString()), read: async link => ({ post: await fediversePost(link), quick: true }) },
];

/** The sites /repost takes, for its help and error text. */
export const SITE_NAMES = [...new Set(READERS.map(r => r.site))];

/** The post a link points to, from whichever site it is on, and the label of the button that opens it there. */
export async function repostLink(link: string, o: ReadOptions & { readers?: typeof READERS }): Promise<LinkRepost & { open: string }> {
  let u: URL;
  try { u = new URL(link.trim()); } catch { throw new LookupError('That doesn\'t look like a link. Paste the whole link to the post.'); }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') throw new LookupError('Only web links (https) can be reposted.');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const reader = (o.readers ?? READERS).find(r => r.test(host, u));
  if (!reader) throw new LookupError(`I can't repost from **${host}** yet. I can from ${SITE_NAMES.slice(0, -1).join(', ')} and ${SITE_NAMES.at(-1)} (any Mastodon-style server).`);
  const r = await reader.read(u.toString(), o);
  return { ...r, open: `Open on ${r.post.site}` };
}
