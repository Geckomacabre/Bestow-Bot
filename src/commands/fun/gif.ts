import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MediaGalleryBuilder,
  MediaGalleryItemBuilder, MessageFlags, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const Gif: Command = {
  data: new SlashCommandBuilder()
    .setName('gif')
    .setDescription('Search for a GIF using Tenor')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM])
    .addStringOption(o => o.setName('query').setDescription('What to search for').setRequired(true)),

  async run(interaction: ChatInputCommandInteraction) {
    const apiKey = Bun.env.TENOR_API_KEY;
    if (!apiKey) {
      await interaction.reply({ ...cv2Text('⚠️ `TENOR_API_KEY` is not set in `.env`.'), flags: IS_CV2 | MessageFlags.Ephemeral });
      return;
    }
    const query = interaction.options.getString('query', true);
    await interaction.deferReply();
    const res = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${apiKey}&limit=20&media_filter=gif&contentfilter=medium`);
    if (!res.ok) { await interaction.editReply(cv2Text('Failed to fetch GIFs. Try again later.')); return; }
    const data: any = await res.json();
    if (!data.results?.length) { await interaction.editReply(cv2Text(`No GIFs found for **${query}**.`)); return; }
    const result = data.results[Math.floor(Math.random() * data.results.length)];
    const gifUrl: string = result.media_formats?.gif?.url ?? result.media_formats?.tinygif?.url ?? '';
    if (!gifUrl) { await interaction.editReply(cv2Text('Could not extract GIF URL.')); return; }
    const container = new ContainerBuilder().setAccentColor(Colors.Purple)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🎞️ ${query}**`))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(gifUrl)));
    await interaction.editReply({ flags: IS_CV2, components: [container] });
  },
};

export default Gif;
