import cron from "node-cron";
import { prisma } from "../../db.js";
import { expireOldGiftCodes } from "./gift.service.js";
import { getSystemConfig } from "../client/client.service.js";
import { sendTelegramNotification } from "./telegram-notify.js";

/**
 * Каждый час:
 * 1. Проверяем просроченные подарочные коды и возвращаем подписки дарителям.
 * 2. Отправляем уведомления дарителям о скором истечении кодов.
 */
export function startGiftExpiryCron() {
  // Экспирация просроченных кодов — каждый час в :15
  cron.schedule("15 * * * *", async () => {
    try {
      const expired = await expireOldGiftCodes();
      if (expired > 0) {
        console.log(`[gift-expiry] Expired ${expired} gift code(s)`);
      }
    } catch (e) {
      console.error("[gift-expiry] Error in expiration job:", e);
    }
  });

  // Уведомления о скором истечении — каждый час в :45
  cron.schedule("45 * * * *", async () => {
    try {
      await notifyExpiringGiftCodes();
    } catch (e) {
      console.error("[gift-expiry] Error in notification job:", e);
    }
  });
}

/**
 * Отправляет уведомления дарителям, чьи подарочные коды скоро истекут.
 * Проверяет: status='ACTIVE', expiresAt < now + N дней, expiryNotifiedAt IS NULL.
 */
async function notifyExpiringGiftCodes(): Promise<void> {
  const config = await getSystemConfig();
  const notifyDays = config.giftExpiryNotificationDays ?? 3;
  if (notifyDays <= 0) return;

  const notifyBefore = new Date(Date.now() + notifyDays * 24 * 60 * 60 * 1000);

  const codes = await prisma.giftCode.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: { lte: notifyBefore },
      expiryNotifiedAt: null,
    },
    include: {
      creator: {
        select: { telegramId: true },
      },
      secondarySubscription: {
        include: { tariff: { select: { name: true } } },
      },
    },
  });

  if (codes.length === 0) return;

  let notified = 0;
  for (const code of codes) {
    const telegramId = code.creator?.telegramId;
    if (!telegramId) {
      // Помечаем как notified чтобы не проверять снова
      await prisma.giftCode.update({
        where: { id: code.id },
        data: { expiryNotifiedAt: new Date() },
      });
      continue;
    }

    const hoursLeft = Math.max(0, Math.round((code.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)));
    const timeLabel = hoursLeft >= 24
      ? `${Math.round(hoursLeft / 24)} дн.`
      : `${hoursLeft} ч.`;
    const tariffLabel = code.secondarySubscription?.tariff?.name ?? "подписка";

    await sendTelegramNotification(
      telegramId,
      `⏰ Ваш подарочный код <b>${code.code}</b> (${tariffLabel}) истечёт через ${timeLabel}.\n\nЕсли получатель не активирует код, подписка вернётся вам.`,
    );

    await prisma.giftCode.update({
      where: { id: code.id },
      data: { expiryNotifiedAt: new Date() },
    });
    notified++;
  }

  if (notified > 0) {
    console.log(`[gift-expiry] Sent ${notified} expiry notification(s)`);
  }
}
