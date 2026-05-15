/**
 * Админ-API для аудит-лога.
 * Только чтение — никаких mutate операций (это write-only журнал).
 */

import express, { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { listAdminEvents, getAuditFacets } from "./audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const auditAdminRouter = Router();
auditAdminRouter.use(requireAuth);
auditAdminRouter.use(requireAdminSection);

const listSchema = z.object({
  kind: z.string().max(80).optional(),
  actorId: z.string().max(120).optional(),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(200).optional(),
  q: z.string().max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(40).optional(),
});

auditAdminRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    const result = await listAdminEvents({
      ...parsed.data,
      dateFrom: parsed.data.dateFrom ? new Date(parsed.data.dateFrom) : undefined,
      dateTo: parsed.data.dateTo ? new Date(parsed.data.dateTo) : undefined,
    });
    return res.json(result);
  }),
);

auditAdminRouter.get(
  "/facets",
  asyncRoute(async (_req, res) => {
    const facets = await getAuditFacets();
    return res.json(facets);
  }),
);
