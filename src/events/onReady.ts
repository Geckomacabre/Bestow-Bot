import { ActivityType, REST, Routes, type Client } from 'discord.js';
import logger from '../utils/logger';
import Config from '../config';
import commands from '../handlers/commandHandler';
import { ownerGuardScan } from './onGuildCreate';
import { getBotConfig } from '../utils/db';
import { staffCommand, staffGuildId } from '../staff/index';
import { syncJuulEmojis } from '../fun/juulEmoji';

/**
 * Registers every command GLOBALLY. Bestow is a user-install app: people add it to their own account and use it in any
 * server, DM or group DM — so commands must never be tied to a particular server (guild commands aren't available to
 * user installs at all).
 */
export const onReady = async (Bot: Client) => {
  const rest = new REST({ version: '10' }).setToken(Config.DISCORD_TOKEN);
  const commandData = Array.from(commands.values()).map((command) => command.data.toJSON());

  try {
    await rest.put(Routes.applicationCommands(Config.CLIENT_ID), { body: commandData });
    logger.info(`Registered ${commandData.length} global commands`);
    // Owner tools exist only in the support server, never in the public command list.
    const staffGuild = staffGuildId();
    if (staffGuild) {
      await rest.put(Routes.applicationGuildCommands(Config.CLIENT_ID, staffGuild), { body: [staffCommand.data.toJSON()] })
        .then(() => logger.info('Registered /staff in the support server'))
        .catch(err => logger.warn(`Couldn't register /staff in the support server (is the bot in it?): ${err}`));
    }
    logger.info(`Logged in as ${Bot.user?.tag}!`);
    // The juul/battery art as application emojis (plain emoji until it's there); never holds up startup.
    syncJuulEmojis(Bot).catch(err => logger.warn(`Couldn't sync the juul emojis: ${err}`));

    await ownerGuardScan([...Bot.guilds.cache.values()]);

    const savedPresence = await getBotConfig('presence');
    if (savedPresence) {
      const { text, type } = JSON.parse(savedPresence) as { text: string; type: number };
      Bot.user?.setPresence({ activities: [{ name: text, type }], status: 'online' });
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
};
