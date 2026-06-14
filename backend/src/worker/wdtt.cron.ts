/**
 * WDTT Cron: автоматический отзыв истёкших WDTT слотов
 * Запускается каждые 5 минут
 */

import { prisma } from "../db.js";

const CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 минут

/**
 * Удаляет ключ с WDTT ноды через HTTP API
 */
async function revokeKeyOnNode(nodeApiUrl: string, nodeApiKey: string, password: string): Promise<boolean> {
  try {
    const response = await fetch(`${nodeApiUrl}/api/keys/${password}`, {
      method: "DELETE",
      headers: {
        "X-API-Key": nodeApiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch (err) {
    console.error(`[WDTT Cron] Failed to revoke key ${password} on node ${nodeApiUrl}:`, err);
    return false;
  }
}

/**
 * Отправляет уведомление клиенту об истечении WDTT доступа
 * Интеграция с ботом через внутренний API
 */
async function notifyClient(clientTelegramId: string | null, message: string): Promise<void> {
  if (!clientTelegramId) return;
  
  try {
    // Здесь должна быть интеграция с ботом
    // Пока логируем
    console.log(`[WDTT Cron] Notify ${clientTelegramId}: ${message}`);
  } catch (err) {
    console.error(`[WDTT Cron] Failed to notify client ${clientTelegramId}:`, err);
  }
}

/**
 * Основная функция проверки и отзыва истёкших слотов
 */
async function checkExpiredWdttSlots(): Promise<void> {
  const now = new Date();
  
  try {
    // Находим все истёкшие активные слоты
    const expiredSlots = await prisma.wdttSlot.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lt: now },
      },
      include: {
        node: true,
        client: {
          select: {
            id: true,
            telegramId: true,
            email: true,
            telegramUsername: true,
          },
        },
      },
    });

    if (expiredSlots.length === 0) {
      return;
    }

    console.log(`[WDTT Cron] Found ${expiredSlots.length} expired WDTT slots`);

    for (const slot of expiredSlots) {
      try {
        // 1. Удаляем ключ с ноды
        const revokedOnNode = await revokeKeyOnNode(
          slot.node.apiUrl,
          slot.node.apiKey,
          slot.password
        );

        if (revokedOnNode) {
          console.log(`[WDTT Cron] Key ${slot.password} revoked on node ${slot.node.name}`);
        } else {
          console.warn(`[WDTT Cron] Key ${slot.password} revocation failed on node ${slot.node.name}, continuing anyway`);
        }

        // 2. Обновляем статус слота в БД
        await prisma.wdttSlot.update({
          where: { id: slot.id },
          data: {
            status: "EXPIRED",
            revokeReason: "expired",
            revokedAt: now,
          },
        });

        // 3. Уменьшаем currentSlots на ноде
        await prisma.wdttNode.update({
          where: { id: slot.nodeId },
          data: {
            currentSlots: { decrement: 1 },
          },
        });

        // 4. Уведомляем клиента
        await notifyClient(
          slot.client.telegramId,
          `⏰ Ваш WDTT доступ истёк.\n\n🔑 Пароль: \`${slot.password}\`\n📅 Истёк: ${slot.expiresAt.toLocaleDateString("ru-RU")}\n\n💰 Пополните баланс для продления.`
        );

        console.log(`[WDTT Cron] Slot ${slot.id} marked as expired, client ${slot.client.id} notified`);
      } catch (err) {
        console.error(`[WDTT Cron] Error processing slot ${slot.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[WDTT Cron] Error checking expired slots:", err);
  }
}

/**
 * Запускает cron
 */
export function startWdttCron(): void {
  console.log(`[WDTT Cron] Starting WDTT expiration checker (interval: ${CRON_INTERVAL_MS / 1000 / 60} min)`);
  
  // Запускаем сразу первый раз
  checkExpiredWdttSlots().catch(console.error);
  
  // Затем по расписанию
  _interval = setInterval(() => {
    checkExpiredWdttSlots().catch(console.error);
  }, CRON_INTERVAL_MS);
}

export function stopWdttCron(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

let _interval: ReturnType<typeof setInterval> | null = null;

// Запуск если вызван напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  startWdttCron();
}