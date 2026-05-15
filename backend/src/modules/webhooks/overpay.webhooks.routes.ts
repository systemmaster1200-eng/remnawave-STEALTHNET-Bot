/**
 * Webhook Overpay:
 *   - Overpay шлёт `order.update` с телом { id, status, merchantTransactionId }.
 *   - Документация описывает GET с body, но на практике мерчанты получают POST.
 *     Поэтому роутер принимает оба метода.
 *   - Идемпотентно: повторные webhook'и не дублируют активацию тарифа / реферальные.
 *   - Безопасность: провайдер не подписывает webhook'и ключом, поэтому полагаемся
 *     на то, что `merchantTransactionId` — UUIDv4 нашего заказа (угадать извне нельзя).
 */

import { Router, Request, Response } from "express";
import { prisma } from "../../db.js";
import { OVERPAY_SUCCESS_STATUSES, OVERPAY_FAILED_STATUSES } from "../overpay/overpay.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import {
  notifyBalanceToppedUp,
  notifyTariffActivated,
  notifyProxySlotsCreated,
  notifySingboxSlotsCreated,
} from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";

function hasExtraOptionInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj?.extraOption != null && typeof obj.extraOption === "object";
  } catch {
    return false;
  }
}

function pickFirstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

type Meta = Record<string, unknown> & {
  overpayActivationAppliedAt?: string;
  overpayActivationInProgressAt?: string;
  overpayActivationAttempts?: number;
  overpayActivationLastError?: string | null;
};

function parseMeta(raw: string | null): Meta {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Meta;
  } catch {
    return {};
  }
}

async function ensureTariffActivation(paymentId: string): Promise<void> {
  const claim = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { status: true, tariffId: true, proxyTariffId: true, singboxTariffId: true, metadata: true, clientId: true },
    });
    const hasExtra = hasExtraOptionInMetadata(row?.metadata ?? null);
    if (!row || row.status !== "PAID" || (!row.tariffId && !row.proxyTariffId && !row.singboxTariffId && !hasExtra)) {
      return { claimed: false as const, reason: "not_paid_or_no_tariff" };
    }

    const meta = parseMeta(row.metadata);
    if (typeof meta.overpayActivationAppliedAt === "string" && meta.overpayActivationAppliedAt.trim()) {
      return { claimed: false as const, reason: "already_applied" };
    }

    const inProgressAt =
      typeof meta.overpayActivationInProgressAt === "string" ? new Date(meta.overpayActivationInProgressAt) : null;
    const freshInProgress =
      inProgressAt && Number.isFinite(inProgressAt.getTime()) && Date.now() - inProgressAt.getTime() < 10 * 60 * 1000;
    if (freshInProgress) {
      return { claimed: false as const, reason: "in_progress" };
    }

    const next: Meta = {
      ...meta,
      overpayActivationInProgressAt: new Date().toISOString(),
      overpayActivationAttempts: Number(meta.overpayActivationAttempts ?? 0) + 1,
    };
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
    return { claimed: true as const, reason: "claimed" };
  });

  if (!claim.claimed) return;

  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { tariffId: true, proxyTariffId: true, singboxTariffId: true, clientId: true, metadata: true },
  });
  const isExtraOption = row ? hasExtraOptionInMetadata(row.metadata) : false;
  let activation: { ok: boolean; error?: string; slotIds?: string[] } = { ok: false };
  if (isExtraOption) {
    activation = await applyExtraOptionByPaymentId(paymentId);
  } else if (row?.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(paymentId);
    activation = proxyResult.ok ? { ok: true, slotIds: proxyResult.slotIds } : { ok: false, error: proxyResult.error };
    if (activation.ok && activation.slotIds?.length && row.clientId) {
      const tariff = await prisma.proxyTariff.findUnique({ where: { id: row.proxyTariffId }, select: { name: true } });
      await notifyProxySlotsCreated(row.clientId, activation.slotIds, tariff?.name ?? undefined).catch(() => {});
    }
  } else if (row?.singboxTariffId) {
    const singboxResult = await createSingboxSlotsByPaymentId(paymentId);
    activation = singboxResult.ok
      ? { ok: true, slotIds: singboxResult.slotIds }
      : { ok: false, error: singboxResult.error };
    if (activation.ok && activation.slotIds?.length && row.clientId) {
      const tariff = await prisma.singboxTariff.findUnique({
        where: { id: row.singboxTariffId },
        select: { name: true },
      });
      await notifySingboxSlotsCreated(row.clientId, activation.slotIds, tariff?.name ?? undefined).catch(() => {});
    }
  } else {
    activation = await activateTariffByPaymentId(paymentId);
  }
  await prisma.$transaction(async (tx) => {
    const row2 = await tx.payment.findUnique({ where: { id: paymentId }, select: { metadata: true } });
    const meta = parseMeta(row2?.metadata ?? null);
    const next: Meta = { ...meta };
    delete next.overpayActivationInProgressAt;
    if (activation.ok) {
      next.overpayActivationAppliedAt = new Date().toISOString();
      next.overpayActivationLastError = null;
    } else {
      next.overpayActivationLastError = activation.error;
    }
    await tx.payment.update({ where: { id: paymentId }, data: { metadata: JSON.stringify(next) } });
  });

  if (activation.ok) {
    console.log("[Overpay Webhook] Tariff activated", { paymentId });
  } else {
    console.error("[Overpay Webhook] Tariff activation failed", { paymentId, error: activation.error });
  }
}

export const overpayWebhooksRouter = Router();

async function handle(req: Request, res: Response) {
  try {
    const src = (req.body && typeof req.body === "object") ? (req.body as Record<string, unknown>) : {};
    const q = (req.query ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = { ...q, ...src };
    if (!data || Object.keys(data).length === 0) {
      console.warn("[Overpay Webhook] Empty body");
      return res.status(200).json({ received: true });
    }

    const orderObj = data.order && typeof data.order === "object" ? (data.order as Record<string, unknown>) : {};
    const dataObj = data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : {};

    const statusRaw = pickFirstString(
      data.status,
      orderObj.status,
      dataObj.status,
      data.state,
    );
    const status = (statusRaw ?? "").toLowerCase();

    const orderId = pickFirstString(
      data.merchantTransactionId,
      data.merchant_transaction_id,
      orderObj.merchantTransactionId,
      orderObj.merchant_transaction_id,
      dataObj.merchantTransactionId,
      dataObj.merchant_transaction_id,
      data.merchantId,
    );
    const overpayId = pickFirstString(data.id, orderObj.id, dataObj.id, data.orderId);

    if (!orderId && !overpayId) {
      console.warn("[Overpay Webhook] No identifiers", { keys: Object.keys(data) });
      return res.status(200).json({ received: true });
    }

    // Ищем платёж: сначала по нашему orderId (merchantTransactionId), затем по externalId (id Overpay).
    let payment = null as
      | null
      | {
          id: string;
          status: string;
          clientId: string;
          botId: string | null;
          amount: number;
          currency: string;
          tariffId: string | null;
          proxyTariffId: string | null;
          singboxTariffId: string | null;
          metadata: string | null;
          orderId: string;
          externalId: string | null;
        };

    const PAYMENT_SELECT = {
      id: true,
      status: true,
      clientId: true,
      botId: true,
      amount: true,
      currency: true,
      tariffId: true,
      proxyTariffId: true,
      singboxTariffId: true,
      metadata: true,
      orderId: true,
      externalId: true,
    } as const;

    if (orderId) {
      const p = await prisma.payment.findUnique({
        where: { orderId },
        select: { ...PAYMENT_SELECT, provider: true },
      });
      if (p && p.provider === "overpay") {
        const { provider: _p, ...rest } = p;
        payment = rest;
      }
    }
    if (!payment && overpayId) {
      const p = await prisma.payment.findFirst({
        where: { provider: "overpay", externalId: overpayId },
        select: PAYMENT_SELECT,
      });
      if (p) payment = p;
    }

    if (!payment) {
      console.warn("[Overpay Webhook] Payment not found", { orderId, overpayId, status });
      return res.status(200).json({ received: true });
    }

    await auditPaymentClientBotAlignment(payment);

    if (OVERPAY_FAILED_STATUSES.has(status)) {
      const failed = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", externalId: overpayId ?? payment.externalId },
      });
      if (failed.count > 0) {
        console.log("[Overpay Webhook] Payment marked FAILED", {
          paymentId: payment.id,
          status,
          overpayId,
          orderId: payment.orderId,
        });
      }
      return res.status(200).json({ received: true });
    }

    if (!OVERPAY_SUCCESS_STATUSES.has(status)) {
      console.log("[Overpay Webhook] Ignored status", { status, paymentId: payment.id });
      return res.status(200).json({ received: true });
    }

    const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
    const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption;
    if (isTopUp) {
      const changed = await prisma.$transaction(async (tx) => {
        const upd = await tx.payment.updateMany({
          where: { id: payment.id, status: "PENDING" },
          data: { status: "PAID", paidAt: new Date(), externalId: overpayId ?? payment.externalId },
        });
        if (upd.count > 0) {
          await tx.client.update({
            where: { id: payment.clientId },
            data: { balance: { increment: payment.amount } },
          });
        }
        return upd.count > 0;
      });
      if (changed) {
        console.log("[Overpay Webhook] Payment PAID, balance credited (top-up)", {
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          overpayId,
          orderId: payment.orderId,
        });
        await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", "Overpay").catch(() => {});
      }
    } else {
      const upd = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "PAID", paidAt: new Date(), externalId: overpayId ?? payment.externalId },
      });
      if (upd.count > 0) {
        console.log("[Overpay Webhook] Payment PAID (tariff)", {
          paymentId: payment.id,
          overpayId,
          orderId: payment.orderId,
        });
      }
    }

    await recordPromoCodeUsageFromPayment(payment.id);
    await ensureTariffActivation(payment.id);
    if (payment.tariffId) {
      await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
    }
    await distributeReferralRewards(payment.id).catch((e) => {
      console.error("[Overpay Webhook] Referral distribution error", { paymentId: payment.id, error: e });
    });

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("[Overpay Webhook] Error:", e);
    return res.status(200).json({ received: true });
  }
}

overpayWebhooksRouter.post("/overpay", handle);
overpayWebhooksRouter.get("/overpay", handle);
