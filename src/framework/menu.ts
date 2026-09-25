import {
  ApplicationCommandType, ApplicationIntegrationType, ContextMenuCommandBuilder, InteractionContextType,
  type MessageContextMenuCommandInteraction, type UserContextMenuCommandInteraction,
} from 'discord.js';
import type { Command } from '../interfaces/command.js';

/** Right-click → Apps commands. They work everywhere Bestow does (servers, DMs, group DMs, user installs). */
const base = (name: string, type: ApplicationCommandType.User | ApplicationCommandType.Message) =>
  new ContextMenuCommandBuilder().setName(name).setType(type)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

export const userMenu = (name: string, runUser: (i: UserContextMenuCommandInteraction) => Promise<unknown>): Command =>
  ({ data: base(name, ApplicationCommandType.User) as unknown as Command['data'], runUser });

export const messageMenu = (name: string, runMessage: (i: MessageContextMenuCommandInteraction) => Promise<unknown>): Command =>
  ({ data: base(name, ApplicationCommandType.Message) as unknown as Command['data'], runMessage });
