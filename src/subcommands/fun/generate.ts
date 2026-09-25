import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder, User } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { getBufferPublic } from '../../framework/http.js';
import { safeLoadImage } from '../../framework/imgsafe.js';
import { sendBuffer } from '../../framework/media.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { colorFor, MAX_MESSAGES, MAX_TEXT, renderChat, renderRip, type ChatLine, type Theme } from '../../generate/render.js';
import { parseColor, toHex, ColorError } from '../../lookups/color.js';

const name = (u: User) => u.displayName ?? u.username;

async function avatar(u: User) {
  try { return await safeLoadImage(await getBufferPublic(u.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }), { maxBytes: 2 * 1024 * 1024, timeoutMs: 8000 }), { maxSide: 256 }); } catch { return null; }
}

const timeOf = (i: ChatInputCommandInteraction, custom?: string | null) => custom?.trim() || `Today at ${new Date(i.createdTimestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
const themeOpt = (s: SlashCommandSubcommandBuilder) => s.addStringOption(o => o.setName('theme').setDescription('Dark (default) or light').addChoices({ name: 'Dark', value: 'dark' }, { name: 'Light', value: 'light' }));
const theme = (i: ChatInputCommandInteraction) => (i.options.getString('theme') ?? 'dark') as Theme;
const textOpt = (s: SlashCommandSubcommandBuilder, n = 'text', d = 'What they said') => s.addStringOption(o => o.setName(n).setDescription(d).setRequired(true).setMaxLength(MAX_TEXT));
const userOpt = (s: SlashCommandSubcommandBuilder, n = 'user', d = 'Who said it') => s.addUserOption(o => o.setName(n).setDescription(d).setRequired(true));

function color(input: string | null): string | undefined {
  if (!input) return undefined;
  try { return toHex(parseColor(input)); } catch (e) { if (e instanceof ColorError) throw new LookupError(e.message); throw e; }
}

export const generateSubs: Sub[] = [
  {
    name: 'message', description: 'Make a fake Discord message (a joke image, watermarked)',
    options: s => { userOpt(s); textOpt(s); themeOpt(s); return s.addStringOption(o => o.setName('time').setDescription('Timestamp text (default: now)').setMaxLength(30)).addStringOption(o => o.setName('color').setDescription('Name colour, e.g. #f47b67')); },
    run: lookup(async i => {
      const u = i.options.getUser('user', true);
      const png = renderChat([{ name: name(u), color: color(i.options.getString('color')), avatar: await avatar(u), text: i.options.getString('text', true), time: timeOf(i, i.options.getString('time')) }], { theme: theme(i) });
      await sendBuffer(i, png, 'message.png');
    }),
  },
  {
    name: 'reply', description: 'Make a fake Discord reply (a joke image, watermarked)',
    options: s => { userOpt(s); textOpt(s); userOpt(s, 'replying_to', 'Who they are replying to'); textOpt(s, 'original', 'What the original message said'); return themeOpt(s); },
    run: lookup(async i => {
      const u = i.options.getUser('user', true), t = i.options.getUser('replying_to', true);
      const png = renderChat([{ name: name(u), avatar: await avatar(u), text: i.options.getString('text', true), time: timeOf(i), replyTo: { name: name(t), text: i.options.getString('original', true) } }], { theme: theme(i) });
      await sendBuffer(i, png, 'reply.png');
    }),
  },
  {
    name: 'convo', description: 'Make a fake conversation between two people (a joke image, watermarked)',
    options: s => {
      userOpt(s, 'user1', 'First person'); userOpt(s, 'user2', 'Second person');
      s.addStringOption(o => o.setName('lines').setDescription('Alternate speakers with " | ", starting with person 1: hi | hey! | how are you').setRequired(true).setMaxLength(1200));
      return themeOpt(s);
    },
    run: lookup(async i => {
      const a = i.options.getUser('user1', true), b = i.options.getUser('user2', true);
      const parts = i.options.getString('lines', true).split('|').map(x => x.trim()).filter(Boolean);
      if (!parts.length) throw new LookupError('Give me at least one line, separated by ` | `.');
      if (parts.length > MAX_MESSAGES) throw new LookupError(`That's ${parts.length} lines — the maximum is ${MAX_MESSAGES}.`);
      const [av1, av2] = await Promise.all([avatar(a), avatar(b)]);
      const lines: ChatLine[] = parts.map((text, n) => ({ name: name(n % 2 ? b : a), avatar: n % 2 ? av2 : av1, text, time: n === 0 ? timeOf(i) : undefined, color: n % 2 ? colorFor(name(b)) : colorFor(name(a)) }));
      await sendBuffer(i, renderChat(lines, { theme: theme(i) }), 'convo.png');
    }),
  },
  {
    name: 'rip', description: 'Make a tombstone for someone (or something)',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Who to bury'))
      .addStringOption(o => o.setName('name').setDescription('…or a name/thing to bury').setMaxLength(60))
      .addStringOption(o => o.setName('epitaph').setDescription('What the stone says').setMaxLength(120))
      .addStringOption(o => o.setName('dates').setDescription('e.g. 2020 – 2026').setMaxLength(30)),
    run: lookup(async i => {
      const u = i.options.getUser('user'), n = i.options.getString('name');
      if (!u && !n) throw new LookupError('Pick a user or give a name to bury.');
      const year = new Date().getFullYear();
      const png = renderRip({ name: n ?? name(u!), avatar: u ? await avatar(u) : null, epitaph: i.options.getString('epitaph') ?? undefined, dates: i.options.getString('dates') ?? `? – ${year}` });
      await sendBuffer(i, png, 'rip.png');
    }),
  },
];
