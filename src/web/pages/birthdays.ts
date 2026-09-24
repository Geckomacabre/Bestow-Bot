import { layout, escHtml, channelSelect } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild, APIChannel } from '../discord';
import * as db from '../../utils/db';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export async function birthdaysPage(
  user: SessionUser, guild: APIGuild, channels: APIChannel[],
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const [cfg, birthdays] = await Promise.all([
    db.getBirthdayConfig(guild.id),
    db.getBirthdays(guild.id),
  ]);

  const content = /* html */`
    <form method="POST" action="/servers/${guild.id}/birthdays">
      <div class="card">
        <h2 class="text-lg font-bold mb-5 text-white">Birthday Settings</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div class="form-group">
            <label>Enabled</label>
            <select name="enabled">
              <option value="1" ${cfg?.enabled ? 'selected' : ''}>Yes</option>
              <option value="0" ${!cfg?.enabled ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>Birthday Announcement Channel</label>
            ${channelSelect('channel_id', channels, cfg?.channel_id)}
          </div>
        </div>
      </div>
      <button type="submit" class="btn-primary">Save Changes</button>
    </form>

    <div class="card mt-6">
      <h2 class="text-lg font-bold mb-4 text-white">Upcoming Birthdays</h2>
      ${birthdays.length ? /* html */`
        <table class="w-full text-sm">
          <thead><tr class="text-gray-400 border-b" style="border-color:#1e3a5f;">
            <th class="text-left py-2">User</th>
            <th class="text-left py-2">Date</th>
          </tr></thead>
          <tbody>
            ${birthdays.map((b: any) => /* html */`
              <tr class="border-b" style="border-color:#1e3a5f;">
                <td class="py-2 text-gray-300"><@${b.user_id}> <span class="text-gray-500 text-xs">(${b.user_id})</span></td>
                <td class="py-2 text-white">${MONTHS[b.month - 1]} ${b.day}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="text-gray-500 text-sm">No birthdays registered yet. Members can use <code>/birthday set</code>.</p>'}
    </div>
  `;

  return layout({ title: 'Birthdays', user, guild, activeHref: `/servers/${guild.id}/birthdays`, content, flash, flashType });
}

export async function handleBirthdaySave(guildId: string, body: any): Promise<void> {
  await db.setBirthdayConfig(guildId, {
    enabled: body.enabled === '1' ? 1 : 0,
    channel_id: body.channel_id || null,
  });
}
