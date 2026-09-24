import { layout, escHtml, channelSelect } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild, APIChannel } from '../discord';
import * as db from '../../utils/db';

type LogGroup = {
  label: string;
  channelField: keyof db.ILogConfig;
  flags: Array<{ key: keyof db.ILogConfig; label: string }>;
};

const LOG_GROUPS: LogGroup[] = [
  {
    label: 'Member Logs',
    channelField: 'member_log_channel_id',
    flags: [
      { key: 'log_joins',           label: 'Member Joined' },
      { key: 'log_leaves',          label: 'Member Left' },
      { key: 'log_bans',            label: 'Member Banned / Unbanned' },
      { key: 'log_nickname_changes',label: 'Nickname Changed' },
      { key: 'log_role_changes',    label: 'Member Roles Changed' },
      { key: 'log_member_profile',  label: 'Username / Avatar Changed' },
    ],
  },
  {
    label: 'Message Logs',
    channelField: 'message_log_channel_id',
    flags: [
      { key: 'log_message_edits',   label: 'Message Edited' },
      { key: 'log_message_deletes', label: 'Message Deleted' },
    ],
  },
  {
    label: 'Voice Logs',
    channelField: 'voice_log_channel_id',
    flags: [
      { key: 'log_voice_events',    label: 'Voice Join / Leave / Move' },
    ],
  },
  {
    label: 'Server Logs',
    channelField: 'server_log_channel_id',
    flags: [
      { key: 'log_emoji_changes',   label: 'Emoji Added / Removed / Renamed' },
      { key: 'log_channel_changes', label: 'Channel Created / Deleted' },
      { key: 'log_server_updates',  label: 'Server Settings Changed' },
    ],
  },
  {
    label: 'Command Logs',
    channelField: 'command_log_channel_id',
    flags: [
      { key: 'log_commands', label: 'Slash Command Used (track raid bots / suspicious activity)' },
    ],
  },
];

const ALL_FLAGS = LOG_GROUPS.flatMap(g => g.flags);

export async function logsPage(
  user: SessionUser, guild: APIGuild, channels: APIChannel[],
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const cfg = await db.getLogConfig(guild.id);

  const groupHtml = LOG_GROUPS.map(group => /* html */`
    <div class="card mb-4">
      <h3 class="text-base font-semibold mb-3 text-white">${escHtml(group.label)}</h3>
      <div class="form-group mb-4">
        <label>Channel <span class="text-xs text-gray-500">(overrides default — leave blank to use default)</span></label>
        ${channelSelect(group.channelField as string, channels, (cfg as any)?.[group.channelField])}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${group.flags.map(f => /* html */`
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="${f.key}" value="1" ${(cfg as any)?.[f.key] ? 'checked' : ''}
              class="w-4 h-4 rounded accent-indigo-500">
            <span class="text-sm text-gray-300">${escHtml(f.label)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  const content = /* html */`
    <form method="POST" action="/servers/${guild.id}/logs">
      <div class="card mb-4">
        <h2 class="text-lg font-bold mb-1 text-white">Log Settings</h2>
        <p class="text-sm text-gray-400 mb-5">Configure a default fallback channel, then optionally set per-category channels below.</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div class="form-group">
            <label>Enabled</label>
            <select name="enabled">
              <option value="1" ${cfg?.enabled ? 'selected' : ''}>Yes</option>
              <option value="0" ${!cfg?.enabled ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>Default Log Channel</label>
            ${channelSelect('channel_id', channels, cfg?.channel_id)}
          </div>
        </div>
      </div>

      ${groupHtml}

      <button type="submit" class="btn-primary mt-2">Save Changes</button>
    </form>
  `;

  return layout({ title: 'Logs', user, guild, activeHref: `/servers/${guild.id}/logs`, content, flash, flashType });
}

export async function handleLogsSave(guildId: string, body: any): Promise<void> {
  const update: Partial<Omit<db.ILogConfig, 'guild_id'>> = {
    enabled: body.enabled === '1' ? 1 : 0,
    channel_id: body.channel_id || null,
    member_log_channel_id: body.member_log_channel_id || null,
    message_log_channel_id: body.message_log_channel_id || null,
    voice_log_channel_id: body.voice_log_channel_id || null,
    server_log_channel_id: body.server_log_channel_id || null,
    command_log_channel_id: body.command_log_channel_id || null,
  };
  for (const { key } of ALL_FLAGS) {
    (update as any)[key] = body[key] === '1' ? 1 : 0;
  }
  await db.updateLogConfig(guildId, update);
}
