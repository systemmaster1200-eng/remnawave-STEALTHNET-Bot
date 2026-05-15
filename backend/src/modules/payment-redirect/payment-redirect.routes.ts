/**
 * Публичный redirect-роут `/api/pay/:orderId`.
 *
 * Зачем: iOS Telegram WebView блокирует/криво рендерит страницы платёжных провайдеров
 * при открытии UrlButton в боте или окне WebApp. Решение — нативный редирект через наш
 * whitelist-нутый домен: бот/фронт дают пользователю URL `https://panel.../api/pay/<id>`,
 * этот роут делает HTTP 302 на реальную ссылку платёжки, Telegram открывает её в Safari.
 */

import { Router } from "express";
import { prisma } from "../../db.js";

export const paymentRedirectRouter = Router();

paymentRedirectRouter.get("/:orderId", async (req, res) => {
  const orderId = String(req.params.orderId || "").trim();
  if (!orderId) {
    return res.status(400).type("text/plain").send("Некорректный orderId");
  }

  const payment = await prisma.payment.findUnique({
    where: { orderId },
    select: { status: true, metadata: true },
  });

  if (!payment) {
    return res.status(404).type("text/plain").send("Платёж не найден");
  }

  if (payment.status === "PAID") {
    return res.status(410).type("text/plain").send("Платёж уже оплачен");
  }
  if (payment.status === "FAILED" || payment.status === "REFUNDED") {
    return res.status(410).type("text/plain").send("Платёж отменён или возвращён");
  }

  let redirectTarget: string | null = null;
  if (payment.metadata) {
    try {
      const meta = JSON.parse(payment.metadata) as Record<string, unknown>;
      if (typeof meta.redirectTargetUrl === "string" && meta.redirectTargetUrl.trim()) {
        redirectTarget = meta.redirectTargetUrl.trim();
      }
    } catch {
      // fallthrough
    }
  }

  if (!redirectTarget) {
    return res.status(410).type("text/plain").send("Ссылка на оплату недоступна");
  }

  return res.redirect(302, redirectTarget);
});
