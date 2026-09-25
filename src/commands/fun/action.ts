import type { User } from 'discord.js';
import { hleaf } from '../../framework/heist.js';
import { card } from '../../lookups/card.js';
import { lookup } from '../../lookups/handler.js';
import * as w from '../../lookups/web.js';

const name = (u: User) => u.displayName ?? u.username;

/** Heist's /action choices are capitalised names ("Handhold"); the GIF service uses the lowercase verb. */
export default hleaf('action', lookup(async i => {
  const kind = i.options.getString('do', true).toLowerCase();
  const target = i.options.getUser('user');
  const gif = await w.actionGif(kind);
  await i.editReply(card({
    title: w.actionText(kind, name(i.user), target ? name(target) : undefined), color: 0xeb459e, image: gif.url,
    description: target && target.id !== i.user.id ? `<@${target.id}>` : undefined, footer: gif.anime ? `Anime: ${gif.anime} · nekos.best` : 'nekos.best',
  }));
}), { tweaks: { do: { skipChoices: ['Fuck (NSFW)'] } } });
