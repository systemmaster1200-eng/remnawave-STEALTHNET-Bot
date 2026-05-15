/**
 * Payment actions для админа: refund / mark-failed / retry-activation.
 *
 * - GET    /admin/payments/:id              — детали платежа + связанная информация
 * - POST   /admin/payments/:id/mark-failed  — статус → FAILED (без возврата денег, для зависших)
 * - POST   /admin/payments/:id/refund       — полный refund: возврат балансов + откат
 *                                              referral-наград (decrement) + status → REFUNDED
 * - POST   /admin/payments/:id/retry-activation — повторно дёрнуть активацию для PAID платежа
 *
 * Все действия логируются в admin_events.
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const paymentActionsRouter = Router();
paymentActionsRouter.use(requireAuth);
paymentActionsRouter.use(requireAdminSection);

paymentActionsRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, email: true, telegramId: true, telegramUsername: true, balance: true, isBlocked: true } },
      },
    });
    if (!payment) return res.status(404).json({ message: "Платёж не найден" });

    // Подтянем связанные refund-записи (если уже делали refund на этот платеж).
    let referralCredits: unknown[] = [];
    try {
      referralCredits = await prisma.referralCredit.findMany({
        where: { paymentId: id },
        include: { referrer: { select: { id: true, email: true, telegramUsername: true } } },
      });
    } catch { /* referral_credits может не быть */ }

    return res.json({ payment, referralCredits });
  }),
);

paymentActionsRouter.post(
  "/:id/mark-failed",
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const reason = z.object({ reason: z.string().max(500).optional() }).safeParse(req.body).data?.reason;

    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return res.status(404).json({ message: "Платёж не найден" });
    if (payment.status === "FAILED") return res.status(400).json({ message: "Платёж уже в FAILED" });
    if (payment.status === "REFUNDED") return res.status(400).json({ message: "Платёж уже возвращён" });

    const updated = await prisma.payment.update({
      where: { id },
      data: { status: "FAILED" },
    });

    await logAdmin(req, "payment.mark_failed", { type: "payment", id }, {
      previousStatus: payment.status,
      reason: reason ?? null,
      amount: payment.amount,
      currency: payment.currency,
    });

    return res.json({ ok: true, payment: updated });
  }),
);

const refundSchema = z.object({
  /** Возвращать ли средства на баланс клиента (если оплата была не балансом, но мы хотим "вернуть" клиенту в виде зачисления). */
  refundToBalance: z.boolean().optional(),
  /** Откатывать ли referral-награды, начисленные с этого платежа. */
  reverseReferrals: z.boolean().optional(),
  /** Причина для аудит-лога (опционально). */
  reason: z.string().max(500).optional(),
});

paymentActionsRouter.post(
  "/:id/refund",
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const parsed = refundSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
    const { refundToBalance = true, reverseReferrals = true, reason } = parsed.data;

    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return res.status(404).json({ message: "Платёж не найден" });
    if (payment.status === "REFUNDED") return res.status(400).json({ message: "Уже возвращён" });
    if (payment.status === "FAILED") return res.status(400).json({ message: "Платёж уже FAILED — refund не нужен" });

    let creditedToBalance = 0;
    let reversedReferralAmount = 0;
    let reversedReferralCount = 0;

    // 1. Зачисление на баланс — если pay-by-balance, увеличиваем (откатываем decrement).
    //    Для других провайдеров — это будет «возврат на счёт» как goodwill credit.
    if (refundToBalance && payment.amount > 0) {
      await prisma.client.update({
        where: { id: payment.clientId },
        data: { balance: { increment: payment.amount } },
      });
      creditedToBalance = payment.amount;
    }

    // 2. Откат referral-наград.
    if (reverseReferrals) {
      try {
        const credits = await prisma.referralCredit.findMany({ where: { paymentId: id } });
        for (const c of credits) {
          // Откатываем баланс реферера на сумму награды (если она была credited).
          if (c.amount > 0) {
            await prisma.client.update({
              where: { id: c.referrerId },
              data: { balance: { decrement: c.amount } },
            }).catch((e) => console.error("[refund] failed to reverse referral credit:", e));
            reversedReferralAmount += c.amount;
            reversedReferralCount += 1;
          }
        }
        // Удаляем сами кредиты.
        await prisma.referralCredit.deleteMany({ where: { paymentId: id } });
      } catch (e) {
        console.error("[refund] referral_credits processing failed:", e);
      }
    }

    // 3. Статус → REFUNDED (если БД позволяет такой статус; иначе FAILED + metadata.refunded).
    let updated;
    try {
      updated = await prisma.payment.update({
        where: { id },
        data: { status: "REFUNDED" },
      });
    } catch {
      // Status enum-like: используем FAILED + помечаем в metadata.
      const meta = payment.metadata ? (() => {
        try { return JSON.parse(payment.metadata) as Record<string, unknown>; } catch { return {}; }
      })() : {};
      updated = await prisma.payment.update({
        where: { id },
        data: {
          status: "FAILED",
          metadata: JSON.stringify({
            ...meta,
            refundedAt: new Date().toISOString(),
            refundedToBalance: creditedToBalance,
            reversedReferralAmount,
          }),
        },
      });
    }

    await logAdmin(req, "payment.refund", { type: "payment", id }, {
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      creditedToBalance,
      reversedReferralAmount,
      reversedReferralCount,
      reason: reason ?? null,
    });

    return res.json({
      ok: true,
      payment: updated,
      summary: {
        creditedToBalance,
        reversedReferralAmount,
        reversedReferralCount,
      },
    });
  }),
);

paymentActionsRouter.post(
  "/:id/retry-activation",
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return res.status(404).json({ message: "Платёж не найден" });
    if (payment.status !== "PAID") return res.status(400).json({ message: `Активацию можно повторить только для PAID платежей. Текущий статус: ${payment.status}` });

    let activationResult: unknown = null;
    let activationError: string | null = null;

    // Импорт по типу tariff/proxy/singbox/extra-option.
    if (payment.tariffId) {
      const { activateTariffByPaymentId } = await import("../tariff/tariff-activation.service.js");
      const result = await activateTariffByPaymentId(payment.id);
      activationResult = result;
      if (!result.ok) activationError = ((result as { error?: string }).error) ?? "tariff activation failed";
    } else if (payment.proxyTariffId) {
      const { createProxySlotsByPaymentId } = await import("../proxy/proxy-slots-activation.service.js");
      const result = await createProxySlotsByPaymentId(payment.id);
      activationResult = result;
      if (!result.ok) activationError = result.error ?? "proxy slots activation failed";
    } else if (payment.singboxTariffId) {
      const { createSingboxSlotsByPaymentId } = await import("../singbox/singbox-slots-activation.service.js");
      const result = await createSingboxSlotsByPaymentId(payment.id);
      activationResult = result;
      if (!result.ok) activationError = result.error ?? "singbox slots activation failed";
    } else {
      // Возможно extra-option.
      try {
        const { applyExtraOptionByPaymentId } = await import("../extra-options/extra-options.service.js");
        const result = await applyExtraOptionByPaymentId(payment.id);
        activationResult = result;
        if (!(result as { ok?: boolean }).ok) {
          activationError = ((result as { error?: string }).error) ?? "extra option activation failed";
        }
      } catch (e) {
        activationError = `Не определён тип платежа для retry: ${String(e)}`;
      }
    }

    await logAdmin(req, "payment.retry_activation", { type: "payment", id }, {
      ok: !activationError,
      error: activationError,
    });

    if (activationError) return res.status(502).json({ message: activationError, result: activationResult });
    return res.json({ ok: true, result: activationResult });
  }),
);
