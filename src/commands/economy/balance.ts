import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getOrCreateEconomy, getEconomyConfig } from '../../utils/db';
import { IS_CV2 } from '../../utils/components.js';

const Balance: Command = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your or another user\'s coin balance')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addUserOption(o => o.setName('user').setDescription('User to check (default: yourself)')),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const target = interaction.options.getUser('user') ?? interaction.user;
    const [eco, cfg] = await Promise.all([getOrCreateEconomy(guildId, target.id), getEconomyConfig(guildId)]);
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Gold)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**${cfg.currency_symbol} Balance — ${target.username}**\n**Balance:** ${cfg.currency_symbol} **${eco.balance.toLocaleString()}** ${cfg.currency_name}\n**Total Earned:** ${cfg.currency_symbol} **${eco.total_earned.toLocaleString()}** ${cfg.currency_name}`
      ));
    await interaction.reply({ flags: IS_CV2, components: [container] });
  },
};

export default Balance;
