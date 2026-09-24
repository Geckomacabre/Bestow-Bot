import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors, ContainerBuilder,
  InteractionContextType, MessageFlags, SlashCommandBuilder, TextChannel, TextDisplayBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import Config from '../../config';
import { Command } from '../../interfaces/command';
import { cv2Text, IS_CV2 } from '../../utils/components.js';

const Report: Command = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription("Report a member to the server's staff")
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addUserOption(o => o.setName('user').setDescription('Member to report').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the report').setRequired(true)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cfg = await db.getModConfig(guildId);
    const channelId = cfg.modlog_channel_id ?? Config.REPORT_CHANNEL_ID;
    if (!channelId) { await interaction.editReply(cv2Text('❌ No report channel configured. Ask an admin to set a modlog channel with `/modconfig modlog`.')); return; }
    const ch = await interaction.guild!.channels.fetch(channelId).catch(() => null) as TextChannel | null;
    if (!ch) { await interaction.editReply(cv2Text('❌ Report channel not found. Contact an admin.')); return; }
    const modCase = await db.createModCase(guildId, 'report', user.id, user.tag, interaction.user.id, interaction.user.tag, reason);
    const container = new ContainerBuilder().setAccentColor(Colors.Blue)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**Case #${modCase.case_num} — Report**\n**Reported User:** ${user.tag} (${user.id})\n**Reporter:** ${interaction.user.tag}\n**Channel:** <#${interaction.channelId}>\n**Reason:** ${reason}`
      ));
    await ch.send({ flags: IS_CV2, components: [container] }).catch(() => {});
    await interaction.editReply(cv2Text('✅ Your report has been submitted to the moderation team.'));
  },
};

export default Report;
