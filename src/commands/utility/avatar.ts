import {
  ApplicationIntegrationType, ChatInputCommandInteraction, ContainerBuilder,
  InteractionContextType, MediaGalleryBuilder, MediaGalleryItemBuilder,
  MessageFlags, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const Avatar: Command = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Get a user's avatar")
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM])
    .addUserOption(o => o.setName('user').setDescription('User (defaults to you)'))
    .addBooleanOption(o => o.setName('server').setDescription('Show server-specific avatar if set (default: false)')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const serverAvatar = interaction.options.getBoolean('server') ?? false;

    let url: string | null = null;

    if (serverAvatar && interaction.inGuild()) {
      const member = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
      url = member?.avatarURL({ size: 4096 }) ?? targetUser.displayAvatarURL({ size: 4096 });
    } else {
      url = targetUser.displayAvatarURL({ size: 4096 });
    }

    const label = serverAvatar ? 'Server Avatar' : 'Avatar';
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${targetUser.username}'s ${label}**`))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)));
    await interaction.reply({ flags: IS_CV2, components: [container] });
  },
};

export default Avatar;
