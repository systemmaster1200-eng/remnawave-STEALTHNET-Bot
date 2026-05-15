/**
 * External API v1 — all client-facing endpoints exposed via API key.
 * Auth: X-Api-Key header (validated by requireApiKey middleware).
 * Client auth: after login, use Authorization: Bearer <clientToken> for protected routes.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireApiKey } from "./api-key.middleware.js";
import {
  hashPassword,
  verifyPassword,
  signClientToken,
  verifyClientToken,
  signClient2FAPendingToken,
  verifyClient2FAPendingToken,
  generateReferralCode,
} from "../client/client.service.js";
import { getPublicConfig } from "../client/client.service.js";
import {
  isRemnaConfigured,
  remnaGetUser,
} from "../remna/remna.client.js";
import { getPrimaryBot } from "../bot/bot.service.js";

export const externalApiRouter = Router();
externalApiRouter.use(requireApiKey);

/* ═══════════════════════════════════════════ */
/*  Helpers                                    */
/* ═══════════════════════════════════════════ */

function clientShape(c: {
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
  totpEnabled?: boolean;
  createdAt?: Date;
  autoRenewEnabled?: boolean;
  autoRenewTariffId?: string | null;
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
    totpEnabled: c.totpEnabled ?? false,
    createdAt: c.createdAt?.toISOString() ?? null,
    autoRenewEnabled: c.autoRenewEnabled ?? false,
    autoRenewTariffId: c.autoRenewTariffId ?? null,
  };
}

const CLIENT_SELECT = {
  id: true,
  email: true,
  telegramId: true,
  telegramUsername: true,
  preferredLang: true,
  preferredCurrency: true,
  balance: true,
  referralCode: true,
  referralPercent: true,
  remnawaveUuid: true,
  trialUsed: true,
  isBlocked: true,
  totpEnabled: true,
  totpSecret: true,
  passwordHash: true,
  createdAt: true,
  autoRenewEnabled: true,
  autoRenewTariffId: true,
} as const;

function requireClientToken(req: Request, res: Response): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Client token required in Authorization header" });
    return null;
  }
  const token = auth.slice(7);
  if (token.startsWith("sk_")) {
    res.status(401).json({ error: "Use client JWT token, not API key" });
    return null;
  }
  const payload = verifyClientToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired client token" });
    return null;
  }
  return payload.clientId;
}

async function getClientOrFail(clientId: string, res: Response) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ...CLIENT_SELECT, passwordHash: false, totpSecret: false },
  });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return null;
  }
  if (client.isBlocked) {
    res.status(403).json({ error: "Account is blocked" });
    return null;
  }
  return client;
}

/* ═══════════════════════════════════════════ */
/*  AUTH                                       */
/* ═══════════════════════════════════════════ */

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

externalApiRouter.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid email or password format" });

  const client = await prisma.client.findFirst({
    where: { email: parsed.data.email.toLowerCase().trim() },
    select: CLIENT_SELECT,
  });
  if (!client || !client.passwordHash) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const valid = await verifyPassword(parsed.data.password, client.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });
  if (client.isBlocked) return res.status(403).json({ error: "Account is blocked" });

  if (client.totpEnabled) {
    return res.json({
      requires2FA: true,
      tempToken: signClient2FAPendingToken(client.id),
    });
  }

  return res.json({
    token: signClientToken(client.id),
    client: clientShape(client),
  });
});

const twoFaSchema = z.object({
  tempToken: z.string().min(1),
  code: z.string().length(6).regex(/^\d+$/),
});

externalApiRouter.post("/auth/2fa", async (req: Request, res: Response) => {
  const parsed = twoFaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "tempToken and 6-digit code required" });

  const payload = verifyClient2FAPendingToken(parsed.data.tempToken);
  if (!payload) return res.status(401).json({ error: "Session expired, login again" });

  const client = await prisma.client.findUnique({
    where: { id: payload.clientId },
    select: { ...CLIENT_SELECT, totpSecret: true },
  });
  if (!client?.totpEnabled || !client.totpSecret) {
    return res.status(401).json({ error: "2FA not enabled" });
  }

  const { verify } = await import("otplib");
  const result = await verify({ secret: client.totpSecret, token: parsed.data.code });
  if (!result.valid) return res.status(401).json({ error: "Invalid 2FA code" });

  return res.json({
    token: signClientToken(client.id),
    client: clientShape(client),
  });
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  referralCode: z.string().optional(),
  preferredLang: z.string().default("ru"),
  preferredCurrency: z.string().default("RUB"),
});

externalApiRouter.post("/auth/register", async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

  const email = parsed.data.email.toLowerCase().trim();
  const existing = await prisma.client.findFirst({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  let referrerId: string | null = null;
  if (parsed.data.referralCode) {
    const ref = await prisma.client.findFirst({ where: { referralCode: parsed.data.referralCode } });
    if (ref) referrerId = ref.id;
  }

  // External API создаёт «безбот'овых» клиентов (через X-Api-Key, без TG-сессии).
  // Привязываем к primary боту.
  const primaryBot = await getPrimaryBot();
  if (!primaryBot) return res.status(503).json({ error: "Primary bot not configured" });

  const client = await prisma.client.create({
    data: {
      botId: primaryBot.id,
      email,
      passwordHash: await hashPassword(parsed.data.password),
      referralCode: generateReferralCode(),
      referrerId,
      preferredLang: parsed.data.preferredLang,
      preferredCurrency: parsed.data.preferredCurrency,
    },
    select: { ...CLIENT_SELECT, passwordHash: false, totpSecret: false },
  });

  return res.status(201).json({
    token: signClientToken(client.id),
    client: clientShape(client),
  });
});

/* ═══════════════════════════════════════════ */
/*  PROFILE                                    */
/* ═══════════════════════════════════════════ */

externalApiRouter.get("/client/profile", async (req: Request, res: Response) => {
  const clientId = requireClientToken(req, res);
  if (!clientId) return;
  const client = await getClientOrFail(clientId, res);
  if (!client) return;
  res.json(clientShape(client));
});

externalApiRouter.patch("/client/profile", async (req: Request, res: Response) => {
  const clientId = requireClientToken(req, res);
  if (!clientId) return;

  const { preferredLang, preferredCurrency } = req.body;
  const data: Record<string, string> = {};
  if (typeof preferredLang === "string") data.preferredLang = preferredLang;
  if (typeof preferredCurrency === "string") data.preferredCurrency = preferredCurrency;

  const updated = await prisma.client.update({
    where: { id: clientId },
    select: { ...CLIENT_SELECT, passwordHash: false, totpSecret: false },
    data,
  });
  res.json(clientShape(updated));
});

/* ═══════════════════════════════════════════ */
/*  BALANCE & PAYMENTS                         */
/* ═══════════════════════════════════════════ */

externalApiRouter.get("/client/balance", async (req: Request, res: Response) => {
  const clientId = requireClientToken(req, res);
  if (!clientId) return;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { balance: true },
  });
  if (!client) return res.status(404).json({ error: "Client not found" });
  res.json({ balance: client.balance });
});

externalApiRouter.get("/client/payments", async (req: Request, res: Response) => {
  const clientId = requireClientToken(req, res);
  if (!clientId) return;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        orderId: true,
        amount: true,
        currency: true,
        status: true,
        provider: true,
        tariffId: true,
        createdAt: true,
        paidAt: true,
      },
    }),
    prisma.payment.count({ where: { clientId } }),
  ]);

  res.json({ payments, total, limit, offset });
});

/* ═══════════════════════════════════════════ */
/*  SUBSCRIPTION                               */
/* ═══════════════════════════════════════════ */

externalApiRouter.get("/client/subscription", async (req: Request, res: Response) => {
  const clientId = requireClientToken(req, res);
  if (!clientId) return;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { remnawaveUuid: true },
  });
  if (!client?.remnawaveUuid) {
    return res.json({ active: false, message: "No subscription" });
  }
  if (!isRemnaConfigured()) {
    return res.status(503).json({ error: "Remna API not configured" });
  }

  const result = await remnaGetUser(client.remnawaveUuid);
  if (result.error || !result.data) {
    return res.status(502).json({ error: "Failed to fetch subscription data" });
  }

  const userData = result.data as { response?: Record<string, unknown> };
  const user = userData.response ?? userData;
  res.json({ active: true, subscription: user });
});

/* ═══════════════════════════════════════════ */
/*  REFERRALS                                  */
/* ═══════════════════════════════════════════ */

externalApiRouter.get("/client/referrals", async (req: Request, res: Response) => {
  const clientId = requireClientToken(req, res);
  if (!clientId) return;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { referralCode: true, referralPercent: true },
  });
  if (!client) return res.status(404).json({ error: "Client not found" });

  const referrals = await prisma.client.count({ where: { referrerId: clientId } });
  const totalEarnings = await prisma.referralCredit.aggregate({
    where: { referrerId: clientId },
    _sum: { amount: true },
  });

  res.json({
    referralCode: client.referralCode,
    referralPercent: client.referralPercent,
    referralsCount: referrals,
    totalEarnings: totalEarnings._sum?.amount ?? 0,
  });
});

/* ═══════════════════════════════════════════ */
/*  TARIFFS (public, no client token needed)   */
/* ═══════════════════════════════════════════ */

function tariffToJson(t: { id: string; name: string; description: string | null; durationDays: number; trafficLimitBytes: bigint | null; trafficResetMode?: string; deviceLimit: number | null; price: number; currency: string }) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    durationDays: t.durationDays,
    trafficLimitBytes: t.trafficLimitBytes ? Number(t.trafficLimitBytes) : null,
    trafficResetMode: t.trafficResetMode ?? null,
    deviceLimit: t.deviceLimit,
    price: t.price,
    currency: t.currency,
  };
}

externalApiRouter.get("/tariffs", async (_req: Request, res: Response) => {
  const categories = await prisma.tariffCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      tariffs: { orderBy: { sortOrder: "asc" } },
    },
  });

  res.json(
    categories.map((c) => ({
      id: c.id,
      name: c.name,
      tariffs: c.tariffs.map(tariffToJson),
    }))
  );
});

externalApiRouter.get("/proxy-tariffs", async (_req: Request, res: Response) => {
  const list = await prisma.proxyCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      tariffs: {
        where: { enabled: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  res.json(list);
});

externalApiRouter.get("/singbox-tariffs", async (_req: Request, res: Response) => {
  const list = await prisma.singboxCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      tariffs: {
        where: { enabled: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  res.json(list);
});

/* ═══════════════════════════════════════════ */
/*  CONFIG (public)                            */
/* ═══════════════════════════════════════════ */

externalApiRouter.get("/config", async (_req: Request, res: Response) => {
  const config = await getPublicConfig();
  res.json(config);
});

/* ═══════════════════════════════════════════ */
/*  DEVICES (HWID)                             */
/* ═══════════════════════════════════════════ */

externalApiRouter.get("/client/devices", async (req: Request, res: Response) => {
  const clientId = requireClientToken(req, res);
  if (!clientId) return;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { remnawaveUuid: true },
  });
  if (!client?.remnawaveUuid || !isRemnaConfigured()) {
    return res.json({ total: 0, devices: [] });
  }

  const { remnaGetUserHwidDevices } = await import("../remna/remna.client.js");
  const result = await remnaGetUserHwidDevices(client.remnawaveUuid);
  if (result.error || !result.data) {
    return res.json({ total: 0, devices: [] });
  }

  const data = result.data as { response?: unknown[] };
  const devices = Array.isArray(data.response) ? data.response : [];
  res.json({ total: devices.length, devices });
});

/* ═══════════════════════════════════════════ */
/*  PROXY & SINGBOX SLOTS                      */
/* ═══════════════════════════════════════════ */

externalApiRouter.get("/client/proxy-slots", async (req: Request, res: Response) => {
  const clientId = requireClientToken(req, res);
  if (!clientId) return;

  const slots = await prisma.proxySlot.findMany({
    where: { clientId, status: "ACTIVE" },
    include: { node: true },
  });

  res.json(
    slots.map((s) => ({
      id: s.id,
      host: s.node.publicHost,
      login: s.login,
      password: s.password,
      expiresAt: s.expiresAt.toISOString(),
      trafficUsedBytes: Number(s.trafficUsedBytes),
      trafficLimitBytes: s.trafficLimitBytes ? Number(s.trafficLimitBytes) : null,
      connectionLimit: s.connectionLimit,
      currentConnections: s.currentConnections,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    }))
  );
});

externalApiRouter.get("/client/singbox-slots", async (req: Request, res: Response) => {
  const clientId = requireClientToken(req, res);
  if (!clientId) return;

  const slots = await prisma.singboxSlot.findMany({
    where: { clientId, status: "ACTIVE" },
    include: { node: true },
  });

  res.json(
    slots.map((s) => ({
      id: s.id,
      userIdentifier: s.userIdentifier,
      expiresAt: s.expiresAt.toISOString(),
      trafficUsedBytes: Number(s.trafficUsedBytes),
      trafficLimitBytes: s.trafficLimitBytes ? Number(s.trafficLimitBytes) : null,
      currentConnections: s.currentConnections,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    }))
  );
});
