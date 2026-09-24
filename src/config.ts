const required = {
  CLIENT_ID: Bun.env.CLIENT_ID,
  GUILD_ID: Bun.env.GUILD_ID,
  DISCORD_TOKEN: Bun.env.TOKEN,
  NODE_ENV: Bun.env.NODE_ENV || 'development',
};

const missingVars = Object.entries(required)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
}

interface Config {
  DISCORD_TOKEN: string;
  CLIENT_ID: string;
  GUILD_ID: string;
  NODE_ENV: string;
  // Optional — features that need these will silently skip if absent
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  YOUTUBE_API_KEY?: string;
  WEATHER_API_KEY?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  REPORT_CHANNEL_ID?: string;
  TENOR_API_KEY?: string;
  OWNER_IDS?: string;    // comma-separated Discord user IDs of bot owners
  OWNER_GUARD?: boolean; // if true, bot leaves guilds where no owner is present
}

const Config: Config = {
  CLIENT_ID: required.CLIENT_ID!,
  GUILD_ID: required.GUILD_ID!,
  DISCORD_TOKEN: required.DISCORD_TOKEN!,
  NODE_ENV: required.NODE_ENV,
  TWITCH_CLIENT_ID: Bun.env.TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET: Bun.env.TWITCH_CLIENT_SECRET,
  YOUTUBE_API_KEY: Bun.env.YOUTUBE_API_KEY,
  WEATHER_API_KEY: Bun.env.WEATHER_API_KEY,
  REDDIT_CLIENT_ID: Bun.env.REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET: Bun.env.REDDIT_CLIENT_SECRET,
  REPORT_CHANNEL_ID: Bun.env.REPORT_CHANNEL_ID,
  TENOR_API_KEY: Bun.env.TENOR_API_KEY,
  OWNER_IDS: Bun.env.OWNER_IDS,
  OWNER_GUARD: Bun.env.OWNER_GUARD === 'true',
};

export default Config;
