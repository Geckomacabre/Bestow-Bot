import { Elysia } from 'elysia';
import Config from '../config';
import {
  createSession, getSession, deleteSession,
  type SessionUser, type DiscordGuild,
} from './session';
import {
  exchangeCode, fetchDiscordUser, fetchUserGuilds,
  getGuildTextChannels, getGuildRoles, getGuild,
  botInGuild, canManageGuild, guildIconUrl,
} from './discord';
import {
  landingPage, serversPage, errorPage, escHtml,
} from './layout';
import * as db from '../utils/db';

import { overviewPage } from './pages/overview';
import { economyPage, handleEconomySave } from './pages/economy';
import { levelingPage, handleLevelingSave } from './pages/leveling';
import { welcomePage, handleWelcomeSave } from './pages/welcome';
import { starboardPage, handleStarboardSave } from './pages/starboard';
import { automodPage } from './pages/automod';
import { logsPage, handleLogsSave } from './pages/logs';
import { reactionRolesPage } from './pages/reactionroles';
import { topicsPage } from './pages/topics';
import { birthdaysPage, handleBirthdaySave } from './pages/birthdays';
import { timezonesPage } from './pages/timezones';
import { statChannelsPage } from './pages/statchannels';

const WEB_PORT = parseInt(Bun.env.WEB_PORT ?? '3000');
const WEB_URL  = Bun.env.WEB_URL ?? `http://localhost:${WEB_PORT}`;
const REDIRECT_URI = `${WEB_URL}/auth/callback`;

const CLIENT_SECRET = Bun.env.DISCORD_CLIENT_SECRET;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSessionFromCookie(cookieHeader: string | null): SessionUser | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/tmcbot_session=([^;]+)/);
  if (!match) return null;
  return getSession(decodeURIComponent(match[1]!));
}

function sessionCookie(id: string): string {
  return `tmcbot_session=${encodeURIComponent(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`;
}

function clearCookie(): string {
  return `tmcbot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function redirect(url: string, extra?: Record<string, string>): Response {
  return new Response(null, { status: 302, headers: { Location: url, ...extra } });
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function requireAuth(req: Request): Promise<SessionUser | Response> {
  const user = getSessionFromCookie(req.headers.get('cookie'));
  if (!user) return redirect('/auth/login');
  return user;
}

async function requireGuildAccess(req: Request, guildId: string): Promise<{ user: SessionUser; guild: Awaited<ReturnType<typeof getGuild>> } | Response> {
  const user = getSessionFromCookie(req.headers.get('cookie'));
  if (!user) return redirect('/auth/login');

  const memberGuild = user.guilds.find(g => g.id === guildId);
  if (!memberGuild || !canManageGuild(memberGuild.permissions)) {
    return html(errorPage('You do not have Manage Server permissions in this server.'), 403);
  }

  const guild = await getGuild(guildId);
  if (!guild) return html(errorPage('Bot is not in this server.'), 404);

  return { user, guild };
}

function parseBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent((v ?? '').replace(/\+/g, ' '));
  }
  return out;
}

// Safe accessor for noUncheckedIndexedAccess
const b = (body: Record<string, string | undefined>, key: string): string => body[key] ?? '';

function flashRedirect(to: string, message: string, type: 'success' | 'error' = 'success'): Response {
  const params = new URLSearchParams({ flash: message, flashType: type });
  return redirect(`${to}?${params}`);
}

function getFlash(url: URL): { flash?: string; flashType?: 'success' | 'error' } {
  const flash = url.searchParams.get('flash') ?? undefined;
  const ft = url.searchParams.get('flashType');
  return { flash, flashType: ft === 'error' ? 'error' : flash ? 'success' : undefined };
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function startWebServer() {
  if (!CLIENT_SECRET) {
    console.warn('[web] DISCORD_CLIENT_SECRET not set — dashboard disabled');
    return;
  }

  const app = new Elysia();

  // ── Landing ──
  app.get('/', () => html(landingPage()));

  // ── Auth ──
  app.get('/auth/login', () => {
    const params = new URLSearchParams({
      client_id: Config.CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'identify guilds',
    });
    return redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  });

  app.get('/auth/callback', async ({ request }) => {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    if (!code) return html(errorPage('Missing OAuth code.'), 400);

    const token = await exchangeCode(code, REDIRECT_URI);
    if (!token) return html(errorPage('Failed to exchange OAuth code. Check DISCORD_CLIENT_SECRET.'), 500);

    const [discordUser, guilds] = await Promise.all([
      fetchDiscordUser(token),
      fetchUserGuilds(token),
    ]);
    if (!discordUser) return html(errorPage('Failed to fetch Discord user.'), 500);

    const manageableGuilds = (guilds as DiscordGuild[]).filter(g => canManageGuild(g.permissions));

    const sessionUser: SessionUser = {
      id: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator ?? '0',
      avatar: discordUser.avatar,
      accessToken: token,
      guilds: manageableGuilds,
    };

    const sessionId = createSession(sessionUser);
    return redirect('/servers', { 'Set-Cookie': sessionCookie(sessionId) });
  });

  app.get('/auth/logout', ({ request }) => {
    const cookie = request.headers.get('cookie');
    const match = cookie?.match(/tmcbot_session=([^;]+)/);
    if (match) deleteSession(decodeURIComponent(match[1]!));
    return redirect('/', { 'Set-Cookie': clearCookie() });
  });

  // ── Server list ──
  app.get('/servers', async ({ request }) => {
    const user = await requireAuth(request);
    if (user instanceof Response) return user;

    const guildsWithStatus = await Promise.all(
      user.guilds.map(async (g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        botPresent: await botInGuild(g.id),
      }))
    );

    return html(serversPage(user, guildsWithStatus));
  });

  // ── Guild routes ──
  app.get('/servers/:guildId', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await overviewPage(auth.user, auth.guild!, flash));
  });

  // Economy
  app.get('/servers/:guildId/economy', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await economyPage(auth.user, auth.guild!, flash, flashType));
  });

  app.post('/servers/:guildId/economy', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await handleEconomySave(params.guildId, body);
    return flashRedirect(`/servers/${params.guildId}/economy`, 'Economy settings saved!');
  });

  // Leveling
  app.get('/servers/:guildId/leveling', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const [channels, roles] = await Promise.all([getGuildTextChannels(params.guildId), getGuildRoles(params.guildId)]);
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await levelingPage(auth.user, auth.guild!, channels, roles, flash, flashType));
  });

  app.post('/servers/:guildId/leveling', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await handleLevelingSave(params.guildId, body);
    return flashRedirect(`/servers/${params.guildId}/leveling`, 'Leveling settings saved!');
  });

  app.post('/servers/:guildId/leveling/roles/add', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    if (body.role_id && body.level) {
      await db.addLevelRole(params.guildId, parseInt(body.level), body.role_id);
    }
    return flashRedirect(`/servers/${params.guildId}/leveling`, 'Level role added!');
  });

  app.post('/servers/:guildId/leveling/roles/remove', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await db.removeLevelRoleByRoleId(params.guildId, body.role_id);
    return flashRedirect(`/servers/${params.guildId}/leveling`, 'Level role removed.');
  });

  // Welcome
  app.get('/servers/:guildId/welcome', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const channels = await getGuildTextChannels(params.guildId);
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await welcomePage(auth.user, auth.guild!, channels, flash, flashType));
  });

  app.post('/servers/:guildId/welcome', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await handleWelcomeSave(params.guildId, body);
    return flashRedirect(`/servers/${params.guildId}/welcome`, 'Welcome settings saved!');
  });

  // Starboard
  app.get('/servers/:guildId/starboard', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const channels = await getGuildTextChannels(params.guildId);
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await starboardPage(auth.user, auth.guild!, channels, flash, flashType));
  });

  app.post('/servers/:guildId/starboard', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await handleStarboardSave(params.guildId, body);
    return flashRedirect(`/servers/${params.guildId}/starboard`, 'Starboard settings saved!');
  });

  // Automod
  app.get('/servers/:guildId/automod', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await automodPage(auth.user, auth.guild!, flash, flashType));
  });

  app.post('/servers/:guildId/automod/add', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    if (!body.name || !body.trigger_type || !body.action) {
      return flashRedirect(`/servers/${params.guildId}/automod`, 'Name, trigger type, and action are required.', 'error');
    }
    await db.createAutomodRule(
      params.guildId, body.name, body.trigger_type, body.trigger_value || '',
      body.action, body.action_duration ? parseInt(body.action_duration) : null,
      body.action_reason || null
    );
    return flashRedirect(`/servers/${params.guildId}/automod`, 'Automod rule added!');
  });

  app.post('/servers/:guildId/automod/remove', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await db.deleteAutomodRule(parseInt(body.id), params.guildId);
    return flashRedirect(`/servers/${params.guildId}/automod`, 'Automod rule removed.');
  });

  // Logs
  app.get('/servers/:guildId/logs', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const channels = await getGuildTextChannels(params.guildId);
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await logsPage(auth.user, auth.guild!, channels, flash, flashType));
  });

  app.post('/servers/:guildId/logs', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await handleLogsSave(params.guildId, body);
    return flashRedirect(`/servers/${params.guildId}/logs`, 'Log settings saved!');
  });

  // Reaction Roles
  app.get('/servers/:guildId/reaction-roles', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const roles = await getGuildRoles(params.guildId);
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await reactionRolesPage(auth.user, auth.guild!, roles, flash, flashType));
  });

  app.post('/servers/:guildId/reaction-roles/add', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    const link = body.message_link ?? '';
    const match = link.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match || !body.emoji || !body.role_id) {
      return flashRedirect(`/servers/${params.guildId}/reaction-roles`, 'Invalid message link or missing fields.', 'error');
    }
    const [, , channelId, messageId] = match;
    await db.addReactionRole(params.guildId, channelId, messageId, body.emoji.trim(), body.role_id);
    return flashRedirect(`/servers/${params.guildId}/reaction-roles`, 'Reaction role added!');
  });

  app.post('/servers/:guildId/reaction-roles/remove', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await db.removeReactionRole(parseInt(body.id), params.guildId);
    return flashRedirect(`/servers/${params.guildId}/reaction-roles`, 'Reaction role removed.');
  });

  // Topics
  app.get('/servers/:guildId/topics', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const channels = await getGuildTextChannels(params.guildId);
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await topicsPage(auth.user, auth.guild!, channels, flash, flashType));
  });

  app.post('/servers/:guildId/topics/add-channel', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    if (!body.channel_id) return flashRedirect(`/servers/${params.guildId}/topics`, 'Select a channel.', 'error');
    const hours = Math.max(1, parseFloat(body.interval_hours) || 24);
    await db.setTopicChannel(params.guildId, body.channel_id, Math.round(hours * 3600), (body.mode as 'sequential' | 'random') || 'sequential');
    return flashRedirect(`/servers/${params.guildId}/topics`, 'Topic channel added!');
  });

  app.post('/servers/:guildId/topics/remove-channel', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await db.removeTopicChannel(params.guildId, body.channel_id);
    return flashRedirect(`/servers/${params.guildId}/topics`, 'Topic channel removed.');
  });

  app.post('/servers/:guildId/topics/add-topic', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    if (!body.text?.trim() || !body.channel_id) return flashRedirect(`/servers/${params.guildId}/topics`, 'Topic text required.', 'error');
    await db.addTopic(params.guildId, body.channel_id, body.text.trim());
    return flashRedirect(`/servers/${params.guildId}/topics`, 'Topic added!');
  });

  app.post('/servers/:guildId/topics/remove-topic', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await db.removeTopic(parseInt(body.topic_id), params.guildId);
    return flashRedirect(`/servers/${params.guildId}/topics`, 'Topic removed.');
  });

  // Birthdays
  app.get('/servers/:guildId/birthdays', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const channels = await getGuildTextChannels(params.guildId);
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await birthdaysPage(auth.user, auth.guild!, channels, flash, flashType));
  });

  app.post('/servers/:guildId/birthdays', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await handleBirthdaySave(params.guildId, body);
    return flashRedirect(`/servers/${params.guildId}/birthdays`, 'Birthday settings saved!');
  });

  // Timezones
  app.get('/servers/:guildId/timezones', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const channels = await getGuildTextChannels(params.guildId);
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await timezonesPage(auth.user, auth.guild!, channels, flash, flashType));
  });

  app.post('/servers/:guildId/timezones', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    if (!body.channel_id) {
      return flashRedirect(`/servers/${params.guildId}/timezones`, 'Select a channel.', 'error');
    }
    // The live message posting requires the bot client — just save channel; bot will post on next update cycle
    await db.setGuildTimezoneMessage(params.guildId, body.channel_id, '0');
    return flashRedirect(`/servers/${params.guildId}/timezones`, 'Timezone channel saved. The bot will post the live message shortly.');
  });

  // Stat Channels
  app.get('/servers/:guildId/stat-channels', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const { flash, flashType } = getFlash(new URL(request.url));
    return html(await statChannelsPage(auth.user, auth.guild!, flash, flashType));
  });

  app.post('/servers/:guildId/stat-channels/remove', async ({ request, params }) => {
    const auth = await requireGuildAccess(request, params.guildId);
    if (auth instanceof Response) return auth;
    const body: any = parseBody(await request.text());
    await db.removeStatChannelById(parseInt(body.id), params.guildId);
    return flashRedirect(`/servers/${params.guildId}/stat-channels`, 'Stat channel removed.');
  });

  app.listen(WEB_PORT);
  console.log(`[web] Dashboard running at ${WEB_URL}`);
}
