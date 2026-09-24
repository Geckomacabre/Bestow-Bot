import { ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../interfaces/command';

const Userinfo: Command = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Get information about a user')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addUserOption(o => o.setName('user').setDescription('User (defaults to you)')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor ?? Colors.Blue)
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
        ...(member ? [
          { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp! / 1000)}:D>`, inline: true },
          { name: 'Nickname', value: member.nickname ?? 'None', inline: true },
          { name: 'Roles', value: member.roles.cache.filter(r => r.id !== interaction.guildId).map(r => `<@&${r.id}>`).join(', ') || 'None' },
        ] : [])
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

export default Userinfo;
