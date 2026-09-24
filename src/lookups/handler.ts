import type { ChatInputCommandInteraction } from 'discord.js';
import { HttpError } from '../framework/http.js';
import { MediaError } from '../framework/media.js';
import { cv2Err } from '../utils/components.js';

/** An error whose message is safe and useful to show the user ("no such user", "not configured"…). */
export class LookupError extends Error {}

export function friendlyError(err: unknown): string {
  if (err instanceof LookupError || err instanceof MediaError) return err.message;
  if (err instanceof HttpError) {
    if (err.status === 429) return 'That service is rate-limiting me right now — try again in a minute.';
    if (err.status === 404) return 'I couldn\'t find that.';
    if (err.status === 401 || err.status === 403) return 'That service refused the request (it may need an API key the bot owner hasn\'t set).';
    return `That service returned an error (${err.status}). Try again later.`;
  }
  const m = (err as Error)?.message ?? '';
  if (/timed out|aborted/i.test(m)) return 'That service took too long to answer. Try again in a moment.';
  if (/not allowed|not a valid|Only http/i.test(m)) return m;
  return 'Something went wrong looking that up.';
}

/** Defer, run, and turn any failure into a friendly message (details are logged, not shown). */
export function lookup(fn: (i: ChatInputCommandInteraction) => Promise<unknown>) {
  return async (i: ChatInputCommandInteraction) => {
    if (!i.deferred && !i.replied) await i.deferReply();
    try {
      await fn(i);
    } catch (err) {
      if (!(err instanceof LookupError) && !(err instanceof MediaError) && !(err instanceof HttpError && [404, 429].includes(err.status))) console.error('[lookup]', err);
      await i.editReply({ ...cv2Err(`❌ ${friendlyError(err)}`), files: [] }).catch(() => {});
    }
  };
}
