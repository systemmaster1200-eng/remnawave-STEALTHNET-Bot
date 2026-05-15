/**
 * Роуты для управления ботами-клонами.
 *
 * Делятся на три группы:
 *   1) /api/admin/bots/*     — CRUD клонов (root-админ); защищено requireAuth.
 *   2) /api/admin/bots/:id/payouts — учёт выплат владельцам клонов.
 *   3) /api/internal/bots    — отдаёт список активных клонов для бот-процесса.
 *                              Защищено токеном из ENV (INTERNAL_API_KEY) ИЛИ
 *                              совпадением с любым активным Bot.token. Это нужно,
 *                              чтобы бот-процесс мог опросить бэкенд при старте,
 *                              даже не зная заранее ни одного «системного» токена.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection, type ReqAdmin } from "../auth/middleware.js";
import { extractBotTokenFromRequest, type ReqWithBot } from "./bot.middleware.js";
import { getBotEarnings, listActiveBots } from "./bot.service.js";

// ─── Admin CRUD ────────────────────────────────────────────────────────────

export const botAdminRouter = Router();

botAdminRouter.use(requireAuth);
botAdminRouter.use(requireAdminSection);

/** Маскирует токен в ответах: показывает первые 6 символов и последние 4 (для идентификации без утечки). */
function maskToken(token: string): string {
  if (!token || token.length <= 12) return "***";
  return token.slice(0, 6) + "..." + token.slice(-4);
}

function serializeBot(b: {
  id: string;
  token: string;
  username: string | null;
  markupPercent: number;
  ownerTelegramId: string | null;
  ownerName: string | null;
  isActive: boolean;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: b.id,
    token: maskToken(b.token),
    username: b.username,
    markupPercent: b.markupPercent,
    ownerTelegramId: b.ownerTelegramId,
    ownerName: b.ownerName,
    isActive: b.isActive,
    isPrimary: b.isPrimary,
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

const createBotSchema = z.object({
  token: z.string().trim().min(20, "Token looks too short"),
  username: z.string().trim().regex(/^[a-zA-Z0-9_]{5,}$/).optional(),
  markupPercent: z.number().min(0).max(1000).default(0),
  ownerTelegramId: z.string().trim().regex(/^\d+$/).optional(),
  ownerName: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

botAdminRouter.get("/", async (_req, res) => {
  const bots = await prisma.bot.findMany({
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  // Для каждого клона добавим краткий счётчик клиентов и заработок.
  const counts = await prisma.client.groupBy({ by: ["botId"], _count: { _all: true } });
  const countMap = new Map(counts.map((c) => [c.botId, c._count._all]));

  const result = await Promise.all(
    bots.map(async (b) => {
      const earnings = await getBotEarnings(b.id);
      return {
        ...serializeBot(b),
        clientsCount: countMap.get(b.id) ?? 0,
        earnings,
      };
    }),
  );
  res.json({ items: result });
});

botAdminRouter.get("/:id", async (req, res) => {
  const bot = await prisma.bot.findUnique({ where: { id: req.params.id } });
  if (!bot) return res.status(404).json({ message: "Bot not found" });
  const clientsCount = await prisma.client.count({ where: { botId: bot.id } });
  const earnings = await getBotEarnings(bot.id);
  res.json({ ...serializeBot(bot), clientsCount, earnings });
});

botAdminRouter.post("/", async (req, res) => {
  const parsed = createBotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const bot = await prisma.bot.create({
      data: {
        token: data.token,
        username: data.username ?? null,
        markupPercent: data.markupPercent,
        ownerTelegramId: data.ownerTelegramId ?? null,
        ownerName: data.ownerName ?? null,
        notes: data.notes ?? null,
        isActive: true,
        isPrimary: false,
      },
    });
    res.status(201).json(serializeBot(bot));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ message: "Bot with this token already exists" });
    }
    console.error("[bot.create] error:", e);
    res.status(500).json({ message: "Failed to create bot" });
  }
});

const updateBotSchema = z.object({
  token: z.string().trim().min(20).optional(),
  username: z.string().trim().nullable().optional(),
  markupPercent: z.number().min(0).max(1000).optional(),
  ownerTelegramId: z.string().trim().nullable().optional(),
  ownerName: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

botAdminRouter.patch("/:id", async (req, res) => {
  const parsed = updateBotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  try {
    const bot = await prisma.bot.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json(serializeBot(bot));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") return res.status(404).json({ message: "Bot not found" });
      if (e.code === "P2002") return res.status(409).json({ message: "Token already used by another bot" });
    }
    console.error("[bot.update] error:", e);
    res.status(500).json({ message: "Failed to update bot" });
  }
});

botAdminRouter.delete("/:id", async (req, res) => {
  // Удаление primary запрещаем — это сломает legacy-связи.
  const bot = await prisma.bot.findUnique({ where: { id: req.params.id } });
  if (!bot) return res.status(404).json({ message: "Bot not found" });
  if (bot.isPrimary) {
    return res.status(409).json({ message: "Primary bot cannot be deleted. Deactivate it instead." });
  }
  // Если есть клиенты — отказываем (нужен миграционный шаг или каскад вручную).
  const cnt = await prisma.client.count({ where: { botId: bot.id } });
  if (cnt > 0) {
    return res.status(409).json({
      message: `Bot has ${cnt} client(s). Deactivate the bot or migrate clients before deleting.`,
    });
  }
  await prisma.bot.delete({ where: { id: bot.id } });
  res.json({ ok: true });
});

// ─── Payouts ───────────────────────────────────────────────────────────────

const createPayoutSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().trim().min(2).max(8).default("rub"),
  comment: z.string().trim().max(2000).optional(),
  paidAt: z.string().datetime().optional(),
});

botAdminRouter.get("/:id/payouts", async (req, res) => {
  const bot = await prisma.bot.findUnique({ where: { id: req.params.id } });
  if (!bot) return res.status(404).json({ message: "Bot not found" });
  const items = await prisma.botPayout.findMany({
    where: { botId: bot.id },
    orderBy: { paidAt: "desc" },
    take: 200,
  });
  res.json({ items });
});

botAdminRouter.post("/:id/payouts", async (req, res) => {
  const ext = req as unknown as Request & ReqAdmin;
  const parsed = createPayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  const bot = await prisma.bot.findUnique({ where: { id: req.params.id } });
  if (!bot) return res.status(404).json({ message: "Bot not found" });

  const created = await prisma.botPayout.create({
    data: {
      botId: bot.id,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      comment: parsed.data.comment ?? null,
      paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date(),
      createdBy: ext.adminEmail || ext.adminId,
    },
  });
  res.status(201).json(created);
});

botAdminRouter.delete("/:id/payouts/:payoutId", async (req, res) => {
  try {
    await prisma.botPayout.delete({ where: { id: req.params.payoutId } });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return res.status(404).json({ message: "Payout not found" });
    }
    res.status(500).json({ message: "Failed to delete payout" });
  }
});

// ─── /api/internal/bots ────────────────────────────────────────────────────
// Эндпоинт для бот-процесса: отдаёт список активных клонов (id + токен + наценка).
// Защита: запрос должен прийти с X-Telegram-Bot-Token, который соответствует
// **любому** активному Bot.token. То есть бот-процесс уже должен знать хотя бы один
// валидный токен. Это «curl-подобное» подтверждение — не панацея, но защищает
// от случайных GET-запросов из публичной сети.

export const botInternalRouter = Router();

botInternalRouter.get("/bots", async (req: Request, res: Response) => {
  const token = extractBotTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ message: "Unauthorized: missing X-Telegram-Bot-Token" });
  }
  const allowed = await prisma.bot.findFirst({ where: { token, isActive: true } });
  if (!allowed) {
    return res.status(401).json({ message: "Unauthorized: token does not match any active bot" });
  }
  const bots = await listActiveBots();
  res.json({
    items: bots.map((b) => ({
      id: b.id,
      token: b.token,
      username: b.username,
      markupPercent: b.markupPercent,
      isPrimary: b.isPrimary,
    })),
  });
});

/**
 * Бот сообщает свой username после первого getMe — обновляем поле в БД.
 * Запрос требует X-Telegram-Bot-Token — это и есть проверка идентичности.
 */
botInternalRouter.post("/bots/me", async (req: Request, res: Response) => {
  const token = extractBotTokenFromRequest(req);
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  const bot = await prisma.bot.findFirst({ where: { token, isActive: true } });
  if (!bot) return res.status(401).json({ message: "Unauthorized" });

  const usernameSchema = z.object({ username: z.string().trim().regex(/^[a-zA-Z0-9_]{3,}$/).optional() });
  const parsed = usernameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input" });

  const newUsername = parsed.data.username ?? null;
  if (newUsername !== bot.username) {
    await prisma.bot.update({ where: { id: bot.id }, data: { username: newUsername } });
  }
  res.json({ ok: true });
});

export type { ReqWithBot };
