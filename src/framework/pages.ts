import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, type AttachmentBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { onComponent } from './router.js';

/**
 * Prev / Next paging for a list of Components-V2 containers. Pages live in memory for 15 minutes; only the person who ran the
 * command can turn them (others get a private "run it yourself" note).
 */

export interface Page { container: ContainerBuilder; files?: AttachmentBuilder[] }
interface Book { owner: string; pages: Page[]; at: number }

const TTL_MS = 15 * 60_000;
const books = new Map<string, Book>();

function sweep(now = Date.now()) { for (const [k, b] of books) if (now - b.at > TTL_MS) books.delete(k); }

function nav(id: string, n: number, total: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`pg:${id}:${n - 1}`).setStyle(ButtonStyle.Secondary).setLabel('◀').setDisabled(n <= 0),
    new ButtonBuilder().setCustomId(`pg:${id}:noop`).setStyle(ButtonStyle.Secondary).setLabel(`${n + 1} / ${total}`).setDisabled(true),
    new ButtonBuilder().setCustomId(`pg:${id}:${n + 1}`).setStyle(ButtonStyle.Secondary).setLabel('▶').setDisabled(n >= total - 1),
  );
}

export function pagePayload(id: string, pages: Page[], n: number) {
  const p = pages[n]!;
  const components: unknown[] = [p.container];
  if (pages.length > 1) components.push(nav(id, n, pages.length));
  return { flags: MessageFlags.IsComponentsV2, components, files: p.files ?? [], allowedMentions: { parse: [] as never[] } };
}

/** Replies (or edits the deferred reply) with page 1 and wires up the buttons. */
export async function sendPages(i: ChatInputCommandInteraction, pages: Page[]): Promise<void> {
  if (!pages.length) throw new Error('sendPages: no pages');
  sweep();
  const id = randomBytes(6).toString('hex');
  books.set(id, { owner: i.user.id, pages, at: Date.now() });
  const payload = pagePayload(id, pages, 0);
  if (i.deferred || i.replied) await i.editReply(payload as never); else await i.reply(payload as never);
}

onComponent('pg:', async b => {
  if (!b.isButton()) return;
  const [, id, raw] = b.customId.split(':');
  const book = books.get(id!);
  if (!book) { await b.reply({ content: 'These pages have expired — run the command again.', flags: MessageFlags.Ephemeral }); return; }
  if (b.user.id !== book.owner) { await b.reply({ content: 'Only the person who ran the command can turn these pages.', flags: MessageFlags.Ephemeral }); return; }
  const n = Math.max(0, Math.min(book.pages.length - 1, Number(raw)));
  book.at = Date.now();
  await b.update(pagePayload(id!, book.pages, n) as never);
});

/** Splits lines into pages of `per` lines each. */
export function chunk<T>(xs: T[], per: number): T[][] {
  const out: T[][] = [];
  for (let k = 0; k < xs.length; k += per) out.push(xs.slice(k, k + per));
  return out;
}
