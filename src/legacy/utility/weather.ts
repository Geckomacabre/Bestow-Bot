import { ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder, InteractionContextType, SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import Config from '../../config';
import { Command } from '../../interfaces/command';

const Weather: Command = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Get current weather for a location')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM])
    .addStringOption(o => o.setName('location').setDescription('City name or "City, Country"').setRequired(true)) as any,

  async run(interaction: ChatInputCommandInteraction) {
    if (!Config.WEATHER_API_KEY) {
      await interaction.reply({ content: '❌ Weather API key not configured. Set `WEATHER_API_KEY` in your environment.', flags: MessageFlags.Ephemeral }); return;
    }
    const location = interaction.options.getString('location', true);
    await interaction.deferReply();

    try {
      const res = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${Config.WEATHER_API_KEY}&units=metric`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) { await interaction.editReply('❌ Location not found.'); return; }
      const w: any = await res.json();

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(`🌤 Weather in ${w.name}, ${w.sys.country}`)
        .setDescription(w.weather[0].description.charAt(0).toUpperCase() + w.weather[0].description.slice(1))
        .setThumbnail(`https://openweathermap.org/img/wn/${w.weather[0].icon}@2x.png`)
        .addFields(
          { name: '🌡 Temperature', value: `${w.main.temp}°C (feels like ${w.main.feels_like}°C)`, inline: true },
          { name: '💧 Humidity', value: `${w.main.humidity}%`, inline: true },
          { name: '💨 Wind', value: `${w.wind.speed} m/s`, inline: true },
          { name: '📊 Pressure', value: `${w.main.pressure} hPa`, inline: true },
          { name: '👁 Visibility', value: `${(w.visibility / 1000).toFixed(1)} km`, inline: true },
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply('❌ Could not fetch weather data.');
    }
  },
};

export default Weather;
