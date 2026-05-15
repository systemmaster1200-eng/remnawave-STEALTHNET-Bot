/**
 * Утилита для отправки Telegram-уведомлений из backend.
 * Использует BOT_TOKEN из env для прямых вызовов Telegram Bot API.
 */

const BOT_TOKEN = process.env.BOT_TOKEN;

/**
 * Отправляет сообщение пользователю в Telegram.
 * Если BOT_TOKEN не задан или отправка не удалась — тихо игнорирует (fire-and-forget).
 */
export async function sendTelegramNotification(
  telegramId: string | bigint,
  text: string,
): Promise<void> {
  if (!BOT_TOKEN) return;
  const chatId = String(telegramId);
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });
  } catch {
    // fire-and-forget: не ломаем основную логику из-за ошибки отправки
  }
}
