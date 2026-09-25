import { defineLeaf } from '../../framework/group.js';
import { premiumSubs } from '../../subcommands/premium/premium.js';

const perks = premiumSubs.find(s => s.name === 'perks')!;
export default defineLeaf({ ...perks, name: 'plus', description: 'Learn about Bestow Premium (unlimited AI) and get it' });
