import type { Client } from 'discord.js';
import * as db from './db';
import logger from './logger';

type TaskHandler = (task: db.IScheduledTask, client: Client) => Promise<void>;

const handlers = new Map<string, TaskHandler>();
const scheduled = new Set<number>();
let client: Client;

export function initScheduler(bot: Client) {
  client = bot;
  pollTasks();
  setInterval(pollTasks, 60_000);
}

export function registerTaskHandler(type: string, handler: TaskHandler) {
  handlers.set(type, handler);
}

async function pollTasks() {
  const horizon = Date.now() + 70_000;
  try {
    const tasks = await db.getPendingScheduledTasks(horizon);
    for (const task of tasks) {
      if (scheduled.has(task.id)) continue;
      scheduled.add(task.id);
      const delay = Math.max(0, task.fires_at - Date.now());
      setTimeout(() => runTask(task), delay);
    }
  } catch (err) {
    logger.error(`Scheduler poll error: ${err}`);
  }
}

async function runTask(task: db.IScheduledTask) {
  scheduled.delete(task.id);
  try {
    await db.markScheduledTaskFired(task.id);
    const handler = handlers.get(task.type);
    if (handler) await handler(task, client);
  } catch (err) {
    logger.error(`Scheduled task ${task.id} (${task.type}) failed: ${err}`);
  }
}
