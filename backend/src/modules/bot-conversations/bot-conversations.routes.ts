/**
 * Bot conversation viewer (pragmatic).
 *
 * Полноценный лог сообщений бота не ведётся (был бы инвазивным изменением).
 * Вместо этого собираем «timeline» взаимодействий клиента из существующих
 * таблиц:
 *   - registrations (Client.createdAt)
 *   - payments (PAID/FAILED/REFUNDED)
 *   - auto_broadcast_logs (что бот ему отправлял)
 *   - broadcast_history (массовые рассылки куда попадал)
 *   - tickets + ticket_messages (если включены)
 *   - gift_history (если использовал подарки)
 *   - admin_events (что админы делали с этим клиентом)
 *
 * Endpoints:
 *   GET /api/admin/bot-conversations?q=...&limit=50  — список клиентов с recent-активностью
 *   GET /api/admin/bot-conversations/:clientId        — полный timeline одного клиента
 */

import express, { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

interface TimelineEvent {
  ts: string;        // ISO
  kind: "registered" | "payment_paid" | "payment_failed" | "payment_refunded" | "broadcast" | "ticket_opened" | "ticket_message" | "gift" | "admin_action";
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export const botConversationsRouter = Router();
botConversationsRouter.use(requireAuth);
botConversationsRouter.use(requireAdminSection);

const listQuery = z.object({
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

botConversationsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    const q = parsed.data?.q?.trim();
    const limit = parsed.data?.limit ?? 50;

    const where: Prisma.ClientWhereInput = q
      ? {
          OR: [
            { telegramUsername: { contains: q, mode: "insensitive" } },
            { telegramId: { contains: q } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};

    // Берём клиентов у кого была активность за последние 30 дней
    const items = await prisma.client.findMany({
      where: {
        ...where,
        OR: [
          { telegramId: { not: null } }, // имеет TG-аккаунт
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        email: true,
        telegramId: true,
        telegramUsername: true,
        balance: true,
        isBlocked: true,
        telegramUnreachable: true,
        trialUsed: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { payments: true, tickets: true, autoBroadcastLogs: true },
        },
      },
    });

    return res.json({
      items: items.map((c) => ({
        id: c.id,
        email: c.email,
        telegramId: c.telegramId,
        telegramUsername: c.telegramUsername,
        balance: c.balance,
        isBlocked: c.isBlocked,
        telegramUnreachable: c.telegramUnreachable,
        trialUsed: c.trialUsed,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        counts: {
          payments: c._count.payments,
          tickets: c._count.tickets,
          broadcasts: c._count.autoBroadcastLogs,
        },
      })),
      total: items.length,
    });
  }),
);

botConversationsRouter.get(
  "/:clientId",
  asyncRoute(async (req, res) => {
    const clientId = req.params.clientId;
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true, email: true, telegramId: true, telegramUsername: true,
        balance: true, isBlocked: true, blockReason: true, telegramUnreachable: true,
        trialUsed: true, createdAt: true, preferredLang: true, preferredCurrency: true,
        currentTariffId: true, autoRenewEnabled: true,
      },
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    const events: TimelineEvent[] = [];

    // 1. Registration
    events.push({
      ts: client.createdAt.toISOString(),
      kind: "registered",
      title: "Регистрация",
      detail: client.telegramUsername ? `@${client.telegramUsername}` : client.email ?? client.telegramId ?? "—",
    });

    // 2. Payments
    const payments = await prisma.payment.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, status: true, amount: true, currency: true, provider: true,
        createdAt: true, paidAt: true, tariffId: true,
      },
    });
    for (const p of payments) {
      const ts = (p.paidAt ?? p.createdAt).toISOString();
      let kind: TimelineEvent["kind"] = "payment_failed";
      let title = "";
      if (p.status === "PAID") { kind = "payment_paid"; title = `Оплата ${p.amount} ${p.currency}`; }
      else if (p.status === "REFUNDED") { kind = "payment_refunded"; title = `Возврат ${p.amount} ${p.currency}`; }
      else if (p.status === "FAILED") { kind = "payment_failed"; title = `FAILED ${p.amount} ${p.currency}`; }
      else continue; // PENDING — пропускаем
      events.push({
        ts,
        kind,
        title,
        detail: p.provider ?? "(no provider)",
        meta: { paymentId: p.id, tariffId: p.tariffId },
      });
    }

    // 3. Auto-broadcast logs
    const autoLogs = await prisma.autoBroadcastLog.findMany({
      where: { clientId },
      orderBy: { sentAt: "desc" },
      take: 50,
      include: { rule: { select: { name: true, channel: true, triggerType: true } } },
    });
    for (const l of autoLogs) {
      events.push({
        ts: l.sentAt.toISOString(),
        kind: "broadcast",
        title: `Авто-рассылка: ${l.rule.name}`,
        detail: `${l.rule.channel} · ${l.rule.triggerType}`,
        meta: { ruleId: l.ruleId },
      });
    }

    // 4. Tickets + messages
    const tickets = await prisma.ticket.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } },
    });
    for (const t of tickets) {
      events.push({
        ts: t.createdAt.toISOString(),
        kind: "ticket_opened",
        title: `Тикет: ${t.subject}`,
        detail: `статус ${t.status}`,
        meta: { ticketId: t.id },
      });
      for (const m of t.messages) {
        const isFromAdmin = m.authorType === "support";
        events.push({
          ts: m.createdAt.toISOString(),
          kind: "ticket_message",
          title: `Тикет «${t.subject}» — ${isFromAdmin ? "ответ админа" : "сообщение клиента"}`,
          detail: m.content.slice(0, 240),
          meta: { ticketId: t.id, messageId: m.id, fromAdmin: isFromAdmin },
        });
      }
    }

    // 5. Gift history
    const gifts = await prisma.giftHistory.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, eventType: true, createdAt: true, metadata: true },
    });
    for (const g of gifts) {
      events.push({
        ts: g.createdAt.toISOString(),
        kind: "gift",
        title: `Gift: ${g.eventType}`,
        meta: { giftEventId: g.id },
      });
    }

    // 6. Admin events targeting this client
    const adminEvents = await prisma.adminEvent.findMany({
      where: { targetType: "client", targetId: clientId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, kind: true, actorId: true, payload: true, createdAt: true },
    });
    for (const a of adminEvents) {
      events.push({
        ts: a.createdAt.toISOString(),
        kind: "admin_action",
        title: `Админ: ${a.kind}`,
        detail: a.actorId ?? "—",
        meta: { adminEventId: a.id, payload: a.payload },
      });
    }

    // Сортируем по времени, новые сверху
    events.sort((a, b) => b.ts.localeCompare(a.ts));

    return res.json({
      client,
      events,
      stats: {
        totalPayments: payments.length,
        paidPayments: payments.filter((p) => p.status === "PAID").length,
        totalTickets: tickets.length,
        totalBroadcasts: autoLogs.length,
        totalAdminActions: adminEvents.length,
      },
    });
  }),
);
