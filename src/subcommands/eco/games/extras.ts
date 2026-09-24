import type { Sub } from '../../../framework/group.js';
import { db, getGameLeaderboard } from '../../../utils/db.js';
import { oddsText } from '../../../eco/stepgames.js';
import { getEco } from '../../../eco/core.js';
import { Colors, cv2Box, ecoCtx, short } from '../ui.js';

export const GAMES = [
  { name: '🪙 Coin Flip', value: 'flip' }, { name: '🎲 High Roll', value: 'highroll' }, { name: '🎰 Slots', value: 'slots' },
  { name: '🎡 Roulette', value: 'roulette' }, { name: '🚀 Crash', value: 'crash' }, { name: '🃏 Blackjack', value: 'blackjack' },
  { name: '♠️ Video Poker', value: 'poker' }, { name: '🎟️ Scratch Card', value: 'scratch' }, { name: '🎯 Plinko', value: 'plinko' },
  { name: '💣 Mines', value: 'mines' }, { name: '🗼 Towers', value: 'towers' }, { name: '🪜 Ladder', value: 'ladder' },
  { name: '🃏 Higher or Lower', value: 'higherlower' }, { name: '🎲 Dice', value: 'dice' },
] as const;

const label = (g: string) => GAMES.find(x => x.value === g)?.name ?? g;

export const oddsSub: Sub = {
  name: 'odds',
  description: 'Explain a game\'s odds and payouts',
  options: s => s.addStringOption(o => o.setName('game').setDescription('Which game').setRequired(true).addChoices(...GAMES)),
  async run(i) {
    const g = i.options.getString('game', true);
    await i.reply(cv2Box(`📊 **${label(g)} — odds & payouts**\n${oddsText(g)}\n\n*Coins only move between players: a slice of every loss feeds the shared jackpot and there's no hidden house edge.*`, Colors.Blurple));
  },
};

export const statsSub: Sub = {
  name: 'stats',
  description: 'Show lifetime gambling statistics',
  options: s => s.addUserOption(o => o.setName('user').setDescription('Whose stats (default: you)')),
  async run(i) {
    const ctx = await ecoCtx(i);
    const target = i.options.getUser('user') ?? i.user;
    const rows = (await db`SELECT game, wins, losses, total_wagered FROM game_stats WHERE guild_id = ${ctx.guildId} AND user_id = ${target.id} ORDER BY total_wagered DESC`) as
      { game: string; wins: number; losses: number; total_wagered: number }[];
    if (!rows.length) { await i.reply(cv2Box(`${target.username} hasn't played any casino games here yet.`, Colors.Blurple)); return; }
    const wins = rows.reduce((s, r) => s + r.wins, 0), losses = rows.reduce((s, r) => s + r.losses, 0);
    const wagered = rows.reduce((s, r) => s + r.total_wagered, 0);
    const eco = await getEco(ctx.guildId, target.id);
    const lines = rows.slice(0, 12).map(r => `${label(r.game)} — **${r.wins}W** / ${r.losses}L · wagered ${ctx.sym} ${short(r.total_wagered)}`);
    await i.reply(cv2Box(
      `🎰 **${target.username}'s gambling stats**\n**${wins}** wins · **${losses}** losses · win rate **${wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0}%**\n` +
      `Total wagered: **${ctx.sym} ${wagered.toLocaleString()}** · lifetime losses: **${ctx.sym} ${eco.total_lost.toLocaleString()}**\n\n${lines.join('\n')}`, Colors.Gold));
  },
};

export const gameLeaderboardSub: Sub = {
  name: 'leaderboard',
  description: 'Top players for a specific game',
  options: s => s.addStringOption(o => o.setName('game').setDescription('Which game').setRequired(true).addChoices(...GAMES)),
  async run(i) {
    await i.deferReply();
    const ctx = await ecoCtx(i);
    const g = i.options.getString('game', true);
    const rows = await getGameLeaderboard(ctx.guildId, g, 10);
    if (!rows.length) { await i.editReply(cv2Box(`${label(g)} **leaderboard**\n\nNo one has played this game yet!`, Colors.Blurple)); return; }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, n) => {
      const total = r.wins + r.losses;
      return `${medals[n] ?? `**${n + 1}.**`} <@${r.user_id}> — **${r.wins}W** / ${r.losses}L *(${total ? Math.round((r.wins / total) * 100) : 0}% win rate)*`;
    });
    await i.editReply(cv2Box(`${label(g)} **leaderboard**\n\n${lines.join('\n')}\n\n*Ranked by wins*`, Colors.Gold));
  },
};
