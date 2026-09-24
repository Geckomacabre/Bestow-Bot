import { layout, escHtml } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild } from '../discord';
import * as db from '../../utils/db';

export async function economyPage(user: SessionUser, guild: APIGuild, flash?: string, flashType?: 'success' | 'error'): Promise<string> {
  const cfg = await db.getEconomyConfig(guild.id);

  const content = /* html */`
    <form method="POST" action="/servers/${guild.id}/economy">
      <div class="card">
        <h2 class="text-lg font-bold mb-5 text-white">Currency Settings</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div class="form-group">
            <label>Currency Name</label>
            <input name="currency_name" value="${escHtml(cfg.currency_name)}" placeholder="coins">
          </div>
          <div class="form-group">
            <label>Currency Symbol</label>
            <input name="currency_symbol" value="${escHtml(cfg.currency_symbol)}" placeholder="🪙">
          </div>
          <div class="form-group">
            <label>Starting Balance</label>
            <input name="starting_balance" type="number" min="0" value="${cfg.starting_balance}">
          </div>
        </div>
      </div>

      <div class="card">
        <h2 class="text-lg font-bold mb-5 text-white">Command Rewards</h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <div class="form-group">
            <label>Daily Min</label>
            <input name="daily_min" type="number" min="1" value="${cfg.daily_min}">
          </div>
          <div class="form-group">
            <label>Daily Max</label>
            <input name="daily_max" type="number" min="1" value="${cfg.daily_max}">
          </div>
          <div class="form-group">
            <label>Weekly Min</label>
            <input name="weekly_min" type="number" min="1" value="${cfg.weekly_min}">
          </div>
          <div class="form-group">
            <label>Weekly Max</label>
            <input name="weekly_max" type="number" min="1" value="${cfg.weekly_max}">
          </div>
          <div class="form-group">
            <label>Monthly Min</label>
            <input name="monthly_min" type="number" min="1" value="${cfg.monthly_min}">
          </div>
          <div class="form-group">
            <label>Monthly Max</label>
            <input name="monthly_max" type="number" min="1" value="${cfg.monthly_max}">
          </div>
          <div class="form-group">
            <label>Yearly Min</label>
            <input name="yearly_min" type="number" min="1" value="${cfg.yearly_min}">
          </div>
          <div class="form-group">
            <label>Yearly Max</label>
            <input name="yearly_max" type="number" min="1" value="${cfg.yearly_max}">
          </div>
          <div class="form-group">
            <label>Work Min</label>
            <input name="work_min" type="number" min="1" value="${cfg.work_min}">
          </div>
          <div class="form-group">
            <label>Work Max</label>
            <input name="work_max" type="number" min="1" value="${cfg.work_max}">
          </div>
        </div>
      </div>

      <button type="submit" class="btn-primary">Save Changes</button>
    </form>
  `;

  return layout({ title: 'Economy', user, guild, activeHref: `/servers/${guild.id}/economy`, content, flash, flashType });
}

export async function handleEconomySave(guildId: string, body: any): Promise<void> {
  await db.setEconomyConfig(guildId, {
    currency_name: body.currency_name?.trim() || 'coins',
    currency_symbol: body.currency_symbol?.trim() || '🪙',
    starting_balance: Math.max(0, parseInt(body.starting_balance ?? '') || 0),
    daily_min: Math.max(1, parseInt(body.daily_min ?? '') || 100),
    daily_max: Math.max(1, parseInt(body.daily_max ?? '') || 500),
    weekly_min: Math.max(1, parseInt(body.weekly_min ?? '') || 500),
    weekly_max: Math.max(1, parseInt(body.weekly_max ?? '') || 2000),
    monthly_min: Math.max(1, parseInt(body.monthly_min ?? '') || 2000),
    monthly_max: Math.max(1, parseInt(body.monthly_max ?? '') || 8000),
    yearly_min: Math.max(1, parseInt(body.yearly_min ?? '') || 25000),
    yearly_max: Math.max(1, parseInt(body.yearly_max ?? '') || 100000),
    work_min: Math.max(1, parseInt(body.work_min ?? '') || 50),
    work_max: Math.max(1, parseInt(body.work_max ?? '') || 200),
  });
}
