import type { Client } from 'discord.js';
import { pollNews } from '../features/feeds';
import { runMonthlyTicketChecks, runMonthlyGuessingReset } from '../utils/monthlyChecks';

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
      name: 'Monthly ticket check',
      frequency: '0 9 1 * *', // 1st of the month, 09:00 UTC
      run: (bot) => runMonthlyTicketChecks(bot),
    },
    {
      name: 'Monthly guessing game reset',
      frequency: '5 9 1 * *', // just after the ticket check, same day
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
