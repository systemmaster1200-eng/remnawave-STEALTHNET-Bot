/**
 * Админские диагностические эндпоинты:
 * - GET /api/admin/diagnostics/health       — агрегированный health-check
 * - GET /api/admin/diagnostics/crons        — список cron-задач + last-run
 * - POST /api/admin/diagnostics/crons/:name/trigger — запуск крон-задачи руками
 * - GET /api/admin/diagnostics/logs         — последние строки логов API-контейнера
 */

import express, { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { aggregateHealth } from "./health.service.js";
import { listCronEntries, triggerCron } from "./cron-registry.js";
import { logAdmin } from "../audit/audit.service.js";
import { getLogs } from "./log-buffer.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const diagnosticsAdminRouter = Router();
diagnosticsAdminRouter.use(requireAuth);
diagnosticsAdminRouter.use(requireAdminSection);

diagnosticsAdminRouter.get(
  "/health",
  asyncRoute(async (_req, res) => {
    const result = await aggregateHealth();
    return res.json(result);
  }),
);

diagnosticsAdminRouter.get(
  "/crons",
  asyncRoute(async (_req, res) => {
    return res.json({ items: listCronEntries() });
  }),
);

diagnosticsAdminRouter.post(
  "/crons/:name/trigger",
  asyncRoute(async (req, res) => {
    const result = await triggerCron(req.params.name);
    await logAdmin(req, "cron.trigger", { type: "cron", id: req.params.name }, { ok: result.ok, error: result.error });
    if (!result.ok) return res.status(400).json({ message: result.error });
    return res.json({ ok: true });
  }),
);

const logsQuerySchema = z.object({
  /** Сколько последних строк отдать (default 200, max 5000). */
  lines: z.coerce.number().int().min(1).max(5000).optional(),
  /** Регэкс для фильтрации (insensitive). */
  filter: z.string().max(200).optional(),
  /** Уровень логов: log | info | warn | error | debug. По умолчанию все. */
  level: z.enum(["log", "info", "warn", "error", "debug"]).optional(),
  /** Имя контейнера. Только api поддерживается (внутри-процессный буфер). */
  container: z.enum(["api"]).optional(),
});

diagnosticsAdminRouter.get(
  "/logs",
  asyncRoute(async (req, res) => {
    const parsed = logsQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });

    const result = getLogs({
      lines: parsed.data.lines,
      filter: parsed.data.filter,
      level: parsed.data.level,
    });

    if ("error" in result) {
      return res.status(400).json({ message: result.error });
    }

    // Формируем читаемый текст для UI (формат: ISO ts [level] text)
    const text = result.lines
      .map((l) => {
        const iso = new Date(l.ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
        const lvl = l.level.toUpperCase().padEnd(5, " ");
        return `${iso} [${lvl}] ${l.text}`;
      })
      .join("\n");

    return res.json({
      container: "api",
      lines: result.lines.length,
      text: text || "[no log entries yet — logs will appear as the API processes requests]",
      meta: { bufferSize: result.bufferSize, capacity: result.capacity },
    });
  }),
);
