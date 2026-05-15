/**
 * Bulk-actions для админа: применить одну операцию к массиву клиентов сразу.
 *
 * Поддерживаемые действия:
 *   - block / unblock — выставить is_blocked + причина
 *   - credit_balance — увеличить баланс на amount (валюта берётся из preferred_currency клиента)
 *   - debit_balance  — уменьшить (с проверкой ≥ 0)
 *   - reset_trial    — снять trial_used (чтобы клиент мог снова взять триал)
 *   - mark_unreachable / mark_reachable — флажок «бот недоступен»
 *
 * Все операции идут одним батчем, но с per-client error tracking — если на одном
 * клиенте упало, остальные продолжают. Возвращаем сводку { ok, failed, errors[] }.
 *
 * Каждое действие логируется в admin_events с targetType=client и targetId=clientId.
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const clientsBulkRouter = Router();
clientsBulkRouter.use(requireAuth);
clientsBulkRouter.use(requireAdminSection);

const bulkSchema = z.object({
  action: z.enum([
    "block",
    "unblock",
    "credit_balance",
    "debit_balance",
    "reset_trial",
    "mark_unreachable",
    "mark_reachable",
  ]),
  ids: z.array(z.string().min(1)).min(1).max(500),
  params: z
    .object({
      reason: z.string().max(500).optional(),
      amount: z.number().positive().optional(),
      note: z.string().max(500).optional(),
    })
    .optional(),
});

clientsBulkRouter.post(
  "/bulk",
  asyncRoute(async (req, res) => {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
    const { action, ids, params = {} } = parsed.data;

    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const id of ids) {
      try {
        switch (action) {
          case "block": {
            await prisma.client.update({
              where: { id },
              data: { isBlocked: true, blockReason: params.reason ?? null },
            });
            break;
          }
          case "unblock": {
            await prisma.client.update({
              where: { id },
              data: { isBlocked: false, blockReason: null },
            });
            break;
          }
          case "credit_balance": {
            if (!params.amount || params.amount <= 0) throw new Error("amount required and must be > 0");
            await prisma.client.update({
              where: { id },
              data: { balance: { increment: params.amount } },
            });
            break;
          }
          case "debit_balance": {
            if (!params.amount || params.amount <= 0) throw new Error("amount required and must be > 0");
            // Атомарный decrement только если хватает баланса.
            const r = await prisma.client.updateMany({
              where: { id, balance: { gte: params.amount } },
              data: { balance: { decrement: params.amount } },
            });
            if (r.count === 0) throw new Error("insufficient balance or client not found");
            break;
          }
          case "reset_trial": {
            await prisma.client.update({
              where: { id },
              data: { trialUsed: false },
            });
            break;
          }
          case "mark_unreachable": {
            await prisma.client.update({
              where: { id },
              data: { telegramUnreachable: true },
            });
            break;
          }
          case "mark_reachable": {
            await prisma.client.update({
              where: { id },
              data: { telegramUnreachable: false },
            });
            break;
          }
        }
        results.push({ id, ok: true });

        // Per-client лог.
        await logAdmin(req, `client.bulk.${action}`, { type: "client", id }, {
          params: params ?? {},
        }).catch(() => { /* don't fail bulk on audit-log errors */ });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ id, ok: false, error: msg });
      }
    }

    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    // Сводный лог для всего батча.
    await logAdmin(req, `client.bulk_summary.${action}`, { type: "system", id: "bulk" }, {
      total: ids.length,
      ok,
      failed,
      params: params ?? {},
    }).catch(() => {});

    return res.json({ total: ids.length, ok, failed, results });
  }),
);
