/**
 * Массовый генератор промокодов.
 *
 * POST /api/admin/promo-codes/bulk-generate
 * Body: {
 *   count: number (1..1000),
 *   prefix?: string (макс. 12 символов; вставляется ПЕРЕД случайной частью),
 *   length?: number (длина случайной части; default 10, range 4..20),
 *   alphabet?: "ALPHA" | "ALPHANUM" | "NUM" (default ALPHANUM, без 0/O/1/I для читаемости),
 *   namePrefix?: string (для поля name, fallback = "Bulk N codes"),
 *   type: "DISCOUNT" | "FREE_DAYS",
 *
 *   // DISCOUNT-параметры (один из):
 *   discountPercent?: number (0..100),
 *   discountFixed?: number,
 *
 *   // FREE_DAYS-параметры (нужны все):
 *   squadUuid?: string,
 *   durationDays?: number,
 *   trafficLimitBytes?: number,
 *   deviceLimit?: number,
 *
 *   // Общие:
 *   maxUses?: number (default 1; 0 = unlimited),
 *   maxUsesPerClient?: number (default 1),
 *   expiresAt?: ISO string,
 * }
 *
 * Ответ: { generated: string[]; failed: { code: string; reason: string }[]; total: number }
 *
 * Логируется в admin_events как promo_codes.bulk_generate.
 */

import express, { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const promoBulkRouter = Router();
promoBulkRouter.use(requireAuth);
promoBulkRouter.use(requireAdminSection);

const schema = z.object({
  count: z.number().int().min(1).max(1000),
  prefix: z.string().max(12).optional(),
  length: z.number().int().min(4).max(20).optional(),
  alphabet: z.enum(["ALPHA", "ALPHANUM", "NUM"]).optional(),
  namePrefix: z.string().max(60).optional(),
  type: z.enum(["DISCOUNT", "FREE_DAYS"]),
  discountPercent: z.number().min(0).max(100).optional(),
  discountFixed: z.number().min(0).optional(),
  squadUuid: z.string().optional(),
  durationDays: z.number().int().min(1).max(3650).optional(),
  trafficLimitBytes: z.number().int().min(0).optional(),
  deviceLimit: z.number().int().min(0).optional(),
  maxUses: z.number().int().min(0).optional(),
  maxUsesPerClient: z.number().int().min(0).optional(),
  expiresAt: z.string().datetime().optional(),
});

const ALPHABETS = {
  // без 0/O/1/I/L для лёгкого набора в Telegram
  ALPHANUM: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
  ALPHA: "ABCDEFGHJKMNPQRSTUVWXYZ",
  NUM: "0123456789",
};

function generateCode(prefix: string, length: number, alphabet: string): string {
  const buf = randomBytes(length);
  let suffix = "";
  for (let i = 0; i < length; i++) {
    suffix += alphabet[buf[i] % alphabet.length];
  }
  return prefix + suffix;
}

promoBulkRouter.post(
  "/bulk-generate",
  asyncRoute(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
    const data = parsed.data;

    // Валидация по типу
    if (data.type === "DISCOUNT") {
      if (data.discountPercent === undefined && data.discountFixed === undefined) {
        return res.status(400).json({ message: "Для DISCOUNT нужен discountPercent или discountFixed" });
      }
    } else {
      if (!data.squadUuid || !data.durationDays) {
        return res.status(400).json({ message: "Для FREE_DAYS нужны squadUuid и durationDays" });
      }
    }

    const length = data.length ?? 10;
    const alphabet = ALPHABETS[data.alphabet ?? "ALPHANUM"];
    const prefix = data.prefix ?? "";
    const maxUses = data.maxUses ?? 1;
    const maxUsesPerClient = data.maxUsesPerClient ?? 1;
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    const namePrefix = data.namePrefix ?? `Bulk ${data.count} codes ${new Date().toISOString().slice(0, 10)}`;

    const generated: string[] = [];
    const failed: { code: string; reason: string }[] = [];

    // Up to 5 attempts per code in case of unique-collision
    for (let i = 0; i < data.count; i++) {
      let attempts = 0;
      let code = "";
      let inserted = false;

      while (attempts < 5 && !inserted) {
        attempts += 1;
        code = generateCode(prefix, length, alphabet);

        try {
          await prisma.promoCode.create({
            data: {
              code,
              name: `${namePrefix} #${i + 1}`,
              type: data.type,
              discountPercent: data.type === "DISCOUNT" ? data.discountPercent ?? null : null,
              discountFixed: data.type === "DISCOUNT" ? data.discountFixed ?? null : null,
              squadUuid: data.type === "FREE_DAYS" ? data.squadUuid ?? null : null,
              trafficLimitBytes: data.type === "FREE_DAYS" && data.trafficLimitBytes !== undefined ? BigInt(data.trafficLimitBytes) : null,
              deviceLimit: data.type === "FREE_DAYS" ? data.deviceLimit ?? null : null,
              durationDays: data.type === "FREE_DAYS" ? data.durationDays ?? null : null,
              maxUses,
              maxUsesPerClient,
              isActive: true,
              expiresAt,
            },
          });
          inserted = true;
          generated.push(code);
        } catch (e) {
          // Если P2002 — unique violation, попробуем ещё раз с новым кодом.
          // Любая другая ошибка — фиксируем как failed и идём дальше.
          if (e instanceof Error && /Unique constraint/i.test(e.message)) {
            continue;
          }
          failed.push({ code, reason: e instanceof Error ? e.message : String(e) });
          break;
        }
      }
      if (!inserted && attempts >= 5) {
        failed.push({ code, reason: "Не удалось сгенерировать уникальный код за 5 попыток" });
      }
    }

    await logAdmin(req, "promo_codes.bulk_generate", { type: "system", id: "promo_codes" }, {
      requested: data.count,
      generated: generated.length,
      failed: failed.length,
      type: data.type,
      prefix,
      length,
    });

    return res.json({
      total: data.count,
      generated,
      failed,
    });
  }),
);
