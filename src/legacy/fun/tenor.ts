import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MediaGalleryBuilder,
  MediaGalleryItemBuilder, MessageFlags, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';
import { klipyGif } from '../../lookups/web.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const Gif: Command = {
  data: new SlashCommandBuilder()
    .setName('gif')
    .setDescription('Search for a GIF')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM])
    .addStringOption(o => o.setName('query').setDescription('What to search for').setRequired(true)),

  async run(interaction: ChatInputCommandInteraction) {
    if (!Bun.env.KLIPY_API_KEY) {
      await interaction.reply({ ...cv2Text('⚠️ `KLIPY_API_KEY` is not set in `.env`.'), flags: IS_CV2 | MessageFlags.Ephemeral });
      return;
    }
    const query = interaction.options.getString('query', true);
    await interaction.deferReply();
    let gifUrl: string;
    try { gifUrl = await klipyGif(query); } catch (e) { await interaction.editReply(cv2Text((e as Error).message)); return; }
    const container = new ContainerBuilder().setAccentColor(Colors.Purple)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🎞️ ${query}**`))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(gifUrl)));
    await interaction.editReply({ flags: IS_CV2, components: [container] });
  },
};

export default Gif;
