import { hleaf } from '../../framework/heist.js';
import { showBanner } from '../../subcommands/info/profile.js';

export default hleaf('banner', showBanner);
