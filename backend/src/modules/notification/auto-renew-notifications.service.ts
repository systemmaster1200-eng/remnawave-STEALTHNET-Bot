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
  /**
   * ID подписки — для deep-link кнопок с плейсхолдером {{SUBSCRIPTION_ID}}
   * (например «Продлить» → /cabinet/extend/{{SUBSCRIPTION_ID}}). Если не задан,
   * кнопки с плейсхолдером пропускаются (нечего подставить).
   */
  subscriptionId?: string;
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
// ─── Inline-кнопки уведомлений (конструктор как в авторассылках) ───

/** Одна кнопка из конструктора: текст + action (menu:* / webapp:/path / URL). */
export type AutoRenewButton = { text: string; action: string };

type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; web_app: { url: string } }
  | { text: string; url: string };

/** Дефолтный набор кнопок — используется, когда buttonsConfig === null (старые шаблоны). */
function defaultButtons(backLabel: string): AutoRenewButton[] {
  return [
    { text: "📋 Мои подписки", action: "menu:my_subs" },
    { text: backLabel, action: "menu:main" },
  ];
}

/** action → конкретная inline-кнопка Telegram (callback / web_app / url). */
function makeInlineButton(text: string, action: string, publicAppUrl?: string | null): InlineKeyboardButton {
  if (action.startsWith("menu:")) {
    return { text, callback_data: action };
  }
  if (action.startsWith("webapp:")) {
    const path = action.slice("webapp:".length);
    const base = (publicAppUrl || "").replace(/\/+$/, "");
    return { text, web_app: { url: `${base}${path}` } };
  }
  return { text, url: action };
}

/** Подставляет {{SUBSCRIPTION_ID}} в action. Возвращает null, если плейсхолдер есть, а id — нет. */
function resolveActionPlaceholders(action: string, subscriptionId?: string): string | null {
  if (!action.includes("{{SUBSCRIPTION_ID}}")) return action;
  if (!subscriptionId) return null; // нечего подставить → кнопку не показываем
  return action.split("{{SUBSCRIPTION_ID}}").join(subscriptionId);
}

/** Парсит buttonsConfig (JSON) в массив кнопок; невалидный/пустой JSON → []. */
function parseButtonsConfig(raw: string | null | undefined): AutoRenewButton[] | null {
  if (raw == null) return null; // NULL → дефолт (решается выше)
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((b) => {
        const obj = (b && typeof b === "object") ? (b as Record<string, unknown>) : {};
        const text = typeof obj.text === "string" ? obj.text.trim() : "";
        const action = typeof obj.action === "string" ? obj.action.trim() : "";
        return { text, action };
      })
      .filter((b) => b.text && b.action);
  } catch {
    return [];
  }
}

/**
 * Строит reply_markup для шаблона.
 *   • buttonsConfig === null  → дефолтный набор (обратная совместимость).
 *   • buttonsConfig === "[]"  → undefined (кнопок нет вовсе).
 *   • иначе                   → кнопки из конфига, каждая отдельным рядом.
 */
function buildReplyMarkupForTemplate(
  buttonsConfigRaw: string | null | undefined,
  backLabel: string,
  publicAppUrl?: string | null,
  subscriptionId?: string,
): { inline_keyboard: InlineKeyboardButton[][] } | undefined {
  const parsed = parseButtonsConfig(buttonsConfigRaw);
  const buttons = parsed === null ? defaultButtons(backLabel) : parsed;
  const rows: InlineKeyboardButton[][] = [];
  for (const b of buttons) {
    const action = resolveActionPlaceholders(b.action, subscriptionId);
    if (action === null) continue; // плейсхолдер без id — пропускаем кнопку
    rows.push([makeInlineButton(b.text, action, publicAppUrl)]);
  }
  if (rows.length === 0) return undefined;
  return { inline_keyboard: rows };
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
  const publicAppUrl = (cfg as { publicAppUrl?: string | null }).publicAppUrl ?? null;

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
    // Кнопки из конструктора шаблона: null → дефолт, "[]" → без кнопок, иначе — заданные.
    const replyMarkup = buildReplyMarkupForTemplate(
      (t as { buttonsConfig?: string | null }).buttonsConfig ?? null,
      backLabel,
      publicAppUrl,
      context.subscriptionId,
    );
    await sendTelegramToUser(client.telegramId, text, null, replyMarkup, { clientIdForBotToken: client.id })
      .catch((e) => console.error(`[arn-notif] sendTelegramToUser failed for client ${clientId}, template ${t.id}:`, e));
    sentCount += 1;
  }
  return sentCount;
}
