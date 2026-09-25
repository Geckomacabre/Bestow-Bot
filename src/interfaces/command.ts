import {
  AutocompleteInteraction,
  CacheType,
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  UserContextMenuCommandInteraction,
} from 'discord.js';

export interface Command {
  data:
    | Omit<SlashCommandBuilder, 'addSubcommandGroup' | 'addSubcommand'>
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder
    | ContextMenuCommandBuilder;
  category?: string;
  run?: (interaction: ChatInputCommandInteraction<CacheType>) => Promise<unknown>;
  runMessage?: (interaction: MessageContextMenuCommandInteraction<CacheType>) => Promise<unknown>;
  runUser?: (interaction: UserContextMenuCommandInteraction<CacheType>) => Promise<unknown>;
  autocomplete?: (interaction: AutocompleteInteraction<CacheType>) => Promise<unknown>;
}