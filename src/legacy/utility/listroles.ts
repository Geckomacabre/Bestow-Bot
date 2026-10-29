import { ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../interfaces/command';
import { card } from '../../lookups/card.js';

const Listroles: Command = {
  data: new SlashCommandBuilder()
    .setName('listroles')
    .setDescription('List all roles in this server')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const roles = interaction.guild!.roles.cache
      .filter(r => r.id !== interaction.guildId)
      .sort((a, b) => b.position - a.position);

    const chunks: string[] = [];
    let current = '';
    for (const [, role] of roles) {
      const line = `<@&${role.id}> (${role.members.size} members)\n`;
      if (current.length + line.length > 3000) { chunks.push(current); current = ''; }
      current += line;
    }
    if (current) chunks.push(current);

    await interaction.reply(card({
      title: `Roles in ${interaction.guild!.name}`, description: chunks[0] ?? 'No roles found.',
      footer: `${roles.size} role${roles.size === 1 ? '' : 's'}${chunks.length > 1 ? ' · the first ones shown' : ''}`, ephemeral: true,
    }));
  },
};

export default Listroles;
