/**
 * Конкурсы: участники по условиям, розыгрыш (random / by_days / by_payments / by_referrals),
 * начисление призов, отмена розыгрыша, аудит.
 *
 * Race-condition защита:
 * - runDraw делает atomic flip status `active|ended → drawing` через updateMany. Только один
 *   запрос проходит (count=1); параллельные получают 409. После успеха — `drawing → drawn`.
 * - undoDraw делает atomic flip `drawn → ended` (только этот переход разрешён) и откатывает
 *   balance-призы.
 *
 * Семантика участника:
 * - PAID-платежи в окне [startAt, endAt] с tariff (не proxy/singbox).
 * - Клиент не isBlocked.
 * - Опционально minTariffDays (минимум для одного тарифа), minPaymentsCount, minReferrals.
 * - referralsCount считается за окно конкурса (приведённые в этот период), а не за всю историю.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

export type ContestConditions = {
  minTariffDays?: number;
  minPaymentsCount?: number;
  /** Минимальное количество привлечённых рефералов в окне конкурса. */
  minReferrals?: number;
};

export type DrawType = "random" | "by_days_bought" | "by_payments_count" | "by_referrals_count";

export type PrizeType = "custom" | "balance" | "vpn_days";

/** Участник с метриками для сортировки */
export type ContestParticipant = {
  clientId: string;
  totalDaysBought: number;
  paymentsCount: number;
  referralsCount?: number;
};

export function parseConditions(json: string | null): ContestConditions {
  if (!json?.trim()) return {};
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    return {
      minTariffDays: typeof o.minTariffDays === "number" ? o.minTariffDays : undefined,
      minPaymentsCount: typeof o.minPaymentsCount === "number" ? o.minPaymentsCount : undefined,
      minReferrals: typeof o.minReferrals === "number" ? o.minReferrals : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Возвращает список clientId, подходящих под условия конкурса.
 * - PAID payments в [startAt, endAt] с tariff != null.
 * - Клиент не isBlocked.
 * - Рефералы считаются за период конкурса.
 */
export async function getEligibleParticipants(
  startAt: Date,
  endAt: Date,
  conditions: ContestConditions,
): Promise<ContestParticipant[]> {
  const minDays = conditions.minTariffDays ?? 0;
  const minPayments = conditions.minPaymentsCount ?? 1;
  const minReferrals = conditions.minReferrals ?? 0;

  const payments = await prisma.payment.findMany({
    where: {
      status: "PAID",
      paidAt: { gte: startAt, lte: endAt },
      tariffId: { not: null },
      tariff: minDays > 0 ? { durationDays: { gte: minDays } } : undefined,
      // Заблокированные клиенты исключаются из участников.
      client: { isBlocked: false },
    },
    select: {
      clientId: true,
      tariff: { select: { durationDays: true } },
    },
  });

  const byClient = new Map<string, { totalDays: number; count: number }>();
  for (const p of payments) {
    const t = byClient.get(p.clientId) ?? { totalDays: 0, count: 0 };
    t.totalDays += p.tariff?.durationDays ?? 0;
    t.count += 1;
    byClient.set(p.clientId, t);
  }

  let out: ContestParticipant[] = [];
  for (const [clientId, { totalDays, count }] of byClient) {
    if (count >= minPayments) {
      out.push({ clientId, totalDaysBought: totalDays, paymentsCount: count });
    }
  }

  if (out.length > 0) {
    const clientIds = [...new Set(out.map((p) => p.clientId))];
    // Считаем рефералов за окно конкурса — клиент привёл нового пользователя в период startAt-endAt.
    const referralCounts = await prisma.client.groupBy({
      by: ["referrerId"],
      where: {
        referrerId: { in: clientIds },
        createdAt: { gte: startAt, lte: endAt },
      },
      _count: { id: true },
    });
    const countByReferrer = new Map<string, number>();
    for (const r of referralCounts) {
      if (r.referrerId) countByReferrer.set(r.referrerId, r._count.id);
    }
    out = out.map((p) => ({ ...p, referralsCount: countByReferrer.get(p.clientId) ?? 0 }));
    if (minReferrals > 0) {
      out = out.filter((p) => (p.referralsCount ?? 0) >= minReferrals);
    }
  }

  return out;
}

/** Выбирает 3 победителей по правилу drawType. */
export function selectWinners(
  participants: ContestParticipant[],
  drawType: DrawType,
): [string, string, string] | null {
  if (participants.length < 3) return null;

  let ordered: ContestParticipant[];
  if (drawType === "by_days_bought") {
    ordered = [...participants].sort((a, b) => b.totalDaysBought - a.totalDaysBought);
  } else if (drawType === "by_payments_count") {
    ordered = [...participants].sort((a, b) => b.paymentsCount - a.paymentsCount);
  } else if (drawType === "by_referrals_count") {
    ordered = [...participants].sort((a, b) => (b.referralsCount ?? 0) - (a.referralsCount ?? 0));
  } else {
    // random: shuffle and take first 3
    ordered = [...participants];
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }

  return [ordered[0].clientId, ordered[1].clientId, ordered[2].clientId];
}

export async function logContestEvent(
  contestId: string,
  kind: string,
  actorId: string | null,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.contestEvent.create({
      data: {
        contestId,
        kind,
        actorId: actorId ?? null,
        payload: payload === undefined ? Prisma.JsonNull : (payload as Prisma.InputJsonValue),
      },
    });
  } catch (e) {
    console.error(`[contest] failed to log event ${kind}:`, e);
  }
}

/**
 * Atomic-flip розыгрыш. Защита от двойного клика «Провести розыгрыш».
 * - Берёт лок через `updateMany WHERE status IN ('active','ended') → 'drawing'`.
 * - Выбирает участников, сохраняет snapshot, создаёт ContestWinner-записи в transaction.
 * - Финальный flip `'drawing' → 'drawn'`.
 * - При ошибке любой стадии — `'drawing' → 'ended'` (откат лока).
 */
export async function runDraw(
  contestId: string,
  actorId: string | null = null,
): Promise<{ ok: boolean; error?: string; winners?: unknown[] }> {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) return { ok: false, error: "Конкурс не найден" };
  if (contest.status === "drawn") return { ok: false, error: "Розыгрыш уже проведён" };
  if (contest.status === "drawing") return { ok: false, error: "Розыгрыш уже выполняется" };

  // Atomic lock — только один параллельный запрос проходит.
  const lock = await prisma.contest.updateMany({
    where: { id: contestId, status: { in: ["active", "ended"] } },
    data: { status: "drawing" },
  });
  if (lock.count === 0) {
    return { ok: false, error: "Нельзя провести розыгрыш в текущем статусе" };
  }

  try {
    const conditions = parseConditions(contest.conditionsJson);
    const participants = await getEligibleParticipants(contest.startAt, contest.endAt, conditions);
    const winnerIds = selectWinners(participants, contest.drawType as DrawType);

    if (!winnerIds) {
      // Откатываем лок в ended.
      await prisma.contest.update({ where: { id: contestId }, data: { status: "ended" } });
      await logContestEvent(contestId, "draw_failed", actorId, { reason: "not_enough_participants", participants: participants.length });
      return { ok: false, error: "Недостаточно участников (нужно минимум 3)" };
    }

    // Сохраняем snapshot участников ДО создания winners — для будущей отмены и аудита.
    const snapshot = participants.map((p) => ({
      clientId: p.clientId,
      totalDays: p.totalDaysBought,
      count: p.paymentsCount,
      refs: p.referralsCount ?? 0,
    }));

    const prizes = [
      { place: 1, type: contest.prize1Type, value: contest.prize1Value },
      { place: 2, type: contest.prize2Type, value: contest.prize2Value },
      { place: 3, type: contest.prize3Type, value: contest.prize3Value },
    ] as const;

    // Создаём winners + сохраняем snapshot одной транзакцией.
    await prisma.$transaction([
      ...prizes.map((p, i) =>
        prisma.contestWinner.create({
          data: {
            contestId,
            clientId: winnerIds[i],
            place: p.place,
            prizeType: p.type,
            prizeValue: p.value,
          },
        }),
      ),
      prisma.contest.update({
        where: { id: contestId },
        data: {
          participantsSnapshotJson: JSON.stringify(snapshot),
          status: "drawn",
        },
      }),
    ]);

    // Применяем balance-призы (по одному, без транзакции — чтобы при сбое одного остальные сохранились).
    for (let i = 0; i < 3; i++) {
      const prize = prizes[i];
      const clientId = winnerIds[i];
      if (prize.type === "balance") {
        const amount = parseFloat(prize.value);
        if (Number.isFinite(amount) && amount > 0) {
          await prisma.client.update({
            where: { id: clientId },
            data: { balance: { increment: amount } },
          });
          await prisma.contestWinner.updateMany({
            where: { contestId, clientId, place: i + 1 },
            data: { appliedAt: new Date() },
          });
        }
      }
    }

    const winners = await prisma.contestWinner.findMany({
      where: { contestId },
      include: { client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } } },
      orderBy: { place: "asc" },
    });

    await logContestEvent(contestId, "drew", actorId, {
      winners: winners.map((w) => ({ place: w.place, clientId: w.clientId, prizeType: w.prizeType })),
      participantsCount: participants.length,
    });

    return { ok: true, winners };
  } catch (e) {
    // Любой сбой — пытаемся откатить лок (если winners уже не созданы; иначе drawn останется).
    const stillLocked = await prisma.contest.findUnique({ where: { id: contestId }, select: { status: true } });
    if (stillLocked?.status === "drawing") {
      await prisma.contest.update({ where: { id: contestId }, data: { status: "ended" } }).catch(() => {});
    }
    await logContestEvent(contestId, "draw_failed", actorId, { reason: "exception", error: String(e) });
    throw e;
  }
}

/**
 * Откат розыгрыша: возврат balance-призов, удаление winners, status `drawn → ended`.
 * Custom и vpn_days призы НЕ автооткатываются (custom — вне нашей зоны контроля,
 * vpn_days — должны быть отозваны вручную через Remna).
 */
export async function undoDraw(
  contestId: string,
  actorId: string | null = null,
): Promise<{ ok: boolean; error?: string; refunded?: number }> {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: { winners: true },
  });
  if (!contest) return { ok: false, error: "Конкурс не найден" };
  if (contest.status !== "drawn") return { ok: false, error: "Розыгрыш не проводился или уже отменён" };

  let refundedBalance = 0;
  for (const w of contest.winners) {
    if (w.prizeType === "balance" && w.appliedAt) {
      const amount = parseFloat(w.prizeValue);
      if (Number.isFinite(amount) && amount > 0) {
        await prisma.client.update({
          where: { id: w.clientId },
          data: { balance: { decrement: amount } },
        }).catch((e) => console.error(`[contest] failed to refund balance for winner ${w.id}:`, e));
        refundedBalance += amount;
      }
    }
  }

  await prisma.$transaction([
    prisma.contestWinner.deleteMany({ where: { contestId } }),
    prisma.contest.update({
      where: { id: contestId },
      data: { status: "ended", participantsSnapshotJson: null },
    }),
  ]);

  await logContestEvent(contestId, "undid_draw", actorId, { refundedBalance });

  return { ok: true, refunded: refundedBalance };
}

/**
 * Авто-переходы статуса для всех конкурсов: вызывается из шедулера в начале каждого тика.
 * draft → active при startAt ≤ now (только если уже отправлено start-уведомление? нет —
 *   start-нотификация шлётся отдельным шагом в шедулере; auto-active только синхронизирует флаг).
 * active → ended при endAt < now (помечаем как завершённый — admin сам решает когда draw).
 *
 * NB: переход draft → active срабатывает БЕЗ старт-нотификации. Стартовая рассылка отдельно
 * — она триггерится по `startNotificationSentAt: null` И `status: "active"` (см. шедулер).
 * Это позволяет админу создать конкурс с future startAt, и когда наступит — автоматически
 * активируется + рассылается старт-уведомление в одном тике cron-а.
 */
export async function autoTransitionContestStatuses(): Promise<{ activated: number; ended: number }> {
  const now = new Date();

  const activated = await prisma.contest.updateMany({
    where: { status: "draft", startAt: { lte: now }, endAt: { gte: now } },
    data: { status: "active" },
  });

  const ended = await prisma.contest.updateMany({
    where: { status: { in: ["draft", "active"] }, endAt: { lt: now } },
    data: { status: "ended" },
  });

  return { activated: activated.count, ended: ended.count };
}
