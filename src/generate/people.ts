import { Routes, type ChatInputCommandInteraction, type GuildMember, type User } from 'discord.js';
import type { Image } from '@napi-rs/canvas';
import { getBufferPublic } from '../framework/http.js';
import { safeLoadImage } from '../framework/imgsafe.js';
import { FONT_IDS, type DisplayFont, type Person } from './discord.js';

/** Turning Discord users into what the /generate renderers draw: name, role colour, avatar, clan tag and name style. */

export async function loadAvatar(url: string | null | undefined, maxSide = 256): Promise<Image | null> {
  if (!url) return null;
  try { return await safeLoadImage(await getBufferPublic(url, { maxBytes: 4 * 1024 * 1024, timeoutMs: 8000 }), { maxSide }); } catch { return null; }
}

/** The raw user object: it carries the clan tag (`primary_guild`) and the name style (`display_name_styles`) when set. */
interface RawUser { primary_guild?: { identity_enabled?: boolean | null; tag?: string | null } | null; display_name_styles?: { font_id?: number; colors?: number[] } | null }
async function rawUser(i: ChatInputCommandInteraction, id: string): Promise<RawUser | null> {
  try { return (await i.client.rest.get(Routes.user(id))) as RawUser; } catch { return null; }
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export interface PersonOpts {
  /** The plain username instead of the display name. */
  useUsername?: boolean;
  hideTag?: boolean;
  /** Force this display font (Heist's display_font). */
  font?: DisplayFont | null;
  /** Use the person's own display-name style (font and gradient) when they have one. */
  ownStyle?: boolean;
}

/** `optionName` is the user option the person came from, so their server nickname/colour/avatar can be used. */
export async function personFor(i: ChatInputCommandInteraction, user: User, o: PersonOpts = {}, optionName?: string): Promise<Person> {
  const m = optionName ? i.options.getMember(optionName) : i.guild?.members.cache.get(user.id) ?? null;
  const member = m && 'displayHexColor' in m ? (m as GuildMember) : null;
  const raw = o.hideTag && !o.ownStyle ? null : await rawUser(i, user.id);
  const color = member && member.displayHexColor !== '#000000' ? member.displayHexColor : null;
  const style = o.ownStyle ? raw?.display_name_styles : null;
  const tag = !o.hideTag && raw?.primary_guild?.identity_enabled !== false && raw?.primary_guild?.tag
    ? { text: raw.primary_guild.tag, badge: await loadAvatar(user.guildTagBadgeURL?.({ size: 32, extension: 'png' }), 32) }
    : null;
  return {
    name: o.useUsername ? user.username : (member?.displayName ?? user.globalName ?? user.username),
    color,
    font: o.font ?? (style?.font_id != null ? FONT_IDS[style.font_id] : undefined),
    gradient: style?.colors && style.colors.length >= 2 ? [hex(style.colors[0]!), hex(style.colors[1]!)] : null,
    avatar: await loadAvatar((member ?? user).displayAvatarURL({ extension: 'png', size: 128, forceStatic: true })),
    tag,
    bot: user.bot,
  };
}
