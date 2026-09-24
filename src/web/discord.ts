// Discord REST helpers used by the web dashboard (uses bot token, not user token)
import Config from '../config';

const API = 'https://discord.com/api/v10';

const botHeaders = {
  Authorization: `Bot ${Config.DISCORD_TOKEN}`,
  'Content-Type': 'application/json',
};

export interface APIChannel {
  id: string;
  name: string;
  type: number; // 0=text, 2=voice, 4=category, 13=stage, 15=forum
  parent_id?: string | null;
}

export interface APIRole {
  id: string;
  name: string;
  color: number;
  position: number;
}

export interface APIGuild {
  id: string;
  name: string;
  icon: string | null;
}

export async function getGuildChannels(guildId: string): Promise<APIChannel[]> {
  const res = await fetch(`${API}/guilds/${guildId}/channels`, { headers: botHeaders });
  if (!res.ok) return [];
  const data: APIChannel[] = await res.json();
  return data
    .filter((c) => c.type === 0 || c.type === 2 || c.type === 5) // text, voice, announcement
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getGuildTextChannels(guildId: string): Promise<APIChannel[]> {
  const channels = await getGuildChannels(guildId);
  return channels.filter((c) => c.type === 0 || c.type === 5);
}

export async function getGuildRoles(guildId: string): Promise<APIRole[]> {
  const res = await fetch(`${API}/guilds/${guildId}/roles`, { headers: botHeaders });
  if (!res.ok) return [];
  const data: APIRole[] = await res.json();
  return data
    .filter((r) => r.name !== '@everyone')
    .sort((a, b) => b.position - a.position);
}

export async function getGuild(guildId: string): Promise<APIGuild | null> {
  const res = await fetch(`${API}/guilds/${guildId}`, { headers: botHeaders });
  if (!res.ok) return null;
  return res.json();
}

export function guildIconUrl(guildId: string, icon: string | null): string {
  if (!icon) return `https://cdn.discordapp.com/embed/avatars/0.png`;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png`;
}

export function userAvatarUrl(userId: string, avatar: string | null): string {
  if (!avatar) return `https://cdn.discordapp.com/embed/avatars/0.png`;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
}

// Check if bot is in a guild by attempting to fetch it
export async function botInGuild(guildId: string): Promise<boolean> {
  const g = await getGuild(guildId);
  return g !== null;
}

// Fetch the user's guilds where they have MANAGE_GUILD (0x20) or ADMINISTRATOR (0x8)
export function canManageGuild(permissions: string): boolean {
  const perms = BigInt(permissions);
  return (perms & BigInt(0x8)) !== BigInt(0) || (perms & BigInt(0x20)) !== BigInt(0);
}

// Exchange OAuth code for access token
export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  const clientId = Config.CLIENT_ID;
  const clientSecret = Bun.env.DISCORD_CLIENT_SECRET;
  if (!clientSecret) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) return null;
  const data: any = await res.json();
  return data.access_token ?? null;
}

export async function fetchDiscordUser(token: string): Promise<any | null> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchUserGuilds(token: string): Promise<any[]> {
  const res = await fetch(`${API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}
