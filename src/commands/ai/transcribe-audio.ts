import { messageMenu } from '../../framework/menu.js';
import { transcribeMenu } from '../../ai/menus.js';

/** Right-click a voice message → Apps → Transcribe Audio. */
export default messageMenu('Transcribe Audio', transcribeMenu);
