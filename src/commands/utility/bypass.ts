import { hleaf } from '../../framework/heist.js';
import { card, trunc } from '../../lookups/card.js';
import { lookup } from '../../lookups/handler.js';
import { unshorten } from '../../lookups/bypass.js';

export default hleaf('bypass', lookup(async i => {
  const { final, hops } = await unshorten(i.options.getString('url', true));
  const chain = hops.map((h, n) => `${n + 1}. \`${h.status}\` ${trunc(h.url, 120)}`);
  await i.editReply(card({
    title: '🔗 Link bypassed', color: 0x57f287,
    description: `**Goes to:** ${trunc(final, 500)}${hops.length > 1 ? `\n\n**Redirect chain**\n${chain.join('\n')}` : '\n\nThat link doesn\'t redirect anywhere.'}`,
    footer: 'Check the destination before you open it.', links: [{ label: 'Open destination', url: final }],
  }));
}), { tweaks: { url: { maxLength: 1000 } } });
