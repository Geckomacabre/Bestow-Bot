import { userMenu } from '../../framework/menu.js';
import { profileCard } from '../../subcommands/info/profile.js';

/** Right-click a person → Apps → View Profile. */
export default userMenu('View Profile', async i => {
  await i.deferReply();
  const member = i.inGuild() && i.guild ? await i.guild.members.fetch(i.targetUser.id).catch(() => null) : null;
  await i.editReply(await profileCard(i.client, i.targetUser, member));
});
