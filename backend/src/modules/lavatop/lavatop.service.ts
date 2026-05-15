/**
 * Lava.top — создание инвойсов и проверка webhook'ов.
 * Документация:  https://developers.lava.top/ru
 *                https://gate.lava.top/docs (Swagger)
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ОТЛИЧИЕ от lava.ru (Business)
 * ─────────────────────────────────────────────────────────────────────────
 *  • lava.ru работает по «амоунт + orderId», создаёт счёт на любую сумму.
 *  • lava.top работает по «продукты + офферы»: оператор заводит продукт
 *    в личном кабинете, у продукта несколько offer'ов с фиксированной ценой
 *    в нужной валюте. Чтобы оплатить — мы передаём `offerId` + `email`.
 *
 *  ➜ В системе хранится один общий API-key и (опционально) `defaultOfferId`,
 *    который используется когда у конкретного тарифа нет своего offer'а.
 *    Поле `lavatop_offer_id` можно вынести в metadata тарифа в админке —
 *    тогда оплата конкретного тарифа использует свой собственный offer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Авторизация
 * ─────────────────────────────────────────────────────────────────────────
 *  • Заголовок `X-Api-Key: <key>` в КАЖДОМ запросе к API.
 *  • Webhook авторизуется тем же ключом — Lava ставит его в `X-Api-Key`
 *    в исходящем запросе (или Basic auth — поддерживаем оба).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Создание инвойса:  POST /api/v2/invoice
 * ─────────────────────────────────────────────────────────────────────────
 *  body:
 *    {
 *      email:         string,                  // email клиента
 *      offerId:       string,                  // UUID оффера из ЛК
 *      currency:      "RUB" | "USD" | "EUR",
 *      periodicity:   "ONE_TIME" | "MONTHLY" | ...,
 *      buyerLanguage: "RU" | "EN" | "ES",
 *      paymentMethod?:"BANK_CARD" | "SBP" | ...,// опционально, если не задано — все доступные
 *      contractId?:   string,                   // наш orderId — Lava вернёт его в webhook'е
 *      utm?:          { source?, medium?, campaign?, content?, term? },
 *      clientUtm?:    {...}
 *    }
 *  response (200):
 *    {
 *      id:            string,        // contract id у Lava
 *      paymentUrl:    string,        // куда редиректить клиента
 *      status:        "new" | ...,
 *      contractId:    string         // тот же orderId
 *    }
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Webhook
 * ─────────────────────────────────────────────────────────────────────────
 *  POST на наш endpoint, JSON body:
 *    {
 *      eventType:        "payment.success" | "payment.failed"
 *                      | "subscription.recurring.payment.success"
 *                      | "subscription.recurring.payment.failed"
 *                      | "subscription.cancelled",
 *      product:          { id, title },
 *      buyer:            { email },
 *      contractId:       string,             // НАШ orderId
 *      parentContractId: string | null,
 *      amount:           number,
 *      currency:         "RUB" | ...,
 *      timestamp:        ISO-8601
 *      status:           "completed" | "failed" | ...,
 *      errorMessage?:    string
 *    }
 *  Авторизация webhook'а:
 *    Lava ставит наш api_key в `X-Api-Key` (или Basic).
 *    Мы проверяем = совпадает ли с сохранённым.
 *  IP whitelist:  158.160.60.174  (Lava отправляет с этого IP)
 */

import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const LAVATOP_BASE = "https://gate.lava.top";

export type LavatopConfig = {
  /** API-ключ из Lava.top → Integrations → Public API */
  apiKey: string;
  /** Дефолтный offerId, используется если у тарифа нет своего */
  defaultOfferId?: string;
};

export function isLavatopConfigured(config: LavatopConfig | null): boolean {
  return Boolean(config?.apiKey?.trim());
}

export type LavatopCurrency = "RUB" | "USD" | "EUR";
export type LavatopPaymentMethod = "BANK_CARD" | "SBP" | "STRIPE" | "PAYPAL" | "UNLIMINT";

/**
 * Периодичность платежа для Lava.top.
 *  - ONE_TIME — разовая оплата
 *  - MONTHLY  — подписка с авто-списанием раз в месяц
 *  - PERIOD_90_DAYS — раз в 3 месяца
 *  - PERIOD_180_DAYS — раз в полгода
 *  - PERIOD_YEAR — раз в год
 */
export type LavatopPeriodicity =
  | "ONE_TIME"
  | "MONTHLY"
  | "PERIOD_90_DAYS"
  | "PERIOD_180_DAYS"
  | "PERIOD_YEAR";

export type CreateLavatopInvoiceParams = {
  config: LavatopConfig;
  /** Email клиента — обязателен в API Lava.top */
  email: string;
  /** UUID оффера в Lava.top (берётся из тарифа или из defaultOfferId) */
  offerId: string;
  /** Валюта инвойса. Должна совпадать с валютой оффера */
  currency: LavatopCurrency;
  /** Идемпотентность: наш orderId. Lava вернёт его в webhook через `contractId` */
  contractId: string;
  /** Периодичность — ONE_TIME (разово) или MONTHLY/...  (подписка с авто-списанием) */
  periodicity?: LavatopPeriodicity;
  /** Куда редиректить после оплаты (success/fail единый url, Lava сама определит) */
  redirectUrl?: string;
  /** Куда вернуться при отмене */
  failUrl?: string;
  /** Язык покупателя для UI оплаты */
  buyerLanguage?: "RU" | "EN" | "ES";
  /** Способ оплаты — если не задан, Lava покажет все доступные */
  paymentMethod?: LavatopPaymentMethod;
  /** UTM-метки */
  clientUtm?: Record<string, string | undefined>;
};

export type CreateLavatopInvoiceResult =
  | { ok: true; contractId: string; paymentUrl: string; status: string; raw: Record<string, unknown> }
  | { ok: false; error: string; status?: number };

/**
 * Создаёт инвойс в Lava.top, возвращает URL страницы оплаты.
 * Endpoint: POST /api/v2/invoice
 */
export async function createLavatopInvoice(
  params: CreateLavatopInvoiceParams,
): Promise<CreateLavatopInvoiceResult> {
  const {
    config,
    email,
    offerId,
    currency,
    contractId,
    periodicity = "ONE_TIME",
    redirectUrl,
    failUrl,
    buyerLanguage = "RU",
    paymentMethod,
    clientUtm,
  } = params;

  const apiKey = config.apiKey?.trim();
  if (!apiKey) return { ok: false, error: "Lava.top: API-ключ не настроен" };
  if (!offerId?.trim()) return { ok: false, error: "Lava.top: не указан offerId (заполните в настройках или в тарифе)" };
  if (!email?.trim()) return { ok: false, error: "Lava.top: не указан email клиента (Lava требует email)" };

  const body: Record<string, unknown> = {
    email: email.trim(),
    offerId: offerId.trim(),
    currency,
    periodicity,
    contractId,
    buyerLanguage,
  };
  if (paymentMethod) body.paymentMethod = paymentMethod;
  if (redirectUrl) body.redirectUrl = redirectUrl;
  if (failUrl) body.failRedirectUrl = failUrl;
  if (clientUtm && Object.keys(clientUtm).length > 0) {
    const utm: Record<string, string> = {};
    for (const k of ["source", "medium", "campaign", "content", "term"] as const) {
      const v = clientUtm[k];
      if (typeof v === "string" && v.trim()) utm[k] = v.trim();
    }
    if (Object.keys(utm).length > 0) body.clientUtm = utm;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-Api-Key": apiKey,
  };

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(`${LAVATOP_BASE}/api/v2/invoice`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, proxy);

    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { ok: false, error: `Lava.top: невалидный JSON в ответе (HTTP ${res.status})`, status: res.status };
    }

    if (res.status === 401) {
      return { ok: false, error: "Lava.top: неверный API-ключ (401)", status: 401 };
    }
    if (!res.ok) {
      const msg = (data.error as string) || (data.message as string) || `HTTP ${res.status}`;
      return { ok: false, error: `Lava.top: ${msg}`, status: res.status };
    }

    const paymentUrl = (data.paymentUrl as string) || (data.payment_url as string) || (data.url as string);
    const id = (data.id as string) || (data.contractId as string) || (data.contract_id as string) || contractId;
    const status = (data.status as string) || "new";

    if (!paymentUrl) {
      return { ok: false, error: "Lava.top: API не вернул paymentUrl", status: res.status };
    }

    return { ok: true, contractId: id, paymentUrl, status, raw: data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/fetch|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|abort/i.test(message)) {
      return { ok: false, error: "Lava.top: нет связи с API (проверь интернет/прокси)" };
    }
    return { ok: false, error: `Lava.top: ${message}` };
  }
}

/**
 * Проверяет авторизацию webhook'а Lava.top.
 *
 * Lava.top подписывает webhook'и не HMAC'ом — она **просто шлёт наш api_key**
 * либо в заголовке `X-Api-Key`, либо в `Authorization: Bearer ...`. Сравниваем
 * полученный ключ с сохранённым.
 *
 * Дополнительно проверяем IP — Lava отправляет хуки с `158.160.60.174`. Если
 * webhook пришёл с другого IP И `X-Api-Key` не совпал — отказ.
 *
 * Возвращает true если авторизация прошла.
 */
export function verifyLavatopWebhookAuth(
  expectedApiKey: string,
  headers: { xApiKey?: string | undefined; authorization?: string | undefined },
): boolean {
  const expected = expectedApiKey?.trim();
  if (!expected) return false;

  const xKey = headers.xApiKey?.trim();
  if (xKey && xKey === expected) return true;

  const auth = headers.authorization?.trim();
  if (auth) {
    // "Bearer <key>"
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m && m[1] === expected) return true;
    // "Basic base64(user:key)" — некоторые конфигурации Lava
    const b = /^Basic\s+(.+)$/i.exec(auth);
    if (b) {
      try {
        const decoded = Buffer.from(b[1], "base64").toString("utf8");
        const [, pass] = decoded.split(":");
        if (pass === expected) return true;
      } catch { /* ignore */ }
    }
  }

  return false;
}

/**
 * Парсит payload webhook'а Lava.top и возвращает нормализованный результат.
 *   - eventType: тип события
 *   - contractId: НАШ orderId (мы его передавали в createLavatopInvoice)
 *   - amount: сумма платежа
 *   - currency: валюта
 *   - status: success/failed/cancelled — упрощённый
 */
export type LavatopWebhookEvent = {
  eventType: string;
  contractId: string | null;
  parentContractId: string | null;
  amount: number | null;
  currency: string | null;
  buyerEmail: string | null;
  productId: string | null;
  productTitle: string | null;
  timestamp: string | null;
  status: "success" | "failed" | "cancelled" | "unknown";
  errorMessage: string | null;
  raw: Record<string, unknown>;
};

export function parseLavatopWebhook(body: Record<string, unknown>): LavatopWebhookEvent {
  const eventType = String(body.eventType ?? body.event_type ?? body.type ?? "").trim();
  const contractId = ((body.contractId as string) ?? (body.contract_id as string) ?? null) || null;
  const parentContractId = ((body.parentContractId as string) ?? (body.parent_contract_id as string) ?? null) || null;
  const amountRaw = body.amount ?? null;
  const amount = typeof amountRaw === "number"
    ? amountRaw
    : typeof amountRaw === "string"
      ? Number(amountRaw)
      : null;
  const currency = ((body.currency as string) ?? null) || null;

  const buyer = (body.buyer && typeof body.buyer === "object")
    ? (body.buyer as Record<string, unknown>)
    : {};
  const product = (body.product && typeof body.product === "object")
    ? (body.product as Record<string, unknown>)
    : {};

  let status: LavatopWebhookEvent["status"] = "unknown";
  if (/payment\.success|subscription\..+\.success/i.test(eventType)) status = "success";
  else if (/payment\.failed|subscription\..+\.failed/i.test(eventType)) status = "failed";
  else if (/subscription\.cancelled|cancelled/i.test(eventType)) status = "cancelled";
  else {
    const s = String(body.status ?? "").toLowerCase();
    if (s === "completed" || s === "success" || s === "paid") status = "success";
    else if (s === "failed" || s === "error") status = "failed";
    else if (s === "cancelled" || s === "canceled") status = "cancelled";
  }

  return {
    eventType,
    contractId,
    parentContractId,
    amount: Number.isFinite(amount as number) ? (amount as number) : null,
    currency,
    buyerEmail: (buyer.email as string) || null,
    productId: (product.id as string) || null,
    productTitle: (product.title as string) || null,
    timestamp: (body.timestamp as string) || null,
    status,
    errorMessage: (body.errorMessage as string) || (body.error_message as string) || null,
    raw: body,
  };
}
