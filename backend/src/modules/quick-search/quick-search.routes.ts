/**
 * Cmd+K quick search: поиск по clients / payments / tariffs / contests / promo.
 * Запрос: GET /api/admin/quick-search?q=text
 * Возвращает группы результатов с deeplink-URL'ами для фронта.
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const quickSearchAdminRouter = Router();
quickSearchAdminRouter.use(requireAuth);
quickSearchAdminRouter.use(requireAdminSection);

const querySchema = z.object({
  q: z.string().min(1).max(200),
});

interface SearchResult {
  group: "clients" | "payments" | "tariffs" | "contests" | "promo_groups" | "promo_codes";
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  /** Релевантность — для сортировки между группами. */
  score: number;
}

quickSearchAdminRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.json({ items: [] });
    const q = parsed.data.q.trim();
    if (!q) return res.json({ items: [] });

    const items: SearchResult[] = [];

    // 1. Clients — email, telegramId, telegramUsername (без @), referralCode.
    const clients = await prisma.client.findMany({
      where: {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { telegramId: { contains: q } },
          { telegramUsername: { contains: q.replace(/^@/, ""), mode: "insensitive" } },
          { referralCode: { contains: q, mode: "insensitive" } },
          { id: q.length >= 8 ? q : undefined },
        ],
      },
      select: {
        id: true, email: true, telegramId: true, telegramUsername: true, balance: true, referralCode: true, isBlocked: true,
      },
      take: 8,
      orderBy: { createdAt: "desc" },
    });
    for (const c of clients) {
      const title = c.email ?? (c.telegramUsername ? `@${c.telegramUsername}` : null) ?? c.telegramId ?? c.id.slice(0, 8);
      const subtitle = [
        c.balance != null ? `${c.balance.toFixed(2)} ₽` : null,
        c.referralCode ? `ref ${c.referralCode}` : null,
        c.isBlocked ? "BLOCKED" : null,
      ].filter(Boolean).join(" · ");
      items.push({
        group: "clients",
        id: c.id,
        title,
        subtitle,
        url: `/admin/clients?q=${encodeURIComponent(c.id)}`,
        score: c.email?.toLowerCase() === q.toLowerCase() ? 100 : 50,
      });
    }

    // 2. Payments — id, orderId, externalId.
    const payments = await prisma.payment.findMany({
      where: {
        OR: [
          { id: { contains: q, mode: "insensitive" } },
          { orderId: { contains: q, mode: "insensitive" } },
          { externalId: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, orderId: true, externalId: true, amount: true, currency: true, status: true, provider: true, createdAt: true, clientId: true },
      take: 6,
      orderBy: { createdAt: "desc" },
    });
    for (const p of payments) {
      const title = `${p.provider} · ${p.amount.toFixed(2)} ${p.currency}`;
      const subtitle = `${p.status} · order ${p.orderId.slice(0, 16)}${p.orderId.length > 16 ? "…" : ""} · ${new Date(p.createdAt).toLocaleDateString("ru")}`;
      items.push({
        group: "payments",
        id: p.id,
        title,
        subtitle,
        url: `/admin/sales-report?paymentId=${encodeURIComponent(p.id)}`,
        score: p.id === q || p.orderId === q || p.externalId === q ? 90 : 40,
      });
    }

    // 3. Tariffs.
    const tariffs = await prisma.tariff.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      select: { id: true, name: true, price: true, currency: true, durationDays: true },
      take: 5,
    });
    for (const t of tariffs) {
      items.push({
        group: "tariffs",
        id: t.id,
        title: t.name,
        subtitle: `${t.price.toFixed(2)} ${t.currency} · ${t.durationDays} дн.`,
        url: `/admin/tariffs?focus=${encodeURIComponent(t.id)}`,
        score: 30,
      });
    }

    // 4. Contests.
    const contests = await prisma.contest.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      select: { id: true, name: true, status: true, startAt: true, endAt: true },
      take: 5,
    });
    for (const c of contests) {
      items.push({
        group: "contests",
        id: c.id,
        title: c.name,
        subtitle: `${c.status} · ${new Date(c.startAt).toLocaleDateString("ru")} → ${new Date(c.endAt).toLocaleDateString("ru")}`,
        url: `/admin/contests?focus=${encodeURIComponent(c.id)}`,
        score: 20,
      });
    }

    // 5. Promo groups (по code).
    const promoGroups = await prisma.promoGroup.findMany({
      where: {
        OR: [
          { code: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, code: true, name: true, isActive: true, maxActivations: true },
      take: 5,
    });
    for (const g of promoGroups) {
      items.push({
        group: "promo_groups",
        id: g.id,
        title: g.name,
        subtitle: `code ${g.code} · max ${g.maxActivations || "∞"}${g.isActive ? "" : " · OFF"}`,
        url: `/admin/promo?focus=${encodeURIComponent(g.id)}`,
        score: 25,
      });
    }

    // 6. Promo codes (по code). Type = DISCOUNT | FREE_DAYS.
    const promoCodes = await prisma.promoCode.findMany({
      where: { code: { contains: q, mode: "insensitive" } },
      select: { id: true, code: true, type: true, isActive: true, discountPercent: true, discountFixed: true, durationDays: true },
      take: 5,
    });
    for (const c of promoCodes) {
      let benefit = "";
      if (c.discountPercent) benefit = `-${c.discountPercent}%`;
      else if (c.discountFixed) benefit = `-${c.discountFixed} ₽`;
      else if (c.durationDays) benefit = `+${c.durationDays} дн.`;
      items.push({
        group: "promo_codes",
        id: c.id,
        title: c.code,
        subtitle: `${c.type} · ${benefit}${c.isActive ? "" : " · OFF"}`,
        url: `/admin/promo-codes?focus=${encodeURIComponent(c.id)}`,
        score: 25,
      });
    }

    items.sort((a, b) => b.score - a.score);
    return res.json({ items });
  }),
);
