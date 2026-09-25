import { Client } from 'discord.js';
import * as db from '../utils/db';
import countingModule from './counting';
import serverStatsModule from './serverstats';
import streamingModule from './streaming';
import customCommandsModule from './customcommands';
import { startFeedsPollers } from './feeds';
import { startFreeGamesPoller } from './freegames';
import xpModule from './xp';
import reactionRolesModule from './reactionroles';
import { startBirthdayChecker } from './birthday';
import { startStatChannelUpdater } from './statchannels';
import { startTopicPoller } from './topics';
import starboardModule from './starboard';
import timezoneModule from './timezone';
import mediaguessModule, { startMediaGames } from './mediaguess';
import { startLottery } from './lottery';
import stickyModule, { startStickyRefresh } from './sticky';
import aiModule from './ai';
import premiumModule from './premium';
import pingOnJoinModule from './pingonjoin';
import { startPremiumSync } from '../premium/sync.js';
import { startGiveawayScheduler } from '../giveaway/service.js';
import { startCryptoTrackers } from '../crypto/tracker.js';

const features = [
  countingModule,
  serverStatsModule,
  streamingModule,
  customCommandsModule,
  xpModule,
  reactionRolesModule,
  starboardModule,
  timezoneModule,
  mediaguessModule,
  stickyModule,
  aiModule,
  premiumModule,
  pingOnJoinModule,
];

export function registerFeatures(bot: Client) {
  for (const feature of features) {
    for (const [event, handler] of Object.entries(feature.handlers)) {
      bot.on(event as any, async (...args) => {
        try {
          await (handler as any)({ data: args, bot, db });
        } catch (err) {
          console.error(`Error in feature ${feature.name} handling event ${event}: ${err}`);
        }
      });
    }
  }

  bot.once('clientReady', () => {
    startFeedsPollers(bot);
    startFreeGamesPoller(bot);
    startBirthdayChecker(bot);
    startStatChannelUpdater(bot);
    startTopicPoller(bot);
    startMediaGames(bot);
    startLottery(bot);
    startStickyRefresh(bot);
    startCryptoTrackers(bot);
    startPremiumSync(bot);
    startGiveawayScheduler(bot);
  });
}
