/**
 * Роуты дополнительных подписок и подарков (v2).
 *
 * Authed endpoints: requireClientAuth (монтируется в app.ts).
 * Клиент ID берётся из req.clientId (проставляется middleware).
 *
 * Public endpoints (no auth): GET /public/gift/:code
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  createAdditionalSubscription,
  activateForSelf,
  deleteSubscription,
  listClientSubscriptions,
  listAllClientSubscriptions,
  createGiftCode,
  redeemGiftCode,
  cancelGiftCode,
  listGiftCodes,
  getSubscriptionUrl,
  getGiftHistory,
  getPublicGiftCodeInfo,
} from "./gift.service.js";
import { paymentSnapshotProduct } from "../bot/bot.service.js";
import { requireClientAuth } from "../client/client.middleware.js";
import { prisma, createPayment } from "../../db.js";
import { randomUUID } from "crypto";

// ─── Public Router (no auth) ─────────────────────────────────────────────────

export const giftPublicRouter = Router();

/**
 * GET /api/gift/public/:code — Публичная информация о подарочном коде.
 * Для страницы /gift/:code — не требует авторизации.
 */
giftPublicRouter.get("/:code", async (req: Request, res: Response) => {
  const { code } = req.params;
  if (!code || code.length < 8 || code.length > 20) {
    return res.status(400).json({ message: "Некорректный код" });
  }

  const result = await getPublicGiftCodeInfo(code);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json(result.data);
});

// ─── Authed Router ───────────────────────────────────────────────────────────

export const giftRouter = Router();

// Все эндпоинты требуют авторизации клиента
giftRouter.use(requireClientAuth);

// ─── Типизация req ───────────────────────────────────────────────────────────

type AuthedReq = Request & { clientId: string };

// ─── Validation Schemas ──────────────────────────────────────────────────────

const buySchema = z.object({
  tariffId: z.string().min(1, "tariffId обязателен"),
  /** Конкретная опция длительности тарифа (необязательно — fallback на минимум). */
  tariffPriceOptionId: z.string().min(1).optional(),
  /** Количество ДОП. устройств которые клиент докупает поверх includedDevices (0..maxExtraDevices). */
  extraDevices: z.number().int().min(0).max(100).optional(),
});

const createCodeSchema = z.object({
  subscriptionId: z.string().min(1, "subscriptionId обязателен"),
  giftMessage: z.string().max(200).optional(),
});

const redeemSchema = z.object({
  code: z.string().min(1, "Код обязателен").max(20),
});

const activateSelfSchema = z.object({
  subscriptionId: z.string().min(1, "subscriptionId обязателен"),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── POST /buy — Покупка дополнительной подписки (оплата балансом) ────────────

giftRouter.post("/buy", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;

  const body = buySchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Некорректные данные", errors: body.error.flatten() });
  }

  // Получаем тариф со всеми полями новой модели устройств.
  const tariff = await prisma.tariff.findUnique({
    where: { id: body.data.tariffId },
    select: {
      id: true,
      name: true,
      price: true,
      currency: true,
      durationDays: true,
      trafficLimitBytes: true,
      deviceLimit: true,
      includedDevices: true,
      pricePerExtraDevice: true,
      maxExtraDevices: true,
      deviceDiscountTiers: true,
      internalSquadUuids: true,
      trafficResetMode: true,
      priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] },
    },
  });

  if (!tariff) {
    return res.status(404).json({ message: "Тариф не найден" });
  }

  // Выбранная опция длительности: явный priceOptionId → найти; иначе минимальная по цене.
  let selectedOption: { id: string; durationDays: number; price: number } | null = null;
  if (body.data.tariffPriceOptionId) {
    const opt = tariff.priceOptions.find((o) => o.id === body.data.tariffPriceOptionId);
    if (!opt) return res.status(400).json({ message: "Опция цены не найдена в этом тарифе" });
    selectedOption = { id: opt.id, durationDays: opt.durationDays, price: opt.price };
  } else if (tariff.priceOptions.length > 0) {
    const sorted = [...tariff.priceOptions].sort((a, b) => a.price - b.price);
    selectedOption = { id: sorted[0].id, durationDays: sorted[0].durationDays, price: sorted[0].price };
  }

  // Применяем формулу: базовая цена опции + extras × pricePerExtra × коэф длительности × (1 − скидка).
  const { applyExtraDevicesPrice, parseDeviceDiscountTiers } = await import("../tariff/tariff-activation.service.js");
  const maxExtras = tariff.maxExtraDevices ?? 0;
  const requestedExtras = Math.min(Math.max(0, body.data.extraDevices ?? 0), maxExtras);
  const unitPrice = selectedOption?.price ?? tariff.price;
  const effectiveDays = selectedOption?.durationDays ?? tariff.durationDays;
  const tiers = parseDeviceDiscountTiers(tariff.deviceDiscountTiers);
  const { extrasTotal } = applyExtraDevicesPrice(tariff.pricePerExtraDevice ?? 0, requestedExtras, tiers, effectiveDays);
  const basePrice = unitPrice + extrasTotal;
  const paySnap = await paymentSnapshotProduct(clientId, basePrice);

  // Реальный пиздец был тут: read balance=100 → check → 5 параллельных /gift/buy
  // прокатили все 5 (баланс уехал на -400, гифтов на 500₽). Старая последовательность
  // findUnique + if balance < x + update — TOCTOU как в учебнике.
  //
  // Атомик debit на SQL-уровне: либо ты единственный кто прошёл (count=1),
  // либо count=0 и нет тебе гифта. Никаких параллельных побед.
  const debit = await prisma.client.updateMany({
    where: { id: clientId, balance: { gte: paySnap.amount } },
    data: { balance: { decrement: paySnap.amount } },
  });
  if (debit.count === 0) {
    return res.status(400).json({ message: "Недостаточно средств на балансе" });
  }

  // Создаём дополнительную подписку с новой моделью устройств.
  // purchasedAsGift=true → подписка попадёт ТОЛЬКО в «🎁 Мои подарки»,
  // не будет дублироваться в «📋 Мои подписки». При activateForSelf флаг сбрасывается.
  const result = await createAdditionalSubscription(clientId, {
    id: tariff.id,
    name: tariff.name,
    price: paySnap.amount,
    durationDays: effectiveDays,
    trafficLimitBytes: tariff.trafficLimitBytes,
    deviceLimit: tariff.deviceLimit,
    includedDevices: tariff.includedDevices,
    internalSquadUuids: tariff.internalSquadUuids,
    trafficResetMode: tariff.trafficResetMode ?? undefined,
  }, { extraDevices: requestedExtras, purchasedAsGift: true });

  if (!result.ok) {
    // Возвращаем баланс при ошибке
    await prisma.client.update({
      where: { id: clientId },
      data: { balance: { increment: paySnap.amount } },
    });
    return res.status(result.status).json({ message: result.error });
  }

  // Создаём запись Payment для истории — с привязкой опции и количеством extras.
  const payment = await createPayment({
    data: {
      clientId,
      orderId: randomUUID(),
      tariffId: tariff.id,
      tariffPriceOptionId: selectedOption?.id ?? null,
      deviceCount: requestedExtras,
      amount: paySnap.amount,
      currency: tariff.currency.toUpperCase(),
      status: "PAID",
      provider: "balance",
      paidAt: new Date(),
      metadata: JSON.stringify({ isAdditionalSubscription: true }),
    },
  });

  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch(() => {});

  return res.json({
    message: "Дополнительная подписка создана",
    ...result.data,
  });
});

// ─── GET /subscriptions — Список подписок клиента (без GIFT_RESERVED) ────────

giftRouter.get("/subscriptions", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;

  const result = await listClientSubscriptions(clientId);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json({ subscriptions: result.data });
});

// ─── GET /subscriptions/all — Все подписки включая GIFT_RESERVED ─────────────

giftRouter.get("/subscriptions/all", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;

  const result = await listAllClientSubscriptions(clientId);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json({ subscriptions: result.data });
});

// ─── POST /activate-self — Активировать подписку на себя (снять GIFT_RESERVED) ─

giftRouter.post("/activate-self", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;

  const body = activateSelfSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Некорректные данные", errors: body.error.flatten() });
  }

  const result = await activateForSelf(clientId, body.data.subscriptionId);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json({ message: "Подписка активирована", ...result.data });
});

// ─── DELETE /subscription/:id — Удалить дополнительную подписку ──────────────

giftRouter.delete("/subscription/:id", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;
  const subscriptionId = req.params.id;

  const result = await deleteSubscription(clientId, subscriptionId);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json({ message: "Подписка удалена" });
});

// ─── POST /create-code — Создать подарочный код ──────────────────────────────

giftRouter.post("/create-code", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;

  const body = createCodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Некорректные данные", errors: body.error.flatten() });
  }

  const result = await createGiftCode(clientId, body.data.subscriptionId, body.data.giftMessage);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json({
    message: "Подарочный код создан",
    code: result.data.code,
    expiresAt: result.data.expiresAt,
    tariffName: result.data.tariffName,
    // T-unify (12.05.2026) — для рендера текста подарка (стандарт без трафика / Unblock с трафиком).
    durationDays: result.data.durationDays,
    trafficLimitBytes: result.data.trafficLimitBytes,
  });
});

// ─── POST /redeem — Активировать подарочный код ──────────────────────────────

giftRouter.post("/redeem", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;

  const body = redeemSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Некорректные данные", errors: body.error.flatten() });
  }

  const result = await redeemGiftCode(clientId, body.data.code);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json({
    message: "Подарок активирован!",
    ...result.data,
  });
});

// ─── DELETE /cancel/:codeOrId — Отменить подарочный код ──────────────────────

giftRouter.delete("/cancel/:codeOrId", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;
  const { codeOrId } = req.params;

  const result = await cancelGiftCode(clientId, codeOrId);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json({ message: "Подарочный код отменён" });
});

// ─── GET /active-code/:subId — Активный код для конкретной подписки ──────────
//
// когда юзер создал код, потом вышел в меню и вернулся
// в «🎁 Мои подарки» — подписка имеет giftStatus=GIFT_RESERVED, но код не виден.
// Эндпоинт возвращает существующий ACTIVE-код этой подписки чтобы бот мог снова
// показать share-UI («Поделиться в Telegram» / «Ссылка на подарок»).
giftRouter.get("/active-code/:subId", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;
  const { subId } = req.params;

  // Проверка ownership: подписка принадлежит запросившему.
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: { ownerId: true, tariff: { select: { name: true } } },
  });
  if (!sub || sub.ownerId !== clientId) {
    return res.status(404).json({ message: "Подписка не найдена" });
  }

  const code = await prisma.giftCode.findFirst({
    where: { subscriptionId: subId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!code) {
    return res.status(404).json({ message: "Активный код не найден" });
  }

  return res.json({
    code: code.code,
    expiresAt: code.expiresAt,
    tariffName: sub.tariff?.name ?? null,
    subscriptionId: subId,
  });
});

// ─── GET /codes — Список подарочных кодов клиента ────────────────────────────

giftRouter.get("/codes", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;

  const result = await listGiftCodes(clientId);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json({ codes: result.data });
});

// ─── GET /history — История подарочных событий (пагинация) ───────────────────

giftRouter.get("/history", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;

  const query = historyQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ message: "Некорректные параметры", errors: query.error.flatten() });
  }

  const result = await getGiftHistory(clientId, query.data.page, query.data.limit);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json(result.data);
});

// ─── GET /subscription-url/:id — URL подписки (Remnawave UUID) ───────────────

giftRouter.get("/subscription-url/:id", async (req: Request, res: Response) => {
  const clientId = (req as AuthedReq).clientId;
  const subscriptionId = req.params.id;

  const result = await getSubscriptionUrl(subscriptionId, clientId);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  return res.json({ uuid: result.data.uuid });
});
