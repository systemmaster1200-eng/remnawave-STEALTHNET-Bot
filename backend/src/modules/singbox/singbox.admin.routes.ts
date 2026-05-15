/**
 * Админские эндпоинты для sing-box нод: CRUD, генерация токена, docker-compose, customConfigJson
 */

import { randomBytes } from "crypto";
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { getSystemConfig } from "../client/client.service.js";

const PROTOCOLS = ["VLESS", "SHADOWSOCKS", "TROJAN", "HYSTERIA2"] as const;

export const singboxAdminRouter = Router();
singboxAdminRouter.use(requireAuth);
singboxAdminRouter.use(requireAdminSection);

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function generateNodeToken(): string {
  return randomBytes(32).toString("hex");
}

const HEARTBEAT_OFFLINE_MS = 5 * 60 * 1000;
async function markStaleNodesOffline() {
  const threshold = new Date(Date.now() - HEARTBEAT_OFFLINE_MS);
  await prisma.singboxNode.updateMany({
    where: { status: "ONLINE", lastSeenAt: { lt: threshold } },
    data: { status: "OFFLINE" },
  });
}

const createNodeSchema = z.object({
  name: z.string().max(200).transform((s) => (s || "").trim()),
  protocol: z.enum(PROTOCOLS).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  tlsEnabled: z.boolean().optional(),
});

// GET /api/admin/singbox/nodes
singboxAdminRouter.get("/nodes", asyncRoute(async (_req, res) => {
  await markStaleNodesOffline();
  const nodes = await prisma.singboxNode.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { slots: true } } },
  });
  return res.json({
    items: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      status: n.status,
      lastSeenAt: n.lastSeenAt?.toISOString() ?? null,
      publicHost: n.publicHost,
      port: n.port,
      protocol: n.protocol,
      tlsEnabled: n.tlsEnabled,
      capacity: n.capacity,
      currentConnections: n.currentConnections,
      trafficInBytes: n.trafficInBytes.toString(),
      trafficOutBytes: n.trafficOutBytes.toString(),
      slotsCount: n._count.slots,
      hasCustomConfig: !!n.customConfigJson,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}));

// POST /api/admin/singbox/nodes
singboxAdminRouter.post("/nodes", asyncRoute(async (req, res) => {
  const body = createNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const protocol = body.data.protocol ?? "VLESS";
  const port = body.data.port ?? 443;
  const tlsEnabled = body.data.tlsEnabled ?? true;
  const token = generateNodeToken();
  const node = await prisma.singboxNode.create({
    data: {
      name: body.data.name || "Sing-box node",
      token,
      status: "OFFLINE",
      port,
      protocol,
      tlsEnabled,
    },
  });
  const config = await getSystemConfig();
  const apiUrl = (config.publicAppUrl || "").trim().replace(/\/$/, "") || "{{STEALTHNET_API_URL}}";
  const dockerCompose = `# STEALTHNET — sing-box нода (агент + heartbeat)
# STEALTHNET_API_URL берётся из настроек панели. Если не задан — замените вручную.
# На сервере: docker compose up -d --build

services:
  singbox-node:
    build:
      context: https://github.com/systemmaster1200-eng/remnawave-STEALTHNET-Bot.git
      dockerfile: singbox-node/Dockerfile
    image: stealthnet/singbox-node:latest
    restart: unless-stopped
    environment:
      STEALTHNET_API_URL: ${apiUrl}
      SINGBOX_NODE_TOKEN: ${token}
      PROTOCOL: "${protocol}"
      PORT: "${port}"
      TLS_ENABLED: "${tlsEnabled ? "1" : "0"}"
    ports:
      - "${port}:${port}/tcp"
      - "${port}:${port}/udp"
`;
  return res.status(201).json({
    node: {
      id: node.id,
      name: node.name,
      status: node.status,
      protocol: node.protocol,
      port: node.port,
      token,
      createdAt: node.createdAt.toISOString(),
    },
    dockerCompose,
    instructions: apiUrl === "{{STEALTHNET_API_URL}}"
      ? "Скопируйте блок выше. Укажите URL панели в настройках или замените {{STEALTHNET_API_URL}} вручную. Сохраните как docker-compose.yml и выполните: docker compose up -d --build"
      : "Скопируйте блок выше. URL панели подставлен. Сохраните как docker-compose.yml и выполните: docker compose up -d --build",
  });
}));

// GET /api/admin/singbox/nodes/:id
singboxAdminRouter.get("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.singboxNode.findUnique({
    where: { id },
    include: {
      slots: {
        include: {
          client: { select: { id: true, email: true, telegramUsername: true, telegramId: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!node) return res.status(404).json({ message: "Node not found" });
  return res.json({
    id: node.id,
    name: node.name,
    status: node.status,
    lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
    publicHost: node.publicHost,
    port: node.port,
    protocol: node.protocol,
    tlsEnabled: node.tlsEnabled,
    capacity: node.capacity,
    currentConnections: node.currentConnections,
    trafficInBytes: node.trafficInBytes.toString(),
    trafficOutBytes: node.trafficOutBytes.toString(),
    metadata: node.metadata,
    customConfigJson: node.customConfigJson,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    slots: node.slots.map((s) => ({
      id: s.id,
      userIdentifier: s.userIdentifier,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      currentConnections: s.currentConnections,
      status: s.status,
      client: s.client,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));

const updateNodeSchema = z.object({
  name: z.string().max(200).optional(),
  status: z.enum(["ONLINE", "OFFLINE", "DISABLED"]).optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(PROTOCOLS).optional(),
  tlsEnabled: z.boolean().optional(),
  customConfigJson: z.string().nullable().optional(),
});

// PATCH /api/admin/singbox/nodes/:id
singboxAdminRouter.patch("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const body = updateNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const node = await prisma.singboxNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });
  if (body.data.customConfigJson !== undefined) {
    const raw = body.data.customConfigJson;
    if (raw !== null && raw !== "") {
      try {
        JSON.parse(raw);
      } catch {
        return res.status(400).json({ message: "customConfigJson must be valid JSON" });
      }
    }
  }
  const updated = await prisma.singboxNode.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined && { name: body.data.name }),
      ...(body.data.status !== undefined && { status: body.data.status }),
      ...(body.data.capacity !== undefined && { capacity: body.data.capacity }),
      ...(body.data.port !== undefined && { port: body.data.port }),
      ...(body.data.protocol !== undefined && { protocol: body.data.protocol }),
      ...(body.data.tlsEnabled !== undefined && { tlsEnabled: body.data.tlsEnabled }),
      ...(body.data.customConfigJson !== undefined && { customConfigJson: body.data.customConfigJson }),
    },
  });
  return res.json({
    id: updated.id,
    name: updated.name,
    status: updated.status,
    port: updated.port,
    protocol: updated.protocol,
    customConfigJson: updated.customConfigJson,
    updatedAt: updated.updatedAt.toISOString(),
  });
}));

// DELETE /api/admin/singbox/nodes/:id
singboxAdminRouter.delete("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.singboxNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });
  await prisma.singboxNode.delete({ where: { id } });
  return res.status(204).send();
}));

// ——— Категории (минимальный CRUD для фазы 1) ———
const categoryIdSchema = z.object({ id: z.string().min(1) });
const createCategorySchema = z.object({
  name: z.string().min(1).max(200),
  sortOrder: z.number().int().optional(),
});

singboxAdminRouter.get("/categories", asyncRoute(async (_req, res) => {
  const list = await prisma.singboxCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      tariffs: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
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
        price: t.price,
        currency: t.currency,
        enabled: t.enabled,
      })),
    })),
  });
}));

singboxAdminRouter.post("/categories", asyncRoute(async (req, res) => {
  const body = createCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const created = await prisma.singboxCategory.create({
    data: { name: body.data.name.trim(), sortOrder: body.data.sortOrder ?? 0 },
  });
  return res.status(201).json({ id: created.id, name: created.name, sortOrder: created.sortOrder });
}));

singboxAdminRouter.patch("/categories/:id", asyncRoute(async (req, res) => {
  const id = categoryIdSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  const body = z.object({ name: z.string().min(1).max(200).optional(), sortOrder: z.number().int().optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const updated = await prisma.singboxCategory.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined && { name: body.data.name.trim() }),
      ...(body.data.sortOrder !== undefined && { sortOrder: body.data.sortOrder }),
    },
  });
  return res.json(updated);
}));

singboxAdminRouter.delete("/categories/:id", asyncRoute(async (req, res) => {
  const id = categoryIdSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  await prisma.singboxCategory.delete({ where: { id } });
  return res.status(204).send();
}));

// ——— Тарифы (минимальный CRUD) ———
const createTariffSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(200),
  slotCount: z.number().int().min(1),
  durationDays: z.number().int().min(1),
  trafficLimitBytes: z.union([z.bigint(), z.string(), z.number()]).nullable().optional(),
  price: z.number().min(0),
  currency: z.string().min(1).max(10),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

singboxAdminRouter.get("/tariffs", asyncRoute(async (req, res) => {
  const categoryId = req.query.categoryId as string | undefined;
  const list = await prisma.singboxTariff.findMany({
    where: categoryId ? { categoryId } : {},
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { category: { select: { name: true } } },
  });
  return res.json({
    items: list.map((t) => ({
      id: t.id,
      categoryId: t.categoryId,
      categoryName: t.category.name,
      name: t.name,
      slotCount: t.slotCount,
      durationDays: t.durationDays,
      trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
      price: t.price,
      currency: t.currency,
      sortOrder: t.sortOrder,
      enabled: t.enabled,
    })),
  });
}));

singboxAdminRouter.post("/tariffs", asyncRoute(async (req, res) => {
  const body = createTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const cat = await prisma.singboxCategory.findUnique({ where: { id: body.data.categoryId } });
  if (!cat) return res.status(400).json({ message: "Категория не найдена" });
  const trafficBytes = body.data.trafficLimitBytes != null
    ? BigInt(typeof body.data.trafficLimitBytes === "string" ? body.data.trafficLimitBytes : body.data.trafficLimitBytes)
    : null;
  const created = await prisma.singboxTariff.create({
    data: {
      categoryId: body.data.categoryId,
      name: body.data.name.trim(),
      slotCount: body.data.slotCount,
      durationDays: body.data.durationDays,
      trafficLimitBytes: trafficBytes,
      price: body.data.price,
      currency: body.data.currency.toUpperCase(),
      sortOrder: body.data.sortOrder ?? 0,
      enabled: body.data.enabled ?? true,
    },
  });
  return res.status(201).json({
    id: created.id,
    categoryId: created.categoryId,
    name: created.name,
    slotCount: created.slotCount,
    durationDays: created.durationDays,
    trafficLimitBytes: created.trafficLimitBytes?.toString() ?? null,
    price: created.price,
    currency: created.currency,
    sortOrder: created.sortOrder,
    enabled: created.enabled,
  });
}));

const tariffIdParamSchema = z.object({ id: z.string().min(1) });
const updateTariffSchema = z.object({
  categoryId: z.string().min(1).optional(),
  name: z.string().min(1).max(200).optional(),
  slotCount: z.number().int().min(1).optional(),
  durationDays: z.number().int().min(1).optional(),
  trafficLimitBytes: z.union([z.bigint(), z.string(), z.number()]).nullable().optional(),
  price: z.number().min(0).optional(),
  currency: z.string().min(1).max(10).optional(),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

singboxAdminRouter.patch("/tariffs/:id", asyncRoute(async (req, res) => {
  const id = tariffIdParamSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  const body = updateTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const existing = await prisma.singboxTariff.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Tariff not found" });
  if (body.data.categoryId) {
    const cat = await prisma.singboxCategory.findUnique({ where: { id: body.data.categoryId } });
    if (!cat) return res.status(400).json({ message: "Категория не найдена" });
  }
  const trafficBytes = body.data.trafficLimitBytes !== undefined
    ? (body.data.trafficLimitBytes == null
      ? null
      : BigInt(typeof body.data.trafficLimitBytes === "string" ? body.data.trafficLimitBytes : body.data.trafficLimitBytes))
    : undefined;
  const updated = await prisma.singboxTariff.update({
    where: { id },
    data: {
      ...(body.data.categoryId !== undefined && { categoryId: body.data.categoryId }),
      ...(body.data.name !== undefined && { name: body.data.name.trim() }),
      ...(body.data.slotCount !== undefined && { slotCount: body.data.slotCount }),
      ...(body.data.durationDays !== undefined && { durationDays: body.data.durationDays }),
      ...(trafficBytes !== undefined && { trafficLimitBytes: trafficBytes }),
      ...(body.data.price !== undefined && { price: body.data.price }),
      ...(body.data.currency !== undefined && { currency: body.data.currency.toUpperCase() }),
      ...(body.data.sortOrder !== undefined && { sortOrder: body.data.sortOrder }),
      ...(body.data.enabled !== undefined && { enabled: body.data.enabled }),
    },
  });
  return res.json({
    id: updated.id,
    categoryId: updated.categoryId,
    name: updated.name,
    slotCount: updated.slotCount,
    durationDays: updated.durationDays,
    trafficLimitBytes: updated.trafficLimitBytes?.toString() ?? null,
    price: updated.price,
    currency: updated.currency,
    sortOrder: updated.sortOrder,
    enabled: updated.enabled,
  });
}));

singboxAdminRouter.delete("/tariffs/:id", asyncRoute(async (req, res) => {
  const id = tariffIdParamSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  const existing = await prisma.singboxTariff.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Tariff not found" });
  await prisma.singboxTariff.delete({ where: { id } });
  return res.status(204).send();
}));
