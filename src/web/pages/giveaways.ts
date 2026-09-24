import { layout, escHtml, channelSelect } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild, APIChannel } from '../discord';
import * as db from '../../utils/db';

export async function giveawaysPage(
  user: SessionUser, guild: APIGuild, channels: APIChannel[],
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const giveaways = await db.getAllGiveaways(guild.id);
  const now = Date.now();

  const active = giveaways.filter((g: any) => !g.ended && g.ends_at > now);
  const ended  = giveaways.filter((g: any) => g.ended || g.ends_at <= now);

  const fmtDate = (ms: number) => new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const content = /* html */`
    <div class="card">
      <h2 class="text-lg font-bold mb-4 text-white">Active Giveaways</h2>
      ${active.length ? /* html */`
        <table class="w-full text-sm mb-4">
          <thead><tr class="text-gray-400 border-b" style="border-color:#1e3a5f;">
            <th class="text-left py-2">Prize</th>
            <th class="text-left py-2">Ends</th>
            <th class="text-left py-2">Winners</th>
            <th class="text-left py-2">Entries</th>
            <th class="py-2"></th>
          </tr></thead>
          <tbody>
            ${active.map((g: any) => /* html */`
              <tr class="border-b" style="border-color:#1e3a5f;">
                <td class="py-2 font-semibold text-white">${escHtml(g.prize)}</td>
                <td class="py-2 text-gray-400 text-xs">${fmtDate(g.ends_at)}</td>
                <td class="py-2 text-gray-300">${g.winner_count}</td>
                <td class="py-2 text-gray-300">${JSON.parse(g.entries ?? '[]').length}</td>
                <td class="py-2 text-right flex gap-2 justify-end">
                  <form method="POST" action="/servers/${guild.id}/giveaways/end" class="inline">
                    <input type="hidden" name="id" value="${g.id}">
                    <button class="btn-primary text-xs py-1 px-2">End Now</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="text-gray-500 text-sm mb-4">No active giveaways.</p>'}
    </div>

    <div class="card">
      <h2 class="text-lg font-bold mb-4 text-white">Start a Giveaway</h2>
      <form method="POST" action="/servers/${guild.id}/giveaways/create" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-group mb-0 sm:col-span-2">
          <label>Prize</label>
          <input name="prize" placeholder="e.g. Discord Nitro" required>
        </div>
        <div class="form-group mb-0">
          <label>Channel</label>
          ${channelSelect('channel_id', channels)}
        </div>
        <div class="form-group mb-0">
          <label>Number of Winners</label>
          <input name="winner_count" type="number" min="1" value="1">
        </div>
        <div class="form-group mb-0">
          <label>Duration (minutes)</label>
          <input name="duration_minutes" type="number" min="1" value="60">
        </div>
        <div class="sm:col-span-2">
          <button type="submit" class="btn-primary">Start Giveaway</button>
        </div>
      </form>
    </div>

    ${ended.length ? /* html */`
      <div class="card">
        <h2 class="text-lg font-bold mb-4 text-white">Past Giveaways</h2>
        <table class="w-full text-sm">
          <thead><tr class="text-gray-400 border-b" style="border-color:#1e3a5f;">
            <th class="text-left py-2">Prize</th><th class="text-left py-2">Ended</th><th class="py-2"></th>
          </tr></thead>
          <tbody>
            ${ended.slice(0, 10).map((g: any) => /* html */`
              <tr class="border-b" style="border-color:#1e3a5f;">
                <td class="py-2 text-gray-300">${escHtml(g.prize)}</td>
                <td class="py-2 text-gray-500 text-xs">${fmtDate(g.ends_at)}</td>
                <td class="py-2 text-right">
                  <form method="POST" action="/servers/${guild.id}/giveaways/reroll" class="inline">
                    <input type="hidden" name="id" value="${g.id}">
                    <button class="btn-primary text-xs py-1 px-2">Reroll</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}
  `;

  return layout({ title: 'Giveaways', user, guild, activeHref: `/servers/${guild.id}/giveaways`, content, flash, flashType });
}
