import { LinkedRoleRule } from '../constants';

export function shouldHaveRole(rule: LinkedRoleRule, roleIds: Set<string>): boolean {
  const matchedCount = rule.children.filter((id) => roleIds.has(id)).length;

  switch (rule.mode) {
    case 'ALL':
      return rule.children.every((id) => roleIds.has(id));
    case 'MIN_COUNT':
      return matchedCount >= (rule.minCount ?? 1);
    case 'ANY':
    default:
      return matchedCount > 0;
  }
}
