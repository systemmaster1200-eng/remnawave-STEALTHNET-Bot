/**
 * Runtime-состояние маркетплейса: включён ли, роль, API-ключ, контактная инфа.
 * Всё хранится в `system_settings` и кешируется в памяти на 30 секунд,
 * чтобы /api/admin/marketplace/* не дёргали БД на каждый чих.
 */
import { prisma } from "../../db.js";
import {
  MARKETPLACE_ENABLED_DEFAULT,
  MARKETPLACE_ROLE_DEFAULT,
  SETTING_KEYS,
} from "./marketplace.constants.js";

export type MarketplaceRole = "client" | "hub";

export interface MarketplaceRuntimeState {
  enabled: boolean;
  role: MarketplaceRole;
  apiKey: string | null;
  installationId: string | null;
  contactUsername: string | null;
  displayName: string | null;
  logoUrl: string | null;
  description: string | null;
  lastConnectAt: Date | null;
  lastConnectStatus: string | null;
}

const ALL_KEYS = Object.values(SETTING_KEYS);
let cache: { at: number; state: MarketplaceRuntimeState } | null = null;
const CACHE_TTL_MS = 30_000;

function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function getMarketplaceRuntime(force = false): Promise<MarketplaceRuntimeState> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.state;
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: ALL_KEYS } } });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const enabledRaw = map[SETTING_KEYS.enabled];
  const enabled = enabledRaw == null ? MARKETPLACE_ENABLED_DEFAULT : enabledRaw === "true" || enabledRaw === "1";

  const roleRaw = (map[SETTING_KEYS.role] || MARKETPLACE_ROLE_DEFAULT).toLowerCase();
  const role: MarketplaceRole = roleRaw === "hub" ? "hub" : "client";

  const state: MarketplaceRuntimeState = {
    enabled,
    role,
    apiKey: (map[SETTING_KEYS.apiKey] ?? "").trim() || null,
    installationId: (map[SETTING_KEYS.installationId] ?? "").trim() || null,
    contactUsername: (map[SETTING_KEYS.contactUsername] ?? "").trim() || null,
    displayName: (map[SETTING_KEYS.displayName] ?? "").trim() || null,
    logoUrl: (map[SETTING_KEYS.logoUrl] ?? "").trim() || null,
    description: (map[SETTING_KEYS.description] ?? "").trim() || null,
    lastConnectAt: parseDate(map[SETTING_KEYS.lastConnectAt]),
    lastConnectStatus: (map[SETTING_KEYS.lastConnectStatus] ?? "").trim() || null,
  };
  cache = { at: Date.now(), state };
  return state;
}

export async function setMarketplaceSettings(updates: Partial<{
  enabled: boolean;
  role: MarketplaceRole;
  apiKey: string | null;
  installationId: string | null;
  contactUsername: string | null;
  displayName: string | null;
  logoUrl: string | null;
  description: string | null;
  lastConnectAt: Date | null;
  lastConnectStatus: string | null;
}>) {
  const upserts: Promise<unknown>[] = [];
  const push = (key: string, value: string) => {
    upserts.push(
      prisma.systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    );
  };
  if (updates.enabled !== undefined) push(SETTING_KEYS.enabled, updates.enabled ? "true" : "false");
  if (updates.role !== undefined) push(SETTING_KEYS.role, updates.role);
  if (updates.apiKey !== undefined) push(SETTING_KEYS.apiKey, updates.apiKey ?? "");
  if (updates.installationId !== undefined) push(SETTING_KEYS.installationId, updates.installationId ?? "");
  if (updates.contactUsername !== undefined) push(SETTING_KEYS.contactUsername, updates.contactUsername ?? "");
  if (updates.displayName !== undefined) push(SETTING_KEYS.displayName, updates.displayName ?? "");
  if (updates.logoUrl !== undefined) push(SETTING_KEYS.logoUrl, updates.logoUrl ?? "");
  if (updates.description !== undefined) push(SETTING_KEYS.description, updates.description ?? "");
  if (updates.lastConnectAt !== undefined) push(SETTING_KEYS.lastConnectAt, updates.lastConnectAt?.toISOString() ?? "");
  if (updates.lastConnectStatus !== undefined) push(SETTING_KEYS.lastConnectStatus, updates.lastConnectStatus ?? "");
  await Promise.all(upserts);
  cache = null;
}

export function invalidateMarketplaceRuntimeCache() {
  cache = null;
}
