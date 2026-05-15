/**
 * Общие хелперы маркетплейса: нормализация домена, генерация/хеш API-ключа,
 * валидаторы значений (валюта, единица цены, статус, причины жалоб).
 */
import { createHash, randomBytes } from "node:crypto";

export const ALLOWED_CURRENCIES = ["USD", "RUB", "EUR", "USDT"] as const;
export type MarketplaceCurrency = (typeof ALLOWED_CURRENCIES)[number];

export const ALLOWED_PRICE_UNITS = ["one_time", "per_month", "per_gb", "per_device"] as const;
export type MarketplacePriceUnit = (typeof ALLOWED_PRICE_UNITS)[number];

export const ALLOWED_LISTING_STATUSES = ["active", "archived", "auto_hidden"] as const;
export type MarketplaceListingStatus = (typeof ALLOWED_LISTING_STATUSES)[number];

export const ALLOWED_REPORT_REASONS = ["spam", "scam", "wrong_category", "offensive", "other"] as const;
export type MarketplaceReportReason = (typeof ALLOWED_REPORT_REASONS)[number];

/** Скрытое автоматическое имя auto_hidden включается, если набрано столько уникальных жалоб. */
export const AUTO_HIDE_REPORTS_THRESHOLD = 3;

export const KEY_PREFIX = "mk_";

/** Возвращает domain без схемы и trailing-slash, в lower-case. */
export function normaliseDomain(input: string | null | undefined): string {
  if (!input) return "";
  let v = input.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  // Срезаем :80 / :443
  v = v.replace(/:(80|443)$/, "");
  return v;
}

/** Telegram username без @ и без https://t.me/. Возвращает null, если пусто. */
export function normaliseUsername(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.trim();
  v = v.replace(/^https?:\/\/t\.me\//i, "");
  v = v.replace(/^@/, "");
  if (!v) return null;
  if (!/^[a-zA-Z0-9_]{3,64}$/.test(v)) return null;
  return v;
}

/** Генерирует ключ вида mk_XXXXXXXX… (32 hex-символа после префикса). */
export function generateApiKey(): { plain: string; hash: string; prefix: string } {
  const random = randomBytes(24).toString("base64url");
  const plain = `${KEY_PREFIX}${random}`;
  return {
    plain,
    hash: hashApiKey(plain),
    prefix: plain.slice(0, 12),
  };
}

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export function safeIp(req: { ip?: string; headers?: Record<string, unknown> }): string {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim().slice(0, 64);
  }
  return (req.ip ?? "").slice(0, 64);
}
