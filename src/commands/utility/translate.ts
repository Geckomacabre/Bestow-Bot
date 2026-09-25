import {
  ApplicationIntegrationType, ChatInputCommandInteraction, EmbedBuilder,
  InteractionContextType, SlashCommandBuilder, Colors, MessageFlags,
} from 'discord.js';
import { Command } from '../../interfaces/command';

const LANGS = [
  { name: 'English', value: 'en' }, { name: 'Spanish', value: 'es' },
  { name: 'French', value: 'fr' }, { name: 'German', value: 'de' },
  { name: 'Italian', value: 'it' }, { name: 'Portuguese', value: 'pt' },
  { name: 'Russian', value: 'ru' }, { name: 'Japanese', value: 'ja' },
  { name: 'Korean', value: 'ko' }, { name: 'Chinese (Simplified)', value: 'zh' },
  { name: 'Arabic', value: 'ar' }, { name: 'Dutch', value: 'nl' },
  { name: 'Polish', value: 'pl' }, { name: 'Turkish', value: 'tr' },
  { name: 'Swedish', value: 'sv' }, { name: 'Hindi', value: 'hi' },
];

const Translate: Command = {
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text between languages')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(o => o.setName('text').setDescription('Text to translate').setRequired(true))
    .addStringOption(o =>
      o.setName('to').setDescription('Target language (default: English)')
        .addChoices(...LANGS.map(l => ({ name: l.name, value: l.value }))))
    .addStringOption(o =>
      o.setName('from').setDescription('Source language (default: auto-detect)')
        .addChoices(...LANGS.map(l => ({ name: l.name, value: l.value })))) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const text = interaction.options.getString('text', true);
    const to = interaction.options.getString('to') ?? 'en';
    const from = interaction.options.getString('from') ?? 'auto';

    if (text.length > 500) {
      return interaction.reply({ content: 'Text must be 500 characters or fewer.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const langpair = `${from}|${to}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;

    const res = await fetch(url);
    if (!res.ok) { await interaction.editReply('Translation service unavailable. Try again later.'); return; }

    const data: any = await res.json();
    if (data.responseStatus !== 200) {
      await interaction.editReply(`Translation failed: ${data.responseDetails ?? 'Unknown error'}`); return;
    }

    const translated: string = data.responseData.translatedText;
    const detectedLang: string = data.responseData.detectedLanguage ?? from;

    const fromLabel = LANGS.find(l => l.value === detectedLang)?.name ?? detectedLang.toUpperCase();
    const toLabel = LANGS.find(l => l.value === to)?.name ?? to.toUpperCase();

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle('🌐 Translation')
      .addFields(
        { name: `Original (${fromLabel})`, value: text },
        { name: `Translated (${toLabel})`, value: translated },
      )
      .setFooter({ text: 'Powered by MyMemory' });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default Translate;
