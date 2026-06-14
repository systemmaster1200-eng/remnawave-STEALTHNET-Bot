/**
 * Админские эндпоинты — прокси к Remna API + клиенты панели + настройки
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, createPayment } from "../../db.js";
import { requireAuth, requireAdminSection, requireAction } from "../auth/middleware.js";
import { hashPassword } from "../auth/auth.service.js";
import { hashPassword as hashClientPassword } from "../client/client.service.js";
import {
  remnaGetUsers,
  remnaGetSubscriptions,
  remnaGetSubscriptionTemplates,
  remnaGetInternalSquads,
  remnaGetExternalSquads,
  remnaGetSystemStats,
  remnaGetSystemStatsNodes,
  remnaGetNodes,
  remnaEnableNode,
  remnaDisableNode,
  remnaRestartNode,
  remnaGetUser,
  remnaUpdateUser,
  remnaRevokeUserSubscription,
  remnaDisableUser,
  remnaDeleteUser,
  remnaEnableUser,
  remnaResetUserTraffic,
  remnaGetUserByTelegramId,
  remnaGetUserByEmail,
  extractRemnaUuid,
  isRemnaConfigured,
  remnaGetUserHwidDevices,
  remnaDeleteUserHwidDevice,
  remnaGetUserBandwidthStats,
} from "../remna/remna.client.js";
import { getSystemConfig, invalidateSystemConfigCache } from "../client/client.service.js";
import {
  disableClient as bulkDisableClient,
  enableClient as bulkEnableClient,
  disableAllSubscriptionsInRemna,
  enableAllSubscriptionsInRemna,
  resetAllSubscriptionsTraffic,
  revokeAllSubscriptionsUrls,
  syncAllSubscriptionsToRemna,
  syncAllSubscriptionsFromRemna,
  wipeClientSubscriptions,
  auditClientSubscriptions,
} from "../client/client-bulk-ops.service.js";
import { getServerStats, getSshConfig, updateSshConfig } from "../server/server.service.js";
import { syncFromRemna, syncToRemna, createRemnaUsersForClientsWithoutUuid } from "../sync/sync.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { markPaymentPaid } from "../payment/mark-paid.service.js";
// activateTariffForClient больше не используется в admin —
// выдача подписки идёт через createAdditionalSubscription (создание новой Subscription).
import { registerBackupRoutes } from "../backup/backup.routes.js";
import { invalidateBrandCache } from "../branding/spa-html.js";
import { getBroadcastRecipientsCount, startBroadcastJob, getBroadcastJob, cancelBroadcastJob, listBroadcastHistory, getBroadcastHistoryItem } from "../broadcast/broadcast.service.js";
import { uploadMascotImage, uploadVideo, uploadTicketAttachment, mascotUrl, videoUploadUrl, removeUploadedFile } from "../../lib/upload.js";
import {
  filesToAttachments,
  serializeAttachments,
  parseAttachments,
  pickField as pickTicketField,
} from "../ticket/attachments.js";
import {
  notifyAdminsAboutSupportReply,
  notifyAdminsAboutTicketStatusChange,
} from "../notification/telegram-notify.service.js";
import { runRule, runAllRules, getEligibleClientIds } from "../auto-broadcast/auto-broadcast.service.js";
import { testNalogConnection } from "../nalog/nalog.service.js";
import { adminCreateGiftCode } from "../gift/gift.service.js";
import { languageRouter } from "./language.routes.js";
import { adminGramadsRouter } from "./gramads.routes.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

/** Обёртка для async-роутов: ошибки передаются в next() и возвращают 500. */
function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

registerBackupRoutes(adminRouter, asyncRoute);

adminRouter.use("/languages", languageRouter);

adminRouter.use(requireAdminSection);

adminRouter.use("/gramads", adminGramadsRouter);

adminRouter.get("/me", asyncRoute(async (req, res) => {
  const adminId = (req as unknown as { adminId: string }).adminId;
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { id: true, email: true, mustChangePassword: true, role: true, allowedSections: true, totpEnabled: true },
  });
  if (!admin) return res.status(401).json({ message: "Not found" });
  const allowedSections = admin.allowedSections
    ? (() => {
        try {
          const p = JSON.parse(admin.allowedSections!) as unknown;
          return Array.isArray(p) ? p.filter((s): s is string => typeof s === "string") : [];
        } catch {
          return [];
        }
      })()
    : [];
  return res.json({ ...admin, allowedSections });
}));

adminRouter.get("/remna/status", (_req, res) => {
  res.json({ configured: isRemnaConfigured() });
});

adminRouter.get("/remna/users", async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await remnaGetUsers({ page, limit });
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRouter.get("/remna/subscriptions", async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await remnaGetSubscriptions({ page, limit });
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRouter.get("/remna/subscription-templates", async (_req, res) => {
  const result = await remnaGetSubscriptionTemplates();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRouter.get("/remna/squads/internal", asyncRoute(async (_req, res) => {
  const result = await remnaGetInternalSquads();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
}));

adminRouter.get("/remna/squads/external", async (_req, res) => {
  const result = await remnaGetExternalSquads();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRouter.get("/remna/system/stats", async (_req, res) => {
  const result = await remnaGetSystemStats();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRouter.get("/remna/system/stats/nodes", async (_req, res) => {
  const result = await remnaGetSystemStatsNodes();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRouter.get("/remna/nodes", async (_req, res) => {
  const result = await remnaGetNodes();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

const remnaNodeUuidSchema = z.object({ uuid: z.string().uuid() });

adminRouter.post("/remna/nodes/:uuid/enable", async (req, res) => {
  const parsed = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!parsed.success) return res.status(400).json({ message: "Invalid node UUID" });
  const result = await remnaEnableNode(parsed.data.uuid);
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? { ok: true });
});

adminRouter.post("/remna/nodes/:uuid/disable", async (req, res) => {
  const parsed = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!parsed.success) return res.status(400).json({ message: "Invalid node UUID" });
  const result = await remnaDisableNode(parsed.data.uuid);
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? { ok: true });
});

adminRouter.post("/remna/nodes/:uuid/restart", async (req, res) => {
  const parsed = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!parsed.success) return res.status(400).json({ message: "Invalid node UUID" });
  const result = await remnaRestartNode(parsed.data.uuid);
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? { ok: true });
});

/** Условие: только реальные поступления (исключаем оплату с баланса, чтобы не дублировать учёт). */
const PAID_EXTERNAL_WHERE = { status: "PAID" as const, provider: { not: "balance" } };

/** Статистика дашборда: пользователи (локальная БД), продажи (Payment PAID — только внешние поступления). */
adminRouter.get("/dashboard/stats", async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [clientsTotal, clientsWithRemna, paidAgg, paidToday, paidLast7, paidLast30, newClientsToday, newClientsLast7, newClientsLast30] =
    await Promise.all([
      prisma.client.count(),
      prisma.client.count({ where: { remnawaveUuid: { not: null } } }),
      prisma.payment.aggregate({
        where: PAID_EXTERNAL_WHERE,
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { ...PAID_EXTERNAL_WHERE, paidAt: { gte: todayStart } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { ...PAID_EXTERNAL_WHERE, paidAt: { gte: sevenDaysAgo } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { ...PAID_EXTERNAL_WHERE, paidAt: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.client.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.client.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.client.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    ]);

  return res.json({
    users: {
      total: clientsTotal,
      withRemna: clientsWithRemna,
      newToday: newClientsToday,
      newLast7Days: newClientsLast7,
      newLast30Days: newClientsLast30,
    },
    sales: {
      totalAmount: paidAgg._sum.amount ?? 0,
      totalCount: paidAgg._count,
      todayAmount: paidToday._sum.amount ?? 0,
      todayCount: paidToday._count,
      last7DaysAmount: paidLast7._sum.amount ?? 0,
      last7DaysCount: paidLast7._count,
      last30DaysAmount: paidLast30._sum.amount ?? 0,
      last30DaysCount: paidLast30._count,
    },
  });
});

// ──── Мониторинг сервера ────

adminRouter.get("/server/stats", asyncRoute(async (_req, res) => {
  const stats = await getServerStats();
  return res.json(stats);
}));

adminRouter.get("/server/ssh", asyncRoute(async (_req, res) => {
  const config = await getSshConfig();
  if (!config) return res.status(404).json({ message: "sshd_config не найден (SSH не настроен или нет доступа)" });
  return res.json(config);
}));

adminRouter.patch("/server/ssh", asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (body.port != null) updates.port = Number(body.port);
  if (body.permitRootLogin != null) updates.permitRootLogin = String(body.permitRootLogin);
  if (body.passwordAuthentication != null) updates.passwordAuthentication = Boolean(body.passwordAuthentication);
  if (body.pubkeyAuthentication != null) updates.pubkeyAuthentication = Boolean(body.pubkeyAuthentication);
  const result = await updateSshConfig(updates as any);
  if (!result.ok) return res.status(500).json({ message: result.error });
  const config = await getSshConfig();
  return res.json(config);
}));

adminRouter.get("/auto-renew/stats", async (_req, res) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalAutoRenewEnabled,
    totalAutoRenewDisabled,
    retriesInProgress,
    renewalsLast30Days,
    renewalsLast7Days,
    renewalAmountLast30Days,
  ] = await Promise.all([
    // Clients with auto-renewal enabled
    prisma.client.count({ where: { autoRenewEnabled: true, autoRenewTariffId: { not: null } } }),
    // Clients who had it but now disabled
    prisma.client.count({ where: { autoRenewEnabled: false, autoRenewTariffId: { not: null } } }),
    // Clients currently in retry state
    prisma.client.count({ where: { autoRenewEnabled: true, autoRenewRetryCount: { gt: 0 } } }),
    // Successful auto-renewals (balance payments with tariff) in 30 days
    prisma.payment.count({
      where: {
        provider: "balance",
        status: "PAID",
        tariffId: { not: null },
        paidAt: { gte: thirtyDaysAgo },
      },
    }),
    // Successful auto-renewals in 7 days
    prisma.payment.count({
      where: {
        provider: "balance",
        status: "PAID",
        tariffId: { not: null },
        paidAt: { gte: sevenDaysAgo },
      },
    }),
    // Total amount of balance-tariff payments in 30 days
    prisma.payment.aggregate({
      where: {
        provider: "balance",
        status: "PAID",
        tariffId: { not: null },
        paidAt: { gte: thirtyDaysAgo },
      },
      _sum: { amount: true },
    }),
  ]);

  return res.json({
    enabled: totalAutoRenewEnabled,
    disabled: totalAutoRenewDisabled,
    retriesInProgress,
    renewalsLast7Days,
    renewalsLast30Days,
    amountLast30Days: renewalAmountLast30Days._sum.amount ?? 0,
  });
});

adminRouter.get("/notifications/counters", asyncRoute(async (_req, res) => {
  const [totalClients, totalTickets, totalTariffPayments, totalBalanceTopups] = await Promise.all([
    prisma.client.count(),
    prisma.ticket.count(),
    prisma.payment.count({
      where: {
        status: "PAID",
        OR: [
          { tariffId: { not: null } },
          { proxyTariffId: { not: null } },
          { singboxTariffId: { not: null } },
        ],
      },
    }),
    prisma.payment.count({
      where: {
        status: "PAID",
        tariffId: null,
        proxyTariffId: null,
        singboxTariffId: null,
      },
    }),
  ]);
  return res.json({ totalClients, totalTickets, totalTariffPayments, totalBalanceTopups });
}));

/** Отметить платёж как оплаченный и начислить реферальные бонусы (3 уровня) */
const paymentIdParamSchema = z.object({ id: z.string().min(1) });
const markPaymentPaidSchema = z.object({ status: z.literal("PAID") });
adminRouter.patch("/payments/:id", asyncRoute(async (req, res) => {
  const params = paymentIdParamSchema.safeParse(req.params);
  const body = markPaymentPaidSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    const err = !params.success ? params.error.flatten() : body.error!.flatten();
    return res.status(400).json({ message: "Invalid input", errors: err });
  }
  const result = await markPaymentPaid(params.data.id);
  if (!result.ok) {
    return res.status(404).json({ message: result.error ?? "Payment not found" });
  }
  return res.json({
    payment: result.payment,
    referral: result.referral,
    activation: result.activation,
    proxySlots: result.proxySlots,
    balanceCredited: result.balanceCredited,
  });
}));

/** Сериализация тарифа для JSON (BigInt → number) с опциями цен. */
function tariffToJson(t: {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  durationDays: number;
  internalSquadUuids: string[];
  trafficLimitBytes: bigint | null;
  trafficResetMode: string;
  deviceLimit: number | null;
  includedDevices: number;
  pricePerExtraDevice: number;
  maxExtraDevices: number;
  deviceDiscountTiers: unknown;
  price: number;
  currency: string;
  sortOrder: number;
  lavatopOfferId?: string | null;
  locations?: string | null; // T11+T12 (11.05.2026)
  menuEmoji?: string | null; // T16 (12.05.2026) — эмодзи в главном меню бота
  purchaseCooldownDays?: number | null; // T-cooldown (13.05.2026) — кулдаун покупки тарифа в днях
  createdAt: Date;
  updatedAt: Date;
  priceOptions?: { id: string; durationDays: number; price: number; sortOrder: number }[];
}) {
  return {
    id: t.id,
    categoryId: t.categoryId,
    name: t.name,
    description: t.description ?? null,
    durationDays: t.durationDays,
    internalSquadUuids: t.internalSquadUuids,
    trafficLimitBytes: t.trafficLimitBytes != null ? Number(t.trafficLimitBytes) : null,
    trafficResetMode: t.trafficResetMode,
    deviceLimit: t.deviceLimit,
    includedDevices: t.includedDevices,
    pricePerExtraDevice: t.pricePerExtraDevice,
    maxExtraDevices: t.maxExtraDevices,
    deviceDiscountTiers: Array.isArray(t.deviceDiscountTiers)
      ? (t.deviceDiscountTiers as { minExtraDevices: number; discountPercent: number }[])
      : [],
    price: t.price,
    currency: t.currency,
    sortOrder: t.sortOrder,
    lavatopOfferId: t.lavatopOfferId ?? null,
    // T11+T12 (11.05.2026) — для админки чтобы загружать в textarea при редактировании.
    locations: t.locations ?? null,
    // T16 (12.05.2026) — эмодзи-префикс в главном меню бота перед названием подписки.
    menuEmoji: t.menuEmoji ?? null,
    // T-cooldown (13.05.2026) — кулдаун покупки тарифа в днях (null = без ограничения).
    purchaseCooldownDays: t.purchaseCooldownDays ?? null,
    priceOptions: (t.priceOptions ?? []).map((o) => ({
      id: o.id,
      durationDays: o.durationDays,
      price: o.price,
      sortOrder: o.sortOrder,
    })),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// ——— Категории тарифов ———
const tariffCategoryIdSchema = z.object({ id: z.string().min(1) });

adminRouter.get("/tariff-categories", async (_req, res) => {
  try {
    const list = await prisma.tariffCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        tariffs: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] },
          },
        },
      },
    });
    return res.json({
      items: list.map((c) => ({
        id: c.id,
        name: c.name,
        emojiKey: c.emojiKey ?? null,
        sortOrder: c.sortOrder,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        tariffs: c.tariffs.map(tariffToJson),
      })),
    });
  } catch (e) {
    console.error("GET /tariff-categories error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("does not exist") || msg.includes("tariff_categories")) {
      return res.status(503).json({
        message: "Таблицы тарифов не найдены. Выполните в папке backend: npx prisma db push",
      });
    }
    return res.status(500).json({ message: "Ошибка загрузки категорий тарифов", error: msg });
  }
});

const createTariffCategorySchema = z.object({
  name: z.string().min(1).max(255),
  sortOrder: z.number().int().optional(),
  emojiKey: z.string().max(32).optional().nullable(),
});
const updateTariffCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  sortOrder: z.number().int().optional(),
  emojiKey: z.string().max(32).optional().nullable(),
});

adminRouter.post("/tariff-categories", async (req, res) => {
  const body = createTariffCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  const created = await prisma.tariffCategory.create({
    data: {
      name: body.data.name,
      sortOrder: body.data.sortOrder ?? 0,
      emojiKey: body.data.emojiKey ?? undefined,
    },
  });
  return res.status(201).json({
    id: created.id,
    name: created.name,
    emojiKey: created.emojiKey,
    sortOrder: created.sortOrder,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  });
});

adminRouter.patch("/tariff-categories/:id", async (req, res) => {
  const idParse = tariffCategoryIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  const body = updateTariffCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  const data: { name?: string; sortOrder?: number; emojiKey?: string | null } = {};
  if (body.data.name !== undefined) data.name = body.data.name;
  if (body.data.sortOrder !== undefined) data.sortOrder = body.data.sortOrder;
  if (body.data.emojiKey !== undefined) data.emojiKey = body.data.emojiKey;
  const updated = await prisma.tariffCategory.update({
    where: { id: idParse.data.id },
    data,
  });
  return res.json({
    id: updated.id,
    name: updated.name,
    emojiKey: updated.emojiKey,
    sortOrder: updated.sortOrder,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

adminRouter.delete("/tariff-categories/:id", async (req, res) => {
  const idParse = tariffCategoryIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  await prisma.tariffCategory.delete({ where: { id: idParse.data.id } });
  return res.json({ success: true });
});

// ——— Тарифы ———
const tariffIdSchema = z.object({ id: z.string().min(1) });
// добавлен "carry_over" — перенос остатка трафика.
const TRAFFIC_RESET_MODES = ["no_reset", "carry_over", "on_purchase", "monthly", "monthly_rolling"] as const;
const priceOptionInputSchema = z.object({
  durationDays: z.number().int().min(1).max(3650),
  price: z.number().min(0),
});
// Лесенка скидок за число ДОП. устройств: {minExtraDevices, discountPercent}.
const deviceDiscountTierSchema = z.object({
  minExtraDevices: z.number().int().min(1).max(100),
  discountPercent: z.number().min(0).max(90),
});
const createTariffSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  durationDays: z.number().int().min(1).max(3650).optional(), // legacy: будет проигнорирован если priceOptions заданы
  internalSquadUuids: z.array(z.string().uuid()).min(1),
  trafficLimitBytes: z.number().int().nonnegative().nullable().optional(),
  trafficResetMode: z.enum(TRAFFIC_RESET_MODES).optional(),
  deviceLimit: z.number().int().nonnegative().nullable().optional(),
  includedDevices: z.number().int().min(1).max(100).optional(),
  pricePerExtraDevice: z.number().min(0).optional(),
  maxExtraDevices: z.number().int().min(0).max(100).optional(),
  deviceDiscountTiers: z.array(deviceDiscountTierSchema).max(20).optional(),
  price: z.number().min(0).optional(), // legacy: используется как fallback если priceOptions не заданы
  currency: z.string().max(10).optional(),
  sortOrder: z.number().int().optional(),
  /** UUID оффера в Lava.top для этого тарифа. При оплате через Lava.top создаётся MONTHLY-подписка. */
  lavatopOfferId: z.string().max(200).nullable().optional(),
  /** T11+T12 (11.05.2026) — rich-text список локаций тарифа (для бота кнопка «🌐 Локации»). */
  locations: z.string().max(10000).nullable().optional(),
  /** T16 (12.05.2026) — эмодзи в главном меню бота. */
  menuEmoji: z.string().max(16).nullable().optional(),
  /** T-cooldown (13.05.2026) — кулдаун покупки тарифа (дней). null/0 = без ограничения. */
  purchaseCooldownDays: z.number().int().min(0).max(3650).nullable().optional(),
  priceOptions: z.array(priceOptionInputSchema).min(1).max(20).optional(),
});
const updateTariffSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  durationDays: z.number().int().min(1).max(3650).optional(),
  internalSquadUuids: z.array(z.string().uuid()).optional(),
  trafficLimitBytes: z.number().int().nonnegative().nullable().optional(),
  trafficResetMode: z.enum(TRAFFIC_RESET_MODES).optional(),
  deviceLimit: z.number().int().nonnegative().nullable().optional(),
  includedDevices: z.number().int().min(1).max(100).optional(),
  pricePerExtraDevice: z.number().min(0).optional(),
  maxExtraDevices: z.number().int().min(0).max(100).optional(),
  deviceDiscountTiers: z.array(deviceDiscountTierSchema).max(20).optional(),
  price: z.number().min(0).optional(),
  currency: z.string().max(10).optional(),
  lavatopOfferId: z.string().max(200).nullable().optional(),
  /** T11+T12 (11.05.2026) — rich-text список локаций. */
  locations: z.string().max(10000).nullable().optional(),
  /** T16 (12.05.2026) — эмодзи в главном меню бота. */
  menuEmoji: z.string().max(16).nullable().optional(),
  /** T-cooldown (13.05.2026) — кулдаун покупки тарифа (дней). null/0 = без ограничения. */
  purchaseCooldownDays: z.number().int().min(0).max(3650).nullable().optional(),
  sortOrder: z.number().int().optional(),
  priceOptions: z.array(priceOptionInputSchema).min(1).max(20).optional(),
});

adminRouter.get("/tariffs", async (req, res) => {
  const categoryId = req.query.categoryId as string | undefined;
  const where = categoryId ? { categoryId } : {};
  const list = await prisma.tariff.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] },
    },
  });
  return res.json({ items: list.map(tariffToJson) });
});

adminRouter.post("/tariffs", async (req, res) => {
  const body = createTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  const category = await prisma.tariffCategory.findUnique({ where: { id: body.data.categoryId } });
  if (!category) return res.status(400).json({ message: "Категория не найдена" });

  // Определяем legacy duration/price из priceOptions если они заданы (минимальная опция = legacy).
  // Это нужно потому что Tariff.durationDays и Tariff.price обязательные поля схемы (NOT NULL).
  let legacyDays = body.data.durationDays;
  let legacyPrice = body.data.price ?? 0;
  if (body.data.priceOptions && body.data.priceOptions.length > 0) {
    const sorted = [...body.data.priceOptions].sort((a, b) => a.price - b.price);
    legacyPrice = sorted[0].price;
    legacyDays = sorted[0].durationDays;
  }
  if (legacyDays == null) {
    return res.status(400).json({ message: "Не указана длительность или опции цен" });
  }

  const created = await prisma.tariff.create({
    data: {
      categoryId: body.data.categoryId,
      name: body.data.name,
      description: body.data.description ?? null,
      durationDays: legacyDays,
      internalSquadUuids: body.data.internalSquadUuids,
      trafficLimitBytes: body.data.trafficLimitBytes != null ? BigInt(body.data.trafficLimitBytes) : null,
      trafficResetMode: body.data.trafficResetMode ?? "no_reset",
      deviceLimit: body.data.deviceLimit ?? null,
      includedDevices: body.data.includedDevices ?? 1,
      pricePerExtraDevice: body.data.pricePerExtraDevice ?? 0,
      maxExtraDevices: body.data.maxExtraDevices ?? 0,
      deviceDiscountTiers: body.data.deviceDiscountTiers ?? [],
      price: legacyPrice,
      currency: (body.data.currency ?? "usd").toLowerCase(),
      sortOrder: body.data.sortOrder ?? 0,
      lavatopOfferId: body.data.lavatopOfferId?.trim() || null,
      // T11+T12 (11.05.2026) — rich-text локаций тарифа.
      locations: body.data.locations?.trim() || null,
      // T16 (12.05.2026) — эмодзи в главном меню бота.
      menuEmoji: body.data.menuEmoji?.trim() || null,
      // T-cooldown (13.05.2026) — кулдаун покупки тарифа (null/0 = без ограничения).
      purchaseCooldownDays: body.data.purchaseCooldownDays && body.data.purchaseCooldownDays > 0
        ? body.data.purchaseCooldownDays
        : null,
      priceOptions: body.data.priceOptions
        ? {
          create: body.data.priceOptions.map((o, idx) => ({
            durationDays: o.durationDays,
            price: o.price,
            sortOrder: idx,
          })),
        }
        : {
          // Если priceOptions не заданы — создаём одну дефолтную из legacy полей
          create: [{ durationDays: legacyDays, price: legacyPrice, sortOrder: 0 }],
        },
    },
    include: { priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } },
  });
  return res.status(201).json(tariffToJson(created));
});

adminRouter.patch("/tariffs/:id", async (req, res) => {
  const idParse = tariffIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  const body = updateTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  const data: { name?: string; description?: string | null; durationDays?: number; internalSquadUuids?: string[]; trafficLimitBytes?: bigint | null; trafficResetMode?: string; deviceLimit?: number | null; includedDevices?: number; pricePerExtraDevice?: number; maxExtraDevices?: number; deviceDiscountTiers?: { minExtraDevices: number; discountPercent: number }[]; price?: number; currency?: string; sortOrder?: number; lavatopOfferId?: string | null; locations?: string | null; menuEmoji?: string | null; purchaseCooldownDays?: number | null } = {};
  if (body.data.name != null) data.name = body.data.name;
  if (body.data.description !== undefined) data.description = body.data.description ?? null;
  if (body.data.internalSquadUuids != null) data.internalSquadUuids = body.data.internalSquadUuids;
  if (body.data.trafficLimitBytes !== undefined) data.trafficLimitBytes = body.data.trafficLimitBytes != null ? BigInt(body.data.trafficLimitBytes) : null;
  if (body.data.trafficResetMode !== undefined) data.trafficResetMode = body.data.trafficResetMode;
  if (body.data.deviceLimit !== undefined) data.deviceLimit = body.data.deviceLimit ?? null;
  if (body.data.includedDevices !== undefined) data.includedDevices = body.data.includedDevices;
  if (body.data.pricePerExtraDevice !== undefined) data.pricePerExtraDevice = body.data.pricePerExtraDevice;
  if (body.data.maxExtraDevices !== undefined) data.maxExtraDevices = body.data.maxExtraDevices;
  if (body.data.deviceDiscountTiers !== undefined) data.deviceDiscountTiers = body.data.deviceDiscountTiers;
  if (body.data.currency !== undefined) data.currency = body.data.currency.toLowerCase();
  if (body.data.sortOrder != null) data.sortOrder = body.data.sortOrder;
  if (body.data.lavatopOfferId !== undefined) data.lavatopOfferId = body.data.lavatopOfferId?.trim() || null;
  // T11+T12 (11.05.2026) — обновление локаций тарифа.
  if (body.data.locations !== undefined) data.locations = body.data.locations?.trim() || null;
  // T16 (12.05.2026) — обновление эмодзи в главном меню бота.
  if (body.data.menuEmoji !== undefined) data.menuEmoji = body.data.menuEmoji?.trim() || null;
  // T-cooldown (13.05.2026) — обновление кулдауна покупки (null/0 = без ограничения).
  if (body.data.purchaseCooldownDays !== undefined) {
    data.purchaseCooldownDays = body.data.purchaseCooldownDays && body.data.purchaseCooldownDays > 0
      ? body.data.purchaseCooldownDays
      : null;
  }
  // Если priceOptions переданы — синхронизируем legacy поля с минимальной опцией.
  if (body.data.priceOptions && body.data.priceOptions.length > 0) {
    const sorted = [...body.data.priceOptions].sort((a, b) => a.price - b.price);
    data.price = sorted[0].price;
    data.durationDays = sorted[0].durationDays;
  } else {
    // Иначе разрешаем менять legacy поля напрямую (на случай редактирования существующих тарифов).
    if (body.data.durationDays != null) data.durationDays = body.data.durationDays;
    if (body.data.price !== undefined) data.price = body.data.price;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (body.data.priceOptions && body.data.priceOptions.length > 0) {
      // Полная замена опций цен: удалить старые → создать новые (CASCADE на Payment.tariffPriceOptionId
      // делает SET NULL, существующие платежи сохранятся, но потеряют ссылку).
      await tx.tariffPriceOption.deleteMany({ where: { tariffId: idParse.data.id } });
      await tx.tariffPriceOption.createMany({
        data: body.data.priceOptions.map((o, idx) => ({
          tariffId: idParse.data.id,
          durationDays: o.durationDays,
          price: o.price,
          sortOrder: idx,
        })),
      });
    }
    return tx.tariff.update({
      where: { id: idParse.data.id },
      data,
      include: { priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } },
    });
  });
  return res.json(tariffToJson(updated));
});

adminRouter.delete("/tariffs/:id", async (req, res) => {
  const idParse = tariffIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  await prisma.tariff.delete({ where: { id: idParse.data.id } });
  return res.json({ success: true });
});

// ─── CRUD для Trial-пресетов ──────────────────
// Каждый триал привязан к одному из тарифов (наследует squads/devices/traffic).
// Длительность задаётся отдельно. Один клиент = одна активация каждого триала.

const trialIdSchema = z.object({ id: z.string().min(1) });

const createTrialSchema = z.object({
  name: z.string().min(1).max(255),
  tariffId: z.string().min(1),
  durationDays: z.number().int().min(1).max(365),
  /** опциональный лимит трафика триала в байтах (null = из тарифа). */
  trafficLimitBytes: z.number().int().nonnegative().nullable().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  description: z.string().max(2000).nullable().optional(),
});

const updateTrialSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  tariffId: z.string().min(1).optional(),
  durationDays: z.number().int().min(1).max(365).optional(),
  /** опциональный лимит трафика триала в байтах (null = из тарифа). */
  trafficLimitBytes: z.number().int().nonnegative().nullable().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  description: z.string().max(2000).nullable().optional(),
});

function trialToJson(t: {
  id: string;
  name: string;
  tariffId: string;
  durationDays: number;
  trafficLimitBytes?: bigint | null;
  enabled: boolean;
  sortOrder: number;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  tariff?: { id: string; name: string } | null;
}) {
  return {
    id: t.id,
    name: t.name,
    tariffId: t.tariffId,
    durationDays: t.durationDays,
    // T16 (12.05.2026) — BigInt → number для JSON; null = используется лимит тарифа.
    trafficLimitBytes: t.trafficLimitBytes != null ? Number(t.trafficLimitBytes) : null,
    enabled: t.enabled,
    sortOrder: t.sortOrder,
    description: t.description,
    tariffName: t.tariff?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// админ-эндпоинты для withdrawal_requests (USDT TRC20).
// Approve → клиенту приходит уведомление в Telegram. Reject → возвращаем баланс.
adminRouter.get("/withdrawals", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : null;
  const where = status && ["PENDING", "APPROVED", "REJECTED"].includes(status) ? { status } : {};
  const items = await prisma.withdrawalRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } } },
  });
  return res.json({ items });
});

adminRouter.post("/withdrawals/:id/approve", async (req, res) => {
  const id = req.params.id;
  const wr = await prisma.withdrawalRequest.findUnique({ where: { id } });
  if (!wr) return res.status(404).json({ message: "Заявка не найдена" });
  if (wr.status !== "PENDING") return res.status(400).json({ message: "Заявка уже обработана" });
  await prisma.withdrawalRequest.update({
    where: { id },
    data: { status: "APPROVED", processedAt: new Date(), adminComment: typeof req.body?.comment === "string" ? req.body.comment.slice(0, 500) : null },
  });
  // Notify клиенту.
  const { notifyClientAboutWithdrawalApproved } = await import("../notification/telegram-notify.service.js");
  await notifyClientAboutWithdrawalApproved(id).catch(() => {});
  return res.json({ message: "Заявка одобрена. Клиенту отправлено уведомление." });
});

adminRouter.post("/withdrawals/:id/reject", async (req, res) => {
  const id = req.params.id;
  const wr = await prisma.withdrawalRequest.findUnique({ where: { id } });
  if (!wr) return res.status(404).json({ message: "Заявка не найдена" });
  if (wr.status !== "PENDING") return res.status(400).json({ message: "Заявка уже обработана" });
  // Возвращаем баланс клиенту.
  await prisma.$transaction([
    prisma.withdrawalRequest.update({
      where: { id },
      data: { status: "REJECTED", processedAt: new Date(), adminComment: typeof req.body?.comment === "string" ? req.body.comment.slice(0, 500) : null },
    }),
    prisma.client.update({ where: { id: wr.clientId }, data: { balance: { increment: wr.amount } } }),
  ]);
  return res.json({ message: "Заявка отклонена. Баланс возвращён клиенту." });
});

// CRUD для шаблонов уведомлений автосписания.
// Cron `auto-renew.cron.ts` использует эти шаблоны при отправке нотификаций клиенту.
const autoRenewNotifSchema = z.object({
  name: z.string().min(1).max(120),
  triggerType: z.enum(["UPCOMING", "SUCCESS", "FAILED", "RETRY", "EXPIRED"]),
  offsetMinutes: z.number().int().min(0).max(60 * 24 * 30), // до 30 дней
  messageText: z.string().min(1).max(4000),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

adminRouter.get("/auto-renew-notifications", async (_req, res) => {
  const list = await prisma.autoRenewNotification.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return res.json({
    items: list.map((n) => ({
      id: n.id,
      name: n.name,
      triggerType: n.triggerType,
      offsetMinutes: n.offsetMinutes,
      messageText: n.messageText,
      enabled: n.enabled,
      sortOrder: n.sortOrder,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    })),
  });
});

adminRouter.post("/auto-renew-notifications", async (req, res) => {
  const parsed = autoRenewNotifSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  const created = await prisma.autoRenewNotification.create({
    data: {
      name: parsed.data.name,
      triggerType: parsed.data.triggerType,
      offsetMinutes: parsed.data.offsetMinutes,
      messageText: parsed.data.messageText,
      enabled: parsed.data.enabled ?? true,
      sortOrder: parsed.data.sortOrder ?? 0,
    },
  });
  return res.status(201).json({ id: created.id });
});

adminRouter.patch("/auto-renew-notifications/:id", async (req, res) => {
  const parsed = autoRenewNotifSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  try {
    await prisma.autoRenewNotification.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ message: "Шаблон не найден" });
  }
});

adminRouter.delete("/auto-renew-notifications/:id", async (req, res) => {
  try {
    await prisma.autoRenewNotification.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ message: "Шаблон не найден" });
  }
});

adminRouter.get("/trials", async (_req, res) => {
  const list = await prisma.trial.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { tariff: { select: { id: true, name: true } } },
  });
  return res.json({ items: list.map(trialToJson) });
});

adminRouter.post("/trials", async (req, res) => {
  const body = createTrialSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  const tariff = await prisma.tariff.findUnique({ where: { id: body.data.tariffId } });
  if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
  const created = await prisma.trial.create({
    data: {
      name: body.data.name,
      tariffId: body.data.tariffId,
      durationDays: body.data.durationDays,
      // T16 (12.05.2026) — отдельный лимит трафика триала (null = из тарифа).
      trafficLimitBytes: body.data.trafficLimitBytes != null ? BigInt(body.data.trafficLimitBytes) : null,
      enabled: body.data.enabled ?? true,
      sortOrder: body.data.sortOrder ?? 0,
      description: body.data.description ?? null,
    },
    include: { tariff: { select: { id: true, name: true } } },
  });
  return res.status(201).json(trialToJson(created));
});

adminRouter.patch("/trials/:id", async (req, res) => {
  const idParse = trialIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  const body = updateTrialSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  if (body.data.tariffId) {
    const tariff = await prisma.tariff.findUnique({ where: { id: body.data.tariffId } });
    if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
  }
  // T16 (12.05.2026) — BigInt из number / null.
  const updateData: {
    name?: string;
    tariffId?: string;
    durationDays?: number;
    trafficLimitBytes?: bigint | null;
    enabled?: boolean;
    sortOrder?: number;
    description?: string | null;
  } = {};
  if (body.data.name !== undefined) updateData.name = body.data.name;
  if (body.data.tariffId !== undefined) updateData.tariffId = body.data.tariffId;
  if (body.data.durationDays !== undefined) updateData.durationDays = body.data.durationDays;
  if (body.data.trafficLimitBytes !== undefined) {
    updateData.trafficLimitBytes = body.data.trafficLimitBytes != null ? BigInt(body.data.trafficLimitBytes) : null;
  }
  if (body.data.enabled !== undefined) updateData.enabled = body.data.enabled;
  if (body.data.sortOrder !== undefined) updateData.sortOrder = body.data.sortOrder;
  if (body.data.description !== undefined) updateData.description = body.data.description ?? null;
  const updated = await prisma.trial.update({
    where: { id: idParse.data.id },
    data: updateData,
    include: { tariff: { select: { id: true, name: true } } },
  });
  return res.json(trialToJson(updated));
});

adminRouter.delete("/trials/:id", async (req, res) => {
  const idParse = trialIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  // ON DELETE CASCADE на client_trial_usages — записи использования удалятся автоматически.
  // SecondarySubscription.trial_id (ON DELETE SET NULL) — оставит подписки клиентов живыми.
  await prisma.trial.delete({ where: { id: idParse.data.id } });
  return res.json({ success: true });
});

// Клиенты панели (наши пользователи — бот, сайт, mini app)
adminRouter.get("/clients", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const isBlockedParam = req.query.isBlocked;

    const where: Prisma.ClientWhereInput = {};
    const conditions: Prisma.ClientWhereInput[] = [];

    if (search.length > 0) {
      conditions.push({
        OR: [
          { email: { contains: search, mode: "insensitive" as const } },
          { telegramUsername: { contains: search, mode: "insensitive" as const } },
          { telegramId: { contains: search } },
          { referralCode: { contains: search, mode: "insensitive" as const } },
          { id: { contains: search } },
          { remnawaveUuid: { contains: search, mode: "insensitive" as const } },
        ],
      });
    }
    if (isBlockedParam === "true") conditions.push({ isBlocked: true });
    else if (isBlockedParam === "false") conditions.push({ isBlocked: false });

    if (conditions.length > 0) where.AND = conditions;
    const whereClause = conditions.length > 0 ? where : undefined;

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          telegramId: true,
          telegramUsername: true,
          preferredLang: true,
          preferredCurrency: true,
          balance: true,
          referralCode: true,
          remnawaveUuid: true,
          trialUsed: true,
          isBlocked: true,
          blockReason: true,
          referralPercent: true,
          personalDiscountPercent: true,
          personalDiscountIsOneTime: true,
          createdAt: true,
          _count: { select: { referrals: true } },
        },
      }),
      prisma.client.count({ where: whereClause }),
    ]);
    let items: ((typeof clients)[number] & { activeNode?: string | null; onlineAt?: string | null })[] = clients;

    // Попробуем обогатить клиентов информацией об активной ноде и onlineAt из Remna
    if (isRemnaConfigured()) {
      const withRemna = clients.filter((c) => c.remnawaveUuid);
      const map: Record<string, { activeNode: string | null; onlineAt: string | null }> = {};
      await Promise.all(
        withRemna.map(async (c) => {
          try {
            const resRemna = await remnaGetUser(c.remnawaveUuid!);
            if (resRemna.error || !resRemna.data) {
              map[c.id] = { activeNode: null, onlineAt: null };
              return;
            }
            const raw = resRemna.data as Record<string, unknown>;
            const resp = (raw.response ?? raw) as Record<string, unknown>;
            let label: string | null = null;
            // Пытаемся вытащить имя активной ноды из возможных полей ответа Remna
            if (typeof resp.activeNodeName === "string" && resp.activeNodeName.trim()) {
              label = resp.activeNodeName.trim();
            } else if (typeof resp.currentNodeName === "string" && resp.currentNodeName.trim()) {
              label = resp.currentNodeName.trim();
            } else if (Array.isArray(resp.activeInternalSquads)) {
              const first = resp.activeInternalSquads[0] as { uuid?: string; name?: string } | string | undefined;
              if (first && typeof first === "object") {
                label = (first.name || first.uuid || "").trim() || null;
              }
            }
            // Извлекаем onlineAt из userTraffic
            const traffic = resp.userTraffic as Record<string, unknown> | undefined;
            const onlineAt = typeof traffic?.onlineAt === "string" ? traffic.onlineAt : null;
            map[c.id] = { activeNode: label, onlineAt };
          } catch {
            map[c.id] = { activeNode: null, onlineAt: null };
          }
        })
      );
      items = clients.map((c) => ({
        ...c,
        activeNode: map[c.id]?.activeNode ?? null,
        onlineAt: map[c.id]?.onlineAt ?? null,
      }));
    }

    return res.json({ items, total, page, limit });
  } catch (e) {
    console.error("GET /admin/clients error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ message: "Ошибка загрузки клиентов. Выполните: cd backend && npx prisma db push", error: msg });
  }
});

/**
 * POST /api/admin/clients/online-statuses
 * Лёгкий эндпоинт для поллинга онлайн-статусов клиентов.
 * Принимает { uuids: string[] } (remnawaveUuid), возвращает { [uuid]: { onlineAt: string | null } }
 */
adminRouter.post("/clients/online-statuses", async (req, res) => {
  try {
    const { uuids } = req.body as { uuids?: string[] };
    if (!Array.isArray(uuids) || uuids.length === 0) {
      return res.json({});
    }
    // Ограничим до 100 uuid за запрос
    const limited = uuids.slice(0, 100);
    const result: Record<string, { onlineAt: string | null }> = {};

    if (!isRemnaConfigured()) {
      for (const uuid of limited) result[uuid] = { onlineAt: null };
      return res.json(result);
    }

    await Promise.all(
      limited.map(async (uuid) => {
        try {
          const resRemna = await remnaGetUser(uuid);
          if (resRemna.error || !resRemna.data) {
            result[uuid] = { onlineAt: null };
            return;
          }
          const raw = resRemna.data as Record<string, unknown>;
          const resp = (raw.response ?? raw) as Record<string, unknown>;
          const traffic = resp.userTraffic as Record<string, unknown> | undefined;
          result[uuid] = {
            onlineAt: typeof traffic?.onlineAt === "string" ? traffic.onlineAt : null,
          };
        } catch {
          result[uuid] = { onlineAt: null };
        }
      })
    );

    return res.json(result);
  } catch (e) {
    console.error("POST /admin/clients/online-statuses error:", e);
    return res.status(500).json({ message: "Ошибка получения статусов" });
  }
});

const clientIdParam = z.object({ id: z.string().cuid() });

adminRouter.get("/clients/:id", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const client = await prisma.client.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      email: true,
      telegramId: true,
      telegramUsername: true,
      preferredLang: true,
      preferredCurrency: true,
      balance: true,
      referralCode: true,
      remnawaveUuid: true,
      trialUsed: true,
      isBlocked: true,
      blockReason: true,
      referralPercent: true,
      personalDiscountPercent: true,
      personalDiscountIsOneTime: true,
      createdAt: true,
      _count: { select: { referrals: true } },
      // текущий реферер для inline-редактора в карточке клиента.
      referrerId: true,
      referrer: { select: { id: true, email: true, telegramUsername: true, telegramId: true, referralCode: true } },
    },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  return res.json(client);
});

const updateClientSchema = z.object({
  email: z.string().email().nullable().optional(),
  preferredLang: z.string().max(5).optional(),
  preferredCurrency: z.string().max(5).optional(),
  balance: z.number().optional(),
  isBlocked: z.boolean().optional(),
  blockReason: z.string().nullable().optional(),
  referralPercent: z.number().min(0).max(100).nullable().optional(),
  personalDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  // флаг одноразовости персональной скидки.
  // true → скидка сгорит после первой продуктовой покупки (mark-paid). false → бессрочно.
  personalDiscountIsOneTime: z.boolean().optional(),
});

adminRouter.patch("/clients/:id", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = updateClientSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const client = await prisma.client.findUnique({ where: { id: parsed.data.id } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  const updates: Record<string, unknown> = {};
  if (body.data.email !== undefined) updates.email = body.data.email;
  if (body.data.preferredLang !== undefined) updates.preferredLang = body.data.preferredLang;
  if (body.data.preferredCurrency !== undefined) updates.preferredCurrency = body.data.preferredCurrency;
  if (body.data.balance !== undefined) updates.balance = body.data.balance;
  if (body.data.isBlocked !== undefined) updates.isBlocked = body.data.isBlocked;
  if (body.data.blockReason !== undefined) updates.blockReason = body.data.blockReason;
  if (body.data.referralPercent !== undefined) updates.referralPercent = body.data.referralPercent;
  if (body.data.personalDiscountPercent !== undefined) updates.personalDiscountPercent = body.data.personalDiscountPercent;
  if (body.data.personalDiscountIsOneTime !== undefined) updates.personalDiscountIsOneTime = body.data.personalDiscountIsOneTime;
  const updated = await prisma.client.update({
    where: { id: parsed.data.id },
    data: updates,
    select: {
      id: true,
      email: true,
      telegramId: true,
      telegramUsername: true,
      preferredLang: true,
      preferredCurrency: true,
      balance: true,
      referralCode: true,
      remnawaveUuid: true,
      trialUsed: true,
      isBlocked: true,
      blockReason: true,
      referralPercent: true,
      personalDiscountPercent: true,
      personalDiscountIsOneTime: true,
      createdAt: true,
      _count: { select: { referrals: true } },
    },
  });
  return res.json(updated);
});

const setClientPasswordSchema = z.object({
  newPassword: z.string().min(8, "Пароль не менее 8 символов"),
});

adminRouter.patch("/clients/:id/password", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = setClientPasswordSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const client = await prisma.client.findUnique({ where: { id: parsed.data.id } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  const passwordHash = await hashClientPassword(body.data.newPassword);
  await prisma.client.update({
    where: { id: parsed.data.id },
    data: { passwordHash },
  });
  return res.json({ success: true, message: "Пароль установлен" });
});

adminRouter.delete("/clients/:id", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const client = await prisma.client.findUnique({ where: { id: parsed.data.id }, select: { id: true, remnawaveUuid: true, telegramId: true, email: true } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });

  // T (11.05.2026): удалять ВСЕ Remna-юзеры клиента,
  // включая дополнительные подписки (secondary_subscriptions с собственным remnawave_uuid).
  // Раньше удалялся только primary, secondary висели в Remna навсегда.
  if (isRemnaConfigured()) {
    let remnaUuid = client.remnawaveUuid;

    // Если remnawaveUuid нет — ищем юзера в Remna по telegramId / email
    if (!remnaUuid && client.telegramId?.trim()) {
      const byTg = await remnaGetUserByTelegramId(client.telegramId.trim());
      remnaUuid = extractRemnaUuid(byTg.data);
    }
    if (!remnaUuid && client.email?.trim()) {
      const byEmail = await remnaGetUserByEmail(client.email.trim());
      remnaUuid = extractRemnaUuid(byEmail.data);
    }

    if (remnaUuid) {
      const remnaRes = await remnaDeleteUser(remnaUuid);
      if (remnaRes.error) {
        console.warn(`[admin delete client] Remna delete primary failed for ${remnaUuid}:`, remnaRes.error);
      }
    }

    // Удаляем все secondary-subscriptions этого клиента из Remna.
    // (БД-каскад удалит сами строки; но Remna-юзеров надо чистить через API).
    const secondaries = await prisma.subscription.findMany({
      where: { ownerId: parsed.data.id, remnawaveUuid: { not: null } },
      select: { id: true, remnawaveUuid: true, subscriptionIndex: true },
    });
    let deletedCount = 0;
    let failedCount = 0;
    for (const sec of secondaries) {
      if (!sec.remnawaveUuid) continue;
      try {
        const r = await remnaDeleteUser(sec.remnawaveUuid);
        if (r.error) {
          failedCount++;
          console.warn(`[admin delete client] Remna delete secondary #${sec.subscriptionIndex} (${sec.remnawaveUuid}) failed:`, r.error);
        } else {
          deletedCount++;
        }
      } catch (e) {
        failedCount++;
        console.warn(`[admin delete client] Remna delete secondary #${sec.subscriptionIndex} threw:`, e);
      }
    }
    if (secondaries.length > 0) {
      console.log(`[admin delete client ${parsed.data.id}] Remna secondary cleanup: ${deletedCount} deleted, ${failedCount} failed (of ${secondaries.length})`);
    }
  }

  // Удаление из БД: cascade удалит secondary_subscriptions, payments (через FK), trial_usages и т.д.
  await prisma.client.delete({ where: { id: parsed.data.id } });
  return res.json({ success: true });
});

// сначала смотрим primary-подписку (subscriptionIndex=0),
// fallback на legacy Client.remnawaveUuid. После унификации UUID у новых клиентов живёт в
// Subscription, legacy field остался ради старых юзеров до бэкфилла.
async function getClientRemnaUuid(clientId: string): Promise<string | null> {
  const primary = await prisma.subscription.findUnique({
    where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
    select: { remnawaveUuid: true },
  });
  if (primary?.remnawaveUuid) return primary.remnawaveUuid;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { remnawaveUuid: true },
  });
  return client?.remnawaveUuid ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Массовые операции над клиентом.
// Работают по всем подпискам клиента (Subscription[*]) — после унификации.
// Возвращают структурированный отчёт { ok, skipped, failed, items[] }.
// ─────────────────────────────────────────────────────────────────────────────

/** Composite «Отключить клиента»: бан в боте + disable VPN на всех подписках + autoRenew off. */
adminRouter.post("/clients/:id/disable", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const report = await bulkDisableClient(parsed.data.id);
  return res.json(report);
}));

/** Composite «Включить клиента»: разбан + Enable Remna для неистёкших подписок. */
adminRouter.post("/clients/:id/enable", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const report = await bulkEnableClient(parsed.data.id);
  return res.json(report);
}));

/** Только Remna: disable всех подписок клиента (бан в боте не трогаем). */
adminRouter.post("/clients/:id/disable-all", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await disableAllSubscriptionsInRemna(parsed.data.id));
}));

adminRouter.post("/clients/:id/enable-all", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await enableAllSubscriptionsInRemna(parsed.data.id));
}));

/** Сбросить трафик на всех подписках клиента. */
adminRouter.post("/clients/:id/reset-all-traffic", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await resetAllSubscriptionsTraffic(parsed.data.id));
}));

/** Перевыпустить subscription URL на всех подписках клиента. */
adminRouter.post("/clients/:id/revoke-all-subscriptions", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await revokeAllSubscriptionsUrls(parsed.data.id));
}));

/** Push БД → Remna для всех подписок (выровнять лимиты/сквады по тарифу). */
adminRouter.post("/clients/:id/sync-push", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await syncAllSubscriptionsToRemna(parsed.data.id));
}));

/** Pull Remna → БД (выровнять кеш в БД + найти лишних в Remna). */
adminRouter.post("/clients/:id/sync-pull", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await syncAllSubscriptionsFromRemna(parsed.data.id));
}));

/** Полный sync = Pull + Push (Remna → БД, потом БД → Remna). */
adminRouter.post("/clients/:id/sync", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const pullReport = await syncAllSubscriptionsFromRemna(parsed.data.id);
  const pushReport = await syncAllSubscriptionsToRemna(parsed.data.id);
  return res.json({ pull: pullReport, push: pushReport });
}));

/** Удалить все подписки клиента (DB + Remna). Клиент остаётся. */
adminRouter.post("/clients/:id/wipe-subscriptions", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await wipeClientSubscriptions(parsed.data.id));
}));

/** Audit (read-only): diff БД vs Remna. */
adminRouter.get("/clients/:id/audit", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await auditClientSubscriptions(parsed.data.id));
}));

/**
 * устройства со ВСЕХ подписок клиента.
 * Каждая `Subscription[*]` имеет свой Remna-юзер → свой набор HWID-устройств.
 * Возвращаем плоский список устройств с пометкой откуда (subscriptionIndex + tariff).
 */
adminRouter.get("/clients/:id/all-devices", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });

  // УНИФИЦИРОВАНО — ВСЕ устройства берутся только
  // из таблицы Subscription. client.remnawaveUuid — legacy, не учитывается (миграция:
  // root-подписка должна иметь Subscription-запись с subscriptionIndex=0).
  // Дедуп по UUID — на случай если две Subscription указывают на один Remna-юзер.
  const subs = await prisma.subscription.findMany({
    where: { ownerId: parsed.data.id },
    orderBy: { subscriptionIndex: "asc" },
    select: {
      id: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      tariff: { select: { name: true, menuEmoji: true } },
    },
  });

  const groups: Array<{
    subscriptionId: string;
    subscriptionIndex: number;
    tariffName: string | null;
    tariffEmoji: string | null;
    remnawaveUuid: string | null;
    devices: unknown[];
    deviceLimit: number | null;
  }> = [];
  let totalDevices = 0;
  const seenUuids = new Set<string>();

  for (const sub of subs) {
    if (!sub.remnawaveUuid) {
      groups.push({
        subscriptionId: sub.id,
        subscriptionIndex: sub.subscriptionIndex,
        tariffName: sub.tariff?.name ?? null,
        tariffEmoji: sub.tariff?.menuEmoji ?? null,
        remnawaveUuid: null,
        devices: [],
        deviceLimit: null,
      });
      continue;
    }
    if (seenUuids.has(sub.remnawaveUuid)) continue; // дедуп
    seenUuids.add(sub.remnawaveUuid);
    const r = await remnaGetUserHwidDevices(sub.remnawaveUuid);
    const d = (r.data as Record<string, unknown> | null)?.response as Record<string, unknown> | undefined;
    const devices = Array.isArray(d?.devices) ? (d.devices as unknown[]) : [];
    totalDevices += devices.length;

    let deviceLimit: number | null = null;
    const userRes = await remnaGetUser(sub.remnawaveUuid);
    const u = (userRes.data as Record<string, unknown> | null);
    const inner = (u?.response ?? u) as Record<string, unknown> | undefined;
    if (typeof inner?.hwidDeviceLimit === "number") deviceLimit = inner.hwidDeviceLimit;

    groups.push({
      subscriptionId: sub.id,
      subscriptionIndex: sub.subscriptionIndex,
      tariffName: sub.tariff?.name ?? null,
      tariffEmoji: sub.tariff?.menuEmoji ?? null,
      remnawaveUuid: sub.remnawaveUuid,
      devices,
      deviceLimit,
    });
  }
  return res.json({ groups, total: totalDevices });
}));

/**
 * сводка по всем подпискам клиента + Remna-данные.
 * Используется во вкладке «Remna» — показывает таблицу со всеми подписками клиента и
 * параметрами их Remna-юзеров: expireAt, traffic used/limit, deviceLimit, статус, squads.
 */
adminRouter.get("/clients/:id/subscriptions-overview", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });

  const subs = await prisma.subscription.findMany({
    where: { ownerId: parsed.data.id },
    orderBy: { subscriptionIndex: "asc" },
    select: {
      id: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      tariffId: true,
      trialId: true,
      purchasedAsGift: true,
      giftStatus: true,
      autoRenewEnabled: true,
      customPrice: true,
      tariff: { select: { name: true, menuEmoji: true, durationDays: true } },
      trial: { select: { name: true, durationDays: true } },
    },
  });

  const items = [] as Array<{
    subscriptionId: string;
    subscriptionIndex: number;
    tariffName: string | null;
    tariffEmoji: string | null;
    isTrial: boolean;
    trialName: string | null;
    purchasedAsGift: boolean;
    giftStatus: string | null;
    autoRenewEnabled: boolean;
    customPrice: number | null;
    remnawaveUuid: string | null;
    remna: {
      username: string | null;
      status: string | null;
      expireAt: string | null;
      trafficLimitBytes: number | null;
      trafficUsedBytes: number | null;
      hwidDeviceLimit: number | null;
      deviceCount: number;
      activeSquadsCount: number;
      subscriptionUrl: string | null;
      onlineAt: string | null;
    } | null;
  }>;

  for (const sub of subs) {
    let remna: typeof items[number]["remna"] = null;
    if (sub.remnawaveUuid) {
      const r = await remnaGetUser(sub.remnawaveUuid);
      const u = (r.data as Record<string, unknown> | null);
      const inner = (u?.response ?? u) as Record<string, unknown> | undefined;
      const traffic = (inner?.userTraffic ?? {}) as Record<string, unknown>;
      const squads = Array.isArray(inner?.activeInternalSquads) ? (inner.activeInternalSquads as unknown[]) : [];
      const devicesRes = await remnaGetUserHwidDevices(sub.remnawaveUuid).catch(() => ({ data: null }));
      const d = (devicesRes.data as Record<string, unknown> | null)?.response as Record<string, unknown> | undefined;
      const devices = Array.isArray(d?.devices) ? (d.devices as unknown[]) : [];
      remna = {
        username: typeof inner?.username === "string" ? inner.username : null,
        status: typeof inner?.status === "string" ? inner.status : null,
        expireAt: typeof inner?.expireAt === "string" ? inner.expireAt : null,
        trafficLimitBytes: typeof inner?.trafficLimitBytes === "number" ? inner.trafficLimitBytes : null,
        trafficUsedBytes: typeof traffic?.usedTrafficBytes === "number" ? traffic.usedTrafficBytes : null,
        hwidDeviceLimit: typeof inner?.hwidDeviceLimit === "number" ? inner.hwidDeviceLimit : null,
        deviceCount: devices.length,
        activeSquadsCount: squads.length,
        subscriptionUrl: typeof inner?.subscriptionUrl === "string" ? inner.subscriptionUrl : null,
        onlineAt: typeof inner?.onlineAt === "string" ? inner.onlineAt : null,
      };
    }
    items.push({
      subscriptionId: sub.id,
      subscriptionIndex: sub.subscriptionIndex,
      tariffName: sub.tariff?.name ?? null,
      tariffEmoji: sub.tariff?.menuEmoji ?? null,
      isTrial: sub.trialId != null,
      trialName: sub.trial?.name ?? null,
      purchasedAsGift: sub.purchasedAsGift,
      giftStatus: sub.giftStatus,
      autoRenewEnabled: sub.autoRenewEnabled,
      customPrice: sub.customPrice,
      remnawaveUuid: sub.remnawaveUuid,
      remna,
    });
  }
  return res.json({ items });
}));



adminRouter.get("/clients/:id/remna", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaGetUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

const remnaUpdateBodySchema = z.object({
  trafficLimitBytes: z.number().int().min(0).optional(),
  trafficLimitStrategy: z.enum(["NO_RESET", "DAY", "WEEK", "MONTH", "MONTH_ROLLING"]).optional(),
  hwidDeviceLimit: z.number().int().min(0).nullable().optional(),
  expireAt: z.string().datetime().optional(),
  activeInternalSquads: z.array(z.string().uuid()).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  telegramId: z.number().int().nullable().optional(),
  email: z.string().email().nullable().optional(),
});

/** Извлечь из ответа Remna getUser: activeInternalSquads (uuid[]), telegramId, email — чтобы не затирать при PATCH. */
function getRemnaUserFieldsForMerge(data: unknown): { activeInternalSquads: string[]; telegramId?: number; email?: string | null } {
  if (!data || typeof data !== "object") return { activeInternalSquads: [] };
  const o = data as Record<string, unknown>;
  const resp = (o.response ?? o) as Record<string, unknown> | undefined;
  const ais = resp?.activeInternalSquads;
  const squads: string[] = [];
  if (Array.isArray(ais)) {
    for (const s of ais) {
      const u = (s && typeof s === "object" && "uuid" in s) ? (s as Record<string, unknown>).uuid : s;
      if (typeof u === "string") squads.push(u);
    }
  }
  return {
    activeInternalSquads: squads,
    ...(typeof resp?.telegramId === "number" && { telegramId: resp.telegramId }),
    ...(resp?.email !== undefined && { email: resp.email != null ? String(resp.email) : null }),
  };
}

adminRouter.patch("/clients/:id/remna", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const body = remnaUpdateBodySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const getRes = await remnaGetUser(remnaUuid);
  if (getRes.error) return res.status(getRes.status >= 400 ? getRes.status : 500).json({ message: getRes.error });
  const current = getRemnaUserFieldsForMerge(getRes.data);
  const patchBody: Record<string, unknown> = { uuid: remnaUuid };
  if (body.data.activeInternalSquads === undefined && current.activeInternalSquads.length > 0) patchBody.activeInternalSquads = current.activeInternalSquads;
  if (body.data.telegramId === undefined && current.telegramId !== undefined) patchBody.telegramId = current.telegramId;
  if (body.data.email === undefined && current.email !== undefined) patchBody.email = current.email;
  Object.assign(patchBody, body.data);
  const result = await remnaUpdateUser(patchBody);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  // после успешного PATCH в Remna зеркалим expireAt
  // в БД (Subscription.expireAt у любой подписки с этим uuid). Раньше изменения
  // через admin UI расходились с БД.
  if (body.data.expireAt) {
    try {
      await prisma.subscription.updateMany({
        where: { ownerId: parsed.data.id, remnawaveUuid: remnaUuid },
        data: { expireAt: new Date(body.data.expireAt) },
      });
    } catch (e) {
      console.error("[admin/clients/remna] expireAt DB sync failed:", e);
    }
  }
  return res.json(result.data ?? {});
});

/**
 * Отвязать клиента от Remna (обнулить remnawaveUuid).
 *
 * Кейс: Remna-пользователь удалён (руками в панели Remna), но клиент в нашей БД остался
 * с «повисшим» remnawaveUuid → syncToRemna не находит его в Remna и выдаёт «fetch failed».
 * Этот endpoint разрывает связь — клиент остаётся, но считается «без VPN»; при следующей
 * покупке тарифа будет создан новый Remna-пользователь.
 */
adminRouter.post("/clients/:id/remna/unlink", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const client = await prisma.client.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, remnawaveUuid: true },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  if (!client.remnawaveUuid) return res.status(400).json({ message: "Клиент уже не привязан к Remna" });
  await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: null } });
  return res.json({ ok: true });
});

adminRouter.post("/clients/:id/remna/revoke-subscription", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaRevokeUserSubscription(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminRouter.post("/clients/:id/remna/disable", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaDisableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminRouter.post("/clients/:id/remna/enable", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaEnableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminRouter.post("/clients/:id/remna/reset-traffic", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaResetUserTraffic(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

const grantTariffSchema = z.object({
  tariffId: z.string().min(1),
  // Опционально: конкретная опция длительности из priceOptions тарифа.
  // Если не указано — используется опция с минимальной ценой (default).
  tariffPriceOptionId: z.string().min(1).optional(),
  // Количество ДОП. устройств (0..tariff.maxExtraDevices). Если не задано — 0.
  deviceCount: z.number().int().min(0).max(100).optional(),
  note: z.string().max(500).optional(),
  createPaymentRecord: z.boolean().optional(),
  // override лимита трафика в БАЙТАХ.
  // Применяется только если у тарифа НЕ безлимит (tariff.trafficLimitBytes > 0).
  // null/undefined → используется лимит тарифа. 0 → безлимит (можно сделать безлимит из лимитного).
  trafficLimitBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  // override длительности в днях. Если задано, перебивает
  // selectedOption.durationDays / tariff.durationDays. Используется админом для
  // выдачи нестандартной длительности (например, компенсация = 7 дней).
  // Диапазон 1..3650 (10 лет максимум, sanity-cap).
  customDurationDays: z.number().int().min(1).max(3650).optional(),
});

/**
 * POST /admin/clients/:id/grant-tariff
 * Выдаёт тариф клиенту вручную (без оплаты). Создаёт запись Payment со статусом PAID,
 * amount=0, provider="admin_grant", и активирует подписку в Remnawave.
 * Подходит для компенсаций, бонусов, корректировок — без начисления реферальных бонусов.
 */
adminRouter.post("/clients/:id/grant-tariff", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = grantTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });

  const clientId = parsed.data.id;
  const { tariffId, tariffPriceOptionId, deviceCount, note, createPaymentRecord = true, trafficLimitBytes: trafficLimitOverride, customDurationDays } = body.data;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, remnawaveUuid: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });

  const tariff = await prisma.tariff.findUnique({
    where: { id: tariffId },
    include: { priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } },
  });
  if (!tariff) return res.status(404).json({ message: "Тариф не найден" });

  // Выбираем опцию: явный priceOptionId → найти и проверить; иначе — опция с минимальной ценой
  // (или fallback на legacy tariff.durationDays + tariff.price если опций нет).
  let selectedOption: { id: string; durationDays: number; price: number } | null = null;
  if (tariffPriceOptionId) {
    const opt = tariff.priceOptions.find((o) => o.id === tariffPriceOptionId);
    if (!opt) return res.status(400).json({ message: "Опция цены не найдена в этом тарифе" });
    selectedOption = { id: opt.id, durationDays: opt.durationDays, price: opt.price };
  } else if (tariff.priceOptions.length > 0) {
    const sorted = [...tariff.priceOptions].sort((a, b) => a.price - b.price);
    selectedOption = { id: sorted[0].id, durationDays: sorted[0].durationDays, price: sorted[0].price };
  }

  const adminId = (req as unknown as { adminId: string }).adminId;
  const now = new Date();

  // Количество ДОП. устройств клиенту бонусом (0..tariff.maxExtraDevices).
  // Параметр deviceCount в API — это extraDevices (legacy имя сохранено для совместимости фронта).
  const effectiveExtras = Math.min(Math.max(0, deviceCount ?? 0), tariff.maxExtraDevices);

  let paymentId: string | null = null;
  if (createPaymentRecord) {
    const orderId = `admin-grant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const payment = await createPayment({
        data: {
          clientId,
          orderId,
          amount: 0,
          currency: tariff.currency,
          status: "PAID",
          provider: "admin_grant",
          tariffId: tariff.id,
          tariffPriceOptionId: selectedOption?.id ?? null,
          deviceCount: effectiveExtras,
          paidAt: now,
          metadata: JSON.stringify({ grantedBy: adminId, note: note ?? null, kind: "admin_grant" }),
        },
        select: { id: true },
      });
      paymentId = payment.id;
    } catch (e) {
      console.error("[admin/grant-tariff] Не удалось создать Payment:", e);
    }
  }

  // админская выдача = НОВАЯ подписка клиенту (НЕ подарок).
  // можно переопределить trafficLimitBytes (только если у тарифа не безлимит).
  // Применяется ТОЛЬКО для лимитных тарифов: если у тарифа уже безлимит — override игнорируем.
  const hasTariffLimit = tariff.trafficLimitBytes != null && Number(tariff.trafficLimitBytes) > 0;
  const effectiveTrafficLimit: bigint | null =
    hasTariffLimit && trafficLimitOverride !== undefined && trafficLimitOverride !== null
      ? BigInt(trafficLimitOverride)
      : tariff.trafficLimitBytes;

  // customDurationDays перебивает выбор опции / legacy fallback.
  // Полезно если админ хочет выдать нестандартный срок (например, 7 дн. компенсации).
  const effectiveDurationDays = customDurationDays ?? selectedOption?.durationDays ?? tariff.durationDays;

  const { createAdditionalSubscription } = await import("../gift/gift.service.js");
  const subResult = await createAdditionalSubscription(clientId, {
    id: tariff.id,
    name: tariff.name,
    price: selectedOption?.price ?? tariff.price,
    durationDays: effectiveDurationDays,
    trafficLimitBytes: effectiveTrafficLimit,
    deviceLimit: tariff.deviceLimit,
    includedDevices: tariff.includedDevices,
    internalSquadUuids: tariff.internalSquadUuids,
    trafficResetMode: tariff.trafficResetMode ?? undefined,
  }, { skipConfigCheck: true, extraDevices: effectiveExtras, purchasedAsGift: false });

  if (!subResult.ok) {
    if (paymentId) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "FAILED", metadata: JSON.stringify({ grantedBy: adminId, note: note ?? null, kind: "admin_grant", error: subResult.error }) },
      }).catch(() => { /* ignore */ });
    }
    return res.status(subResult.status && subResult.status >= 400 ? subResult.status : 500).json({
      ok: false,
      message: subResult.error ?? "Ошибка активации тарифа",
    });
  }

  // T-unify: привязываем Payment к созданной Subscription (для аналитики + auto-renew).
  if (paymentId) {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { subscriptionId: subResult.data.subscriptionId },
    }).catch(() => { /* ignore */ });
    // отправляем клиенту уведомление в Telegram о выдаче подписки
    // (тот же поток что после обычной оплаты — текст с ссылкой подписки и кнопками).
    try {
      const { notifyTariffActivated } = await import("../notification/telegram-notify.service.js");
      await notifyTariffActivated(clientId, paymentId);
    } catch (e) {
      console.error("[admin/grant-tariff] notify client failed:", e);
    }
  }

  return res.json({
    ok: true,
    paymentId,
    subscriptionId: subResult.data.subscriptionId,
    subscriptionIndex: subResult.data.subscriptionIndex,
    // возвращаем выбранную опцию длительности,
    // а не tariff.durationDays (legacy минимум). Раньше success-сообщение всегда показывало 30 дн.
    // если был customDurationDays, возвращаем именно его.
    tariff: { id: tariff.id, name: tariff.name, durationDays: effectiveDurationDays },
  });
});

const squadActionSchema = z.object({ squadUuid: z.string().uuid() });

adminRouter.post("/clients/:id/remna/squads/add", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  // Получаем текущие сквады пользователя, чтобы добавить новый без потери существующих
  const userRes = await remnaGetUser(remnaUuid);
  const userData = userRes.data as Record<string, unknown> | undefined;
  const resp = (userData?.response ?? userData) as Record<string, unknown> | undefined;
  const currentSquads: string[] = [];
  const ais = resp?.activeInternalSquads;
  if (Array.isArray(ais)) {
    for (const s of ais) {
      const u = (s && typeof s === "object" && "uuid" in s) ? (s as Record<string, unknown>).uuid : s;
      if (typeof u === "string") currentSquads.push(u);
    }
  }
  if (!currentSquads.includes(body.data.squadUuid)) {
    currentSquads.push(body.data.squadUuid);
  }
  const result = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminRouter.post("/clients/:id/remna/squads/remove", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  // По api-1.yaml у DELETE .../remove-users нет requestBody — только uuid сквада в path; эндпоинт может убирать всех из сквада. Поэтому убираем сквад только у этого пользователя через PATCH user (как при add).
  const userRes = await remnaGetUser(remnaUuid);
  if (userRes.error) return res.status(userRes.status >= 400 ? userRes.status : 500).json({ message: userRes.error });
  const current = getRemnaUserFieldsForMerge(userRes.data);
  const currentSquads = current.activeInternalSquads.filter((u) => u !== body.data.squadUuid);
  const result = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminRouter.get("/clients/:id/remna/devices", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaGetUserHwidDevices(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

const deleteDeviceSchema = z.object({ hwid: z.string().min(1) });

adminRouter.post("/clients/:id/remna/devices/delete", requireAction("delete_device"), async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const body = deleteDeviceSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const result = await remnaDeleteUserHwidDevice(remnaUuid, body.data.hwid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { success: true });
});

adminRouter.get("/clients/:id/remna/usage", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const result = await remnaGetUserBandwidthStats(remnaUuid, fmt(start), fmt(end));
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

// Настройки (языки, валюты, название сервиса) — для бота, mini app, сайта
adminRouter.get("/settings", asyncRoute(async (_req, res) => {
  const config = await getSystemConfig();
  return res.json(config);
}));

/** Версия панели — для мониторинга. Под auth, чтобы не светить наружу. */
adminRouter.get("/version", asyncRoute(async (_req, res) => {
  return res.json({ version: "5.0.0" });
}));

/**
 * GET /api/admin/lavatop/products
 *
 * Прокси к Lava.top API: возвращает список всех продуктов оператора со
 * вложенными офферами. UI админки использует это чтобы показать удобный
 * список offer ID — оператор копирует нужный UUID в поле тарифа.
 *
 * Аутентификация — текущий API-key из system_settings.lavatop_api_key.
 */
adminRouter.get("/lavatop/products", asyncRoute(async (_req, res) => {
  const config = await getSystemConfig();
  const apiKey = (config as { lavatopApiKey?: string | null }).lavatopApiKey?.trim();
  if (!apiKey) {
    return res.status(400).json({ message: "Lava.top API-ключ не настроен. Сначала введите его в Settings → Платежи → Lava.top." });
  }
  try {
    const r = await fetch("https://gate.lava.top/api/v2/products", {
      method: "GET",
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    });
    const text = await r.text();
    if (r.status === 401) {
      return res.status(401).json({ message: "Lava.top: неверный API-ключ (401)" });
    }
    if (!r.ok) {
      return res.status(r.status).json({ message: `Lava.top API ${r.status}: ${text.slice(0, 300)}` });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
      return res.status(502).json({ message: "Lava.top вернул невалидный JSON" });
    }
    type LavatopOffer = {
      id: string;
      name?: string;
      description?: string;
      prices?: { currency: string; amount: number; periodicity: string }[];
    };
    type LavatopProduct = {
      id: string;
      title?: string;
      description?: string;
      type?: string;
      offers?: LavatopOffer[];
    };
    const data = parsed as { items?: LavatopProduct[] } | LavatopProduct[];
    const items: LavatopProduct[] = Array.isArray(data)
      ? (data as LavatopProduct[])
      : Array.isArray(data?.items) ? data.items : [];

    // Нормализуем: плоский список офферов с привязкой к продукту
    const offers = items.flatMap((p) =>
      (p.offers ?? []).map((o) => ({
        offerId: o.id,
        offerName: o.name ?? "",
        offerDescription: (o.description ?? "").slice(0, 200),
        productId: p.id,
        productTitle: p.title ?? "",
        productType: p.type ?? "",
        prices: (o.prices ?? []).map((pr) => ({
          currency: pr.currency,
          amount: pr.amount,
          periodicity: pr.periodicity,
        })),
      })),
    );

    return res.json({
      productCount: items.length,
      offerCount: offers.length,
      offers,
      products: items.map((p) => ({ id: p.id, title: p.title, type: p.type, offerCount: (p.offers ?? []).length })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ message: `Lava.top: нет связи (${msg})` });
  }
}));

/**
 * Базовый конфиг страницы подписки (subpage-00000000-0000-0000-0000-000000000000.json)
 * для визуального редактора. В Docker файл подмонтирован как volume
 * (см. docker-compose.yml), поэтому изменения файла на хосте подхватываются
 * без пересборки контейнера.
 *
 * Логика поиска (по убыванию приоритета):
 *   1. /app/subpage-...json (volume-mount или COPY из образа) — primary
 *   2. process.cwd()-варианты для dev-окружения (npm run dev из backend/)
 *   3. /app/defaults/subpage-...json — fallback из образа, если primary
 *      сломан (пустой каталог при отсутствии файла на хосте, битый JSON и т.п.)
 *
 * Кэш на 30 секунд в памяти, чтобы не читать файл при каждом GET.
 * `?fresh=1` сбрасывает кэш — используется кнопкой «Перезагрузить с сервера» в UI.
 */
let _defaultSubpageCache: { data: unknown; ts: number } | null = null;
const SUBPAGE_CACHE_TTL_MS = 30_000;

async function tryReadJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch {
    // ENOENT, EISDIR (volume на отсутствующий файл монтируется как пустой каталог),
    // невалидный JSON — все случаи прозрачно скипаем и идём к следующему кандидату.
    return null;
  }
}

adminRouter.get("/default-subscription-page-config", asyncRoute(async (req, res) => {
  // ?fresh=1 — принудительный сброс кэша (используется при ручной перезагрузке)
  const fresh = req.query.fresh === "1" || req.query.fresh === "true";
  if (!fresh && _defaultSubpageCache && Date.now() - _defaultSubpageCache.ts < SUBPAGE_CACHE_TTL_MS) {
    return res.json(_defaultSubpageCache.data);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const fileName = "subpage-00000000-0000-0000-0000-000000000000.json";
  const candidates = [
    // 1. Primary: /app/subpage-...json (Docker volume-mount или COPY из образа)
    path.join(process.cwd(), fileName),
    // 2. Dev: запуск из backend/ (npm run dev)
    path.join(process.cwd(), "..", fileName),
    path.join(__dirname, "..", "..", "..", "..", fileName),
    path.join(__dirname, "..", "..", "..", "..", "..", fileName),
    // 3. Fallback из образа (всегда валидный snapshot версии на момент сборки)
    path.join(process.cwd(), "defaults", fileName),
    "/app/defaults/" + fileName,
  ];

  for (const configPath of candidates) {
    const data = await tryReadJsonFile(configPath);
    if (data !== null) {
      _defaultSubpageCache = { data, ts: Date.now() };
      return res.json(data);
    }
  }
  return res.status(404).json({ message: "Default config file not found" });
}));

const updateSettingsSchema = z.object({
  activeLanguages: z.string().optional(),
  activeCurrencies: z.string().optional(),
  defaultLanguage: z.string().max(10).optional(),
  defaultCurrency: z.string().max(10).optional(),
  defaultReferralPercent: z.number().optional(),
  referralPercentLevel2: z.number().min(0).max(100).optional(),
  referralPercentLevel3: z.number().min(0).max(100).optional(),
  trialDays: z.number().int().min(0).optional(),
  trialSquadUuid: z.string().uuid().nullable().optional(),
  trialDeviceLimit: z.number().int().min(0).nullable().optional(),
  trialTrafficLimitBytes: z.number().int().min(0).nullable().optional(),
  serviceName: z.string().max(200).optional(),
  logo: z.string().max(5_500_000).nullable().optional(),
  logoBot: z.string().max(5_500_000).nullable().optional(),
  favicon: z.string().max(5_500_000).nullable().optional(),
  cabinetDesign: z.enum(["classic", "stealth"]).optional(),
  cabinetDesignApplyInBrowser: z.boolean().optional(),
  remnaClientUrl: z.string().max(2000).nullable().optional(),
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(255).nullable().optional(),
  smtpPassword: z.string().max(500).nullable().optional(),
  smtpFromEmail: z.string().email().max(255).nullable().optional(),
  smtpFromName: z.string().max(200).nullable().optional(),
  publicAppUrl: z.string().max(2000).nullable().optional(),
  telegramBotToken: z.string().max(500).nullable().optional(),
  telegramBotUsername: z.string().max(100).nullable().optional(),
  botAdminTelegramIds: z.union([z.string().max(2000), z.array(z.string())]).nullable().optional(),
  notificationTelegramGroupId: z.string().max(100).nullable().optional(),
  notificationManagersGroupId: z.string().max(100).nullable().optional(),
  notificationManagersTopicTickets: z.string().max(50).nullable().optional(),
  notificationTopicNewClients: z.string().max(50).nullable().optional(),
  notificationTopicPayments: z.string().max(50).nullable().optional(),
  notificationTopicTickets: z.string().max(50).nullable().optional(),
  notificationTopicBackups: z.string().max(50).nullable().optional(),
  autoBackupEnabled: z.boolean().optional(),
  autoBackupCron: z.string().max(50).nullable().optional(),
  plategaMerchantId: z.string().max(200).nullable().optional(),
  plategaSecret: z.string().max(500).nullable().optional(),
  plategaMethods: z.string().max(2000).nullable().optional(),
  /** HMAC секрет для проверки подписи webhook'ов Platega — security fix против форджинга платежей. */
  plategaWebhookSecret: z.string().max(500).nullable().optional(),
  paymentProvidersConfig: z.string().max(5000).nullable().optional(),
  gramadsApiKey: z.string().max(1000).nullable().optional(),
  yoomoneyClientId: z.string().max(200).nullable().optional(),
  yoomoneyClientSecret: z.string().max(500).nullable().optional(),
  yoomoneyReceiverWallet: z.string().max(50).nullable().optional(),
  yoomoneyNotificationSecret: z.string().max(500).nullable().optional(),
  yookassaShopId: z.string().max(200).nullable().optional(),
  yookassaSecretKey: z.string().max(500).nullable().optional(),
  /** Basic-auth username для webhook ЮKassa — security fix против форджинга платежей. */
  yookassaWebhookBasicUser: z.string().max(200).nullable().optional(),
  /** Basic-auth password для webhook ЮKassa — security fix против форджинга платежей. */
  yookassaWebhookBasicPassword: z.string().max(500).nullable().optional(),
  cryptopayApiToken: z.string().max(500).nullable().optional(),
  cryptopayTestnet: z.boolean().optional(),
  heleketMerchantId: z.string().max(500).nullable().optional(),
  heleketApiKey: z.string().max(500).nullable().optional(),
  lavaShopId: z.string().max(200).nullable().optional(),
  lavaSecretKey: z.string().max(500).nullable().optional(),
  lavaAdditionalKey: z.string().max(500).nullable().optional(),
  lavatopApiKey: z.string().max(500).nullable().optional(),
  lavatopDefaultOfferId: z.string().max(200).nullable().optional(),
  // Приветствие в боте при /start
  botWelcomeEnabled: z.boolean().optional(),
  botWelcomeText: z.string().max(4000).nullable().optional(),
  botWelcomeImage: z.string().max(5_500_000).nullable().optional(), // data URL base64
  botWelcomeShowOnce: z.boolean().optional(),
  overpayApiUrl: z.string().max(500).nullable().optional(),
  overpayProjectId: z.string().max(100).nullable().optional(),
  overpayLogin: z.string().max(200).nullable().optional(),
  overpayPassword: z.string().max(500).nullable().optional(),
  groqApiKey: z.string().max(500).nullable().optional(),
  groqModel: z.string().max(100).nullable().optional(),
  groqFallback1: z.string().max(100).nullable().optional(),
  groqFallback2: z.string().max(100).nullable().optional(),
  groqFallback3: z.string().max(100).nullable().optional(),
  aiSystemPrompt: z.string().max(5000).nullable().optional(),
  botButtons: z.string().max(10000).nullable().optional(),
  botButtonsPerRow: z.union([z.literal(1), z.literal(2), z.number().int().min(1).max(2)]).optional(),
  botEmojis: z.union([z.string().max(15000), z.record(z.object({ unicode: z.string().max(20).optional(), tgEmojiId: z.string().max(50).optional() }))]).nullable().optional(),
  botBackLabel: z.string().max(200).nullable().optional(),
  // редактируемый текст шапки «📱 Мои устройства».
  botDevicesText: z.string().max(8000).nullable().optional(),
  botMenuTexts: z.string().max(8000).nullable().optional(),
  botMenuLineVisibility: z.union([z.string().max(5000), z.record(z.boolean())]).nullable().optional(),
  botInnerButtonStyles: z.union([z.string().max(2000), z.record(z.string())]).nullable().optional(),
  botTariffsText: z.string().max(8000).nullable().optional(),
  botTariffsFields: z.union([z.string().max(2000), z.record(z.boolean())]).nullable().optional(),
  botPaymentText: z.string().max(8000).nullable().optional(),
  subscriptionPageConfig: z.string().max(500000).nullable().optional(),
  supportLink: z.string().max(2000).nullable().optional(),
  agreementLink: z.string().max(2000).nullable().optional(),
  offerLink: z.string().max(2000).nullable().optional(),
  instructionsLink: z.string().max(2000).nullable().optional(),
  // ссылка инструкции по рефералке.
  referralInstructionsUrl: z.string().max(2000).nullable().optional(),
  // T11+T13+T14 (11.05.2026) — кастомизация бота
  refundLink: z.string().max(2000).nullable().optional(),
  supportHoursFrom: z.string().max(20).nullable().optional(),
  supportHoursTo: z.string().max(20).nullable().optional(),
  tgProxyText: z.string().max(8000).nullable().optional(),
  tgProxyUrlPrimary: z.string().max(2000).nullable().optional(),
  tgProxyUrlBackup: z.string().max(2000).nullable().optional(),
  // динамический список TG-прокси-серверов. Заменяет
  // primary/backup на массив. Каждый элемент: {flag: "🇳🇱", name: "Нидерланды",
  // url: "tg://proxy?..."}. Хранится как JSON-строка в system_settings.
  // Старые поля primary/backup остаются для backward compat: бот их использует
  // как fallback, если массив пуст.
  tgProxyServers: z.string().max(16000).nullable().optional(),
  reissueWarningText: z.string().max(4000).nullable().optional(),
  installSecondDeviceText: z.string().max(8000).nullable().optional(),
  helpIntroText: z.string().max(8000).nullable().optional(),
  ticketsEnabled: z.boolean().optional(),
  themeAccent: z.string().max(50).optional(),
  allowUserThemeChange: z.boolean().optional(),
  forceSubscribeEnabled: z.boolean().optional(),
  forceSubscribeChannelId: z.string().max(200).nullable().optional(),
  forceSubscribeMessage: z.string().max(1000).nullable().optional(),
  blacklistEnabled: z.boolean().optional(),
  sellOptionsEnabled: z.boolean().optional(),
  sellOptionsTrafficEnabled: z.boolean().optional(),
  sellOptionsTrafficProducts: z.string().max(10000).nullable().optional(),
  sellOptionsDevicesEnabled: z.boolean().optional(),
  sellOptionsDevicesProducts: z.string().max(10000).nullable().optional(),
  sellOptionsServersEnabled: z.boolean().optional(),
  sellOptionsServersProducts: z.string().max(10000).nullable().optional(),
  googleAnalyticsId: z.string().max(100).nullable().optional(),
  yandexMetrikaId: z.string().max(100).nullable().optional(),
  autoBroadcastCron: z.string().max(100).nullable().optional(),
  adminFrontNotificationsEnabled: z.boolean().optional(),
  skipEmailVerification: z.boolean().optional(),
  signupProtectionEnabled: z.boolean().optional(),
  emailDomainBlocklist: z.string().max(10000).optional(),
  emailPatternBlocklist: z.string().max(10000).optional(),
  signupMaxPerIpPerHour: z.number().int().min(1).max(1000).optional(),
  happCryptEnabled: z.boolean().optional(),
  useRemnaSubscriptionPage: z.boolean().optional(),
  aiChatEnabled: z.boolean().optional(),
  customBuildEnabled: z.boolean().optional(),
  customBuildPricePerDay: z.number().min(0).optional(),
  customBuildPricePerDevice: z.number().min(0).optional(),
  customBuildTrafficMode: z.enum(["unlimited", "per_gb"]).optional(),
  customBuildPricePerGb: z.number().min(0).optional(),
  customBuildSquadUuid: z.string().uuid().nullable().optional(),
  customBuildCurrency: z.string().max(10).optional(),
  customBuildMaxDays: z.number().int().min(1).max(360).optional(),
  customBuildMaxDevices: z.number().int().min(1).max(20).optional(),
  defaultAutoRenewEnabled: z.boolean().optional(),
  autoRenewDaysBeforeExpiry: z.number().int().min(1).max(30).optional(),
  autoRenewNotifyDaysBefore: z.number().int().min(1).max(30).optional(),
  autoRenewGracePeriodDays: z.number().int().min(0).max(14).optional(),
  autoRenewMaxRetries: z.number().int().min(1).max(10).optional(),
  yookassaRecurringEnabled: z.boolean().optional(),
  googleLoginEnabled: z.boolean().optional(),
  googleClientId: z.string().max(500).nullable().optional(),
  googleClientSecret: z.string().max(500).nullable().optional(),
  appleLoginEnabled: z.boolean().optional(),
  appleClientId: z.string().max(500).nullable().optional(),
  appleTeamId: z.string().max(100).nullable().optional(),
  appleKeyId: z.string().max(100).nullable().optional(),
  applePrivateKey: z.string().max(5000).nullable().optional(),
  landingEnabled: z.boolean().optional(),
  landingHeroTitle: z.string().max(500).nullable().optional(),
  landingHeroSubtitle: z.string().max(2000).nullable().optional(),
  landingHeroCtaText: z.string().max(100).nullable().optional(),
  landingShowTariffs: z.boolean().optional(),
  landingContacts: z.string().max(5000).nullable().optional(),
  landingOfferLink: z.string().max(2000).nullable().optional(),
  landingPrivacyLink: z.string().max(2000).nullable().optional(),
  landingFooterText: z.string().max(2000).nullable().optional(),
  landingHeroBadge: z.string().max(200).nullable().optional(),
  landingHeroHint: z.string().max(500).nullable().optional(),
  landingFeature1Label: z.string().max(200).nullable().optional(),
  landingFeature1Sub: z.string().max(200).nullable().optional(),
  landingFeature2Label: z.string().max(200).nullable().optional(),
  landingFeature2Sub: z.string().max(200).nullable().optional(),
  landingFeature3Label: z.string().max(200).nullable().optional(),
  landingFeature3Sub: z.string().max(200).nullable().optional(),
  landingFeature4Label: z.string().max(200).nullable().optional(),
  landingFeature4Sub: z.string().max(200).nullable().optional(),
  landingFeature5Label: z.string().max(200).nullable().optional(),
  landingFeature5Sub: z.string().max(200).nullable().optional(),
  landingBenefitsTitle: z.string().max(200).nullable().optional(),
  landingBenefitsSubtitle: z.string().max(1000).nullable().optional(),
  landingBenefit1Title: z.string().max(200).nullable().optional(),
  landingBenefit1Desc: z.string().max(1000).nullable().optional(),
  landingBenefit2Title: z.string().max(200).nullable().optional(),
  landingBenefit2Desc: z.string().max(1000).nullable().optional(),
  landingBenefit3Title: z.string().max(200).nullable().optional(),
  landingBenefit3Desc: z.string().max(1000).nullable().optional(),
  landingBenefit4Title: z.string().max(200).nullable().optional(),
  landingBenefit4Desc: z.string().max(1000).nullable().optional(),
  landingBenefit5Title: z.string().max(200).nullable().optional(),
  landingBenefit5Desc: z.string().max(1000).nullable().optional(),
  landingBenefit6Title: z.string().max(200).nullable().optional(),
  landingBenefit6Desc: z.string().max(1000).nullable().optional(),
  landingTariffsTitle: z.string().max(200).nullable().optional(),
  landingTariffsSubtitle: z.string().max(500).nullable().optional(),
  landingDevicesTitle: z.string().max(200).nullable().optional(),
  landingDevicesSubtitle: z.string().max(500).nullable().optional(),
  landingFaqTitle: z.string().max(200).nullable().optional(),
  landingFaqJson: z.string().max(20000).nullable().optional(),
  landingHeroHeadline1: z.string().max(300).nullable().optional(),
  landingHeroHeadline2: z.string().max(300).nullable().optional(),
  landingHeaderBadge: z.string().max(200).nullable().optional(),
  landingButtonLogin: z.string().max(100).nullable().optional(),
  landingButtonLoginCabinet: z.string().max(100).nullable().optional(),
  landingNavBenefits: z.string().max(100).nullable().optional(),
  landingNavTariffs: z.string().max(100).nullable().optional(),
  landingNavDevices: z.string().max(100).nullable().optional(),
  landingNavFaq: z.string().max(100).nullable().optional(),
  landingBenefitsBadge: z.string().max(200).nullable().optional(),
  landingDefaultPaymentText: z.string().max(300).nullable().optional(),
  landingButtonChooseTariff: z.string().max(100).nullable().optional(),
  landingNoTariffsMessage: z.string().max(500).nullable().optional(),
  landingButtonWatchTariffs: z.string().max(100).nullable().optional(),
  landingButtonStart: z.string().max(100).nullable().optional(),
  landingButtonOpenCabinet: z.string().max(100).nullable().optional(),
  landingJourneyStepsJson: z.string().max(5000).nullable().optional(),
  landingSignalCardsJson: z.string().max(5000).nullable().optional(),
  landingTrustPointsJson: z.string().max(2000).nullable().optional(),
  landingExperiencePanelsJson: z.string().max(3000).nullable().optional(),
  landingDevicesListJson: z.string().max(1000).nullable().optional(),
  landingQuickStartJson: z.string().max(1500).nullable().optional(),
  landingInfraTitle: z.string().max(500).nullable().optional(),
  landingNetworkCockpitText: z.string().max(500).nullable().optional(),
  landingPulseTitle: z.string().max(300).nullable().optional(),
  landingComfortTitle: z.string().max(300).nullable().optional(),
  landingComfortBadge: z.string().max(200).nullable().optional(),
  landingPrinciplesTitle: z.string().max(500).nullable().optional(),
  landingTechTitle: z.string().max(300).nullable().optional(),
  landingTechDesc: z.string().max(2000).nullable().optional(),
  landingCategorySubtitle: z.string().max(500).nullable().optional(),
  landingTariffDefaultDesc: z.string().max(500).nullable().optional(),
  landingTariffBullet1: z.string().max(300).nullable().optional(),
  landingTariffBullet2: z.string().max(300).nullable().optional(),
  landingTariffBullet3: z.string().max(300).nullable().optional(),
  landingLowestTariffDesc: z.string().max(500).nullable().optional(),
  landingDevicesCockpitText: z.string().max(500).nullable().optional(),
  landingUniversalityTitle: z.string().max(300).nullable().optional(),
  landingUniversalityDesc: z.string().max(500).nullable().optional(),
  landingQuickSetupTitle: z.string().max(300).nullable().optional(),
  landingQuickSetupDesc: z.string().max(500).nullable().optional(),
  landingPremiumServiceTitle: z.string().max(300).nullable().optional(),
  landingPremiumServicePara1: z.string().max(1000).nullable().optional(),
  landingPremiumServicePara2: z.string().max(1000).nullable().optional(),
  landingHowItWorksTitle: z.string().max(500).nullable().optional(),
  landingHowItWorksDesc: z.string().max(1000).nullable().optional(),
  landingStatsPlatforms: z.string().max(50).nullable().optional(),
  landingStatsTariffsLabel: z.string().max(50).nullable().optional(),
  landingStatsAccessLabel: z.string().max(50).nullable().optional(),
  landingStatsPaymentMethods: z.string().max(50).nullable().optional(),
  landingReadyToConnectEyebrow: z.string().max(200).nullable().optional(),
  landingReadyToConnectTitle: z.string().max(500).nullable().optional(),
  landingReadyToConnectDesc: z.string().max(2000).nullable().optional(),
  landingShowFeatures: z.boolean().optional(),
  landingShowBenefits: z.boolean().optional(),
  landingShowDevices: z.boolean().optional(),
  landingShowFaq: z.boolean().optional(),
  landingShowHowItWorks: z.boolean().optional(),
  landingShowCta: z.boolean().optional(),
  proxyEnabled: z.boolean().optional(),
  proxyUrl: z.string().max(500).nullable().optional(),
  proxyTelegram: z.boolean().optional(),
  proxyPayments: z.boolean().optional(),
  proxyAi: z.boolean().optional(),
  nalogEnabled: z.boolean().optional(),
  nalogInn: z.string().max(20).nullable().optional(),
  nalogPassword: z.string().max(200).nullable().optional(),
  nalogDeviceId: z.string().max(100).nullable().optional(),
  nalogServiceName: z.string().max(300).nullable().optional(),
  geoMapEnabled: z.boolean().optional(),
  geoCacheTtl: z.number().min(10).max(3600).optional(),
  maxmindDbPath: z.string().max(500).nullable().optional(),
  giftSubscriptionsEnabled: z.boolean().optional(),
  giftCodeExpiryHours: z.number().int().min(1).max(8760).optional(),
  maxAdditionalSubscriptions: z.number().int().min(1).max(100).optional(),
  giftCodeFormatLength: z.number().int().min(6).max(24).optional(),
  giftRateLimitPerMinute: z.number().int().min(1).max(60).optional(),
  giftExpiryNotificationDays: z.number().int().min(0).max(30).optional(),
  giftReferralEnabled: z.boolean().optional(),
  giftMessageMaxLength: z.number().int().min(0).max(1000).optional(),
  // Поведение бота
  botAutoDeleteUnknownMessages: z.boolean().optional(),
  botInfoBlock: z.string().max(2000).nullable().optional(),
});

adminRouter.patch("/settings", async (req, res) => {
  const rawBody = req.body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rawBody, "botInnerButtonStyles")) {
    const raw = rawBody.botInnerButtonStyles;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_inner_button_styles" },
      create: { key: "bot_inner_button_styles", value: val },
      update: { value: val },
    });
  }

  const body = updateSettingsSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const updates = body.data;
  if (updates.activeLanguages != null) {
    await prisma.systemSetting.upsert({
      where: { key: "active_languages" },
      create: { key: "active_languages", value: updates.activeLanguages },
      update: { value: updates.activeLanguages },
    });
  }
  if (updates.activeCurrencies != null) {
    await prisma.systemSetting.upsert({
      where: { key: "active_currencies" },
      create: { key: "active_currencies", value: updates.activeCurrencies },
      update: { value: updates.activeCurrencies },
    });
  }
  if (updates.defaultLanguage != null) {
    await prisma.systemSetting.upsert({
      where: { key: "default_language" },
      create: { key: "default_language", value: updates.defaultLanguage },
      update: { value: updates.defaultLanguage },
    });
  }
  if (updates.defaultCurrency != null) {
    await prisma.systemSetting.upsert({
      where: { key: "default_currency" },
      create: { key: "default_currency", value: updates.defaultCurrency },
      update: { value: updates.defaultCurrency },
    });
  }
  if (updates.defaultReferralPercent != null) {
    await prisma.systemSetting.upsert({
      where: { key: "default_referral_percent" },
      create: { key: "default_referral_percent", value: String(updates.defaultReferralPercent) },
      update: { value: String(updates.defaultReferralPercent) },
    });
  }
  if (updates.referralPercentLevel2 != null) {
    await prisma.systemSetting.upsert({
      where: { key: "referral_percent_level_2" },
      create: { key: "referral_percent_level_2", value: String(updates.referralPercentLevel2) },
      update: { value: String(updates.referralPercentLevel2) },
    });
  }
  if (updates.referralPercentLevel3 != null) {
    await prisma.systemSetting.upsert({
      where: { key: "referral_percent_level_3" },
      create: { key: "referral_percent_level_3", value: String(updates.referralPercentLevel3) },
      update: { value: String(updates.referralPercentLevel3) },
    });
  }
  if (updates.trialDays != null) {
    await prisma.systemSetting.upsert({
      where: { key: "trial_days" },
      create: { key: "trial_days", value: String(updates.trialDays) },
      update: { value: String(updates.trialDays) },
    });
  }
  if (updates.trialSquadUuid !== undefined) {
    const val = updates.trialSquadUuid ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "trial_squad_uuid" },
      create: { key: "trial_squad_uuid", value: val },
      update: { value: val },
    });
  }
  if (updates.trialDeviceLimit !== undefined) {
    const val = updates.trialDeviceLimit == null ? "" : String(updates.trialDeviceLimit);
    await prisma.systemSetting.upsert({
      where: { key: "trial_device_limit" },
      create: { key: "trial_device_limit", value: val },
      update: { value: val },
    });
  }
  if (updates.trialTrafficLimitBytes !== undefined) {
    const val = updates.trialTrafficLimitBytes == null ? "" : String(updates.trialTrafficLimitBytes);
    await prisma.systemSetting.upsert({
      where: { key: "trial_traffic_limit" },
      create: { key: "trial_traffic_limit", value: val },
      update: { value: val },
    });
  }
  if (updates.serviceName != null) {
    await prisma.systemSetting.upsert({
      where: { key: "service_name" },
      create: { key: "service_name", value: updates.serviceName },
      update: { value: updates.serviceName },
    });
    invalidateBrandCache();
  }
  if (updates.logo !== undefined) {
    const val = updates.logo ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "logo" },
      create: { key: "logo", value: val },
      update: { value: val },
    });
    invalidateBrandCache();
  }
  if (updates.logoBot !== undefined) {
    const val = updates.logoBot ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "logo_bot" },
      create: { key: "logo_bot", value: val },
      update: { value: val },
    });
  }
  if (updates.favicon !== undefined) {
    const val = updates.favicon ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "favicon" },
      create: { key: "favicon", value: val },
      update: { value: val },
    });
  }
  if (updates.cabinetDesign !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: "cabinet_design" },
      create: { key: "cabinet_design", value: updates.cabinetDesign },
      update: { value: updates.cabinetDesign },
    });
  }
  if (updates.cabinetDesignApplyInBrowser !== undefined) {
    const val = updates.cabinetDesignApplyInBrowser ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "cabinet_design_apply_in_browser" },
      create: { key: "cabinet_design_apply_in_browser", value: val },
      update: { value: val },
    });
  }
  if (updates.remnaClientUrl !== undefined) {
    const val = updates.remnaClientUrl ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "remna_client_url" },
      create: { key: "remna_client_url", value: val },
      update: { value: val },
    });
  }
  if (updates.smtpHost !== undefined) {
    const val = updates.smtpHost ?? "";
    await prisma.systemSetting.upsert({ where: { key: "smtp_host" }, create: { key: "smtp_host", value: val }, update: { value: val } });
  }
  if (updates.smtpPort != null) {
    await prisma.systemSetting.upsert({ where: { key: "smtp_port" }, create: { key: "smtp_port", value: String(updates.smtpPort) }, update: { value: String(updates.smtpPort) } });
  }
  if (updates.smtpSecure !== undefined) {
    await prisma.systemSetting.upsert({ where: { key: "smtp_secure" }, create: { key: "smtp_secure", value: updates.smtpSecure ? "true" : "false" }, update: { value: updates.smtpSecure ? "true" : "false" } });
  }
  if (updates.smtpUser !== undefined) {
    const val = updates.smtpUser ?? "";
    await prisma.systemSetting.upsert({ where: { key: "smtp_user" }, create: { key: "smtp_user", value: val }, update: { value: val } });
  }
  if (updates.smtpPassword !== undefined && updates.smtpPassword !== "") {
    await prisma.systemSetting.upsert({ where: { key: "smtp_password" }, create: { key: "smtp_password", value: updates.smtpPassword! }, update: { value: updates.smtpPassword! } });
  }
  if (updates.smtpFromEmail !== undefined) {
    const val = updates.smtpFromEmail ?? "";
    await prisma.systemSetting.upsert({ where: { key: "smtp_from_email" }, create: { key: "smtp_from_email", value: val }, update: { value: val } });
  }
  if (updates.smtpFromName !== undefined) {
    const val = updates.smtpFromName ?? "";
    await prisma.systemSetting.upsert({ where: { key: "smtp_from_name" }, create: { key: "smtp_from_name", value: val }, update: { value: val } });
  }
  if (updates.publicAppUrl !== undefined) {
    const val = updates.publicAppUrl ?? "";
    await prisma.systemSetting.upsert({ where: { key: "public_app_url" }, create: { key: "public_app_url", value: val }, update: { value: val } });
  }
  if (updates.telegramBotToken !== undefined) {
    const val = updates.telegramBotToken ?? "";
    await prisma.systemSetting.upsert({ where: { key: "telegram_bot_token" }, create: { key: "telegram_bot_token", value: val }, update: { value: val } });
  }
  if (updates.telegramBotUsername !== undefined) {
    const val = updates.telegramBotUsername ?? "";
    await prisma.systemSetting.upsert({ where: { key: "telegram_bot_username" }, create: { key: "telegram_bot_username", value: val }, update: { value: val } });
  }
  if (updates.botAdminTelegramIds !== undefined) {
    const raw = updates.botAdminTelegramIds;
    const val = Array.isArray(raw) ? JSON.stringify(raw) : (raw ?? "");
    await prisma.systemSetting.upsert({ where: { key: "bot_admin_telegram_ids" }, create: { key: "bot_admin_telegram_ids", value: val }, update: { value: val } });
  }
  if (updates.notificationTelegramGroupId !== undefined) {
    const val = (updates.notificationTelegramGroupId ?? "").trim() || "";
    await prisma.systemSetting.upsert({
      where: { key: "notification_telegram_group_id" },
      create: { key: "notification_telegram_group_id", value: val },
      update: { value: val },
    });
  }
  if (updates.notificationManagersGroupId !== undefined) {
    const val = (updates.notificationManagersGroupId ?? "").trim() || "";
    await prisma.systemSetting.upsert({
      where: { key: "notification_managers_group_id" },
      create: { key: "notification_managers_group_id", value: val },
      update: { value: val },
    });
  }
  const topicKeys: [keyof typeof updates, string][] = [
    ["notificationTopicNewClients", "notification_topic_new_clients"],
    ["notificationTopicPayments", "notification_topic_payments"],
    ["notificationTopicTickets", "notification_topic_tickets"],
    ["notificationManagersTopicTickets", "notification_managers_topic_tickets"],
    ["notificationTopicBackups", "notification_topic_backups"],
  ];
  for (const [key, dbKey] of topicKeys) {
    if (updates[key] !== undefined) {
      const val = (String(updates[key] ?? "")).trim() || "";
      await prisma.systemSetting.upsert({ where: { key: dbKey }, create: { key: dbKey, value: val }, update: { value: val } });
    }
  }
  if (updates.autoBackupEnabled !== undefined) {
    const val = updates.autoBackupEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "auto_backup_enabled" }, create: { key: "auto_backup_enabled", value: val }, update: { value: val } });
  }
  if (updates.autoBackupCron !== undefined) {
    const val = (updates.autoBackupCron ?? "").trim() || "";
    await prisma.systemSetting.upsert({ where: { key: "auto_backup_cron" }, create: { key: "auto_backup_cron", value: val }, update: { value: val } });
    const { restartAutoBackupScheduler } = await import("../backup/auto-backup.scheduler.js");
    await restartAutoBackupScheduler();
  }
  if (updates.autoBackupEnabled !== undefined) {
    const { restartAutoBackupScheduler } = await import("../backup/auto-backup.scheduler.js");
    await restartAutoBackupScheduler();
  }
  if (updates.plategaMerchantId !== undefined) {
    const val = updates.plategaMerchantId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "platega_merchant_id" }, create: { key: "platega_merchant_id", value: val }, update: { value: val } });
  }
  if (updates.plategaSecret !== undefined) {
    const val = updates.plategaSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "platega_secret" }, create: { key: "platega_secret", value: val }, update: { value: val } });
  }
  if (updates.plategaMethods !== undefined) {
    const val = updates.plategaMethods ?? "";
    await prisma.systemSetting.upsert({ where: { key: "platega_methods" }, create: { key: "platega_methods", value: val }, update: { value: val } });
  }
  if (updates.plategaWebhookSecret !== undefined) {
    const val = updates.plategaWebhookSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "platega_webhook_secret" }, create: { key: "platega_webhook_secret", value: val }, update: { value: val } });
  }
  if (updates.paymentProvidersConfig !== undefined) {
    const val = updates.paymentProvidersConfig ?? "";
    await prisma.systemSetting.upsert({ where: { key: "payment_providers_config" }, create: { key: "payment_providers_config", value: val }, update: { value: val } });
  }
  if (updates.gramadsApiKey !== undefined) {
    const val = updates.gramadsApiKey && updates.gramadsApiKey !== "********" ? updates.gramadsApiKey : (updates.gramadsApiKey === "" ? "" : undefined);
    if (val !== undefined) {
      await prisma.systemSetting.upsert({ where: { key: "gramads_api_key" }, create: { key: "gramads_api_key", value: val }, update: { value: val } });
    }
  }
  if (updates.yoomoneyClientId !== undefined) {
    const val = updates.yoomoneyClientId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yoomoney_client_id" }, create: { key: "yoomoney_client_id", value: val }, update: { value: val } });
  }
  if (updates.yoomoneyClientSecret !== undefined) {
    const val = updates.yoomoneyClientSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yoomoney_client_secret" }, create: { key: "yoomoney_client_secret", value: val }, update: { value: val } });
  }
  if (updates.yoomoneyReceiverWallet !== undefined) {
    const val = updates.yoomoneyReceiverWallet ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yoomoney_receiver_wallet" }, create: { key: "yoomoney_receiver_wallet", value: val }, update: { value: val } });
  }
  if (updates.yoomoneyNotificationSecret !== undefined) {
    const val = updates.yoomoneyNotificationSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yoomoney_notification_secret" }, create: { key: "yoomoney_notification_secret", value: val }, update: { value: val } });
  }
  if (updates.yookassaShopId !== undefined) {
    const val = updates.yookassaShopId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yookassa_shop_id" }, create: { key: "yookassa_shop_id", value: val }, update: { value: val } });
  }
  if (updates.yookassaSecretKey !== undefined) {
    const val = updates.yookassaSecretKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yookassa_secret_key" }, create: { key: "yookassa_secret_key", value: val }, update: { value: val } });
  }
  if (updates.yookassaWebhookBasicUser !== undefined) {
    const val = updates.yookassaWebhookBasicUser ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yookassa_webhook_basic_user" }, create: { key: "yookassa_webhook_basic_user", value: val }, update: { value: val } });
  }
  if (updates.yookassaWebhookBasicPassword !== undefined) {
    const val = updates.yookassaWebhookBasicPassword ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yookassa_webhook_basic_password" }, create: { key: "yookassa_webhook_basic_password", value: val }, update: { value: val } });
  }
  if (updates.cryptopayApiToken !== undefined) {
    const val = updates.cryptopayApiToken ?? "";
    await prisma.systemSetting.upsert({ where: { key: "cryptopay_api_token" }, create: { key: "cryptopay_api_token", value: val }, update: { value: val } });
  }
  if (updates.cryptopayTestnet !== undefined) {
    const val = updates.cryptopayTestnet ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "cryptopay_testnet" }, create: { key: "cryptopay_testnet", value: val }, update: { value: val } });
  }
  if (updates.heleketMerchantId !== undefined) {
    const val = updates.heleketMerchantId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "heleket_merchant_id" }, create: { key: "heleket_merchant_id", value: val }, update: { value: val } });
  }
  if (updates.heleketApiKey !== undefined) {
    const val = updates.heleketApiKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "heleket_api_key" }, create: { key: "heleket_api_key", value: val }, update: { value: val } });
  }
  if (updates.lavaShopId !== undefined) {
    const val = updates.lavaShopId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lava_shop_id" }, create: { key: "lava_shop_id", value: val }, update: { value: val } });
  }
  if (updates.lavaSecretKey !== undefined) {
    const val = updates.lavaSecretKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lava_secret_key" }, create: { key: "lava_secret_key", value: val }, update: { value: val } });
  }
  if (updates.lavaAdditionalKey !== undefined) {
    const val = updates.lavaAdditionalKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lava_additional_key" }, create: { key: "lava_additional_key", value: val }, update: { value: val } });
  }
  if (updates.lavatopApiKey !== undefined) {
    const val = updates.lavatopApiKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lavatop_api_key" }, create: { key: "lavatop_api_key", value: val }, update: { value: val } });
  }
  if (updates.lavatopDefaultOfferId !== undefined) {
    const val = updates.lavatopDefaultOfferId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lavatop_default_offer_id" }, create: { key: "lavatop_default_offer_id", value: val }, update: { value: val } });
  }
  if (updates.botWelcomeEnabled !== undefined) {
    const val = updates.botWelcomeEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "bot_welcome_enabled" }, create: { key: "bot_welcome_enabled", value: val }, update: { value: val } });
  }
  if (updates.botWelcomeText !== undefined) {
    const val = updates.botWelcomeText ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_welcome_text" }, create: { key: "bot_welcome_text", value: val }, update: { value: val } });
  }
  if (updates.botWelcomeImage !== undefined) {
    const val = updates.botWelcomeImage ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_welcome_image" }, create: { key: "bot_welcome_image", value: val }, update: { value: val } });
  }
  if (updates.botWelcomeShowOnce !== undefined) {
    const val = updates.botWelcomeShowOnce ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "bot_welcome_show_once" }, create: { key: "bot_welcome_show_once", value: val }, update: { value: val } });
  }
  if (updates.overpayApiUrl !== undefined) {
    const val = updates.overpayApiUrl ?? "";
    await prisma.systemSetting.upsert({ where: { key: "overpay_api_url" }, create: { key: "overpay_api_url", value: val }, update: { value: val } });
  }
  if (updates.overpayProjectId !== undefined) {
    const val = updates.overpayProjectId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "overpay_project_id" }, create: { key: "overpay_project_id", value: val }, update: { value: val } });
  }
  if (updates.overpayLogin !== undefined) {
    const val = updates.overpayLogin ?? "";
    await prisma.systemSetting.upsert({ where: { key: "overpay_login" }, create: { key: "overpay_login", value: val }, update: { value: val } });
  }
  if (updates.overpayPassword !== undefined) {
    const val = updates.overpayPassword ?? "";
    await prisma.systemSetting.upsert({ where: { key: "overpay_password" }, create: { key: "overpay_password", value: val }, update: { value: val } });
  }
  if (updates.groqApiKey !== undefined) {
    const val = updates.groqApiKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "groq_api_key" }, create: { key: "groq_api_key", value: val }, update: { value: val } });
  }
  if (updates.groqModel !== undefined) {
    const val = updates.groqModel ?? "llama3-8b-8192";
    await prisma.systemSetting.upsert({ where: { key: "groq_model" }, create: { key: "groq_model", value: val }, update: { value: val } });
  }
  if (updates.groqFallback1 !== undefined) {
    const val = updates.groqFallback1 ?? "";
    await prisma.systemSetting.upsert({ where: { key: "groq_fallback_1" }, create: { key: "groq_fallback_1", value: val }, update: { value: val } });
  }
  if (updates.groqFallback2 !== undefined) {
    const val = updates.groqFallback2 ?? "";
    await prisma.systemSetting.upsert({ where: { key: "groq_fallback_2" }, create: { key: "groq_fallback_2", value: val }, update: { value: val } });
  }
  if (updates.groqFallback3 !== undefined) {
    const val = updates.groqFallback3 ?? "";
    await prisma.systemSetting.upsert({ where: { key: "groq_fallback_3" }, create: { key: "groq_fallback_3", value: val }, update: { value: val } });
  }
  if (updates.aiSystemPrompt !== undefined) {
    const val = updates.aiSystemPrompt ?? "";
    await prisma.systemSetting.upsert({ where: { key: "ai_system_prompt" }, create: { key: "ai_system_prompt", value: val }, update: { value: val } });
  }
  if (updates.botButtons !== undefined) {
    const val = updates.botButtons ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_buttons" }, create: { key: "bot_buttons", value: val }, update: { value: val } });
  }
  if (updates.botButtonsPerRow !== undefined) {
    const val = updates.botButtonsPerRow === 2 ? "2" : "1";
    await prisma.systemSetting.upsert({ where: { key: "bot_buttons_per_row" }, create: { key: "bot_buttons_per_row", value: val }, update: { value: val } });
  }
  if (updates.botEmojis !== undefined) {
    const raw = updates.botEmojis;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({ where: { key: "bot_emojis" }, create: { key: "bot_emojis", value: val }, update: { value: val } });
  }
  if (updates.botBackLabel !== undefined) {
    const val = updates.botBackLabel ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_back_label" }, create: { key: "bot_back_label", value: val }, update: { value: val } });
  }
  if (updates.botDevicesText !== undefined) {
    const val = updates.botDevicesText ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_devices_text" }, create: { key: "bot_devices_text", value: val }, update: { value: val } });
  }
  if (updates.botMenuTexts !== undefined) {
    const val = updates.botMenuTexts ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_menu_texts" }, create: { key: "bot_menu_texts", value: val }, update: { value: val } });
  }
  if (updates.botMenuLineVisibility !== undefined) {
    const raw = updates.botMenuLineVisibility;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_menu_line_visibility" },
      create: { key: "bot_menu_line_visibility", value: val },
      update: { value: val },
    });
  }
  if (updates.botInnerButtonStyles !== undefined) {
    const raw = updates.botInnerButtonStyles;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_inner_button_styles" },
      create: { key: "bot_inner_button_styles", value: val },
      update: { value: val },
    });
  }
  if (updates.botTariffsText !== undefined) {
    const val = updates.botTariffsText ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_tariffs_text" },
      create: { key: "bot_tariffs_text", value: val },
      update: { value: val },
    });
  }
  if (updates.botTariffsFields !== undefined) {
    const raw = updates.botTariffsFields;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_tariffs_fields" },
      create: { key: "bot_tariffs_fields", value: val },
      update: { value: val },
    });
  }
  if (updates.botPaymentText !== undefined) {
    const val = updates.botPaymentText ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_payment_text" },
      create: { key: "bot_payment_text", value: val },
      update: { value: val },
    });
  }
  if (updates.subscriptionPageConfig !== undefined) {
    const val = updates.subscriptionPageConfig ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "subscription_page_config" },
      create: { key: "subscription_page_config", value: val },
      update: { value: val },
    });
  }
  if (updates.allowUserThemeChange !== undefined) {
    const val = updates.allowUserThemeChange ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "allow_user_theme_change" }, create: { key: "allow_user_theme_change", value: val }, update: { value: val } });
  }
  if (updates.themeAccent !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: "theme_accent" },
      create: { key: "theme_accent", value: updates.themeAccent },
      update: { value: updates.themeAccent },
    });
  }
  for (const [key, settingKey] of [
    ["supportLink", "support_link"],
    ["agreementLink", "agreement_link"],
    ["offerLink", "offer_link"],
    ["instructionsLink", "instructions_link"],
    // T-ref-instructions (27.05.2026) — ссылка инструкции рефералки.
    ["referralInstructionsUrl", "referral_instructions_url"],
    // T11+T13+T14 (11.05.2026) — кастомизация бота.
    ["refundLink", "refund_link"],
    ["supportHoursFrom", "support_hours_from"],
    ["supportHoursTo", "support_hours_to"],
    ["tgProxyText", "tg_proxy_text"],
    ["tgProxyUrlPrimary", "tg_proxy_url_primary"],
    ["tgProxyUrlBackup", "tg_proxy_url_backup"],
    // JSON-массив прокси-серверов (см. tgProxyServers выше).
    ["tgProxyServers", "tg_proxy_servers"],
    ["reissueWarningText", "reissue_warning_text"],
    ["installSecondDeviceText", "install_second_device_text"],
    ["helpIntroText", "help_intro_text"],
  ] as const) {
    if (updates[key] !== undefined) {
      const val = updates[key] ?? "";
      await prisma.systemSetting.upsert({
        where: { key: settingKey },
        create: { key: settingKey, value: String(val).trim() },
        update: { value: String(val).trim() },
      });
    }
  }
  if (updates.ticketsEnabled !== undefined) {
    const val = updates.ticketsEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "tickets_enabled" }, create: { key: "tickets_enabled", value: val }, update: { value: val } });
  }
  if (updates.forceSubscribeEnabled !== undefined) {
    const val = updates.forceSubscribeEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "force_subscribe_enabled" }, create: { key: "force_subscribe_enabled", value: val }, update: { value: val } });
  }
  if (updates.forceSubscribeChannelId !== undefined) {
    const val = (updates.forceSubscribeChannelId ?? "").trim();
    await prisma.systemSetting.upsert({ where: { key: "force_subscribe_channel_id" }, create: { key: "force_subscribe_channel_id", value: val }, update: { value: val } });
  }
  if (updates.forceSubscribeMessage !== undefined) {
    const val = (updates.forceSubscribeMessage ?? "").trim();
    await prisma.systemSetting.upsert({ where: { key: "force_subscribe_message" }, create: { key: "force_subscribe_message", value: val }, update: { value: val } });
  }
  if (updates.blacklistEnabled !== undefined) {
    const val = updates.blacklistEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "blacklist_enabled" }, create: { key: "blacklist_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsEnabled !== undefined) {
    const val = updates.sellOptionsEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "sell_options_enabled" }, create: { key: "sell_options_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsTrafficEnabled !== undefined) {
    const val = updates.sellOptionsTrafficEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "sell_options_traffic_enabled" }, create: { key: "sell_options_traffic_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsTrafficProducts !== undefined) {
    const val = typeof updates.sellOptionsTrafficProducts === "string" ? updates.sellOptionsTrafficProducts : (updates.sellOptionsTrafficProducts == null ? "" : JSON.stringify(updates.sellOptionsTrafficProducts));
    await prisma.systemSetting.upsert({ where: { key: "sell_options_traffic_products" }, create: { key: "sell_options_traffic_products", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsDevicesEnabled !== undefined) {
    const val = updates.sellOptionsDevicesEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "sell_options_devices_enabled" }, create: { key: "sell_options_devices_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsDevicesProducts !== undefined) {
    const val = typeof updates.sellOptionsDevicesProducts === "string" ? updates.sellOptionsDevicesProducts : (updates.sellOptionsDevicesProducts == null ? "" : JSON.stringify(updates.sellOptionsDevicesProducts));
    await prisma.systemSetting.upsert({ where: { key: "sell_options_devices_products" }, create: { key: "sell_options_devices_products", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsServersEnabled !== undefined) {
    const val = updates.sellOptionsServersEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "sell_options_servers_enabled" }, create: { key: "sell_options_servers_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsServersProducts !== undefined) {
    const val = typeof updates.sellOptionsServersProducts === "string" ? updates.sellOptionsServersProducts : (updates.sellOptionsServersProducts == null ? "" : JSON.stringify(updates.sellOptionsServersProducts));
    await prisma.systemSetting.upsert({ where: { key: "sell_options_servers_products" }, create: { key: "sell_options_servers_products", value: val }, update: { value: val } });
  }
  if (updates.googleAnalyticsId !== undefined) {
    await prisma.systemSetting.upsert({ where: { key: "google_analytics_id" }, create: { key: "google_analytics_id", value: updates.googleAnalyticsId ?? "" }, update: { value: updates.googleAnalyticsId ?? "" } });
  }
  if (updates.yandexMetrikaId !== undefined) {
    await prisma.systemSetting.upsert({ where: { key: "yandex_metrika_id" }, create: { key: "yandex_metrika_id", value: updates.yandexMetrikaId ?? "" }, update: { value: updates.yandexMetrikaId ?? "" } });
  }
  if (updates.autoBroadcastCron !== undefined) {
    const val = updates.autoBroadcastCron ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "auto_broadcast_cron" },
      create: { key: "auto_broadcast_cron", value: val },
      update: { value: val },
    });
    const { restartAutoBroadcastScheduler } = await import("../auto-broadcast/auto-broadcast-scheduler.js");
    await restartAutoBroadcastScheduler();
  }
  if (updates.adminFrontNotificationsEnabled !== undefined) {
    const val = updates.adminFrontNotificationsEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "admin_front_notifications_enabled" },
      create: { key: "admin_front_notifications_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.skipEmailVerification !== undefined) {
    const val = updates.skipEmailVerification ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "skip_email_verification" },
      create: { key: "skip_email_verification", value: val },
      update: { value: val },
    });
  }
  // Антибот-защита регистраций
  if (updates.signupProtectionEnabled !== undefined) {
    const val = updates.signupProtectionEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "signup_protection_enabled" },
      create: { key: "signup_protection_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.emailDomainBlocklist !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: "email_domain_blocklist" },
      create: { key: "email_domain_blocklist", value: updates.emailDomainBlocklist ?? "" },
      update: { value: updates.emailDomainBlocklist ?? "" },
    });
  }
  if (updates.emailPatternBlocklist !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: "email_pattern_blocklist" },
      create: { key: "email_pattern_blocklist", value: updates.emailPatternBlocklist ?? "" },
      update: { value: updates.emailPatternBlocklist ?? "" },
    });
  }
  if (updates.signupMaxPerIpPerHour !== undefined) {
    const val = String(Math.max(1, updates.signupMaxPerIpPerHour));
    await prisma.systemSetting.upsert({
      where: { key: "signup_max_per_ip_per_hour" },
      create: { key: "signup_max_per_ip_per_hour", value: val },
      update: { value: val },
    });
  }
  if (updates.happCryptEnabled !== undefined) {
    const val = updates.happCryptEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "happ_crypt_enabled" },
      create: { key: "happ_crypt_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.useRemnaSubscriptionPage !== undefined) {
    const val = updates.useRemnaSubscriptionPage ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "use_remna_subscription_page" },
      create: { key: "use_remna_subscription_page", value: val },
      update: { value: val },
    });
  }
  if (updates.aiChatEnabled !== undefined) {
    const val = updates.aiChatEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "ai_chat_enabled" },
      create: { key: "ai_chat_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.defaultAutoRenewEnabled !== undefined) {
    const val = updates.defaultAutoRenewEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "default_auto_renew_enabled" },
      create: { key: "default_auto_renew_enabled", value: val },
      update: { value: val },
    });
  }
  // Auto-renewal numeric settings
  const autoRenewNumericKeys: [keyof typeof updates, string][] = [
    ["autoRenewDaysBeforeExpiry", "auto_renew_days_before_expiry"],
    ["autoRenewNotifyDaysBefore", "auto_renew_notify_days_before"],
    ["autoRenewGracePeriodDays", "auto_renew_grace_period_days"],
    ["autoRenewMaxRetries", "auto_renew_max_retries"],
  ];
  for (const [key, dbKey] of autoRenewNumericKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = String(v);
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  // YooKassa recurring payments toggle
  if (updates.yookassaRecurringEnabled !== undefined) {
    const val = updates.yookassaRecurringEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "yookassa_recurring_enabled" },
      create: { key: "yookassa_recurring_enabled", value: val },
      update: { value: val },
    });
  }
  const cbKeys: [keyof typeof updates, string][] = [
    ["customBuildEnabled", "custom_build_enabled"],
    ["customBuildPricePerDay", "custom_build_price_per_day"],
    ["customBuildPricePerDevice", "custom_build_price_per_device"],
    ["customBuildTrafficMode", "custom_build_traffic_mode"],
    ["customBuildPricePerGb", "custom_build_price_per_gb"],
    ["customBuildSquadUuid", "custom_build_squad_uuid"],
    ["customBuildCurrency", "custom_build_currency"],
    ["customBuildMaxDays", "custom_build_max_days"],
    ["customBuildMaxDevices", "custom_build_max_devices"],
  ];
  for (const [key, dbKey] of cbKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const oauthKeys: [keyof typeof updates, string][] = [
    ["googleLoginEnabled", "google_login_enabled"],
    ["googleClientId", "google_client_id"],
    ["googleClientSecret", "google_client_secret"],
    ["appleLoginEnabled", "apple_login_enabled"],
    ["appleClientId", "apple_client_id"],
    ["appleTeamId", "apple_team_id"],
    ["appleKeyId", "apple_key_id"],
    ["applePrivateKey", "apple_private_key"],
  ];
  for (const [key, dbKey] of oauthKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const landingKeys: [keyof typeof updates, string][] = [
    ["landingEnabled", "landing_enabled"],
    ["landingHeroTitle", "landing_hero_title"],
    ["landingHeroSubtitle", "landing_hero_subtitle"],
    ["landingHeroCtaText", "landing_hero_cta_text"],
    ["landingShowTariffs", "landing_show_tariffs"],
    ["landingContacts", "landing_contacts"],
    ["landingOfferLink", "landing_offer_link"],
    ["landingPrivacyLink", "landing_privacy_link"],
    ["landingFooterText", "landing_footer_text"],
    ["landingHeroBadge", "landing_hero_badge"],
    ["landingHeroHint", "landing_hero_hint"],
    ["landingFeature1Label", "landing_feature_1_label"],
    ["landingFeature1Sub", "landing_feature_1_sub"],
    ["landingFeature2Label", "landing_feature_2_label"],
    ["landingFeature2Sub", "landing_feature_2_sub"],
    ["landingFeature3Label", "landing_feature_3_label"],
    ["landingFeature3Sub", "landing_feature_3_sub"],
    ["landingFeature4Label", "landing_feature_4_label"],
    ["landingFeature4Sub", "landing_feature_4_sub"],
    ["landingFeature5Label", "landing_feature_5_label"],
    ["landingFeature5Sub", "landing_feature_5_sub"],
    ["landingBenefitsTitle", "landing_benefits_title"],
    ["landingBenefitsSubtitle", "landing_benefits_subtitle"],
    ["landingBenefit1Title", "landing_benefit_1_title"],
    ["landingBenefit1Desc", "landing_benefit_1_desc"],
    ["landingBenefit2Title", "landing_benefit_2_title"],
    ["landingBenefit2Desc", "landing_benefit_2_desc"],
    ["landingBenefit3Title", "landing_benefit_3_title"],
    ["landingBenefit3Desc", "landing_benefit_3_desc"],
    ["landingBenefit4Title", "landing_benefit_4_title"],
    ["landingBenefit4Desc", "landing_benefit_4_desc"],
    ["landingBenefit5Title", "landing_benefit_5_title"],
    ["landingBenefit5Desc", "landing_benefit_5_desc"],
    ["landingBenefit6Title", "landing_benefit_6_title"],
    ["landingBenefit6Desc", "landing_benefit_6_desc"],
    ["landingTariffsTitle", "landing_tariffs_title"],
    ["landingTariffsSubtitle", "landing_tariffs_subtitle"],
    ["landingDevicesTitle", "landing_devices_title"],
    ["landingDevicesSubtitle", "landing_devices_subtitle"],
    ["landingFaqTitle", "landing_faq_title"],
    ["landingFaqJson", "landing_faq_json"],
    ["landingHeroHeadline1", "landing_hero_headline_1"],
    ["landingHeroHeadline2", "landing_hero_headline_2"],
    ["landingHeaderBadge", "landing_header_badge"],
    ["landingButtonLogin", "landing_button_login"],
    ["landingButtonLoginCabinet", "landing_button_login_cabinet"],
    ["landingNavBenefits", "landing_nav_benefits"],
    ["landingNavTariffs", "landing_nav_tariffs"],
    ["landingNavDevices", "landing_nav_devices"],
    ["landingNavFaq", "landing_nav_faq"],
    ["landingBenefitsBadge", "landing_benefits_badge"],
    ["landingDefaultPaymentText", "landing_default_payment_text"],
    ["landingButtonChooseTariff", "landing_button_choose_tariff"],
    ["landingNoTariffsMessage", "landing_no_tariffs_message"],
    ["landingButtonWatchTariffs", "landing_button_watch_tariffs"],
    ["landingButtonStart", "landing_button_start"],
    ["landingButtonOpenCabinet", "landing_button_open_cabinet"],
    ["landingJourneyStepsJson", "landing_journey_steps_json"],
    ["landingSignalCardsJson", "landing_signal_cards_json"],
    ["landingTrustPointsJson", "landing_trust_points_json"],
    ["landingExperiencePanelsJson", "landing_experience_panels_json"],
    ["landingDevicesListJson", "landing_devices_list_json"],
    ["landingQuickStartJson", "landing_quick_start_json"],
    ["landingInfraTitle", "landing_infra_title"],
    ["landingNetworkCockpitText", "landing_network_cockpit_text"],
    ["landingPulseTitle", "landing_pulse_title"],
    ["landingComfortTitle", "landing_comfort_title"],
    ["landingComfortBadge", "landing_comfort_badge"],
    ["landingPrinciplesTitle", "landing_principles_title"],
    ["landingTechTitle", "landing_tech_title"],
    ["landingTechDesc", "landing_tech_desc"],
    ["landingCategorySubtitle", "landing_category_subtitle"],
    ["landingTariffDefaultDesc", "landing_tariff_default_desc"],
    ["landingTariffBullet1", "landing_tariff_bullet_1"],
    ["landingTariffBullet2", "landing_tariff_bullet_2"],
    ["landingTariffBullet3", "landing_tariff_bullet_3"],
    ["landingLowestTariffDesc", "landing_lowest_tariff_desc"],
    ["landingDevicesCockpitText", "landing_devices_cockpit_text"],
    ["landingUniversalityTitle", "landing_universality_title"],
    ["landingUniversalityDesc", "landing_universality_desc"],
    ["landingQuickSetupTitle", "landing_quick_setup_title"],
    ["landingQuickSetupDesc", "landing_quick_setup_desc"],
    ["landingPremiumServiceTitle", "landing_premium_service_title"],
    ["landingPremiumServicePara1", "landing_premium_service_para1"],
    ["landingPremiumServicePara2", "landing_premium_service_para2"],
    ["landingHowItWorksTitle", "landing_how_it_works_title"],
    ["landingHowItWorksDesc", "landing_how_it_works_desc"],
    ["landingStatsPlatforms", "landing_stats_platforms"],
    ["landingStatsTariffsLabel", "landing_stats_tariffs_label"],
    ["landingStatsAccessLabel", "landing_stats_access_label"],
    ["landingStatsPaymentMethods", "landing_stats_payment_methods"],
    ["landingReadyToConnectEyebrow", "landing_ready_to_connect_eyebrow"],
    ["landingReadyToConnectTitle", "landing_ready_to_connect_title"],
    ["landingReadyToConnectDesc", "landing_ready_to_connect_desc"],
    ["landingShowFeatures", "landing_show_features"],
    ["landingShowBenefits", "landing_show_benefits"],
    ["landingShowDevices", "landing_show_devices"],
    ["landingShowFaq", "landing_show_faq"],
    ["landingShowHowItWorks", "landing_show_how_it_works"],
    ["landingShowCta", "landing_show_cta"],
  ];
  for (const [key, dbKey] of landingKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const proxyKeys: [keyof typeof updates, string][] = [
    ["proxyEnabled", "proxy_enabled"],
    ["proxyUrl", "proxy_url"],
    ["proxyTelegram", "proxy_telegram"],
    ["proxyPayments", "proxy_payments"],
    ["proxyAi", "proxy_ai"],
  ];
  for (const [key, dbKey] of proxyKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const nalogKeys: [keyof typeof updates, string][] = [
    ["nalogEnabled", "nalog_enabled"],
    ["nalogInn", "nalog_inn"],
    ["nalogPassword", "nalog_password"],
    ["nalogDeviceId", "nalog_device_id"],
    ["nalogServiceName", "nalog_service_name"],
  ];
  for (const [key, dbKey] of nalogKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const geoMapKeys: [keyof typeof updates, string][] = [
    ["geoMapEnabled", "geo_map_enabled"],
    ["geoCacheTtl", "geo_cache_ttl"],
    ["maxmindDbPath", "maxmind_db_path"],
  ];
  for (const [key, dbKey] of geoMapKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const giftKeys: [keyof typeof updates, string][] = [
    ["giftSubscriptionsEnabled", "gift_subscriptions_enabled"],
    ["giftCodeExpiryHours", "gift_code_expiry_hours"],
    ["maxAdditionalSubscriptions", "max_additional_subscriptions"],
    ["giftCodeFormatLength", "gift_code_format_length"],
    ["giftRateLimitPerMinute", "gift_rate_limit_per_minute"],
    ["giftExpiryNotificationDays", "gift_expiry_notification_days"],
    ["giftReferralEnabled", "gift_referral_enabled"],
    ["giftMessageMaxLength", "gift_message_max_length"],
    ["botAutoDeleteUnknownMessages", "bot_auto_delete_unknown_messages"],
    ["botInfoBlock", "bot_info_block"],
  ];
  for (const [key, dbKey] of giftKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = v === null ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v);
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  // invalidate cache до возврата свежего config'а.
  invalidateSystemConfigCache();
  const config = await getSystemConfig();
  return res.json(config);
});

adminRouter.post("/nalog/test", asyncRoute(async (_req, res) => {
  const result = await testNalogConnection();
  return res.json(result);
}));

/** Сброс всех текстов лендинга на исходные (из кода). Очищает значения в БД — фронт подставит дефолты. */
const LANDING_TEXT_DB_KEYS = [
  "landing_hero_title", "landing_hero_subtitle", "landing_hero_cta_text", "landing_contacts", "landing_offer_link",
  "landing_privacy_link", "landing_footer_text", "landing_hero_badge", "landing_hero_hint",
  "landing_feature_1_label", "landing_feature_1_sub", "landing_feature_2_label", "landing_feature_2_sub",
  "landing_feature_3_label", "landing_feature_3_sub", "landing_feature_4_label", "landing_feature_4_sub",
  "landing_feature_5_label", "landing_feature_5_sub", "landing_benefits_title", "landing_benefits_subtitle",
  "landing_benefit_1_title", "landing_benefit_1_desc", "landing_benefit_2_title", "landing_benefit_2_desc",
  "landing_benefit_3_title", "landing_benefit_3_desc", "landing_benefit_4_title", "landing_benefit_4_desc",
  "landing_benefit_5_title", "landing_benefit_5_desc", "landing_benefit_6_title", "landing_benefit_6_desc",
  "landing_tariffs_title", "landing_tariffs_subtitle", "landing_devices_title", "landing_devices_subtitle",
  "landing_faq_title", "landing_faq_json", "landing_hero_headline_1", "landing_hero_headline_2",
  "landing_header_badge", "landing_button_login", "landing_button_login_cabinet", "landing_nav_benefits",
  "landing_nav_tariffs", "landing_nav_devices", "landing_nav_faq", "landing_benefits_badge",
  "landing_default_payment_text", "landing_button_choose_tariff", "landing_no_tariffs_message",
  "landing_button_watch_tariffs", "landing_button_start", "landing_button_open_cabinet",
  "landing_journey_steps_json", "landing_signal_cards_json", "landing_trust_points_json",
  "landing_experience_panels_json", "landing_devices_list_json", "landing_quick_start_json",
  "landing_infra_title", "landing_network_cockpit_text", "landing_pulse_title", "landing_comfort_title",
  "landing_comfort_badge", "landing_principles_title", "landing_tech_title", "landing_tech_desc",
  "landing_category_subtitle", "landing_tariff_default_desc", "landing_tariff_bullet_1", "landing_tariff_bullet_2",
  "landing_tariff_bullet_3", "landing_lowest_tariff_desc", "landing_devices_cockpit_text",
  "landing_universality_title", "landing_universality_desc", "landing_quick_setup_title", "landing_quick_setup_desc",
  "landing_premium_service_title", "landing_premium_service_para1", "landing_premium_service_para2",
  "landing_how_it_works_title", "landing_how_it_works_desc",   "landing_stats_platforms",
  "landing_stats_tariffs_label", "landing_stats_access_label", "landing_stats_payment_methods",
  "landing_ready_to_connect_eyebrow", "landing_ready_to_connect_title", "landing_ready_to_connect_desc",
];
adminRouter.post("/settings/reset-landing-text", asyncRoute(async (req, res) => {
  for (const dbKey of LANDING_TEXT_DB_KEYS) {
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: "" },
      update: { value: "" },
    });
  }
  const config = await getSystemConfig();
  return res.json(config);
}));

// ——— Тикеты (админ: список, просмотр, закрытие, ответ)
adminRouter.get("/tickets", asyncRoute(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = status === "open" || status === "closed" ? { status } : {};
  const list = await prisma.ticket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { client: { select: { id: true, email: true, telegramUsername: true } } },
  });
  return res.json({
    items: list.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      client: t.client,
    })),
  });
}));

adminRouter.get("/tickets/:id", asyncRoute(async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: {
      client: { select: { id: true, email: true, telegramUsername: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) return res.status(404).json({ message: "Тикет не найден" });
  return res.json({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    client: ticket.client,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      content: m.content,
      attachments: parseAttachments(m.attachments),
      createdAt: m.createdAt.toISOString(),
    })),
  });
}));

adminRouter.patch("/tickets/:id", asyncRoute(async (req, res) => {
  const body = z.object({ status: z.enum(["open", "closed"]) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const ticket = await prisma.ticket.update({
    where: { id: req.params.id },
    data: { status: body.data.status },
    select: { id: true, clientId: true, subject: true, status: true },
  });
  notifyAdminsAboutTicketStatusChange({
    ticketId: ticket.id,
    clientId: ticket.clientId,
    subject: ticket.subject,
    status: ticket.status,
  }).catch(() => {});
  return res.json({ id: ticket.id, status: ticket.status });
}));

// Ответ поддержки. multipart/form-data — если приложены фото.
const adminTicketMessageSchema = z.object({ content: z.string().max(10000).optional().default("") });
adminRouter.post("/tickets/:id/messages", uploadTicketAttachment.array("files", 5), asyncRoute(async (req, res) => {
  const content = pickTicketField(req, "content");
  const body = adminTicketMessageSchema.safeParse({ content });
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ message: "Тикет не найден" });
  const attachments = filesToAttachments(req.files as Express.Multer.File[] | undefined);
  const trimmed = body.data.content.trim();
  if (!trimmed && attachments.length === 0) {
    return res.status(400).json({ message: "Пустое сообщение" });
  }
  const msg = await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      authorType: "support",
      content: trimmed,
      attachments: serializeAttachments(attachments),
    },
  });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
  notifyAdminsAboutSupportReply({
    ticketId: ticket.id,
    clientId: ticket.clientId,
    content: trimmed,
    attachmentsCount: attachments.length,
  }).catch(() => {});
  return res.status(201).json({
    id: msg.id,
    authorType: msg.authorType,
    content: msg.content,
    attachments: parseAttachments(msg.attachments),
    createdAt: msg.createdAt.toISOString(),
  });
}));

// Синхронизация с Remna
adminRouter.post("/sync/from-remna", async (_req, res) => {
  try {
    const result = await syncFromRemna();
    return res.json(result);
  } catch (e) {
    console.error("Sync from Remna error:", e);
    return res.status(500).json({
      ok: false,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    });
  }
});

adminRouter.post("/sync/to-remna", async (_req, res) => {
  try {
    const result = await syncToRemna();
    return res.json(result);
  } catch (e) {
    console.error("Sync to Remna error:", e);
    return res.status(500).json({
      ok: false,
      updated: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    });
  }
});

/** Создать в Remna пользователей для клиентов без remnawaveUuid (привязка «отстающих»). */
adminRouter.post("/sync/create-remna-for-missing", async (_req, res) => {
  try {
    const result = await createRemnaUsersForClientsWithoutUuid();
    return res.json(result);
  } catch (e) {
    console.error("Create Remna for missing error:", e);
    return res.status(500).json({
      ok: false,
      created: 0,
      linked: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    });
  }
});

// ——————————————— Рассылка ———————————————

const broadcastSchema = z.object({
  channel: z.enum(["telegram", "email", "both"]),
  subject: z.string().max(500).optional(),
  message: z.string().min(1, "Текст сообщения обязателен").max(4096),
  buttonText: z.string().max(64).optional(),
  buttonUrl: z.string().max(500).optional(),
  // фильтр получателей.
  targetGroup: z.enum([
    "all",
    "active_subs",
    "expired_subs",
    "with_any_subs",
    "without_subs",
    "standard_subs",
    "unblock_subs",
    "unblock_unlimited",
  ]).optional(),
});

const broadcastUpload = multer({
  storage: multer.memoryStorage(),
  // подняли с 20 MB до 50 MB ради видео (sendVideo через
  // основной bot API лимит ~50 MB; для большего пришлось бы поднимать локальный
  // bot-api server, чего у нас сейчас нет).
  limits: { fileSize: 50 * 1024 * 1024 },
});

adminRouter.get("/broadcast/recipients-count", asyncRoute(async (_req, res) => {
  const counts = await getBroadcastRecipientsCount();
  return res.json(counts);
}));

adminRouter.post(
  "/broadcast",
  broadcastUpload.single("attachment"),
  asyncRoute(async (req, res) => {
    const parsed = broadcastSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    }
    const { channel, subject, message, buttonText, buttonUrl, targetGroup } = parsed.data;
    const attachment =
      req.file && req.file.buffer
        ? { buffer: req.file.buffer, mimetype: req.file.mimetype || "application/octet-stream", originalname: req.file.originalname || "file" }
        : undefined;
    // Запускаем рассылку в фоне. Для больших баз синхронная отправка
    // упирается в таймаут nginx/браузера, хотя на бэкенде всё идёт успешно.
    const adminId = (req as unknown as { adminId?: string }).adminId;
    // startBroadcastJob теперь async (queue в DB + worker pickup).
    const jobId = await startBroadcastJob({
      channel,
      subject: subject ?? "",
      message,
      attachment,
      buttonText,
      buttonUrl,
      targetGroup,
      startedByAdmin: adminId,
    });
    return res.json({ jobId });
  })
);

// Возобновить ранее прерванную рассылку.
// Берёт существующую запись broadcast_history, читает её text/buttons/channel/targetGroup,
// принимает attachment (бинарь не хранится в БД, юзер переаплоадит тот же файл),
// запускает с тем же broadcastId → runBroadcast подхватит broadcast_sent_log
// и skip'нет уже отправленных. Дубли стремятся к нулю.
adminRouter.post(
  "/broadcast/:jobId/resume",
  broadcastUpload.single("attachment"),
  asyncRoute(async (req, res) => {
    const oldJobId = req.params.jobId;
    const old = await prisma.broadcastHistory.findUnique({ where: { id: oldJobId } });
    if (!old) return res.status(404).json({ message: "Рассылка не найдена" });
    if (old.status === "running") return res.status(409).json({ message: "Эта рассылка уже идёт" });

    const attachment =
      req.file && req.file.buffer
        ? { buffer: req.file.buffer, mimetype: req.file.mimetype || "application/octet-stream", originalname: req.file.originalname || "file" }
        : undefined;
    if (old.attachmentName && !attachment) {
      return res.status(400).json({
        message: `Эта рассылка содержала вложение "${old.attachmentName}" — переаплоадите тот же файл для возобновления.`,
      });
    }

    const tg = typeof req.body?.targetGroup === "string" ? req.body.targetGroup : "all";
    const adminId = (req as unknown as { adminId?: string }).adminId;

    const jobId = await startBroadcastJob({
      channel: old.channel as "telegram" | "email" | "both",
      subject: old.subject ?? "",
      message: old.message,
      attachment,
      buttonText: old.buttonText ?? undefined,
      buttonUrl: old.buttonUrl ?? undefined,
      targetGroup: tg as Parameters<typeof startBroadcastJob>[0]["targetGroup"],
      startedByAdmin: adminId,
      resumeJobId: oldJobId,
    });
    return res.json({ jobId, resumedFrom: oldJobId });
  })
);

// список получателей рассылки (sent_log) для админа.
// ?format=csv → text/csv downloadable. По дефолту json с массивом.
adminRouter.get(
  "/broadcast/:jobId/recipients",
  asyncRoute(async (req, res) => {
    const jobId = req.params.jobId;
    const fmt = typeof req.query.format === "string" ? req.query.format : "json";
    const rows = await prisma.$queryRaw<Array<{
      tgid: string;
      sent_at: Date;
      username: string | null;
    }>>`
      SELECT log.tgid, log.sent_at, c.telegram_username AS username
        FROM broadcast_sent_log log
        LEFT JOIN clients c ON c.telegram_id = log.tgid
       WHERE log.broadcast_id = ${jobId}
       ORDER BY log.sent_at ASC;
    `;
    if (fmt === "csv") {
      const header = "tgid,username,sent_at\n";
      const body = rows.map((r) => {
        const u = (r.username ?? "").replace(/[",\n]/g, "");
        return `${r.tgid},${u},${r.sent_at.toISOString()}`;
      }).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="broadcast-${jobId}-recipients.csv"`);
      return res.send(header + body + "\n");
    }
    return res.json({ total: rows.length, recipients: rows });
  })
);

adminRouter.get(
  "/broadcast/status/:jobId",
  asyncRoute(async (req, res) => {
    // getBroadcastJob теперь async (читает из DB, не из in-memory).
    const job = await getBroadcastJob(req.params.jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    return res.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      result: job.result ?? null,
      error: job.error ?? null,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
      cancelRequested: job.cancelRequested,
    });
  })
);

// отмена активной рассылки.
// 25.05.2026 — теперь через DB-флаг (worker polls). Если job-row в БД 'running' но
// worker уже умер (зомби) → DB-update переводит запись в cancelled.
adminRouter.post(
  "/broadcast/cancel/:jobId",
  asyncRoute(async (req, res) => {
    const jobId = req.params.jobId;
    const result = await cancelBroadcastJob(jobId);
    if (result.ok) return res.json({ ok: true });
    const code = result.reason === "not_found" ? 404 : 409;
    const msg = result.reason === "not_found"
      ? "Рассылка не найдена"
      : result.reason === "not_running"
        ? "Рассылка уже завершена"
        : "Отмена уже запрошена";
    return res.status(code).json({ message: msg, reason: result.reason });
  })
);

// История рассылок: пагинированный список + получение деталей по id.
adminRouter.get(
  "/broadcast/history",
  asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const data = await listBroadcastHistory({ limit, offset });
    return res.json(data);
  })
);

adminRouter.get(
  "/broadcast/history/:id",
  asyncRoute(async (req, res) => {
    const item = await getBroadcastHistoryItem(req.params.id);
    if (!item) return res.status(404).json({ message: "Not found" });
    return res.json(item);
  })
);

// ——————————————— Авто-рассылка ———————————————

const autoBroadcastRuleSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.enum([
    "after_registration",
    "inactivity",
    "no_payment",
    "trial_not_connected",
    "trial_used_never_paid",
    "no_traffic",
    "subscription_expired",
    "subscription_ending_soon",
    // новый триггер — за N минут до окончания подписки.
    "subscription_ending_minutes",
    // пассивные пользователи без действий.
    "inactive_no_subscription",
    "inactive_with_subscription",
  ]),
  // T-unify: для subscription_ending_minutes допускаем minutes до 7*24*60 = 10080.
  delayDays: z.union([z.number(), z.string()]).transform((v) => (typeof v === "string" ? parseInt(v, 10) : v)).pipe(z.number().int().min(0).max(10080)),
  channel: z.enum(["telegram", "email", "both"]),
  subject: z.string().max(500).nullish(),
  message: z.string().min(1).max(4096),
  buttonText: z.string().max(64).nullish(),
  buttonUrl: z.string().max(500).nullish(),
  // вторая кнопка под сообщением.
  button2Text: z.string().max(64).nullish(),
  button2Url: z.string().max(500).nullish(),
  enabled: z.boolean().optional(),
  // индивидуальные скидки/промокоды для авторассылки.
  promoCodeId: z.string().nullable().optional(),
  personalDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  // при выдаче скидки клиенту через это правило —
  // помечать её как одноразовую (сгорит после первой продуктовой покупки). Дефолт true.
  personalDiscountIsOneTime: z.boolean().optional(),
  maxRecipients: z.number().int().min(1).nullable().optional(),
  // индивидуальный cron этого правила.
  // null/пусто → scheduler берёт дефолт по типу триггера. Формат node-cron (5 полей).
  cronExpression: z.string().max(64).nullable().optional(),
  // per-rule флаг — если true, правило НЕ
  // запускается по крону, ждёт события из бота (после регистрации). Поддерживается
  // для after_registration.
  eventDriven: z.boolean().optional(),
});

adminRouter.get("/auto-broadcast/rules", asyncRoute(async (_req, res) => {
  const rules = await prisma.autoBroadcastRule.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { logs: true } } },
  });
  return res.json(
    rules.map((r) => ({
      id: r.id,
      name: r.name,
      triggerType: r.triggerType,
      delayDays: r.delayDays,
      channel: r.channel,
      subject: r.subject,
      message: r.message,
      buttonText: r.buttonText,
      buttonUrl: r.buttonUrl,
      button2Text: r.button2Text,
      button2Url: r.button2Url,
      enabled: r.enabled,
      // T-promo (13.05.2026) — поля для рассылки с промокодом/скидкой.
      promoCodeId: r.promoCodeId,
      personalDiscountPercent: r.personalDiscountPercent,
      personalDiscountIsOneTime: r.personalDiscountIsOneTime,
      maxRecipients: r.maxRecipients,
      // T-cron-per-rule (13.05.2026)
      cronExpression: r.cronExpression,
      // T-event-driven (14.05.2026)
      eventDriven: r.eventDriven,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      sentCount: r._count.logs,
    }))
  );
}));

adminRouter.get("/auto-broadcast/rules/:id/eligible-count", asyncRoute(async (req, res) => {
  const ruleId = req.params.id;
  const ids = await getEligibleClientIds(ruleId);
  return res.json({ count: ids.length });
}));

adminRouter.post("/auto-broadcast/rules", asyncRoute(async (req, res) => {
  const parsed = autoBroadcastRuleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  const data = parsed.data;
  const rule = await prisma.autoBroadcastRule.create({
    data: {
      name: data.name,
      triggerType: data.triggerType,
      delayDays: data.delayDays,
      channel: data.channel,
      subject: data.subject ?? null,
      message: data.message,
      buttonText: data.buttonText ?? null,
      buttonUrl: data.buttonUrl ?? null,
      button2Text: data.button2Text ?? null,
      button2Url: data.button2Url ?? null,
      enabled: data.enabled ?? true,
      // T-promo (13.05.2026)
      promoCodeId: data.promoCodeId ?? null,
      personalDiscountPercent: data.personalDiscountPercent ?? null,
      personalDiscountIsOneTime: data.personalDiscountIsOneTime ?? true,
      maxRecipients: data.maxRecipients ?? null,
      // T-cron-per-rule (13.05.2026)
      cronExpression: data.cronExpression?.trim() || null,
      // T-event-driven (14.05.2026)
      eventDriven: data.eventDriven ?? false,
    },
  });
  // T-cron-per-rule: подхватить cron сразу после create — пересоздаём scheduler для этого правила.
  try {
    const { rescheduleRule } = await import("../auto-broadcast/auto-broadcast-scheduler.js");
    await rescheduleRule(rule.id);
  } catch (e) { console.warn("[auto-broadcast] rescheduleRule after create failed:", e); }
  return res.status(201).json({
    id: rule.id,
    name: rule.name,
    triggerType: rule.triggerType,
    delayDays: rule.delayDays,
    channel: rule.channel,
    subject: rule.subject,
    message: rule.message,
    buttonText: rule.buttonText,
    buttonUrl: rule.buttonUrl,
    button2Text: rule.button2Text,
    button2Url: rule.button2Url,
    enabled: rule.enabled,
    promoCodeId: rule.promoCodeId,
    personalDiscountPercent: rule.personalDiscountPercent,
    personalDiscountIsOneTime: rule.personalDiscountIsOneTime,
    maxRecipients: rule.maxRecipients,
    cronExpression: rule.cronExpression,
    eventDriven: rule.eventDriven,
    lastRunAt: rule.lastRunAt?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  });
}));

adminRouter.patch("/auto-broadcast/rules/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const parsed = autoBroadcastRuleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  // нормализуем cronExpression (пустая строка → null).
  const data = { ...parsed.data } as Record<string, unknown>;
  if ("cronExpression" in data) {
    const raw = typeof data.cronExpression === "string" ? data.cronExpression.trim() : data.cronExpression;
    data.cronExpression = raw || null;
  }
  const rule = await prisma.autoBroadcastRule.update({ where: { id }, data });
  // Применяем новое расписание сразу.
  try {
    const { rescheduleRule } = await import("../auto-broadcast/auto-broadcast-scheduler.js");
    await rescheduleRule(rule.id);
  } catch (e) { console.warn("[auto-broadcast] rescheduleRule after patch failed:", e); }
  return res.json({
    id: rule.id,
    name: rule.name,
    triggerType: rule.triggerType,
    delayDays: rule.delayDays,
    channel: rule.channel,
    subject: rule.subject,
    message: rule.message,
    buttonText: rule.buttonText,
    buttonUrl: rule.buttonUrl,
    button2Text: rule.button2Text,
    button2Url: rule.button2Url,
    enabled: rule.enabled,
    promoCodeId: rule.promoCodeId,
    personalDiscountPercent: rule.personalDiscountPercent,
    personalDiscountIsOneTime: rule.personalDiscountIsOneTime,
    maxRecipients: rule.maxRecipients,
    cronExpression: rule.cronExpression,
    eventDriven: rule.eventDriven,
    lastRunAt: rule.lastRunAt?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  });
}));

adminRouter.delete("/auto-broadcast/rules/:id", asyncRoute(async (req, res) => {
  await prisma.autoBroadcastRule.delete({ where: { id: req.params.id } });
  // T-cron-per-rule: снимаем cron-задачу удалённого правила.
  try {
    const { rescheduleRule } = await import("../auto-broadcast/auto-broadcast-scheduler.js");
    await rescheduleRule(req.params.id);
  } catch (e) { console.warn("[auto-broadcast] rescheduleRule after delete failed:", e); }
  return res.status(204).send();
}));

adminRouter.post("/auto-broadcast/run", asyncRoute(async (_req, res) => {
  const results = await runAllRules();
  return res.json({ results });
}));

adminRouter.post("/auto-broadcast/run/:ruleId", asyncRoute(async (req, res) => {
  const result = await runRule(req.params.ruleId);
  return res.json(result);
}));

// ——————————————— Промо-группы ———————————————

function generatePromoCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < length; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** Список промо-групп + статистика активаций */
adminRouter.get("/promo-groups", async (_req, res) => {
  const groups = await prisma.promoGroup.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { activations: true } },
    },
  });
  return res.json(groups.map((g) => ({
    ...g,
    trafficLimitBytes: g.trafficLimitBytes.toString(),
    activationsCount: g._count.activations,
  })));
});

/** Одна промо-группа + список активаций */
adminRouter.get("/promo-groups/:id", async (req, res) => {
  const group = await prisma.promoGroup.findUnique({
    where: { id: req.params.id },
    include: {
      activations: {
        include: {
          client: {
            select: { id: true, email: true, telegramId: true, telegramUsername: true, createdAt: true, remnawaveUuid: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { activations: true } },
    },
  });
  if (!group) return res.status(404).json({ message: "Not found" });
  return res.json({
    ...group,
    trafficLimitBytes: group.trafficLimitBytes.toString(),
    activationsCount: group._count.activations,
  });
});

const createPromoGroupSchema = z.object({
  name: z.string().min(1).max(200),
  squadUuid: z.string().min(1),
  trafficLimitBytes: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
  deviceLimit: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(1),
  maxActivations: z.number().int().min(0).default(0),
  isActive: z.boolean().optional(),
});

/** Создать промо-группу */
adminRouter.post("/promo-groups", async (req, res) => {
  const parsed = createPromoGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
  const data = parsed.data;

  // Генерируем уникальный код
  let code: string;
  let exists = true;
  do {
    code = generatePromoCode();
    const existing = await prisma.promoGroup.findUnique({ where: { code } });
    exists = !!existing;
  } while (exists);

  const group = await prisma.promoGroup.create({
    data: {
      name: data.name,
      code,
      squadUuid: data.squadUuid,
      trafficLimitBytes: data.trafficLimitBytes,
      deviceLimit: data.deviceLimit ?? null,
      durationDays: data.durationDays,
      maxActivations: data.maxActivations,
      isActive: data.isActive ?? true,
    },
  });
  return res.json({ ...group, trafficLimitBytes: group.trafficLimitBytes.toString() });
});

const updatePromoGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  squadUuid: z.string().min(1).optional(),
  trafficLimitBytes: z.union([z.string(), z.number()]).transform((v) => BigInt(v)).optional(),
  deviceLimit: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(1).optional(),
  maxActivations: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/** Обновить промо-группу */
adminRouter.patch("/promo-groups/:id", async (req, res) => {
  const parsed = updatePromoGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });

  const existing = await prisma.promoGroup.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Not found" });

  const group = await prisma.promoGroup.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  return res.json({ ...group, trafficLimitBytes: group.trafficLimitBytes.toString() });
});

/** Удалить промо-группу */
adminRouter.delete("/promo-groups/:id", async (req, res) => {
  const existing = await prisma.promoGroup.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Not found" });
  await prisma.promoGroup.delete({ where: { id: req.params.id } });
  return res.json({ ok: true });
});

// ——————————————— Промокоды (скидки / бесплатные дни) ———————————————

/** Список промокодов */
adminRouter.get("/promo-codes", async (_req, res) => {
  const codes = await prisma.promoCode.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { usages: true } } },
  });
  return res.json(codes.map((c) => ({
    ...c,
    trafficLimitBytes: c.trafficLimitBytes?.toString() ?? null,
    usagesCount: c._count.usages,
  })));
});

/** Один промокод + использования */
adminRouter.get("/promo-codes/:id", async (req, res) => {
  const code = await prisma.promoCode.findUnique({
    where: { id: req.params.id },
    include: {
      usages: {
        include: {
          client: {
            select: { id: true, email: true, telegramId: true, telegramUsername: true, createdAt: true, remnawaveUuid: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { usages: true } },
    },
  });
  if (!code) return res.status(404).json({ message: "Not found" });
  return res.json({
    ...code,
    trafficLimitBytes: code.trafficLimitBytes?.toString() ?? null,
    usagesCount: code._count.usages,
  });
});

const createPromoCodeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  type: z.enum(["DISCOUNT", "FREE_DAYS"]),
  discountPercent: z.number().min(0).max(100).nullable().optional(),
  discountFixed: z.number().min(0).nullable().optional(),
  squadUuid: z.string().nullable().optional(),
  trafficLimitBytes: z.union([z.string(), z.number()]).transform((v) => (v != null ? BigInt(v) : null)).nullable().optional(),
  deviceLimit: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(1).nullable().optional(),
  maxUses: z.number().int().min(0).default(0),
  maxUsesPerClient: z.number().int().min(1).default(1),
  isActive: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
});

/** Создать промокод */
adminRouter.post("/promo-codes", async (req, res) => {
  const parsed = createPromoCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
  const d = parsed.data;

  // Проверяем уникальность кода
  const exists = await prisma.promoCode.findUnique({ where: { code: d.code } });
  if (exists) return res.status(400).json({ message: "Промокод с таким кодом уже существует" });

  const code = await prisma.promoCode.create({
    data: {
      code: d.code,
      name: d.name,
      type: d.type,
      discountPercent: d.type === "DISCOUNT" ? (d.discountPercent ?? null) : null,
      discountFixed: d.type === "DISCOUNT" ? (d.discountFixed ?? null) : null,
      squadUuid: d.type === "FREE_DAYS" ? (d.squadUuid ?? null) : null,
      trafficLimitBytes: d.type === "FREE_DAYS" ? (d.trafficLimitBytes ?? BigInt(0)) : null,
      deviceLimit: d.type === "FREE_DAYS" ? (d.deviceLimit ?? null) : null,
      durationDays: d.type === "FREE_DAYS" ? (d.durationDays ?? null) : null,
      maxUses: d.maxUses,
      maxUsesPerClient: d.maxUsesPerClient,
      isActive: d.isActive ?? true,
      expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
    },
  });
  return res.json({ ...code, trafficLimitBytes: code.trafficLimitBytes?.toString() ?? null });
});

const updatePromoCodeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(["DISCOUNT", "FREE_DAYS"]).optional(),
  discountPercent: z.number().min(0).max(100).nullable().optional(),
  discountFixed: z.number().min(0).nullable().optional(),
  squadUuid: z.string().nullable().optional(),
  trafficLimitBytes: z.union([z.string(), z.number()]).transform((v) => (v != null ? BigInt(v) : null)).nullable().optional(),
  deviceLimit: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(1).nullable().optional(),
  maxUses: z.number().int().min(0).optional(),
  maxUsesPerClient: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
});

/** Обновить промокод */
adminRouter.patch("/promo-codes/:id", async (req, res) => {
  const parsed = updatePromoCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });

  const existing = await prisma.promoCode.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Not found" });

  const data: Record<string, unknown> = { ...parsed.data };
  if (data.expiresAt !== undefined) {
    data.expiresAt = data.expiresAt ? new Date(data.expiresAt as string) : null;
  }

  const code = await prisma.promoCode.update({
    where: { id: req.params.id },
    data,
  });
  return res.json({ ...code, trafficLimitBytes: code.trafficLimitBytes?.toString() ?? null });
});

/** Удалить промокод */
adminRouter.delete("/promo-codes/:id", async (req, res) => {
  const existing = await prisma.promoCode.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Not found" });
  await prisma.promoCode.delete({ where: { id: req.params.id } });
  return res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  АНАЛИТИКА (полная)
// ═══════════════════════════════════════════════════════════════

/** helper: заполняет дневной ряд нулями */
function fillDaySeries(map: Record<string, number>, from: Date, to: Date): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const d = new Date(from);
  while (d <= to) {
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, value: map[key] ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

adminRouter.get("/analytics", async (_req, res) => {
  const now = new Date();
  const day1Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day90Ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // ─── Все оплаченные платежи за 90 дней ───
  const payments90 = await prisma.payment.findMany({
    where: { status: "PAID", paidAt: { gte: day90Ago } },
    select: { amount: true, paidAt: true, provider: true, tariffId: true, clientId: true },
    orderBy: { paidAt: "asc" },
  });

  const revenueByDay: Record<string, number> = {};
  const revenueByProvider: Record<string, number> = {};
  const tariffSalesCount: Record<string, number> = {};
  const tariffRevenue: Record<string, number> = {};
  const uniqueBuyers = new Set<string>();
  let rev7 = 0, rev30 = 0, cnt7 = 0, cnt30 = 0;

  const isExternal = (provider: string | null) => provider !== "balance";
  for (const p of payments90) {
    const day = p.paidAt ? p.paidAt.toISOString().slice(0, 10) : "unknown";
    const prov = p.provider ?? "unknown";
    if (isExternal(p.provider)) {
      revenueByDay[day] = (revenueByDay[day] ?? 0) + p.amount;
      uniqueBuyers.add(p.clientId);
      if (p.paidAt && p.paidAt >= day7Ago) { rev7 += p.amount; cnt7++; }
      if (p.paidAt && p.paidAt >= day30Ago) { rev30 += p.amount; cnt30++; }
      if (p.tariffId) tariffRevenue[p.tariffId] = (tariffRevenue[p.tariffId] ?? 0) + p.amount;
    }
    revenueByProvider[prov] = (revenueByProvider[prov] ?? 0) + p.amount;
    if (p.tariffId) tariffSalesCount[p.tariffId] = (tariffSalesCount[p.tariffId] ?? 0) + 1;
  }

  const revenueSeries = fillDaySeries(revenueByDay, day90Ago, now);

  // ─── Клиенты за 90 дней (включая UTM для аналитики по кампаниям) ───
  const allClients = await prisma.client.findMany({
    select: {
      id: true, createdAt: true, telegramId: true, email: true,
      trialUsed: true, remnawaveUuid: true, referrerId: true, balance: true,
      utmSource: true, utmCampaign: true,
    },
  });

  const clientsByDay: Record<string, number> = {};
  let botClients = 0, siteClients = 0, bothClients = 0;
  let trialUsedCount = 0;
  let withReferrer = 0;
  const totalBalance = allClients.reduce((s, c) => s + c.balance, 0);

  for (const c of allClients) {
    if (c.createdAt >= day90Ago) {
      const day = c.createdAt.toISOString().slice(0, 10);
      clientsByDay[day] = (clientsByDay[day] ?? 0) + 1;
    }
    const hasBot = !!c.telegramId;
    const hasSite = !!c.email;
    if (hasBot && hasSite) bothClients++;
    else if (hasBot) botClients++;
    else if (hasSite) siteClients++;
    if (c.trialUsed) trialUsedCount++;
    if (c.referrerId) withReferrer++;
  }

  const clientsSeries = fillDaySeries(clientsByDay, day90Ago, now);

  // ─── Аналитика по источникам трафика (UTM) ───
  const bySourceKey: Record<string, { registrations: number; trials: number; payments: number; revenue: number }> = {};
  function keyFor(source: string | null, campaign: string | null) {
    const s = source?.trim() || "(без метки)";
    const c = campaign?.trim() || "";
    return `${s}\t${c}`;
  }
  for (const c of allClients) {
    const k = keyFor(c.utmSource, c.utmCampaign);
    if (!bySourceKey[k]) bySourceKey[k] = { registrations: 0, trials: 0, payments: 0, revenue: 0 };
    bySourceKey[k].registrations++;
    if (c.trialUsed) bySourceKey[k].trials++;
  }
  const clientIdToUtm = new Map(allClients.map((c) => [c.id, { source: c.utmSource, campaign: c.utmCampaign }]));
  for (const p of payments90) {
    const utm = clientIdToUtm.get(p.clientId);
    const k = keyFor(utm?.source ?? null, utm?.campaign ?? null);
    if (!bySourceKey[k]) bySourceKey[k] = { registrations: 0, trials: 0, payments: 0, revenue: 0 };
    if (isExternal(p.provider)) {
      bySourceKey[k].payments++;
      bySourceKey[k].revenue += p.amount;
    }
  }
  const campaignsStats = Object.entries(bySourceKey).map(([key, v]) => {
    const [source, campaign] = key.split("\t");
    return { source, campaign: campaign || null, ...v };
  }).sort((a, b) => b.revenue - a.revenue);

  // ─── Триалы по дням (клиенты с trialUsed, приближаем по createdAt) ───
  // Точной даты триала нет, но можем показать клиентов использовавших триал
  // Вместо этого считаем из promo activations и trial по дням
  const trialClients = allClients.filter((c) => c.trialUsed && c.createdAt >= day90Ago);
  const trialsByDay: Record<string, number> = {};
  for (const c of trialClients) {
    const day = c.createdAt.toISOString().slice(0, 10);
    trialsByDay[day] = (trialsByDay[day] ?? 0) + 1;
  }
  const trialsSeries = fillDaySeries(trialsByDay, day90Ago, now);

  // ─── Конверсия: триал → покупка ───
  const trialClientIds = new Set(allClients.filter((c) => c.trialUsed).map((c) => c.id));
  const trialToPaid = [...trialClientIds].filter((id) => uniqueBuyers.has(id)).length;
  const trialConversionRate = trialClientIds.size > 0 ? Math.round((trialToPaid / trialClientIds.size) * 100) : 0;

  // ─── Топ тарифов (продажи + доход) ───
  const tariffIds = Object.keys(tariffSalesCount);
  const tariffRows = tariffIds.length > 0
    ? await prisma.tariff.findMany({ where: { id: { in: tariffIds } }, select: { id: true, name: true } })
    : [];
  const tariffMap = Object.fromEntries(tariffRows.map((t) => [t.id, t.name]));
  const topTariffs = Object.entries(tariffSalesCount)
    .map(([id, count]) => ({ name: tariffMap[id] ?? id, count, revenue: tariffRevenue[id] ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // ─── Доход по провайдерам ───
  const providerSeries = Object.entries(revenueByProvider).map(([provider, amount]) => ({
    provider: provider === "balance" ? "Баланс" : provider === "platega" ? "Platega" : provider === "cryptopay" ? "Crypto Pay" : provider === "heleket" ? "Heleket" : provider === "overpay" ? "Overpay" : provider,
    amount,
  }));

  // ─── Топ рефералов ───
  const referralCredits = await prisma.referralCredit.findMany({
    select: { referrerId: true, amount: true, level: true },
  });
  const refEarnings: Record<string, { total: number; l1: number; l2: number; l3: number; count: number }> = {};
  for (const rc of referralCredits) {
    if (!refEarnings[rc.referrerId]) refEarnings[rc.referrerId] = { total: 0, l1: 0, l2: 0, l3: 0, count: 0 };
    const e = refEarnings[rc.referrerId];
    e.total += rc.amount;
    e.count++;
    if (rc.level === 1) e.l1 += rc.amount;
    else if (rc.level === 2) e.l2 += rc.amount;
    else if (rc.level === 3) e.l3 += rc.amount;
  }

  // Количество рефералов у каждого реферера
  const referralCounts: Record<string, number> = {};
  for (const c of allClients) {
    if (c.referrerId) {
      referralCounts[c.referrerId] = (referralCounts[c.referrerId] ?? 0) + 1;
    }
  }

  const topReferrerIds = Object.entries(refEarnings)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15)
    .map(([id]) => id);

  const topReferrerClients = topReferrerIds.length > 0
    ? await prisma.client.findMany({
        where: { id: { in: topReferrerIds } },
        select: { id: true, email: true, telegramUsername: true, telegramId: true },
      })
    : [];
  const refClientMap = Object.fromEntries(topReferrerClients.map((c) => [c.id, c]));
  const topReferrers = topReferrerIds.map((id) => {
    const c = refClientMap[id];
    const e = refEarnings[id];
    return {
      id,
      name: c?.telegramUsername ? `@${c.telegramUsername}` : c?.email ?? c?.telegramId ?? id,
      referrals: referralCounts[id] ?? 0,
      earnings: e.total,
      l1: e.l1,
      l2: e.l2,
      l3: e.l3,
      credits: e.count,
    };
  });

  // ─── Промо аналитика ───
  const [promoActivationsTotal, promoCodeUsagesTotal] = await Promise.all([
    prisma.promoActivation.count(),
    prisma.promoCodeUsage.count(),
  ]);

  // Промо-ссылки по группам
  const promoGroupStats = await prisma.promoGroup.findMany({
    select: { id: true, name: true, code: true, maxActivations: true, _count: { select: { activations: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Промокоды по коду
  const promoCodeStats = await prisma.promoCode.findMany({
    select: { id: true, code: true, name: true, type: true, maxUses: true, _count: { select: { usages: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Промо активации по дням
  const promoActs90 = await prisma.promoActivation.findMany({
    where: { createdAt: { gte: day90Ago } },
    select: { createdAt: true },
  });
  const promoActsByDay: Record<string, number> = {};
  for (const a of promoActs90) {
    const day = a.createdAt.toISOString().slice(0, 10);
    promoActsByDay[day] = (promoActsByDay[day] ?? 0) + 1;
  }
  const promoActsSeries = fillDaySeries(promoActsByDay, day90Ago, now);

  // Промокоды использований по дням
  const promoUsages90 = await prisma.promoCodeUsage.findMany({
    where: { createdAt: { gte: day90Ago } },
    select: { createdAt: true },
  });
  const promoUsagesByDay: Record<string, number> = {};
  for (const u of promoUsages90) {
    const day = u.createdAt.toISOString().slice(0, 10);
    promoUsagesByDay[day] = (promoUsagesByDay[day] ?? 0) + 1;
  }
  const promoUsagesSeries = fillDaySeries(promoUsagesByDay, day90Ago, now);

  // ─── Реферальные начисления по дням ───
  const refCredits90 = await prisma.referralCredit.findMany({
    where: { createdAt: { gte: day90Ago } },
    select: { createdAt: true, amount: true },
  });
  const refCreditsByDay: Record<string, number> = {};
  for (const rc of refCredits90) {
    const day = rc.createdAt.toISOString().slice(0, 10);
    refCreditsByDay[day] = (refCreditsByDay[day] ?? 0) + rc.amount;
  }
  const refCreditsSeries = fillDaySeries(refCreditsByDay, day90Ago, now);

  // ─── Сводка (доход и кол-во платежей — только внешние поступления, без оплаты с баланса) ───
  const [totalClients, activeClients, totalRevenueAgg, totalPayments, referralCreditsSum,
    clientsNew24h, clientsNew7d, clientsNew30d, paymentsPending] = await Promise.all([
    prisma.client.count(),
    prisma.client.count({ where: { remnawaveUuid: { not: null } } }),
    prisma.payment.aggregate({ where: PAID_EXTERNAL_WHERE, _sum: { amount: true } }),
    prisma.payment.count({ where: PAID_EXTERNAL_WHERE }),
    prisma.referralCredit.aggregate({ _sum: { amount: true } }),
    prisma.client.count({ where: { createdAt: { gte: day1Ago } } }),
    prisma.client.count({ where: { createdAt: { gte: day7Ago } } }),
    prisma.client.count({ where: { createdAt: { gte: day30Ago } } }),
    prisma.payment.count({ where: { status: "PENDING" } }),
  ]);

  const totalRevenue = totalRevenueAgg._sum.amount ?? 0;
  const avgCheck = totalPayments > 0 ? Math.round((totalRevenue / totalPayments) * 100) / 100 : 0;
  const arpu = totalClients > 0 ? Math.round((totalRevenue / totalClients) * 100) / 100 : 0;
  const payingClients = uniqueBuyers.size;
  const payingPercent = totalClients > 0 ? Math.round((payingClients / totalClients) * 100) : 0;

  return res.json({
    // Графики
    revenueSeries,
    clientsSeries,
    trialsSeries,
    promoActsSeries,
    promoUsagesSeries,
    refCreditsSeries,

    // Таблицы / списки
    topTariffs,
    providerSeries,
    topReferrers,
    campaignsStats,
    promoGroupStats: promoGroupStats.map((g) => ({
      name: g.name,
      code: g.code,
      maxActivations: g.maxActivations,
      activations: g._count.activations,
    })),
    promoCodeStats: promoCodeStats.map((c) => ({
      code: c.code,
      name: c.name,
      type: c.type,
      maxUses: c.maxUses,
      usages: c._count.usages,
    })),

    // Сводка
    summary: {
      totalClients,
      activeClients,
      totalRevenue,
      totalPayments,
      totalReferralPaid: referralCreditsSum._sum.amount ?? 0,
      promoActivations: promoActivationsTotal,
      promoCodeUsages: promoCodeUsagesTotal,
      // Новое
      clientsNew24h,
      clientsNew7d,
      clientsNew30d,
      botClients,
      siteClients,
      bothClients,
      trialUsedCount,
      trialToPaid,
      trialConversionRate,
      avgCheck,
      arpu,
      payingClients,
      payingPercent,
      rev7,
      rev30,
      cnt7,
      cnt30,
      paymentsPending,
      totalBalance: Math.round(totalBalance * 100) / 100,
      withReferrer,
    },
  });
});

// ═══════════════════════════════════════════════════════════════
//  ОТЧЁТЫ ПРОДАЖ
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  АВТО-БЭКАП — ручной запуск
// ═══════════════════════════════════════════════════════════════

adminRouter.post("/backup/send-to-telegram", asyncRoute(async (_req, res) => {
  const { runAutoBackup } = await import("../backup/auto-backup.scheduler.js");
  try {
    await runAutoBackup();
    return res.json({ ok: true, message: "Бэкап создан и отправлен в Telegram" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, message: msg });
  }
}));

// ═══════════════════════════════════════════════════════════════
//  ВИДЕО-ИНСТРУКЦИИ
// ═══════════════════════════════════════════════════════════════

adminRouter.get("/video-instructions", async (_req, res) => {
  const [enabledRow, dataRow] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "video_instructions_enabled" } }),
    prisma.systemSetting.findUnique({ where: { key: "video_instructions" } }),
  ]);
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(dataRow?.value || "[]"); } catch { /* empty */ }
  return res.json({ enabled: enabledRow?.value === "true", items });
});

adminRouter.put("/video-instructions/toggle", async (req, res) => {
  const enabled = req.body.enabled === true;
  await prisma.systemSetting.upsert({
    where: { key: "video_instructions_enabled" },
    create: { key: "video_instructions_enabled", value: enabled ? "true" : "false" },
    update: { value: enabled ? "true" : "false" },
  });
  return res.json({ ok: true, enabled });
});

adminRouter.post("/video-instructions", async (req, res) => {
  const { title, telegramFileId } = req.body;
  if (!title || !telegramFileId) return res.status(400).json({ error: "title and telegramFileId required" });

  const row = await prisma.systemSetting.findUnique({ where: { key: "video_instructions" } });
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(row?.value || "[]"); } catch { /* empty */ }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sortOrder = items.length > 0 ? Math.max(...items.map((i) => i.sortOrder)) + 1 : 0;
  items.push({ id, title: String(title).trim(), telegramFileId: String(telegramFileId).trim(), sortOrder });

  await prisma.systemSetting.upsert({
    where: { key: "video_instructions" },
    create: { key: "video_instructions", value: JSON.stringify(items) },
    update: { value: JSON.stringify(items) },
  });
  return res.json({ ok: true, items });
});

adminRouter.put("/video-instructions/:id", async (req, res) => {
  const { id } = req.params;
  const { title, telegramFileId } = req.body;

  const row = await prisma.systemSetting.findUnique({ where: { key: "video_instructions" } });
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(row?.value || "[]"); } catch { /* empty */ }

  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return res.status(404).json({ error: "not found" });

  if (title !== undefined) items[idx].title = String(title).trim();
  if (telegramFileId !== undefined) items[idx].telegramFileId = String(telegramFileId).trim();

  await prisma.systemSetting.upsert({
    where: { key: "video_instructions" },
    create: { key: "video_instructions", value: JSON.stringify(items) },
    update: { value: JSON.stringify(items) },
  });
  return res.json({ ok: true, items });
});

adminRouter.delete("/video-instructions/:id", async (req, res) => {
  const { id } = req.params;

  const row = await prisma.systemSetting.findUnique({ where: { key: "video_instructions" } });
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(row?.value || "[]"); } catch { /* empty */ }

  items = items.filter((i) => i.id !== id);

  await prisma.systemSetting.upsert({
    where: { key: "video_instructions" },
    create: { key: "video_instructions", value: JSON.stringify(items) },
    update: { value: JSON.stringify(items) },
  });
  return res.json({ ok: true, items });
});

adminRouter.put("/video-instructions/reorder", async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: "order must be an array of ids" });

  const row = await prisma.systemSetting.findUnique({ where: { key: "video_instructions" } });
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(row?.value || "[]"); } catch { /* empty */ }

  const sorted: typeof items = [];
  for (let i = 0; i < order.length; i++) {
    const found = items.find((it) => it.id === order[i]);
    if (found) { found.sortOrder = i; sorted.push(found); }
  }
  for (const it of items) {
    if (!sorted.includes(it)) sorted.push(it);
  }

  await prisma.systemSetting.upsert({
    where: { key: "video_instructions" },
    create: { key: "video_instructions", value: JSON.stringify(sorted) },
    update: { value: JSON.stringify(sorted) },
  });
  return res.json({ ok: true, items: sorted });
});

adminRouter.get("/sales-report", async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const provider = typeof req.query.provider === "string" ? req.query.provider : null;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

  const where: Record<string, unknown> = {};
  if (status && status !== "all") {
    where.status = status;
  } else {
    where.status = "PAID";
  }
  if (from || to) {
    const paidAt: Record<string, Date> = {};
    if (from) paidAt.gte = new Date(from);
    if (to) paidAt.lte = new Date(to + "T23:59:59.999Z");
    where.paidAt = paidAt;
  }
  if (provider) where.provider = provider;
  if (search) {
    where.OR = [
      { orderId: { contains: search, mode: "insensitive" } },
      { client: { email: { contains: search, mode: "insensitive" } } },
      { client: { telegramUsername: { contains: search, mode: "insensitive" } } },
      { client: { telegramId: search } },
      { tariff: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { paidAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } },
        tariff: { select: { id: true, name: true } },
      },
    }),
  ]);

  const agg = await prisma.payment.aggregate({ where, _sum: { amount: true }, _count: true });

  const byCurrency: Record<string, { sum: number; count: number }> = {};
  const byProvider: Record<string, number> = {};
  for (const p of payments) {
    const cur = p.currency ?? "RUB";
    if (!byCurrency[cur]) byCurrency[cur] = { sum: 0, count: 0 };
    byCurrency[cur].sum += p.amount;
    byCurrency[cur].count += 1;
    const prov = p.provider ?? "unknown";
    byProvider[prov] = (byProvider[prov] ?? 0) + 1;
  }

  return res.json({
    items: payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      provider: p.provider ?? "unknown",
      status: p.status,
      tariffName: p.tariff?.name ?? null,
      tariffId: p.tariff?.id ?? null,
      clientId: p.client?.id ?? null,
      clientEmail: p.client?.email ?? null,
      clientTelegramId: p.client?.telegramId ?? null,
      clientTelegramUsername: p.client?.telegramUsername ?? null,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      metadata: p.metadata,
    })),
    total,
    page,
    limit,
    totalAmount: agg._sum.amount ?? 0,
    totalCount: agg._count,
    byCurrency,
    byProvider,
  });
});

/**
 * отчёт продаж только через баланс.
 * Доступ только для ADMIN или MANAGER с action `view_balance_sales`. Для менеджеров-девочек —
 * они видят только то, что реально оплачено через начисление баланса (provider=balance),
 * без всех остальных платёжек (карты/крипта/etc).
 *
 * Этот endpoint не пускает через requireAdminSection (т.к. секция `sales-report` могла быть
 * не выдана менеджеру), а проверяет action напрямую.
 */
adminRouter.get("/balance-sales", requireAction("view_balance_sales"), async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : null;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

  const where: Record<string, unknown> = {
    status: "PAID",
    provider: "balance",
  };
  if (from || to) {
    const paidAt: Record<string, Date> = {};
    if (from) paidAt.gte = new Date(from);
    if (to) paidAt.lte = new Date(to + "T23:59:59.999Z");
    where.paidAt = paidAt;
  }
  if (search) {
    where.OR = [
      { client: { email: { contains: search, mode: "insensitive" } } },
      { client: { telegramUsername: { contains: search, mode: "insensitive" } } },
      { client: { telegramId: search } },
      { tariff: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { paidAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } },
        tariff: { select: { id: true, name: true } },
      },
    }),
  ]);

  const agg = await prisma.payment.aggregate({ where, _sum: { amount: true }, _count: true });

  return res.json({
    items: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      tariffName: p.tariff?.name ?? null,
      clientId: p.client?.id ?? null,
      clientEmail: p.client?.email ?? null,
      clientTelegramId: p.client?.telegramId ?? null,
      clientTelegramUsername: p.client?.telegramUsername ?? null,
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
    total,
    page,
    limit,
    totalAmount: agg._sum.amount ?? 0,
    totalCount: agg._count,
  });
});

adminRouter.delete("/sales-report/:paymentId", async (req, res) => {
  const { paymentId } = req.params;
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return res.status(404).json({ error: "Платёж не найден" });
  await prisma.payment.delete({ where: { id: paymentId } });
  return res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  МЕНЕДЖЕРЫ (только для роли ADMIN)
// ═══════════════════════════════════════════════════════════════

export const ADMIN_ALLOWED_SECTIONS = [
  // Overview
  "dashboard",
  "remna-nodes", // виджет нод Remna на дашборде
  "analytics",
  "sales-report",
  "traffic-abuse",
  "geo-map",
  // Management
  "clients",
  "proxy",
  "singbox",
  "backup",
  "tickets",
  "withdrawals", // Заявки на вывод USDT
  // Subscription
  "tariffs",
  "trials", // Trial-пресеты (мульти-триал система)
  "auto-renew", // Конструктор уведомлений автосписания
  "promo",
  "promo-codes",
  "marketing",
  "referral-network",
  "secondary-subscriptions",
  // Tools
  "video-instructions",
  "broadcast",
  "auto-broadcast",
  "contests",
  "tour-constructor",
  "promo-vpn", // Продвижение VPN через Gramads
  "marketplace",
  // Settings
  "settings",
  "languages",
  "api-keys",
  "bots", // Боты-клоны
  "antibot",
  "diagnostics",
  "webhook-inbox",
  "audit", // Аудит-лог
] as const;

/** Список админов и менеджеров (только ADMIN). */
adminRouter.get("/admins", asyncRoute(async (req, res) => {
  const ext = req as unknown as { adminRole?: string };
  if (ext.adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Only admin can list managers" });
  }
  const list = await prisma.admin.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      allowedSections: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });
  const allowedSections = (raw: string | null): string[] => {
    if (!raw?.trim()) return [];
    try {
      const p = JSON.parse(raw) as unknown;
      // возвращаем только секции, action:* — отдельный endpoint.
      return Array.isArray(p) ? p.filter((s): s is string => typeof s === "string" && !s.startsWith("action:")) : [];
    } catch {
      return [];
    }
  };
  return res.json(
    list.map((a) => ({
      id: a.id,
      email: a.email,
      role: a.role,
      allowedSections: allowedSections(a.allowedSections),
      mustChangePassword: a.mustChangePassword,
      createdAt: a.createdAt.toISOString(),
    }))
  );
}));

const createManagerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Min 8 characters"),
  allowedSections: z.array(z.string()).optional(),
});

/** Создать менеджера (только ADMIN). */
adminRouter.post("/admins", asyncRoute(async (req, res) => {
  const ext = req as unknown as { adminRole?: string };
  if (ext.adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Only admin can create managers" });
  }
  const body = createManagerSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const existing = await prisma.admin.findUnique({ where: { email: body.data.email } });
  if (existing) {
    return res.status(400).json({ message: "Email already registered" });
  }
  const sections = (body.data.allowedSections ?? []).filter((s) =>
    (ADMIN_ALLOWED_SECTIONS as readonly string[]).includes(s)
  );
  const passwordHash = await hashPassword(body.data.password);
  const admin = await prisma.admin.create({
    data: {
      email: body.data.email,
      passwordHash,
      mustChangePassword: true,
      role: "MANAGER",
      allowedSections: JSON.stringify(sections),
    },
    select: { id: true, email: true, role: true, allowedSections: true, createdAt: true },
  });
  const allowed = admin.allowedSections
    ? (() => {
        try {
          const p = JSON.parse(admin.allowedSections) as unknown;
          return Array.isArray(p) ? p.filter((s): s is string => typeof s === "string") : [];
        } catch {
          return [];
        }
      })()
    : [];
  return res.status(201).json({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    allowedSections: allowed,
    createdAt: admin.createdAt.toISOString(),
  });
}));

const updateManagerSchema = z.object({
  allowedSections: z.array(z.string()).optional(),
  password: z.string().min(8, "Min 8 characters").optional(),
});

/** Обновить менеджера (разделы доступа и/или пароль). Только ADMIN. */
adminRouter.patch("/admins/:id", asyncRoute(async (req, res) => {
  const ext = req as unknown as { adminRole?: string; adminId?: string };
  if (ext.adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Only admin can update managers" });
  }
  const body = updateManagerSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const target = await prisma.admin.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ message: "Not found" });
  if (target.role === "ADMIN") {
    return res.status(403).json({ message: "Cannot modify full admin" });
  }
  const updates: { allowedSections?: string; passwordHash?: string } = {};
  if (body.data.allowedSections !== undefined) {
    const sections = body.data.allowedSections.filter((s) =>
      (ADMIN_ALLOWED_SECTIONS as readonly string[]).includes(s)
    );
    // сохраняем actions (action:*) из текущего значения,
    // иначе PATCH секций стирает права из Permissions-диалога. Парсим как JSON или CSV
    // (для обратной совместимости со старыми CSV-записями от admin-permissions).
    const existingRaw = target.allowedSections ?? "";
    let existingItems: string[] = [];
    try {
      const p = JSON.parse(existingRaw) as unknown;
      if (Array.isArray(p)) existingItems = p.filter((s): s is string => typeof s === "string");
    } catch {
      existingItems = existingRaw.split(",").map((s) => s.trim()).filter(Boolean);
    }
    const existingActions = existingItems.filter((s) => s.startsWith("action:"));
    updates.allowedSections = JSON.stringify([...sections, ...existingActions]);
  }
  if (body.data.password?.trim()) {
    updates.passwordHash = await hashPassword(body.data.password);
  }
  const updated = await prisma.admin.update({
    where: { id: req.params.id },
    data: updates,
    select: { id: true, email: true, role: true, allowedSections: true },
  });
  const allowed = updated.allowedSections
    ? (() => {
        try {
          const p = JSON.parse(updated.allowedSections) as unknown;
          // только секции, action:* — отдельный endpoint.
          return Array.isArray(p) ? p.filter((s): s is string => typeof s === "string" && !s.startsWith("action:")) : [];
        } catch {
          return [];
        }
      })()
    : [];
  return res.json({
    id: updated.id,
    email: updated.email,
    role: updated.role,
    allowedSections: allowed,
  });
}));

/** Удалить менеджера. Только ADMIN. Нельзя удалить полного админа. */
adminRouter.delete("/admins/:id", asyncRoute(async (req, res) => {
  const ext = req as unknown as { adminRole?: string; adminId?: string };
  if (ext.adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Only admin can delete managers" });
  }
  if (req.params.id === ext.adminId) {
    return res.status(400).json({ message: "Cannot delete yourself" });
  }
  const target = await prisma.admin.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ message: "Not found" });
  if (target.role === "ADMIN") {
    return res.status(403).json({ message: "Cannot delete full admin" });
  }
  await prisma.admin.delete({ where: { id: req.params.id } });
  return res.json({ success: true });
}));

// ────── Secondary Subscriptions Admin API ──────

adminRouter.get("/secondary-subscriptions", asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const giftStatus = typeof req.query.giftStatus === "string" ? req.query.giftStatus : "";
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
  const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : "createdAt";
  const sortDir = req.query.sortDir === "asc" ? "asc" as const : "desc" as const;

  const where: Prisma.SubscriptionWhereInput = {};
  const conditions: Prisma.SubscriptionWhereInput[] = [];

  // Gift status filter
  if (giftStatus === "owned") {
    conditions.push({
      OR: [
        { giftStatus: null, giftedToClientId: null },
        { giftStatus: "", giftedToClientId: null },
        { giftStatus: "ACTIVATED_SELF" },
      ],
    });
  } else if (giftStatus === "null") {
    conditions.push({
      OR: [
        { giftStatus: null, giftedToClientId: null },
        { giftStatus: "", giftedToClientId: null },
      ],
    });
  } else if (giftStatus === "ACTIVATED_SELF") {
    conditions.push({ giftStatus: "ACTIVATED_SELF" });
  } else if (giftStatus === "GIFT_RESERVED" || giftStatus === "GIFT_CODE_ACTIVE" || giftStatus === "GIFTED") {
    conditions.push({ giftStatus });
  }

  // Search by owner email/telegramUsername/telegramId
  // старая реализация фильтровала через nested relation:
  //   { owner: { telegramUsername: { contains, mode: "insensitive" } } }
  // В нашем Prisma (6.19.2) этот паттерн с mode:"insensitive" в nested relation
  // молча возвращал 0 строк (баг проявлялся не для всех клиентов). Сейчас сначала
  // резолвим matching client IDs отдельным запросом — этот же синтаксис на
  // ТОП-уровне (как в /admin/clients) работает надёжно — а потом фильтруем
  // subscriptions по `ownerId in (..)` или `giftedToClientId in (..)`.
  if (search.length > 0) {
    const matchedClients = await prisma.client.findMany({
      where: {
        OR: [
          { id: { equals: search } },
          { email: { contains: search, mode: "insensitive" as const } },
          { telegramUsername: { contains: search, mode: "insensitive" as const } },
          { telegramId: { contains: search } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    const matchedClientIds = matchedClients.map((c) => c.id);
    conditions.push({
      OR: [
        ...(matchedClientIds.length > 0
          ? [
              { ownerId: { in: matchedClientIds } },
              { giftedToClientId: { in: matchedClientIds } },
              // поиск по ОТПРАВИТЕЛЮ подарка —
              // подписки, у которых gift-код создан этим клиентом (username/tgid/email/id).
              { giftCodes: { some: { creatorId: { in: matchedClientIds } } } },
            ]
          : []),
        { remnawaveUuid: { contains: search } },
        { id: { contains: search } },
        // поиск по ПОДАРОЧНОМУ КОДУ (XXXX-XXXX-XXXX).
        { giftCodes: { some: { code: { contains: search, mode: "insensitive" as const } } } },
      ],
    });
  }

  // Date range filter
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (!isNaN(d.getTime())) conditions.push({ createdAt: { gte: d } });
  }
  if (dateTo) {
    const d = new Date(dateTo);
    if (!isNaN(d.getTime())) conditions.push({ createdAt: { lte: d } });
  }

  if (conditions.length > 0) where.AND = conditions;

  // Determine orderBy
  const allowedSorts: Record<string, Prisma.SubscriptionOrderByWithRelationInput> = {
    createdAt: { createdAt: sortDir },
    updatedAt: { updatedAt: sortDir },
    subscriptionIndex: { subscriptionIndex: sortDir },
  };
  const orderBy = allowedSorts[sortBy] ?? { createdAt: sortDir };

  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        owner: {
          select: { id: true, email: true, telegramId: true, telegramUsername: true },
        },
        giftedToClient: {
          select: { id: true, email: true, telegramId: true, telegramUsername: true },
        },
        tariff: {
          select: { id: true, name: true, durationDays: true, price: true },
        },
        giftCodes: {
          select: {
            id: true,
            code: true,
            status: true,
            giftMessage: true,
            expiresAt: true,
            redeemedAt: true,
            createdAt: true,
            redeemedBy: { select: { id: true, email: true, telegramUsername: true } },
            // для отображения «отправителя» в админке.
            creator: { select: { id: true, email: true, telegramUsername: true } },
            createdByAdmin: true,
            createdByAdminId: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.subscription.count({ where }),
  ]);

  // резолвим имена админов одним batch-запросом — не дёргаем БД в цикле.
  const adminIds = Array.from(new Set(items.map((s) => s.giftCodes[0]?.createdByAdminId).filter((v): v is string => !!v)));
  const adminsMap: Record<string, { id: string; email: string }> = {};
  if (adminIds.length > 0) {
    const admins = await prisma.admin.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, email: true },
    });
    for (const a of admins) adminsMap[a.id] = a;
  }

  return res.json({
    items: items.map((s) => {
      const lastCode = s.giftCodes[0] ?? null;
      // отправитель — это:
      //   • Конкретный админ из admins-таблицы (по createdByAdminId) → префикс 👑.
      //   • Если createdByAdmin=true но adminId не сохранён (legacy) → «👑 Администратор».
      //   • Иначе клиент-даритель из creator gift code.
      const isAdminGift = lastCode?.createdByAdmin === true;
      let giftSender: { id: string; email: string | null; telegramUsername: string | null; isAdmin: boolean } | null = null;
      if (isAdminGift) {
        const adminEntry = lastCode?.createdByAdminId ? adminsMap[lastCode.createdByAdminId] : null;
        if (adminEntry) {
          giftSender = { id: adminEntry.id, email: adminEntry.email, telegramUsername: null, isAdmin: true };
        } else {
          giftSender = { id: "admin", email: null, telegramUsername: "Администратор", isAdmin: true };
        }
      } else if (lastCode?.creator) {
        giftSender = { ...lastCode.creator, isAdmin: false };
      }
      return {
        ...s,
        latestGiftCode: lastCode,
        giftSender,
        giftCodes: undefined,
      };
    }),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}));

adminRouter.get("/secondary-subscriptions/:id", asyncRoute(async (req, res) => {
  const sub = await prisma.subscription.findUnique({
    where: { id: req.params.id },
    include: {
      owner: {
        select: { id: true, email: true, telegramId: true, telegramUsername: true },
      },
      giftedToClient: {
        select: { id: true, email: true, telegramId: true, telegramUsername: true },
      },
      tariff: {
        select: { id: true, name: true, durationDays: true, price: true, category: true },
      },
      giftCodes: {
        select: {
          id: true,
          code: true,
          status: true,
          giftMessage: true,
          expiresAt: true,
          redeemedAt: true,
          createdAt: true,
          creator: { select: { id: true, email: true, telegramUsername: true } },
          redeemedBy: { select: { id: true, email: true, telegramUsername: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });

  // Fetch Remnawave data if UUID exists
  let remnaData: Record<string, unknown> | null = null;
  if (sub.remnawaveUuid && isRemnaConfigured()) {
    try {
      const r = await remnaGetUser(sub.remnawaveUuid);
      if (!r.error && r.data) {
        const raw = r.data as Record<string, unknown>;
        remnaData = (raw.response ?? raw) as Record<string, unknown>;
      }
    } catch { /* skip */ }
  }

  // Fetch history
  const history = await prisma.giftHistory.findMany({
    where: { subscriptionId: sub.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return res.json({ ...sub, remnaData, history });
}));

// PATCH доп. подписки админом — менять дни и лимит трафика.
// addDays: положительное → продлить (от текущего expireAt или now если истекла),
//          отрицательное → сократить срок.
// trafficLimitBytes: 0 → безлимит, число > 0 → конкретный лимит, null → не менять.
// Изменения пишутся в Remnawave (PATCH user) + лог в gift_history.
const editSecondarySubSchema = z.object({
  addDays: z.number().int().min(-3650).max(3650).optional(),
  trafficLimitBytes: z.number().int().min(0).nullable().optional(),
});
adminRouter.patch("/secondary-subscriptions/:id", asyncRoute(async (req, res) => {
  const parsed = editSecondarySubSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные данные", errors: parsed.error.flatten() });
  if (parsed.data.addDays == null && parsed.data.trafficLimitBytes === undefined) {
    return res.status(400).json({ message: "Нужно указать хотя бы одно поле для изменения" });
  }
  const sub = await prisma.subscription.findUnique({
    where: { id: req.params.id },
    select: { id: true, remnawaveUuid: true, ownerId: true },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });
  if (!sub.remnawaveUuid) return res.status(400).json({ message: "Подписка не привязана к Remnawave" });
  if (!isRemnaConfigured()) return res.status(503).json({ message: "Remnawave не настроен" });

  // Читаем текущее состояние user в Remna — нам нужен expireAt для расчёта.
  const userRes = await remnaGetUser(sub.remnawaveUuid);
  if (userRes.error || !userRes.data) {
    return res.status(404).json({ message: "Пользователь Remnawave не найден" });
  }
  const inner = (userRes.data as Record<string, unknown>) ?? {};
  const responseObj = (inner.response ?? inner.data ?? inner) as Record<string, unknown>;
  const currentExpireAtRaw = responseObj.expireAt ?? responseObj.expire_at;

  const updatePayload: { uuid: string; expireAt?: string; trafficLimitBytes?: number } = { uuid: sub.remnawaveUuid };

  let newExpireAt: Date | null = null;
  if (parsed.data.addDays != null && parsed.data.addDays !== 0) {
    let baseDate: Date;
    if (typeof currentExpireAtRaw === "string" || typeof currentExpireAtRaw === "number") {
      const d = typeof currentExpireAtRaw === "number" ? new Date(currentExpireAtRaw * 1000) : new Date(currentExpireAtRaw);
      // Если подписка истекла — стартуем от now, иначе стек от текущего expireAt.
      baseDate = !isNaN(d.getTime()) && d.getTime() > Date.now() ? d : new Date();
    } else {
      baseDate = new Date();
    }
    newExpireAt = new Date(baseDate.getTime() + parsed.data.addDays * 24 * 60 * 60 * 1000);
    updatePayload.expireAt = newExpireAt.toISOString();
  }

  if (parsed.data.trafficLimitBytes !== undefined) {
    updatePayload.trafficLimitBytes = parsed.data.trafficLimitBytes ?? 0; // null → 0 (безлимит)
  }

  const updateRes = await remnaUpdateUser(updatePayload);
  if (updateRes.error) {
    return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
  }

  // синкаем expireAt в БД для broadcast-фильтра.
  if (newExpireAt) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { expireAt: newExpireAt },
    }).catch(() => {});
  }

  await prisma.giftHistory.create({
    data: {
      clientId: sub.ownerId,
      subscriptionId: sub.id,
      eventType: "EDITED_BY_ADMIN",
      metadata: {
        addDays: parsed.data.addDays ?? null,
        newExpireAt: newExpireAt?.toISOString() ?? null,
        trafficLimitBytes: parsed.data.trafficLimitBytes !== undefined ? parsed.data.trafficLimitBytes : null,
      },
    },
  });

  return res.json({ success: true, expireAt: newExpireAt?.toISOString() ?? null, trafficLimitBytes: parsed.data.trafficLimitBytes ?? null });
}));

adminRouter.delete("/secondary-subscriptions/:id", asyncRoute(async (req, res) => {
  const sub = await prisma.subscription.findUnique({
    where: { id: req.params.id },
    select: { id: true, remnawaveUuid: true, ownerId: true },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });

  // Delete Remnawave user if exists
  if (sub.remnawaveUuid && isRemnaConfigured()) {
    try {
      await remnaDeleteUser(sub.remnawaveUuid);
    } catch { /* best effort */ }
  }

  // Log event
  await prisma.giftHistory.create({
    data: {
      clientId: sub.ownerId,
      subscriptionId: sub.id,
      eventType: "DELETED",
      metadata: { deletedBy: "admin" },
    },
  });

  // Cascade deletes GiftCodes via DB relation
  await prisma.subscription.delete({ where: { id: sub.id } });

  return res.json({ success: true });
}));

adminRouter.delete("/secondary-subscriptions/bulk", asyncRoute(async (req, res) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "Укажите массив ids" });
  }

  const subs = await prisma.subscription.findMany({
    where: { id: { in: ids } },
    select: { id: true, remnawaveUuid: true, ownerId: true },
  });

  // Delete Remnawave users
  if (isRemnaConfigured()) {
    await Promise.allSettled(
      subs.filter((s) => s.remnawaveUuid).map((s) => remnaDeleteUser(s.remnawaveUuid!))
    );
  }

  // Log events
  await prisma.giftHistory.createMany({
    data: subs.map((s) => ({
      clientId: s.ownerId,
      subscriptionId: s.id,
      eventType: "DELETED",
      metadata: { deletedBy: "admin", bulk: true },
    })),
  });

  await prisma.subscription.deleteMany({ where: { id: { in: ids } } });

  return res.json({ success: true, deleted: subs.length });
}));

// ────── Gift Analytics ──────

adminRouter.get("/gift-analytics", asyncRoute(async (_req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalSubscriptions,
    last30Days,
    activatedSelf,
    gifted,
    pendingCodes,
    expiredCodes,
    redeemedCodes,
    totalCodes,
  ] = await Promise.all([
    prisma.subscription.count(),
    prisma.subscription.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.subscription.count({ where: { OR: [{ giftStatus: null, giftedToClientId: null }, { giftStatus: "", giftedToClientId: null }, { giftStatus: "ACTIVATED_SELF" }] } }),
    prisma.subscription.count({ where: { giftedToClientId: { not: null } } }),
    prisma.giftCode.count({ where: { status: "ACTIVE" } }),
    prisma.giftCode.count({ where: { status: "EXPIRED" } }),
    prisma.giftCode.count({ where: { status: "REDEEMED" } }),
    prisma.giftCode.count(),
  ]);

  const conversionRate = totalCodes > 0
    ? Math.round((redeemedCodes / totalCodes) * 1000) / 10
    : 0;

  return res.json({
    totalSubscriptions,
    last30Days,
    activatedSelf,
    gifted,
    pendingCodes,
    expiredCodes,
    redeemedCodes,
    conversionRate,
  });
}));

// ────── Admin Gift Code Creation ──────

adminRouter.post("/gift-codes/create", asyncRoute(async (req, res) => {
  const schema = z.object({
    clientId: z.string().min(1),
    tariffId: z.string().min(1),
    giftMessage: z.string().max(200).optional(),
    durationDays: z.number().int().min(1).max(3650).optional(),
    trafficGb: z.number().min(0).max(1048576).optional(),
    notify: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Некорректные данные", errors: parsed.error.flatten().fieldErrors });
  }

  const { clientId, tariffId, giftMessage, durationDays, trafficGb, notify = true } = parsed.data;

  // Проверяем что клиент существует
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    return res.status(404).json({ message: "Клиент не найден" });
  }

  // передаём adminId чтобы в админ-списке отображался конкретный менеджер.
  const adminIdForGift = (req as unknown as { adminId?: string }).adminId ?? null;
  // админ-override срока/трафика (GB → bytes; 0 = безлимит).
  const giftOverrides: { durationDays?: number; trafficLimitBytes?: bigint | null } = {};
  if (durationDays != null) giftOverrides.durationDays = durationDays;
  if (trafficGb != null) giftOverrides.trafficLimitBytes = trafficGb > 0 ? BigInt(Math.round(trafficGb * 1024 ** 3)) : BigInt(0);
  const result = await adminCreateGiftCode(clientId, tariffId, giftMessage, adminIdForGift, giftOverrides);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  // giftUrl считаем ВСЕГДА (нужен и в ответе админу, и для авто-уведомления).
  // Авто-сообщение клиенту шлём только если notify (по умолчанию true). Новая выдача «код в руки» → notify=false.
  let giftUrl: string | null = null;
  try {
    const cfg = await getSystemConfig();
    const botToken = (cfg.telegramBotToken || "").trim();
    if (botToken) {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
        .then((r) => r.json() as Promise<{ ok: boolean; result?: { username?: string } }>)
        .catch(() => null);
      const botUsername = meRes?.result?.username ?? "bot";
      giftUrl = `https://t.me/${botUsername}?start=gift_${result.data.code}`;
      if (notify) {
        const fullClient = await prisma.client.findUnique({
          where: { id: clientId },
          select: { telegramId: true, telegramUsername: true },
        });
        if (fullClient?.telegramId) {
          const tariff = await prisma.tariff.findUnique({ where: { id: tariffId }, select: { name: true } });
          const customMessage = giftMessage?.trim() ? `\n\n💬 «${giftMessage.trim()}»` : "";
          const text =
            `🎁 Вам подарили подписку <b>${tariff?.name ?? "VPN"}</b>!\n\n` +
            `Код активации: <code>${result.data.code}</code>${customMessage}\n\n` +
            `${giftUrl}`;
          const shareText = `У меня для тебя подарок 🎁\n \nПодписка на сервис безопасного удалённого доступа 🛡 \n\n💡 Нажми на ссылку, чтобы активировать:\n\n${giftUrl}`;
          const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(giftUrl)}&text=${encodeURIComponent(shareText)}`;
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: fullClient.telegramId,
              text,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "💌 Отправить подарок", url: shareUrl }],
                  [{ text: "🎁 Активировать подарок", url: giftUrl }],
                ],
              },
            }),
          }).catch((e) => console.error("[admin/gift-codes/create] notify client failed:", e));
        }
      }
    }
  } catch (e) {
    console.error("[admin/gift-codes/create] giftUrl/notify error:", e);
  }

  return res.json({ ...result.data, giftUrl });
}));

// ——— Tour Steps (конструктор тура) ———

const tourStepIdSchema = z.object({ id: z.string().min(1) });

const TOUR_PLACEMENTS = ["top", "bottom", "left", "right", "center"] as const;
const TOUR_MOODS = ["wave", "point", "happy", "think"] as const;

const createTourStepSchema = z.object({
  target: z.string().min(1).max(500),
  targetLabel: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(5000),
  videoUrl: z.string().max(1000).nullable().optional(),
  placement: z.enum(TOUR_PLACEMENTS).optional(),
  route: z.string().max(255).nullable().optional(),
  mascotId: z.string().max(100).nullable().optional(),
  mood: z.enum(TOUR_MOODS).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const updateTourStepSchema = z.object({
  target: z.string().min(1).max(500).optional(),
  targetLabel: z.string().min(1).max(255).optional(),
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(5000).optional(),
  videoUrl: z.string().max(1000).nullable().optional(),
  placement: z.enum(TOUR_PLACEMENTS).optional(),
  route: z.string().max(255).nullable().optional(),
  mascotId: z.string().max(100).nullable().optional(),
  mood: z.enum(TOUR_MOODS).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const reorderTourStepsSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    sortOrder: z.number().int(),
  })),
});

function tourStepToJson(s: {
  id: string; target: string; targetLabel: string; title: string; content: string;
  videoUrl: string | null; placement: string; route: string | null; mascotId: string | null; mood: string;
  sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  mascot?: { id: string; name: string; imageUrl: string; isBuiltIn: boolean; emotions?: { id: string; mood: string; imageUrl: string }[] } | null;
}) {
  return {
    id: s.id,
    target: s.target,
    targetLabel: s.targetLabel,
    title: s.title,
    content: s.content,
    videoUrl: s.videoUrl,
    placement: s.placement,
    route: s.route,
    mascotId: s.mascotId,
    mood: s.mood,
    sortOrder: s.sortOrder,
    isActive: s.isActive,
    mascot: s.mascot ? { id: s.mascot.id, name: s.mascot.name, imageUrl: s.mascot.imageUrl, isBuiltIn: s.mascot.isBuiltIn, emotions: (s.mascot.emotions ?? []).map(e => ({ id: e.id, mood: e.mood, imageUrl: e.imageUrl })) } : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

adminRouter.get("/tour-steps", asyncRoute(async (_req, res) => {
  const steps = await prisma.tourStep.findMany({
    include: { mascot: { include: { emotions: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return res.json({ items: steps.map(tourStepToJson) });
}));

adminRouter.post("/tour-steps", asyncRoute(async (req, res) => {
  const body = createTourStepSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });

  const created = await prisma.tourStep.create({
    data: {
      target: body.data.target,
      targetLabel: body.data.targetLabel,
      title: body.data.title,
      content: body.data.content,
      videoUrl: body.data.videoUrl ?? null,
      placement: body.data.placement ?? "bottom",
      route: body.data.route ?? null,
      mascotId: body.data.mascotId ?? null,
      mood: body.data.mood ?? "point",
      sortOrder: body.data.sortOrder ?? 0,
      isActive: body.data.isActive ?? true,
    },
    include: { mascot: { include: { emotions: true } } },
  });
  return res.status(201).json(tourStepToJson(created));
}));

// IMPORTANT: /reorder MUST be before /:id
adminRouter.patch("/tour-steps/reorder", asyncRoute(async (req, res) => {
  const body = reorderTourStepsSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });

  await prisma.$transaction(
    body.data.items.map(item =>
      prisma.tourStep.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })
    )
  );
  return res.json({ success: true });
}));

adminRouter.patch("/tour-steps/:id", asyncRoute(async (req, res) => {
  const idParse = tourStepIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });

  const body = updateTourStepSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });

  const data: Record<string, unknown> = {};
  if (body.data.target !== undefined) data.target = body.data.target;
  if (body.data.targetLabel !== undefined) data.targetLabel = body.data.targetLabel;
  if (body.data.title !== undefined) data.title = body.data.title;
  if (body.data.content !== undefined) data.content = body.data.content;
  if (body.data.videoUrl !== undefined) data.videoUrl = body.data.videoUrl;
  if (body.data.placement !== undefined) data.placement = body.data.placement;
  if (body.data.route !== undefined) data.route = body.data.route;
  if (body.data.mascotId !== undefined) data.mascotId = body.data.mascotId;
  if (body.data.mood !== undefined) data.mood = body.data.mood;
  if (body.data.sortOrder !== undefined) data.sortOrder = body.data.sortOrder;
  if (body.data.isActive !== undefined) data.isActive = body.data.isActive;

  const updated = await prisma.tourStep.update({
    where: { id: idParse.data.id },
    data,
    include: { mascot: { include: { emotions: true } } },
  });
  return res.json(tourStepToJson(updated));
}));

adminRouter.delete("/tour-steps/:id", asyncRoute(async (req, res) => {
  const idParse = tourStepIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });

  await prisma.tourStep.delete({ where: { id: idParse.data.id } });
  return res.json({ success: true });
}));

adminRouter.post("/tour-steps/seed-defaults", asyncRoute(async (_req, res) => {
  // Удаляем все существующие шаги
  await prisma.tourStep.deleteMany();

  // Берём первого встроенного маскота (если есть)
  const builtIn = await prisma.tourMascot.findFirst({ where: { isBuiltIn: true } });

  const defaults = [
    {
      target: "body",
      targetLabel: "Приветствие",
      title: "Добро пожаловать! 👋",
      content: "Привет! Это твой личный кабинет STEALTHNET. Давай я покажу, что тут есть! Тур автоматически переключит вкладки — просто нажимай «Дальше».",
      placement: "center",
      route: null,
      mascotId: builtIn?.id ?? null,
      mood: "wave",
      sortOrder: 0,
    },
    {
      target: '[data-tour="subscription"]',
      targetLabel: "Подписка",
      title: "Твоя подписка 🔑",
      content: "Здесь ты видишь статус своей VPN-подписки, оставшиеся дни и трафик.",
      placement: "bottom",
      route: "/cabinet/dashboard",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 1,
    },
    {
      target: '[data-tour="balance"]',
      targetLabel: "Баланс",
      title: "Твой баланс 💰",
      content: "Тут отображается баланс аккаунта. Пополняй и оплачивай тарифы!",
      placement: "left",
      route: "/cabinet/dashboard",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 2,
    },
    {
      target: '[data-tour="tariffs"]',
      targetLabel: "Тарифы (навигация)",
      title: "Раздел тарифов 📦",
      content: "Нажми сюда, чтобы перейти к тарифам. Сейчас я покажу тебе, что там внутри!",
      placement: "bottom",
      route: "/cabinet/dashboard",
      mascotId: builtIn?.id ?? null,
      mood: "think",
      sortOrder: 3,
    },
    {
      target: '[data-tour="tariff-list"]',
      targetLabel: "Список тарифов",
      title: "Выбирай тариф 📦",
      content: "Здесь все доступные тарифы. Выбирай подходящий по цене и возможностям!",
      placement: "top",
      route: "/cabinet/tariffs",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 4,
    },
    {
      target: '[data-tour="referrals"]',
      targetLabel: "Рефералы (навигация)",
      title: "Реферальная программа 👥",
      content: "Приглашай друзей и получай бонусы! Давай глянем подробнее...",
      placement: "bottom",
      route: "/cabinet/tariffs",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 5,
    },
    {
      target: '[data-tour="referral-link"]',
      targetLabel: "Реферальная ссылка",
      title: "Твоя реферальная ссылка 🔗",
      content: "Скопируй ссылку и отправь друзьям. За каждого приглашённого — бонусы на баланс!",
      placement: "bottom",
      route: "/cabinet/referral",
      mascotId: builtIn?.id ?? null,
      mood: "happy",
      sortOrder: 6,
    },
    {
      target: '[data-tour="referral-stats"]',
      targetLabel: "Статистика рефералов",
      title: "Статистика приглашений 📊",
      content: "Тут видно сколько друзей ты пригласил и сколько бонусов заработал. До 3 уровней глубины!",
      placement: "top",
      route: "/cabinet/referral",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 7,
    },
    {
      target: '[data-tour="profile"]',
      targetLabel: "Профиль (навигация)",
      title: "Твой профиль 👤",
      content: "Здесь можно настроить аккаунт. Давай заглянем!",
      placement: "bottom",
      route: "/cabinet/referral",
      mascotId: builtIn?.id ?? null,
      mood: "think",
      sortOrder: 8,
    },
    {
      target: '[data-tour="profile-settings"]',
      targetLabel: "Данные профиля",
      title: "Данные профиля ✏️",
      content: "Карточка с твоими личными данными — имя, email и другая информация.",
      placement: "bottom",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 9,
    },
    {
      target: '[data-tour="language-currency"]',
      targetLabel: "Язык и валюта",
      title: "Язык и валюта 🌐",
      content: "Выбирай удобный язык интерфейса и валюту для отображения цен.",
      placement: "bottom",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 10,
    },
    {
      target: '[data-tour="password-change"]',
      targetLabel: "Смена пароля",
      title: "Безопасность 🔐",
      content: "Тут можно сменить пароль от аккаунта. Рекомендуем использовать надёжный пароль!",
      placement: "top",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 11,
    },
    {
      target: '[data-tour="floating-chat"]',
      targetLabel: "Сообщения",
      title: "Чат и поддержка 💬",
      content: "Нужна помощь? Нажми на эту кнопку — здесь AI-ассистент и поддержка. Мы обязательно поможем!",
      placement: "left",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "wave",
      sortOrder: 12,
    },
    {
      target: '[data-tour="gifts"]',
      targetLabel: "Подарки",
      title: "Подарки 🎁",
      content: "Здесь ты можешь купить подписку в подарок другу или активировать подарочный код для себя.",
      placement: "right",
      route: "/cabinet/profile",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 13,
    },
    {
      target: '[data-tour="gifts-buy-button"]',
      targetLabel: "Купить подарок",
      title: "Купить подписку 🛒",
      content: "Нажми сюда, чтобы купить дополнительную подписку — для себя или в подарок другу.",
      placement: "bottom",
      route: "/cabinet/gifts",
      mascotId: builtIn?.id ?? null,
      mood: "point",
      sortOrder: 14,
    },
    {
      target: '[data-tour="gifts-redeem"]',
      targetLabel: "Активировать код",
      title: "Активация кода 🎫",
      content: "Получил подарочный код? Введи его здесь — подписка активируется мгновенно!",
      placement: "bottom",
      route: "/cabinet/gifts",
      mascotId: builtIn?.id ?? null,
      mood: "happy",
      sortOrder: 15,
    },
    {
      target: '[data-tour="gifts-subscriptions"]',
      targetLabel: "Мои подписки",
      title: "Мои подписки 📋",
      content: "Тут отображаются все твои дополнительные подписки. Одна активирована для себя, другая подарена — удобно, правда?",
      placement: "top",
      route: "/cabinet/gifts",
      mascotId: builtIn?.id ?? null,
      mood: "happy",
      sortOrder: 16,
    },
    {
      target: '[data-tour="gifts-history"]',
      targetLabel: "История подарков",
      title: "История действий 📜",
      content: "Все действия с подарками — покупки, активации, отправки — записываются здесь.",
      placement: "top",
      route: "/cabinet/gifts",
      mascotId: builtIn?.id ?? null,
      mood: "idle",
      sortOrder: 17,
    },
    {
      target: "body",
      targetLabel: "Завершение",
      title: "Всё готово! 🎉",
      content: "Теперь ты знаешь все разделы кабинета. Удачного использования STEALTHNET! Если забудешь — тур можно перезапустить в профиле.",
      placement: "center",
      route: null,
      mascotId: builtIn?.id ?? null,
      mood: "happy",
      sortOrder: 18,
    },
  ];

  const created = await prisma.$transaction(
    defaults.map(step => prisma.tourStep.create({ data: step }))
  );

  return res.json({ items: created.map(s => tourStepToJson({ ...s, mascot: builtIn && s.mascotId === builtIn.id ? builtIn : null })) });
}));

// ——————————————————————————————————————————————————————————
// Tour Mascots CRUD
// ——————————————————————————————————————————————————————————

adminRouter.get("/tour-mascots", asyncRoute(async (_req, res) => {
  const mascots = await prisma.tourMascot.findMany({
    include: { emotions: true },
    orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }],
  });
  return res.json({ items: mascots.map(m => ({
    id: m.id, name: m.name, imageUrl: m.imageUrl, isBuiltIn: m.isBuiltIn, createdAt: m.createdAt.toISOString(),
    emotions: m.emotions.map(e => ({ id: e.id, mood: e.mood, imageUrl: e.imageUrl })),
  })) });
}));

adminRouter.post("/tour-mascots", uploadMascotImage.single("image"), asyncRoute(async (req, res) => {
  const name = typeof req.body.name === "string" && req.body.name.trim() ? req.body.name.trim() : "Маскот";
  const imageUrl = req.file ? mascotUrl(req.file.filename) : "";

  const mascot = await prisma.tourMascot.create({
    data: {
      name,
      imageUrl,
      isBuiltIn: false,
    },
    include: { emotions: true },
  });

  return res.status(201).json({
    id: mascot.id, name: mascot.name, imageUrl: mascot.imageUrl, isBuiltIn: mascot.isBuiltIn,
    createdAt: mascot.createdAt.toISOString(), emotions: [],
  });
}));

adminRouter.patch("/tour-mascots/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const mascot = await prisma.tourMascot.findUnique({ where: { id } });
  if (!mascot) return res.status(404).json({ message: "Маскот не найден" });

  const name = typeof req.body.name === "string" && req.body.name.trim() ? req.body.name.trim() : undefined;
  const updated = await prisma.tourMascot.update({
    where: { id },
    data: { ...(name ? { name } : {}) },
    include: { emotions: true },
  });

  return res.json({
    id: updated.id, name: updated.name, imageUrl: updated.imageUrl, isBuiltIn: updated.isBuiltIn,
    createdAt: updated.createdAt.toISOString(),
    emotions: updated.emotions.map(e => ({ id: e.id, mood: e.mood, imageUrl: e.imageUrl })),
  });
}));

adminRouter.delete("/tour-mascots/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const mascot = await prisma.tourMascot.findUnique({ where: { id } });
  if (!mascot) return res.status(404).json({ message: "Маскот не найден" });
  if (mascot.isBuiltIn) return res.status(400).json({ message: "Нельзя удалить встроенного маскота" });

  // Убираем mascotId у шагов, использующих этого маскота
  await prisma.tourStep.updateMany({ where: { mascotId: id }, data: { mascotId: null } });
  await prisma.tourMascot.delete({ where: { id } });

  // Удаляем файл
  const filename = mascot.imageUrl.split("/").pop();
  if (filename) removeUploadedFile(`mascots/${filename}`);

  return res.json({ success: true });
}));

// ——————————————————————————————————————————————————————————
// Tour Mascot Emotions CRUD
// ——————————————————————————————————————————————————————————

const validMoods = ["wave", "point", "happy", "think"] as const;

adminRouter.post("/tour-mascots/:id/emotions", uploadMascotImage.single("image"), asyncRoute(async (req, res) => {
  const mascotId = req.params.id;
  const mascot = await prisma.tourMascot.findUnique({ where: { id: mascotId } });
  if (!mascot) return res.status(404).json({ message: "Маскот не найден" });
  if (!req.file) return res.status(400).json({ message: "Изображение не загружено" });

  const mood = typeof req.body.mood === "string" ? req.body.mood.trim() : "";
  if (!validMoods.includes(mood as typeof validMoods[number])) {
    removeUploadedFile(`mascots/${req.file.filename}`);
    return res.status(400).json({ message: `Недопустимая эмоция. Доступные: ${validMoods.join(", ")}` });
  }

  // Если уже есть такая эмоция — заменяем файл
  const existing = await prisma.mascotEmotion.findUnique({ where: { mascotId_mood: { mascotId, mood } } });
  if (existing) {
    const oldFilename = existing.imageUrl.split("/").pop();
    if (oldFilename) removeUploadedFile(`mascots/${oldFilename}`);

    const updated = await prisma.mascotEmotion.update({
      where: { id: existing.id },
      data: { imageUrl: mascotUrl(req.file.filename) },
    });
    return res.json({ id: updated.id, mood: updated.mood, imageUrl: updated.imageUrl });
  }

  const emotion = await prisma.mascotEmotion.create({
    data: {
      mascotId,
      mood,
      imageUrl: mascotUrl(req.file.filename),
    },
  });

  // Если это первая эмоция — установить как дефолтную картинку маскота
  if (!mascot.imageUrl) {
    await prisma.tourMascot.update({ where: { id: mascotId }, data: { imageUrl: mascotUrl(req.file.filename) } });
  }

  return res.status(201).json({ id: emotion.id, mood: emotion.mood, imageUrl: emotion.imageUrl });
}));

adminRouter.delete("/tour-mascots/:id/emotions/:emotionId", asyncRoute(async (req, res) => {
  const { id: mascotId, emotionId } = req.params;
  const emotion = await prisma.mascotEmotion.findFirst({ where: { id: emotionId, mascotId } });
  if (!emotion) return res.status(404).json({ message: "Эмоция не найдена" });

  const filename = emotion.imageUrl.split("/").pop();
  if (filename) removeUploadedFile(`mascots/${filename}`);

  await prisma.mascotEmotion.delete({ where: { id: emotionId } });
  return res.json({ success: true });
}));

// ——————————————————————————————————————————————————————————
// Tour Step — Video Upload
// ——————————————————————————————————————————————————————————

adminRouter.post("/tour-steps/:id/video", uploadVideo.single("video"), asyncRoute(async (req, res) => {
  const id = req.params.id;
  const step = await prisma.tourStep.findUnique({ where: { id } });
  if (!step) return res.status(404).json({ message: "Шаг не найден" });

  if (!req.file) return res.status(400).json({ message: "Видео не загружено" });

  // Удаляем старый файл если это был загруженный файл
  if (step.videoUrl?.startsWith("/api/uploads/videos/")) {
    const oldFilename = step.videoUrl.split("/").pop();
    if (oldFilename) removeUploadedFile(`videos/${oldFilename}`);
  }

  const updated = await prisma.tourStep.update({
    where: { id },
    data: { videoUrl: videoUploadUrl(req.file.filename) },
    include: { mascot: { include: { emotions: true } } },
  });
  return res.json(tourStepToJson(updated));
}));

adminRouter.delete("/tour-steps/:id/video", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const step = await prisma.tourStep.findUnique({ where: { id } });
  if (!step) return res.status(404).json({ message: "Шаг не найден" });

  // Удаляем файл если это был загруженный файл
  if (step.videoUrl?.startsWith("/api/uploads/videos/")) {
    const oldFilename = step.videoUrl.split("/").pop();
    if (oldFilename) removeUploadedFile(`videos/${oldFilename}`);
  }

  const updated = await prisma.tourStep.update({
    where: { id },
    data: { videoUrl: null },
    include: { mascot: { include: { emotions: true } } },
  });
  return res.json(tourStepToJson(updated));
}));

// ─────────────────────────────────────────────────────────────────────────────
// Per-subscription Remna endpoints.
//
// Параллельный набор к `/clients/:id/remna/*` — но работает per-subscription.
// Используется в UI «Подписки клиента» — каждая подписка имеет свой Remna user
// и должна управляться отдельно (limits, squads, disable/enable, reset-traffic).
//
// Helper getSubscriptionRemnaUuid берёт `Subscription.remnawaveUuid` по subId.
// ─────────────────────────────────────────────────────────────────────────────

async function getSubscriptionRemnaUuid(subId: string): Promise<string | null> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: { remnawaveUuid: true },
  });
  return sub?.remnawaveUuid ?? null;
}

const subIdParam = z.object({ subId: z.string().min(1) });

/** Список всех подписок клиента (primary + secondary) — для нового UI «Подписки клиента». */
adminRouter.get("/clients/:id/subscriptions", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  // расширили выборку: включаем не только subs, которыми клиент
  // владеет (ownerId), но и subs, ПОДАРЕННЫЕ ему (giftedToClientId). Раньше второй
  // случай не показывался в инлайн-блоке «Подписки клиента» в карточке клиента.
  const subs = await prisma.subscription.findMany({
    where: {
      OR: [
        { ownerId: parsed.data.id },
        { giftedToClientId: parsed.data.id },
      ],
    },
    orderBy: { subscriptionIndex: "asc" },
    include: {
      tariff: { select: { id: true, name: true } },
    },
  });
  return res.json({
    items: subs.map((s) => ({
      id: s.id,
      subscriptionIndex: s.subscriptionIndex,
      isPrimary: s.subscriptionIndex === 0,
      remnawaveUuid: s.remnawaveUuid,
      tariffId: s.tariffId,
      tariffName: s.tariff?.name ?? null,
      giftStatus: s.giftStatus,
      // добавили в ответ: нужны для UI-бейджей «Подарочная» и
      // «Получена в подарок» в инлайн-блоке карточки клиента (clients.tsx).
      purchasedAsGift: s.purchasedAsGift,
      ownerId: s.ownerId,
      giftedToClientId: s.giftedToClientId,
      autoRenewEnabled: s.autoRenewEnabled,
      expireAt: s.expireAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));

/** GET Remna user данных для подписки (Username, лимиты, трафик, expireAt, сквады). */
adminRouter.get("/subscriptions/:subId/remna", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaGetUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

/** PATCH лимитов / сквадов / телеграма Remna user конкретной подписки. */
adminRouter.patch("/subscriptions/:subId/remna", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const body = remnaUpdateBodySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  // для MANAGER разрешено менять ТОЛЬКО hwidDeviceLimit,
  // и только при наличии action `change_device_limit`. Остальные поля — admin-only.
  const reqExt = req as express.Request & { adminRole?: "ADMIN" | "MANAGER"; adminAllowedSections?: string[] };
  if (reqExt.adminRole !== "ADMIN") {
    const allowedKeys = new Set(["hwidDeviceLimit"]);
    const presentKeys = Object.keys(body.data).filter((k) => (body.data as Record<string, unknown>)[k] !== undefined);
    const onlyAllowed = presentKeys.length > 0 && presentKeys.every((k) => allowedKeys.has(k));
    if (!onlyAllowed) {
      return res.status(403).json({ message: "MANAGER может менять только лимит устройств в этом эндпоинте" });
    }
    if (!(reqExt.adminAllowedSections ?? []).includes("action:change_device_limit")) {
      return res.status(403).json({ message: "Требуется право «change_device_limit»" });
    }
  }
  const getRes = await remnaGetUser(remnaUuid);
  if (getRes.error) return res.status(getRes.status >= 400 ? getRes.status : 500).json({ message: getRes.error });
  const current = getRemnaUserFieldsForMerge(getRes.data);
  const patchBody: Record<string, unknown> = { uuid: remnaUuid };
  if (body.data.activeInternalSquads === undefined && current.activeInternalSquads.length > 0) patchBody.activeInternalSquads = current.activeInternalSquads;
  if (body.data.telegramId === undefined && current.telegramId !== undefined) patchBody.telegramId = current.telegramId;
  if (body.data.email === undefined && current.email !== undefined) patchBody.email = current.email;
  Object.assign(patchBody, body.data);
  // когда админ меняет expireAt и status явно
  // не передан — форсим ACTIVE если новая дата в будущем. Иначе Remna user
  // остаётся в старом status (например EXPIRED после истечения), и бот продолжает
  // рисовать «истекла», хоть expireAt уже в будущем. EXPIRED не форсим — Remna
  // сама переключит когда expireAt в прошлом.
  if (body.data.expireAt && body.data.status === undefined) {
    const newExpire = new Date(body.data.expireAt);
    // EXPIRED не форсим — Remna сама переключит status когда expireAt в прошлом.
    // Форсим только ACTIVE при «продлении» (expireAt в будущем): без этого
    // user, который уже был EXPIRED, остаётся EXPIRED даже после продления.
    if (!Number.isNaN(newExpire.getTime()) && newExpire.getTime() > Date.now()) {
      patchBody.status = "ACTIVE";
    }
  }
  const result = await remnaUpdateUser(patchBody);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  // зеркалим expireAt в БД для этой подписки —
  // чтобы auto-broadcast / бот видели ту же дату что в Remna. Без этого после
  // PATCH через UI «Применить лимиты» расходились БД и Remna (бот мог слать
  // уведомления «истекает через 15 мин» когда в Remna уже истекло, и наоборот).
  if (body.data.expireAt) {
    try {
      await prisma.subscription.update({
        where: { id: parsed.data.subId },
        data: { expireAt: new Date(body.data.expireAt) },
      });
    } catch (e) {
      console.error("[admin/subscriptions/remna] expireAt DB sync failed:", e);
    }
  }
  return res.json(result.data ?? {});
}));

/** Отвязать подписку от Remna (обнулить Subscription.remnawaveUuid). */
adminRouter.post("/subscriptions/:subId/remna/unlink", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const sub = await prisma.subscription.findUnique({
    where: { id: parsed.data.subId },
    select: { id: true, remnawaveUuid: true },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });
  if (!sub.remnawaveUuid) return res.status(400).json({ message: "Подписка уже не привязана к Remna" });
  await prisma.subscription.update({ where: { id: sub.id }, data: { remnawaveUuid: null } });
  return res.json({ ok: true });
}));

adminRouter.post("/subscriptions/:subId/remna/revoke-subscription", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaRevokeUserSubscription(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminRouter.post("/subscriptions/:subId/remna/disable", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaDisableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminRouter.post("/subscriptions/:subId/remna/enable", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaEnableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminRouter.post("/subscriptions/:subId/remna/reset-traffic", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaResetUserTraffic(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminRouter.post("/subscriptions/:subId/remna/squads/add", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const userRes = await remnaGetUser(remnaUuid);
  const userData = userRes.data as Record<string, unknown> | undefined;
  const resp = (userData?.response ?? userData) as Record<string, unknown> | undefined;
  const currentSquads: string[] = [];
  const ais = resp?.activeInternalSquads;
  if (Array.isArray(ais)) {
    for (const s of ais) {
      const u = (s && typeof s === "object" && "uuid" in s) ? (s as Record<string, unknown>).uuid : s;
      if (typeof u === "string") currentSquads.push(u);
    }
  }
  if (!currentSquads.includes(body.data.squadUuid)) currentSquads.push(body.data.squadUuid);
  const result = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminRouter.post("/subscriptions/:subId/remna/squads/remove", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const userRes = await remnaGetUser(remnaUuid);
  if (userRes.error) return res.status(userRes.status >= 400 ? userRes.status : 500).json({ message: userRes.error });
  const current = getRemnaUserFieldsForMerge(userRes.data);
  const currentSquads = current.activeInternalSquads.filter((u) => u !== body.data.squadUuid);
  const result = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminRouter.get("/subscriptions/:subId/remna/devices", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaGetUserHwidDevices(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminRouter.post("/subscriptions/:subId/remna/devices/delete", requireAction("delete_device"), asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const body = z.object({ hwid: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const result = await remnaDeleteUserHwidDevice(remnaUuid, body.data.hwid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { success: true });
}));

adminRouter.get("/subscriptions/:subId/remna/usage", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const result = await remnaGetUserBandwidthStats(remnaUuid, fmt(start), fmt(end));
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

// ─── Referral admin (16.05.2026) ──────────────────────────────────
// Полная картина по рефералке конкретного клиента: его реферер, кого пригласил,
// заработок по уровням L1/L2/L3, последние credit'ы. Plus возможность переназначить
// реферера (для саппорта когда клиент жалуется «не приходит реф. кэшбек»).

/**
 * GET /api/admin/referrals/lookup?q=<query>
 * Поиск клиента по: client.id (cuid), telegramId, telegramUsername, email, referralCode.
 * Возвращает до 10 совпадений — для autocomplete'а.
 */
adminRouter.get("/referrals/lookup", asyncRoute(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ clients: [] });
  const stripped = q.replace(/^@/, "");
  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { id: q },
        { telegramId: stripped },
        { telegramUsername: { equals: stripped, mode: "insensitive" } },
        { telegramUsername: { contains: stripped, mode: "insensitive" } },
        { email: { equals: stripped, mode: "insensitive" } },
        { referralCode: { equals: stripped.toUpperCase() } },
      ],
    },
    select: {
      id: true,
      telegramId: true,
      telegramUsername: true,
      email: true,
      referralCode: true,
      referrerId: true,
      balance: true,
      _count: { select: { referrals: true, referralCredits: true } },
    },
    take: 10,
  });
  return res.json({ clients });
}));

/**
 * GET /api/admin/referrals/:id
 * Полная инфо по рефералке клиента.
 *  - client (basic info)
 *  - referrer (если есть)
 *  - referrals[] (кого он пригласил)
 *  - earnings: { totalAll, byLevel: {1, 2, 3} }
 *  - recentCredits[] (последние 50)
 */
adminRouter.get("/referrals/:id", asyncRoute(async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ message: "Invalid client id" });

  const client = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true,
      telegramId: true,
      telegramUsername: true,
      email: true,
      referralCode: true,
      referralPercent: true,
      referrerId: true,
      balance: true,
      createdAt: true,
    },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });

  const referrer = client.referrerId
    ? await prisma.client.findUnique({
        where: { id: client.referrerId },
        select: {
          id: true, telegramId: true, telegramUsername: true,
          email: true, referralCode: true,
        },
      })
    : null;

  const referrals = await prisma.client.findMany({
    where: { referrerId: id },
    select: {
      id: true,
      telegramId: true,
      telegramUsername: true,
      email: true,
      createdAt: true,
      _count: { select: { referrals: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // earnings aggregate
  const earningsRows = await prisma.referralCredit.groupBy({
    by: ["level"],
    where: { referrerId: id },
    _sum: { amount: true },
    _count: { id: true },
  });
  const byLevel: Record<number, { amount: number; count: number }> = {};
  let totalAll = 0;
  let totalCount = 0;
  for (const r of earningsRows) {
    const lvl = r.level;
    const amt = Number(r._sum.amount ?? 0);
    const cnt = Number(r._count.id ?? 0);
    byLevel[lvl] = { amount: amt, count: cnt };
    totalAll += amt;
    totalCount += cnt;
  }

  const recentCredits = await prisma.referralCredit.findMany({
    where: { referrerId: id },
    select: {
      id: true,
      amount: true,
      level: true,
      createdAt: true,
      paymentId: true,
      payment: {
        select: {
          id: true,
          amount: true,
          status: true,
          clientId: true,
          client: { select: { id: true, telegramId: true, telegramUsername: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return res.json({
    client,
    referrer,
    referrals,
    earnings: { totalAll, totalCount, byLevel },
    recentCredits,
  });
}));

/**
 * PATCH /api/admin/referrals/:id/referrer
 * Body: { referrerId: string | null, lookupBy?: "id"|"tgid"|"username"|"referralCode" }
 * Если lookupBy задан и не "id" — referrerId интерпретируется как соответствующий ключ
 * (например telegramId), и резолвится в Client.id. Защита от self-referral / циклов.
 */
adminRouter.patch("/referrals/:id/referrer", asyncRoute(async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ message: "Invalid client id" });

  const schema = z.object({
    referrerId: z.string().nullable(),
    lookupBy: z.enum(["id", "tgid", "username", "referralCode"]).optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });

  const client = await prisma.client.findUnique({ where: { id }, select: { id: true, referrerId: true } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });

  let resolvedReferrerId: string | null = null;
  if (body.data.referrerId) {
    const raw = body.data.referrerId.trim().replace(/^@/, "");
    const by = body.data.lookupBy ?? "id";
    let found: { id: string } | null = null;
    if (by === "id") {
      found = await prisma.client.findUnique({ where: { id: raw }, select: { id: true } });
    } else if (by === "tgid") {
      found = await prisma.client.findFirst({ where: { telegramId: raw }, select: { id: true } });
    } else if (by === "username") {
      found = await prisma.client.findFirst({
        where: { telegramUsername: { equals: raw, mode: "insensitive" } },
        select: { id: true },
      });
    } else if (by === "referralCode") {
      found = await prisma.client.findFirst({
        where: { referralCode: raw.toUpperCase() },
        select: { id: true },
      });
    }
    if (!found) return res.status(404).json({ message: "Реферер не найден по указанному ключу" });
    if (found.id === id) return res.status(400).json({ message: "Нельзя сделать клиента реферером самого себя" });

    // Защита от циклов: проверяем что новый реферер не является нашим (прямым или транзитивным) рефералом.
    let cursor: string | null = found.id;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === id) {
        return res.status(400).json({ message: "Цикл рефералки запрещён (этот клиент уже является чьим-то рефералом по цепочке)" });
      }
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const parent: { referrerId: string | null } | null = await prisma.client.findUnique({
        where: { id: cursor },
        select: { referrerId: true },
      });
      cursor = parent?.referrerId ?? null;
    }
    resolvedReferrerId = found.id;
  }

  await prisma.client.update({
    where: { id },
    data: { referrerId: resolvedReferrerId },
  });

  return res.json({ ok: true, referrerId: resolvedReferrerId, previousReferrerId: client.referrerId });
}));
