/**
 * Админские эндпоинты для прокси-нод: CRUD, генерация токена, docker-compose
 */

import { randomBytes } from "crypto";
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { getSystemConfig } from "../client/client.service.js";

export const proxyAdminRouter = Router();
proxyAdminRouter.use(requireAuth);
proxyAdminRouter.use(requireAdminSection);

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/** Генерирует уникальный токен для ноды (32 байта hex = 64 символа). */
function generateNodeToken(): string {
  return randomBytes(32).toString("hex");
}

const createNodeSchema = z.object({
  name: z.string().min(1, "Укажите название ноды").max(200).transform((s) => s.trim()),
  socksPort: z.number().int().min(1).max(65535).optional(),
  httpPort: z.number().int().min(1).max(65535).optional(),
});

// Пометить ноды без heartbeat > 5 мин как OFFLINE
const HEARTBEAT_OFFLINE_MS = 5 * 60 * 1000;
async function markStaleNodesOffline() {
  const threshold = new Date(Date.now() - HEARTBEAT_OFFLINE_MS);
  await prisma.proxyNode.updateMany({
    where: { status: "ONLINE", lastSeenAt: { lt: threshold } },
    data: { status: "OFFLINE" },
  });
}

// GET /api/admin/proxy/nodes — список нод
proxyAdminRouter.get("/nodes", asyncRoute(async (_req, res) => {
  await markStaleNodesOffline();
  const nodes = await prisma.proxyNode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { slots: true } },
    },
  });
  return res.json({
    items: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      status: n.status,
      lastSeenAt: n.lastSeenAt?.toISOString() ?? null,
      publicHost: n.publicHost,
      socksPort: n.socksPort,
      httpPort: n.httpPort,
      capacity: n.capacity,
      currentConnections: n.currentConnections,
      trafficInBytes: n.trafficInBytes.toString(),
      trafficOutBytes: n.trafficOutBytes.toString(),
      slotsCount: n._count.slots,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}));

// POST /api/admin/proxy/nodes — создать ноду (получить токен и docker-compose)
proxyAdminRouter.post("/nodes", asyncRoute(async (req, res) => {
  const body = createNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const socksPort = body.data.socksPort ?? 1080;
  const httpPort = body.data.httpPort ?? 8080;
  const token = generateNodeToken();
  const node = await prisma.proxyNode.create({
    data: {
      name: body.data.name,
      token,
      status: "OFFLINE",
      socksPort,
      httpPort,
    },
  });
  const config = await getSystemConfig();
  const apiUrl = (config.publicAppUrl || "").trim().replace(/\/$/, "") || "{{STEALTHNET_API_URL}}";
  const dockerCompose = `# STEALTHNET — прокси-нода (агент + heartbeat)
# STEALTHNET_API_URL берётся из настроек панели (URL приложения). Если не задан — замените вручную.
# На сервере: docker compose up -d --build
# (образ собирается из репозитория, не требуется Docker Hub)

services:
  proxy-node:
    build:
      context: https://github.com/systemmaster1200-eng/remnawave-STEALTHNET-Bot.git
      dockerfile: proxy-node/Dockerfile
    image: stealthnet/proxy-node:latest
    restart: unless-stopped
    environment:
      STEALTHNET_API_URL: ${apiUrl}
      PROXY_NODE_TOKEN: ${token}
      SOCKS_PORT: "${socksPort}"
      HTTP_PORT: "${httpPort}"
    ports:
      - "${socksPort}:${socksPort}"
      - "${httpPort}:${httpPort}"
`;
  return res.status(201).json({
    node: {
      id: node.id,
      name: node.name,
      status: node.status,
      token,
      createdAt: node.createdAt.toISOString(),
    },
    dockerCompose,
    instructions: apiUrl === "{{STEALTHNET_API_URL}}"
      ? "Скопируйте блок выше. Укажите URL панели в настройках (Настройки → URL приложения) или замените {{STEALTHNET_API_URL}} вручную. Сохраните как docker-compose.yml на сервере и выполните: docker compose up -d --build"
      : "Скопируйте блок выше. URL панели уже подставлен из настроек. Сохраните как docker-compose.yml на сервере и выполните: docker compose up -d --build",
  });
}));

// GET /api/admin/proxy/nodes/:id — одна нода со слотами
proxyAdminRouter.get("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.proxyNode.findUnique({
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
    socksPort: node.socksPort,
    httpPort: node.httpPort,
    capacity: node.capacity,
    currentConnections: node.currentConnections,
    trafficInBytes: node.trafficInBytes.toString(),
    trafficOutBytes: node.trafficOutBytes.toString(),
    metadata: node.metadata,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    slots: node.slots.map((s) => ({
      id: s.id,
      login: s.login,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      connectionLimit: s.connectionLimit,
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
  socksPort: z.number().int().min(1).max(65535).optional(),
  httpPort: z.number().int().min(1).max(65535).optional(),
});

// PATCH /api/admin/proxy/nodes/:id
proxyAdminRouter.patch("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const body = updateNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const node = await prisma.proxyNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });
  const updated = await prisma.proxyNode.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined && { name: body.data.name }),
      ...(body.data.status !== undefined && { status: body.data.status }),
      ...(body.data.capacity !== undefined && { capacity: body.data.capacity }),
      ...(body.data.socksPort !== undefined && { socksPort: body.data.socksPort }),
      ...(body.data.httpPort !== undefined && { httpPort: body.data.httpPort }),
    },
  });
  return res.json({
    id: updated.id,
    name: updated.name,
    status: updated.status,
    capacity: updated.capacity,
    socksPort: updated.socksPort,
    httpPort: updated.httpPort,
    updatedAt: updated.updatedAt.toISOString(),
  });
}));

// DELETE /api/admin/proxy/nodes/:id
proxyAdminRouter.delete("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.proxyNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });
  await prisma.proxyNode.delete({ where: { id } });
  return res.status(204).send();
}));

// ——— Категории прокси ———
const proxyCategoryIdSchema = z.object({ id: z.string().min(1) });
const createProxyCategorySchema = z.object({ name: z.string().min(1).max(200), sortOrder: z.number().int().optional() });
const updateProxyCategorySchema = z.object({ name: z.string().min(1).max(200).optional(), sortOrder: z.number().int().optional() });

proxyAdminRouter.get("/categories", asyncRoute(async (_req, res) => {
  const list = await prisma.proxyCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      tariffs: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { assignedNodes: { select: { nodeId: true } } },
      },
    },
  });
  return res.json({
    items: list.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      tariffs: c.tariffs.map((t) => ({
        id: t.id,
        categoryId: t.categoryId,
        name: t.name,
        proxyCount: t.proxyCount,
        durationDays: t.durationDays,
        trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
        connectionLimit: t.connectionLimit,
        price: t.price,
        currency: t.currency,
        sortOrder: t.sortOrder,
        enabled: t.enabled,
        nodeIds: t.assignedNodes.map((a) => a.nodeId),
      })),
    })),
  });
}));

proxyAdminRouter.post("/categories", asyncRoute(async (req, res) => {
  const body = createProxyCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const created = await prisma.proxyCategory.create({
    data: { name: body.data.name.trim(), sortOrder: body.data.sortOrder ?? 0 },
  });
  return res.status(201).json({ id: created.id, name: created.name, sortOrder: created.sortOrder });
}));

proxyAdminRouter.patch("/categories/:id", asyncRoute(async (req, res) => {
  const id = proxyCategoryIdSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  const body = updateProxyCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const updated = await prisma.proxyCategory.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined && { name: body.data.name.trim() }),
      ...(body.data.sortOrder !== undefined && { sortOrder: body.data.sortOrder }),
    },
  });
  return res.json(updated);
}));

proxyAdminRouter.delete("/categories/:id", asyncRoute(async (req, res) => {
  const id = proxyCategoryIdSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  await prisma.proxyCategory.delete({ where: { id } });
  return res.status(204).send();
}));

// ——— Тарифы прокси ———
const createProxyTariffSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(200),
  proxyCount: z.number().int().min(1),
  durationDays: z.number().int().min(1),
  trafficLimitBytes: z.union([z.bigint(), z.string(), z.number()]).nullable().optional(),
  connectionLimit: z.number().int().min(1).nullable().optional(),
  price: z.number().min(0),
  currency: z.string().min(1).max(10),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  nodeIds: z.array(z.string().min(1)).optional(),
});

const updateProxyTariffSchema = createProxyTariffSchema.partial();

proxyAdminRouter.get("/tariffs", asyncRoute(async (req, res) => {
  const categoryId = req.query.categoryId as string | undefined;
  const list = await prisma.proxyTariff.findMany({
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
      proxyCount: t.proxyCount,
      durationDays: t.durationDays,
      trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
      connectionLimit: t.connectionLimit,
      price: t.price,
      currency: t.currency,
      sortOrder: t.sortOrder,
      enabled: t.enabled,
    })),
  });
}));

proxyAdminRouter.post("/tariffs", asyncRoute(async (req, res) => {
  const body = createProxyTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const cat = await prisma.proxyCategory.findUnique({ where: { id: body.data.categoryId } });
  if (!cat) return res.status(400).json({ message: "Категория не найдена" });
  const trafficBytes = body.data.trafficLimitBytes != null
    ? BigInt(typeof body.data.trafficLimitBytes === "string" ? body.data.trafficLimitBytes : body.data.trafficLimitBytes)
    : null;
  const created = await prisma.$transaction(async (tx) => {
    const tariff = await tx.proxyTariff.create({
      data: {
        categoryId: body.data.categoryId,
        name: body.data.name.trim(),
        proxyCount: body.data.proxyCount,
        durationDays: body.data.durationDays,
        trafficLimitBytes: trafficBytes,
        connectionLimit: body.data.connectionLimit ?? null,
        price: body.data.price,
        currency: body.data.currency.toUpperCase(),
        sortOrder: body.data.sortOrder ?? 0,
        enabled: body.data.enabled ?? true,
      },
    });
    const nodeIds = body.data.nodeIds ?? [];
    if (nodeIds.length > 0) {
      await tx.proxyTariffNode.createMany({
        data: nodeIds.map((nodeId) => ({ tariffId: tariff.id, nodeId })),
        skipDuplicates: true,
      });
    }
    return tariff;
  });
  return res.status(201).json({
    id: created.id,
    categoryId: created.categoryId,
    name: created.name,
    proxyCount: created.proxyCount,
    durationDays: created.durationDays,
    trafficLimitBytes: created.trafficLimitBytes?.toString() ?? null,
    connectionLimit: created.connectionLimit,
    price: created.price,
    currency: created.currency,
    sortOrder: created.sortOrder,
    enabled: created.enabled,
  });
}));

proxyAdminRouter.patch("/tariffs/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  const body = updateProxyTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const data: Record<string, unknown> = {};
  if (body.data.name !== undefined) data.name = body.data.name.trim();
  if (body.data.categoryId !== undefined) data.categoryId = body.data.categoryId;
  if (body.data.proxyCount !== undefined) data.proxyCount = body.data.proxyCount;
  if (body.data.durationDays !== undefined) data.durationDays = body.data.durationDays;
  if (body.data.trafficLimitBytes !== undefined) {
    data.trafficLimitBytes = body.data.trafficLimitBytes != null
      ? BigInt(typeof body.data.trafficLimitBytes === "string" ? body.data.trafficLimitBytes : body.data.trafficLimitBytes)
      : null;
  }
  if (body.data.connectionLimit !== undefined) data.connectionLimit = body.data.connectionLimit;
  if (body.data.price !== undefined) data.price = body.data.price;
  if (body.data.currency !== undefined) data.currency = body.data.currency.toUpperCase();
  if (body.data.sortOrder !== undefined) data.sortOrder = body.data.sortOrder;
  if (body.data.enabled !== undefined) data.enabled = body.data.enabled;
  const updated = await prisma.$transaction(async (tx) => {
    const tariff = await tx.proxyTariff.update({ where: { id }, data: data as object });
    if (body.data.nodeIds !== undefined) {
      await tx.proxyTariffNode.deleteMany({ where: { tariffId: id } });
      const nodeIds = body.data.nodeIds;
      if (nodeIds && nodeIds.length > 0) {
        await tx.proxyTariffNode.createMany({
          data: nodeIds.map((nodeId: string) => ({ tariffId: id, nodeId })),
          skipDuplicates: true,
        });
      }
    }
    return tariff;
  });
  return res.json({
    id: updated.id,
    categoryId: updated.categoryId,
    name: updated.name,
    proxyCount: updated.proxyCount,
    durationDays: updated.durationDays,
    trafficLimitBytes: updated.trafficLimitBytes?.toString() ?? null,
    connectionLimit: updated.connectionLimit,
    price: updated.price,
    currency: updated.currency,
    sortOrder: updated.sortOrder,
    enabled: updated.enabled,
  });
}));

proxyAdminRouter.delete("/tariffs/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  await prisma.proxyTariff.delete({ where: { id } });
  return res.status(204).send();
}));

// ——— Управление слотами ———

// GET /api/admin/proxy/slots — список всех слотов с клиентом и нодой
proxyAdminRouter.get("/slots", asyncRoute(async (_req, res) => {
  const slots = await prisma.proxySlot.findMany({
    include: {
      node: { select: { id: true, name: true, publicHost: true, socksPort: true, httpPort: true } },
      client: { select: { id: true, email: true, telegramUsername: true, telegramId: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({
    items: slots.map((s) => ({
      id: s.id,
      nodeId: s.nodeId,
      nodeName: s.node.name,
      publicHost: s.node.publicHost,
      socksPort: s.node.socksPort,
      httpPort: s.node.httpPort,
      clientId: s.clientId,
      clientEmail: s.client.email,
      clientTelegram: s.client.telegramUsername,
      clientTelegramId: s.client.telegramId,
      login: s.login,
      password: s.password,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      connectionLimit: s.connectionLimit,
      currentConnections: s.currentConnections,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));

// PATCH /api/admin/proxy/slots/:id — изменить слот (логин, пароль, лимиты, статус)
const updateSlotSchema = z.object({
  login: z.string().min(1).max(100).optional(),
  password: z.string().min(1).max(100).optional(),
  connectionLimit: z.number().int().min(0).nullable().optional(),
  trafficLimitBytes: z.union([z.string(), z.number()]).nullable().optional(),
  status: z.enum(["ACTIVE", "EXPIRED", "REVOKED"]).optional(),
  expiresAt: z.string().optional(),
});

proxyAdminRouter.patch("/slots/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const body = updateSlotSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const slot = await prisma.proxySlot.findUnique({ where: { id } });
  if (!slot) return res.status(404).json({ message: "Slot not found" });
  const data: Record<string, unknown> = {};
  if (body.data.login !== undefined) data.login = body.data.login.trim();
  if (body.data.password !== undefined) data.password = body.data.password;
  if (body.data.connectionLimit !== undefined) data.connectionLimit = body.data.connectionLimit;
  if (body.data.trafficLimitBytes !== undefined) {
    data.trafficLimitBytes = body.data.trafficLimitBytes != null ? BigInt(body.data.trafficLimitBytes) : null;
  }
  if (body.data.status !== undefined) data.status = body.data.status;
  if (body.data.expiresAt !== undefined) data.expiresAt = new Date(body.data.expiresAt);
  const updated = await prisma.proxySlot.update({ where: { id }, data: data as object });
  return res.json({
    id: updated.id,
    login: updated.login,
    password: updated.password,
    connectionLimit: updated.connectionLimit,
    trafficLimitBytes: updated.trafficLimitBytes?.toString() ?? null,
    status: updated.status,
    expiresAt: updated.expiresAt.toISOString(),
  });
}));

// DELETE /api/admin/proxy/slots/:id — удалить слот
proxyAdminRouter.delete("/slots/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const slot = await prisma.proxySlot.findUnique({ where: { id } });
  if (!slot) return res.status(404).json({ message: "Slot not found" });
  await prisma.proxySlot.delete({ where: { id } });
  return res.status(204).send();
}));

// GET /api/admin/proxy/slots/export — экспорт слотов в CSV
proxyAdminRouter.get("/slots/export", asyncRoute(async (req, res) => {
  const format = (req.query.format as string) || "csv";
  if (format !== "csv") {
    return res.status(400).json({ message: "Supported format: csv" });
  }
  const slots = await prisma.proxySlot.findMany({
    include: {
      node: { select: { id: true, name: true, publicHost: true, socksPort: true, httpPort: true } },
      client: { select: { id: true, email: true, telegramUsername: true } },
    },
    orderBy: [{ nodeId: "asc" }, { createdAt: "desc" }],
  });
  const header = "nodeId;nodeName;host;socksPort;httpPort;slotId;login;password;clientId;email;telegram;status;expiresAt;trafficLimitBytes;trafficUsedBytes;connectionLimit;currentConnections;createdAt";
  const rows = slots.map((s) => {
    const escape = (v: string | null | undefined) =>
      v == null ? "" : String(v).replace(/;/g, ",").replace(/\n/g, " ");
    return [
      s.node.id,
      escape(s.node.name),
      escape(s.node.publicHost),
      s.node.socksPort,
      s.node.httpPort,
      s.id,
      escape(s.login),
      escape(s.password),
      s.client.id,
      escape(s.client.email),
      escape(s.client.telegramUsername),
      s.status,
      s.expiresAt.toISOString(),
      s.trafficLimitBytes?.toString() ?? "",
      s.trafficUsedBytes.toString(),
      s.connectionLimit ?? "",
      s.currentConnections,
      s.createdAt.toISOString(),
    ].join(";");
  });
  const csv = [header, ...rows].join("\n");
  const bom = "\uFEFF";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=proxy-slots.csv");
  return res.send(bom + csv);
}));
