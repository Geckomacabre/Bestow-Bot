import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import {
  getOrCreateEconomy, getEconomyConfig, adjustBalance, getActiveBoost, addBoost,
  getEconomyCooldown, resetEconomyCooldown,
} from '../../utils/db';
import { cv2Err, IS_CV2 } from '../../utils/components.js';
import { rand, randInt } from '../../utils/random.js';
import { withLock } from '../../framework/mutex.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// kind: 'boost' = timed effect · 'oneshot' = stored until triggered · 'instant' = resolves at purchase
const SHOP_ITEMS = [
  {
    id: 'xp_surge', name: 'XP Surge', emoji: '🔮', kind: 'boost',
    description: '2× XP from all sources for **1 hour**',
    price: 25_000, type: 'xp', multiplier: 2.0, durationMs: HOUR,
  },
  {
    id: 'lucky_charm', name: 'Lucky Charm', emoji: '🍀', kind: 'boost',
    description: '1.5× gambling winnings for **30 minutes**',
    price: 30_000, type: 'luck', multiplier: 1.5, durationMs: HOUR / 2,
  },
  {
    id: 'no_cooldown', name: 'Hint Rush', emoji: '⚡', kind: 'boost',
    description: '**Skip the shared hint cooldown** in the guessing games (movie/TV/game/song) for **15 minutes**',
    price: 15_000, type: 'guesscd', multiplier: 1.0, durationMs: HOUR / 4,
  },
  {
    id: 'overtime', name: 'Overtime Permit', emoji: '💼', kind: 'boost',
    description: 'Half `/eco work` cooldown (30 min instead of 1 hour) for **4 hours**',
    price: 20_000, type: 'workcd', multiplier: 0.5, durationMs: 4 * HOUR,
  },
  {
    id: 'coin_magnet', name: 'Coin Magnet', emoji: '🧲', kind: 'boost',
    description: '1.5× coins from `/eco work`, `/eco daily`, and `/eco beg` for **24 hours**',
    price: 40_000, type: 'magnet', multiplier: 1.5, durationMs: DAY,
  },
  {
    id: 'loaded_dice', name: 'Loaded Dice', emoji: '🎟️', kind: 'boost',
    description: '**Double your chance** to win the next daily lottery draw',
    price: 15_000, type: 'lotto', multiplier: 2.0, durationMs: 2 * DAY, // cleared after the draw
  },
  {
    id: 'goon_squad', name: 'Goon Squad', emoji: '🥊', kind: 'oneshot',
    description: 'Your next **failed `/eco rob`** has no cooldown — one use, keeps for 7 days',
    price: 25_000, type: 'goon', multiplier: 1.0, durationMs: 7 * DAY,
  },
  {
    id: 'insurance', name: 'Gambling Insurance', emoji: '🛡️', kind: 'oneshot',
    description: 'Your next **lost bet** is 50% refunded — one use, keeps for 7 days',
    price: 30_000, type: 'insurance', multiplier: 1.0, durationMs: 7 * DAY,
  },
  {
    id: 'second_chance', name: 'Second Chance', emoji: '🔁', kind: 'oneshot',
    description: 'If `/eco games crash` busts **below 1.5x**, your bet is refunded — one use, keeps for 7 days',
    price: 40_000, type: 'second_chance', multiplier: 1.0, durationMs: 7 * DAY,
  },
  {
    id: 'extra_life', name: 'Extra Life', emoji: '💖', kind: 'oneshot',
    description: 'Your next mistake in **counting** is forgiven instead of resetting the streak — one use, keeps for 7 days',
    price: 35_000, type: 'extra_life', multiplier: 1.0, durationMs: 7 * DAY,
  },
  {
    id: 'time_skip', name: 'Time Skip', emoji: '⏩', kind: 'instant',
    description: 'Instantly reset your `/eco daily`, `/eco work`, or `/eco beg` cooldown (pick one)',
    price: 35_000, type: '', multiplier: 1.0, durationMs: 0,
  },
  {
    id: 'mystery_box', name: 'Mystery Box', emoji: '📦', kind: 'instant',
    description: 'A gamble in a box — coins, a random boost, a jackpot… or nothing',
    price: 10_000, type: '', multiplier: 1.0, durationMs: 0,
  },
] as const;

type ShopItem = (typeof SHOP_ITEMS)[number];
type ItemId = ShopItem['id'];

// Cooldown windows for Time Skip validation — mirrors each command's constant.
const SKIPPABLE: Record<string, { label: string; windowMs: number }> = {
  daily: { label: '/eco daily', windowMs: 20 * HOUR },
  work:  { label: '/eco work',  windowMs: HOUR },
  beg:   { label: '/eco beg',   windowMs: 15 * 60_000 },
};

// Mystery Box boost prizes reuse the standard shop boosts.
const BOX_BOOSTS = SHOP_ITEMS.filter(i => ['xp_surge', 'lucky_charm', 'no_cooldown'].includes(i.id));

async function openMysteryBox(guildId: string, userId: string, sym: string): Promise<string> {
  const roll = rand();
  if (roll < 0.60) {
    const coins = randInt(2_000, 8_000);
    await adjustBalance(guildId, userId, coins);
    return `You found **${sym} ${coins.toLocaleString()}** inside!`;
  }
  if (roll < 0.85) {
    // Random standard boost — skip types the user already has running.
    const order = [...BOX_BOOSTS].sort(() => rand() - 0.5);
    for (const prize of order) {
      if (await getActiveBoost(guildId, userId, prize.type)) continue;
      await addBoost(guildId, userId, prize.type, prize.multiplier, Date.now() + prize.durationMs);
      return `You found a free ${prize.emoji} **${prize.name}**! (${prize.description})`;
    }
    const coins = 5_000;
    await adjustBalance(guildId, userId, coins);
    return `You found a boost, but you already have them all running — sold it for **${sym} ${coins.toLocaleString()}**.`;
  }
  if (roll < 0.95) {
    return 'The box was **empty**. Ouch.';
  }
  const jackpot = 50_000;
  await adjustBalance(guildId, userId, jackpot);
  return `💰 **JACKPOT!** The box held **${sym} ${jackpot.toLocaleString()}**!`;
}

const Shop: Command = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Buy boosts and items with your coins')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addSubcommand(sub =>
      sub.setName('browse').setDescription('View all available items')
    )
    .addSubcommand(sub =>
      sub.setName('buy')
        .setDescription('Purchase an item from the shop')
        .addStringOption(o =>
          o.setName('item')
            .setDescription('Item to purchase')
            .setRequired(true)
            .addChoices(
              { name: '🔮 XP Surge — 2× XP for 1 hour (25,000)', value: 'xp_surge' },
              { name: '🍀 Lucky Charm — 1.5× gambling wins 30 min (30,000)', value: 'lucky_charm' },
              { name: '⚡ Hint Rush — skip the shared hint cooldown 15 min (15,000)', value: 'no_cooldown' },
              { name: '💼 Overtime Permit — half work cooldown 4h (20,000)', value: 'overtime' },
              { name: '🧲 Coin Magnet — 1.5× work/daily/beg coins 24h (40,000)', value: 'coin_magnet' },
              { name: '🎟️ Loaded Dice — 2× lottery chance next draw (15,000)', value: 'loaded_dice' },
              { name: '🥊 Goon Squad — next failed rob: no cooldown (25,000)', value: 'goon_squad' },
              { name: '🛡️ Gambling Insurance — next lost bet 50% back (30,000)', value: 'insurance' },
              { name: '🔁 Second Chance — crash bust <1.5x refunded (40,000)', value: 'second_chance' },
              { name: '💖 Extra Life — forgive next counting mistake (35,000)', value: 'extra_life' },
              { name: '⏩ Time Skip — reset daily/work/beg cooldown (35,000)', value: 'time_skip' },
              { name: '📦 Mystery Box — random reward (10,000)', value: 'mystery_box' },
            )
        )
        .addStringOption(o =>
          o.setName('cooldown')
            .setDescription('Time Skip only — which cooldown to reset')
            .addChoices(
              { name: 'Daily', value: 'daily' },
              { name: 'Work', value: 'work' },
              { name: 'Beg', value: 'beg' },
            )
        )
    ),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand(true);
    const guildId = (interaction.guildId ?? 'global');
    const userId = interaction.user.id;
    const cfg = await getEconomyConfig(guildId);
    const sym = cfg.currency_symbol;

    if (sub === 'browse') {
      const section = (kind: ShopItem['kind']) =>
        SHOP_ITEMS.filter(i => i.kind === kind)
          .map(i => `${i.emoji} **${i.name}** — ${sym} ${i.price.toLocaleString()}\n> ${i.description}`)
          .join('\n');

      const container = new ContainerBuilder()
        .setAccentColor(Colors.Blurple)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `🏪 **Shop**\nBuy with \`/eco shop buy\`.\n\n` +
          `**⏱️ Boosts** *(timed effects)*\n${section('boost')}\n\n` +
          `**🎫 One-Shots** *(stored until they trigger, expire after 7 days)*\n${section('oneshot')}\n\n` +
          `**⚡ Instant** *(happens right away)*\n${section('instant')}`
        ));
      await interaction.reply({ flags: IS_CV2, components: [container] });
      return;
    }

    // buy subcommand
    const itemId = interaction.options.getString('item', true) as ItemId;
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) {
      await interaction.reply(cv2Err('Unknown item.')); return;
    }

    // Time Skip needs its target validated BEFORE charging.
    let skipTarget: string | null = null;
    if (item.id === 'time_skip') {
      skipTarget = interaction.options.getString('cooldown');
      if (!skipTarget || !SKIPPABLE[skipTarget]) {
        await interaction.reply(cv2Err('Pick which cooldown to reset — add the `cooldown` option (Daily, Work, or Beg).'));
        return;
      }
      const { label, windowMs } = SKIPPABLE[skipTarget]!;
      const lastUsed = await getEconomyCooldown(userId, skipTarget);
      if (Date.now() - lastUsed >= windowMs) {
        await interaction.reply(cv2Err(`Your **${label}** cooldown isn't active — nothing to skip, so you weren't charged.`));
        return;
      }
    }

    // Duplicate check for stored effects (boosts and one-shots).
    if (item.kind !== 'instant') {
      const existing = await getActiveBoost(guildId, userId, item.type);
      if (existing) {
        const expiresIn = Math.ceil((existing.expires_at - Date.now()) / 60_000);
        const note = item.kind === 'oneshot'
          ? `You already have an unused **${item.name}** — it triggers on its own (expires in ~${expiresIn} min).`
          : `You already have an active **${item.name}** — expires in ~${expiresIn} min.`;
        await interaction.reply(cv2Err(note));
        return;
      }
    }

    // Charge atomically — the check and the debit are one statement, so two rapid purchases can't both succeed.
    const paid = await adjustBalance(guildId, userId, -item.price, `shop:${item.id}`);
    if (!paid.success) {
      await interaction.reply(cv2Err(`You need **${sym} ${item.price.toLocaleString()}** to buy **${item.name}**. Cash: **${sym} ${paid.newBalance.toLocaleString()}**.`));
      return;
    }

    let resultLine: string;
    if (item.id === 'mystery_box') {
      resultLine = await openMysteryBox(guildId, userId, sym);
    } else if (item.id === 'time_skip') {
      await resetEconomyCooldown(userId, skipTarget!);
      resultLine = `Your **${SKIPPABLE[skipTarget!]!.label}** cooldown was reset — go claim it!`;
    } else {
      await addBoost(guildId, userId, item.type, item.multiplier, Date.now() + item.durationMs);
      resultLine = item.kind === 'oneshot'
        ? `> ${item.description}\nIt sits in your pocket until it triggers.`
        : `> ${item.description}\nActive for the next **${item.durationMs >= HOUR ? `${item.durationMs / HOUR} hour${item.durationMs > HOUR ? 's' : ''}` : `${item.durationMs / 60_000} minutes`}**.`;
    }

    const { balance } = await getOrCreateEconomy(guildId, userId);
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Gold)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `${item.emoji} **${item.name} Purchased!** *(−${sym} ${item.price.toLocaleString()})*\n${resultLine}\n**Balance:** ${sym} **${balance.toLocaleString()}**`
      ));
    await interaction.reply({ flags: IS_CV2, components: [container] });
  },
};

// Serialise purchases per user so the duplicate-boost check and the charge can't interleave.
const shopRun = Shop.run!;
Shop.run = (i) => (i.options.getSubcommand(true) === 'buy' ? withLock(`eco:${i.user.id}`, () => shopRun(i)) : shopRun(i));

export default Shop;
