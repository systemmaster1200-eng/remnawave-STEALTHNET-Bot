/**
 * Отметить платёж как оплаченный: обновление статуса, начисление баланса (топ-ап),
 * активация тарифа/прокси/singbox, реферальные бонусы.
 * Используется в веб-админке и в бот-админке.
 */

import { prisma } from "../../db.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { auditPaymentClientBotAlignment } from "./payment-webhook-audit.util.js";

function hasExtraOptionInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj?.extraOption != null && typeof obj.extraOption === "object";
  } catch {
    return false;
  }
}

export type MarkPaymentPaidResult = {
  ok: boolean;
  payment: Awaited<ReturnType<typeof prisma.payment.findUnique>>;
  referral?: Awaited<ReturnType<typeof distributeReferralRewards>>;
  activation?: { ok: boolean; error?: string };
  proxySlots?: { ok: boolean; slotsCreated?: number; error?: string };
  balanceCredited?: boolean;
  error?: string;
};

export async function markPaymentPaid(paymentId: string): Promise<MarkPaymentPaidResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    return { ok: false, payment: null, error: "Payment not found" };
  }
  await auditPaymentClientBotAlignment({
    id: payment.id,
    clientId: payment.clientId,
    botId: payment.botId,
  });
  if (payment.status === "PAID") {
    const result = await distributeReferralRewards(paymentId);
    const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
    return { ok: true, payment: updated ?? payment, referral: result };
  }
  const now = new Date();
  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  const isTopUp =
    (payment.provider === "yoomoney_form" || payment.provider === "platega" || payment.provider === "yookassa") &&
    !payment.tariffId &&
    !payment.proxyTariffId &&
    !payment.singboxTariffId &&
    !isExtraOption;

  // Idempotent flip: PENDING → PAID. Если параллельный webhook (или повторный
  // ретрай провайдера) уже зафлипнул — count=0, сюда не лезем второй раз.
  // Без этой проверки: 2 webhook'а на один payment → 2 раза +balance.increment
  // (двойной топап). На бесподписном webhook'е (см. отчёт) — атакер мог фигачить
  // /webhooks/platega с одним paymentId сколько хочет.
  const flip = await prisma.payment.updateMany({
    where: { id: paymentId, status: "PENDING" },
    data: { status: "PAID", paidAt: now },
  });
  if (flip.count === 0) {
    // Уже PAID параллельным запросом — выходим как идемпотент.
    const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
    const result = await distributeReferralRewards(paymentId);
    return { ok: true, payment: updated ?? payment, referral: result };
  }
  if (isTopUp) {
    // Списание баланса делаем ТОЛЬКО если flip нам "достался" (count=1).
    await prisma.client.update({
      where: { id: payment.clientId },
      data: { balance: { increment: payment.amount } },
    });
  }

  let activation: { ok: boolean; error?: string } = { ok: false, error: "no tariff" };
  let proxySlots: { ok: boolean; slotsCreated?: number; error?: string } = { ok: false };
  if (isExtraOption) {
    const extraResult = await applyExtraOptionByPaymentId(paymentId);
    activation = extraResult.ok ? { ok: true } : { ok: false, error: (extraResult as { error?: string }).error };
  } else if (payment.tariffId) {
    activation = await activateTariffByPaymentId(paymentId);
  } else if (payment.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(paymentId);
    if (proxyResult.ok) {
      proxySlots = { ok: true, slotsCreated: proxyResult.slotsCreated };
      const tariff = await prisma.proxyTariff.findUnique({
        where: { id: payment.proxyTariffId },
        select: { name: true },
      });
      await notifyProxySlotsCreated(
        payment.clientId,
        proxyResult.slotIds,
        tariff?.name ?? undefined
      ).catch(() => {});
    } else {
      proxySlots = { ok: false, error: proxyResult.error };
    }
  } else if (payment.singboxTariffId) {
    const singboxResult = await createSingboxSlotsByPaymentId(paymentId);
    if (singboxResult.ok) {
      proxySlots = { ok: true, slotsCreated: singboxResult.slotsCreated };
      const tariff = await prisma.singboxTariff.findUnique({
        where: { id: payment.singboxTariffId },
        select: { name: true },
      });
      await notifySingboxSlotsCreated(
        payment.clientId,
        singboxResult.slotIds,
        tariff?.name ?? undefined
      ).catch(() => {});
    } else {
      proxySlots = { ok: false, error: singboxResult.error };
    }
  }

  if (payment.tariffId || payment.proxyTariffId || payment.singboxTariffId) {
    await prisma.client.update({
      where: { id: payment.clientId },
      data: { trialUsed: true },
    }).catch(() => {});
  }

  const referral = await distributeReferralRewards(paymentId);
  const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
  return {
    ok: true,
    payment: updated ?? payment,
    referral,
    activation,
    proxySlots: proxySlots.ok ? proxySlots : undefined,
    balanceCredited: isTopUp,
  };
}
