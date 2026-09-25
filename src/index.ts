import { Client, GatewayIntentBits } from 'discord.js';
import Config from './config';
import { registerEvents } from './events';
import { registerFeatures } from './features';
import * as db from './utils/db';
import { startWebServer } from './web';

// Exit rather than limp on in an unknown state - the container restarts us
// cleanly. Previously this only logged, so the bot kept running half-broken.
process.on('uncaughtException', (err) => {
  console.error(`Uncaught Exception: ${err instanceof Error ? err.stack : err}`);
  void shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Privileged intents are the ones that expose the most about people, so each is documented, and presence
// (who is playing/streaming what) is OFF unless you deliberately turn it on for the streaming-announcement feature.
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,        // privileged: auto-moderation, counting, custom commands, XP counts, @mention chat. Content is processed in memory, never stored.
  GatewayIntentBits.GuildMembers,          // privileged: autorole, welcome, member logs
  GatewayIntentBits.GuildVoiceStates,      // voice roles
  GatewayIntentBits.GuildModeration,       // ban/unban events
  GatewayIntentBits.GuildMessageReactions, // polls, reaction roles
  GatewayIntentBits.DirectMessages,        // reminder DMs, DM chat
];
if (Bun.env.ENABLE_PRESENCE_INTENT === '1') intents.push(GatewayIntentBits.GuildPresences); // privileged: streaming detection only

export const Bot = new Client({ intents });

await db.initDb();
registerEvents(Bot);
registerFeatures(Bot);
startWebServer();

Bot.login(Config.DISCORD_TOKEN);

// ─── Graceful shutdown ───────────────────────────────────────────────────────
// Without these handlers the process took SIGTERM straight to a segfault
// (exit 139) on every `docker stop`, leaving an unclean WAL behind.

let shuttingDown = false;

async function shutdown(signal: string, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, closing down`);

  // Never hang forever on a wedged socket or DB handle.
  const force = setTimeout(() => {
    console.error('[shutdown] timed out after 10s, forcing exit');
    process.exit(code || 1);
  }, 10_000);
  force.unref?.();

  try {
    await Bot.destroy();
    console.log('[shutdown] discord client destroyed');
  } catch (err) {
    console.error('[shutdown] client.destroy failed:', err);
  }

  try {
    await db.closeDb();
    console.log('[shutdown] database checkpointed and closed');
  } catch (err) {
    console.error('[shutdown] closeDb failed:', err);
  }

  clearTimeout(force);
  console.log('[shutdown] clean exit');
  process.exit(code);
}
