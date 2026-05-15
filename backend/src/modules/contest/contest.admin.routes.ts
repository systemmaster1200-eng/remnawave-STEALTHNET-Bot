/**
 * Админские эндпоинты конкурсов: CRUD, проведение розыгрыша, отмена, ручное управление
 * победителями, применение призов, аудит-лог.
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { getEligibleParticipants, runDraw, undoDraw, parseConditions, logContestEvent } from "./contest.service.js";
import { sendContestStartNotification, sendContestDrawResults } from "./contest-daily-reminder.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function actorOf(req: express.Request): string | null {
  return (req as express.Request & { adminEmail?: string }).adminEmail ?? null;
}

const ALLOWED_PRIZE_CURRENCIES = ["RUB", "USD", "EUR", "USDT"] as const;

const createContestSchema = z.object({
  name: z.string().min(1).max(200),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  prize1Type: z.enum(["custom", "balance", "vpn_days"]),
  prize1Value: z.string().max(2000),
  prize2Type: z.enum(["custom", "balance", "vpn_days"]),
  prize2Value: z.string().max(2000),
  prize3Type: z.enum(["custom", "balance", "vpn_days"]),
  prize3Value: z.string().max(2000),
  prizeBalanceCurrency: z.enum(ALLOWED_PRIZE_CURRENCIES).nullable().optional(),
  conditionsJson: z.string().max(2000).nullable().optional(),
  drawType: z.enum(["random", "by_days_bought", "by_payments_count", "by_referrals_count"]),
  dailyMessage: z.string().max(2000).nullable().optional(),
  buttonText: z.string().max(200).nullable().optional(),
  buttonUrl: z.string().max(2000).nullable().optional(),
  reminderEnabled: z.boolean().optional(),
  reminderIntervalHours: z.number().int().min(0).max(24 * 30).optional(),
  reminderDeadlineHoursBefore: z
    .string()
    .max(200)
    .regex(/^(\s*\d+\s*(,\s*\d+\s*)*)?$/, "Формат: '24,1' (часы через запятую)")
    .optional(),
});

const updateContestSchema = createContestSchema.partial();

export const contestAdminRouter = Router();
contestAdminRouter.use(requireAuth);
contestAdminRouter.use(requireAdminSection);

contestAdminRouter.get("/", asyncRoute(async (_req, res) => {
  const list = await prisma.contest.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      winners: {
        include: { client: { select: { id: true, email: true, telegramUsername: true } } },
        orderBy: { place: "asc" },
      },
    },
  });
  return res.json(list);
}));

contestAdminRouter.get("/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const contest = await prisma.contest.findUnique({
    where: { id },
    include: {
      winners: {
        include: { client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } } },
        orderBy: { place: "asc" },
      },
    },
  });
  if (!contest) return res.status(404).json({ message: "Конкурс не найден" });
  return res.json(contest);
}));

contestAdminRouter.post("/", asyncRoute(async (req, res) => {
  const parsed = createContestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Неверные данные", errors: parsed.error.flatten() });
  }
  const data = parsed.data;
  const contest = await prisma.contest.create({
    data: {
      name: data.name,
      startAt: new Date(data.startAt),
      endAt: new Date(data.endAt),
      prize1Type: data.prize1Type,
      prize1Value: data.prize1Value,
      prize2Type: data.prize2Type,
      prize2Value: data.prize2Value,
      prize3Type: data.prize3Type,
      prize3Value: data.prize3Value,
      prizeBalanceCurrency: data.prizeBalanceCurrency ?? null,
      conditionsJson: data.conditionsJson ?? null,
      drawType: data.drawType,
      dailyMessage: data.dailyMessage ?? null,
      buttonText: data.buttonText ?? null,
      buttonUrl: data.buttonUrl ?? null,
      reminderEnabled: data.reminderEnabled ?? true,
      reminderIntervalHours: data.reminderIntervalHours ?? 24,
      reminderDeadlineHoursBefore: data.reminderDeadlineHoursBefore ?? "",
      status: "draft",
    },
  });
  await logContestEvent(contest.id, "created", actorOf(req), { name: contest.name });
  return res.status(201).json(contest);
}));

contestAdminRouter.patch("/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const parsed = updateContestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Неверные данные", errors: parsed.error.flatten() });
  }
  const data = parsed.data;
  const update: Record<string, unknown> = {};
  if (data.name != null) update.name = data.name;
  if (data.startAt != null) update.startAt = new Date(data.startAt);
  if (data.endAt != null) update.endAt = new Date(data.endAt);
  if (data.prize1Type != null) update.prize1Type = data.prize1Type;
  if (data.prize1Value != null) update.prize1Value = data.prize1Value;
  if (data.prize2Type != null) update.prize2Type = data.prize2Type;
  if (data.prize2Value != null) update.prize2Value = data.prize2Value;
  if (data.prize3Type != null) update.prize3Type = data.prize3Type;
  if (data.prize3Value != null) update.prize3Value = data.prize3Value;
  if (data.prizeBalanceCurrency !== undefined) update.prizeBalanceCurrency = data.prizeBalanceCurrency;
  if (data.conditionsJson !== undefined) update.conditionsJson = data.conditionsJson;
  if (data.drawType != null) update.drawType = data.drawType;
  if (data.dailyMessage !== undefined) update.dailyMessage = data.dailyMessage;
  if (data.buttonText !== undefined) update.buttonText = data.buttonText;
  if (data.buttonUrl !== undefined) update.buttonUrl = data.buttonUrl;
  if (data.reminderEnabled !== undefined) update.reminderEnabled = data.reminderEnabled;
  if (data.reminderIntervalHours !== undefined) update.reminderIntervalHours = data.reminderIntervalHours;
  if (data.reminderDeadlineHoursBefore !== undefined) update.reminderDeadlineHoursBefore = data.reminderDeadlineHoursBefore;

  const contest = await prisma.contest.update({
    where: { id },
    data: update as Parameters<typeof prisma.contest.update>[0]["data"],
  });
  await logContestEvent(id, "updated", actorOf(req), { fields: Object.keys(update) });
  return res.json(contest);
}));

contestAdminRouter.patch("/:id/status", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const body = z.object({ status: z.enum(["draft", "active", "ended"]) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Укажите status" });
  const contest = await prisma.contest.findUnique({ where: { id } });
  if (!contest) return res.status(404).json({ message: "Конкурс не найден" });
  const now = new Date();
  let newStatus = body.data.status;
  if (newStatus === "active" && contest.startAt <= now && contest.endAt >= now) {
    // ок
  } else if (newStatus === "active") {
    if (contest.startAt > now) newStatus = "draft";
    else if (contest.endAt < now) newStatus = "ended";
  }
  const updated = await prisma.contest.update({
    where: { id },
    data: { status: newStatus },
  });
  await logContestEvent(id, "status_changed", actorOf(req), { from: contest.status, to: newStatus });
  return res.json(updated);
}));

contestAdminRouter.get("/:id/participants-preview", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const contest = await prisma.contest.findUnique({ where: { id } });
  if (!contest) return res.status(404).json({ message: "Конкурс не найден" });
  const conditions = parseConditions(contest.conditionsJson);
  const participants = await getEligibleParticipants(contest.startAt, contest.endAt, conditions);
  return res.json({
    total: participants.length,
    participants: participants.slice(0, 50).map((p) => ({
      clientId: p.clientId,
      totalDaysBought: p.totalDaysBought,
      paymentsCount: p.paymentsCount,
      ...(p.referralsCount != null && { referralsCount: p.referralsCount }),
    })),
  });
}));

contestAdminRouter.post("/:id/launch", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const result = await sendContestStartNotification(id);
  if (!result.ok) return res.status(400).json({ message: result.error });
  await logContestEvent(id, "launched", actorOf(req), { sent: result.sent, errors: result.errors });
  return res.json({ message: "Конкурс запущен, уведомление отправлено", sent: result.sent, errors: result.errors });
}));

contestAdminRouter.post("/:id/draw", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const result = await runDraw(id, actorOf(req));
  if (!result.ok) return res.status(400).json({ message: result.error });
  sendContestDrawResults(id).catch((e) => console.error("[contest] sendContestDrawResults error:", e));
  return res.json({ message: "Розыгрыш проведён", winners: result.winners });
}));

contestAdminRouter.post("/:id/undo-draw", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const result = await undoDraw(id, actorOf(req));
  if (!result.ok) return res.status(400).json({ message: result.error });
  return res.json({ message: "Розыгрыш отменён, balance-призы возвращены", refunded: result.refunded });
}));

// ─── Управление победителями вручную ───────────────────────────────────────

const winnerAddSchema = z.object({
  clientId: z.string().min(1),
  place: z.number().int().min(1).max(10),
  prizeType: z.enum(["custom", "balance", "vpn_days"]),
  prizeValue: z.string().max(2000),
});

contestAdminRouter.post("/:id/winners", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const parsed = winnerAddSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные данные", errors: parsed.error.flatten() });
  const { clientId, place, prizeType, prizeValue } = parsed.data;

  const contest = await prisma.contest.findUnique({ where: { id } });
  if (!contest) return res.status(404).json({ message: "Конкурс не найден" });
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) return res.status(400).json({ message: "Клиент не найден" });

  // Проверяем что место ещё не занято (UNIQUE constraint поймает это, но лучше явно).
  const existing = await prisma.contestWinner.findFirst({ where: { contestId: id, place } });
  if (existing) return res.status(409).json({ message: `Место ${place} уже занято` });

  const winner = await prisma.contestWinner.create({
    data: { contestId: id, clientId, place, prizeType, prizeValue },
  });
  await logContestEvent(id, "winner_added", actorOf(req), { clientId, place, prizeType });
  return res.status(201).json(winner);
}));

contestAdminRouter.delete("/:id/winners/:winnerId", asyncRoute(async (req, res) => {
  const { id, winnerId } = req.params;
  const winner = await prisma.contestWinner.findUnique({ where: { id: winnerId } });
  if (!winner || winner.contestId !== id) return res.status(404).json({ message: "Победитель не найден" });

  // Если balance уже применён — возвращаем средства.
  let refunded = 0;
  if (winner.prizeType === "balance" && winner.appliedAt) {
    const amount = parseFloat(winner.prizeValue);
    if (Number.isFinite(amount) && amount > 0) {
      await prisma.client.update({
        where: { id: winner.clientId },
        data: { balance: { decrement: amount } },
      }).catch((e) => console.error("[contest] failed to refund on winner delete:", e));
      refunded = amount;
    }
  }

  await prisma.contestWinner.delete({ where: { id: winnerId } });
  await logContestEvent(id, "winner_removed", actorOf(req), {
    clientId: winner.clientId, place: winner.place, prizeType: winner.prizeType, refunded,
  });
  return res.json({ message: "Победитель удалён", refunded });
}));

/**
 * Применение приза: для balance — increment баланса (если ещё не applied);
 * для vpn_days — продление подписки в Remna; для custom — просто помечает appliedAt.
 */
contestAdminRouter.post("/:id/winners/:winnerId/apply", asyncRoute(async (req, res) => {
  const { id, winnerId } = req.params;
  const winner = await prisma.contestWinner.findUnique({
    where: { id: winnerId },
    include: { client: true },
  });
  if (!winner || winner.contestId !== id) return res.status(404).json({ message: "Победитель не найден" });
  if (winner.appliedAt) return res.status(400).json({ message: "Приз уже применён" });

  if (winner.prizeType === "balance") {
    const amount = parseFloat(winner.prizeValue);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Некорректное значение balance-приза" });
    }
    await prisma.client.update({
      where: { id: winner.clientId },
      data: { balance: { increment: amount } },
    });
    await prisma.contestWinner.update({ where: { id: winnerId }, data: { appliedAt: new Date() } });
    await logContestEvent(id, "prize_applied", actorOf(req), { winnerId, kind: "balance", amount });
    return res.json({ message: "Сумма зачислена на баланс" });
  }

  if (winner.prizeType === "vpn_days") {
    const days = parseInt(winner.prizeValue, 10);
    if (!Number.isFinite(days) || days <= 0) {
      return res.status(400).json({ message: "Некорректное значение vpn_days" });
    }
    if (!winner.client.remnawaveUuid) {
      return res.status(400).json({ message: "У клиента нет Remna UUID — нельзя продлить подписку. Сначала клиент должен активировать подписку." });
    }
    // Динамический импорт чтобы не таскать remna во всех путях service.
    const { remnaGetUser, remnaUpdateUser } = await import("../remna/remna.client.js");
    const user = await remnaGetUser(winner.client.remnawaveUuid);
    if (user.error) return res.status(502).json({ message: `Remna: ${user.error}` });
    const userResp = (user.data && typeof user.data === "object"
      ? ((user.data as Record<string, unknown>).response ?? (user.data as Record<string, unknown>).data ?? user.data)
      : null) as Record<string, unknown> | null;
    const currentExpireRaw = userResp?.expireAt;
    const currentExpireAt = currentExpireRaw ? new Date(String(currentExpireRaw)) : null;
    const baseDate = currentExpireAt && currentExpireAt > new Date() ? currentExpireAt : new Date();
    const newExpireAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
    const upd = await remnaUpdateUser({ uuid: winner.client.remnawaveUuid, expireAt: newExpireAt });
    if (upd.error) return res.status(502).json({ message: `Remna update: ${upd.error}` });
    await prisma.contestWinner.update({ where: { id: winnerId }, data: { appliedAt: new Date() } });
    await logContestEvent(id, "prize_applied", actorOf(req), { winnerId, kind: "vpn_days", days, newExpireAt: newExpireAt.toISOString() });
    return res.json({ message: `Подписка продлена на ${days} дн.`, newExpireAt: newExpireAt.toISOString() });
  }

  // custom — только маркируем как обработанное.
  await prisma.contestWinner.update({ where: { id: winnerId }, data: { appliedAt: new Date() } });
  await logContestEvent(id, "prize_applied", actorOf(req), { winnerId, kind: "custom" });
  return res.json({ message: "Приз помечен как выданный (требует ручной выдачи администратором)" });
}));

contestAdminRouter.get("/:id/events", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const events = await prisma.contestEvent.findMany({
    where: { contestId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json(events);
}));

contestAdminRouter.delete("/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  await prisma.contest.delete({ where: { id } });
  return res.status(204).send();
}));
