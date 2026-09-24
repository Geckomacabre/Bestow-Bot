import type { Guild } from 'discord.js';
import Config from '../config';
import logger from '../utils/logger';

function getOwnerIds(): string[] {
  return Config.OWNER_IDS?.split(',').map(id => id.trim()).filter(Boolean) ?? [];
}

async function ownerPresentIn(guild: Guild, ownerIds: string[]): Promise<boolean> {
  for (const id of ownerIds) {
    try {
      await guild.members.fetch(id);
      return true;
    } catch {}
  }
  return false;
}

export async function onGuildCreate(guild: Guild): Promise<void> {
  if (!Config.OWNER_GUARD) return;
  const ownerIds = getOwnerIds();
  if (!ownerIds.length) return;

  if (await ownerPresentIn(guild, ownerIds)) return;

  logger.info(`[owner-guard] Leaving "${guild.name}" (${guild.id}) — no owner present`);
  try {
    await guild.leave();
  } catch (err) {
    logger.error(`[owner-guard] Failed to leave "${guild.name}": ${err}`);
  }
}

export async function ownerGuardScan(guilds: Guild[]): Promise<void> {
  if (!Config.OWNER_GUARD) return;
  const ownerIds = getOwnerIds();
  if (!ownerIds.length) return;

  for (const guild of guilds) {
    if (await ownerPresentIn(guild, ownerIds)) continue;
    logger.info(`[owner-guard] Leaving "${guild.name}" (${guild.id}) — no owner present`);
    try {
      await guild.leave();
    } catch (err) {
      logger.error(`[owner-guard] Failed to leave "${guild.name}": ${err}`);
    }
  }
}
