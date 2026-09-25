import { hgroup, hsub } from '../../framework/heist.js';
import { card } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import * as rbx from '../../lookups/roblox.js';
import * as tg from '../../lookups/telegram.js';

const DISCORD = 0x5865f2, ROBLOX = 0xe2231a, TELEGRAM = 0x229ed9;
const SNOWFLAKE = /^\d{17,20}$/;

export default hgroup({
  name: 'convert',
  subs: [
    hsub('convert discordid2user', lookup(async i => {
      const id = i.options.getString('user_id', true).trim().replace(/^<@!?|>$/g, '');
      if (!SNOWFLAKE.test(id)) throw new LookupError('That isn\'t a Discord user ID (17–20 digits).');
      const u = await i.client.users.fetch(id).catch(() => null);
      if (!u) throw new LookupError(`No Discord user has the ID \`${id}\`.`);
      await i.editReply(card({ title: u.globalName ?? u.username, url: `https://discord.com/users/${u.id}`, color: DISCORD, thumbnail: u.displayAvatarURL({ size: 256 }),
        fields: [['Username', `@${u.username}`], ['ID', `\`${u.id}\``], ['Mention', `<@${u.id}>`], ['Bot', u.bot ? 'Yes' : null]] }));
    }), { tweaks: { user_id: { maxLength: 25 } } }),
    hsub('convert discorduser2id', lookup(async i => {
      const u = i.options.getUser('user') ?? i.user;
      await i.editReply(card({ title: u.globalName ?? u.username, color: DISCORD, thumbnail: u.displayAvatarURL({ size: 256 }), description: `\`\`\`\n${u.id}\n\`\`\``, fields: [['Username', `@${u.username}`]] }));
    })),
    hsub('convert robloxid2user', lookup(async i => {
      const raw = i.options.getString('user_id', true).trim();
      if (!/^\d{1,15}$/.test(raw)) throw new LookupError('That isn\'t a Roblox user ID.');
      const u = await rbx.userById(Number(raw));
      await i.editReply(card({ title: u.displayName, url: rbx.profileUrl(u.id), color: ROBLOX, fields: [['Username', `@${u.name}`], ['ID', `\`${u.id}\``]], links: [{ label: 'Profile', url: rbx.profileUrl(u.id) }] }));
    }), { tweaks: { user_id: { maxLength: 20 } } }),
    hsub('convert robloxuser2id', lookup(async i => {
      const u = await rbx.userByName(i.options.getString('username', true).trim().replace(/^@/, ''));
      await i.editReply(card({ title: u.displayName, url: rbx.profileUrl(u.id), color: ROBLOX, description: `\`\`\`\n${u.id}\n\`\`\``, fields: [['Username', `@${u.name}`]], links: [{ label: 'Profile', url: rbx.profileUrl(u.id) }] }));
    }), { tweaks: { username: { maxLength: 60 } } }),
    hsub('convert telegramuser2id', lookup(async i => {
      const c = await tg.getChat(i.options.getString('username', true));
      const name = c.title ?? c.first_name ?? c.username ?? 'Telegram chat';
      await i.editReply(card({ title: name, url: c.username ? `https://t.me/${c.username}` : undefined, color: TELEGRAM, description: `\`\`\`\n${c.id}\n\`\`\``, fields: [['Username', c.username ? `@${c.username}` : null], ['Type', c.type]] }));
    }), { tweaks: { username: { maxLength: 40 } } }),
  ],
});
