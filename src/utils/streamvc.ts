import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle,
  ChatInputCommandInteraction, EmbedBuilder, GuildMember, MessageFlags,
  PermissionFlagsBits, TextChannel,
} from 'discord.js';
import {
  getStreamVcConfig, getStreamVcApprovers, type IStreamVcApprover,
} from './db';

const STREAM_COLOR = 0x9146FF; // Twitch purple

// Ping string for the request notice — users as <@id>, roles as <@&id>.
export function approverMentions(approvers: IStreamVcApprover[]): string {
  return approvers.map(a => (a.is_role ? `<@&${a.target_id}>` : `<@${a.target_id}>`)).join(' ');
}

// Whether a member is allowed to approve/reject requests: an explicit approver
// (by user or role), or anyone with Manage Channels (mods/admins always can).
export function canApprove(member: GuildMember, approvers: IStreamVcApprover[]): boolean {
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  for (const a of approvers) {
    if (a.is_role) { if (member.roles.cache.has(a.target_id)) return true; }
    else if (a.target_id === member.id) return true;
  }
  return false;
}

// The persistent panel posted in a channel — one button anyone can click to request.
export function buildAccessPanel(vcId: string | null, requiredRoleId: string | null) {
  const embed = new EmbedBuilder()
    .setColor(STREAM_COLOR)
    .setTitle('🎥 Stream VC Access')
    .setDescription(
      `Want to join ${vcId ? `<#${vcId}>` : 'the stream voice channel'}? Click the button below to send a request.\n\n` +
      (requiredRoleId ? `You need the <@&${requiredRoleId}> role to request.\n` : '') +
      `An approver will let you in once they accept.`
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('streamvc:request').setLabel('Request to Join').setStyle(ButtonStyle.Primary).setEmoji('🎥'),
  );

  return { embeds: [embed], components: [row] };
}

// The notice posted in the request channel. Carries a "Review" button; the actual
// Approve/Reject controls open ephemerally (only the approver who clicks sees them).
function buildRequestNotice(requester: { id: string; tag: string; avatar: string }, vcId: string, reason: string | null) {
  const embed = new EmbedBuilder()
    .setColor(STREAM_COLOR)
    .setAuthor({ name: requester.tag, iconURL: requester.avatar })
    .setTitle('🎥 Stream VC — Join Request')
    .setDescription(`<@${requester.id}> is requesting to join <#${vcId}>.`)
    .setTimestamp();
  if (reason) embed.addFields({ name: 'Reason', value: reason.slice(0, 1000) });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`streamvc:review:${requester.id}`).setLabel('Review Request').setStyle(ButtonStyle.Primary).setEmoji('🛡️'),
  );

  return { embeds: [embed], components: [row] };
}

// The ephemeral Approve/Reject panel shown to an approver after they click Review.
// customId carries the requester plus the original notice (channel + message) so the
// decision can update that notice — no in-memory state, survives restarts.
export function buildDecisionPanel(requesterId: string, channelId: string, messageId: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`streamvc:accept:${requesterId}:${channelId}:${messageId}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`streamvc:decline:${requesterId}:${channelId}:${messageId}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji('✖️'),
  );
  return { content: `Approve <@${requesterId}>’s request to join the stream VC?`, components: [row] };
}

// Shared request flow used by both /streamvc request and the panel button.
export async function submitJoinRequest(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  reason: string | null,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;
  const guildId = guild.id;

  const cfg = await getStreamVcConfig(guildId);
  if (!cfg?.vc_id || !cfg.alert_channel_id) {
    await interaction.reply({ content: '❌ The stream VC system isn’t set up yet. An admin needs to run `/streamvc config set`.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Gate: only members with the required (self-promo) role may request.
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (cfg.required_role_id && (!member || !member.roles.cache.has(cfg.required_role_id))) {
    await interaction.reply({ content: `❌ You need the <@&${cfg.required_role_id}> role to request access to the stream VC.`, flags: MessageFlags.Ephemeral });
    return;
  }

  // Already have access? No need to request.
  const vc = await guild.channels.fetch(cfg.vc_id).catch(() => null);
  if (vc && 'permissionsFor' in vc && member && vc.permissionsFor(member).has(PermissionFlagsBits.Connect)) {
    await interaction.reply({ content: `✅ You already have access to <#${cfg.vc_id}> — just hop in!`, flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await interaction.client.channels.fetch(cfg.alert_channel_id).catch(() => null);
  if (!(channel instanceof TextChannel)) {
    await interaction.reply({ content: '❌ The configured request channel no longer exists. Ask an admin to re-run `/streamvc config set`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const approvers = await getStreamVcApprovers(guildId);
  const ping = approverMentions(approvers);
  await channel.send({
    content: ping ? `🔔 ${ping}` : '🔔 New stream VC join request',
    ...buildRequestNotice(
      { id: interaction.user.id, tag: interaction.user.tag, avatar: interaction.user.displayAvatarURL() },
      cfg.vc_id, reason,
    ),
    allowedMentions: {
      users: approvers.filter(a => !a.is_role).map(a => a.target_id),
      roles: approvers.filter(a => a.is_role).map(a => a.target_id),
    },
  });
  await interaction.reply({ content: `✅ Your request to join <#${cfg.vc_id}> was posted for the approvers. You’ll be let in once one accepts.`, flags: MessageFlags.Ephemeral });
}
