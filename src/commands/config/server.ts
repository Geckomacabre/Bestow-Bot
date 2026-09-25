import { defineGroup, foldCommand, fromCommand, groupFromCommand } from '../../framework/group.js';
import serverinfo from '../../legacy/utility/serverinfo.js';
import userinfo from '../../legacy/utility/userinfo.js';
import listroles from '../../legacy/utility/listroles.js';
import viewperms from '../../legacy/utility/viewperms.js';
import status from '../../legacy/utility/status.js';
import sticky from '../../legacy/utility/sticky.js';
import levelconfig from '../../legacy/levels/levelconfig.js';
import repconfig from '../../legacy/reputation/repconfig.js';
import birthdayconfig from '../../legacy/birthday/birthdayconfig.js';
import rolesconfig from '../../legacy/roles/rolesconfig.js';
import economyconfig from '../../legacy/economy/economyconfig.js';
import mediaguess from '../../legacy/mediaguess/mediaguess.js';

/**
 * Server info and administration. Everything in here needs the bot to be added to the server (a "guild install"): it reads
 * or changes server settings. Each subcommand carries the permission its original command required (Manage Server etc.).
 */
export default defineGroup({
  name: 'server',
  description: 'Server info and settings (needs the bot added to the server)',
  scope: 'anywhere',
  subs: [fromCommand(serverinfo), fromCommand(userinfo), fromCommand(listroles), fromCommand(viewperms)],
  groups: [
    groupFromCommand(status, 'status'),
    groupFromCommand(sticky, 'sticky'),
    foldCommand(levelconfig, { name: 'levels', description: 'Level and XP settings, level roles' }),
    groupFromCommand(repconfig, 'reputation'),
    groupFromCommand(birthdayconfig, 'birthdays'),
    foldCommand(rolesconfig, { name: 'roles', description: 'Self-assign and reaction roles' }),
    groupFromCommand(economyconfig, 'economy'),
    groupFromCommand(mediaguess, 'guess'),
  ],
});
