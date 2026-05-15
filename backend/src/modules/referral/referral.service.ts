/**
 * Трёхуровневая реферальная система: начисление процентов от пополнений
 * рефералов уровня 1, 2 и 3 при переходе платежа в статус PAID.
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";

/**
 * Распределяет реферальные бонусы по цепочке рефереров (до 3 уровней)
 * при оплате. Вызывать один раз при переводе платежа в PAID.
 * Идемпотентно: повторный вызов для того же платежа не дублирует начисления
 * (проверка по referralDistributedAt).
 */
export async function distributeReferralRewards(paymentId: string): Promise<{ distributed: boolean; message: string }> {
  const config = await getSystemConfig();
  const p1 = config.defaultReferralPercent;
  const p2 = config.referralPercentLevel2;
  const p3 = config.referralPercentLevel3;

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        client: {
          include: {
            referrer: {
              include: {
                referrer: {
                  include: {
                    referrer: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return { distributed: false, message: "Payment not found" };
    }
    if (payment.status !== "PAID") {
      return { distributed: false, message: "Payment is not PAID" };
    }
    if (payment.referralDistributedAt != null) {
      return { distributed: false, message: "Referral rewards already distributed for this payment" };
    }

    // Claim (идемпотентность при гонках/дублях webhook)
    const claim = await tx.payment.updateMany({
      where: { id: paymentId, status: "PAID", referralDistributedAt: null },
      data: { referralDistributedAt: new Date() },
    });
    if (claim.count === 0) {
      return { distributed: false, message: "Referral rewards already distributed for this payment" };
    }

    const level1 = payment.client.referrer ?? null;
    const level2 = level1?.referrer ?? null;
    const level3 = level2?.referrer ?? null;

    const amount = payment.baseAmount ?? payment.amount;
    const updates: { clientId: string; bonus: number; level: number }[] = [];
    const pct1 = level1?.referralPercent ?? p1;
    const pct2 = level2?.referralPercent ?? p2;
    const pct3 = level3?.referralPercent ?? p3;
    if (level1 && !level1.isBlocked && pct1 > 0) {
      updates.push({ clientId: level1.id, bonus: Math.round(amount * (pct1 / 100) * 100) / 100, level: 1 });
    }
    if (level2 && !level2.isBlocked && pct2 > 0) {
      updates.push({ clientId: level2.id, bonus: Math.round(amount * (pct2 / 100) * 100) / 100, level: 2 });
    }
    if (level3 && !level3.isBlocked && pct3 > 0) {
      updates.push({ clientId: level3.id, bonus: Math.round(amount * (pct3 / 100) * 100) / 100, level: 3 });
    }

    for (const { clientId, bonus, level } of updates) {
      await tx.client.update({
        where: { id: clientId },
        data: { balance: { increment: bonus } },
      });
      await tx.referralCredit.create({
        data: { referrerId: clientId, paymentId, amount: bonus, level },
      });
    }

    if (updates.length === 0) {
      return { distributed: true, message: "No referrers or all blocked; payment marked as distributed" };
    }

    return {
      distributed: true,
      message: `Distributed to ${updates.length} referrer(s)`,
    };
  });
}
