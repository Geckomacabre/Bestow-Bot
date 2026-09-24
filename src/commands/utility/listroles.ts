import { ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder, InteractionContextType, SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../interfaces/command';

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
      if (current.length + line.length > 4096) { chunks.push(current); current = ''; }
      current += line;
    }
    if (current) chunks.push(current);

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(`Roles in ${interaction.guild!.name}`)
      .setDescription(chunks[0] ?? 'No roles found.')
      .setFooter({ text: `${roles.size} role(s) total` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default Listroles;
