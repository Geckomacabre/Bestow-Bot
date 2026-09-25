import {
  ActionRowBuilder, ContainerBuilder, MessageFlags, StringSelectMenuBuilder, TextDisplayBuilder, type ChatInputCommandInteraction,
} from 'discord.js';
import { hleaf } from '../../framework/heist.js';
import { onComponent } from '../../framework/router.js';
import { getAccent, toHex } from '../../customize/accent.js';
import { privacySubs } from '../../subcommands/privacy/privacy.js';
import { colorPanel } from './customize.js';
import * as db from '../../utils/db.js';
import { listTags } from '../../tags/store.js';
import { userById } from '../../profile/store.js';

/** /settings — Heist's one-stop panel: what's set for you, and a menu to change it or manage your data. */

const OPTIONS = [
  { value: 'color', label: 'Embed color', description: 'The color of the cards Bestow sends you (✨)', emoji: '🎨' },
  { value: 'policy', label: 'Privacy policy', description: 'What Bestow stores and what it never does', emoji: '🔒' },
  { value: 'data', label: 'My data', description: 'See what Bestow has stored about you', emoji: '📂' },
  { value: 'export', label: 'Export my data', description: 'Download it all as a file', emoji: '📦' },
  { value: 'delete', label: 'Delete my data', description: 'Erase everything (asks first)', emoji: '🗑️' },
] as const;

async function panel(userId: string) {
  const [accent, tz, tags, me] = await Promise.all([getAccent(userId), db.getTimezone(userId), listTags(userId), userById(userId)]);
  const lines = [
    '## ⚙ Settings',
    `**Embed color:** ${accent != null ? `\`${toHex(accent)}\`` : 'default'}`,
    `**Timezone:** ${tz?.timezone?.replace(/_/g, ' ') ?? 'not set'} · change with \`/timezone set\``,
    `**Tags:** ${tags.length} · manage with \`/tags\``,
    me ? `**Bestow UID:** #${me.uid}` : null,
  ].filter(Boolean).join('\n');
  const c = new ContainerBuilder().setAccentColor(accent ?? 0x5865f2).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines))
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('set:menu').setPlaceholder('Choose a setting…').addOptions(OPTIONS.map(o => ({ ...o })))));
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [c] };
}

onComponent('set:', async i => {
  if (!i.isStringSelectMenu() || i.customId !== 'set:menu') return;
  const pick = i.values[0];
  if (pick === 'color') { await i.reply({ ...(await colorPanel(i.user.id)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }); return; }
  // The privacy handlers only use reply/deferReply/editReply, which a menu interaction has too.
  const sub = privacySubs.find(s => s.name === pick);
  if (sub) await sub.run(i as unknown as ChatInputCommandInteraction);
});

export default hleaf('settings', async i => { await i.reply(await panel(i.user.id)); });
