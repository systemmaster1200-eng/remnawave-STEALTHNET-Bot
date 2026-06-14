import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import {
  createApiKey,
  listApiKeys,
  deleteApiKey,
  toggleApiKey,
  updateApiKey,
  listApiKeyUsage,
} from "./api-keys.service.js";

export const apiKeysAdminRouter = Router();
apiKeysAdminRouter.use(requireAuth);
apiKeysAdminRouter.use(requireAdminSection);

// CIDR / single IP. Принимаем строку, базовая валидация формата.
const cidrSchema = z
  .string()
  .trim()
  .refine(
    (s) =>
      /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(s) ||
      /^[0-9a-fA-F:]+(\/\d{1,3})?$/.test(s), // IPv6 (грубая проверка)
    { message: "Неверный формат IP/CIDR" }
  );

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  // ISO datetime либо null. Дополнительно: пустая строка → null.
  expiresAt: z
    .union([z.string().datetime(), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v && v !== "" ? new Date(v) : null)),
  allowedIps: z.array(cidrSchema).max(50).optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.union([z.string().max(500), z.null()]).optional(),
  expiresAt: z
    .union([z.string().datetime(), z.literal(""), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      return new Date(v);
    }),
  allowedIps: z.array(cidrSchema).max(50).optional().nullable(),
});

apiKeysAdminRouter.get("/", async (_req, res) => {
  const keys = await listApiKeys();
  res.json(keys);
});

apiKeysAdminRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Validation error", errors: parsed.error.errors });
  }
  const result = await createApiKey({
    name: parsed.data.name,
    description: parsed.data.description,
    expiresAt: parsed.data.expiresAt,
    allowedIps: parsed.data.allowedIps ?? null,
  });
  res.status(201).json(result);
});

apiKeysAdminRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Validation error", errors: parsed.error.errors });
  }
  try {
    const updated = await updateApiKey(req.params.id, {
      name: parsed.data.name,
      description: parsed.data.description,
      expiresAt: parsed.data.expiresAt,
      allowedIps: parsed.data.allowedIps ?? undefined,
    });
    res.json(updated);
  } catch {
    res.status(404).json({ message: "API key not found" });
  }
});

apiKeysAdminRouter.patch("/:id/toggle", async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;
  if (typeof isActive !== "boolean") {
    return res.status(400).json({ message: "isActive (boolean) required" });
  }
  try {
    const updated = await toggleApiKey(id, isActive);
    res.json(updated);
  } catch {
    res.status(404).json({ message: "API key not found" });
  }
});

apiKeysAdminRouter.get("/:id/usage", async (req, res) => {
  const limit = Number(req.query.limit ?? 100);
  const items = await listApiKeyUsage(req.params.id, isNaN(limit) ? 100 : limit);
  res.json(items);
});

apiKeysAdminRouter.delete("/:id", async (req, res) => {
  try {
    await deleteApiKey(req.params.id);
    res.json({ message: "Deleted" });
  } catch {
    res.status(404).json({ message: "API key not found" });
  }
});
