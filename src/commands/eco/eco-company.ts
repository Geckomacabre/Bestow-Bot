import { defineGroup } from '../../framework/group.js';
import { companyGroups, companySubs } from '../../subcommands/eco/company.js';
import { conform, DRIFTING } from '../../subcommands/eco/heist.js';

export default defineGroup({
  name: 'eco-company',
  description: 'Companies: shared vaults, projects and leaderboards',
  scope: 'anywhere',
  ...conform('eco-company', DRIFTING, { subs: companySubs, groups: companyGroups }),
});
