import { ButtonInteraction, MessageFlags } from 'discord.js';
import { EventModule } from '../feature';

const verifyModule: EventModule = {
  name: 'verify',
  handlers: {
    interactionCreate: async ({ data: [interaction], db }) => {
      if (!(interaction as any).isButton()) return;
      const btn = interaction as ButtonInteraction;
      if (btn.customId !== 'verify_btn') return;
      if (!btn.guildId) return;

      const cfg = await db.getVerifyConfig(btn.guildId);
      if (!cfg?.member_role_id) return;

      const member = await btn.guild?.members.fetch(btn.user.id).catch(() => null);
      if (!member) return;

      if (member.roles.cache.has(cfg.member_role_id)) {
        await btn.reply({ content: '✅ You are already verified!', flags: MessageFlags.Ephemeral });
        return;
      }

      await member.roles.add(cfg.member_role_id).catch(() => {});
      if (cfg.unverified_role_id) {
        await member.roles.remove(cfg.unverified_role_id).catch(() => {});
      }

      await btn.reply({ content: '✅ You have been verified! Welcome to the server.', flags: MessageFlags.Ephemeral });
    },
  },
};

export default verifyModule;
