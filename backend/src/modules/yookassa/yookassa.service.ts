/**
 * ЮKassa API — создание платежа (redirect на страницу оплаты).
 * Документация: https://yookassa.ru/developers/api#create_payment
 */

import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const YOOKASSA_API = "https://api.yookassa.ru/v3";

/**
 * Placeholder-email для receipts, когда юзер отказался от чека.
 * 54-ФЗ требует email в `receipt.customer.email`, но реальные чеки слать некуда —
 * подставляем правдоподобный адрес на популярных доменах.
 *
 * Если у клиента есть Telegram-username — используем его как локальную часть
 * (`ivan_petrov2913@mail.ru`), иначе fallback на полностью случайный.
 */
const PLACEHOLDER_DOMAINS = [
  "gmail.com", "mail.ru", "yandex.ru", "outlook.com",
  "icloud.com", "hotmail.com", "rambler.ru", "bk.ru",
  "list.ru", "inbox.ru", "yahoo.com",
];

function generatePlaceholderEmail(tgUsername?: string | null): string {
  const domain = PLACEHOLDER_DOMAINS[Math.floor(Math.random() * PLACEHOLDER_DOMAINS.length)];
  if (tgUsername && typeof tgUsername === "string") {
    // Чистим username: только [a-z0-9_.], lowercase, max 24 chars.
    const cleaned = tgUsername.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24);
    if (cleaned.length >= 3) {
      // Добавляем 3–4 цифры для уникальности (стиль "ivan2008" — выглядит реалистично).
      const suffix = Math.floor(Math.random() * 9000) + 100;
      return `${cleaned}${suffix}@${domain}`;
    }
  }
  // Fallback: полностью случайный.
  const a = Math.random().toString(36).slice(2, 10);
  const b = Math.random().toString(36).slice(2, 6);
  return `${a}${b}@${domain}`;
}

export type CreatePaymentParams = {
  shopId: string;
  secretKey: string;
  amount: number;
  currency: string;
  returnUrl: string;
  description: string;
  metadata: Record<string, string>;
  /** Email покупателя для чека 54-ФЗ (обязателен при включённых чеках в ЮKassa) */
  customerEmail?: string | null;
  /** TG-username клиента; используется как имя в placeholder-email
   *  если customerEmail не задан (генерится `<tg_username><цифры>@<random-domain>`). */
  customerTelegramUsername?: string | null;
  /** Сохранить способ оплаты для рекуррентных платежей */
  savePaymentMethod?: boolean;
};

export type CreatePaymentResult =
  | { ok: true; paymentId: string; confirmationUrl: string; status: string }
  | { ok: false; error: string; status?: number };

/**
 * Создаёт платёж в ЮKassa. Возвращает confirmation_url для редиректа пользователя.
 * Idempotence-Key: генерируется из metadata.payment_id + timestamp для уникальности.
 */
export async function createYookassaPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const { shopId, secretKey, amount, currency, returnUrl, description, metadata, customerEmail, customerTelegramUsername, savePaymentMethod } = params;
  if (!shopId?.trim() || !secretKey?.trim()) {
    return { ok: false, error: "YooKassa not configured" };
  }

  const valueStr = amount.toFixed(2);
  const currencyUpper = currency.toUpperCase();

  // Чек 54-ФЗ (обязателен, если в ЛК ЮKassa включены «Чеки от ЮKassa»).
  // для wolfpn используется УСН (доходы) + НДС 5%:
  //   tax_system_code = 2  (УСН доходы)        — https://yookassa.ru/developers/payment-acceptance/scenario-extensions/receipts#tax-system-codes
  //   vat_code        = 7  (НДС по ставке 5%)  — https://yookassa.ru/developers/payment-acceptance/scenario-extensions/receipts#vat-codes
  const receipt = {
    customer: {
      email: (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))
        ? customerEmail.trim()
        : generatePlaceholderEmail(customerTelegramUsername),
    },
    tax_system_code: 2,
    items: [
      {
        description: description.slice(0, 128) || "Оплата подписки",
        quantity: "1.00",
        amount: { value: valueStr, currency: currencyUpper },
        vat_code: 7,
        payment_subject: "service" as const,
        payment_mode: "full_payment" as const,
      },
    ],
  };

  const body: Record<string, unknown> = {
    amount: { value: valueStr, currency: currencyUpper },
    capture: true,
    confirmation: { type: "redirect" as const, return_url: returnUrl },
    description: description.slice(0, 128),
    metadata,
    receipt,
  };

  if (savePaymentMethod) {
    body.save_payment_method = true;
  }

  const idempotenceKey = `${metadata.payment_id ?? "pay"}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const auth = Buffer.from(`${shopId.trim()}:${secretKey.trim()}`).toString("base64");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(`${YOOKASSA_API}/payments`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Idempotence-Key": idempotenceKey,
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    }, proxy);
    clearTimeout(timeoutId);

    let data: {
      id?: string;
      status?: string;
      confirmation?: { confirmation_url?: string };
      description?: string;
      code?: string;
      parameter?: string;
      [key: string]: unknown;
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return { ok: false, error: `YooKassa: ответ не JSON (${res.status})`, status: res.status };
    }

    if (!res.ok) {
      const parts = [data.description ?? data.code ?? res.statusText ?? "YooKassa error"];
      if (data.parameter) parts.push(`Параметр: ${data.parameter}`);
      return { ok: false, error: parts.join(". "), status: res.status };
    }

    const confirmationUrl = data.confirmation?.confirmation_url;
    if (!data.id || !confirmationUrl) {
      return { ok: false, error: "No id or confirmation_url in response" };
    }

    return {
      ok: true,
      paymentId: data.id,
      confirmationUrl,
      status: data.status ?? "pending",
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    const isNetwork =
      message === "fetch failed" ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND") ||
      message.includes("ETIMEDOUT") ||
      message.includes("network") ||
      (e instanceof Error && e.name === "AbortError");
    if (isNetwork) {
      return {
        ok: false,
        error:
          "Сервер не может подключиться к ЮKassa (api.yookassa.ru). Проверьте доступ в интернет, firewall и DNS на сервере.",
      };
    }
    return { ok: false, error: message };
  }
}

export function isYookassaConfigured(shopId: string | null, secretKey: string | null): boolean {
  return Boolean(shopId?.trim() && secretKey?.trim());
}

// ────────────────────────────────────────────
// Автоплатёж по сохранённому способу оплаты
// ────────────────────────────────────────────

export type AutopaymentParams = {
  shopId: string;
  secretKey: string;
  amount: number;
  currency: string;
  paymentMethodId: string;
  description: string;
  metadata: Record<string, string>;
  customerEmail?: string | null;
  /** для placeholder-email (см. createYookassaPayment). */
  customerTelegramUsername?: string | null;
};

export type AutopaymentResult =
  | { ok: true; paymentId: string; status: string }
  | { ok: false; error: string; reason?: string };

/**
 * Создаёт автоплатёж через сохранённый payment_method_id.
 * Не требует подтверждения пользователя — деньги списываются сразу (capture: true).
 */
export async function createYookassaAutopayment(params: AutopaymentParams): Promise<AutopaymentResult> {
  const { shopId, secretKey, amount, currency, paymentMethodId, description, metadata, customerEmail, customerTelegramUsername } = params;
  if (!shopId?.trim() || !secretKey?.trim()) {
    return { ok: false, error: "YooKassa not configured" };
  }

  const valueStr = amount.toFixed(2);
  const currencyUpper = currency.toUpperCase();

  // те же коды что в createYookassaPayment.
  const receipt = {
    customer: {
      email: (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))
        ? customerEmail.trim()
        : generatePlaceholderEmail(customerTelegramUsername),
    },
    tax_system_code: 2,
    items: [
      {
        description: description.slice(0, 128) || "Автопродление подписки",
        quantity: "1.00",
        amount: { value: valueStr, currency: currencyUpper },
        vat_code: 7,
        payment_subject: "service" as const,
        payment_mode: "full_payment" as const,
      },
    ],
  };

  const body = {
    amount: { value: valueStr, currency: currencyUpper },
    capture: true,
    payment_method_id: paymentMethodId,
    description: description.slice(0, 128),
    metadata,
    receipt,
  };

  const idempotenceKey = `autopay-${metadata.payment_id ?? "pay"}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const auth = Buffer.from(`${shopId.trim()}:${secretKey.trim()}`).toString("base64");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(`${YOOKASSA_API}/payments`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Idempotence-Key": idempotenceKey,
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    }, proxy);
    clearTimeout(timeoutId);

    let data: {
      id?: string;
      status?: string;
      cancellation_details?: { party?: string; reason?: string };
      description?: string;
      code?: string;
      [key: string]: unknown;
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return { ok: false, error: `YooKassa: ответ не JSON (${res.status})` };
    }

    if (!res.ok) {
      return { ok: false, error: data.description ?? data.code ?? res.statusText ?? "YooKassa error" };
    }

    if (!data.id) {
      return { ok: false, error: "No payment id in response" };
    }

    // Автоплатёж с capture: true должен мгновенно вернуть succeeded, если карта списалась.
    // pending / waiting_for_capture — это НЕ готовый к активации платёж (нужна доп. проверка/3DS),
    // поэтому активировать тариф сейчас нельзя — иначе тариф выдадут, а деньги не спишутся.
    if (data.status === "succeeded") {
      return { ok: true, paymentId: data.id, status: data.status };
    }

    if (data.status === "canceled") {
      const reason = data.cancellation_details?.reason ?? "unknown";
      return { ok: false, error: `Автоплатёж отклонён: ${reason}`, reason };
    }

    return {
      ok: false,
      error: `Автоплатёж не завершён (статус: ${data.status ?? "unknown"})`,
      reason: data.status ?? undefined,
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    const isNetwork =
      message === "fetch failed" ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND") ||
      message.includes("ETIMEDOUT") ||
      message.includes("network") ||
      (e instanceof Error && e.name === "AbortError");
    if (isNetwork) {
      return { ok: false, error: "Сервер не может подключиться к ЮKassa" };
    }
    return { ok: false, error: message };
  }
}
