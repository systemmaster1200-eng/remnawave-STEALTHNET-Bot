/**
 * API для агента sing-box ноды: регистрация, heartbeat, получение слотов и кастомного конфига
 * Авторизация: заголовок X-Singbox-Node-Token с токеном ноды
 */

import express, { Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";

const TOKEN_HEADER = "x-singbox-node-token";
const HEARTBEAT_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

export const singboxAgentRouter = Router();

async function requireNodeToken(req: Request, res: Response, next: express.NextFunction) {
  const token = req.headers[TOKEN_HEADER] ?? req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  if (typeof token !== "string" || !token.trim()) {
    return res.status(401).json({ error: "Missing X-Singbox-Node-Token" });
  }
  const node = await prisma.singboxNode.findUnique({
    where: { token: token.trim() },
  });
  if (!node) {
    return res.status(401).json({ error: "Invalid token" });
  }
  (req as Request & { singboxNode: typeof node }).singboxNode = node;
  next();
}

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const registerSchema = z.object({
  token: z.string().min(1).optional(),
  name: z.string().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  protocol: z.string().max(50).optional(),
  tlsEnabled: z.boolean().optional(),
});

// POST /api/singbox-nodes/register
singboxAgentRouter.post("/register", asyncRoute(async (req, res) => {
  const raw = registerSchema.safeParse(req.body);
  const tokenFromHeader = typeof req.headers[TOKEN_HEADER] === "string" ? req.headers[TOKEN_HEADER]!.trim() : null;
  const token = (raw.success && raw.data.token) ? raw.data.token.trim() : tokenFromHeader;
  if (!token) {
    return res.status(400).json({ error: "Missing token (body.token or X-Singbox-Node-Token)" });
  }
  const node = await prisma.singboxNode.findUnique({
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

  await prisma.singboxNode.update({
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
    protocol: node.protocol,
    port: node.port,
    tlsEnabled: node.tlsEnabled,
    message: "Registered. Use GET /slots and POST /heartbeat with X-Singbox-Node-Token.",
  });
}));

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

// POST /api/singbox-nodes/:id/heartbeat
singboxAgentRouter.post("/:id/heartbeat", requireNodeToken, asyncRoute(async (req, res) => {
  const reqWithNode = req as Request & { singboxNode: { id: string } };
  const nodeId = req.params.id;
  if (reqWithNode.singboxNode.id !== nodeId) {
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

  await prisma.singboxNode.update({
    where: { id: nodeId },
    data: updateData,
  });

  if (body.data.slots?.length) {
    for (const s of body.data.slots) {
      const slotUpdate: { trafficUsedBytes?: bigint; currentConnections?: number } = {};
      if (s.trafficUsed !== undefined) slotUpdate.trafficUsedBytes = BigInt(s.trafficUsed);
      if (s.connections !== undefined) slotUpdate.currentConnections = s.connections;
      if (Object.keys(slotUpdate).length > 0) {
        await prisma.singboxSlot.updateMany({
          where: { id: s.slotId, nodeId },
          data: slotUpdate,
        });
      }
    }
  }

  return res.json({ ok: true });
}));

// GET /api/singbox-nodes/:id/slots — слоты + протокол ноды + customConfigJson для агента
singboxAgentRouter.get("/:id/slots", requireNodeToken, asyncRoute(async (req, res) => {
  const reqWithNode = req as Request & { singboxNode: { id: string } };
  const nodeId = req.params.id;
  if (reqWithNode.singboxNode.id !== nodeId) {
    return res.status(403).json({ error: "Token does not match node id" });
  }

  const node = await prisma.singboxNode.findUnique({
    where: { id: nodeId },
    select: { protocol: true, port: true, tlsEnabled: true, publicHost: true, customConfigJson: true },
  });

  const now = new Date();
  const slots = await prisma.singboxSlot.findMany({
    where: {
      nodeId,
      status: "ACTIVE",
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      userIdentifier: true,
      secret: true,
      expiresAt: true,
      trafficLimitBytes: true,
    },
  });

  return res.json({
    protocol: node?.protocol ?? "VLESS",
    port: node?.port ?? 443,
    tlsEnabled: node?.tlsEnabled ?? true,
    publicHost: node?.publicHost ?? null,
    customConfigJson: node?.customConfigJson ?? null,
    slots: slots.map((s) => ({
      id: s.id,
      userIdentifier: s.userIdentifier,
      secret: s.secret,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
    })),
  });
}));
