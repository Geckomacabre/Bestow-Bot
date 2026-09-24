import {
  ApplicationIntegrationType, ChannelType, ChatInputCommandInteraction,
  InteractionContextType, MessageFlags, PermissionFlagsBits, Role,
  SlashCommandBuilder, TextChannel, User,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import {
  getStreamVcConfig, setStreamVcConfig, getStreamVcApprovers,
  addStreamVcApprover, removeStreamVcApprover,
} from '../../utils/db';
import { approverMentions, buildAccessPanel, submitJoinRequest } from '../../utils/streamvc.js';

const StreamVc: Command = {
  data: new SlashCommandBuilder()
    .setName('streamvc')
    .setDescription('Request to join the stream voice channel, or configure it')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub =>
      sub.setName('request')
        .setDescription('Ask the approvers to let you into the stream voice channel')
        .addStringOption(o => o.setName('reason').setDescription('Optional note for the approvers').setMaxLength(300))
    )
    .addSubcommandGroup(group =>
      group.setName('config')
        .setDescription('Configure the stream VC request system (Manage Server)')
        .addSubcommand(sub =>
          sub.setName('set')
            .setDescription('Set the voice channel, the request channel, and the required role')
            .addChannelOption(o =>
              o.setName('vc').setDescription('The stream voice channel (will be locked automatically)')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
            .addChannelOption(o =>
              o.setName('request_channel').setDescription('Channel where join requests are posted for approvers')
                .addChannelTypes(ChannelType.GuildText))
            .addRoleOption(o =>
              o.setName('required_role').setDescription('Role required to request access (e.g. Self Promo)'))
        )
        .addSubcommand(sub =>
          sub.setName('add-approver')
            .setDescription('Add a user or role that can review and approve/reject requests')
            .addMentionableOption(o => o.setName('target').setDescription('User or role').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('remove-approver')
            .setDescription('Remove a user or role from the approvers')
            .addMentionableOption(o => o.setName('target').setDescription('User or role').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('panel')
            .setDescription('Post the “Request to Join” button panel in a channel')
            .addChannelOption(o =>
              o.setName('channel').setDescription('Channel to post the panel in (defaults to here)')
                .addChannelTypes(ChannelType.GuildText))
        )
        .addSubcommand(sub => sub.setName('view').setDescription('Show the current stream VC settings'))
    ),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    // ── /streamvc request ─────────────────────────────────────────────────────
    if (!group && sub === 'request') {
      await submitJoinRequest(interaction, interaction.options.getString('reason'));
      return;
    }

    // ── /streamvc config … (Manage Server) ────────────────────────────────────
    if (group === 'config') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '❌ You need **Manage Server** to configure the stream VC.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'set') {
        const vc = interaction.options.getChannel('vc');
        const requestChannel = interaction.options.getChannel('request_channel');
        const role = interaction.options.getRole('required_role');
        if (!vc && !requestChannel && !role) {
          await interaction.reply({ content: 'Provide a `vc`, `request_channel`, and/or `required_role` to set.', flags: MessageFlags.Ephemeral });
          return;
        }
        await setStreamVcConfig(guildId, {
          vc_id: vc?.id ?? undefined,
          alert_channel_id: requestChannel?.id ?? undefined,
          required_role_id: role?.id ?? undefined,
        });

        // Lock the VC: deny @everyone Connect so the only way in is being accepted.
        let lockNote = '';
        if (vc) {
          const channel = await interaction.guild!.channels.fetch(vc.id).catch(() => null);
          if (channel && 'permissionOverwrites' in channel) {
            try {
              await (channel as any).permissionOverwrites.edit(guildId, { Connect: false });
              lockNote = '\n🔒 Locked the channel — `@everyone` can no longer connect until accepted.';
            } catch {
              lockNote = '\n⚠️ Couldn’t lock the channel automatically — make sure I have **Manage Roles/Channels** on it, then deny `@everyone` the **Connect** permission manually.';
            }
          }
        }

        const cfg = await getStreamVcConfig(guildId);
        await interaction.reply({
          content:
            `✅ Stream VC settings updated.\n` +
            `• Voice channel: ${cfg?.vc_id ? `<#${cfg.vc_id}>` : '*not set*'}\n` +
            `• Request channel: ${cfg?.alert_channel_id ? `<#${cfg.alert_channel_id}>` : '*not set*'}\n` +
            `• Required role: ${cfg?.required_role_id ? `<@&${cfg.required_role_id}>` : '*none*'}` +
            lockNote,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'add-approver') {
        const target = interaction.options.getMentionable('target', true);
        const isRole = target instanceof Role;
        const id = (target as Role | User).id;
        await addStreamVcApprover(guildId, id, isRole);
        await interaction.reply({ content: `✅ ${isRole ? `<@&${id}>` : `<@${id}>`} can now review and approve/reject requests.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'remove-approver') {
        const target = interaction.options.getMentionable('target', true);
        const id = (target as Role | User).id;
        const removed = await removeStreamVcApprover(guildId, id);
        await interaction.reply({ content: removed ? `✅ Removed from the approvers.` : `That user/role wasn’t an approver.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'panel') {
        const cfg = await getStreamVcConfig(guildId);
        const target = (interaction.options.getChannel('channel') ?? interaction.channel);
        if (!(target instanceof TextChannel)) {
          await interaction.reply({ content: '❌ Pick a text channel to post the panel in.', flags: MessageFlags.Ephemeral });
          return;
        }
        await target.send(buildAccessPanel(cfg?.vc_id ?? null, cfg?.required_role_id ?? null));
        await interaction.reply({ content: `✅ Posted the request panel in <#${target.id}>.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'view') {
        const cfg = await getStreamVcConfig(guildId);
        const approvers = await getStreamVcApprovers(guildId);
        await interaction.reply({
          content:
            `🎥 **Stream VC settings**\n` +
            `• Voice channel: ${cfg?.vc_id ? `<#${cfg.vc_id}>` : '*not set*'}\n` +
            `• Request channel: ${cfg?.alert_channel_id ? `<#${cfg.alert_channel_id}>` : '*not set*'}\n` +
            `• Required role: ${cfg?.required_role_id ? `<@&${cfg.required_role_id}>` : '*none*'}\n` +
            `• Approvers: ${approvers.length ? approverMentions(approvers) : '*none set — add one with `/streamvc config add-approver`*'}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
  },
};

export default StreamVc;
