import { ComponentType, InteractionType, MessageFlags, TextChannel } from 'discord.js';
import { EventModule } from '../feature';

// ── Word-to-number ────────────────────────────────────────────────────────────
const ONES: Record<string, number> = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15,
  sixteen:16, seventeen:17, eighteen:18, nineteen:19,
};
const TENS: Record<string, number> = {
  twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90,
};

function wordsToNumber(text: string): number | null {
  const tokens = text.toLowerCase().replace(/-/g, ' ').trim().split(/\s+/);
  if (tokens.some(t => !ONES.hasOwnProperty(t) && !TENS.hasOwnProperty(t) && !['hundred','thousand','million','and'].includes(t))) return null;
  let result = 0, current = 0;
  for (const t of tokens) {
    if (ONES[t] !== undefined) { current += ONES[t]; }
    else if (TENS[t] !== undefined) { current += TENS[t]; }
    else if (t === 'hundred') { current = (current || 1) * 100; }
    else if (t === 'thousand') { result += (current || 1) * 1000; current = 0; }
    else if (t === 'million') { result += (current || 1) * 1_000_000; current = 0; }
  }
  result += current;
  return result;
}

// ── Roman numerals ────────────────────────────────────────────────────────────
const ROMAN_PAIRS: [string, number][] = [
  ['CM',900],['CD',400],['XC',90],['XL',40],['IX',9],['IV',4],
  ['M',1000],['D',500],['C',100],['L',50],['X',10],['V',5],['I',1],
];

function romanToInt(s: string): number | null {
  const str = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(str)) return null;
  let i = 0, result = 0;
  while (i < str.length) {
    let matched = false;
    for (const [sym, val] of ROMAN_PAIRS) {
      if (str.startsWith(sym, i)) { result += val; i += sym.length; matched = true; break; }
    }
    if (!matched) return null;
  }
  return result > 0 ? result : null;
}

// ── Safe math evaluator ───────────────────────────────────────────────────────
function evalMath(expr: string): number | null {
  // Only allow digits, operators, parens, decimals
  if (!/^[\d+\-*/().]+$/.test(expr)) return null;
  const tokens = expr.match(/\d+\.?\d*|[+\-*/()]/g);
  if (!tokens) return null;
  try {
    const nums: number[] = [], ops: string[] = [];
    const precedence: Record<string, number> = { '+':1, '-':1, '*':2, '/':2 };
    const applyOp = () => {
      const op = ops.pop()!;
      const b = nums.pop()!, a = nums.pop()!;
      if (op === '+') nums.push(a + b);
      else if (op === '-') nums.push(a - b);
      else if (op === '*') nums.push(a * b);
      else if (op === '/') { if (b === 0) throw new Error('div0'); nums.push(a / b); }
    };
    for (const tok of tokens) {
      if (/^\d/.test(tok)) { nums.push(parseFloat(tok)); }
      else if (tok === '(') { ops.push(tok); }
      else if (tok === ')') {
        while (ops.length && ops[ops.length-1] !== '(') applyOp();
        ops.pop();
      } else {
        while (ops.length && ops[ops.length-1] !== '(' && (precedence[ops[ops.length-1]] ?? 0) >= precedence[tok]) applyOp();
        ops.push(tok);
      }
    }
    while (ops.length) applyOp();
    const result = nums[0];
    return isFinite(result) ? Math.round(result * 10000) / 10000 : null;
  } catch { return null; }
}

// ── Main parser ───────────────────────────────────────────────────────────────
function parseCount(raw: string): number | null {
  const text = raw.trim().replaceAll(',', '').replaceAll('_', '');
  if (!text) return null;

  // 1. Plain integer
  const plain = Number.parseInt(text, 10);
  if (!isNaN(plain) && /^-?\d+$/.test(text)) return plain;

  // 2. Pure roman numeral (no operators)
  if (/^[IVXLCDM]+$/i.test(text)) return romanToInt(text);

  // 3. Written-out number (e.g. "twenty five", "one hundred")
  const wordVal = wordsToNumber(text);
  if (wordVal !== null) return wordVal;

  // 4. Math expression — replace 'x'/'×' with '*', substitute roman numeral tokens
  const mathText = text
    .replace(/[xX×]/g, '*')
    .replace(/\s+/g, '')
    // Replace roman numeral tokens that are surrounded by operators/start/end
    .replace(/(?<=[+\-*/^(]|^)[IVXLCDM]+(?=[+\-*/^(]|$)/gi, m => {
      const v = romanToInt(m);
      return v !== null ? String(v) : m;
    });

  return evalMath(mathText);
}

// ─────────────────────────────────────────────────────────────────────────────

const countingModule: EventModule = {
  name: 'counting',
  handlers: {
    messageCreate: async ({ data: [message], bot, db }) => {
      if (!message.guildId || message.author?.bot) return;
      const counting = await db.getCounting(message.channelId);
      if (!counting) return;

      const { count, highscore, last_msg } = counting;
      let lastUser = last_msg?.author_id;

      let lowerContent = (message.content || '').toLowerCase();
      if (lowerContent.includes('what is the count') || lowerContent.includes('what are we up to')) {
        if (!message.channel || !message.channel.isTextBased()) return;
        const channel = message.channel as TextChannel;
        await channel.send({
          content: `We are up to ${count.toLocaleString()}, so next number is **${(count + 1).toLocaleString()}!**`,
          reply: { messageReference: message.id },
        });
        return;
      }

      // Respond to cheaty emojis
      if (message.content?.includes('☑️') || message.content?.includes('✅')) {
        setTimeout(async () => {
          try { await message.react('🤨'); } catch {}
        }, 200);
      }

      const num = parseCount(message.content ?? '');
      if (num === null || num === 0 || !Number.isInteger(num) || num < 0) return;

      if (lastUser && last_msg?.failed !== true && message.author.id === lastUser) {
        if (!message.channel.isTextBased()) return;
        await message.reply({ content: `⚠️ <@${message.author.id}> Wait for someone else to send **${(count + 1).toLocaleString()}.**` });
        await message.react('⚠️').catch(console.error);
        return;
      }
      if (!message.channel.isTextBased()) return;

      if (num === count + 2 || num === count) {
        await message.reply({ content: `⚠️ <@${message.author.id}> You're close, but you actually need to send **${(count + 1).toLocaleString()}.**` });
        await message.react('⚠️').catch(console.error);
        return;
      }

      if (num !== count + 1) {
        if (lastUser && last_msg?.failed && message.author.id === lastUser) {
          await message.react('❌').catch(console.error);
          return;
        }

        if (await db.consumeBoost(message.guildId, message.author.id, 'extra_life')) {
          await message.reply({ content: `💖 <@${message.author.id}> **Extra Life used!** Your mistake was forgiven — the streak is safe at **${count.toLocaleString()}**, next number is still **${(count + 1).toLocaleString()}.**` });
          await message.react('💖').catch(console.error);
          return;
        }

        const punishmentNumber = Math.max(
          0,
          Math.min(
            Math.max(
              count - Math.round(Math.abs(count - num) * (Math.random() * 2 + 1.35)),
              Math.round(count * (1 - (count > 25 ? 0.15 : 0.5)))
            ),
            count - 1
          )
        );

        await db.updateCounting(message.channel.id, {
          count: punishmentNumber,
          last_msg: { message_id: message.id, author_id: message.author.id, number: num, failed: true },
        });

        await message.reply({ content: `⚠️ <@${message.author.id}> RUINED IT AT **${count.toLocaleString()}**!! Now next number is **${(punishmentNumber + 1).toLocaleString()}.**` });
        await message.react('❌').catch(console.error);
        return;
      }

      await db.updateCounting(message.channel.id, {
        count: count + 1,
        highscore: Math.max(highscore ?? 0, count + 1),
        last_msg: { message_id: message.id, author_id: message.author.id, number: num },
      });

      await message.react((highscore ?? 0) <= count + 1 ? '☑️' : '✅').catch(console.error);
    },

    messageUpdate: async ({ data: [oldMessage, newMessage], bot, db }) => {
      const counting = await db.getCounting(newMessage.channelId);
      if (!counting) return;
      const latest = counting.last_msg;
      if (!latest || latest.message_id !== newMessage.id) return;
      const newNumber = parseCount(newMessage.content ?? '');
      if (newNumber === null || newNumber === latest.number) return;
      const channel = newMessage.channel as TextChannel;
      if (!channel?.isTextBased()) return;
      await channel.send({ content: `<@${latest.author_id}> why change your message from **"${latest.number.toLocaleString()}"**?` });
    },

    messageDelete: async ({ data: [message], bot, db }) => {
      const counting = await db.getCounting(message.channelId);
      if (!counting) return;
      const latest = counting.last_msg;
      if (!latest || latest.message_id !== message.id) return;
      await message.channel.send({ content: `<@${latest.author_id}> why u delete **"${latest.number.toLocaleString()}"**?` });
    },

    messageDeleteBulk: async ({ data: [messages, channel], bot, db }) => {
      const counting = await db.getCounting(channel.id);
      if (!counting) return;
      const latest = counting.last_msg;
      if (!latest) return;
      if (!messages.has(latest.message_id)) return;
      await channel.send({
        content: `<@${latest.author_id}> why u delete **${latest.number.toLocaleString()}**?`,
        allowedMentions: { users: [latest.author_id] },
      });
    },

    channelDelete: async ({ data: [channel], bot, db }) => {
      if (!channel.isTextBased()) return;
      const textChannel = channel as TextChannel;
      if (!textChannel.guildId) return;
      await db.removeCountingByChannelId(textChannel.guildId, textChannel.id);
    },

    interactionCreate: async ({ data: [interaction], bot, db }) => {
      if (!interaction.guildId) return;
      if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('counting_modal:')) {
        const channelId = interaction.channel?.id;
        if (!channelId) return;
        let newCount = 0, newHighScore = 0, resetMessages = false;
        for (const label of interaction.components) {
          if (label.type !== ComponentType.Label) continue;
          const c = label.component ?? label;
          if (!c) continue;
          if (c.type === ComponentType.TextInput) {
            if (c.customId === 'current_count' && c.value) newCount = Number(c.value.replaceAll(',', ''));
            if (c.customId === 'high_score' && c.value) newHighScore = Number(c.value.replaceAll(',', ''));
          } else if (c.type === ComponentType.Checkbox) {
            if (c.customId === 'reset_messages') resetMessages = c.value;
          }
        }
        if (isNaN(newCount) || isNaN(newHighScore)) {
          await interaction.reply({ content: '❌ Please enter valid numbers for count and high score.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (resetMessages) {
          await db.unsetCounting(channelId);
          await interaction.reply({ content: '🚫 Counting has been disabled for this channel and all data has been reset.', flags: MessageFlags.Ephemeral });
          return;
        }
        await db.setCounting(channelId, interaction.guildId, newCount, Math.max(newHighScore, newCount), undefined);
        await interaction.reply({ content: `✅ Counting has been updated for this channel! The current count is now **${newCount.toLocaleString()}** with a high score of **${newHighScore.toLocaleString()}**.` });
      }
    },
  },
};

export default countingModule;
