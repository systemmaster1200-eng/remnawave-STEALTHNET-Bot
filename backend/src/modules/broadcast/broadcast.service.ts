/**
 * Рассылка: отправка сообщения клиентам через Telegram и/или Email.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { sendEmail } from "../mail/mail.service.js";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const TELEGRAM_SEND_DELAY_MS = 60;
const EMAIL_SEND_DELAY_MS = 200;

export type BroadcastChannel = "telegram" | "email" | "both";

export type BroadcastResult = {
  ok: boolean;
  sentTelegram: number;
  sentEmail: number;
  failedTelegram: number;
  failedEmail: number;
  errors: string[];
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; web_app: { url: string } }
  | { text: string; url: string };

type InlineKeyboard = { inline_keyboard: InlineKeyboardButton[][] };

function buildReplyMarkup(buttonText?: string, buttonAction?: string, publicAppUrl?: string | null): InlineKeyboard | undefined {
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

/**
 * Отправить текстовое сообщение в Telegram.
 */
async function sendTelegramMessage(botToken: string, chatId: string, text: string, replyMarkup?: InlineKeyboard): Promise<{ ok: boolean; error?: string }> {
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
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, error: data.description ?? res.statusText ?? "Unknown error" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Отправить фото в Telegram (caption = текст сообщения).
 */
async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  caption: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  replyMarkup?: InlineKeyboard
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", new Blob([buffer], { type: mimeType }), fileName || "image");
    if (caption) {
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
    }
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    const proxy = await getProxyUrl("telegram");
    const res = await proxyFetch(url, { method: "POST", body: form }, proxy);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, error: data.description ?? res.statusText ?? "Unknown error" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Отправить документ в Telegram (caption = текст сообщения).
 */
async function sendTelegramDocument(
  botToken: string,
  chatId: string,
  caption: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  replyMarkup?: InlineKeyboard
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", new Blob([buffer], { type: mimeType }), fileName || "file");
    if (caption) {
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
    }
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    const proxy = await getProxyUrl("telegram");
    const res = await proxyFetch(url, { method: "POST", body: form }, proxy);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, error: data.description ?? res.statusText ?? "Unknown error" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export type BroadcastAttachment = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

export type BroadcastProgress = {
  totalTelegram: number;
  totalEmail: number;
  sentTelegram: number;
  sentEmail: number;
  failedTelegram: number;
  failedEmail: number;
  currentChannel?: "telegram" | "email";
};

/**
 * Запустить рассылку: Telegram и/или Email.
 * subject используется только для email. attachment — опциональное изображение или файл.
 * onProgress — опциональный коллбек для трекинга прогресса (обновляется после
 * каждого отправленного/зафейленного получателя и в момент переключения канала).
 */
export async function runBroadcast(options: {
  channel: BroadcastChannel;
  subject: string;
  message: string;
  attachment?: BroadcastAttachment;
  buttonText?: string;
  buttonUrl?: string;
  onProgress?: (p: BroadcastProgress) => void;
}): Promise<BroadcastResult> {
  const { channel, subject, message, attachment, buttonText, buttonUrl, onProgress } = options;
  const result: BroadcastResult = {
    ok: true,
    sentTelegram: 0,
    sentEmail: 0,
    failedTelegram: 0,
    failedEmail: 0,
    errors: [],
  };

  const config = await getSystemConfig();
  const doTelegram = channel === "telegram" || channel === "both";
  const doEmail = channel === "email" || channel === "both";
  const isImage = attachment?.mimetype?.startsWith("image/") ?? false;
  const replyMarkup = buildReplyMarkup(buttonText, buttonUrl, config.publicAppUrl);

  // Предварительно считаем получателей, чтобы фронт мог сразу показать "X из Y".
  const [totalTelegram, totalEmail] = await Promise.all([
    doTelegram ? prisma.client.count({ where: { telegramId: { not: null } } }) : Promise.resolve(0),
    doEmail ? prisma.client.count({ where: { email: { not: null } } }) : Promise.resolve(0),
  ]);
  const progress: BroadcastProgress = {
    totalTelegram,
    totalEmail,
    sentTelegram: 0,
    sentEmail: 0,
    failedTelegram: 0,
    failedEmail: 0,
  };
  const report = () => {
    progress.sentTelegram = result.sentTelegram;
    progress.sentEmail = result.sentEmail;
    progress.failedTelegram = result.failedTelegram;
    progress.failedEmail = result.failedEmail;
    onProgress?.(progress);
  };
  report();

  if (doTelegram) {
    progress.currentChannel = "telegram";
    report();
    const botToken = config.telegramBotToken?.trim();
    if (!botToken) {
      result.errors.push("Telegram: не задан токен бота (Настройки → Почта и Telegram)");
      result.ok = false;
    } else {
      const clients = await prisma.client.findMany({
        where: { telegramId: { not: null } },
        select: { id: true, telegramId: true },
      });
      for (const c of clients) {
        const tid = c.telegramId!.trim();
        if (!tid) continue;
        await delay(TELEGRAM_SEND_DELAY_MS);
        const send = attachment
          ? isImage
            ? await sendTelegramPhoto(
                botToken,
                tid,
                message,
                attachment.buffer,
                attachment.mimetype,
                attachment.originalname,
                replyMarkup
              )
            : await sendTelegramDocument(
                botToken,
                tid,
                message,
                attachment.buffer,
                attachment.mimetype,
                attachment.originalname,
                replyMarkup
              )
          : await sendTelegramMessage(botToken, tid, message, replyMarkup);
        if (send.ok) result.sentTelegram++;
        else {
          result.failedTelegram++;
          if (result.errors.length < 10) result.errors.push(`Telegram ${tid}: ${send.error ?? "error"}`);
        }
        report();
      }
    }
  }

  if (doEmail) {
    progress.currentChannel = "email";
    report();
    const smtpConfig = {
      host: config.smtpHost || "",
      port: config.smtpPort ?? 587,
      secure: config.smtpSecure ?? false,
      user: config.smtpUser ?? null,
      password: config.smtpPassword ?? null,
      fromEmail: config.smtpFromEmail ?? null,
      fromName: config.smtpFromName ?? null,
    };
    if (!smtpConfig.host || !smtpConfig.fromEmail) {
      result.errors.push("Email: не настроен SMTP (Настройки → Платежи / Почта)");
      result.ok = false;
    } else {
      const clients = await prisma.client.findMany({
        where: { email: { not: null } },
        select: { id: true, email: true },
      });
      const serviceName = config.serviceName || "Сервис";
      const subj = subject.trim() || `Сообщение от ${serviceName}`;
      const html = message.trim().replace(/\n/g, "<br>\n");
      const htmlBody = `<!DOCTYPE html><html><body style="font-family: sans-serif;">${html}</body></html>`;
      const emailAttachments = attachment
        ? [{ filename: attachment.originalname || "file", content: attachment.buffer }]
        : undefined;
      for (const c of clients) {
        const email = c.email!.trim();
        if (!email) continue;
        await delay(EMAIL_SEND_DELAY_MS);
        const send = await sendEmail(smtpConfig, email, subj, htmlBody, emailAttachments);
        if (send.ok) result.sentEmail++;
        else {
          result.failedEmail++;
          if (result.errors.length < 10) result.errors.push(`Email ${email}: ${send.error ?? "error"}`);
        }
        report();
      }
    }
  }

  if (result.errors.length > 0) result.ok = false;
  return result;
}

/**
 * Количество клиентов с telegramId и с email (для отображения в форме рассылки).
 */
export async function getBroadcastRecipientsCount(): Promise<{ withTelegram: number; withEmail: number }> {
  const [withTelegram, withEmail] = await Promise.all([
    prisma.client.count({ where: { telegramId: { not: null } } }),
    prisma.client.count({ where: { email: { not: null } } }),
  ]);
  return { withTelegram, withEmail };
}

// ───────────────────────── Background jobs ─────────────────────────
// Рассылка для больших аудиторий занимает минуты; HTTP-запрос на фронтенде
// обрывается по таймауту (nginx/браузер), хотя сама отправка на бэкенде
// успешно завершается. Поэтому запускаем рассылку как фоновую задачу и
// отдаём на фронт jobId — он опрашивает статус.

export type BroadcastJobStatus = "running" | "completed" | "error";

export type BroadcastJob = {
  id: string;
  status: BroadcastJobStatus;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
  result?: BroadcastResult;
  progress: BroadcastProgress;
};

const broadcastJobs = new Map<string, BroadcastJob>();

// Автоочистка: удаляем завершённые джобы старше 1 часа раз в 10 минут.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of broadcastJobs) {
    if (job.finishedAt && job.finishedAt.getTime() < cutoff) broadcastJobs.delete(id);
  }
}, 10 * 60 * 1000).unref?.();

export function startBroadcastJob(options: {
  channel: BroadcastChannel;
  subject: string;
  message: string;
  attachment?: BroadcastAttachment;
  buttonText?: string;
  buttonUrl?: string;
  startedByAdmin?: string;
}): string {
  const jobId = randomUUID();
  const job: BroadcastJob = {
    id: jobId,
    status: "running",
    startedAt: new Date(),
    progress: {
      totalTelegram: 0,
      totalEmail: 0,
      sentTelegram: 0,
      sentEmail: 0,
      failedTelegram: 0,
      failedEmail: 0,
    },
  };
  broadcastJobs.set(jobId, job);

  // Запускаем в фоне — HTTP-запрос на POST /admin/broadcast возвращается сразу
  // с jobId, а реальная отправка продолжается без таймаут-рисков.
  void (async () => {
    // 1) Создаём запись истории (status=running) — id совпадает с jobId.
    let historyCreated = false;
    try {
      await prisma.broadcastHistory.create({
        data: {
          id: jobId,
          status: "running",
          channel: options.channel,
          subject: options.subject ?? "",
          message: options.message,
          buttonText: options.buttonText || null,
          buttonUrl: options.buttonUrl || null,
          attachmentName: options.attachment?.originalname || null,
          startedByAdmin: options.startedByAdmin || null,
        },
      });
      historyCreated = true;
    } catch (e) {
      // История — best-effort: если создать запись не удалось, рассылку всё равно запускаем.
      console.warn("[broadcast] failed to create history record:", e instanceof Error ? e.message : e);
    }

    // Пишем прогресс в БД не чаще раза в 5 сек, чтобы не нагружать запись на каждое сообщение.
    let lastDbWriteAt = 0;
    const PROGRESS_FLUSH_MS = 5000;

    try {
      job.result = await runBroadcast({
        ...options,
        onProgress: (p) => {
          job.progress = { ...p };
          if (!historyCreated) return;
          const now = Date.now();
          if (now - lastDbWriteAt < PROGRESS_FLUSH_MS) return;
          lastDbWriteAt = now;
          void prisma.broadcastHistory
            .update({
              where: { id: jobId },
              data: {
                totalTelegram: p.totalTelegram,
                sentTelegram: p.sentTelegram,
                failedTelegram: p.failedTelegram,
                totalEmail: p.totalEmail,
                sentEmail: p.sentEmail,
                failedEmail: p.failedEmail,
              },
            })
            .catch((e: unknown) => console.warn("[broadcast] progress update failed:", e instanceof Error ? e.message : e));
        },
      });
      job.status = "completed";
    } catch (e) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : String(e);
    } finally {
      job.finishedAt = new Date();
      // 2) Финализируем запись истории с итоговыми результатами.
      if (historyCreated) {
        try {
          await prisma.broadcastHistory.update({
            where: { id: jobId },
            data: {
              status: job.status,
              finishedAt: job.finishedAt,
              totalTelegram: job.progress.totalTelegram,
              sentTelegram: job.result?.sentTelegram ?? job.progress.sentTelegram,
              failedTelegram: job.result?.failedTelegram ?? job.progress.failedTelegram,
              totalEmail: job.progress.totalEmail,
              sentEmail: job.result?.sentEmail ?? job.progress.sentEmail,
              failedEmail: job.result?.failedEmail ?? job.progress.failedEmail,
              errors: job.result?.errors?.length ? job.result.errors.slice(0, 50) : undefined,
              error: job.error || null,
            },
          });
        } catch (e) {
          console.warn("[broadcast] history finalize failed:", e instanceof Error ? e.message : e);
        }
      }
    }
  })();

  return jobId;
}

export function getBroadcastJob(jobId: string): BroadcastJob | null {
  return broadcastJobs.get(jobId) ?? null;
}

export type BroadcastHistoryItem = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  channel: string;
  subject: string;
  message: string;
  buttonText: string | null;
  buttonUrl: string | null;
  attachmentName: string | null;
  totalTelegram: number;
  sentTelegram: number;
  failedTelegram: number;
  totalEmail: number;
  sentEmail: number;
  failedEmail: number;
  errors: string[] | null;
  error: string | null;
  startedByAdmin: string | null;
};

function rowToItem(row: {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  channel: string;
  subject: string;
  message: string;
  buttonText: string | null;
  buttonUrl: string | null;
  attachmentName: string | null;
  totalTelegram: number;
  sentTelegram: number;
  failedTelegram: number;
  totalEmail: number;
  sentEmail: number;
  failedEmail: number;
  errors: unknown;
  error: string | null;
  startedByAdmin: string | null;
}): BroadcastHistoryItem {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    status: row.status,
    channel: row.channel,
    subject: row.subject,
    message: row.message,
    buttonText: row.buttonText,
    buttonUrl: row.buttonUrl,
    attachmentName: row.attachmentName,
    totalTelegram: row.totalTelegram,
    sentTelegram: row.sentTelegram,
    failedTelegram: row.failedTelegram,
    totalEmail: row.totalEmail,
    sentEmail: row.sentEmail,
    failedEmail: row.failedEmail,
    errors: Array.isArray(row.errors) ? (row.errors as string[]) : null,
    error: row.error,
    startedByAdmin: row.startedByAdmin,
  };
}

export async function listBroadcastHistory(opts: { limit?: number; offset?: number } = {}): Promise<{ items: BroadcastHistoryItem[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const [rows, total] = await Promise.all([
    prisma.broadcastHistory.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.broadcastHistory.count(),
  ]);
  return { items: rows.map(rowToItem), total };
}

export async function getBroadcastHistoryItem(id: string): Promise<BroadcastHistoryItem | null> {
  const row = await prisma.broadcastHistory.findUnique({ where: { id } });
  return row ? rowToItem(row) : null;
}
