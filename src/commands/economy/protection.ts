import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getOrCreateEconomy, getEconomyConfig, adjustBalance, getProtection, setProtection } from '../../utils/db';
import { cv2Err, IS_CV2 } from '../../utils/components.js';

const PROTECTION_COST = 5_000;
const PROTECTION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const Protection: Command = {
  data: new SlashCommandBuilder()
    .setName('protection')
    .setDescription('Hire mob protection for 24 hours — costs 5,000 coins, prevents robbery')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const cfg = await getEconomyConfig(guildId);
    const sym = cfg.currency_symbol;

    // Check for existing active protection
    const existing = await getProtection(guildId, userId);
    if (existing !== null) {
      const expiresIn = Math.ceil((existing - Date.now()) / 3_600_000);
      await interaction.reply(cv2Err(`You already have mob protection active for another ~${expiresIn} hour${expiresIn !== 1 ? 's' : ''}.`));
      return;
    }

    const eco = await getOrCreateEconomy(guildId, userId);
    if (eco.balance < PROTECTION_COST) {
      await interaction.reply(cv2Err(`You need **${sym} ${PROTECTION_COST.toLocaleString()}** for mob protection. Balance: **${sym} ${eco.balance.toLocaleString()}**.`));
      return;
    }

    const expiresAt = Date.now() + PROTECTION_DURATION_MS;
    await Promise.all([
      adjustBalance(guildId, userId, -PROTECTION_COST),
      setProtection(guildId, userId, expiresAt),
    ]);

    const expiresDate = new Date(expiresAt).toUTCString();
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Gold)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `🛡️ **Mob Protection Activated**\nYou paid **${sym} ${PROTECTION_COST.toLocaleString()}** to hire protection.\nYou are protected from robbery for **24 hours**.\nExpires: *${expiresDate}*`
      ));
    await interaction.reply({ flags: IS_CV2, components: [container] });
  },
};

export default Protection;
