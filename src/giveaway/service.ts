import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
  type ButtonInteraction, type Client,
} from 'discord.js';
import { GIVEAWAY_TAX, dueGiveaways, endGiveaway, entryCount, getGiveaway, toggleEntry, winnerList, payoutPerWinner, type Ended, type Giveaway } from './core.js';

const ts = (ms: number, style: 'R' | 'f' = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const mention = (ids: string[]) => ids.map(id => `<@${id}>`).join(', ');
const COLOR = { active: 0xeb459e, ended: 0x57f287, cancelled: 0x99aab5 } as const;

/** The giveaway message in each state. Only an active one has an Enter button. */
export function giveawayView(g: Giveaway, entries: number) {
  const c = new ContainerBuilder().setAccentColor(COLOR[g.status]);
  const lines = [`## 🎉 ${g.prize}`];
  if (g.pot > 0) lines.push(`💰 Prize pool: **${g.pot.toLocaleString('en-US')}** (${Math.round(GIVEAWAY_TAX * 100)}% tax on payout)`);
  if (g.status === 'active') lines.push(`Ends ${ts(g.ends_at)} (${ts(g.ends_at, 'f')})`, `Hosted by <@${g.host_id}>`, `Winners: **${g.winners}**`, `Entries: **${entries.toLocaleString('en-US')}**`);
  else if (g.status === 'cancelled') lines.push('❌ **This giveaway was cancelled.**', `Hosted by <@${g.host_id}>`);
  else {
    const w = winnerList(g);
    lines.push(`Ended ${ts(g.ends_at)}`, `Hosted by <@${g.host_id}>`, `Entries: **${entries.toLocaleString('en-US')}**`, w.length ? `🏆 Winner${w.length === 1 ? '' : 's'}: ${mention(w)}` : '😢 Nobody entered, so there is no winner.');
  }
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  if (g.image_url && /^https:\/\//.test(g.image_url)) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(g.image_url)));
  if (g.status === 'active') {
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`gw:enter:${g.id}`).setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Primary)));
  }
  return { flags: MessageFlags.IsComponentsV2 as const, components: [c], allowedMentions: { parse: [] as never[] } };
}

/** What gets said in the channel when a giveaway ends. */
export function announcement(e: Ended): string {
  const g = e.giveaway;
  if (!e.winners.length) return `😢 Nobody entered the giveaway for **${g.prize}**${g.pot > 0 ? ' — the prize pool was refunded to the host' : ''}.`;
  const each = g.pot > 0 ? ` and **${payoutPerWinner(g.pot, e.winners.length).toLocaleString('en-US')}** each` : '';
  return `🎉 Congratulations ${mention(e.winners)}! You won **${g.prize}**${each}. Hosted by <@${g.host_id}>.`;
}

/** The slice of a Discord channel/message this needs — tests pass fakes. */
export interface GwChannel {
  send(p: unknown): Promise<unknown>;
  messages: { fetch(id: string): Promise<{ edit(p: unknown): Promise<unknown>; id: string }> };
}
export type FetchChannel = (channelId: string) => Promise<GwChannel | null>;
export const clientFetch = (client: Client): FetchChannel => async id => ((await client.channels.fetch(id).catch(() => null)) as unknown as GwChannel | null);

/** Ends one giveaway and updates its message + announces the result. Safe to call twice: only the first does anything. */
export async function finishGiveaway(id: number, fetchChannel: FetchChannel): Promise<Ended | undefined> {
  const ended = await endGiveaway(id);
  if (!ended) return undefined;
  const g = ended.giveaway;
  const channel = await fetchChannel(g.channel_id);
  if (!channel) return ended; // channel deleted / no access: the result is stored, there's just nowhere to post it
  const view = giveawayView(g, ended.entries);
  if (g.message_id) await channel.messages.fetch(g.message_id).then(m => m.edit(view)).catch(() => {});
  await channel.send({ content: announcement(ended), allowedMentions: { users: ended.winners }, ...(g.message_id ? { reply: { messageReference: g.message_id, failIfNotExists: false } } : {}) }).catch(() => {});
  return ended;
}

/** One scheduler pass: end everything that is due. */
export async function tick(fetchChannel: FetchChannel, now = Date.now()): Promise<number> {
  let n = 0;
  for (const g of await dueGiveaways(now)) {
    try { if (await finishGiveaway(g.id, fetchChannel)) n++; } catch (err) { console.error(`[giveaway] failed to end #${g.id}:`, (err as Error).message); }
  }
  return n;
}

export function startGiveawayScheduler(client: Client): void {
  const run = () => tick(clientFetch(client)).catch(err => console.error('[giveaway] tick failed:', (err as Error).message));
  void run();
  setInterval(run, 10_000).unref?.();
}

const say = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

/** The Enter button: join, or press again to leave. Updates the entry count on the message. */
export async function handleEnterButton(i: ButtonInteraction): Promise<void> {
  const id = Number(i.customId.split(':')[2]);
  if (!Number.isInteger(id)) { await i.reply(say('That giveaway button is invalid.')); return; }
  const r = await toggleEntry(id, i.user.id);
  if (r === 'missing') { await i.reply(say('I can\'t find that giveaway any more.')); return; }
  if (r === 'ended') { await i.reply(say('This giveaway has already ended.')); return; }
  const g = (await getGiveaway(id))!;
  await i.update(giveawayView(g, await entryCount(id)));
  await i.followUp(say(r === 'entered' ? '✅ You\'re in! Press the button again to leave.' : '👋 You left the giveaway.')).catch(() => {});
}
