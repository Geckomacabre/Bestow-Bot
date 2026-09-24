import { Command } from '../interfaces/command';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

const commands = new Map<string, Command>();

async function loadCommands(directory: string, isRoot = true): Promise<number> {
  const entries = fs.readdirSync(directory);
  let commandCount = 0;

  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    const categoryName = entry;
    const files = fs.readdirSync(fullPath).filter(
      (f) => (f.endsWith('.ts') || f.endsWith('.js')) && f !== 'index.ts' && f !== 'index.js'
    );

    for (const file of files) {
      const commandPath = path.join(fullPath, file);
      // dynamic import() instead of require() — correctly parses TypeScript
      const mod = await import(commandPath);
      const command: Command = mod.default;
      command.category = categoryName;
      commands.set(command.data.name, command);
      logger.debug(`Loading command: ${command.data.name} (${categoryName})`);
      commandCount++;
    }
  }

  if (isRoot) {
    logger.info(`${commandCount} command(s) loaded`);
    logger.debug(
      `Loaded commands: ${Array.from(commands.entries())
        .map(([name, cmd]) => `${name} (${cmd.category})`)
        .join(', ')}`
    );
  }
  return commandCount;
}

// top-level await ensures commands are populated before this module is used
await loadCommands(path.join(import.meta.dir, '../commands'));

export default commands;
