import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import {
  getOrCreateEconomy, getEconomyConfig, adjustBalance,
  getEconomyCooldown, setEconomyCooldown, getProtection, consumeBoost,
} from '../../utils/db';
import { cv2Err, IS_CV2 } from '../../utils/components.js';
import { rand, randInt } from '../../utils/random.js';

const FAIL_COOLDOWN_MS  = 30 * 60 * 1000; // 30 min after a failed rob
const SUCCESS_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour after a successful rob
const MIN_TARGET_BALANCE = 100;

const Rob: Command = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Attempt to rob another user')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addUserOption(o => o.setName('target').setDescription('Who to rob').setRequired(true)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const target = interaction.options.getUser('target', true);

    if (target.id === userId) {
      await interaction.reply(cv2Err('You cannot rob yourself.')); return;
    }
    if (target.bot) {
      await interaction.reply(cv2Err('You cannot rob a bot.')); return;
    }

    const cfg = await getEconomyConfig(guildId);
    const sym = cfg.currency_symbol;

    // Check robber cooldowns
    const [lastFail, lastSuccess] = await Promise.all([
      getEconomyCooldown(userId, 'rob_fail'),
      getEconomyCooldown(userId, 'rob_success'),
    ]);
    const now = Date.now();
    if (now - lastFail < FAIL_COOLDOWN_MS) {
      const remaining = Math.ceil((FAIL_COOLDOWN_MS - (now - lastFail)) / 60_000);
      await interaction.reply(cv2Err(`You're still lying low after your last failed robbery. Try again in **${remaining} min**.`)); return;
    }
    if (now - lastSuccess < SUCCESS_COOLDOWN_MS) {
      const remaining = Math.ceil((SUCCESS_COOLDOWN_MS - (now - lastSuccess)) / 60_000);
      await interaction.reply(cv2Err(`You need to lay low after your last successful robbery. Try again in **${remaining} min**.`)); return;
    }

    // Check if target has mob protection — if so, rob fails but NO cooldown for robber
    const protection = await getProtection(guildId, target.id);
    if (protection !== null) {
      const expiresIn = Math.ceil((protection - now) / 3_600_000);
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Orange)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `🛡️ **Rob Failed**\n<@${target.id}> has **mob protection** active for another ~${expiresIn}h.\nYour crew backed off — no cooldown this time.`
        ));
      await interaction.reply({ flags: IS_CV2, components: [container] }); return;
    }

    // Check target balance
    const targetEco = await getOrCreateEconomy(guildId, target.id);
    if (targetEco.balance < MIN_TARGET_BALANCE) {
      await interaction.reply(cv2Err(`<@${target.id}> doesn't have enough coins to be worth robbing (minimum ${sym} ${MIN_TARGET_BALANCE}).`)); return;
    }

    // 50/50 success
    const success = rand() < 0.5;

    if (success) {
      // Pure RNG: steal anywhere from a single coin up to the target's entire balance.
      const stolen = randInt(1, targetEco.balance);
      await Promise.all([
        adjustBalance(guildId, target.id, -stolen),
        adjustBalance(guildId, userId, stolen),
        setEconomyCooldown(userId, 'rob_success'),
      ]);
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Green)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `🦹 **Successful Robbery!**\nYou stole **${sym} ${stolen.toLocaleString()}** from <@${target.id}>!\n*You'll need to lay low for 1 hour.*`
        ));
      await interaction.reply({ flags: IS_CV2, components: [container] });
    } else {
      const fine = Math.min(Math.floor(targetEco.balance * 0.05), 500);
      const robberEco = await getOrCreateEconomy(guildId, userId);
      const actualFine = Math.min(fine, robberEco.balance);
      // Goon Squad (one-shot shop item): a failed rob triggers no cooldown.
      const goons = await consumeBoost(guildId, userId, 'goon');
      await Promise.all([
        adjustBalance(guildId, userId, -actualFine),
        adjustBalance(guildId, target.id, actualFine),
        goons ? Promise.resolve() : setEconomyCooldown(userId, 'rob_fail'),
      ]);
      const cooldownLine = goons
        ? '🥊 *Your Goon Squad covered the escape — no cooldown!*'
        : "*You're on a 30-minute cooldown.*";
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Red)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `🚨 **Caught!**\nYou were caught trying to rob <@${target.id}>!\n${actualFine > 0 ? `You paid **${sym} ${actualFine.toLocaleString()}** as a fine.` : 'You had nothing to pay as a fine.'}\n${cooldownLine}`
        ));
      await interaction.reply({ flags: IS_CV2, components: [container] });
    }
  },
};

export default Rob;
