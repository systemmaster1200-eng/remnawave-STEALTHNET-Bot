import { randomBytes, createHash } from "crypto";
import { prisma } from "../../db.js";

const KEY_PREFIX_LEN = 8;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = "sk_" + randomBytes(32).toString("hex");
  const prefix = raw.slice(0, KEY_PREFIX_LEN);
  const hash = hashKey(raw);
  return { raw, prefix, hash };
}

export interface CreateApiKeyInput {
  name: string;
  description?: string;
  expiresAt?: Date | null;
  allowedIps?: string[] | null;
}

function normalizeAllowedIps(ips: string[] | null | undefined): string | null {
  if (!ips || ips.length === 0) return null;
  const cleaned = ips
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}

export async function createApiKey(input: CreateApiKeyInput) {
  const { raw, prefix, hash } = generateApiKey();
  const record = await prisma.apiKey.create({
    data: {
      name: input.name,
      description: input.description,
      keyHash: hash,
      prefix,
      expiresAt: input.expiresAt ?? null,
      allowedIps: normalizeAllowedIps(input.allowedIps ?? null),
    },
  });
  return { ...record, rawKey: raw };
}

export async function listApiKeys() {
  return prisma.apiKey.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      prefix: true,
      isActive: true,
      lastUsedAt: true,
      lastUsedIp: true,
      expiresAt: true,
      allowedIps: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteApiKey(id: string) {
  return prisma.apiKey.delete({ where: { id } });
}

export async function toggleApiKey(id: string, isActive: boolean) {
  return prisma.apiKey.update({
    where: { id },
    data: { isActive },
  });
}

export interface UpdateApiKeyInput {
  name?: string;
  description?: string | null;
  expiresAt?: Date | null;
  allowedIps?: string[] | null;
}

export async function updateApiKey(id: string, input: UpdateApiKeyInput) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
  if (input.allowedIps !== undefined) {
    data.allowedIps = normalizeAllowedIps(input.allowedIps);
  }
  return prisma.apiKey.update({ where: { id }, data });
}

export interface ValidationResult {
  ok: boolean;
  reason?: "not_found" | "disabled" | "expired" | "ip_blocked";
  key?: { id: string; name: string };
}

/**
 * Парсит CIDR-нотацию вида "192.0.2.0/24" или одиночный IP "203.0.113.5".
 * Возвращает true если ip входит в диапазон.
 * Поддерживает только IPv4 (для IPv6 — exact match).
 */
function ipMatchesCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes("/")) {
    // Точное совпадение
    return ip === cidr;
  }
  const [range, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const toInt = (s: string): number | null => {
    const parts = s.split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
      const v = parseInt(p, 10);
      if (isNaN(v) || v < 0 || v > 255) return null;
      n = (n << 8) + v;
    }
    return n >>> 0;
  };
  const ipInt = toInt(ip);
  const rangeInt = toInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function isIpAllowed(ip: string | null | undefined, allowedIpsJson: string | null): boolean {
  if (!allowedIpsJson) return true; // нет ограничений
  if (!ip) return false;
  let list: string[];
  try {
    const parsed = JSON.parse(allowedIpsJson);
    if (!Array.isArray(parsed)) return false;
    list = parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return false;
  }
  if (list.length === 0) return true;
  return list.some((cidr) => ipMatchesCidr(ip, cidr));
}

export async function validateApiKey(
  raw: string,
  ip?: string | null
): Promise<ValidationResult> {
  const hash = hashKey(raw);
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  if (!key) return { ok: false, reason: "not_found" };
  if (!key.isActive) return { ok: false, reason: "disabled", key: { id: key.id, name: key.name } };
  if (key.expiresAt && key.expiresAt < new Date()) {
    return { ok: false, reason: "expired", key: { id: key.id, name: key.name } };
  }
  if (key.allowedIps && !isIpAllowed(ip, key.allowedIps)) {
    return { ok: false, reason: "ip_blocked", key: { id: key.id, name: key.name } };
  }
  // fire-and-forget update
  prisma.apiKey
    .update({
      where: { id: key.id },
      data: { lastUsedAt: new Date(), lastUsedIp: ip ?? null },
    })
    .catch(() => {});
  return { ok: true, key: { id: key.id, name: key.name } };
}

/**
 * Запись в audit log. Никогда не бросает — лог не должен ронять основной запрос.
 */
export function recordApiKeyUsage(args: {
  apiKeyId: string;
  ip?: string | null;
  ua?: string | null;
  method: string;
  path: string;
  statusCode: number;
}) {
  prisma.apiKeyUsage
    .create({
      data: {
        apiKeyId: args.apiKeyId,
        ip: args.ip ?? null,
        ua: args.ua ? args.ua.slice(0, 500) : null,
        method: args.method.slice(0, 10),
        path: args.path.slice(0, 500),
        statusCode: args.statusCode,
      },
    })
    .catch(() => {});
}

export async function listApiKeyUsage(apiKeyId: string, limit = 100) {
  return prisma.apiKeyUsage.findMany({
    where: { apiKeyId },
    orderBy: { ts: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}
