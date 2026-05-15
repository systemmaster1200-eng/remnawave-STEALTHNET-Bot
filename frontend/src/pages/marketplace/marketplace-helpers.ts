import type { MarketplaceCurrency, MarketplacePriceUnit } from "@/lib/api";

const CURRENCY_FORMAT: Record<MarketplaceCurrency, { symbol: string; locale: string }> = {
  USD: { symbol: "$", locale: "en-US" },
  EUR: { symbol: "€", locale: "de-DE" },
  RUB: { symbol: "₽", locale: "ru-RU" },
  USDT: { symbol: "USDT", locale: "en-US" },
};

export function formatPrice(priceCents: number, currency: MarketplaceCurrency): string {
  const value = (priceCents ?? 0) / 100;
  const conf = CURRENCY_FORMAT[currency] ?? CURRENCY_FORMAT.USD;
  const fmt = new Intl.NumberFormat(conf.locale, { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  return currency === "USDT" ? `${fmt.format(value)} USDT` : `${conf.symbol}${fmt.format(value)}`;
}

const UNIT_KEY: Record<MarketplacePriceUnit, string> = {
  one_time: "admin.marketplace.card.per_one_time",
  per_month: "admin.marketplace.card.per_month",
  per_gb: "admin.marketplace.card.per_gb",
  per_device: "admin.marketplace.card.per_device",
};

export function priceUnitKey(unit: MarketplacePriceUnit): string {
  return UNIT_KEY[unit] ?? UNIT_KEY.one_time;
}

export function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const cc = code.toUpperCase();
  const A = 0x41;
  return String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - A, 0x1f1e6 + cc.charCodeAt(1) - A);
}

export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
