/**
 * HTTP-уведомления ЮMoney о входящих переводах (оплата картой).
 * Пополнение баланса (без tariffId) → зачисляем на баланс клиента.
 * Покупка тарифа (есть tariffId) → активируем тариф в Remnawave, баланс не трогаем.
 * Проверка подлинности: SHA1(notification_type&operation_id&amount&currency&datetime&sender&codepro&notification_secret&label)
 */

import { Router } from "express";
import { createHash } from "crypto";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";

function hasExtraOptionInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj?.extraOption != null && typeof obj.extraOption === "object";
  } catch {
    return false;
  }
}
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";

export const yoomoneyWebhooksRouter = Router();

/** Как в Panel: GET для проверки доступности URL в настройках ЮMoney */
yoomoneyWebhooksRouter.get("/yoomoney", (_req, res) => {
  res.status(200).json({ status: "ok", message: "YooMoney webhook is available" });
});

function pickFirst(val: unknown): string {
  if (val == null) return "";
  if (Array.isArray(val)) return String(val[0] ?? "").trim();
  return String(val).trim();
}

function computeSha1(
  notificationType: string,
  operationId: string,
  amount: string,
  currency: string,
  datetime: string,
  sender: string,
  codepro: string,
  notificationSecret: string,
  label: string
): string {
  const str = [
    notificationType,
    operationId,
    amount,
    currency,
    datetime,
    sender,
    codepro,
    notificationSecret,
    label,
  ].join("&");
  return createHash("sha1").update(str, "utf8").digest("hex");
}

yoomoneyWebhooksRouter.post("/yoomoney", async (req, res) => {
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  if (Object.keys(body).length === 0) {
    console.warn("[YooMoney Webhook] Empty body — проверьте Content-Type (должен быть application/x-www-form-urlencoded) и что nginx не съедает тело запроса");
    return res.status(200).send("OK");
  }

  const notificationType = pickFirst(body.notification_type);
  const operationId = pickFirst(body.operation_id);
  const amountRaw = body.amount;
  const amount = Array.isArray(amountRaw) ? String(amountRaw[0] ?? "") : typeof amountRaw === "number" ? String(amountRaw) : String(amountRaw ?? "");
  const currency = pickFirst(body.currency);
  const datetime = pickFirst(body.datetime);
  const sender = pickFirst(body.sender);
  const codeproRaw = body.codepro;
  const codeproStr = Array.isArray(codeproRaw) ? String(codeproRaw[0] ?? "false") : codeproRaw === true || codeproRaw === "true" ? "true" : "false";
  let label = pickFirst(body.label);
  if (!label) label = pickFirst(body.order_id) || pickFirst(body.orderId) || pickFirst(body.custom);
  const sha1Hash = pickFirst(body.sha1_hash);
  const unaccepted = pickFirst(body.unaccepted).toLowerCase();

  console.log("[YooMoney Webhook] Incoming", {
    keys: Object.keys(body),
    notification_type: notificationType,
    operation_id: operationId,
    amount,
    label: label ? `${label.slice(0, 12)}…` : "(empty)",
    codepro: codeproStr,
    unaccepted: unaccepted || "(empty)",
  });

  if (!notificationType || !operationId || !amount || !sha1Hash) {
    console.warn("[YooMoney Webhook] Missing required fields", { keys: Object.keys(body) });
    return res.status(400).send("Bad request");
  }

  if (codeproStr === "true") {
    console.log("[YooMoney Webhook] Ignored: codepro=true (protected transfer)");
    return res.status(200).send("OK");
  }
  if (unaccepted && unaccepted !== "false") {
    console.log("[YooMoney Webhook] Ignored: unaccepted=", unaccepted);
    return res.status(200).send("OK");
  }

  const config = await getSystemConfig();
  const secret = config.yoomoneyNotificationSecret?.trim();
  if (!secret) {
    console.warn("[YooMoney Webhook] yoomoney_notification_secret not configured");
    return res.status(500).send("Server configuration error");
  }

  const expectedHash = computeSha1(
    notificationType,
    operationId,
    amount,
    currency,
    datetime,
    sender,
    codeproStr,
    secret,
    label
  );
  if (expectedHash.toLowerCase() !== sha1Hash.toLowerCase()) {
    console.warn("[YooMoney Webhook] Invalid sha1_hash", { expected: expectedHash.slice(0, 8) + "…", received: sha1Hash.slice(0, 8) + "…" });
    return res.status(403).send("Invalid signature");
  }

  if (!label.trim()) {
    console.warn("[YooMoney Webhook] Empty label, cannot match payment");
    return res.status(200).send("OK");
  }

  const labelNorm = label.trim();

  // Как в Panel: ищем сначала по id (мы пишем payment.id в label), потом по orderId, потом по operation_id
  type PaymentRow = {
    id: string;
    clientId: string;
    botId: string | null;
    amount: number;
    tariffId: string | null;
    proxyTariffId: string | null;
    singboxTariffId: string | null;
    status: string;
    metadata: string | null;
  };
  let payment: PaymentRow | null = null;

  const paymentSelect = {
    id: true,
    clientId: true,
    botId: true,
    amount: true,
    tariffId: true,
    proxyTariffId: true,
    singboxTariffId: true,
    status: true,
    metadata: true,
  } as const;
  // 1) По payment.id (наш label при создании = payment.id)
  payment = await prisma.payment.findFirst({
    where: { id: labelNorm, provider: "yoomoney_form" },
    select: paymentSelect,
  });

  // 2) По orderId (как в Panel: label = order_id)
  if (!payment) {
    payment = await prisma.payment.findFirst({
      where: { orderId: labelNorm, provider: "yoomoney_form" },
      select: paymentSelect,
    });
  }

  // 3) По operation_id как externalId
  if (!payment && operationId) {
    payment = await prisma.payment.findFirst({
      where: { externalId: operationId, provider: "yoomoney_form" },
      select: paymentSelect,
    });
  }

  if (!payment) {
    console.warn("[YooMoney Webhook] Payment not found", { label: labelNorm, operationId });
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  if (payment.status === "PAID") {
    console.log("[YooMoney Webhook] Payment already processed", { paymentId: payment.id });
    return res.status(200).send("OK");
  }

  const amountNum = parseFloat(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(200).send("OK");
  }

  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption;

  if (isTopUp) {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: "PAID", paidAt: new Date(), externalId: operationId },
      }),
      prisma.client.update({
        where: { id: payment.clientId },
        data: { balance: { increment: amountNum } },
      }),
    ]);
    console.log("[YooMoney Webhook] Payment PAID, balance credited (top-up)", {
      paymentId: payment.id,
      clientId: payment.clientId,
      amount: amountNum,
      operationId,
      notificationType,
    });
    await notifyBalanceToppedUp(payment.clientId, amountNum, currency || "RUB", "YooMoney").catch(() => {});
  } else {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date(), externalId: operationId },
    });
    await recordPromoCodeUsageFromPayment(payment.id);
    console.log("[YooMoney Webhook] Payment PAID (tariff/option)", { paymentId: payment.id, operationId, notificationType });

    if (isExtraOption) {
      const result = await applyExtraOptionByPaymentId(payment.id);
      if (result.ok) {
        console.log("[YooMoney Webhook] Extra option applied", { paymentId: payment.id });
      } else {
        console.error("[YooMoney Webhook] Extra option apply failed", { paymentId: payment.id, error: (result as { error?: string }).error });
      }
    } else if (payment.proxyTariffId) {
      const proxyResult = await createProxySlotsByPaymentId(payment.id);
      if (proxyResult.ok) {
        console.log("[YooMoney Webhook] Proxy slots created", { paymentId: payment.id, slots: proxyResult.slotsCreated });
        const tariff = await prisma.proxyTariff.findUnique({ where: { id: payment.proxyTariffId }, select: { name: true } });
        await notifyProxySlotsCreated(payment.clientId, proxyResult.slotIds, tariff?.name ?? undefined).catch(() => {});
      } else {
        console.error("[YooMoney Webhook] Proxy slots creation failed", { paymentId: payment.id, error: proxyResult.error });
      }
    } else if (payment.singboxTariffId) {
      const singboxResult = await createSingboxSlotsByPaymentId(payment.id);
      if (singboxResult.ok) {
        console.log("[YooMoney Webhook] Singbox slots created", { paymentId: payment.id, slots: singboxResult.slotsCreated });
        const tariff = await prisma.singboxTariff.findUnique({ where: { id: payment.singboxTariffId }, select: { name: true } });
        await notifySingboxSlotsCreated(payment.clientId, singboxResult.slotIds, tariff?.name ?? undefined).catch(() => {});
      } else {
        console.error("[YooMoney Webhook] Singbox slots creation failed", { paymentId: payment.id, error: singboxResult.error });
      }
    } else {
      const activation = await activateTariffByPaymentId(payment.id);
      if (activation.ok) {
        console.log("[YooMoney Webhook] Tariff activated", { paymentId: payment.id });
        await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
      } else {
        console.error("[YooMoney Webhook] Tariff activation failed", { paymentId: payment.id, error: (activation as { error?: string }).error });
      }
    }
  }

  await distributeReferralRewards(payment.id).catch((e) => {
    console.error("[YooMoney Webhook] Referral distribution error", { paymentId: payment.id, error: e });
  });

  return res.status(200).send("OK");
});
