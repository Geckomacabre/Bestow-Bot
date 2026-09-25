import { ChatInputCommandInteraction, Colors, ContainerBuilder, TextDisplayBuilder } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { adjustBalance, db, getActiveBoost, getEconomyConfig, type IEconomyConfig } from '../../utils/db.js';
import { cv2Err, IS_CV2 } from '../../utils/components.js';
import { applyDroughtBonus, droughtNote } from '../../utils/droughtBonus.js';
import { claimCooldown, fmtDuration, getEco, releaseCooldown } from '../../eco/core.js';
import { careerMultiplier, pct } from '../../eco/effects.js';
import { randInt } from '../../utils/random.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface ClaimDef {
  name: string;
  description: string;
  title: string;
  color: number;
  cooldownMs: number | ((guildId: string, userId: string) => Promise<number>);
  roll: (cfg: IEconomyConfig) => number;
  /** Shop Coin Magnet applies (work/daily/beg only). */
  magnet?: boolean;
  /** Guild-wide "nobody has claimed in a while" bonus. */
  drought?: { type: string; thresholdMs: number; doublingMs: number };
  /** Text between the title line and the reward line. */
  flavor?: () => string;
  cooldownHint: string;
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

const BEG_RESPONSES = [
  'Someone took pity on you.', 'A passerby dropped some change.', 'You found a crumpled bill on the ground.',
  'A kind stranger helped you out.', 'You performed a sad little dance and earned some coins.',
  'The vending machine gave back your money.', 'You recycled some cans.', 'A generous soul blessed you today.',
];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
const pendingWorkNotifications = new Map<string, ReturnType<typeof setTimeout>>();

const CLAIMS: ClaimDef[] = [
  {
    name: 'daily', description: 'Claim your daily reward', title: 'Daily Reward', color: Colors.Green,
    cooldownMs: 20 * HOUR, roll: c => randInt(c.daily_min, c.daily_max), magnet: true,
    // No daily claimed in this server for 4+ days? The reward climbs, doubling every 24h after that.
    drought: { type: 'daily', thresholdMs: 4 * DAY, doublingMs: DAY },
    cooldownHint: 'Come back in 20 hours for your next reward.',
  },
  {
    name: 'weekly', description: 'Claim your weekly reward', title: 'Weekly Reward', color: Colors.Green,
    cooldownMs: 7 * DAY, roll: c => randInt(c.weekly_min, c.weekly_max), cooldownHint: 'Come back in 7 days for your next reward.',
  },
  {
    name: 'monthly', description: 'Claim your monthly premium cash reward', title: 'Monthly Reward', color: Colors.Green, premium: true,
    cooldownMs: 30 * DAY, roll: c => randInt(c.monthly_min, c.monthly_max), cooldownHint: 'Come back in 30 days for your next reward.',
  },
  {
    name: 'yearly', description: 'Claim your yearly reward', title: 'Yearly Reward', color: Colors.Gold,
    cooldownMs: 365 * DAY, roll: c => randInt(c.yearly_min, c.yearly_max), cooldownHint: 'Come back in 365 days for your next reward.',
  },
  {
    name: 'work', description: 'Work a shift for coins (1-hour cooldown)', title: 'Work Complete', color: Colors.Blue,
    // Overtime Permit (shop) halves the cooldown while active.
    cooldownMs: async (g, u) => ((await getActiveBoost(g, u, 'workcd')) ? HOUR / 2 : HOUR),
    roll: c => randInt(c.work_min, c.work_max), magnet: true,
    drought: { type: 'work', thresholdMs: 6 * HOUR, doublingMs: 12 * HOUR },
    flavor: () => `You ${pick(WORK_JOBS)}`,
    cooldownHint: 'You can work again after the cooldown.',
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
            await channel.send(`⏰ <@${userId}> Your work cooldown is up! Run \`/eco work\` to earn more ${cfg.currency_symbol} ${cfg.currency_name}.`);
          }
        } catch { /* channel gone / no perms */ }
      }, cooldownMs);
      pendingWorkNotifications.set(userId, timer);
    },
  },
  {
    name: 'beg', description: 'Beg a stranger for money (15-minute cooldown)', title: 'Beg', color: Colors.Blurple,
    cooldownMs: 15 * MIN, roll: () => randInt(10, 100), magnet: true,
    drought: { type: 'beg', thresholdMs: 3 * HOUR, doublingMs: 6 * HOUR },
    flavor: () => pick(BEG_RESPONSES),
    cooldownHint: 'Come back in 15 minutes.',
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
        let amount = def.roll(cfg);
        if (magnet) amount = Math.floor(amount * magnet.multiplier);
        const drought = def.drought ? await applyDroughtBonus(guildId, amount, def.drought) : null;
        if (drought) amount = drought.amount;
        amount = Math.floor(amount * career);

        const { newBalance } = await adjustBalance(guildId, userId, amount, def.name);
        const sym = cfg.currency_symbol;
        const notes =
          (magnet ? '\n🧲 *Coin Magnet boosted your reward!*' : '') +
          (career > 1 ? `\n💼 *Career card: +${pct(career - 1)}*` : '') +
          (drought ? droughtNote(drought) : '');
        const lead = def.flavor ? `${def.flavor()} and earned` : 'You claimed';
        const container = new ContainerBuilder().setAccentColor(def.color).addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**${sym} ${def.title}**\n${lead} **${sym} ${amount.toLocaleString()} ${cfg.currency_name}**!\nNew balance: **${newBalance.toLocaleString()}**${notes}\n*${def.cooldownHint}*`,
        ));
        await interaction.reply({ flags: IS_CV2, components: [container] });
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
      let body: string, color: number;
      if (Math.random() < HUSTLE_WIN_CHANCE) {
        const amount = Math.floor(randInt(cfg.work_min, cfg.work_max) * 1.5 * (await careerMultiplier(userId)));
        const { newBalance } = await adjustBalance(guildId, userId, amount, 'hustle');
        body = `You ${pick(HUSTLE_WINS)} and earned **${sym} ${amount.toLocaleString()} ${cfg.currency_name}**!\nNew balance: **${newBalance.toLocaleString()}**`;
        color = Colors.Green;
      } else {
        const eco = await getEco(guildId, userId);
        const wanted = Math.min(randInt(50, 250), eco.balance);
        const paid = wanted > 0 ? (await adjustBalance(guildId, userId, -wanted, 'hustle:loss')).success : false;
        body = `You ${pick(HUSTLE_LOSSES)}. ${paid ? `That cost you **${sym} ${wanted.toLocaleString()} ${cfg.currency_name}**.` : 'Luckily you had nothing to lose.'}`;
        color = Colors.Red;
      }
      const container = new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${sym} Hustle**\n${body}\n*Come back in 30 minutes.*`));
      await i.reply({ flags: IS_CV2, components: [container] });
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
