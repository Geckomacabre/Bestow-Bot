import { hleaf } from '../../framework/heist.js';
import { card } from '../../lookups/card.js';
import { lookup } from '../../lookups/handler.js';
import { define } from '../../lookups/dictionary.js';

export default hleaf('define', lookup(async i => {
  const d = await define(i.options.getString('word', true));
  const mw = `https://www.merriam-webster.com/dictionary/${encodeURIComponent(d.word)}`;
  const lines = d.senses.flatMap(s => [s.pos ? `**${s.pos}**` : '', ...s.defs.map((x, n) => `${n + 1}. ${x}`), s.example ? `*"${s.example}"*` : ''].filter(Boolean));
  await i.editReply(card({
    title: `📖 ${d.word}${d.phonetic ? `  ${d.phonetic}` : ''}`, url: mw, color: 0x2b5797, description: lines.join('\n'),
    fields: [['Synonyms', d.synonyms.length ? d.synonyms.join(', ') : null]], footer: d.source, links: [{ label: 'Merriam-Webster', url: mw }],
  }));
}), { tweaks: { word: { maxLength: 60 } } });
