import { ApplicationIntegrationType, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../interfaces/command';
import { card } from '../../lookups/card.js';
import { helpFor, suggestions, toHelp } from '../../info/help.js';

// The registry is imported lazily: it loads every command module, and /help is one of them.
const list = async () => toHelp((await import('../../handlers/commandHandler')).default.values());

const Help: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Browse commands by category, or get details on one')
    .addStringOption(o => o.setName('query').setDescription('A command (e.g. tools) or category (e.g. fun)').setAutocomplete(true))
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]) as any,

  async run(i) {
    const r = helpFor(await list(), i.options.getString('query'));
    await i.reply({ ...card({ title: 'Help', color: r.found ? 0x5865f2 : 0xfee75c, description: r.text }), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  },

  async autocomplete(i) {
    await i.respond(suggestions(await list(), i.options.getFocused()));
  },
};

export default Help;
