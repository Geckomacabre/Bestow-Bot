import { EventModule } from '../feature';

const voicerolesModule: EventModule = {
  name: 'voiceroles',
  handlers: {
    voiceStateUpdate: async ({ data: [oldState, newState], db }) => {
      const member = newState.member ?? oldState.member;
      if (!member || member.user.bot) return;
      const guildId = newState.guild?.id ?? oldState.guild?.id;
      if (!guildId) return;

      // Remove roles from old channel
      if (oldState.channelId) {
        const oldRoles = await db.getVoiceRolesForChannel(guildId, oldState.channelId);
        for (const vr of oldRoles) {
          await member.roles.remove(vr.role_id).catch(() => {});
        }
      }

      // Add roles for new channel
      if (newState.channelId) {
        const newRoles = await db.getVoiceRolesForChannel(guildId, newState.channelId);
        for (const vr of newRoles) {
          await member.roles.add(vr.role_id).catch(() => {});
        }
      }
    },
  },
};

export default voicerolesModule;
