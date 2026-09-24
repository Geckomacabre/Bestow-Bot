import { layout, escHtml } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild } from '../discord';
import * as db from '../../utils/db';

const TRIGGER_TYPES = [
  { value: 'banned_words',  label: 'Banned Words' },
  { value: 'spam',          label: 'Spam Detection' },
  { value: 'invite_links',  label: 'Discord Invite Links' },
  { value: 'mass_mentions', label: 'Mass Mentions' },
  { value: 'caps',          label: 'Excessive Caps' },
  { value: 'links',         label: 'External Links' },
];

const ACTIONS = [
  { value: 'delete',  label: 'Delete Message' },
  { value: 'warn',    label: 'Warn User' },
  { value: 'timeout', label: 'Timeout User' },
  { value: 'kick',    label: 'Kick User' },
  { value: 'ban',     label: 'Ban User' },
];

export async function automodPage(
  user: SessionUser, guild: APIGuild,
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const rules = await db.getAutomodRules(guild.id);

  const content = /* html */`
    <div class="card">
      <h2 class="text-lg font-bold mb-4 text-white">Automod Rules</h2>

      ${rules.length ? /* html */`
        <table class="w-full text-sm mb-6">
          <thead><tr class="text-gray-400 border-b" style="border-color:#1e3a5f;">
            <th class="text-left py-2">Name</th>
            <th class="text-left py-2">Trigger</th>
            <th class="text-left py-2">Action</th>
            <th class="text-left py-2">Value</th>
            <th class="text-left py-2">Status</th>
            <th class="py-2"></th>
          </tr></thead>
          <tbody>
            ${rules.map((r: db.IAutomodRule) => /* html */`
              <tr class="border-b" style="border-color:#1e3a5f;">
                <td class="py-2 font-semibold text-white">${escHtml(r.name)}</td>
                <td class="py-2 text-gray-300">${escHtml(TRIGGER_TYPES.find(t => t.value === r.trigger_type)?.label ?? r.trigger_type)}</td>
                <td class="py-2 text-gray-300">${escHtml(ACTIONS.find(a => a.value === r.action)?.label ?? r.action)}</td>
                <td class="py-2 text-gray-400 text-xs max-w-40 truncate">${escHtml(r.trigger_value ?? '—')}</td>
                <td class="py-2">
                  <span class="badge ${r.enabled ? 'badge-green' : 'badge-red'}">${r.enabled ? 'On' : 'Off'}</span>
                </td>
                <td class="py-2 text-right">
                  <form method="POST" action="/servers/${guild.id}/automod/remove" class="inline">
                    <input type="hidden" name="id" value="${r.id}">
                    <button class="btn-danger text-xs py-1 px-2">Remove</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="text-gray-500 text-sm mb-4">No automod rules configured yet.</p>'}

      <h3 class="text-base font-semibold mb-3 text-white">Add Rule</h3>
      <form method="POST" action="/servers/${guild.id}/automod/add" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-group mb-0">
          <label>Rule Name</label>
          <input name="name" placeholder="e.g. No swearing" required>
        </div>
        <div class="form-group mb-0">
          <label>Trigger Type</label>
          <select name="trigger_type">
            ${TRIGGER_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group mb-0">
          <label>Trigger Value <span class="text-gray-500">(word list, threshold, etc.)</span></label>
          <input name="trigger_value" placeholder="e.g. badword1, badword2">
        </div>
        <div class="form-group mb-0">
          <label>Action</label>
          <select name="action">
            ${ACTIONS.map(a => `<option value="${a.value}">${a.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group mb-0">
          <label>Action Reason <span class="text-gray-500">(optional)</span></label>
          <input name="action_reason" placeholder="Automod: rule violation">
        </div>
        <div class="form-group mb-0">
          <label>Timeout Duration (minutes) <span class="text-gray-500">(for timeout action)</span></label>
          <input name="action_duration" type="number" min="1" placeholder="10">
        </div>
        <div class="sm:col-span-2">
          <button type="submit" class="btn-primary">Add Rule</button>
        </div>
      </form>
    </div>
  `;

  return layout({ title: 'Automod', user, guild, activeHref: `/servers/${guild.id}/automod`, content, flash, flashType });
}
