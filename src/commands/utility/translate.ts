import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { hleaf } from '../../framework/heist.js';
import { card, trunc } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { gtranslate } from '../../lookups/textfun.js';
import { languageName, resolveLanguage, searchLanguages } from '../../lookups/languages.js';

const MAX = 1500;

/** No `text` given: translate the latest message with text in this channel (if the bot can read it). */
async function latestText(i: ChatInputCommandInteraction): Promise<string | null> {
  const ch = i.channel;
  if (!ch || !('messages' in ch)) return null;
  try {
    const msgs = await ch.messages.fetch({ limit: 15 });
    return msgs.find(m => !!m.content.trim() && m.id !== i.id)?.content ?? null;
  } catch { return null; }
}

async function langAutocomplete(i: AutocompleteInteraction) {
  await i.respond(searchLanguages(String(i.options.getFocused())).slice(0, 25));
}

export default hleaf('translate', lookup(async i => {
  const toIn = i.options.getString('to') ?? 'en', fromIn = i.options.getString('from_lang') ?? 'auto';
  const to = resolveLanguage(toIn), from = resolveLanguage(fromIn);
  if (!to || to === 'auto') throw new LookupError(`I don't know the language **${trunc(toIn, 40)}**. Try a name like "French" or a code like "fr".`);
  if (!from) throw new LookupError(`I don't know the language **${trunc(fromIn, 40)}**.`);
  const text = i.options.getString('text') ?? await latestText(i);
  if (!text) throw new LookupError('Give me some `text` to translate (I couldn\'t read a recent message here).');
  const r = await gtranslate(text.slice(0, MAX), to, from);
  const fromName = languageName(from === 'auto' ? r.detected : from);
  await i.editReply(card({
    title: '🌐 Translation', color: 0x4285f4,
    fields: [[`${fromName}${from === 'auto' ? ' (detected)' : ''}`, trunc(text, 1000)], [languageName(to), trunc(r.text, 1800)]],
    footer: 'Google Translate',
  }));
}), {
  tweaks: { to: { autocomplete: true, maxLength: 40 }, from_lang: { autocomplete: true, maxLength: 40 }, text: { maxLength: MAX } },
  autocomplete: langAutocomplete,
});
