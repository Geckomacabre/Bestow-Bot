import { layout, escHtml, channelSelect } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild, APIChannel } from '../discord';
import * as db from '../../utils/db';

export async function timezonesPage(
  user: SessionUser, guild: APIGuild, channels: APIChannel[],
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const [tzMessage, timezones] = await Promise.all([
    db.getGuildTimezoneMessage(guild.id),
    db.getGuildTimezones(guild.id),
  ]);

  const ch = tzMessage ? channels.find(c => c.id === tzMessage.channel_id) : null;

  const content = /* html */`
    <form method="POST" action="/servers/${guild.id}/timezones">
      <div class="card">
        <h2 class="text-lg font-bold mb-1 text-white">Timezone Live Message</h2>
        <p class="text-sm text-gray-400 mb-5">
          Bestow will post and continuously update a message in the selected channel showing all members' timezones.
        </p>
        <div class="form-group">
          <label>Channel</label>
          ${channelSelect('channel_id', channels, tzMessage?.channel_id)}
        </div>
        ${tzMessage ? /* html */`
          <p class="text-xs text-green-400 mb-2">
            ✓ Live message active in #${escHtml(ch?.name ?? tzMessage.channel_id)}
          </p>
        ` : ''}
      </div>
      <button type="submit" class="btn-primary">Save &amp; Post Message</button>
    </form>

    <div class="card mt-6">
      <h2 class="text-lg font-bold mb-4 text-white">Member Timezones (${timezones.length})</h2>
      ${timezones.length ? /* html */`
        <table class="w-full text-sm">
          <thead><tr class="text-gray-400 border-b" style="border-color:#1e3a5f;">
            <th class="text-left py-2">User</th>
            <th class="text-left py-2">Timezone</th>
            <th class="text-left py-2">Current Time</th>
          </tr></thead>
          <tbody>
            ${timezones.map((t: any) => {
              let localTime = '—';
              try {
                localTime = new Intl.DateTimeFormat('en-US', {
                  hour: 'numeric', minute: '2-digit', hour12: true, timeZone: t.timezone,
                }).format(Date.now());
              } catch {}
              return /* html */`
                <tr class="border-b" style="border-color:#1e3a5f;">
                  <td class="py-2 text-gray-300">&lt;@${t.user_id}&gt;</td>
                  <td class="py-2 text-white">${escHtml(t.timezone)}</td>
                  <td class="py-2 text-gray-400">${localTime}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      ` : '<p class="text-gray-500 text-sm">No members have set their timezone yet. They can use <code>/timezone set</code>.</p>'}
    </div>
  `;

  return layout({ title: 'Timezones', user, guild, activeHref: `/servers/${guild.id}/timezones`, content, flash, flashType });
}
