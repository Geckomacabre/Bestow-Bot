import { hgroup } from '../../framework/heist.js';
import { funGroups } from '../../subcommands/fun/fun.js';

export default hgroup({ name: 'juul', subs: funGroups[0]!.subs });
