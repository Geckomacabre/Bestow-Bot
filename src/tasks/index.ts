import type { Client } from 'discord.js';
import { pollNews } from '../features/feeds';
import { runMonthlyGuessingReset } from '../utils/monthlyChecks';

export type CronTask = {
  name: string;
  frequency: Bun.CronWithAutocomplete | 'once';
  run: (bot: Client) => Promise<void>;
};

export function initCronJobs(bot: Client) {
  const tasks: CronTask[] = [
    {
      name: 'Hourly news feed',
      frequency: '0 * * * *',
      run: (bot) => pollNews(bot),
    },
    {
      name: 'Monthly guessing game reset',
      frequency: '5 9 1 * *', // 1st of the month, 09:05 UTC
      run: (bot) => runMonthlyGuessingReset(bot),
    },
  ];

  for (const task of tasks) {
    const runSafe = async () => {
      try {
        await task.run(bot);
      } catch (error) {
        console.error(`Cron task failed: ${task.name}`, error);
      }
    };

    if (task.frequency === 'once') {
      runSafe();
      continue;
    }

    Bun.cron(task.frequency, runSafe);
  }
}
