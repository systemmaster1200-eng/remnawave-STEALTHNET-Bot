/**
 * Бизнес-аналитика для оператора:
 *   - KPI: MRR / ARPU / LTV / Churn
 *   - Когортный retention (по неделям регистрации)
 *   - Воронка: register → trial → first paid → second paid → auto-renew on
 *   - Сравнение платёжных провайдеров
 *
 * Все запросы за последние N дней (по умолчанию 30, max 365). Параметр `days`.
 *
 * Финансовые метрики выдаются с группировкой по валюте — в STEALTHNET один и
 * тот же тариф можно купить за RUB/USD/EUR, и складывать в одно число
 * нельзя без курса. Если в БД был только один currency — будет ровно одна
 * запись.
 *
 * GET /api/admin/business-analytics?days=30
 */

import express, { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const businessAnalyticsRouter = Router();
businessAnalyticsRouter.use(requireAuth);
businessAnalyticsRouter.use(requireAdminSection);

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

interface KpiByCurrency {
  currency: string;
  mrr: number;          // выручка за последние N дней (по subscription-платежам)
  totalRevenue: number; // выручка по всем PAID за окно (в т.ч. balance top-ups)
  arpu: number;         // средний чек одного активного клиента за окно
  ltv: number;          // средний lifetime-revenue одного клиента (за всё время)
  paidCount: number;    // кол-во PAID платежей за окно
  payingClients: number;// уникальных платящих клиентов за окно
}

interface ChurnStat {
  prevPeriodPayingClients: number; // платили в окне [N..2N) дней назад
  retainedClients: number;         // из них продолжили в окне [0..N) дней назад
  churnedClients: number;          // не продолжили
  churnRate: number;               // 0..1
}

interface CohortRow {
  weekStart: string;                // ISO date (YYYY-MM-DD), понедельник недели
  cohortSize: number;
  /** Сколько из когорты было активно (хоть один PAID-платёж) к концу недели N после регистрации. */
  retention: { week: number; active: number; pct: number }[];
}

interface FunnelStep {
  key: string;
  label: string;
  count: number;
  pctOfPrev: number; // 0..1 — конверсия из предыдущего шага
  pctOfStart: number;// 0..1 — конверсия от первого шага
}

interface ProviderRow {
  provider: string;
  total: number;          // все попытки оплаты
  paid: number;           // успешных
  failed: number;         // FAILED
  refunded: number;       // REFUNDED
  successRate: number;    // 0..1
  avgSecondsToPaid: number | null; // средняя длительность от создания до оплаты
  revenueByCurrency: { currency: string; amount: number }[];
  avgAmountByCurrency: { currency: string; amount: number }[];
}

businessAnalyticsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    const days = parsed.data.days ?? 30;

    const now = new Date();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const prevWindowStart = new Date(now.getTime() - 2 * days * 24 * 60 * 60 * 1000);

    // ────────────────────────────────────────────────────────────────
    // 1. KPI по валютам — MRR / total / paid count / paying clients
    // ────────────────────────────────────────────────────────────────
    const kpiRows = await prisma.$queryRaw<{
      currency: string;
      mrr: number;
      total_revenue: number;
      paid_count: bigint;
      paying_clients: bigint;
    }[]>(Prisma.sql`
      SELECT
        currency,
        COALESCE(SUM(amount) FILTER (WHERE tariff_id IS NOT NULL OR proxy_tariff_id IS NOT NULL OR singbox_tariff_id IS NOT NULL), 0)::float8 AS mrr,
        COALESCE(SUM(amount), 0)::float8 AS total_revenue,
        COUNT(*) AS paid_count,
        COUNT(DISTINCT client_id) AS paying_clients
      FROM payments
      WHERE status = 'PAID' AND paid_at >= ${windowStart}
      GROUP BY currency
      ORDER BY mrr DESC
    `);

    // ARPU/LTV считаем отдельным запросом — надо учесть «всех клиентов» а не только окно
    const ltvRows = await prisma.$queryRaw<{ currency: string; avg_total: number }[]>(Prisma.sql`
      WITH client_totals AS (
        SELECT client_id, currency, SUM(amount) AS total
        FROM payments
        WHERE status = 'PAID'
        GROUP BY client_id, currency
      )
      SELECT currency, AVG(total)::float8 AS avg_total
      FROM client_totals
      GROUP BY currency
    `);

    const kpis: KpiByCurrency[] = kpiRows.map((r) => {
      const ltv = ltvRows.find((l) => l.currency === r.currency)?.avg_total ?? 0;
      const payingClientsNum = Number(r.paying_clients);
      return {
        currency: r.currency,
        mrr: r.mrr,
        totalRevenue: r.total_revenue,
        arpu: payingClientsNum > 0 ? r.total_revenue / payingClientsNum : 0,
        ltv,
        paidCount: Number(r.paid_count),
        payingClients: payingClientsNum,
      };
    });

    // ────────────────────────────────────────────────────────────────
    // 2. Churn
    // ────────────────────────────────────────────────────────────────
    const [{ prev_count, retained_count }] = await prisma.$queryRaw<{ prev_count: bigint; retained_count: bigint }[]>(Prisma.sql`
      WITH paid_prev AS (
        SELECT DISTINCT client_id FROM payments
        WHERE status = 'PAID' AND paid_at >= ${prevWindowStart} AND paid_at < ${windowStart}
      ),
      paid_now AS (
        SELECT DISTINCT client_id FROM payments
        WHERE status = 'PAID' AND paid_at >= ${windowStart}
      )
      SELECT
        (SELECT COUNT(*) FROM paid_prev) AS prev_count,
        (SELECT COUNT(*) FROM paid_prev p WHERE EXISTS (SELECT 1 FROM paid_now n WHERE n.client_id = p.client_id)) AS retained_count
    `);
    const prevPaying = Number(prev_count);
    const retained = Number(retained_count);
    const churn: ChurnStat = {
      prevPeriodPayingClients: prevPaying,
      retainedClients: retained,
      churnedClients: Math.max(0, prevPaying - retained),
      churnRate: prevPaying > 0 ? Math.max(0, 1 - retained / prevPaying) : 0,
    };

    // ────────────────────────────────────────────────────────────────
    // 3. Когортный retention (12 недель)
    // ────────────────────────────────────────────────────────────────
    const cohortRows = await prisma.$queryRaw<{
      cohort_week: Date;
      cohort_size: bigint;
      week_1: bigint;
      week_2: bigint;
      week_4: bigint;
      week_8: bigint;
    }[]>(Prisma.sql`
      WITH cohorts AS (
        SELECT id AS client_id, DATE_TRUNC('week', created_at) AS cohort_week
        FROM clients
        WHERE created_at >= NOW() - INTERVAL '12 weeks'
      )
      SELECT
        c.cohort_week::date AS cohort_week,
        COUNT(*) AS cohort_size,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM payments p WHERE p.client_id = c.client_id AND p.status = 'PAID'
          AND p.paid_at >= c.cohort_week + INTERVAL '7 days' AND p.paid_at < c.cohort_week + INTERVAL '14 days'
        )) AS week_1,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM payments p WHERE p.client_id = c.client_id AND p.status = 'PAID'
          AND p.paid_at >= c.cohort_week + INTERVAL '14 days' AND p.paid_at < c.cohort_week + INTERVAL '21 days'
        )) AS week_2,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM payments p WHERE p.client_id = c.client_id AND p.status = 'PAID'
          AND p.paid_at >= c.cohort_week + INTERVAL '28 days' AND p.paid_at < c.cohort_week + INTERVAL '35 days'
        )) AS week_4,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM payments p WHERE p.client_id = c.client_id AND p.status = 'PAID'
          AND p.paid_at >= c.cohort_week + INTERVAL '56 days' AND p.paid_at < c.cohort_week + INTERVAL '63 days'
        )) AS week_8
      FROM cohorts c
      GROUP BY c.cohort_week
      ORDER BY c.cohort_week DESC
    `);

    const cohorts: CohortRow[] = cohortRows.map((r) => {
      const size = Number(r.cohort_size);
      const pct = (n: bigint) => (size > 0 ? Number(n) / size : 0);
      return {
        weekStart: r.cohort_week.toISOString().slice(0, 10),
        cohortSize: size,
        retention: [
          { week: 1, active: Number(r.week_1), pct: pct(r.week_1) },
          { week: 2, active: Number(r.week_2), pct: pct(r.week_2) },
          { week: 4, active: Number(r.week_4), pct: pct(r.week_4) },
          { week: 8, active: Number(r.week_8), pct: pct(r.week_8) },
        ],
      };
    });

    // ────────────────────────────────────────────────────────────────
    // 4. Воронка
    // ────────────────────────────────────────────────────────────────
    const [{ registered, trial_used, paid_once, paid_twice, auto_renew }] = await prisma.$queryRaw<{
      registered: bigint;
      trial_used: bigint;
      paid_once: bigint;
      paid_twice: bigint;
      auto_renew: bigint;
    }[]>(Prisma.sql`
      SELECT
        COUNT(*) AS registered,
        COUNT(*) FILTER (WHERE trial_used) AS trial_used,
        (SELECT COUNT(DISTINCT client_id) FROM payments WHERE status = 'PAID') AS paid_once,
        (SELECT COUNT(*) FROM (
          SELECT client_id FROM payments WHERE status = 'PAID' GROUP BY client_id HAVING COUNT(*) >= 2
        ) AS t) AS paid_twice,
        COUNT(*) FILTER (WHERE auto_renew_enabled) AS auto_renew
      FROM clients
    `);

    const fStart = Number(registered);
    const fStep = (n: bigint, prev: number): { count: number; pctOfPrev: number; pctOfStart: number } => {
      const c = Number(n);
      return {
        count: c,
        pctOfPrev: prev > 0 ? c / prev : 0,
        pctOfStart: fStart > 0 ? c / fStart : 0,
      };
    };
    const stepRegistered = fStep(registered, fStart);
    const stepTrial = fStep(trial_used, stepRegistered.count);
    const stepPaid1 = fStep(paid_once, stepTrial.count);
    const stepPaid2 = fStep(paid_twice, stepPaid1.count);
    const stepAuto = fStep(auto_renew, stepPaid1.count);

    const funnel: FunnelStep[] = [
      { key: "registered", label: "Зарегистрировались", ...stepRegistered },
      { key: "trial_used", label: "Воспользовались триалом", ...stepTrial },
      { key: "first_paid", label: "Сделали первую оплату", ...stepPaid1 },
      { key: "second_paid", label: "Сделали 2+ оплат", ...stepPaid2 },
      { key: "auto_renew", label: "Включили авто-продление", ...stepAuto },
    ];

    // ────────────────────────────────────────────────────────────────
    // 5. Сравнение провайдеров
    // ────────────────────────────────────────────────────────────────
    const provRows = await prisma.$queryRaw<{
      provider: string;
      total: bigint;
      paid: bigint;
      failed: bigint;
      refunded: bigint;
      avg_seconds: number | null;
    }[]>(Prisma.sql`
      SELECT
        COALESCE(provider, '(none)') AS provider,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'PAID') AS paid,
        COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
        COUNT(*) FILTER (WHERE status = 'REFUNDED') AS refunded,
        AVG(EXTRACT(EPOCH FROM (paid_at - created_at))) FILTER (WHERE status = 'PAID' AND paid_at IS NOT NULL)::float8 AS avg_seconds
      FROM payments
      WHERE created_at >= ${windowStart}
      GROUP BY COALESCE(provider, '(none)')
      ORDER BY paid DESC
    `);

    // отдельно — выручка по валюте у каждого провайдера
    const provRevRows = await prisma.$queryRaw<{
      provider: string;
      currency: string;
      revenue: number;
      avg_amount: number;
    }[]>(Prisma.sql`
      SELECT
        COALESCE(provider, '(none)') AS provider,
        currency,
        SUM(amount)::float8 AS revenue,
        AVG(amount)::float8 AS avg_amount
      FROM payments
      WHERE status = 'PAID' AND paid_at >= ${windowStart}
      GROUP BY COALESCE(provider, '(none)'), currency
    `);

    const providers: ProviderRow[] = provRows.map((r) => {
      const total = Number(r.total);
      const paid = Number(r.paid);
      const revRows = provRevRows.filter((rr) => rr.provider === r.provider);
      return {
        provider: r.provider,
        total,
        paid,
        failed: Number(r.failed),
        refunded: Number(r.refunded),
        successRate: total > 0 ? paid / total : 0,
        avgSecondsToPaid: r.avg_seconds,
        revenueByCurrency: revRows.map((rr) => ({ currency: rr.currency, amount: rr.revenue })),
        avgAmountByCurrency: revRows.map((rr) => ({ currency: rr.currency, amount: rr.avg_amount })),
      };
    });

    return res.json({
      windowDays: days,
      windowStart: windowStart.toISOString(),
      generatedAt: now.toISOString(),
      kpis,
      churn,
      cohorts,
      funnel,
      providers,
    });
  }),
);
