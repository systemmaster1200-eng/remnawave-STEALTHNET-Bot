/**
 * API для агента прокси-ноды: регистрация, heartbeat, получение списка слотов
 * Авторизация: заголовок X-Proxy-Node-Token с токеном ноды
 */

import express, { Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";

const TOKEN_HEADER = "x-proxy-node-token";
const HEARTBEAT_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 минут

export const proxyAgentRouter = Router();

/** Middleware: загружает ноду по токену из заголовка и кладёт в req.proxyNode */
async function requireNodeToken(req: Request, res: Response, next: express.NextFunction) {
  const token = req.headers[TOKEN_HEADER] ?? req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  if (typeof token !== "string" || !token.trim()) {
    return res.status(401).json({ error: "Missing X-Proxy-Node-Token" });
  }
  const node = await prisma.proxyNode.findUnique({
    where: { token: token.trim() },
  });
  if (!node) {
    return res.status(401).json({ error: "Invalid token" });
  }
  (req as Request & { proxyNode: typeof node }).proxyNode = node;
  next();
}

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// POST /api/proxy-nodes/register — регистрация ноды по токену (созданному в админке)
// Тело: { token, name?, socksPort?, httpPort? }. Токен можно передать и в заголовке.
const registerSchema = z.object({
  token: z.string().min(1).optional(),
  name: z.string().max(200).optional(),
  socksPort: z.number().int().min(1).max(65535).optional(),
  httpPort: z.number().int().min(1).max(65535).optional(),
});

proxyAgentRouter.post("/register", asyncRoute(async (req, res) => {
  const raw = registerSchema.safeParse(req.body);
  const tokenFromHeader = typeof req.headers[TOKEN_HEADER] === "string" ? req.headers[TOKEN_HEADER]!.trim() : null;
  const token = (raw.success && raw.data.token) ? raw.data.token.trim() : tokenFromHeader;
  if (!token) {
    return res.status(400).json({ error: "Missing token (body.token or X-Proxy-Node-Token)" });
  }
  const node = await prisma.proxyNode.findUnique({
    where: { token },
  });
  if (!node) {
    return res.status(404).json({ error: "Token not found. Create the node in the admin panel first." });
  }
  const publicHost = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || (req.headers["x-real-ip"] as string)
    || req.socket?.remoteAddress
    || null;
  const name = (raw.success && raw.data.name != null) ? raw.data.name : node.name;

  await prisma.proxyNode.update({
    where: { id: node.id },
    data: {
      name: name || node.name,
      status: "ONLINE",
      lastSeenAt: new Date(),
      publicHost: publicHost || node.publicHost,
    },
  });

  return res.json({
    nodeId: node.id,
    pollIntervalSec: 60,
    message: "Registered. Use GET /slots and POST /heartbeat with X-Proxy-Node-Token.",
  });
}));

// POST /api/proxy-nodes/:id/heartbeat — метрики от ноды (требует токен)
const heartbeatSchema = z.object({
  connections: z.number().int().min(0).optional(),
  trafficIn: z.number().int().min(0).optional(),
  trafficOut: z.number().int().min(0).optional(),
  slots: z.array(z.object({
    slotId: z.string(),
    trafficUsed: z.number().int().min(0).optional(),
    connections: z.number().int().min(0).optional(),
  })).optional(),
});

proxyAgentRouter.post("/:id/heartbeat", requireNodeToken, asyncRoute(async (req, res) => {
  const reqWithNode = req as Request & { proxyNode: { id: string } };
  const nodeId = req.params.id;
  if (reqWithNode.proxyNode.id !== nodeId) {
    return res.status(403).json({ error: "Token does not match node id" });
  }
  const body = heartbeatSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid body", errors: body.error.flatten() });
  }

  const updateData: {
    lastSeenAt: Date;
    currentConnections?: number;
    trafficInBytes?: bigint;
    trafficOutBytes?: bigint;
  } = { lastSeenAt: new Date() };
  if (body.data.connections !== undefined) updateData.currentConnections = body.data.connections;
  if (body.data.trafficIn !== undefined) updateData.trafficInBytes = BigInt(body.data.trafficIn);
  if (body.data.trafficOut !== undefined) updateData.trafficOutBytes = BigInt(body.data.trafficOut);

  await prisma.proxyNode.update({
    where: { id: nodeId },
    data: updateData,
  });

  if (body.data.slots?.length) {
    for (const s of body.data.slots) {
      const slotUpdate: { trafficUsedBytes?: bigint; currentConnections?: number } = {};
      if (s.trafficUsed !== undefined) slotUpdate.trafficUsedBytes = BigInt(s.trafficUsed);
      if (s.connections !== undefined) slotUpdate.currentConnections = s.connections;
      if (Object.keys(slotUpdate).length > 0) {
        await prisma.proxySlot.updateMany({
          where: { id: s.slotId, nodeId },
          data: slotUpdate,
        });
      }
    }
  }

  return res.json({ ok: true });
}));

// GET /api/proxy-nodes/:id/slots — список слотов для ноды (логин, пароль, лимиты) для генерации конфига
proxyAgentRouter.get("/:id/slots", requireNodeToken, asyncRoute(async (req, res) => {
  const reqWithNode = req as Request & { proxyNode: { id: string } };
  const nodeId = req.params.id;
  if (reqWithNode.proxyNode.id !== nodeId) {
    return res.status(403).json({ error: "Token does not match node id" });
  }

  const node = await prisma.proxyNode.findUnique({
    where: { id: nodeId },
    select: { socksPort: true, httpPort: true },
  });

  const now = new Date();
  const slots = await prisma.proxySlot.findMany({
    where: {
      nodeId,
      status: "ACTIVE",
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      login: true,
      password: true,
      expiresAt: true,
      trafficLimitBytes: true,
      connectionLimit: true,
    },
  });

  return res.json({
    socksPort: node?.socksPort ?? 1080,
    httpPort: node?.httpPort ?? 8080,
    slots: slots.map((s) => ({
      id: s.id,
      login: s.login,
      password: s.password,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      connectionLimit: s.connectionLimit,
    })),
  });
}));
