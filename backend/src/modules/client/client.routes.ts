import { randomBytes, createHmac } from "crypto";
import { randomUUID } from "crypto";
import { generateSecret, generateURI, verify } from "otplib";
import { env } from "../../config/index.js";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, createPayment, asClientUncheckedCreate, asClientWhere, asClientSelect, asPaymentUncheckedCreate, asTelegramAuthUpdate, type TelegramAuthTokenRecord, type ClientEmptyCloneRow } from "../../db.js";
import {
  hashPassword,
  verifyPassword,
  signClientToken,
  signClient2FAPendingToken,
  verifyClient2FAPendingToken,
  generateReferralCode,
  getSystemConfig,
  getPublicConfig,
  type SellOptionTrafficProduct,
  type SellOptionDeviceProduct,
  type SellOptionServerProduct,
} from "./client.service.js";
import {
  notifyAdminsAboutClientTicketMessage,
  notifyAdminsAboutNewClient,
  notifyAdminsAboutNewTicket,
} from "../notification/telegram-notify.service.js";
import { requireClientAuth } from "./client.middleware.js";
import { remnaCreateUser, remnaUpdateUser, isRemnaConfigured, remnaGetUser, remnaGetUserByUsername, remnaGetUserByEmail, remnaGetUserByTelegramId, extractRemnaUuid, remnaUsernameFromClient, remnaGetUserHwidDevices, remnaDeleteUserHwidDevice, encryptSubscriptionUrlInPlace, remnaRevokeUserSubscription } from "../remna/remna.client.js";
import { sendVerificationEmail, sendLinkEmailVerification, isSmtpConfigured } from "../mail/mail.service.js";
import { createPlategaTransaction, isPlategaConfigured } from "../platega/platega.service.js";
import { activateTariffForClient, activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { upsertPrimarySubscription, upsertSubscriptionByRemnaUuid } from "../subscription/subscription.helpers.js";
import { saveRedirectAndBuildUrl } from "../payment-redirect/payment-redirect.util.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { buildSingboxSlotSubscriptionLink } from "../singbox/singbox-link.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { getAuthUrl, exchangeCodeForToken, requestPayment, processPayment } from "../yoomoney/yoomoney.service.js";
import { createYookassaPayment } from "../yookassa/yookassa.service.js";
import { createCryptopayInvoice, isCryptopayConfigured } from "../cryptopay/cryptopay.service.js";
import { createHeleketInvoice, isHeleketConfigured } from "../heleket/heleket.service.js";
import { createLavaInvoice, isLavaConfigured } from "../lava/lava.service.js";
import { createLavatopInvoice, isLavatopConfigured } from "../lavatop/lavatop.service.js";
import { createOverpayPayformOrder, isOverpayConfigured } from "../overpay/overpay.service.js";
import { applyPersonalDiscount } from "./personal-discount.js";
import { getBotByToken, getPrimaryBot, paymentSnapshotTopup, paymentSnapshotProduct, applyMarkup } from "../bot/bot.service.js";
import { extractBotTokenFromRequest, optionalBot, type ReqWithBot } from "../bot/bot.middleware.js";
import { uploadTicketAttachment } from "../../lib/upload.js";
import {
  filesToAttachments,
  serializeAttachments,
  parseAttachments,
  pickField,
} from "../ticket/attachments.js";
import { validateEmailForSignup } from "../signup-protection/email-blocklist.js";

/** Извлекает реальный IP клиента (с учётом trust proxy). */
function getRequestIp(req: Request): string | null {
  const ip = req.ip || req.socket?.remoteAddress || null;
  if (!ip) return null;
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/** Извлекает текущий expireAt из ответа Remna. Возвращает Date если в будущем, иначе null. */
function extractCurrentExpireAt(data: unknown): Date | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const resp = (o.response ?? o.data ?? o) as Record<string, unknown>;
  const raw = resp?.expireAt;
  if (typeof raw !== "string") return null;
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.getTime() > Date.now() ? d : null;
  } catch {
    return null;
  }
}

/**
 * вычисляет коэффициент масштабирования цены для доп. устройств.
 * Если в подписке осталось > 30 дней → цена = basePrice × (remainingDays / 30).
 * Иначе минимум = basePrice.
 * Если targetSubId не передан или sub не найдена → коэффициент = 1 (полная цена).
 */
async function calculateDevicesProrataPriceCoefficient(targetSubId: string | null | undefined): Promise<number> {
  if (!targetSubId) return 1;
  const sub = await prisma.subscription.findUnique({
    where: { id: targetSubId },
    select: { expireAt: true },
  }).catch(() => null);
  if (!sub?.expireAt) return 1;
  const daysLeft = (sub.expireAt.getTime() - Date.now()) / 86_400_000;
  return Math.max(1, daysLeft / 30);
}

/**
 * вычисляет коэффициент для primary подписки клиента.
 * Используется когда targetSubscriptionId не передан и нужно применить опцию к primary.
 */
async function calculateDevicesProrataPriceCoefficientForPrimary(clientId: string): Promise<number> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { remnawaveUuid: true },
  }).catch(() => null);
  if (!client?.remnawaveUuid) return 1;
  const primarySub = await prisma.subscription.findFirst({
    where: { ownerId: clientId, remnawaveUuid: client.remnawaveUuid },
    select: { expireAt: true },
  }).catch(() => null);
  if (!primarySub?.expireAt) return 1;
  const daysLeft = (primarySub.expireAt.getTime() - Date.now()) / 86_400_000;
  return Math.max(1, daysLeft / 30);
}

/** Считает expireAt: если текущая подписка активна — добавляет дни к ней, иначе от now. */
function calculateExpireAt(currentExpireAt: Date | null, durationDays: number): string {
  const base = currentExpireAt ?? new Date();
  return new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Определяет, какому Bot-клону принадлежит запрос на регистрацию/логин.
 *
 * Логика:
 *   1) Если в заголовке X-Telegram-Bot-Token есть токен активного клона — используем его.
 *      (это путь из бота: каждый клон шлёт свой токен в API)
 *   2) Иначе — primary bot (это путь из веб-кабинета: webhook'ов, OAuth и т.п.,
 *      где явной привязки к клону нет).
 *
 * Возвращает объект Bot или null, если в БД нет primary бота (broken state — должно
 * быть сделано миграцией). Вызывающий код в случае null возвращает 503.
 */
async function resolveBotForClientRequest(req: { headers: Record<string, unknown> | unknown }) {
  const token = extractBotTokenFromRequest(req as Parameters<typeof extractBotTokenFromRequest>[0]);
  if (token) {
    const fromHeader = await getBotByToken(token);
    if (fromHeader) return fromHeader;
  }
  return getPrimaryBot();
}

export const clientAuthRouter = Router();

const utmSchema = {
  utm_source: z.string().max(255).optional(),
  utm_medium: z.string().max(255).optional(),
  utm_campaign: z.string().max(255).optional(),
  utm_content: z.string().max(255).optional(),
  utm_term: z.string().max(255).optional(),
};

const registerSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  telegramId: z.string().optional(),
  telegramUsername: z.string().optional(),
  preferredLang: z.string().max(5).default("ru"),
  preferredCurrency: z.string().max(5).default("usd"),
  referralCode: z.string().optional(),
  ...utmSchema,
});

clientAuthRouter.post("/register", async (req, res) => {
  const body = registerSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }

  const data = body.data;
  const hasEmail = data.email && data.password;
  const hasTelegram = data.telegramId;

  if (!hasEmail && !hasTelegram) {
    return res.status(400).json({ message: "Provide email+password or telegramId" });
  }

  // Какому клону принадлежит регистрация — определяем по X-Telegram-Bot-Token
  // (бот шлёт свой токен) либо берём primary (веб-регистрация).
  const requestBot = await resolveBotForClientRequest(req);
  if (!requestBot) {
    return res.status(503).json({ message: "Primary bot not configured. Run migrations." });
  }

  // Регистрация по email: создаём ожидание и отправляем письмо с ссылкой
  if (hasEmail) {
    const existing = await prisma.client.findUnique({ where: { email: data.email! } });
    if (existing) return res.status(400).json({ message: "Email already registered" });

    const config = await getSystemConfig();

    // ——— Антибот-защита: блок-лист доменов и паттернов ———
    if (config.signupProtectionEnabled !== false) {
      const check = validateEmailForSignup(data.email!, {
        customDomainBlocklist: config.emailDomainBlocklist ?? "",
        customPatternBlocklist: config.emailPatternBlocklist ?? "",
      });
      if (!check.ok) {
        // Намеренно НЕ говорим конкретно «домен в блок-листе» —
        // чтобы бот не мог попробовать другой домен из ответа.
        return res.status(400).json({ message: "Этот email нельзя использовать для регистрации." });
      }
    }

    // ——— Антибот-защита: лимит регистраций с одного IP ———
    // Окно 60 секунд. Запросы от Telegram-бота (X-Telegram-Bot-Token) пропускаем —
    // иначе все регистрации через /start блокируются (бот стучится от одного IP).
    const clientIp = getRequestIp(req);
    const isFromBot = typeof req.headers["x-telegram-bot-token"] === "string"
      && (req.headers["x-telegram-bot-token"] as string).length > 10;
    if (clientIp && !isFromBot && config.signupProtectionEnabled !== false) {
      const WINDOW_MS = 60_000; // 60 секунд
      const since = new Date(Date.now() - WINDOW_MS);
      const recentFromIp = await prisma.client.count({
        where: { registrationIp: clientIp, createdAt: { gte: since } },
      });
      // Историческое имя поля — 'PerHour', но фактически это лимит на текущее окно (60 сек).
      const maxPerWindow = config.signupMaxPerIpPerHour ?? 3;
      if (recentFromIp >= maxPerWindow) {
        // Считаем когда самая старая регистрация в окне выйдет → resetAt
        const oldest = await prisma.client.findFirst({
          where: { registrationIp: clientIp, createdAt: { gte: since } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        });
        const resetAt = oldest?.createdAt
          ? oldest.createdAt.getTime() + WINDOW_MS
          : Date.now() + WINDOW_MS;
        const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
        res.setHeader("Retry-After", retryAfter);
        return res.status(429).json({
          message: `Слишком много регистраций с этого IP. Попробуйте через ${retryAfter} сек.`,
          retryAfter,
          resetAt: new Date(resetAt).toISOString(),
        });
      }
    }

    // Режим без подтверждения почты — создаём клиента сразу
    if (config.skipEmailVerification) {
      const referralCode = generateReferralCode();
      let referrerId: string | null = null;
      if (data.referralCode) {
        const referrer = await prisma.client.findFirst({ where: { referralCode: data.referralCode } });
        if (referrer) referrerId = referrer.id;
      }
      const passwordHash = await hashPassword(data.password!);
      const client = await prisma.client.create({
        data: asClientUncheckedCreate({
          email: data.email!,
          passwordHash,
          remnawaveUuid: null,
          referralCode,
          referrerId,
          preferredLang: data.preferredLang,
          preferredCurrency: data.preferredCurrency,
          telegramId: null,
          telegramUsername: null,
          utmSource: data.utm_source ?? null,
          utmMedium: data.utm_medium ?? null,
          utmCampaign: data.utm_campaign ?? null,
          utmContent: data.utm_content ?? null,
          utmTerm: data.utm_term ?? null,
          autoRenewEnabled: config.defaultAutoRenewEnabled ?? false,
          onboardingCompleted: false,
          registrationIp: clientIp,
          registrationUa: (req.headers["user-agent"] as string)?.slice(0, 500) ?? null,
          registrationSource: "web",
        }),
      });
      notifyAdminsAboutNewClient(client.id).catch(() => {});
      const token = signClientToken(client.id);
      return res.status(201).json({ token, client: toClientShape(client) });
    }

    const smtpConfig = {
      host: config.smtpHost || "",
      port: config.smtpPort,
      secure: config.smtpSecure,
      user: config.smtpUser,
      password: config.smtpPassword,
      fromEmail: config.smtpFromEmail,
      fromName: config.smtpFromName,
    };
    if (!isSmtpConfigured(smtpConfig)) {
      return res.status(503).json({ message: "Email registration is not configured. Contact administrator." });
    }

    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    if (!appUrl) {
      return res.status(503).json({ message: "Public app URL is not set in settings." });
    }

    const verificationToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 ч

    const referralCode = generateReferralCode();
    let referrerId: string | null = null;
    if (data.referralCode) {
      const referrer = await prisma.client.findFirst({ where: { referralCode: data.referralCode } });
      if (referrer) referrerId = referrer.id;
    }
    const passwordHash = await hashPassword(data.password!);

    await prisma.pendingEmailRegistration.create({
      data: {
        email: data.email!,
        passwordHash,
        preferredLang: data.preferredLang,
        preferredCurrency: data.preferredCurrency,
        referralCode: data.referralCode || null,
        utmSource: data.utm_source ?? null,
        utmMedium: data.utm_medium ?? null,
        utmCampaign: data.utm_campaign ?? null,
        utmContent: data.utm_content ?? null,
        utmTerm: data.utm_term ?? null,
        verificationToken,
        expiresAt,
      },
    });
    // IP/UA сохраним в Client при подтверждении письма (см. /verify-email)
    void clientIp;

    const verificationLink = `${appUrl}/cabinet/verify-email?token=${verificationToken}`;
    const sendResult = await sendVerificationEmail(
      smtpConfig,
      data.email!,
      verificationLink,
      config.serviceName
    );
    console.log(`[register] Email send result to ${data.email}:`, sendResult);
    if (!sendResult.ok) {
      await prisma.pendingEmailRegistration.deleteMany({ where: { verificationToken } }).catch(() => {});
      return res.status(500).json({ message: "Failed to send verification email. Try again later." });
    }

    return res.status(201).json({ message: "Check your email to complete registration", requiresVerification: true });
  }

  // Регистрация / вход по Telegram (используется ботом). 2FA не требуем — только для входа на сайте.
  if (hasTelegram) {
    const existing = await prisma.client.findFirst({
      where: asClientWhere({ telegramId: data.telegramId! }),
      select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
    });
    if (existing) {
      if (!existing.isBlocked) {
        const blConfig = await getSystemConfig();
        if (blConfig.blacklistEnabled) {
          const { checkAndBlockIfBlacklisted } = await import("../blacklist/blacklist.service.js");
          const blocked = await checkAndBlockIfBlacklisted(data.telegramId!);
          if (blocked) return res.status(403).json({ message: "Account is blocked" });
        }
      }
      if (existing.isBlocked) return res.status(403).json({ message: "Account is blocked" });
      // isNewClient=false — клиент уже был
      // (бот не будет fire after_registration broadcast).
      return res.json({ token: signClientToken(existing.id), client: toClientShape(existing), isNewClient: false });
    }
  }

  // Не создаём пользователя в Remna при регистрации — клиент неактивен до триала или оплаты тарифа.
  const referralCode = generateReferralCode();
  let referrerId: string | null = null;
  if (data.referralCode) {
    const referrer = await prisma.client.findFirst({ where: { referralCode: data.referralCode } });
    if (referrer) referrerId = referrer.id;
  }

  const passwordHash = data.password ? await hashPassword(data.password) : null;
  const configForAutoRenew = await getSystemConfig();
  const tgRegIp = getRequestIp(req);
  // для TG-юзеров без email сразу
  // ставим onboardingCompleted=false — пусть привяжет почту через онбординг
  // при первом заходе на сайт. Для остальных оставляем дефолт schema (true).
  const isBareTgUser = !!data.telegramId && !data.email;
  const client = await prisma.client.create({
    data: asClientUncheckedCreate({
      email: data.email ?? null,
      passwordHash,
      remnawaveUuid: null,
      referralCode,
      referrerId,
      preferredLang: data.preferredLang,
      preferredCurrency: data.preferredCurrency,
      telegramId: data.telegramId ?? null,
      telegramUsername: data.telegramUsername ?? null,
      utmSource: data.utm_source ?? null,
      utmMedium: data.utm_medium ?? null,
      utmCampaign: data.utm_campaign ?? null,
      utmContent: data.utm_content ?? null,
      utmTerm: data.utm_term ?? null,
      autoRenewEnabled: configForAutoRenew.defaultAutoRenewEnabled ?? false,
      registrationIp: tgRegIp,
      registrationUa: (req.headers["user-agent"] as string)?.slice(0, 500) ?? null,
      registrationSource: data.telegramId ? "telegram" : "web",
      ...(isBareTgUser ? { onboardingCompleted: false } : {}),
    }),
  });
  notifyAdminsAboutNewClient(client.id).catch(() => {});

  if (data.telegramId) {
    const blConfig2 = await getSystemConfig();
    if (blConfig2.blacklistEnabled) {
      const { checkAndBlockIfBlacklisted } = await import("../blacklist/blacklist.service.js");
      const blocked = await checkAndBlockIfBlacklisted(data.telegramId);
      if (blocked) return res.status(403).json({ message: "Account is blocked" });
    }
  }

  const token = signClientToken(client.id);
  // isNewClient=true — клиент только что создан.
  // Бот после регистрации проверяет флаг и запускает event-driven welcome (after_registration).
  return res.status(201).json({ token, client: toClientShape(client), isNewClient: true });
});

const verifyLinkEmailSchema = z.object({ token: z.string().min(1) });
clientAuthRouter.post("/verify-link-email", async (req, res) => {
  const parse = verifyLinkEmailSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: "Invalid input" });
  const { token } = parse.data;
  const pending = await prisma.pendingEmailLink.findUnique({ where: { verificationToken: token } });
  if (!pending) return res.status(400).json({ message: "Недействительная или просроченная ссылка" });
  if (new Date() > pending.expiresAt) {
    await prisma.pendingEmailLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
    return res.status(400).json({ message: "Ссылка просрочена. Запросите привязку почты снова." });
  }
  const existingByEmail = await prisma.client.findUnique({ where: { email: pending.email } });
  if (existingByEmail && existingByEmail.id !== pending.clientId) {
    await prisma.pendingEmailLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
    return res.status(400).json({ message: "Эта почта уже привязана к другому аккаунту." });
  }
  const client = await prisma.client.update({
    where: { id: pending.clientId },
    data: { email: pending.email },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
  });
  await prisma.pendingEmailLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
  const auth = buildAuthResponse(client);
  return res.json(auth);
});

const verifyEmailSchema = z.object({ token: z.string().min(1) });
clientAuthRouter.post("/verify-email", async (req, res) => {
  const parse = verifyEmailSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: "Invalid input" });
  const { token } = parse.data;

  const pending = await prisma.pendingEmailRegistration.findUnique({
    where: { verificationToken: token },
  });
  if (!pending) return res.status(400).json({ message: "Invalid or expired link" });
  if (new Date() > pending.expiresAt) {
    await prisma.pendingEmailRegistration.delete({ where: { id: pending.id } }).catch(() => {});
    return res.status(400).json({ message: "Link expired. Please register again." });
  }

  const existingClient = await prisma.client.findUnique({
    where: { email: pending.email },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
  });
  if (existingClient) {
    await prisma.pendingEmailRegistration.delete({ where: { id: pending.id } }).catch(() => {});
    const auth = buildAuthResponse(existingClient);
    return res.json(auth);
  }

  // Не создаём пользователя в Remna при регистрации — клиент неактивен до триала или оплаты тарифа.
  const referralCode = generateReferralCode();
  let referrerId: string | null = null;
  if (pending.referralCode) {
    const referrer = await prisma.client.findFirst({ where: { referralCode: pending.referralCode } });
    if (referrer) referrerId = referrer.id;
  }

  // Email-регистрация — всегда primary bot (веб-кабинет, без привязки к клону).
  const primaryBot = await getPrimaryBot();
  if (!primaryBot) {
    return res.status(503).json({ message: "Primary bot not configured. Run migrations." });
  }

  const configForAutoRenew = await getSystemConfig();
  const client = await prisma.client.create({
    data: asClientUncheckedCreate({
      email: pending.email,
      passwordHash: pending.passwordHash,
      remnawaveUuid: null,
      referralCode,
      referrerId,
      preferredLang: pending.preferredLang,
      preferredCurrency: pending.preferredCurrency,
      telegramId: null,
      telegramUsername: null,
      utmSource: pending.utmSource,
      utmMedium: pending.utmMedium,
      utmCampaign: pending.utmCampaign,
      utmContent: pending.utmContent,
      utmTerm: pending.utmTerm,
      autoRenewEnabled: configForAutoRenew.defaultAutoRenewEnabled ?? false,
      onboardingCompleted: false,
      // IP/UA на момент перехода по ссылке из письма (не на момент создания pending —
      // боты обычно не ходят по ссылкам, а если ходят — это уже другой IP, ещё лучше)
      registrationIp: getRequestIp(req),
      registrationUa: (req.headers["user-agent"] as string)?.slice(0, 500) ?? null,
      registrationSource: "web",
    }),
  });

  await prisma.pendingEmailRegistration.delete({ where: { id: pending.id } }).catch(() => {});

  const signToken = signClientToken(client.id);
  return res.status(201).json({ token: signToken, client: toClientShape(client) });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

clientAuthRouter.post("/login", async (req, res) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input" });
  }

  const client = await prisma.client.findUnique({ where: { email: body.data.email } });
  if (!client || !client.passwordHash || client.isBlocked) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const valid = await verifyPassword(body.data.password, client.passwordHash);
  if (!valid) return res.status(401).json({ message: "Invalid email or password" });

  const full = await prisma.client.findUnique({
    where: { id: client.id },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
  });
  if (!full) return res.status(401).json({ message: "Invalid email or password" });
  const auth = buildAuthResponse(full);
  return res.json(auth);
});

/** Валидация initData из Telegram Web App (Mini App). https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
function validateTelegramInitData(initData: string, botToken: string): boolean {
  if (!initData?.trim() || !botToken?.trim()) return false;
  const params = new URLSearchParams(initData.trim());
  const hash = params.get("hash");
  if (!hash) return false;
  params.delete("hash");
  const authDate = params.get("auth_date");
  if (!authDate) return false;
  const authTimestamp = parseInt(authDate, 10);
  if (!Number.isFinite(authTimestamp) || Date.now() / 1000 - authTimestamp > 3600) return false; // не старше 1 часа
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return computedHash === hash;
}

/** Парсинг user из initData (JSON в параметре user) */
function parseTelegramUser(initData: string): { id: number; username?: string } | null {
  const params = new URLSearchParams(initData.trim());
  const userStr = params.get("user");
  if (!userStr) return null;
  try {
    const user = JSON.parse(userStr) as Record<string, unknown>;
    const id = typeof user.id === "number" ? user.id : Number(user.id);
    if (!Number.isFinite(id)) return null;
    const username = typeof user.username === "string" ? user.username : undefined;
    return { id, username };
  } catch {
    return null;
  }
}

const telegramMiniappSchema = z.object({ initData: z.string().min(1) });

clientAuthRouter.post("/telegram-miniapp", async (req, res) => {
  const body = telegramMiniappSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  // v5.0.0: Mini App initData подписан токеном единственного бота инсталляции
  // (process.env.BOT_TOKEN). Раньше проверяли по каждому активному клону.
  const botToken = (process.env.BOT_TOKEN ?? "").trim();
  if (!botToken || !validateTelegramInitData(body.data.initData, botToken)) {
    return res.status(401).json({ message: "Invalid or expired Telegram data" });
  }
  const tgUser = parseTelegramUser(body.data.initData);
  if (!tgUser) return res.status(400).json({ message: "Missing user in init data" });

  const telegramId = String(tgUser.id);
  const telegramUsername = tgUser.username?.trim() ?? null;
  const existing = await prisma.client.findFirst({
    where: asClientWhere({ telegramId }),
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  if (existing) {
    if (existing.isBlocked) return res.status(403).json({ message: "Account is blocked" });
    // см. /telegram-login-check — тот же триггер.
    // passwordHash из условия убран: у бот-юзеров может быть dummy-пароль.
    if (existing.onboardingCompleted && !existing.email) {
      await prisma.client.update({
        where: { id: existing.id },
        data: { onboardingCompleted: false },
      }).catch(() => {});
      existing.onboardingCompleted = false;
    }
    const auth = buildAuthResponse(existing);
    return res.json(auth);
  }

  const configForDefaults = await getSystemConfig();
  // Если Remna-пользователь уже существует (например, создан ботом раньше) — используем его;
  // иначе создаём с remnawaveUuid=null, Remna-юзер будет создан при активации триала / покупке тарифа.
  // Это предотвращает появление «истёкшей подписки» в UI сразу после регистрации.
  let remnawaveUuid: string | null = null;
  if (isRemnaConfigured()) {
    const byTgRes = await remnaGetUserByTelegramId(telegramId);
    remnawaveUuid = extractRemnaUuid(byTgRes.data);
  }
  const referralCode = generateReferralCode();
  // новый TG-юзер без email/пароля → онбординг.
  const client = await prisma.client.create({
    data: asClientUncheckedCreate({
      email: null,
      passwordHash: null,
      remnawaveUuid,
      referralCode,
      referrerId: null,
      preferredLang: configForDefaults.defaultLanguage ?? "ru",
      preferredCurrency: configForDefaults.defaultCurrency ?? "usd",
      telegramId,
      telegramUsername,
      autoRenewEnabled: configForDefaults.defaultAutoRenewEnabled ?? false,
      onboardingCompleted: false,
    }),
  });
  const token = signClientToken(client.id);
  // isNewClient=true — клиент только что создан.
  // Бот после регистрации проверяет флаг и запускает event-driven welcome (after_registration).
  return res.status(201).json({ token, client: toClientShape(client), isNewClient: true });
});

const twoFaLoginSchema = z.object({ tempToken: z.string().min(1), code: z.string().length(6, "Код 6 цифр").regex(/^\d+$/) });
clientAuthRouter.post("/2fa-login", async (req, res) => {
  const body = twoFaLoginSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите 6-значный код", errors: body.error.flatten() });
  const payload = verifyClient2FAPendingToken(body.data.tempToken);
  if (!payload) return res.status(401).json({ message: "Сессия истекла. Войдите снова." });
  const client = await prisma.client.findUnique({
    where: { id: payload.clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpSecret: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
  });
  if (!client?.totpEnabled || !client.totpSecret) return res.status(401).json({ message: "2FA не включена. Войдите снова." });
  const result = await verify({ secret: client.totpSecret, token: body.data.code });
  if (!result.valid) return res.status(401).json({ message: "Неверный код" });
  const token = signClientToken(client.id);
  return res.json({ token, client: toClientShape(client) });
});

clientAuthRouter.get("/me", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const full = await prisma.client.findUnique({
    where: { id: client.id },
    select: {
      id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true,
      balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true,
      autoRenewEnabled: true, autoRenewTariffId: true, autoRenewPromoCode: true, yoomoneyAccessToken: true,
      totpEnabled: true, createdAt: true, yookassaPaymentMethodTitle: true, onboardingCompleted: true, passwordHash: true,
      // «Мои подписки» / Commit 2 — нужен currentTariff для category-aware диалога
      // при покупке тарифа из другой категории (продлить vs сменить vs купить как доп.).
      currentTariffId: true,
      currentTariff: { select: { id: true, name: true, categoryId: true } },
      // нужен боту для расчёта и отображения
      // зачёркнутой базовой цены на экранах выбора платежки и оплаты тарифа.
      personalDiscountPercent: true,
    },
  });
  if (!full) return res.status(401).json({ message: "Unauthorized" });
  return res.json(toClientShape(full));
});

/**
 * event-driven welcome для after_registration
 * правил. Бот вызывает после успешной регистрации нового клиента (`isNewClient=true`
 * из /register). Запускает все enabled rules с triggerType=after_registration.
 *
 * Дедуп тот же что у крон-пути — `(rule_id, client_id)` через autoBroadcastLog.
 * Идемпотентно: повторный вызов для того же клиента отбрасывается дедупом.
 */
clientAuthRouter.post("/fire-on-registration", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  try {
    const { fireRegistrationRulesForClient } = await import("../auto-broadcast/auto-broadcast.service.js");
    const results = await fireRegistrationRulesForClient(client.id);
    const totalSent = results.reduce((s, r) => s + r.sent, 0);
    return res.json({ ok: true, rulesProcessed: results.length, sent: totalSent });
  } catch (e) {
    console.error("[fire-on-registration] failed:", e);
    return res.status(500).json({ ok: false, message: e instanceof Error ? e.message : "Internal error" });
  }
});

function toClientShape(c: {
  id: string;
  email: string | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  preferredLang: string;
  preferredCurrency: string;
  balance: number;
  referralCode: string | null;
  referralPercent?: number | null;
  remnawaveUuid: string | null;
  trialUsed?: boolean;
  isBlocked?: boolean;
  yoomoneyAccessToken?: string | null;
  totpEnabled?: boolean;
  createdAt?: Date;
  autoRenewEnabled?: boolean;
  autoRenewTariffId?: string | null;
  autoRenewPromoCode?: string | null;
  yookassaPaymentMethodTitle?: string | null;
  onboardingCompleted?: boolean;
  passwordHash?: string | null;
  // currentTariff передаётся боту для category-aware диалога.
  currentTariffId?: string | null;
  currentTariff?: { id: string; name: string; categoryId: string | null } | null;
  // бот использует поле для зачёркивания базовой цены.
  personalDiscountPercent?: number | null;
}) {
  return {
    id: c.id,
    email: c.email,
    telegramId: c.telegramId ?? null,
    telegramUsername: c.telegramUsername ?? null,
    preferredLang: c.preferredLang,
    preferredCurrency: c.preferredCurrency,
    balance: c.balance,
    referralCode: c.referralCode,
    referralPercent: c.referralPercent ?? null,
    remnawaveUuid: c.remnawaveUuid,
    trialUsed: c.trialUsed ?? false,
    isBlocked: c.isBlocked ?? false,
    yoomoneyConnected: Boolean(c.yoomoneyAccessToken),
    totpEnabled: c.totpEnabled ?? false,
    createdAt: c.createdAt ? c.createdAt.toISOString() : undefined,
    autoRenewEnabled: c.autoRenewEnabled ?? false,
    autoRenewTariffId: c.autoRenewTariffId ?? null,
    autoRenewPromoCode: c.autoRenewPromoCode ?? null,
    yookassaPaymentMethodTitle: c.yookassaPaymentMethodTitle ?? null,
    onboardingCompleted: c.onboardingCompleted ?? true,
    hasPassword: Boolean(c.passwordHash && c.passwordHash.trim()),
    // используется ботом в pay_tariff handler для category-check.
    currentTariffId: c.currentTariffId ?? null,
    currentTariff: c.currentTariff
      ? { id: c.currentTariff.id, name: c.currentTariff.name, categoryId: c.currentTariff.categoryId ?? null }
      : null,
    // бот рендерит зачёркнутую базовую цену.
    personalDiscountPercent: c.personalDiscountPercent ?? null,
  };
}

/** Если у клиента включена 2FA — возвращаем tempToken для шага ввода кода; иначе — обычные token и client. */
function buildAuthResponse(c: { id: string; totpEnabled?: boolean } & Parameters<typeof toClientShape>[0]) {
  if (c.totpEnabled) {
    return { requires2FA: true as const, tempToken: signClient2FAPendingToken(c.id) };
  }
  return { token: signClientToken(c.id), client: toClientShape(c) };
}

// ——— Google OAuth: фронтенд отправляет id_token, полученный через Sign In With Google ———
const googleAuthSchema = z.object({ idToken: z.string().min(1) });
clientAuthRouter.post("/google", async (req, res) => {
  const parse = googleAuthSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: "Invalid input" });
  const config = await getSystemConfig();
  if (!config.googleLoginEnabled || !config.googleClientId) {
    return res.status(403).json({ message: "Google login is not enabled" });
  }
  let payload: { sub?: string; email?: string; email_verified?: boolean } | undefined;
  try {
    const { OAuth2Client } = await import("google-auth-library");
    const gClient = new OAuth2Client(config.googleClientId);
    const ticket = await gClient.verifyIdToken({
      idToken: parse.data.idToken,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.error("[Google OAuth] verify error:", err);
    return res.status(401).json({ message: "Invalid Google token" });
  }
  if (!payload?.sub) return res.status(401).json({ message: "Invalid Google token" });
  const googleId = payload.sub;
  const googleEmail = payload.email ?? null;

  const existing = await prisma.client.findUnique({
    where: { googleId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
  });
  if (existing) {
    if (existing.isBlocked) return res.status(403).json({ message: "Account is blocked" });
    const auth = buildAuthResponse(existing);
    return res.json(auth);
  }

  if (googleEmail) {
    const byEmail = await prisma.client.findUnique({
      where: { email: googleEmail },
      select: { id: true, email: true, googleId: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
    });
    if (byEmail) {
      if (byEmail.isBlocked) return res.status(403).json({ message: "Account is blocked" });
      await prisma.client.update({ where: { id: byEmail.id }, data: { googleId } });
      const auth = buildAuthResponse(byEmail);
      return res.json(auth);
    }
  }

  const configForDefaults = await getSystemConfig();
  // Если есть Remna-юзер с такой почтой — используем его; иначе оставляем remnawaveUuid=null,
  // Remna-юзер будет создан при активации триала / покупке тарифа.
  let remnawaveUuid: string | null = null;
  if (isRemnaConfigured() && googleEmail?.trim()) {
    const byEmailRes = await remnaGetUserByEmail(googleEmail.trim());
    remnawaveUuid = extractRemnaUuid(byEmailRes.data);
  }
  const referralCode = generateReferralCode();
  const client = await prisma.client.create({
    data: asClientUncheckedCreate({
      email: googleEmail,
      passwordHash: null,
      remnawaveUuid,
      referralCode,
      referrerId: null,
      preferredLang: configForDefaults.defaultLanguage ?? "ru",
      preferredCurrency: configForDefaults.defaultCurrency ?? "usd",
      telegramId: null,
      telegramUsername: null,
      googleId,
      autoRenewEnabled: configForDefaults.defaultAutoRenewEnabled ?? false,
    }),
  });
  const token = signClientToken(client.id);
  // isNewClient=true — клиент только что создан.
  // Бот после регистрации проверяет флаг и запускает event-driven welcome (after_registration).
  return res.status(201).json({ token, client: toClientShape(client), isNewClient: true });
});

// ——— Apple Sign In: фронтенд отправляет id_token (JWT от Apple) ———
const appleAuthSchema = z.object({ idToken: z.string().min(1) });
clientAuthRouter.post("/apple", async (req, res) => {
  const parse = appleAuthSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: "Invalid input" });
  const config = await getSystemConfig();
  if (!config.appleLoginEnabled || !config.appleClientId) {
    return res.status(403).json({ message: "Apple login is not enabled" });
  }

  let appleSub: string | null = null;
  let appleEmail: string | null = null;
  try {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
    const { payload: jwtPayload } = await jwtVerify(parse.data.idToken, APPLE_JWKS, {
      issuer: "https://appleid.apple.com",
      audience: config.appleClientId,
    });
    appleSub = (jwtPayload.sub as string) ?? null;
    appleEmail = (jwtPayload as { email?: string }).email ?? null;
  } catch (err) {
    console.error("[Apple OAuth] verify error:", err);
    return res.status(401).json({ message: "Invalid Apple token" });
  }
  if (!appleSub) return res.status(401).json({ message: "Invalid Apple token" });

  const existing = await prisma.client.findUnique({
    where: { appleId: appleSub },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
  });
  if (existing) {
    if (existing.isBlocked) return res.status(403).json({ message: "Account is blocked" });
    const auth = buildAuthResponse(existing);
    return res.json(auth);
  }

  if (appleEmail) {
    const byEmail = await prisma.client.findUnique({
      where: { email: appleEmail },
      select: { id: true, email: true, appleId: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
    });
    if (byEmail) {
      if (byEmail.isBlocked) return res.status(403).json({ message: "Account is blocked" });
      await prisma.client.update({ where: { id: byEmail.id }, data: { appleId: appleSub } });
      const auth = buildAuthResponse(byEmail);
      return res.json(auth);
    }
  }

  const configForDefaults = await getSystemConfig();
  // Если есть Remna-юзер с такой почтой — используем его; иначе оставляем remnawaveUuid=null,
  // Remna-юзер будет создан при активации триала / покупке тарифа.
  let remnawaveUuid: string | null = null;
  if (isRemnaConfigured() && appleEmail?.trim()) {
    const byEmailRes = await remnaGetUserByEmail(appleEmail.trim());
    remnawaveUuid = extractRemnaUuid(byEmailRes.data);
  }
  const referralCode = generateReferralCode();
  const client = await prisma.client.create({
    data: asClientUncheckedCreate({
      email: appleEmail,
      passwordHash: null,
      remnawaveUuid,
      referralCode,
      referrerId: null,
      preferredLang: configForDefaults.defaultLanguage ?? "ru",
      preferredCurrency: configForDefaults.defaultCurrency ?? "usd",
      telegramId: null,
      telegramUsername: null,
      appleId: appleSub,
      autoRenewEnabled: configForDefaults.defaultAutoRenewEnabled ?? false,
    }),
  });
  const token = signClientToken(client.id);
  // isNewClient=true — клиент только что создан.
  // Бот после регистрации проверяет флаг и запускает event-driven welcome (after_registration).
  return res.status(201).json({ token, client: toClientShape(client), isNewClient: true });
});

// ——— Deep-link Telegram авторизация (tg:// протокол, обходит блокировки) ———

// 1) Генерация одноразового токена для deep-link авторизации
clientAuthRouter.post("/telegram-login-token", async (_req, res) => {
  try {
    // Чистим просроченные токены
    await prisma.telegramAuthToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const token = randomBytes(16).toString("hex"); // 32 hex chars — with "auth_" prefix = 37, well under Telegram's 64-char start param limit
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 минут

    const record = await prisma.telegramAuthToken.create({
      data: { token, expiresAt },
    });

    return res.json({ token: record.token, expiresAt: record.expiresAt.toISOString() });
  } catch (err) {
    console.error("[telegram-login-token] error:", err);
    return res.status(500).json({ message: "Failed to generate auth token" });
  }
});

// 1.5) Native redirect: 302 на https://t.me/BOT?start=auth_TOKEN — обходит блокировку tg:// схемы на iOS Safari/Telegram WebView
clientAuthRouter.get("/telegram-login-redirect", async (req, res) => {
  const { token } = req.query;
  if (typeof token !== "string" || !token.trim()) {
    return res.status(400).send("Missing token");
  }

  try {
    const record = await prisma.telegramAuthToken.findUnique({
      where: { token: token.trim() },
      select: { id: true, expiresAt: true },
    });

    if (!record) return res.status(404).send("Token not found or expired");
    if (record.expiresAt < new Date()) {
      await prisma.telegramAuthToken.delete({ where: { id: record.id } }).catch(() => {});
      return res.status(410).send("Token expired");
    }

    const config = await getSystemConfig();
    const botUsername = (config.telegramBotUsername ?? "").replace(/^@/, "").trim();
    if (!botUsername) return res.status(503).send("Telegram bot not configured");

    const tgUrl = `https://t.me/${encodeURIComponent(botUsername)}?start=auth_${encodeURIComponent(token.trim())}`;
    return res.redirect(302, tgUrl);
  } catch (err) {
    console.error("[telegram-login-redirect] error:", err);
    return res.status(500).send("Internal error");
  }
});

// 2) Поллинг: проверяем, подтвердил ли пользователь токен через бота
clientAuthRouter.get("/telegram-login-check", async (req, res) => {
  const { token } = req.query;
  if (typeof token !== "string" || !token.trim()) {
    return res.status(400).json({ message: "Missing token" });
  }

  try {
    const record = (await prisma.telegramAuthToken.findUnique({
      where: { token: token.trim() },
    })) as TelegramAuthTokenRecord | null;

    if (!record) {
      return res.status(404).json({ message: "Token not found or expired" });
    }

    if (record.expiresAt < new Date()) {
      await prisma.telegramAuthToken.delete({ where: { id: record.id } }).catch(() => {});
      return res.status(410).json({ message: "Token expired" });
    }

    if (!record.confirmedTelegramId) {
      return res.json({ confirmed: false });
    }

    // Токен подтверждён — ищем/создаём клиента
    const telegramId = record.confirmedTelegramId;
    const telegramUsername = record.confirmedUsername ?? null;

    // Удаляем использованный токен
    await prisma.telegramAuthToken.delete({ where: { id: record.id } }).catch(() => {});

    const clientSelect = { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true };

    const existing = await prisma.client.findFirst({
      where: asClientWhere({ telegramId}),
      select: clientSelect,
    });

    if (existing) {
      if (existing.isBlocked) return res.status(403).json({ message: "Account is blocked" });
      // Обновляем username если изменился
      if (telegramUsername && existing.telegramUsername !== telegramUsername) {
        await prisma.client.update({ where: { id: existing.id }, data: { telegramUsername } }).catch(() => {});
      }
      // TG-юзер впервые на сайте без привязанного email.
      // Запускаем онбординг чтобы попросить ввести почту. Условие про passwordHash убрано —
      // у бот-юзеров может быть dummy-пароль (созданный ботом), но они всё равно «голые».
      if (existing.onboardingCompleted && !existing.email) {
        await prisma.client.update({
          where: { id: existing.id },
          data: { onboardingCompleted: false },
        }).catch(() => {});
        existing.onboardingCompleted = false;
      }
      const auth = buildAuthResponse(existing);
      return res.json({ confirmed: true, ...auth });
    }

    // Новый клиент — регистрируем
    const configForDefaults = await getSystemConfig();
    let remnawaveUuid: string | null = null;
    if (isRemnaConfigured()) {
      // Сначала проверяем — может юзер уже есть в Remna (создан ботом или предыдущей попыткой)
      const byTgRes = await remnaGetUserByTelegramId(telegramId);
      remnawaveUuid = extractRemnaUuid(byTgRes.data);

      if (!remnawaveUuid) {
        const username = remnaUsernameFromClient({
          telegramUsername: telegramUsername ?? undefined,
          telegramId,
        });
        const remnaRes = await remnaCreateUser({
          username,
          trafficLimitBytes: 0,
          trafficLimitStrategy: "NO_RESET",
          expireAt: new Date(Date.now() - 1000).toISOString(),
          telegramId: Number(telegramId),
        });
        remnawaveUuid = extractRemnaUuid(remnaRes.data);
        if (remnaRes.error || remnawaveUuid == null) {
          console.error("[Remna] create user (telegram deeplink) failed:", { error: remnaRes.error, status: remnaRes.status, data: remnaRes.data });
          return res.status(503).json({ message: "Сервис временно недоступен. Попробуйте позже." });
        }
      }
    }

    const referralCode = generateReferralCode();
    // новый TG-юзер через сайт → сразу онбординг.
    const client = await prisma.client.create({
      data: asClientUncheckedCreate({
        email: null,
        passwordHash: null,
        remnawaveUuid,
        referralCode,
        referrerId: null,
        preferredLang: configForDefaults.defaultLanguage ?? "ru",
        preferredCurrency: configForDefaults.defaultCurrency ?? "usd",
        telegramId,
        telegramUsername,
        autoRenewEnabled: configForDefaults.defaultAutoRenewEnabled ?? false,
        onboardingCompleted: false,
      }),
    });

    notifyAdminsAboutNewClient(client.id).catch(() => {});
    const jwt = signClientToken(client.id);
    return res.json({ confirmed: true, token: jwt, client: toClientShape(client), justCreated: true });
  } catch (err) {
    console.error("[telegram-login-check] error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
});

// 3) Подтверждение токена ботом (бот вызывает этот эндпоинт, когда юзер отправляет /start auth_TOKEN)
clientAuthRouter.post("/telegram-login-confirm", async (req, res) => {
  // v5.0.0: токен бота один (BOT_TOKEN из env).
  const receivedBotToken = (req.headers["x-telegram-bot-token"] as string ?? "").trim();
  const expectedToken = (process.env.BOT_TOKEN ?? "").trim();
  if (!receivedBotToken || !expectedToken || receivedBotToken !== expectedToken) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  const { token, telegramId, telegramUsername } = req.body ?? {};
  if (typeof token !== "string" || !token.trim()) {
    return res.status(400).json({ message: "Missing token" });
  }
  if (telegramId == null) {
    return res.status(400).json({ message: "Missing telegramId" });
  }

  try {
    const record = await prisma.telegramAuthToken.findUnique({
      where: { token: token.trim() },
    });

    if (!record) {
      return res.status(404).json({ message: "Token not found" });
    }

    if (record.expiresAt < new Date()) {
      await prisma.telegramAuthToken.delete({ where: { id: record.id } }).catch(() => {});
      return res.status(410).json({ message: "Token expired" });
    }

    if (record.confirmedTelegramId) {
      return res.status(409).json({ message: "Token already confirmed" });
    }

    await prisma.telegramAuthToken.update({
      where: { id: record.id },
      data: asTelegramAuthUpdate({
        confirmedTelegramId: String(telegramId),
        confirmedUsername: telegramUsername ? String(telegramUsername) : null,
      }),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[telegram-login-confirm] error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
});

// Единый роутер /api/client: /auth (логин, регистрация, me) + кабинет (подписка, платежи)
export const clientRouter = Router();
clientRouter.use("/auth", clientAuthRouter);

// ЮMoney OAuth callback — без авторизации клиента (редирект с ЮMoney)
function yoomoneyStateSign(clientId: string): string {
  const payload = JSON.stringify({ clientId });
  const sig = createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
  return Buffer.from(payload, "utf8").toString("base64url") + "." + sig;
}
function yoomoneyStateVerify(state: string): string | null {
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { clientId?: string };
    if (!payload?.clientId) return null;
    const expected = createHmac("sha256", env.JWT_SECRET).update(JSON.stringify({ clientId: payload.clientId })).digest("base64url");
    if (sig !== expected) return null;
    return payload.clientId;
  } catch {
    return null;
  }
}

clientRouter.get("/yoomoney/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const config = await getSystemConfig();
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const redirectFail = appUrl ? `${appUrl}/cabinet?yoomoney=error` : "/";
  if (!code?.trim() || !state?.trim()) {
    return res.redirect(302, redirectFail);
  }
  const clientId = yoomoneyStateVerify(state);
  if (!clientId) {
    return res.redirect(302, redirectFail);
  }
  const redirectUri = appUrl ? `${appUrl}/api/client/yoomoney/callback` : "";
  if (!redirectUri) {
    return res.redirect(302, redirectFail);
  }
  const result = await exchangeCodeForToken({
    code: code.trim(),
    clientId: config.yoomoneyClientId || "",
    redirectUri,
    clientSecret: config.yoomoneyClientSecret,
  });
  if ("error" in result) {
    return res.redirect(302, appUrl ? `${appUrl}/cabinet?yoomoney=error&reason=${encodeURIComponent(result.error)}` : redirectFail);
  }
  await prisma.client.update({
    where: { id: clientId },
    data: { yoomoneyAccessToken: result.access_token },
  });
  const redirectOk = appUrl ? `${appUrl}/cabinet?yoomoney=connected` : redirectFail;
  return res.redirect(302, redirectOk);
});

// ——— Tour Steps (публичные, без авторизации — ПЕРЕД requireClientAuth!) ———
clientRouter.get("/tour-steps", async (_req, res) => {
  try {
    const steps = await prisma.tourStep.findMany({
      where: { isActive: true },
      include: { mascot: { include: { emotions: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return res.json({
      items: steps.map(s => ({
        id: s.id,
        target: s.target,
        targetLabel: s.targetLabel,
        title: s.title,
        content: s.content,
        videoUrl: s.videoUrl,
        placement: s.placement,
        route: s.route,
        mascotId: s.mascotId,
        mood: s.mood,
        sortOrder: s.sortOrder,
        mascot: s.mascot ? {
          id: s.mascot.id, name: s.mascot.name, imageUrl: s.mascot.imageUrl,
          emotions: (s.mascot.emotions ?? []).map((e: { id: string; mood: string; imageUrl: string }) => ({
            id: e.id, mood: e.mood, imageUrl: e.imageUrl,
          })),
        } : null,
      })),
    });
  } catch (e) {
    console.error("GET /tour-steps error:", e);
    return res.status(500).json({ message: "Ошибка загрузки шагов тура" });
  }
});

clientRouter.use(requireClientAuth);

// ——— 2FA (TOTP) ———
const twoFaConfirmSchema = z.object({ code: z.string().length(6, "Код должен быть 6 цифр").regex(/^\d+$/) });
clientRouter.post("/2fa/setup", async (req, res) => {
  const client = (req as unknown as { client: { id: string; email: string | null } }).client;
  const current = await prisma.client.findUnique({ where: { id: client.id }, select: { totpEnabled: true } });
  if (current?.totpEnabled) return res.status(400).json({ message: "2FA уже включена" });
  const secret = generateSecret();
  const label = client.email?.trim() || `client-${client.id}`;
  const otpauthUrl = generateURI({ issuer: "STEALTHNET", label, secret });
  await prisma.client.update({
    where: { id: client.id },
    data: { totpSecret: secret, totpEnabled: false },
  });
  return res.json({ secret, otpauthUrl });
});
clientRouter.post("/2fa/confirm", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const body = twoFaConfirmSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите 6-значный код из приложения", errors: body.error.flatten() });
  const row = await prisma.client.findUnique({ where: { id: client.id }, select: { totpSecret: true, totpEnabled: true } });
  if (!row?.totpSecret) return res.status(400).json({ message: "Сначала запустите настройку 2FA" });
  if (row.totpEnabled) return res.status(400).json({ message: "2FA уже включена" });
  const result = await verify({ secret: row.totpSecret, token: body.data.code });
  if (!result.valid) return res.status(400).json({ message: "Неверный код. Проверьте время на устройстве." });
  await prisma.client.update({
    where: { id: client.id },
    data: { totpEnabled: true },
  });
  return res.json({ message: "Двухфакторная аутентификация включена" });
});
clientRouter.post("/2fa/disable", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const body = twoFaConfirmSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите 6-значный код из приложения", errors: body.error.flatten() });
  const row = await prisma.client.findUnique({ where: { id: client.id }, select: { totpSecret: true, totpEnabled: true } });
  if (!row?.totpEnabled || !row.totpSecret) return res.status(400).json({ message: "2FA не включена" });
  const result = await verify({ secret: row.totpSecret, token: body.data.code });
  if (!result.valid) return res.status(400).json({ message: "Неверный код" });
  await prisma.client.update({
    where: { id: client.id },
    data: { totpSecret: null, totpEnabled: false },
  });
  return res.json({ message: "Двухфакторная аутентификация отключена" });
});

// ——— Change Password ———
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: z.string().min(6, "Минимум 6 символов"),
});

clientRouter.post("/change-password", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string; passwordHash: string | null } }).client;
  const body = changePasswordSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }

  // Получаем актуальный passwordHash из базы
  const clientData = await prisma.client.findUnique({
    where: { id: client.id },
    select: { passwordHash: true },
  });

  if (!clientData?.passwordHash) {
    return res.status(400).json({ message: "У вас нет пароля. Используйте вход через Telegram или Email." });
  }

  const valid = await verifyPassword(body.data.currentPassword, clientData.passwordHash);
  if (!valid) {
    return res.status(400).json({ message: "Неверный текущий пароль" });
  }

  const newPasswordHash = await hashPassword(body.data.newPassword);
  await prisma.client.update({
    where: { id: client.id },
    data: { passwordHash: newPasswordHash },
  });

  return res.json({ message: "Пароль успешно изменён" });
});

const setPasswordSchema = z.object({
  newPassword: z.string().min(6, "Минимум 6 символов"),
});

clientRouter.post("/set-password", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string; passwordHash: string | null } }).client;
  const body = setPasswordSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }

  const clientData = await prisma.client.findUnique({
    where: { id: client.id },
    select: { passwordHash: true, onboardingCompleted: true },
  });

  // Разрешаем установку пароля если: пароля нет ИЛИ онбоардинг не завершён (dummy-пароль от email-регистрации)
  if (clientData?.passwordHash && clientData.onboardingCompleted) {
    return res.status(400).json({ message: "Пароль уже установлен. Используйте смену пароля." });
  }

  const newPasswordHash = await hashPassword(body.data.newPassword);
  await prisma.client.update({
    where: { id: client.id },
    data: { passwordHash: newPasswordHash },
  });

  return res.json({ message: "Пароль установлен" });
});

clientRouter.post("/complete-onboarding", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  await prisma.client.update({
    where: { id: client.id },
    data: { onboardingCompleted: true },
  });
  return res.json({ message: "Onboarding завершён" });
});

const updateProfileSchema = z.object({
  preferredLang: z.string().max(10).optional(),
  preferredCurrency: z.string().max(10).optional(),
});

clientRouter.patch("/profile", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const body = updateProfileSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const updates: { preferredLang?: string; preferredCurrency?: string } = {};
  if (body.data.preferredLang !== undefined) updates.preferredLang = body.data.preferredLang;
  if (body.data.preferredCurrency !== undefined) updates.preferredCurrency = body.data.preferredCurrency;
  if (Object.keys(updates).length === 0) {
    const current = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, createdAt: true, onboardingCompleted: true } });
    return res.json(current ? toClientShape(current) : { message: "Not found" });
  }
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: updates,
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, createdAt: true, onboardingCompleted: true },
  });
  return res.json(toClientShape(updated));
});

const updateAutoRenewSchema = z.object({
  enabled: z.boolean().optional(),
  tariffId: z.string().nullable().optional(),
  promoCode: z.string().max(50).nullable().optional(),
});

clientRouter.patch("/auto-renew", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const body = updateAutoRenewSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });

  const updates: {
    autoRenewEnabled?: boolean;
    autoRenewTariffId?: string | null;
    autoRenewPriceOptionId?: string | null;
    autoRenewExtraDevices?: number;
    autoRenewPromoCode?: string | null;
  } = {};
  if (body.data.enabled !== undefined) updates.autoRenewEnabled = body.data.enabled;
  if (body.data.tariffId !== undefined) updates.autoRenewTariffId = body.data.tariffId;

  // При включении автопродления (без явного tariffId) — авто-подтягиваем контекст из последнего
  // успешного тарифного платежа: тариф + опция длительности + кол-во доп. устройств. Без этого
  // плашка «следующее списание» не появится для клиентов, которые до изменений уже включали
  // автопродление, но мы не сохраняли priceOption / extras.
  if (body.data.enabled === true && body.data.tariffId === undefined) {
    const lastPaid = await prisma.payment.findFirst({
      where: { clientId: client.id, status: "PAID", tariffId: { not: null } },
      orderBy: { paidAt: "desc" },
      select: { tariffId: true, tariffPriceOptionId: true, deviceCount: true },
    });
    if (lastPaid?.tariffId) {
      updates.autoRenewTariffId = lastPaid.tariffId;
      updates.autoRenewPriceOptionId = lastPaid.tariffPriceOptionId;
      updates.autoRenewExtraDevices = lastPaid.deviceCount ?? 0;
    } else {
      // Нет тарифной истории — fallback на currentTariffId.
      const cur = await prisma.client.findUnique({
        where: { id: client.id },
        select: { currentTariffId: true },
      });
      if (cur?.currentTariffId) updates.autoRenewTariffId = cur.currentTariffId;
    }
  }

  if (body.data.promoCode !== undefined) {
    const code = body.data.promoCode?.trim() ?? "";
    // Пустая строка = удалить промокод из автопродления.
    if (!code) {
      updates.autoRenewPromoCode = null;
    } else {
      // Валидируем DISCOUNT-промокод прежде чем сохранять.
      const result = await validatePromoCode(code, client.id);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      if (result.promo.type !== "DISCOUNT") return res.status(400).json({ message: "Для автопродления нужен промокод со скидкой" });
      updates.autoRenewPromoCode = code;
    }
  }

  if (Object.keys(updates).length === 0) {
    const current = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, autoRenewPromoCode: true, createdAt: true, onboardingCompleted: true, passwordHash: true } });
    return res.json(current ? toClientShape(current) : { message: "Not found" });
  }

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: updates,
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, autoRenewPromoCode: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  return res.json(toClientShape(updated));
});

/** Запросить код для привязки Telegram через бота (аккаунт без Telegram, залогинен по почте) */
clientRouter.post("/link-telegram-request", async (req, res) => {
  const client = (req as unknown as { client: { id: string; telegramId: string | null } }).client;
  if (client.telegramId) return res.status(400).json({ message: "Telegram уже привязан" });
  await prisma.pendingTelegramLink.deleteMany({ where: { clientId: client.id } });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.pendingTelegramLink.create({
    data: { clientId: client.id, code, expiresAt },
  });
  const config = await getSystemConfig();
  const botUsername = (config.telegramBotUsername ?? "").replace(/^@/, "") || null;
  return res.json({ code, expiresAt: expiresAt.toISOString(), botUsername });
});

/** Привязать Telegram из Mini App (initData от Telegram WebApp) */
const linkTelegramSchema = z.object({ initData: z.string().min(1) });
clientRouter.post("/link-telegram", async (req, res) => {
  const client = (req as unknown as { client: { id: string; telegramId: string | null } }).client;
  if (client.telegramId) return res.status(400).json({ message: "Telegram уже привязан" });
  const body = linkTelegramSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  // v5.0.0: initData подписан токеном единственного бота инсталляции.
  const botToken = (process.env.BOT_TOKEN ?? "").trim();
  if (!botToken || !validateTelegramInitData(body.data.initData, botToken)) {
    return res.status(401).json({ message: "Недействительные или устаревшие данные Telegram" });
  }
  const tgUser = parseTelegramUser(body.data.initData);
  if (!tgUser) return res.status(400).json({ message: "Нет данных пользователя" });
  const telegramId = String(tgUser.id);
  const telegramUsername = tgUser.username?.trim() ?? null;
  const other = (await prisma.client.findFirst({
    where: asClientWhere({ telegramId}),
    select: asClientSelect({
      id: true,
      email: true,
      passwordHash: true,
      googleId: true,
      appleId: true,
      remnawaveUuid: true,
      balance: true,
      _count: { select: { payments: true, ownedSubscriptions: true } },
    }),
  })) as ClientEmptyCloneRow | null;
  if (other && other.id !== client.id) {
    // Проверяем: "другой" клиент — это пустой автосоздавшийся через /start в боте
    // (нет email/OAuth/пароля, без платежей, без дополнительных подписок, нулевой баланс)?
    // Если да — безопасно удаляем и переносим telegramId (и remnawaveUuid, если есть) на текущего.
    const isEmptyBotClone =
      !other.email &&
      !other.passwordHash &&
      !other.googleId &&
      !other.appleId &&
      other.balance === 0 &&
      other._count.payments === 0 &&
      other._count.ownedSubscriptions === 0;
    if (!isEmptyBotClone) {
      return res.status(409).json({ message: "Этот Telegram-аккаунт уже привязан к другому аккаунту. Сначала войдите в тот аккаунт и отвяжите Telegram, либо обратитесь в поддержку." });
    }
    // Сливаем: переносим remnawaveUuid (если есть и у нас пусто) и удаляем пустого клона.
    const keepRemna = other.remnawaveUuid ?? null;
    await prisma.$transaction(async (tx) => {
      await tx.client.delete({ where: { id: other.id } });
      await tx.client.update({
        where: { id: client.id },
        data: {
          telegramId,
          telegramUsername,
          // Только если у текущего клиента нет своего remnawaveUuid — берём из клона.
          ...(keepRemna ? { remnawaveUuid: { set: keepRemna } } : {}),
        },
      });
    }).catch(async (e) => {
      console.error("[link-telegram] merge failed:", e);
      // Фолбэк: если транзакция упала, попробуем без переноса remnawaveUuid.
      await prisma.client.update({ where: { id: client.id }, data: { telegramId, telegramUsername } });
    });
    // Если у текущего клиента уже был свой remnawaveUuid — не перезаписываем его клоновым.
    const current = await prisma.client.findUnique({ where: { id: client.id }, select: { remnawaveUuid: true } });
    if (current?.remnawaveUuid && keepRemna && current.remnawaveUuid !== keepRemna) {
      // Уже был свой uuid, транзакция выше его перезаписала — откатываем на родной.
      // (Это крайний edge case, нормальный путь: у текущего клиента uuid=null, клон имеет uuid, берём клоновый.)
      await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: current.remnawaveUuid } });
    }
  } else {
    await prisma.client.update({ where: { id: client.id }, data: { telegramId, telegramUsername } });
  }
  const updated = await prisma.client.findUnique({
    where: { id: client.id },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  if (!updated) return res.status(500).json({ message: "Не удалось привязать Telegram" });
  return res.json({ client: toClientShape(updated) });
});

/**
 * мгновенная привязка email БЕЗ верификации.
 * Используется когда SMTP не настроен или skipEmailVerification=true в админке.
 * В обоих случаях нет смысла слать письмо — либо нельзя, либо не требуется.
 */
const linkEmailDirectSchema = z.object({ email: z.string().email() });
clientRouter.post("/link-email-direct", async (req, res) => {
  const client = (req as unknown as { client: { id: string; email: string | null } }).client;
  if (client.email?.trim()) return res.status(400).json({ message: "Почта уже привязана" });
  const body = linkEmailDirectSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Некорректный email", errors: body.error.flatten() });
  const email = body.data.email.trim().toLowerCase();

  // Защита от обхода: метод работает только если SMTP не настроен ИЛИ
  // skipEmailVerification=true. Иначе админ хочет полноценную верификацию.
  const config = await getSystemConfig();
  const smtpConfig = {
    host: config.smtpHost || "",
    port: config.smtpPort ?? 587,
    secure: config.smtpSecure ?? false,
    user: config.smtpUser ?? null,
    password: config.smtpPassword ?? null,
    fromEmail: config.smtpFromEmail ?? null,
    fromName: config.smtpFromName ?? null,
  };
  const smtpOk = isSmtpConfigured(smtpConfig);
  if (smtpOk && !config.skipEmailVerification) {
    return res.status(400).json({ message: "Требуется верификация. Используйте /link-email-request." });
  }

  const existing = await prisma.client.findUnique({ where: { email } });
  if (existing && existing.id !== client.id) {
    return res.status(400).json({ message: "Эта почта уже используется другим аккаунтом" });
  }

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { email },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true },
  });
  return res.json({ message: "Почта привязана", client: toClientShape(updated) });
});

/** Запросить привязку email (отправить письмо со ссылкой) */
const linkEmailRequestSchema = z.object({ email: z.string().email() });
clientRouter.post("/link-email-request", async (req, res) => {
  const client = (req as unknown as { client: { id: string; email: string | null } }).client;
  if (client.email?.trim()) return res.status(400).json({ message: "Почта уже привязана" });
  const body = linkEmailRequestSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Некорректный email", errors: body.error.flatten() });
  const email = body.data.email.trim().toLowerCase();
  const config = await getSystemConfig();
  const smtpConfig = {
    host: config.smtpHost || "",
    port: config.smtpPort ?? 587,
    secure: config.smtpSecure ?? false,
    user: config.smtpUser ?? null,
    password: config.smtpPassword ?? null,
    fromEmail: config.smtpFromEmail ?? null,
    fromName: config.smtpFromName ?? null,
  };
  if (!isSmtpConfigured(smtpConfig)) return res.status(503).json({ message: "Отправка писем не настроена. Обратитесь в поддержку." });
  const existing = await prisma.client.findUnique({ where: { email } });
  if (existing && existing.id !== client.id) return res.status(400).json({ message: "Эта почта уже используется другим аккаунтом" });
  await prisma.pendingEmailLink.deleteMany({ where: { clientId: client.id } });
  const verificationToken = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.pendingEmailLink.create({
    data: { clientId: client.id, email, verificationToken, expiresAt },
  });
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const verificationLink = appUrl ? `${appUrl}/cabinet/verify-link-email?token=${verificationToken}` : "";
  if (!verificationLink) return res.status(500).json({ message: "Не задан URL приложения в настройках" });
  const sendResult = await sendLinkEmailVerification(smtpConfig, email, verificationLink, config.serviceName ?? "STEALTHNET");
  if (!sendResult.ok) {
    await prisma.pendingEmailLink.deleteMany({ where: { verificationToken } }).catch(() => {});
    return res.status(500).json({ message: "Не удалось отправить письмо. Попробуйте позже." });
  }
  return res.json({ message: "Письмо с ссылкой отправлено на указанный email" });
});

clientRouter.get("/referral-stats", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const c = await prisma.client.findUnique({
    where: { id: client.id },
    select: {
      referralCode: true,
      referralPercent: true,
      balance: true,
      _count: { select: { referrals: true } },
    },
  });
  if (!c) return res.status(404).json({ message: "Not found" });
  const config = await getSystemConfig();
  const referralPercent: number = c.referralPercent ?? (config.defaultReferralPercent ?? 0);

  // расширенная статистика по эталону клиента.
  // - Доход L1 / L2 — отдельно по уровню (ReferralCredit.level)
  // - Купили = кол-во рефералов с хотя бы одной PAID-оплатой
  // - L2 invites = кол-во рефералов чьи рефералы → нам в L2
  // - Spent = SUM(Payment.amount) где clientId=me AND status=PAID AND provider=balance (потрачено с баланса)
  // - Withdrawn = SUM(WithdrawalRequest.amount) где APPROVED (если есть таблица; иначе 0)
  const [l1Sum, l2Sum, paidReferrals, l1Refs, totalSpent] = await Promise.all([
    prisma.referralCredit.aggregate({ where: { referrerId: client.id, level: 1 }, _sum: { amount: true } }),
    prisma.referralCredit.aggregate({ where: { referrerId: client.id, level: 2 }, _sum: { amount: true } }),
    prisma.client.count({
      where: { referrerId: client.id, payments: { some: { status: "PAID" } } },
    }),
    prisma.client.findMany({
      where: { referrerId: client.id },
      select: { id: true },
    }),
    prisma.payment.aggregate({
      where: { clientId: client.id, status: "PAID", provider: "balance" },
      _sum: { amount: true },
    }),
  ]);
  const l1Ids = l1Refs.map((r) => r.id);
  const l2InvitesCount = l1Ids.length > 0
    ? await prisma.client.count({ where: { referrerId: { in: l1Ids } } })
    : 0;

  // Withdrawal — если таблица существует. Безопасно через try/catch (миграция может ещё не накатиться).
  let totalWithdrawn = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = await (prisma as any).withdrawalRequest?.aggregate?.({
      where: { clientId: client.id, status: "APPROVED" },
      _sum: { amount: true },
    });
    totalWithdrawn = w?._sum?.amount ?? 0;
  } catch {
    totalWithdrawn = 0;
  }

  const l1Earned = l1Sum._sum.amount ?? 0;
  const l2Earned = l2Sum._sum.amount ?? 0;
  const totalEarned = l1Earned + l2Earned;

  return res.json({
    referralCode: c.referralCode,
    referralPercent,
    referralPercentLevel2: config.referralPercentLevel2 ?? 0,
    referralPercentLevel3: config.referralPercentLevel3 ?? 0,
    referralCount: c._count.referrals,
    // T-fix (11.05.2026): расширенная статистика
    l1Clicks: c._count.referrals, // переходов = кол-во зарегистрированных по ссылке
    l1Purchased: paidReferrals,
    l1Earned,
    l2InvitesCount,
    l2Earned,
    totalEarned,
    totalWithdrawn,
    totalSpent: totalSpent._sum.amount ?? 0,
    availableBalance: c.balance,
    // Back-compat:
    totalEarnings: totalEarned,
  });
});

// создание заявки на вывод реф. баланса (USDT TRC20).
// Минимум 3000₽. При создании баланс замораживается (decrement) — при reject
// админом средства возвращаются. При approve — клиенту приходит уведомление.
const withdrawCreateSchema = z.object({
  amount: z.number().positive().min(3000, "Минимальная сумма вывода — 3000₽").max(1e7),
  walletTrc20: z.string().min(20).max(64).regex(/^T[A-Za-z0-9]{33}$/, "Некорректный TRC20-адрес (должен начинаться с T)"),
});
clientRouter.post("/withdrawals", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const parsed = withdrawCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Некорректные данные", errors: parsed.error.flatten() });
  }
  const { amount, walletTrc20 } = parsed.data;

  // Атомарный debit — либо есть баланс >= amount, либо отказ.
  const debit = await prisma.client.updateMany({
    where: { id: clientId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (debit.count === 0) {
    const c = await prisma.client.findUnique({ where: { id: clientId }, select: { balance: true } });
    return res.status(400).json({ message: `Недостаточно средств. Доступно: ${(c?.balance ?? 0).toFixed(2)}₽` });
  }

  const wr = await prisma.withdrawalRequest.create({
    data: { clientId, amount, walletTrc20, status: "PENDING" },
  });

  // Notify админам в Telegram.
  try {
    const { notifyAdminsAboutWithdrawal } = await import("../notification/telegram-notify.service.js");
    await notifyAdminsAboutWithdrawal(wr.id).catch(() => {});
  } catch {
    // Если notify-функции ещё нет — просто молча; админ увидит заявку в UI.
  }

  return res.json({
    message: "Заявка отправлена. Ожидайте подтверждения администратора.",
    id: wr.id,
    amount,
    walletTrc20,
    status: wr.status,
  });
});

// История заявок клиента.
clientRouter.get("/withdrawals", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const items = await prisma.withdrawalRequest.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return res.json({ items });
});

clientRouter.post("/trial", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null; trialUsed: boolean; email: string | null; telegramId: string | null; telegramUsername?: string | null } }).client;
  if (client.trialUsed) {
    return res.status(400).json({ message: "Бесплатный тест уже использован" });
  }
  const config = await getSystemConfig();
  const trialDays = config.trialDays ?? 0;
  const trialSquadUuid = config.trialSquadUuid?.trim() || null;
  if (trialDays <= 0 || !trialSquadUuid) {
    return res.status(503).json({ message: "Бесплатный тест не настроен" });
  }
  if (!isRemnaConfigured()) {
    return res.status(503).json({ message: "Сервис временно недоступен" });
  }

  const trafficLimitBytes = config.trialTrafficLimitBytes ?? 0;
  const hwidDeviceLimit = config.trialDeviceLimit ?? null;

  let workingUuid = client.remnawaveUuid;

  if (workingUuid) {
    const checkRes = await remnaGetUser(workingUuid);
    if (checkRes.error || !checkRes.data) {
      console.warn(`[trial] Remna user ${workingUuid} not found (status ${checkRes.status}), will re-create`);
      workingUuid = null;
      await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: null } });
    }
  }

  if (workingUuid) {
    const userRes = await remnaGetUser(workingUuid);
    const currentExpireAt = extractCurrentExpireAt(userRes.data);

    // Защита от перезаписи платной подписки: если у клиента уже активна подписка
    // (expireAt в будущем) с непустыми squads, которые НЕ равны [trialSquadUuid],
    // значит действует платный/подарочный тариф. Триал не должен затирать его параметры
    // (squads, traffic limit, device limit).
    const resp = (userRes.data && typeof userRes.data === "object"
      ? ((userRes.data as Record<string, unknown>).response ?? (userRes.data as Record<string, unknown>).data ?? userRes.data)
      : null) as Record<string, unknown> | null;
    const currentSquadsRaw = Array.isArray(resp?.activeInternalSquads) ? (resp?.activeInternalSquads as unknown[]) : [];
    const currentSquads: string[] = [];
    for (const s of currentSquadsRaw) {
      const u = s && typeof s === "object" && "uuid" in s ? (s as Record<string, unknown>).uuid : s;
      if (typeof u === "string") currentSquads.push(u);
    }
    const hasActivePaidSub =
      currentExpireAt != null &&
      currentSquads.length > 0 &&
      !(currentSquads.length === 1 && currentSquads[0] === trialSquadUuid);
    if (hasActivePaidSub) {
      return res.status(400).json({
        message: "Бесплатный тест нельзя активировать — у вас уже есть активная подписка.",
      });
    }

    // Тут была дыра: middleware подсасывает trialUsed=false и кладёт его в req.client.
    // Между проверкой `if (client.trialUsed)` сверху и финальным update'ом флага
    // на самом дне хендлера — сотни мс на Remna API. За это время второй запрос
    // успевает влезть с тем же стейтом и сделать ещё один триал. Юзеры так
    // активировали по 2 триала параллельно (см. отчёт о баге).
    //
    // Фикс — атомик flip на уровне SQL: UPDATE ... WHERE trialUsed = false.
    // PG лочит строку и сериализует — кому повезло, у того count = 1, остальные
    // получают 0 и идут лесом с 409.
    const trialGuardA = await prisma.client.updateMany({
      where: { id: client.id, trialUsed: false },
      data: { trialUsed: true },
    });
    if (trialGuardA.count === 0) {
      return res.status(409).json({ message: "Бесплатный тест уже активирован" });
    }

    const expireAt = calculateExpireAt(currentExpireAt, trialDays);

    const updateRes = await remnaUpdateUser({
      uuid: workingUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [trialSquadUuid],
    });
    if (updateRes.error) {
      // Remna кинула — откатываем флаг, пусть юзер ретраит. Иначе мы у него
      // отняли триал, а активации не сделали — на ровном месте обидится.
      await prisma.client.update({ where: { id: client.id }, data: { trialUsed: false } }).catch(() => {});
      return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
    }

    // материализуем подписку для триала в ПЕРВЫЙ СВОБОДНЫЙ
    // слот (0, 1, 2…). Если триал переактивируется на том же Remna-юзере — UPDATE, не дубль.
    await upsertSubscriptionByRemnaUuid(client.id, {
      remnawaveUuid: workingUuid,
      // Триал не привязан к конкретному тарифу — tariffId=null.
      // trialId здесь null (триал из system config, не из таблицы Trial).
    }).catch((e) => console.error("[trial] upsertSubscriptionByRemnaUuid failed:", e));
  } else {
    let existingUuid: string | null = null;
    let currentExpireAt: Date | null = null;
    if (client.telegramId?.trim()) {
      const byTgRes = await remnaGetUserByTelegramId(client.telegramId.trim());
      existingUuid = extractRemnaUuid(byTgRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byTgRes.data);
    }
    if (!existingUuid && client.email?.trim()) {
      const byEmailRes = await remnaGetUserByEmail(client.email.trim());
      existingUuid = extractRemnaUuid(byEmailRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byEmailRes.data);
    }
    const displayUsername = remnaUsernameFromClient({
      telegramUsername: client.telegramUsername,
      telegramId: client.telegramId,
      email: client.email,
      clientIdFallback: client.id,
    });
    if (!existingUuid) {
      const byUsernameRes = await remnaGetUserByUsername(displayUsername);
      existingUuid = extractRemnaUuid(byUsernameRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byUsernameRes.data);
    }

    // Та же история, что в ветке выше — флипаем флаг ДО любого побочного
    // эффекта в Remna. Без этого 2 параллельных запроса оба создавали юзера.
    const trialGuardB = await prisma.client.updateMany({
      where: { id: client.id, trialUsed: false },
      data: { trialUsed: true },
    });
    if (trialGuardB.count === 0) {
      return res.status(409).json({ message: "Бесплатный тест уже активирован" });
    }

    const expireAt = calculateExpireAt(currentExpireAt, trialDays);

    if (!existingUuid) {
      const createRes = await remnaCreateUser({
        username: displayUsername,
        trafficLimitBytes,
        trafficLimitStrategy: "NO_RESET",
        expireAt,
        hwidDeviceLimit: hwidDeviceLimit ?? undefined,
        activeInternalSquads: [trialSquadUuid],
        ...(client.telegramId?.trim() && { telegramId: parseInt(client.telegramId, 10) }),
        ...(client.email?.trim() && { email: client.email.trim() }),
      });
      existingUuid = extractRemnaUuid(createRes.data);
    }

    if (!existingUuid) {
      // Remna create обосрался — откатываем флаг, юзер ретраит.
      await prisma.client.update({ where: { id: client.id }, data: { trialUsed: false } }).catch(() => {});
      return res.status(502).json({ message: "Ошибка создания пользователя" });
    }

    await remnaUpdateUser({
      uuid: existingUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [trialSquadUuid],
    });
    workingUuid = existingUuid;
    await prisma.client.update({
      where: { id: client.id },
      data: { remnawaveUuid: existingUuid }, // trialUsed already set by atomic guard
    });

    // подписка для триала в первый свободный слот.
    await upsertSubscriptionByRemnaUuid(client.id, {
      remnawaveUuid: existingUuid,
    }).catch((e) => console.error("[trial] upsertSubscriptionByRemnaUuid failed:", e));

    const updated = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, createdAt: true, onboardingCompleted: true } });
    return res.json({ message: "Бесплатный тест активирован", client: updated ? toClientShape(updated) : null });
  }

  // Финальный update trialUsed убран — атомик guard выше уже всё сделал.
  // Отдельный write был чисто легаси-страховкой.
  const updated = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, createdAt: true, onboardingCompleted: true } });
  return res.json({ message: "Бесплатный тест активирован", client: updated ? toClientShape(updated) : null });
});

/**
 * Список ДОСТУПНЫХ для клиента триалов.
 * Доступный = enabled AND ещё не активированный этим клиентом (нет записи в client_trial_usages).
 *
 * Возвращает массив с tariffName/durationDays/etc для отрисовки кнопок в боте/кабинете.
 * Если массив пустой → клиент использовал ВСЕ триалы (или их вообще нет) → кнопка
 * «Получить пробную» в главном меню скрывается.
 */
clientRouter.get("/trials/available", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const allEnabled = await prisma.trial.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { tariff: { select: { id: true, name: true, trafficLimitBytes: true, deviceLimit: true, includedDevices: true } } },
  });
  // hasAnyEnabled — флаг для бота, чтобы при пустом items.length знать:
  //   нет триалов вообще (используй legacy single-trial flow) или
  //   все использованы (скрывай кнопку «Получить пробную»).
  if (allEnabled.length === 0) return res.json({ items: [], hasAnyEnabled: false });
  const used = await prisma.clientTrialUsage.findMany({
    where: { clientId },
    select: { trialId: true },
  });
  const usedSet = new Set(used.map((u) => u.trialId));
  const available = allEnabled.filter((t) => !usedSet.has(t.id));
  return res.json({
    items: available.map((t) => {
      // trafficLimitBytes из триала (если задан) или из тарифа.
      // Отдаём как строку (BigInt JSON-safe). Клиенты конвертят в Number для отображения.
      const effectiveTraffic = t.trafficLimitBytes ?? t.tariff?.trafficLimitBytes ?? null;
      return {
        id: t.id,
        name: t.name,
        tariffId: t.tariffId,
        tariffName: t.tariff?.name ?? null,
        durationDays: t.durationDays,
        description: t.description,
        sortOrder: t.sortOrder,
        trafficLimitBytes: effectiveTraffic !== null ? effectiveTraffic.toString() : null,
        deviceLimit: t.tariff?.deviceLimit ?? null,
        includedDevices: t.tariff?.includedDevices ?? null,
      };
    }),
    hasAnyEnabled: true,
  });
});

/**
 * Активация конкретного триала.
 * Использует createAdditionalSubscription (как для подарков) — создаёт secondary
 * с настройками тарифа триала и длительностью из триала. Помечает её trial_id.
 * Записывает в client_trial_usages для блокировки повторной активации.
 */
clientRouter.post("/trials/:id/activate", async (req, res) => {
  const trialId = req.params.id;
  const clientId = (req as unknown as { clientId: string }).clientId;
  if (!isRemnaConfigured()) return res.status(503).json({ message: "Сервис временно недоступен" });

  const trial = await prisma.trial.findUnique({
    where: { id: trialId },
    include: { tariff: true },
  });
  if (!trial || !trial.enabled) {
    return res.status(404).json({ message: "Триал не найден или отключён" });
  }

  // Проверяем что клиент ещё не активировал этот триал (атомарно через UNIQUE).
  const existingUsage = await prisma.clientTrialUsage.findUnique({
    where: { clientId_trialId: { clientId, trialId } },
  });
  if (existingUsage) {
    return res.status(409).json({ message: "Этот пробный период уже активирован" });
  }

  // Создаём secondary subscription с настройками тарифа триала, но длительностью триала.
  // если у триала задан собственный trafficLimitBytes —
  // используем его вместо тарифа (например 5 ГБ на триал при 100 ГБ у платного Unblock).
  // Если null — fallback на лимит тарифа (бэк-совместимость со старыми триалами).
  const trialTrafficLimit = trial.trafficLimitBytes ?? trial.tariff.trafficLimitBytes;
  const { createAdditionalSubscription } = await import("../gift/gift.service.js");
  const subResult = await createAdditionalSubscription(clientId, {
    id: trial.tariffId,
    name: trial.tariff.name,
    price: 0,
    durationDays: trial.durationDays, // ← длительность из триала, не тарифа
    trafficLimitBytes: trialTrafficLimit,
    deviceLimit: trial.tariff.deviceLimit,
    includedDevices: trial.tariff.includedDevices,
    internalSquadUuids: trial.tariff.internalSquadUuids,
    trafficResetMode: trial.tariff.trafficResetMode ?? undefined,
  }, { skipConfigCheck: true, extraDevices: 0 });
  if (!subResult.ok) {
    return res.status(subResult.status).json({ message: subResult.error });
  }

  // Помечаем sub как «триал» (для отображения в боте + кнопки «Конвертировать»).
  await prisma.subscription.update({
    where: { id: subResult.data.subscriptionId },
    data: { trialId: trial.id },
  }).catch(() => {});

  // если триал стал primary (subscriptionIndex=0) и у клиента
  // ещё пустой Client.remnawaveUuid — синкаем туда remnawaveUuid подписки для legacy-чтения.
  if (subResult.data.subscriptionIndex === 0) {
    const createdSubForSync = await prisma.subscription.findUnique({
      where: { id: subResult.data.subscriptionId },
      select: { remnawaveUuid: true },
    });
    if (createdSubForSync?.remnawaveUuid) {
      await prisma.client.update({
        where: { id: clientId },
        data: { remnawaveUuid: createdSubForSync.remnawaveUuid },
      }).catch(() => {});
    }
  }

  // Лог использования (атомарный insert через UNIQUE).
  try {
    await prisma.clientTrialUsage.create({
      data: {
        clientId,
        trialId: trial.id,
        subscriptionId: subResult.data.subscriptionId,
      },
    });
  } catch {
    // Гонка: одновременно 2 запроса. Один прошёл, второй получит 409 при повторе.
  }

  // подгружаем subscriptionUrl + remnawaveUuid из созданной подписки
  // чтобы бот мог сразу показать кнопку «📲 Инструкции по установке» с прямой ссылкой.
  const createdSub = await prisma.subscription.findUnique({
    where: { id: subResult.data.subscriptionId },
    select: { remnawaveUuid: true },
  });
  let subscriptionUrl: string | null = null;
  if (createdSub?.remnawaveUuid) {
    try {
      const r = await remnaGetUser(createdSub.remnawaveUuid);
      const inner = (r.data as { response?: Record<string, unknown>; data?: Record<string, unknown> } | null)?.response
        ?? (r.data as { response?: Record<string, unknown>; data?: Record<string, unknown> } | null)?.data
        ?? (r.data as Record<string, unknown> | null);
      subscriptionUrl = (inner as { subscriptionUrl?: string } | null)?.subscriptionUrl ?? null;
    } catch { /* ignore */ }
  }

  return res.json({
    message: `🎁 Пробная подписка «${trial.name}» активирована на ${trial.durationDays} дн.!`,
    subscriptionId: subResult.data.subscriptionId,
    trialId: trial.id,
    durationDays: trial.durationDays,
    // для кнопки «🌐 Локации» на экране активации (скрин 5).
    // Бот покажет кнопку только если у тарифа триала есть текст локаций.
    tariffId: trial.tariffId,
    tariffHasLocations: !!(trial.tariff.locations?.trim()),
    // T-unify: subscription URL для прямой URL-кнопки инструкций.
    subscriptionUrl,
  });
});

// ——— Активация промо-ссылки ———
clientRouter.post("/promo/activate", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null; email: string | null; telegramId: string | null; telegramUsername?: string | null } }).client;
  const { code } = req.body as { code?: string };
  if (!code?.trim()) return res.status(400).json({ message: "Промокод не указан" });

  const group = await prisma.promoGroup.findUnique({ where: { code: code.trim() } });
  if (!group || !group.isActive) return res.status(404).json({ message: "Промокод не найден или неактивен" });

  // Раньше было: existing-check + count(maxActivations) + потом Remna API + потом
  // promoActivation.create в самом конце. Между чтением count и create — секунды
  // на Remna. Параллельные /promo/activate от разных юзеров пробивали maxActivations
  // (все видели count<max → все активировали → группа уехала за лимит).
  //
  // Фикс — резервируем активацию атомарно ПЕРЕД Remna, через Serializable
  // транзакцию: count → если ок → create. PG сериализует — лишние конкуренты
  // получат serialization_failure и нашу 400. Существующая activation для того
  // же юзера ловится @@unique(promoGroupId, clientId) → P2002 → 400.
  let activationCreated = false;
  try {
    await prisma.$transaction(async (tx) => {
      // Дубль той же связки (юзер уже активировал этот промокод) — DB словит
      // P2002 на create ниже. Тут — отдельная ранняя проверка ради вменяемого
      // сообщения.
      const existing = await tx.promoActivation.findUnique({
        where: { promoGroupId_clientId: { promoGroupId: group.id, clientId: client.id } },
      });
      if (existing) {
        throw new Error("DUPLICATE_USER_ACTIVATION");
      }
      if (group.maxActivations > 0) {
        const count = await tx.promoActivation.count({ where: { promoGroupId: group.id } });
        if (count >= group.maxActivations) {
          throw new Error("MAX_ACTIVATIONS_EXCEEDED");
        }
      }
      await tx.promoActivation.create({
        data: { promoGroupId: group.id, clientId: client.id },
      });
      activationCreated = true;
    }, { isolationLevel: "Serializable" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "DUPLICATE_USER_ACTIVATION") {
      return res.status(400).json({ message: "Вы уже активировали этот промокод" });
    }
    if (msg === "MAX_ACTIVATIONS_EXCEEDED") {
      return res.status(400).json({ message: "Лимит активаций промокода исчерпан" });
    }
    // P2002 (уник нарушен), serialization_failure, или что-то ещё — трактуем как
    // конкурент уже занял место.
    if ((e as { code?: string })?.code === "P2002") {
      return res.status(400).json({ message: "Вы уже активировали этот промокод" });
    }
    if ((e as { code?: string })?.code === "P2034") {
      return res.status(409).json({ message: "Слишком много одновременных запросов, попробуйте ещё раз" });
    }
    throw e;
  }

  if (!isRemnaConfigured()) {
    // Откатываем резервацию: Remna не настроен, активацию делать нечем.
    if (activationCreated) {
      await prisma.promoActivation.delete({
        where: { promoGroupId_clientId: { promoGroupId: group.id, clientId: client.id } },
      }).catch(() => {});
    }
    return res.status(503).json({ message: "Сервис временно недоступен" });
  }

  const trafficLimitBytes = Number(group.trafficLimitBytes);
  const hwidDeviceLimit = group.deviceLimit ?? null;

  let promoWorkingUuid = client.remnawaveUuid;

  if (promoWorkingUuid) {
    const checkRes = await remnaGetUser(promoWorkingUuid);
    if (checkRes.error || !checkRes.data) {
      console.warn(`[promo] Remna user ${promoWorkingUuid} not found (status ${checkRes.status}), will re-create`);
      promoWorkingUuid = null;
      await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: null } });
    }
  }

  if (promoWorkingUuid) {
    const userRes = await remnaGetUser(promoWorkingUuid);
    const currentExpireAt = extractCurrentExpireAt(userRes.data);
    const expireAt = calculateExpireAt(currentExpireAt, group.durationDays);

    const updateRes = await remnaUpdateUser({
      uuid: promoWorkingUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [group.squadUuid],
    });
    if (updateRes.error) {
      return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
    }
  } else {
    let existingUuid: string | null = null;
    let currentExpireAt: Date | null = null;
    if (client.telegramId?.trim()) {
      const byTgRes = await remnaGetUserByTelegramId(client.telegramId.trim());
      existingUuid = extractRemnaUuid(byTgRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byTgRes.data);
    }
    if (!existingUuid && client.email?.trim()) {
      const byEmailRes = await remnaGetUserByEmail(client.email.trim());
      existingUuid = extractRemnaUuid(byEmailRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byEmailRes.data);
    }
    const displayUsername = remnaUsernameFromClient({
      telegramUsername: client.telegramUsername,
      telegramId: client.telegramId,
      email: client.email,
      clientIdFallback: client.id,
    });
    const expireAt = calculateExpireAt(currentExpireAt, group.durationDays);
    if (!existingUuid) {
      const createRes = await remnaCreateUser({
        username: displayUsername,
        trafficLimitBytes,
        trafficLimitStrategy: "NO_RESET",
        expireAt,
        hwidDeviceLimit: hwidDeviceLimit ?? undefined,
        activeInternalSquads: [group.squadUuid],
        ...(client.telegramId?.trim() && { telegramId: parseInt(client.telegramId, 10) }),
        ...(client.email?.trim() && { email: client.email.trim() }),
      });
      existingUuid = extractRemnaUuid(createRes.data);
    }
    if (!existingUuid) return res.status(502).json({ message: "Ошибка создания пользователя VPN" });

    await remnaUpdateUser({ uuid: existingUuid, expireAt, trafficLimitBytes, hwidDeviceLimit, activeInternalSquads: [group.squadUuid] });

    await prisma.client.update({
      where: { id: client.id },
      data: { remnawaveUuid: existingUuid },
    });
  }

  // Запись об активации уже создана выше в Serializable-транзакции до Remna —
  // повторный create тут НЕ нужен.

  return res.json({ message: "Промокод активирован! Подписка подключена." });
});

// ——— Промокоды (скидки / бесплатные дни) ———

/** Общая валидация промокода — возвращает объект PromoCode или ошибку */
type PromoCodeRow = NonNullable<Awaited<ReturnType<typeof prisma.promoCode.findUnique>>>;
type ValidateResult = { ok: true; promo: PromoCodeRow } | { ok: false; error: string; status: number };

async function validatePromoCode(code: string, clientId: string): Promise<ValidateResult> {
  const promo = await prisma.promoCode.findUnique({ where: { code: code.trim() } });
  if (!promo || !promo.isActive) return { ok: false, error: "Промокод не найден или неактивен", status: 404 };
  if (promo.expiresAt && promo.expiresAt < new Date()) return { ok: false, error: "Срок действия промокода истёк", status: 400 };

  if (promo.maxUses > 0) {
    const totalUsages = await prisma.promoCodeUsage.count({ where: { promoCodeId: promo.id } });
    if (totalUsages >= promo.maxUses) return { ok: false, error: "Лимит использований промокода исчерпан", status: 400 };
  }

  const clientUsages = await prisma.promoCodeUsage.count({
    where: { promoCodeId: promo.id, clientId },
  });
  if (clientUsages >= promo.maxUsesPerClient) return { ok: false, error: "Вы уже использовали этот промокод", status: 400 };

  return { ok: true, promo };
}

/** Проверить промокод (для скидки — возвращает данные скидки; для FREE_DAYS — информацию) */
clientRouter.post("/promo-code/check", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const { code } = req.body as { code?: string };
  if (!code?.trim()) return res.status(400).json({ message: "Промокод не указан" });

  const result = await validatePromoCode(code, client.id);
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  const promo = result.promo;
  if (promo.type === "DISCOUNT") {
    return res.json({
      type: "DISCOUNT",
      discountPercent: promo.discountPercent,
      discountFixed: promo.discountFixed,
      name: promo.name,
    });
  }
  return res.json({
    type: "FREE_DAYS",
    durationDays: promo.durationDays,
    name: promo.name,
  });
});

/** Применить промокод FREE_DAYS — активирует подписку */
clientRouter.post("/promo-code/activate", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null; email: string | null; telegramId: string | null; telegramUsername?: string | null } }).client;
  const { code } = req.body as { code?: string };
  if (!code?.trim()) return res.status(400).json({ message: "Промокод не указан" });

  const result = await validatePromoCode(code, client.id);
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  const promo = result.promo;

  if (promo.type === "DISCOUNT") {
    return res.status(400).json({ message: "Промокод на скидку применяется при оплате тарифа" });
  }

  // FREE_DAYS
  if (!promo.squadUuid || !promo.durationDays) {
    return res.status(400).json({ message: "Промокод не полностью настроен" });
  }

  if (!isRemnaConfigured()) return res.status(503).json({ message: "Сервис временно недоступен" });

  const trafficLimitBytes = Number(promo.trafficLimitBytes ?? 0);
  const hwidDeviceLimit = promo.deviceLimit ?? null;

  if (client.remnawaveUuid) {
    const userRes = await remnaGetUser(client.remnawaveUuid);
    const currentExpireAt = extractCurrentExpireAt(userRes.data);
    const expireAt = calculateExpireAt(currentExpireAt, promo.durationDays);

    const updateRes = await remnaUpdateUser({
      uuid: client.remnawaveUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [promo.squadUuid],
    });
    if (updateRes.error) {
      return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
    }
    // Не вызываем add-users: по api-1.yaml эндпоинт добавляет ВСЕХ пользователей в сквад.
  } else {
    let existingUuid: string | null = null;
    let currentExpireAt: Date | null = null;
    if (client.telegramId?.trim()) {
      const byTgRes = await remnaGetUserByTelegramId(client.telegramId.trim());
      existingUuid = extractRemnaUuid(byTgRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byTgRes.data);
    }
    if (!existingUuid && client.email) {
      const byEmailRes = await remnaGetUserByEmail(client.email.trim());
      existingUuid = extractRemnaUuid(byEmailRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byEmailRes.data);
    }
    const displayUsername = remnaUsernameFromClient({
      telegramUsername: client.telegramUsername,
      telegramId: client.telegramId,
      email: client.email,
      clientIdFallback: client.id,
    });
    const expireAt = calculateExpireAt(currentExpireAt, promo.durationDays);
    if (!existingUuid) {
      const createRes = await remnaCreateUser({
        username: displayUsername,
        trafficLimitBytes,
        trafficLimitStrategy: "NO_RESET",
        expireAt,
        hwidDeviceLimit: hwidDeviceLimit ?? undefined,
        activeInternalSquads: [promo.squadUuid],
        ...(client.telegramId?.trim() && { telegramId: parseInt(client.telegramId, 10) }),
        ...(client.email?.trim() && { email: client.email.trim() }),
      });
      existingUuid = extractRemnaUuid(createRes.data);
    }
    if (!existingUuid) return res.status(502).json({ message: "Ошибка создания пользователя VPN" });

    await remnaUpdateUser({ uuid: existingUuid, expireAt, trafficLimitBytes, hwidDeviceLimit, activeInternalSquads: [promo.squadUuid] });
    // Не вызываем add-users: по api-1.yaml эндпоинт добавляет ВСЕХ пользователей в сквад.
    await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: existingUuid } });
  }

  await prisma.promoCodeUsage.create({ data: { promoCodeId: promo.id, clientId: client.id } });
  return res.json({ message: `Промокод активирован! Подписка на ${promo.durationDays} дн. подключена.` });
});

/** Определить отображаемое имя тарифа: Триал, название с сайта или «Тариф не выбран».
 *  Поддерживает activeInternalSquads как массив строк (uuid) или объектов { uuid }.
 *  Приоритет: сначала ищем совпадение с оплаченным тарифом, затем — триал. */
async function resolveTariffDisplayName(remnaUserData: unknown): Promise<string> {
  const raw = remnaUserData as { response?: { activeInternalSquads?: unknown[] }; activeInternalSquads?: unknown[] };
  const user = raw?.response ?? raw;
  const ais = user?.activeInternalSquads;
  const squadUuids: string[] = [];
  if (Array.isArray(ais)) {
    for (const s of ais) {
      const u = s != null && typeof s === "object" && "uuid" in s ? (s as { uuid: unknown }).uuid : s;
      if (typeof u === "string") squadUuids.push(u);
    }
  }
  if (squadUuids.length === 0) return "Тариф не выбран";
  const config = await getSystemConfig();
  const trialUuid = config.trialSquadUuid?.trim() || null;
  const tariffs = await prisma.tariff.findMany({ select: { name: true, internalSquadUuids: true } });
  for (const squadUuid of squadUuids) {
    if (trialUuid === squadUuid) continue;
    const match = tariffs.find((t) => t.internalSquadUuids.includes(squadUuid));
    if (match?.name) return match.name;
  }
  if (trialUuid && squadUuids.includes(trialUuid)) return "Тест";
  return "Тариф не выбран";
}

clientRouter.get("/proxy-slots", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const now = new Date();
  const slots = await prisma.proxySlot.findMany({
    where: { clientId: client.id, status: "ACTIVE", expiresAt: { gt: now } },
    select: {
      id: true,
      login: true,
      password: true,
      expiresAt: true,
      trafficLimitBytes: true,
      trafficUsedBytes: true,
      connectionLimit: true,
      node: { select: { publicHost: true, socksPort: true, httpPort: true } },
    },
    orderBy: { expiresAt: "asc" },
  });
  return res.json({
    slots: slots.map((s) => ({
      id: s.id,
      login: s.login,
      password: s.password,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      connectionLimit: s.connectionLimit,
      host: s.node.publicHost ?? "host",
      socksPort: s.node.socksPort,
      httpPort: s.node.httpPort,
    })),
  });
});

clientRouter.get("/singbox-slots", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const now = new Date();
  const slots = await prisma.singboxSlot.findMany({
    where: { clientId: client.id, status: "ACTIVE", expiresAt: { gt: now } },
    select: {
      id: true,
      userIdentifier: true,
      secret: true,
      expiresAt: true,
      trafficLimitBytes: true,
      trafficUsedBytes: true,
      node: { select: { publicHost: true, port: true, protocol: true, tlsEnabled: true } },
    },
    orderBy: { expiresAt: "asc" },
  });
  return res.json({
    slots: slots.map((s) => {
      const link = buildSingboxSlotSubscriptionLink(
        {
          publicHost: s.node.publicHost ?? "",
          port: s.node.port ?? 443,
          protocol: s.node.protocol ?? "VLESS",
          tlsEnabled: s.node.tlsEnabled,
        },
        { userIdentifier: s.userIdentifier, secret: s.secret },
        `slot-${s.id.slice(-8)}`
      );
      return {
        id: s.id,
        subscriptionLink: link,
        expiresAt: s.expiresAt.toISOString(),
        trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
        trafficUsedBytes: s.trafficUsedBytes.toString(),
        protocol: s.node.protocol ?? "VLESS",
      };
    }),
  });
});

clientRouter.get("/subscription", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;
  // T-uuid-resync : резолвим активную подписку из таблицы subscriptions (root, index 0),
  // а НЕ по clients.remnawaveUuid — оно рассинхронивается при перевыпуске/продлении (указывает на старого
  // EXPIRED Remna-юзера, тогда как subscriptions хранит актуального). Бот берёт из subscriptions — кабинет теперь тоже.
  const rootSub = await prisma.subscription.findFirst({
    where: { ownerId: client.id, subscriptionIndex: 0, remnawaveUuid: { not: null } },
    select: { remnawaveUuid: true },
  });
  const effectiveUuid = rootSub?.remnawaveUuid ?? client.remnawaveUuid;
  if (!effectiveUuid) {
    return res.json({ subscription: null, tariffDisplayName: null, currentPricePerDay: null, message: "Подписка не привязана" });
  }
  // Self-heal: clients.remnawaveUuid разошёлся с актуальной подпиской → чиним (влияет на устройства, доп.подписки и пр.).
  if (rootSub?.remnawaveUuid && rootSub.remnawaveUuid !== client.remnawaveUuid) {
    prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: rootSub.remnawaveUuid } }).catch(() => {});
  }
  const result = await remnaGetUser(effectiveUuid);
  if (result.error) {
    return res.json({ subscription: null, tariffDisplayName: null, currentPricePerDay: null, message: result.error });
  }

  // Опциональное шифрование subscriptionUrl в happ://crypt4/... — настройка happCryptEnabled.
  // По умолчанию выключено: crypt4-ссылка длинная (1500+ символов).
  const subCfg = await getSystemConfig();
  if (subCfg.happCryptEnabled) {
    await encryptSubscriptionUrlInPlace(result.data);
  }

  // Берём currentTariffId + currentPricePerDay (для UI отображения и для расчёта конвертации в warn-модалке)
  const dbClient = await prisma.client.findUnique({
    where: { id: client.id },
    select: {
      currentTariff: { select: { name: true } },
      currentPricePerDay: true,
      autoRenewEnabled: true,
      autoRenewTariffId: true,
      autoRenewPriceOptionId: true,
      autoRenewExtraDevices: true,
      autoRenewPromoCode: true,
      personalDiscountPercent: true,
      autoRenewTariff: { select: { id: true, price: true, durationDays: true, currency: true, pricePerExtraDevice: true, deviceDiscountTiers: true } },
    },
  });
  let tariffDisplayName: string;
  if (dbClient?.currentTariff?.name?.trim()) {
    tariffDisplayName = dbClient.currentTariff.name.trim();
  } else {
    tariffDisplayName = await resolveTariffDisplayName(result.data ?? null);
    if (tariffDisplayName === "Тест" || tariffDisplayName === "Тариф не выбран") {
      const lastPaidTariff = await prisma.payment.findFirst({
        where: { clientId: client.id, status: "PAID", tariffId: { not: null } },
        orderBy: { paidAt: "desc" },
        select: { tariff: { select: { name: true } } },
      });
      const name = lastPaidTariff?.tariff?.name?.trim();
      if (name) tariffDisplayName = name;
    }
  }

  // Автопродление: считаем следующее списание (сумма + дата) если включено.
  let autoRenewNextChargeAmount: number | null = null;
  let autoRenewNextChargeAt: string | null = null;
  let autoRenewCurrency: string | null = null;
  if (dbClient?.autoRenewEnabled && dbClient.autoRenewTariff) {
    try {
      const { applyExtraDevicesPrice, parseDeviceDiscountTiers } = await import("../tariff/tariff-activation.service.js");
      // Опция длительности
      let opt: { id: string; durationDays: number; price: number } | null = null;
      if (dbClient.autoRenewPriceOptionId) {
        const savedOpt = await prisma.tariffPriceOption.findFirst({
          where: { id: dbClient.autoRenewPriceOptionId, tariffId: dbClient.autoRenewTariff.id },
        });
        if (savedOpt) opt = { id: savedOpt.id, durationDays: savedOpt.durationDays, price: savedOpt.price };
      }
      if (!opt) {
        const fallback = await prisma.tariffPriceOption.findFirst({
          where: { tariffId: dbClient.autoRenewTariff.id },
          orderBy: { price: "asc" },
        });
        if (fallback) opt = { id: fallback.id, durationDays: fallback.durationDays, price: fallback.price };
      }
      const unitPrice = opt?.price ?? dbClient.autoRenewTariff.price;
      const durationDays = opt?.durationDays ?? dbClient.autoRenewTariff.durationDays;
      const tiers = parseDeviceDiscountTiers(dbClient.autoRenewTariff.deviceDiscountTiers);
      const { extrasTotal } = applyExtraDevicesPrice(
        dbClient.autoRenewTariff.pricePerExtraDevice ?? 0,
        dbClient.autoRenewExtraDevices ?? 0,
        tiers,
        durationDays,
      );
      let nextAmount = unitPrice + extrasTotal;
      // Персональная скидка
      if (typeof dbClient.personalDiscountPercent === "number" && dbClient.personalDiscountPercent > 0) {
        const pct = Math.min(100, dbClient.personalDiscountPercent);
        nextAmount = Math.round(nextAmount * (100 - pct)) / 100;
      }
      autoRenewNextChargeAmount = nextAmount;
      autoRenewCurrency = dbClient.autoRenewTariff.currency.toUpperCase();

      // Дата = expireAt − autoRenewDaysBeforeExpiry дней (config, default 1).
      const respObj = (result.data as Record<string, unknown> | null);
      const remnaResp = (respObj?.response ?? respObj) as Record<string, unknown> | null;
      const expireRaw = remnaResp?.expireAt;
      if (typeof expireRaw === "string") {
        const expDate = new Date(expireRaw);
        if (!Number.isNaN(expDate.getTime())) {
          const cfg = await getSystemConfig();
          const daysBefore = cfg.autoRenewDaysBeforeExpiry ?? 1;
          const chargeDate = new Date(expDate.getTime() - daysBefore * 24 * 60 * 60 * 1000);
          autoRenewNextChargeAt = chargeDate.toISOString();
        }
      }
    } catch (e) {
      console.warn("[subscription] failed to compute auto-renew next charge:", e instanceof Error ? e.message : e);
    }
  }

  return res.json({
    subscription: result.data ?? null,
    tariffDisplayName,
    currentPricePerDay: dbClient?.currentPricePerDay ?? null,
    autoRenewNextChargeAmount,
    autoRenewNextChargeAt,
    autoRenewCurrency,
  });
});

/**
 * GET /api/client/subscription/by-uuid/:uuid — Подписка по Remnawave UUID.
 * Используется на /cabinet/subscribe?uuid=xxx для secondary подписок.
 */
clientRouter.get("/subscription/by-uuid/:uuid", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;
  const clientId = (req as unknown as { clientId: string }).clientId;
  const { uuid } = req.params;
  if (!uuid || typeof uuid !== "string") {
    return res.status(400).json({ subscription: null, tariffDisplayName: null, message: "UUID не указан" });
  }

  // Проверяем принадлежность: root или secondary подписка
  const isRoot = client.remnawaveUuid === uuid;
  if (!isRoot) {
    const secondarySub = await prisma.subscription.findFirst({
      where: { ownerId: clientId, remnawaveUuid: uuid },
    });
    if (!secondarySub) {
      return res.status(404).json({ subscription: null, tariffDisplayName: null, message: "Подписка не найдена" });
    }
  }

  const result = await remnaGetUser(uuid);
  if (result.error) {
    return res.json({ subscription: null, tariffDisplayName: null, message: result.error });
  }
  const subUuidCfg = await getSystemConfig();
  if (subUuidCfg.happCryptEnabled) {
    await encryptSubscriptionUrlInPlace(result.data);
  }
  const tariffDisplayName = await resolveTariffDisplayName(result.data ?? null);
  return res.json({ subscription: result.data ?? null, tariffDisplayName });
});

/**
 * GET /api/client/subscription/all — Все подписки клиента (root + secondary).
 * Возвращает массив с Remnawave-данными для каждой подписки.
 */
clientRouter.get("/subscription/all", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const subAllCfg = await getSystemConfig();
  const cryptOn = subAllCfg.happCryptEnabled;

  // УНИФИЦИРОВАННАЯ выборка подписок — одна таблица, один запрос.
  // type: "root" → subscriptionIndex=0, type: "secondary" → 1..N (сохраняем для бот-совместимости).
  // Фильтр:
  //   • Свои подписки (НЕ для подарка): ownerId=me + purchasedAsGift=false
  //   • Полученные подарки: giftedToClientId=me + giftStatus=GIFTED
  //   • Исключаем GIFT_RESERVED / GIFT_CODE_ACTIVE (это резерв под отправку подарка).
  type SubInfo = {
    type: "root" | "secondary";
    id: string;
    subscriptionIndex: number | null;
    subscription: unknown;
    tariffDisplayName: string;
    remnawaveUuid: string | null;
    tariffId: string | null;
    trialId: string | null;
    autoRenewEnabled: boolean;
    tariffMenuEmoji: string | null;
    /** кол-во докупленных доп. устройств. */
    extraDevices: number;
    /** суммарная цена за все доп. устройства на 30 дней. */
    extraDevicesMonthlyPrice: number;
  };

  const allSubs = await prisma.subscription.findMany({
    where: {
      OR: [
        { ownerId: clientId, purchasedAsGift: false },
        { giftedToClientId: clientId, giftStatus: "GIFTED" },
      ],
    },
    select: {
      id: true,
      remnawaveUuid: true,
      subscriptionIndex: true,
      trialId: true,
      giftStatus: true,
      autoRenewEnabled: true,
      extraDevices: true,
      extraDevicesMonthlyPrice: true,
      tariff: { select: { id: true, name: true, menuEmoji: true } },
    },
    orderBy: { subscriptionIndex: "asc" },
  });

  // JS-фильтр для исключения GIFT_RESERVED / GIFT_CODE_ACTIVE (резерв под подарок).
  const visible = allSubs.filter((s) => {
    const gs = s.giftStatus ?? "";
    return gs !== "GIFT_RESERVED" && gs !== "GIFT_CODE_ACTIVE";
  });

  const items: SubInfo[] = [];
  for (const sub of visible) {
    let remnaPayload: unknown = null;
    let tariffName = sub.tariff?.name?.trim() ?? "";
    if (sub.remnawaveUuid) {
      const r = await remnaGetUser(sub.remnawaveUuid);
      if (cryptOn) await encryptSubscriptionUrlInPlace(r.data);
      remnaPayload = r.data ?? null;
      if (!tariffName) tariffName = await resolveTariffDisplayName(r.data ?? null);
    }
    if (!tariffName) tariffName = "Тариф не выбран";

    items.push({
      // type сохраняем для back-compat с ботом / фронтом —
      // index=0 → "root" (главная), иначе "secondary" (доп).
      type: sub.subscriptionIndex === 0 ? "root" : "secondary",
      id: sub.id,
      subscriptionIndex: sub.subscriptionIndex,
      subscription: remnaPayload,
      tariffDisplayName: tariffName,
      remnawaveUuid: sub.remnawaveUuid,
      tariffId: sub.tariff?.id ?? null,
      trialId: sub.trialId ?? null,
      autoRenewEnabled: sub.autoRenewEnabled === true,
      tariffMenuEmoji: sub.tariff?.menuEmoji?.trim() || null,
      extraDevices: sub.extraDevices ?? 0,
      extraDevicesMonthlyPrice: sub.extraDevicesMonthlyPrice ?? 0,
    });
  }

  console.log(`[subscription/all] client=${clientId} total=${visible.length}`);
  return res.json({ items });
});

/**
 * pre-check кулдауна продления для конкретной подписки.
 * Бот дёргает перед отрисовкой кнопки «💰 Продлить» и при клике на неё — чтобы сразу выдать
 * сообщение «нельзя ещё N дней», не дожидаясь экрана выбора провайдера.
 *
 * Принимает `subscriptionId` (= Subscription.id). Возвращает:
 *   { blocked: false } — продление доступно
 *   { blocked: true, daysLeft, message, tariffName, cooldownDays } — заблокировано
 */
clientRouter.get("/subscription/:id/cooldown", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const subId = req.params.id;
  // Проверяем что подписка принадлежит клиенту (или подарена ему).
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: { id: true, ownerId: true, giftedToClientId: true },
  });
  if (!sub || (sub.ownerId !== clientId && sub.giftedToClientId !== clientId)) {
    return res.status(404).json({ blocked: false, error: "subscription_not_found" });
  }
  const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
  const cd = await checkSubscriptionRenewalCooldown(subId);
  if (cd.ok) return res.json({ blocked: false });
  return res.json({
    blocked: true,
    daysLeft: cd.daysLeft,
    message: cd.message,
    tariffName: cd.tariffName,
    cooldownDays: cd.cooldownDays,
    nextAvailableAt: cd.nextAvailableAt.toISOString(),
  });
});

/**
 * batch-проверка кулдаунов для нескольких подписок сразу.
 * Используется в боте на экране выбора подписки для продления (renew_pick) — чтобы пометить
 * каждую подписку либо доступной, либо иконкой 🚫 «нельзя ещё N дней».
 *
 * Body: { ids: string[] }
 * Возвращает: { items: Array<{ subscriptionId, blocked, daysLeft?, message? }> }
 */
clientRouter.post("/subscriptions/cooldown-check", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const body = req.body as { ids?: unknown };
  if (!Array.isArray(body.ids)) return res.status(400).json({ message: "ids must be array" });
  const ids = body.ids.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 50);
  if (ids.length === 0) return res.json({ items: [] });
  const subs = await prisma.subscription.findMany({
    where: {
      id: { in: ids },
      OR: [{ ownerId: clientId }, { giftedToClientId: clientId }],
    },
    select: { id: true },
  });
  const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
  const items = await Promise.all(subs.map(async (s) => {
    const cd = await checkSubscriptionRenewalCooldown(s.id);
    if (cd.ok) return { subscriptionId: s.id, blocked: false };
    return {
      subscriptionId: s.id,
      blocked: true,
      daysLeft: cd.daysLeft,
      cooldownDays: cd.cooldownDays,
      tariffName: cd.tariffName,
      message: cd.message,
    };
  }));
  return res.json({ items });
});

/**
 * POST /api/client/subscription/:type/:id/reissue
 * «Обновление подписки» (скрин 8 эталона) — перевыпуск subscription URL.
 *
 * Что делает: вызывает Remnawave POST /api/users/{uuid}/actions/revoke,
 * который генерирует новый shortUuid → старая ссылка перестаёт работать,
 * выдаётся новая. Срок (expireAt), тариф, лимиты, устройства — НЕ меняются.
 *
 * type = "root"      → `id` это clientId, берём client.remnawaveUuid
 * type = "secondary" → `id` это secondarySubscription.id, берём её remnawaveUuid
 *
 * Зачем: клиент мог поделиться ссылкой / его конфиг засветился. Даём перевыпустить.
 */
clientRouter.post("/subscription/:type/:id/reissue", async (req, res) => {
  if (!isRemnaConfigured()) return res.status(503).json({ message: "Remna API не настроен" });
  const subType = req.params.type;
  const subId = req.params.id;
  if (subType !== "root" && subType !== "secondary") {
    return res.status(400).json({ message: "Неверный тип подписки" });
  }
  const clientId = (req as unknown as { clientId: string }).clientId;

  // резолвим подписку через унифицированную таблицу.
  // type=root → ищем primary (subscriptionIndex=0). type=secondary → ищем по id.
  const sub = subType === "root"
    ? await prisma.subscription.findUnique({
        where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
        select: { id: true, ownerId: true, giftedToClientId: true, remnawaveUuid: true },
      })
    : await prisma.subscription.findUnique({
        where: { id: subId },
        select: { id: true, ownerId: true, giftedToClientId: true, remnawaveUuid: true },
      });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });
  if (sub.ownerId !== clientId && sub.giftedToClientId !== clientId) {
    return res.status(403).json({ message: "Нет доступа" });
  }
  const targetUuid = sub.remnawaveUuid;
  if (!targetUuid) return res.status(404).json({ message: "Подписка не привязана к Remnawave" });

  try {
    await remnaRevokeUserSubscription(targetUuid);
    // Достаём свежий subscription URL.
    const fresh = await remnaGetUser(targetUuid);
    const inner = (fresh.data as { response?: Record<string, unknown>; data?: Record<string, unknown> } | null)?.response
      ?? (fresh.data as { response?: Record<string, unknown>; data?: Record<string, unknown> } | null)?.data
      ?? (fresh.data as Record<string, unknown> | null);
    const newUrl = (inner as { subscriptionUrl?: string } | null)?.subscriptionUrl ?? null;
    return res.json({ ok: true, subscriptionUrl: newUrl });
  } catch (e) {
    console.error("[reissue] error:", e);
    return res.status(500).json({ message: e instanceof Error ? e.message : "Ошибка обновления" });
  }
});

/**
 * POST /api/client/subscription/:type/:id/auto-renew
 * Включить/выключить автосписание для конкретной подписки (root или secondary).
 *  - type=root      → обновляет client.autoRenewEnabled (legacy логика, как было)
 *  - type=secondary → обновляет secondary_subscriptions.auto_renew_enabled (новая логика)
 *
 * Body: { enabled: boolean }
 * При включении: проверяем что у клиента баланс > 0 (минимум на одну оплату) — иначе предупреждаем.
 */
clientRouter.post("/subscription/:type/:id/auto-renew", async (req, res) => {
  const subType = req.params.type;
  const subId = req.params.id;
  if (subType !== "root" && subType !== "secondary") {
    return res.status(400).json({ message: "Неверный тип подписки" });
  }
  const enabled = req.body?.enabled === true;
  const client = (req as unknown as { client: { id: string; balance: number; remnawaveUuid: string | null } }).client;
  const clientId = (req as unknown as { clientId: string }).clientId;

  // Предупреждение если включается без баланса И без сохранённой карты YooKassa.
  // Если есть карта + YK-recurring включён — баланс пустой не критично, спишется с карты.
  if (enabled && (client.balance ?? 0) <= 0) {
    const cfg = await getSystemConfig();
    const ykRecurringOn = cfg.yookassaRecurringEnabled === true && !!cfg.yookassaShopId?.trim() && !!cfg.yookassaSecretKey?.trim();
    const dbClient = await prisma.client.findUnique({ where: { id: clientId }, select: { yookassaPaymentMethodId: true } });
    const hasYkCard = !!dbClient?.yookassaPaymentMethodId;
    if (!(ykRecurringOn && hasYkCard)) {
      return res.status(400).json({
        message: "Баланс пустой. Сначала пополните баланс или получите реферальные начисления.",
        code: "EMPTY_BALANCE",
      });
    }
    // Иначе разрешаем — спишется с карты при наступлении срока.
  }

  // единая логика для root и secondary — обе живут в Subscription.
  // type=root → находим primary (subscriptionIndex=0), type=secondary → по id.
  const sub = subType === "root"
    ? await prisma.subscription.findUnique({
        where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
        select: { id: true, ownerId: true, giftedToClientId: true, tariffId: true },
      })
    : await prisma.subscription.findUnique({
        where: { id: subId },
        select: { id: true, ownerId: true, giftedToClientId: true, tariffId: true },
      });
  if (!sub || (sub.ownerId !== clientId && sub.giftedToClientId !== clientId)) {
    return res.status(404).json({ message: "Подписка не найдена" });
  }
  if (enabled && !sub.tariffId) {
    return res.status(400).json({ message: "К подписке не привязан тариф — автосписание невозможно" });
  }

  // Если включаем — подтягиваем последний оплаченный тариф/опцию/устройства для удобства.
  const updates: { autoRenewEnabled: boolean; autoRenewTariffId?: string | null; autoRenewPriceOptionId?: string | null; autoRenewExtraDevices?: number } = {
    autoRenewEnabled: enabled,
  };
  if (enabled) {
    const lastPaid = await prisma.payment.findFirst({
      where: { clientId, status: "PAID", tariffId: { not: null } },
      orderBy: { paidAt: "desc" },
      select: { tariffId: true, tariffPriceOptionId: true, deviceCount: true },
    });
    if (lastPaid?.tariffId) {
      updates.autoRenewTariffId = lastPaid.tariffId;
      updates.autoRenewPriceOptionId = lastPaid.tariffPriceOptionId;
      updates.autoRenewExtraDevices = lastPaid.deviceCount ?? 0;
    } else if (sub.tariffId) {
      updates.autoRenewTariffId = sub.tariffId;
    }
  }
  await prisma.subscription.update({ where: { id: sub.id }, data: updates });
  return res.json({ ok: true, enabled, type: subType });
});

/**
 * POST /api/client/subscription/:type/:id/remove-extra-devices
 * Убирает ВСЕ доп. устройства с подписки. extraDevices → 0, hwidDeviceLimit в Remna →
 * tariff.includedDevices. Если активных HWID было больше нового лимита — жёстко kick
 * лишних (вариант Б, согласовано с юзером 14.05.2026).
 * Возврата денег НЕТ — устройства уже отработали до текущего expireAt подписки.
 */
clientRouter.post("/subscription/:type/:id/remove-extra-devices", async (req, res) => {
  if (!isRemnaConfigured()) return res.status(503).json({ message: "Remna API не настроен" });
  const subType = req.params.type;
  const subId = req.params.id;
  if (subType !== "root" && subType !== "secondary") {
    return res.status(400).json({ message: "Неверный тип подписки" });
  }
  const clientId = (req as unknown as { clientId: string }).clientId;

  const sub = subType === "root"
    ? await prisma.subscription.findUnique({
        where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
        select: { id: true, ownerId: true, giftedToClientId: true, remnawaveUuid: true, tariffId: true, extraDevices: true },
      })
    : await prisma.subscription.findUnique({
        where: { id: subId },
        select: { id: true, ownerId: true, giftedToClientId: true, remnawaveUuid: true, tariffId: true, extraDevices: true },
      });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });
  if (sub.ownerId !== clientId && sub.giftedToClientId !== clientId) {
    return res.status(403).json({ message: "Нет доступа" });
  }
  if (!sub.remnawaveUuid) return res.status(400).json({ message: "Подписка не привязана к Remnawave" });
  if ((sub.extraDevices ?? 0) === 0) {
    return res.status(400).json({ message: "У этой подписки нет докупленных устройств" });
  }

  const tariff = sub.tariffId
    ? await prisma.tariff.findUnique({ where: { id: sub.tariffId }, select: { includedDevices: true, deviceLimit: true } })
    : null;
  const includedDevices = tariff?.includedDevices ?? tariff?.deviceLimit ?? 1;

  // Список активных HWID — вариант Б: жёстко удалить лишние.
  let removedHwids = 0;
  try {
    const devicesRes = await remnaGetUserHwidDevices(sub.remnawaveUuid);
    const devicesData = devicesRes.data as { response?: { devices?: Array<{ hwid: string; createdAt?: string }> } } | undefined;
    const activeDevices = devicesData?.response?.devices ?? [];
    if (activeDevices.length > includedDevices) {
      // Сортируем по createdAt asc — старые удаляем первыми, новые сохраняем.
      const sorted = [...activeDevices].sort((a, b) => {
        const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aT - bT;
      });
      const toRemove = sorted.slice(0, activeDevices.length - includedDevices);
      for (const dev of toRemove) {
        await remnaDeleteUserHwidDevice(sub.remnawaveUuid, dev.hwid).catch((e) => {
          console.error("[remove-extra-devices] kick HWID failed:", dev.hwid, e);
        });
        removedHwids += 1;
      }
    }
  } catch (e) {
    console.error("[remove-extra-devices] devices kick error:", e);
  }

  // Уменьшаем лимит в Remna до базы.
  const updateRes = await remnaUpdateUser({
    uuid: sub.remnawaveUuid,
    hwidDeviceLimit: includedDevices,
  });
  if (updateRes.error) {
    return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
  }

  // Обнуляем счётчик + monthlyPrice в БД.
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { extraDevices: 0, extraDevicesMonthlyPrice: 0 },
  });

  return res.json({
    ok: true,
    extraDevicesRemoved: sub.extraDevices ?? 0,
    hwidKicked: removedHwids,
    newDeviceLimit: includedDevices,
  });
});

/** GET /api/client/devices — список устройств (HWID) пользователя в Remna */
clientRouter.get("/devices", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;
  if (!client.remnawaveUuid) {
    return res.json({ total: 0, devices: [] });
  }
  const result = await remnaGetUserHwidDevices(client.remnawaveUuid);
  if (result.error) {
    return res.status(result.status >= 500 ? 503 : 400).json({ message: result.error });
  }
  const data = result.data as { response?: { total?: number; devices?: Array<{ hwid: string; platform?: string; deviceModel?: string; createdAt?: string }> } } | undefined;
  const resp = data?.response;
  const devices = Array.isArray(resp?.devices) ? resp.devices : [];
  const total = typeof resp?.total === "number" ? resp.total : devices.length;
  return res.json({ total, devices });
});

// схема расширена subscriptionType/subscriptionId — теперь устройство
// можно удалить с конкретной подписки (root или secondary). Раньше endpoint использовал только
// client.remnawaveUuid (root) → удаление с secondary возвращало «HWID device not found».
const deleteDeviceSchema = z.object({
  hwid: z.string().min(1).max(500),
  subscriptionType: z.enum(["root", "secondary"]).optional(),
  subscriptionId: z.string().min(1).max(64).optional(),
});

/** POST /api/client/devices/delete — удалить устройство по HWID */
clientRouter.post("/devices/delete", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;
  const clientId = (req as unknown as { clientId: string }).clientId;
  const body = deleteDeviceSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });

  // Определяем UUID подписки откуда удалять.
  // резолвим uuid ВСЕГДА по subscriptionId, если он передан
  // (бот шлёт его и для root, и для secondary). Раньше root-ветка брала client.remnawaveUuid —
  // после унификации это legacy-поле рассинхронено с subscriptions[idx0].remnawaveUuid у 18560
  // клиентов → Remna отвечал "HWID device not found" и устройство не удалялось.
  let targetUuid: string | null = null;
  if (body.data.subscriptionId) {
    // Удаление из конкретной подписки (root или secondary — едины после унификации). Проверяем ownership.
    const sub = await prisma.subscription.findUnique({
      where: { id: body.data.subscriptionId },
      select: { ownerId: true, giftedToClientId: true, remnawaveUuid: true },
    });
    if (!sub || (sub.ownerId !== clientId && sub.giftedToClientId !== clientId)) {
      return res.status(404).json({ message: "Подписка не найдена" });
    }
    if (!sub.remnawaveUuid) {
      return res.status(400).json({ message: "Подписка не привязана к VPN" });
    }
    targetUuid = sub.remnawaveUuid;
  } else {
    // Back-compat: старые версии бота шлют только hwid без subscriptionId → root-поле клиента.
    if (!client.remnawaveUuid) {
      return res.status(400).json({ message: "Подписка не привязана" });
    }
    targetUuid = client.remnawaveUuid;
  }

  // Если subscriptionType не задан явно — попробуем удалить со всех подписок (best-effort).
  // Это для back-compat: старые версии бота шлют только hwid, без указания подписки.
  if (!body.data.subscriptionType) {
    // Сначала root.
    const rootResult = await remnaDeleteUserHwidDevice(targetUuid, body.data.hwid);
    if (!rootResult.error) {
      return res.json({ ok: true, message: "Устройство удалено" });
    }
    // Если в root не нашли — перебираем все secondary этого клиента.
    const secs = await prisma.subscription.findMany({
      where: { ownerId: clientId, remnawaveUuid: { not: null } },
      select: { remnawaveUuid: true },
    });
    for (const s of secs) {
      if (!s.remnawaveUuid) continue;
      const r = await remnaDeleteUserHwidDevice(s.remnawaveUuid, body.data.hwid);
      if (!r.error) {
        return res.json({ ok: true, message: "Устройство удалено" });
      }
    }
    // Нигде не нашли — возвращаем ошибку с понятным текстом.
    return res.status(404).json({ message: "Устройство не найдено ни в одной из ваших подписок" });
  }

  // subscriptionType задан → целенаправленное удаление.
  const result = await remnaDeleteUserHwidDevice(targetUuid, body.data.hwid);
  if (result.error) {
    return res.status(result.status >= 500 ? 503 : 400).json({ message: result.error });
  }
  return res.json({ ok: true, message: "Устройство удалено" });
});

/**
 * GET /api/client/devices/all
 * Все устройства всех подписок клиента (root + secondary), с пометкой откуда.
 * Бот показывает единый список с подписью «Подписка #N — тариф».
 */
clientRouter.get("/devices/all", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;

  type DeviceItem = {
    hwid: string;
    platform?: string;
    deviceModel?: string;
    appName?: string;
    createdAt?: string;
    /**
     * миграция — все подписки живут в Subscription.
     * Тип `subscriptionType` устарел, но оставлен для back-compat с UI бота/кабинета.
     * Считаем по subscriptionIndex: 0 = «root» (главная), иначе «secondary».
     */
    subscriptionType: "root" | "secondary";
    subscriptionId: string;
    subscriptionIndex: number;
    tariffName: string | null;
  };
  const items: DeviceItem[] = [];

  const extractDevices = (data: unknown): { hwid: string; platform?: string; deviceModel?: string; appName?: string; createdAt?: string }[] => {
    const raw = data as { response?: { devices?: Record<string, unknown>[] } } | undefined;
    const devs = Array.isArray(raw?.response?.devices) ? raw.response.devices : [];
    return devs.map((d) => {
      const obj = d as Record<string, unknown>;
      const appName = (obj.appName ?? obj.clientName ?? obj.userAgent ?? obj.app ?? null) as string | null;
      return {
        hwid: String(obj.hwid ?? ""),
        platform: obj.platform ? String(obj.platform) : undefined,
        deviceModel: obj.deviceModel ? String(obj.deviceModel) : undefined,
        appName: appName?.toString().trim() || undefined,
        createdAt: obj.createdAt ? String(obj.createdAt) : undefined,
      };
    });
  };

  // ВСЕ подписки клиента — из Subscription.
  // legacy `client.remnawaveUuid` не используется. Дедуп по UUID — на случай дубля записей.
  const subs = await prisma.subscription.findMany({
    where: {
      OR: [
        { ownerId: clientId, purchasedAsGift: false, giftStatus: null },
        { ownerId: clientId, purchasedAsGift: false, giftStatus: "" },
        { ownerId: clientId, purchasedAsGift: false, giftStatus: "ACTIVATED_SELF" },
        { ownerId: clientId, purchasedAsGift: false, giftStatus: "GIFTED" },
        { giftedToClientId: clientId, giftStatus: "GIFTED" },
      ],
      remnawaveUuid: { not: null },
    },
    select: {
      id: true,
      remnawaveUuid: true,
      subscriptionIndex: true,
      tariff: { select: { name: true } },
    },
    orderBy: { subscriptionIndex: "asc" },
  });
  const seenUuids = new Set<string>();
  for (const sub of subs) {
    if (!sub.remnawaveUuid) continue;
    if (seenUuids.has(sub.remnawaveUuid)) continue;
    seenUuids.add(sub.remnawaveUuid);
    const r = await remnaGetUserHwidDevices(sub.remnawaveUuid);
    if (r.error || !r.data) continue;
    for (const d of extractDevices(r.data)) {
      items.push({
        ...d,
        subscriptionType: sub.subscriptionIndex === 0 ? "root" : "secondary",
        subscriptionId: sub.id,
        subscriptionIndex: sub.subscriptionIndex,
        tariffName: sub.tariff?.name ?? null,
      });
    }
  }

  return res.json({ total: items.length, items });
});

const createPlategaPaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  paymentMethod: z.number().int().min(2).max(13),
  description: z.string().max(500).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // покупка как доп. подписка — см. yookassa-схему ниже.
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
  // продление существующей secondary (вместо создания новой).
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  extraOption: z.object({ kind: z.enum(["traffic", "devices", "servers"]), productId: z.string().min(1), targetSubscriptionId: z.string().min(1).optional() }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
clientRouter.post("/payments/platega", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const parsed = createPlategaPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  const { amount: originalAmount, currency, paymentMethod, description, tariffId, proxyTariffId, singboxTariffId, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;

  let tariffIdToStore: string | null = null;
  let proxyTariffIdToStore: string | null = null;
  let singboxTariffIdToStore: string | null = null;
  let finalAmount: number;
  let currencyToUse: string;
  let metadataExtra: Record<string, unknown> | null = null;

  if (customBuildBody) {
    const configForCb = await getSystemConfig();
    const cfg = getCustomBuildConfig(configForCb);
    if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
    let { days, devices, trafficGb } = customBuildBody;
    if (days > cfg.maxDays || devices > cfg.maxDevices) {
      return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
    }
    const trafficLimitBytes =
      cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
        ? Math.round(trafficGb * 1024 ** 3)
        : null;
    finalAmount = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
    if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) finalAmount += trafficGb * cfg.pricePerGb;
    finalAmount = Math.round(finalAmount * 100) / 100;
    currencyToUse = cfg.currency.toUpperCase();
    metadataExtra = {
      customBuild: {
        durationDays: days,
        deviceLimit: devices,
        trafficLimitBytes,
        internalSquadUuids: [cfg.squadUuid],
      },
    };
  } else if (extraOption) {
    const config = await getSystemConfig();
    if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
      return res.status(400).json({ message: "Продажа опций отключена" });
    }
    const cfg = config as {
      sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
      sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
      sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[];
    };
    if (extraOption.kind === "traffic") {
      const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      finalAmount = product.price;
      currencyToUse = product.currency.toUpperCase();
      metadataExtra = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
    } else if (extraOption.kind === "devices") {
      const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      // для primary подписки (sub_index=0) — масштабируем цену по оставшимся дням
      const clientForProrata = await prisma.client.findUnique({
        where: { id: clientId },
        select: { remnawaveUuid: true },
      });
      let prorataCoef = 1;
      if (clientForProrata?.remnawaveUuid) {
        const primarySub = await prisma.subscription.findFirst({
          where: { ownerId: clientId, remnawaveUuid: clientForProrata.remnawaveUuid },
          select: { expireAt: true },
        });
        if (primarySub?.expireAt) {
          const daysLeft = (primarySub.expireAt.getTime() - Date.now()) / 86_400_000;
          prorataCoef = Math.max(1, daysLeft / 30);
        }
      }
      finalAmount = Math.floor(product.price * prorataCoef);
      currencyToUse = product.currency.toUpperCase();
      metadataExtra = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
    } else {
      const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      finalAmount = product.price;
      currencyToUse = product.currency.toUpperCase();
      metadataExtra = {
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
    }
    if (parsed.data.extraOption?.targetSubscriptionId) {
      metadataExtra = { ...metadataExtra, targetSubscriptionId: parsed.data.extraOption.targetSubscriptionId };
    }
  } else {
    // Если передан tariffId / proxyTariffId / singboxTariffId — цену+валюту берём
    // из тарифа в БД (приоритет: tariffPriceOption → tariff). Если ни одного
    // продуктового id не передано — это чистый top-up балансом, тогда обязателен
    // явный amount+currency.
    finalAmount = originalAmount ?? 0;
    currencyToUse = (currency ?? "").toUpperCase();
    if (tariffId) {
      const tariff = await prisma.tariff.findUnique({
        where: { id: tariffId },
        include: { priceOptions: true },
      });
      if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
      // кулдаун ПРОДЛЕНИЯ существующей подписки.
      // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого тарифа
      // (как доп. подписки) не ограничиваются.
      if (parsed.data.extendsSecondarySubId) {
        const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
        const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId);
        if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
      }
      tariffIdToStore = tariffId;
      // Цена: priceOption если выбран, иначе tariff.price
      let unitPrice = tariff.price;
      let effectiveDays = tariff.durationDays;
      if (parsed.data.tariffPriceOptionId) {
        const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
        if (opt) {
          unitPrice = opt.price;
          effectiveDays = opt.durationDays;
        }
      }
      // при продлении добавляем
      // extraDevicesMonthlyPrice × (days/30). Цена устройств хранится в подписке
      // (накапливается из sell-options-пакетов при докупке). НЕ из тарифа.
      if (parsed.data.extendsSecondarySubId) {
        const sub = await prisma.subscription.findUnique({
          where: { id: parsed.data.extendsSecondarySubId },
          select: { extraDevicesMonthlyPrice: true },
        });
        const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
        if (monthlyPrice > 0 && effectiveDays > 0) {
          unitPrice += Math.round(monthlyPrice * (effectiveDays / 30) * 100) / 100;
        }
      }
      // для НОВОЙ покупки тарифа добавляем
      // tariff.pricePerExtraDevice × deviceCount × tier × (days/30). См. payByBalance.
      const newExtras = Math.max(0, parsed.data.deviceCount ?? 0);
      if (!parsed.data.extendsSecondarySubId && newExtras > 0) {
        const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
        const r = calcExtrasPrice(
          tariff.pricePerExtraDevice ?? 0,
          newExtras,
          tariff.deviceDiscountTiers,
          effectiveDays,
        );
        unitPrice += r.extrasTotal;
      }
      // Бэк сам считает финальную сумму — игнорируем фронтовый originalAmount
      // (защита от подделки цены).
      finalAmount = unitPrice;
      if (!currency) currencyToUse = tariff.currency.toUpperCase();
    }
    if (proxyTariffId) {
      const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffId } });
      if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
      proxyTariffIdToStore = proxyTariffId;
      if (originalAmount == null) finalAmount = proxyTariff.price;
      if (!currency) currencyToUse = proxyTariff.currency.toUpperCase();
    }
    if (singboxTariffId) {
      const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffId } });
      if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
      singboxTariffIdToStore = singboxTariffId;
      if (originalAmount == null) finalAmount = singboxTariff.price;
      if (!currency) currencyToUse = singboxTariff.currency.toUpperCase();
    }
    // После всех попыток — если до сих пор пусто, значит ни тариф ни amount не пришли = top-up без суммы
    if (finalAmount <= 0 || !currencyToUse) {
      return res.status(400).json({ message: "Укажите сумму и валюту" });
    }
  }

  if (finalAmount < 1) {
    return res.status(400).json({ message: "Минимальная сумма платежа — 1" });
  }

  // Персональная скидка клиента (админ мог выдать). Применяется к продуктовым
  // оплатам (тариф/прокси/singbox/кастомный билд/опции), но НЕ к чистому пополнению.
  const isTopupOnlyPlatega = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
  let personalDiscountPercent = 0;
  if (!isTopupOnlyPlatega) {
    const pd = await applyPersonalDiscount(finalAmount, clientId);
    if (pd.personalDiscountPercent > 0) {
      finalAmount = pd.amount;
      personalDiscountPercent = pd.personalDiscountPercent;
    }
  }

  // Применяем промокод на скидку (не для опций по умолчанию, можно разрешить — тогда скидка с опции)
  let promoCodeRecord: { id: string } | null = null;
  if (promoCodeStr?.trim() && !extraOption) {
    const result = await validatePromoCode(promoCodeStr.trim(), clientId);
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    const promo = result.promo;
    if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });

    if (promo.discountPercent && promo.discountPercent > 0) {
      finalAmount = Math.max(0, finalAmount - finalAmount * promo.discountPercent / 100);
    }
    if (promo.discountFixed && promo.discountFixed > 0) {
      finalAmount = Math.max(0, finalAmount - promo.discountFixed);
    }
    finalAmount = Math.round(finalAmount * 100) / 100;
    if (finalAmount <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
    promoCodeRecord = promo;
  }

  const config = await getSystemConfig();
  const plategaConfig = {
    merchantId: config.plategaMerchantId || "",
    secret: config.plategaSecret || "",
  };
  if (!isPlategaConfigured(plategaConfig)) {
    return res.status(503).json({ message: "Platega не настроен" });
  }

  const methods = config.plategaMethods || [];
  const allowed = methods.find((m) => m.id === paymentMethod && m.enabled);
  if (!allowed) {
    return res.status(400).json({ message: "Метод оплаты недоступен" });
  }

  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const orderId = randomUUID();
  const paymentKind = tariffIdToStore ? "tariff" : proxyTariffIdToStore ? "proxy" : singboxTariffIdToStore ? "singbox" : metadataExtra ? "option" : "topup";
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const returnUrl = appUrl
    ? `${appUrl}/cabinet/dashboard?payment=success&payment_kind=${paymentKind}&oid=${orderId}`
    : "";
  const failedUrl = appUrl
    ? `${appUrl}/cabinet/dashboard?payment=failed&payment_kind=${paymentKind}&oid=${orderId}`
    : "";
  // добавляем tg:<id> в description для удобного поиска
  // в кабинете Plategá (зеркалит логику YooKassa/CryptoPay).
  const plategaClient = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true },
  });
  const plategaTgSuffix = plategaClient?.telegramId ? ` tg:${plategaClient.telegramId}` : "";
  const plategaDescription = (tariffIdToStore
    ? `Тариф ${serviceName} #${orderId}`
    : proxyTariffIdToStore
      ? `Прокси ${serviceName} #${orderId}`
      : singboxTariffIdToStore
        ? `Доступы ${serviceName} #${orderId}`
        : metadataExtra
      ? `Опция ${serviceName} #${orderId}`
      : `Пополнение баланса ${serviceName} #${orderId}`) + plategaTgSuffix;

  const personalDiscountMeta = personalDiscountPercent > 0 ? { personalDiscountPercent } : null;
  const paymentMetaObj: Record<string, unknown> = {};
  if (metadataExtra) Object.assign(paymentMetaObj, metadataExtra);
  if (promoCodeRecord) {
    paymentMetaObj.promoCodeId = promoCodeRecord.id;
    paymentMetaObj.originalAmount = metadataExtra ? finalAmount : (originalAmount ?? finalAmount);
  }
  if (personalDiscountMeta) Object.assign(paymentMetaObj, personalDiscountMeta);
  const paymentMeta = Object.keys(paymentMetaObj).length > 0 ? paymentMetaObj : null;
  const snap = isTopupOnlyPlatega ? await paymentSnapshotTopup(clientId, finalAmount) : await paymentSnapshotProduct(clientId, finalAmount);
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId,
      orderId,
      amount: snap.amount,
      currency: currencyToUse,
      status: "PENDING",
      provider: "platega",
      tariffId: tariffIdToStore,
      tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
      deviceCount: parsed.data.deviceCount ?? null,
      proxyTariffId: proxyTariffIdToStore,
      singboxTariffId: singboxTariffIdToStore,
      metadata: paymentMeta ? JSON.stringify(paymentMeta) : null,
    }),
  });

  const result = await createPlategaTransaction(plategaConfig, {
    amount: snap.amount,
    currency: currencyToUse,
    orderId,
    paymentMethod,
    returnUrl,
    failedUrl,
    description: plategaDescription,
  });

  if ("error" in result) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(502).json({ message: result.error });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { externalId: result.transactionId },
  });

  const paymentUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.paymentUrl, config.publicAppUrl);

  return res.status(201).json({
    paymentUrl,
    orderId,
    paymentId: payment.id,
    discountApplied: promoCodeRecord ? true : false,
    finalAmount: snap.amount,
  });
});

// ——— Оплата тарифа или прокси-тарифа балансом ———

const payByBalanceSchema = z.object({
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // продление существующей secondary подписки балансом.
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  // покупка ДОПОЛНИТЕЛЬНОЙ подписки балансом (не через gift/buy).
  // Раньше для этого использовали gift/buy → она ставила purchasedAsGift=true → подписки
  // ошибочно попадали в «🎁 Мои подарки». Теперь /payments/balance принимает asAdditional
  // и создаёт обычную доп. подписку с purchasedAsGift=false → в «📋 Мои подписки».
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
}).refine((d) => (d.tariffId ? 1 : 0) + (d.proxyTariffId ? 1 : 0) + (d.singboxTariffId ? 1 : 0) === 1, { message: "Укажите tariffId, proxyTariffId или singboxTariffId" });

clientRouter.post("/payments/balance", async (req, res) => {
  const clientRaw = (req as unknown as { client: { id: string; remnawaveUuid: string | null; email: string | null; telegramId: string | null } }).client;
  const parsed = payByBalanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });

  const { tariffId, tariffPriceOptionId, deviceCount, proxyTariffId, singboxTariffId, promoCode: promoCodeStr, extendsSecondarySubId, removeExtrasOnActivate, asAdditional } = parsed.data;

  if (proxyTariffId) {
    const tariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffId } });
    if (!tariff || !tariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
    const clientDb = await prisma.client.findUnique({ where: { id: clientRaw.id } });
    if (!clientDb) return res.status(401).json({ message: "Unauthorized" });
    // Персональная скидка админа (баланс — такой же канал оплаты, как и другие).
    const pd = await applyPersonalDiscount(tariff.price, clientRaw.id);
    const finalProxyPrice = pd.amount;
    const snap = await paymentSnapshotProduct(clientRaw.id, finalProxyPrice);
    // Тут была классика: read balance → если хватает → списываем → создаём payment+слоты.
    // Между read и UPDATE — несколько мс. Юзеры угоняли до 30 параллельных запросов
    // и баланс уезжал глубоко в минус (на проде 100₽ → -2900₽ за подписку, см. отчёт).
    //
    // Чиним SQL'ной атомарностью: WHERE balance >= amount. Либо UPDATE прошёл (count=1)
    // и ты списан корректно, либо count=0 — иди говори что денег нет.
    const debit = await prisma.client.updateMany({
      where: { id: clientRaw.id, balance: { gte: snap.amount } },
      data: { balance: { decrement: snap.amount } },
    });
    if (debit.count === 0) {
      return res.status(400).json({ message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${snap.amount.toFixed(2)}` });
    }
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId: clientRaw.id,
        orderId: randomUUID(),
        amount: snap.amount,
        currency: tariff.currency.toUpperCase(),
        status: "PAID",
        provider: "balance",
        proxyTariffId: tariff.id,
        paidAt: new Date(),
        metadata: pd.personalDiscountPercent > 0
          ? JSON.stringify({ personalDiscountPercent: pd.personalDiscountPercent, originalPrice: tariff.price })
          : null,
      }),
    });
    const proxyResult = await createProxySlotsByPaymentId(payment.id);
    if (!proxyResult.ok) {
      // Слоты не вылетели — возвращаем бабки на баланс.
      await prisma.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: snap.amount } } }).catch(() => {});
      return res.status(proxyResult.status).json({ message: proxyResult.error });
    }
    const { distributeReferralRewards } = await import("../referral/referral.service.js");
    await distributeReferralRewards(payment.id).catch((e) => console.error("[referral] Error:", e));
    // сжигаем одноразовую скидку после покупки proxy.
    {
      const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
      await extinguishOneTimeDiscount(clientRaw.id).catch(() => {});
    }
    const { notifyProxySlotsCreated } = await import("../notification/telegram-notify.service.js");
    await notifyProxySlotsCreated(clientRaw.id, proxyResult.slotIds, tariff.name).catch(() => {});
    const after = await prisma.client.findUnique({ where: { id: clientRaw.id }, select: { balance: true } });
    return res.json({
      message: `Прокси «${tariff.name}» оплачены! Списано ${snap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`,
      newBalance: after?.balance ?? clientDb.balance - snap.amount,
    });
  }

  if (singboxTariffId) {
    const tariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffId } });
    if (!tariff || !tariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
    const clientDb = await prisma.client.findUnique({ where: { id: clientRaw.id } });
    if (!clientDb) return res.status(401).json({ message: "Unauthorized" });
    const pd = await applyPersonalDiscount(tariff.price, clientRaw.id);
    const finalSingboxPrice = pd.amount;
    const singSnap = await paymentSnapshotProduct(clientRaw.id, finalSingboxPrice);
    // Та же история, что в proxy-ветке: атомик debit вместо read+check+write.
    const debit = await prisma.client.updateMany({
      where: { id: clientRaw.id, balance: { gte: singSnap.amount } },
      data: { balance: { decrement: singSnap.amount } },
    });
    if (debit.count === 0) {
      return res.status(400).json({ message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${singSnap.amount.toFixed(2)}` });
    }
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId: clientRaw.id,
        orderId: randomUUID(),
        amount: singSnap.amount,
        currency: tariff.currency.toUpperCase(),
        status: "PAID",
        provider: "balance",
        singboxTariffId: tariff.id,
        paidAt: new Date(),
        metadata: pd.personalDiscountPercent > 0
          ? JSON.stringify({ personalDiscountPercent: pd.personalDiscountPercent, originalPrice: tariff.price })
          : null,
      }),
    });
    const singboxResult = await createSingboxSlotsByPaymentId(payment.id);
    if (!singboxResult.ok) {
      // Слоты Sing-box не вылетели — деньги обратно на баланс.
      await prisma.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: singSnap.amount } } }).catch(() => {});
      return res.status(singboxResult.status).json({ message: singboxResult.error });
    }
    const { distributeReferralRewards } = await import("../referral/referral.service.js");
    await distributeReferralRewards(payment.id).catch((e) => console.error("[referral] Error:", e));
    // сжигаем одноразовую скидку после покупки singbox.
    {
      const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
      await extinguishOneTimeDiscount(clientRaw.id).catch(() => {});
    }
    const { notifySingboxSlotsCreated } = await import("../notification/telegram-notify.service.js");
    await notifySingboxSlotsCreated(clientRaw.id, singboxResult.slotIds, tariff.name).catch(() => {});
    const after = await prisma.client.findUnique({ where: { id: clientRaw.id }, select: { balance: true } });
    return res.json({
      message: `Доступы «${tariff.name}» оплачены! Списано ${singSnap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`,
      newBalance: after?.balance ?? clientDb.balance - singSnap.amount,
    });
  }

  const tariff = await prisma.tariff.findUnique({
    where: { id: tariffId! },
    include: { priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } },
  });
  if (!tariff) return res.status(400).json({ message: "Тариф не найден" });

  // кулдаун ПРОДЛЕНИЯ существующей подписки.
  // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого тарифа
  // (как доп. подписки) не ограничиваются.
  if (extendsSecondarySubId) {
    const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
    const cd = await checkSubscriptionRenewalCooldown(extendsSecondarySubId!);
    if (!cd.ok) {
      return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
    }
  }

  // Определяем выбранную опцию: явный priceOptionId → найти и проверить принадлежность тарифу.
  // Если не указан — fallback на legacy (tariff.price + tariff.durationDays).
  let selectedOption: { id: string; durationDays: number; price: number } | null = null;
  if (tariffPriceOptionId) {
    const opt = tariff.priceOptions.find((o) => o.id === tariffPriceOptionId);
    if (!opt) return res.status(400).json({ message: "Опция цены не найдена в этом тарифе" });
    selectedOption = { id: opt.id, durationDays: opt.durationDays, price: opt.price };
  } else if (tariff.priceOptions.length > 0) {
    // Если опции есть но не указали — берём минимальную цену по умолчанию (как в legacy)
    const sorted = [...tariff.priceOptions].sort((a, b) => a.price - b.price);
    selectedOption = { id: sorted[0].id, durationDays: sorted[0].durationDays, price: sorted[0].price };
  }

  // tariff.pricePerExtraDevice — это
  // ОТДЕЛЬНАЯ админская фича выбора устройств ПРИ покупке тарифа. К нашей логике
  // sell-options не относится. Цена дополнительных устройств подписки хранится
  // отдельно в Subscription.extraDevicesMonthlyPrice (берётся из sell-option-пакета).
  //
  // Формула при продлении:
  //   finalPrice = selectedOption.price + sub.extraDevicesMonthlyPrice × (days / 30)
  // При обычной покупке нового тарифа extras не учитываются (их ещё нет на новой подписке).
  const unitPrice = selectedOption?.price ?? tariff.price;
  const effectiveDays = selectedOption?.durationDays ?? tariff.durationDays;
  // Параметр deviceCount/requestedExtras в API остаётся для legacy/tariff-extras flow;
  // в нашем sell-options flow он = 0 (юзер докупает устройства отдельно через extra-options).
  const requestedExtras = Math.max(0, deviceCount ?? 0);

  let extrasMonthlyPrice = 0;
  if (extendsSecondarySubId) {
    const sub = await prisma.subscription.findUnique({
      where: { id: extendsSecondarySubId },
      select: { extraDevicesMonthlyPrice: true },
    });
    extrasMonthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
  }
  const extrasTotal = extrasMonthlyPrice > 0 && effectiveDays > 0
    ? Math.round(extrasMonthlyPrice * (effectiveDays / 30) * 100) / 100
    : 0;
  // для НОВОЙ покупки (не extend) добавляем
  // цену доп. устройств из tariff.pricePerExtraDevice × deviceCount × tier × (days/30).
  // Раньше эта сумма игнорировалась — юзер видел общую цену с устройствами, а
  // списывали только базовую (см. баг-репорт о 149₽ вместо суммы с устройствами).
  let newExtrasTotal = 0;
  if (!extendsSecondarySubId && requestedExtras > 0) {
    const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
    const r = calcExtrasPrice(
      tariff.pricePerExtraDevice ?? 0,
      requestedExtras,
      tariff.deviceDiscountTiers,
      effectiveDays,
    );
    newExtrasTotal = r.extrasTotal;
  }
  let basePriceForTariff = unitPrice + extrasTotal + newExtrasTotal;

  // customPrice (T7c) DEPRECATED.
  // Раньше при докупе устройств цена накапливалась в Subscription.customPrice,
  // но эта схема ломалась при смене длительности продления.
  // Теперь количество устройств хранится в Subscription.extraDevices (Int),
  // а цена считается формулой выше: selectedOption.price + extraDevices × pricePerDevice × (days/30).
  let finalPrice = basePriceForTariff;

  // Персональная скидка админа — применяется первой.
  const pdTariff = await applyPersonalDiscount(finalPrice, clientRaw.id);
  finalPrice = pdTariff.amount;
  const tariffPersonalDiscount = pdTariff.personalDiscountPercent;

  // Промокод на скидку
  let promoCodeRecord: { id: string } | null = null;
  if (promoCodeStr?.trim()) {
    const result = await validatePromoCode(promoCodeStr.trim(), clientRaw.id);
    if (!result.ok) {
      const isStale = result.status === 404 || /истёк|not found/i.test(result.error);
      if (!isStale) return res.status(result.status).json({ message: result.error });
    } else {
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });

      if (promo.discountPercent && promo.discountPercent > 0) {
        finalPrice = Math.max(0, finalPrice - finalPrice * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        finalPrice = Math.max(0, finalPrice - promo.discountFixed);
      }
      finalPrice = Math.round(finalPrice * 100) / 100;
      promoCodeRecord = promo;
    }
  }

  // Проверяем баланс (с учётом наценки клона)
  const clientDb = await prisma.client.findUnique({ where: { id: clientRaw.id } });
  if (!clientDb) return res.status(401).json({ message: "Unauthorized" });
  const tariffPaySnap = await paymentSnapshotProduct(clientRaw.id, finalPrice);

  // Атомик debit ДО активации в Remna. Раньше было: проверили баланс, активировали
  // тариф, потом списали. Между check и debit юзер мог нажать "купить" 30 раз —
  // получал 30 продлений за 100₽. Теперь сначала списываем, и если Remna откажет —
  // откатываем взад.
  const debit = await prisma.client.updateMany({
    where: { id: clientRaw.id, balance: { gte: tariffPaySnap.amount } },
    data: { balance: { decrement: tariffPaySnap.amount } },
  });
  if (debit.count === 0) {
    return res.status(400).json({ message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${tariffPaySnap.amount.toFixed(2)}` });
  }

  // УНИФИЦИРОВАННАЯ покупка балансом.
  //
  // 1. extendsSecondarySubId → явное продление конкретной подписки.
  // 2. ИНАЧЕ → ВСЕГДА новая подписка через createAdditionalSubscription.
  //    Старая ветка `activateTariffForClient` (которая продлевала Subscription[0]) удалена,
  //    потому что: «обычная покупка тарифа» должна создавать НОВУЮ подписку, а не складывать
  //    дни в primary. Хочешь продлить — нажми «Продлить подписку» (передаст extendsSecondarySubId).
  let activateResult: { ok: true; subscriptionId?: string } | { ok: false; error: string; status: number };
  let isExtendingSecondary = false;
  let createdSubscriptionId: string | null = null;

  if (extendsSecondarySubId) {
    const sec = await prisma.subscription.findUnique({
      where: { id: extendsSecondarySubId },
      select: { ownerId: true, giftedToClientId: true },
    });
    if (!sec || (sec.ownerId !== clientRaw.id && sec.giftedToClientId !== clientRaw.id)) {
      await prisma.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: tariffPaySnap.amount } } }).catch(() => {});
      return res.status(403).json({ message: "Доп. подписка не принадлежит вам" });
    }
    const { extendSecondarySubscription } = await import("../tariff/tariff-activation.service.js");
    activateResult = await extendSecondarySubscription(
      extendsSecondarySubId,
      tariff,
      selectedOption ? { id: selectedOption.id, durationDays: selectedOption.durationDays, price: selectedOption.price } : undefined,
      requestedExtras,
    );
    isExtendingSecondary = true;
    createdSubscriptionId = extendsSecondarySubId;
  } else {
    // Любая «новая покупка тарифа» — через единый createAdditionalSubscription.
    // Для свежего клиента она получит subscriptionIndex=0 (= главная). Для уже имеющего
    // подписки — следующий свободный индекс. Без затирания/смешивания.
    void asAdditional;
    const { createAdditionalSubscription } = await import("../gift/gift.service.js");
    const addResult = await createAdditionalSubscription(clientRaw.id, {
      id: tariff.id,
      name: tariff.name,
      price: tariffPaySnap.amount,
      durationDays: selectedOption?.durationDays ?? tariff.durationDays,
      trafficLimitBytes: tariff.trafficLimitBytes,
      deviceLimit: tariff.deviceLimit,
      includedDevices: tariff.includedDevices,
      internalSquadUuids: tariff.internalSquadUuids,
      trafficResetMode: tariff.trafficResetMode ?? undefined,
    }, { extraDevices: requestedExtras, skipConfigCheck: true });
    activateResult = addResult.ok
      ? { ok: true, subscriptionId: addResult.data.subscriptionId }
      : { ok: false, error: addResult.error, status: addResult.status };
    if (addResult.ok) createdSubscriptionId = addResult.data.subscriptionId;
  }
  if (!activateResult.ok) {
    // Remna послала — возвращаем бабки.
    await prisma.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: tariffPaySnap.amount } } }).catch(() => {});
    return res.status(activateResult.status).json({ message: activateResult.error });
  }
  // NB: списание уже сделано атомарно выше — повторного decrement тут НЕ надо.

  // если юзер выбрал «продлить без устройств»
  // — после успешного extending удаляем все доп. устройства.
  if (removeExtrasOnActivate === true && extendsSecondarySubId) {
    try {
      const { removeAllExtraDevicesForSub } = await import("../subscription/extras.helper.js");
      await removeAllExtraDevicesForSub(extendsSecondarySubId);
    } catch (e) {
      console.error("[balance pay] removeExtras after activation failed:", e);
    }
  }

  // Создаём запись об оплате
  const orderId = randomUUID();
  const tariffMeta: Record<string, unknown> = {};
  if (promoCodeRecord) Object.assign(tariffMeta, { promoCodeId: promoCodeRecord.id, originalPrice: basePriceForTariff });
  if (tariffPersonalDiscount > 0) {
    tariffMeta.personalDiscountPercent = tariffPersonalDiscount;
    if (!tariffMeta.originalPrice) tariffMeta.originalPrice = basePriceForTariff;
  }
  // T7b: пишем маркер продления в metadata (для аудита и для re-activate если webhook).
  if (extendsSecondarySubId) tariffMeta.extendsSecondarySubId = extendsSecondarySubId;
  // флаг удаления доп. устройств при активации.
  if (removeExtrasOnActivate === true && extendsSecondarySubId) tariffMeta.removeExtrasOnActivate = true;
  // T-fix (11.05.2026): маркер покупки доп. подписки балансом (без gift).
  if (asAdditional && !extendsSecondarySubId) tariffMeta.isAdditionalSubscription = true;
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId: clientRaw.id,
      orderId,
      amount: tariffPaySnap.amount,
      currency: tariff.currency.toUpperCase(),
      status: "PAID",
      provider: "balance",
      tariffId,
      tariffPriceOptionId: selectedOption?.id ?? null,
      deviceCount: requestedExtras,
      paidAt: new Date(),
      metadata: Object.keys(tariffMeta).length > 0 ? JSON.stringify(tariffMeta) : null,
    }),
  });

  // Записываем использование промокода
  if (promoCodeRecord) {
    await prisma.promoCodeUsage.create({ data: { promoCodeId: promoCodeRecord.id, clientId: clientRaw.id } });
  }

  // Реферальные начисления
  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch(() => {});

  // сразу после payment.create — линкуем subscriptionId
  // (для notifyTariffActivated и админ-аналитики). Бэк-веб-хуки делают это в activateTariffByPaymentId,
  // но в балансовой ветке мы сами создаём подписку → надо явно прокинуть.
  if (createdSubscriptionId) {
    await prisma.payment.update({ where: { id: payment.id }, data: { subscriptionId: createdSubscriptionId } }).catch(() => {});
  }

  // T-unify-purchase: красивое уведомление в TG-бот с кнопками — теперь и при оплате балансом.
  // Раньше бот сам показывал сухой текст из HTTP-ответа. Теперь шлём ту же rich-нотификацию,
  // что и при оплате картой / криптой / прочими провайдерами.
  const { notifyTariffActivated } = await import("../notification/telegram-notify.service.js");
  notifyTariffActivated(clientRaw.id, payment.id).catch((e) => {
    console.error("[balance-purchase] notifyTariffActivated failed:", e);
  });

  // сжигаем одноразовую персональную скидку
  // после продуктовой покупки тарифа балансом.
  {
    const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
    await extinguishOneTimeDiscount(clientRaw.id).catch(() => {});
  }

  // T7b: сообщение клиенту — продлено или активировано (как fallback в кабинете/мини-аппе).
  const okMessage = isExtendingSecondary
    ? `🔄 Подписка продлена на ${effectiveDays} дн.! Списано ${tariffPaySnap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`
    : `Тариф «${tariff.name}» активирован! Списано ${tariffPaySnap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`;
  return res.json({
    message: okMessage,
    paymentId: payment.id,
    newBalance: clientDb.balance - tariffPaySnap.amount,
  });
});

// ——— Гибкий тариф (собери сам): расчёт и оплата балансом ———
function getCustomBuildConfig(config: Awaited<ReturnType<typeof getSystemConfig>>) {
  const c = config as {
    customBuildEnabled?: boolean;
    customBuildPricePerDay?: number;
    customBuildPricePerDevice?: number;
    customBuildTrafficMode?: string;
    customBuildPricePerGb?: number;
    customBuildSquadUuid?: string | null;
    customBuildCurrency?: string;
    customBuildMaxDays?: number;
    customBuildMaxDevices?: number;
  };
  if (!c.customBuildEnabled || !c.customBuildSquadUuid?.trim()) return null;
  return {
    pricePerDay: c.customBuildPricePerDay ?? 0,
    pricePerDevice: c.customBuildPricePerDevice ?? 0,
    trafficMode: c.customBuildTrafficMode === "per_gb" ? "per_gb" as const : "unlimited" as const,
    pricePerGb: c.customBuildPricePerGb ?? 0,
    squadUuid: c.customBuildSquadUuid.trim(),
    currency: (c.customBuildCurrency || "rub").toLowerCase(),
    maxDays: Math.min(360, Math.max(1, c.customBuildMaxDays ?? 360)),
    maxDevices: Math.min(20, Math.max(1, c.customBuildMaxDevices ?? 10)),
  };
}

const customBuildPayByBalanceSchema = z.object({
  days: z.number().int().min(1).max(360),
  devices: z.number().int().min(1).max(20),
  trafficGb: z.number().min(0).nullable().optional(),
  promoCode: z.string().max(50).optional(),
});

clientRouter.post("/custom-build/pay-balance", async (req, res) => {
  const clientRaw = (req as unknown as { client: { id: string } }).client;
  const parsed = customBuildPayByBalanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });

  const config = await getSystemConfig();
  const cfg = getCustomBuildConfig(config);
  if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });

  let { days, devices, trafficGb } = parsed.data;
  if (days > cfg.maxDays || devices > cfg.maxDevices) {
    return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
  }
  const trafficLimitBytes =
    cfg.trafficMode === "per_gb"
      ? (trafficGb != null && trafficGb >= 0 ? BigInt(Math.round(trafficGb * 1024 ** 3)) : null)
      : null;

  let amount = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
  if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) {
    amount += trafficGb * cfg.pricePerGb;
  }

  let finalPrice = amount;

  // Персональная скидка админа применяется первой.
  const pdCustom = await applyPersonalDiscount(finalPrice, clientRaw.id);
  finalPrice = pdCustom.amount;
  const customPersonalDiscount = pdCustom.personalDiscountPercent;

  let promoCodeRecord: { id: string } | null = null;
  if (parsed.data.promoCode?.trim()) {
    const result = await validatePromoCode(parsed.data.promoCode.trim(), clientRaw.id);
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    const promo = result.promo;
    if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
    if (promo.discountPercent && promo.discountPercent > 0) {
      finalPrice = Math.max(0, finalPrice - finalPrice * promo.discountPercent / 100);
    }
    if (promo.discountFixed && promo.discountFixed > 0) {
      finalPrice = Math.max(0, finalPrice - promo.discountFixed);
    }
    finalPrice = Math.round(finalPrice * 100) / 100;
    promoCodeRecord = promo;
  }

  const clientDb = await prisma.client.findUnique({ where: { id: clientRaw.id } });
  if (!clientDb) return res.status(401).json({ message: "Unauthorized" });
  const customSnap = await paymentSnapshotProduct(clientRaw.id, finalPrice);

  // Тот же TOCTOU, что в /payments/balance: read balance → check → activate (Remna,
  // сотни мс) → write decrement. Параллельные запросы все проходят check со стейтом
  // ДО первого debit'а — баланс уезжал в минус. Чиним атомарным debit'ом ДО
  // activate; при ошибке активации — refund.
  const debit = await prisma.client.updateMany({
    where: { id: clientRaw.id, balance: { gte: customSnap.amount } },
    data: { balance: { decrement: customSnap.amount } },
  });
  if (debit.count === 0) {
    return res.status(400).json({
      message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${customSnap.amount.toFixed(2)} ${cfg.currency.toUpperCase()}`,
    });
  }

  const metadata = JSON.stringify({
    customBuild: {
      durationDays: days,
      deviceLimit: devices,
      trafficLimitBytes: trafficLimitBytes != null ? Number(trafficLimitBytes) : null,
      internalSquadUuids: [cfg.squadUuid],
    },
    ...(promoCodeRecord && { promoCodeId: promoCodeRecord.id, originalPrice: amount }),
    ...(customPersonalDiscount > 0 && { personalDiscountPercent: customPersonalDiscount, originalPrice: amount }),
  });

  const orderId = randomUUID();
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId: clientRaw.id,
      orderId,
      amount: customSnap.amount,
      currency: cfg.currency.toUpperCase(),
      status: "PAID",
      provider: "balance",
      paidAt: new Date(),
      metadata,
    }),
  });

  const activation = await activateTariffByPaymentId(payment.id);
  if (!activation.ok) {
    // Активация провалилась — возвращаем бабки на баланс.
    await prisma.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: customSnap.amount } } }).catch(() => {});
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(activation.status).json({ message: activation.error });
  }

  // NB: списание уже сделано атомарно выше — повторного decrement тут НЕ надо.
  if (promoCodeRecord) {
    await prisma.promoCodeUsage.create({ data: { promoCodeId: promoCodeRecord.id, clientId: clientRaw.id } });
  }

  // сжигаем одноразовую персональную скидку
  // после продуктовой покупки кастомного билда балансом.
  {
    const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
    await extinguishOneTimeDiscount(clientRaw.id).catch(() => {});
  }

  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch((e) => console.error("[referral] Error:", e));

  const after = await prisma.client.findUnique({ where: { id: clientRaw.id }, select: { balance: true } });
  return res.json({
    message: `Подписка на ${days} дн., ${devices} ${devices === 1 ? "устройство" : "устройства"} активирована. Списано ${customSnap.amount.toFixed(2)} ${cfg.currency.toUpperCase()}.`,
    paymentId: payment.id,
    newBalance: after?.balance ?? clientDb.balance - customSnap.amount,
  });
});

// ——— Оплата опции (доп. трафик/устройства/сервер) балансом ———
const payOptionByBalanceSchema = z.object({
  extraOption: z.object({ kind: z.enum(["traffic", "devices", "servers"]), productId: z.string().min(1) }),
  // к какой подписке применить опцию.
  // Если передан — apply к secondary с этим id (+ её customPrice += сумма опции).
  // Если null/undefined — apply к primary (как раньше) + client.customPrimaryPrice += сумма опции.
  targetSubscriptionId: z.string().min(1).max(64).optional(),
});
clientRouter.post("/payments/balance/option", async (req, res) => {
  const clientRaw = (req as unknown as { clientId: string }).clientId;
  const parsed = payOptionByBalanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });

  const config = await getSystemConfig();
  if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
    return res.status(400).json({ message: "Продажа опций отключена" });
  }

  const cfg = config as {
    sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
    sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
    sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[];
  };
  const { kind, productId } = parsed.data.extraOption;
  const targetSubscriptionId = parsed.data.targetSubscriptionId?.trim() || null;
  let price: number;
  let currency: string;
  let metadataExtra: Record<string, unknown>;

  if (kind === "traffic") {
    const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ message: "Опция не найдена" });
    price = product.price;
    currency = product.currency;
    metadataExtra = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
  } else if (kind === "devices") {
    const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ message: "Опция не найдена" });
    // масштабируем цену по оставшимся дням подписки
    // Если targetSubscriptionId передан — используем его; иначе ищем primary
    let prorataCoef = 1;
    if (targetSubscriptionId) {
      prorataCoef = await calculateDevicesProrataPriceCoefficient(targetSubscriptionId);
    } else {
      prorataCoef = await calculateDevicesProrataPriceCoefficientForPrimary(clientRaw);
    }
    price = Math.floor(product.price * prorataCoef);
    currency = product.currency;
    metadataExtra = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
  } else {
    const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ message: "Опция не найдена" });
    price = product.price;
    currency = product.currency;
    metadataExtra = {
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
  }

  const clientDb = await prisma.client.findUnique({ where: { id: clientRaw } });
  if (!clientDb) return res.status(401).json({ message: "Unauthorized" });

  // валидируем, что secondary принадлежит клиенту.
  // Если targetSubscriptionId не передан — опция применится к primary (старое поведение).
  if (targetSubscriptionId) {
    const sec = await prisma.subscription.findUnique({
      where: { id: targetSubscriptionId },
      select: { ownerId: true, remnawaveUuid: true },
    });
    if (!sec || sec.ownerId !== clientDb.id || !sec.remnawaveUuid) {
      return res.status(400).json({ message: "Подписка для опции не найдена" });
    }
    metadataExtra.targetSubscriptionId = targetSubscriptionId;
  }

  const pdOption = await applyPersonalDiscount(price, clientDb.id);
  const finalOptionPrice = pdOption.amount;
  const optSnap = await paymentSnapshotProduct(clientDb.id, finalOptionPrice);

  // Та же дыра, что в остальных balance-эндпоинтах: read balance → check →
  // applyExtraOptionByPaymentId (Remna API, сотни мс) → write decrement.
  // Между read и write 5+ параллельных запросов проходили check одинаково и
  // получали несколько опций за одну стоимость. Чиним атомарным debit'ом.
  const debit = await prisma.client.updateMany({
    where: { id: clientDb.id, balance: { gte: optSnap.amount } },
    data: { balance: { decrement: optSnap.amount } },
  });
  if (debit.count === 0) {
    return res.status(400).json({ message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${optSnap.amount.toFixed(2)}` });
  }
  if (pdOption.personalDiscountPercent > 0) {
    (metadataExtra as Record<string, unknown>).personalDiscountPercent = pdOption.personalDiscountPercent;
    (metadataExtra as Record<string, unknown>).originalPrice = price;
  }

  const orderId = randomUUID();
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId: clientDb.id,
      orderId,
      amount: optSnap.amount,
      currency: currency.toUpperCase(),
      status: "PAID",
      provider: "balance",
      paidAt: new Date(),
      metadata: JSON.stringify(metadataExtra),
    }),
  });

  const applyResult = await applyExtraOptionByPaymentId(payment.id);
  if (!applyResult.ok) {
    // Применение опции в Remna провалилось — возвращаем баланс.
    await prisma.client.update({ where: { id: clientDb.id }, data: { balance: { increment: optSnap.amount } } }).catch(() => {});
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(applyResult.status).json({ message: (applyResult as { error?: string }).error || "Ошибка применения опции" });
  }

  // NB: списание уже сделано атомарно выше — повторного decrement тут НЕ надо.

  // уведомляем клиента после успешной активации опции.
  const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
  notifyExtraOptionApplied(clientDb.id, payment.id).catch(() => {});

  // сжигаем одноразовую персональную скидку.
  {
    const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
    await extinguishOneTimeDiscount(clientDb.id).catch(() => {});
  }

  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch(() => {});

  const after = await prisma.client.findUnique({ where: { id: clientDb.id }, select: { balance: true } });
  return res.json({
    message: "Опция применена. Списано с баланса.",
    paymentId: payment.id,
    newBalance: after?.balance ?? clientDb.balance - optSnap.amount,
  });
});

// ——— ЮMoney: пополнение баланса ———

clientRouter.get("/yoomoney/auth-url", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const config = await getSystemConfig();
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  if (!config.yoomoneyClientId?.trim() || !appUrl) {
    return res.status(503).json({ message: "ЮMoney не настроен или не указан URL приложения" });
  }
  const redirectUri = `${appUrl}/api/client/yoomoney/callback`;
  const state = yoomoneyStateSign(clientId);
  const url = getAuthUrl({ clientId: config.yoomoneyClientId, redirectUri, state });
  return res.json({ url });
});

const yoomoneyRequestTopupSchema = z.object({ amount: z.number().positive().max(1e7) });
clientRouter.post("/yoomoney/request-topup", async (req, res) => {
  const client = (req as unknown as { client: { id: string; yoomoneyAccessToken?: string | null } }).client;
  const parsed = yoomoneyRequestTopupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Укажите сумму", errors: parsed.error.flatten() });
  const { amount } = parsed.data;
  if (!client.yoomoneyAccessToken?.trim()) {
    return res.status(400).json({ message: "Сначала подключите кошелёк ЮMoney" });
  }
  const config = await getSystemConfig();
  const receiver = config.yoomoneyReceiverWallet?.trim();
  if (!receiver) return res.status(503).json({ message: "ЮMoney не настроен" });

  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const amountRounded = Math.round(amount * 100) / 100;
  const orderId = randomUUID();
  const topSnap = await paymentSnapshotTopup(client.id, amountRounded);
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId: client.id,
      orderId,
      amount: topSnap.amount,
      currency: "RUB",
      status: "PENDING",
      provider: "yoomoney",
      metadata: JSON.stringify({ type: "balance_topup" }),
    }),
  });

  const result = await requestPayment(client.yoomoneyAccessToken, {
    to: receiver,
    amount_due: topSnap.amount,
    label: payment.id,
    message: `Пополнение баланса ${serviceName}. Заказ ${orderId}`,
    comment: `Пополнение баланса`,
  });

  if (result.status === "refused") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(400).json({ message: result.error_description ?? result.error });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { metadata: JSON.stringify({ type: "balance_topup", request_id: result.request_id }) },
  });

  return res.json({
    paymentId: payment.id,
    request_id: result.request_id,
    money_source: result.money_source,
    contract_amount: result.contract_amount,
  });
});

const yoomoneyProcessPaymentSchema = z.object({
  paymentId: z.string().min(1),
  request_id: z.string().min(1),
  money_source: z.string().optional(),
  csc: z.string().max(10).optional(),
});
clientRouter.post("/yoomoney/process-payment", async (req, res) => {
  const client = (req as unknown as { client: { id: string; yoomoneyAccessToken?: string | null } }).client;
  const parsed = yoomoneyProcessPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
  const { paymentId, request_id, money_source, csc } = parsed.data;

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, clientId: client.id, status: "PENDING", provider: "yoomoney" },
  });
  if (!payment) return res.status(404).json({ message: "Платёж не найден или уже обработан" });
  if (!client.yoomoneyAccessToken?.trim()) return res.status(400).json({ message: "Кошелёк ЮMoney не подключён" });

  const result = await processPayment(client.yoomoneyAccessToken, { request_id, money_source, csc });

  if (result.status === "in_progress") {
    return res.status(202).json({ status: "in_progress", message: "Платёж обрабатывается, повторите запрос через минуту" });
  }
  if (result.status === "ext_auth_required") {
    return res.status(200).json({ status: "ext_auth_required", acs_uri: result.acs_uri, acs_params: result.acs_params });
  }
  if (result.status === "refused") {
    return res.status(400).json({ message: result.error });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PAID", paidAt: new Date(), externalId: result.payment_id ?? undefined },
  });
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { balance: { increment: payment.amount } },
    select: { balance: true },
  });

  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch((e) => console.error("[referral] yoomoney process-payment:", e));

  return res.json({ message: "Баланс пополнен", newBalance: updated.balance });
});

// ——— ЮMoney: форма перевода (оплата картой). Пополнение баланса, тариф или опция ———
const yoomoneyFormPaymentSchema = z.object({
  amount: z.number().positive().max(1e7).optional(),
  paymentType: z.enum(["PC", "AC"]), // PC = с кошелька, AC = с карты
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // покупка как доп. подписка — см. yookassa-схему выше.
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
  // продление существующей secondary (вместо создания новой).
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  extraOption: z.object({ kind: z.enum(["traffic", "devices", "servers"]), productId: z.string().min(1), targetSubscriptionId: z.string().min(1).optional() }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
clientRouter.post("/yoomoney/create-form-payment", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const parsed = yoomoneyFormPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Укажите сумму и способ оплаты", errors: parsed.error.flatten() });
  const { amount: amountBody, paymentType, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;
  const config = await getSystemConfig();
  const receiver = config.yoomoneyReceiverWallet?.trim();
  if (!receiver) return res.status(503).json({ message: "ЮMoney не настроен" });

  let tariffIdToStore: string | null = null;
  let proxyTariffIdToStore: string | null = null;
  let singboxTariffIdToStore: string | null = null;
  let amountRounded: number;
  let metadataObj: Record<string, unknown> = { paymentType };
  let yoomoneyPromoRecord: PromoCodeRow | null = null;
  let yoomoneyOriginalAmount: number | null = null;

  if (customBuildBody) {
    const cfg = getCustomBuildConfig(config);
    if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
    let { days, devices, trafficGb } = customBuildBody;
    if (days > cfg.maxDays || devices > cfg.maxDevices) {
      return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
    }
    const trafficLimitBytes =
      cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
        ? Math.round(trafficGb * 1024 ** 3)
        : null;
    amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
    if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
    amountRounded = Math.round(amountRounded * 100) / 100;
    metadataObj = {
      paymentType,
      customBuild: {
        durationDays: days,
        deviceLimit: devices,
        trafficLimitBytes,
        internalSquadUuids: [cfg.squadUuid],
      },
    };
  } else if (extraOption) {
    if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
      return res.status(400).json({ message: "Продажа опций отключена" });
    }
    const cfg = config as {
      sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
      sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
      sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[];
    };
    if (extraOption.kind === "traffic") {
      const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      amountRounded = Math.round(product.price * 100) / 100;
      metadataObj = { paymentType, extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
    } else if (extraOption.kind === "devices") {
      const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      // масштабируем цену для primary подписки
      const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
      amountRounded = Math.floor(product.price * prorataCoef);
      metadataObj = { paymentType, extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
    } else {
      const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      amountRounded = Math.round(product.price * 100) / 100;
      metadataObj = {
        paymentType,
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
    }
    if (parsed.data.extraOption?.targetSubscriptionId) {
      metadataObj = { ...metadataObj, targetSubscriptionId: parsed.data.extraOption.targetSubscriptionId };
    }
  } else {
    if (amountBody == null && !tariffIdBody && !proxyTariffIdBody && !singboxTariffIdBody) return res.status(400).json({ message: "Укажите сумму" });
    if (tariffIdBody) {
      const tariff = await prisma.tariff.findUnique({ where: { id: tariffIdBody }, include: { priceOptions: true } });
      if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
      // кулдаун ПРОДЛЕНИЯ существующей подписки.
      // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого тарифа
      // (как доп. подписки) не ограничиваются.
      if (parsed.data.extendsSecondarySubId) {
        const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
        const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId);
        if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
      }
      tariffIdToStore = tariffIdBody;
      // Цена: priceOption если выбран, иначе tariff.price
      let unitPrice = tariff.price;
      const optId = (parsed.data as { tariffPriceOptionId?: string }).tariffPriceOptionId;
      if (optId) {
        const opt = (tariff.priceOptions ?? []).find((p) => p.id === optId);
        if (opt) unitPrice = opt.price;
      }
      amountRounded = Math.round((amountBody ?? unitPrice) * 100) / 100;
      if (promoCodeStr?.trim()) {
        const result = await validatePromoCode(promoCodeStr.trim(), clientId);
        if (result.ok && result.promo.type === "DISCOUNT") {
          const promo = result.promo;
          yoomoneyOriginalAmount = amountRounded;
          yoomoneyPromoRecord = promo;
          if (promo.discountPercent && promo.discountPercent > 0) amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
          if (promo.discountFixed && promo.discountFixed > 0) amountRounded = Math.max(0, amountRounded - promo.discountFixed);
          amountRounded = Math.round(amountRounded * 100) / 100;
        }
      }
    } else if (proxyTariffIdBody) {
      const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
      if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
      proxyTariffIdToStore = proxyTariffIdBody;
      amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
    } else if (singboxTariffIdBody) {
      const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
      if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
      singboxTariffIdToStore = singboxTariffIdBody;
      amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
    } else {
      amountRounded = Math.round((amountBody ?? 0) * 100) / 100;
    }
  }

  if (amountRounded < 1) {
    return res.status(400).json({ message: "Минимальная сумма платежа — 1" });
  }

  // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
  const yoomoneyIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
  let yoomoneyPersonalDiscount = 0;
  if (!yoomoneyIsTopup) {
    const originalBeforePersonal = amountRounded;
    const pd = await applyPersonalDiscount(amountRounded, clientId);
    if (pd.personalDiscountPercent > 0) {
      amountRounded = pd.amount;
      yoomoneyPersonalDiscount = pd.personalDiscountPercent;
      if (yoomoneyOriginalAmount == null) yoomoneyOriginalAmount = originalBeforePersonal;
    }
  }

  if (yoomoneyPromoRecord != null && yoomoneyOriginalAmount != null) {
    metadataObj = { ...metadataObj, promoCodeId: yoomoneyPromoRecord.id, originalAmount: yoomoneyOriginalAmount };
  }
  if (yoomoneyPersonalDiscount > 0) {
    metadataObj = { ...metadataObj, personalDiscountPercent: yoomoneyPersonalDiscount, ...(yoomoneyOriginalAmount != null ? { originalAmount: yoomoneyOriginalAmount } : {}) };
  }

  const yoomoneySnap = yoomoneyIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
  const yoomoneyCharge = yoomoneySnap.amount;

  const orderId = randomUUID();
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId,
      orderId,
      amount: yoomoneySnap.amount,
      currency: "RUB",
      status: "PENDING",
      provider: "yoomoney_form",
      tariffId: tariffIdToStore,
      tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
      deviceCount: parsed.data.deviceCount ?? null,
      proxyTariffId: proxyTariffIdToStore,
      singboxTariffId: singboxTariffIdToStore,
      // see yookassa endpoint for explanation.
      metadata: (parsed.data.asAdditional && tariffIdToStore)
        ? JSON.stringify({ ...metadataObj, isAdditionalSubscription: true, ...(parsed.data.asGift ? { purchasedAsGift: true } : {}), ...(parsed.data.extendsSecondarySubId ? { extendsSecondarySubId: parsed.data.extendsSecondarySubId } : {}) })
        : JSON.stringify(parsed.data.extendsSecondarySubId ? { ...metadataObj, extendsSecondarySubId: parsed.data.extendsSecondarySubId } : metadataObj),
    }),
  });

  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const successURL = appUrl ? `${appUrl}/cabinet?yoomoney_form=success` : "";
  const targets = tariffIdToStore
    ? `Тариф ${serviceName} #${orderId}`
    : proxyTariffIdToStore
      ? `Прокси ${serviceName} #${orderId}`
      : singboxTariffIdToStore
        ? `Доступы ${serviceName} #${orderId}`
        : customBuildBody
          ? `Гибкий тариф ${serviceName} #${orderId}`
          : extraOption
            ? `Опция ${serviceName} #${orderId}`
            : `Пополнение баланса ${serviceName} #${orderId}`;
  const params = new URLSearchParams({
    receiver,
    "quickpay-form": "shop",
    targets,
    sum: String(yoomoneyCharge),
    paymentType,
    label: payment.id.slice(0, 64),
    successURL,
  });
  const rawPaymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?${params.toString()}`;
  const paymentUrl = await saveRedirectAndBuildUrl(payment.id, orderId, rawPaymentUrl, config.publicAppUrl);

  return res.status(201).json({
    paymentId: payment.id,
    paymentUrl,
    form: {
      receiver,
      sum: yoomoneyCharge,
      label: payment.id,
      paymentType,
      successURL,
    },
    successURL,
  });
});

clientRouter.get("/yoomoney/form-payment/:paymentId", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const paymentId = typeof req.params.paymentId === "string" ? req.params.paymentId : "";
  if (!paymentId) return res.status(400).json({ message: "paymentId required" });

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, clientId, status: "PENDING", provider: "yoomoney_form" },
    select: { id: true, amount: true, metadata: true },
  });
  if (!payment) return res.status(404).json({ message: "Платёж не найден или уже оплачен" });

  const config = await getSystemConfig();
  const receiver = config.yoomoneyReceiverWallet?.trim();
  if (!receiver) return res.status(503).json({ message: "ЮMoney не настроен" });

  let paymentType = "PC";
  try {
    const meta = payment.metadata ? JSON.parse(payment.metadata) as { paymentType?: string } : {};
    if (meta.paymentType === "AC" || meta.paymentType === "PC") paymentType = meta.paymentType;
  } catch { /* ignore */ }

  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const successURL = appUrl ? `${appUrl}/cabinet?yoomoney_form=success` : "";

  return res.json({
    receiver,
    sum: payment.amount,
    label: payment.id,
    paymentType,
    successURL,
  });
});

// ——— ЮKassa API: создание платежа (тариф, пополнение или опция), редирект на confirmation_url ———
const yookassaCreatePaymentSchema = z.object({
  amount: z.number().positive().max(1e7).optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().optional(),
  // покупка тарифа как ДОП. подписки (а не модификация основной).
  // На webhook'е activateTariffByPaymentId увидит metadata.isAdditionalSubscription и
  // вызовет createAdditionalSubscription. Игнорируется без tariffId.
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
  // продление существующей secondary (вместо создания новой).
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  extraOption: z.object({
    kind: z.enum(["traffic", "devices", "servers"]),
    productId: z.string().min(1),
    targetSubscriptionId: z.string().min(1).optional(),
  }).optional(),
  customBuild: z.object({
    days: z.number().int().min(1).max(360),
    devices: z.number().int().min(1).max(20),
    trafficGb: z.number().min(0).nullable().optional(),
  }).optional(),
  // 54-ФЗ-чек: email юзера, которому ЮКасса отправит чек.
  // Если задан и валиден — переопределяет client.email; пустая строка значит «без чека»
  // (используется рандомный placeholder вида randomname@gmail.com — см. yookassa.service.ts).
  // Если client.email пустой, а тут пришёл валидный — сохраним в clients.email.
  receiptEmail: z.string().max(254).optional(),
});
clientRouter.post("/yookassa/create-payment", async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = yookassaCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode, extraOption, customBuild: customBuildBody, extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;
    const config = await getSystemConfig();
    const shopId = config.yookassaShopId?.trim();
    const secretKey = config.yookassaSecretKey?.trim();
    if (!shopId || !secretKey) return res.status(503).json({ message: "ЮKassa не настроена" });

    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCode ? { promoCode } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      let { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
      if (currencyUpper !== "RUB") return res.status(400).json({ message: "ЮKassa принимает только рубли (RUB)" });
    } else if (extraOption) {
      if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
        return res.status(400).json({ message: "Продажа опций отключена" });
      }
      const cfg = config as {
        sellOptionsTrafficEnabled?: boolean;
        sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
        sellOptionsDevicesEnabled?: boolean;
        sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
        sellOptionsServersEnabled?: boolean;
        sellOptionsServersProducts?: SellOptionServerProduct[];
      };
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = {
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
      }
      if (parsed.data.extraOption?.targetSubscriptionId) {
        metadataObj = { ...metadataObj, targetSubscriptionId: parsed.data.extraOption.targetSubscriptionId };
      }
      if (currencyUpper !== "RUB") return res.status(400).json({ message: "ЮKassa принимает только рубли (RUB)" });
    } else {
      currencyUpper = (currencyBody ?? "RUB").toUpperCase();
      if (currencyUpper !== "RUB") return res.status(400).json({ message: "ЮKassa принимает только рубли (RUB)" });
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        if (parsed.data.extendsSecondarySubId) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        } else {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
    } else {
      if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
      amountRounded = Math.round(amountBody * 100) / 100;
    }
  }

    if (amountRounded < 1) {
      return res.status(400).json({ message: "Минимальная сумма платежа — 1" });
    }

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const yookassaIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!yookassaIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    let promoCodeRecord: { id: string } | null = null;
    if (promoCode?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCode.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      promoCodeRecord = promo;
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      // добавили telegramId: используем в description платежа
      // YooKassa, чтобы админ мог быстро искать платежи по tg_id в кабинете провайдера.
      select: { email: true, telegramUsername: true, telegramId: true },
    });
    // 3 случая для customerEmail (54-ФЗ-чек):
    //   • receiptEmail отсутствует в body (undefined)  → legacy fallback на client.email
    //     (для совместимости с autopay/cron которые вообще про email-prompt не знают).
    //   • receiptEmail === ""                          → юзер явно нажал "Нет, продолжить"
    //     в боте → НЕ слать чек, оставить placeholder.
    //   • receiptEmail = валидный                      → использовать его, сохранить
    //     в client.email если email ещё пустой.
    const receiptEmailKey = parsed.data.receiptEmail;
    let customerEmail: string | null;
    if (typeof receiptEmailKey === "string") {
      // Явный выбор от бота.
      const trimmed = receiptEmailKey.trim();
      const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
      customerEmail = isValidEmail ? trimmed : null; // пустая строка → null → без чека
      if (isValidEmail && !client?.email) {
        await prisma.client.update({
          where: { id: clientId },
          data: { email: trimmed },
        }).catch((e) => console.warn(`[yookassa] failed to save client.email: ${e}`));
      }
    } else {
      // Ключ не передан — legacy путь (например autopay): берём сохранённый.
      customerEmail = client?.email?.trim() || null;
    }

    const ykSnap = yookassaIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const ykCharge = ykSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: ykSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "yookassa",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // mark Payment as additional-subscription if requested AND
        // a tariff is being purchased. activateTariffByPaymentId reads this flag from
        // metadata.isAdditionalSubscription on the webhook and routes activation to
        // createAdditionalSubscription instead of activateTariffForClient.
        // asGift=true → создаём подписку с purchasedAsGift=true (для подарка).
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const returnUrl = appUrl ? `${appUrl}/cabinet?yookassa=success` : "";
    // добавляем tg:<id> в description, чтобы админ мог
    // быстро искать платежи по telegram_id в кабинете YooKassa (раньше там был
    // только orderId UUID, который никак не связать с клиентом без БД).
    const idDesc = (client?.email?.trim() || customerEmail || "").trim();
    // для веб/email-юзеров (без telegramId) кладём email в
    // description, иначе платёж в кабинете YooKassa не связать с клиентом.
    const tgIdSuffix = client?.telegramId ? ` tg:${client.telegramId}` : (idDesc ? ` ${idDesc}` : "");
    const description = (tariffIdToStore
      ? `Тариф ${serviceName} #${orderId}`
      : proxyTariffIdToStore
        ? `Прокси ${serviceName} #${orderId}`
        : singboxTariffIdToStore
          ? `Доступы ${serviceName} #${orderId}`
        : extraOption
          ? `Опция ${serviceName} #${orderId}`
          : `Пополнение баланса ${serviceName} #${orderId}`) + tgIdSuffix;

    const result = await createYookassaPayment({
      shopId,
      secretKey,
      amount: ykCharge,
      currency: currencyUpper,
      returnUrl,
      description,
      metadata: { payment_id: payment.id },
      customerEmail,
      customerTelegramUsername: client?.telegramUsername ?? null,
      savePaymentMethod: config.yookassaRecurringEnabled,
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    const confirmationUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.confirmationUrl, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      confirmationUrl,
      yookassaPaymentId: result.paymentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[yookassa/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
});

// --- Отвязка сохранённого способа оплаты ЮKassa ---
clientRouter.post("/yookassa/unlink-payment-method", async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const cl = await prisma.client.findUnique({ where: { id: clientId }, select: { yookassaPaymentMethodId: true } });
    if (!cl?.yookassaPaymentMethodId) {
      return res.status(400).json({ message: "Нет привязанного способа оплаты" });
    }
    const updated = await prisma.client.update({
      where: { id: clientId },
      data: { yookassaPaymentMethodId: null, yookassaPaymentMethodTitle: null },
      select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, yookassaPaymentMethodTitle: true, onboardingCompleted: true },
    });
    return res.json({ client: toClientShape(updated as Parameters<typeof toClientShape>[0]) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[yookassa/unlink-payment-method]", message, err);
    return res.status(500).json({ message: "Ошибка отвязки способа оплаты" });
  }
});

const cryptopayCreatePaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // покупка как доп. подписка — см. yookassa-схему выше.
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
  // продление существующей secondary (вместо создания новой).
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  extraOption: z.object({
    kind: z.enum(["traffic", "devices", "servers"]),
    productId: z.string().min(1),
    targetSubscriptionId: z.string().min(1).optional(),
  }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
clientRouter.post("/cryptopay/create-payment", async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = cryptopayCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const cryptopayConfig = {
      apiToken: (config as { cryptopayApiToken?: string | null }).cryptopayApiToken ?? "",
      testnet: (config as { cryptopayTestnet?: boolean }).cryptopayTestnet ?? false,
    };
    if (!isCryptopayConfigured(cryptopayConfig)) return res.status(503).json({ message: "Crypto Pay не настроен" });

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody, extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      let { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
      if (parsed.data.extraOption?.targetSubscriptionId) {
        metadataObj = { ...metadataObj, targetSubscriptionId: parsed.data.extraOption.targetSubscriptionId };
      }
    } else {
      currencyUpper = (currencyBody ?? "USD").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        if (parsed.data.extendsSecondarySubId) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        } else {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    const fiatSupported = ["USD", "RUB", "EUR", "UAH", "KZT", "BYN", "UZS", "GEL", "TRY", "AMD", "THB", "INR", "CNY", "GBP", "BRL", "IDR", "AZN", "AED", "PLN", "ILS"];
    if (!fiatSupported.includes(currencyUpper)) return res.status(400).json({ message: "Crypto Pay: поддерживаются USD, RUB, EUR и др. Укажите валюту из списка." });
    if (amountRounded < 0.5) return res.status(400).json({ message: "Минимальная сумма — 0.5" });

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const cryptoIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!cryptoIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    let promoCodeRecord: { id: string } | null = null;
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      promoCodeRecord = promo;
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const cpSnap = cryptoIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const cpCharge = cpSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: cpSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "cryptopay",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    // добавляем tg:<id> в description для удобного поиска
    // платежей в кабинете CryptoPay (зеркалит логику YooKassa).
    const cryptoClient = await prisma.client.findUnique({
      where: { id: clientId },
      select: { telegramId: true },
    });
    const tgIdSuffix = cryptoClient?.telegramId ? ` tg:${cryptoClient.telegramId}` : "";
    const description = (tariffIdToStore
      ? `Тариф ${serviceName} #${orderId}`
      : proxyTariffIdToStore
        ? `Прокси ${serviceName} #${orderId}`
        : singboxTariffIdToStore
          ? `Доступы ${serviceName} #${orderId}`
          : customBuildBody
            ? `Гибкий тариф ${serviceName} #${orderId}`
            : extraOption
              ? `Опция ${serviceName} #${orderId}`
              : `Пополнение баланса ${serviceName} #${orderId}`) + tgIdSuffix;

    const result = await createCryptopayInvoice({
      config: cryptopayConfig,
      amount: String(cpCharge),
      currencyType: "fiat",
      fiat: currencyUpper,
      description: description.slice(0, 1024),
      payload: payment.id,
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.payUrl, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
      miniAppPayUrl: result.miniAppPayUrl,
      webAppPayUrl: result.webAppPayUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cryptopay/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
});

const heleketCreatePaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // покупка как доп. подписка — см. yookassa-схему выше.
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
  // продление существующей secondary (вместо создания новой).
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  extraOption: z.object({
    kind: z.enum(["traffic", "devices", "servers"]),
    productId: z.string().min(1),
    targetSubscriptionId: z.string().min(1).optional(),
  }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
clientRouter.post("/heleket/create-payment", async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = heleketCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const heleketConfig = {
      merchantId: (config as { heleketMerchantId?: string | null }).heleketMerchantId ?? "",
      apiKey: (config as { heleketApiKey?: string | null }).heleketApiKey ?? "",
    };
    if (!isHeleketConfigured(heleketConfig)) return res.status(503).json({ message: "Heleket не настроен" });
    const { extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      let { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "USD").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        if (parsed.data.extendsSecondarySubId) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        } else {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1" });

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const heleketIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!heleketIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    let promoCodeRecord: { id: string } | null = null;
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      promoCodeRecord = promo;
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const hkSnap = heleketIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const hkCharge = hkSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: hkSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "heleket",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const urlCallback = appUrl ? `${appUrl}/api/webhooks/heleket` : undefined;
    const urlSuccess = appUrl ? `${appUrl}/cabinet?heleket=success` : undefined;
    const urlReturn = appUrl ? `${appUrl}/cabinet?heleket=return` : undefined;

    const result = await createHeleketInvoice({
      config: heleketConfig,
      amount: String(hkCharge),
      currency: currencyUpper,
      orderId,
      urlCallback,
      urlSuccess,
      urlReturn,
      additionalData: payment.id,
      lifetime: 3600,
      toCurrency: "usdt",
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.url, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[heleket/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
});

// ═════════════════════════════════════════════════════════════════
// LAVA Business — счета (карты / СБП / СберPay) в рублях.
// API: POST https://api.lava.ru/business/invoice/create
// Подпись: HMAC-SHA256(JSON body, secretKey) → Signature header.
// Валюта Lava Business — только RUB. На нерублёвый тариф — ошибка.
// ═════════════════════════════════════════════════════════════════
const lavaCreatePaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // покупка как доп. подписка — см. yookassa-схему выше.
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
  // продление существующей secondary (вместо создания новой).
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  extraOption: z.object({
    kind: z.enum(["traffic", "devices", "servers"]),
    productId: z.string().min(1),
    targetSubscriptionId: z.string().min(1).optional(),
  }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
clientRouter.post("/lava/create-payment", async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = lavaCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const lavaConfig = {
      shopId: (config as { lavaShopId?: string | null }).lavaShopId ?? "",
      secretKey: (config as { lavaSecretKey?: string | null }).lavaSecretKey ?? "",
    };
    if (!isLavaConfigured(lavaConfig)) return res.status(503).json({ message: "Lava не настроена" });
    const { extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      const { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "RUB").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        if (parsed.data.extendsSecondarySubId) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        } else {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (currencyUpper !== "RUB") {
      return res.status(400).json({ message: "Lava принимает только рубли. Выберите другой метод оплаты." });
    }
    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1 ₽" });

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const lavaIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!lavaIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const lavaSnap = lavaIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const lavaCharge = lavaSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: lavaSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "lava",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const hookUrl = appUrl ? `${appUrl}/api/webhooks/lava` : undefined;
    const successUrl = appUrl ? `${appUrl}/cabinet?lava=success` : undefined;
    const failUrl = appUrl ? `${appUrl}/cabinet?lava=fail` : undefined;

    const result = await createLavaInvoice({
      config: lavaConfig,
      amount: lavaCharge,
      orderId,
      hookUrl,
      successUrl,
      failUrl,
      expire: 300, // 5 часов — стандартный TTL Lava
      comment: `${serviceName} — ${payment.id}`.slice(0, 255),
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    // Сохраняем invoiceId чтобы позже сверять с webhook'ом.
    await prisma.payment.update({ where: { id: payment.id }, data: { externalId: result.invoiceId } });

    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.url, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[lava/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
});

// ═════════════════════════════════════════════════════════════════
// Lava.top — создание инвойса через product/offer модель.
// API: POST https://gate.lava.top/api/v2/invoice
// Auth: X-Api-Key header. У оператора в ЛК Lava.top создан product с
// несколькими offer'ами, мы передаём offerId (берём из тарифа.metadata
// или из system_settings.lavatop_default_offer_id) + email клиента.
// ═════════════════════════════════════════════════════════════════
const lavatopCreatePaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  /** Email клиента — Lava.top требует обязательно. Если не передан, берём из client.email */
  email: z.string().email().optional(),
  /** Кастомный offerId — переопределяет дефолтный из настроек */
  offerId: z.string().min(1).optional(),
  // покупка как доп. подписка — см. yookassa-схему выше.
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
  // продление существующей secondary (вместо создания новой).
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  extraOption: z.object({
    kind: z.enum(["traffic", "devices", "servers"]),
    productId: z.string().min(1),
    targetSubscriptionId: z.string().min(1).optional(),
  }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
clientRouter.post("/lavatop/create-payment", async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = lavatopCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const lavatopConfig = {
      apiKey: (config as { lavatopApiKey?: string | null }).lavatopApiKey ?? "",
      defaultOfferId: (config as { lavatopDefaultOfferId?: string | null }).lavatopDefaultOfferId ?? undefined,
    };
    if (!isLavatopConfigured(lavatopConfig)) return res.status(503).json({ message: "Lava.top не настроена" });
    const { extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { email: true } });
    // Lava.top требует валидный email. Если у клиента нет email (Telegram-only регистрация) —
    // генерим синтетический на основе домена сервиса (config.publicAppUrl). `.local` TLD
    // отклоняется как невалидный, поэтому используем реальный домен оператора.
    let buyerEmail = (parsed.data.email?.trim()) || client?.email?.trim() || "";
    if (!buyerEmail) {
      let domain = "lavatop-receipts.io";
      try {
        const u = new URL(config.publicAppUrl || "https://lavatop-receipts.io");
        if (u.hostname && u.hostname.includes(".") && !u.hostname.endsWith(".local")) domain = u.hostname;
      } catch { /* keep default */ }
      buyerEmail = `client-${clientId}@${domain}`;
    }

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody, offerId: customOfferId } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      const { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "RUB").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        if (parsed.data.extendsSecondarySubId) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        } else {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (!["RUB", "USD", "EUR"].includes(currencyUpper)) {
      return res.status(400).json({ message: "Lava.top принимает только RUB / USD / EUR" });
    }
    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1" });

    // Персональная скидка / промокод
    const lavatopIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    // Lava.top — только подписка на тариф (MONTHLY auto-renew). Топ-ап баланса
    // отклоняем — для пополнения используются другие провайдеры (LAVA, ЮKassa, ЮMoney и т.д.).
    if (lavatopIsTopup) {
      return res.status(400).json({ message: "Lava.top доступен только для покупки тарифа (подписка с авто-списанием). Для пополнения баланса используйте другой способ оплаты." });
    }
    if (!lavatopIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      if (promo.discountFixed && promo.discountFixed > 0) amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    // Определяем offerId. Приоритет:
    //   1) req.body.offerId (явно передан клиентом — для расширенных интеграций)
    //   2) tariff.lavatopOfferId (per-tariff offer, заданный оператором в админке)
    //   3) settings.lavatop_default_offer_id (фолбэк для топ-апа баланса)
    let offerId = customOfferId?.trim() || "";
    if (!offerId && tariffIdToStore) {
      const tariff = await prisma.tariff.findUnique({
        where: { id: tariffIdToStore },
        select: { lavatopOfferId: true },
      });
      if (tariff?.lavatopOfferId?.trim()) offerId = tariff.lavatopOfferId.trim();
    }
    if (!offerId) offerId = (lavatopConfig.defaultOfferId ?? "").trim();
    if (!offerId) {
      return res.status(400).json({ message: "Lava.top: не задан offerId. Укажите его в редактировании тарифа (поле «Lava.top Offer ID») или Default Offer ID в настройках." });
    }

    const lavatopSnap = lavatopIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: lavatopSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "lavatop",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const redirectUrl = appUrl ? `${appUrl}/cabinet?lavatop=success` : undefined;
    const failUrl = appUrl ? `${appUrl}/cabinet?lavatop=fail` : undefined;

    // Для покупки тарифа используем подписку MONTHLY — Lava.top будет авто-списывать
    // ежемесячно, и при каждом списании webhook продлит тариф у клиента (см. lavatop
    // webhook handler: subscription.recurring.payment.success → activateTariffByPaymentId
    // создаёт новый payment + extends subscription).
    // Топ-ап баланса (без tariffId/proxyTariffId/etc) — разовая оплата ONE_TIME.
    const periodicity: "ONE_TIME" | "MONTHLY" = lavatopIsTopup ? "ONE_TIME" : "MONTHLY";

    const result = await createLavatopInvoice({
      config: lavatopConfig,
      email: buyerEmail,
      offerId,
      currency: currencyUpper as "RUB" | "USD" | "EUR",
      contractId: orderId,
      periodicity,
      redirectUrl,
      failUrl,
      buyerLanguage: "RU",
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    await prisma.payment.update({ where: { id: payment.id }, data: { externalId: result.contractId } });
    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.paymentUrl, config.publicAppUrl);
    return res.status(201).json({ paymentId: payment.id, payUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[lavatop/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа Lava.top" });
  }
});

// ═════════════════════════════════════════════════════════════════
// Overpay — платёжная форма (карты / СБП) через композит preflight.
// API: POST {apiUrl}/api/orders/preflight  (HTTP Basic Auth)
// Ответ: { id, resultUrl } — URL хостовой формы, куда редиректим клиента.
// Валюта — как указано в projectId (обычно RUB).
// ═════════════════════════════════════════════════════════════════
const overpayCreatePaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // для единообразия с другими провайдерами — поддержка extendsSecondarySubId.
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  extraOption: z.object({
    kind: z.enum(["traffic", "devices", "servers"]),
    productId: z.string().min(1),
    targetSubscriptionId: z.string().min(1).optional(),
  }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
clientRouter.post("/overpay/create-payment", async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = overpayCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const overpayConfig = {
      apiUrl: (config as { overpayApiUrl?: string | null }).overpayApiUrl ?? "",
      projectId: (config as { overpayProjectId?: string | null }).overpayProjectId ?? "",
      login: (config as { overpayLogin?: string | null }).overpayLogin ?? "",
      password: (config as { overpayPassword?: string | null }).overpayPassword ?? "",
    };
    if (!isOverpayConfigured(overpayConfig)) return res.status(503).json({ message: "Overpay не настроен" });

    const {
      amount: amountBody,
      currency: currencyBody,
      tariffId: tariffIdBody,
      proxyTariffId: proxyTariffIdBody,
      singboxTariffId: singboxTariffIdBody,
      promoCode: promoCodeStr,
      extraOption,
      customBuild: customBuildBody,
    } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      const { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "RUB").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        if (parsed.data.extendsSecondarySubId) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        } else {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1" });

    const overpayIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!overpayIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const opSnap = overpayIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const opCharge = opSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: opSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "overpay",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        metadata: Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null,
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const returnUrl = appUrl ? `${appUrl}/cabinet?overpay=return` : undefined;

    const clientRow = await prisma.client.findUnique({
      where: { id: clientId },
      select: { email: true, telegramUsername: true },
    });

    const result = await createOverpayPayformOrder({
      config: overpayConfig,
      amount: opCharge,
      currency: currencyUpper,
      orderId,
      description: `${serviceName} — ${payment.id}`.slice(0, 200),
      returnUrl,
      livetimeMinutes: 300,
      client: clientRow
        ? {
            email: clientRow.email ?? null,
            name: clientRow.telegramUsername ?? null,
          }
        : undefined,
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    await prisma.payment.update({ where: { id: payment.id }, data: { externalId: result.id } });

    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.url, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[overpay/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
});

const aiChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string()
  })).max(50),
});

clientRouter.post("/ai/chat", async (req, res) => {
  try {
    const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;

    const parsed = aiChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Неверный формат сообщений", errors: parsed.error.flatten() });
    }

    const config = await getSystemConfig();
    const publicConfig = await getPublicConfig();
    if ((publicConfig as { aiChatEnabled?: boolean }).aiChatEnabled === false) {
      return res.status(403).json({ message: "AI-чат отключён" });
    }

    const apiKey = (config as { groqApiKey?: string | null }).groqApiKey?.trim();
    if (!apiKey) {
      // Заглушка, если API ключ не настроен
      return res.json({
        reply: "Извините, AI-ассистент пока не настроен. Пожалуйста, обратитесь в поддержку или настройте Groq API Key в админ-панели."
      });
    }

    const primaryModel = (config as { groqModel?: string | null }).groqModel?.trim() || "llama3-8b-8192";
    const fallback1 = (config as { groqFallback1?: string | null }).groqFallback1?.trim();
    const fallback2 = (config as { groqFallback2?: string | null }).groqFallback2?.trim();
    const fallback3 = (config as { groqFallback3?: string | null }).groqFallback3?.trim();
    
    const modelsToTry = [primaryModel];
    if (fallback1) modelsToTry.push(fallback1);
    if (fallback2) modelsToTry.push(fallback2);
    if (fallback3) modelsToTry.push(fallback3);

    const systemPromptText = (config as { aiSystemPrompt?: string | null }).aiSystemPrompt?.trim() || "Ты — лучший менеджер техподдержки VPN-сервиса. Твоя цель — вежливо, быстро и точно помогать пользователям с настройкой VPN, тарифами и решением технических проблем. Отвечай кратко и по делу.";

    const vpnTariffs = await prisma.tariff.findMany({ orderBy: { price: 'asc' } });
    const proxyTariffs = await prisma.proxyTariff.findMany({ where: { enabled: true }, orderBy: { price: 'asc' } });
    const singboxTariffs = await prisma.singboxTariff.findMany({ where: { enabled: true }, orderBy: { price: 'asc' } });

    let tariffsContext = "\n\nАКТУАЛЬНАЯ ИНФОРМАЦИЯ О ТАРИФАХ ДЛЯ ПОЛЬЗОВАТЕЛЯ:\nОбязательно используй только эти тарифы, если пользователь спрашивает про цены.\n";
    if (vpnTariffs.length > 0) tariffsContext += "VPN Тарифы: " + vpnTariffs.map(t => `${t.name} (${t.price} ${t.currency.toUpperCase()} на ${t.durationDays} дней)`).join(", ") + ".\n";
    if (proxyTariffs.length > 0) tariffsContext += "Прокси: " + proxyTariffs.map(t => `${t.name} (${t.price} ${t.currency.toUpperCase()} на ${t.durationDays} дней)`).join(", ") + ".\n";
    if (singboxTariffs.length > 0) tariffsContext += "Sing-box: " + singboxTariffs.map(t => `${t.name} (${t.price} ${t.currency.toUpperCase()} на ${t.durationDays} дней)`).join(", ") + ".\n";

    const paymentMethods = [];
    if (publicConfig.yookassaEnabled) paymentMethods.push("YooKassa (Банковские карты, СБП и др.)");
    if (publicConfig.yoomoneyEnabled) paymentMethods.push("YooMoney (Кошелек, Карты)");
    if (publicConfig.cryptopayEnabled) paymentMethods.push("Crypto Pay (Криптовалюта в Telegram)");
    if (publicConfig.heleketEnabled) paymentMethods.push("Heleket (Криптовалюта)");
    if (publicConfig.plategaMethods && publicConfig.plategaMethods.length > 0) {
      paymentMethods.push("Platega (" + publicConfig.plategaMethods.map(m => m.label).join(", ") + ")");
    }

    let paymentContext = "\n\nДОСТУПНЫЕ СПОСОБЫ ОПЛАТЫ НА САЙТЕ:\n";
    if (paymentMethods.length > 0) {
      paymentContext += "Пользователь может оплатить следующими способами:\n- " + paymentMethods.join("\n- ") + "\nЕсли спрашивают как оплатить, перечисли ТОЛЬКО эти способы. Не выдумывай Сбербанк Онлайн, QIWI, WebMoney, PayPal и т.д., если их нет в списке.\n";
    } else {
      paymentContext += "В данный момент на сайте не настроено автоматических способов оплаты.\n";
    }

    const instructionsContext = `\n\nИНСТРУКЦИЯ ПО ПОДКЛЮЧЕНИЮ:
Если пользователь спрашивает, как подключиться или настроить VPN, отвечай СТРОГО по следующему алгоритму (не придумывай свои методы):
1. В личном кабинете на сайте нажать кнопку "Подключить VPN".
2. Выбрать свою платформу и скачать предложенное приложение.
3. Вернуться на сайт и нажать кнопку "Добавить подписку" (оная автоматически добавит конфигурацию в приложение) либо отсканировать QR-код.

ПРАВИЛА ОТВЕТА О ЛИМИТАХ И ТАРИФАХ:
Если пользователь спрашивает "какой у меня тариф", "сколько осталось дней", "какой лимит трафика", "сколько устройств", "какой у меня баланс" и т.д., ВСЕГДА используй данные из блока "ИНФОРМАЦИЯ О ТЕКУЩЕМ ПОЛЬЗОВАТЕЛЕ" ниже. НИКОГДА не говори, что ты не можешь найти информацию. Просто прочитай её из блока и ответь пользователю.\n`;

    let userInfoContext = "\n\nИНФОРМАЦИЯ О ТЕКУЩЕМ ПОЛЬЗОВАТЕЛЕ:\nИспользуй эти данные, если пользователь спрашивает про свои текущие подписки или лимиты. Если написано, что чего-то нет, прямо скажи пользователю, что у него этого нет.\n";
    try {
      const dbClient = await prisma.client.findUnique({
        where: { id: client.id },
        include: {
          proxySlots: { where: { status: 'ACTIVE' }, include: { proxyTariff: true } },
          singboxSlots: { where: { status: 'ACTIVE' }, include: { singboxTariff: true } }
        }
      });
      
      userInfoContext += `- Баланс: ${dbClient?.balance || 0} ${(dbClient?.preferredCurrency || 'usd').toUpperCase()}\n`;

      let vpnInfo = "У пользователя НЕТ активной подписки VPN";
      if (client.remnawaveUuid) {
        const u = await remnaGetUser(client.remnawaveUuid);
        if (u && !u.error && u.data) {
          const exp = extractCurrentExpireAt(u.data);
          if (exp && exp > new Date()) {
             const resp = ((u.data as any).response ?? (u.data as any).data ?? u.data) as any;
             const tLimitRaw = resp?.trafficLimitBytes ?? resp?.trafficLimit;
             const tLimit = (tLimitRaw != null && tLimitRaw > 0) ? (Number(tLimitRaw) / 1024**3).toFixed(2) + " GB" : "Безлимит";
             const tUsedRaw = resp?.trafficUsedBytes ?? resp?.trafficUsed;
             const tUsed = tUsedRaw != null ? (Number(tUsedRaw) / 1024**3).toFixed(2) + " GB" : "0 GB";
             const dLimitRaw = resp?.hwidDeviceLimit ?? resp?.deviceLimit;
             const dLimit = (dLimitRaw != null && dLimitRaw > 0) ? dLimitRaw : "Безлимит";
             vpnInfo = `Активна до ${exp.toISOString().split('T')[0]}, Трафик: ${tUsed} / ${tLimit}, Лимит устройств: ${dLimit}`;
          }
        }
      }
      userInfoContext += `- VPN: ${vpnInfo}\n`;
      
      if (dbClient?.proxySlots?.length) {
        userInfoContext += `- Прокси: ${dbClient.proxySlots.map((s: any) => `${s.proxyTariff?.name || 'Слот'} (до ${s.expiresAt.toISOString().split('T')[0]})`).join(', ')}\n`;
      } else {
        userInfoContext += `- Прокси: У пользователя НЕТ прокси\n`;
      }
      
      if (dbClient?.singboxSlots?.length) {
        userInfoContext += `- Sing-box: ${dbClient.singboxSlots.map((s: any) => `${s.singboxTariff?.name || 'Слот'} (до ${s.expiresAt.toISOString().split('T')[0]})`).join(', ')}\n`;
      } else {
        userInfoContext += `- Sing-box: У пользователя НЕТ подписок Sing-box\n`;
      }
    } catch (e) {
      console.error("[ai/chat] Error fetching user info:", e);
    }

    const systemPrompt = systemPromptText + tariffsContext + paymentContext + instructionsContext + userInfoContext;

    const messages = [
      { role: "system", content: systemPrompt },
      ...parsed.data.messages
    ];

    let lastErrorDetails = "";
    let lastStatus = 500;

    const { proxyFetch } = await import("../proxy-util/proxy-fetch.js");
    const { getProxyUrl } = await import("../proxy-util/get-proxy-url.js");
    const aiProxy = await getProxyUrl("ai");

    for (const model of modelsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const groqRes = await proxyFetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.5,
            max_tokens: 1024,
          }),
          signal: controller.signal,
        }, aiProxy);
        
        clearTimeout(timeoutId);

        if (groqRes.ok) {
          const data = await groqRes.json() as any;
          const reply = data.choices?.[0]?.message?.content || "Не удалось получить ответ.";
          return res.json({ reply });
        }

        // Если ошибка (например, 429 Rate Limit), пробуем следующую модель
        const errText = await groqRes.text().catch(() => "");
        console.error(`[ai/chat] Groq error (model: ${model}):`, groqRes.status, errText);
        lastStatus = groqRes.status;
        lastErrorDetails = errText;
        
        // Если это не 429 Rate Limit или 5xx, возможно стоит прервать, но лучше попробовать следующую
      } catch (err) {
        console.error(`[ai/chat] Network/Abort error with model ${model}:`, err);
        lastErrorDetails = err instanceof Error ? err.message : String(err);
      }
    }

    // Если все модели не сработали
    return res.status(502).json({ message: "Ошибка сервиса AI или превышены лимиты", details: lastErrorDetails });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai/chat]", message, err);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

clientRouter.get("/payments", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const payments = await prisma.payment.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, orderId: true, amount: true, currency: true, status: true, createdAt: true, paidAt: true },
  });
  return res.json({
    items: payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
  });
});

// ——— Тикеты (доступны только при включённой тикет-системе в настройках)
async function ensureTicketsEnabled(res: import("express").Response): Promise<boolean> {
  const config = await getPublicConfig();
  if (!config?.ticketsEnabled) {
    res.status(404).json({ message: "Тикет-система отключена" });
    return false;
  }
  return true;
}

// Создание тикета. Принимаем как JSON, так и multipart/form-data (когда прикрепляют фото).
// Текст первого сообщения может быть пустым, если приложены картинки.
const createTicketSchema = z.object({
  subject: z.string().min(1).max(500),
  message: z.string().max(10000).optional().default(""),
});
clientRouter.post("/tickets", uploadTicketAttachment.array("files", 5), async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const subject = pickField(req, "subject");
  const message = pickField(req, "message");
  const body = createTicketSchema.safeParse({ subject, message });
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const attachments = filesToAttachments(req.files as Express.Multer.File[] | undefined);
  const trimmedMessage = body.data.message.trim();
  if (!trimmedMessage && attachments.length === 0) {
    return res.status(400).json({ message: "Пустое сообщение" });
  }
  const ticket = await prisma.ticket.create({
    data: {
      clientId,
      subject: body.data.subject.trim(),
      status: "open",
      messages: {
        create: {
          authorType: "client",
          content: trimmedMessage,
          attachments: serializeAttachments(attachments),
        },
      },
    },
    include: { messages: true },
  });
  notifyAdminsAboutNewTicket({
    ticketId: ticket.id,
    clientId,
    subject: ticket.subject,
    firstMessage: trimmedMessage,
    attachmentsCount: attachments.length,
  }).catch(() => {});
  return res.status(201).json({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      content: m.content,
      attachments: parseAttachments(m.attachments),
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

clientRouter.get("/tickets/unread-count", async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const count = await prisma.ticketMessage.count({
    where: {
      ticket: { clientId },
      authorType: "support",
      isRead: false,
    },
  });
  return res.json({ count });
});

clientRouter.get("/tickets", async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const list = await prisma.ticket.findMany({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, subject: true, status: true, createdAt: true, updatedAt: true },
  });
  return res.json({
    items: list.map((t) => ({ id: t.id, subject: t.subject, status: t.status, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() })),
  });
});

clientRouter.get("/tickets/:id", async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const ticket = await prisma.ticket.findFirst({
    where: { id: req.params.id, clientId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) return res.status(404).json({ message: "Тикет не найден" });

  // Mark support messages as read
  await prisma.ticketMessage.updateMany({
    where: { ticketId: ticket.id, authorType: "support", isRead: false },
    data: { isRead: true },
  });

  return res.json({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      content: m.content,
      attachments: parseAttachments(m.attachments),
      createdAt: m.createdAt.toISOString(),
      isRead: m.isRead,
    })),
  });
});

// Ответ в тикет. multipart/form-data — если приложены фото.
const replyTicketSchema = z.object({ content: z.string().max(10000).optional().default("") });
clientRouter.post("/tickets/:id/messages", uploadTicketAttachment.array("files", 5), async (req, res) => {
  if (!(await ensureTicketsEnabled(res))) return;
  const clientId = (req as unknown as { client: { id: string } }).client.id;
  const content = pickField(req, "content");
  const body = replyTicketSchema.safeParse({ content });
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id, clientId } });
  if (!ticket) return res.status(404).json({ message: "Тикет не найден" });
  const attachments = filesToAttachments(req.files as Express.Multer.File[] | undefined);
  const trimmed = body.data.content.trim();
  if (!trimmed && attachments.length === 0) {
    return res.status(400).json({ message: "Пустое сообщение" });
  }
  const msg = await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      authorType: "client",
      content: trimmed,
      attachments: serializeAttachments(attachments),
    },
  });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
  notifyAdminsAboutClientTicketMessage({
    ticketId: ticket.id,
    clientId,
    content: trimmed,
    attachmentsCount: attachments.length,
  }).catch(() => {});
  return res.status(201).json({
    id: msg.id,
    authorType: msg.authorType,
    content: msg.content,
    attachments: parseAttachments(msg.attachments),
    createdAt: msg.createdAt.toISOString(),
  });
});

// Публичный конфиг для бота, mini app, сайта (без паролей и секретов)
export const publicConfigRouter = Router();
publicConfigRouter.use(optionalBot);
publicConfigRouter.get("/config", async (req, res) => {
  const bot = (req as Request & Partial<ReqWithBot>).bot;
  const config = await getPublicConfig(bot ?? null);
  return res.json(config);
});

/**
 * Динамический PWA-манифест.
 *
 * Статический /manifest.webmanifest содержит дефолтные иконки и имя
 * «STEALTHNET». Этот эндпоинт строит манифест на лету с пользовательским
 * serviceName и favicon. Frontend в App.tsx переключает <link rel="manifest">
 * на /api/public/manifest.webmanifest когда custom favicon задан.
 *
 * Кэш 60 сек — баланс между актуальностью после save и нагрузкой
 * (Chrome дёргает URL каждый раз при show install banner).
 */
publicConfigRouter.get("/manifest.webmanifest", async (_req, res) => {
  try {
    const cfg = (await getSystemConfig().catch(() => null)) as { serviceName?: string | null; favicon?: string | null } | null;
    const brand = (cfg?.serviceName ?? "").trim() || "STEALTHNET";
    const favicon = (cfg?.favicon ?? "").trim() || null;

    const icons = favicon
      ? [
          { src: favicon, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: favicon, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: favicon, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]
      : [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ];
    const shortcutIcon = favicon ?? "/icon-192.png";

    const manifest = {
      name: brand,
      short_name: brand.length <= 12 ? brand : brand.slice(0, 12),
      description: `${brand} — личный кабинет и админка VPN`,
      lang: "ru",
      start_url: "/cabinet",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#0f172a",
      theme_color: "#0f172a",
      categories: ["productivity", "utilities"],
      icons,
      shortcuts: [
        { name: "Кабинет", short_name: "Кабинет", description: "Личный кабинет: тарифы, подписки, подключения", url: "/cabinet", icons: [{ src: shortcutIcon, sizes: "192x192" }] },
        { name: "Админка", short_name: "Админ", description: "Управление клиентами и тарифами", url: "/admin", icons: [{ src: shortcutIcon, sizes: "192x192" }] },
      ],
    };

    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json(manifest);
  } catch (e) {
    console.error("[manifest] render failed:", e);
    return res.status(500).type("text/plain").send("Failed to render manifest");
  }
});

/**
 * Промежуточная страница для диплинков: открывается через Telegram.WebApp.openLink() в системном браузере,
 * который уже может обработать кастомную URL-схему (happ://, stash://, v2rayng:// и т.д.).
 * В Telegram Mini App WebView кастомные схемы заблокированы — это единственный рабочий обходной путь.
 */
publicConfigRouter.get("/deeplink", (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) return res.status(400).send("Missing url parameter");
  const skipAuto = req.query.skip_auto === "1" || req.query.skip_auto === "true";
  const safeUrl = url.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeUrlJs = url.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  const autoRedirectScript = skipAuto
    ? "/* skip_auto: только кнопка, без авто-редиректа (из мини-аппа) */"
    : `setTimeout(function(){ try { window.location.href = "${safeUrlJs}"; } catch (e) {} }, 300);`;
  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Открытие приложения…</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0d1117;color:#e6edf3;padding:16px;box-sizing:border-box}
  .btn{display:inline-block;margin-top:24px;padding:14px 32px;background:#2ea043;color:#fff;border:none;border-radius:12px;font-size:17px;text-decoration:none;cursor:pointer}
  .btn:active{opacity:.85}
  .sub{margin-top:16px;font-size:13px;color:#8b949e;max-width:90%;text-align:center;word-break:break-all}
  .hint{margin-top:12px;font-size:12px;color:#8b949e;max-width:90%;text-align:center}
</style>
</head><body>
<p>Открываем приложение…</p>
<a class="btn" href="${safeUrl}" id="open">Открыть приложение</a>
<p class="sub">Если приложение не открылось — нажмите кнопку выше.<br>Ссылка подписки скопирована в буфер обмена.</p>
<p class="hint" id="androidHint" style="display:none">На Android или в Telegram на ПК: если страница открылась внутри Telegram, зайдите в Настройки → Чаты → «Открывать ссылки во внешнем браузере» и нажмите кнопку ещё раз.</p>
<script>
  (function(){
    var ua = navigator.userAgent || "";
    if (/Android|Windows|tdesktop/i.test(ua)) document.getElementById("androidHint").style.display = "block";
    ${autoRedirectScript}
  })();
</script>
</body></html>`;
  res.type("html").send(html);
});

/** Привязка Telegram к аккаунту по коду (вызывается ботом после /link КОД) */
const linkTelegramFromBotSchema = z.object({
  code: z.string().min(1),
  telegramId: z.number(),
  telegramUsername: z.string().optional(),
});
publicConfigRouter.post("/link-telegram-from-bot", async (req, res) => {
  // v5.0.0: токен один (основной BOT_TOKEN).
  const headerToken = typeof req.headers["x-telegram-bot-token"] === "string" ? req.headers["x-telegram-bot-token"].trim() : "";
  const expectedToken = (process.env.BOT_TOKEN ?? "").trim();
  if (!headerToken || !expectedToken || headerToken !== expectedToken) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const body = linkTelegramFromBotSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const { code, telegramId, telegramUsername } = body.data;
  const tid = String(telegramId);
  const pending = await prisma.pendingTelegramLink.findUnique({ where: { code: code.trim() } });
  if (!pending) return res.status(400).json({ message: "Неверный или просроченный код" });
  if (new Date() > pending.expiresAt) {
    await prisma.pendingTelegramLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
    return res.status(400).json({ message: "Код истёк. Запросите новый в кабинете." });
  }
  const other = (await prisma.client.findFirst({
    where: asClientWhere({ telegramId: tid}),
    select: asClientSelect({
      id: true,
      email: true,
      passwordHash: true,
      googleId: true,
      appleId: true,
      remnawaveUuid: true,
      balance: true,
      _count: { select: { payments: true, ownedSubscriptions: true } },
    }),
  })) as ClientEmptyCloneRow | null;
  if (other && other.id !== pending.clientId) {
    // Кейс PabloRuss77: юзер нажал /start в боте до ввода кода → авто-создался пустой клиент с
    // этим telegramId. Если клон пустой — безопасно сливаем (переносим telegramId и
    // remnawaveUuid, удаляем пустого клона).
    const isEmptyBotClone =
      !other.email &&
      !other.passwordHash &&
      !other.googleId &&
      !other.appleId &&
      other.balance === 0 &&
      other._count.payments === 0 &&
      other._count.ownedSubscriptions === 0;
    if (!isEmptyBotClone) {
      await prisma.pendingTelegramLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
      return res.status(409).json({ message: "Этот Telegram-аккаунт уже привязан к другому аккаунту. Отвяжите его сначала или обратитесь в поддержку." });
    }
    const target = await prisma.client.findUnique({ where: { id: pending.clientId }, select: { remnawaveUuid: true } });
    const newRemnaUuid = target?.remnawaveUuid ?? other.remnawaveUuid ?? null;
    await prisma.$transaction(async (tx) => {
      await tx.client.delete({ where: { id: other.id } });
      await tx.client.update({
        where: { id: pending.clientId },
        data: {
          telegramId: tid,
          telegramUsername: (telegramUsername ?? "").trim() || null,
          ...(newRemnaUuid ? { remnawaveUuid: newRemnaUuid } : {}),
        },
      });
    }).catch(async (e) => {
      console.error("[link-telegram-from-bot] merge failed:", e);
      await prisma.client.update({
        where: { id: pending.clientId },
        data: { telegramId: tid, telegramUsername: (telegramUsername ?? "").trim() || null },
      }).catch(() => {});
    });
  } else {
    await prisma.client.update({
      where: { id: pending.clientId },
      data: { telegramId: tid, telegramUsername: (telegramUsername ?? "").trim() || null },
    });
  }
  await prisma.pendingTelegramLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
  return res.json({ message: "Telegram привязан" });
});

/** Конфиг страницы подписки (приложения по платформам, тексты) — для кабинета /cabinet/subscribe */
publicConfigRouter.get("/subscription-page", async (_req, res) => {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: "subscription_page_config" },
    });
    if (!row?.value) return res.json(null);
    const parsed = JSON.parse(row.value) as unknown;
    return res.json(parsed);
  } catch {
    return res.json(null);
  }
});

function tariffToJson(
  t: {
    id: string;
    name: string;
    description: string | null;
    durationDays: number;
    internalSquadUuids: string[];
    trafficLimitBytes: bigint | null;
    trafficResetMode?: string;
    deviceLimit: number | null;
    includedDevices?: number;
    pricePerExtraDevice?: number;
    maxExtraDevices?: number;
    deviceDiscountTiers?: unknown;
    price: number;
    currency: string;
    locations?: string | null; // T11+T12 (11.05.2026): rich-text список локаций
    priceOptions?: { id: string; durationDays: number; price: number; sortOrder: number }[];
  },
  markupPercent = 0,
) {
  const m = (n: number) => applyMarkup(n, markupPercent);
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? null,
    durationDays: t.durationDays,
    trafficLimitBytes: t.trafficLimitBytes != null ? Number(t.trafficLimitBytes) : null,
    trafficResetMode: t.trafficResetMode ?? "no_reset",
    deviceLimit: t.deviceLimit,
    includedDevices: t.includedDevices ?? 1,
    pricePerExtraDevice: m(t.pricePerExtraDevice ?? 0),
    maxExtraDevices: t.maxExtraDevices ?? 0,
    deviceDiscountTiers: Array.isArray(t.deviceDiscountTiers)
      ? (t.deviceDiscountTiers as { minExtraDevices: number; discountPercent: number }[])
      : [],
    price: m(t.price),
    currency: t.currency,
    // локации тарифа отдаются клиенту/боту.
    locations: t.locations ?? null,
    priceOptions: (t.priceOptions ?? []).map((o) => ({
      id: o.id,
      durationDays: o.durationDays,
      price: m(o.price),
      sortOrder: o.sortOrder,
    })),
  };
}

publicConfigRouter.get("/tariffs", async (req, res) => {
  try {
    const markupPct = (req as Request & Partial<ReqWithBot>).bot?.markupPercent ?? 0;
    const config = await getSystemConfig();
    const categoryEmojis = config.categoryEmojis ?? { ordinary: "📦", premium: "⭐" };
    const list = await prisma.tariffCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        tariffs: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] },
          },
        },
      },
    });
    return res.json({
      items: list.map((c) => {
        const emoji = (c.emojiKey && categoryEmojis[c.emojiKey]) ? categoryEmojis[c.emojiKey] : "";
        return {
          id: c.id,
          name: c.name,
          emojiKey: c.emojiKey ?? null,
          emoji,
          tariffs: c.tariffs.map((t) => tariffToJson(t, markupPct)),
        };
      }),
    });
  } catch (e) {
    console.error("GET /public/tariffs error:", e);
    return res.status(500).json({ message: "Ошибка загрузки тарифов" });
  }
});

// GET /api/public/proxy-tariffs — публичный список тарифов прокси (для бота и кабинета)
publicConfigRouter.get("/proxy-tariffs", async (req, res) => {
  try {
    const markupPct = (req as Request & Partial<ReqWithBot>).bot?.markupPercent ?? 0;
    const list = await prisma.proxyCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { tariffs: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    return res.json({
      items: list.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        tariffs: c.tariffs.map((t) => ({
          id: t.id,
          name: t.name,
          proxyCount: t.proxyCount,
          durationDays: t.durationDays,
          trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
          connectionLimit: t.connectionLimit,
          price: applyMarkup(t.price, markupPct),
          currency: t.currency,
        })),
      })),
    });
  } catch (e) {
    console.error("GET /public/proxy-tariffs error:", e);
    return res.status(500).json({ message: "Ошибка загрузки тарифов прокси" });
  }
});

// GET /api/public/singbox-tariffs — публичный список тарифов Sing-box (для бота и кабинета)
publicConfigRouter.get("/singbox-tariffs", async (req, res) => {
  try {
    const markupPct = (req as Request & Partial<ReqWithBot>).bot?.markupPercent ?? 0;
    const list = await prisma.singboxCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { tariffs: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    return res.json({
      items: list.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        tariffs: c.tariffs.map((t) => ({
          id: t.id,
          name: t.name,
          slotCount: t.slotCount,
          durationDays: t.durationDays,
          trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
          price: applyMarkup(t.price, markupPct),
          currency: t.currency,
        })),
      })),
    });
  } catch (e) {
    console.error("GET /public/singbox-tariffs error:", e);
    return res.status(500).json({ message: "Ошибка загрузки тарифов Sing-box" });
  }
});



