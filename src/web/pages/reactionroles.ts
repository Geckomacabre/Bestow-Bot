import { layout, escHtml, roleSelect } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild, APIRole } from '../discord';
import * as db from '../../utils/db';

export async function reactionRolesPage(
  user: SessionUser, guild: APIGuild, roles: APIRole[],
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const entries = await db.getReactionRoles(guild.id);

  const content = /* html */`
    <div class="card">
      <h2 class="text-lg font-bold mb-4 text-white">Reaction Roles</h2>

      ${entries.length ? /* html */`
        <table class="w-full text-sm mb-6">
          <thead><tr class="text-gray-400 border-b" style="border-color:#1e3a5f;">
            <th class="text-left py-2">Message Link</th>
            <th class="text-left py-2">Emoji</th>
            <th class="text-left py-2">Role</th>
            <th class="py-2"></th>
          </tr></thead>
          <tbody>
            ${entries.map((e: any) => /* html */`
              <tr class="border-b" style="border-color:#1e3a5f;">
                <td class="py-2 text-xs text-blue-400">
                  <a href="https://discord.com/channels/${guild.id}/${e.channel_id}/${e.message_id}" target="_blank" class="hover:underline">
                    #…/${e.message_id}
                  </a>
                </td>
                <td class="py-2 text-xl">${escHtml(e.emoji)}</td>
                <td class="py-2 text-gray-300">@${escHtml(roles.find(r => r.id === e.role_id)?.name ?? e.role_id)}</td>
                <td class="py-2 text-right">
                  <form method="POST" action="/servers/${guild.id}/reaction-roles/remove" class="inline">
                    <input type="hidden" name="id" value="${e.id}">
                    <button class="btn-danger text-xs py-1 px-2">Remove</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="text-gray-500 text-sm mb-4">No reaction roles configured yet.</p>'}

      <h3 class="text-base font-semibold mb-3 text-white">Add Reaction Role</h3>
      <form method="POST" action="/servers/${guild.id}/reaction-roles/add" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-group mb-0 sm:col-span-2">
          <label>Message Link</label>
          <input name="message_link" placeholder="https://discord.com/channels/…/…/…" required>
          <div class="text-xs text-gray-500 mt-1">Right-click a message → Copy Message Link</div>
        </div>
        <div class="form-group mb-0">
          <label>Emoji</label>
          <input name="emoji" placeholder="⭐ or custom emoji ID" required>
        </div>
        <div class="form-group mb-0">
          <label>Role</label>
          ${roleSelect('role_id', roles)}
        </div>
        <div class="sm:col-span-2">
          <button type="submit" class="btn-primary">Add</button>
        </div>
      </form>
    </div>
  `;

  return layout({ title: 'Reaction Roles', user, guild, activeHref: `/servers/${guild.id}/reaction-roles`, content, flash, flashType });
}
