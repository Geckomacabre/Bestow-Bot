import { MessageFlags, PermissionsBitField } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { card } from '../../lookups/card.js';
import pkg from '../../../package.json' with { type: 'json' };

/** Permissions the bot asks for when invited to a server — enough for its moderation, roles, tickets and media features, and no Administrator. */
export const INVITE_PERMISSIONS = new PermissionsBitField([
  'ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions', 'UseExternalEmojis', 'ManageMessages',
  'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageNicknames', 'Connect', 'Speak', 'MoveMembers',
]);

export function inviteUrl(clientId: string, kind: 'server' | 'user' = 'server'): string {
  const p = new URLSearchParams({ client_id: clientId });
  if (kind === 'user') { p.set('integration_type', '1'); p.set('scope', 'applications.commands'); }
  else { p.set('scope', 'bot applications.commands'); p.set('permissions', INVITE_PERMISSIONS.bitfield.toString()); }
  return `https://discord.com/oauth2/authorize?${p}`;
}

const fmtUptime = (s: number) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' '); };

export const botSubs: Sub[] = [
  {
    name: 'about', description: 'About this bot',
    run: async i => {
      const c = i.client;
      await i.reply({
        ...card({
          title: `${c.user?.username ?? 'Onyx'} v${pkg.version}`, color: 0x5865f2, thumbnail: c.user?.displayAvatarURL({ extension: 'png', size: 256 }),
          description: 'Economy, media tools, lookups, AI and community tooling in one bot — with no tracking and no ads. Try `/help`, and see exactly what\'s stored about you with `/privacy data`.',
          fields: [['Servers', c.guilds.cache.size.toLocaleString('en-US')], ['Uptime', fmtUptime(process.uptime())], ['Runtime', `Bun ${Bun.version}`], ['Memory', `${(process.memoryUsage.rss() / 1048576).toFixed(0)} MB`], ['Ping', `${Math.round(c.ws.ping)} ms`]],
          footer: 'Open source (GPL-3.0-or-later), derived from TMCBot.',
        }), allowedMentions: { parse: [] },
      });
    },
  },
  {
    name: 'invite', description: 'Get links to add the bot to a server or to your own account',
    run: async i => {
      const id = i.client.user?.id ?? i.client.application?.id ?? '';
      await i.reply({
        ...card({
          title: 'Add me', color: 0x57f287, description: '**Server** — full feature set (moderation, roles, tickets, economy…).\n**Your account** — use the fun/lookup/tools commands in any server or DM, no admin needed.',
          links: [{ label: 'Add to a server', url: inviteUrl(id) }, { label: 'Add to my account', url: inviteUrl(id, 'user') }],
        }), flags: MessageFlags.IsComponentsV2,
      });
    },
  },
];
