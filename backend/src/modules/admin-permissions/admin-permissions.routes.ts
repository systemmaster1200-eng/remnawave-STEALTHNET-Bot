/**
 * Granular permissions for admins.
 *
 * Существующая модель: admins.allowedSections — массив строк-секций
 * (clients, tariffs, settings и т.п.). MANAGER может работать только в
 * своих секциях; ADMIN — везде.
 *
 * Эта надстройка добавляет ACTION-уровень: критические операции
 * (refund, debit_balance, logout_all, …) гейтятся отдельно. Хранятся
 * в том же поле allowedSections с префиксом `action:`, чтобы не делать
 * миграцию схемы.
 *
 * Endpoints:
 *   GET  /api/admin/admin-permissions/actions     — каталог доступных действий
 *   GET  /api/admin/admin-permissions/:adminId    — текущие actions у админа
 *   PUT  /api/admin/admin-permissions/:adminId    — заменить набор actions
 *
 * Только ADMIN может менять.
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth } from "../auth/middleware.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

interface ActionDef {
  key: string;        // "refund_payment"
  label: string;
  description: string;
  group: "payments" | "clients" | "security" | "operations";
  severity: "info" | "warn" | "critical";
}

export const ACTION_CATALOG: ActionDef[] = [
  // Payments
  { key: "refund_payment", label: "Возврат платежа", description: "POST /admin/payments/:id/refund — полный возврат денег + откат referral-credits", group: "payments", severity: "critical" },
  { key: "mark_payment_failed", label: "Отметить платёж как FAILED", description: "POST /admin/payments/:id/mark-failed — для зависших PENDING", group: "payments", severity: "warn" },
  { key: "retry_activation", label: "Повторить активацию", description: "POST /admin/payments/:id/retry-activation", group: "payments", severity: "info" },
  { key: "delete_payment", label: "Удалить платёж", description: "DELETE /admin/payments/:id (legacy)", group: "payments", severity: "critical" },

  // Clients
  { key: "bulk_block", label: "Блокировка клиентов (bulk)", description: "POST /admin/clients/bulk action=block", group: "clients", severity: "warn" },
  { key: "bulk_credit_balance", label: "Начисление баланса (bulk)", description: "POST /admin/clients/bulk action=credit_balance", group: "clients", severity: "critical" },
  { key: "bulk_debit_balance", label: "Списание баланса (bulk)", description: "POST /admin/clients/bulk action=debit_balance", group: "clients", severity: "critical" },
  { key: "bulk_reset_trial", label: "Сброс trial (bulk)", description: "POST /admin/clients/bulk action=reset_trial", group: "clients", severity: "warn" },
  // менеджерские права на устройства клиентов.
  { key: "change_device_limit", label: "Менять лимит устройств в подписках", description: "PATCH /admin/subscriptions/:subId/remna — поле hwidDeviceLimit. Менеджер без этого action получает 403 на смену лимита.", group: "clients", severity: "info" },
  { key: "delete_device", label: "Удалять устройства клиентов", description: "POST /admin/clients/:id/remna/devices/delete и POST /admin/subscriptions/:subId/remna/devices/delete", group: "clients", severity: "info" },
  // отчёт продаж только через баланс (для менеджеров-девочек).
  { key: "view_balance_sales", label: "Видеть отчёт продаж через баланс", description: "GET /admin/balance-sales — список платежей с provider=balance (продажи через начисление баланса вручную). Доступ к странице «Продажи через баланс» в админке.", group: "payments", severity: "info" },

  // Security
  { key: "logout_all_admins", label: "Logout всех админов", description: "POST /admin/security/logout-all — инвалидация всех токенов", group: "security", severity: "critical" },
  { key: "logout_specific_admin", label: "Logout конкретного админа", description: "POST /admin/security/logout-admin/:id", group: "security", severity: "warn" },

  // Operations
  { key: "tariffs_csv_import", label: "Импорт тарифов из CSV", description: "POST /admin/tariffs-csv/import", group: "operations", severity: "warn" },
  { key: "promo_bulk_generate", label: "Массовая генерация промокодов", description: "POST /admin/promo-codes/bulk-generate", group: "operations", severity: "warn" },
  { key: "trigger_cron", label: "Запуск cron вручную", description: "POST /admin/diagnostics/crons/:name/trigger", group: "operations", severity: "warn" },
  { key: "replay_webhook", label: "Replay входящих webhook'ов", description: "POST /admin/webhook-inbox/:id/replay", group: "operations", severity: "warn" },
];

export const ACTION_PREFIX = "action:";

export const adminPermissionsRouter = Router();
adminPermissionsRouter.use(requireAuth);

// Только ADMIN может смотреть/менять. Самопроверка вшита в каждый эндпоинт.

function isFullAdmin(req: express.Request): boolean {
  const ext = req as express.Request & { adminRole?: "ADMIN" | "MANAGER" };
  return ext.adminRole === "ADMIN";
}

adminPermissionsRouter.get(
  "/actions",
  asyncRoute(async (_req, res) => {
    return res.json({ actions: ACTION_CATALOG });
  }),
);

/**
 * парсит allowedSections либо как JSON массив
 * (новый формат, совместим с middleware и PATCH /admins/:id),
 * либо как CSV (legacy от старых записей PUT /admin-permissions).
 */
function parseAllowedItems(raw: string | null | undefined): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  try {
    const p = JSON.parse(s) as unknown;
    if (Array.isArray(p)) return p.filter((x): x is string => typeof x === "string");
  } catch {
    /* fall through */
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

adminPermissionsRouter.get(
  "/:adminId",
  asyncRoute(async (req, res) => {
    if (!isFullAdmin(req)) return res.status(403).json({ message: "Только полный ADMIN может просматривать permissions" });
    const admin = await prisma.admin.findUnique({
      where: { id: req.params.adminId },
      select: { id: true, email: true, role: true, allowedSections: true },
    });
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    const allowed = parseAllowedItems(admin.allowedSections);
    const sections = allowed.filter((s) => !s.startsWith(ACTION_PREFIX));
    const actions = allowed.filter((s) => s.startsWith(ACTION_PREFIX)).map((s) => s.slice(ACTION_PREFIX.length));

    return res.json({
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      sections,
      actions,
    });
  }),
);

const putSchema = z.object({
  actions: z.array(z.string().min(1).max(80)).max(100),
});

adminPermissionsRouter.put(
  "/:adminId",
  asyncRoute(async (req, res) => {
    if (!isFullAdmin(req)) return res.status(403).json({ message: "Только полный ADMIN может менять permissions" });
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

    // валидируем что все экшены — известные
    const validKeys = new Set(ACTION_CATALOG.map((a) => a.key));
    const unknown = parsed.data.actions.filter((a) => !validKeys.has(a));
    if (unknown.length > 0) {
      return res.status(400).json({ message: `Unknown actions: ${unknown.join(", ")}` });
    }

    const admin = await prisma.admin.findUnique({
      where: { id: req.params.adminId },
      select: { id: true, allowedSections: true, email: true },
    });
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    // сохраняем как JSON-массив (единый формат с PATCH /admins/:id
    // и middleware/requireAdminSection). Раньше тут писали CSV — это ломало секции, т.к. middleware
    // читает только JSON. Парсер `parseAllowedItems` принимает оба формата для обратной совместимости.
    const existing = parseAllowedItems(admin.allowedSections);
    const sectionsOnly = existing.filter((s) => !s.startsWith(ACTION_PREFIX));
    const prefixedActions = parsed.data.actions.map((a) => `${ACTION_PREFIX}${a}`);
    const merged = [...sectionsOnly, ...prefixedActions];

    await prisma.admin.update({
      where: { id: admin.id },
      data: { allowedSections: JSON.stringify(merged) },
    });

    await logAdmin(req, "admin_permissions.update", { type: "admin", id: admin.id }, {
      email: admin.email,
      actions: parsed.data.actions,
    });

    return res.json({ ok: true, actions: parsed.data.actions });
  }),
);
