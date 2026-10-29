import { ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../interfaces/command';
import { card, when } from '../../lookups/card.js';

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

    const roles = member?.roles.cache.filter(r => r.id !== interaction.guildId).map(r => `<@&${r.id}>`).join(' ');
    await interaction.reply(card({
      title: member?.displayName ?? user.globalName ?? user.username, description: `@${user.username}${user.bot ? ' · 🤖 bot' : ''}`,
      thumbnail: user.displayAvatarURL({ size: 256 }), color: member?.displayColor || undefined, // the colour of their top role, if it has one
      fields: [['Account created', when(user.createdTimestamp)], ['Joined the server', member?.joinedTimestamp ? when(member.joinedTimestamp) : null], ['Roles', member ? roles || 'None' : null]],
      footer: `ID ${user.id}`,
    }));
  },
};

export default Userinfo;
