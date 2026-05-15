// Установить захват логов в кольцевой буфер ДО первого console.log в импортах.
// Это даёт нам логи всех последующих вызовов в /api/admin/diagnostics/logs.
import { installLogCapture } from "./modules/diagnostics/log-buffer.js";
installLogCapture();

import app from "./app.js";
import { env } from "./config/index.js";
import { prisma } from "./db.js";
import { ensureFirstAdmin } from "./modules/auth/auth.service.js";
import { ensureSystemSettings } from "./scripts/seed-system-settings.js";
import { startAutoBroadcastScheduler, stopAutoBroadcastScheduler } from "./modules/auto-broadcast/auto-broadcast-scheduler.js";
import { startContestDailyReminderScheduler, stopContestDailyReminderScheduler } from "./modules/contest/contest-daily-reminder-scheduler.js";
import { startAutoRenewScheduler } from "./modules/payment/auto-renew.cron.js";
import { startAutoBackupScheduler, stopAutoBackupScheduler } from "./modules/backup/auto-backup.scheduler.js";
import { startGiftExpiryCron } from "./modules/gift/gift-expiry.cron.js";
import { startAbandonedAccountsCleanup } from "./modules/client/abandoned-accounts.cron.js";
import { startMarketplaceScheduler, stopMarketplaceScheduler } from "./modules/marketplace/marketplace.scheduler.js";
import { ensureTheme, seedDefaultsToEmptyBlocks } from "./modules/landing/landing.service.js";
import { migrateLandingToBlocks } from "./scripts/migrate-landing-to-blocks.js";
import { registerCron } from "./modules/diagnostics/cron-registry.js";
import { runContestDailyReminder } from "./modules/contest/contest-daily-reminder.service.js";

async function main() {
  await prisma.$connect();

  await ensureFirstAdmin(env);
  await ensureSystemSettings();
  await ensureTheme();
  try {
    const result = await migrateLandingToBlocks();
    if (result.migrated) {
      console.log(`[landing-editor] seeded ${result.created} blocks from legacy settings`);
    }
  } catch (e) {
    console.error("[landing-editor] migrate-landing-to-blocks failed:", e);
  }
  try {
    const result = await seedDefaultsToEmptyBlocks();
    if (result.filled > 0) {
      console.log(`[landing-editor] auto-filled defaults into ${result.filled}/${result.total} empty blocks`);
    }
  } catch (e) {
    console.error("[landing-editor] seedDefaultsToEmptyBlocks failed:", e);
  }

  await startAutoBroadcastScheduler();
  startContestDailyReminderScheduler(env.CONTEST_REMINDER_CRON ?? undefined);
  startAutoRenewScheduler();
  startGiftExpiryCron();
  startAbandonedAccountsCleanup();
  await startAutoBackupScheduler();
  startMarketplaceScheduler();

  // Регистрация cron-задач в реестре для UI /admin/diagnostics → Cron monitor.
  // Имена/cron-выражения зашиты — должны соответствовать defaults в каждом scheduler.
  // Trigger подключён только там где безопасный manual run (контест-реминдер). Для
  // остальных — UI покажет «Run now» серой (canTrigger=false).
  registerCron({ name: "auto-broadcast", cron: "0 9 * * *", description: "Авто-рассылки сегментам пользователей" });
  registerCron({
    name: "contest-daily-reminder",
    cron: env.CONTEST_REMINDER_CRON || "0 * * * *",
    description: "Напоминания о конкурсах + auto-status transitions",
    trigger: () => runContestDailyReminder(),
  });
  registerCron({ name: "auto-renew", cron: "*/15 * * * *", description: "Авто-продление подписок с баланса/yookassa" });
  registerCron({ name: "gift-expiry", cron: "*/30 * * * *", description: "Истёкшие gift-коды → освобождаем зарезервированные подписки" });
  registerCron({ name: "abandoned-accounts", cron: "0 3 * * *", description: "Очистка незавершённых регистраций" });
  registerCron({ name: "auto-backup", cron: "0 4 * * *", description: "Автоматический бэкап БД" });
  registerCron({ name: "marketplace-heartbeat", cron: "*/10 * * * *", description: "Heartbeat в маркетплейс-хаб" });

  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`API v4.2.1 listening on port ${env.PORT}`);
  });

  const shutdown = async () => {
    stopAutoBroadcastScheduler();
    stopContestDailyReminderScheduler();
    stopAutoBackupScheduler();
    stopMarketplaceScheduler();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
