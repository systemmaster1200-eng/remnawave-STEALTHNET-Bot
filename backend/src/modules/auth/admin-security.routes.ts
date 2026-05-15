/**
 * Безопасность админов:
 *   POST /api/admin/security/logout-all  — инвалидирует все refresh-токены всех админов
 *                                          + (опционально) текущий админ.
 *   POST /api/admin/security/logout-admin/:id — инвалидирует токены конкретного админа.
 *
 * Используется при подозрении на утечку: «выкинуть всех», «отозвать сессию у уволенного
 * админа». После вызова всем админам потребуется логиниться заново.
 *
 * Реализация: удаляем все ряды из таблицы refresh_tokens. Access-токены (15min TTL)
 * умрут сами максимум через 15 минут. Можно добавить blacklist для access-tokens
 * если нужна моментальная инвалидация — сейчас пропускаем (15 минут — приемлемо).
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "./middleware.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const adminSecurityRouter = Router();
adminSecurityRouter.use(requireAuth);
adminSecurityRouter.use(requireAdminSection);

const logoutAllSchema = z.object({
  /** Включать ли в инвалидацию текущего админа (по умолчанию true). */
  includingMe: z.boolean().optional(),
  /** Пояснение (для аудита). */
  reason: z.string().max(500).optional(),
});

adminSecurityRouter.post(
  "/logout-all",
  asyncRoute(async (req, res) => {
    const parsed = logoutAllSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
    const includingMe = parsed.data.includingMe !== false;
    const myAdminId = (req as express.Request & { adminId?: string }).adminId;

    const where: Record<string, unknown> = {};
    if (!includingMe && myAdminId) where.adminId = { not: myAdminId };

    const result = await prisma.refreshToken.deleteMany({ where });

    await logAdmin(req, "security.logout_all", undefined, {
      deletedTokens: result.count,
      includingMe,
      reason: parsed.data.reason ?? null,
    });

    return res.json({
      ok: true,
      deletedTokens: result.count,
      message: includingMe
        ? "Все refresh-токены отозваны. Все админы (включая вас) будут разлогинены через ≤15 минут."
        : "Все refresh-токены кроме вашего отозваны. Остальные админы будут разлогинены через ≤15 минут.",
    });
  }),
);

adminSecurityRouter.post(
  "/logout-admin/:id",
  asyncRoute(async (req, res) => {
    const adminId = req.params.id;
    if (!adminId) return res.status(400).json({ message: "adminId required" });

    const admin = await prisma.admin.findUnique({ where: { id: adminId }, select: { id: true, email: true } });
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    const result = await prisma.refreshToken.deleteMany({ where: { adminId } });

    await logAdmin(req, "security.logout_admin", { type: "admin", id: adminId }, {
      adminEmail: admin.email,
      deletedTokens: result.count,
    });

    return res.json({
      ok: true,
      adminEmail: admin.email,
      deletedTokens: result.count,
    });
  }),
);
