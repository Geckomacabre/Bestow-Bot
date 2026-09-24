import { EventModule } from '../feature';

function applyTemplate(response: string, vars: Record<string, string>): string {
  return response
    .replace(/\{user\}/g, vars.user ?? '')
    .replace(/\{username\}/g, vars.username ?? '')
    .replace(/\{server\}/g, vars.server ?? '')
    .replace(/\{channel\}/g, vars.channel ?? '')
    .replace(/\{membercount\}/g, vars.membercount ?? '');
}

const customCommandsModule: EventModule = {
  name: 'customcommands',
  handlers: {
    messageCreate: async ({ data: [message], db }) => {
      if (!message.guildId || !message.content || message.author?.bot) return;

      const cmds = await db.getCustomCommands(message.guildId);
      if (!cmds.length) return;

      const content = message.content;
      const lower = content.toLowerCase();

      for (const cmd of cmds) {
        let match = false;
        const trigger = cmd.trigger;
        const triggerLower = trigger.toLowerCase();

        switch (cmd.trigger_type) {
          case 'command':
            match = lower === triggerLower || lower.startsWith(triggerLower + ' ');
            break;
          case 'startswith':
            match = lower.startsWith(triggerLower);
            break;
          case 'contains':
            match = lower.includes(triggerLower);
            break;
          case 'exact':
            match = lower === triggerLower;
            break;
          case 'regex':
            try { match = new RegExp(trigger, 'i').test(content); } catch {}
            break;
        }

        if (!match) continue;

        const vars: Record<string, string> = {
          user: `<@${message.author.id}>`,
          username: message.author.username,
          server: message.guild?.name ?? '',
          channel: `<#${message.channelId}>`,
          membercount: String(message.guild?.memberCount ?? ''),
        };

        const response = applyTemplate(cmd.response, vars);
        await message.reply(response).catch(() => {});
        break;
      }
    },
  },
};

export default customCommandsModule;
