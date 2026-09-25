import {
  ApplicationIntegrationType, ChatInputCommandInteraction, ContainerBuilder,
  InteractionContextType, MediaGalleryBuilder, MediaGalleryItemBuilder,
  MessageFlags, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const Banner: Command = {
  data: new SlashCommandBuilder()
    .setName('banner')
    .setDescription("Get a user's profile banner")
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addUserOption(o => o.setName('user').setDescription('User (defaults to you)'))
    .addBooleanOption(o => o.setName('server').setDescription('Show server-specific banner if set (default: false)')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const serverBanner = interaction.options.getBoolean('server') ?? false;

    // Banners require a fresh REST fetch — cached user objects don't include them
    const freshUser = await interaction.client.users.fetch(targetUser.id, { force: true });

    let url: string | null = null;

    if (serverBanner && interaction.inGuild()) {
      const member = await interaction.guild?.members.fetch({ user: targetUser.id, force: true }).catch(() => null);
      url = member?.bannerURL({ size: 4096 }) ?? freshUser.bannerURL({ size: 4096 }) ?? null;
    } else {
      url = freshUser.bannerURL({ size: 4096 }) ?? null;
    }

    if (!url) {
      const who = targetUser.id === interaction.user.id ? 'You don\'t have' : `**${targetUser.username}** doesn't have`;
      await interaction.editReply(cv2Text(`❌ ${who} a ${serverBanner ? 'server ' : ''}banner set.`));
      return;
    }

    const label = serverBanner ? 'Server Banner' : 'Banner';
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${freshUser.username}'s ${label}**`))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)));
    await interaction.editReply({ flags: IS_CV2, components: [container] });
  },
};

export default Banner;
