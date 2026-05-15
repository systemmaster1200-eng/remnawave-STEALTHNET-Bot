/**
 * Heleket API — создание инвойсов и приём webhook.
 * Документация: https://doc.heleket.com/uk/methods/payments/creating-invoice
 * Подпись: md5(base64_encode(body) + API_KEY)
 */

import { createHash } from "crypto";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const HELEKET_BASE = "https://api.heleket.com/v1";

export type HeleketConfig = {
  merchantId: string;
  apiKey: string;
};

export function isHeleketConfigured(config: HeleketConfig | null): boolean {
  return Boolean(config?.merchantId?.trim() && config?.apiKey?.trim());
}

/**
 * Генерация подписи для запроса: md5(base64(body) + apiKey)
 */
function buildSign(body: Record<string, unknown>, apiKey: string): string {
  const bodyStr = JSON.stringify(body);
  const base64 = Buffer.from(bodyStr, "utf8").toString("base64");
  return createHash("md5").update(base64 + apiKey).digest("hex");
}

export type CreateHeleketInvoiceParams = {
  config: HeleketConfig;
  amount: string;
  currency: string;
  orderId: string;
  urlCallback?: string;
  urlSuccess?: string;
  urlReturn?: string;
  /** Доп. данные (не показываются клиенту), макс. 255 символов */
  additionalData?: string;
  /** Время жизни инвойса в секундах (300–43200), по умолчанию 3600 */
  lifetime?: number;
  /** Целевая криптовалюта (например USDT) — пользователь платит в ней */
  toCurrency?: string;
  /** Сеть (например tron, bsc) — опционально */
  network?: string;
};

export type CreateHeleketInvoiceResult =
  | { ok: true; uuid: string; url: string; paymentStatus: string; expiredAt?: number }
  | { ok: false; error: string; status?: number };

/**
 * Создаёт инвойс в Heleket. Возвращает URL страницы оплаты.
 */
export async function createHeleketInvoice(params: CreateHeleketInvoiceParams): Promise<CreateHeleketInvoiceResult> {
  const { config, amount, currency, orderId, urlCallback, urlSuccess, urlReturn, additionalData, lifetime = 3600, toCurrency, network } = params;
  const merchantId = config.merchantId?.trim();
  const apiKey = config.apiKey?.trim();
  if (!merchantId || !apiKey) return { ok: false, error: "Heleket не настроен" };

  const body: Record<string, unknown> = {
    amount: String(amount),
    currency: currency.toUpperCase(),
    order_id: orderId,
    lifetime: Math.min(43200, Math.max(300, lifetime)),
    is_payment_multiple: false,
  };
  if (urlCallback) body.url_callback = urlCallback;
  if (urlSuccess) body.url_success = urlSuccess;
  if (urlReturn) body.url_return = urlReturn;
  if (additionalData != null && additionalData.length > 0) body.additional_data = additionalData.slice(0, 255);
  if (toCurrency) body.to_currency = toCurrency.toLowerCase();
  if (network) body.network = network;

  const sign = buildSign(body, apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(`${HELEKET_BASE}/payment`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "merchant": merchantId,
        "sign": sign,
      },
      body: JSON.stringify(body),
    }, proxy);
    clearTimeout(timeoutId);

    let data: {
      state?: number;
      result?: {
        uuid?: string;
        url?: string;
        payment_status?: string;
        expired_at?: number;
      };
      message?: string;
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return { ok: false, error: `Heleket: не JSON (${res.status})`, status: res.status };
    }

    if (data.state !== 0 || !data.result) {
      const msg = data.message ?? res.statusText;
      return { ok: false, error: `Heleket: ${msg}`, status: res.status };
    }

    const url = data.result.url;
    if (!data.result.uuid || !url) {
      return { ok: false, error: "Heleket: в ответе нет uuid или url" };
    }

    return {
      ok: true,
      uuid: data.result.uuid,
      url,
      paymentStatus: data.result.payment_status ?? "check",
      expiredAt: data.result.expired_at,
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("ETIMEDOUT") || (e instanceof Error && e.name === "AbortError")) {
      return { ok: false, error: "Нет связи с Heleket. Проверьте интернет и настройки." };
    }
    return { ok: false, error: message };
  }
}

/**
 * Проверка подписи webhook: из тела убирают sign, затем md5(base64(json) + apiKey).
 * В JSON при формировании строки слэши экранируют: \/ (как в PHP).
 */
export function verifyHeleketWebhookSignature(apiKey: string, rawBody: string, signFromBody: string | undefined): boolean {
  if (!apiKey?.trim() || !signFromBody?.trim()) return false;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return false;
  }
  const receivedSign = parsed.sign as string | undefined;
  if (!receivedSign) return false;
  delete parsed.sign;
  // Heleket отправляет JSON с экранированием слэшей (как PHP)
  const bodyStr = JSON.stringify(parsed).replace(/\//g, "\\/");
  const base64 = Buffer.from(bodyStr, "utf8").toString("base64");
  const hash = createHash("md5").update(base64 + apiKey.trim()).digest("hex");
  return hash === receivedSign.trim();
}
