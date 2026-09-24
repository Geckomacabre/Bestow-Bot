import {
  ApplicationCommandOptionType,
  Client,
  ComponentType,
  InteractionType,
  MessageFlags,
  TextChannel,
} from 'discord.js';
import { EventModule } from '../feature';
import { getTimeZones, Timezone } from '../../utils/timeZones';
import { trim } from '../../utils/strings';

const _timezones = getTimeZones();
const timezones = _timezones;

const timezoneModule: EventModule = {
  name: 'timezone',
  handlers: {
    clientReady: async ({ data: [bot], db }: any) => {
      const timeTillNextMinute = 60000 - (Date.now() % 60000);
      await updateExistingTimezoneMessage(bot, db).catch(console.error);
      setTimeout(() => {
        updateExistingTimezoneMessage(bot, db).catch(console.error);
        setInterval(() => {
          updateExistingTimezoneMessage(bot, db).catch(console.error);
        }, 60_000);
      }, timeTillNextMinute);
    },
    messageDelete: async ({ data: [message], db }: any) => {
      if (!message.guildId) return;
      await db.removeGuildTimezoneMessageByMsgId(message.guildId, message.id);
    },
    guildMemberRemove: async ({ data: [member], db }: any) => {
      await db.removeUserTimezone(member.guild.id, member.user.id);
    },
    channelDelete: async ({ data: [channel], db }: any) => {
      if (!channel.isTextBased()) return;
      const textChannel = channel as TextChannel;
      if (!textChannel.guildId || !textChannel.id) return;
      await db.removeGuildTimezoneMessageByChannelId(textChannel.guildId, textChannel.id);
    },
    interactionCreate: async ({ data: [interaction], db }: any) => {
      if (!interaction.guildId) return;

      if (
        interaction.type === InteractionType.ApplicationCommandAutocomplete &&
        (interaction.commandName === 'timezone' || (interaction.commandName === 'config' && interaction.options.getSubcommandGroup() === 'timezone'))
      ) {
        const focused = interaction.options.getFocused(true);
        if (focused?.type !== ApplicationCommandOptionType.String) return;

        const value = typeof focused?.value === 'string' ? focused.value.toLowerCase() : '';
        const results = searchTimezones(value)
          .slice(0, 25)
          .map((tz) => ({
            name: trim(
              `[${offsetToString(tz.offset)}] ${tz.displayName} - ${tz.cities?.join(', ') || ''} ${tz.hasDST ? ' (DST)' : ''}`,
              100
            ),
            value: tz.name,
          }));
        await interaction.respond(results);
      }
    },
  },
};

export default timezoneModule;

export async function generateTimezoneMessage(
  db: typeof import('../../utils/db'),
  guildId: string,
  highlightUserId?: string | null
): Promise<any | null> {
  const timezoneRows = await db.getGuildTimezones(guildId);
  if (!timezoneRows.length) return null;

  const now = Date.now();

  const tzs = timezoneRows
    .sort((a, b) => {
      if (a.user_id.length === b.user_id.length) return a.user_id.localeCompare(b.user_id);
      return a.user_id.length - b.user_id.length;
    })
    .reduce((acc: { localTime: string; offsetStr: string; user_ids: string[]; offsetNum: number }[], r) => {
      const canonical = timezones.find((e) => e.name === r.timezone);
      if (!canonical) return acc;

      let localTime = '?';
      let offsetStr = '';
      try {
        localTime = new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: canonical.name,
        }).format(now);
        offsetStr =
          new Intl.DateTimeFormat('en-US', { timeZone: canonical.name, timeZoneName: 'shortOffset' })
            .formatToParts(now)
            .find((p) => p.type === 'timeZoneName')?.value || '';
      } catch {}

      const existing = acc.find((e) => e.localTime === localTime);
      if (existing) {
        existing.user_ids.push(r.user_id);
      } else {
        acc.push({ ...r, user_ids: [r.user_id], localTime, offsetStr, offsetNum: canonical.offset });
      }
      return acc;
    }, [])
    .sort((a, b) => a.offsetNum - b.offsetNum);

  const lines = tzs.map(
    (row) =>
      `* \`${row.localTime}\`  ${row.offsetStr}  •  ${row.user_ids.map((id) => (id === highlightUserId ? `__***<@${id}>***__` : `<@${id}>`)).join(' ')}`
  );
  const result = `### Server member timezones:\n` + lines.join('\n');

  return {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {},
    components: [
      {
        type: ComponentType.Container,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: result,
          },
        ],
      },
    ],
    content: '',
  };
}

async function updateExistingTimezoneMessage(bot: Client, db: typeof import('../../utils/db')): Promise<void> {
  const guilds = await db.getTimezoneMessages();

  for (const guild of guilds) {
    const newContent = await generateTimezoneMessage(db, guild.guild_id, null);
    if (!newContent) continue;

    try {
      const channel = await bot.channels.fetch(guild.channel_id);
      if (!channel || !channel.isTextBased()) continue;

      if (!guild.message_id || guild.message_id === '0') continue;
      const message = await (channel as any).messages.fetch(guild.message_id).catch(() => null);
      if (!message) continue;

      await message.edit({
        ...newContent,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      console.error(err);
    }
  }
}

export function findTimezoneMatch(z: string): Timezone | undefined {
  if (!z) return undefined;
  const input = String(z).trim().toLowerCase();
  const exact = timezones.find((tz) => tz.name.toLowerCase() === input);
  if (exact) return exact;
  return searchTimezones(input)[0];
}

export function searchTimezones(query: string): Timezone[] {
  const input = String(query).trim().toLowerCase();
  return timezones
    .filter(
      (tz) =>
        tz.name.toLowerCase().includes(input) ||
        tz.displayName.toLowerCase().includes(input) ||
        tz.abbr.toLowerCase().includes(input) ||
        tz.offset.toString() === input ||
        offsetToString(tz.offset) === input ||
        (tz.cities && tz.cities.some((u: string) => u.toLowerCase().includes(input))) ||
        (tz.country && tz.country.toLowerCase().includes(input))
    )
    .sort((a, b) => {
      const aPopular = a.popular ? 1 : 0;
      const bPopular = b.popular ? 1 : 0;
      if (aPopular !== bPopular) return bPopular - aPopular;
      return 0;
    });
}

export function offsetToString(offset: number): string {
  if (offset === 0) return 'UTC±0';
  const sign = offset > 0 ? '+' : '-';
  const hours = Math.floor(Math.abs(offset));
  const minutes = Math.round((Math.abs(offset) - hours) * 60);
  return `UTC${sign}${hours.toString().padStart(0, '0')}${minutes === 0 ? '' : `:${minutes.toString().padStart(2, '0')}`}`;
}
