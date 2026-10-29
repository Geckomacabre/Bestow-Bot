import { Client, TextChannel } from 'discord.js';
import { card } from '../../lookups/card.js';
import { getAllFreeGameConfigs, hasFreeGameBeenPosted, markFreeGamePosted } from '../../utils/db';

export interface FreeGame {
  id: string;        // platform-prefixed unique ID, e.g. "epic:abc123"
  platform: string;  // display name
  title: string;
  description: string | null;
  url: string;
  image: string | null;
  originalPrice: string | null;  // e.g. "$19.99"
  endDate: string | null;        // ISO date string
}

/** When a game's free period ends (or, for an upcoming one, starts), as Discord times in each reader's own timezone. */
const freeWindow = (game: FreeGame) => {
  const ts = game.endDate ? Math.floor(new Date(game.endDate).getTime() / 1000) : null;
  return ts ? `<t:${ts}:f> (<t:${ts}:R>)` : null;
};

/**
 * The card for one free game: where it's free, its picture, what it normally costs, until when, and a button to claim it. A server's
 * free-game post pings its role in the card itself (cv2 messages carry no separate text), and only that role.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function freeGameCard(game: FreeGame, o: { upcoming?: boolean; pingRole?: string | null } = {}): any {
  return card({
    lead: o.pingRole ? `<@&${o.pingRole}>` : undefined, mentions: o.pingRole ? { roles: [o.pingRole] } : undefined,
    author: { name: `🎮 ${o.upcoming ? 'Coming free' : 'Free'} on ${game.platform}` }, title: game.title, url: game.url,
    description: game.description, image: game.image,
    fields: [['Normally', game.originalPrice ? `~~${game.originalPrice}~~ → **Free**` : null], [o.upcoming ? 'Free from' : 'Free until', freeWindow(game)]],
    links: [{ label: o.upcoming ? 'Store page' : 'Claim it', url: game.url, emoji: '🎮' }],
  });
}

// ─── Platform fetchers ────────────────────────────────────────────────────────

async function fetchEpicFreeGames(): Promise<FreeGame[]> {
  try {
    const res = await fetch(
      'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bestow/1.0)' }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    const elements: any[] = data?.data?.Catalog?.searchStore?.elements ?? [];
    const now = Date.now();

    return elements.flatMap((el: any) => {
      const activeOffers: any[] = el?.promotions?.promotionalOffers ?? [];
      if (!activeOffers.length) return [];
      const innerOffers: any[] = activeOffers[0]?.promotionalOffers ?? [];
      const offer = innerOffers.find((o: any) => {
        const start = new Date(o.startDate).getTime();
        const end = new Date(o.endDate).getTime();
        return o.discountSetting?.discountPercentage === 0 && now >= start && now <= end;
      });
      if (!offer) return [];

      const slug = el.productSlug ?? el.offerMappings?.[0]?.pageSlug ?? el.urlSlug;
      const url = slug
        ? `https://store.epicgames.com/en-US/p/${slug.replace(/\/home$/, '')}`
        : 'https://store.epicgames.com/en-US/free-games';

      const originalCents: number = el.price?.totalPrice?.originalPrice ?? 0;
      const originalPrice = originalCents > 0 ? `$${(originalCents / 100).toFixed(2)}` : null;

      const image =
        el.keyImages?.find((k: any) => k.type === 'DieselStoreFrontWide')?.url ??
        el.keyImages?.find((k: any) => k.type === 'Thumbnail')?.url ??
        null;

      return [{
        id: `epic:${el.id}`,
        platform: 'Epic Games Store',
        title: el.title,
        description: el.description ? el.description.slice(0, 250) : null,
        url,
        image,
        originalPrice,
        endDate: offer.endDate,
      }] as FreeGame[];
    });
  } catch {
    return [];
  }
}

async function fetchSteamFreeGames(): Promise<FreeGame[]> {
  try {
    const res = await fetch(
      'https://store.steampowered.com/api/featuredcategories/?cc=us&l=en',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bestow/1.0)' }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    const specials: any[] = data?.specials?.items ?? [];

    return specials
      .filter((item: any) => item.final_price === 0 && (item.original_price ?? 0) > 0 && item.discount_percent === 100)
      .map((item: any) => ({
        id: `steam:${item.id}`,
        platform: 'Steam',
        title: item.name,
        description: null,
        url: `https://store.steampowered.com/app/${item.id}`,
        image: item.header_image ?? null,
        originalPrice: item.original_price ? `$${(item.original_price / 100).toFixed(2)}` : null,
        endDate: null,
      }));
  } catch {
    return [];
  }
}

async function fetchGOGFreeGames(): Promise<FreeGame[]> {
  try {
    // GOG catalog filtered to discounted games priced at 0
    const res = await fetch(
      'https://catalog.gog.com/v1/catalog?limit=24&order=desc:trending&priceRange=0%2C0&discounted=eq%3Atrue&productType=in%3Agame%2Cpack%2Cdlc%2Cextras&page=1&countryCode=US&locale=en-US&currencyCode=USD',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bestow/1.0)' }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    const products: any[] = data?.products ?? [];

    return products
      .filter((p: any) => {
        const price = p.price?.finalMoney?.amount;
        const original = p.price?.baseMoney?.amount;
        return price !== undefined && parseFloat(price) === 0 && original && parseFloat(original) > 0;
      })
      .map((p: any) => ({
        id: `gog:${p.id}`,
        platform: 'GOG',
        title: p.title,
        description: null,
        url: `https://www.gog.com/en/game/${p.slug}`,
        image: p.coverHorizontal ? `https:${p.coverHorizontal}` : null,
        originalPrice: p.price?.baseMoney ? `$${parseFloat(p.price.baseMoney.amount).toFixed(2)}` : null,
        endDate: p.price?.discount?.dateEnd ?? null,
      }));
  } catch {
    return [];
  }
}

export async function fetchEpicUpcomingGames(): Promise<FreeGame[]> {
  try {
    const res = await fetch(
      'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bestow/1.0)' }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    const elements: any[] = data?.data?.Catalog?.searchStore?.elements ?? [];

    return elements.flatMap((el: any) => {
      const upcoming: any[] = el?.promotions?.upcomingPromotionalOffers ?? [];
      if (!upcoming.length) return [];
      const innerOffers: any[] = upcoming[0]?.promotionalOffers ?? [];
      const offer = innerOffers.find((o: any) => o.discountSetting?.discountPercentage === 0);
      if (!offer) return [];

      const slug = el.productSlug ?? el.offerMappings?.[0]?.pageSlug ?? el.urlSlug;
      const url = slug
        ? `https://store.epicgames.com/en-US/p/${slug.replace(/\/home$/, '')}`
        : 'https://store.epicgames.com/en-US/free-games';

      const originalCents: number = el.price?.totalPrice?.originalPrice ?? 0;
      const originalPrice = originalCents > 0 ? `$${(originalCents / 100).toFixed(2)}` : null;

      const image =
        el.keyImages?.find((k: any) => k.type === 'DieselStoreFrontWide')?.url ??
        el.keyImages?.find((k: any) => k.type === 'Thumbnail')?.url ??
        null;

      return [{
        id: `epic-upcoming:${el.id}`,
        platform: 'Epic Games Store',
        title: el.title,
        description: el.description ? el.description.slice(0, 250) : null,
        url,
        image,
        originalPrice,
        endDate: offer.startDate, // "free from" date
      }] as FreeGame[];
    });
  } catch {
    return [];
  }
}

// ─── Poller ───────────────────────────────────────────────────────────────────

export async function fetchAllFreeGames(): Promise<FreeGame[]> {
  const [epic, steam, gog] = await Promise.all([
    fetchEpicFreeGames(),
    fetchSteamFreeGames(),
    fetchGOGFreeGames(),
  ]);
  return [...epic, ...steam, ...gog];
}

async function pollFreeGames(bot: Client) {
  const games = await fetchAllFreeGames();
  if (games.length === 0) return;

  const configs = await getAllFreeGameConfigs();

  for (const config of configs) {
    if (!config.channel_id) continue;
    const platforms: string[] = JSON.parse(config.platforms);
    const channel = bot.channels.cache.get(config.channel_id) as TextChannel | undefined;
    if (!channel) continue;

    for (const game of games) {
      const platformKey = game.id.split(':')[0]; // 'epic', 'steam', 'gog'
      if (!platforms.includes(platformKey)) continue;

      if (await hasFreeGameBeenPosted(config.guild_id, game.id)) continue;

      await channel.send(freeGameCard(game, { pingRole: config.ping_role_id })).catch(() => {});
      await markFreeGamePosted(config.guild_id, game.id);
    }
  }
}

export function startFreeGamesPoller(bot: Client) {
  // Initial check 30s after startup, then every hour
  setTimeout(() => pollFreeGames(bot).catch(console.error), 30_000);
  setInterval(() => pollFreeGames(bot).catch(console.error), 60 * 60 * 1000);
}
