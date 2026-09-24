import type { Client, ClientEvents } from 'discord.js';

type HandlerContext<K extends keyof ClientEvents> = {
  data: ClientEvents[K];
  bot: Client;
  db: typeof import('../utils/db');
};

export type EventModule = {
  name: string;
  handlers: Partial<{
    [K in keyof ClientEvents]: (context: HandlerContext<K>) => Promise<any>;
  }>;
};
