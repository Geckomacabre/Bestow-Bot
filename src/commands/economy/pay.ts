import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getOrCreateEconomy, getEconomyConfig, adjustBalance } from '../../utils/db';
import { cv2Err, IS_CV2 } from '../../utils/components.js';

const Pay: Command = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Send coins to another user')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addUserOption(o => o.setName('user').setDescription('User to pay').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const sender = interaction.user;
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    if (target.id === sender.id) { await interaction.reply(cv2Err('❌ You cannot pay yourself.')); return; }
    if (target.bot) { await interaction.reply(cv2Err('❌ You cannot pay bots.')); return; }
    const cfg = await getEconomyConfig(guildId);
    const senderEco = await getOrCreateEconomy(guildId, sender.id);
    if (senderEco.balance < amount) {
      await interaction.reply(cv2Err(`❌ Insufficient balance. You have **${cfg.currency_symbol} ${senderEco.balance.toLocaleString()}**.`)); return;
    }
    await adjustBalance(guildId, sender.id, -amount);
    await adjustBalance(guildId, target.id, amount);
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Green)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**${cfg.currency_symbol} Payment Sent**\n<@${sender.id}> sent **${cfg.currency_symbol} ${amount.toLocaleString()} ${cfg.currency_name}** to <@${target.id}>.`
      ));
    await interaction.reply({ flags: IS_CV2, components: [container] });
  },
};

export default Pay;
