/**
 * Хаб-эндпоинты маркетплейса. Подключаются только когда роль = hub.
 * Аутентификация — по `X-Marketplace-Key` (для CRUD/heartbeat/reports).
 * Публичные GET (категории, листинги) — без ключа, но с rate-limit.
 */
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import {
  ALLOWED_CURRENCIES,
  ALLOWED_PRICE_UNITS,
  ALLOWED_LISTING_STATUSES,
  ALLOWED_REPORT_REASONS,
  generateApiKey,
  normaliseDomain,
  normaliseUsername,
  safeIp,
} from "./marketplace.shared.js";
import {
  MARKETPLACE_AUTO_HIDE_REPORTS_THRESHOLD,
  MARKETPLACE_MAX_LISTINGS_PER_INSTALLATION,
} from "./marketplace.constants.js";
import { requireInstallation, type ReqWithInstallation } from "./marketplace.hub.middleware.js";

export const marketplaceHubRouter = Router();

// Лимиты
const dev = process.env.NODE_ENV === "development";
const browseLimiter = rateLimit({ windowMs: 60_000, max: dev ? 1000 : 120, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60_000, max: dev ? 1000 : 30, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, max: dev ? 200 : 10, standardHeaders: true, legacyHeaders: false });

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/* ─────────────── Регистрация инсталляции ─────────────── */

const registerSchema = z.object({
  domain: z.string().min(3).max(2000),
  contactUsername: z.string().min(3).max(64),
  displayName: z.string().max(200).optional(),
  logoUrl: z.string().url().max(2000).optional(),
  description: z.string().max(4000).optional(),
});

marketplaceHubRouter.post(
  "/registry/register",
  registerLimiter,
  asyncRoute(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    }
    const domain = normaliseDomain(parsed.data.domain);
    if (!domain) return res.status(400).json({ message: "Invalid domain" });
    const contactUsername = normaliseUsername(parsed.data.contactUsername);
    if (!contactUsername) return res.status(400).json({ message: "Invalid Telegram username" });

    const existing = await prisma.marketplaceInstallation.findUnique({ where: { domain } });
    if (existing) {
      return res.status(409).json({
        message: "Installation already registered. Use existing API key or contact hub admin to reset.",
        installationId: existing.id,
        domain: existing.domain,
      });
    }

    const key = generateApiKey();
    const inst = await prisma.marketplaceInstallation.create({
      data: {
        apiKeyHash: key.hash,
        apiKeyPrefix: key.prefix,
        domain,
        contactUsername,
        displayName: parsed.data.displayName ?? null,
        logoUrl: parsed.data.logoUrl ?? null,
        description: parsed.data.description ?? null,
        lastIp: safeIp(req),
      },
    });

    return res.json({
      installationId: inst.id,
      domain: inst.domain,
      apiKey: key.plain, // показывается ровно один раз
      contactUsername: inst.contactUsername,
    });
  })
);

/* ─────────────── Heartbeat ─────────────── */

const heartbeatSchema = z.object({
  contactUsername: z.string().max(64).optional(),
  displayName: z.string().max(200).nullable().optional(),
  logoUrl: z.string().url().max(2000).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  version: z.string().max(64).optional(),
});

marketplaceHubRouter.post(
  "/heartbeat",
  browseLimiter,
  requireInstallation,
  asyncRoute(async (req, res) => {
    const inst = (req as ReqWithInstallation).installation;
    const parsed = heartbeatSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });

    const data: Prisma.MarketplaceInstallationUpdateInput = { lastSeenAt: new Date() };
    if (parsed.data.contactUsername !== undefined) {
      const u = normaliseUsername(parsed.data.contactUsername);
      if (!u) return res.status(400).json({ message: "Invalid Telegram username" });
      data.contactUsername = u;
    }
    if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
    if (parsed.data.logoUrl !== undefined) data.logoUrl = parsed.data.logoUrl;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;

    const updated = await prisma.marketplaceInstallation.update({ where: { id: inst.id }, data });
    return res.json({
      installationId: updated.id,
      domain: updated.domain,
      contactUsername: updated.contactUsername,
      displayName: updated.displayName,
      logoUrl: updated.logoUrl,
      description: updated.description,
    });
  })
);

/* ─────────────── Категории (публично) ─────────────── */

marketplaceHubRouter.get(
  "/categories",
  browseLimiter,
  asyncRoute(async (_req, res) => {
    const list = await prisma.marketplaceCategory.findMany({
      where: { isEnabled: true },
      orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }],
    });
    return res.json({ items: list });
  })
);

/* ─────────────── Каталог листингов (публично) ─────────────── */

const listQuerySchema = z.object({
  category: z.string().max(64).optional(),
  country: z.string().max(8).optional(),
  q: z.string().max(120).optional(),
  currency: z.enum(ALLOWED_CURRENCIES).optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(["new", "cheap", "expensive"]).default("new"),
  installationId: z.string().max(64).optional(),
});

marketplaceHubRouter.get(
  "/listings",
  browseLimiter,
  asyncRoute(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    const q = parsed.data;
    const where: Prisma.MarketplaceListingWhereInput = {
      status: "active",
      installation: { isBanned: false },
    };
    if (q.category) {
      const cat = await prisma.marketplaceCategory.findUnique({ where: { slug: q.category } });
      if (!cat) return res.json({ items: [], total: 0, page: q.page, limit: q.limit });
      where.categoryId = cat.id;
    }
    if (q.country) where.country = q.country.toUpperCase();
    if (q.currency) where.currency = q.currency;
    if (q.installationId) where.installationId = q.installationId;
    if (q.priceMin != null || q.priceMax != null) {
      where.priceCents = {
        ...(q.priceMin != null ? { gte: q.priceMin } : {}),
        ...(q.priceMax != null ? { lte: q.priceMax } : {}),
      };
    }
    if (q.q) {
      where.OR = [
        { title: { contains: q.q, mode: "insensitive" } },
        { description: { contains: q.q, mode: "insensitive" } },
        { tags: { has: q.q.toLowerCase() } },
      ];
    }

    const orderBy: Prisma.MarketplaceListingOrderByWithRelationInput =
      q.sort === "cheap" ? { priceCents: "asc" } : q.sort === "expensive" ? { priceCents: "desc" } : { createdAt: "desc" };

    const [items, total] = await Promise.all([
      prisma.marketplaceListing.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { category: true, installation: { select: publicInstallationSelect } },
      }),
      prisma.marketplaceListing.count({ where }),
    ]);
    return res.json({ items: items.map(serializeListing), total, page: q.page, limit: q.limit });
  })
);

// ВАЖНО: `domain` НЕ включаем в публичный select — это адрес панели продавца,
// и его не должны видеть другие админы. Связь только через Telegram username.
const publicInstallationSelect = {
  id: true,
  displayName: true,
  contactUsername: true,
  logoUrl: true,
  totalListings: true,
  createdAt: true,
} satisfies Prisma.MarketplaceInstallationSelect;

function serializeListing(l: Prisma.MarketplaceListingGetPayload<{
  include: { category: true; installation: { select: typeof publicInstallationSelect } };
}>) {
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    priceCents: l.priceCents,
    currency: l.currency,
    priceUnit: l.priceUnit,
    country: l.country,
    tags: l.tags,
    coverImageUrl: l.coverImageUrl,
    gallery: parseGallery(l.galleryJson),
    status: l.status,
    views: l.views,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    category: { id: l.category.id, slug: l.category.slug, labelRu: l.category.labelRu, labelEn: l.category.labelEn, icon: l.category.icon },
    seller: {
      installationId: l.installation.id,
      displayName: l.installation.displayName,
      contactUsername: l.installation.contactUsername,
      contactUrl: `https://t.me/${l.installation.contactUsername}`,
      logoUrl: l.installation.logoUrl,
      memberSince: l.installation.createdAt,
    },
  };
}

function parseGallery(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((u): u is string => typeof u === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

marketplaceHubRouter.get(
  "/listings/:id",
  browseLimiter,
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const l = await prisma.marketplaceListing.findUnique({
      where: { id },
      include: { category: true, installation: { select: publicInstallationSelect } },
    });
    if (!l || l.installation == null) return res.status(404).json({ message: "Not found" });
    if (l.status !== "active") return res.status(404).json({ message: "Not found" });
    return res.json(serializeListing(l));
  })
);

// Дебаунс по IP/listing 1 раз в 30 минут.
const VIEW_DEBOUNCE_MS = 30 * 60 * 1000;
const viewSeen = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of viewSeen) if (now - t > VIEW_DEBOUNCE_MS * 2) viewSeen.delete(k);
}, 10 * 60 * 1000).unref?.();

marketplaceHubRouter.post(
  "/listings/:id/view",
  browseLimiter,
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const ip = safeIp(req);
    const key = `${id}|${ip}`;
    const last = viewSeen.get(key) ?? 0;
    if (Date.now() - last < VIEW_DEBOUNCE_MS) return res.json({ ok: true, deduped: true });
    viewSeen.set(key, Date.now());
    await prisma.marketplaceListing.update({ where: { id }, data: { views: { increment: 1 } } }).catch(() => undefined);
    return res.json({ ok: true });
  })
);

/* ─────────────── Мои листинги (auth) ─────────────── */

const upsertSchema = z.object({
  categoryId: z.string().min(1).max(64),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(4000),
  priceCents: z.number().int().min(0).max(1_000_000_00),
  currency: z.enum(ALLOWED_CURRENCIES),
  priceUnit: z.enum(ALLOWED_PRICE_UNITS).default("one_time"),
  country: z.string().max(8).nullable().optional(),
  tags: z.array(z.string().min(1).max(32)).max(12).default([]),
  coverImageUrl: z.string().url().max(2000).nullable().optional(),
  gallery: z.array(z.string().url().max(2000)).max(8).default([]),
});

marketplaceHubRouter.get(
  "/my/listings",
  browseLimiter,
  requireInstallation,
  asyncRoute(async (req, res) => {
    const inst = (req as ReqWithInstallation).installation;
    const items = await prisma.marketplaceListing.findMany({
      where: { installationId: inst.id },
      orderBy: { createdAt: "desc" },
      include: { category: true, installation: { select: publicInstallationSelect } },
    });
    return res.json({ items: items.map(serializeListing) });
  })
);

marketplaceHubRouter.post(
  "/listings",
  writeLimiter,
  requireInstallation,
  asyncRoute(async (req, res) => {
    const inst = (req as ReqWithInstallation).installation;
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });

    const cat = await prisma.marketplaceCategory.findUnique({ where: { id: parsed.data.categoryId } });
    if (!cat || !cat.isEnabled) return res.status(400).json({ message: "Unknown category" });

    const active = await prisma.marketplaceListing.count({ where: { installationId: inst.id, status: { not: "archived" } } });
    if (active >= MARKETPLACE_MAX_LISTINGS_PER_INSTALLATION) {
      return res.status(429).json({ message: `Listing limit reached (${MARKETPLACE_MAX_LISTINGS_PER_INSTALLATION}). Archive old ones first.` });
    }

    const created = await prisma.marketplaceListing.create({
      data: {
        installationId: inst.id,
        categoryId: cat.id,
        title: parsed.data.title.trim(),
        description: parsed.data.description.trim(),
        priceCents: parsed.data.priceCents,
        currency: parsed.data.currency,
        priceUnit: parsed.data.priceUnit,
        country: parsed.data.country ? parsed.data.country.toUpperCase().slice(0, 8) : null,
        tags: parsed.data.tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
        coverImageUrl: parsed.data.coverImageUrl ?? null,
        galleryJson: JSON.stringify(parsed.data.gallery ?? []),
      },
      include: { category: true, installation: { select: publicInstallationSelect } },
    });
    await prisma.marketplaceInstallation.update({
      where: { id: inst.id },
      data: { totalListings: { increment: 1 } },
    });
    return res.status(201).json(serializeListing(created));
  })
);

const patchSchema = upsertSchema.partial().extend({
  status: z.enum(ALLOWED_LISTING_STATUSES).optional(),
});

marketplaceHubRouter.patch(
  "/listings/:id",
  writeLimiter,
  requireInstallation,
  asyncRoute(async (req, res) => {
    const inst = (req as ReqWithInstallation).installation;
    const id = String(req.params.id ?? "");
    const existing = await prisma.marketplaceListing.findUnique({ where: { id } });
    if (!existing || existing.installationId !== inst.id) return res.status(404).json({ message: "Not found" });

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });

    const data: Prisma.MarketplaceListingUpdateInput = {};
    if (parsed.data.categoryId) {
      const cat = await prisma.marketplaceCategory.findUnique({ where: { id: parsed.data.categoryId } });
      if (!cat || !cat.isEnabled) return res.status(400).json({ message: "Unknown category" });
      data.category = { connect: { id: cat.id } };
    }
    if (parsed.data.title !== undefined) data.title = parsed.data.title.trim();
    if (parsed.data.description !== undefined) data.description = parsed.data.description.trim();
    if (parsed.data.priceCents !== undefined) data.priceCents = parsed.data.priceCents;
    if (parsed.data.currency !== undefined) data.currency = parsed.data.currency;
    if (parsed.data.priceUnit !== undefined) data.priceUnit = parsed.data.priceUnit;
    if (parsed.data.country !== undefined) data.country = parsed.data.country ? parsed.data.country.toUpperCase().slice(0, 8) : null;
    if (parsed.data.tags !== undefined) data.tags = { set: parsed.data.tags.map((t) => t.toLowerCase().trim()).filter(Boolean) };
    if (parsed.data.coverImageUrl !== undefined) data.coverImageUrl = parsed.data.coverImageUrl;
    if (parsed.data.gallery !== undefined) data.galleryJson = JSON.stringify(parsed.data.gallery);
    if (parsed.data.status !== undefined) {
      // продавец может только активировать/архивировать; auto_hidden ставит хаб
      if (parsed.data.status === "auto_hidden") return res.status(400).json({ message: "Cannot set auto_hidden manually" });
      data.status = parsed.data.status;
    }

    const updated = await prisma.marketplaceListing.update({
      where: { id },
      data,
      include: { category: true, installation: { select: publicInstallationSelect } },
    });
    return res.json(serializeListing(updated));
  })
);

marketplaceHubRouter.delete(
  "/listings/:id",
  writeLimiter,
  requireInstallation,
  asyncRoute(async (req, res) => {
    const inst = (req as ReqWithInstallation).installation;
    const id = String(req.params.id ?? "");
    const existing = await prisma.marketplaceListing.findUnique({ where: { id } });
    if (!existing || existing.installationId !== inst.id) return res.status(404).json({ message: "Not found" });
    await prisma.marketplaceListing.delete({ where: { id } });
    await prisma.marketplaceInstallation.update({
      where: { id: inst.id },
      data: { totalListings: { decrement: 1 } },
    }).catch(() => undefined);
    return res.json({ ok: true });
  })
);

/* ─────────────── Жалобы ─────────────── */

const reportSchema = z.object({
  listingId: z.string().min(1).max(64),
  reason: z.enum(ALLOWED_REPORT_REASONS),
  comment: z.string().max(1000).optional(),
});

marketplaceHubRouter.post(
  "/reports",
  writeLimiter,
  requireInstallation,
  asyncRoute(async (req, res) => {
    const inst = (req as ReqWithInstallation).installation;
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    const listing = await prisma.marketplaceListing.findUnique({ where: { id: parsed.data.listingId } });
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (listing.installationId === inst.id) return res.status(400).json({ message: "Cannot report your own listing" });

    try {
      await prisma.marketplaceReport.create({
        data: {
          listingId: listing.id,
          reporterInstallationId: inst.id,
          reason: parsed.data.reason,
          comment: parsed.data.comment ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res.status(409).json({ message: "Already reported" });
      }
      throw e;
    }

    const totalOpen = await prisma.marketplaceReport.count({
      where: { listingId: listing.id, status: "open" },
    });
    const data: Prisma.MarketplaceListingUpdateInput = { reportsCount: totalOpen };
    if (totalOpen >= MARKETPLACE_AUTO_HIDE_REPORTS_THRESHOLD && listing.status === "active") {
      data.status = "auto_hidden";
    }
    await prisma.marketplaceListing.update({ where: { id: listing.id }, data });

    return res.json({ ok: true, reports: totalOpen, autoHidden: data.status === "auto_hidden" });
  })
);
