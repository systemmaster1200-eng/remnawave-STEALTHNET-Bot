/**
 * Админ-API для webhook inbox.
 */

import express, { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { listWebhookEvents, getWebhookEvent, replayWebhook } from "./webhook-inbox.service.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const webhookInboxAdminRouter = Router();
webhookInboxAdminRouter.use(requireAuth);
webhookInboxAdminRouter.use(requireAdminSection);

const ALLOWED_OUTCOMES = [
  "accepted", "rejected_signature", "rejected_payload",
  "payment_not_found", "payment_already_paid", "payment_failed",
  "ignored_event", "error",
] as const;

const listSchema = z.object({
  provider: z.string().max(20).optional(),
  outcome: z.enum(ALLOWED_OUTCOMES).optional(),
  paymentId: z.string().max(200).optional(),
  q: z.string().max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(40).optional(),
});

webhookInboxAdminRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    const result = await listWebhookEvents({
      ...parsed.data,
      dateFrom: parsed.data.dateFrom ? new Date(parsed.data.dateFrom) : undefined,
      dateTo: parsed.data.dateTo ? new Date(parsed.data.dateTo) : undefined,
    });
    return res.json(result);
  }),
);

webhookInboxAdminRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const ev = await getWebhookEvent(req.params.id);
    if (!ev) return res.status(404).json({ message: "Webhook event not found" });
    return res.json(ev);
  }),
);

webhookInboxAdminRouter.post(
  "/:id/replay",
  asyncRoute(async (req, res) => {
    const actorId = ((req as unknown as { adminEmail?: string }).adminEmail) ?? null;
    // Базовый URL для replay — внутренний (api контейнер сам себе шлёт через нашу же
    // публичную доменную ссылку), берём из publicAppUrl. Можно заменить на http://api:5000.
    const baseUrl = "http://localhost:5000";
    const result = await replayWebhook(req.params.id, actorId, baseUrl);
    await logAdmin(req, "webhook.replay", { type: "webhook_event", id: req.params.id }, {
      ok: result.ok,
      status: result.status,
      error: result.error,
    });
    if (!result.ok) return res.status(400).json({ message: result.error });
    return res.json({ ok: true, replayedHttpStatus: result.status });
  }),
);
