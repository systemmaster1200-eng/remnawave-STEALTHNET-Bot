/**
 * Inbox bell counters — то что должно «пинговать» админа в реальном времени.
 * Считается каждый раз при запросе (дёшево для текущих масштабов; на больших
 * можно кешировать в memory с TTL 30s).
 *
 * Сейчас считаем:
 *   - tickets:        новые/непрочитанные тикеты от клиентов
 *   - webhookErrors:  webhook'и с outcome != accepted за последние 24ч
 *   - failedPayments: платежи в FAILED статусе за последние 24ч
 *   - draftBackups:   неудавшиеся auto-backup'ы за последние 7д
 *   - pendingLanding: блоки лендинга с draft'ом (не опубликовано)
 *   - cronFailures:   cron-задачи у которых последний запуск был с ошибкой
 *
 * Каждое — отдельное число + URL куда вести админа по клику.
 */

import express, { Router } from "express";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { listCronEntries } from "../diagnostics/cron-registry.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export interface NotificationCounter {
  key: string;
  label: string;
  count: number;
  url: string;
  severity: "info" | "warn" | "error";
}

export const notificationsCountersRouter = Router();
notificationsCountersRouter.use(requireAuth);
notificationsCountersRouter.use(requireAdminSection);

notificationsCountersRouter.get(
  "/counters",
  asyncRoute(async (_req, res) => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const counters: NotificationCounter[] = [];

    // 1. Open tickets (status=open).
    try {
      const tickets = await prisma.ticket.count({ where: { status: "open" } });
      if (tickets > 0) {
        counters.push({
          key: "tickets",
          label: "Открытых тикетов",
          count: tickets,
          url: "/admin/tickets",
          severity: tickets > 5 ? "warn" : "info",
        });
      }
    } catch { /* table may not exist on fresh installs */ }

    // 2. Webhook errors (rejected/error за 24h).
    try {
      const webhookErrors = await prisma.webhookEvent.count({
        where: {
          createdAt: { gte: since24h },
          outcome: { in: ["rejected_signature", "rejected_payload", "error"] },
        },
      });
      if (webhookErrors > 0) {
        counters.push({
          key: "webhook_errors",
          label: "Ошибок webhook'ов за 24ч",
          count: webhookErrors,
          url: "/admin/webhook-inbox",
          severity: webhookErrors > 3 ? "error" : "warn",
        });
      }
    } catch { /* webhook_events table may not exist on legacy installs */ }

    // 3. Failed payments (FAILED за 24h, по дате создания).
    const failedPayments = await prisma.payment.count({
      where: { status: "FAILED", createdAt: { gte: since24h } },
    });
    if (failedPayments > 0) {
      counters.push({
        key: "failed_payments",
        label: "Неудачных платежей за 24ч",
        count: failedPayments,
        url: "/admin/sales-report?status=FAILED",
        severity: failedPayments > 5 ? "warn" : "info",
      });
    }

    // 4. Pending landing drafts (черновики не опубликованы).
    try {
      const drafts = await prisma.landingBlock.count({
        where: { OR: [{ propsDraft: { not: undefined } }, { i18nDraft: { not: undefined } }] },
      });
      if (drafts > 0) {
        counters.push({
          key: "landing_drafts",
          label: "Черновиков лендинга",
          count: drafts,
          url: "/admin/landing-editor",
          severity: "info",
        });
      }
    } catch { /* landing_blocks may not exist on older schema */ }

    // 5. Cron failures (последний run с ошибкой за 7d).
    const crons = listCronEntries();
    const cronFailures = crons.filter((c) => {
      const last = c.recent[0];
      return last && !last.ok && new Date(last.startedAt) >= since7d;
    });
    if (cronFailures.length > 0) {
      counters.push({
        key: "cron_failures",
        label: "Сбойных cron-задач",
        count: cronFailures.length,
        url: "/admin/diagnostics",
        severity: "warn",
      });
    }

    // 6. Failed contests draws (неудачные результаты розыгрыша за 7d).
    try {
      const contestDrawFails = await prisma.contestEvent.count({
        where: { kind: "draw_failed", createdAt: { gte: since7d } },
      });
      if (contestDrawFails > 0) {
        counters.push({
          key: "contest_draw_failures",
          label: "Неудачных розыгрышей",
          count: contestDrawFails,
          url: "/admin/contests",
          severity: "warn",
        });
      }
    } catch { /* contest_events table may not exist on legacy installs */ }

    return res.json({ counters, total: counters.reduce((s, c) => s + c.count, 0) });
  }),
);
