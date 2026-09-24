import { GuildMember, PartialGuildMember } from 'discord.js';
import { EventModule } from '../feature';
import { HOME_GUILD_ID, LinkedRoles } from '../../constants';
import { shouldHaveRole } from '../../utils/linkedRoles';

// Join-time role assignment (bot/human) now lives in the generic, per-guild
// /rolesconfig auto system (see src/features/autorole) so every server can
// configure it — not just this one. Only the LinkedRoles parent/child sync
// below remains hardcoded to this specific server.
const guildActionsModule: EventModule = {
  name: 'guild-actions',
  handlers: {
    guildMemberUpdate: async ({ data: [oldMember, newMember] }: { data: [GuildMember | PartialGuildMember, GuildMember] }) => {
      if (newMember.guild.id !== HOME_GUILD_ID) return;
      const oldRoles = oldMember.roles.cache;
      const newRoles = newMember.roles.cache;

      const roleIds = new Set(newRoles.keys());

      for (const rule of LinkedRoles) {
        const hasParent = newRoles.has(rule.parent);
        const shouldHave = shouldHaveRole(rule, roleIds);

        if (shouldHave === hasParent) continue;

        if (shouldHave) {
          await newMember.roles.add(rule.parent).catch(() => null);
        } else {
          await newMember.roles.remove(rule.parent).catch(() => null);
        }
      }

      const added = newRoles.filter((role) => !oldRoles.has(role.id));
      const removed = oldRoles.filter((role) => !newRoles.has(role.id));

      if (!added.size && !removed.size) return;
    },
  },
};

export default guildActionsModule;
