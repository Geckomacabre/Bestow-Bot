import type { ChatInputCommandInteraction, User } from 'discord.js';
import type { Sub, SubGroup } from '../../framework/group.js';
import { card, trunc, when } from '../../lookups/card.js';
import { lookup } from '../../lookups/handler.js';
import * as w from '../../lookups/web.js';
import { heartBar, pick, shipName } from '../../lookups/textfun.js';
import { funTextSubs } from '../lookups/tools.js';
import * as j from '../../fun/juul.js';
import { batteryEmoji, juulEmoji } from '../../fun/juulEmoji.js';
import * as s from '../../fun/social.js';
import { hsub } from '../../framework/heist.js';
import { cv2Err, cv2Text } from '../../utils/components.js';

const name = (u: User) => u.displayName ?? u.username;
const userOpt = (req = false, d = 'Who?') => (o: import('discord.js').SlashCommandUserOption) => o.setName('user').setDescription(d).setRequired(req);

// ─── Social one-offs ─────────────────────────────────────────────────────────

const socialSubs: Sub[] = [
  {
    name: 'action', description: 'Send an anime GIF: hug, pat, slap and more',
    options: sub => sub.addStringOption(o => o.setName('type').setDescription('What to do').setRequired(true).addChoices(...Object.keys(w.ACTIONS).map(k => ({ name: k, value: k }))))
      .addUserOption(userOpt(false, 'Who to do it to')),
    run: lookup(async i => {
      const kind = i.options.getString('type', true);
      const target = i.options.getUser('user');
      const gif = await w.actionGif(kind);
      await i.editReply(card({
        title: w.actionText(kind, name(i.user), target ? name(target) : undefined), color: 0xeb459e, image: gif.url,
        description: target && target.id !== i.user.id ? `<@${target.id}>` : undefined, footer: gif.anime ? `Anime: ${gif.anime} · nekos.best` : 'nekos.best',
      }));
    }),
  },
  {
    name: 'ship', description: 'See how compatible two people are',
    options: sub => sub.addUserOption(userOpt(true, 'First person')).addUserOption(o => o.setName('other').setDescription('Second person (default: you)')),
    run: lookup(async i => {
      const a = i.options.getUser('user', true), b = i.options.getUser('other') ?? i.user;
      const pct = s.shipScore(a.id, b.id);
      await i.editReply(card({
        title: `${name(a)} 💞 ${name(b)}`, color: 0xeb459e, description: `${heartBar(pct)}\n## ${pct}%\n${s.shipLine(pct)}`, footer: `Ship name: ${shipName(name(a), name(b))}`,
      }));
    }),
  },
  {
    name: 'rate', description: 'Rate anything out of 100 (same answer all day)', options: sub => sub.addStringOption(o => o.setName('thing').setDescription('What to rate').setRequired(true).setMaxLength(100)),
    run: lookup(async i => {
      const thing = i.options.getString('thing', true);
      const pct = s.rate(thing);
      await i.editReply(card({ title: `I rate **${trunc(thing, 80)}**…`, color: 0xfee75c, description: `## ${pct}/100\n${s.rateLine(pct)}` }));
    }),
  },
  {
    name: 'rizz', description: 'Get a cheesy pickup line', options: sub => sub.addUserOption(userOpt(false, 'Who to charm')),
    run: lookup(async i => {
      const t = i.options.getUser('user');
      await i.editReply(card({ title: t ? `😏 Rizz for ${name(t)}` : '😏 Rizz', color: 0xeb459e, description: `${t ? `<@${t.id}> ` : ''}${pick(s.RIZZ)}` }));
    }),
  },
  {
    name: 'roast', description: 'Playfully roast someone', options: sub => sub.addUserOption(userOpt(true, 'Who to roast')),
    run: lookup(async i => {
      const t = i.options.getUser('user', true);
      await i.editReply(card({ title: '🔥 Roasted', color: 0xed4245, description: s.fill(pick(s.ROASTS), `<@${t.id}>`), footer: 'All in good fun.' }));
    }),
  },
  {
    name: 'say', description: 'Make the bot say something (no pings)', options: sub => sub.addStringOption(o => o.setName('text').setDescription('What to say').setRequired(true).setMaxLength(1000)),
    run: async (i: ChatInputCommandInteraction) => {
      await i.reply({ content: i.options.getString('text', true), allowedMentions: { parse: [] } });
    },
  },
];

// ─── /juul ───────────────────────────────────────────────────────────────────

/** The pause between "hitting the juul…" and the result, like Heist. Tests set it to 0. */
export const JUUL_TIMING = { hitDelayMs: 1200 };
const juulName = (x: j.Juul, u: User) => x.name ? `**${x.name}**` : `${name(u)}'s juul`;

const juulSubs: Sub[] = [
  hsub('juul hit', async i => {
    const r = await j.hit(i.user.id);
    if (!r.ok) {
      await i.reply(cv2Text(`🪫 Your juul is dead. Plug it in with \`/juul charge\`.${r.charging && r.fullAt ? `\n-# Charging — full ${when(r.fullAt, 'R')}` : ''}`));
      return;
    }
    await i.reply(cv2Text(`${juulEmoji()} hitting the juul...`));
    if (JUUL_TIMING.hitDelayMs) await Bun.sleep(JUUL_TIMING.hitDelayMs);
    await i.editReply(cv2Text(`${juulEmoji()} **${r.puffs.toLocaleString('en-US')}** puffs total.\n-# Battery: ${r.battery}/${j.MAX_BATTERY} ${batteryEmoji(r.battery)}`));
  }),
  hsub('juul charge', async i => {
    const r = await j.charge(i.user.id);
    const text = r.kind === 'full' ? `🔋 Your juul is already fully charged.\n-# Battery: ${j.MAX_BATTERY}/${j.MAX_BATTERY} ${batteryEmoji(j.MAX_BATTERY)}`
      : `🔌 ${r.kind === 'started' ? 'Plugged in' : 'Already charging'} — full ${when(r.fullAt, 'R')}.\n-# Battery: ${r.battery}/${j.MAX_BATTERY} ${batteryEmoji(r.battery)}`;
    await i.reply(cv2Text(text));
  }),
  hsub('juul flavor', async i => {
    const f = i.options.getString('flavor', true);
    await j.setFlavor(i.user.id, f);
    await i.reply(cv2Text(`${juulEmoji()} Loaded a **${f}** pod.`));
  }),
  hsub('juul customize', async i => {
    const nameIn = i.options.getString('name'), skin = i.options.getString('skin');
    if (nameIn == null && skin == null) { await i.reply({ ...cv2Err('❌ Give your juul a `name`, pick a `skin`, or both.') }); return; }
    const x = await j.customize(i.user.id, { name: nameIn, skin });
    await i.reply(cv2Text(`${juulEmoji()} ${[nameIn != null ? (x.name ? `Renamed your juul to **${x.name}**.` : 'Cleared your juul\'s name.') : null, skin ? `Applied the **${x.skin}** skin.` : null].filter(Boolean).join(' ')}`, j.skinColor(x)));
  }, { tweaks: { name: { maxLength: j.NAME_MAX } } }),
  hsub('juul stats', async i => {
    const u = i.options.getUser('user') ?? i.user;
    const x = await j.getJuul(u.id);
    const b = j.effectiveBattery(x, Date.now());
    const charging = x.charging_since != null && b < j.MAX_BATTERY;
    await i.reply({
      ...cv2Text([
        `### ${juulEmoji()} ${juulName(x, u)}`,
        `**Puffs:** ${x.puffs.toLocaleString('en-US')}`,
        `**Battery:** ${b}/${j.MAX_BATTERY} ${batteryEmoji(b)}${charging ? ` · 🔌 full ${when(j.fullAt(x, Date.now()), 'R')}` : ''}`,
        `**Flavor:** ${x.flavor}`,
        `**Skin:** ${x.skin}`,
        `**Last hit:** ${x.last_hit ? when(x.last_hit, 'R') : 'never'}`,
      ].join('\n'), j.skinColor(x)),
      allowedMentions: { parse: [] },
    });
  }),
];

export const funSubs: Sub[] = [...socialSubs, ...funTextSubs];
export const funGroups: SubGroup[] = [{ name: 'juul', description: 'A totally fictional virtual vape', subs: juulSubs }];
