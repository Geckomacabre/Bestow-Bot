import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MessageFlags,
  SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getEconomyConfig, getEconomyCooldown, setEconomyCooldown, adjustBalance, getActiveBoost } from '../../utils/db';
import { cv2Text } from '../../utils/components.js';
import { applyDroughtBonus, droughtNote } from '../../utils/droughtBonus.js';

const IS_CV2 = MessageFlags.IsComponentsV2;
const WORK_COOLDOWN_MS = 60 * 60 * 1000;
// No one's worked in this server for 6+ hours? Pay starts climbing, doubling
// every 12 hours after that — reaching the 1,000,000 cap takes over a week of
// nobody working at all, so it stays a rare, exciting find.
const DROUGHT_TUNING = { type: 'work', thresholdMs: 6 * 60 * 60 * 1000, doublingMs: 12 * 60 * 60 * 1000 };
const pendingWorkNotifications = new Map<string, ReturnType<typeof setTimeout>>();

const WORK_JOBS = [
  'worked the night shift at a gas station', 'delivered pizzas', 'mowed lawns in the neighborhood',
  'streamed on Twitch for 3 hours', 'drove for a rideshare app', 'sold some old junk online',
  'walked dogs around the park', 'wrote an article for a blog', 'fixed a neighbor\'s computer',
  'washed cars at the carwash', 'sorted packages at a warehouse', 'helped move furniture',
  'tutored a kid in math', 'flipped burgers at the local diner',
];

function pick<T>(arr: T[]) { return arr[Math.floor(Math.random() * arr.length)]; }

const Work: Command = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work to earn some coins (1-hour cooldown)')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const cfg = await getEconomyConfig(guildId);
    // Overtime Permit halves the cooldown while active.
    const overtime = await getActiveBoost(guildId, userId, 'workcd');
    const cooldownMs = overtime ? WORK_COOLDOWN_MS / 2 : WORK_COOLDOWN_MS;
    const lastUsed = await getEconomyCooldown(userId, 'work');
    const elapsed = Date.now() - lastUsed;
    if (elapsed < cooldownMs) {
      const remaining = cooldownMs - elapsed;
      const minutes = Math.floor(remaining / 60_000);
      const seconds = Math.floor((remaining % 60_000) / 1000);
      await interaction.reply({ ...cv2Text(`You're tired from your last job. Rest for **${minutes}m ${seconds}s** before working again.`), flags: IS_CV2 | MessageFlags.Ephemeral });
      return;
    }
    const magnet = await getActiveBoost(guildId, userId, 'magnet');
    const base = Math.floor(Math.random() * (cfg.work_max - cfg.work_min + 1)) + cfg.work_min;
    const magnetAmount = magnet ? Math.floor(base * magnet.multiplier) : base;
    const drought = await applyDroughtBonus(guildId, magnetAmount, DROUGHT_TUNING);
    const amount = drought.amount;
    const job = pick(WORK_JOBS);
    const { newBalance } = await adjustBalance(guildId, userId, amount);
    await setEconomyCooldown(userId, 'work');
    const boostNotes =
      (magnet ? '\n🧲 *Coin Magnet boosted your pay!*' : '') +
      (overtime ? '\n💼 *Overtime Permit: you can work again in 30 minutes.*' : '') +
      droughtNote(drought);
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Blue)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**${cfg.currency_symbol} Work Complete**\nYou ${job} and earned **${cfg.currency_symbol} ${amount.toLocaleString()} ${cfg.currency_name}**!\nNew balance: **${newBalance.toLocaleString()}**${boostNotes}\n*You can work again in ${overtime ? '30 minutes' : '1 hour'}.*`
      ));
    await interaction.reply({ flags: IS_CV2, components: [container] });
    const existing = pendingWorkNotifications.get(userId);
    if (existing) clearTimeout(existing);
    const { channelId, client } = interaction;
    const timer = setTimeout(async () => {
      pendingWorkNotifications.delete(userId);
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isTextBased()) await (channel as any).send(`⏰ <@${userId}> Your work cooldown is up! Run \`/work\` to earn more ${cfg.currency_symbol} ${cfg.currency_name}.`);
      } catch {}
    }, cooldownMs);
    pendingWorkNotifications.set(userId, timer);
  },
};

export default Work;
