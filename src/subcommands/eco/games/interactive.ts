import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder,
} from 'discord.js';
import type { Sub } from '../../../framework/group.js';
import { getEconomyConfig, getGambleMultiplier } from '../../../utils/db.js';
import { cv2Err } from '../../../utils/components.js';
import { randInt } from '../../../utils/random.js';
import { stake } from '../../../eco/core.js';
import { settleRound } from '../../../eco/round.js';
import { fortuneMultiplier } from '../../../eco/effects.js';
import {
  DICE_WIN_MULT, LADDER_CHANCES, MINES_COLS, MINES_MAX, MINES_MIN, MINES_ROWS, MINES_TILES, TOWER_MODES, TOWER_ROWS,
  chanceHigher, chanceLower, drawRank, hiloGuess, ladderClimb, ladderMultiplier, minesMultiplier, minesReveal, newMines, newTowers,
  rankName, roll2d6, towersMultiplier, towersPick, type MinesState, type TowersState,
} from '../../../eco/stepgames.js';
import { Colors } from '../ui.js';

type Outcome = 'continue' | 'bust' | 'clear';
type End = 'bust' | 'cashed' | 'clear' | 'timeout';
interface View { content: string; rows: ActionRowBuilder<ButtonBuilder>[] }
interface Ctx { bet: number; sym: string; mult: number; end?: End; payout?: number; balance?: number }

interface Def<S> {
  game: string;
  init: (i: ChatInputCommandInteraction) => S;
  view: (s: S, c: Ctx) => View;
  press: (s: S, id: string) => Outcome;
  mult: (s: S) => number;
  xp: (mult: number) => number;
}

const btn = (id: string, label: string, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const cashRow = (c: Ctx, disabled: boolean) => new ActionRowBuilder<ButtonBuilder>().addComponents(
  btn('cash', c.mult > 0 ? `💰 Cash out ×${c.mult} — ${c.sym} ${Math.floor(c.bet * c.mult).toLocaleString()}` : '💰 Cash out', ButtonStyle.Success, disabled || c.mult <= 0),
);
const betOption = (s: SlashCommandSubcommandBuilder) => s.addIntegerOption(o => o.setName('amount').setDescription('Amount to bet').setRequired(true).setMinValue(1));

/**
 * Runs one "push your luck" round. The stake is taken up front; the round ends by bust, cash-out,
 * clearing the board, or (after 90s idle) an automatic cash-out — so walking away never confiscates progress.
 */
async function runInteractive<S>(i: ChatInputCommandInteraction, def: Def<S>): Promise<void> {
  const guildId = (i.guildId ?? 'global'), userId = i.user.id;
  const bet = i.options.getInteger('amount', true);
  const cfg = await getEconomyConfig(guildId);
  const sym = cfg.currency_symbol;

  const staked = await stake(guildId, userId, bet, def.game);
  if (!staked.success) { await i.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Balance: **${sym} ${staked.newBalance.toLocaleString()}**.`)); return; }

  await i.deferReply();
  const state = def.init(i);
  const luck = (await getGambleMultiplier(guildId, userId)) * (await fortuneMultiplier(userId));
  const ctx = (extra: Partial<Ctx> = {}): Ctx => ({ bet, sym, mult: def.mult(state), ...extra });
  const render = (v: View, disable = false) => ({
    content: v.content,
    components: disable ? [] : v.rows,
  });

  const msg = await i.editReply(render(def.view(state, ctx())));
  let finished = false;

  const finish = async (end: End) => {
    if (finished) return;
    finished = true;
    collector.stop('done');
    const mult = end === 'bust' ? 0 : def.mult(state);
    // Every multiplier here is ≥ 1×. Luck boosts (Lucky Charm, Fortune card) apply to the profit portion only.
    const returned = mult > 0 ? bet + Math.floor(bet * (mult - 1) * luck) : 0;
    const won = returned > bet;
    const round = await settleRound({
      guildId, userId, game: def.game, bet, returned, won,
      xp: won ? def.xp(mult) : undefined,
      insuredLoss: end === 'timeout' && returned === 0 ? 0 : undefined,
      client: i.client, channelId: i.channelId, currencySymbol: sym,
    });
    const title = end === 'bust' ? `💥 **Busted!** You lost **${sym} ${bet.toLocaleString()}**.${round.insuranceText}`
      : end === 'timeout' ? (returned > 0 ? `⏰ **Timed out** — auto-cashed at ×${mult}: **${sym} ${returned.toLocaleString()}**.` : `⏰ **Timed out** before making a move — your bet of **${sym} ${bet.toLocaleString()}** was forfeited.`)
      : end === 'clear' ? `🏆 **Board cleared!** ×${mult} — you won **${sym} ${returned.toLocaleString()}**!${round.xpText}`
      : `✅ **Cashed out at ×${mult}** — you won **${sym} ${returned.toLocaleString()}**!${luck > 1 ? ' *(🍀 luck bonus)*' : ''}${round.xpText}`;
    const v = def.view(state, ctx({ end, payout: returned, balance: round.balance }));
    await i.editReply({ content: `${v.content}\n\n${title}\n**Balance:** ${sym} **${round.balance.toLocaleString()}**${round.jackpotText}`, components: [] }).catch(() => {});
  };

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: b => b.user.id === userId,
    idle: 90_000,
    time: 14 * 60_000,
  });

  collector.on('collect', async b => {
    await b.deferUpdate().catch(() => {});
    if (finished) return;
    if (b.customId === 'cash') { if (def.mult(state) > 0) await finish('cashed'); return; }
    const out = def.press(state, b.customId);
    if (out === 'bust') { await finish('bust'); return; }
    if (out === 'clear') { await finish('clear'); return; }
    await i.editReply(render(def.view(state, ctx()))).catch(() => {});
  });

  collector.on('end', (_c, reason) => { if (reason !== 'done') void finish('timeout'); });
}

// ─── Mines ───────────────────────────────────────────────────────────────────

const minesDef = (mines: number): Def<MinesState> => ({
  game: 'mines',
  init: () => newMines(mines),
  mult: s => minesMultiplier(s.mineCount, s.revealed.size),
  xp: m => Math.min(50 + Math.floor(m * 10), 200),
  press: (s, id) => {
    const r = minesReveal(s, Number(id.split(':')[1]));
    return r === 'bust' ? 'bust' : r === 'clear' ? 'clear' : 'continue';
  },
  view: (s, c) => {
    const over = !!c.end;
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let r = 0; r < MINES_ROWS; r++) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (let col = 0; col < MINES_COLS; col++) {
        const idx = r * MINES_COLS + col;
        const shown = s.revealed.has(idx);
        const mine = s.mines.has(idx);
        row.addComponents(
          shown ? btn(`t:${idx}`, '💎', ButtonStyle.Success, true)
            : over && mine ? btn(`t:${idx}`, '💣', ButtonStyle.Danger, true)
            : btn(`t:${idx}`, '❔', ButtonStyle.Secondary, over));
      }
      rows.push(row);
    }
    rows.push(cashRow(c, over));
    const safeLeft = MINES_TILES - s.mineCount - s.revealed.size;
    return {
      content: `💣 **Mines** — ${s.mineCount} mine${s.mineCount === 1 ? '' : 's'} · bet ${c.sym} ${c.bet.toLocaleString()}\nRevealed **${s.revealed.size}** · safe tiles left ${safeLeft} · next tile ×${minesMultiplier(s.mineCount, s.revealed.size + 1) || '—'}`,
      rows,
    };
  },
});

// ─── Towers ──────────────────────────────────────────────────────────────────

const towersDef = (mode: string): Def<TowersState> => ({
  game: 'towers',
  init: () => newTowers(mode),
  mult: s => towersMultiplier(s.mode, s.picks.filter((p, row) => s.layout[row]!.has(p)).length),
  xp: m => Math.min(50 + Math.floor(m * 10), 200),
  press: (s, id) => {
    const r = towersPick(s, Number(id.split(':')[1]));
    return r === 'bust' ? 'bust' : r === 'clear' ? 'clear' : 'continue';
  },
  view: (s, c) => {
    const m = TOWER_MODES[s.mode]!;
    const lines: string[] = [];
    for (let r = TOWER_ROWS - 1; r >= 0; r--) {
      const mult = `×${towersMultiplier(s.mode, r + 1)}`;
      let cells = '';
      for (let t = 0; t < m.tiles; t++) {
        if (r < s.picks.length) {
          const picked = s.picks[r] === t;
          const safe = s.layout[r]!.has(t);
          cells += picked ? (safe ? '🟩' : '💥') : c.end ? (safe ? '🟢' : '⬛') : '⬛';
        } else cells += r === s.picks.length && !c.end ? '❔' : '⬜';
      }
      lines.push(`${cells}  ${mult}${r === s.picks.length && !c.end ? '  ⬅️' : ''}`);
    }
    const over = !!c.end || s.picks.length >= TOWER_ROWS;
    const tiles = new ActionRowBuilder<ButtonBuilder>().addComponents(
      Array.from({ length: m.tiles }, (_, t) => btn(`t:${t}`, `Tile ${t + 1}`, ButtonStyle.Primary, over)));
    return { content: `🗼 **Towers** — ${m.label} · bet ${c.sym} ${c.bet.toLocaleString()}\n${lines.join('\n')}`, rows: [tiles, cashRow(c, over)] };
  },
});

// ─── Ladder ──────────────────────────────────────────────────────────────────

interface LadderState { rung: number; fell: boolean }
const ladderDef: Def<LadderState> = {
  game: 'ladder',
  init: () => ({ rung: 0, fell: false }),
  mult: s => (s.fell ? 0 : ladderMultiplier(s.rung)),
  xp: m => Math.min(50 + Math.floor(m * 5), 200),
  press: (s, id) => {
    if (id !== 'climb') return 'continue';
    const r = ladderClimb(s.rung);
    if (r === 'fall') { s.fell = true; return 'bust'; }
    s.rung++;
    return r === 'top' ? 'clear' : 'continue';
  },
  view: (s, c) => {
    const lines = LADDER_CHANCES.map((p, i) => {
      const rung = i + 1;
      const mark = s.fell && rung === s.rung + 1 ? '💥' : s.rung >= rung ? '🟩' : s.rung === rung - 1 && !c.end ? '🧗' : '⬜';
      return `${mark} Rung ${rung} — ${Math.round(p * 100)}% to hold · ×${ladderMultiplier(rung)}`;
    }).reverse();
    const over = !!c.end;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(btn('climb', s.rung >= LADDER_CHANCES.length ? 'At the top' : `🪜 Climb to rung ${s.rung + 1}`, ButtonStyle.Primary, over));
    return { content: `🪜 **Ladder** — bet ${c.sym} ${c.bet.toLocaleString()}\n${lines.join('\n')}`, rows: [row, cashRow(c, over)] };
  },
};

// ─── Higher / Lower ──────────────────────────────────────────────────────────

interface HiloState { current: number; mult: number; streak: number; trail: number[] }
const HILO_MAX_STREAK = 15;
const hiloDef: Def<HiloState> = {
  game: 'higherlower',
  init: () => ({ current: drawRank(), mult: 0, streak: 0, trail: [] }),
  mult: s => s.mult,
  xp: m => Math.min(50 + Math.floor(m * 8), 200),
  press: (s, id) => {
    if (id !== 'higher' && id !== 'lower') return 'continue';
    const r = hiloGuess(s.current, id);
    s.trail.push(s.current);
    s.current = r.next;
    if (!r.win) { s.mult = 0; return 'bust'; }
    s.mult = Math.floor((s.mult === 0 ? 1 : s.mult) * r.step * 100) / 100;
    s.streak++;
    return s.streak >= HILO_MAX_STREAK ? 'clear' : 'continue';
  },
  view: (s, c) => {
    const over = !!c.end;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      btn('higher', `⬆️ Higher (${Math.round(chanceHigher(s.current) * 100)}%)`, ButtonStyle.Primary, over || chanceHigher(s.current) === 0),
      btn('lower', `⬇️ Lower (${Math.round(chanceLower(s.current) * 100)}%)`, ButtonStyle.Primary, over || chanceLower(s.current) === 0),
    );
    const trail = s.trail.length ? `\nPrevious: ${s.trail.slice(-8).map(rankName).join(' → ')}` : '';
    return {
      content: `🃏 **Higher or Lower** — bet ${c.sym} ${c.bet.toLocaleString()}\nCurrent card: **${rankName(s.current)}** *(ties lose)*\nStreak **${s.streak}**${trail}`,
      rows: [row, cashRow(c, over)],
    };
  },
};

// ─── Dice (single round) ─────────────────────────────────────────────────────

const die = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
async function playDice(i: ChatInputCommandInteraction) {
  const guildId = (i.guildId ?? 'global'), userId = i.user.id;
  const bet = i.options.getInteger('amount', true);
  const cfg = await getEconomyConfig(guildId);
  const sym = cfg.currency_symbol;
  const staked = await stake(guildId, userId, bet, 'dice');
  if (!staked.success) { await i.reply(cv2Err(`❌ Not enough ${cfg.currency_name}. Balance: **${sym} ${staked.newBalance.toLocaleString()}**.`)); return; }

  const [p1, p2, h1, h2] = [randInt(1, 6), randInt(1, 6), randInt(1, 6), randInt(1, 6)];
  const player = p1 + p2, house = h1 + h2;
  const win = player > house, tie = player === house;
  const luck = win ? (await getGambleMultiplier(guildId, userId)) * (await fortuneMultiplier(userId)) : 1;
  const returned = win ? bet + Math.floor(bet * (DICE_WIN_MULT - 1) * luck) : tie ? bet : 0;
  const round = await settleRound({
    guildId, userId, game: 'dice', bet, returned, won: win, xp: win ? randInt(50, 100) : undefined,
    client: i.client, channelId: i.channelId, currencySymbol: sym,
  });
  const result = win ? `✅ You win **${sym} ${(returned - bet).toLocaleString()}**!` : tie ? '🤝 Tie — your bet is refunded.' : `❌ You lose **${sym} ${bet.toLocaleString()}**.${round.insuranceText}`;
  await i.reply({
    content: `🎲 **Dice** — bet ${sym} ${bet.toLocaleString()}\n**You:** ${die[p1! - 1]} ${die[p2! - 1]} = **${player}**\n**House:** ${die[h1! - 1]} ${die[h2! - 1]} = **${house}**\n${result}\n**Balance:** ${sym} **${round.balance.toLocaleString()}**${round.xpText}${round.jackpotText}`,
  });
}

export const interactiveSubs: Sub[] = [
  {
    name: 'mines', description: 'Reveal tiles, avoid the mines, cash out before you blow up',
    options: s => betOption(s).addIntegerOption(o => o.setName('count').setDescription(`Number of mines (${MINES_MIN}–${MINES_MAX}, default 3)`).setMinValue(MINES_MIN).setMaxValue(MINES_MAX)),
    run: i => runInteractive(i, minesDef(i.options.getInteger('count') ?? 3)),
  },
  {
    name: 'towers', description: 'Climb five rows and cash out before losing',
    options: s => betOption(s).addStringOption(o => o.setName('difficulty').setDescription('How risky (default medium)')
      .addChoices(...Object.entries(TOWER_MODES).map(([value, m]) => ({ name: m.label, value })))),
    run: i => runInteractive(i, towersDef(i.options.getString('difficulty') ?? 'medium')),
  },
  { name: 'ladder', description: 'Climb the multiplier ladder', options: betOption, run: i => runInteractive(i, ladderDef) },
  { name: 'higherlower', description: 'Guess higher or lower and build a streak', options: betOption, run: i => runInteractive(i, hiloDef) },
  { name: 'dice', description: 'Bet on a dice roll vs the house', options: betOption, run: playDice },
];
