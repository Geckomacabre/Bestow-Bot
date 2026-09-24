import { ActivityType, REST, Routes, type Client } from 'discord.js';
import logger from '../utils/logger';
import Config from '../config';
import commands from '../handlers/commandHandler';
import { ownerGuardScan } from './onGuildCreate';
import { getBotConfig } from '../utils/db';

export const onReady = async (Bot: Client) => {
  const rest = new REST({ version: '10' }).setToken(Config.DISCORD_TOKEN);
  const commandData = Array.from(commands.values()).map((command) => command.data.toJSON());

  try {
    logger.info('Clearing existing commands...');

    if (Config.NODE_ENV === 'development') {
      await rest.put(Routes.applicationGuildCommands(Config.CLIENT_ID, Config.GUILD_ID), { body: [] });
      logger.info('Cleared guild commands');

      await rest.put(Routes.applicationCommands(Config.CLIENT_ID), { body: [] });
      logger.info('Cleared global commands');

      logger.info('Development mode: Registering guild commands...');
      await rest.put(Routes.applicationGuildCommands(Config.CLIENT_ID, Config.GUILD_ID), {
        body: commandData,
      });
      logger.info(`Successfully registered ${commandData.length} guild commands`);
    } else {
      await rest.put(Routes.applicationGuildCommands(Config.CLIENT_ID, Config.GUILD_ID), { body: [] });
      logger.info('Cleared guild commands');

      logger.info('Production mode: Registering global commands...');
      await rest.put(Routes.applicationCommands(Config.CLIENT_ID), { body: commandData });
      logger.info(`Successfully registered ${commandData.length} global commands`);
    }

    logger.info(`Logged in as ${Bot.user?.tag}!`);

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
