/**
 * Bootstrap-логика клиентской панели:
 *   1. Если маркетплейс выключен (или роль = hub) — ничего не делаем.
 *   2. Если ключа нет — POST /api/marketplace/registry/register на хаб,
 *      получаем `apiKey` и сохраняем в SystemSetting.
 *   3. Если ключ есть — heartbeat (нужно для lastSeenAt и обновления контактов).
 */
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import {
  MARKETPLACE_HUB_URL,
  MARKETPLACE_HUB_TIMEOUT_MS,
  SETTING_KEYS,
} from "./marketplace.constants.js";
import {
  getMarketplaceRuntime,
  setMarketplaceSettings,
} from "./marketplace.runtime.js";
import { normaliseDomain, normaliseUsername } from "./marketplace.shared.js";

interface ConnectResult {
  ok: boolean;
  status: "registered" | "heartbeat" | "skipped" | "error";
  message?: string;
  installationId?: string | null;
}

/** Текущий публичный домен инсталляции (без схемы и trailing-slash). */
async function resolveLocalDomain(): Promise<string | null> {
  try {
    const cfg = await getSystemConfig();
    const url = (cfg.publicAppUrl ?? "").trim();
    return normaliseDomain(url) || null;
  } catch {
    return null;
  }
}

async function hubRequest(
  path: string,
  init: { method: "POST"; body: unknown; key?: string }
): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MARKETPLACE_HUB_TIMEOUT_MS);
  try {
    const r = await fetch(`${MARKETPLACE_HUB_URL.replace(/\/+$/, "")}/api/marketplace${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.key ? { "X-Marketplace-Key": init.key } : {}),
      },
      body: JSON.stringify(init.body),
      signal: ctrl.signal,
    });
    let body: unknown = null;
    try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  } finally {
    clearTimeout(timer);
  }
}

let inflight: Promise<ConnectResult> | null = null;

/**
 * Если ещё не зарегистрированы — регистрируется, иначе шлёт heartbeat.
 * Можно дёрнуть из админки кнопкой «Подключиться сейчас».
 */
export async function ensureRegistered(opts: { force?: boolean } = {}): Promise<ConnectResult> {
  if (inflight && !opts.force) return inflight;
  const promise = doConnect();
  inflight = promise;
  try {
    return await promise;
  } finally {
    inflight = null;
  }
}

async function doConnect(): Promise<ConnectResult> {
  const rt = await getMarketplaceRuntime(true);
  if (!rt.enabled) return finish({ ok: true, status: "skipped", message: "Marketplace disabled in settings" });

  const domain = await resolveLocalDomain();

  // Авто-определение хаба: если домен этой инсталляции совпадает с зашитым
  // MARKETPLACE_HUB_URL — значит это и есть тот самый хаб.
  if (domain && rt.role !== "hub") {
    const hubHost = normaliseDomain(MARKETPLACE_HUB_URL);
    if (hubHost && hubHost === domain) {
      await setMarketplaceSettings({ role: "hub", apiKey: null, installationId: null });
      console.log(`[marketplace] Auto-detected this installation as the hub (${domain})`);
      return finish({ ok: true, status: "skipped", message: "This installation auto-detected as the hub" });
    }
  }

  if (rt.role === "hub") return finish({ ok: true, status: "skipped", message: "This installation is the hub itself" });

  if (!domain) {
    return finish({
      ok: false,
      status: "error",
      message: "publicAppUrl is empty in settings — cannot register on marketplace hub",
    });
  }
  const contactUsername = normaliseUsername(rt.contactUsername);

  if (!rt.apiKey) {
    if (!contactUsername) {
      return finish({
        ok: false,
        status: "error",
        message: "Telegram username is required for marketplace registration. Open Settings → Marketplace.",
      });
    }
    const r = await hubRequest("/registry/register", {
      method: "POST",
      body: {
        domain,
        contactUsername,
        displayName: rt.displayName ?? undefined,
        logoUrl: rt.logoUrl ?? undefined,
        description: rt.description ?? undefined,
      },
    }).catch((e) => ({ status: 0, body: { message: e instanceof Error ? e.message : String(e) } }));
    if (r.status >= 200 && r.status < 300) {
      const data = r.body as { apiKey: string; installationId: string };
      await setMarketplaceSettings({
        apiKey: data.apiKey,
        installationId: data.installationId,
      });
      console.log(`[marketplace] Registered installation ${data.installationId} on ${MARKETPLACE_HUB_URL}`);
      return finish({ ok: true, status: "registered", installationId: data.installationId });
    }
    if (r.status === 409) {
      const data = r.body as { installationId?: string; message?: string };
      return finish({
        ok: false,
        status: "error",
        message: `Hub says this domain is already registered (${data.installationId ?? "?"}). Reset key on hub or change publicAppUrl.`,
      });
    }
    const m = r.body && typeof r.body === "object" && "message" in r.body ? String((r.body as { message: unknown }).message) : `HTTP ${r.status}`;
    return finish({ ok: false, status: "error", message: `Registration failed: ${m}` });
  }

  const r = await hubRequest("/heartbeat", {
    method: "POST",
    key: rt.apiKey,
    body: {
      contactUsername: contactUsername ?? undefined,
      displayName: rt.displayName,
      logoUrl: rt.logoUrl,
      description: rt.description,
    },
  }).catch((e) => ({ status: 0, body: { message: e instanceof Error ? e.message : String(e) } }));
  if (r.status >= 200 && r.status < 300) {
    return finish({ ok: true, status: "heartbeat", installationId: rt.installationId });
  }
  if (r.status === 401) {
    // Ключ не подходит — забываем, при следующей попытке зарегистрируемся заново
    await prisma.systemSetting.delete({ where: { key: SETTING_KEYS.apiKey } }).catch(() => undefined);
    await prisma.systemSetting.delete({ where: { key: SETTING_KEYS.installationId } }).catch(() => undefined);
    return finish({ ok: false, status: "error", message: "Hub rejected our API key, will re-register on next try" });
  }
  const m = r.body && typeof r.body === "object" && "message" in r.body ? String((r.body as { message: unknown }).message) : `HTTP ${r.status}`;
  return finish({ ok: false, status: "error", message: `Heartbeat failed: ${m}` });
}

async function finish(result: ConnectResult): Promise<ConnectResult> {
  await setMarketplaceSettings({
    lastConnectAt: new Date(),
    lastConnectStatus: result.ok ? result.status : `error: ${result.message ?? "unknown"}`.slice(0, 200),
  }).catch(() => undefined);
  return result;
}
