/**
 * Per-rule cron scheduler для авто-рассылки.
 *
 * Архитектура:
 * - Каждое правило AutoBroadcastRule имеет своё cron_expression (или null → дефолт по триггеру).
 * - При старте сервера / после edit правила — пересоздаём cron-задачи: одна задача = одно правило.
 * - Минутный cron используется только для triggers с узким окном (`subscription_ending_minutes`).
 * - Ежечасный — для `subscription_expired` (окно 7 дней, час задержки не критичен).
 * - Ежедневный — для one-time триггеров и `subscription_ending_soon`.
 *
 * Загрузка БД минимизирована: каждое правило знает когда срабатывать → нет одной большой пачки.
 */

import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "../../db.js";
import { runRule } from "./auto-broadcast.service.js";

/** Дефолтное расписание по типу триггера, если у правила cronExpression=null. */
const DEFAULT_CRON_BY_TRIGGER: Record<string, string> = {
  subscription_ending_minutes: "* * * * *",   // каждую минуту — узкое окно ±1 мин
  subscription_expired:        "0 * * * *",   // каждый час — окно 7 дней, час OK
  subscription_ending_soon:    "0 9 * * *",   // ежедневно в 9 утра
  // after_registration НЕ запускается по
  // крону — отправляется event-driven при /start в боте через
  // fireRegistrationRulesForClient(). См. EVENT_DRIVEN_TRIGGERS ниже.
  no_payment:                  "0 9 * * *",
  trial_not_connected:         "0 9 * * *",
  trial_used_never_paid:       "0 9 * * *",
  no_traffic:                  "0 9 * * *",
  inactivity:                  "0 9 * * *",
};

/**
 * per-rule флаг `event_driven` на самом
 * правиле определяет, скиппает ли scheduler создание крон-задачи. Это позволяет
 * для одного и того же триггера (например after_registration) иметь несколько
 * правил с разной логикой: одно мгновенное при /start (event_driven=true),
 * другое по крону через N дней (event_driven=false). Старая константа удалена.
 */
const FALLBACK_CRON = "0 9 * * *";

/** Активные cron-задачи: ruleId → ScheduledTask. */
const ruleTasks = new Map<string, ScheduledTask>();

/** Резолв расписания: явное cronExpression правила → дефолт по триггеру → fallback 9:00. */
export function resolveCronForRule(rule: { cronExpression: string | null; triggerType: string }): string {
  const explicit = rule.cronExpression?.trim();
  if (explicit && cron.validate(explicit)) return explicit;
  if (explicit) {
    console.warn(`[auto-broadcast] Invalid cronExpression "${explicit}" for trigger ${rule.triggerType}, using default`);
  }
  return DEFAULT_CRON_BY_TRIGGER[rule.triggerType] ?? FALLBACK_CRON;
}

/** Запустить cron-задачу для одного правила. */
function scheduleRule(rule: { id: string; name: string; enabled: boolean; cronExpression: string | null; triggerType: string; eventDriven: boolean }): void {
  // Если для правила уже была задача — остановить.
  const existing = ruleTasks.get(rule.id);
  if (existing) {
    existing.stop();
    ruleTasks.delete(rule.id);
  }
  if (!rule.enabled) return;
  // per-rule флаг — если правило event-driven,
  // крон-задачу не создаём (оно вызывается по событию из бота/бэка).
  if (rule.eventDriven) {
    console.log(`[auto-broadcast] Skipping cron for "${rule.name}" — event-driven (triggers: ${rule.triggerType})`);
    return;
  }

  const schedule = resolveCronForRule(rule);
  const task = cron.schedule(schedule, async () => {
    console.log(`[auto-broadcast] Running rule "${rule.name}" (${rule.triggerType}, ${schedule})`);
    try {
      const result = await runRule(rule.id);
      await prisma.autoBroadcastRule.update({
        where: { id: rule.id },
        data: { lastRunAt: new Date() },
      }).catch(() => {});
      if (result.errors.length > 0) {
        console.warn(`[auto-broadcast] Rule "${rule.name}": sent=${result.sent}, errors=${result.errors.length}: ${result.errors.slice(0, 3).join("; ")}`);
      } else if (result.sent > 0) {
        console.log(`[auto-broadcast] Rule "${rule.name}": sent=${result.sent}`);
      }
    } catch (e) {
      console.error(`[auto-broadcast] Rule "${rule.name}" failed:`, e);
    }
  });
  ruleTasks.set(rule.id, task);
  console.log(`[auto-broadcast] Scheduled "${rule.name}" with "${schedule}" (${rule.triggerType})`);
}

/** Загрузить ВСЕ правила из БД и запустить cron-задачи для каждого. */
export async function startAutoBroadcastScheduler(): Promise<void> {
  // Останавливаем все предыдущие задачи (на случай повторного вызова).
  for (const [, task] of ruleTasks) task.stop();
  ruleTasks.clear();

  const rules = await prisma.autoBroadcastRule.findMany({
    select: { id: true, name: true, enabled: true, cronExpression: true, triggerType: true, eventDriven: true },
  });
  for (const r of rules) scheduleRule(r);
  console.log(`[auto-broadcast] Scheduler started: ${ruleTasks.size} active rule(s) (${rules.length} total)`);
}

/** Пересоздать cron-задачу для одного правила (вызывается после create/update в админке). */
export async function rescheduleRule(ruleId: string): Promise<void> {
  const rule = await prisma.autoBroadcastRule.findUnique({
    where: { id: ruleId },
    select: { id: true, name: true, enabled: true, cronExpression: true, triggerType: true, eventDriven: true },
  });
  if (!rule) {
    // Правило удалили — снимаем задачу.
    const task = ruleTasks.get(ruleId);
    if (task) {
      task.stop();
      ruleTasks.delete(ruleId);
      console.log(`[auto-broadcast] Removed task for deleted rule ${ruleId}`);
    }
    return;
  }
  scheduleRule(rule);
}

/** Backwards compat — старый код может вызывать рестарт scheduler'а. */
export async function restartAutoBroadcastScheduler(): Promise<void> {
  await startAutoBroadcastScheduler();
}

/** Остановить все задачи (при graceful shutdown). */
export function stopAutoBroadcastScheduler(): void {
  for (const [, task] of ruleTasks) task.stop();
  ruleTasks.clear();
}
