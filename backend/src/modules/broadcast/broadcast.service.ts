/**
 * Рассылка: отправка сообщения клиентам через Telegram и/или Email.
 */

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { sendEmail } from "../mail/mail.service.js";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

// 25.05.2026, WolfVPN — параметры throughput'а:
// • Для ТЕКСТА Telegram global rate ~30 msg/sec — можно агрессивно.
// • Для МЕДИА (video/photo/document) практический лимит ~5-8/sec на бота;
//   при превышении Telegram возвращает 429 retry_after=60s (видели на практике).
// Решение: концурренси и delay выбираются ДИНАМИЧЕСКИ в зависимости от типа.
//   text:  CONCURRENCY=4, DELAY=50ms  → ~20 msg/sec  (под global 30)
//   media: CONCURRENCY=1, DELAY=200ms → ~5  msg/sec  (под media-throttle)
// 429-retry с respect retry_after — страховка если всё равно превысим.
const TELEGRAM_TEXT_CONCURRENCY = 4;
const TELEGRAM_TEXT_DELAY_MS = 50;
// 25.05.2026, WolfVPN — после file_id-reuse upload пропадает → можем увеличить.
// 1 worker для первой отправки (upload бинаря), потом file_id ускоряет всё в 20x.
// delay 150ms = ~6.5 msg/sec безопасно под media-throttle Telegram (~5-8/sec).
const TELEGRAM_MEDIA_CONCURRENCY = 1;
const TELEGRAM_MEDIA_DELAY_MS = 150;
const EMAIL_SEND_DELAY_MS = 200;
const TELEGRAM_429_MAX_RETRIES = 3;

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

/** Одна кнопка конструктора: текст + action (menu:* / webapp:/path / URL). */
type ConfigButton = { text: string; action: string };

/** action → конкретная inline-кнопка Telegram. */
function makeConfigButton(text: string, action: string, publicAppUrl?: string | null): InlineKeyboardButton {
  if (action.startsWith("menu:")) return { text, callback_data: action };
  if (action.startsWith("webapp:")) {
    const path = action.slice("webapp:".length);
    const base = (publicAppUrl || "").replace(/\/+$/, "");
    return { text, web_app: { url: `${base}${path}` } };
  }
  return { text, url: action };
}

/** Парсит buttonsConfig (JSON). Невалидный/пустой → []. NULL/undefined → null (нет конфига). */
function parseButtonsConfig(raw: string | null | undefined): ConfigButton[] | null {
  if (raw == null) return null;
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((b) => {
        const o = (b && typeof b === "object") ? (b as Record<string, unknown>) : {};
        return { text: typeof o.text === "string" ? o.text.trim() : "", action: typeof o.action === "string" ? o.action.trim() : "" };
      })
      .filter((b) => b.text && b.action);
  } catch { return []; }
}

/**
 * Строит reply_markup из buttonsConfig (произвольное число кнопок, каждая отдельным
 * рядом). Подставляет {{SUBSCRIPTION_ID}} — если плейсхолдер есть, а id нет, кнопка
 * пропускается. Если buttonsConfig === null → возвращает null (вызвать fallback на старые поля).
 */
function buildReplyMarkupFromConfig(
  raw: string | null | undefined,
  publicAppUrl?: string | null,
  subscriptionId?: string,
): InlineKeyboard | undefined | null {
  const parsed = parseButtonsConfig(raw);
  if (parsed === null) return null; // нет конфига → caller сделает fallback
  const rows: InlineKeyboardButton[][] = [];
  for (const b of parsed) {
    let action = b.action;
    if (action.includes("{{SUBSCRIPTION_ID}}")) {
      if (!subscriptionId) continue;
      action = action.split("{{SUBSCRIPTION_ID}}").join(subscriptionId);
    }
    rows.push([makeConfigButton(b.text, action, publicAppUrl)]);
  }
  if (rows.length === 0) return undefined;
  return { inline_keyboard: rows };
}

/**
 * Единая точка: сначала buttonsConfig (новый конструктор), при его отсутствии —
 * старые buttonText/buttonUrl (обратная совместимость).
 */
function resolveReplyMarkup(
  opts: { buttonsConfig?: string | null; buttonText?: string; buttonUrl?: string },
  publicAppUrl?: string | null,
  subscriptionId?: string,
): InlineKeyboard | undefined {
  const fromConfig = buildReplyMarkupFromConfig(opts.buttonsConfig, publicAppUrl, subscriptionId);
  if (fromConfig !== null) return fromConfig; // конфиг задан (в т.ч. пустой → undefined)
  return buildReplyMarkup(opts.buttonText, opts.buttonUrl, publicAppUrl);
}

/**
 * Отправить текстовое сообщение в Telegram. 25.05.2026, WolfVPN —
 * принимает proxy parameter (берём 1 раз перед циклом, не на каждое сообщение)
 * и retry на 429 с уважением retry_after.
 */
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup: InlineKeyboard | undefined,
  proxy: string | null,
): Promise<TgSendResult> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramSendWith429Retry(async () => {
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, proxy);
    return res;
  });
}

// T-direct-send (WolfVPN): отправка ОДНОГО сообщения конкретному юзеру по telegram_id
// (точечная рассылка из админки). Переиспользует sendTelegramMessage + токен/прокси из настроек.
// T-direct-send: доп. опции точечной отправки. channel telegram (по умолч.) / email; subject — для email.
export type DirectSendExtras = {
  channel?: "telegram" | "email";
  subject?: string;
  buttonText?: string;
  buttonUrl?: string;
  buttonsConfig?: string | null;
  attachment?: BroadcastAttachment;
};

function isValidEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

// Готовит SMTP-конфиг, тему и HTML-тело письма (1-в-1 как email-ветка runBroadcast).
function buildEmailParts(config: Awaited<ReturnType<typeof getSystemConfig>>, subject: string | undefined, message: string, attachment: BroadcastAttachment | undefined) {
  const smtpConfig = {
    host: config.smtpHost || "",
    port: config.smtpPort ?? 587,
    secure: config.smtpSecure ?? false,
    user: config.smtpUser ?? null,
    password: config.smtpPassword ?? null,
    fromEmail: config.smtpFromEmail ?? null,
    fromName: config.smtpFromName ?? null,
  };
  const serviceName = config.serviceName || "Сервис";
  const subj = subject?.trim() || `Сообщение от ${serviceName}`;
  const html = message.trim().replace(/\n/g, "<br>\n");
  const htmlBody = `<!DOCTYPE html><html><body style="font-family: sans-serif;">${html}</body></html>`;
  const emailAttachments = attachment ? [{ filename: attachment.originalname || "file", content: attachment.buffer }] : undefined;
  return { smtpConfig, subj, htmlBody, emailAttachments };
}

export async function sendDirectEmail(to: string, subject: string | undefined, message: string, attachment?: BroadcastAttachment): Promise<{ ok: boolean; error?: string }> {
  const config = await getSystemConfig();
  const { smtpConfig, subj, htmlBody, emailAttachments } = buildEmailParts(config, subject, message, attachment);
  if (!smtpConfig.host || !smtpConfig.fromEmail) return { ok: false, error: "Не настроен SMTP (Настройки → Почта)" };
  const send = await sendEmail(smtpConfig, to, subj, htmlBody, emailAttachments);
  return send.ok ? { ok: true } : { ok: false, error: send.error };
}

// Одноразовая подготовка media-параметров (тип + probe видео + thumbnail) перед отправкой.
function prepareMedia(att: BroadcastAttachment | undefined) {
  const isImage = att?.mimetype?.startsWith("image/") ?? false;
  const isVideo = att?.mimetype?.startsWith("video/") ?? false;
  const videoMeta = isVideo && att ? probeVideoMetaSync(att.buffer, att.originalname) : {};
  const videoThumb = isVideo && att ? generateVideoThumbnail(att.buffer, att.originalname) : null;
  return { isImage, isVideo, videoMeta, videoThumb };
}

// Один rich-send: photo/video/document/text + клавиатура. fileIdOrBuffer — для reuse file_id в списке.
async function richSendOne(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup: InlineKeyboard | undefined,
  att: BroadcastAttachment | undefined,
  media: ReturnType<typeof prepareMedia>,
  fileIdOrBuffer: string | Buffer | null,
  proxy: string | null,
): Promise<TgSendResult> {
  if (!att) return sendTelegramMessage(botToken, chatId, text, replyMarkup, proxy);
  const fileArg: Buffer | string = fileIdOrBuffer ?? att.buffer;
  if (media.isImage) return sendTelegramPhoto(botToken, chatId, text, fileArg, att.mimetype, att.originalname, replyMarkup, proxy);
  if (media.isVideo) return sendTelegramVideo(botToken, chatId, text, fileArg, att.mimetype, att.originalname, replyMarkup, media.videoMeta, media.videoThumb, proxy);
  return sendTelegramDocument(botToken, chatId, text, fileArg, att.mimetype, att.originalname, replyMarkup, proxy);
}

export async function sendDirectTelegramMessage(chatId: string, text: string, extras?: DirectSendExtras): Promise<{ ok: boolean; error?: string }> {
  const config = await getSystemConfig();
  const botToken = config.telegramBotToken?.trim();
  if (!botToken) return { ok: false, error: "Не задан токен бота (Настройки → Почта и Telegram)" };
  const proxy = await getProxyUrl("telegram");
  const replyMarkup = resolveReplyMarkup({ buttonsConfig: extras?.buttonsConfig, buttonText: extras?.buttonText, buttonUrl: extras?.buttonUrl }, config.publicAppUrl);
  const media = prepareMedia(extras?.attachment);
  const res = await richSendOne(botToken, chatId, text, replyMarkup, extras?.attachment, media, null, proxy);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

// T-list-send (WolfVPN): рассылка по ЯВНОМУ списку Telegram ID. In-memory job в api-процессе
// (ID могут быть не из нашей БД → обычный broadcast через worker+prisma.client сюда не подходит).
// Запрос мгновенно отдаёт jobId, отправка идёт в фоне, фронт опрашивает прогресс.
export type ListSendJob = {
  id: string;
  total: number;
  sent: number;
  failed: number;
  done: boolean;
  errors: Array<{ telegramId: string; error: string }>;
};
const listSendJobs = new Map<string, ListSendJob>();

export function getListSendJob(jobId: string): ListSendJob | null {
  return listSendJobs.get(jobId) ?? null;
}

export function startListSendJob(recipients: string[], message: string, extras?: DirectSendExtras): { jobId: string; total: number } {
  const channel = extras?.channel ?? "telegram";
  // дедуп + валидные получатели по каналу (TG — числовые ID, email — адреса)
  const ids = Array.from(new Set(
    recipients
      .map((s) => String(s).trim())
      .filter((s) => (channel === "email" ? isValidEmail(s) : /^\d+$/.test(s))),
  ));
  const jobId = randomUUID();
  const job: ListSendJob = { id: jobId, total: ids.length, sent: 0, failed: 0, done: ids.length === 0, errors: [] };
  listSendJobs.set(jobId, job);
  if (ids.length === 0) return { jobId, total: 0 };

  void (async () => {
    try {
      const config = await getSystemConfig();

      // ── EMAIL ──
      if (channel === "email") {
        const { smtpConfig, subj, htmlBody, emailAttachments } = buildEmailParts(config, extras?.subject, message, extras?.attachment);
        if (!smtpConfig.host || !smtpConfig.fromEmail) {
          job.failed = ids.length;
          job.errors.push({ telegramId: "—", error: "Не настроен SMTP (Настройки → Почта)" });
          return;
        }
        for (const to of ids) {
          const send = await sendEmail(smtpConfig, to, subj, htmlBody, emailAttachments);
          if (send.ok) job.sent++;
          else {
            job.failed++;
            if (job.errors.length < 200) job.errors.push({ telegramId: to, error: send.error ?? "Ошибка отправки" });
          }
          await delay(EMAIL_SEND_DELAY_MS);
        }
        return;
      }

      // ── TELEGRAM ──
      const botToken = config.telegramBotToken?.trim();
      if (!botToken) {
        job.failed = ids.length;
        job.errors.push({ telegramId: "—", error: "Не задан токен бота (Настройки → Почта и Telegram)" });
        return;
      }
      const proxy = await getProxyUrl("telegram");
      const replyMarkup = resolveReplyMarkup({ buttonsConfig: extras?.buttonsConfig, buttonText: extras?.buttonText, buttonUrl: extras?.buttonUrl }, config.publicAppUrl);
      const att = extras?.attachment;
      const media = prepareMedia(att);
      let cachedFileId: string | null = null; // file_id reuse: вложение грузим 1 раз, дальше шлём строкой
      for (const id of ids) {
        const res = await richSendOne(botToken, id, message, replyMarkup, att, media, cachedFileId, proxy);
        if (res.ok) {
          job.sent++;
          if (att && !cachedFileId) {
            const fid = extractFileId(media.isImage ? "photo" : media.isVideo ? "video" : "document", res.result);
            if (fid) cachedFileId = fid;
          }
        } else {
          job.failed++;
          if (job.errors.length < 200) job.errors.push({ telegramId: id, error: res.error });
        }
        await delay(40); // ~25 msg/sec — бережём rate limit Telegram (429 retry уже внутри sendTelegram*)
      }
    } catch (e) {
      job.errors.push({ telegramId: "—", error: e instanceof Error ? e.message : "Внутренняя ошибка" });
    } finally {
      job.done = true;
      const t = setTimeout(() => listSendJobs.delete(jobId), 30 * 60 * 1000); // уборка через 30 мин
      t.unref?.();
    }
  })();

  return { jobId, total: ids.length };
}

/**
 * Универсальная обёртка с retry на 429. Telegram при превышении rate возвращает
 * 429 + parameters.retry_after (sec). Мы спим столько и повторяем — не теряем
 * сообщения. До TELEGRAM_429_MAX_RETRIES попыток.
 *
 * 25.05.2026, WolfVPN — возвращаем result-объект Telegram при success
 * (нужно для извлечения file_id и переиспользования его в следующих отправках).
 */
type TgSendResult = { ok: true; result: TgSendResultData } | { ok: false; error: string };
type TgSendResultData = {
  message_id?: number;
  video?: { file_id?: string };
  photo?: Array<{ file_id?: string }>;
  document?: { file_id?: string };
  animation?: { file_id?: string };
};

async function telegramSendWith429Retry(
  doRequest: () => Promise<Response>,
): Promise<TgSendResult> {
  for (let attempt = 0; attempt <= TELEGRAM_429_MAX_RETRIES; attempt++) {
    try {
      const res = await doRequest();
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: TgSendResultData;
        description?: string;
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      if (res.ok && data.ok) return { ok: true, result: data.result ?? {} };
      if (data.error_code === 429 && data.parameters?.retry_after && attempt < TELEGRAM_429_MAX_RETRIES) {
        const wait = Math.min(60, data.parameters.retry_after) * 1000;
        console.warn(`[broadcast] 429 — sleeping ${wait}ms then retry (attempt ${attempt + 1}/${TELEGRAM_429_MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return { ok: false, error: data.description ?? res.statusText ?? "Unknown error" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Network errors — retry с маленьким backoff.
      if (attempt < TELEGRAM_429_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: "max retries exceeded" };
}

/** Helper: извлекает file_id из Telegram-ответа в зависимости от типа вложения. */
function extractFileId(kind: "photo" | "video" | "document", result: TgSendResultData): string | null {
  if (kind === "video") return result.video?.file_id ?? null;
  if (kind === "document") return result.document?.file_id ?? null;
  if (kind === "photo") {
    // photo[] — самый большой обычно последний.
    const arr = result.photo ?? [];
    return arr[arr.length - 1]?.file_id ?? null;
  }
  return null;
}

/**
 * Отправить фото в Telegram (caption = текст сообщения).
 */
/**
 * 25.05.2026, WolfVPN — теперь принимает либо Buffer (первая отправка, upload),
 * либо string (file_id из предыдущей успешной отправки этого же бота — Telegram
 * хранит файл и принимает его строкой без upload). Каноничный приём для broadcast.
 */
async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  caption: string,
  photo: Buffer | string,
  mimeType: string,
  fileName: string,
  replyMarkup: InlineKeyboard | undefined,
  proxy: string | null,
): Promise<TgSendResult> {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  return telegramSendWith429Retry(async () => {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (typeof photo === "string") form.append("photo", photo);
    else form.append("photo", new Blob([photo], { type: mimeType }), fileName || "image");
    if (caption) {
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
    }
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    return await proxyFetch(url, { method: "POST", body: form }, proxy);
  });
}

/**
 * Запускает ffprobe и возвращает {width, height, duration} видео с учётом rotation.
 * 25.05.2026, WolfVPN — нужно для sendVideo, иначе Telegram рисует квадрат-плейсхолдер
 * вместо корректного аспекта (особенно для 9:16 рилсов и нестандартных размеров).
 *
 * iPhone и др. шлют mp4 где stream-размеры landscape (1920×1080), а в metadata
 * есть пометка «rotate 90/270» — реальный аспект vertical (1080×1920). Если
 * передать в sendVideo non-rotated размеры — Telegram нарисует видео в landscape-боксе
 * и оно будет выглядеть растянутым / в чёрных полосах / квадратом. Поэтому
 * детектим rotation (новый формат: side_data_list[].rotation, legacy: tags.rotate)
 * и при 90°/270° СВОПАЕМ width<->height перед отправкой.
 */
function probeVideoMetaSync(buffer: Buffer, fileName: string): { width?: number; height?: number; duration?: number } {
  let tmpDir: string | null = null;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), "vidprobe-"));
    const fpath = join(tmpDir, fileName.replace(/[^\w.-]/g, "_") || "video.mp4");
    writeFileSync(fpath, buffer);
    let out: string;
    try {
      out = execFileSync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_streams",
        "-of", "json",
        fpath,
      ], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
    } catch (e) {
      console.warn("[broadcast] ffprobe spawn failed:", e instanceof Error ? e.message : e);
      return {};
    }

    const parsed = JSON.parse(out) as {
      streams?: {
        width?: number;
        height?: number;
        duration?: string;
        tags?: { rotate?: string };
        side_data_list?: { rotation?: number; side_data_type?: string }[];
      }[];
    };
    const s = parsed.streams?.[0];
    if (!s) return {};

    let w = typeof s.width === "number" ? s.width : undefined;
    let h = typeof s.height === "number" ? s.height : undefined;
    const dur = s.duration ? Math.round(parseFloat(s.duration)) : undefined;

    // Детектим rotation: новый формат (ffmpeg 5+) — side_data_list, legacy — tags.rotate.
    let rotation = 0;
    if (Array.isArray(s.side_data_list)) {
      for (const sd of s.side_data_list) {
        if (typeof sd.rotation === "number") rotation = sd.rotation;
      }
    }
    if (!rotation && s.tags?.rotate) {
      const r = parseInt(s.tags.rotate, 10);
      if (Number.isFinite(r)) rotation = r;
    }
    // Нормализуем — может быть -90 (=270) и т.д.
    const norm = ((rotation % 360) + 360) % 360;
    if ((norm === 90 || norm === 270) && w && h) {
      [w, h] = [h, w];
    }

    return { width: w, height: h, duration: dur };
  } catch (e) {
    console.warn("[broadcast] ffprobe failed:", e instanceof Error ? e.message : e);
    return {};
  } finally {
    if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Генерирует thumbnail (превью первого «не-чёрного» кадра) для видео.
 * 25.05.2026, WolfVPN — Telegram автогенерит thumb из 1-го кадра, но не всегда:
 * для некоторых H264/HEVC контейнеров получается чёрный screen. Делаем сами:
 *   • -ss 00:00:01 — берём 1-ю секунду (часто там уже есть контент, не fade-in)
 *   • -vframes 1 — один кадр
 *   • scale до 320px по большей стороне (требование Telegram thumb: ≤320 + ≤200 KB)
 *   • -q:v 5 — нормальное JPEG качество, обычно <50 KB
 * Возвращает Buffer JPEG или null если ffmpeg недоступен / упал.
 */
function generateVideoThumbnail(buffer: Buffer, fileName: string): Buffer | null {
  let tmpDir: string | null = null;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), "vidthumb-"));
    const inPath = join(tmpDir, fileName.replace(/[^\w.-]/g, "_") || "video.mp4");
    const outPath = join(tmpDir, "thumb.jpg");
    writeFileSync(inPath, buffer);
    try {
      execFileSync("ffmpeg", [
        "-v", "error",
        "-y",
        "-ss", "00:00:01",
        "-i", inPath,
        "-vframes", "1",
        "-vf", "scale='min(320,iw)':'min(320,ih)':force_original_aspect_ratio=decrease",
        "-q:v", "5",
        outPath,
      ], { timeout: 15_000, stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      console.warn("[broadcast] ffmpeg thumb failed:", e instanceof Error ? e.message : e);
      return null;
    }
    if (!existsSync(outPath)) return null;
    const thumb = readFileSync(outPath);
    if (thumb.length === 0 || thumb.length > 200 * 1024) {
      // Telegram режет thumb >200 KB. Если получился больше — просто не шлём
      // (Telegram сам что-то нарисует, лучше чем 400 error).
      console.warn(`[broadcast] thumb too big (${thumb.length} bytes), skipping`);
      return null;
    }
    return thumb;
  } catch (e) {
    console.warn("[broadcast] thumb gen failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Отправить видео в Telegram (caption = текст сообщения). Telegram отрисует
 * нативный плеер с превью; для документа (sendDocument) видео будет просто файлом.
 * 25.05.2026, WolfVPN.
 *   • Передаём width / height / duration из ffprobe — иначе Telegram рисует квадрат.
 *   • supports_streaming=true — позволяет смотреть без полной загрузки.
 */
async function sendTelegramVideo(
  botToken: string,
  chatId: string,
  caption: string,
  video: Buffer | string,
  mimeType: string,
  fileName: string,
  replyMarkup: InlineKeyboard | undefined,
  meta: { width?: number; height?: number; duration?: number } | undefined,
  thumbnail: Buffer | null | undefined,
  proxy: string | null,
): Promise<TgSendResult> {
  const url = `https://api.telegram.org/bot${botToken}/sendVideo`;
  return telegramSendWith429Retry(async () => {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (typeof video === "string") form.append("video", video);
    else form.append("video", new Blob([video], { type: mimeType }), fileName || "video");
    if (caption) {
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
    }
    form.append("supports_streaming", "true");
    if (meta?.width) form.append("width", String(meta.width));
    if (meta?.height) form.append("height", String(meta.height));
    if (meta?.duration) form.append("duration", String(meta.duration));
    // 25.05.2026, WolfVPN — thumbnail передаём ТОЛЬКО при upload бинаря.
    // Для file_id Telegram уже знает превью.
    if (typeof video !== "string" && thumbnail && thumbnail.length > 0) {
      form.append("thumbnail", new Blob([thumbnail], { type: "image/jpeg" }), "thumb.jpg");
    }
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    return await proxyFetch(url, { method: "POST", body: form }, proxy);
  });
}

/**
 * Отправить документ в Telegram (caption = текст сообщения).
 */
async function sendTelegramDocument(
  botToken: string,
  chatId: string,
  caption: string,
  document: Buffer | string,
  mimeType: string,
  fileName: string,
  replyMarkup: InlineKeyboard | undefined,
  proxy: string | null,
): Promise<TgSendResult> {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
  return telegramSendWith429Retry(async () => {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (typeof document === "string") form.append("document", document);
    else form.append("document", new Blob([document], { type: mimeType }), fileName || "file");
    if (caption) {
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
    }
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    return await proxyFetch(url, { method: "POST", body: form }, proxy);
  });
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
/**
 * T-unify (12.05.2026, WolfVPN): группы получателей для broadcast.
 * T-expire-sync (13.05.2026, WolfVPN): точные фильтры через Subscription.expireAt.
 */
export type BroadcastTargetGroup =
  | "all"               // Все клиенты (с telegramId/email)
  | "active_subs"       // У клиента есть хоть одна неистёкшая подписка (expireAt > now)
  | "expired_subs"      // У клиента есть подписки, но ВСЕ истекли (expireAt <= now)
  | "with_any_subs"     // У клиента есть любая подписка (активная или истёкшая)
  | "without_subs"      // У клиента нет подписок вообще
  | "standard_subs"     // Активная подписка со Стандартным тарифом (menuEmoji=🌐)
  | "unblock_subs"      // Активная подписка с Unblock (menuEmoji=🔒)
  | "unblock_unlimited" // Активная подписка с Безлимитным Unblock (menuEmoji=♾️🔒)
  ;

function buildClientWhereForGroup(group: BroadcastTargetGroup | undefined, base: Prisma.ClientWhereInput): Prisma.ClientWhereInput {
  if (!group || group === "all") return base;
  if (group === "without_subs") {
    return { ...base, ownedSubscriptions: { none: {} } };
  }
  if (group === "with_any_subs") {
    return { ...base, ownedSubscriptions: { some: {} } };
  }
  const now = new Date();
  if (group === "active_subs") {
    // Точный фильтр: хотя бы одна подписка с expireAt > now (или expireAt=null для свежих).
    return {
      ...base,
      ownedSubscriptions: {
        some: {
          OR: [{ expireAt: { gt: now } }, { expireAt: null }],
        },
      },
    };
  }
  if (group === "expired_subs") {
    // У клиента есть подписки И все они истекли (expireAt <= now).
    return {
      ...base,
      ownedSubscriptions: { some: {} },
      NOT: {
        ownedSubscriptions: {
          some: {
            OR: [{ expireAt: { gt: now } }, { expireAt: null }],
          },
        },
      },
    };
  }
  // Тарифные фильтры: хотя бы одна АКТИВНАЯ подписка с этим тарифом.
  const activeFilter = { OR: [{ expireAt: { gt: now } }, { expireAt: null }] };
  if (group === "standard_subs") {
    return { ...base, ownedSubscriptions: { some: { tariff: { menuEmoji: "🌐" }, ...activeFilter } } };
  }
  if (group === "unblock_subs") {
    return { ...base, ownedSubscriptions: { some: { tariff: { menuEmoji: "🔒" }, ...activeFilter } } };
  }
  if (group === "unblock_unlimited") {
    return { ...base, ownedSubscriptions: { some: { tariff: { menuEmoji: "♾️🔒" }, ...activeFilter } } };
  }
  return base;
}

export async function runBroadcast(options: {
  channel: BroadcastChannel;
  subject: string;
  message: string;
  attachment?: BroadcastAttachment;
  buttonText?: string;
  buttonUrl?: string;
  buttonsConfig?: string | null;
  targetGroup?: BroadcastTargetGroup;
  onProgress?: (p: BroadcastProgress) => void;
  /** 19.05.2026, WolfVPN — проверяется перед каждой отправкой. Если вернёт true, рассылка прерывается. */
  isCancelled?: () => boolean;
  /** 25.05.2026, WolfVPN — id записи в broadcast_history. Нужно для persistent log
   *  и auto-resume (skip уже отправленных tgid'ов). Без него log пишется не будет. */
  broadcastId?: string;
}): Promise<BroadcastResult & { cancelled?: boolean }> {
  const { channel, subject, message, attachment, buttonText, buttonUrl, buttonsConfig, targetGroup, onProgress, isCancelled, broadcastId } = options;
  const result: BroadcastResult & { cancelled?: boolean } = {
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
  // 25.05.2026, WolfVPN — добавили ветку video/* → sendVideo (нативный плеер
  // с превью в Telegram, в отличие от sendDocument где видео — просто файл).
  const isVideo = attachment?.mimetype?.startsWith("video/") ?? false;
  // 25.05.2026, WolfVPN — одноразовый probe видео для width/height/duration:
  // иначе Telegram рисует квадрат-плейсхолдер при отсутствии явных размеров.
  // Делается ОДИН раз перед циклом (не на каждого получателя).
  const videoMeta = isVideo && attachment ? probeVideoMetaSync(attachment.buffer, attachment.originalname) : {};
  // 25.05.2026, WolfVPN — также генерим thumbnail (первый «не-чёрный» кадр).
  // Telegram сам автогенерит, но не всегда — иногда превью чёрное. Делаем сами.
  const videoThumb = isVideo && attachment ? generateVideoThumbnail(attachment.buffer, attachment.originalname) : null;
  if (isVideo) {
    console.log(`[broadcast] video metadata: ${JSON.stringify(videoMeta)}  thumb=${videoThumb ? videoThumb.length + "B" : "none"}`);
  }
  const replyMarkup = resolveReplyMarkup({ buttonsConfig, buttonText, buttonUrl }, config.publicAppUrl);

  // T-unify (12.05.2026, WolfVPN): применяем фильтр targetGroup к where-clause.
  const whereTelegram = buildClientWhereForGroup(targetGroup, { telegramId: { not: null } });
  const whereEmail = buildClientWhereForGroup(targetGroup, { email: { not: null } });
  // Предварительно считаем получателей, чтобы фронт мог сразу показать "X из Y".
  const [totalTelegram, totalEmail] = await Promise.all([
    doTelegram ? prisma.client.count({ where: whereTelegram }) : Promise.resolve(0),
    doEmail ? prisma.client.count({ where: whereEmail }) : Promise.resolve(0),
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
      // 25.05.2026, WolfVPN — proxy URL берём ОДИН раз перед циклом
      // (раньше каждое сообщение делало getSystemConfig() → 50k DB roundtrips).
      const telegramProxy = await getProxyUrl("telegram");
      console.log(`[broadcast] telegram proxy: ${telegramProxy ? "configured" : "direct"}`);

      // 25.05.2026 — детерминированный порядок + auto-resume через broadcast_sent_log.
      const clients = await prisma.client.findMany({
        where: whereTelegram,
        select: { id: true, telegramId: true },
        orderBy: { id: "asc" },
      });

      let alreadySent: Set<string> = new Set();
      if (broadcastId) {
        try {
          const sentRows = await prisma.broadcastSentLog.findMany({
            where: { broadcastId },
            select: { tgid: true },
          });
          alreadySent = new Set(sentRows.map((r: { tgid: string }) => r.tgid));
          if (alreadySent.size > 0) {
            console.log(`[broadcast] resume: ${alreadySent.size} tgid'ов уже отправлены — skip`);
            result.sentTelegram = alreadySent.size;
          }
        } catch (e) {
          console.warn("[broadcast] resume log load failed:", e instanceof Error ? e.message : e);
        }
      }

      const queue = clients.filter((c) => c.telegramId && !alreadySent.has(c.telegramId!.trim()));
      // 25.05.2026, WolfVPN — выбираем concurrency/delay по типу вложения.
      const hasMedia = isImage || isVideo || (attachment && !isImage && !isVideo);
      const concurrency = hasMedia ? TELEGRAM_MEDIA_CONCURRENCY : TELEGRAM_TEXT_CONCURRENCY;
      const sendDelay = hasMedia ? TELEGRAM_MEDIA_DELAY_MS : TELEGRAM_TEXT_DELAY_MS;
      console.log(`[broadcast] telegram: ${clients.length} matched, ${queue.length} to send (media=${hasMedia}, concurrency=${concurrency}, delay=${sendDelay}ms)`);

      // 25.05.2026, WolfVPN — file_id reuse: первая отправка загружает binary,
      // получаем file_id из ответа Telegram, дальнейшие отправки идут строкой
      // (без upload). Снижает bandwidth в N раз и нагрузку на Telegram bot API.
      let cachedFileId: string | null = null;

      // Helper отправляет одного получателя + пишет в sent_log если broadcastId задан.
      const sendOne = async (tid: string): Promise<void> => {
        let send: TgSendResult;
        if (attachment) {
          const fileArg: Buffer | string = cachedFileId ?? attachment.buffer;
          if (isImage) {
            send = await sendTelegramPhoto(botToken, tid, message, fileArg, attachment.mimetype, attachment.originalname, replyMarkup, telegramProxy);
          } else if (isVideo) {
            send = await sendTelegramVideo(botToken, tid, message, fileArg, attachment.mimetype, attachment.originalname, replyMarkup, videoMeta, videoThumb, telegramProxy);
          } else {
            send = await sendTelegramDocument(botToken, tid, message, fileArg, attachment.mimetype, attachment.originalname, replyMarkup, telegramProxy);
          }
        } else {
          send = await sendTelegramMessage(botToken, tid, message, replyMarkup, telegramProxy);
        }

        if (send.ok) {
          result.sentTelegram++;
          // Кешируем file_id после ПЕРВОЙ успешной отправки media-вложения.
          if (attachment && !cachedFileId) {
            const kind = isImage ? "photo" : isVideo ? "video" : "document";
            const fid = extractFileId(kind, send.result);
            if (fid) {
              cachedFileId = fid;
              console.log(`[broadcast] file_id cached after 1st send: ${fid.substring(0, 20)}… (kind=${kind})`);
            }
          }
          if (broadcastId) {
            // Best-effort INSERT — если упадёт (unique violation на retry/race), игнорируем.
            prisma.broadcastSentLog.create({
              data: { broadcastId, tgid: tid },
            }).catch(() => { /* duplicate / FK gone — норм */ });
          }
        } else {
          result.failedTelegram++;
          if (result.errors.length < 10) result.errors.push(`Telegram ${tid}: ${send.error ?? "error"}`);
        }
      };

      // Concurrent pool: N воркеров берут задачи из очереди.
      // 25.05.2026 — каждый воркер делает delay(TELEGRAM_SEND_DELAY_MS) ПЕРЕД sendOne,
      // чтобы под глобальный rate ≈ N × (1000/DELAY) сообщений/сек (~200/s при 8×40),
      // но 429-retry внутри send-функций мягко дросселирует если Telegram ругается.
      let nextIdx = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          if (isCancelled?.()) { result.cancelled = true; return; }
          const idx = nextIdx++;
          if (idx >= queue.length) return;
          const c = queue[idx];
          const tid = c.telegramId!.trim();
          if (!tid) continue;
          await delay(sendDelay);
          await sendOne(tid);
          // Report не чаще раз в ~50 сообщений чтобы не дёргать DB-progress-write.
          if (idx % 50 === 0) report();
        }
      };

      const workers = Array.from({ length: concurrency }, () => worker());
      await Promise.all(workers);
      report();
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
        where: whereEmail,
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
        if (isCancelled?.()) { result.cancelled = true; break; }
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

export type BroadcastJobStatus = "running" | "completed" | "error" | "cancelled";

export type BroadcastJob = {
  id: string;
  status: BroadcastJobStatus;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
  result?: BroadcastResult & { cancelled?: boolean };
  progress: BroadcastProgress;
  /** 19.05.2026, WolfVPN — флаг ставится cancelBroadcastJob() и проверяется в runBroadcast() */
  cancelRequested: boolean;
};

const broadcastJobs = new Map<string, BroadcastJob>();

// Автоочистка: удаляем завершённые джобы старше 1 часа раз в 10 минут.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of broadcastJobs) {
    if (job.finishedAt && job.finishedAt.getTime() < cutoff) broadcastJobs.delete(id);
  }
}, 10 * 60 * 1000).unref?.();

/**
 * 25.05.2026, WolfVPN — путь к общему диску для attachment'ов между api и
 * broadcast-worker. Объявлен как shared volume в docker-compose.
 */
const ATTACHMENT_DIR = process.env.BROADCAST_ATTACHMENT_DIR || "/data/broadcast-attachments";

async function saveAttachmentToDisk(jobId: string, attachment: BroadcastAttachment): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(ATTACHMENT_DIR, { recursive: true });
  const safeName = attachment.originalname.replace(/[^\w.-]/g, "_") || "file";
  const path = `${ATTACHMENT_DIR}/${jobId}__${safeName}`;
  await writeFile(path, attachment.buffer);
  return path;
}

/**
 * 25.05.2026, WolfVPN — рассылка теперь обрабатывается ОТДЕЛЬНЫМ контейнером
 * stealthnet-broadcast-worker. API только кладёт задачу в очередь (DB row
 * status='pending' + attachment на shared volume) и сразу возвращает jobId.
 * Worker polling'ом подхватит и запустит runBroadcast в своём процессе —
 * event-loop api остаётся свободным для bot/UI запросов.
 */
export async function startBroadcastJob(options: {
  channel: BroadcastChannel;
  subject: string;
  message: string;
  attachment?: BroadcastAttachment;
  buttonText?: string;
  buttonUrl?: string;
  buttonsConfig?: string | null;
  /** T-unify (12.05.2026, WolfVPN): целевая группа получателей. */
  targetGroup?: BroadcastTargetGroup;
  startedByAdmin?: string;
  /** Resume: переиспользуем существующую запись broadcast_history. */
  resumeJobId?: string;
}): Promise<string> {
  const jobId = options.resumeJobId ?? randomUUID();

  // 1. Сохраняем attachment на shared volume (если есть).
  let attachmentPath: string | null = null;
  if (options.attachment) {
    try {
      attachmentPath = await saveAttachmentToDisk(jobId, options.attachment);
    } catch (e) {
      console.error("[broadcast] failed to save attachment to disk:", e instanceof Error ? e.message : e);
      throw new Error("Failed to save attachment");
    }
  }

  // 2. Создаём/обновляем DB row со status='pending'. Worker подхватит.
  try {
    if (options.resumeJobId) {
      await prisma.broadcastHistory.update({
        where: { id: jobId },
        data: {
          status: "pending",
          finishedAt: null,
          error: null,
          cancelRequested: false,
          attachmentName: options.attachment?.originalname ?? null,
          attachmentPath: attachmentPath,
          attachmentMime: options.attachment?.mimetype ?? null,
          targetGroup: options.targetGroup ?? null,
        },
      });
      console.log(`[broadcast] queued for resume: ${jobId}`);
    } else {
      await prisma.broadcastHistory.create({
        data: {
          id: jobId,
          status: "pending",
          channel: options.channel,
          subject: options.subject ?? "",
          message: options.message,
          buttonText: options.buttonText || null,
          buttonUrl: options.buttonUrl || null,
          // Новый конструктор кнопок (произвольное число). null → fallback на button*.
          ...(options.buttonsConfig != null ? { buttonsConfig: options.buttonsConfig } : {}),
          attachmentName: options.attachment?.originalname || null,
          attachmentPath: attachmentPath,
          attachmentMime: options.attachment?.mimetype || null,
          targetGroup: options.targetGroup || null,
          startedByAdmin: options.startedByAdmin || null,
        } as Parameters<typeof prisma.broadcastHistory.create>[0]["data"],
      });
      console.log(`[broadcast] queued: ${jobId} (worker will pick up within ~3s)`);
    }
  } catch (e) {
    console.error("[broadcast] failed to queue:", e instanceof Error ? e.message : e);
    throw e;
  }

  return jobId;
}

/**
 * 25.05.2026, WolfVPN — статус ТЕПЕРЬ читается из DB, а не из in-memory map
 * (рассылка теперь в отдельном worker-процессе, in-memory map api не виден).
 */
export async function getBroadcastJob(jobId: string): Promise<BroadcastJob | null> {
  const row = await prisma.broadcastHistory.findUnique({ where: { id: jobId } });
  if (!row) return null;
  return {
    id: row.id,
    status: (row.status as BroadcastJobStatus),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
    error: row.error ?? undefined,
    progress: {
      totalTelegram: row.totalTelegram,
      totalEmail: row.totalEmail,
      sentTelegram: row.sentTelegram,
      sentEmail: row.sentEmail,
      failedTelegram: row.failedTelegram,
      failedEmail: row.failedEmail,
    },
    cancelRequested: row.cancelRequested,
  };
}

/**
 * 19.05.2026, WolfVPN — попросить активную рассылку остановиться.
 * Реальное прерывание произойдёт **между сообщениями** (после текущего sendMessage),
 * так что cancel почти мгновенный (≤ TELEGRAM_SEND_DELAY_MS).
 * Возвращает причину если отмена невозможна.
 */
/**
 * 25.05.2026, WolfVPN — cancel ТЕПЕРЬ через БД (рассылка в отдельном worker'е).
 * SET cancel_requested=true → worker увидит при следующем чекинге и прервётся.
 */
export async function cancelBroadcastJob(jobId: string): Promise<{ ok: boolean; reason?: "not_found" | "not_running" | "already_cancelled" }> {
  const row = await prisma.broadcastHistory.findUnique({ where: { id: jobId } });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "running" && row.status !== "pending") return { ok: false, reason: "not_running" };
  if (row.cancelRequested) return { ok: false, reason: "already_cancelled" };
  await prisma.broadcastHistory.update({
    where: { id: jobId },
    data: { cancelRequested: true },
  });
  return { ok: true };
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
