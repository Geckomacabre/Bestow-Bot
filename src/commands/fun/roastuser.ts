import { userMenu } from '../../framework/menu.js';
import { card } from '../../lookups/card.js';
import { pick } from '../../lookups/textfun.js';
import * as social from '../../fun/social.js';

/** Right-click a person → Apps → Roast User. */
export default userMenu('Roast User', async i => {
  await i.reply(card({ title: '🔥 Roasted', color: 0xed4245, description: social.fill(pick(social.ROASTS), `<@${i.targetUser.id}>`), footer: 'All in good fun.' }));
});
