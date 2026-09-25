import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, TextDisplayBuilder,
  UserSelectMenuBuilder,
  type ChatInputCommandInteraction, type User,
} from 'discord.js';
import { onComponent } from '../framework/router.js';
import { TIERS, renderTierList, type Tier } from './extras.js';
import { loadAvatar } from './people.js';

/**
 * /generate tierlist: a builder with one member picker per tier (S–F). Picking someone for a tier moves them out of any other;
 * Generate renders the list. With `hidden`, the builder is only visible to you and the finished list is posted for everyone.
 * Builders live in memory for 15 minutes and only answer the person who opened them.
 */

const TTL_MS = 15 * 60_000;
interface Builder { owner: string; hidden: boolean; at: number; tiers: Record<Tier, string[]>; users: Map<string, User> }
const builders = new Map<string, Builder>();
const sweep = (now = Date.now()) => { for (const [k, b] of builders) if (now - b.at > TTL_MS) builders.delete(k); };
const emptyTiers = (): Record<Tier, string[]> => Object.fromEntries(TIERS.map(([t]) => [t, []])) as unknown as Record<Tier, string[]>;

export function builderPayload(id: string, b: Builder) {
  const placed = TIERS.reduce((n, [t]) => n + b.tiers[t].length, 0);
  const box = new ContainerBuilder().setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### 🏆 Tier list\nPick people for each tier, then **Generate**. ${placed ? `-# ${placed} placed` : '-# Nobody placed yet'}`));
  for (const [t] of TIERS) {
    const menu = new UserSelectMenuBuilder().setCustomId(`tier:${id}:${t}`).setPlaceholder(`${t} tier`).setMinValues(0).setMaxValues(10);
    if (b.tiers[t].length) menu.setDefaultUsers(...b.tiers[t]);
    box.addActionRowComponents(new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu));
  }
  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`tier:${id}:go`).setLabel('Generate').setStyle(ButtonStyle.Primary).setDisabled(!placed),
    new ButtonBuilder().setCustomId(`tier:${id}:reset`).setLabel('Reset').setStyle(ButtonStyle.Secondary).setDisabled(!placed),
  ));
  return { flags: MessageFlags.IsComponentsV2, components: [box], allowedMentions: { parse: [] as never[] } };
}

export async function openTierBuilder(i: ChatInputCommandInteraction): Promise<void> {
  sweep();
  const id = randomBytes(6).toString('hex');
  const hidden = i.options.getBoolean('hidden') ?? false;
  const b: Builder = { owner: i.user.id, hidden, at: Date.now(), tiers: emptyTiers(), users: new Map() };
  builders.set(id, b);
  const payload = builderPayload(id, b);
  await i.reply({ ...payload, flags: payload.flags | (hidden ? MessageFlags.Ephemeral : 0) } as never);
}

/** Put the picked users in `tier`, taking them out of every other tier. */
export function placeUsers(tiers: Record<Tier, string[]>, tier: Tier, ids: string[]): void {
  for (const [t] of TIERS) if (t !== tier) tiers[t] = tiers[t].filter(x => !ids.includes(x));
  tiers[tier] = [...new Set(ids)];
}

onComponent('tier:', async c => {
  const [, id, what] = c.customId.split(':');
  const b = builders.get(id!);
  if (!b) { await c.reply({ content: 'This tier list builder has expired — run `/generate tierlist` again.', flags: MessageFlags.Ephemeral }); return; }
  if (c.user.id !== b.owner) { await c.reply({ content: 'Only the person who opened this builder can use it.', flags: MessageFlags.Ephemeral }); return; }
  b.at = Date.now();
  if (c.isUserSelectMenu()) {
    for (const u of c.users.values()) b.users.set(u.id, u);
    placeUsers(b.tiers, what as Tier, c.values);
    await c.update(builderPayload(id!, b) as never);
    return;
  }
  if (!c.isButton()) return;
  if (what === 'reset') { b.tiers = emptyTiers(); await c.update(builderPayload(id!, b) as never); return; }
  if (what !== 'go') return;
  await c.deferUpdate();
  const rows = Object.fromEntries(await Promise.all(TIERS.map(async ([t]) => [t, await Promise.all(b.tiers[t].map(async uid => {
    const u = b.users.get(uid) ?? await c.client.users.fetch(uid).catch(() => null);
    return { name: u ? (u.globalName ?? u.username) : 'Unknown', avatar: u ? await loadAvatar(u.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true })) : null };
  }))]))) as Record<Tier, { name: string; avatar: Awaited<ReturnType<typeof loadAvatar>> }[]>;
  const file = new AttachmentBuilder(renderTierList(rows), { name: 'tierlist.png' });
  builders.delete(id!);
  if (b.hidden) {
    await c.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('✅ Posted your tier list.'))] } as never);
    await c.followUp({ files: [file], allowedMentions: { parse: [] } });
  } else {
    const box = new ContainerBuilder().addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://tierlist.png')));
    await c.editReply({ components: [box], files: [file] } as never);
  }
});
