import { ChatInputCommandInteraction, Colors, ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { adjustBalance, db, getActiveBoost, getEconomyConfig, type IEconomyConfig } from '../../utils/db.js';
import { cv2Err } from '../../utils/components.js';
import { applyDroughtBonus, droughtNote } from '../../utils/droughtBonus.js';
import { claimCooldown, fmtDuration, getEco, nextStreak, releaseCooldown, saveStreak, streakBonus } from '../../eco/core.js';
import { moneyBold } from '../../eco/cashEmoji.js';
import { careerMultiplier, pct } from '../../eco/effects.js';
import { randInt } from '../../utils/random.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface ClaimDef {
  name: string;
  description: string;
  cooldownMs: number | ((guildId: string, userId: string) => Promise<number>);
  roll: (cfg: IEconomyConfig) => number;
  /** The result sentence, with the reward already formatted ("💸 **$291**"). `streak` is the day of the streak, when there is one. */
  line: (reward: string, streak: { day: number; bonus: number } | null) => string;
  /** Claims on consecutive days build a streak that pays a growing bonus (daily). */
  streak?: boolean;
  /** Shop Coin Magnet applies (work/daily/beg only). */
  magnet?: boolean;
  /** Guild-wide "nobody has claimed in a while" bonus. */
  drought?: { type: string; thresholdMs: number; doublingMs: number };
  /** A ✨ Premium command. */
  premium?: boolean;
  /** Called after a successful claim. */
  after?: (i: ChatInputCommandInteraction, cfg: IEconomyConfig, cooldownMs: number) => void;
}

const WORK_JOBS = [
  'worked the night shift at a gas station', 'delivered pizzas', 'mowed lawns in the neighborhood',
  'streamed on Twitch for 3 hours', 'drove for a rideshare app', 'sold some old junk online',
  'walked dogs around the park', 'wrote an article for a blog', 'fixed a neighbor\'s computer',
  'washed cars at the carwash', 'sorted packages at a warehouse', 'helped move furniture',
  'tutored a kid in math', 'flipped burgers at the local diner',
];

const BEG_RESPONSES: ((reward: string) => string)[] = [
  r => `You ask passersby if they can spare some cash. A stranger felt bad for you and gave you ${r}.`,
  r => `You sit on the curb with a cardboard sign. Someone took pity on you and handed you ${r}.`,
  r => `You perform a sad little dance in the square. A passerby dropped ${r} in your hat.`,
  r => `You spot a crumpled bill on the ground. It turns out to be worth ${r}.`,
  r => `You recycle a bag of cans behind the shop and get ${r} back.`,
  r => `A generous soul blesses you today with ${r}.`,
];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
const pendingWorkNotifications = new Map<string, ReturnType<typeof setTimeout>>();

/** A one-line result on a coloured bar, like Heist's: "✔️ @user: …". */
export function resultLine(userId: string, text: string, ok = true) {
  const container = new ContainerBuilder().setAccentColor(ok ? Colors.Green : Colors.Red)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${ok ? '✔️' : '❌'} <@${userId}>: ${text}`));
  return { flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] as never[] }, components: [container] };
}

const CLAIMS: ClaimDef[] = [
  {
    name: 'daily', description: 'Claim your daily reward', streak: true,
    cooldownMs: 20 * HOUR, roll: c => randInt(c.daily_min, c.daily_max), magnet: true,
    // No daily claimed in this server for 4+ days? The reward climbs, doubling every 24h after that.
    drought: { type: 'daily', thresholdMs: 4 * DAY, doublingMs: DAY },
    line: (r, s) => `Claimed your daily reward - **Day ${s!.day}** streak (+${Math.round(s!.bonus * 100)}% bonus) - earned ${r}`,
  },
  {
    name: 'weekly', description: 'Claim your weekly reward',
    cooldownMs: 7 * DAY, roll: c => randInt(c.weekly_min, c.weekly_max), line: r => `Claimed your weekly reward - earned ${r}`,
  },
  {
    name: 'monthly', description: 'Claim your monthly premium cash reward', premium: true,
    cooldownMs: 30 * DAY, roll: c => randInt(c.monthly_min, c.monthly_max), line: r => `Claimed your monthly reward - earned ${r}`,
  },
  {
    name: 'yearly', description: 'Claim your yearly reward',
    cooldownMs: 365 * DAY, roll: c => randInt(c.yearly_min, c.yearly_max), line: r => `Claimed your yearly reward - earned ${r}`,
  },
  {
    name: 'work', description: 'Work a shift for coins (1-hour cooldown)',
    // Overtime Permit (shop) halves the cooldown while active.
    cooldownMs: async (g, u) => ((await getActiveBoost(g, u, 'workcd')) ? HOUR / 2 : HOUR),
    roll: c => randInt(c.work_min, c.work_max), magnet: true,
    drought: { type: 'work', thresholdMs: 6 * HOUR, doublingMs: 12 * HOUR },
    line: r => `You ${pick(WORK_JOBS)} and earned ${r}.`,
    after(i, cfg, cooldownMs) {
      const userId = i.user.id;
      const existing = pendingWorkNotifications.get(userId);
      if (existing) clearTimeout(existing);
      const { channelId, client } = i;
      const timer = setTimeout(async () => {
        pendingWorkNotifications.delete(userId);
        try {
          const [pref] = await db`SELECT notify_rob FROM economy WHERE user_id = ${userId}`; // /eco toggle-notifications
          if (pref && !pref.notify_rob) return;
          const channel = await client.channels.fetch(channelId);
          if (channel?.isTextBased() && 'send' in channel) {
            await channel.send(`⏰ <@${userId}> Your work cooldown is up! Run \`/eco work\` to earn more.`);
          }
        } catch { /* channel gone / no perms */ }
      }, cooldownMs);
      pendingWorkNotifications.set(userId, timer);
    },
  },
  {
    name: 'beg', description: 'Beg a stranger for money (15-minute cooldown)',
    cooldownMs: 15 * MIN, roll: () => randInt(10, 100), magnet: true,
    drought: { type: 'beg', thresholdMs: 3 * HOUR, doublingMs: 6 * HOUR },
    line: r => pick(BEG_RESPONSES)(r),
  },
];

function makeClaim(def: ClaimDef): Sub {
  return {
    name: def.name,
    description: def.description,
    ...(def.premium ? { premium: true } : {}),
    async run(interaction) {
      const guildId = (interaction.guildId ?? 'global');
      const userId = interaction.user.id;
      const cooldownMs = typeof def.cooldownMs === 'number' ? def.cooldownMs : await def.cooldownMs(guildId, userId);

      const claim = await claimCooldown(userId, def.name, cooldownMs);
      if (!claim.ok) {
        await interaction.reply(cv2Err(`You already claimed your **${def.name}**. Come back in **${fmtDuration(claim.remainingMs)}**.`));
        return;
      }

      try {
        const cfg = await getEconomyConfig(guildId);
        const magnet = def.magnet ? await getActiveBoost(guildId, userId, 'magnet') : null;
        const career = await careerMultiplier(userId);
        const day = def.streak ? await nextStreak(userId, def.name) : null;
        const streak = day ? { day, bonus: streakBonus(day) } : null;
        let amount = def.roll(cfg);
        if (magnet) amount = Math.floor(amount * magnet.multiplier);
        const drought = def.drought ? await applyDroughtBonus(guildId, amount, def.drought) : null;
        if (drought) amount = drought.amount;
        if (streak) amount = Math.floor(amount * (1 + streak.bonus));
        amount = Math.floor(amount * career);

        await adjustBalance(guildId, userId, amount, def.name);
        if (day) await saveStreak(userId, def.name, day);
        const notes =
          (magnet ? '\n-# 🧲 Coin Magnet boosted your reward!' : '') +
          (career > 1 ? `\n-# 💼 Career card: +${pct(career - 1)}` : '') +
          (drought ? droughtNote(drought) : '');
        await interaction.reply(resultLine(userId, `${def.line(moneyBold(cfg.currency_symbol, amount), streak)}${notes}`));
        def.after?.(interaction, cfg, cooldownMs);
      } catch (err) {
        await releaseCooldown(userId, def.name); // don't burn the cooldown if we failed to pay
        throw err;
      }
    },
  };
}

const claimNamed = (name: string) => makeClaim(CLAIMS.find(c => c.name === name)!);

// ─── hustle ──────────────────────────────────────────────────────────────────

const HUSTLE_WINS = [
  'flipped a limited-edition sneaker before anyone noticed', 'sold a stack of handmade stickers at a convention', 'resold concert tickets at a fair price',
  'won a small bet on a pub quiz', 'ran a one-night pop-up stall and sold out', 'got paid to test a new app before it launched',
];
const HUSTLE_LOSSES = [
  'bought a "guaranteed" crypto tip from a stranger', 'ordered 200 fidget spinners just as the trend died', 'put a deposit on a food truck that never showed',
  'lost your stall permit and paid the fine', 'trusted a mystery investor who ghosted you',
];
const HUSTLE_WIN_CHANCE = 0.65;

/** A risky alternative to /eco work: a bigger payout most of the time, a small loss otherwise. */
export const hustle: Sub = {
  name: 'hustle', description: 'Take a risky side hustle: bigger pay, but it can flop (30-minute cooldown)',
  async run(i) {
    const guildId = i.guildId ?? 'global', userId = i.user.id;
    const claimed = await claimCooldown(userId, 'hustle', 30 * MIN);
    if (!claimed.ok) { await i.reply(cv2Err(`You're still hustling. Come back in **${fmtDuration(claimed.remainingMs)}**.`)); return; }
    try {
      const cfg = await getEconomyConfig(guildId), sym = cfg.currency_symbol;
      if (Math.random() < HUSTLE_WIN_CHANCE) {
        const amount = Math.floor(randInt(cfg.work_min, cfg.work_max) * 1.5 * (await careerMultiplier(userId)));
        await adjustBalance(guildId, userId, amount, 'hustle');
        await i.reply(resultLine(userId, `You ${pick(HUSTLE_WINS)} and earned ${moneyBold(sym, amount)}.`));
      } else {
        const eco = await getEco(guildId, userId);
        const wanted = Math.min(randInt(50, 250), eco.balance);
        const paid = wanted > 0 ? (await adjustBalance(guildId, userId, -wanted, 'hustle:loss')).success : false;
        await i.reply(resultLine(userId, `You ${pick(HUSTLE_LOSSES)}. ${paid ? `That cost you ${moneyBold(sym, wanted)}.` : 'Luckily you had nothing to lose.'}`, false));
      }
    } catch (err) {
      await releaseCooldown(userId, 'hustle');
      throw err;
    }
  },
};

/** Direct `/eco` claims. */
export const claimSubs: Sub[] = ['daily', 'monthly', 'work', 'beg'].map(claimNamed);
/** The longer-cooldown claims that live under `/community` (Discord caps `/eco` at 25 entries). */
export const extraClaimSubs: Sub[] = ['weekly', 'yearly'].map(claimNamed);
