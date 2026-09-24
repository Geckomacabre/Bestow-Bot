import { ChatInputCommandInteraction, Colors, ContainerBuilder, TextChannel, TextDisplayBuilder } from 'discord.js';
import * as db from './db';
import { IS_CV2 } from './components.js';

export function parseDuration(s: string): number | null {
  const m = /^(\d+)(s|m|h|d|w)$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1]);
  const units: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return n * (units[m[2].toLowerCase()] ?? 0) || null;
}

export function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export const TYPE_COLORS: Record<string, number> = {
  ban: Colors.Red, unban: Colors.Green, kick: Colors.Orange,
  timeout: Colors.Yellow, removetimeout: Colors.Green, warn: Colors.Yellow, report: Colors.Blue,
};

export async function sendModCase(
  interaction: ChatInputCommandInteraction,
  modCase: { case_num: number; type: string; user_tag: string; user_id: string; expires_at?: number | null },
  user: { tag: string; id: string },
  extras: string[] = [],
) {
  const color = TYPE_COLORS[modCase.type] ?? Colors.Grey;
  const lines = [
    `**Case #${modCase.case_num} — ${capitalize(modCase.type)}**`,
    `**User:** ${user.tag} (${user.id})`,
    `**Moderator:** ${interaction.user.tag}`,
    ...extras,
    ...(modCase.expires_at ? [`**Expires:** <t:${Math.floor(modCase.expires_at / 1000)}:R>`] : []),
  ];
  const container = new ContainerBuilder().setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  await interaction.editReply({ flags: IS_CV2, components: [container] });

  const cfg = await db.getModConfig(interaction.guildId!);
  if (cfg.modlog_channel_id) {
    const ch = await interaction.guild!.channels.fetch(cfg.modlog_channel_id).catch(() => null) as TextChannel | null;
    await ch?.send({ flags: IS_CV2, components: [container] }).catch(() => {});
  }
}
