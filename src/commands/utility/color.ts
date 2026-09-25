import { AttachmentBuilder } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { card } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import * as col from '../../lookups/color.js';
import { swatch } from '../../lookups/swatch.js';

function color(input: string): col.RGB {
  try { return col.parseColor(input); } catch (e) { if (e instanceof col.ColorError) throw new LookupError(e.message); throw e; }
}
const hex = (c: col.RGB) => col.toHex(c).toUpperCase();
const RECOMMEND: col.Scheme[] = ['complementary', 'analogous', 'triadic', 'split-complementary', 'monochrome'];
const title = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export default hgroup({
  name: 'color',
  subs: [
    hsub('color inspect', lookup(async i => {
      const c = color(i.options.getString('query', true)), hsl = col.rgbToHsl(c), k = col.rgbToCmyk(c);
      const recs = RECOMMEND.map(s => [s, col.palette(c, s)] as const);
      // Big swatch of the colour, then one strip per recommended palette.
      const strip = swatch([c, ...recs[0]![1].slice(1), ...recs[1]![1].slice(1), ...recs[2]![1].slice(1)], { blockWidth: 100, height: 120 });
      await i.editReply(card({
        title: hex(c), color: col.toDecimal(c), image: 'attachment://color.png', files: [new AttachmentBuilder(strip, { name: 'color.png' })],
        fields: [['RGB', `${c.r}, ${c.g}, ${c.b}`], ['HSL', `${hsl.h}°, ${hsl.s}%, ${hsl.l}%`], ['CMYK', `${k.c}, ${k.m}, ${k.y}, ${k.k}`], ['Decimal', String(col.toDecimal(c))],
          ['Best text colour', col.readableOn(c)], ['Contrast vs white', `${col.contrast(c, { r: 255, g: 255, b: 255 }).toFixed(2)}:1`], ['Contrast vs black', `${col.contrast(c, { r: 0, g: 0, b: 0 }).toFixed(2)}:1`],
          ...recs.map(([s, p]) => [title(s), p.slice(1).map(x => `\`${hex(x)}\``).join(' ')] as [string, string])],
      }));
    }), { tweaks: { query: { maxLength: 40 } } }),
    hsub('color gradient', lookup(async i => {
      const a = color(i.options.getString('start', true)), b = color(i.options.getString('end', true));
      const g = col.gradient(a, b, i.options.getInteger('amount') ?? 7);
      await i.editReply(card({
        title: `${hex(a)} → ${hex(b)}`, color: col.toDecimal(g[Math.floor(g.length / 2)]!), image: 'attachment://gradient.png', files: [new AttachmentBuilder(swatch(g), { name: 'gradient.png' })],
        description: g.map(x => `\`${hex(x)}\``).join(' '),
      }));
    }), { tweaks: { start: { maxLength: 40 }, end: { maxLength: 40 }, amount: { min: 2, max: 10 } } }),
  ],
});
