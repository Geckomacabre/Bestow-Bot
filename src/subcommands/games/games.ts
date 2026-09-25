import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, MessageFlags, TextDisplayBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type User,
} from 'discord.js';
import type { Sub } from '../../framework/group.js';
import {
  RPS, RPS_EMOJI, bjBust, bjCompare, bjScore, newDeck, newSnake, rpsCompare, showHand, snakeBoard, snakeStep, tttOutcome, tttPlay,
  type Board, type Card, type Dir, type Rps,
} from '../../games/logic.js';

/**
 * /games — small games played with buttons on one message. Two-player games start with an invitation (name an opponent, or leave it open
 * and the first person to press Join plays). Everything is held in memory for the length of the game and dropped when it ends or times out.
 */

const COLOR = 0x5865f2;
const V2 = MessageFlags.IsComponentsV2;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Row = ActionRowBuilder<ButtonBuilder>;
const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(b);
const btn = (id: string, label: string | null, style = ButtonStyle.Secondary, o: { emoji?: string; disabled?: boolean } = {}) => {
  const b = new ButtonBuilder().setCustomId(id).setStyle(style).setDisabled(!!o.disabled);
  if (label) b.setLabel(label);
  if (o.emoji) b.setEmoji(o.emoji);
  return b;
};

/** One card of text plus button rows. `mention` lists the people the message may ping. */
export function box(text: string, rows: Row[] = [], o: { color?: number; mention?: string[] } = {}) {
  const c = new ContainerBuilder().setAccentColor(o.color ?? COLOR).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  for (const r of rows) c.addActionRowComponents(r);
  return { flags: V2 as MessageFlags.IsComponentsV2, components: [c], allowedMentions: { users: o.mention ?? [] } };
}
const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

// ─── Lobby ───────────────────────────────────────────────────────────────────

export interface LobbyOpts { game: string; emoji: string; host: User; opponent: User | null; waitMs?: number }

/** Sends the invitation and resolves with the second player, or null (declined / nobody came). Leaves the message for the game to take over. */
export async function lobby(i: ChatInputCommandInteraction, o: LobbyOpts): Promise<User | null> {
  const { host, opponent } = o;
  if (opponent?.bot) { await i.reply(ephemeral('Bots can\'t play this — pick a person.')); return null; }
  if (opponent?.id === host.id) { await i.reply(ephemeral('You can\'t play against yourself — leave the opponent empty to let anyone join.')); return null; }
  const invite = opponent
    ? `${o.emoji} **${o.game}**\n<@${host.id}> challenges <@${opponent.id}>. Press **Accept** within a minute!`
    : `${o.emoji} **${o.game}**\n<@${host.id}> is looking for an opponent. Press **Join** to play!`;
  await i.reply(box(invite, [row(btn('lobby:join', opponent ? 'Accept' : 'Join', ButtonStyle.Success), btn('lobby:cancel', opponent ? 'Decline' : 'Cancel', ButtonStyle.Danger))], { mention: opponent ? [opponent.id] : [] }));
  const msg = await i.fetchReply();
  return new Promise<User | null>(resolve => {
    const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: o.waitMs ?? 60_000 });
    let joined: User | null = null;
    col.on('collect', async (b: ButtonInteraction) => {
      if (b.customId === 'lobby:cancel') {
        if (b.user.id !== host.id && b.user.id !== opponent?.id) { await b.reply(ephemeral('Only the host can cancel this.')); return; }
        col.stop('cancel'); await b.update(box(`${o.emoji} **${o.game}** — cancelled.`)); return;
      }
      if (b.user.id === host.id) { await b.reply(ephemeral('You started this one — wait for someone else to join.')); return; }
      if (opponent && b.user.id !== opponent.id) { await b.reply(ephemeral(`This challenge is for <@${opponent.id}>.`)); return; }
      joined = b.user; col.stop('joined');
      await b.deferUpdate();
    });
    col.on('end', async () => {
      if (!joined) await i.editReply(box(`${o.emoji} **${o.game}** — nobody joined in time.`)).catch(() => {});
      resolve(joined);
    });
  });
}

const oppOption = (s: import('discord.js').SlashCommandSubcommandBuilder) => s.addUserOption(o => o.setName('player').setDescription('The user you want to play against (leave empty to let anyone join)'));

// ─── Tic-tac-toe ─────────────────────────────────────────────────────────────

const MARK_EMOJI = { X: '❌', O: '⭕' } as const;

export function tttView(b: Board, names: { X: string; O: string }, turn: 'X' | 'O', over: ReturnType<typeof tttOutcome> | 'timeout') {
  const win = over && over !== 'draw' && over !== 'timeout' ? new Set(over.line) : new Set<number>();
  const rows = [0, 1, 2].map(r => row(...[0, 1, 2].map(c => {
    const n = r * 3 + c, m = b[n];
    return btn(`ttt:${n}`, null, win.has(n) ? ButtonStyle.Success : m === 'X' ? ButtonStyle.Danger : m === 'O' ? ButtonStyle.Primary : ButtonStyle.Secondary, { emoji: m ? MARK_EMOJI[m] : '⬜', disabled: !!m || !!over });
  })));
  const status = over === 'draw' ? '🤝 **It\'s a draw!**' : over === 'timeout' ? '⌛ Timed out — nobody moved for two minutes.' : over ? `🏆 **${names[over.winner]}** wins!` : `${MARK_EMOJI[turn]} **${names[turn]}**'s turn`;
  return box(`⭕ **Tic-tac-toe** — ${MARK_EMOJI.X} ${names.X} vs ${MARK_EMOJI.O} ${names.O}\n${status}`, rows);
}

async function playTicTacToe(i: ChatInputCommandInteraction, x: User, o: User) {
  const players = { X: x, O: o };
  const names = { X: `<@${x.id}>`, O: `<@${o.id}>` };
  let board: Board = Array(9).fill(null), turn: 'X' | 'O' = 'X';
  const mention = [x.id, o.id];
  await i.editReply({ ...tttView(board, names, turn, null), allowedMentions: { users: mention } });
  const msg = await i.fetchReply();
  const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 120_000 });
  col.on('collect', async (b: ButtonInteraction) => {
    if (b.user.id !== players[turn].id) { await b.reply(ephemeral(b.user.id === x.id || b.user.id === o.id ? 'It\'s not your turn yet.' : 'You\'re not in this game.')); return; }
    const next = tttPlay(board, Number(b.customId.split(':')[1]), turn);
    if (!next) { await b.reply(ephemeral('That square is taken.')); return; }
    board = next;
    const over = tttOutcome(board);
    if (!over) turn = turn === 'X' ? 'O' : 'X';
    await b.update({ ...tttView(board, names, turn, over), allowedMentions: { users: mention } });
    if (over) col.stop('done');
  });
  col.on('end', async (_c, reason) => { if (reason !== 'done') await i.editReply({ ...tttView(board, names, turn, 'timeout'), allowedMentions: { users: mention } }).catch(() => {}); });
}

// ─── Rock paper scissors (first to 2) ────────────────────────────────────────

const RPS_ROW = () => row(...RPS.map(r => btn(`rps:${r}`, r[0]!.toUpperCase() + r.slice(1), ButtonStyle.Primary, { emoji: RPS_EMOJI[r] })));

async function playRps(i: ChatInputCommandInteraction, a: User, b: User) {
  const score = { [a.id]: 0, [b.id]: 0 } as Record<string, number>;
  const mention = [a.id, b.id];
  const head = () => `${RPS_EMOJI.rock} **Rock paper scissors** — first to 2\n<@${a.id}> **${score[a.id]}** – **${score[b.id]}** <@${b.id}>`;
  let round = 1, picks = new Map<string, Rps>();
  await i.editReply({ ...box(`${head()}\nRound ${round}: both players pick — only you see your choice.`, [RPS_ROW()]), allowedMentions: { users: mention } });
  const msg = await i.fetchReply();
  const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 90_000 });
  col.on('collect', async (c: ButtonInteraction) => {
    if (c.user.id !== a.id && c.user.id !== b.id) { await c.reply(ephemeral('You\'re not in this game.')); return; }
    if (picks.has(c.user.id)) { await c.reply(ephemeral('You already picked — waiting for your opponent.')); return; }
    const pick = c.customId.split(':')[1] as Rps;
    picks.set(c.user.id, pick);
    await c.reply(ephemeral(`You picked ${RPS_EMOJI[pick]} **${pick}**.`));
    if (picks.size < 2) return;
    const pa = picks.get(a.id)!, pb = picks.get(b.id)!;
    const r = rpsCompare(pa, pb);
    if (r === 1) score[a.id]!++; else if (r === -1) score[b.id]!++;
    const line = `Round ${round}: <@${a.id}> ${RPS_EMOJI[pa]} vs ${RPS_EMOJI[pb]} <@${b.id}> — ${r === 0 ? '**tie**' : `**<@${(r === 1 ? a : b).id}>** wins the round`}`;
    picks = new Map(); round++;
    if (score[a.id]! >= 2 || score[b.id]! >= 2) {
      const w = score[a.id]! >= 2 ? a : b;
      await i.editReply({ ...box(`${head()}\n${line}\n🏆 **<@${w.id}> wins the match!**`), allowedMentions: { users: mention } });
      col.stop('done'); return;
    }
    await i.editReply({ ...box(`${head()}\n${line}\nRound ${round}: pick again.`, [RPS_ROW()]), allowedMentions: { users: mention } });
  });
  col.on('end', async (_c, reason) => { if (reason !== 'done') await i.editReply(box(`${head()}\n⌛ Timed out.`)).catch(() => {}); });
}

// ─── Blackjack (head to head) ────────────────────────────────────────────────

async function playBlackjack(i: ChatInputCommandInteraction, a: User, b: User) {
  const deck = newDeck();
  const hands: Record<string, Card[]> = { [a.id]: [deck.pop()!, deck.pop()!], [b.id]: [deck.pop()!, deck.pop()!] };
  const order = [a, b]; let turn = 0;
  const mention = [a.id, b.id];
  const controls = () => [row(btn('bj:hit', 'Hit', ButtonStyle.Success, { emoji: '🃏' }), btn('bj:stand', 'Stand', ButtonStyle.Danger, { emoji: '✋' }))];
  const view = (over: string | null) => {
    const lines = order.map((p, n) => {
      const revealed = over !== null || n <= turn;
      return `<@${p.id}> ${revealed ? `${showHand(hands[p.id]!)} = **${bjScore(hands[p.id]!)}**${bjBust(hands[p.id]!) ? ' 💥 bust' : ''}` : '`?? ??`'}`;
    });
    return `🃏 **Blackjack** — closest to 21 wins\n${lines.join('\n')}\n${over ?? `▶️ <@${order[turn]!.id}>, hit or stand?`}`;
  };
  await i.editReply({ ...box(view(null), controls()), allowedMentions: { users: mention } });
  const msg = await i.fetchReply();
  const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 90_000 });
  const finish = async (b2: ButtonInteraction | null) => {
    const r = bjCompare(hands[a.id]!, hands[b.id]!);
    const verdict = r === 0 ? '🤝 **Push — nobody wins.**' : `🏆 **<@${(r === 1 ? a : b).id}> wins!**`;
    const payload = { ...box(view(verdict)), allowedMentions: { users: mention } };
    if (b2) await b2.update(payload); else await i.editReply(payload);
    col.stop('done');
  };
  col.on('collect', async (c: ButtonInteraction) => {
    if (c.user.id !== order[turn]!.id) { await c.reply(ephemeral(c.user.id === a.id || c.user.id === b.id ? 'It\'s not your turn yet.' : 'You\'re not in this game.')); return; }
    const mine = hands[c.user.id]!;
    if (c.customId === 'bj:hit') mine.push(deck.pop()!);
    const done = c.customId === 'bj:stand' || bjBust(mine) || bjScore(mine) === 21;
    if (!done) { await c.update({ ...box(view(null), controls()), allowedMentions: { users: mention } }); return; }
    if (turn === 1) { await finish(c); return; }
    turn = 1;
    await c.update({ ...box(view(null), controls()), allowedMentions: { users: mention } });
  });
  col.on('end', async (_c, reason) => { if (reason !== 'done') await i.editReply(box(`${view('⌛ Timed out.')}`)).catch(() => {}); });
}

// ─── Snake ───────────────────────────────────────────────────────────────────

const ARROW: Record<Dir, string> = { up: '⬆️', down: '⬇️', left: '⬅️', right: '➡️' };

export function snakeView(s: ReturnType<typeof newSnake>, timedOut = false) {
  const text = `🐍 **Snake** — score **${s.score}**\n${snakeBoard(s)}\n${timedOut ? '⌛ Timed out.' : s.over === 'wall' ? '💥 You hit the wall!' : s.over === 'self' ? '💥 You ate yourself!' : s.over === 'won' ? '🏆 You filled the board!' : 'Each press moves one step. Eat the 🍎!'}`;
  const off = !!s.over || timedOut;
  const rows = [
    row(btn('snake:x1', null, ButtonStyle.Secondary, { emoji: '⬛', disabled: true }), btn('snake:up', null, ButtonStyle.Primary, { emoji: ARROW.up, disabled: off }), btn('snake:x2', null, ButtonStyle.Secondary, { emoji: '⬛', disabled: true })),
    row(btn('snake:left', null, ButtonStyle.Primary, { emoji: ARROW.left, disabled: off }), btn('snake:down', null, ButtonStyle.Primary, { emoji: ARROW.down, disabled: off }), btn('snake:right', null, ButtonStyle.Primary, { emoji: ARROW.right, disabled: off })),
  ];
  return box(text, rows, { color: s.over || timedOut ? 0xed4245 : 0x57f287 });
}

async function playSnake(i: ChatInputCommandInteraction) {
  let s = newSnake();
  await i.reply(snakeView(s));
  const msg = await i.fetchReply();
  const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 120_000 });
  col.on('collect', async (c: ButtonInteraction) => {
    if (c.user.id !== i.user.id) { await c.reply(ephemeral('This is someone else\'s game — start your own with `/games snake`.')); return; }
    s = snakeStep(s, c.customId.split(':')[1] as Dir);
    await c.update(snakeView(s));
    if (s.over) col.stop('done');
  });
  col.on('end', async (_c, reason) => { if (reason !== 'done') await i.editReply(snakeView(s, true)).catch(() => {}); });
}

// ─── Cookie ──────────────────────────────────────────────────────────────────

async function playCookie(i: ChatInputCommandInteraction, delayMs: number) {
  const cookie = (on: boolean) => row(btn('cookie:go', on ? 'CLICK!' : 'Wait for it…', on ? ButtonStyle.Success : ButtonStyle.Secondary, { emoji: '🍪', disabled: !on }));
  await i.reply(box('🍪 **Cookie race** — get ready… the cookie appears soon. First to click wins!', [cookie(false)]));
  const msg = await i.fetchReply();
  await sleep(delayMs);
  await i.editReply(box('🍪 **NOW!** Click the cookie!', [cookie(true)], { color: 0x57f287 }));
  const started = Date.now();
  const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 15_000, max: 1 });
  col.on('collect', async (c: ButtonInteraction) => {
    await c.update({ ...box(`🍪 **<@${c.user.id}>** got the cookie first — in **${((Date.now() - started) / 1000).toFixed(2)}s**!`, [cookie(false)], { color: 0xfee75c, mention: [c.user.id] }) });
  });
  col.on('end', async (collected) => { if (!collected.size) await i.editReply(box('🍪 Nobody clicked the cookie. 🍪', [cookie(false)])).catch(() => {}); });
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

const twoPlayer = (name: string, description: string, title: string, emoji: string, play: (i: ChatInputCommandInteraction, a: User, b: User) => Promise<void>): Sub => ({
  name, description, options: oppOption,
  async run(i) {
    const other = await lobby(i, { game: title, emoji, host: i.user, opponent: i.options.getUser('player') });
    if (other) await play(i, i.user, other);
  },
});

export const gameSubs: Sub[] = [
  twoPlayer('tictactoe', 'Play TicTacToe with a friend', 'Tic-tac-toe', '⭕', playTicTacToe),
  twoPlayer('rps', 'Play Rock-Paper-Scissors with a friend', 'Rock paper scissors', '🪨', playRps),
  twoPlayer('blackjack', 'Play Blackjack with a friend', 'Blackjack', '🃏', playBlackjack),
  { name: 'snake', description: 'Play Snake game', run: playSnake },
  { name: 'cookie', description: 'Click the cookie first', run: i => playCookie(i, 2000 + Math.floor(Math.random() * 4000)) },
];

/** Exposed so tests can run the games without lobby/timer delays. */
export const _games = { playTicTacToe, playRps, playBlackjack, playSnake, playCookie };
