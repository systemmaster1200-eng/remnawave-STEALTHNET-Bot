/**
 * отправка кастомных уведомлений автосписания.
 * Использует шаблоны из таблицы `auto_renew_notifications` (UI: /admin/auto-renew).
 *
 * Архитектура:
 *   - Cron (`auto-renew.cron.ts`) после каждого события (UPCOMING, SUCCESS, FAILED, RETRY, EXPIRED)
 *     дёргает `dispatchAutoRenewNotification(...)` с типом события и контекстом.
 *   - Функция достаёт enabled шаблоны нужного типа, для UPCOMING фильтрует по offsetMinutes
 *     (близко к текущему timeLeft), подставляет переменные и отправляет через TG.
 *
 * Переменные в `messageText`:
 *   {tariff_name}   — имя тарифа
 *   {amount}        — сумма к списанию
 *   {currency}      — валюта
 *   {days_left}     — целое число дней до истечения
 *   {hours_left}    — целое число часов до истечения
 *   {minutes_left}  — целое число минут до истечения
 *   {days_unit}     — «дн.»/«день»/«дня» (правильное склонение)
 *   {expire_date}   — DD.MM.YYYY
 *   {sub_index}     — номер подписки (#N)
 *   {balance}       — текущий баланс клиента
 */

import { prisma } from "../../db.js";
import { sendTelegramToUser } from "./telegram-notify.service.js";
import { getSystemConfig } from "../client/client.service.js";

export type AutoRenewTriggerType = "UPCOMING" | "SUCCESS" | "FAILED" | "RETRY" | "EXPIRED";

export type AutoRenewNotifContext = {
  tariffName: string;
  amount: number;
  currency: string;
  /** Только для UPCOMING — оставшееся время до истечения в МИНУТАХ (положительное). */
  minutesLeft?: number;
  /** Дата истечения (для подстановки). */
  expireAt?: Date | null;
  /** Индекс подписки (root=0, secondary=N). */
  subIndex?: number;
  /** Текущий баланс клиента. */
  balance?: number;
  /**
   * Уникальный ключ для дедупа (например `arn_<templateId>_<subId>`).
   * Если задан — функция сохранит ключ в `secondary_subscriptions.last_notified_key` (для sec)
   * и не отправит тот же шаблон повторно в течение часа.
   */
  dedupKeyForSec?: { secondarySubscriptionId: string; ttlMs?: number };
  /** Аналогично dedupKeyForSec — но для root подписки (через clients.last_arn_notified_key). */
  dedupKeyForRoot?: { clientId: string; ttlMs?: number };
};

function declOf(n: number): string {
  // Правильное склонение «дн.» / «дня» / «дней».
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

function renderTemplate(template: string, ctx: AutoRenewNotifContext): string {
  const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const days = ctx.minutesLeft != null ? Math.max(0, Math.floor(ctx.minutesLeft / (60 * 24))) : 0;
  const hours = ctx.minutesLeft != null ? Math.max(0, Math.floor(ctx.minutesLeft / 60)) : 0;
  const minutes = ctx.minutesLeft != null ? Math.max(0, Math.round(ctx.minutesLeft)) : 0;
  const expireStr = ctx.expireAt
    ? ctx.expireAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";

  return template
    // Литеральные «\n» из ручного ввода в админке → реальные переносы строк.
    // Реальные переносы (из seed E'...\n...') не содержат backslash и не затрагиваются.
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/\{tariff_name\}/g, ctx.tariffName)
    .replace(/\{amount\}/g, fmt(ctx.amount))
    .replace(/\{currency\}/g, ctx.currency.toUpperCase() === "RUB" ? "₽" : ctx.currency)
    .replace(/\{days_left\}/g, String(days))
    .replace(/\{hours_left\}/g, String(hours))
    .replace(/\{minutes_left\}/g, String(minutes))
    .replace(/\{days_unit\}/g, declOf(days))
    .replace(/\{expire_date\}/g, expireStr)
    .replace(/\{sub_index\}/g, ctx.subIndex != null ? String(ctx.subIndex) : "")
    .replace(/\{balance\}/g, ctx.balance != null ? fmt(ctx.balance) : "—");
}

/**
 * Главная функция dispatch. Отправляет все подходящие active-шаблоны клиенту.
 * Возвращает количество отправленных уведомлений (для логов).
 */
export async function dispatchAutoRenewNotification(
  clientId: string,
  triggerType: AutoRenewTriggerType,
  context: AutoRenewNotifContext,
): Promise<number> {
  // Тянем enabled шаблоны нужного типа.
  const templates = await prisma.autoRenewNotification.findMany({
    where: { triggerType, enabled: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (templates.length === 0) return 0;

  // Для UPCOMING — фильтруем по offsetMinutes (с допуском ± половина interval cron).
  // Cron бежит каждый час (60 минут), поэтому окно срабатывания = ±30 минут вокруг offsetMinutes.
  let matched = templates;
  if (triggerType === "UPCOMING") {
    if (context.minutesLeft == null) return 0;
    const ml = context.minutesLeft;
    matched = templates.filter((t) => {
      // |timeLeft - offset| < window → ровно «за N минут до».
      // Окно = max(30 мин, offset * 0.1) — для дальних дат больше допуск.
      const window = Math.max(30, Math.min(60, t.offsetMinutes * 0.1));
      return Math.abs(ml - t.offsetMinutes) < window;
    });
  }
  if (matched.length === 0) return 0;

  // Клиент → telegramId.
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, id: true },
  });
  if (!client?.telegramId) return 0;

  const cfg = await getSystemConfig();
  const backLabel = (cfg.botBackLabel ?? "🏠 Главное меню").trim() || "🏠 Главное меню";

  let sentCount = 0;
  for (const t of matched) {
    // Дедуп для secondary: не отправляем тот же шаблон повторно в течение ttl.
    if (context.dedupKeyForSec?.secondarySubscriptionId) {
      const expectedKey = `${t.id}:${Math.floor(Date.now() / (context.dedupKeyForSec.ttlMs ?? 60 * 60 * 1000))}`;
      const sec = await prisma.subscription.findUnique({
        where: { id: context.dedupKeyForSec.secondarySubscriptionId },
        select: { lastNotifiedKey: true },
      });
      if (sec?.lastNotifiedKey === expectedKey) continue;
      // Помечаем перед отправкой (atomic-ish — двойная отправка маловероятна).
      await prisma.subscription.update({
        where: { id: context.dedupKeyForSec.secondarySubscriptionId },
        data: { lastNotifiedKey: expectedKey },
      }).catch(() => {});
    }
    // Дедуп для root — через clients.lastArnNotifiedKey.
    if (context.dedupKeyForRoot?.clientId) {
      const expectedKey = `${t.id}:${Math.floor(Date.now() / (context.dedupKeyForRoot.ttlMs ?? 60 * 60 * 1000))}`;
      const cli = await prisma.client.findUnique({
        where: { id: context.dedupKeyForRoot.clientId },
        select: { lastArnNotifiedKey: true },
      });
      if (cli?.lastArnNotifiedKey === expectedKey) continue;
      await prisma.client.update({
        where: { id: context.dedupKeyForRoot.clientId },
        data: { lastArnNotifiedKey: expectedKey },
      }).catch(() => {});
    }

    const text = renderTemplate(t.messageText, context);
    const replyMarkup = {
      inline_keyboard: [
        [{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }],
        [{ text: backLabel, callback_data: "menu:main" }],
      ],
    };
    await sendTelegramToUser(client.telegramId, text, null, replyMarkup, { clientIdForBotToken: client.id })
      .catch((e) => console.error(`[arn-notif] sendTelegramToUser failed for client ${clientId}, template ${t.id}:`, e));
    sentCount += 1;
  }
  return sentCount;
}
