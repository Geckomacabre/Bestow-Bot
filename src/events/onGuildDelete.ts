import { Guild } from 'discord.js';
import * as db from '../utils/db';

export const onGuildDelete = async (guild: Guild) => {
  if (!guild.id) return;
  await db.removeGuild(guild.id);
};
