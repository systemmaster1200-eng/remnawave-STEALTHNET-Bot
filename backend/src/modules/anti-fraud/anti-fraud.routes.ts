/**
 * Anti-fraud signals — детектирует подозрительные паттерны на существующих данных.
 *
 * Полностью read-only: ничего не блокирует автоматически, просто подсвечивает в UI.
 * Все детекторы — обычные SQL/Prisma запросы; ничего не пишем в БД.
 *
 * Сигналы:
 *   1. multi_account_telegram   — один TG id у разных Client (возможно один человек делает фейковые аккаунты)
 *   2. multi_account_email      — один email у разных botId (legitимно если один TG-юзер в нескольких клонах)
 *   3. rapid_trial_burn         — клиенты, прошедшие trial → блок (без оплаты) → новый аккаунт быстро
 *   4. high_failed_payments     — клиенты с >5 FAILED платежей за 7д (вероятная фрод-проба карты)
 *   5. referral_self_chain      — рефералы где referrer и client имеют общий telegramId или один email-домен (self-referral abuse)
 *   6. high_refund_clients      — клиенты с >2 REFUND за 30д
 *   7. payment_velocity_burst   — клиенты, оплатившие >20 раз за 1 час (карта-перебор/тестирование)
 *   8. suspicious_promo_burst   — промокод активирован >50 раз за 5 минут (utility-attack)
 *
 * GET /api/admin/anti-fraud/signals — все сигналы за один проход
 * GET /api/admin/anti-fraud/signal/:key?limit=N — детальный список для одного сигнала
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

export const antiFraudRouter = Router();
antiFraudRouter.use(requireAuth);
antiFraudRouter.use(requireAdminSection);

interface SignalSummary {
  key: string;
  label: string;
  description: string;
  severity: "info" | "warn" | "error";
  count: number;
  topItems?: Array<Record<string, unknown>>;
}

// ─── individual detectors ───────────────────────────────────────────────

async function detectMultiAccountTelegram(limit = 10) {
  const rows = await prisma.$queryRaw<{ telegram_id: string; account_count: bigint; emails: string[] }[]>(Prisma.sql`
    SELECT
      telegram_id,
      COUNT(*) AS account_count,
      ARRAY_AGG(COALESCE(email, '(no-email)')) AS emails
    FROM clients
    WHERE telegram_id IS NOT NULL
    GROUP BY telegram_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    telegramId: r.telegram_id,
    accountCount: Number(r.account_count),
    emails: r.emails,
  }));
}

async function detectMultiAccountEmail(limit = 10) {
  // Один и тот же email встречается у разных botId — может быть нормально (один юзер в разных клонах),
  // но если accountCount > 3 — стоит проверить.
  const rows = await prisma.$queryRaw<{ email: string; account_count: bigint; telegram_ids: string[] }[]>(Prisma.sql`
    SELECT
      LOWER(email) AS email,
      COUNT(DISTINCT id) AS account_count,
      ARRAY_AGG(DISTINCT COALESCE(telegram_id, '(no-tg)')) AS telegram_ids
    FROM clients
    WHERE email IS NOT NULL
    GROUP BY LOWER(email)
    HAVING COUNT(DISTINCT id) > 3
    ORDER BY COUNT(DISTINCT id) DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    email: r.email,
    accountCount: Number(r.account_count),
    telegramIds: r.telegram_ids,
  }));
}

async function detectHighFailedPayments(limit = 20) {
  const rows = await prisma.$queryRaw<{
    client_id: string;
    email: string | null;
    telegram_username: string | null;
    failed_count: bigint;
  }[]>(Prisma.sql`
    SELECT
      c.id AS client_id,
      c.email,
      c.telegram_username,
      COUNT(*) AS failed_count
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    WHERE p.status = 'FAILED' AND p.created_at >= NOW() - INTERVAL '7 days'
    GROUP BY c.id, c.email, c.telegram_username
    HAVING COUNT(*) > 5
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    clientId: r.client_id,
    email: r.email,
    telegramUsername: r.telegram_username,
    failedCount: Number(r.failed_count),
  }));
}

async function detectHighRefundClients(limit = 20) {
  const rows = await prisma.$queryRaw<{
    client_id: string;
    email: string | null;
    telegram_username: string | null;
    refund_count: bigint;
    refund_total: number;
  }[]>(Prisma.sql`
    SELECT
      c.id AS client_id,
      c.email,
      c.telegram_username,
      COUNT(*) AS refund_count,
      SUM(p.amount)::float8 AS refund_total
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    WHERE p.status = 'REFUNDED' AND p.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY c.id, c.email, c.telegram_username
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    clientId: r.client_id,
    email: r.email,
    telegramUsername: r.telegram_username,
    refundCount: Number(r.refund_count),
    refundTotal: r.refund_total,
  }));
}

async function detectPaymentVelocityBurst(limit = 20) {
  const rows = await prisma.$queryRaw<{
    client_id: string;
    email: string | null;
    telegram_username: string | null;
    payment_count: bigint;
    window_start: Date;
  }[]>(Prisma.sql`
    SELECT
      c.id AS client_id,
      c.email,
      c.telegram_username,
      COUNT(*) AS payment_count,
      MIN(p.created_at) AS window_start
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    WHERE p.created_at >= NOW() - INTERVAL '7 days'
    GROUP BY c.id, c.email, c.telegram_username, DATE_TRUNC('hour', p.created_at)
    HAVING COUNT(*) > 20
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    clientId: r.client_id,
    email: r.email,
    telegramUsername: r.telegram_username,
    paymentCount: Number(r.payment_count),
    windowStart: r.window_start.toISOString(),
  }));
}

async function detectSuspiciousPromoBurst(limit = 20) {
  // Promo-код активирован более 30 раз за 5 минут — utility-attack
  const rows = await prisma.$queryRaw<{
    promo_code_id: string;
    code: string;
    activations: bigint;
    window_start: Date;
  }[]>(Prisma.sql`
    SELECT
      pc.id AS promo_code_id,
      pc.code,
      COUNT(*) AS activations,
      MIN(u.created_at) AS window_start
    FROM promo_code_usages u
    JOIN promo_codes pc ON pc.id = u.promo_code_id
    WHERE u.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY pc.id, pc.code, DATE_TRUNC('minute', u.created_at)
    HAVING COUNT(*) > 30
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    promoCodeId: r.promo_code_id,
    code: r.code,
    activations: Number(r.activations),
    windowStart: r.window_start.toISOString(),
  }));
}

async function detectReferralSelfChain(limit = 20) {
  // Рефералы где у referrer и referred совпадает email-домен или telegram_id
  const rows = await prisma.$queryRaw<{
    referrer_id: string;
    referrer_email: string | null;
    referrer_tg: string | null;
    client_id: string;
    client_email: string | null;
    client_tg: string | null;
    reason: string;
  }[]>(Prisma.sql`
    SELECT
      r.id AS referrer_id,
      r.email AS referrer_email,
      r.telegram_id AS referrer_tg,
      c.id AS client_id,
      c.email AS client_email,
      c.telegram_id AS client_tg,
      CASE
        WHEN r.telegram_id = c.telegram_id AND r.telegram_id IS NOT NULL THEN 'same_telegram_id'
        WHEN r.email IS NOT NULL AND c.email IS NOT NULL
             AND POSITION('@' IN r.email) > 0 AND POSITION('@' IN c.email) > 0
             AND SUBSTRING(LOWER(r.email) FROM POSITION('@' IN r.email)) = SUBSTRING(LOWER(c.email) FROM POSITION('@' IN c.email))
             AND SUBSTRING(LOWER(r.email) FROM '^[^@]+\\+') IS NOT NULL
             THEN 'gmail_plus_alias'
        ELSE 'unknown'
      END AS reason
    FROM clients c
    JOIN clients r ON r.id = c.referrer_id
    WHERE c.referrer_id IS NOT NULL
      AND (
        r.telegram_id = c.telegram_id
        OR (
          r.email IS NOT NULL AND c.email IS NOT NULL
          AND SUBSTRING(LOWER(r.email) FROM '^[^@+]+') = SUBSTRING(LOWER(c.email) FROM '^[^@+]+')
          AND SUBSTRING(LOWER(r.email) FROM POSITION('@' IN r.email)) = SUBSTRING(LOWER(c.email) FROM POSITION('@' IN c.email))
        )
      )
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    referrerId: r.referrer_id,
    referrerEmail: r.referrer_email,
    referrerTg: r.referrer_tg,
    clientId: r.client_id,
    clientEmail: r.client_email,
    clientTg: r.client_tg,
    reason: r.reason,
  }));
}

async function detectRapidTrialBurn(limit = 20) {
  // Клиенты у которых: trial_used=true, нет PAID-платежей, и зарегистрированы недавно (<7д) — потенциальная trial-фарма
  // Дополнительно фильтруем по «много таких с одного TG-id» — это и есть burn
  const rows = await prisma.$queryRaw<{
    telegram_id: string;
    burner_count: bigint;
  }[]>(Prisma.sql`
    SELECT
      telegram_id,
      COUNT(*) AS burner_count
    FROM clients c
    WHERE c.trial_used = true
      AND c.telegram_id IS NOT NULL
      AND c.created_at >= NOW() - INTERVAL '7 days'
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.client_id = c.id AND p.status = 'PAID')
    GROUP BY telegram_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    telegramId: r.telegram_id,
    burnerCount: Number(r.burner_count),
  }));
}

// ─── routes ─────────────────────────────────────────────────────────────

antiFraudRouter.get(
  "/signals",
  asyncRoute(async (_req, res) => {
    const [
      multiTg,
      multiEmail,
      failedPay,
      refundClients,
      velocityBurst,
      promoBurst,
      selfChain,
      trialBurn,
    ] = await Promise.all([
      detectMultiAccountTelegram(5),
      detectMultiAccountEmail(5),
      detectHighFailedPayments(5),
      detectHighRefundClients(5),
      detectPaymentVelocityBurst(5),
      detectSuspiciousPromoBurst(5),
      detectReferralSelfChain(5),
      detectRapidTrialBurn(5),
    ]);

    const signals: SignalSummary[] = [
      {
        key: "multi_account_telegram",
        label: "Один TG id — несколько аккаунтов",
        description: "Несколько Client'ов с одинаковым telegram_id (возможно фейковые регистрации)",
        severity: multiTg.length > 0 ? "warn" : "info",
        count: multiTg.length,
        topItems: multiTg as unknown as Array<Record<string, unknown>>,
      },
      {
        key: "multi_account_email",
        label: "Один email — много (>3) аккаунтов",
        description: "Email встречается у >3 разных Client (возможно email-alias abuse)",
        severity: multiEmail.length > 0 ? "warn" : "info",
        count: multiEmail.length,
        topItems: multiEmail as unknown as Array<Record<string, unknown>>,
      },
      {
        key: "rapid_trial_burn",
        label: "Trial-фарма (один TG, много trial-аккаунтов)",
        description: "С одного telegram_id создано несколько аккаунтов за 7д с использованным trial и без оплат",
        severity: trialBurn.length > 0 ? "warn" : "info",
        count: trialBurn.length,
        topItems: trialBurn as unknown as Array<Record<string, unknown>>,
      },
      {
        key: "high_failed_payments",
        label: "Много FAILED платежей (>5 за 7д)",
        description: "Клиенты с >5 неудачными платежами — возможная проба украденных карт",
        severity: failedPay.length > 0 ? "error" : "info",
        count: failedPay.length,
        topItems: failedPay as unknown as Array<Record<string, unknown>>,
      },
      {
        key: "referral_self_chain",
        label: "Самореферралы (тот же TG/email-prefix)",
        description: "Клиент использовал свой же реферальный код через альтернативный аккаунт",
        severity: selfChain.length > 0 ? "warn" : "info",
        count: selfChain.length,
        topItems: selfChain as unknown as Array<Record<string, unknown>>,
      },
      {
        key: "high_refund_clients",
        label: "Частые refund'ы (>=2 за 30д)",
        description: "Клиенты с повторными возвратами — проверьте легитимность",
        severity: refundClients.length > 0 ? "warn" : "info",
        count: refundClients.length,
        topItems: refundClients as unknown as Array<Record<string, unknown>>,
      },
      {
        key: "payment_velocity_burst",
        label: "Burst оплат (>20 за час)",
        description: "Клиент создал >20 платежей за один час — возможная карт-проба или скрипт",
        severity: velocityBurst.length > 0 ? "error" : "info",
        count: velocityBurst.length,
        topItems: velocityBurst as unknown as Array<Record<string, unknown>>,
      },
      {
        key: "suspicious_promo_burst",
        label: "Промокод за 1 минуту >30 активаций",
        description: "Возможная утечка промокода (массовая активация ботом)",
        severity: promoBurst.length > 0 ? "error" : "info",
        count: promoBurst.length,
        topItems: promoBurst as unknown as Array<Record<string, unknown>>,
      },
    ];

    return res.json({
      generatedAt: new Date().toISOString(),
      signals,
      total: signals.reduce((s, x) => s + x.count, 0),
    });
  }),
);

const detailQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

antiFraudRouter.get(
  "/signal/:key",
  asyncRoute(async (req, res) => {
    const limit = detailQuery.safeParse(req.query).data?.limit ?? 50;
    const key = req.params.key;
    let items: unknown[] = [];
    switch (key) {
      case "multi_account_telegram": items = await detectMultiAccountTelegram(limit); break;
      case "multi_account_email": items = await detectMultiAccountEmail(limit); break;
      case "rapid_trial_burn": items = await detectRapidTrialBurn(limit); break;
      case "high_failed_payments": items = await detectHighFailedPayments(limit); break;
      case "referral_self_chain": items = await detectReferralSelfChain(limit); break;
      case "high_refund_clients": items = await detectHighRefundClients(limit); break;
      case "payment_velocity_burst": items = await detectPaymentVelocityBurst(limit); break;
      case "suspicious_promo_burst": items = await detectSuspiciousPromoBurst(limit); break;
      default: return res.status(404).json({ message: "Unknown signal key" });
    }
    return res.json({ key, items, total: items.length });
  }),
);
