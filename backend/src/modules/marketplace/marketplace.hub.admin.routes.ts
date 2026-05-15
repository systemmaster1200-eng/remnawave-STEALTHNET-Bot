/**
 * Админка хаба: список инсталляций, бан/разбан, очередь жалоб, CRUD категорий,
 * override-удаление чужих листингов. Подключается под `/api/admin/marketplace/hub`,
 * только когда роль = hub (см. подключение в app.ts).
 *
 * Аутентификация — обычный admin токен (требуется в родительском роутере).
 */
import express, { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

export const marketplaceHubAdminRouter = Router();

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/* ─────────────── Инсталляции ─────────────── */

marketplaceHubAdminRouter.get(
  "/installations",
  asyncRoute(async (req, res) => {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const where: Prisma.MarketplaceInstallationWhereInput = q
      ? {
          OR: [
            { domain: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
            { contactUsername: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};
    const items = await prisma.marketplaceInstallation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return res.json({
      items: items.map((i) => ({
        id: i.id,
        domain: i.domain,
        displayName: i.displayName,
        contactUsername: i.contactUsername,
        contactTelegramId: i.contactTelegramId,
        logoUrl: i.logoUrl,
        description: i.description,
        isBanned: i.isBanned,
        banReason: i.banReason,
        totalListings: i.totalListings,
        apiKeyPrefix: i.apiKeyPrefix,
        lastSeenAt: i.lastSeenAt,
        lastIp: i.lastIp,
        createdAt: i.createdAt,
      })),
    });
  })
);

const banSchema = z.object({
  isBanned: z.boolean(),
  reason: z.string().max(2000).optional(),
});
marketplaceHubAdminRouter.patch(
  "/installations/:id/ban",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const parsed = banSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    const inst = await prisma.marketplaceInstallation.findUnique({ where: { id } });
    if (!inst) return res.status(404).json({ message: "Not found" });
    const updated = await prisma.marketplaceInstallation.update({
      where: { id },
      data: { isBanned: parsed.data.isBanned, banReason: parsed.data.isBanned ? parsed.data.reason ?? null : null },
    });
    return res.json({ id: updated.id, isBanned: updated.isBanned, banReason: updated.banReason });
  })
);

marketplaceHubAdminRouter.delete(
  "/installations/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    await prisma.marketplaceInstallation.delete({ where: { id } }).catch(() => undefined);
    return res.json({ ok: true });
  })
);

/* ─────────────── Жалобы ─────────────── */

marketplaceHubAdminRouter.get(
  "/reports",
  asyncRoute(async (req, res) => {
    const status = String(req.query.status ?? "open");
    const where: Prisma.MarketplaceReportWhereInput = ["open", "resolved", "dismissed"].includes(status)
      ? { status }
      : {};
    const items = await prisma.marketplaceReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        listing: { include: { installation: true, category: true } },
        reporter: true,
      },
      take: 200,
    });
    return res.json({
      items: items.map((r) => ({
        id: r.id,
        listingId: r.listingId,
        reason: r.reason,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        listing: {
          id: r.listing.id,
          title: r.listing.title,
          status: r.listing.status,
          reportsCount: r.listing.reportsCount,
          category: { slug: r.listing.category.slug, labelRu: r.listing.category.labelRu, labelEn: r.listing.category.labelEn },
          installation: {
            id: r.listing.installation.id,
            domain: r.listing.installation.domain,
            displayName: r.listing.installation.displayName,
            contactUsername: r.listing.installation.contactUsername,
            isBanned: r.listing.installation.isBanned,
          },
        },
        reporter: {
          id: r.reporter.id,
          domain: r.reporter.domain,
          displayName: r.reporter.displayName,
        },
      })),
    });
  })
);

const resolveSchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
  /** Если true — листинг возвращается в активный статус (auto_hidden → active). */
  unhideListing: z.boolean().optional(),
});

marketplaceHubAdminRouter.patch(
  "/reports/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    const report = await prisma.marketplaceReport.findUnique({ where: { id } });
    if (!report) return res.status(404).json({ message: "Not found" });
    await prisma.marketplaceReport.update({
      where: { id },
      data: { status: parsed.data.status, resolvedAt: new Date() },
    });
    if (parsed.data.unhideListing) {
      const open = await prisma.marketplaceReport.count({ where: { listingId: report.listingId, status: "open" } });
      await prisma.marketplaceListing.update({
        where: { id: report.listingId },
        data: { status: "active", reportsCount: open },
      }).catch(() => undefined);
    }
    return res.json({ ok: true });
  })
);

/* ─────────────── Override-удаление листинга ─────────────── */

marketplaceHubAdminRouter.delete(
  "/listings/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const existing = await prisma.marketplaceListing.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Not found" });
    await prisma.marketplaceListing.delete({ where: { id } });
    await prisma.marketplaceInstallation.update({
      where: { id: existing.installationId },
      data: { totalListings: { decrement: 1 } },
    }).catch(() => undefined);
    return res.json({ ok: true });
  })
);

/* ─────────────── CRUD категорий ─────────────── */

marketplaceHubAdminRouter.get(
  "/categories",
  asyncRoute(async (_req, res) => {
    const items = await prisma.marketplaceCategory.findMany({ orderBy: { sortOrder: "asc" } });
    return res.json({ items });
  })
);

const categorySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/, "lowercase, digits, dashes"),
  labelRu: z.string().min(1).max(120),
  labelEn: z.string().min(1).max(120),
  icon: z.string().max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isEnabled: z.boolean().default(true),
});

marketplaceHubAdminRouter.post(
  "/categories",
  asyncRoute(async (req, res) => {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    try {
      const created = await prisma.marketplaceCategory.create({ data: { ...parsed.data, icon: parsed.data.icon ?? null } });
      return res.status(201).json(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res.status(409).json({ message: "Slug already exists" });
      }
      throw e;
    }
  })
);

marketplaceHubAdminRouter.patch(
  "/categories/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const parsed = categorySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    try {
      const updated = await prisma.marketplaceCategory.update({ where: { id }, data: parsed.data });
      return res.json(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return res.status(404).json({ message: "Not found" });
      }
      throw e;
    }
  })
);

marketplaceHubAdminRouter.delete(
  "/categories/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const used = await prisma.marketplaceListing.count({ where: { categoryId: id } });
    if (used > 0) return res.status(409).json({ message: `Category has ${used} listing(s)` });
    await prisma.marketplaceCategory.delete({ where: { id } }).catch(() => undefined);
    return res.json({ ok: true });
  })
);
