/**
 * WDTT (Warp/WireGuard) Admin Routes
 * Управление нодами, категориями, тарифами и слотами WDTT
 */

import { randomBytes } from "crypto";
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";

export const wdttAdminRouter = Router();
wdttAdminRouter.use(requireAuth);
wdttAdminRouter.use(requireAdminSection);

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/** Генерирует уникальный API ключ для ноды (32 байта hex = 64 символа). */
function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}

// ——— WDTT Ноды ———

// GET /api/admin/wdtt/nodes — список нод
wdttAdminRouter.get("/nodes", asyncRoute(async (_req, res) => {
  const nodes = await prisma.wdttNode.findMany({
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
      apiUrl: n.apiUrl,
      dtlsPort: n.dtlsPort,
      wgPort: n.wgPort,
      tunPort: n.tunPort,
      capacity: n.capacity,
      currentSlots: n.currentSlots,
      slotsCount: n._count.slots,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}));

// POST /api/admin/wdtt/nodes — создать ноду
const createWdttNodeSchema = z.object({
  name: z.string().min(1, "Укажите название ноды").max(200).transform((s) => s.trim()),
  apiUrl: z.string().min(1, "Укажите URL API ноды").url("Неверный формат URL"),
  apiKey: z.string().min(16, "API ключ должен быть минимум 16 символов").optional(),
  dtlsPort: z.number().int().min(1).max(65535).optional(),
  wgPort: z.number().int().min(1).max(65535).optional(),
  tunPort: z.number().int().min(1).max(65535).optional(),
  capacity: z.number().int().min(1).nullable().optional(),
});

wdttAdminRouter.post("/nodes", asyncRoute(async (req, res) => {
  const body = createWdttNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }

  const apiKey = body.data.apiKey ?? generateApiKey();
  const node = await prisma.wdttNode.create({
    data: {
      name: body.data.name,
      apiUrl: body.data.apiUrl,
      apiKey,
      status: "OFFLINE",
      dtlsPort: body.data.dtlsPort ?? 56000,
      wgPort: body.data.wgPort ?? 56001,
      tunPort: body.data.tunPort ?? 9000,
      capacity: body.data.capacity ?? null,
    },
  });

  return res.status(201).json({
    node: {
      id: node.id,
      name: node.name,
      status: node.status,
      apiUrl: node.apiUrl,
      apiKey: node.apiKey,
      dtlsPort: node.dtlsPort,
      wgPort: node.wgPort,
      tunPort: node.tunPort,
      capacity: node.capacity,
      createdAt: node.createdAt.toISOString(),
    },
    instructions: `Нода добавлена. API ключ: ${apiKey}\n\nУстановите на сервере proxy-turn-vk-android-main и укажите этот API ключ в конфигурации.`,
  });
}));

// GET /api/admin/wdtt/nodes/:id — одна нода со слотами
wdttAdminRouter.get("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.wdttNode.findUnique({
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
    apiUrl: node.apiUrl,
    apiKey: node.apiKey,
    dtlsPort: node.dtlsPort,
    wgPort: node.wgPort,
    tunPort: node.tunPort,
    capacity: node.capacity,
    currentSlots: node.currentSlots,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    slots: node.slots.map((s) => ({
      id: s.id,
      password: s.password,
      vkHash: s.vkHash,
      wdttLink: s.wdttLink,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      status: s.status,
      client: s.client,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));

// PATCH /api/admin/wdtt/nodes/:id — обновить ноду
const updateWdttNodeSchema = z.object({
  name: z.string().max(200).optional(),
  status: z.enum(["ONLINE", "OFFLINE", "DISABLED"]).optional(),
  apiUrl: z.string().url().optional(),
  capacity: z.number().int().min(1).nullable().optional(),
  dtlsPort: z.number().int().min(1).max(65535).optional(),
  wgPort: z.number().int().min(1).max(65535).optional(),
  tunPort: z.number().int().min(1).max(65535).optional(),
});

wdttAdminRouter.patch("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const body = updateWdttNodeSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const node = await prisma.wdttNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });

  const updated = await prisma.wdttNode.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined && { name: body.data.name }),
      ...(body.data.status !== undefined && { status: body.data.status }),
      ...(body.data.apiUrl !== undefined && { apiUrl: body.data.apiUrl }),
      ...(body.data.capacity !== undefined && { capacity: body.data.capacity }),
      ...(body.data.dtlsPort !== undefined && { dtlsPort: body.data.dtlsPort }),
      ...(body.data.wgPort !== undefined && { wgPort: body.data.wgPort }),
      ...(body.data.tunPort !== undefined && { tunPort: body.data.tunPort }),
    },
  });
  return res.json({
    id: updated.id,
    name: updated.name,
    status: updated.status,
    apiUrl: updated.apiUrl,
    capacity: updated.capacity,
    dtlsPort: updated.dtlsPort,
    wgPort: updated.wgPort,
    tunPort: updated.tunPort,
    updatedAt: updated.updatedAt.toISOString(),
  });
}));

// DELETE /api/admin/wdtt/nodes/:id — удалить ноду
wdttAdminRouter.delete("/nodes/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.wdttNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });
  await prisma.wdttNode.delete({ where: { id } });
  return res.status(204).send();
}));

// POST /api/admin/wdtt/nodes/:id/test — тест связи с нодой
wdttAdminRouter.post("/nodes/:id/test", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const node = await prisma.wdttNode.findUnique({ where: { id } });
  if (!node) return res.status(404).json({ message: "Node not found" });

  try {
    const response = await fetch(`${node.apiUrl}/api/health`, {
      headers: { "X-API-Key": node.apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      // Обновляем статус ноды
      await prisma.wdttNode.update({
        where: { id },
        data: { status: "ONLINE", lastSeenAt: new Date() },
      });
      return res.json({ success: true, nodeStatus: "ONLINE", data });
    }
    return res.status(502).json({ success: false, error: `HTTP ${response.status}` });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ success: false, error });
  }
}));

// ——— WDTT Категории ———

const wdttCategoryIdSchema = z.object({ id: z.string().min(1) });
const createWdttCategorySchema = z.object({ name: z.string().min(1).max(200), sortOrder: z.number().int().optional() });
const updateWdttCategorySchema = z.object({ name: z.string().min(1).max(200).optional(), sortOrder: z.number().int().optional() });

wdttAdminRouter.get("/categories", asyncRoute(async (_req, res) => {
  const list = await prisma.wdttCategory.findMany({
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
        price: t.price,
        currency: t.currency,
        sortOrder: t.sortOrder,
        enabled: t.enabled,
        nodeIds: t.assignedNodes.map((a) => a.nodeId),
      })),
    })),
  });
}));

wdttAdminRouter.post("/categories", asyncRoute(async (req, res) => {
  const body = createWdttCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const created = await prisma.wdttCategory.create({
    data: { name: body.data.name.trim(), sortOrder: body.data.sortOrder ?? 0 },
  });
  return res.status(201).json({ id: created.id, name: created.name, sortOrder: created.sortOrder });
}));

wdttAdminRouter.patch("/categories/:id", asyncRoute(async (req, res) => {
  const id = wdttCategoryIdSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  const body = updateWdttCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const updated = await prisma.wdttCategory.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined && { name: body.data.name.trim() }),
      ...(body.data.sortOrder !== undefined && { sortOrder: body.data.sortOrder }),
    },
  });
  return res.json(updated);
}));

wdttAdminRouter.delete("/categories/:id", asyncRoute(async (req, res) => {
  const id = wdttCategoryIdSchema.safeParse(req.params).data?.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  await prisma.wdttCategory.delete({ where: { id } });
  return res.status(204).send();
}));

// ——— WDTT Тарифы ———

const createWdttTariffSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(200),
  proxyCount: z.number().int().min(1),
  durationDays: z.number().int().min(1),
  trafficLimitBytes: z.union([z.bigint(), z.string(), z.number()]).nullable().optional(),
  price: z.number().min(0),
  currency: z.string().min(1).max(10),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  nodeIds: z.array(z.string().min(1)).optional(),
});

const updateWdttTariffSchema = createWdttTariffSchema.partial();

wdttAdminRouter.get("/tariffs", asyncRoute(async (req, res) => {
  const categoryId = req.query.categoryId as string | undefined;
  const list = await prisma.wdttTariff.findMany({
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
      price: t.price,
      currency: t.currency,
      sortOrder: t.sortOrder,
      enabled: t.enabled,
    })),
  });
}));

wdttAdminRouter.post("/tariffs", asyncRoute(async (req, res) => {
  const body = createWdttTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const cat = await prisma.wdttCategory.findUnique({ where: { id: body.data.categoryId } });
  if (!cat) return res.status(400).json({ message: "Категория не найдена" });
  const trafficBytes = body.data.trafficLimitBytes != null
    ? BigInt(typeof body.data.trafficLimitBytes === "string" ? body.data.trafficLimitBytes : body.data.trafficLimitBytes)
    : null;
  const created = await prisma.$transaction(async (tx) => {
    const tariff = await tx.wdttTariff.create({
      data: {
        categoryId: body.data.categoryId,
        name: body.data.name.trim(),
        proxyCount: body.data.proxyCount,
        durationDays: body.data.durationDays,
        trafficLimitBytes: trafficBytes,
        price: body.data.price,
        currency: body.data.currency.toUpperCase(),
        sortOrder: body.data.sortOrder ?? 0,
        enabled: body.data.enabled ?? true,
      },
    });
    const nodeIds = body.data.nodeIds ?? [];
    if (nodeIds.length > 0) {
      await tx.wdttTariffNode.createMany({
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
    price: created.price,
    currency: created.currency,
    sortOrder: created.sortOrder,
    enabled: created.enabled,
  });
}));

wdttAdminRouter.patch("/tariffs/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  const body = updateWdttTariffSchema.safeParse(req.body);
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
  if (body.data.price !== undefined) data.price = body.data.price;
  if (body.data.currency !== undefined) data.currency = body.data.currency.toUpperCase();
  if (body.data.sortOrder !== undefined) data.sortOrder = body.data.sortOrder;
  if (body.data.enabled !== undefined) data.enabled = body.data.enabled;
  const updated = await prisma.$transaction(async (tx) => {
    const tariff = await tx.wdttTariff.update({ where: { id }, data: data as object });
    if (body.data.nodeIds !== undefined) {
      await tx.wdttTariffNode.deleteMany({ where: { tariffId: id } });
      const nodeIds = body.data.nodeIds;
      if (nodeIds && nodeIds.length > 0) {
        await tx.wdttTariffNode.createMany({
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
    price: updated.price,
    currency: updated.currency,
    sortOrder: updated.sortOrder,
    enabled: updated.enabled,
  });
}));

wdttAdminRouter.delete("/tariffs/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Invalid id" });
  await prisma.wdttTariff.delete({ where: { id } });
  return res.status(204).send();
}));

// ——— WDTT Слоты ———

// GET /api/admin/wdtt/slots — список всех слотов
wdttAdminRouter.get("/slots", asyncRoute(async (_req, res) => {
  const slots = await prisma.wdttSlot.findMany({
    include: {
      node: { select: { id: true, name: true, publicHost: true, dtlsPort: true, wgPort: true, tunPort: true } },
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
      dtlsPort: s.node.dtlsPort,
      wgPort: s.node.wgPort,
      tunPort: s.node.tunPort,
      clientId: s.clientId,
      clientEmail: s.client.email,
      clientTelegram: s.client.telegramUsername,
      clientTelegramId: s.client.telegramId,
      password: s.password,
      vkHash: s.vkHash,
      wdttLink: s.wdttLink,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      status: s.status,
      revokeReason: s.revokeReason,
      revokedAt: s.revokedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));

// PATCH /api/admin/wdtt/slots/:id — изменить слот
const updateWdttSlotSchema = z.object({
  status: z.enum(["ACTIVE", "EXPIRED", "REVOKED"]).optional(),
  expiresAt: z.string().optional(),
});

wdttAdminRouter.patch("/slots/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const body = updateWdttSlotSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const slot = await prisma.wdttSlot.findUnique({ where: { id } });
  if (!slot) return res.status(404).json({ message: "Slot not found" });
  const data: Record<string, unknown> = {};
  if (body.data.status !== undefined) data.status = body.data.status;
  if (body.data.expiresAt !== undefined) data.expiresAt = new Date(body.data.expiresAt);
  const updated = await prisma.wdttSlot.update({ where: { id }, data: data as object });
  return res.json({
    id: updated.id,
    status: updated.status,
    expiresAt: updated.expiresAt.toISOString(),
  });
}));

// DELETE /api/admin/wdtt/slots/:id — удалить слот (и отозвать доступ)
wdttAdminRouter.delete("/slots/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const slot = await prisma.wdttSlot.findUnique({
    where: { id },
    include: { node: true },
  });
  if (!slot) return res.status(404).json({ message: "Slot not found" });

  // Удаляем ключ с ноды
  try {
    await fetch(`${slot.node.apiUrl}/api/keys/${slot.password}`, {
      method: "DELETE",
      headers: { "X-API-Key": slot.node.apiKey },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Продолжаем удаление из БД даже если нода недоступна
  }

  // Уменьшаем currentSlots на ноде
  await prisma.wdttNode.update({
    where: { id: slot.nodeId },
    data: { currentSlots: { decrement: 1 } },
  });

  await prisma.wdttSlot.delete({ where: { id } });
  return res.status(204).send();
}));

// POST /api/admin/wdtt/slots/:id/revoke — отозвать доступ вручную
wdttAdminRouter.post("/slots/:id/revoke", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const slot = await prisma.wdttSlot.findUnique({
    where: { id },
    include: { node: true },
  });
  if (!slot) return res.status(404).json({ message: "Slot not found" });

  // Удаляем ключ с ноды
  try {
    await fetch(`${slot.node.apiUrl}/api/keys/${slot.password}`, {
      method: "DELETE",
      headers: { "X-API-Key": slot.node.apiKey },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Продолжаем даже если нода недоступна
  }

  // Обновляем статус слота
  await prisma.wdttSlot.update({
    where: { id },
    data: { status: "REVOKED", revokeReason: "manual", revokedAt: new Date() },
  });

  // Уменьшаем currentSlots
  await prisma.wdttNode.update({
    where: { id: slot.nodeId },
    data: { currentSlots: { decrement: 1 } },
  });

  return res.json({ success: true, message: "Доступ отозван" });
}));

// GET /api/admin/wdtt/slots/export — экспорт слотов в CSV
wdttAdminRouter.get("/slots/export", asyncRoute(async (req, res) => {
  const format = (req.query.format as string) || "csv";
  if (format !== "csv") {
    return res.status(400).json({ message: "Supported format: csv" });
  }
  const slots = await prisma.wdttSlot.findMany({
    include: {
      node: { select: { id: true, name: true, publicHost: true, dtlsPort: true, wgPort: true, tunPort: true } },
      client: { select: { id: true, email: true, telegramUsername: true } },
    },
    orderBy: [{ nodeId: "asc" }, { createdAt: "desc" }],
  });
  const header = "nodeId;nodeName;host;dtlsPort;wgPort;tunPort;slotId;password;vkHash;clientId;email;telegram;status;expiresAt;trafficLimitBytes;trafficUsedBytes;createdAt";
  const rows = slots.map((s) => {
    const escape = (v: string | null | undefined) =>
      v == null ? "" : String(v).replace(/;/g, ",").replace(/\n/g, " ");
    return [
      s.node.id,
      escape(s.node.name),
      escape(s.node.publicHost),
      s.node.dtlsPort,
      s.node.wgPort,
      s.node.tunPort,
      s.id,
      escape(s.password),
      escape(s.vkHash),
      s.client.id,
      escape(s.client.email),
      escape(s.client.telegramUsername),
      s.status,
      s.expiresAt.toISOString(),
      s.trafficLimitBytes?.toString() ?? "",
      s.trafficUsedBytes.toString(),
      s.createdAt.toISOString(),
    ].join(";");
  });
  const csv = [header, ...rows].join("\n");
  const bom = "\uFEFF";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=wdtt-slots.csv");
  return res.send(bom + csv);
}));
