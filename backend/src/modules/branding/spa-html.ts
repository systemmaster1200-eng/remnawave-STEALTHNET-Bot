/**
 * SSR-подстановка имени сервиса в `index.html` на лету.
 *
 * Зачем: meta-теги (`<title>`, `og:title`, description, application-name)
 * захардкожены при сборке фронтенда как «STEALTHNET». Telegram, Twitter и
 * прочие крауллеры читают их статически — JS не выполняют. Поэтому мы
 * рендерим index.html на стороне api и подставляем актуальное имя из
 * `service_name` (Настройки → Брендинг).
 *
 * Frontend dist лежит в общем docker-volume `frontend_dist`, который
 * примонтирован в api как `/var/www/stealthnet:ro`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { getSystemConfig } from "../client/client.service.js";

const DIST_PATH = process.env.FRONTEND_DIST_PATH || "/var/www/stealthnet";
const INDEX_FILE = path.join(DIST_PATH, "index.html");
const DEFAULT_BRAND = "STEALTHNET";
const DEFAULT_DESC = "STEALTHNET — личный кабинет и админка VPN на базе Remnawave";

interface CachedTemplate {
  raw: string;
  mtimeMs: number;
}

let templateCache: CachedTemplate | null = null;

async function loadTemplate(): Promise<string> {
  const stat = await fs.stat(INDEX_FILE);
  if (templateCache && templateCache.mtimeMs === stat.mtimeMs) {
    return templateCache.raw;
  }
  const raw = await fs.readFile(INDEX_FILE, "utf8");
  templateCache = { raw, mtimeMs: stat.mtimeMs };
  return raw;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

interface BrandValues {
  brand: string;
  description: string;
  ogImage: string | null;
}

let brandCache: { at: number; value: BrandValues } | null = null;
const BRAND_TTL_MS = 30_000;

async function resolveBrand(): Promise<BrandValues> {
  if (brandCache && Date.now() - brandCache.at < BRAND_TTL_MS) return brandCache.value;
  const cfg = await getSystemConfig().catch(() => null);
  const brand = (cfg?.serviceName ?? "").trim() || DEFAULT_BRAND;
  const description =
    brand === DEFAULT_BRAND
      ? DEFAULT_DESC
      : `${brand} — личный кабинет и админка VPN на базе Remnawave`;
  const logo = (cfg?.logo ?? "").trim() || null;
  brandCache = {
    at: Date.now(),
    value: { brand, description, ogImage: logo },
  };
  return brandCache.value;
}

/** Сбрасывает кеш бренда — вызывается при сохранении настроек. */
export function invalidateBrandCache() {
  brandCache = null;
}

/** Сбрасывает закешированный шаблон index.html (например, после деплоя). */
export function invalidateTemplateCache() {
  templateCache = null;
}

function renderHtml(tpl: string, b: BrandValues): string {
  // Заменяем все вхождения "STEALTHNET" в шаблоне (это бренд-плейсхолдер
  // в meta/title/manifest-name и т. п. — никаких ложных срабатываний быть
  // не должно, так как имя редкое).
  let out = tpl.replaceAll(DEFAULT_BRAND, escapeHtml(b.brand));

  // Прицельно правим description-тег (он всегда генерируется при сборке).
  out = out.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${escapeAttr(b.description)}" />`
  );

  // Дополняем head OG/Twitter тегами, если их ещё нет — для красивого превью
  // в мессенджерах. Делаем идемпотентно: если og:title уже есть, не дублируем.
  if (!/<meta\s+property=["']og:title["']/i.test(out)) {
    const ogBlock = [
      `<meta property="og:title" content="${escapeAttr(b.brand)}" />`,
      `<meta property="og:description" content="${escapeAttr(b.description)}" />`,
      `<meta property="og:type" content="website" />`,
      ...(b.ogImage ? [`<meta property="og:image" content="${escapeAttr(b.ogImage)}" />`] : []),
      `<meta name="twitter:card" content="summary${b.ogImage ? "_large_image" : ""}" />`,
      `<meta name="twitter:title" content="${escapeAttr(b.brand)}" />`,
      `<meta name="twitter:description" content="${escapeAttr(b.description)}" />`,
      ...(b.ogImage ? [`<meta name="twitter:image" content="${escapeAttr(b.ogImage)}" />`] : []),
    ].join("\n    ");
    out = out.replace(/<\/head>/i, `    ${ogBlock}\n  </head>`);
  }

  return out;
}

export async function renderSpaIndex(_req: Request, res: Response) {
  try {
    const [tpl, brand] = await Promise.all([loadTemplate(), resolveBrand()]);
    const html = renderHtml(tpl, brand);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-Brand", encodeURIComponent(brand.brand));
    res.send(html);
  } catch (e) {
    console.warn("[spa-html] render failed:", e instanceof Error ? e.message : e);
    res.status(500).type("text/plain").send("SPA template not available yet, please retry");
  }
}
