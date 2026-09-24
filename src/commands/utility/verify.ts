import {
  ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, Colors, EmbedBuilder,
  InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getVerifyConfig, setVerifyConfig } from '../../utils/db';

const VerifyCmd: Command = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verification gate setup')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s
      .setName('setup')
      .setDescription('Post the verification button in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post the verify button in').setRequired(true))
      .addRoleOption(o => o.setName('member_role').setDescription('Role to assign when verified').setRequired(true))
      .addRoleOption(o => o.setName('unverified_role').setDescription('Role to remove when verified (optional)'))
      .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Embed description').setRequired(false)))
    .addSubcommand(s => s
      .setName('config')
      .setDescription('Show current verify config')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === 'config') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const cfg = await getVerifyConfig(guildId);
      if (!cfg) {
        await interaction.editReply('No verify config set up. Use `/verify setup` first.');
        return;
      }
      await interaction.editReply(
        `**Verify Config**\nChannel: <#${cfg.channel_id}>\nMember role: <@&${cfg.member_role_id}>\nUnverified role: ${cfg.unverified_role_id ? `<@&${cfg.unverified_role_id}>` : 'None'}`
      );
      return;
    }

    // setup
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel('channel', true) as any;
    const memberRole = interaction.options.getRole('member_role', true);
    const unverifiedRole = interaction.options.getRole('unverified_role');
    const title = interaction.options.getString('title') ?? '✅ Verify to gain access';
    const description = interaction.options.getString('description') ??
      'Click the **Verify** button below to confirm you are human and unlock the server.';

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(title)
      .setDescription(description);

    const button = new ButtonBuilder()
      .setCustomId('verify_btn')
      .setLabel('Verify')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    let msg: any;
    try {
      msg = await channel.send({ embeds: [embed], components: [row] });
    } catch {
      await interaction.editReply('❌ Could not post in that channel. Make sure I have Send Messages permission there.');
      return;
    }

    await setVerifyConfig(guildId, {
      channel_id: channel.id,
      message_id: msg.id,
      member_role_id: memberRole.id,
      unverified_role_id: unverifiedRole?.id ?? null,
    });

    await interaction.editReply(
      `✅ Verify button posted in <#${channel.id}>.\nMember role: <@&${memberRole.id}>${unverifiedRole ? `\nUnverified role removed on verify: <@&${unverifiedRole.id}>` : ''}`
    );
  },
};

export default VerifyCmd;
