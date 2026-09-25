import { ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../interfaces/command';

const Serverinfo: Command = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Get information about this server')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild!;
    const owner = await guild.fetchOwner().catch(() => null);

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: guild.id, inline: true },
        { name: 'Owner', value: owner ? `${owner.user.tag}` : 'Unknown', inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
        { name: 'Members', value: guild.memberCount.toLocaleString(), inline: true },
        { name: 'Channels', value: guild.channels.cache.size.toLocaleString(), inline: true },
        { name: 'Roles', value: guild.roles.cache.size.toLocaleString(), inline: true },
        { name: 'Boost Level', value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} boosts)`, inline: true },
        { name: 'Verification', value: ['None', 'Low', 'Medium', 'High', 'Very High'][guild.verificationLevel], inline: true },
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

export default Serverinfo;
