import { layout, escHtml, channelSelect } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild, APIChannel } from '../discord';
import * as db from '../../utils/db';

export async function welcomePage(
  user: SessionUser, guild: APIGuild, channels: APIChannel[],
  flash?: string, flashType?: 'success' | 'error'
): Promise<string> {
  const cfg = await db.getWelcomeConfig(guild.id);

  const content = /* html */`
    <form method="POST" action="/servers/${guild.id}/welcome">

      <!-- ── Welcome ─────────────────────────────────────────────────────── -->
      <div class="card mb-4">
        <h2 class="text-lg font-bold mb-1 text-white">Welcome Messages</h2>
        <p class="text-sm text-gray-400 mb-5">Sent in a channel when a new member joins.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div class="form-group">
            <label>Enabled</label>
            <select name="enabled">
              <option value="1" ${cfg?.enabled ? 'selected' : ''}>Yes</option>
              <option value="0" ${!cfg?.enabled ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>Channel</label>
            ${channelSelect('channel_id', channels, cfg?.channel_id)}
          </div>
        </div>
        <div class="form-group">
          <label>Message</label>
          <textarea name="message" rows="3" placeholder="Welcome {user} to **{server}**!">${escHtml(cfg?.message ?? '')}</textarea>
          <div class="text-xs text-gray-500 mt-1">Variables: {user} {username} {server} {membercount} {#membercount}</div>
        </div>
        <div class="form-group">
          <label>GIF / Image URL <span class="text-gray-500">(optional — shown as embed image)</span></label>
          <input type="text" name="image_url" value="${escHtml(cfg?.image_url ?? '')}" placeholder="https://tenor.com/view/... or direct .gif URL">
          <div class="text-xs text-gray-500 mt-1">Any image or GIF URL — Tenor/Giphy share links work fine.</div>
        </div>
        <div class="form-group">
          <label>DM Message <span class="text-gray-500">(optional — sent directly to new member)</span></label>
          <textarea name="dm_message" rows="2" placeholder="Welcome to {server}! Check out the rules.">${escHtml(cfg?.dm_message ?? '')}</textarea>
        </div>
      </div>

      <!-- ── Leave ───────────────────────────────────────────────────────── -->
      <div class="card mb-4">
        <h2 class="text-lg font-bold mb-1 text-white">Leave Messages</h2>
        <p class="text-sm text-gray-400 mb-5">Sent in a channel when a member leaves the server.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div class="form-group">
            <label>Enabled</label>
            <select name="leave_enabled">
              <option value="1" ${cfg?.leave_enabled ? 'selected' : ''}>Yes</option>
              <option value="0" ${!cfg?.leave_enabled ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>Channel</label>
            ${channelSelect('leave_channel_id', channels, cfg?.leave_channel_id)}
          </div>
        </div>
        <div class="form-group">
          <label>Message</label>
          <textarea name="leave_message" rows="3" placeholder="{username} has left **{server}**. We now have {membercount} members.">${escHtml(cfg?.leave_message ?? '')}</textarea>
          <div class="text-xs text-gray-500 mt-1">Variables: {user} {username} {server} {membercount} {#membercount}</div>
        </div>
        <div class="form-group">
          <label>GIF / Image URL <span class="text-gray-500">(optional)</span></label>
          <input type="text" name="leave_image_url" value="${escHtml(cfg?.leave_image_url ?? '')}" placeholder="https://tenor.com/view/... or direct .gif URL">
          <div class="text-xs text-gray-500 mt-1">Any image or GIF URL — Tenor/Giphy share links work fine.</div>
        </div>
      </div>

      <!-- ── Ban ─────────────────────────────────────────────────────────── -->
      <div class="card mb-4">
        <h2 class="text-lg font-bold mb-1 text-white">Ban Messages</h2>
        <p class="text-sm text-gray-400 mb-5">Sent in a channel when a member is banned.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div class="form-group">
            <label>Enabled</label>
            <select name="ban_enabled">
              <option value="1" ${cfg?.ban_enabled ? 'selected' : ''}>Yes</option>
              <option value="0" ${!cfg?.ban_enabled ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>Channel</label>
            ${channelSelect('ban_channel_id', channels, cfg?.ban_channel_id)}
          </div>
        </div>
        <div class="form-group">
          <label>Message</label>
          <textarea name="ban_message" rows="3" placeholder="{username} has been banned. Reason: {reason}">${escHtml(cfg?.ban_message ?? '')}</textarea>
          <div class="text-xs text-gray-500 mt-1">Variables: {user} {username} {server} {reason}</div>
        </div>
        <div class="form-group">
          <label>GIF / Image URL <span class="text-gray-500">(optional)</span></label>
          <input type="text" name="ban_image_url" value="${escHtml(cfg?.ban_image_url ?? '')}" placeholder="https://tenor.com/view/... or direct .gif URL">
          <div class="text-xs text-gray-500 mt-1">Any image or GIF URL — Tenor/Giphy share links work fine.</div>
        </div>
      </div>

      <button type="submit" class="btn-primary">Save Changes</button>
    </form>
  `;

  return layout({ title: 'Welcome', user, guild, activeHref: `/servers/${guild.id}/welcome`, content, flash, flashType });
}

export async function handleWelcomeSave(guildId: string, body: any): Promise<void> {
  await db.setWelcomeConfig(guildId, {
    enabled:          body.enabled === '1' ? 1 : 0,
    channel_id:       body.channel_id || null,
    message:          body.message?.trim() || 'Welcome {user} to **{server}**!',
    image_url:        body.image_url?.trim() || null,
    dm_message:       body.dm_message?.trim() || null,
    leave_enabled:    body.leave_enabled === '1' ? 1 : 0,
    leave_channel_id: body.leave_channel_id || null,
    leave_message:    body.leave_message?.trim() || null,
    leave_image_url:  body.leave_image_url?.trim() || null,
    ban_enabled:      body.ban_enabled === '1' ? 1 : 0,
    ban_channel_id:   body.ban_channel_id || null,
    ban_message:      body.ban_message?.trim() || null,
    ban_image_url:    body.ban_image_url?.trim() || null,
  });
}
