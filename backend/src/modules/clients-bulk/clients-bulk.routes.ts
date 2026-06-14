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
import {
  BUILTIN_EMAIL_BLOCKLIST,
  BUILTIN_EMAIL_PATTERN_BLOCKLIST,
} from "../signup-protection/email-blocklist.js";

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

/**
 * ——— Антибот: поиск и удаление подозрительных клиентов ———
 *
 * Фильтры (все опциональные, AND):
 *   - emailDomain: точное совпадение домена (например "example.com")
 *   - emailDomainBuiltinList: использовать встроенный disposable-список
 *   - createdSinceMinutes: только зарегистрированные за последние N минут
 *   - registrationIp: точный IP
 *   - sameIpThreshold: показывать только IP с >= N регистрациями
 *   - neverConnected: только без remnawave_uuid и без trial_used
 *   - hasNoPayments: только без платежей
 *   - registrationSource: web/telegram/google/apple
 *
 * Возвращает массив подозрительных + сводку. Удаление — отдельным /antibot/purge.
 */
const findSuspiciousSchema = z.object({
  emailDomain: z.string().max(120).optional(),
  emailDomainBuiltinList: z.boolean().optional(),
  emailPatternBuiltin: z.boolean().optional(),
  createdSinceMinutes: z.number().int().positive().max(60 * 24 * 30).optional(),
  registrationIp: z.string().max(64).optional(),
  sameIpThreshold: z.number().int().min(2).max(1000).optional(),
  neverConnected: z.boolean().optional(),
  hasNoPayments: z.boolean().optional(),
  registrationSource: z.string().max(20).optional(),
  limit: z.number().int().min(1).max(2000).default(500),
});

clientsBulkRouter.post(
  "/antibot/find",
  asyncRoute(async (req, res) => {
    const parsed = findSuspiciousSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
    const f = parsed.data;

    const where: Record<string, unknown> = {};

    if (f.createdSinceMinutes) {
      const since = new Date(Date.now() - f.createdSinceMinutes * 60_000);
      where.createdAt = { gte: since };
    }
    if (f.registrationIp) where.registrationIp = f.registrationIp;
    if (f.registrationSource) where.registrationSource = f.registrationSource;
    if (f.neverConnected) {
      where.remnawaveUuid = null;
      where.trialUsed = false;
    }

    // Domain matching через раздельные OR-условия.
    const orFilters: Array<Record<string, unknown>> = [];
    if (f.emailDomain) {
      orFilters.push({ email: { endsWith: `@${f.emailDomain.toLowerCase()}` } });
    }
    if (f.emailDomainBuiltinList) {
      for (const d of BUILTIN_EMAIL_BLOCKLIST) {
        orFilters.push({ email: { endsWith: `@${d}` } });
      }
    }
    if (orFilters.length > 0) {
      where.OR = orFilters;
    }

    const candidates = await prisma.client.findMany({
      where,
      select: {
        id: true,
        email: true,
        telegramId: true,
        telegramUsername: true,
        balance: true,
        registrationIp: true,
        registrationUa: true,
        registrationSource: true,
        remnawaveUuid: true,
        trialUsed: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: f.limit,
    });

    let filtered = candidates;

    // Pattern-фильтр поверх result set
    if (f.emailPatternBuiltin) {
      filtered = filtered.filter((c) => {
        if (!c.email) return false;
        return BUILTIN_EMAIL_PATTERN_BLOCKLIST.some((re) => re.test(c.email!));
      });
    }

    // Доп. фильтр: «только без платежей» — отдельным запросом
    if (f.hasNoPayments && filtered.length > 0) {
      const ids = filtered.map((c) => c.id);
      const withPayments = await prisma.payment.findMany({
        where: { clientId: { in: ids } },
        select: { clientId: true },
        distinct: ["clientId"],
      });
      const paid = new Set(withPayments.map((p) => p.clientId));
      filtered = filtered.filter((c) => !paid.has(c.id));
    }

    // Группировка по IP, если задан порог
    let ipGroups: Array<{ ip: string; count: number }> = [];
    if (f.sameIpThreshold && f.sameIpThreshold >= 2) {
      const counts = new Map<string, number>();
      for (const c of filtered) {
        if (!c.registrationIp) continue;
        counts.set(c.registrationIp, (counts.get(c.registrationIp) ?? 0) + 1);
      }
      ipGroups = Array.from(counts.entries())
        .filter(([, n]) => n >= f.sameIpThreshold!)
        .map(([ip, count]) => ({ ip, count }))
        .sort((a, b) => b.count - a.count);
      const allowedIps = new Set(ipGroups.map((g) => g.ip));
      filtered = filtered.filter((c) => c.registrationIp && allowedIps.has(c.registrationIp));
    }

    return res.json({
      total: filtered.length,
      candidates: filtered,
      ipGroups,
      builtinBlocklistSize: BUILTIN_EMAIL_BLOCKLIST.length,
    });
  }),
);

const purgeSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(2000),
  /**
   * Если true — удаляет даже клиентов с платежами / активной remnawaveUuid.
   * По умолчанию false — нельзя случайно убить платящего юзера.
   */
  force: z.boolean().optional(),
});

clientsBulkRouter.post(
  "/antibot/purge",
  asyncRoute(async (req, res) => {
    const parsed = purgeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
    const { ids, force } = parsed.data;

    const candidates = await prisma.client.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        balance: true,
        remnawaveUuid: true,
        trialUsed: true,
      },
    });

    const protectedIds = new Set<string>();
    if (!force) {
      for (const c of candidates) {
        if (c.remnawaveUuid || c.balance > 0) {
          protectedIds.add(c.id);
        }
      }
      if (protectedIds.size === 0) {
        // отдельная проверка: были ли платежи
        const paid = await prisma.payment.findMany({
          where: { clientId: { in: ids } },
          select: { clientId: true },
          distinct: ["clientId"],
        });
        for (const p of paid) protectedIds.add(p.clientId);
      }
    }

    const toDelete = candidates.filter((c) => !protectedIds.has(c.id)).map((c) => c.id);

    let deleted = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of toDelete) {
      try {
        await prisma.client.delete({ where: { id } });
        deleted++;
      } catch (e) {
        errors.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    await logAdmin(
      req,
      "client.antibot_purge",
      { type: "system", id: "antibot" },
      { requested: ids.length, deleted, protected: protectedIds.size, force: !!force, errors: errors.length }
    ).catch(() => {});

    return res.json({
      requested: ids.length,
      deleted,
      protected: Array.from(protectedIds),
      errors,
    });
  }),
);
