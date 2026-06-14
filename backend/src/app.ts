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
import { wdttAdminRouter } from "./modules/wdtt/wdtt.admin.routes.js";
import { wdttClientRouter } from "./modules/wdtt/wdtt.client.routes.js";
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
/**
 * CORS origins — динамический список:
 *   1) Если в `.env CORS_ORIGIN` явно задан (не "*") — используется как whitelist
 *      (несколько доменов через запятую).
 *   2) Иначе — auto-derive из `system_settings.public_app_url` (то что админ задал
 *      в настройках сервиса). Запрашивается один раз и кэшируется на 60 секунд.
 *   3) Если ни в env, ни в settings ничего нет — fallback на `*` (для свежих
 *      установок где админ ещё ничего не настроил).
 *
 * Это hardening: из коробки CORS защищён, нужно только публичный URL прописать
 * в админке (что обычно делается в первую очередь для генерации платёжных URL).
 */
let _corsOriginsCache: string[] | null = null;
let _corsOriginsCachedAt = 0;
const CORS_CACHE_TTL_MS = 60_000;

async function getAllowedOrigins(): Promise<string[] | null> {
  // 1) Explicit env wins
  if (env.CORS_ORIGIN && env.CORS_ORIGIN !== "*") {
    return env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
  }
  // 2) Cached
  if (_corsOriginsCache !== null && Date.now() - _corsOriginsCachedAt < CORS_CACHE_TTL_MS) {
    return _corsOriginsCache.length > 0 ? _corsOriginsCache : null;
  }
  // 3) Read from system_settings.publicAppUrl
  try {
    const { getSystemConfig } = await import("./modules/client/client.service.js");
    const cfg = await getSystemConfig();
    const url = cfg.publicAppUrl?.trim();
    if (url) {
      try {
        const u = new URL(url);
        _corsOriginsCache = [`${u.protocol}//${u.host}`];
      } catch {
        _corsOriginsCache = [];
      }
    } else {
      _corsOriginsCache = [];
    }
  } catch {
    _corsOriginsCache = [];
  }
  _corsOriginsCachedAt = Date.now();
  return _corsOriginsCache.length > 0 ? _corsOriginsCache : null;
}

app.use(cors({
  origin: (origin, callback) => {
    getAllowedOrigins().then((allowed) => {
      // null = ничего не настроено → разрешаем всё (fallback для свежей установки)
      if (allowed === null) return callback(null, true);
      // Запрос без Origin (curl/Postman/server-to-server) — разрешаем
      if (!origin) return callback(null, true);
      // Whitelist — origin должен быть в списке
      callback(null, allowed.includes(origin));
    }).catch((err) => callback(err));
  },
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

// Админка: логин и 2FA — жёсткий лимит по IP.
// 20 попыток / 15 мин — достаточно для опечаток и менеджеров паролей,
// но ломает любой brute-force. skipSuccessfulRequests: верный пароль
// не уменьшает квоту, чтобы легитимный пользователь не блокировал
// сам себя из-за ошибочных попыток.
const authStrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: dev ? 1000 : 20,
  skipSuccessfulRequests: true,
  message: { message: "Слишком много попыток входа. Попробуйте через 15 минут." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", authStrictLimiter);
app.use("/api/auth/2fa-login", authStrictLimiter);

// Клиент: регистрация — 5/мин/IP с откатом 60 секунд.
// ВАЖНО: запросы от Telegram-бота пропускаются (skip): бот стучится в API
// от своего IP и без skip все регистрации через /start блокируются —
// все клиенты выглядят как «один IP» для лимитера. Telegram сам по себе
// антибот-щит (нужен аккаунт + подписка), доверяем X-Telegram-Bot-Token header.

// общий хелпер: запросы из docker-network (бот-контейнер,
// внутренние крон-сервисы) НЕ лимитим. Используется во ВСЕХ rate-limit'ерах ниже.
function isInternalIp(ip: string | undefined): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  const m = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = parseInt(m[1]!, 10);
  const b = parseInt(m[2]!, 10);
  return a === 172 && b >= 16 && b <= 31;
}

const clientRegisterLimiter = rateLimit({
  windowMs: 60 * 1000, // 60 секунд
  max: dev ? 500 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Запросы из docker-network (бот) — без лимита.
    if (isInternalIp(req.ip)) return true;
    // Если в заголовке есть наш bot-token — пропускаем лимит.
    // Валидность токена проверяется дальше в /register самим хэндлером.
    const t = req.headers["x-telegram-bot-token"];
    return typeof t === "string" && t.length > 10;
  },
  handler: (req, res) => {
    // express-rate-limit складывает время сброса в req.rateLimit.resetTime
    type RL = { resetTime?: Date };
    const rl = (req as unknown as { rateLimit?: RL }).rateLimit;
    const resetAt = rl?.resetTime instanceof Date ? rl.resetTime.getTime() : Date.now() + 60_000;
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({
      message: `Слишком много регистраций с этого IP. Попробуйте через ${retryAfter} сек.`,
      retryAfter,
      resetAt: new Date(resetAt).toISOString(),
    });
  },
});
app.use("/api/client/auth/register", clientRegisterLimiter);

// Клиент: логин по email/паролю — 20/15 мин/IP, как у админа
const clientLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: dev ? 1000 : 20,
  skipSuccessfulRequests: true,
  message: { message: "Слишком много попыток входа. Попробуйте через 15 минут." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isInternalIp(req.ip),
});
app.use("/api/client/auth/login", clientLoginLimiter);
app.use("/api/client/auth/2fa-login", clientLoginLimiter);

// Клиент: вход через Telegram Mini App (создание аккаунта или логин)
const clientTelegramMiniappLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: dev ? 1000 : 1500,
  message: { message: "Too many attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isInternalIp(req.ip),
});
app.use("/api/client/auth/telegram-miniapp", clientTelegramMiniappLimiter);

// Клиент: OAuth (Google, Apple) — ограничение от перебора
const clientOAuthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: dev ? 1000 : 300,
  message: { message: "Too many OAuth attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isInternalIp(req.ip),
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
  skip: (req) => isInternalIp(req.ip),
});
app.use("/api/client/auth", clientAuthLimiter);

// Общий лимит на весь API (по IP: каждый клиент/NAT имеет свой счётчик).
// `skip` для internal IPs см. isInternalIp() выше.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: dev ? 2000 : 1500,
  message: { message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isInternalIp(req.ip),
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
  // Версию не отдаём — fingerprint resistance. Внутренний мониторинг получает её
  // через защищённый эндпоинт `/api/admin/version` (требует auth).
  res.json({ status: "ok" });
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
// adminReferralsRouter (/referrals/network) ДОЛЖЕН
// идти ПЕРЕД adminRouter (/api/admin), иначе GET /referrals/network перехватывается роутом
// /referrals/:id в adminRouter (id="network") → 404 «Клиент не найден». Граф «Реф. сеть» был сломан.
// Специфичные под-роуты (lookup, :id, :id/referrer) живут в adminRouter и резолвятся через next().
app.use("/api/admin/referrals", adminReferralsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin/traffic-abuse", trafficAbuseRouter);
app.use("/api/admin/api-keys", apiKeysAdminRouter);
app.use("/api/admin/geo-map", geoMapRouter);
app.use("/api/admin/contests", contestAdminRouter);
app.use("/api/admin/proxy", proxyAdminRouter);
app.use("/api/admin/singbox", singboxAdminRouter);
app.use("/api/admin/wdtt", wdttAdminRouter);
app.use("/api/proxy-nodes", proxyAgentRouter);
app.use("/api/singbox-nodes", singboxAgentRouter);
app.use("/api/client", clientRouter);
app.use("/api/client/wdtt", wdttClientRouter);
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
