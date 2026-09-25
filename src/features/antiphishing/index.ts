import { Colors, EmbedBuilder, TextChannel } from 'discord.js';
import { EventModule } from '../feature';

// Cache of known phishing domains fetched from sinking.yachts
let phishingDomains = new Set<string>();

async function refreshDomains() {
  try {
    const res = await fetch('https://phish.sinking.yachts/v2/all', {
      headers: { 'X-Identity': 'Onyx antiphishing' },
    });
    if (!res.ok) return;
    const list: string[] = await res.json();
    phishingDomains = new Set(list.map(d => d.toLowerCase()));
  } catch {}
}

// Refresh every 30 minutes
refreshDomains();
setInterval(refreshDomains, 30 * 60 * 1000);

const URL_RE = /https?:\/\/([^\s/]+)/gi;

function extractDomains(text: string): string[] {
  const domains: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    domains.push(m[1]!.toLowerCase().replace(/^www\./, ''));
  }
  return domains;
}

// Catches discord.gg/xxx and discord.com/invite/xxx with or without a protocol —
// raid spam almost never bothers with "https://".
const INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-zA-Z0-9-]{2,32})/gi;

function extractInviteCodes(text: string): string[] {
  const codes: string[] = [];
  let m: RegExpExecArray | null;
  INVITE_RE.lastIndex = 0;
  while ((m = INVITE_RE.exec(text)) !== null) codes.push(m[1]!);
  return codes;
}

// Brands most commonly impersonated in nitro/crypto scam links. Catches
// zero-day typosquats (e.g. "discocd.gift") that haven't hit the sinking.yachts
// blocklist yet — that list only refreshes every 30 minutes, which is exactly
// the window a raid script exploits.
const BRAND_DOMAINS = ['discord.com', 'discordapp.com', 'steamcommunity.com', 'steampowered.com', 'epicgames.com'];

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(dp[j]!, dp[j - 1]!, prev);
      prev = temp;
    }
  }
  return dp[b.length]!;
}

function findLookalike(domain: string): string | null {
  for (const brand of BRAND_DOMAINS) {
    if (domain === brand || domain.endsWith(`.${brand}`)) return null; // exact or legit subdomain
    const dist = levenshtein(domain, brand);
    if (dist > 0 && dist <= 2) return brand;
  }
  return null;
}

async function alertModlog(message: any, db: any, title: string, detail: string, color: number) {
  try {
    const cfg = await db.getModConfig(message.guildId);
    const channelId = cfg?.modlog_channel_id;
    if (!channelId) return;
    const ch = await message.client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(`<@${message.author.id}> in <#${message.channelId}>\n${detail}`)
      .setFooter({ text: `${message.author.tag} • ${message.author.id}` })
      .setTimestamp();
    await ch.send({ embeds: [embed] }).catch(() => {});
  } catch {}
}

const antiphishingModule: EventModule = {
  name: 'antiphishing',
  handlers: {
    messageCreate: async ({ data: [message], db }) => {
      if (!message.guildId || !message.content || message.author?.bot) return;
      const member = message.member;
      if (member?.permissions.has('ManageMessages')) return;

      const cfg = await db.getAntiphishingConfig(message.guildId);
      if (!cfg.enabled) return;

      const domains = extractDomains(message.content);

      // ── Known phishing domains (sinking.yachts blocklist) ─────────────────────
      // Independent of the lookalike check below — an empty/not-yet-loaded
      // blocklist must not disable lookalike detection too.
      if (phishingDomains.size) {
        const hit = domains.find(d => phishingDomains.has(d));
        if (hit) {
          await message.delete().catch(() => {});
          await message.channel.send(
            `🚨 <@${message.author.id}> **Phishing link detected and removed.** The domain \`${hit}\` is a known phishing site.`
          ).then((m: any) => setTimeout(() => m.delete().catch(() => {}), 10_000)).catch(() => {});
          await alertModlog(message, db, '🎣 Phishing Link Removed', `Domain: \`${hit}\``, Colors.DarkRed);
          return;
        }
      }

      // ── Lookalike / typosquat domains ─────────────────────────────────────────
      if (cfg.block_lookalike) {
        for (const d of domains) {
          const brand = findLookalike(d);
          if (!brand) continue;
          await message.delete().catch(() => {});
          await message.channel.send(
            `🚨 <@${message.author.id}> **Suspicious link removed.** \`${d}\` looks like it's impersonating \`${brand}\`.`
          ).then((m: any) => setTimeout(() => m.delete().catch(() => {}), 10_000)).catch(() => {});
          await alertModlog(message, db, '⚠️ Lookalike Domain Removed', `Domain: \`${d}\` (impersonating \`${brand}\`)`, Colors.Orange);
          return;
        }
      }

      // ── Discord invite links (the #1 raid-spam vector) ──────────────────────
      if (cfg.block_invites) {
        const codes = extractInviteCodes(message.content);
        if (codes.length) {
          await message.delete().catch(() => {});
          await message.channel.send(
            `🚨 <@${message.author.id}> **Invite link removed.** Posting Discord invites isn't allowed here.`
          ).then((m: any) => setTimeout(() => m.delete().catch(() => {}), 10_000)).catch(() => {});
          await alertModlog(message, db, '🔗 Invite Link Removed', `Code(s): \`${codes.join('`, `')}\``, Colors.Yellow);
        }
      }
    },
  },
};

export default antiphishingModule;
