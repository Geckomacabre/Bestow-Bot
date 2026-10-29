import { ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../interfaces/command';
import { card, num, when } from '../../lookups/card.js';

const Serverinfo: Command = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Get information about this server')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild!;
    const owner = await guild.fetchOwner().catch(() => null);

    await interaction.reply(card({
      title: guild.name, description: guild.description, thumbnail: guild.iconURL({ size: 256 }),
      fields: [
        ['Owner', owner ? `<@${owner.id}>` : null], ['Created', when(guild.createdTimestamp)],
        ['Members', num(guild.memberCount)], ['Channels and roles', `${num(guild.channels.cache.size)} channels · ${num(guild.roles.cache.size)} roles`],
        ['Boosts', `Level ${guild.premiumTier} · ${guild.premiumSubscriptionCount ?? 0} boosts`],
      ],
      footer: `ID ${guild.id}`,
    }));
  },
};

export default Serverinfo;
