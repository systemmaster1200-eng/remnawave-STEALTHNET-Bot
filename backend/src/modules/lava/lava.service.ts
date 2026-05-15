/**
 * LAVA Business API — выставление счетов и проверка webhook.
 *
 * Документация:
 *   - Выставление счёта:        https://dev.lava.ru/api-invoice-create
 *   - Формирование сигнатуры:   https://dev.lava.ru/api-invoice-sign
 *   - WebHook:                  https://dev.lava.ru/business-webhook
 *
 * Подпись: HMAC-SHA256(JSON-тело запроса, secretKey) → HEX.
 *   Передаётся в заголовке `Signature` (рекомендуемый способ).
 *   Тело ОБЯЗАТЕЛЬНО подписывается ДО передачи — тот же JSON.stringify,
 *   без перестановок полей, без экранирования слэшей.
 *
 * Webhook: LAVA ставит подпись в заголовке `Authorization`, подписываемую
 *   "дополнительным ключом" (additional key) из кабинета мерчанта.
 *   В теле webhook'а: { invoice_id, status: "success" | ..., amount, order_id, pay_service, ... }.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const LAVA_BASE = "https://api.lava.ru";

export type LavaConfig = {
  /** UUID проекта из кабинета Lava Business */
  shopId: string;
  /** Секретный ключ — подпись исходящих запросов */
  secretKey: string;
  /** «Дополнительный» ключ — проверка подписи webhook'ов */
  additionalKey: string;
};

export function isLavaConfigured(config: Pick<LavaConfig, "shopId" | "secretKey"> | null): boolean {
  return Boolean(config?.shopId?.trim() && config?.secretKey?.trim());
}

/** HMAC-SHA256(JSON, key) → hex. */
function signBody(body: Record<string, unknown>, secretKey: string): string {
  return createHmac("sha256", secretKey).update(JSON.stringify(body)).digest("hex");
}

export type CreateLavaInvoiceParams = {
  config: Pick<LavaConfig, "shopId" | "secretKey">;
  /** Сумма в рублях (числом, до двух знаков — как требует Lava) */
  amount: number;
  /** Уникальный идентификатор заказа (Lava хранит и возвращает его в webhook) */
  orderId: string;
  /** URL куда Lava шлёт хук при оплате / отмене / истечении */
  hookUrl?: string;
  /** URL куда редиректить после успешной оплаты */
  successUrl?: string;
  /** URL куда редиректить при неудачной оплате */
  failUrl?: string;
  /** Время жизни счёта в минутах (1…7200). По умолчанию 300 (5 часов) */
  expire?: number;
  /** Комментарий к счёту (до 255 символов) */
  comment?: string;
  /** Доп. поля, max 500 символов */
  customFields?: string;
  /** Ограничение методов оплаты на странице Lava (например ["card", "sbp"]) */
  includeService?: string[];
  /** Скрыть методы оплаты (например ["qiwi"]) */
  excludeService?: string[];
};

export type CreateLavaInvoiceResult =
  | { ok: true; invoiceId: string; url: string; expired?: string }
  | { ok: false; error: string; status?: number };

/** Создаёт инвойс в Lava и возвращает URL страницы оплаты. */
export async function createLavaInvoice(params: CreateLavaInvoiceParams): Promise<CreateLavaInvoiceResult> {
  const { config, amount, orderId, hookUrl, successUrl, failUrl, expire, comment, customFields, includeService, excludeService } = params;
  const shopId = config.shopId?.trim();
  const secretKey = config.secretKey?.trim();
  if (!shopId || !secretKey) return { ok: false, error: "Lava не настроен" };

  // Сумма — число с двумя знаками после запятой.
  const sum = Math.round(amount * 100) / 100;

  // Порядок полей важен для подписи (то же JSON.stringify, что и при отправке).
  const body: Record<string, unknown> = { shopId, sum, orderId };
  if (hookUrl) body.hookUrl = hookUrl;
  if (successUrl) body.successUrl = successUrl;
  if (failUrl) body.failUrl = failUrl;
  if (expire != null) body.expire = Math.min(7200, Math.max(1, Math.round(expire)));
  if (customFields != null && customFields.length > 0) body.customFields = customFields.slice(0, 500);
  if (comment != null && comment.length > 0) body.comment = comment.slice(0, 255);
  if (includeService && includeService.length > 0) body.includeService = includeService;
  if (excludeService && excludeService.length > 0) body.excludeService = excludeService;

  const signature = signBody(body, secretKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(`${LAVA_BASE}/business/invoice/create`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Signature: signature,
      },
      body: JSON.stringify(body),
    }, proxy);
    clearTimeout(timeoutId);

    let data: {
      status?: number | string;
      status_check?: boolean;
      data?: { id?: string; url?: string; expired?: string; status?: string };
      error?: unknown;
      message?: string;
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return { ok: false, error: `Lava: не JSON (${res.status})`, status: res.status };
    }

    // Lava возвращает в data.data.id / data.data.url при успехе.
    const invoice = data.data;
    if (!invoice?.id || !invoice.url) {
      const errMsg = extractLavaError(data) ?? `HTTP ${res.status}`;
      return { ok: false, error: `Lava: ${errMsg}`, status: res.status };
    }

    return {
      ok: true,
      invoiceId: invoice.id,
      url: invoice.url,
      expired: invoice.expired,
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("ETIMEDOUT") || (e instanceof Error && e.name === "AbortError")) {
      return { ok: false, error: "Нет связи с Lava. Проверьте интернет и настройки." };
    }
    return { ok: false, error: message };
  }
}

/**
 * Проверка подписи webhook'а Lava.
 * Lava кладёт сигнатуру в заголовок `Authorization` (в некоторых версиях используется имя `Signature`),
 * Алгоритм Lava (по их PHP-примеру + тестовому вектору саппорта 04.05.2026):
 *   1) JSON.parse(rawBody)
 *   2) ksort (PHP: top-level ключи отсортированы по алфавиту)
 *   3) json_encode (без флагов — но в Lava-payload нет слэшей/unicode, так что
 *      обычный JSON.stringify даёт байт-в-байт то же что PHP json_encode)
 *   4) HMAC-SHA256(canonicalJson, additionalKey) → hex
 *
 * Тестовый вектор от саппорта Lava (key="test"):
 *   {"type":1,"amount":"10.00","status":"success","credited":"10.00",
 *    "order_id":"test","pay_time":"2026-05-01 13:57:36","invoice_id":"test",
 *    "pay_service":"test","custom_fields":null,"payer_details":null}
 *   → 9af43dede4417ee68fdfc2ed7d772c41443a23eed2472329dd239ea7657f3e92
 *
 * Если в payload появятся слэши или unicode — нужен дополнительный escape под
 * стиль PHP (`/` → `\/`, `é` → `é`). Lava-вебхуки обычно без этого, но
 * fallback-проверка raw body оставлена на случай когда Lava пришлёт сигнатуру
 * не от canonical, а от raw (исторические клиенты, debug, ручной test).
 */
export function verifyLavaWebhookSignature(additionalKey: string, rawBody: string, signatureHeader: string | undefined): boolean {
  const key = additionalKey?.trim();
  const sig = signatureHeader?.trim();
  if (!key || !sig) return false;

  // Основной путь: canonical JSON с отсортированными top-level ключами.
  let canonical: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(parsed).sort()) sorted[k] = parsed[k];
      canonical = JSON.stringify(sorted);
    }
  } catch {
    // невалидный JSON — оставляем canonical=null, проверим только raw
  }

  const candidates = [canonical, rawBody].filter((s): s is string => typeof s === "string" && s.length > 0);
  for (const body of candidates) {
    const expected = createHmac("sha256", key).update(body).digest("hex");
    try {
      const expectedBuf = Buffer.from(expected, "hex");
      const providedBuf = Buffer.from(sig, "hex");
      if (expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)) {
        return true;
      }
    } catch {
      // невалидный hex в заголовке — fallback на полное хэширование строк
      if (createHash("sha256").update(expected).digest("hex") === createHash("sha256").update(sig).digest("hex")) {
        return true;
      }
    }
  }
  return false;
}
function extractLavaError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.message === "string" && d.message.trim()) return d.message;
  if (d.error && typeof d.error === "object") {
    const errObj = d.error as Record<string, unknown>;
    const first = Object.values(errObj)[0];
    if (typeof first === "string") return first;
    if (Array.isArray(first) && typeof first[0] === "string") return first[0];
  }
  if (typeof d.error === "string" && d.error.trim()) return d.error;
  return null;
}
