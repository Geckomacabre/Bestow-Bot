import { defineGroup } from '../../framework/group.js';
import { companyGroups, companySubs } from '../../subcommands/eco/company.js';

export default defineGroup({
  name: 'eco-company',
  description: 'Companies: shared vaults, projects and leaderboards',
  scope: 'guild',
  subs: companySubs,
  groups: companyGroups,
});
