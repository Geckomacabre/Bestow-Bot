import { Colors, type Client } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import {
  db, getEconomyConfig, getEconomyCooldown, setEconomyCooldown, getProtection, consumeBoost,
} from '../../utils/db.js';
import { cv2Err, cv2Box } from '../../utils/components.js';
import { rand, randInt } from '../../utils/random.js';
import { getCash, moveCash } from '../../eco/core.js';
import { guardBonus, robBonus, pct } from '../../eco/effects.js';
import { withLock } from '../../framework/mutex.js';

const FAIL_COOLDOWN_MS = 30 * 60 * 1000;
const SUCCESS_COOLDOWN_MS = 60 * 60 * 1000;
const MIN_TARGET_CASH = 100;
const BASE_CHANCE = 0.5;

const box = (color: number, text: string) => cv2Box(text, color);

export const rob: Sub = {
  name: 'rob',
  description: 'Try to steal cash from another user (banked money is safe)',
  options: s => s.addUserOption(o => o.setName('user').setDescription('Who to rob').setRequired(true)),

  async run(interaction) {
    const guildId = (interaction.guildId ?? 'global');
    const userId = interaction.user.id;
    const target = interaction.options.getUser('user', true);

    if (target.id === userId) { await interaction.reply(cv2Err('You cannot rob yourself.')); return; }
    if (target.bot) { await interaction.reply(cv2Err('You cannot rob a bot.')); return; }

    // One robbery attempt per user at a time — no double-dipping on the cooldown check.
    await withLock(`rob:${userId}`, async () => {
      const cfg = await getEconomyConfig(guildId);
      const sym = cfg.currency_symbol;
      const now = Date.now();

      const [lastFail, lastSuccess] = await Promise.all([getEconomyCooldown(userId, 'rob_fail'), getEconomyCooldown(userId, 'rob_success')]);
      if (now - lastFail < FAIL_COOLDOWN_MS) {
        const min = Math.ceil((FAIL_COOLDOWN_MS - (now - lastFail)) / 60_000);
        await interaction.reply(cv2Err(`You're still lying low after your last failed robbery. Try again in **${min} min**.`)); return;
      }
      if (now - lastSuccess < SUCCESS_COOLDOWN_MS) {
        const min = Math.ceil((SUCCESS_COOLDOWN_MS - (now - lastSuccess)) / 60_000);
        await interaction.reply(cv2Err(`You need to lay low after your last successful robbery. Try again in **${min} min**.`)); return;
      }

      // Mob protection: the rob fails, but the robber isn't put on cooldown.
      const protection = await getProtection(guildId, target.id);
      if (protection !== null) {
        const hrs = Math.ceil((protection - now) / 3_600_000);
        await interaction.reply(box(Colors.Orange, `🛡️ **Rob Failed**\n<@${target.id}> has **mob protection** for another ~${hrs}h.\nYour crew backed off — no cooldown this time.`));
        return;
      }

      const targetCash = await getCash(guildId, target.id);
      if (targetCash < MIN_TARGET_CASH) {
        await interaction.reply(cv2Err(`<@${target.id}> is carrying less than ${sym} ${MIN_TARGET_CASH} in cash — not worth it. (Money in the bank can't be robbed.)`)); return;
      }

      const [bonus, guard] = await Promise.all([robBonus(userId), guardBonus(target.id)]);
      const chance = Math.min(0.9, Math.max(0.1, BASE_CHANCE + bonus - guard));
      const success = rand() < chance;
      const oddsNote = bonus || guard
        ? `\n*Odds: ${pct(chance)}${bonus ? ` (+${pct(bonus)} Rogue card)` : ''}${guard ? ` (−${pct(guard)} target's Guardian card)` : ''}*`
        : '';

      if (success) {
        // Steal anywhere from 1 coin up to the victim's whole wallet — re-read so a spent wallet can't be overdrawn.
        let stolen = 0;
        for (let attempt = 0; attempt < 2 && !stolen; attempt++) {
          const cash = await getCash(guildId, target.id);
          if (cash < 1) break;
          const amount = randInt(1, cash);
          if (await moveCash(guildId, target.id, userId, amount, 'rob')) stolen = amount;
        }
        if (!stolen) {
          await interaction.reply(box(Colors.Orange, `🦹 You got there just as <@${target.id}> emptied their pockets. Nothing to steal.`));
          return;
        }
        await setEconomyCooldown(userId, 'rob_success');
        await interaction.reply(box(Colors.Green, `🦹 **Successful Robbery!**\nYou stole **${sym} ${stolen.toLocaleString()}** from <@${target.id}>!\n*You'll need to lay low for 1 hour.*${oddsNote}`));
        void notifyVictim(interaction.client, target.id,
          `🦹 **${interaction.user.username}** robbed you for **${sym} ${stolen.toLocaleString()}** in **${interaction.guild?.name ?? 'a server'}**. ` +
          `Keep your money in the bank with \`/eco bank deposit\` to protect it. (Turn these DMs off with \`/eco notifications\`.)`);
        return;
      }

      const robberCash = await getCash(guildId, userId);
      const fine = Math.min(Math.floor(targetCash * 0.05), 500, robberCash);
      if (fine > 0) await moveCash(guildId, userId, target.id, fine, 'rob:fine');
      // Goon Squad (shop one-shot): a failed rob triggers no cooldown.
      const goons = await consumeBoost(guildId, userId, 'goon');
      if (!goons) await setEconomyCooldown(userId, 'rob_fail');
      await interaction.reply(box(Colors.Red,
        `🚨 **Caught!**\nYou were caught trying to rob <@${target.id}>!\n${fine > 0 ? `You paid **${sym} ${fine.toLocaleString()}** as a fine.` : 'You had nothing to pay as a fine.'}\n` +
        `${goons ? '🥊 *Your Goon Squad covered the escape — no cooldown!*' : "*You're on a 30-minute cooldown.*"}${oddsNote}`));
    });
  },
};

async function notifyVictim(client: Client, victimId: string, text: string) {
  try {
    const [row] = await db`SELECT notify_rob FROM economy WHERE user_id = ${victimId}`;
    if (row && !row.notify_rob) return;
    const user = await client.users.fetch(victimId);
    await user.send(text);
  } catch { /* DMs closed */ }
}
