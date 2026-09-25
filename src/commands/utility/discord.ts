import { GuildVerificationLevel, type Invite } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { card, compact, when } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { imageCard, memberOf, profileCard } from '../../subcommands/info/profile.js';
import { cv2Err } from '../../utils/components.js';

const BLURPLE = 0x5865f2;

/** `<:name:id>`, `<a:name:id>`, a bare ID or a CDN link → { id, animated, name }. */
export function parseEmoji(input: string): { id: string; animated: boolean; name?: string } | null {
  const s = input.trim();
  const m = /^<(a)?:([\w~]{1,32}):(\d{17,20})>$/.exec(s);
  if (m) return { animated: !!m[1], name: m[2], id: m[3]! };
  const cdn = /cdn\.discordapp\.com\/emojis\/(\d{17,20})\.(gif|png|webp)/i.exec(s);
  if (cdn) return { id: cdn[1]!, animated: cdn[2]!.toLowerCase() === 'gif' };
  if (/^\d{17,20}$/.test(s)) return { id: s, animated: false };
  return null;
}

/** discord.gg/x, discord.com/invite/x, or a bare code. */
export function parseInvite(input: string): string | null {
  const s = input.trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg)\/([\w-]{2,32})/i.exec(s);
  if (m) return m[1]!;
  return /^[\w-]{2,32}$/.test(s) ? s : null;
}

const VERIFY: Record<number, string> = { [GuildVerificationLevel.None]: 'None', [GuildVerificationLevel.Low]: 'Low', [GuildVerificationLevel.Medium]: 'Medium', [GuildVerificationLevel.High]: 'High', [GuildVerificationLevel.VeryHigh]: 'Highest' };
const FEATURE_NAMES: Record<string, string> = { VERIFIED: '✅ Verified', PARTNERED: '🤝 Partnered', COMMUNITY: 'Community', DISCOVERABLE: 'Discoverable', VANITY_URL: 'Vanity URL', ANIMATED_ICON: 'Animated icon', BANNER: 'Banner', ROLE_ICONS: 'Role icons', GUILD_ONBOARDING: 'Onboarding' };

export default hgroup({
  name: 'discord',
  subs: [
    hsub('discord emoji', async i => {
      const e = parseEmoji(i.options.getString('emoji', true));
      if (!e) { await i.reply(cv2Err('❌ Paste a custom emoji (like `<:name:123…>`), its ID, or its CDN link. Standard emoji like 😀 have no Discord CDN link.')); return; }
      const base = `https://cdn.discordapp.com/emojis/${e.id}`;
      const main = `${base}.${e.animated ? 'gif' : 'png'}?size=4096&quality=lossless`;
      await i.reply(imageCard(`${e.name ? `:${e.name}:` : 'Emoji'} \`${e.id}\``, main, [
        { label: 'PNG', url: `${base}.png?size=4096` }, { label: 'WEBP', url: `${base}.webp?size=4096&quality=lossless${e.animated ? '&animated=true' : ''}` }, ...(e.animated ? [{ label: 'GIF', url: `${base}.gif?size=4096` }] : []),
      ]));
    }, { tweaks: { emoji: { maxLength: 120 } } }),
    hsub('discord server', lookup(async i => {
      const code = parseInvite(i.options.getString('invite', true));
      if (!code) throw new LookupError('That isn\'t an invite link or code.');
      let inv: Invite;
      try { inv = await i.client.fetchInvite(code); } catch { throw new LookupError('That invite is invalid or has expired.'); }
      const g = inv.guild;
      if (!g) throw new LookupError('That invite isn\'t for a server (it may be a group DM invite).');
      const features = g.features.map(f => FEATURE_NAMES[f]).filter(Boolean);
      await i.editReply(card({
        title: g.name, url: `https://discord.gg/${inv.code}`, color: BLURPLE, thumbnail: g.iconURL({ size: 256 }) ?? undefined, image: g.bannerURL({ size: 1024 }) ?? g.splashURL({ size: 1024 }) ?? undefined,
        description: g.description ?? undefined,
        fields: [['ID', `\`${g.id}\``], ['Members', inv.memberCount ? `${compact(inv.memberCount)} (${compact(inv.presenceCount)} online)` : null], ['Boosts', g.premiumSubscriptionCount != null ? String(g.premiumSubscriptionCount) : null],
          ['Verification', VERIFY[g.verificationLevel] ?? null], ['Vanity URL', g.vanityURLCode ? `discord.gg/${g.vanityURLCode}` : null], ['Created', `${when(g.createdTimestamp)} (${when(g.createdTimestamp, 'R')})`],
          ['Invite channel', inv.channel ? `#${inv.channel.name}` : null], ['Invited by', inv.inviter ? `@${inv.inviter.username}` : null], ['Expires', inv.expiresTimestamp ? when(inv.expiresTimestamp, 'R') : 'Never'],
          features.length ? ['Features', features.join(', ')] : null],
        links: [{ label: 'Join', url: `https://discord.gg/${inv.code}` }, ...(g.iconURL() ? [{ label: 'Icon', url: g.iconURL({ size: 4096 })! }] : [])],
      }));
    }), { tweaks: { invite: { maxLength: 100 } } }),
    hsub('discord user', async i => {
      await i.deferReply();
      const u = i.options.getUser('user') ?? i.user;
      await i.editReply(await profileCard(i.client, u, await memberOf(i, u.id)));
    }),
  ],
});
