import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors, ContainerBuilder,
  InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text, cv2Err, IS_CV2 } from '../../utils/components.js';

const ModConfig: Command = {
  data: new SlashCommandBuilder()
    .setName('modconfig')
    .setDescription('Configure moderation settings')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('modlog').setDescription('Set the modlog channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for mod logs (omit to clear)')))
    .addSubcommand(s => s.setName('dm').setDescription('Toggle DM notifications to punished users')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable DMs').setRequired(true)))
    .addSubcommand(s => s.setName('view').setDescription('View current moderation settings')),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply(cv2Err('❌ You need **Manage Server** to configure moderation.')); return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'modlog') {
      const channel = interaction.options.getChannel('channel');
      await db.setModlogChannel(guildId, channel?.id ?? null);
      await interaction.editReply(cv2Text(channel ? `✅ Modlog channel set to <#${channel.id}>.` : '✅ Modlog channel cleared.'));
    } else if (sub === 'dm') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await db.ensureConfig(guildId);
      await db.db`INSERT OR IGNORE INTO mod_config (guild_id) VALUES (${guildId})`;
      await db.db`UPDATE mod_config SET dm_on_punish = ${enabled ? 1 : 0} WHERE guild_id = ${guildId}`;
      await interaction.editReply(cv2Text(`✅ DM on punish ${enabled ? 'enabled' : 'disabled'}.`));
    } else {
      const cfg = await db.getModConfig(guildId);
      const container = new ContainerBuilder().setAccentColor(Colors.Blue)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**Moderation Config**\n**Modlog Channel:** ${cfg.modlog_channel_id ? `<#${cfg.modlog_channel_id}>` : 'Not set'}\n**DM on Punish:** ${cfg.dm_on_punish ? 'Enabled' : 'Disabled'}\n**Next Case #:** ${cfg.next_case_num}`
        ));
      await interaction.editReply({ flags: IS_CV2, components: [container] });
    }
  },
};

export default ModConfig;
