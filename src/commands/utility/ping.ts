import { hleaf } from '../../framework/heist.js';
import { cv2Text } from '../../utils/components.js';

export default hleaf('ping', async i => {
  const started = Date.now();
  await i.deferReply();
  const roundTrip = Date.now() - started;
  await i.editReply(cv2Text(`🏓 **Pong!**\n**Gateway:** ${Math.max(0, Math.round(i.client.ws.ping))} ms · **Round trip:** ${roundTrip} ms`, 0x5865f2));
});
