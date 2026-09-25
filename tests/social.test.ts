import { describe, expect, test } from 'bun:test';
import { parseFxTweet, parseFxUser, stripMediaLinks } from '../src/lookups/x';
import { cleanUser, parseTikPost, parseTikTokUrl, parseTikUser } from '../src/lookups/tiktok';
import { metaTag, parseBioPage, parseCash, parseIgUser, parsePinSearch, parseSnap } from '../src/lookups/social';
import { cleanGiftSlug, cleanHandle, parseEmbed, parseGift, parseMessageLink, parsePage, parsePosts, tgNumber } from '../src/lookups/telegram';
import { cleanTonQuery, nanoToTon, parseEvents, parseJettons, parseNfts } from '../src/lookups/ton';
import { parseHistory, parseMatchFor, parseMmr, parseScoreboard } from '../src/lookups/henrik';
import { hashUrl, isInitialNecklace, parseAssetId, parseChart, parsePlayer, parseRobux } from '../src/lookups/roblox';
import { repostCard, shortCount, statsLine } from '../src/lookups/repost';
import { parseInfoJson } from '../src/media/download';
import { parseFnStats } from '../src/lookups/games';

const flat = (payload: any): string => JSON.stringify(payload.components.map((c: any) => c.toJSON?.() ?? c));

describe('X (FxTwitter)', () => {
  const raw = {
    code: 200,
    tweet: {
      url: 'https://x.com/Tectone/status/1', text: 'new vid https://t.co/XVZLscHtvP', created_timestamp: 1_790_000_000, likes: 906, replies: 105, bookmarks: 66, retweets: 23, views: 24_310, possibly_sensitive: false,
      author: { name: 'TECTONE 🇺🇸', screen_name: 'Tectone', avatar_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg', verification: { verified: true } },
      media: { all: [{ type: 'video' as const, url: 'https://video.twimg.com/a.mp4', thumbnail_url: 'https://pbs.twimg.com/t.jpg' }] },
    },
  };
  test('a post becomes a repost card with the media link stripped and Heist\'s stats order', () => {
    const p = parseFxTweet(raw)!;
    expect(p.text).toBe('new vid'); expect(p.author).toMatchObject({ name: 'TECTONE 🇺🇸', handle: 'Tectone', verified: true, url: 'https://x.com/Tectone' });
    expect(p.author.avatar).toContain('_400x400.'); expect(p.createdAt).toBe(1_790_000_000_000);
    expect(p.media).toEqual([{ type: 'video', url: 'https://video.twimg.com/a.mp4', thumb: 'https://pbs.twimg.com/t.jpg' }]);
    expect(statsLine(p.stats)).toBe('♡ 906 · 💬 105 · 🔖 66 · 🔁 23 · 24.3k views');
    expect(parseFxTweet({ code: 404 })).toBeNull();
  });
  test('text keeps links that are not trailing media links', () => {
    expect(stripMediaLinks('see https://t.co/a here', true)).toBe('see https://t.co/a here');
    expect(stripMediaLinks('only text https://t.co/a', false)).toBe('only text https://t.co/a');
  });
  test('the card: header with handle and relative time, media gallery, stats line, both buttons', () => {
    const p = parseFxTweet(raw)!;
    const out = repostCard(p, { files: [], items: ['attachment://video1.mp4'], skipped: [] }, { open: 'Open on X', authorUrl: p.author.url });
    const s = flat(out);
    expect(s).toContain('### TECTONE 🇺🇸 ☑️'); expect(s).toContain('@Tectone • <t:1790000000:R>'); expect(s).toContain('attachment://video1.mp4');
    expect(s).toContain('-# ♡ 906 · 💬 105'); expect(s).toContain('Open on X'); expect(s).toContain('Author');
  });
  test('profiles', () => {
    const u = parseFxUser({ user: { screen_name: 'x', name: 'X', followers: 10, following: 2, tweets: 5, joined: 'Tue Feb 20 14:35:54 +0000 2007', verification: { verified: true }, website: { url: 'https://x.ai' } } })!;
    expect(u).toMatchObject({ handle: 'x', followers: 10, verified: true, website: 'https://x.ai' }); expect(u.joined).toBe(Date.parse('Tue Feb 20 14:35:54 +0000 2007'));
    expect(parseFxUser({ code: 404 })).toBeNull();
  });
  test('short counts', () => { expect(shortCount(906)).toBe('906'); expect(shortCount(24_310)).toBe('24.3k'); expect(shortCount(1_200_000)).toBe('1.2m'); expect(shortCount(250_000)).toBe('250k'); });
});

describe('TikTok (TikWM)', () => {
  test('video posts use the no-watermark HD file; relative URLs are made absolute; photo posts become images', () => {
    const v = parseTikPost({ id: '7', title: 'hi', hdplay: '/video/media/hdplay/7.mp4', digg_count: 5, comment_count: 1, collect_count: 2, share_count: 3, play_count: 1000, create_time: 1_700_000_000, author: { unique_id: 'bob', nickname: 'Bob', avatar: 'https://p16/a.jpg' } }, 'https://vm.tiktok.com/x');
    expect(v.media).toEqual([{ type: 'video', url: 'https://www.tikwm.com/video/media/hdplay/7.mp4', thumb: undefined }]);
    expect(v.url).toBe('https://www.tiktok.com/@bob/video/7'); expect(statsLine(v.stats)).toBe('♡ 5 · 💬 1 · 🔖 2 · ↗️ 3 · 1k views');
    const photos = parseTikPost({ id: '8', images: ['https://p16/1.jpg', 'https://p16/2.jpg'] }, 'https://www.tiktok.com/@a/photo/8');
    expect(photos.media.map(m => m.type)).toEqual(['image', 'image']);
  });
  test('users and inputs', () => {
    expect(parseTikUser({ user: { uniqueId: 'bob', nickname: 'Bob', verified: true }, stats: { followerCount: 9, heart: 4 } })).toMatchObject({ handle: 'bob', followers: 9, likes: 4, verified: true });
    expect(parseTikUser({})).toBeNull();
    expect(cleanUser('@bob.smith')).toBe('bob.smith'); expect(cleanUser('https://www.tiktok.com/@bob?x=1')).toBe('bob'); expect(() => cleanUser('no spaces!')).toThrow();
    expect(parseTikTokUrl('https://vm.tiktok.com/ZM123/')).toContain('vm.tiktok.com'); expect(() => parseTikTokUrl('https://evil.com/tiktok.com')).toThrow(); expect(() => parseTikTokUrl('http://www.tiktok.com/@a')).toThrow();
  });
});

describe('profile pages', () => {
  test('Instagram web_profile_info', () => {
    const u = parseIgUser({ data: { user: { username: 'nasa', full_name: 'NASA', edge_followed_by: { count: 100 }, edge_follow: { count: 3 }, edge_owner_to_timeline_media: { count: 7 }, is_verified: true, is_private: false, profile_pic_url_hd: 'https://x/hd.jpg' } } })!;
    expect(u).toMatchObject({ username: 'nasa', followers: 100, following: 3, posts: 7, verified: true, avatar: 'https://x/hd.jpg' });
    expect(parseIgUser({ data: { user: null } })).toBeNull();
  });
  test('Snapchat public profile and personal account from __NEXT_DATA__', () => {
    const page = (profile: unknown) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { userProfile: profile } } })}</script></html>`;
    expect(parseSnap(page({ publicProfileInfo: { username: 'djkhaled', title: 'DJ Khaled', subscriberCount: '5000000', bio: 'we the best' } }), 'x')).toMatchObject({ username: 'djkhaled', name: 'DJ Khaled', subscribers: 5_000_000, public: true });
    expect(parseSnap(page({ userInfo: { username: 'amy', displayName: 'Amy', bitmoji3d: { avatarImage: { url: 'https://b/a.png' } } } }), 'x')).toMatchObject({ username: 'amy', name: 'Amy', avatar: 'https://b/a.png', public: false });
    expect(parseSnap('<html><meta property="og:title" content="Snapchat"></html>', 'x')).toBeNull();
  });
  test('Cash App embedded profile, with an og:title fallback', () => {
    expect(parseCash('<script>var profile = {"display_name":"Jack","formatted_cashtag":"$jack","avatar":{"image_url":"https://c/a.jpg","initial":"J","accent_color":"#00d632"},"is_verified_account":true};\n</script>', 'jack'))
      .toMatchObject({ cashtag: '$jack', name: 'Jack', verified: true, accent: '#00d632' });
    expect(parseCash('<meta property="og:title" content="Pay Jack on Cash App">', 'jack')).toMatchObject({ cashtag: '$jack', name: 'Jack' });
    expect(parseCash('<meta property="og:title" content="Cash App">', 'nobody')).toBeNull();
  });
  test('bio pages read og tags and reject not-found pages', () => {
    expect(parseBioPage('<meta property="og:title" content="bob | guns.lol"><meta property="og:description" content="hi">', 'guns.lol', 'bob', 'https://guns.lol/bob')).toMatchObject({ title: 'bob | guns.lol', description: 'hi' });
    expect(parseBioPage('<title>404 - Not Found</title>', 'guns.lol', 'x', 'u')).toBeNull();
    expect(metaTag('<meta content="v" property="og:x">', 'og:x')).toBe('v');
  });
  test('Pinterest search results', () => {
    const pins = parsePinSearch({ resource_response: { data: { results: [{ id: '1', grid_title: 'Cat', images: { orig: { url: 'https://i.pinimg.com/originals/a.jpg', width: 600, height: 600 } }, pinner: { username: 'p', full_name: 'P' }, repin_count: 5 }, { id: '2' } as never] } } });
    expect(pins).toHaveLength(1); expect(pins[0]).toMatchObject({ id: '1', title: 'Cat', image: 'https://i.pinimg.com/originals/a.jpg', saves: 5, url: 'https://www.pinterest.com/pin/1/' });
  });
});

describe('Telegram public pages', () => {
  const page = (extra: string, title = 'Durov\'s Channel') => `<div class="tgme_page_photo"><img class="tgme_page_photo_image" src="https://cdn4.telesco.pe/p.jpg"></div><div class="tgme_page_title"><span dir="auto">${title}</span></div><div class="tgme_page_extra">${extra}</div><div class="tgme_page_description">Hi &amp; welcome<br/>line 2</div>`;
  test('kind from the counters; bots by their required "bot" suffix', () => {
    expect(parsePage(page('1 234 567 subscribers'), 'durov')).toMatchObject({ kind: 'channel', subscribers: 1_234_567, title: 'Durov\'s Channel', description: 'Hi & welcome\nline 2', photo: 'https://cdn4.telesco.pe/p.jpg' });
    expect(parsePage(page('12 345 members, 678 online'), 'somegroup')).toMatchObject({ kind: 'group', members: 12_345, online: 678 });
    expect(parsePage(page('@DurgerKingBot'), 'DurgerKingBot')!.kind).toBe('bot'); expect(parsePage(page('@durov'), 'durov')!.kind).toBe('user');
    expect(parsePage('<meta property="og:title" content="Telegram: Contact @nobody">', 'nobody')).toBeNull();
    expect(tgNumber('1 000')).toBe(1000);
  });
  test('handles, links, gifts', () => {
    expect(cleanHandle('https://t.me/durov')).toBe('durov'); expect(cleanHandle('@durov')).toBe('durov'); expect(() => cleanHandle('ab')).toThrow();
    expect(parseMessageLink('https://t.me/durov/123')).toEqual({ channel: 'durov', id: 123 }); expect(() => parseMessageLink('https://t.me/c/123/4')).toThrow(/Private/);
    expect(cleanGiftSlug('https://t.me/nft/PlushPepe-1')).toBe('PlushPepe-1'); expect(() => cleanGiftSlug('nope')).toThrow();
    const gift = parseGift('<meta property="og:title" content="Plush Pepe #1"><meta property="og:image" content="https://g/1.png"><table class="tgme_gift_table"><tr><th>Owner</th><td><a>Alice</a></td></tr><tr><th>Model</th><td>Gold 1%</td></tr></table>', 'PlushPepe-1')!;
    expect(gift).toMatchObject({ title: 'Plush Pepe #1', number: '1', owner: 'Alice', image: 'https://g/1.png' }); expect(gift.attributes).toContainEqual(['Model', 'Gold 1%']);
  });
  test('message embeds and channel posts', () => {
    const m = parseEmbed('<a class="tgme_widget_message_owner_name" href="x"><span>Durov</span></a><div class="tgme_widget_message_text js-message_text" dir="auto">Hello<br/>world</div><span class="tgme_widget_message_views">1.2M</span><time datetime="2024-01-01T00:00:00+00:00">', 'durov', 5)!;
    expect(m).toMatchObject({ author: 'Durov', text: 'Hello\nworld', views: '1.2M', link: 'https://t.me/durov/5' });
    expect(parseEmbed('<div class="tgme_widget_message_error">Post not found</div>', 'x', 1)).toBeNull();
    const posts = parsePosts('<div class="tgme_widget_message_wrap"><div data-post="durov/10"><div class="tgme_widget_message_text" dir="auto">a</div></div></div><div class="tgme_widget_message_wrap"><div data-post="durov/11"><div class="tgme_widget_message_video_player"></div></div></div></section>', 'durov');
    expect(posts.map(p => p.id)).toEqual([10, 11]); expect(posts[1]!.hasVideo).toBe(true);
  });
});

describe('TON', () => {
  test('queries: addresses, domains, bare names', () => {
    expect(cleanTonQuery('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N')).toBe('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N');
    expect(cleanTonQuery('Foundation.TON')).toBe('foundation.ton'); expect(cleanTonQuery('foundation')).toBe('foundation.ton'); expect(() => cleanTonQuery('not a thing!')).toThrow();
    expect(nanoToTon('1500000000')).toBe(1.5);
  });
  test('jettons, NFTs, events', () => {
    const j = parseJettons({ balances: [{ balance: '2500000', jetton: { name: 'Tether', symbol: 'USDT', decimals: 6, verification: 'whitelist' }, price: { prices: { USD: 1 } } }, { balance: '0', jetton: { name: 'Zero', symbol: 'Z', decimals: 9 } }] });
    expect(j).toEqual([{ name: 'Tether', symbol: 'USDT', amount: 2.5, image: undefined, usd: 2.5, verified: true }]);
    expect(parseNfts({ nft_items: [{ address: 'a', metadata: { name: 'N' }, collection: { name: 'C' }, previews: [{ resolution: '500x500', url: 'https://p/5.png' }], trust: 'whitelist' }] })[0]).toMatchObject({ name: 'N', collection: 'C', image: 'https://p/5.png', verified: true });
    expect(parseEvents({ events: [{ event_id: 'e', timestamp: 10, actions: [{ type: 'TonTransfer', simple_preview: { description: 'Sent 1 TON' } }, { type: 'X', status: 'failed' }] }] })[0]).toEqual({ id: 'e', time: 10_000, scam: false, lines: ['Sent 1 TON', '❌ X'] });
  });
});

describe('Valorant (HenrikDev), both API layouts', () => {
  test('rank from v3 and v2 mmr', () => {
    expect(parseMmr({ current: { tier: { name: 'Gold 2' }, rr: 45, last_change: -12 }, peak: { tier: { name: 'Platinum 1' } } })).toMatchObject({ tier: 'Gold 2', rr: 45, lastChange: -12, peak: 'Platinum 1' });
    expect(parseMmr({ current_data: { currenttierpatched: 'Iron 1', ranking_in_tier: 3 } })).toMatchObject({ tier: 'Iron 1', rr: 3 });
    expect(parseMmr({})).toBeNull();
  });
  test('matches and scoreboards from v4 and v3', () => {
    const v4 = { metadata: { match_id: 'm', map: { name: 'Ascent' }, queue: { name: 'Competitive' }, started_at: '2026-01-01T00:00:00Z' }, players: [{ puuid: 'p', name: 'A', tag: '1', team_id: 'Red', agent: { name: 'Jett' }, stats: { kills: 20, deaths: 10, assists: 5, score: 300 } }, { puuid: 'q', name: 'B', tag: '2', team_id: 'Blue', stats: { kills: 1, deaths: 2, assists: 3, score: 100 } }], teams: [{ team_id: 'Red', won: true, rounds: { won: 13, lost: 7 } }, { team_id: 'Blue', won: false, rounds: { won: 7, lost: 13 } }] };
    expect(parseMatchFor(v4, 'p')).toMatchObject({ map: 'Ascent', agent: 'Jett', kills: 20, won: true, rounds: '13–7' });
    expect(parseScoreboard(v4).teams.map(t => [t.name, t.players.length, t.won])).toEqual([['Red', 1, true], ['Blue', 1, false]]);
    const v3 = { metadata: { matchid: 'm', map: 'Bind', mode: 'Unrated', game_start: 100 }, players: { all_players: [{ puuid: 'p', name: 'A', tag: '1', team: 'Blue', character: 'Sage', stats: { kills: 3, deaths: 4, assists: 5, score: 50 } }] }, teams: { blue: { has_won: false, rounds_won: 5, rounds_lost: 13 } } };
    expect(parseMatchFor(v3, 'p')).toMatchObject({ map: 'Bind', agent: 'Sage', won: false, rounds: '5–13', started: 100_000 });
  });
  test('RR history rows from either shape', () => {
    expect(parseHistory([{ currenttierpatched: 'Gold 1', ranking_in_tier: 20, mmr_change_to_last_game: 18, map: { name: 'Haven' }, date_raw: 5 }])[0]).toMatchObject({ tier: 'Gold 1', rr: 20, change: 18, map: 'Haven', date: 5000 });
    expect(parseHistory({ history: [{ tier: { name: 'Gold 2' }, rr: 1, last_change: -20, date: '2026-01-01T00:00:00Z' }] })[0]).toMatchObject({ tier: 'Gold 2', change: -20 });
  });
});

describe('Roblox extras and Rolimons', () => {
  test('Heist-style Robux amounts', () => {
    expect(parseRobux('100k')).toBe(100_000); expect(parseRobux('1.5m')).toBe(1_500_000); expect(parseRobux('10b')).toBe(10_000_000_000); expect(parseRobux('1,000')).toBe(1000); expect(parseRobux('R$ 250')).toBe(250);
    expect(parseRobux('lots')).toBeNull(); expect(parseRobux('0')).toBeNull();
  });
  test('asset IDs from links', () => {
    expect(parseAssetId('https://www.roblox.com/catalog/1365767/Valkyrie-Helm')).toBe(1365767); expect(parseAssetId('https://www.roblox.com/library/123/x')).toBe(123);
    expect(parseAssetId('https://assetdelivery.roblox.com/v1/asset?id=55')).toBe(55); expect(parseAssetId('42')).toBe(42); expect(parseAssetId('nope')).toBeNull();
  });
  test('initial necklaces', () => {
    for (const n of ['A Initial Necklace', 'Initials Chain', 'Letter B Necklace', 'K Chain']) expect(isInitialNecklace(n), n).toBe(true);
    for (const n of ['Gold Chain', 'Bling Necklace']) expect(isInitialNecklace(n), n).toBe(false);
  });
  test('3D CDN URLs, Rolimons players and charts', () => {
    expect(hashUrl('abc')[0]).toBe('https://tr.rbxcdn.com/abc'); expect(hashUrl('abc')[1]).toMatch(/^https:\/\/t[0-7]\.rbxcdn\.com\/abc$/);
    expect(parsePlayer({ success: true, playername: 'x', rap: 5, value: 9, premium: true })).toMatchObject({ name: 'x', rap: 5, value: 9, premium: true });
    expect(parsePlayer({ success: false })).toBeNull();
    const pts = parseChart('<script>var chart_data = {"num_points":2,"timestamp":[1700000000,1700086400],"rap":[1,2],"value":[3,4]};</script>');
    expect(pts).toEqual([{ t: 1_700_000_000_000, rap: 1, value: 3 }, { t: 1_700_086_400_000, rap: 2, value: 4 }]);
    expect(parseChart('<html></html>')).toEqual([]);
  });
});

describe('yt-dlp post metadata and Fortnite stats', () => {
  test('the JSON line is found among other output', () => {
    expect(parseInfoJson('[info] hi\n{"uploader":"u","like_count":3}\n')).toEqual({ uploader: 'u', like_count: 3 });
    expect(parseInfoJson('nothing')).toBeNull();
  });
  test('Fortnite overall stats', () => {
    expect(parseFnStats({ account: { name: 'Ninja' }, stats: { all: { overall: { wins: 5, kills: 50, kd: 2.5, matches: 25, winRate: 20, minutesPlayed: 600 } } } })).toMatchObject({ name: 'Ninja', wins: 5, kd: 2.5, minutes: 600 });
    expect(parseFnStats({})).toBeNull();
  });
});
