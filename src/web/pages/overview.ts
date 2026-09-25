import { layout, escHtml } from '../layout';
import type { SessionUser } from '../session';
import type { APIGuild } from '../discord';
import * as db from '../../utils/db';

export async function overviewPage(user: SessionUser, guild: APIGuild, flash?: string): Promise<string> {
  const [econCfg, xpCfg] = await Promise.all([
    db.getEconomyConfig(guild.id, true),
    db.getXpConfig(guild.id),
  ]);

  const content = /* html */`
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      <div class="card text-center">
        <div class="text-3xl mb-1">💰</div>
        <div class="text-sm text-gray-400">Currency</div>
        <div class="font-bold text-white mt-1">${escHtml(econCfg.currency_symbol)} ${escHtml(econCfg.currency_name)}</div>
      </div>
      <div class="card text-center">
        <div class="text-3xl mb-1">⭐</div>
        <div class="text-sm text-gray-400">XP System</div>
        <div class="font-bold mt-1 ${xpCfg?.enabled ? 'text-green-400' : 'text-red-400'}">${xpCfg?.enabled ? 'Enabled' : 'Disabled'}</div>
      </div>
      <div class="card text-center">
        <div class="text-3xl mb-1">🤖</div>
        <div class="text-sm text-gray-400">Dashboard</div>
        <div class="font-bold text-green-400 mt-1">Online</div>
      </div>
    </div>

    <div class="card">
      <h2 class="text-lg font-bold mb-4 text-white">Quick Links</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        ${[
          { href: 'economy',       icon: '💰', label: 'Economy' },
          { href: 'leveling',      icon: '⭐', label: 'Leveling' },
          { href: 'reaction-roles',icon: '🎭', label: 'Reaction Roles' },
          { href: 'starboard',     icon: '⭐', label: 'Starboard' },
        ].map(item => /* html */`
          <a href="/servers/${guild.id}/${item.href}" class="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-dash-hover transition text-center" style="background:#1a1a2e; border:1px solid #1e3a5f;">
            <span class="text-2xl">${item.icon}</span>
            <span class="text-sm font-medium text-gray-300">${item.label}</span>
          </a>
        `).join('')}
      </div>
    </div>
  `;

  return layout({ title: `${guild.name} Overview`, user, guild, activeHref: `/servers/${guild.id}`, content, flash });
}
