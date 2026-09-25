import { hleaf } from '../../framework/heist.js';
import { showServerAvatar } from '../../subcommands/info/profile.js';

export default hleaf('serveravatar', showServerAvatar);
