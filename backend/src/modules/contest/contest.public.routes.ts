/**
 * Публичный API конкурсов:
 * - /api/public/contests/active — активный конкурс для бота (анонимный).
 * - /api/client/contests/my — конкурсы, где залогиненный клиент участвует или выиграл.
 *
 * Клиентский эндпоинт намеренно читает Client из `requireClientAuth` (не дёргается
 * напрямую с фронта без токена).
 */

import { Router, Request, Response } from "express";
import { prisma } from "../../db.js";

export const contestPublicRouter = Router();

/** GET /api/public/contests/active — активный конкурс (для бота, без авторизации). */
contestPublicRouter.get("/contests/active", async (_req: Request, res: Response) => {
  const now = new Date();
  const contest = await prisma.contest.findFirst({
    where: {
      startAt: { lte: now },
      endAt: { gte: now },
      status: "active",
    },
    orderBy: { startAt: "desc" },
    select: {
      id: true,
      name: true,
      startAt: true,
      endAt: true,
      dailyMessage: true,
      prize1Type: true,
      prize1Value: true,
      prize2Type: true,
      prize2Value: true,
      prize3Type: true,
      prize3Value: true,
      prizeBalanceCurrency: true,
      conditionsJson: true,
      drawType: true,
    },
  });
  if (!contest) {
    return res.json({ active: false, contest: null });
  }
  return res.json({
    active: true,
    contest: {
      ...contest,
      startAt: contest.startAt.toISOString(),
      endAt: contest.endAt.toISOString(),
    },
  });
});

// ─── Клиентский эндпоинт «мои конкурсы» ────────────────────────────────────

import { getEligibleParticipants, parseConditions } from "./contest.service.js";
import { requireClientAuth } from "../client/client.middleware.js";

export const contestClientRouter = Router();
contestClientRouter.use(requireClientAuth);

/**
 * GET /api/client/contests/my — список конкурсов с прогрессом клиента:
 * - active: где клиент проходит по условиям + текущий ранг по drawType.
 * - drawn: где клиент в победителях.
 */
contestClientRouter.get("/my", async (req: Request, res: Response) => {
  const clientId = (req as Request & { clientId: string }).clientId;
  const now = new Date();

  // Активные конкурсы.
  const activeContests = await prisma.contest.findMany({
    where: {
      status: "active",
      startAt: { lte: now },
      endAt: { gte: now },
    },
    orderBy: { endAt: "asc" },
  });

  const activeWithProgress = await Promise.all(activeContests.map(async (c) => {
    const conditions = parseConditions(c.conditionsJson);
    const participants = await getEligibleParticipants(c.startAt, c.endAt, conditions);
    const me = participants.find((p) => p.clientId === clientId);

    let rank: number | null = null;
    if (me) {
      const sortKey = c.drawType === "by_days_bought"
        ? (p: typeof participants[number]) => p.totalDaysBought
        : c.drawType === "by_payments_count"
          ? (p: typeof participants[number]) => p.paymentsCount
          : c.drawType === "by_referrals_count"
            ? (p: typeof participants[number]) => p.referralsCount ?? 0
            : null;
      if (sortKey) {
        const sorted = [...participants].sort((a, b) => sortKey(b) - sortKey(a));
        rank = sorted.findIndex((p) => p.clientId === clientId) + 1;
      }
    }

    return {
      id: c.id,
      name: c.name,
      startAt: c.startAt.toISOString(),
      endAt: c.endAt.toISOString(),
      drawType: c.drawType,
      participating: !!me,
      myStats: me ? {
        totalDaysBought: me.totalDaysBought,
        paymentsCount: me.paymentsCount,
        referralsCount: me.referralsCount ?? 0,
      } : null,
      myRank: rank,
      totalParticipants: participants.length,
      prizes: [
        { place: 1, type: c.prize1Type, value: c.prize1Value },
        { place: 2, type: c.prize2Type, value: c.prize2Value },
        { place: 3, type: c.prize3Type, value: c.prize3Value },
      ],
      prizeBalanceCurrency: c.prizeBalanceCurrency,
    };
  }));

  // Конкурсы, где клиент уже выиграл.
  const wonRows = await prisma.contestWinner.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    include: {
      contest: { select: { id: true, name: true, endAt: true, prizeBalanceCurrency: true, status: true } },
    },
  });

  const won = wonRows.map((w) => ({
    contestId: w.contest.id,
    contestName: w.contest.name,
    contestEndAt: w.contest.endAt.toISOString(),
    place: w.place,
    prizeType: w.prizeType,
    prizeValue: w.prizeValue,
    prizeBalanceCurrency: w.contest.prizeBalanceCurrency,
    appliedAt: w.appliedAt?.toISOString() ?? null,
  }));

  return res.json({
    active: activeWithProgress,
    won,
  });
});
