import { userMenu } from '../../framework/menu.js';
import { card } from '../../lookups/card.js';
import { pick } from '../../lookups/textfun.js';
import * as social from '../../fun/social.js';

/** Right-click a person → Apps → Rizz User. */
export default userMenu('Rizz User', async i => {
  await i.reply(card({ title: `😏 Rizz for ${i.targetUser.displayName}`, color: 0xeb459e, description: `<@${i.targetUser.id}> ${pick(social.RIZZ)}` }));
});
