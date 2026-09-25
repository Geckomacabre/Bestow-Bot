import { Colors, ContainerBuilder, TextDisplayBuilder } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { adjustBalance, getEconomyConfig, getProtection, setProtection } from '../../utils/db.js';
import { cv2Err, IS_CV2 } from '../../utils/components.js';
import { withLock } from '../../framework/mutex.js';

const PROTECTION_COST = 5_000;
const PROTECTION_DURATION_MS = 24 * 60 * 60 * 1000;

export const protection: Sub = {
  name: 'protection',
  description: 'Hire mob protection for 24 hours (5,000) — nobody can rob you',

  async run(interaction) {
    const guildId = (interaction.guildId ?? 'global');
    const userId = interaction.user.id;

    await withLock(`eco:${userId}`, async () => {
      const cfg = await getEconomyConfig(guildId);
      const sym = cfg.currency_symbol;

      const existing = await getProtection(guildId, userId);
      if (existing !== null) {
        const hrs = Math.ceil((existing - Date.now()) / 3_600_000);
        await interaction.reply(cv2Err(`You already have mob protection active for another ~${hrs} hour${hrs !== 1 ? 's' : ''}.`));
        return;
      }

      const paid = await adjustBalance(guildId, userId, -PROTECTION_COST, 'shop:protection');
      if (!paid.success) {
        await interaction.reply(cv2Err(`You need **${sym} ${PROTECTION_COST.toLocaleString()}** for mob protection. Cash: **${sym} ${paid.newBalance.toLocaleString()}**.`));
        return;
      }

      const expiresAt = Date.now() + PROTECTION_DURATION_MS;
      await setProtection(guildId, userId, expiresAt);
      await interaction.reply({
        flags: IS_CV2,
        components: [new ContainerBuilder().setAccentColor(Colors.Gold).addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `🛡️ **Mob Protection Activated**\nYou paid **${sym} ${PROTECTION_COST.toLocaleString()}** to hire protection.\nYou are protected from robbery until <t:${Math.floor(expiresAt / 1000)}:f> (<t:${Math.floor(expiresAt / 1000)}:R>).`,
        ))],
      });
    });
  },
};
