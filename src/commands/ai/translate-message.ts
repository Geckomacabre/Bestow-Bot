import { messageMenu } from '../../framework/menu.js';
import { translateMenu } from '../../ai/menus.js';

/** Right-click a message → Apps → Translate Message (into your Discord language). */
export default messageMenu('Translate Message', translateMenu);
