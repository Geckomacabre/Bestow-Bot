import { hgroup, hsub } from '../../framework/heist.js';
import { card, trunc } from '../../lookups/card.js';
import { lookup } from '../../lookups/handler.js';
import * as n from '../../lookups/net.js';

export default hgroup({
  name: 'dns',
  subs: [
    hsub('dns lookup', lookup(async i => {
      const resolver: n.Resolver = i.options.getString('resolver') === 'Google DNS' ? 'google' : 'cloudflare';
      const r = await n.dnsOverview(i.options.getString('domain', true), resolver);
      const lines = r.records.slice(0, 30).map(x => `${x.type.padEnd(5)} ${String(x.ttl).padStart(6)}s  ${trunc(x.data, 110)}`);
      await i.editReply(card({
        title: `DNS · ${r.name}`, color: r.records.length ? 0x5865f2 : 0x99aab5,
        description: r.records.length ? `\`\`\`\n${lines.join('\n')}\n\`\`\`${r.records.length > 30 ? `\n…and ${r.records.length - 30} more` : ''}` : '*No records found.*',
        fields: [['Status', r.status], r.dnssec ? ['DNSSEC', '✅ validated'] : null], footer: `via ${n.resolverLabel(resolver)} (DNS-over-HTTPS)`,
      }));
    }), { tweaks: { domain: { maxLength: 253 } } }),
  ],
});
