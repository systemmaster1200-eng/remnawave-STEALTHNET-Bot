/**
 * Прокси-роуты для админки панели: всё, что админка хочет узнать или сделать
 * с маркетплейсом, она запрашивает у своего бэкенда. Бэкенд добавляет
 * `X-Marketplace-Key` и форвардит запрос на хаб (`MARKETPLACE_HUB_URL`).
 *
 * Так фронт никогда не видит API-ключ инсталляции.
 */
import express, { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import {
  MARKETPLACE_HUB_URL,
  MARKETPLACE_HUB_TIMEOUT_MS,
} from "./marketplace.constants.js";
import { getMarketplaceRuntime, setMarketplaceSettings } from "./marketplace.runtime.js";
import { ensureRegistered } from "./marketplace.registration.js";
import { normaliseUsername } from "./marketplace.shared.js";

export const marketplaceClientRouter = Router();

marketplaceClientRouter.use(requireAuth);

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

interface HubFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  withKey?: boolean;
}

async function hubFetch(opts: HubFetchOptions) {
  const url = new URL(`${MARKETPLACE_HUB_URL.replace(/\/+$/, "")}/api/marketplace${opts.path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (opts.withKey) {
    const rt = await getMarketplaceRuntime();
    if (!rt.apiKey) {
      return { status: 412, json: { message: "Panel is not registered on marketplace hub yet. Open Settings → Marketplace to (re)connect." } };
    }
    headers["X-Marketplace-Key"] = rt.apiKey;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MARKETPLACE_HUB_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await r.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { status: r.status, json: parsed };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { status: 502, json: { message: `Hub unreachable: ${message}` } };
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────── Статус подключения ─────────────── */

marketplaceClientRouter.get(
  "/status",
  asyncRoute(async (_req, res) => {
    const rt = await getMarketplaceRuntime();
    return res.json({
      enabled: rt.enabled,
      role: rt.role,
      hubUrl: MARKETPLACE_HUB_URL,
      installationId: rt.installationId,
      apiKeyConnected: Boolean(rt.apiKey),
      contactUsername: rt.contactUsername,
      displayName: rt.displayName,
      logoUrl: rt.logoUrl,
      description: rt.description,
      lastConnectAt: rt.lastConnectAt,
      lastConnectStatus: rt.lastConnectStatus,
    });
  })
);

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  role: z.enum(["client", "hub"]).optional(),
  contactUsername: z.string().max(64).nullable().optional(),
  displayName: z.string().max(200).nullable().optional(),
  logoUrl: z.string().url().max(2000).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
});

marketplaceClientRouter.patch(
  "/settings",
  asyncRoute(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    const data = parsed.data;
    const updates: Parameters<typeof setMarketplaceSettings>[0] = {};
    if (data.enabled !== undefined) updates.enabled = data.enabled;
    if (data.role !== undefined) updates.role = data.role;
    if (data.contactUsername !== undefined) {
      if (data.contactUsername === null || data.contactUsername === "") {
        updates.contactUsername = null;
      } else {
        const u = normaliseUsername(data.contactUsername);
        if (!u) return res.status(400).json({ message: "Invalid Telegram username" });
        updates.contactUsername = u;
      }
    }
    if (data.displayName !== undefined) updates.displayName = data.displayName;
    if (data.logoUrl !== undefined) updates.logoUrl = data.logoUrl;
    if (data.description !== undefined) updates.description = data.description;
    await setMarketplaceSettings(updates);

    // Если изменили публичные поля и уже зарегистрированы — синхронизируем на хабе.
    const rt = await getMarketplaceRuntime(true);
    if (rt.apiKey && (data.contactUsername !== undefined || data.displayName !== undefined || data.logoUrl !== undefined || data.description !== undefined)) {
      hubFetch({
        method: "POST",
        path: "/heartbeat",
        withKey: true,
        body: {
          contactUsername: rt.contactUsername ?? undefined,
          displayName: rt.displayName,
          logoUrl: rt.logoUrl,
          description: rt.description,
        },
      }).catch(() => undefined);
    }
    return res.json({ ok: true });
  })
);

marketplaceClientRouter.post(
  "/connect",
  asyncRoute(async (_req, res) => {
    const result = await ensureRegistered({ force: true });
    return res.status(result.ok ? 200 : 502).json(result);
  })
);

/* ─────────────── Каталог ─────────────── */

marketplaceClientRouter.get(
  "/categories",
  asyncRoute(async (_req, res) => {
    const r = await hubFetch({ path: "/categories" });
    return res.status(r.status).json(r.json);
  })
);

marketplaceClientRouter.get(
  "/listings",
  asyncRoute(async (req, res) => {
    const r = await hubFetch({ path: "/listings", query: req.query as Record<string, string> });
    return res.status(r.status).json(r.json);
  })
);

marketplaceClientRouter.get(
  "/listings/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const r = await hubFetch({ path: `/listings/${encodeURIComponent(id)}` });
    return res.status(r.status).json(r.json);
  })
);

marketplaceClientRouter.post(
  "/listings/:id/view",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const r = await hubFetch({ method: "POST", path: `/listings/${encodeURIComponent(id)}/view` });
    return res.status(r.status).json(r.json);
  })
);

/* ─────────────── Мои листинги ─────────────── */

marketplaceClientRouter.get(
  "/my/listings",
  asyncRoute(async (_req, res) => {
    const r = await hubFetch({ path: "/my/listings", withKey: true });
    return res.status(r.status).json(r.json);
  })
);

marketplaceClientRouter.post(
  "/my/listings",
  asyncRoute(async (req, res) => {
    const r = await hubFetch({ method: "POST", path: "/listings", body: req.body, withKey: true });
    return res.status(r.status).json(r.json);
  })
);

marketplaceClientRouter.patch(
  "/my/listings/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const r = await hubFetch({ method: "PATCH", path: `/listings/${encodeURIComponent(id)}`, body: req.body, withKey: true });
    return res.status(r.status).json(r.json);
  })
);

marketplaceClientRouter.delete(
  "/my/listings/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "");
    const r = await hubFetch({ method: "DELETE", path: `/listings/${encodeURIComponent(id)}`, withKey: true });
    return res.status(r.status).json(r.json);
  })
);

/* ─────────────── Жалобы ─────────────── */

marketplaceClientRouter.post(
  "/reports",
  asyncRoute(async (req, res) => {
    const r = await hubFetch({ method: "POST", path: "/reports", body: req.body, withKey: true });
    return res.status(r.status).json(r.json);
  })
);
