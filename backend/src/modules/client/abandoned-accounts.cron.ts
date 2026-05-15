import cron from "node-cron";
import { prisma } from "../../db.js";

/**
 * Удаляет заброшенные email-аккаунты, где onboardingCompleted = false
 * (пользователь зарегистрировался через email, но не задал пароль и ушёл).
 *
 * Запускается каждые 15 минут. Удаляет аккаунты старше 30 минут.
 */
export function startAbandonedAccountsCleanup() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      const threshold = new Date(Date.now() - 30 * 60 * 1000); // 30 минут назад

      const abandoned = await prisma.client.findMany({
        where: {
          onboardingCompleted: false,
          createdAt: { lt: threshold },
        },
        select: { id: true, email: true },
      });

      if (abandoned.length === 0) return;

      // Все связанные записи удаляются каскадно (onDelete: Cascade в схеме)
      const ids = abandoned.map((c) => c.id);

      const deleted = await prisma.client.deleteMany({
        where: { id: { in: ids } },
      });

      console.log(
        `[abandoned-accounts] Deleted ${deleted.count} abandoned account(s):`,
        abandoned.map((c) => c.email).join(", "),
      );
    } catch (e) {
      console.error("[abandoned-accounts] Error in cleanup job:", e);
    }
  });
}
