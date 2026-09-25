import { hleaf } from '../../framework/heist.js';
import { card, when } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { isOwner, premiumStatus } from '../../premium/index.js';
import { donationTotal, userById, userByUid, userCount } from '../../profile/store.js';
import { getAccent, toHex } from '../../customize/accent.js';

/** /me — your Bestow profile: UID (#1 = the first person who ever used the bot), since when, commands run, Premium and badges. */
export default hleaf('me', lookup(async i => {
  const uidIn = i.options.getString('uid');
  let row;
  let target = i.options.getUser('user') ?? i.user;
  if (uidIn) {
    const n = Number(uidIn.trim().replace(/^#/, ''));
    if (!Number.isInteger(n) || n < 1) throw new LookupError('A Bestow UID is a number, like `42`.');
    row = await userByUid(n);
    if (!row) throw new LookupError(`No one has Bestow UID **#${n}** yet.`);
    target = await i.client.users.fetch(row.user_id).catch(() => target);
  } else {
    row = await userById(target.id);
  }
  if (!row) throw new LookupError(target.id === i.user.id ? 'You don\'t have a Bestow profile yet.' : `**${target.displayName ?? target.username}** hasn't used Bestow yet.`);
  const [prem, donated, accent, total] = await Promise.all([premiumStatus(row.user_id, { client: i.client }), donationTotal(row.user_id), getAccent(row.user_id), userCount()]);
  const badges = [isOwner(row.user_id) ? '👑 Owner' : null, prem.premium ? '✨ Premium' : null, donated > 0 ? '💝 Donator' : null, row.uid <= 100 ? '🌱 Early user' : null].filter(Boolean);
  await i.editReply(card({
    title: `${target.globalName ?? target.username}`, color: accent ?? 0x5865f2, thumbnail: target.displayAvatarURL({ size: 256 }),
    fields: [['Bestow UID', `#${row.uid.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`], ['Discord', `<@${row.user_id}> · \`${row.user_id}\``], ['Using Bestow since', `${when(row.first_seen)} (${when(row.first_seen, 'R')})`],
      ['Commands run', row.commands.toLocaleString('en-US')], ['Premium', prem.premium ? (prem.expiresAt ? `until ${when(prem.expiresAt, 'R')}` : 'active') : 'No'],
      ['Donated', donated > 0 ? `$${donated.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : null], ['Embed color', accent != null ? toHex(accent) : null], badges.length ? ['Badges', badges.join(' · ')] : null],
  }));
}), { tweaks: { uid: { maxLength: 12 } } });
