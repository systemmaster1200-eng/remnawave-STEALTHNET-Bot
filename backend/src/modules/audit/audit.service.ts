/**
 * Универсальный аудит-лог админских действий.
 *
 * Используется как явный helper из admin-роутов:
 *   await logAdmin(req, "client.block", { type: "client", id: clientId }, { reason });
 *
 * Дешёвая операция (один INSERT), не критична. Никогда не должна падать
 * вызов admin-эндпоинта — все ошибки глотаются.
 */

import type express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

export interface AuditTarget {
  /** "client" | "payment" | "tariff" | "contest" | "settings" | "promo_group" | "gift_code" | "tariff_category" | "promo_code" | "broadcast" | "ticket" | "admin" | ... */
  type: string;
  id?: string | null;
}

function extractActorId(req: express.Request): string | null {
  const ext = req as express.Request & { adminEmail?: string; adminId?: string };
  return ext.adminEmail ?? ext.adminId ?? null;
}

function extractActorIp(req: express.Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim().slice(0, 64);
  if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).trim().slice(0, 64);
  if (req.ip) return req.ip.slice(0, 64);
  return null;
}

/**
 * Записать событие в аудит-лог. Ошибки глотаются.
 */
export async function logAdminEvent(
  kind: string,
  actorId: string | null,
  actorIp: string | null,
  target: AuditTarget | null,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.adminEvent.create({
      data: {
        kind,
        actorId: actorId ?? null,
        actorIp: actorIp ?? null,
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        payload: payload === undefined ? Prisma.JsonNull : (payload as Prisma.InputJsonValue),
      },
    });
  } catch (e) {
    console.error(`[audit] failed to log ${kind}:`, e);
  }
}

/** Convenience-обёртка которая вытаскивает actor/ip из req. */
export async function logAdmin(
  req: express.Request,
  kind: string,
  target?: AuditTarget,
  payload?: Record<string, unknown>,
): Promise<void> {
  return logAdminEvent(kind, extractActorId(req), extractActorIp(req), target ?? null, payload);
}

// ─── Query API ──────────────────────────────────────────────────────────────

export interface AuditQuery {
  kind?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  /** Полнотекстовый поиск по kind + actorId + targetId. */
  q?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  cursor?: string;
}

export async function listAdminEvents(query: AuditQuery) {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const where: Prisma.AdminEventWhereInput = {};
  if (query.kind) where.kind = query.kind;
  if (query.actorId) where.actorId = query.actorId;
  if (query.targetType) where.targetType = query.targetType;
  if (query.targetId) where.targetId = query.targetId;
  if (query.dateFrom || query.dateTo) {
    where.createdAt = {};
    if (query.dateFrom) where.createdAt.gte = query.dateFrom;
    if (query.dateTo) where.createdAt.lte = query.dateTo;
  }
  if (query.q?.trim()) {
    const q = query.q.trim();
    where.OR = [
      { kind: { contains: q, mode: "insensitive" } },
      { actorId: { contains: q, mode: "insensitive" } },
      { targetId: { contains: q, mode: "insensitive" } },
    ];
  }

  const events = await prisma.adminEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });

  const hasMore = events.length > limit;
  const items = hasMore ? events.slice(0, limit) : events;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}

/** Уникальные значения для filters (kind / actorId / targetType) — для UI dropdown'ов. */
export async function getAuditFacets() {
  const [kinds, actors, targetTypes] = await Promise.all([
    prisma.adminEvent.findMany({ distinct: ["kind"], select: { kind: true }, take: 200 }),
    prisma.adminEvent.findMany({ distinct: ["actorId"], select: { actorId: true }, where: { actorId: { not: null } }, take: 100 }),
    prisma.adminEvent.findMany({ distinct: ["targetType"], select: { targetType: true }, where: { targetType: { not: null } }, take: 100 }),
  ]);
  return {
    kinds: kinds.map((k) => k.kind).filter(Boolean).sort(),
    actors: actors.map((a) => a.actorId).filter((x): x is string => !!x).sort(),
    targetTypes: targetTypes.map((t) => t.targetType).filter((x): x is string => !!x).sort(),
  };
}
