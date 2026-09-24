import { EventModule } from '../feature';
import logger from '../../utils/logger';

const autoroleModule: EventModule = {
  name: 'autorole',
  handlers: {
    guildMemberAdd: async ({ data: [member], db }) => {
      const roles = (await db.getAutoroles(member.guild.id)).filter(ar => {
        if (ar.target === 'bots') return member.user.bot;
        if (ar.target === 'humans') return !member.user.bot;
        return true;
      });
      logger.debug(`[autorole] guildMemberAdd fired for ${member.user.tag} in ${member.guild.name} — ${roles.length} autorole(s) configured`);
      if (!roles.length) return;
      logger.info(`[autorole] ${roles.length} autorole(s) to apply to ${member.user.tag} in ${member.guild.name}`);
      for (const ar of roles) {
        if (ar.wait_seconds > 0) {
          setTimeout(async () => {
            try {
              const fresh = await member.guild.members.fetch(member.id).catch(() => null);
              if (!fresh) { logger.warn(`[autorole] member ${member.id} left before delayed role could be applied`); return; }
              await fresh.roles.add(ar.role_id).catch(err =>
                logger.warn(`[autorole] failed to add role ${ar.role_id} (delayed): ${err.message}`)
              );
            } catch (err: any) {
              logger.warn(`[autorole] delayed role error: ${err.message}`);
            }
          }, ar.wait_seconds * 1000);
        } else {
          await member.roles.add(ar.role_id).catch(err =>
            logger.warn(`[autorole] failed to add role ${ar.role_id} to ${member.user.tag}: ${err.message}`)
          );
        }
      }
    },
  },
};

export default autoroleModule;
