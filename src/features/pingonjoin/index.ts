import type { EventModule } from '../feature';
import { pingChannels, renderPing } from '../../profile/store.js';

/** How long a join ping stays before it deletes itself (the notification still reaches the new member). */
export const PING_TTL_MS = 3_000;

const pingOnJoinModule: EventModule = {
  name: 'pingonjoin',
  handlers: {
    async guildMemberAdd({ data: [member] }) {
      if (member.user.bot) return;
      const list = await pingChannels(member.guild.id);
      for (const c of list) {
        const ch = member.guild.channels.cache.get(c.channel_id);
        if (!ch?.isSendable()) continue;
        const msg = await ch.send({ content: renderPing(c.message, member.id, member.guild.name).slice(0, 2000), allowedMentions: { users: [member.id] } }).catch(() => null);
        if (msg) setTimeout(() => { msg.delete().catch(() => {}); }, PING_TTL_MS);
      }
    },
  },
};

export default pingOnJoinModule;
