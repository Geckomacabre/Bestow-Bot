import {
  ApplicationCommandType, ApplicationIntegrationType,
  ContextMenuCommandBuilder, InteractionContextType,
  MessageContextMenuCommandInteraction, MessageFlags,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { selectedImages } from '../../utils/imageSelection.js';

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

const SelectImage: Command = {
  data: new ContextMenuCommandBuilder()
    .setName('Select Image')
    .setType(ApplicationCommandType.Message)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM]) as any,

  async runMessage(interaction: MessageContextMenuCommandInteraction) {
    const msg = interaction.targetMessage;
    let url: string | null = null;

    for (const att of msg.attachments.values()) {
      if (IMAGE_MIME.has(att.contentType ?? '')) { url = att.url; break; }
    }
    if (!url) {
      for (const embed of msg.embeds) {
        const u = embed.image?.url ?? embed.thumbnail?.url;
        if (u) { url = u; break; }
      }
    }

    if (!url) {
      await interaction.reply({ content: '❌ No image found in that message.', flags: MessageFlags.Ephemeral });
      return;
    }

    selectedImages.set(interaction.user.id, url);
    await interaction.reply({ content: '✅ Image selected! Now use any image command and it will use this image.', flags: MessageFlags.Ephemeral });
  },
};

export default SelectImage;
