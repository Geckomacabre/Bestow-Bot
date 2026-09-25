import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, EmbedBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  MessageFlags, TextDisplayBuilder, type ButtonInteraction, type SlashCommandSubcommandBuilder, type User,
} from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { HttpError, getBuffer } from '../../framework/http.js';
import { cv2File } from '../../utils/components.js';
import { card } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { renderCoinFlipGif, FLIP_REVEAL_MS } from '../../utils/coinFlip.js';
import { petpetGif } from '../../fun/petpet.js';
import * as social from '../../fun/social.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const coin = () => (crypto.getRandomValues(new Uint8Array(1))[0]! & 1 ? 'heads' : 'tails') as 'heads' | 'tails';
const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });
const noMentions = { parse: [] as never[] };

// ─── /roleplay ───────────────────────────────────────────────────────────────

export const roleplaySub: Sub = {
  name: 'roleplay', description: 'Roleplay actions have moved to /action',
  run: async i => { await i.reply({ content: 'Roleplay actions live in `/action` now — try `/action do:Hug user:@someone`.', flags: MessageFlags.Ephemeral }); },
};

// ─── /button ─────────────────────────────────────────────────────────────────

const STYLES: Record<string, ButtonStyle> = { blurple: ButtonStyle.Primary, green: ButtonStyle.Success, grey: ButtonStyle.Secondary, red: ButtonStyle.Danger, link: ButtonStyle.Link };

/** Whether `text` is a usable link for a link-style button (http/https only). */
export function linkOk(text: string): boolean {
  try { const u = new URL(text.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

export const buttonSub: Sub = {
  name: 'button', description: 'Create a button',
  options: s => s
    .addStringOption(o => o.setName('title').setDescription('Button title').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('text').setDescription('Text sent when button is clicked').setRequired(true).setMaxLength(1900))
    .addStringOption(o => o.setName('style').setDescription('Button style').addChoices(...Object.keys(STYLES).map(k => ({ name: k, value: k }))))
    .addIntegerOption(o => o.setName('timeout').setDescription('Time before disabling the button (default 60s)').setMinValue(5).setMaxValue(840)),
  async run(i) {
    const title = i.options.getString('title', true), text = i.options.getString('text', true);
    const style = i.options.getString('style') ?? 'blurple';
    const seconds = i.options.getInteger('timeout') ?? 60;
    const make = (disabled: boolean) => {
      const b = new ButtonBuilder().setLabel(title).setStyle(STYLES[style] ?? ButtonStyle.Primary).setDisabled(disabled);
      return new ActionRowBuilder<ButtonBuilder>().addComponents(style === 'link' ? b.setURL(text.trim()) : b.setCustomId('button:click'));
    };
    if (style === 'link') {
      if (!linkOk(text)) { await i.reply(ephemeral('A link button needs a full `https://…` link as its text.')); return; }
      await i.reply({ components: [make(false)] });
      setTimeout(() => { void i.editReply({ components: [make(true)] }).catch(() => {}); }, seconds * 1000);
      return;
    }
    await i.reply({ components: [make(false)] });
    const msg = await i.fetchReply();
    const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: seconds * 1000 });
    col.on('collect', async (b: ButtonInteraction) => { await b.reply({ content: text, allowedMentions: noMentions }); });
    col.on('end', async () => { await i.editReply({ components: [make(true)] }).catch(() => {}); });
  },
};

// ─── /coinflip ───────────────────────────────────────────────────────────────

export const coinflipSub: Sub = {
  name: 'coinflip', description: 'Flip a coin',
  options: s => s.addIntegerOption(o => o.setName('rounds').setDescription('How many coins to flip').addChoices(...[1, 2, 3, 4, 5].map(n => ({ name: String(n), value: n })))),
  async run(i) {
    const rounds = Math.min(5, Math.max(1, i.options.getInteger('rounds') ?? 1));
    const flips = Array.from({ length: rounds }, coin);
    const face = (f: 'heads' | 'tails') => (f === 'heads' ? '🟡 Heads' : '⚪ Tails');
    if (rounds > 1) {
      const heads = flips.filter(f => f === 'heads').length;
      await i.reply({ ...card({ title: `🪙 ${rounds} coin flips`, color: 0xfee75c, description: flips.map((f, n) => `**${n + 1}.** ${face(f)}`).join('\n'), footer: `${heads} heads · ${rounds - heads} tails` }) });
      return;
    }
    const result = flips[0]!;
    const gif = await renderCoinFlipGif(result);
    await i.reply(cv2File(gif, 'gif', '🪙 Flipping…'));
    await sleep(FLIP_REVEAL_MS);
    // Editing only the components keeps the already-uploaded GIF, so the animation doesn't restart.
    const c = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`🪙 **${face(result)}!**`))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://result.gif')));
    await i.editReply({ components: [c] }).catch(() => {});
  },
};

// ─── /emojimix ───────────────────────────────────────────────────────────────

/** The emoji (as grapheme clusters, so skin tones and ZWJ sequences stay whole) in a piece of text. */
export function parseEmojis(input: string): string[] {
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return [...seg.segment(input)].map(s => s.segment).filter(g => /\p{Extended_Pictographic}/u.test(g));
}

export const emojimixSub: Sub = {
  name: 'emojimix', description: 'Mix two emojis together',
  options: s => s.addStringOption(o => o.setName('emojis').setDescription('Two emojis to mix together').setRequired(true).setMaxLength(60)),
  run: lookup(async i => {
    const found = parseEmojis(i.options.getString('emojis', true));
    if (found.length !== 2) throw new LookupError('Give me exactly **two** emojis to mix, like `😀 🔥`.');
    const url = `https://emojik.vercel.app/s/${encodeURIComponent(found[0]!)}_${encodeURIComponent(found[1]!)}?size=256`;
    let png: Buffer;
    try { png = await getBuffer(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000 }); }
    catch (err) { if (err instanceof HttpError && [400, 404].includes(err.status)) throw new LookupError(`${found[0]} + ${found[1]} can't be mixed — not every pair has a combination. Try another!`); throw err; }
    await i.editReply(cv2File(png, 'png', `${found[0]} + ${found[1]}`));
  }),
};

// ─── /nitro ──────────────────────────────────────────────────────────────────

export const nitroSub: Sub = {
  name: 'nitro', description: 'Why not send a little gift?',
  options: s => s.addStringOption(o => o.setName('legacy').setDescription('Use the old embed style instead of the new container layout').addChoices({ name: 'yes', value: 'yes' }, { name: 'no', value: 'no' })),
  async run(i) {
    const accept = (disabled: boolean) => new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('nitro:accept').setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('🎁').setDisabled(disabled));
    const text = `**A WILD GIFT APPEARS!**\n<@${i.user.id}> sent you **1 month of Nitro**.`;
    if (i.options.getString('legacy') === 'yes') {
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('A WILD GIFT APPEARS!').setDescription(`<@${i.user.id}> sent you **1 month of Nitro**.`);
      await i.reply({ embeds: [embed], components: [accept(false)], allowedMentions: noMentions });
    } else {
      await i.reply({ flags: MessageFlags.IsComponentsV2, allowedMentions: noMentions, components: [new ContainerBuilder().setAccentColor(0x5865f2).addTextDisplayComponents(new TextDisplayBuilder().setContent(text)).addActionRowComponents(accept(false))] });
    }
    const msg = await i.fetchReply();
    const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 10 * 60_000 });
    col.on('collect', async (b: ButtonInteraction) => {
      await b.reply(ephemeral(`🎁 Gotcha — that was a joke gift from <@${i.user.id}>. There's nothing to claim, but thanks for clicking!`));
    });
    col.on('end', async () => {
      const done = new ContainerBuilder().setAccentColor(0x99aab5).addTextDisplayComponents(new TextDisplayBuilder().setContent(`${text}\n*This gift has expired.*`)).addActionRowComponents(accept(true));
      await i.editReply(i.options.getString('legacy') === 'yes' ? { components: [accept(true)] } : { components: [done] }).catch(() => {});
    });
  },
};

// ─── /petpet + Pet User ──────────────────────────────────────────────────────

/** The pet-pet GIF for a user's avatar. */
export async function petpetFor(user: Pick<User, 'displayAvatarURL'>): Promise<Buffer> {
  const url = user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
  return petpetGif(await getBuffer(url, { maxBytes: 4 * 1024 * 1024 }));
}

export const petpetSub: Sub = {
  name: 'petpet', description: 'Pet someone\'s avatar',
  options: s => s.addUserOption(o => o.setName('user').setDescription('User to pet (defaults to you)')),
  run: lookup(async i => {
    const target = i.options.getUser('user') ?? i.user;
    const gif = await petpetFor(target);
    await i.editReply({ ...cv2File(gif, 'gif', `<@${i.user.id}> pets <@${target.id}>`), allowedMentions: noMentions });
  }),
};

// ─── /rating hotcalc ─────────────────────────────────────────────────────────

const HOT: [number, string][] = [
  [25, '🧊 Cool as ice — that\'s a compliment.'], [50, '🌤️ Comfortably warm.'], [75, '🔥 Definitely hot.'], [100, '🌋 Volcanic. Somebody call the fire department.'],
];

export const hotcalcSub: Sub = {
  name: 'hotcalc', description: 'Check how hot someone is',
  options: (s: SlashCommandSubcommandBuilder) => s.addUserOption(o => o.setName('user').setDescription('The user you want to check').setRequired(true)),
  run: lookup(async i => {
    const t = i.options.getUser('user') ?? i.user;
    const pct = social.rate(`hot:${t.id}`);
    await i.editReply(card({ title: '🔥 Hot-o-meter', color: 0xf26522, description: `<@${t.id}> is **${pct}%** hot today.\n${HOT.find(([max]) => pct <= max)![1]}`, footer: 'Just for fun — the answer changes daily.' }));
  }),
};
