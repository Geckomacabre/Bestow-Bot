import { EventModule } from '../feature';
import { handleAiMessage } from '../../ai/chat.js';

/** Replies when the bot is @mentioned, replied to, or DMed. Uses only that reply chain; see src/ai/chat.ts. */
const aiModule: EventModule = {
  name: 'ai',
  handlers: {
    messageCreate: async ({ data: [message] }) => { await handleAiMessage(message).catch(err => console.error('[ai]', err)); },
  },
};

export default aiModule;
