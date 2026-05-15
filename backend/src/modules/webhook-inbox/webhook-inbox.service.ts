/**
 * Сервис записи входящих webhook'ов в БД.
 *
 * Используется как helper из webhook-handler'ов. Каждый handler в начале вызывает
 * `recordWebhook()` и в конце обновляет результат через `markOutcome()`.
 * При ошибках записи НЕ блокируем обработку самого webhook'а.
 */

import type express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

export type WebhookOutcome =
  | "accepted"
  | "rejected_signature"
  | "rejected_payload"
  | "payment_not_found"
  | "payment_already_paid"
  | "payment_failed"
  | "ignored_event"
  | "error";

export interface CapturedWebhook {
  id: string | null;
  startedAt: number;
}

function pickHeaders(req: express.Request): Record<string, string> {
  const out: Record<string, string> = {};
  // Только relevant заголовки чтобы не хранить cookies/auth-tokens пользователей.
  const allowed = ["x-signature", "signature", "authorization", "content-type", "user-agent", "x-forwarded-for", "x-real-ip"];
  for (const k of allowed) {
    const v = req.headers[k];
    if (typeof v === "string" && v.length > 0) out[k] = v.length > 1024 ? v.slice(0, 1024) : v;
  }
  return out;
}

function extractIp(req: express.Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim().slice(0, 64);
  if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).trim().slice(0, 64);
  if (req.ip) return req.ip.slice(0, 64);
  return null;
}

/**
 * Записать "сырой" webhook сразу при его получении. Возвращает id и стартовое время
 * для последующего markOutcome().
 *
 * Truncates rawBody до 64KB (большинство payload'ов сильно меньше).
 */
export async function recordWebhook(
  provider: string,
  req: express.Request,
  rawBody: Buffer | string,
): Promise<CapturedWebhook> {
  const startedAt = Date.now();
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const truncated = bodyStr.length > 65_536 ? bodyStr.slice(0, 65_536) + "...[truncated]" : bodyStr;

  try {
    const ev = await prisma.webhookEvent.create({
      data: {
        provider,
        rawBody: truncated,
        headers: pickHeaders(req) as Prisma.InputJsonValue,
        remoteIp: extractIp(req),
        responseStatus: 0, // ещё не ответили
        outcome: "ignored_event", // placeholder, перезапишет markOutcome
      },
    });
    return { id: ev.id, startedAt };
  } catch (e) {
    console.error(`[webhook-inbox] failed to record ${provider}:`, e);
    return { id: null, startedAt };
  }
}

/**
 * Обновить запись webhook'а финальным результатом. Если recordWebhook вернул id=null
 * (запись провалилась), молча игнорируем.
 */
export async function markOutcome(
  captured: CapturedWebhook,
  responseStatus: number,
  outcome: WebhookOutcome,
  opts?: { errorMessage?: string; paymentId?: string | null },
): Promise<void> {
  if (!captured.id) return;
  try {
    await prisma.webhookEvent.update({
      where: { id: captured.id },
      data: {
        responseStatus,
        outcome,
        errorMessage: opts?.errorMessage ?? null,
        paymentId: opts?.paymentId ?? null,
        durationMs: Date.now() - captured.startedAt,
      },
    });
  } catch (e) {
    console.error(`[webhook-inbox] failed to mark outcome:`, e);
  }
}

// ─── Query API ──────────────────────────────────────────────────────────────

export interface WebhookQuery {
  provider?: string;
  outcome?: WebhookOutcome;
  paymentId?: string;
  q?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  cursor?: string;
}

export async function listWebhookEvents(query: WebhookQuery) {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const where: Prisma.WebhookEventWhereInput = {};
  if (query.provider) where.provider = query.provider;
  if (query.outcome) where.outcome = query.outcome;
  if (query.paymentId) where.paymentId = query.paymentId;
  if (query.dateFrom || query.dateTo) {
    where.createdAt = {};
    if (query.dateFrom) where.createdAt.gte = query.dateFrom;
    if (query.dateTo) where.createdAt.lte = query.dateTo;
  }
  if (query.q?.trim()) {
    const q = query.q.trim();
    where.OR = [
      { paymentId: { contains: q, mode: "insensitive" } },
      { errorMessage: { contains: q, mode: "insensitive" } },
      { rawBody: { contains: q, mode: "insensitive" } },
    ];
  }

  const events = await prisma.webhookEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: {
      id: true,
      provider: true,
      remoteIp: true,
      responseStatus: true,
      outcome: true,
      errorMessage: true,
      paymentId: true,
      durationMs: true,
      replayedBy: true,
      replayOfId: true,
      createdAt: true,
      // rawBody/headers НЕ берём в list — они тяжёлые. Берутся в getById.
    },
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });

  const hasMore = events.length > limit;
  const items = hasMore ? events.slice(0, limit) : events;
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}

export async function getWebhookEvent(id: string) {
  return prisma.webhookEvent.findUnique({ where: { id } });
}

/**
 * Replay: создаёт http-запрос к нашему же webhook-эндпоинту с тем же body+headers.
 * Сам replay помечается как WebhookEvent со ссылкой на original.
 */
export async function replayWebhook(
  id: string,
  actorId: string | null,
  baseUrl: string,
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const original = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!original) return { ok: false, error: "Webhook event not found" };

  const endpoint = `${baseUrl}/api/webhooks/${original.provider}`;
  const headers: Record<string, string> = {};
  const origHeaders = (original.headers ?? {}) as Record<string, string>;
  for (const [k, v] of Object.entries(origHeaders)) {
    if (typeof v === "string") headers[k] = v;
  }
  // Маркер в headers — чтобы handler не плодил бесконечный replay loop.
  headers["x-replay-from"] = id;
  if (actorId) headers["x-replay-actor"] = actorId;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: original.rawBody,
      signal: AbortSignal.timeout(30_000),
    });
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
