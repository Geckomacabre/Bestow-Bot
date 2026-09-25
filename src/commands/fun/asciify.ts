import { hleaf } from '../../framework/heist.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { ASCII_FONTS, asciify } from '../../lookups/textfun.js';

const fontOf = (q: string | null) => ASCII_FONTS.find(f => f.toLowerCase() === (q ?? 'standard').trim().toLowerCase());

export default hleaf('asciify', lookup(async i => {
  const font = fontOf(i.options.getString('font'));
  if (!font) throw new LookupError(`Pick a font from the list: ${ASCII_FONTS.join(', ')}.`);
  const art = asciify(i.options.getString('text', true), font);
  if (art.length > 1900) throw new LookupError('That came out too big — try fewer characters or the Small font.');
  await i.editReply({ content: `\`\`\`\n${art}\n\`\`\``, allowedMentions: { parse: [] } });
}), {
  tweaks: { text: { maxLength: 30 }, font: { autocomplete: true } },
  autocomplete: async i => {
    const q = String(i.options.getFocused()).toLowerCase();
    await i.respond(ASCII_FONTS.filter(f => f.toLowerCase().includes(q)).slice(0, 25).map(f => ({ name: f, value: f })));
  },
});
