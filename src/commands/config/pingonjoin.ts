import { ChannelType, MessageFlags, PermissionFlagsBits, type AutocompleteInteraction } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { listCard } from '../../lookups/card.js';
import { cv2Box, cv2Err } from '../../utils/components.js';
import * as store from '../../profile/store.js';

/** /pingonjoin: ping new members in up to five channels when they join (the ping deletes itself — see features/pingonjoin). */

const OK = 0x57f287;
const guard = { guildOnly: true, permissions: PermissionFlagsBits.ManageGuild };
const priv = { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral } as const;

async function channelAutocomplete(i: AutocompleteInteraction) {
  if (!i.guildId) { await i.respond([]); return; }
  const list = await store.pingChannels(i.guildId);
  const q = String(i.options.getFocused()).toLowerCase();
  await i.respond(list.map(c => ({ name: `#${i.guild?.channels.cache.get(c.channel_id)?.name ?? c.channel_id}`, value: c.channel_id })).filter(c => c.name.toLowerCase().includes(q)).slice(0, 25));
}

export default hgroup({
  name: 'pingonjoin',
  scope: 'guild',
  subs: [
    hsub('pingonjoin list', async i => {
      const list = await store.pingChannels(i.guildId!);
      await i.reply({ ...listCard('📣 Ping on Join', list.map(c => `• <#${c.channel_id}>${c.message ? ` — ${c.message.slice(0, 80)}` : ''}`), { color: OK, footer: `${list.length}/${store.MAX_PING_CHANNELS} channels · pings delete themselves after a few seconds` }), flags: priv.flags });
    }, guard),
    hsub('pingonjoin remove', async i => {
      const raw = i.options.getString('channel', true).replace(/^<#|>$/g, '');
      const ok = await store.removePingChannel(i.guildId!, raw);
      await i.reply({ ...(ok ? cv2Box(`✅ New members won't be pinged in <#${raw}> any more.`, OK) : cv2Err('❌ That channel isn\'t set up for ping on join.')), flags: priv.flags });
    }, { ...guard, autocomplete: channelAutocomplete, tweaks: { channel: { autocomplete: true, maxLength: 30 } } }),
    hsub('pingonjoin setup', async i => {
      const ch = i.options.getChannel('channel', true);
      const me = i.guild?.members.me;
      const perms = me && 'permissionsFor' in (ch as object) ? (ch as unknown as { permissionsFor(m: unknown): { has(p: bigint[]): boolean } | null }).permissionsFor(me) : null;
      if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages])) {
        await i.reply({ ...cv2Err(`❌ I need **View Channel**, **Send Messages** and **Manage Messages** in <#${ch.id}>.`), flags: priv.flags }); return;
      }
      const r = await store.addPingChannel(i.guildId!, ch.id, i.options.getString('message'), i.user.id);
      if (r === 'full') { await i.reply({ ...cv2Err(`❌ You can ping in up to ${store.MAX_PING_CHANNELS} channels. Remove one first.`), flags: priv.flags }); return; }
      await i.reply({ ...cv2Box(`✅ New members will be pinged in <#${ch.id}>${r === 'updated' ? ' (message updated)' : ''}. Use \`{user}\` and \`{server}\` in the message.`, OK), flags: priv.flags });
    }, { ...guard, tweaks: { channel: { channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement] }, message: { maxLength: 300 } } }),
    hsub('pingonjoin stop', async i => {
      const n = await store.clearPingChannels(i.guildId!);
      await i.reply({ ...(n ? cv2Box(`✅ Ping on join is off (removed ${n} channel${n === 1 ? '' : 's'}).`, OK) : cv2Err('❌ Ping on join isn\'t set up here.')), flags: priv.flags });
    }, guard),
  ],
});
