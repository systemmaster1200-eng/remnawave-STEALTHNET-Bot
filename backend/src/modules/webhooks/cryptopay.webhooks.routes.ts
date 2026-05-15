/**
 * Webhook Crypto Pay (Crypto Bot): update_type invoice_paid.
 * Проверка подписи: HMAC-SHA256(rawBody, SHA256(token)).
 * Документация: https://help.send.tg/en/articles/10279948-crypto-pay-api
 */

import { Router, Request, Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyCryptopayWebhookSignature } from "../cryptopay/cryptopay.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
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

export const cryptopayWebhooksRouter = Router();

type CryptopayWebhookPayload = {
  update_type?: string;
  payload?: { payload?: string; invoice_id?: number; status?: string };
};

/** POST /api/webhooks/cryptopay — вызывается с express.raw(), req.body = Buffer */
cryptopayWebhooksRouter.post("/", async (req: Request, res: Response) => {
  const rawBody = req.body;
  const rawString = typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : "";
  if (!rawString) {
    console.warn("[Crypto Pay Webhook] Empty body");
    return res.status(200).send("OK");
  }

  const config = await getSystemConfig();
  const token = (config as { cryptopayApiToken?: string | null }).cryptopayApiToken?.trim();
  if (!token) {
    console.warn("[Crypto Pay Webhook] Crypto Pay not configured");
    return res.status(200).send("OK");
  }

  const signature = req.headers["crypto-pay-api-signature"] as string | undefined;
  if (!verifyCryptopayWebhookSignature(token, rawString, signature)) {
    console.warn("[Crypto Pay Webhook] Invalid signature");
    return res.status(401).send("Invalid signature");
  }

  let body: CryptopayWebhookPayload;
  try {
    body = JSON.parse(rawString) as CryptopayWebhookPayload;
  } catch {
    console.warn("[Crypto Pay Webhook] Invalid JSON");
    return res.status(200).send("OK");
  }

  if (body.update_type !== "invoice_paid" || !body.payload?.payload) {
    return res.status(200).send("OK");
  }

  const paymentId = body.payload.payload.trim();
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, provider: "cryptopay" },
    select: {
      id: true,
      clientId: true,
      botId: true,
      amount: true,
      currency: true,
      tariffId: true,
      proxyTariffId: true,
      singboxTariffId: true,
      status: true,
      metadata: true,
    },
  });

  if (!payment) {
    console.warn("[Crypto Pay Webhook] Payment not found", { paymentId });
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  if (payment.status === "PAID") {
    return res.status(200).send("OK");
  }

  const invoiceId = body.payload.invoice_id ?? null;
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PAID", paidAt: new Date(), externalId: invoiceId != null ? String(invoiceId) : null },
  });
  await recordPromoCodeUsageFromPayment(payment.id);

  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption;

  if (isTopUp) {
    await prisma.client.update({
      where: { id: payment.clientId },
      data: { balance: { increment: payment.amount } },
    });
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "USD", "CryptoPay").catch(() => {});
  } else if (isExtraOption) {
    await applyExtraOptionByPaymentId(payment.id);
  } else if (payment.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(payment.id);
    if (proxyResult.ok) {
      const tariff = await prisma.proxyTariff.findUnique({ where: { id: payment.proxyTariffId }, select: { name: true } });
      await notifyProxySlotsCreated(payment.clientId, proxyResult.slotIds, tariff?.name ?? undefined).catch(() => {});
    }
  } else if (payment.singboxTariffId) {
    const singboxResult = await createSingboxSlotsByPaymentId(payment.id);
    if (singboxResult.ok) {
      const tariff = await prisma.singboxTariff.findUnique({ where: { id: payment.singboxTariffId }, select: { name: true } });
      await notifySingboxSlotsCreated(payment.clientId, singboxResult.slotIds, tariff?.name ?? undefined).catch(() => {});
    }
  } else {
    const activation = await activateTariffByPaymentId(payment.id);
    if (activation.ok) await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
  }

  await distributeReferralRewards(payment.id).catch(() => {});

  return res.status(200).send("OK");
});
