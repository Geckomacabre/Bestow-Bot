import { hgroup } from '../../framework/heist.js';
import { heistRobloxSubs, robloxHistorySubs, robloxRenderSubs } from '../../subcommands/lookups/roblox-extra.js';

export default hgroup({
  name: 'roblox',
  subs: heistRobloxSubs,
  groups: [
    { name: 'render', description: 'Render Roblox avatars and items as 3D models', subs: robloxRenderSubs },
    { name: 'history', description: 'Roblox history lookups', subs: robloxHistorySubs },
  ],
});
