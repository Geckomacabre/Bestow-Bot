import { layout, escHtml, channelSelect } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild, APIChannel } from '../discord';
import * as db from '../../utils/db';

export async function starboardPage(
  user: SessionUser, guild: APIGuild, channels: APIChannel[],
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const cfg = await db.getStarboardConfig(guild.id);

  const content = /* html */`
    <form method="POST" action="/servers/${guild.id}/starboard">
      <div class="card">
        <h2 class="text-lg font-bold mb-5 text-white">Starboard Settings</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div class="form-group">
            <label>Enabled</label>
            <select name="enabled">
              <option value="1" ${cfg?.enabled ? 'selected' : ''}>Yes</option>
              <option value="0" ${!cfg?.enabled ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>Starboard Channel</label>
            ${channelSelect('channel_id', channels, cfg?.channel_id)}
          </div>
          <div class="form-group">
            <label>Reaction Threshold</label>
            <input name="threshold" type="number" min="1" value="${cfg?.threshold ?? 3}">
          </div>
          <div class="form-group">
            <label>Trigger Emoji</label>
            <input name="emoji" value="${escHtml(cfg?.emoji ?? '⭐')}" placeholder="⭐">
          </div>
        </div>
      </div>
      <button type="submit" class="btn-primary">Save Changes</button>
    </form>
  `;

  return layout({ title: 'Starboard', user, guild, activeHref: `/servers/${guild.id}/starboard`, content, flash, flashType });
}

export async function handleStarboardSave(guildId: string, body: any): Promise<void> {
  await db.setStarboardConfig(guildId, {
    enabled: body.enabled === '1' ? 1 : 0,
    channel_id: body.channel_id || null,
    threshold: Math.max(1, parseInt(body.threshold ?? '') || 3),
    emoji: body.emoji?.trim() || '⭐',
  });
}
