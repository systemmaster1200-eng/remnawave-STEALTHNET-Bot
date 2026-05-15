/**
 * Запуск авто-рассылки по расписанию (cron).
 * По умолчанию — раз в день в 9:00 (по времени сервера).
 * Расписание можно менять в админке (настройки → авто-рассылка или системные настройки).
 */

import cron, { type ScheduledTask } from "node-cron";
import { getSystemConfig } from "../client/client.service.js";
import { runAllRules } from "./auto-broadcast.service.js";
import { env } from "../../config/env.js";

const DEFAULT_CRON = "0 9 * * *"; // 9:00 каждый день (minute hour day month weekday)

let currentTask: ScheduledTask | null = null;

function startWithExpression(cronExpression: string): ScheduledTask | null {
  const expr = cronExpression.trim();
  if (!expr) return null;

  const valid = cron.validate(expr);
  const schedule = valid ? expr : DEFAULT_CRON;
  if (!valid) {
    console.warn(`[auto-broadcast] Invalid cron "${expr}", using ${DEFAULT_CRON}`);
  }

  const task = cron.schedule(schedule, async () => {
    console.log(`[auto-broadcast] Cron triggered (${schedule}), starting rules...`);
    try {
      const results = await runAllRules();
      const total = results.reduce((s, r) => s + r.sent, 0);
      const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

      if (results.length === 0) {
        console.log("[auto-broadcast] No enabled rules found.");
      } else {
        console.log(
          `[auto-broadcast] Cron run complete: ${results.length} rule(s), ${total} sent, ${totalErrors} error(s)`,
        );
        // Логируем результат каждого правила при наличии ошибок
        for (const r of results) {
          if (r.errors.length > 0) {
            console.warn(`[auto-broadcast]   Rule "${r.ruleName}": ${r.sent} sent, errors: ${r.errors.join("; ")}`);
          }
        }
      }
    } catch (e) {
      console.error("[auto-broadcast] Scheduled run failed:", e);
    }
  });

  console.log(`[auto-broadcast] Scheduler started: ${schedule}`);
  return task;
}

/** Запустить планировщик. Если выражение не передано — берётся из настроек (БД) или env, иначе по умолчанию 9:00. */
export async function startAutoBroadcastScheduler(cronExpression?: string): Promise<ScheduledTask | null> {
  let expr = cronExpression?.trim();
  if (!expr) {
    const config = await getSystemConfig();
    expr = config.autoBroadcastCron ?? env.AUTO_BROADCAST_CRON ?? DEFAULT_CRON;
  }
  currentTask = startWithExpression(expr);
  return currentTask;
}

/** Перезапустить планировщик с актуальным расписанием из настроек (после сохранения в админке). */
export async function restartAutoBroadcastScheduler(): Promise<void> {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  await startAutoBroadcastScheduler();
}

/** Остановить планировщик (при завершении процесса). */
export function stopAutoBroadcastScheduler(): void {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
}
