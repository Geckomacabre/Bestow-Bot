import { userMenu } from '../../framework/menu.js';
import { petpetFor } from '../../subcommands/fun/heist.js';
import { cv2Err, cv2File } from '../../utils/components.js';

/** Right-click a person → Apps → Pet User. */
export default userMenu('Pet User', async i => {
  await i.deferReply();
  try {
    const gif = await petpetFor(i.targetUser);
    await i.editReply({ ...cv2File(gif, 'gif', `<@${i.user.id}> pets <@${i.targetUser.id}>`), allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[pet user]', (err as Error).message);
    await i.editReply({ ...cv2Err('❌ I couldn\'t make that GIF right now.'), files: [] }).catch(() => {});
  }
});
