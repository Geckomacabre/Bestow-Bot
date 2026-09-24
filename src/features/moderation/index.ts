import type { Client } from 'discord.js';
import { initScheduler, registerTaskHandler } from '../../utils/scheduler';
import type { IScheduledTask } from '../../utils/db';
import { EventModule } from '../feature';

export function initModerationScheduler(client: Client) {
  initScheduler(client);

  registerTaskHandler('unban', async (task: IScheduledTask, bot: Client) => {
    if (!task.guild_id || !task.user_id) return;
    try {
      const guild = await bot.guilds.fetch(task.guild_id);
      await guild.members.unban(task.user_id, 'Temporary ban expired');
    } catch {}
  });
}

const moderationModule: EventModule = {
  name: 'moderation',
  handlers: {},
};

export default moderationModule;
