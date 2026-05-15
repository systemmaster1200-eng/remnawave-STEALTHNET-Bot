import express from "express";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/index.js";
import { authRouter } from "./modules/auth/index.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { proxyAdminRouter } from "./modules/proxy/proxy.admin.routes.js";
import { proxyAgentRouter } from "./modules/proxy/proxy.agent.routes.js";
import { singboxAdminRouter } from "./modules/singbox/singbox.admin.routes.js";
import { singboxAgentRouter } from "./modules/singbox/singbox.agent.routes.js";
import { clientRouter, publicConfigRouter } from "./modules/client/client.routes.js";
import { remnaWebhooksRouter } from "./modules/webhooks/remna.webhooks.routes.js";
import { plategaWebhooksRouter } from "./modules/webhooks/platega.webhooks.routes.js";
import { yoomoneyWebhooksRouter } from "./modules/webhooks/yoomoney.webhooks.routes.js";
import { yookassaWebhooksRouter } from "./modules/webhooks/yookassa.webhooks.routes.js";
import { cryptopayWebhooksRouter } from "./modules/webhooks/cryptopay.webhooks.routes.js";
import { heleketWebhooksRouter } from "./modules/webhooks/heleket.webhooks.routes.js";
import { lavaWebhooksRouter } from "./modules/webhooks/lava.webhooks.routes.js";
import { lavatopWebhooksRouter } from "./modules/webhooks/lavatop.webhooks.routes.js";
import { botAdminRouter } from "./modules/bot-admin/bot-admin.routes.js";
import { botAdminRouter as botsAdminCrudRouter, botInternalRouter } from "./modules/bot/bot.routes.js";
import { contestAdminRouter } from "./modules/contest/contest.admin.routes.js";
import { contestPublicRouter, contestClientRouter } from "./modules/contest/contest.public.routes.js";
import { adminReferralsRouter } from "./modules/admin/referrals.routes.js";
import { trafficAbuseRouter } from "./modules/admin/traffic-abuse.routes.js";
import { apiKeysAdminRouter } from "./modules/api-keys/api-keys.admin.routes.js";
import { externalApiRouter } from "./modules/api-keys/external-api.routes.js";
import { geoMapRouter } from "./modules/geo-map/geo-map.routes.js";
import { giftRouter, giftPublicRouter } from "./modules/gift/gift.routes.js";
import { paymentRedirectRouter } from "./modules/payment-redirect/payment-redirect.routes.js";
import { marketplaceClientRouter } from "./modules/marketplace/marketplace.client.routes.js";
import { marketplaceHubRouter } from "./modules/marketplace/marketplace.hub.routes.js";
import { marketplaceHubAdminRouter } from "./modules/marketplace/marketplace.hub.admin.routes.js";
import { getMarketplaceRuntime } from "./modules/marketplace/marketplace.runtime.js";
import { landingAdminRouter } from "./modules/landing/landing.admin.routes.js";
import { landingPublicRouter } from "./modules/landing/landing.public.routes.js";
import { auditAdminRouter } from "./modules/audit/audit.routes.js";
import { webhookInboxAdminRouter } from "./modules/webhook-inbox/webhook-inbox.routes.js";
import { diagnosticsAdminRouter } from "./modules/diagnostics/diagnostics.routes.js";
import { quickSearchAdminRouter } from "./modules/quick-search/quick-search.routes.js";
import { adminSecurityRouter } from "./modules/auth/admin-security.routes.js";
import { notificationsCountersRouter } from "./modules/notifications-counters/notifications-counters.routes.js";
import { paymentActionsRouter } from "./modules/payment-actions/payment-actions.routes.js";
import { clientsBulkRouter } from "./modules/clients-bulk/clients-bulk.routes.js";
import { businessAnalyticsRouter } from "./modules/business-analytics/business-analytics.routes.js";
import { promoBulkRouter } from "./modules/promo-bulk/promo-bulk.routes.js";
import { tariffCsvRouter } from "./modules/tariff-csv/tariff-csv.routes.js";
import { antiFraudRouter } from "./modules/anti-fraud/anti-fraud.routes.js";
import { adminPermissionsRouter } from "./modules/admin-permissions/admin-permissions.routes.js";
import { emailTemplatesRouter } from "./modules/email-templates/email-templates.routes.js";
import { botMessagesRouter } from "./modules/bot-messages/bot-messages.routes.js";
import { botConversationsRouter } from "./modules/bot-conversations/bot-conversations.routes.js";
import { requireAuth } from "./modules/auth/middleware.js";
import { renderSpaIndex } from "./modules/branding/spa-html.js";

const app = express();

// За nginx: иначе express-rate-limit падает из-за X-Forwarded-For
app.set("trust proxy", 1);

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({
  origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
}));
// Crypto Pay, Heleket и Lava webhooks нужен raw body для проверки подписи (до express.json)
app.use("/api/webhooks/cryptopay", express.raw({ type: "application/json" }), cryptopayWebhooksRouter);
app.use("/api/webhooks/heleket", express.raw({ type: "application/json" }), heleketWebhooksRouter);
app.use("/api/webhooks/lava", express.raw({ type: "application/json" }), lavaWebhooksRouter);
// Platega — HMAC проверяет raw body. Apply path-specific raw middleware ДО express.json,
// чтобы плательщик мог проверить подпись над оригинальными байтами. Сам router смонтирован
// ниже на /api/webhooks (где у него уже есть `.post("/platega", ...)`).
app.use("/api/webhooks/platega", express.raw({ type: "application/json" }));

// Лимит 5MB для настроек с логотипом и favicon (data URL)
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ——— Защита от накрутки аккаунтов и перебора ———
const dev = process.env.NODE_ENV === "development";

// Админка: логин и 2FA — жёсткий лимит по IP
const authStrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: dev ? 1000 : 2000,
  message: { message: "Too many login attempts" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", authStrictLimiter);
app.use("/api/auth/2fa-login", authStrictLimiter);

// Клиент: регистрация — сильно ограничить с одного IP
const clientRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: dev ? 500 : 500,
  message: { message: "Too many registration attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/client/auth/register", clientRegisterLimiter);

// Клиент: вход через Telegram Mini App (создание аккаунта или логин)
const clientTelegramMiniappLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: dev ? 1000 : 1500,
  message: { message: "Too many attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/client/auth/telegram-miniapp", clientTelegramMiniappLimiter);

// Клиент: OAuth (Google, Apple) — ограничение от перебора
const clientOAuthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: dev ? 1000 : 300,
  message: { message: "Too many OAuth attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/client/auth/google", clientOAuthLimiter);
app.use("/api/client/auth/apple", clientOAuthLimiter);

// Клиент: все auth-эндпоинты (логин, verify-email, 2fa и т.д.) — общий лимит
const clientAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: dev ? 2000 : 600,
  message: { message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/client/auth", clientAuthLimiter);

// Общий лимит на весь API (по IP: каждый клиент/NAT имеет свой счётчик)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: dev ? 2000 : 1500,
  message: { message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

// Gift public endpoint: 5 attempts per minute per IP (brute force protection)
const giftPublicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: dev ? 100 : 5,
  message: { message: "Слишком много попыток. Подождите минуту." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/gift/public", giftPublicLimiter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "4.2.1" });
});

// SSR-рендер index.html с подстановкой имени из брендинга (Telegram preview).
// Дёргается nginx'ом для `/`, `/index.html` и SPA-фоллбэка.
app.get("/_spa", renderSpaIndex);

// Статика для загруженных файлов (маскоты, видео)
app.use("/api/uploads", express.static(path.join("/app/uploads"), {
  maxAge: "30d",
  immutable: true,
}));

// Маркетплейс между админами: всегда монтируем, но хаб-роуты включаются только
// если runtime-роль = hub (см. requireHubRole).
async function requireHubRole(_req: express.Request, res: express.Response, next: express.NextFunction) {
  const rt = await getMarketplaceRuntime();
  if (!rt.enabled) return res.status(404).json({ message: "Marketplace disabled" });
  if (rt.role !== "hub") return res.status(404).json({ message: "This installation is not the marketplace hub" });
  next();
}
async function requireMarketplaceEnabled(_req: express.Request, res: express.Response, next: express.NextFunction) {
  const rt = await getMarketplaceRuntime();
  if (!rt.enabled) return res.status(404).json({ message: "Marketplace disabled" });
  next();
}
app.use("/api/marketplace", requireHubRole, marketplaceHubRouter);
app.use("/api/admin/marketplace/hub", requireAuth, requireHubRole, marketplaceHubAdminRouter);
app.use("/api/admin/marketplace", requireMarketplaceEnabled, marketplaceClientRouter);

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin/referrals", adminReferralsRouter);
app.use("/api/admin/traffic-abuse", trafficAbuseRouter);
app.use("/api/admin/api-keys", apiKeysAdminRouter);
app.use("/api/admin/geo-map", geoMapRouter);
app.use("/api/admin/contests", contestAdminRouter);
app.use("/api/admin/proxy", proxyAdminRouter);
app.use("/api/admin/singbox", singboxAdminRouter);
app.use("/api/proxy-nodes", proxyAgentRouter);
app.use("/api/singbox-nodes", singboxAgentRouter);
app.use("/api/client", clientRouter);
app.use("/api/client/contests", contestClientRouter);
app.use("/api/client/gift", giftRouter);
app.use("/api/gift/public", giftPublicRouter);
app.use("/api/admin/landing", landingAdminRouter);
app.use("/api/admin/audit", auditAdminRouter);
app.use("/api/admin/webhook-inbox", webhookInboxAdminRouter);
app.use("/api/admin/diagnostics", diagnosticsAdminRouter);
app.use("/api/admin/quick-search", quickSearchAdminRouter);
app.use("/api/admin/security", adminSecurityRouter);
app.use("/api/admin/notifications", notificationsCountersRouter);
app.use("/api/admin/payments", paymentActionsRouter);
app.use("/api/admin/clients", clientsBulkRouter);
app.use("/api/admin/business-analytics", businessAnalyticsRouter);
app.use("/api/admin/promo-codes", promoBulkRouter);
// CSV-импорт принимает text/csv ИЛИ application/json — express.json() выше
// уже разбирает JSON, добавляем text-parser для text/csv параллельно.
app.use("/api/admin/tariffs-csv", express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }), tariffCsvRouter);
app.use("/api/admin/anti-fraud", antiFraudRouter);
app.use("/api/admin/admin-permissions", adminPermissionsRouter);
app.use("/api/admin/email-templates", emailTemplatesRouter);
app.use("/api/admin/bot-messages", botMessagesRouter);
app.use("/api/admin/bot-conversations", botConversationsRouter);
app.use("/api/public", publicConfigRouter);
app.use("/api/public", contestPublicRouter);
app.use("/api/public", landingPublicRouter);
app.use("/api/pay", paymentRedirectRouter);
app.use("/api/v1", externalApiRouter);
app.use("/api/bot-admin", botAdminRouter);
app.use("/api/admin/bots", botsAdminCrudRouter);
app.use("/api/internal", botInternalRouter);
app.use("/api/webhooks", remnaWebhooksRouter);
app.use("/api/webhooks", plategaWebhooksRouter); // raw body для /platega уже применён выше
app.use("/api/webhooks", yoomoneyWebhooksRouter);
app.use("/api/webhooks", yookassaWebhooksRouter);
// cryptopay уже смонтирован выше с raw body
// Lava.top использует X-Api-Key вместо HMAC, поэтому raw body не нужен — обычный JSON
app.use("/api/webhooks/lavatop", lavatopWebhooksRouter);

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

export default app;
