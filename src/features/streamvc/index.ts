import {
  ButtonInteraction, EmbedBuilder, GuildMember, MessageFlags, TextChannel, VoiceChannel,
} from 'discord.js';
import { EventModule } from '../feature';
import { canApprove, submitJoinRequest, buildDecisionPanel } from '../../utils/streamvc.js';

const streamVcModule: EventModule = {
  name: 'streamvc',
  handlers: {
    interactionCreate: async ({ data: [interaction], db }) => {
      if (!(interaction as any).isButton()) return;
      const btn = interaction as ButtonInteraction;
      if (!btn.customId.startsWith('streamvc:')) return;
      const parts = btn.customId.split(':');
      const action = parts[1];

      // Member clicks the public panel → submit a request (role-gated inside).
      if (action === 'request') {
        await submitJoinRequest(btn, null);
        return;
      }

      if (!btn.guildId) return;
      const approvers = await db.getStreamVcApprovers(btn.guildId);
      const member = btn.member as GuildMember | null;

      // Review → open the ephemeral Approve/Reject panel (only this approver sees it).
      if (action === 'review') {
        const requesterId = parts[2];
        if (!member || !canApprove(member, approvers)) {
          await btn.reply({ content: '❌ Only an approver can review join requests.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (!btn.message.components.length) {
          await btn.reply({ content: 'This request has already been handled.', flags: MessageFlags.Ephemeral });
          return;
        }
        await btn.reply({ ...buildDecisionPanel(requesterId!, btn.channelId, btn.message.id), flags: MessageFlags.Ephemeral });
        return;
      }

      // Approve / Reject (from the ephemeral panel).
      if (action !== 'accept' && action !== 'decline') return;
      const [, , requesterId, noticeChannelId, noticeMessageId] = parts;
      if (!requesterId || !noticeChannelId || !noticeMessageId) return;

      if (!member || !canApprove(member, approvers)) {
        await btn.update({ content: '❌ Only an approver can decide this request.', components: [] }).catch(() => {});
        return;
      }

      // The original notice is the source of truth — if its buttons are gone, it's done.
      const noticeChannel = await btn.client.channels.fetch(noticeChannelId).catch(() => null);
      const notice = noticeChannel instanceof TextChannel
        ? await noticeChannel.messages.fetch(noticeMessageId).catch(() => null)
        : null;
      if (notice && notice.components.length === 0) {
        await btn.update({ content: 'This request was already handled by another approver.', components: [] }).catch(() => {});
        return;
      }

      const accepted = action === 'accept';

      if (accepted) {
        const cfg = await db.getStreamVcConfig(btn.guildId);
        const vc = cfg?.vc_id ? await btn.guild!.channels.fetch(cfg.vc_id).catch(() => null) : null;
        if (!(vc instanceof VoiceChannel)) {
          await btn.update({ content: '❌ The configured voice channel no longer exists.', components: [] }).catch(() => {});
          return;
        }
        try {
          await vc.permissionOverwrites.edit(requesterId, { Connect: true, ViewChannel: true });
        } catch (err) {
          console.error('[streamvc] failed to grant access:', err);
          await btn.update({ content: '❌ I couldn’t grant access — check that I have **Manage Roles/Channels** on that VC.', components: [] }).catch(() => {});
          return;
        }
        await btn.client.users.send(requesterId, `✅ You’ve been approved to join <#${cfg!.vc_id}> in **${btn.guild!.name}** — hop in!`).catch(() => {});
      } else {
        await btn.client.users.send(requesterId, `✖️ Your request to join the stream voice channel in **${btn.guild!.name}** was declined.`).catch(() => {});
      }

      // Update the public notice to the outcome and drop its Review button.
      if (notice) {
        const base = notice.embeds[0] ? EmbedBuilder.from(notice.embeds[0]) : new EmbedBuilder();
        base.setColor(accepted ? 0x57F287 : 0xED4245)
          .addFields({ name: 'Status', value: `${accepted ? '✅ Approved' : '✖️ Rejected'} by <@${btn.user.id}>` });
        await notice.edit({ embeds: [base], components: [] }).catch(() => {});
      }

      // Update the approver's ephemeral panel to confirm their action.
      await btn.update({
        content: accepted ? `✅ You approved <@${requesterId}> — they can now join.` : `✖️ You rejected <@${requesterId}>’s request.`,
        components: [],
      }).catch(() => {});
    },
  },
};

export default streamVcModule;
