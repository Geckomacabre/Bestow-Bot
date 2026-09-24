import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getEconomyConfig, getEconomyCooldown, setEconomyCooldown, adjustBalance } from '../../utils/db';
import { cv2Err, IS_CV2 } from '../../utils/components.js';

const YEARLY_COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000;

const Yearly: Command = {
  data: new SlashCommandBuilder()
    .setName('yearly')
    .setDescription('Claim your yearly coin reward')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const cfg = await getEconomyConfig(guildId);
    const lastUsed = await getEconomyCooldown(userId, 'yearly');
    const elapsed = Date.now() - lastUsed;
    if (elapsed < YEARLY_COOLDOWN_MS) {
      const remaining = YEARLY_COOLDOWN_MS - elapsed;
      const days = Math.floor(remaining / 86_400_000);
      const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
      await interaction.reply(cv2Err(`You already claimed your yearly reward. Come back in **${days}d ${hours}h**.`)); return;
    }
    const amount = Math.floor(Math.random() * (cfg.yearly_max - cfg.yearly_min + 1)) + cfg.yearly_min;
    const { newBalance } = await adjustBalance(guildId, userId, amount);
    await setEconomyCooldown(userId, 'yearly');
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Gold)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**${cfg.currency_symbol} Yearly Reward**\nYou claimed **${cfg.currency_symbol} ${amount.toLocaleString()} ${cfg.currency_name}**!\nNew balance: **${newBalance.toLocaleString()}**\n*Come back in 365 days for your next reward.*`
      ));
    await interaction.reply({ flags: IS_CV2, components: [container] });
  },
};

export default Yearly;
