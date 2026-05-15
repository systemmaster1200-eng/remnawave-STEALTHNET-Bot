/**
 * Реминдеры конкурсов: периодические + deadline-напоминания + старт-нотификация.
 * Также делает auto-transition status (draft→active, active→ended).
 *
 * Race-condition защита:
 * - startNotificationSentAt флипается атомарно `null → now()` через updateMany ДО рассылки.
 *   Если cron-тик не успел уложиться в час, следующий не отправит дубль.
 * - Periodic reminder обновляет lastDailyReminderAt ПОСЛЕ рассылки — окно дубля минимум,
 *   но не нулевое (если рассылка длится дольше чем интервал — что для 24h практически невозможно).
 *
 * Telegram-блокировки:
 * - При SKIP_PATTERNS (bot was blocked / user is deactivated / chat not found / Forbidden / PEER_ID_INVALID)
 *   клиенту выставляется `telegramUnreachable: true`. В следующих рассылках он отфильтровывается.
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { autoTransitionContestStatuses } from "./contest.service.js";

const TELEGRAM_DELAY_MS = 80;
const TELEGRAM_FETCH_TIMEOUT_MS = 10_000;
const SKIP_PATTERNS = [/bot was blocked/i, /user is deactivated/i, /chat not found/i, /Forbidden/i, /PEER_ID_INVALID/i];

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildReplyMarkup(buttonText?: string | null, buttonUrl?: string | null) {
  if (!buttonText?.trim() || !buttonUrl?.trim()) return undefined;
  return {
    inline_keyboard: [[{ text: buttonText.trim(), url: buttonUrl.trim() }]],
  };
}

interface SendResult {
  ok: boolean;
  /** Сообщение нельзя доставить (бот заблокирован клиентом и т.п.) — клиента стоит пометить unreachable. */
  unreachable?: boolean;
  error?: string;
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup?: object,
): Promise<SendResult> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (res.ok && data.ok) return { ok: true };
    const desc = data.description ?? "";
    if (SKIP_PATTERNS.some((p) => p.test(desc))) return { ok: false, unreachable: true, error: desc };
    return { ok: false, error: desc };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function formatPrizeLine(prizeType: string, prizeValue: string, balanceCurrency: string): string {
  const v = (prizeValue || "").trim();
  if (!v) return "—";
  if (prizeType === "balance") return `${v} ${balanceCurrency} на баланс`;
  if (prizeType === "vpn_days") return `${v} дней VPN`;
  return v;
}

function buildContestStartMessage(
  contest: {
    name: string;
    startAt: Date;
    endAt: Date;
    dailyMessage: string | null;
    prize1Type: string; prize1Value: string;
    prize2Type: string; prize2Value: string;
    prize3Type: string; prize3Value: string;
    prizeBalanceCurrency: string | null;
  },
  defaultCurrency: string,
): string {
  const startStr = contest.startAt.toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" });
  const endStr = contest.endAt.toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" });
  const cur = (contest.prizeBalanceCurrency || defaultCurrency || "RUB").toUpperCase();
  const lines: string[] = [
    `<b>🏆 Конкурс «${contest.name}» запущен!</b>`,
    "",
    `📅 Период: с ${startStr} по ${endStr}.`,
  ];
  if (contest.dailyMessage?.trim()) {
    lines.push("", contest.dailyMessage.trim());
  }
  lines.push(
    "",
    "<b>🎁 Призы:</b>",
    `1 место — ${formatPrizeLine(contest.prize1Type, contest.prize1Value, cur)}`,
    `2 место — ${formatPrizeLine(contest.prize2Type, contest.prize2Value, cur)}`,
    `3 место — ${formatPrizeLine(contest.prize3Type, contest.prize3Value, cur)}`,
  );
  return lines.join("\n");
}

interface BroadcastClient {
  id: string;
  telegramId: string | null;
}

async function broadcastToClients(
  botToken: string,
  clients: BroadcastClient[],
  text: string,
  replyMarkup?: object,
): Promise<{ sent: number; errors: number; skipped: number; unreachableIds: string[] }> {
  let sent = 0;
  let errors = 0;
  let skipped = 0;
  const unreachableIds: string[] = [];

  for (const c of clients) {
    const tid = c.telegramId?.trim();
    if (!tid) continue;
    const result = await sendTelegram(botToken, tid, text, replyMarkup);
    if (result.ok) {
      sent++;
    } else if (result.unreachable) {
      skipped++;
      unreachableIds.push(c.id);
    } else {
      errors++;
    }
    await delay(TELEGRAM_DELAY_MS);
  }

  // Помечаем клиентов как недоступных в Telegram — следующие рассылки их пропустят.
  if (unreachableIds.length > 0) {
    await prisma.client.updateMany({
      where: { id: { in: unreachableIds } },
      data: { telegramUnreachable: true },
    }).catch((e) => console.error("[broadcast] failed to mark telegramUnreachable:", e));
  }

  return { sent, errors, skipped, unreachableIds };
}

function parseDeadlineHours(csv: string | null | undefined): number[] {
  if (!csv?.trim()) return [];
  return csv
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function readDeadlineSent(json: string | null | undefined): Record<string, string> {
  if (!json?.trim()) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function shouldSendInterval(
  lastSent: Date | null,
  intervalHours: number,
  now: Date,
): boolean {
  if (intervalHours <= 0) return false;
  if (!lastSent) return true;
  const elapsedMs = now.getTime() - lastSent.getTime();
  return elapsedMs >= intervalHours * 60 * 60 * 1000;
}

function pickPendingDeadlineHour(
  deadlineHours: number[],
  endAt: Date,
  alreadySent: Record<string, string>,
  now: Date,
): number | null {
  const TOLERANCE_MS = 60 * 60 * 1000;
  for (const h of deadlineHours) {
    if (alreadySent[String(h)]) continue;
    const triggerAt = endAt.getTime() - h * 60 * 60 * 1000;
    if (now.getTime() >= triggerAt && now.getTime() < triggerAt + TOLERANCE_MS) {
      return h;
    }
  }
  return null;
}

function buildDeadlineMessage(
  contest: { name: string; endAt: Date; dailyMessage: string | null },
  hoursBefore: number,
): string {
  const lead = hoursBefore >= 24
    ? `<b>⏰ Конкурс «${contest.name}» завершается через ${Math.round(hoursBefore / 24)} дн.!</b>`
    : `<b>⚡ Конкурс «${contest.name}» завершается через ${hoursBefore} ч.!</b>`;
  const lines = [lead];
  if (contest.dailyMessage?.trim()) {
    lines.push("", contest.dailyMessage.trim());
  }
  lines.push("", "Успейте принять участие 🏆");
  return lines.join("\n");
}

/** Получает клиентов для рассылки — с TG ID, не заблокированных, бот доступен. */
async function getReachableClients(): Promise<BroadcastClient[]> {
  return prisma.client.findMany({
    where: {
      telegramId: { not: null },
      isBlocked: false,
      telegramUnreachable: false,
    },
    select: { id: true, telegramId: true },
  });
}

export async function runContestDailyReminder(): Promise<{ sent: number; errors: number; activated: number; ended: number }> {
  const now = new Date();

  // 0. Авто-переходы статусов конкурсов перед всеми рассылками.
  const transitions = await autoTransitionContestStatuses();
  if (transitions.activated > 0 || transitions.ended > 0) {
    console.log(`[contest-daily-reminder] auto-status: activated=${transitions.activated}, ended=${transitions.ended}`);
  }

  const config = await getSystemConfig();
  const botToken = config.telegramBotToken?.trim();
  if (!botToken) {
    console.warn("[contest-daily-reminder] telegram_bot_token not set, skip");
    return { sent: 0, errors: 0, ...transitions };
  }

  const clients = await getReachableClients();
  if (clients.length === 0) return { sent: 0, errors: 0, ...transitions };

  const defaultCurrency = (config.defaultCurrency || "rub").toUpperCase();

  let totalSent = 0;
  let totalErrors = 0;

  // 1. Старт-нотификации для конкурсов, которые только что стали active и ещё не рассылались.
  // ATOMIC: флипаем startNotificationSentAt: null → now ДО рассылки. Если cron-тики перекрылись,
  // второй обнаружит уже не-null и не сделает дубль.
  while (true) {
    // Берём по одному (чтобы не залипнуть на длинной рассылке для нескольких конкурсов в одном тике).
    const candidate = await prisma.contest.findFirst({
      where: {
        startAt: { lte: now },
        endAt: { gte: now },
        status: "active",
        startNotificationSentAt: null,
      },
      orderBy: { startAt: "desc" },
      select: { id: true },
    });
    if (!candidate) break;

    // Atomic acquire — только один параллельный процесс пройдёт.
    const acquired = await prisma.contest.updateMany({
      where: { id: candidate.id, startNotificationSentAt: null },
      data: { startNotificationSentAt: now, lastDailyReminderAt: now },
    });
    if (acquired.count === 0) {
      // Кто-то перехватил — пропускаем этот конкурс, на следующей итерации возьмём другой.
      continue;
    }

    // Лок наш — рассылаем.
    const contest = await prisma.contest.findUnique({ where: { id: candidate.id } });
    if (!contest) continue;
    const text = buildContestStartMessage(contest, defaultCurrency);
    const markup = buildReplyMarkup(contest.buttonText, contest.buttonUrl);
    const result = await broadcastToClients(botToken, clients, text, markup);
    totalSent += result.sent;
    totalErrors += result.errors;
    console.log(`[contest-daily-reminder] Contest "${contest.name}" start: sent=${result.sent}, errors=${result.errors}, skipped=${result.skipped}`);
  }

  // 2. Реминдеры (deadline + periodic) для активных конкурсов с уже отправленным стартом.
  const contestsForReminders = await prisma.contest.findMany({
    where: {
      startAt: { lte: now },
      endAt: { gte: now },
      status: "active",
      startNotificationSentAt: { not: null },
    },
    orderBy: { startAt: "desc" },
  });

  for (const contest of contestsForReminders) {
    if (!contest.reminderEnabled) continue;

    // Deadline-напоминания приоритетнее periodic.
    const deadlineHours = parseDeadlineHours(contest.reminderDeadlineHoursBefore);
    const sentMap = readDeadlineSent(contest.reminderDeadlineSentJson);
    const pendingHour = deadlineHours.length
      ? pickPendingDeadlineHour(deadlineHours, contest.endAt, sentMap, now)
      : null;

    if (pendingHour != null) {
      const text = buildDeadlineMessage(contest, pendingHour);
      const markup = buildReplyMarkup(contest.buttonText, contest.buttonUrl);
      const result = await broadcastToClients(botToken, clients, text, markup);
      sentMap[String(pendingHour)] = now.toISOString();
      await prisma.contest.update({
        where: { id: contest.id },
        data: { reminderDeadlineSentJson: JSON.stringify(sentMap) },
      });
      totalSent += result.sent;
      totalErrors += result.errors;
      console.log(`[contest-daily-reminder] Contest "${contest.name}" deadline-${pendingHour}h: sent=${result.sent}, errors=${result.errors}, skipped=${result.skipped}`);
      continue;
    }

    // Periodic reminder.
    if (!shouldSendInterval(contest.lastDailyReminderAt, contest.reminderIntervalHours, now)) {
      continue;
    }

    // Atomic claim чтобы два параллельных тика не отправили один реминдер дважды.
    const claim = await prisma.contest.updateMany({
      where: {
        id: contest.id,
        OR: [
          { lastDailyReminderAt: null },
          { lastDailyReminderAt: { lte: new Date(now.getTime() - contest.reminderIntervalHours * 60 * 60 * 1000) } },
        ],
      },
      data: { lastDailyReminderAt: now },
    });
    if (claim.count === 0) continue;

    const text =
      (contest.dailyMessage?.trim()) ||
      `🏆 Конкурс «${contest.name}» идёт до ${contest.endAt.toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" })}. Участвуйте — призы за 1, 2 и 3 место!`;
    const markup = buildReplyMarkup(contest.buttonText, contest.buttonUrl);
    const result = await broadcastToClients(botToken, clients, text, markup);

    totalSent += result.sent;
    totalErrors += result.errors;
    if (result.sent > 0 || result.errors > 0) {
      console.log(`[contest-daily-reminder] Contest "${contest.name}" interval-${contest.reminderIntervalHours}h: sent=${result.sent}, errors=${result.errors}, skipped=${result.skipped}`);
    }
  }

  return { sent: totalSent, errors: totalErrors, ...transitions };
}

/** Ручной запуск старт-нотификации (admin endpoint). Дополнительно использует atomic flip. */
export async function sendContestStartNotification(
  contestId: string,
): Promise<{ ok: boolean; sent?: number; errors?: number; error?: string }> {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) return { ok: false, error: "Конкурс не найден" };

  const config = await getSystemConfig();
  const botToken = config.telegramBotToken?.trim();
  if (!botToken) return { ok: false, error: "Не задан токен бота (Настройки → Telegram)" };

  const now = new Date();
  // Атомарно переводим в active + помечаем что старт-уведомление отправлено.
  // Если уже отправлялось — count=0, выходим с предупреждением.
  const acquired = await prisma.contest.updateMany({
    where: { id: contestId, startNotificationSentAt: null },
    data: { status: "active", startNotificationSentAt: now, lastDailyReminderAt: now },
  });
  if (acquired.count === 0) {
    return { ok: false, error: "Старт-уведомление уже отправлялось" };
  }

  const clients = await getReachableClients();
  const defaultCurrency = (config.defaultCurrency || "rub").toUpperCase();
  const text = buildContestStartMessage(contest, defaultCurrency);
  const markup = buildReplyMarkup(contest.buttonText, contest.buttonUrl);
  const result = await broadcastToClients(botToken, clients, text, markup);

  return { ok: true, sent: result.sent, errors: result.errors };
}

export async function sendContestDrawResults(contestId: string): Promise<void> {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      winners: {
        include: { client: { select: { telegramId: true, telegramUsername: true, email: true } } },
        orderBy: { place: "asc" },
      },
    },
  });
  if (!contest || contest.winners.length === 0) return;

  const config = await getSystemConfig();
  const botToken = config.telegramBotToken?.trim();
  if (!botToken) return;
  const defaultCurrency = (config.defaultCurrency || "rub").toUpperCase();
  const cur = (contest.prizeBalanceCurrency || defaultCurrency).toUpperCase();

  // Публичная рассылка результатов всем — анонс победителей.
  const clients = await getReachableClients();

  const lines: string[] = [
    `<b>🏆 Конкурс «${contest.name}» — результаты розыгрыша!</b>`,
    "",
    "<b>Победители:</b>",
  ];
  for (const w of contest.winners) {
    const name = w.client.telegramUsername ? `@${w.client.telegramUsername}` : w.client.email ?? "—";
    lines.push(`${w.place} место — ${name} (${formatPrizeLine(w.prizeType, w.prizeValue, cur)})`);
  }
  lines.push("", "Поздравляем победителей! 🎉");
  const text = lines.join("\n");
  const markup = buildReplyMarkup(contest.buttonText, contest.buttonUrl);
  const result = await broadcastToClients(botToken, clients, text, markup);
  console.log(`[contest] Draw results "${contest.name}": sent=${result.sent}, errors=${result.errors}, skipped=${result.skipped}`);

  // Persona-сообщение каждому победителю — детали приза + что делать дальше.
  for (const w of contest.winners) {
    const tid = w.client.telegramId?.trim();
    if (!tid) continue;
    const personalLines: string[] = [
      `<b>🎉 Поздравляем!</b>`,
      `Вы заняли <b>${w.place} место</b> в конкурсе «${contest.name}».`,
      "",
      `<b>Ваш приз:</b> ${formatPrizeLine(w.prizeType, w.prizeValue, cur)}`,
    ];
    if (w.prizeType === "balance" && w.appliedAt) {
      personalLines.push("", "💰 Сумма уже зачислена на ваш баланс в кабинете.");
    } else if (w.prizeType === "vpn_days") {
      personalLines.push("", "📅 Дни VPN будут начислены администратором в ближайшее время. Проверьте срок подписки.");
    } else if (w.prizeType === "custom") {
      personalLines.push("", "📞 Свяжитесь с поддержкой чтобы получить приз.");
    }
    await sendTelegram(botToken, tid, personalLines.join("\n"));
    await delay(TELEGRAM_DELAY_MS);
  }
}
