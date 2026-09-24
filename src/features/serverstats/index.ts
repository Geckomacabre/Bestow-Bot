import { EventModule } from '../feature';

const serverStatsModule: EventModule = {
  name: 'serverstats',
  handlers: {
    messageCreate: async ({ data: [message], db }) => {
      if (!message.guildId || message.author?.bot) return;
      await db.incrementStat(message.guildId, 'messages');
    },
    guildMemberAdd: async ({ data: [member], db }) => {
      await db.incrementStat(member.guild.id, 'joins');
    },
    guildMemberRemove: async ({ data: [member], db }) => {
      await db.incrementStat(member.guild.id, 'leaves');
    },
  },
};

export default serverStatsModule;
