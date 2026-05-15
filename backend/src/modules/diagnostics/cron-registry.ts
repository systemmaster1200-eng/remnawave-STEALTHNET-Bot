/**
 * Реестр всех cron-задач API. Каждый scheduler при старте регистрирует себя
 * через `registerCron()`, при тике вызывает `recordCronRun()` чтобы запомнить
 * время и результат последнего запуска.
 *
 * Это in-memory реестр (живёт пока живёт API-процесс). При рестарте API
 * `nextRunAt` пересчитывается заново; история last-run теряется (это OK для
 * диагностики «сейчас» — для исторической нужен audit log).
 */

import cronParser from "node-cron";

export interface CronRunRecord {
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface CronEntry {
  /** Уникальное имя: `auto-broadcast`, `contest-daily-reminder`, `auto-renew`, `gift-expiry`, `abandoned-accounts`, `auto-backup`, `marketplace`. */
  name: string;
  /** Cron-выражение. */
  cron: string;
  /** Описание для UI. */
  description?: string;
  /** Trigger — функция которую дёргаем при «Run now». */
  trigger?: () => Promise<unknown>;
  /** История последних запусков (max 20). */
  recent: CronRunRecord[];
  /** В данный момент идёт. */
  running: boolean;
  registeredAt: Date;
}

const registry = new Map<string, CronEntry>();
const HISTORY_LIMIT = 20;

export function registerCron(opts: {
  name: string;
  cron: string;
  description?: string;
  trigger?: () => Promise<unknown>;
}): void {
  const existing = registry.get(opts.name);
  if (existing) {
    // Перерегистрация (например, при hot-reload schedule) — обновляем поля, history оставляем.
    existing.cron = opts.cron;
    existing.description = opts.description ?? existing.description;
    existing.trigger = opts.trigger ?? existing.trigger;
    return;
  }
  registry.set(opts.name, {
    name: opts.name,
    cron: opts.cron,
    description: opts.description,
    trigger: opts.trigger,
    recent: [],
    running: false,
    registeredAt: new Date(),
  });
}

export function unregisterCron(name: string): void {
  registry.delete(name);
}

export function recordCronRun(name: string, run: { ok: boolean; error?: string; startedAt: Date; finishedAt: Date }): void {
  const entry = registry.get(name);
  if (!entry) return;
  const record: CronRunRecord = {
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    ok: run.ok,
    error: run.error,
    durationMs: run.finishedAt.getTime() - run.startedAt.getTime(),
  };
  entry.recent.unshift(record);
  if (entry.recent.length > HISTORY_LIMIT) entry.recent.length = HISTORY_LIMIT;
  entry.running = false;
}

export function markCronStart(name: string): void {
  const entry = registry.get(name);
  if (entry) entry.running = true;
}

/**
 * Обёртка: оборачивает функцию scheduler'а в логику registerCron + recordCronRun.
 * Использование:
 *   cron.schedule("0 * * * *", wrapCronTick("contest-daily-reminder", () => runContestDailyReminder()));
 */
export function wrapCronTick(name: string, fn: () => Promise<unknown>): () => Promise<void> {
  return async () => {
    const startedAt = new Date();
    markCronStart(name);
    try {
      await fn();
      recordCronRun(name, { ok: true, startedAt, finishedAt: new Date() });
    } catch (e) {
      recordCronRun(name, { ok: false, error: String(e), startedAt, finishedAt: new Date() });
      throw e;
    }
  };
}

export function listCronEntries() {
  return Array.from(registry.values()).map((e) => ({
    name: e.name,
    cron: e.cron,
    description: e.description ?? null,
    running: e.running,
    registeredAt: e.registeredAt.toISOString(),
    nextRunAt: computeNextRun(e.cron),
    recent: e.recent.slice(0, 10).map((r) => ({
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      ok: r.ok,
      error: r.error,
      durationMs: r.durationMs,
    })),
    canTrigger: !!e.trigger,
  }));
}

export async function triggerCron(name: string): Promise<{ ok: boolean; error?: string }> {
  const entry = registry.get(name);
  if (!entry) return { ok: false, error: `Cron "${name}" не зарегистрирован` };
  if (!entry.trigger) return { ok: false, error: `Cron "${name}" не поддерживает manual trigger` };
  if (entry.running) return { ok: false, error: `Cron "${name}" сейчас уже выполняется` };

  const startedAt = new Date();
  markCronStart(name);
  try {
    await entry.trigger();
    recordCronRun(name, { ok: true, startedAt, finishedAt: new Date() });
    return { ok: true };
  } catch (e) {
    const err = String(e);
    recordCronRun(name, { ok: false, error: err, startedAt, finishedAt: new Date() });
    return { ok: false, error: err };
  }
}

/**
 * Простой расчёт следующего запуска по cron-выражению — приближённый, считает
 * каждую минуту в течение 7 дней вперёд и берёт первое совпадение.
 *
 * На node-cron нет публичного API для next-run; используем validate чтобы хотя
 * бы убедиться что выражение корректное.
 */
function computeNextRun(cron: string): string | null {
  if (!cronParser.validate(cron)) return null;
  // Очень простой парсер: разбираем 5-полевое выражение и сканируем минутно.
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;

  function matches(field: string, value: number, max: number): boolean {
    if (field === "*") return true;
    // step: */N
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10);
      return Number.isFinite(step) && step > 0 && value % step === 0;
    }
    // list: 1,3,5
    if (field.includes(",")) {
      return field.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n)).includes(value);
    }
    // range: 1-5
    if (field.includes("-")) {
      const [a, b] = field.split("-").map((s) => parseInt(s.trim(), 10));
      return Number.isFinite(a) && Number.isFinite(b) && value >= a && value <= b;
    }
    const exact = parseInt(field, 10);
    if (Number.isFinite(exact)) return value === exact;
    void max;
    return false;
  }

  const now = new Date();
  const candidate = new Date(now.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 7; i++) {
    if (
      matches(m, candidate.getMinutes(), 60) &&
      matches(h, candidate.getHours(), 24) &&
      matches(dom, candidate.getDate(), 31) &&
      matches(mon, candidate.getMonth() + 1, 12) &&
      matches(dow, candidate.getDay(), 7)
    ) {
      return candidate.toISOString();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}
