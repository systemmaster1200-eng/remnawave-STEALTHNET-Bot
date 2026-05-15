/**
 * Планировщик напоминаний об активном конкурсе.
 *
 * До issue #35: один раз в день в 10:00 для всех конкурсов.
 * После: гоняем каждый час, в `runContestDailyReminder` решается per-contest:
 *   - reminderEnabled=false → пропуск
 *   - reminderIntervalHours>0 + прошло N часов с lastDailyReminderAt → шлём
 *   - reminderDeadlineHoursBefore содержит N → шлём за N часов до endAt (один раз)
 *
 * Дефолт CRON 0 * * * * (каждый час). Переопределяется CONTEST_REMINDER_CRON.
 */

import cron, { type ScheduledTask } from "node-cron";
import { runContestDailyReminder } from "./contest-daily-reminder.service.js";

const DEFAULT_CRON = "0 * * * *"; // каждый час в :00

let currentTask: ScheduledTask | null = null;

export function startContestDailyReminderScheduler(cronExpression?: string): ScheduledTask | null {
  const expr = (cronExpression ?? process.env.CONTEST_REMINDER_CRON ?? DEFAULT_CRON).trim();
  const schedule = expr && cron.validate(expr) ? expr : DEFAULT_CRON;
  if (!expr || !cron.validate(expr)) {
    console.warn(`[contest-daily-reminder] Invalid cron "${expr}", using ${DEFAULT_CRON}`);
  }

  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }

  currentTask = cron.schedule(schedule, async () => {
    try {
      await runContestDailyReminder();
    } catch (e) {
      console.error("[contest-daily-reminder] Scheduled run failed:", e);
    }
  });

  console.log(`[contest-daily-reminder] Scheduler started: ${schedule}`);
  return currentTask;
}

export function stopContestDailyReminderScheduler(): void {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
}
