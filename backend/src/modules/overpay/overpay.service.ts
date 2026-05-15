/**
 * Overpay.io — создание платёжной формы и проверка статусов.
 *
 * Документация: https://pay-docs.overpay.io/ (tag=payform, operation=composer.preflight).
 *
 * Поток:
 *   1. POST {API_URL}/api/orders/preflight  →  получаем { id, resultUrl }.
 *      resultUrl — ссылка на хостовую форму оплаты Overpay.
 *   2. Редиректим клиента на resultUrl.
 *   3. После оплаты Overpay дергает наш webhook (тег `webhooks`, событие `order.update`),
 *      тело: { id, status, merchantTransactionId }.
 *      Успех — status=="charged", отказ — "declined"|"rejected"|"error"|"reversed"|"refunded".
 *
 * Авторизация: HTTP Basic Auth (login:password).
 * Дополнительно Overpay поддерживает p12 client certificate, но для MVP мы полагаемся
 * на IP-whitelist в ЛК мерчанта.
 */

import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

export type OverpayConfig = {
  /** Базовый URL Overpay API (например, https://api.overpay.io). Без завершающего слэша. */
  apiUrl: string;
  /** ID проекта в Overpay (числовая строка, из ЛК мерчанта). */
  projectId: string;
  /** Логин для Basic Auth. */
  login: string;
  /** Пароль для Basic Auth. */
  password: string;
};

export function isOverpayConfigured(config: OverpayConfig | null): boolean {
  return Boolean(
    config?.apiUrl?.trim() &&
      config?.projectId?.trim() &&
      config?.login?.trim() &&
      config?.password?.trim(),
  );
}

export type CreateOverpayOrderParams = {
  config: OverpayConfig;
  /** Сумма (в основных единицах валюты). Overpay хочет строку типа "123.45". */
  amount: number;
  /** ISO 4217 alpha-3: "RUB", "USD", "EUR", ... */
  currency: string;
  /** Наш внутренний orderId — Overpay сохранит его в merchantTransactionId и пришлёт обратно в webhook. */
  orderId: string;
  /** Описание (видит клиент на форме). */
  description?: string;
  /** URL возврата после оплаты. */
  returnUrl?: string;
  /** Разрешённые методы оплаты: "card" | "externalPaymentPage" | "fps". По умолчанию все. */
  paymentMethods?: ("card" | "externalPaymentPage" | "fps")[];
  /** Время жизни ссылки (мин), 5..144000. По умолчанию 300 (5 часов). */
  livetimeMinutes?: number;
  /** Данные клиента (опционально — Overpay может потребовать для некоторых методов). */
  client?: {
    email?: string | null;
    name?: string | null;
    phone?: string | null;
    country?: string | null;
    city?: string | null;
    address?: string | null;
    zip?: string | null;
  };
};

export type CreateOverpayOrderResult =
  | { ok: true; id: string; url: string }
  | { ok: false; error: string; status?: number };

/** Создаёт payform-заказ в Overpay и возвращает URL формы оплаты. */
export async function createOverpayPayformOrder(
  params: CreateOverpayOrderParams,
): Promise<CreateOverpayOrderResult> {
  const { config, amount, currency, orderId, description, returnUrl, paymentMethods, livetimeMinutes, client } = params;

  const apiUrl = config.apiUrl.trim().replace(/\/+$/, "");
  const projectId = config.projectId.trim();
  const login = config.login.trim();
  const password = config.password;

  if (!apiUrl || !projectId || !login || !password) {
    return { ok: false, error: "Overpay не настроен" };
  }

  // Overpay хочет строку вида "100" или "100.00".
  const amountStr = Number(amount).toFixed(2).replace(/\.?0+$/, (s) => (s === "" ? "" : s));
  // Валидация по regex из спеки: ^\d+(\.\d{1,2})?$
  if (!/^\d+(\.\d{1,2})?$/.test(amountStr)) {
    return { ok: false, error: `Overpay: некорректная сумма (${amount})` };
  }

  const body: Record<string, unknown> = {
    amount: amountStr,
    currency: currency.toUpperCase(),
    projectId,
    merchantTransactionId: orderId,
    livetimeMinutes: clampLivetime(livetimeMinutes ?? 300),
  };
  if (description?.trim()) body.description = description.trim().slice(0, 500);
  if (returnUrl?.trim()) body.returnUrl = returnUrl.trim();
  if (paymentMethods && paymentMethods.length > 0) body.paymentMethods = Array.from(new Set(paymentMethods));
  const clientPayload = client ? cleanClientObject(client) : null;
  if (clientPayload && Object.keys(clientPayload).length > 0) body.client = clientPayload;

  const auth = Buffer.from(`${login}:${password}`, "utf8").toString("base64");
  const url = `${apiUrl}/api/orders/preflight`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    }, proxy);
    clearTimeout(timeoutId);

    const text = await res.text();
    let data: Record<string, unknown> | null;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      return { ok: false, error: `Overpay: не JSON (HTTP ${res.status})`, status: res.status };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Overpay: неверный логин/пароль или IP не в whitelist", status: res.status };
    }
    if (!res.ok) {
      const msg = extractOverpayError(data) ?? text?.slice(0, 300) ?? `HTTP ${res.status}`;
      return { ok: false, error: `Overpay: ${msg}`, status: res.status };
    }

    const id = typeof data?.id === "string" ? data.id : null;
    const resultUrl = typeof data?.resultUrl === "string" ? data.resultUrl : null;
    if (!id || !resultUrl) {
      return { ok: false, error: "Overpay не вернул resultUrl", status: res.status };
    }
    return { ok: true, id, url: resultUrl };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Overpay: таймаут запроса (15с)" };
    }
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(message)) {
      return { ok: false, error: "Нет связи с Overpay. Проверьте интернет и настройки прокси." };
    }
    return { ok: false, error: message };
  }
}

function clampLivetime(minutes: number): number {
  const n = Math.round(Number(minutes) || 300);
  if (!Number.isFinite(n)) return 300;
  return Math.min(144000, Math.max(5, n));
}

function cleanClientObject(c: NonNullable<CreateOverpayOrderParams["client"]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

function extractOverpayError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.message === "string" && d.message.trim()) return d.message.trim();
  if (typeof d.error === "string" && d.error.trim()) return d.error.trim();
  if (d.errors && typeof d.errors === "object") {
    const errs = d.errors as Record<string, unknown>;
    const first = Object.values(errs)[0];
    if (typeof first === "string") return first;
    if (Array.isArray(first) && typeof first[0] === "string") return first[0];
    if (first && typeof first === "object") {
      const sub = Object.values(first as Record<string, unknown>)[0];
      if (typeof sub === "string") return sub;
    }
  }
  return null;
}

/** Успешные и финально-неуспешные статусы Overpay (в нижнем регистре). */
export const OVERPAY_SUCCESS_STATUSES = new Set(["charged", "authorized", "credited"]);
export const OVERPAY_FAILED_STATUSES = new Set([
  "declined",
  "rejected",
  "error",
  "reversed",
  "refunded",
  "chargeback",
]);
