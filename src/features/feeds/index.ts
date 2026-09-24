import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import * as db from '../../utils/db';
import Config from '../../config';
import logger from '../../utils/logger';

// ─── Curated news sources per category ───────────────────────────────────────

const NEWS_SOURCES: Record<string, { url: string; source: string }[]> = {
  world: [
    { url: 'http://feeds.bbci.co.uk/news/world/rss.xml',                        source: 'BBC World News' },
    { url: 'https://feeds.npr.org/1001/rss.xml',                                 source: 'NPR News' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',             source: 'NY Times World' },
  ],
  entertainment: [
    { url: 'https://variety.com/feed/',                                           source: 'Variety' },
    { url: 'https://deadline.com/feed/',                                          source: 'Deadline' },
    { url: 'https://www.hollywoodreporter.com/feed/',                             source: 'Hollywood Reporter' },
  ],
  sports: [
    { url: 'https://www.espn.com/espn/rss/news',                                 source: 'ESPN' },
    { url: 'http://feeds.bbci.co.uk/sport/rss.xml',                              source: 'BBC Sport' },
    { url: 'https://sports.yahoo.com/rss/',                                       source: 'Yahoo Sports' },
  ],
  politics: [
    { url: 'https://feeds.npr.org/1014/rss.xml',                                 source: 'NPR Politics' },
    { url: 'https://thehill.com/rss/syndicator/19109',                           source: 'The Hill' },
    { url: 'https://www.politico.com/rss/politicopicks.xml',                     source: 'Politico' },
  ],
  gaming: [
    { url: 'https://feeds.ign.com/ign/articles',                                 source: 'IGN' },
    { url: 'https://kotaku.com/rss',                                              source: 'Kotaku' },
    { url: 'https://www.polygon.com/rss/index.xml',                              source: 'Polygon' },
  ],
};

const CATEGORY_COLORS: Record<string, number> = {
  world:         0x1565C0,
  entertainment: 0x6A1B9A,
  sports:        0x1B5E20,
  politics:      0xB71C1C,
  gaming:        0xE65100,
};

const CATEGORY_LABELS: Record<string, string> = {
  world:         '🌍 World News',
  entertainment: '🎬 TV & Movies',
  sports:        '⚽ Sports',
  politics:      '🏛️ Politics',
  gaming:        '🎮 Gaming',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getChannel(bot: Client, id: string): Promise<TextChannel | null> {
  try {
    const ch = await bot.channels.fetch(id);
    return ch instanceof TextChannel ? ch : null;
  } catch { return null; }
}

// ─── RSS ──────────────────────────────────────────────────────────────────────

function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”');
}

function extractCdata(raw: string): string {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim();
}

function extractImage(block: string): string | null {
  // media:content url="..."
  let m = /<media:content[^>]+url="([^"]+)"/.exec(block);
  if (m) return m[1]!;
  // media:thumbnail url="..."
  m = /<media:thumbnail[^>]+url="([^"]+)"/.exec(block);
  if (m) return m[1]!;
  // enclosure type="image/..."
  m = /<enclosure[^>]+type="image\/[^"]*"[^>]+url="([^"]+)"/.exec(block)
    ?? /<enclosure[^>]+url="([^"]+)"[^>]+type="image\/[^"]*"/.exec(block);
  if (m) return m[1]!;
  // <img src="..."> inside description/content (skip tracking pixels)
  const imgM = /<img[^>]+src="([^"]+)"/.exec(block);
  if (imgM && imgM[1] && imgM[1].startsWith('http') && !imgM[1].includes('pixel') && !imgM[1].includes('track')) return imgM[1];
  return null;
}

function parseRssItems(xml: string): { id: string; title: string; link: string; published: string; image: string | null }[] {
  const items: { id: string; title: string; link: string; published: string; image: string | null }[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1] ?? m[2] ?? '';
    const title = decodeEntities(extractCdata(/<title[^>]*>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? ''));
    const link = (/<link[^>]*href="([^"]+)"/.exec(block)?.[1] ?? extractCdata(/<link[^>]*>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? '')).trim();
    const guid = extractCdata(/<guid[^>]*>([\s\S]*?)<\/guid>/.exec(block)?.[1] ?? /<id>([\s\S]*?)<\/id>/.exec(block)?.[1] ?? link);
    const published = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1] ?? /<published>([\s\S]*?)<\/published>/.exec(block)?.[1] ?? '').trim();
    const image = extractImage(block);
    if (title && link) items.push({ id: guid, title, link, published, image });
  }
  return items;
}

async function pollRss(bot: Client) {
  const feeds = await db.getAllRssFeeds();
  for (const feed of feeds) {
    try {
      const res = await fetch(feed.feed_url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (!items.length) continue;

      const newItems = feed.last_item_id
        ? items.filter(i => i.id !== feed.last_item_id).slice(0, 5)
        : items.slice(0, 1);

      for (const item of newItems.reverse()) {
        const ch = await getChannel(bot, feed.channel_id);
        if (!ch) continue;
        const embed = new EmbedBuilder()
          .setTitle(item.title.slice(0, 256))
          .setURL(item.link)
          .setColor(0xff6600)
          .setTimestamp(item.published ? new Date(item.published) : new Date());
        await ch.send({ embeds: [embed] }).catch(() => {});
      }

      if (items[0]) await db.updateRssLastItem(feed.id, items[0].id);
    } catch (err) {
      logger.debug(`RSS poll error for ${feed.feed_url}: ${err}`);
    }
  }
}

// ─── Reddit ───────────────────────────────────────────────────────────────────

async function pollReddit(bot: Client) {
  const feeds = await db.getAllRedditFeeds();
  for (const feed of feeds) {
    try {
      const url = `https://www.reddit.com/r/${feed.subreddit}/new.json?limit=5`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TMCBot/1.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const json: any = await res.json();
      const posts: any[] = json?.data?.children?.map((c: any) => c.data) ?? [];
      if (!posts.length) continue;

      const newPosts = feed.last_post_id
        ? posts.filter(p => p.id !== feed.last_post_id && !p.over_18 || feed.nsfw).slice(0, 3)
        : posts.slice(0, 1);

      for (const post of newPosts.reverse()) {
        if (post.over_18 && !feed.nsfw) continue;
        const ch = await getChannel(bot, feed.channel_id);
        if (!ch) continue;
        const embed = new EmbedBuilder()
          .setTitle(post.title.slice(0, 256))
          .setURL(`https://reddit.com${post.permalink}`)
          .setColor(0xff4500)
          .setAuthor({ name: `r/${feed.subreddit}` })
          .setDescription((post.selftext || '').slice(0, 400) || null)
          .setTimestamp(new Date(post.created_utc * 1000));
        if (post.thumbnail && post.thumbnail.startsWith('http')) embed.setImage(post.thumbnail);
        await ch.send({ embeds: [embed] }).catch(() => {});
      }

      if (posts[0]) await db.updateRedditLastPost(feed.id, posts[0].id);
    } catch (err) {
      logger.debug(`Reddit poll error for r/${feed.subreddit}: ${err}`);
    }
  }
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

async function pollYoutube(bot: Client) {
  if (!Config.YOUTUBE_API_KEY) return;
  const feeds = await db.getAllYoutubeFeeds();
  for (const feed of feeds) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?channelId=${feed.youtube_channel_id}&order=date&maxResults=1&part=snippet&type=video&key=${Config.YOUTUBE_API_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const json: any = await res.json();
      const item = json?.items?.[0];
      if (!item) continue;
      const videoId = item.id?.videoId;
      if (!videoId || videoId === feed.last_video_id) continue;

      const ch = await getChannel(bot, feed.channel_id);
      if (!ch) continue;

      const msg = (feed.message ?? '🎬 New video from **{channel}**: {url}')
        .replace('{channel}', feed.youtube_channel_name ?? 'YouTube')
        .replace('{title}', item.snippet?.title ?? '')
        .replace('{url}', `https://youtu.be/${videoId}`);

      await ch.send(msg).catch(() => {});
      await db.updateYoutubeLastVideo(feed.id, videoId);
    } catch (err) {
      logger.debug(`YouTube poll error: ${err}`);
    }
  }
}

// ─── Twitch ───────────────────────────────────────────────────────────────────

let twitchToken: { token: string; expires: number } | null = null;

async function getTwitchToken(): Promise<string | null> {
  if (!Config.TWITCH_CLIENT_ID || !Config.TWITCH_CLIENT_SECRET) return null;
  if (twitchToken && twitchToken.expires > Date.now()) return twitchToken.token;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${Config.TWITCH_CLIENT_ID}&client_secret=${Config.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
      { method: 'POST', signal: AbortSignal.timeout(10_000) }
    );
    const json: any = await res.json();
    twitchToken = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 - 60_000 };
    return twitchToken.token;
  } catch { return null; }
}

async function pollTwitch(bot: Client) {
  const token = await getTwitchToken();
  if (!token || !Config.TWITCH_CLIENT_ID) return;

  const feeds = await db.getAllTwitchFeeds();
  const usernames = [...new Set(feeds.map(f => f.twitch_username))];
  if (!usernames.length) return;

  try {
    const params = usernames.map(u => `user_login=${encodeURIComponent(u)}`).join('&');
    const res = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
      headers: {
        'Client-ID': Config.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;
    const json: any = await res.json();
    const liveStreams: Map<string, any> = new Map(
      (json.data ?? []).map((s: any) => [s.user_login.toLowerCase(), s])
    );

    for (const feed of feeds) {
      const stream = liveStreams.get(feed.twitch_username.toLowerCase());
      const isLive = !!stream;

      if (isLive && !feed.live) {
        const ch = await getChannel(bot, feed.channel_id);
        if (ch) {
          const msg = (feed.message ?? '🔴 **{username}** is now live on Twitch!\n**{game}**\nhttps://twitch.tv/{username}')
            .replace(/{username}/g, stream.user_name)
            .replace(/{game}/g, stream.game_name ?? 'Unknown')
            .replace(/{title}/g, stream.title ?? '');
          await ch.send(msg).catch(() => {});
        }
      }
      if (isLive !== !!feed.live) {
        await db.updateTwitchFeedStatus(feed.id, isLive);
      }
    }
  } catch (err) {
    logger.debug(`Twitch poll error: ${err}`);
  }
}

// ─── Reminder poller ──────────────────────────────────────────────────────────

async function pollReminders(bot: Client) {
  const due = await db.getPendingReminders(Date.now());
  for (const reminder of due) {
    try {
      const ch = await bot.channels.fetch(reminder.channel_id).catch(() => null);
      if (ch && 'send' in ch) {
        await (ch as TextChannel).send(`⏰ <@${reminder.user_id}> Reminder: ${reminder.message}`).catch(() => {});
      }
    } catch {}
    await db.fireReminder(reminder.id);
  }
}

// ─── News poller ──────────────────────────────────────────────────────────────

export async function pollNews(bot: Client) {
  // Prune posted records older than 7 days to keep the table lean
  await db.pruneOldNews(Date.now() - 7 * 24 * 60 * 60 * 1000).catch(() => {});

  const configs = await db.getAllNewsConfigs();
  if (!configs.length) return;

  // Group configs by guild so we make one DB trip per guild
  const byGuild = new Map<string, typeof configs>();
  for (const cfg of configs) {
    const list = byGuild.get(cfg.guild_id) ?? [];
    list.push(cfg);
    byGuild.set(cfg.guild_id, list);
  }

  for (const [guildId, guildConfigs] of byGuild) {
    for (const cfg of guildConfigs) {
      const sources = NEWS_SOURCES[cfg.category];
      if (!sources) continue;

      // Collect all items across every source for this category
      const allItems: { id: string; title: string; link: string; published: string; image: string | null; source: string }[] = [];
      for (const { url, source } of sources) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) continue;
          const xml = await res.text();
          const parsed = parseRssItems(xml).map(i => ({ ...i, source }));
          allItems.push(...parsed);
        } catch (err) {
          logger.debug(`[news] fetch error ${url}: ${err}`);
        }
      }

      if (!allItems.length) continue;

      // Sort newest first, deduplicate by URL
      allItems.sort((a, b) => (new Date(b.published).getTime() || 0) - (new Date(a.published).getTime() || 0));
      const seen = new Set<string>();
      const deduped = allItems.filter(i => {
        if (seen.has(i.link)) return false;
        seen.add(i.link);
        return true;
      });

      // Filter to items not yet posted for this guild, cap at 3 per run
      const toPost: typeof deduped = [];
      for (const item of deduped) {
        if (toPost.length >= 3) break;
        if (await db.isNewsPosted(guildId, item.link)) continue;
        toPost.push(item);
      }
      if (!toPost.length) continue;

      const ch = await getChannel(bot, cfg.channel_id);
      if (!ch) continue;

      const color = CATEGORY_COLORS[cfg.category] ?? 0x5865F2;
      const label = CATEGORY_LABELS[cfg.category] ?? cfg.category;

      for (const item of toPost.reverse()) {
        const embed = new EmbedBuilder()
          .setTitle(item.title.slice(0, 256))
          .setURL(item.link)
          .setColor(color)
          .setAuthor({ name: `${label} • ${item.source}` })
          .setTimestamp(item.published ? new Date(item.published) : new Date());
        if (item.image) embed.setImage(item.image);
        await ch.send({ embeds: [embed] }).catch(() => {});
        await db.markNewsPosted(guildId, item.link);
      }
    }
  }
}

// ─── Start all pollers ────────────────────────────────────────────────────────

export function startFeedsPollers(bot: Client) {
  // Run immediately then on interval
  const poll = async () => {
    await Promise.all([
      pollRss(bot),
      pollReddit(bot),
      pollYoutube(bot),
      pollTwitch(bot),
      pollReminders(bot),
    ]);
  };
  poll();
  setInterval(poll, 5 * 60 * 1000); // every 5 minutes
}
