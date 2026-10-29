import { ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import Config from '../../config';
import { Command } from '../../interfaces/command';
import { card } from '../../lookups/card.js';

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

      const temp = (c: number) => `${Math.round(c)}°C / ${Math.round(c * 9 / 5 + 32)}°F`;
      await interaction.editReply(card({
        title: `Weather in ${w.name}, ${w.sys.country}`, thumbnail: `https://openweathermap.org/img/wn/${w.weather[0].icon}@2x.png`,
        description: w.weather[0].description.charAt(0).toUpperCase() + w.weather[0].description.slice(1),
        fields: [['Temperature', `${temp(w.main.temp)} · feels like ${temp(w.main.feels_like)}`], ['Humidity', `${w.main.humidity}%`], ['Wind', `${w.wind.speed} m/s`]],
      }));
    } catch {
      await interaction.editReply('❌ Could not fetch weather data.');
    }
  },
};

export default Weather;
