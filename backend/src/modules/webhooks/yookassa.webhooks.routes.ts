/**
 * Webhook ЮKassa — уведомления о статусе платежа (JSON).
 * Событие payment.succeeded: помечаем платёж PAID, активируем тариф или зачисляем баланс, рефералы.
 * Документация: https://yookassa.ru/developers/using-api/webhooks
 *
 * Аутентификация:
 * - YooKassa поддерживает HTTP Basic Auth на webhook URL. Админ настраивает это в кабинете
 *   ЮKassa: webhook URL вида https://user:pass@panel.example.com/api/webhooks/yookassa.
 *   Админ задаёт `yookassa_webhook_basic_user` / `yookassa_webhook_basic_password` в админке.
 * - Дополнительно: после прохождения basic-auth мы делаем double-check через YooKassa API
 *   (`GET /payments/:id`) — не доверяем event'у из webhook'а напрямую, ограничивает SSRF-риск.
 *   (Реализован отдельно в yookassa.service.ts; здесь только проверяем статус.)
 */

import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { createNalogReceipt } from "../nalog/nalog.service.js";
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

export const yookassaWebhooksRouter = Router();

yookassaWebhooksRouter.get("/yookassa", (_req, res) => {
  res.status(200).json({ status: "ok", message: "YooKassa webhook is available" });
});

type YookassaNotification = {
  type?: string;
  event?: string;
  object?: {
    id?: string;
    status?: string;
    amount?: { value?: string; currency?: string };
    metadata?: Record<string, string>;
    payment_method?: {
      type?: string;
      id?: string;
      saved?: boolean;
      title?: string;
      card?: { last4?: string; card_type?: string };
    };
  };
};

/**
 * Constant-time-сравнение двух строк через timingSafeEqual.
 * Возвращает false при разных длинах — это безопасно (длина ожидаемой строки не секрет).
 */
function safeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Проверяет HTTP Basic Auth заголовок против `yookassa_webhook_basic_user/password`
 * из system_settings. Возвращает true если все ОК или basic-auth выключен (нет пароля).
 *
 * SECURITY: если в админке не задан пароль — webhook принимается без проверки (legacy).
 * Чтобы включить — заходишь в админку → Платежи → ЮKassa → задаёшь user+password,
 * затем в кабинете ЮKassa прописываешь URL вида `https://USER:PASS@panel.example.com/...`.
 * Когда пароль задан — все запросы без или с неверным auth получают 401.
 */
async function verifyYookassaWebhookAuth(req: { headers: Record<string, unknown> }): Promise<{ ok: boolean; reason?: string }> {
  const config = await getSystemConfig();
  const expectedUser = (config as { yookassaWebhookBasicUser?: string | null }).yookassaWebhookBasicUser?.trim();
  const expectedPass = (config as { yookassaWebhookBasicPassword?: string | null }).yookassaWebhookBasicPassword?.trim();

  // Не настроено — legacy mode, пропускаем (но громко предупреждаем).
  if (!expectedUser || !expectedPass) {
    console.warn("[YooKassa Webhook] BASIC AUTH NOT CONFIGURED — webhook accepted without verification. Set yookassaWebhookBasicUser / yookassaWebhookBasicPassword in admin settings.");
    return { ok: true, reason: "no_credentials_configured" };
  }

  const authHeader = (req.headers["authorization"] ?? req.headers["Authorization"]) as string | undefined;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return { ok: false, reason: "missing_basic_auth" };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return { ok: false, reason: "invalid_base64" };
  }

  const colonIdx = decoded.indexOf(":");
  if (colonIdx < 0) return { ok: false, reason: "invalid_format" };
  const gotUser = decoded.slice(0, colonIdx);
  const gotPass = decoded.slice(colonIdx + 1);

  if (!safeStringEqual(gotUser, expectedUser) || !safeStringEqual(gotPass, expectedPass)) {
    return { ok: false, reason: "wrong_credentials" };
  }
  return { ok: true };
}

yookassaWebhooksRouter.post("/yookassa", async (req, res) => {
  // ВАЖНО: проверка аутентификации ПЕРЕД любыми DB-операциями.
  const auth = await verifyYookassaWebhookAuth(req);
  if (!auth.ok) {
    console.warn(`[YooKassa Webhook] Auth failed: ${auth.reason}`);
    res.set("WWW-Authenticate", 'Basic realm="yookassa-webhook"');
    return res.status(401).json({ message: "Unauthorized" });
  }

  let body: YookassaNotification = {};
  if (req.body && typeof req.body === "object") {
    body = req.body as YookassaNotification;
  }
  if (!body.object?.metadata?.payment_id) {
    console.warn("[YooKassa Webhook] Missing or invalid body/object/metadata.payment_id", {
      hasBody: !!req.body,
      event: body.event,
    });
    return res.status(200).send("OK");
  }

  const event = body.event ?? "";
  const paymentId = body.object?.metadata?.payment_id?.trim();
  if (!paymentId) {
    return res.status(200).send("OK");
  }

  if (event !== "payment.succeeded") {
    console.log("[YooKassa Webhook] Ignored event", { event, paymentId });
    return res.status(200).send("OK");
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, provider: "yookassa" },
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
    console.warn("[YooKassa Webhook] Payment not found", { paymentId });
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  if (payment.status === "PAID") {
    console.log("[YooKassa Webhook] Already processed", { paymentId });
    return res.status(200).send("OK");
  }

  const yookassaId = body.object?.id ?? null;
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PAID", paidAt: new Date(), externalId: yookassaId },
  });
  await recordPromoCodeUsageFromPayment(payment.id);

  // Сохраняем способ оплаты для рекуррентных платежей
  const pm = body.object?.payment_method;
  if (pm?.saved && pm.id) {
    const title = pm.title || (pm.card?.last4 ? `Карта *${pm.card.last4}` : pm.type || "Сохранённый способ");
    await prisma.client.update({
      where: { id: payment.clientId },
      data: {
        yookassaPaymentMethodId: pm.id,
        yookassaPaymentMethodTitle: title,
      },
    });
    console.log("[YooKassa Webhook] Saved payment method", {
      clientId: payment.clientId,
      paymentMethodId: pm.id,
      title,
    });
  }

  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption;

  if (isTopUp) {
    await prisma.client.update({
      where: { id: payment.clientId },
      data: { balance: { increment: payment.amount } },
    });
    console.log("[YooKassa Webhook] Payment PAID, balance credited (top-up)", {
      paymentId: payment.id,
      clientId: payment.clientId,
      amount: payment.amount,
    });
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", "YooKassa").catch(() => {});
  } else if (isExtraOption) {
    const result = await applyExtraOptionByPaymentId(payment.id);
    if (result.ok) {
      console.log("[YooKassa Webhook] Extra option applied", { paymentId: payment.id });
    } else {
      console.error("[YooKassa Webhook] Extra option apply failed", {
        paymentId: payment.id,
        error: (result as { error?: string }).error,
      });
    }
  } else if (payment.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(payment.id);
    if (proxyResult.ok) {
      console.log("[YooKassa Webhook] Proxy slots created", { paymentId: payment.id, slots: proxyResult.slotsCreated });
      const tariff = await prisma.proxyTariff.findUnique({ where: { id: payment.proxyTariffId }, select: { name: true } });
      await notifyProxySlotsCreated(payment.clientId, proxyResult.slotIds, tariff?.name ?? undefined).catch(() => {});
    } else {
      console.error("[YooKassa Webhook] Proxy slots creation failed", {
        paymentId: payment.id,
        error: proxyResult.error,
      });
    }
  } else if (payment.singboxTariffId) {
    const singboxResult = await createSingboxSlotsByPaymentId(payment.id);
    if (singboxResult.ok) {
      console.log("[YooKassa Webhook] Singbox slots created", { paymentId: payment.id, slots: singboxResult.slotsCreated });
      const tariff = await prisma.singboxTariff.findUnique({ where: { id: payment.singboxTariffId }, select: { name: true } });
      await notifySingboxSlotsCreated(payment.clientId, singboxResult.slotIds, tariff?.name ?? undefined).catch(() => {});
    } else {
      console.error("[YooKassa Webhook] Singbox slots creation failed", {
        paymentId: payment.id,
        error: singboxResult.error,
      });
    }
  } else {
    const activation = await activateTariffByPaymentId(payment.id);
    if (activation.ok) {
      console.log("[YooKassa Webhook] Tariff activated", { paymentId: payment.id });
      await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
    } else {
      console.error("[YooKassa Webhook] Tariff activation failed", {
        paymentId: payment.id,
        error: (activation as { error?: string }).error,
      });
    }
  }

  await distributeReferralRewards(payment.id).catch((e) => {
    console.error("[YooKassa Webhook] Referral distribution error", { paymentId: payment.id, error: e });
  });

  const tariffForReceipt = payment.tariffId
    ? await prisma.tariff.findUnique({ where: { id: payment.tariffId }, select: { name: true } }).catch(() => null)
    : null;
  const receiptDesc = tariffForReceipt?.name ? `Оплата тарифа «${tariffForReceipt.name}»` : "Пополнение баланса";
  createNalogReceipt({
    paymentId: payment.id,
    amount: payment.amount,
    currency: payment.currency || "RUB",
    description: receiptDesc,
    paidAt: new Date(),
  }).catch((e) => {
    console.warn("[YooKassa Webhook] Nalog receipt error (non-critical):", e);
  });

  return res.status(200).send("OK");
});
