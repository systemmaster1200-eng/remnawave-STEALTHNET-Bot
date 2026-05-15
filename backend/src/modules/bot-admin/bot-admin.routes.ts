/**
 * API для админ-панели в Telegram-боте.
 * Авторизация: X-Telegram-Bot-Token (токен ЛЮБОГО активного клона) + telegramId (ID админа в Telegram).
 * Доступ только для telegramId из настройки bot_admin_telegram_ids.
 *
 * После миграции на боты-клоны: токен сверяется с таблицей bots (любой активный клон),
 * а не только с system_settings.telegram_bot_token. Список админов остаётся общим
 * (bot_admin_telegram_ids) — то есть админ-панель в боте видит всех клиентов всех клонов
 * (это feature, а не bug: владелец платформы должен видеть всё).
 */

import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { getBotByToken } from "../bot/bot.service.js";
import { markPaymentPaid } from "../payment/mark-paid.service.js";
import { getBroadcastRecipientsCount, runBroadcast } from "../broadcast/broadcast.service.js";
import {
  remnaGetUser,
  remnaGetInternalSquads,
  remnaUpdateUser,
  remnaRevokeUserSubscription,
  remnaDisableUser,
  remnaEnableUser,
  remnaResetUserTraffic,
} from "../remna/remna.client.js";

async function getClientRemnaUuid(clientId: string): Promise<string | null> {
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    select: { remnawaveUuid: true },
  });
  return c?.remnawaveUuid ?? null;
}

/** Извлечь activeInternalSquads (uuid[]) из ответа Remna getUser */
function getRemnaUserSquads(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  const resp = (o.response ?? o) as Record<string, unknown> | undefined;
  const ais = resp?.activeInternalSquads;
  const squads: string[] = [];
  if (Array.isArray(ais)) {
    for (const s of ais) {
      const u = s && typeof s === "object" && "uuid" in s ? (s as { uuid: string }).uuid : s;
      if (typeof u === "string") squads.push(u);
    }
  }
  return squads;
}

const PAID_EXTERNAL_WHERE = { status: "PAID" as const, provider: { not: "balance" } };

const botAdminRouter = Router();

function getBotToken(req: Request): string {
  const h = req.headers["x-telegram-bot-token"];
  return typeof h === "string" ? h.trim() : "";
}

function getTelegramId(req: Request): number | null {
  const q = req.query.telegramId;
  if (typeof q === "string" && /^\d+$/.test(q)) return parseInt(q, 10);
  const b = req.body as { telegramId?: number };
  if (typeof b?.telegramId === "number") return b.telegramId;
  return null;
}

async function requireBotAdmin(req: Request, res: Response): Promise<{ telegramId: number; botId: string } | null> {
  const token = getBotToken(req);
  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  // После миграции: принимаем токен ЛЮБОГО активного клона, а не только primary.
  const bot = await getBotByToken(token);
  if (!bot) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  const telegramId = getTelegramId(req);
  if (telegramId == null) {
    res.status(400).json({ message: "telegramId required (query or body)" });
    return null;
  }
  const config = await getSystemConfig();
  const ids = config.botAdminTelegramIds ?? [];
  if (!ids.includes(String(telegramId))) {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }
  return { telegramId, botId: bot.id };
}

const notificationSettingsSchema = z.object({
  notifyBalanceTopup: z.boolean().optional(),
  notifyTariffPayment: z.boolean().optional(),
  notifyNewClient: z.boolean().optional(),
  notifyNewTicket: z.boolean().optional(),
});

botAdminRouter.get("/notification-settings", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const telegramId = String(admin.telegramId);
  const prefs = await prisma.adminNotificationPreference.findUnique({
    where: { telegramId },
  });
  const payload = {
    notifyBalanceTopup: prefs?.notifyBalanceTopup ?? true,
    notifyTariffPayment: prefs?.notifyTariffPayment ?? true,
    notifyNewClient: prefs?.notifyNewClient ?? true,
    notifyNewTicket: prefs?.notifyNewTicket ?? true,
  };
  return res.json(payload);
});

botAdminRouter.patch("/notification-settings", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = notificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  const telegramId = String(admin.telegramId);
  const data = parsed.data;
  const existing = await prisma.adminNotificationPreference.findUnique({ where: { telegramId } });
  if (!existing) {
    const created = await prisma.adminNotificationPreference.create({
      data: {
        telegramId,
        notifyBalanceTopup: data.notifyBalanceTopup ?? true,
        notifyTariffPayment: data.notifyTariffPayment ?? true,
        notifyNewClient: data.notifyNewClient ?? true,
        notifyNewTicket: data.notifyNewTicket ?? true,
      },
    });
    return res.json({
      notifyBalanceTopup: created.notifyBalanceTopup,
      notifyTariffPayment: created.notifyTariffPayment,
      notifyNewClient: created.notifyNewClient,
      notifyNewTicket: created.notifyNewTicket,
    });
  }
  const update: Record<string, unknown> = {};
  if (data.notifyBalanceTopup !== undefined) update.notifyBalanceTopup = data.notifyBalanceTopup;
  if (data.notifyTariffPayment !== undefined) update.notifyTariffPayment = data.notifyTariffPayment;
  if (data.notifyNewClient !== undefined) update.notifyNewClient = data.notifyNewClient;
  if (data.notifyNewTicket !== undefined) update.notifyNewTicket = data.notifyNewTicket;
  const updated = await prisma.adminNotificationPreference.update({
    where: { telegramId },
    data: update,
  });
  return res.json({
    notifyBalanceTopup: updated.notifyBalanceTopup,
    notifyTariffPayment: updated.notifyTariffPayment,
    notifyNewClient: updated.notifyNewClient,
    notifyNewTicket: updated.notifyNewTicket,
  });
});

/** GET /api/bot-admin/stats — статистика дашборда */
botAdminRouter.get("/stats", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [clientsTotal, clientsWithRemna, paidAgg, paidLast7, paidLast30, newClientsLast7, newClientsLast30] =
    await Promise.all([
      prisma.client.count(),
      prisma.client.count({ where: { remnawaveUuid: { not: null } } }),
      prisma.payment.aggregate({ where: PAID_EXTERNAL_WHERE, _sum: { amount: true }, _count: true }),
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
      prisma.client.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.client.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    ]);
  return res.json({
    users: {
      total: clientsTotal,
      withRemna: clientsWithRemna,
      newLast7Days: newClientsLast7,
      newLast30Days: newClientsLast30,
    },
    sales: {
      totalAmount: paidAgg._sum.amount ?? 0,
      totalCount: paidAgg._count,
      last7DaysAmount: paidLast7._sum.amount ?? 0,
      last7DaysCount: paidLast7._count,
      last30DaysAmount: paidLast30._sum.amount ?? 0,
      last30DaysCount: paidLast30._count,
    },
  });
});

/** GET /api/bot-admin/clients — список клиентов (пагинация, поиск) */
botAdminRouter.get("/clients", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(20, Math.max(5, Number(req.query.limit) || 10));
  const skip = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const isBlockedParam = req.query.isBlocked;

  const where: Prisma.ClientWhereInput = {};
  const conditions: Prisma.ClientWhereInput[] = [];
  if (search.length > 0) {
    conditions.push({
      OR: [
        { email: { contains: search, mode: "insensitive" } },
        { telegramUsername: { contains: search, mode: "insensitive" } },
        { telegramId: { contains: search } },
        { referralCode: { contains: search, mode: "insensitive" } },
        { id: { contains: search } },
      ],
    });
  }
  if (isBlockedParam === "true") conditions.push({ isBlocked: true });
  else if (isBlockedParam === "false") conditions.push({ isBlocked: false });
  if (conditions.length > 0) where.AND = conditions;
  const whereClause = conditions.length > 0 ? where : undefined;

  const [items, total] = await Promise.all([
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
        balance: true,
        isBlocked: true,
        createdAt: true,
      },
    }),
    prisma.client.count({ where: whereClause }),
  ]);
  return res.json({ items, total, page, limit });
});

const clientIdParam = z.object({ id: z.string().cuid() });

/** GET /api/bot-admin/clients/:id — один клиент */
botAdminRouter.get("/clients/:id", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
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
      createdAt: true,
      _count: { select: { referrals: true } },
    },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  return res.json(client);
});

const blockSchema = z.object({ isBlocked: z.boolean(), blockReason: z.string().max(500).optional() });

/** PATCH /api/bot-admin/clients/:id/block — заблокировать/разблокировать */
botAdminRouter.patch("/clients/:id/block", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = clientIdParam.safeParse(req.params);
  const body = blockSchema.safeParse(req.body);
  if (!parsed.success || !body.success) {
    return res.status(400).json({ message: "Invalid input" });
  }
  const client = await prisma.client.findUnique({ where: { id: parsed.data.id } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  await prisma.client.update({
    where: { id: parsed.data.id },
    data: {
      isBlocked: body.data.isBlocked,
      blockReason: body.data.isBlocked ? (body.data.blockReason ?? null) : null,
    },
  });
  return res.json({ ok: true, isBlocked: body.data.isBlocked });
});

const balanceSchema = z.object({ amount: z.number() });

/** PATCH /api/bot-admin/clients/:id/balance — пополнить баланс клиента (amount прибавляется) */
botAdminRouter.patch("/clients/:id/balance", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = clientIdParam.safeParse(req.params);
  const body = balanceSchema.safeParse(req.body);
  if (!parsed.success || !body.success) return res.status(400).json({ message: "Invalid input" });
  const client = await prisma.client.findUnique({ where: { id: parsed.data.id } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  const updated = await prisma.client.update({
    where: { id: parsed.data.id },
    data: { balance: { increment: body.data.amount } },
    select: { id: true, balance: true },
  });
  return res.json({ ok: true, newBalance: updated.balance });
});

/** POST /api/bot-admin/clients/:id/remna/revoke-subscription */
botAdminRouter.post("/clients/:id/remna/revoke-subscription", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaRevokeUserSubscription(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

/** POST /api/bot-admin/clients/:id/remna/disable */
botAdminRouter.post("/clients/:id/remna/disable", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaDisableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

/** POST /api/bot-admin/clients/:id/remna/enable */
botAdminRouter.post("/clients/:id/remna/enable", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaEnableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

/** POST /api/bot-admin/clients/:id/remna/reset-traffic */
botAdminRouter.post("/clients/:id/remna/reset-traffic", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaResetUserTraffic(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

/** GET /api/bot-admin/remna/squads/internal — список внутренних сквадов Remna */
botAdminRouter.get("/remna/squads/internal", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const result = await remnaGetInternalSquads();
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  const raw = result.data as Record<string, unknown> | undefined;
  const resp = raw?.response ?? raw;
  const list = Array.isArray(resp)
    ? resp
    : (resp && typeof resp === "object" && "internalSquads" in resp)
      ? (resp as { internalSquads: { uuid?: string; name?: string }[] }).internalSquads ?? []
      : [];
  const items = (Array.isArray(list) ? list : []).map((s: { uuid?: string; name?: string }) => ({
    uuid: typeof s?.uuid === "string" ? s.uuid : "",
    name: typeof s?.name === "string" ? s.name : s?.uuid ?? "",
  })).filter((s) => s.uuid);
  return res.json({ items });
});

/** GET /api/bot-admin/clients/:id/remna — данные пользователя в Remna (сквады и т.д.) */
botAdminRouter.get("/clients/:id/remna", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaGetUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  const activeInternalSquads = getRemnaUserSquads(result.data);
  return res.json({ remnaUuid, activeInternalSquads });
});

const squadActionSchema = z.object({ squadUuid: z.string().uuid() });

/** POST /api/bot-admin/clients/:id/remna/squads/add */
botAdminRouter.post("/clients/:id/remna/squads/add", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const userRes = await remnaGetUser(remnaUuid);
  if (userRes.error) return res.status(userRes.status >= 400 ? userRes.status : 500).json({ message: userRes.error });
  const currentSquads = getRemnaUserSquads(userRes.data);
  if (!currentSquads.includes(body.data.squadUuid)) currentSquads.push(body.data.squadUuid);
  const updateRes = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (updateRes.error) return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
  return res.json({ ok: true, activeInternalSquads: currentSquads });
});

/** POST /api/bot-admin/clients/:id/remna/squads/remove */
botAdminRouter.post("/clients/:id/remna/squads/remove", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const userRes = await remnaGetUser(remnaUuid);
  if (userRes.error) return res.status(userRes.status >= 400 ? userRes.status : 500).json({ message: userRes.error });
  const currentSquads = getRemnaUserSquads(userRes.data).filter((u) => u !== body.data.squadUuid);
  const updateRes = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (updateRes.error) return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
  return res.json({ ok: true, activeInternalSquads: currentSquads });
});

// ——— Платежи ———

/** GET /api/bot-admin/payments — список платежей (status=PENDING|PAID, page, limit) */
botAdminRouter.get("/payments", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const status = (req.query.status as string) === "PAID" ? "PAID" : "PENDING";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(20, Math.max(5, Number(req.query.limit) || 10));
  const skip = (page - 1) * limit;
  const where: Prisma.PaymentWhereInput = { status };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: status === "PENDING" ? { createdAt: "desc" } : { paidAt: "desc" },
      skip,
      take: limit,
      include: {
        client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } },
        tariff: { select: { name: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);
  const list = items.map((p) => ({
    id: p.id,
    amount: p.amount,
    currency: p.currency,
    provider: p.provider ?? "—",
    status: p.status,
    tariffName: p.tariff?.name ?? null,
    clientEmail: p.client?.email ?? null,
    clientTelegramId: p.client?.telegramId ?? null,
    clientTelegramUsername: p.client?.telegramUsername ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  }));
  return res.json({ items: list, total, page, limit });
});

const paymentIdParam = z.object({ id: z.string().min(1) });

/** PATCH /api/bot-admin/payments/:id/mark-paid */
botAdminRouter.patch("/payments/:id/mark-paid", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const parsed = paymentIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payment id" });
  const result = await markPaymentPaid(parsed.data.id);
  if (!result.ok) return res.status(404).json({ message: result.error ?? "Payment not found" });
  return res.json({
    payment: result.payment,
    referral: result.referral,
    activation: result.activation,
    proxySlots: result.proxySlots,
    balanceCredited: result.balanceCredited,
  });
});

// ——— Рассылка ———

/** GET /api/bot-admin/broadcast/count */
botAdminRouter.get("/broadcast/count", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const counts = await getBroadcastRecipientsCount();
  return res.json(counts);
});

const broadcastBodySchema = z.object({
  message: z.string().max(4096),
  channel: z.enum(["telegram", "email", "both"]),
  photoFileId: z.string().min(1).optional(),
  buttonText: z.string().max(256).optional(),
  buttonUrl: z.string().max(2048).optional(),
});

/** Скачать файл из Telegram по file_id. */
async function downloadTelegramFile(botToken: string, fileId: string): Promise<{ buffer: Buffer; mimeType: string; originalname: string } | null> {
  const getUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const getRes = await fetch(getUrl);
  const getData = (await getRes.json().catch(() => ({}))) as { ok?: boolean; result?: { file_path?: string } };
  if (!getRes.ok || !getData.ok || !getData.result?.file_path) return null;
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${getData.result.file_path}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) return null;
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const mimeType = fileRes.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const ext = mimeType === "image/png" ? "png" : "jpg";
  return { buffer, mimeType, originalname: `photo.${ext}` };
}

/** POST /api/bot-admin/broadcast — запустить рассылку (текст и/или фото по photoFileId) */
botAdminRouter.post("/broadcast", async (req, res) => {
  const admin = await requireBotAdmin(req, res);
  if (!admin) return;
  const body = broadcastBodySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const { message, channel, photoFileId, buttonText, buttonUrl } = body.data;
  if (!message.trim() && !photoFileId) {
    return res.status(400).json({ message: "Укажите текст сообщения или приложите фото." });
  }
  let attachment: { buffer: Buffer; mimetype: string; originalname: string } | undefined;
  if (photoFileId) {
    const config = await getSystemConfig();
    const botToken = (config.telegramBotToken ?? "").trim();
    if (!botToken) {
      return res.status(500).json({ message: "Токен бота не настроен." });
    }
    const file = await downloadTelegramFile(botToken, photoFileId);
    if (!file) {
      return res.status(400).json({ message: "Не удалось скачать фото из Telegram." });
    }
    // Всегда как картинка в сообщении (sendPhoto), а не как документ
    const mimetype = file.mimeType.startsWith("image/") ? file.mimeType : "image/jpeg";
    attachment = { buffer: file.buffer, mimetype, originalname: file.originalname };
  }
  const result = await runBroadcast({
    channel,
    subject: "",
    message: message.trim(),
    attachment,
    buttonText,
    buttonUrl,
  });
  return res.json(result);
});

export { botAdminRouter };
