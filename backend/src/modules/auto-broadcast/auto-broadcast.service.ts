/**
 * Авто-рассылка: настраиваемые правила (после регистрации, неактивность, без платежа и т.д.).
 * Джоб выбирает подходящих клиентов, отправляет сообщение и пишет лог.
 *
 * Триггеры делятся на два типа:
 *  - ONE-TIME: отправляется клиенту один раз за всё время (after_registration, no_payment,
 *              trial_not_connected, trial_used_never_paid, no_traffic)
 *  - RECURRING: может отправляться повторно, если условие снова наступило — дедупликация
 *              за последние RECURRING_COOLDOWN_DAYS дней (inactivity, subscription_expired,
 *              subscription_ending_soon)
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { sendEmail } from "../mail/mail.service.js";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

/** Задержка между Telegram-сообщениями (мс). Telegram rate limit ~30 msg/sec, берём с запасом. */
const TELEGRAM_DELAY_MS = 50;
/** Задержка между email-сообщениями (мс). */
const EMAIL_DELAY_MS = 200;
/**
 * Для recurring-триггеров: кулдаун в днях. Если клиенту уже отправлялось это правило
 * в пределах кулдауна — пропускаем. Предотвращает спам при каждом запуске cron.
 */
const RECURRING_COOLDOWN_DAYS = 30;

/**
 * «Окно актуальности» для one-time триггеров (в днях).
 *
 * Проблема: без верхней границы критерий «createdAt <= now-delay» захватывает всех клиентов
 * старше N дней — при создании нового правила это приводит к одномоментному спаму по
 * всей базе. Ограничиваем выборку клиентами, у которых событие-триггер наступило недавно
 * (в пределах этого окна).
 *
 * Cron работает ежедневно — 3 дня дают достаточный буфер на случай простоя / ребилдов.
 */
const ONE_TIME_WINDOW_DAYS = 3;

/** Окно для subscription_expired: показывать только недавно истёкшие (чтобы не спамить годами). */
const EXPIRED_WINDOW_DAYS = 7;

const LOG_PREFIX = "[auto-broadcast]";

export type TriggerType =
  | "after_registration"
  | "inactivity"
  | "no_payment"
  | "trial_not_connected"
  | "trial_used_never_paid"
  | "no_traffic"
  | "subscription_expired"
  | "subscription_ending_soon";

/** Recurring-триггеры — могут повторяться, дедупликация по кулдауну */
const RECURRING_TRIGGERS: Set<TriggerType> = new Set([
  "inactivity",
  "subscription_expired",
  "subscription_ending_soon",
]);

function isRecurring(trigger: string): boolean {
  return RECURRING_TRIGGERS.has(trigger as TriggerType);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Telegram send ────────────────────────────────────────────────

type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; web_app: { url: string } }
  | { text: string; url: string };

type InlineKeyboard = { inline_keyboard: InlineKeyboardButton[][] };

function buildReplyMarkup(buttonText?: string | null, buttonAction?: string | null, publicAppUrl?: string | null): InlineKeyboard | undefined {
  const label = buttonText?.trim();
  const action = buttonAction?.trim();
  if (!label || !action) return undefined;

  let btn: InlineKeyboardButton;
  if (action.startsWith("menu:")) {
    btn = { text: label, callback_data: action };
  } else if (action.startsWith("webapp:")) {
    const path = action.slice(7);
    const base = (publicAppUrl || "").replace(/\/+$/, "");
    btn = { text: label, web_app: { url: `${base}${path}` } };
  } else {
    btn = { text: label, url: action };
  }
  return { inline_keyboard: [[btn]] };
}

async function sendTelegram(botToken: string, chatId: string, text: string, replyMarkup?: InlineKeyboard): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const proxy = await getProxyUrl("telegram");
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, proxy);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !data.ok) {
      const err = data.description ?? `HTTP ${res.status}`;
      console.warn(`${LOG_PREFIX} Telegram send failed for chat ${chatId}: ${err}`);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Telegram send error for chat ${chatId}:`, msg);
    return { ok: false, error: msg };
  }
}

// ─── Dedup helpers ────────────────────────────────────────────────

/** Для ONE-TIME триггеров: получить Set клиентов, которым уже КОГДА-ЛИБО отправлялось это правило */
async function getEverSentClientIds(ruleId: string): Promise<Set<string>> {
  const logs = await prisma.autoBroadcastLog.findMany({
    where: { ruleId },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  return new Set(logs.map((l) => l.clientId));
}

/** Для RECURRING триггеров: получить Set клиентов, которым отправлялось за последние N дней */
async function getRecentlySentClientIds(ruleId: string, cooldownDays: number): Promise<Set<string>> {
  const since = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
  const logs = await prisma.autoBroadcastLog.findMany({
    where: { ruleId, sentAt: { gte: since } },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  return new Set(logs.map((l) => l.clientId));
}

// ─── Eligible clients ─────────────────────────────────────────────

/**
 * Фильтр «есть канал, пригодный для правила». Без него клиенты без telegramId (для
 * telegram-правила) попадали в eligible, отправка пропускалась, лог не писался —
 * и клиент висел как «подходящий» навечно, завышая eligibleCount в админке.
 */
function channelFilter(channel: string): Record<string, unknown> {
  if (channel === "telegram") return { telegramId: { not: null } };
  if (channel === "email") return { email: { not: null } };
  // both — хотя бы один из каналов
  return { OR: [{ telegramId: { not: null } }, { email: { not: null } }] };
}

/**
 * Стэкинг дат подписки, как в activateTariffForClient:
 * base = max(prevExpire, paidAt); newExpire = base + durationDays.
 * Используем для реконструкции expireAt в базе данных без похода в Remnawave.
 *
 * Если вернули null — значит у клиента нет ни одного завершённого платёжного
 * цикла с тарифом (и сроком его жизни).
 */
function computeStackedExpireAt(
  payments: Array<{ paidAt: Date; durationDays: number }>,
): Date | null {
  if (payments.length === 0) return null;
  // Гарантируем порядок по времени (возрастанию)
  const ordered = [...payments].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  let expire: Date | null = null;
  for (const p of ordered) {
    const base: Date = expire && expire.getTime() > p.paidAt.getTime() ? expire : p.paidAt;
    expire = new Date(base.getTime() + p.durationDays * 24 * 60 * 60 * 1000);
  }
  return expire;
}

/**
 * Собрать текущий expireAt для всех клиентов по PAID-платежам основного тарифа.
 * Один запрос + in-memory стэкинг по clientId.
 */
async function getClientMainExpiries(): Promise<Map<string, Date>> {
  const payments = await prisma.payment.findMany({
    where: {
      status: "PAID",
      tariffId: { not: null },
      paidAt: { not: null },
    },
    select: { clientId: true, paidAt: true, tariff: { select: { durationDays: true } } },
    orderBy: { paidAt: "asc" },
  });
  const byClient = new Map<string, Array<{ paidAt: Date; durationDays: number }>>();
  for (const p of payments) {
    if (!p.clientId || !p.paidAt || p.tariff?.durationDays == null) continue;
    const arr = byClient.get(p.clientId) ?? [];
    arr.push({ paidAt: p.paidAt, durationDays: p.tariff.durationDays });
    byClient.set(p.clientId, arr);
  }
  const out = new Map<string, Date>();
  for (const [clientId, arr] of byClient) {
    const expire = computeStackedExpireAt(arr);
    if (expire) out.set(clientId, expire);
  }
  return out;
}

/**
 * Получить ID клиентов, подходящих под правило (с учётом дедупликации, окна,
 * канала доставки и статуса авто-продления).
 */
export async function getEligibleClientIds(ruleId: string): Promise<string[]> {
  const rule = await prisma.autoBroadcastRule.findUnique({
    where: { id: ruleId },
  });
  if (!rule) return [];

  const sentSet = isRecurring(rule.triggerType)
    ? await getRecentlySentClientIds(ruleId, RECURRING_COOLDOWN_DAYS)
    : await getEverSentClientIds(ruleId);

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const delayDays = Math.max(0, rule.delayDays);

  // Базовая часть WHERE: не заблокирован + есть канал доставки, подходящий правилу
  const baseWhere = { isBlocked: false, ...channelFilter(rule.channel) };

  let clients: { id: string }[] = [];

  switch (rule.triggerType as TriggerType) {
    // ── after_registration ──────────────────────────────────────
    // Окно: createdAt ∈ [now-(delay+window), now-delay]. Без верхней границы при
    // включении нового правила уведомление ушло бы всем старым клиентам.
    case "after_registration": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
      clients = await prisma.client.findMany({
        where: {
          ...baseWhere,
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        select: { id: true },
      });
      break;
    }

    // ── no_payment ──────────────────────────────────────────────
    // Зарегистрирован в окне [now-(delay+window), now-delay], ни разу не платил.
    case "no_payment": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
      clients = await prisma.client.findMany({
        where: {
          ...baseWhere,
          createdAt: { gte: windowStart, lte: windowEnd },
          payments: { none: { status: "PAID", amount: { gt: 0 } } },
        },
        select: { id: true },
      });
      break;
    }

    // ── trial_not_connected ─────────────────────────────────────
    // Зарегистрирован в окне, триал не активировал, подписки нет.
    case "trial_not_connected": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
      clients = await prisma.client.findMany({
        where: {
          ...baseWhere,
          createdAt: { gte: windowStart, lte: windowEnd },
          trialUsed: false,
          remnawaveUuid: null,
        },
        select: { id: true },
      });
      break;
    }

    // ── trial_used_never_paid ───────────────────────────────────
    // Использовал триал в окне [now-(delay+window), now-delay], ни разу не платил.
    // По createdAt (т.к. момент активации триала в БД не фиксируется отдельно).
    case "trial_used_never_paid": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
      clients = await prisma.client.findMany({
        where: {
          ...baseWhere,
          createdAt: { gte: windowStart, lte: windowEnd },
          trialUsed: true,
          payments: { none: { status: "PAID", amount: { gt: 0 } } },
        },
        select: { id: true },
      });
      break;
    }

    // ── no_traffic ──────────────────────────────────────────────
    // Подключён к VPN (есть remnawaveUuid), зарегистрирован в окне, не платил
    // (платный не нужно напоминать «ты не пользуешься»). One-time.
    case "no_traffic": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
      clients = await prisma.client.findMany({
        where: {
          ...baseWhere,
          remnawaveUuid: { not: null },
          createdAt: { gte: windowStart, lte: windowEnd },
          payments: { none: { status: "PAID", amount: { gt: 0 } } },
        },
        select: { id: true },
      });
      break;
    }

    // ── inactivity ──────────────────────────────────────────────
    // Платил когда-то, но в последние delayDays PAID-платежей нет. Recurring.
    // Исключаем тех, кто вообще никогда не платил (иначе дубль no_payment).
    case "inactivity": {
      const since = new Date(now.getTime() - delayDays * dayMs);
      const all = await prisma.client.findMany({
        where: {
          ...baseWhere,
          // Хотя бы один платный платёж когда-либо
          payments: { some: { status: "PAID", amount: { gt: 0 } } },
        },
        select: { id: true },
      });
      const recentlyPaidIds = new Set(
        (
          await prisma.payment.findMany({
            where: { status: "PAID", amount: { gt: 0 }, paidAt: { gte: since } },
            select: { clientId: true },
            distinct: ["clientId"],
          })
        ).map((p) => p.clientId),
      );
      clients = all.filter((c) => !recentlyPaidIds.has(c.id));
      break;
    }

    // ── subscription_expired ────────────────────────────────────
    // Подписка истекла в окне [now-(delay+EXPIRED_WINDOW), now-delay].
    // Исключаем клиентов с включённым авто-продлением.
    case "subscription_expired": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - EXPIRED_WINDOW_DAYS * dayMs);
      const expiries = await getClientMainExpiries();
      const expiredIds: string[] = [];
      for (const [clientId, expireAt] of expiries) {
        if (expireAt >= windowStart && expireAt <= windowEnd) {
          expiredIds.push(clientId);
        }
      }
      if (expiredIds.length === 0) {
        clients = [];
      } else {
        clients = await prisma.client.findMany({
          where: {
            ...baseWhere,
            id: { in: expiredIds },
            autoRenewEnabled: false,
          },
          select: { id: true },
        });
      }
      break;
    }

    // ── subscription_ending_soon ────────────────────────────────
    // Подписка истекает через N дней — окно [now + (N-1), now + N] суток.
    // Исключаем клиентов с включённым авто-продлением.
    case "subscription_ending_soon": {
      const daysLeft = Math.max(1, delayDays);
      const windowStart = new Date(now.getTime() + (daysLeft - 1) * dayMs);
      const windowEnd = new Date(now.getTime() + daysLeft * dayMs);
      const expiries = await getClientMainExpiries();
      const endingSoonIds: string[] = [];
      for (const [clientId, expireAt] of expiries) {
        if (expireAt >= windowStart && expireAt < windowEnd) {
          endingSoonIds.push(clientId);
        }
      }
      if (endingSoonIds.length === 0) {
        clients = [];
      } else {
        clients = await prisma.client.findMany({
          where: {
            ...baseWhere,
            id: { in: endingSoonIds },
            autoRenewEnabled: false,
          },
          select: { id: true },
        });
      }
      break;
    }

    default:
      console.warn(`${LOG_PREFIX} Unknown trigger type: ${rule.triggerType}`);
      return [];
  }

  const eligible = clients.map((c) => c.id).filter((id) => !sentSet.has(id));

  console.log(
    `${LOG_PREFIX} Rule "${rule.name}" (${rule.triggerType}, delay=${rule.delayDays}, channel=${rule.channel}): ` +
    `${clients.length} matched, ${sentSet.size} already sent, ${eligible.length} eligible`,
  );

  return eligible;
}

// ─── Run rule ─────────────────────────────────────────────────────

export type RunRuleResult = {
  ruleId: string;
  ruleName: string;
  sent: number;
  skipped: number;
  errors: string[];
};

/**
 * Выполнить одно правило: отправить сообщение подходящим клиентам и записать лог.
 */
export async function runRule(ruleId: string): Promise<RunRuleResult> {
  const rule = await prisma.autoBroadcastRule.findUnique({ where: { id: ruleId } });
  if (!rule) return { ruleId, ruleName: "", sent: 0, skipped: 0, errors: ["Rule not found"] };
  if (!rule.enabled) return { ruleId, ruleName: rule.name, sent: 0, skipped: 0, errors: [] };

  const clientIds = await getEligibleClientIds(ruleId);
  if (clientIds.length === 0) {
    return { ruleId, ruleName: rule.name, sent: 0, skipped: 0, errors: [] };
  }

  const config = await getSystemConfig();
  const doTelegram = rule.channel === "telegram" || rule.channel === "both";
  const doEmail = rule.channel === "email" || rule.channel === "both";
  const botToken = config.telegramBotToken?.trim();

  // Проверка конфигурации каналов
  if (doTelegram && !botToken) {
    console.error(
      `${LOG_PREFIX} Rule "${rule.name}": telegram channel selected but telegram_bot_token is not configured in settings!`,
    );
  }

  const smtpConfig = doEmail
    ? {
        host: config.smtpHost || "",
        port: config.smtpPort ?? 587,
        secure: config.smtpSecure ?? false,
        user: config.smtpUser ?? null,
        password: config.smtpPassword ?? null,
        fromEmail: config.smtpFromEmail ?? null,
        fromName: config.smtpFromName ?? null,
      }
    : null;

  if (doEmail && (!smtpConfig?.host || !smtpConfig?.fromEmail)) {
    console.error(
      `${LOG_PREFIX} Rule "${rule.name}": email channel selected but SMTP is not configured (host or fromEmail missing)!`,
    );
  }

  const serviceName = config.serviceName || "Сервис";
  const subject = rule.subject?.trim() || `Сообщение от ${serviceName}`;
  const htmlMessage = rule.message.trim().replace(/\n/g, "<br>\n");
  const htmlBody = `<!DOCTYPE html><html><body style="font-family: sans-serif;">${htmlMessage}</body></html>`;
  const replyMarkup = buildReplyMarkup(rule.buttonText, rule.buttonUrl, config.publicAppUrl);

  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, telegramId: true, email: true },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  const SKIP_PATTERNS = /blocked by the user|can't initiate conversation|send messages to bots|chat not found|user is deactivated|bot was kicked/i;

  console.log(`${LOG_PREFIX} Rule "${rule.name}": sending to ${clients.length} clients...`);

  for (const c of clients) {
    let telegramOk = false;
    let emailOk = false;

    let telegramSkipped = false;

    // Telegram
    if (doTelegram && botToken && c.telegramId?.trim()) {
      const tgResult = await sendTelegram(botToken, c.telegramId.trim(), rule.message.trim(), replyMarkup);
      telegramOk = tgResult.ok;
      if (!telegramOk) {
        if (tgResult.error && SKIP_PATTERNS.test(tgResult.error)) {
          skipped++;
          telegramSkipped = true;
        } else if (errors.length < 20) {
          errors.push(`Telegram ${c.telegramId}: ${tgResult.error ?? "unknown error"}`);
        }
      }
      await delay(TELEGRAM_DELAY_MS);
    }

    // Email
    if (doEmail && smtpConfig?.host && smtpConfig?.fromEmail && c.email?.trim()) {
      try {
        const res = await sendEmail(smtpConfig, c.email.trim(), subject, htmlBody);
        emailOk = res.ok;
        if (!emailOk && errors.length < 20) {
          errors.push(`Email fail: ${c.email}`);
        }
      } catch (err) {
        if (errors.length < 20) {
          errors.push(`Email error: ${c.email} — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await delay(EMAIL_DELAY_MS);
    }

    const anySent = telegramOk || emailOk;
    const shouldLog = anySent || telegramSkipped;
    if (shouldLog) {
      try {
        await prisma.autoBroadcastLog.create({
          data: { ruleId: rule.id, clientId: c.id },
        });
      } catch (logErr) {
        console.error(`${LOG_PREFIX} Failed to write log for rule ${rule.id}, client ${c.id}:`, logErr);
      }
      if (anySent) sent++;
    }
  }

  console.log(
    `${LOG_PREFIX} Rule "${rule.name}" done: ${sent} sent, ${skipped} skipped` +
    (errors.length > 0 ? `, ${errors.length} error(s)` : ""),
  );

  return { ruleId, ruleName: rule.name, sent, skipped, errors };
}

// ─── Run all rules ────────────────────────────────────────────────

/**
 * Запустить все включённые правила.
 */
export async function runAllRules(): Promise<RunRuleResult[]> {
  const rules = await prisma.autoBroadcastRule.findMany({
    where: { enabled: true },
    select: { id: true, name: true },
  });

  if (rules.length === 0) {
    console.log(`${LOG_PREFIX} No enabled rules found.`);
    return [];
  }

  console.log(`${LOG_PREFIX} Running ${rules.length} enabled rule(s)...`);

  const results: RunRuleResult[] = [];
  for (const r of rules) {
    try {
      const res = await runRule(r.id);
      results.push(res);
    } catch (err) {
      console.error(`${LOG_PREFIX} Rule "${r.name}" (${r.id}) crashed:`, err);
      results.push({
        ruleId: r.id,
        ruleName: r.name,
        sent: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  const totalSent = results.reduce((s, r) => s + r.sent, 0);
  const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  console.log(`${LOG_PREFIX} All rules done: ${totalSent} sent, ${totalSkipped} skipped, ${totalErrors} error(s)`);

  return results;
}
