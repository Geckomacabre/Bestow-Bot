import { ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../interfaces/command';

const Define: Command = {
  data: new SlashCommandBuilder()
    .setName('define')
    .setDescription('Get the dictionary definition of a word')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(o => o.setName('word').setDescription('Word to define').setRequired(true)) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const word = interaction.options.getString('word', true).trim().toLowerCase();
    await interaction.deferReply();

    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { await interaction.editReply(`❌ No definition found for **${word}**.`); return; }
      const json: any[] = await res.json();
      const entry = json[0];
      const meaning = entry.meanings[0];
      const def = meaning?.definitions[0];

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(`📖 ${entry.word}`)
        .addFields(
          { name: 'Part of Speech', value: meaning?.partOfSpeech ?? 'Unknown', inline: true },
          ...(entry.phonetic ? [{ name: 'Phonetic', value: entry.phonetic, inline: true }] : []),
          { name: 'Definition', value: def?.definition ?? 'N/A' },
          ...(def?.example ? [{ name: 'Example', value: `*"${def.example}"*` }] : []),
          ...(def?.synonyms?.length ? [{ name: 'Synonyms', value: def.synonyms.slice(0, 8).join(', ') }] : []),
        );
      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply('❌ Could not fetch definition.');
    }
  },
};

export default Define;
