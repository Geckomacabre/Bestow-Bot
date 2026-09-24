import { layout, escHtml, channelSelect, roleSelect } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild, APIChannel, APIRole } from '../discord';
import * as db from '../../utils/db';

export async function levelingPage(
  user: SessionUser, guild: APIGuild,
  channels: APIChannel[], roles: APIRole[],
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const [cfg, levelRoles] = await Promise.all([
    db.getXpConfig(guild.id),
    db.getLevelRoles(guild.id),
  ]);

  const content = /* html */`
    <form method="POST" action="/servers/${guild.id}/leveling">
      <div class="card">
        <h2 class="text-lg font-bold mb-5 text-white">XP Settings</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div class="form-group">
            <label>Enabled</label>
            <select name="enabled">
              <option value="1" ${cfg?.enabled ? 'selected' : ''}>Yes</option>
              <option value="0" ${!cfg?.enabled ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>XP Cooldown (seconds)</label>
            <input name="cooldown_seconds" type="number" min="1" value="${cfg?.cooldown_seconds ?? 60}">
          </div>
          <div class="form-group">
            <label>XP Per Message (Min)</label>
            <input name="xp_min" type="number" min="1" value="${cfg?.xp_min ?? 15}">
          </div>
          <div class="form-group">
            <label>XP Per Message (Max)</label>
            <input name="xp_max" type="number" min="1" value="${cfg?.xp_max ?? 25}">
          </div>
          <div class="form-group">
            <label>Level-Up Channel</label>
            ${channelSelect('level_up_channel_id', channels, cfg?.level_up_channel_id)}
          </div>
          <div class="form-group">
            <label>Level-Up Announcements</label>
            <select name="level_up_announce">
              <option value="1" ${cfg?.level_up_announce !== 0 ? 'selected' : ''}>Enabled</option>
              <option value="0" ${cfg?.level_up_announce === 0 ? 'selected' : ''}>Disabled</option>
            </select>
          </div>
          <div class="form-group">
            <label>Level-Up Message</label>
            <input name="level_up_message" value="${escHtml(cfg?.level_up_message ?? '')}" placeholder="{user} reached level {level}!">
            <div class="text-xs text-gray-500 mt-1">Variables: {user} {level} {username}</div>
          </div>
        </div>
      </div>
      <button type="submit" class="btn-primary">Save Changes</button>
    </form>

    <div class="card mt-6">
      <h2 class="text-lg font-bold mb-4 text-white">Level Roles</h2>
      <p class="text-sm text-gray-400 mb-4">Assign a role when a member reaches a certain level.</p>

      ${levelRoles.length ? /* html */`
        <table class="w-full text-sm mb-4">
          <thead><tr class="text-gray-400 border-b" style="border-color:#1e3a5f;">
            <th class="text-left py-2">Level</th><th class="text-left py-2">Role</th><th class="py-2"></th>
          </tr></thead>
          <tbody>
            ${levelRoles.map((lr: any) => /* html */`
              <tr class="border-b" style="border-color:#1e3a5f;">
                <td class="py-2 font-bold text-white">${lr.level}</td>
                <td class="py-2 text-gray-300">${escHtml(roles.find(r => r.id === lr.role_id)?.name ?? lr.role_id)}</td>
                <td class="py-2 text-right">
                  <form method="POST" action="/servers/${guild.id}/leveling/roles/remove" class="inline">
                    <input type="hidden" name="role_id" value="${lr.role_id}">
                    <input type="hidden" name="level" value="${lr.level}">
                    <button class="btn-danger text-xs py-1 px-2">Remove</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="text-gray-500 text-sm mb-4">No level roles configured yet.</p>'}

      <form method="POST" action="/servers/${guild.id}/leveling/roles/add" class="flex gap-3 flex-wrap">
        <div class="form-group mb-0 flex-1 min-w-32">
          <label>Level</label>
          <input name="level" type="number" min="1" placeholder="e.g. 5">
        </div>
        <div class="form-group mb-0 flex-1 min-w-48">
          <label>Role</label>
          ${roleSelect('role_id', roles)}
        </div>
        <div class="flex items-end">
          <button type="submit" class="btn-primary">Add</button>
        </div>
      </form>
    </div>
  `;

  return layout({ title: 'Leveling', user, guild, activeHref: `/servers/${guild.id}/leveling`, content, flash, flashType });
}

export async function handleLevelingSave(guildId: string, body: any): Promise<void> {
  await db.setXpConfig(guildId, {
    enabled: body.enabled === '1' ? 1 : 0,
    cooldown_seconds: Math.max(1, parseInt(body.cooldown_seconds ?? '') || 60),
    xp_min: Math.max(1, parseInt(body.xp_min ?? '') || 15),
    xp_max: Math.max(1, parseInt(body.xp_max ?? '') || 25),
    level_up_channel_id: body.level_up_channel_id || null,
    level_up_announce: body.level_up_announce === '1' ? 1 : 0,
    level_up_message: body.level_up_message?.trim() || '{user} leveled up to **{level}**! 🎉',
  });
}
