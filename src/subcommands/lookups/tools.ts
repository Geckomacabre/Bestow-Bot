import { AttachmentBuilder } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { findMedia, mediaOptions, sendBuffer } from '../../framework/media.js';
import { card, listCard, trunc, when } from '../../lookups/card.js';
import { lookup, LookupError, nsfwOk } from '../../lookups/handler.js';
import { evaluate, formatNumber, MathError } from '../../lookups/mathx.js';
import * as col from '../../lookups/color.js';
import { swatch } from '../../lookups/swatch.js';
import { convertAny } from '../../lookups/convert.js';
import { makeQr, scanQrUrl } from '../../lookups/qr.js';
import * as w from '../../lookups/web.js';
import * as t from '../../lookups/textfun.js';

const str = (name: string, d: string, max = 200, required = true) => (s: import('discord.js').SlashCommandSubcommandBuilder) =>
  s.addStringOption(o => o.setName(name).setDescription(d).setRequired(required).setMaxLength(max));

const attachOf = (buf: Buffer, name: string) => new AttachmentBuilder(buf, { name });

/** Colour parsing that turns ColorError into a normal lookup error. */
function color(input: string): col.RGB {
  try { return col.parseColor(input); } catch (e) { if (e instanceof col.ColorError) throw new LookupError(e.message); throw e; }
}

export const toolsSubs: Sub[] = [
  {
    name: 'qr', description: 'Generate a QR code from text or a link',
    options: s => str('text', 'What to put in the QR code', 1000)(s)
      .addStringOption(o => o.setName('color').setDescription('Foreground colour (default black), e.g. #5865f2'))
      .addStringOption(o => o.setName('background').setDescription('Background colour (default white)')),
    run: lookup(async i => {
      const dark = i.options.getString('color'), light = i.options.getString('background');
      const png = await makeQr(i.options.getString('text', true), { dark: dark ? col.toHex(color(dark)) : undefined, light: light ? col.toHex(color(light)) : undefined });
      await sendBuffer(i, png, 'qr.png');
    }),
  },
  {
    name: 'qr-scan', description: 'Read the QR code in an image',
    options: s => mediaOptions('image', s),
    run: lookup(async i => {
      const ref = await findMedia(i, 'image');
      const text = await scanQrUrl(ref.url);
      const isUrl = /^https?:\/\/\S+$/i.test(text);
      await i.editReply(card({ title: 'QR code contents', color: 0x5865f2, description: `\`\`\`\n${trunc(text, 1500)}\n\`\`\``, footer: isUrl ? 'This is a link — check where it goes before you open it.' : undefined }));
    }),
  },
  {
    name: 'color', description: 'Inspect a colour: hex, RGB, HSL, CMYK and contrast', options: str('color', 'Hex, rgb(), hsl() or a name like coral', 40),
    run: lookup(async i => {
      const c = color(i.options.getString('color', true)), hsl = col.rgbToHsl(c), k = col.rgbToCmyk(c);
      await i.editReply(card({
        title: col.toHex(c).toUpperCase(), color: col.toDecimal(c), image: 'attachment://color.png', files: [attachOf(swatch([c], { blockWidth: 400, height: 120 }), 'color.png')],
        fields: [['RGB', `${c.r}, ${c.g}, ${c.b}`], ['HSL', `${hsl.h}°, ${hsl.s}%, ${hsl.l}%`], ['CMYK', `${k.c}, ${k.m}, ${k.y}, ${k.k}`], ['Decimal', String(col.toDecimal(c))],
          ['Best text colour', col.readableOn(c)], ['Contrast vs white', `${col.contrast(c, { r: 255, g: 255, b: 255 }).toFixed(2)}:1`], ['Contrast vs black', `${col.contrast(c, { r: 0, g: 0, b: 0 }).toFixed(2)}:1`]],
      }));
    }),
  },
  {
    name: 'palette', description: 'Generate a matching colour palette',
    options: s => str('color', 'Base colour', 40)(s).addStringOption(o => o.setName('scheme').setDescription('Palette type (default: complementary)')
      .addChoices(...(['complementary', 'analogous', 'triadic', 'split-complementary', 'tetradic', 'monochrome'] as const).map(v => ({ name: v, value: v })))),
    run: lookup(async i => {
      const base = color(i.options.getString('color', true));
      const scheme = (i.options.getString('scheme') ?? 'complementary') as col.Scheme;
      const p = col.palette(base, scheme);
      await i.editReply(card({
        title: `${scheme[0]!.toUpperCase()}${scheme.slice(1)} palette`, color: col.toDecimal(base), image: 'attachment://palette.png', files: [attachOf(swatch(p), 'palette.png')],
        description: p.map(x => `\`${col.toHex(x).toUpperCase()}\``).join('  '),
      }));
    }),
  },
  {
    name: 'gradient', description: 'Blend two colours into a gradient',
    options: s => str('from', 'Start colour', 40)(s).addStringOption(o => o.setName('to').setDescription('End colour').setRequired(true).setMaxLength(40))
      .addIntegerOption(o => o.setName('steps').setDescription('How many colours (2–12, default 7)').setMinValue(2).setMaxValue(12)),
    run: lookup(async i => {
      const a = color(i.options.getString('from', true)), b = color(i.options.getString('to', true));
      const g = col.gradient(a, b, i.options.getInteger('steps') ?? 7);
      await i.editReply(card({
        title: `${col.toHex(a).toUpperCase()} → ${col.toHex(b).toUpperCase()}`, color: col.toDecimal(g[Math.floor(g.length / 2)]!), image: 'attachment://gradient.png', files: [attachOf(swatch(g), 'gradient.png')],
        description: g.map(x => `\`${col.toHex(x).toUpperCase()}\``).join(' '),
      }));
    }),
  },
  {
    name: 'convert', description: 'Convert units or currencies, e.g. 5 km to mi or 100 usd to eur', options: str('query', 'What to convert, e.g. 72 f to c', 100),
    run: lookup(async i => {
      const r = await convertAny(i.options.getString('query', true));
      await i.editReply(card({ title: 'Conversion', color: 0x5865f2, description: r.text, footer: r.note }));
    }),
  },
  {
    name: 'math', description: 'Calculate an expression (supports functions like sqrt, sin, log)', options: str('expression', 'e.g. 2*(3+4)^2 or sqrt(144)+5!', 200),
    run: lookup(async i => {
      const expr = i.options.getString('expression', true);
      let v: number;
      try { v = evaluate(expr); } catch (e) { if (e instanceof MathError) throw new LookupError(e.message); throw e; }
      await i.editReply(card({ title: 'Calculator', color: 0x5865f2, description: `\`${trunc(expr, 200)}\`\n## = ${formatNumber(v)}` }));
    }),
  },
  {
    name: 'lyrics', description: 'Find the lyrics to a song', options: str('song', 'Song title and artist', 150),
    run: lookup(async i => {
      const l = await w.lyrics(i.options.getString('song', true));
      const pages = w.paginate(l.text, 3200);
      await i.editReply(card({
        title: `${l.title} — ${l.artist}`, color: 0x1db954, description: l.instrumental ? '*This track is instrumental.*' : `${pages[0]}${pages.length > 1 ? '\n\n*…lyrics truncated.*' : ''}`,
        footer: `${l.album ? `${l.album} · ` : ''}Lyrics from LRCLIB`,
      }));
    }),
  },
  {
    name: 'search', description: 'Search the web for a topic', options: str('query', 'What to search for', 200),
    run: lookup(async i => {
      const r = await w.search(i.options.getString('query', true));
      await i.editReply(listCard(`Results for "${trunc(i.options.getString('query', true), 60)}"`,
        r.hits.map((h, n) => `**${n + 1}.** [${trunc(h.title, 80)}](${h.url})\n${trunc(h.snippet, 200)}`), { color: 0x5865f2, footer: `via ${r.engine}` }));
    }),
  },
  {
    name: 'paste', description: 'Upload text to a public paste link (paste.rs)', options: str('text', 'The text to upload (public — anyone with the link can read it)', 4000),
    run: lookup(async i => {
      const url = await w.paste(i.options.getString('text', true));
      await i.editReply(card({ title: 'Pasted', url, color: 0x57f287, description: url, footer: 'Public link on paste.rs. Don\'t paste secrets.', links: [{ label: 'Open paste', url }] }));
    }),
  },
  {
    name: 'tweet', description: 'Preview a tweet / X post from its link', options: str('link', 'Link to the post', 300),
    run: lookup(async i => {
      const p = await w.tweet(i.options.getString('link', true));
      const img = p.media.find(m => m.type === 'image');
      await i.editReply(card({
        title: `${p.user} (@${p.handle})`, url: p.url, color: 0x1d9bf0, thumbnail: p.avatar, image: img?.url, description: trunc(p.text || '*No text.*', 1500),
        fields: [['❤️ Likes', p.likes.toLocaleString('en-US')], ['🔁 Reposts', p.retweets.toLocaleString('en-US')], ['💬 Replies', p.replies.toLocaleString('en-US')], ['Posted', when(p.date, 'f')],
          p.media.some(m => m.type !== 'image') ? ['Media', p.media.filter(m => m.type !== 'image').map((m, n) => `[${m.type} ${n + 1}](${m.url})`).join(' · ')] : null],
        footer: p.sensitive ? '⚠️ This post is marked as possibly sensitive.' : undefined, links: [{ label: 'Open post', url: p.url }],
      }));
    }),
  },
];

export const funTextSubs: Sub[] = [
  {
    name: 'urban', description: 'Look up a word on Urban Dictionary (age-restricted channels)',
    options: s => str('term', 'Word or phrase', 100)(s).addIntegerOption(o => o.setName('number').setDescription('Which definition (default 1)').setMinValue(1).setMaxValue(10)),
    run: lookup(async i => {
      if (!nsfwOk(i)) throw new LookupError('Urban Dictionary is user-written and can be explicit, so it only works in age-restricted channels and DMs.');
      const { def, total } = await w.urban(i.options.getString('term', true), (i.options.getInteger('number') ?? 1) - 1);
      await i.editReply(card({
        title: def.word, url: def.url, color: 0xeff600, description: trunc(def.definition, 1200), fields: [['Example', def.example ? trunc(def.example, 500) : null], ['👍', String(def.up)], ['👎', String(def.down)], ['By', def.author]],
        footer: `${total} definition${total === 1 ? '' : 's'} · Urban Dictionary`,
      }));
    }),
  },
  {
    name: 'ascii', description: 'Turn text into big ASCII art',
    options: s => str('text', 'Up to 30 characters', 30)(s).addStringOption(o => o.setName('font').setDescription('Style (default Standard)').addChoices(...t.ASCII_FONTS.map(f => ({ name: f, value: f })))),
    run: lookup(async i => {
      const art = t.asciify(i.options.getString('text', true), i.options.getString('font') ?? 'Standard');
      if (art.length > 1900) throw new LookupError('That came out too big — try fewer characters or the Small font.');
      await i.editReply({ content: `\`\`\`\n${art}\n\`\`\``, allowedMentions: { parse: [] } });
    }),
  },
  {
    name: 'badtranslate', description: 'Run text through a chain of translations until it\'s ruined', options: s => str('text', 'What to mangle', 300)(s).addIntegerOption(o => o.setName('passes').setDescription('How many languages (2–8, default 5)').setMinValue(2).setMaxValue(8)),
    run: lookup(async i => {
      const chain = t.pickChain(i.options.getInteger('passes') ?? 5);
      const r = await t.badTranslate(i.options.getString('text', true), chain);
      await i.editReply(card({ title: 'Bad translation', color: 0xeb459e, description: `> ${trunc(i.options.getString('text', true), 300)}\n\n**${trunc(r.final, 1000)}**`, footer: `Path: English → ${chain.map(c => t.LANGS[c] ?? c).join(' → ')} → English` }));
    }),
  },
  {
    name: 'markov', description: 'Generate new text in the style of some sample text', options: s => str('text', 'Sample text to learn from (a few sentences)', 2000)(s).addIntegerOption(o => o.setName('words').setDescription('Length (10–100, default 40)').setMinValue(10).setMaxValue(100)),
    run: lookup(async i => {
      await i.editReply(card({ title: 'Markov chain', color: 0xeb459e, description: t.markov(i.options.getString('text', true), i.options.getInteger('words') ?? 40) }));
    }),
  },
];
