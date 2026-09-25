import { userAvatarUrl, guildIconUrl } from './discord';
import type { SessionUser, DiscordGuild } from './session';

export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const guildNav = (guildId: string): NavItem[] => [
  { label: 'Overview',       href: `/servers/${guildId}`,              icon: '🏠' },
  { label: 'Economy',        href: `/servers/${guildId}/economy`,      icon: '💰' },
  { label: 'Leveling',       href: `/servers/${guildId}/leveling`,     icon: '⭐' },
  { label: 'Welcome',        href: `/servers/${guildId}/welcome`,      icon: '👋' },
  { label: 'Automod',        href: `/servers/${guildId}/automod`,      icon: '🛡️' },
  { label: 'Logs',           href: `/servers/${guildId}/logs`,         icon: '📋' },
  { label: 'Reaction Roles', href: `/servers/${guildId}/reaction-roles`, icon: '🎭' },
  { label: 'Topics',         href: `/servers/${guildId}/topics`,       icon: '💬' },
  { label: 'Starboard',      href: `/servers/${guildId}/starboard`,    icon: '⭐' },
  { label: 'Birthdays',      href: `/servers/${guildId}/birthdays`,    icon: '🎂' },
  { label: 'Timezones',      href: `/servers/${guildId}/timezones`,    icon: '🌍' },
  { label: 'Stat Channels',  href: `/servers/${guildId}/stat-channels`, icon: '📊' },
];

export function layout(opts: {
  title: string;
  user: SessionUser;
  guild?: { id: string; name: string; icon: string | null };
  activeHref?: string;
  content: string;
  flash?: string;
  flashType?: 'success' | 'error';
}): string {
  const { title, user, guild, activeHref, content, flash, flashType = 'success' } = opts;
  const nav = guild ? guildNav(guild.id) : [];

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — Onyx Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            'dash-bg':      '#1a1a2e',
            'dash-sidebar': '#16213e',
            'dash-card':    '#0f3460',
            'dash-border':  '#1e3a5f',
            'dash-hover':   '#1e3a5f',
            'dash-accent':  '#4361ee',
            'dash-success': '#2dc653',
            'dash-danger':  '#e63946',
          },
        },
      },
    };
  </script>
  <style>
    body { background: #1a1a2e; }
    .sidebar-link { transition: background 0.15s; }
    .sidebar-link:hover { background: #1e3a5f; }
    .sidebar-link.active { background: #4361ee; }
    input, select, textarea {
      background: #0f1e3c !important;
      border: 1px solid #1e3a5f !important;
      color: #e2e8f0 !important;
      border-radius: 0.375rem;
      padding: 0.5rem 0.75rem;
      width: 100%;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #4361ee !important;
    }
    select option { background: #0f1e3c; color: #e2e8f0; }
    .form-group { margin-bottom: 1.25rem; }
    .form-group label { display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 0.4rem; }
    .btn-primary {
      background: #4361ee; color: white; border: none;
      padding: 0.5rem 1.25rem; border-radius: 0.375rem; cursor: pointer; font-weight: 600;
      transition: background 0.15s;
    }
    .btn-primary:hover { background: #3451d1; }
    .btn-danger {
      background: #e63946; color: white; border: none;
      padding: 0.4rem 1rem; border-radius: 0.375rem; cursor: pointer; font-weight: 600;
    }
    .btn-danger:hover { background: #c1121f; }
    .card { background: #0f3460; border: 1px solid #1e3a5f; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-blue { background: #4361ee; color: white; }
    .badge-green { background: #2dc653; color: white; }
    .badge-red { background: #e63946; color: white; }
  </style>
</head>
<body class="text-gray-100 min-h-screen flex">

  <!-- Sidebar -->
  <aside class="w-64 min-h-screen flex-shrink-0 flex flex-col" style="background:#16213e; border-right:1px solid #1e3a5f;">
    <!-- Brand -->
    <a href="/servers" class="flex items-center gap-3 px-5 py-4 border-b" style="border-color:#1e3a5f;">
      <span class="text-2xl">🤖</span>
      <span class="font-bold text-lg text-white">Onyx</span>
    </a>

    <!-- Guild info -->
    ${guild ? /* html */`
    <div class="px-5 py-3 border-b text-sm" style="border-color:#1e3a5f;">
      <div class="flex items-center gap-2">
        <img src="${guildIconUrl(guild.id, guild.icon)}" class="w-7 h-7 rounded-full">
        <span class="font-semibold truncate text-white">${escHtml(guild.name)}</span>
      </div>
    </div>
    ` : ''}

    <!-- Nav -->
    <nav class="flex-1 py-3 overflow-y-auto">
      ${nav.map(item => /* html */`
        <a href="${item.href}"
           class="sidebar-link flex items-center gap-3 px-5 py-2.5 text-sm font-medium text-gray-300 ${activeHref === item.href ? 'active text-white' : ''}">
          <span>${item.icon}</span>
          <span>${item.label}</span>
        </a>
      `).join('')}

      ${guild ? '' : /* html */`
        <div class="px-5 py-3 text-xs text-gray-500 uppercase tracking-wider">No server selected</div>
        <a href="/servers" class="sidebar-link flex items-center gap-3 px-5 py-2.5 text-sm font-medium text-gray-300">
          <span>🔀</span><span>Select Server</span>
        </a>
      `}
    </nav>

    <!-- User -->
    <div class="px-5 py-4 border-t flex items-center gap-3" style="border-color:#1e3a5f;">
      <img src="${userAvatarUrl(user.id, user.avatar)}" class="w-8 h-8 rounded-full">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-white truncate">${escHtml(user.username)}</div>
      </div>
      <a href="/auth/logout" title="Logout" class="text-gray-400 hover:text-red-400 text-lg">↩</a>
    </div>
  </aside>

  <!-- Main -->
  <main class="flex-1 flex flex-col min-h-screen overflow-x-hidden">
    <!-- Top bar -->
    <header class="px-8 py-4 border-b flex items-center justify-between" style="background:#16213e; border-color:#1e3a5f;">
      <h1 class="text-xl font-bold text-white">${escHtml(title)}</h1>
      <a href="/servers" class="text-sm text-gray-400 hover:text-gray-200">← Change Server</a>
    </header>

    <!-- Flash -->
    ${flash ? /* html */`
    <div class="mx-8 mt-4 px-4 py-3 rounded-lg text-sm font-medium ${flashType === 'error' ? 'bg-red-900 text-red-200 border border-red-700' : 'bg-green-900 text-green-200 border border-green-700'}">
      ${escHtml(flash)}
    </div>
    ` : ''}

    <!-- Content -->
    <div class="flex-1 px-8 py-6">
      ${content}
    </div>
  </main>

</body>
</html>`;
}

export function errorPage(message: string, user?: SessionUser): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Error — Onyx Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-gray-100 min-h-screen flex items-center justify-center">
  <div class="text-center">
    <div class="text-6xl mb-4">⚠️</div>
    <h1 class="text-2xl font-bold mb-2">Something went wrong</h1>
    <p class="text-gray-400 mb-6">${escHtml(message)}</p>
    <a href="/servers" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg">Back to servers</a>
  </div>
</body>
</html>`;
}

export function landingPage(): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Onyx Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-gray-100 min-h-screen flex items-center justify-center">
  <div class="text-center max-w-md">
    <div class="text-6xl mb-4">🤖</div>
    <h1 class="text-4xl font-bold mb-2 text-white">Onyx Dashboard</h1>
    <p class="text-gray-400 mb-8">Configure your server settings, manage economy, and more.</p>
    <a href="/auth/login"
       class="inline-flex items-center gap-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-3 rounded-lg text-lg transition">
      <svg width="24" height="24" viewBox="0 0 127.14 96.36" fill="white"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>
      Login with Discord
    </a>
  </div>
</body>
</html>`;
}

export function serversPage(user: SessionUser, guilds: Array<{ id: string; name: string; icon: string | null; botPresent: boolean }>): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Select Server — Onyx Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background: #1a1a2e; }
    .guild-card { background: #0f3460; border: 1px solid #1e3a5f; transition: border-color 0.15s, transform 0.15s; }
    .guild-card:hover { border-color: #4361ee; transform: translateY(-2px); }
  </style>
</head>
<body class="text-gray-100 min-h-screen">
  <header class="px-8 py-4 border-b flex items-center justify-between" style="background:#16213e; border-color:#1e3a5f;">
    <div class="flex items-center gap-3">
      <span class="text-2xl">🤖</span>
      <span class="text-xl font-bold text-white">Onyx Dashboard</span>
    </div>
    <div class="flex items-center gap-4">
      <img src="${userAvatarUrl(user.id, user.avatar)}" class="w-8 h-8 rounded-full">
      <span class="text-sm text-gray-300">${escHtml(user.username)}</span>
      <a href="/auth/logout" class="text-sm text-gray-400 hover:text-red-400">Logout</a>
    </div>
  </header>

  <main class="max-w-4xl mx-auto px-6 py-10">
    <h2 class="text-2xl font-bold mb-2 text-white">Select a Server</h2>
    <p class="text-gray-400 mb-8">You can only manage servers where you have the <strong>Manage Server</strong> permission and Onyx is present.</p>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${guilds.map(g => /* html */`
        ${g.botPresent
          ? /* html */`<a href="/servers/${g.id}" class="guild-card rounded-xl p-5 flex items-center gap-4 cursor-pointer">
              <img src="${guildIconUrl(g.id, g.icon)}" class="w-12 h-12 rounded-full flex-shrink-0">
              <div class="min-w-0">
                <div class="font-semibold text-white truncate">${escHtml(g.name)}</div>
                <div class="text-xs text-green-400 mt-1">✓ Bot active</div>
              </div>
            </a>`
          : /* html */`<div class="guild-card rounded-xl p-5 flex items-center gap-4 opacity-50 cursor-not-allowed">
              <img src="${guildIconUrl(g.id, g.icon)}" class="w-12 h-12 rounded-full flex-shrink-0 grayscale">
              <div class="min-w-0">
                <div class="font-semibold text-white truncate">${escHtml(g.name)}</div>
                <div class="text-xs text-gray-500 mt-1">Bot not in server</div>
              </div>
            </div>`}
      `).join('')}
    </div>

    ${guilds.length === 0 ? /* html */`
      <div class="text-center py-16 text-gray-400">
        <div class="text-5xl mb-4">😔</div>
        <p>No servers found where you have Manage Server permissions.</p>
      </div>
    ` : ''}
  </main>
</body>
</html>`;
}

export function escHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function channelSelect(name: string, channels: Array<{ id: string; name: string }>, selectedId?: string | null): string {
  return /* html */`<select name="${name}">
    <option value="">— None —</option>
    ${channels.map(c => /* html */`<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>#${escHtml(c.name)}</option>`).join('')}
  </select>`;
}

export function roleSelect(name: string, roles: Array<{ id: string; name: string }>, selectedId?: string | null): string {
  return /* html */`<select name="${name}">
    <option value="">— None —</option>
    ${roles.map(r => /* html */`<option value="${r.id}" ${selectedId === r.id ? 'selected' : ''}>@${escHtml(r.name)}</option>`).join('')}
  </select>`;
}

export function toggle(name: string, checked: boolean, label: string): string {
  return /* html */`<label class="flex items-center gap-3 cursor-pointer">
    <div class="relative">
      <input type="checkbox" name="${name}" value="1" class="sr-only peer" ${checked ? 'checked' : ''}>
      <div class="w-11 h-6 rounded-full peer-checked:bg-indigo-600 bg-gray-600 transition peer-focus:ring-2 peer-focus:ring-indigo-500" style="background:${checked ? '#4361ee' : '#374151'}"></div>
      <div class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition peer-checked:translate-x-5" style="transform: ${checked ? 'translateX(1.25rem)' : 'none'}"></div>
    </div>
    <span class="text-sm text-gray-300">${label}</span>
  </label>`;
}
