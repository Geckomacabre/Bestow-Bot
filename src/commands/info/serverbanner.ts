import { hleaf } from '../../framework/heist.js';
import { showServerBanner } from '../../subcommands/info/profile.js';

export default hleaf('serverbanner', showServerBanner);
