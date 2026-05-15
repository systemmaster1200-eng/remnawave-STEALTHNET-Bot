/**
 * Cron: каждые 10 минут пингует хаб (регистрируется если ещё нет).
 * Не запускается, если роль = hub или маркетплейс выключен — проверка внутри
 * ensureRegistered.
 */
import cron, { type ScheduledTask } from "node-cron";
import { MARKETPLACE_HEARTBEAT_CRON } from "./marketplace.constants.js";
import { ensureRegistered } from "./marketplace.registration.js";

let task: ScheduledTask | null = null;

export function startMarketplaceScheduler() {
  if (task) return;
  // Первый прогон через 30 секунд после старта (даём поднять БД и сидинг).
  setTimeout(() => {
    ensureRegistered().catch((e) => {
      console.warn("[marketplace] initial connect failed:", e instanceof Error ? e.message : e);
    });
  }, 30_000);

  task = cron.schedule(MARKETPLACE_HEARTBEAT_CRON, () => {
    ensureRegistered().catch((e) => {
      console.warn("[marketplace] scheduled connect failed:", e instanceof Error ? e.message : e);
    });
  });
}

export function stopMarketplaceScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}
