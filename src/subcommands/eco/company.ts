import { AttachmentBuilder, ContainerBuilder, MessageFlags, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { safeLoadImage } from '../../framework/imgsafe.js';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Sub, SubGroup } from '../../framework/group.js';
import { askUser } from '../../framework/confirm.js';
import { getBufferPublic } from '../../framework/http.js';
import { COMPANY, PROJECTS } from '../../eco/catalog.js';
import {
  cancelProject, changeRank, collectProject, companyLeaderboard, companyLogs, completeProject, contributeProject, createCompany,
  decideRequest, deleteCompany, findCompany, getMembership, getProject, inviteUser, joinCompany, kickMember, leaveCompany, listMembers,
  listRequests, memberCap, projectContribs, rankIcon, renameCompany, retagCompany, setCeoLimit, setDescription, setIcon, setPrivacy,
  startProject, toggleRequest, transferOwnership, uninviteUser, upgradeCompany, upgradeCost, vaultBonus, vaultDeposit, vaultWithdraw,
  type Company, type Privacy,
} from '../../eco/company.js';
import { getWallet, fmtDuration } from '../../eco/core.js';
import { AMOUNT_HELP, Colors, cv2Box, cv2Err, ecoCtx, parseAmount, short } from './ui.js';

const ICON_DIR = path.resolve(import.meta.dir, '../../../data/company_icons');
const iconPath = (id: number) => path.join(ICON_DIR, `${id}.png`);
const ts = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;
const NEED_COMPANY = 'You\'re not in a company. Join one with `/eco-company join` or make one with `/eco-company create`.';

const REASONS: Record<string, string> = {
  none: NEED_COMPANY, perm: 'You don\'t have permission to do that in your company.', member: 'You\'re already in a company.',
  taken: 'That tag or name is already taken.', tag: `Tags are ${COMPANY.tagMin}–${COMPANY.tagMax} letters/numbers.`,
  name: `Names are ${COMPANY.nameMin}–${COMPANY.nameMax} characters (letters, numbers, spaces and . - ' &).`, unknown: 'I couldn\'t find that company.',
  full: 'That company is full.', 'not-member': 'That user isn\'t in your company.', self: 'You can\'t do that to yourself.',
  rank: 'You can only act on members below your rank.', 'in-company': 'That user is already in a company.', invalid: 'That amount isn\'t valid.',
  ceo: 'The CEO can\'t leave — transfer ownership (`/eco-company transfer`) or disband (`/eco-company delete`).', 'no-request': 'There\'s no pending request from that user.',
  'no-invite': 'That user has no pending invite.', 'already-top': 'They\'re already an officer.', 'already-bottom': 'They\'re already a regular member.',
  'invite-only': 'That company is invite-only.', 'request-only': 'That company needs a join request — use `/eco-company requests send`.',
};
const say = (reason: string) => cv2Err(`❌ ${REASONS[reason] ?? `Something went wrong (${reason}).`}`);

async function myCompany(i: ChatInputCommandInteraction) {
  const ms = await getMembership(i.user.id);
  if (!ms) await i.reply(cv2Err(NEED_COMPANY));
  return ms;
}

async function amountOf(i: ChatInputCommandInteraction, max: number): Promise<number | null> {
  const a = parseAmount(i.options.getString('amount', true), max);
  if (!a) await i.reply(cv2Err('I couldn\'t read that amount.'));
  return a;
}
const amountOpt = (desc: string) => (s: import('discord.js').SlashCommandSubcommandBuilder) =>
  s.addStringOption(o => o.setName('amount').setDescription(`${desc} — ${AMOUNT_HELP}`).setRequired(true));

async function saveIcon(companyId: number, url: string): Promise<void> {
  const raw = await getBufferPublic(url, { maxBytes: 8 * 1024 * 1024 });
  const img = await safeLoadImage(raw, { maxSide: 1024 }); // user-supplied bytes: never hand these straight to the native decoder
  const c = createCanvas(128, 128);
  const ctx = c.getContext('2d');
  const s = Math.max(128 / img.width, 128 / img.height);
  ctx.drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
  mkdirSync(ICON_DIR, { recursive: true });
  writeFileSync(iconPath(companyId), c.toBuffer('image/png'));
}

async function companyCard(i: ChatInputCommandInteraction, co: Company) {
  const ctx = await ecoCtx(i);
  const members = await listMembers(co.id);
  const top = members.slice(0, 8).map(m => `${rankIcon(m.rank)} <@${m.user_id}>`).join('\n');
  const proj = await getProject(co.id);
  const text =
    `## [${co.tag}] ${co.name}\n${co.description ? `> ${co.description}\n` : ''}` +
    `**Level ${co.level}** · **${members.length}/${memberCap(co.level)}** members · ${co.privacy === 'open' ? '🔓 open' : co.privacy === 'request' ? '📨 by request' : '🔒 invite only'}\n` +
    `**Vault:** ${ctx.fmt(co.vault)}\n` +
    (proj ? `**Project:** ${PROJECTS[proj.kind]?.emoji} ${PROJECTS[proj.kind]?.name} — ${proj.status}${proj.status === 'funding' ? ` (${short(proj.raised)}/${short(proj.goal)})` : ''}\n` : '') +
    `Founded ${ts(co.created_at)}\n\n${top}${members.length > 8 ? `\n*…and ${members.length - 8} more*` : ''}`;
  const container = new ContainerBuilder().setAccentColor(Colors.Gold);
  const files: AttachmentBuilder[] = [];
  if (co.icon && existsSync(iconPath(co.id))) {
    files.push(new AttachmentBuilder(iconPath(co.id), { name: 'icon.png' }));
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)).setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://icon.png')));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  }
  return { flags: MessageFlags.IsComponentsV2 as const, files, components: [container], allowedMentions: { parse: [] as never[] } };
}

// ─── Direct subcommands ──────────────────────────────────────────────────────

export const companySubs: Sub[] = [
  {
    name: 'create', description: `Create a company (${COMPANY.createCost.toLocaleString()})`,
    options: s => s
      .addStringOption(o => o.setName('tag').setDescription(`${COMPANY.tagMin}–${COMPANY.tagMax} letters/numbers`).setRequired(true).setMinLength(COMPANY.tagMin).setMaxLength(COMPANY.tagMax))
      .addStringOption(o => o.setName('name').setDescription('Company name').setRequired(true).setMinLength(COMPANY.nameMin).setMaxLength(COMPANY.nameMax)),
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await createCompany(ctx.guildId, ctx.userId, i.options.getString('tag', true).toUpperCase(), i.options.getString('name', true).trim());
      if (!r.ok) { await i.reply(r.reason === 'funds' ? cv2Err(`❌ Founding a company costs **${ctx.fmt(COMPANY.createCost)}** (you have ${ctx.fmt(r.cash!)}).`) : say(r.reason)); return; }
      await i.reply(cv2Box(`🏢 **[${r.company.tag}] ${r.company.name} founded!**\nYou're the CEO. Set it up with \`/eco-company privacy\`, \`description\` and \`icon\`, then invite people or open the doors.\nCash: ${ctx.fmt(r.cash)}`, Colors.Gold));
    },
  },
  {
    name: 'info', description: 'View your company or another company',
    options: s => s.addStringOption(o => o.setName('name').setDescription('Company name or tag (default: yours)')),
    async run(i) {
      const q = i.options.getString('name');
      const co = q ? await findCompany(q) : (await getMembership(i.user.id))?.company ?? null;
      if (!co) { await i.reply(cv2Err(q ? '❌ I couldn\'t find that company.' : NEED_COMPANY)); return; }
      await i.reply(await companyCard(i, co));
    },
  },
  {
    name: 'members', description: 'List company members and ranks',
    async run(i) {
      const ms = await myCompany(i); if (!ms) return;
      const members = await listMembers(ms.company.id);
      await i.reply({ ...cv2Box(`👥 **[${ms.company.tag}] members** (${members.length}/${memberCap(ms.company.level)})\n${members.map(m => `${rankIcon(m.rank)} <@${m.user_id}> — ${m.rank} · joined ${ts(m.joined_at)}`).join('\n')}`, Colors.Blurple), allowedMentions: { parse: [] } });
    },
  },
  {
    name: 'userinfo', description: 'Show a company member\'s rank',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Member (default: you)')),
    async run(i) {
      const t = i.options.getUser('user') ?? i.user;
      const ms = await getMembership(t.id);
      if (!ms) { await i.reply(cv2Err(`${t.username} isn't in a company.`)); return; }
      const w = await getWallet((i.guildId ?? 'global'), t.id);
      await i.reply({ ...cv2Box(`${rankIcon(ms.member.rank)} <@${t.id}> is a **${ms.member.rank}** of **[${ms.company.tag}] ${ms.company.name}**\nJoined ${ts(ms.member.joined_at)} · net worth ${(await ecoCtx(i)).fmt(w.networth)}`, Colors.Blurple), allowedMentions: { parse: [] } });
    },
  },
  {
    name: 'join', description: 'Join a company',
    options: s => s.addStringOption(o => o.setName('name').setDescription('Company name or tag').setRequired(true)),
    async run(i) {
      const r = await joinCompany(i.user.id, i.options.getString('name', true));
      if (!r.ok) { await i.reply(say(r.reason)); return; }
      await i.reply(cv2Box(`🎉 You joined **[${r.company.tag}] ${r.company.name}**!`, Colors.Green));
    },
  },
  {
    name: 'leave', description: 'Leave your company',
    async run(i) {
      const r = await leaveCompany(i.user.id);
      await i.reply(r.ok ? cv2Box(`👋 You left **${r.company.name}**.`, Colors.Orange) : say(r.reason));
    },
  },
  {
    name: 'invite', description: 'Invite a user to your company',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Who to invite').setRequired(true)),
    async run(i) {
      const t = i.options.getUser('user', true);
      if (t.bot) { await i.reply(cv2Err('Bots can\'t join companies.')); return; }
      const r = await inviteUser(i.user.id, t.id);
      await i.reply(r.ok ? { ...cv2Box(`📨 Invited <@${t.id}> to **${r.company.name}**. They can join with \`/eco-company join name:${r.company.name}\`.`, Colors.Green), allowedMentions: { users: [t.id] } } : say(r.reason));
    },
  },
  {
    name: 'uninvite', description: 'Cancel a pending invite',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Whose invite').setRequired(true)),
    async run(i) {
      const r = await uninviteUser(i.user.id, i.options.getUser('user', true).id);
      await i.reply(r.ok ? cv2Box('✅ Invite cancelled.', Colors.Green) : say(r.reason));
    },
  },
  {
    name: 'kick', description: 'Kick a member from your company',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Who to kick').setRequired(true)),
    async run(i) {
      const t = i.options.getUser('user', true);
      const r = await kickMember(i.user.id, t.id);
      await i.reply(r.ok ? { ...cv2Box(`🥾 <@${t.id}> was kicked from **${r.company.name}**.`, Colors.Orange), allowedMentions: { parse: [] } } : say(r.reason));
    },
  },
  {
    name: 'uprank', description: 'Promote a member to officer',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Who to promote').setRequired(true)),
    async run(i) {
      const t = i.options.getUser('user', true);
      const r = await changeRank(i.user.id, t.id, 'up');
      await i.reply(r.ok ? { ...cv2Box(`⭐ <@${t.id}> is now an **officer**.`, Colors.Green), allowedMentions: { parse: [] } } : say(r.reason));
    },
  },
  {
    name: 'downrank', description: 'Demote an officer to member',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Who to demote').setRequired(true)),
    async run(i) {
      const t = i.options.getUser('user', true);
      const r = await changeRank(i.user.id, t.id, 'down');
      await i.reply(r.ok ? { ...cv2Box(`👤 <@${t.id}> is now a **member**.`, Colors.Orange), allowedMentions: { parse: [] } } : say(r.reason));
    },
  },
  {
    name: 'transfer', description: 'Transfer company ownership to another member',
    options: s => s.addUserOption(o => o.setName('user').setDescription('New CEO').setRequired(true)),
    async run(i) {
      const t = i.options.getUser('user', true);
      const ms = await getMembership(i.user.id);
      if (!ms || ms.member.rank !== 'ceo') { await i.reply(say(ms ? 'perm' : 'none')); return; }
      const ok = await askUser(i, { userId: i.user.id, acceptLabel: 'Yes, transfer', declineLabel: 'Cancel', content: `⚠️ Make <@${t.id}> the CEO of **${ms.company.name}**? You'll become an officer.` });
      if (!ok) { await i.editReply({ content: 'Cancelled.', components: [] }).catch(() => {}); return; }
      const r = await transferOwnership(i.user.id, t.id);
      await i.editReply({ content: r.ok ? `👑 <@${t.id}> is the new CEO of **${r.company.name}**.` : `❌ ${REASONS[r.reason] ?? r.reason}`, components: [], allowedMentions: { parse: [] } });
    },
  },
  {
    name: 'delete', description: 'Delete your company permanently (vault is split between members)',
    async run(i) {
      const ms = await getMembership(i.user.id);
      if (!ms || ms.member.rank !== 'ceo') { await i.reply(say(ms ? 'perm' : 'none')); return; }
      const ok = await askUser(i, { userId: i.user.id, acceptLabel: 'Delete it', declineLabel: 'Keep it', content: `⚠️ Permanently delete **[${ms.company.tag}] ${ms.company.name}**? Its vault is split evenly between all members. This can't be undone.` });
      if (!ok) { await i.editReply({ content: 'Cancelled — your company is safe.', components: [] }).catch(() => {}); return; }
      const r = await deleteCompany((i.guildId ?? 'global'), i.user.id);
      if (r.ok && existsSync(iconPath(r.company.id))) unlinkSync(iconPath(r.company.id));
      await i.editReply({ content: r.ok ? `🗑️ **${r.company.name}** was disbanded. Each of the ${r.members} members received **${r.each.toLocaleString()}** from the vault.` : `❌ ${REASONS[r.reason] ?? r.reason}`, components: [] });
    },
  },
  {
    name: 'description', description: 'Change your company\'s description',
    options: s => s.addStringOption(o => o.setName('description').setDescription('New description').setRequired(true).setMaxLength(COMPANY.descMax)),
    async run(i) {
      const r = await setDescription(i.user.id, i.options.getString('description', true));
      await i.reply(r.ok ? cv2Box('✅ Description updated.', Colors.Green) : say(r.reason));
    },
  },
  {
    name: 'name', description: 'Rename your company',
    options: s => s.addStringOption(o => o.setName('name').setDescription('New name').setRequired(true).setMinLength(COMPANY.nameMin).setMaxLength(COMPANY.nameMax)),
    async run(i) {
      const r = await renameCompany(i.user.id, i.options.getString('name', true).trim());
      await i.reply(r.ok ? cv2Box('✅ Company renamed.', Colors.Green) : say(r.reason));
    },
  },
  {
    name: 'tag', description: 'Change your company\'s tag',
    options: s => s.addStringOption(o => o.setName('tag').setDescription('New tag').setRequired(true).setMinLength(COMPANY.tagMin).setMaxLength(COMPANY.tagMax)),
    async run(i) {
      const r = await retagCompany(i.user.id, i.options.getString('tag', true).toUpperCase());
      await i.reply(r.ok ? cv2Box('✅ Tag changed.', Colors.Green) : say(r.reason));
    },
  },
  {
    name: 'privacy', description: 'Change who can join your company',
    options: s => s.addStringOption(o => o.setName('privacy').setDescription('Who can join').setRequired(true)
      .addChoices({ name: '🔓 Open — anyone can join', value: 'open' }, { name: '📨 Request — people ask to join', value: 'request' }, { name: '🔒 Invite only', value: 'invite' })),
    async run(i) {
      const p = i.options.getString('privacy', true) as Privacy;
      const r = await setPrivacy(i.user.id, p);
      await i.reply(r.ok ? cv2Box(`✅ Privacy set to **${p}**.`, Colors.Green) : say(r.reason));
    },
  },
  {
    name: 'icon', description: 'Set your company\'s icon',
    options: s => s.addAttachmentOption(o => o.setName('image').setDescription('PNG/JPG/WebP').setRequired(true)),
    async run(i) {
      const ms = await getMembership(i.user.id);
      if (!ms || ms.member.rank !== 'ceo') { await i.reply(say(ms ? 'perm' : 'none')); return; }
      const img = i.options.getAttachment('image', true);
      if (!img.contentType?.startsWith('image/') || img.size > 8 * 1024 * 1024) { await i.reply(cv2Err('Attach an image under 8 MB.')); return; }
      await i.deferReply();
      try { await saveIcon(ms.company.id, img.url); } catch { await i.editReply(cv2Err('I couldn\'t read that image.')); return; }
      await setIcon(i.user.id, true);
      await i.editReply(cv2Box('✅ Company icon updated.', Colors.Green));
    },
  },
  {
    name: 'reset-icon', description: 'Remove your company\'s icon',
    async run(i) {
      const r = await setIcon(i.user.id, false);
      if (!r.ok) { await i.reply(say(r.reason)); return; }
      if (existsSync(iconPath(r.company.id))) unlinkSync(iconPath(r.company.id));
      await i.reply(cv2Box('✅ Icon removed.', Colors.Green));
    },
  },
  {
    name: 'upgrade', description: 'Upgrade your company (paid from the vault)',
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await upgradeCompany(i.user.id);
      if (!r.ok) {
        await i.reply(r.reason === 'funds' ? cv2Err(`❌ The upgrade costs **${ctx.fmt(r.cost!)}** from the vault (it has ${ctx.fmt(r.vault!)}).`) : r.reason === 'max' ? cv2Err('Your company is max level.') : say(r.reason));
        return;
      }
      await i.reply(cv2Box(`⬆️ **Company upgraded to level ${r.level}** for ${ctx.fmt(r.cost)}.\nMember cap: **${r.cap}**. Next upgrade: ${ctx.fmt(upgradeCost(r.level))}`, Colors.Gold));
    },
  },
];

// ─── Groups ──────────────────────────────────────────────────────────────────

export const companyGroups: SubGroup[] = [
  {
    name: 'vault', description: 'Company vault',
    subs: [
      {
        name: 'deposit', description: 'Deposit cash into your company vault', options: amountOpt('How much to deposit'),
        async run(i) {
          const ctx = await ecoCtx(i);
          const cash = (await getWallet(ctx.guildId, ctx.userId)).cash;
          const a = await amountOf(i, cash); if (!a) return;
          const r = await vaultDeposit(ctx.guildId, ctx.userId, a);
          if (!r.ok) { await i.reply(r.reason === 'funds' ? cv2Err(`❌ You only have ${ctx.fmt(r.cash!)} in cash.`) : say(r.reason)); return; }
          await i.reply(cv2Box(`🏦 Deposited **${ctx.fmt(a)}**. Vault: **${ctx.fmt(r.vault)}**`, Colors.Green));
        },
      },
      {
        name: 'withdraw', description: 'Withdraw cash from your company vault (CEO only)', options: amountOpt('How much to withdraw'),
        async run(i) {
          const ctx = await ecoCtx(i);
          const ms = await myCompany(i); if (!ms) return;
          const a = await amountOf(i, ms.company.vault); if (!a) return;
          const r = await vaultWithdraw(ctx.guildId, ctx.userId, a);
          if (!r.ok) { await i.reply(r.reason === 'limit' ? cv2Err(`❌ That's over your daily vault limit (**${ctx.fmt(r.left!)}** left of ${ctx.fmt(r.limit!)} today).`) : r.reason === 'funds' ? cv2Err('❌ The vault doesn\'t have that much.') : say(r.reason)); return; }
          await i.reply(cv2Box(`🏦 Withdrew **${ctx.fmt(a)}**. Vault: **${ctx.fmt(r.vault)}** · Cash: ${ctx.fmt(r.cash)}`, Colors.Blue));
        },
      },
      {
        name: 'bonus', description: 'Send a vault bonus to a member (CEO only)',
        options: s => s.addUserOption(o => o.setName('user').setDescription('Who gets it').setRequired(true)).addStringOption(o => o.setName('amount').setDescription(`Amount — ${AMOUNT_HELP}`).setRequired(true)),
        async run(i) {
          const ctx = await ecoCtx(i);
          const ms = await myCompany(i); if (!ms) return;
          const t = i.options.getUser('user', true);
          const a = await amountOf(i, ms.company.vault); if (!a) return;
          const r = await vaultBonus(ctx.guildId, ctx.userId, t.id, a);
          if (!r.ok) { await i.reply(r.reason === 'limit' ? cv2Err(`❌ Over your daily vault limit (**${ctx.fmt(r.left!)}** left).`) : r.reason === 'funds' ? cv2Err('❌ The vault doesn\'t have that much.') : say(r.reason)); return; }
          await i.reply({ ...cv2Box(`🎁 Sent **${ctx.fmt(a)}** from the vault to <@${t.id}>. Vault: ${ctx.fmt(r.vault)}`, Colors.Green), allowedMentions: { users: [t.id] } });
        },
      },
      {
        name: 'limit', description: 'Set your own daily vault withdraw limit (CEO only)',
        options: s => s.addIntegerOption(o => o.setName('amount').setDescription('Max per day (0 = no limit)').setRequired(true).setMinValue(0)),
        async run(i) {
          const a = i.options.getInteger('amount', true);
          const r = await setCeoLimit(i.user.id, a === 0 ? null : a);
          await i.reply(r.ok ? cv2Box(a === 0 ? '✅ Daily vault limit removed.' : `✅ Daily vault limit set to **${a.toLocaleString()}**.`, Colors.Green) : say(r.reason));
        },
      },
      {
        name: 'logs', description: 'View the company vault logs',
        async run(i) {
          const ms = await myCompany(i); if (!ms) return;
          const ctx = await ecoCtx(i);
          const rows = await companyLogs(ms.company.id, 15);
          if (!rows.length) { await i.reply(cv2Err('No activity yet.')); return; }
          await i.reply({ ...cv2Box(`📜 **[${ms.company.tag}] activity**\n${rows.map(r => `<@${r.user_id}> \`${r.action}\`${r.amount ? ` ${ctx.fmt(r.amount)}` : ''} ${ts(r.ts)}`).join('\n')}`, Colors.Blurple), allowedMentions: { parse: [] } });
        },
      },
    ],
  },
  {
    name: 'requests', description: 'Join requests',
    subs: [
      {
        name: 'send', description: 'Send (or cancel) a join request',
        options: s => s.addStringOption(o => o.setName('name').setDescription('Company name or tag').setRequired(true)).addStringOption(o => o.setName('text').setDescription('Why you want to join').setMaxLength(200)),
        async run(i) {
          const r = await toggleRequest(i.user.id, i.options.getString('name', true), i.options.getString('text') ?? '');
          await i.reply(r.ok ? cv2Box(r.action === 'sent' ? `📨 Request sent to **${r.company.name}**.` : `↩️ Request to **${r.company.name}** cancelled.`, Colors.Green) : say(r.reason));
        },
      },
      {
        name: 'list', description: 'View pending join requests',
        async run(i) {
          const r = await listRequests(i.user.id);
          if (!r.ok) { await i.reply(say(r.reason)); return; }
          await i.reply({ ...cv2Box(r.requests.length ? `📨 **Pending requests**\n${r.requests.map(x => `<@${x.user_id}> ${ts(x.created_at)}${x.text ? ` — “${x.text}”` : ''}`).join('\n')}` : 'No pending requests.', Colors.Blurple), allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'accept', description: 'Accept a pending join request',
        options: s => s.addUserOption(o => o.setName('user').setDescription('Whose request').setRequired(true)),
        async run(i) {
          const t = i.options.getUser('user', true);
          const r = await decideRequest(i.user.id, t.id, true);
          await i.reply(r.ok ? { ...cv2Box(`✅ <@${t.id}> joined **${r.company.name}**.`, Colors.Green), allowedMentions: { users: [t.id] } } : say(r.reason));
        },
      },
      {
        name: 'deny', description: 'Deny a pending join request',
        options: s => s.addUserOption(o => o.setName('user').setDescription('Whose request').setRequired(true)),
        async run(i) {
          const r = await decideRequest(i.user.id, i.options.getUser('user', true).id, false);
          await i.reply(r.ok ? cv2Box('🚫 Request denied.', Colors.Orange) : say(r.reason));
        },
      },
    ],
  },
  {
    name: 'project', description: 'Company projects',
    subs: [
      {
        name: 'list', description: 'List all projects that exist',
        async run(i) {
          const ctx = await ecoCtx(i);
          await i.reply(cv2Box(`🏗️ **Projects**\nFund one together, wait for it to finish, then everyone collects a share.\n\n${Object.values(PROJECTS).map(p => `${p.emoji} **${p.name}** — goal ${ctx.fmt(p.goal)} · ${fmtDuration(p.durationMs)} · pays back ×${p.yield}`).join('\n')}`, Colors.Blurple));
        },
      },
      {
        name: 'start', description: 'Start a project for your company (CEO only)',
        options: s => s.addStringOption(o => o.setName('name').setDescription('Which project').setRequired(true).addChoices(...Object.entries(PROJECTS).map(([value, p]) => ({ name: `${p.emoji} ${p.name}`, value })))),
        async run(i) {
          const r = await startProject((i.guildId ?? 'global'), i.user.id, i.options.getString('name', true));
          if (!r.ok) { await i.reply(r.reason === 'active' ? cv2Err('❌ You already have a project running — finish or cancel it first.') : say(r.reason)); return; }
          await i.reply(cv2Box(`${r.def.emoji} **${r.def.name} started!** Everyone can chip in with \`/eco-company project contribute\` until ${(await ecoCtx(i)).fmt(r.def.goal)} is raised.`, Colors.Green));
        },
      },
      {
        name: 'contribute', description: 'Contribute to your company project', options: amountOpt('How much'),
        async run(i) {
          const ctx = await ecoCtx(i);
          const a = await amountOf(i, (await getWallet(ctx.guildId, ctx.userId)).cash); if (!a) return;
          const r = await contributeProject(ctx.guildId, ctx.userId, a);
          if (!r.ok) { await i.reply(r.reason === 'funds' ? cv2Err(`❌ You only have ${ctx.fmt(r.cash!)} in cash.`) : r.reason === 'no-funding' ? cv2Err('❌ There\'s no project taking contributions right now.') : say(r.reason)); return; }
          await i.reply(cv2Box(`🏗️ Contributed **${ctx.fmt(r.took)}** — **${ctx.fmt(r.raised)} / ${ctx.fmt(r.goal)}**${r.funded ? '\n🎉 **Fully funded!** Construction has begun.' : ''}`, Colors.Green));
        },
      },
      {
        name: 'status', description: 'View the status of your company project',
        async run(i) {
          const ms = await myCompany(i); if (!ms) return;
          const ctx = await ecoCtx(i);
          const p = await getProject(ms.company.id);
          if (!p) { await i.reply(cv2Err('Your company has no project. The CEO can start one.')); return; }
          const d = PROJECTS[p.kind]!;
          const state = p.status === 'funding' ? `Funding: **${ctx.fmt(p.raised)} / ${ctx.fmt(p.goal)}**`
            : p.status === 'active' ? ((p.ends_at ?? 0) > Date.now() ? `Under construction — done ${ts(p.ends_at!)}` : '✅ **Finished!** Run `/eco-company project complete`.')
            : `✅ Complete — pool **${ctx.fmt(p.pool)}**. Collect with \`/eco-company project collect\`.`;
          await i.reply(cv2Box(`${d.emoji} **${d.name}**\n${state}`, Colors.Blurple));
        },
      },
      {
        name: 'complete', description: 'Complete your company project',
        async run(i) {
          const r = await completeProject(i.user.id);
          if (!r.ok) { await i.reply(r.reason === 'pending' ? cv2Err(`Not finished yet — done ${ts(r.endsAt!)}.`) : r.reason === 'not-funded' ? cv2Err('It isn\'t fully funded yet.') : r.reason === 'already' ? cv2Err('It\'s already complete — collect your share!') : r.reason === 'no-project' ? cv2Err('Your company has no project.') : say(r.reason)); return; }
          await i.reply(cv2Box(`🎉 **${PROJECTS[r.kind]!.name} complete!** The pool is **${(await ecoCtx(i)).fmt(r.pool)}**. Contributors collect with \`/eco-company project collect\`.`, Colors.Gold));
        },
      },
      {
        name: 'collect', description: 'Collect your company project earnings',
        options: s => s.addIntegerOption(o => o.setName('amount').setDescription('Collect at most this much (default: everything)').setMinValue(1)),
        async run(i) {
          const ctx = await ecoCtx(i);
          const r = await collectProject(ctx.guildId, ctx.userId, i.options.getInteger('amount'));
          if (!r.ok) { await i.reply(cv2Err(r.reason === 'not-done' ? 'The project isn\'t complete yet.' : r.reason === 'no-share' ? 'You didn\'t contribute to this project.' : r.reason === 'nothing' ? 'You\'ve already collected your whole share.' : NEED_COMPANY)); return; }
          await i.reply(cv2Box(`💰 Collected **${ctx.fmt(r.took)}**${r.left ? ` (${ctx.fmt(r.left)} still to collect)` : ''}.\nCash: ${ctx.fmt(r.cash)}`, Colors.Green));
        },
      },
      {
        name: 'participants', description: 'View project contributors',
        async run(i) {
          const ms = await myCompany(i); if (!ms) return;
          const ctx = await ecoCtx(i);
          const rows = await projectContribs(ms.company.id);
          await i.reply({ ...cv2Box(rows.length ? `👷 **Contributors**\n${rows.map(r => `<@${r.user_id}> — ${ctx.fmt(r.amount)}`).join('\n')}` : 'Nobody has contributed yet.', Colors.Blurple), allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'cancel', description: 'Cancel your company project while it\'s still funding (CEO only)',
        async run(i) {
          const r = await cancelProject((i.guildId ?? 'global'), i.user.id);
          if (!r.ok) { await i.reply(r.reason === 'locked' ? cv2Err('❌ Once fully funded a project can\'t be cancelled.') : r.reason === 'no-project' ? cv2Err('You have no project.') : say(r.reason)); return; }
          await i.reply(cv2Box(`🛑 Project cancelled. Refunded **${r.refunded.toLocaleString()}** to ${r.contributors} contributor(s).`, Colors.Orange));
        },
      },
    ],
  },
  {
    name: 'leaderboard', description: 'Company leaderboards',
    subs: (['networth', 'vault'] as const).map(kind => ({
      name: kind,
      description: kind === 'networth' ? 'Company leaderboard by member net worth' : 'Company leaderboard by vault',
      async run(i: ChatInputCommandInteraction) {
        await i.deferReply();
        const ctx = await ecoCtx(i);
        const rows = await companyLeaderboard(kind, 10);
        if (!rows.length) { await i.editReply(cv2Box('No companies yet. Found one with `/eco-company create`.', Colors.Blurple)); return; }
        const medals = ['🥇', '🥈', '🥉'];
        await i.editReply(cv2Box(`🏆 **Company ${kind === 'networth' ? 'net worth' : 'vault'} leaderboard**\n\n${rows.map((r, n) => `${medals[n] ?? `**${n + 1}.**`} **[${r.tag}] ${r.name}** — ${ctx.sym} ${short(Number(r.value))}`).join('\n')}`, Colors.Gold));
      },
    })),
  },
];
