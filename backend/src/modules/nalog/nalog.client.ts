/**
 * HTTP-клиент для API «Мой Налог» (lknpd.nalog.ru) — регистрация доходов самозанятых.
 * Реализация на основе API из PHP-библиотеки shoman4eg/moy-nalog и Python-порта nalogo.
 */

import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const BASE_URL = "https://lknpd.nalog.ru/api/v1";
const APP_VERSION = "1.0.0";
const SOURCE_TYPE = "WEB";

export interface NalogTokens {
  token: string;
  refreshToken: string;
  tokenExpireIn: string;
}

export interface NalogDeviceInfo {
  sourceDeviceId: string;
  sourceType: string;
  appVersion: string;
  metaDetails: Record<string, unknown>;
}

export interface NalogServiceItem {
  name: string;
  amount: number;
  quantity: number;
}

export interface NalogIncomeClient {
  contactPhone?: string;
  displayName?: string;
  incomeType: "FROM_INDIVIDUAL" | "FROM_LEGAL_ENTITY" | "FROM_FOREIGN_AGENCY";
  inn?: string;
}

export interface CreateIncomeParams {
  paymentType: "CASH" | "ACCOUNT";
  services: NalogServiceItem[];
  totalAmount: number;
  operationTime: string;
  client?: NalogIncomeClient | null;
}

export interface CreateIncomeResult {
  approvedReceiptUuid: string;
}

function buildDeviceInfo(deviceId: string): NalogDeviceInfo {
  return {
    sourceDeviceId: deviceId,
    sourceType: SOURCE_TYPE,
    appVersion: APP_VERSION,
    metaDetails: {},
  };
}

async function nalogFetch(
  path: string,
  options: { method?: string; body?: string; token?: string },
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

  try {
    const proxy = await getProxyUrl("telegram");
    const res = await proxyFetch(url, {
      method: options.method ?? "POST",
      headers,
      body: options.body,
    }, proxy);
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) {
      const msg = typeof data === "object" && data !== null ? (data as Record<string, unknown>).message ?? text : text;
      return { ok: false, status: res.status, data, error: String(msg) };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function nalogAuth(inn: string, password: string, deviceId: string): Promise<NalogTokens> {
  const res = await nalogFetch("/auth/lkfl", {
    body: JSON.stringify({ inn, password, deviceInfo: buildDeviceInfo(deviceId) }),
  });
  if (!res.ok) throw new Error(`Nalog auth failed: ${res.error}`);
  const d = res.data as Record<string, unknown>;
  return {
    token: String(d.token ?? ""),
    refreshToken: String(d.refreshToken ?? ""),
    tokenExpireIn: String(d.tokenExpireIn ?? ""),
  };
}

export async function nalogRefreshToken(refreshToken: string, deviceId: string): Promise<NalogTokens> {
  const res = await nalogFetch("/auth/token", {
    body: JSON.stringify({ refreshToken, deviceInfo: buildDeviceInfo(deviceId) }),
  });
  if (!res.ok) throw new Error(`Nalog token refresh failed: ${res.error}`);
  const d = res.data as Record<string, unknown>;
  return {
    token: String(d.token ?? ""),
    refreshToken: String(d.refreshToken ?? ""),
    tokenExpireIn: String(d.tokenExpireIn ?? ""),
  };
}

export async function nalogCreateIncome(
  token: string,
  params: CreateIncomeParams,
): Promise<CreateIncomeResult> {
  const now = new Date().toISOString();
  const body = {
    paymentType: params.paymentType,
    ignoreMaxTotalIncomeRestriction: false,
    client: params.client ?? null,
    requestTime: now,
    operationTime: params.operationTime,
    services: params.services.map((s) => ({
      name: s.name,
      amount: Number(s.amount.toFixed(2)),
      quantity: s.quantity,
    })),
    totalAmount: Number(params.totalAmount.toFixed(2)),
  };

  const res = await nalogFetch("/income", { body: JSON.stringify(body), token });
  if (!res.ok) throw new Error(`Nalog create income failed: ${res.error}`);
  const d = res.data as Record<string, unknown>;
  return { approvedReceiptUuid: String(d.approvedReceiptUuid ?? "") };
}

export async function nalogCancelIncome(
  token: string,
  receiptUuid: string,
  comment: string,
): Promise<void> {
  const now = new Date().toISOString();
  const body = {
    receiptUuid,
    comment,
    requestTime: now,
    operationTime: now,
    partnerCode: null,
  };
  const res = await nalogFetch("/cancel", { body: JSON.stringify(body), token });
  if (!res.ok) throw new Error(`Nalog cancel income failed: ${res.error}`);
}

export function nalogReceiptPrintUrl(receiptUuid: string): string {
  return `https://lknpd.nalog.ru/api/v1/receipt/${receiptUuid}/print`;
}
