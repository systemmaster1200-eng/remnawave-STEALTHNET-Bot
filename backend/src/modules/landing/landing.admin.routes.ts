/**
 * Админские эндпоинты редактора лендинга.
 *
 * Все маршруты требуют авторизации (requireAuth) и проверки секции (requireAdminSection).
 * Section auto-derives как "landing" из первого сегмента пути.
 */

import express, { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import {
  listBlocks,
  listBlocksForRender,
  getBlock,
  createBlock,
  updateBlockDraft,
  publishBlock,
  discardBlockDraft,
  deleteBlock,
  reorderBlocks,
  getTheme,
  getThemeForRender,
  updateThemeDraft,
  publishTheme,
  discardThemeDraft,
  createSnapshot,
  listSnapshots,
  getSnapshot,
  deleteSnapshot,
  restoreSnapshot,
  publishAll,
  discardAllDrafts,
  hasPendingDrafts,
  getLandingEnabled,
  setLandingEnabled,
  applyBlockDefaults,
  seedDefaultsToEmptyBlocks,
} from "./landing.service.js";

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>,
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// Поддерживаемые типы блоков (для валидации). При добавлении нового — расширить.
const BLOCK_TYPES = [
  "hero",
  "features",
  "benefits",
  "tariffs",
  "devices",
  "faq",
  "cta",
  "stats",
  "logos",
  "testimonials",
  "video",
  "spacer",
  "custom",
] as const;

const createBlockSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  variant: z.string().min(1).max(60).optional(),
  order: z.number().int().optional(),
  visible: z.boolean().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  i18n: z.record(z.string(), z.unknown()).optional(),
});

const updateBlockSchema = z.object({
  variant: z.string().min(1).max(60).optional(),
  order: z.number().int().optional(),
  visible: z.boolean().optional(),
  propsDraft: z.record(z.string(), z.unknown()).nullable().optional(),
  i18nDraft: z.record(z.string(), z.unknown()).nullable().optional(),
});

const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), order: z.number().int() })).min(1).max(200),
});

const themeDraftSchema = z.object({
  draft: z.record(z.string(), z.unknown()).nullable(),
});

const snapshotCreateSchema = z.object({
  label: z.string().max(120).optional(),
});

// ─── Upload (multer) ────────────────────────────────────────────────────────

const LANDING_UPLOAD_DIR = "/app/uploads/landing";
if (!fs.existsSync(LANDING_UPLOAD_DIR)) {
  fs.mkdirSync(LANDING_UPLOAD_DIR, { recursive: true });
}

const ALLOWED_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);

const landingUpload = multer({
  storage: multer.diskStorage({
    destination: LANDING_UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const rawExt = path.extname(file.originalname).toLowerCase();
      const ext = ALLOWED_EXTS.has(rawExt) ? rawExt : ".png";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) return cb(new Error("Unsupported file extension"));
    cb(null, true);
  },
});

export const landingAdminRouter = Router();
landingAdminRouter.use(requireAuth);
landingAdminRouter.use(requireAdminSection);

landingAdminRouter.post(
  "/upload",
  landingUpload.single("file"),
  (req, res) => {
    const file = (req as express.Request & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ message: "No file" });
    return res.json({ url: `/api/uploads/landing/${file.filename}`, size: file.size, mime: file.mimetype });
  },
);

// ─── Blocks CRUD ─────────────────────────────────────────────────────────────

landingAdminRouter.get(
  "/blocks",
  asyncRoute(async (_req, res) => {
    const blocks = await listBlocks({ withDraft: true });
    return res.json(blocks);
  }),
);

landingAdminRouter.get(
  "/blocks/:id",
  asyncRoute(async (req, res) => {
    const block = await getBlock(req.params.id);
    if (!block) return res.status(404).json({ message: "Block not found" });
    return res.json(block);
  }),
);

landingAdminRouter.post(
  "/blocks",
  asyncRoute(async (req, res) => {
    const parsed = createBlockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.format() });
    const block = await createBlock(parsed.data);
    return res.status(201).json(block);
  }),
);

landingAdminRouter.patch(
  "/blocks/:id",
  asyncRoute(async (req, res) => {
    const parsed = updateBlockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.format() });
    const block = await updateBlockDraft(req.params.id, parsed.data);
    return res.json(block);
  }),
);

landingAdminRouter.delete(
  "/blocks/:id",
  asyncRoute(async (req, res) => {
    await deleteBlock(req.params.id);
    return res.status(204).send();
  }),
);

landingAdminRouter.post(
  "/blocks/reorder",
  asyncRoute(async (req, res) => {
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.format() });
    const blocks = await reorderBlocks(parsed.data.items);
    return res.json(blocks);
  }),
);

landingAdminRouter.post(
  "/blocks/:id/publish",
  asyncRoute(async (req, res) => {
    const block = await publishBlock(req.params.id);
    return res.json(block);
  }),
);

landingAdminRouter.post(
  "/blocks/:id/discard-draft",
  asyncRoute(async (req, res) => {
    const block = await discardBlockDraft(req.params.id);
    return res.json(block);
  }),
);

landingAdminRouter.post(
  "/blocks/:id/apply-defaults",
  asyncRoute(async (req, res) => {
    const mode = req.body?.mode === "overwrite" ? "overwrite" : "merge";
    const block = await applyBlockDefaults(req.params.id, mode);
    return res.json(block);
  }),
);

landingAdminRouter.post(
  "/seed-defaults",
  asyncRoute(async (_req, res) => {
    const result = await seedDefaultsToEmptyBlocks();
    return res.json(result);
  }),
);

// ─── Theme ───────────────────────────────────────────────────────────────────

landingAdminRouter.get(
  "/theme",
  asyncRoute(async (_req, res) => {
    const theme = await getTheme({ withDraft: true });
    return res.json(theme);
  }),
);

landingAdminRouter.patch(
  "/theme",
  asyncRoute(async (req, res) => {
    const parsed = themeDraftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.format() });
    const theme = await updateThemeDraft({ draft: parsed.data.draft });
    return res.json(theme);
  }),
);

landingAdminRouter.post(
  "/theme/publish",
  asyncRoute(async (_req, res) => {
    const theme = await publishTheme();
    return res.json(theme);
  }),
);

landingAdminRouter.post(
  "/theme/discard-draft",
  asyncRoute(async (_req, res) => {
    const theme = await discardThemeDraft();
    return res.json(theme);
  }),
);

// ─── Snapshots ───────────────────────────────────────────────────────────────

landingAdminRouter.get(
  "/snapshots",
  asyncRoute(async (_req, res) => {
    const items = await listSnapshots(50);
    return res.json(items);
  }),
);

landingAdminRouter.get(
  "/snapshots/:id",
  asyncRoute(async (req, res) => {
    const snap = await getSnapshot(req.params.id);
    if (!snap) return res.status(404).json({ message: "Snapshot not found" });
    return res.json(snap);
  }),
);

landingAdminRouter.post(
  "/snapshots",
  asyncRoute(async (req, res) => {
    const parsed = snapshotCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.format() });
    const adminEmail = (req as express.Request & { adminEmail?: string }).adminEmail;
    const snap = await createSnapshot({ label: parsed.data.label, createdBy: adminEmail });
    return res.status(201).json(snap);
  }),
);

landingAdminRouter.post(
  "/snapshots/:id/restore",
  asyncRoute(async (req, res) => {
    const adminEmail = (req as express.Request & { adminEmail?: string }).adminEmail;
    const result = await restoreSnapshot(req.params.id, adminEmail);
    return res.json(result);
  }),
);

landingAdminRouter.delete(
  "/snapshots/:id",
  asyncRoute(async (req, res) => {
    await deleteSnapshot(req.params.id);
    return res.status(204).send();
  }),
);

// ─── Landing on/off toggle ──────────────────────────────────────────────────

landingAdminRouter.get(
  "/status",
  asyncRoute(async (_req, res) => {
    const enabled = await getLandingEnabled();
    return res.json({ enabled });
  }),
);

landingAdminRouter.patch(
  "/status",
  asyncRoute(async (req, res) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });
    const result = await setLandingEnabled(parsed.data.enabled);
    return res.json(result);
  }),
);

// ─── Preview (admin-only render с черновиками) ───────────────────────────────

landingAdminRouter.get(
  "/preview",
  asyncRoute(async (req, res) => {
    const langRaw = String(req.query.lang ?? "ru").toLowerCase();
    const lang = langRaw === "en" ? "en" : "ru";
    const [blocks, theme] = await Promise.all([
      listBlocksForRender(lang, { useDraft: true }),
      getThemeForRender({ useDraft: true }),
    ]);
    return res.json({ blocks, theme, lang });
  }),
);

// ─── Bulk publish/discard ────────────────────────────────────────────────────

landingAdminRouter.get(
  "/drafts-status",
  asyncRoute(async (_req, res) => {
    const status = await hasPendingDrafts();
    return res.json(status);
  }),
);

landingAdminRouter.post(
  "/publish-all",
  asyncRoute(async (req, res) => {
    const adminEmail = (req as express.Request & { adminEmail?: string }).adminEmail;
    const result = await publishAll(adminEmail);
    return res.json(result);
  }),
);

landingAdminRouter.post(
  "/discard-all-drafts",
  asyncRoute(async (_req, res) => {
    const result = await discardAllDrafts();
    return res.json(result);
  }),
);
