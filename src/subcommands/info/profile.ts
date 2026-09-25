import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SectionBuilder,
  SeparatorBuilder, TextDisplayBuilder, ThumbnailBuilder, UserFlagsBitField, type ChatInputCommandInteraction, type Client, type GuildMember, type User,
} from 'discord.js';
import { cv2Err } from '../../utils/components.js';
import { when } from '../../lookups/card.js';

/** Avatar / banner / profile views shared by /avatar, /banner, /serveravatar, /serverbanner, /discord user and the View Profile menu. */

const BLURPLE = 0x5865f2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function imageCard(title: string, url: string, links: { label: string; url: string }[] = [], color = BLURPLE): any {
  const c = new ContainerBuilder().setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)));
  if (links.length) c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(links.map(l => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(l.label).setURL(l.url))));
  return { flags: MessageFlags.IsComponentsV2, components: [c], allowedMentions: { parse: [] } };
}

/** PNG / WEBP / (GIF when animated) download buttons for a Discord CDN image. */
export function formatLinks(url: string): { label: string; url: string }[] {
  const base = url.split('?')[0]!.replace(/\.(png|webp|gif|jpg|jpeg)$/i, '');
  const animated = /\/a_[0-9a-f]+/.test(base);
  return [
    { label: 'PNG', url: `${base}.png?size=4096` },
    { label: 'WEBP', url: `${base}.webp?size=4096` },
    ...(animated ? [{ label: 'GIF', url: `${base}.gif?size=4096` }] : []),
  ];
}

const nameOf = (u: User) => u.globalName ?? u.username;

export async function showAvatar(i: ChatInputCommandInteraction) {
  const u = i.options.getUser('user') ?? i.user;
  const url = u.displayAvatarURL({ size: 4096 });
  await i.reply(imageCard(`${nameOf(u)}'s avatar`, url, formatLinks(url)));
}

export async function showBanner(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const u = await i.client.users.fetch((i.options.getUser('user') ?? i.user).id, { force: true });
  const url = u.bannerURL({ size: 4096 });
  if (!url) {
    await i.editReply(cv2Err(`❌ ${u.id === i.user.id ? 'You don\'t' : `**${nameOf(u)}** doesn't`} have a banner.`));
    return;
  }
  await i.editReply(imageCard(`${nameOf(u)}'s banner`, url, formatLinks(url), u.accentColor ?? BLURPLE));
}

async function memberOf(i: ChatInputCommandInteraction, id: string, force = false): Promise<GuildMember | null> {
  if (!i.inGuild() || !i.guild) return null;
  return i.guild.members.fetch({ user: id, force }).catch(() => null);
}

export async function showServerAvatar(i: ChatInputCommandInteraction) {
  const u = i.options.getUser('member') ?? i.user;
  const m = await memberOf(i, u.id);
  const url = m?.avatarURL({ size: 4096 });
  if (!url) {
    await i.reply(cv2Err(i.guild ? `❌ ${u.id === i.user.id ? 'You don\'t' : `**${nameOf(u)}** doesn't`} have a server avatar here.` : '❌ Server avatars need the bot to be in this server.'));
    return;
  }
  await i.reply(imageCard(`${m!.displayName}'s server avatar`, url, formatLinks(url)));
}

export async function showServerBanner(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const u = i.options.getUser('member') ?? i.user;
  const m = await memberOf(i, u.id, true);
  const url = m?.bannerURL({ size: 4096 });
  if (!url) {
    await i.editReply(cv2Err(i.guild ? `❌ ${u.id === i.user.id ? 'You don\'t' : `**${nameOf(u)}** doesn't`} have a server banner here.` : '❌ Server banners need the bot to be in this server.'));
    return;
  }
  await i.editReply(imageCard(`${m!.displayName}'s server banner`, url, formatLinks(url)));
}

const BADGES: Partial<Record<keyof typeof UserFlagsBitField.Flags, string>> = {
  Staff: 'Discord Staff', Partner: 'Partnered Server Owner', Hypesquad: 'HypeSquad Events', BugHunterLevel1: 'Bug Hunter', BugHunterLevel2: 'Bug Hunter (Gold)',
  HypeSquadOnlineHouse1: 'HypeSquad Bravery', HypeSquadOnlineHouse2: 'HypeSquad Brilliance', HypeSquadOnlineHouse3: 'HypeSquad Balance', PremiumEarlySupporter: 'Early Supporter',
  VerifiedDeveloper: 'Early Verified Bot Developer', CertifiedModerator: 'Moderator Programs Alumni', ActiveDeveloper: 'Active Developer', VerifiedBot: 'Verified Bot',
};

export function badgesOf(u: User): string[] {
  const flags = u.flags?.toArray() ?? [];
  return flags.map(f => BADGES[f as keyof typeof BADGES]).filter((x): x is string => !!x);
}

/** The profile card for /discord user and the View Profile menu. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function profileCard(client: Client, target: User, member: GuildMember | null): Promise<any> {
  const u = await client.users.fetch(target.id, { force: true }).catch(() => target);
  const badges = badgesOf(u);
  const lines = [
    `### ${nameOf(u)}${u.bot ? ' `APP`' : ''}`,
    `@${u.username}${u.discriminator && u.discriminator !== '0' ? `#${u.discriminator}` : ''} · \`${u.id}\``,
    '',
    `**Created:** ${when(u.createdTimestamp, 'f')} (${when(u.createdTimestamp, 'R')})`,
    member?.joinedTimestamp ? `**Joined server:** ${when(member.joinedTimestamp, 'f')} (${when(member.joinedTimestamp, 'R')})` : null,
    member?.nickname ? `**Nickname:** ${member.nickname}` : null,
    member ? `**Roles:** ${member.roles.cache.size > 1 ? member.roles.cache.filter(r => r.id !== member.guild.id).sort((a, b) => b.position - a.position).first(10).map(r => `<@&${r.id}>`).join(' ') : 'None'}` : null,
    member?.premiumSinceTimestamp ? `**Boosting since:** ${when(member.premiumSinceTimestamp, 'R')}` : null,
    badges.length ? `**Badges:** ${badges.join(', ')}` : null,
  ].filter((x): x is string => x !== null);
  const avatar = (member?.avatarURL({ size: 512 }) ?? u.displayAvatarURL({ size: 512 }));
  const c = new ContainerBuilder().setAccentColor(u.accentColor ?? member?.displayColor ?? BLURPLE)
    .addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n'))).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  const banner = u.bannerURL({ size: 1024 });
  if (banner) c.addSeparatorComponents(new SeparatorBuilder()).addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(banner)));
  c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Profile').setURL(`https://discord.com/users/${u.id}`),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Avatar').setURL(u.displayAvatarURL({ size: 4096 })),
    ...(banner ? [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Banner').setURL(u.bannerURL({ size: 4096 })!)] : []),
  ));
  return { flags: MessageFlags.IsComponentsV2, components: [c], allowedMentions: { parse: [] } };
}

/** OAuth2 link that adds another bot to a server. */
export const botInviteUrl = (id: string) => `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot%20applications.commands`;

export async function getBotInvite(i: ChatInputCommandInteraction) {
  const u = i.options.getUser('user', true);
  if (!u.bot) { await i.reply(cv2Err(`❌ **${nameOf(u)}** isn't a bot.`)); return; }
  const c = new ContainerBuilder().setAccentColor(BLURPLE)
    .addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Invite ${nameOf(u)}\n\`${u.id}\`\n${botInviteUrl(u.id)}`)).setThumbnailAccessory(new ThumbnailBuilder().setURL(u.displayAvatarURL({ size: 256 }))))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Add ${nameOf(u)}`.slice(0, 80)).setURL(botInviteUrl(u.id))));
  await i.reply({ flags: MessageFlags.IsComponentsV2, components: [c], allowedMentions: { parse: [] } });
}

export { memberOf };
