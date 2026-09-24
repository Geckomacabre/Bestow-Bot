import { Client, Events } from 'discord.js';
import { initCronJobs } from '../tasks';
import { onGuildDelete } from './onGuildDelete';
import { onGuildCreate } from './onGuildCreate';
import { onInteraction } from './onInteraction';
import { onReady } from './onReady';

export function registerEvents(Bot: Client) {
  Bot.once(Events.ClientReady, async () => {
    await onReady(Bot);
    initCronJobs(Bot);
  });

  Bot.on(Events.GuildCreate, async (guild) => await onGuildCreate(guild));

  Bot.on(Events.GuildDelete, async (guild) => await onGuildDelete(guild));

  Bot.on(Events.InteractionCreate, async (interaction) => await onInteraction(interaction));
}
