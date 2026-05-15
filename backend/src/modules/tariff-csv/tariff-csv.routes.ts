/**
 * CSV-импорт/экспорт тарифов.
 *
 * GET  /api/admin/tariffs-csv/export   — отдаёт CSV всех тарифов (text/csv)
 * POST /api/admin/tariffs-csv/import   — принимает CSV в body (text/csv ИЛИ JSON {csv: "..."}),
 *                                         + опц. флаг ?dryRun=1 для preview без записи
 *
 * Формат CSV (UTF-8, разделитель `,`, escape по RFC4180 — кавычки удваиваются если внутри значения):
 *
 *   id,category_id,name,description,duration_days,price,currency,included_devices,
 *   price_per_extra_device,max_extra_devices,traffic_limit_bytes,traffic_reset_mode,sort_order
 *
 * При импорте:
 *   - id пустой → CREATE новый тариф
 *   - id существует → UPDATE (только эти поля; price_options, internal_squad_uuids не трогаем)
 *   - id указан, но не найден → ошибка
 *   - category_id не найден → ошибка
 *   - traffic_limit_bytes = "" или 0 → null (безлимит)
 *
 * Возвращает: { created, updated, skipped, errors: [{row, error}], previewRows? }
 *
 * Логирование в admin_events: tariffs.csv_import.
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const tariffCsvRouter = Router();
tariffCsvRouter.use(requireAuth);
tariffCsvRouter.use(requireAdminSection);

// ── CSV utilities ─────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuote = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): string[][] {
  // нормализуем переводы строк, поддерживая многострочные значения внутри кавычек
  const rows: string[][] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '""'; i++; } else { cur += ch; inQuote = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') { cur += ch; inQuote = true; }
      else if (ch === "\n") { rows.push(parseCsvLine(cur)); cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur.length > 0) rows.push(parseCsvLine(cur));
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// ── Export ────────────────────────────────────────────────────────────────

const HEADERS = [
  "id", "category_id", "name", "description",
  "duration_days", "price", "currency",
  "included_devices", "price_per_extra_device", "max_extra_devices",
  "traffic_limit_bytes", "traffic_reset_mode", "sort_order",
];

tariffCsvRouter.get(
  "/export",
  asyncRoute(async (_req, res) => {
    const tariffs = await prisma.tariff.findMany({
      orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
    });

    const lines: string[] = [HEADERS.join(",")];
    for (const t of tariffs) {
      const row = [
        t.id,
        t.categoryId,
        t.name,
        t.description ?? "",
        t.durationDays,
        t.price,
        t.currency,
        t.includedDevices,
        t.pricePerExtraDevice,
        t.maxExtraDevices,
        t.trafficLimitBytes !== null && t.trafficLimitBytes !== undefined ? t.trafficLimitBytes.toString() : "",
        t.trafficResetMode,
        t.sortOrder,
      ];
      lines.push(row.map(csvEscape).join(","));
    }

    const csv = lines.join("\n") + "\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tariffs-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  }),
);

// ── Import ────────────────────────────────────────────────────────────────

const importBodySchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});

interface ImportRow {
  id?: string;
  category_id: string;
  name: string;
  description: string;
  duration_days: number;
  price: number;
  currency: string;
  included_devices: number;
  price_per_extra_device: number;
  max_extra_devices: number;
  traffic_limit_bytes: bigint | null;
  traffic_reset_mode: string;
  sort_order: number;
}

function parseRow(headers: string[], row: string[], lineNum: number): { ok: true; data: ImportRow } | { ok: false; error: string } {
  if (row.length !== headers.length) {
    return { ok: false, error: `строка ${lineNum}: ожидалось ${headers.length} столбцов, получено ${row.length}` };
  }
  const get = (k: string) => row[headers.indexOf(k)] ?? "";
  const num = (k: string, opt = false) => {
    const v = get(k).trim();
    if (v === "" && opt) return 0;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${k}="${v}" — не число`);
    return n;
  };
  try {
    const trafficRaw = get("traffic_limit_bytes").trim();
    const traffic = trafficRaw === "" ? null : BigInt(trafficRaw);
    return {
      ok: true,
      data: {
        id: get("id").trim() || undefined,
        category_id: get("category_id").trim(),
        name: get("name").trim(),
        description: get("description"),
        duration_days: num("duration_days"),
        price: num("price"),
        currency: get("currency").trim() || "usd",
        included_devices: num("included_devices", true),
        price_per_extra_device: num("price_per_extra_device", true),
        max_extra_devices: num("max_extra_devices", true),
        traffic_limit_bytes: traffic,
        traffic_reset_mode: get("traffic_reset_mode").trim() || "no_reset",
        sort_order: num("sort_order", true),
      },
    };
  } catch (e) {
    return { ok: false, error: `строка ${lineNum}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

tariffCsvRouter.post(
  "/import",
  asyncRoute(async (req, res) => {
    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";

    let csvText: string;
    if (typeof req.body === "string") {
      csvText = req.body;
    } else if (req.body && typeof req.body === "object" && typeof (req.body as { csv?: string }).csv === "string") {
      const parsed = importBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
      csvText = parsed.data.csv;
    } else {
      return res.status(400).json({ message: "Body must be CSV text or { csv: '...' }" });
    }

    const rows = parseCsv(csvText);
    if (rows.length < 2) return res.status(400).json({ message: "CSV должен содержать заголовок и хотя бы одну строку данных" });

    const headers = rows[0].map((h) => h.trim());
    const missing = HEADERS.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      return res.status(400).json({ message: `Не хватает столбцов: ${missing.join(", ")}` });
    }

    // Parse all rows first
    const parsedRows: ImportRow[] = [];
    const errors: { row: number; error: string }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = parseRow(headers, rows[i], i + 1);
      if (r.ok) parsedRows.push(r.data);
      else errors.push({ row: i + 1, error: r.error });
    }

    // Validate referential integrity
    const categoryIds = [...new Set(parsedRows.map((r) => r.category_id))];
    const knownCategories = await prisma.tariffCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true } });
    const knownCategoryIds = new Set(knownCategories.map((c) => c.id));
    for (let i = 0; i < parsedRows.length; i++) {
      if (!knownCategoryIds.has(parsedRows[i].category_id)) {
        errors.push({ row: i + 2, error: `category_id="${parsedRows[i].category_id}" не найден` });
      }
    }

    const idsToCheck = parsedRows.filter((r) => r.id).map((r) => r.id!);
    const knownIds = idsToCheck.length
      ? new Set((await prisma.tariff.findMany({ where: { id: { in: idsToCheck } }, select: { id: true } })).map((t) => t.id))
      : new Set<string>();
    for (let i = 0; i < parsedRows.length; i++) {
      if (parsedRows[i].id && !knownIds.has(parsedRows[i].id!)) {
        errors.push({ row: i + 2, error: `id="${parsedRows[i].id}" указан, но тарифа с таким id нет` });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: "Есть ошибки в CSV — импорт прерван", errors });
    }

    if (dryRun) {
      return res.json({
        dryRun: true,
        total: parsedRows.length,
        wouldCreate: parsedRows.filter((r) => !r.id).length,
        wouldUpdate: parsedRows.filter((r) => r.id).length,
        previewRows: parsedRows.slice(0, 50).map((r) => ({
          action: r.id ? "update" : "create",
          id: r.id ?? "(new)",
          name: r.name,
          price: `${r.price} ${r.currency}`,
          duration_days: r.duration_days,
          included_devices: r.included_devices,
          category_id: r.category_id,
        })),
      });
    }

    let created = 0;
    let updated = 0;
    const writeErrors: { row: number; error: string }[] = [];

    for (let i = 0; i < parsedRows.length; i++) {
      const r = parsedRows[i];
      try {
        if (r.id) {
          await prisma.tariff.update({
            where: { id: r.id },
            data: {
              categoryId: r.category_id,
              name: r.name,
              description: r.description || null,
              durationDays: r.duration_days,
              price: r.price,
              currency: r.currency,
              includedDevices: r.included_devices,
              pricePerExtraDevice: r.price_per_extra_device,
              maxExtraDevices: r.max_extra_devices,
              trafficLimitBytes: r.traffic_limit_bytes,
              trafficResetMode: r.traffic_reset_mode,
              sortOrder: r.sort_order,
            },
          });
          updated += 1;
        } else {
          await prisma.tariff.create({
            data: {
              categoryId: r.category_id,
              name: r.name,
              description: r.description || null,
              durationDays: r.duration_days,
              price: r.price,
              currency: r.currency,
              includedDevices: r.included_devices,
              pricePerExtraDevice: r.price_per_extra_device,
              maxExtraDevices: r.max_extra_devices,
              trafficLimitBytes: r.traffic_limit_bytes,
              trafficResetMode: r.traffic_reset_mode,
              sortOrder: r.sort_order,
              internalSquadUuids: [],
            },
          });
          created += 1;
        }
      } catch (e) {
        writeErrors.push({ row: i + 2, error: e instanceof Error ? e.message : String(e) });
      }
    }

    await logAdmin(req, "tariffs.csv_import", { type: "system", id: "tariffs" }, {
      total: parsedRows.length,
      created,
      updated,
      errors: writeErrors.length,
    });

    return res.json({
      dryRun: false,
      total: parsedRows.length,
      created,
      updated,
      errors: writeErrors,
    });
  }),
);
