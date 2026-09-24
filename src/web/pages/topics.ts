import { layout, escHtml, channelSelect } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild, APIChannel } from '../discord';
import * as db from '../../utils/db';

export async function topicsPage(
  user: SessionUser, guild: APIGuild, channels: APIChannel[],
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const topicChannels = await db.getTopicChannelsForGuild(guild.id);

  const fmtInterval = (s: number) => {
    if (s >= 86400) return `${Math.round(s / 86400)}d`;
    if (s >= 3600)  return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 60)}m`;
  };

  const content = /* html */`
    <div class="card">
      <h2 class="text-lg font-bold mb-4 text-white">Topic Channels</h2>
      <p class="text-sm text-gray-400 mb-4">A topic message is posted in the channel on a schedule to spark discussion.</p>

      ${topicChannels.length ? /* html */`
        ${await Promise.all(topicChannels.map(async (tc: any) => {
          const topics = await db.getTopics(guild.id, tc.channel_id);
          const ch = channels.find(c => c.id === tc.channel_id);
          return /* html */`
            <div class="mb-5 p-4 rounded-lg" style="background:#1a1a2e; border:1px solid #1e3a5f;">
              <div class="flex items-center justify-between mb-3">
                <span class="font-semibold text-white">#${escHtml(ch?.name ?? tc.channel_id)}</span>
                <div class="flex gap-2 items-center">
                  <span class="badge badge-blue">Every ${fmtInterval(tc.interval_seconds)}</span>
                  <form method="POST" action="/servers/${guild.id}/topics/remove-channel" class="inline">
                    <input type="hidden" name="channel_id" value="${tc.channel_id}">
                    <button class="btn-danger text-xs py-1 px-2">Remove Channel</button>
                  </form>
                </div>
              </div>
              <ul class="space-y-1 mb-3">
                ${topics.map((t: any) => /* html */`
                  <li class="flex items-center gap-2 text-sm text-gray-300">
                    <span class="flex-1">${escHtml(t.text)}</span>
                    <form method="POST" action="/servers/${guild.id}/topics/remove-topic" class="inline">
                      <input type="hidden" name="topic_id" value="${t.id}">
                      <button class="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </form>
                  </li>
                `).join('') || '<li class="text-gray-500 text-xs">No topics yet.</li>'}
              </ul>
              <form method="POST" action="/servers/${guild.id}/topics/add-topic" class="flex gap-2">
                <input type="hidden" name="channel_id" value="${tc.channel_id}">
                <input name="text" placeholder="New discussion topic…" class="flex-1">
                <button type="submit" class="btn-primary text-sm px-3">Add</button>
              </form>
            </div>
          `;
        })).then(r => r.join(''))}
      ` : '<p class="text-gray-500 text-sm mb-4">No topic channels set up yet.</p>'}

      <h3 class="text-base font-semibold mb-3 text-white">Add Topic Channel</h3>
      <form method="POST" action="/servers/${guild.id}/topics/add-channel" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="form-group mb-0">
          <label>Channel</label>
          ${channelSelect('channel_id', channels)}
        </div>
        <div class="form-group mb-0">
          <label>Interval (hours)</label>
          <input name="interval_hours" type="number" min="1" value="24">
        </div>
        <div class="form-group mb-0">
          <label>Mode</label>
          <select name="mode">
            <option value="sequential">Sequential</option>
            <option value="random">Random</option>
          </select>
        </div>
        <div class="sm:col-span-3">
          <button type="submit" class="btn-primary">Add Channel</button>
        </div>
      </form>
    </div>
  `;

  return layout({ title: 'Topics', user, guild, activeHref: `/servers/${guild.id}/topics`, content, flash, flashType });
}
