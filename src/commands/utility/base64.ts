import { ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../interfaces/command';

const Base64: Command = {
  data: new SlashCommandBuilder()
    .setName('base64')
    .setDescription('Encode or decode base64')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM])
    .addStringOption(o => o.setName('action').setDescription('Encode or decode').setRequired(true).setChoices(
      { name: 'Encode', value: 'encode' }, { name: 'Decode', value: 'decode' }
    ))
    .addStringOption(o => o.setName('text').setDescription('Text to encode/decode').setRequired(true)) as any,
  async run(interaction: ChatInputCommandInteraction) {
    const action = interaction.options.getString('action', true);
    const text = interaction.options.getString('text', true);
    try {
      const result = action === 'encode'
        ? Buffer.from(text, 'utf8').toString('base64')
        : Buffer.from(text, 'base64').toString('utf8');
      await interaction.reply({ content: `\`\`\`\n${result.slice(0, 1900)}\n\`\`\``, flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({ content: '❌ Invalid input.', flags: MessageFlags.Ephemeral });
    }
  },
};
export default Base64;
