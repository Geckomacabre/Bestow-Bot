import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getEconomyConfig, getEconomyCooldown, setEconomyCooldown, adjustBalance } from '../../utils/db';
import { cv2Err, IS_CV2 } from '../../utils/components.js';

const MONTHLY_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

const Monthly: Command = {
  data: new SlashCommandBuilder()
    .setName('monthly')
    .setDescription('Claim your monthly coin reward')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const cfg = await getEconomyConfig(guildId);
    const lastUsed = await getEconomyCooldown(userId, 'monthly');
    const elapsed = Date.now() - lastUsed;
    if (elapsed < MONTHLY_COOLDOWN_MS) {
      const remaining = MONTHLY_COOLDOWN_MS - elapsed;
      const days = Math.floor(remaining / 86_400_000);
      const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
      const minutes = Math.floor((remaining % 3_600_000) / 60_000);
      await interaction.reply(cv2Err(`You already claimed your monthly reward. Come back in **${days}d ${hours}h ${minutes}m**.`)); return;
    }
    const amount = Math.floor(Math.random() * (cfg.monthly_max - cfg.monthly_min + 1)) + cfg.monthly_min;
    const { newBalance } = await adjustBalance(guildId, userId, amount);
    await setEconomyCooldown(userId, 'monthly');
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Green)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**${cfg.currency_symbol} Monthly Reward**\nYou claimed **${cfg.currency_symbol} ${amount.toLocaleString()} ${cfg.currency_name}**!\nNew balance: **${newBalance.toLocaleString()}**\n*Come back in 30 days for your next reward.*`
      ));
    await interaction.reply({ flags: IS_CV2, components: [container] });
  },
};

export default Monthly;
