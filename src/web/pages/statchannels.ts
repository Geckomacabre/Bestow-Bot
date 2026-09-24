import { layout, escHtml } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild } from '../discord';
import * as db from '../../utils/db';

const STAT_TYPES = [
  { value: 'members',  label: 'Total Members', example: 'Members: {count}' },
  { value: 'humans',   label: 'Human Members', example: 'Humans: {count}' },
  { value: 'bots',     label: 'Bot Count',     example: 'Bots: {count}' },
  { value: 'channels', label: 'Channel Count', example: 'Channels: {count}' },
  { value: 'roles',    label: 'Role Count',    example: 'Roles: {count}' },
];

export async function statChannelsPage(
  user: SessionUser, guild: APIGuild,
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const stats = await db.getStatChannels(guild.id);

  const content = /* html */`
    <div class="card">
      <h2 class="text-lg font-bold mb-2 text-white">Stat Channels</h2>
      <p class="text-sm text-gray-400 mb-4">
        Creates voice channels with live-updating counts. Use <code>/statschannels add</code> in Discord to create them,
        or manage existing ones here.
      </p>

      ${stats.length ? /* html */`
        <table class="w-full text-sm mb-4">
          <thead><tr class="text-gray-400 border-b" style="border-color:#1e3a5f;">
            <th class="text-left py-2">Channel</th>
            <th class="text-left py-2">Type</th>
            <th class="text-left py-2">Label Template</th>
            <th class="py-2"></th>
          </tr></thead>
          <tbody>
            ${stats.map((s: any) => /* html */`
              <tr class="border-b" style="border-color:#1e3a5f;">
                <td class="py-2 text-xs text-gray-500">${s.channel_id}</td>
                <td class="py-2 text-white">${escHtml(STAT_TYPES.find(t => t.value === s.type)?.label ?? s.type)}</td>
                <td class="py-2 text-gray-300">${escHtml(s.label)}</td>
                <td class="py-2 text-right">
                  <form method="POST" action="/servers/${guild.id}/stat-channels/remove" class="inline">
                    <input type="hidden" name="id" value="${s.id}">
                    <button class="btn-danger text-xs py-1 px-2">Remove</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="text-gray-500 text-sm mb-4">No stat channels configured.</p>'}

      <div class="p-4 rounded-lg text-sm text-gray-400" style="background:#1a1a2e; border:1px solid #1e3a5f;">
        <strong class="text-white">Available types:</strong>
        <ul class="mt-2 space-y-1">
          ${STAT_TYPES.map(t => `<li><code class="text-blue-400">${t.value}</code> — ${t.label} (e.g. <em>${t.example}</em>)</li>`).join('')}
        </ul>
        <p class="mt-2">Use <code>/statschannels add type:members label:"Members: {count}"</code> in Discord to add new ones.</p>
      </div>
    </div>
  `;

  return layout({ title: 'Stat Channels', user, guild, activeHref: `/servers/${guild.id}/stat-channels`, content, flash, flashType });
}
