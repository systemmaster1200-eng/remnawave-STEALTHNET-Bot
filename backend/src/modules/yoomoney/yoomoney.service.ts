/**
 * Интеграция с API кошелька ЮMoney (OAuth, request-payment, process-payment).
 * Документация: https://yoomoney.ru/docs/wallet
 */

import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const YOOMONEY_OAUTH = "https://yoomoney.ru/oauth";
const YOOMONEY_API = "https://yoomoney.ru/api";

/** Права: информация о счёте и переводы на счёт (P2P) */
const DEFAULT_SCOPE = "account-info payment-p2p";

export function getAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const scope = params.scope ?? DEFAULT_SCOPE;
  const q = new URLSearchParams({
    client_id: params.clientId,
    response_type: "code",
    redirect_uri: params.redirectUri,
    scope,
    state: params.state,
  });
  return `${YOOMONEY_OAUTH}/authorize?${q.toString()}`;
}

export async function exchangeCodeForToken(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  clientSecret?: string | null;
}): Promise<{ access_token: string } | { error: string }> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
  });
  if (params.clientSecret?.trim()) {
    body.set("client_secret", params.clientSecret.trim());
  }
  const proxy = await getProxyUrl("payments");
  const res = await proxyFetch(`${YOOMONEY_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, proxy);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || data.error) {
    return { error: data.error ?? `HTTP ${res.status}` };
  }
  if (!data.access_token) {
    return { error: "No access_token in response" };
  }
  return { access_token: data.access_token };
}

/** Ответ request-payment: success + request_id + money_source или refused + error */
export type RequestPaymentResult =
  | { status: "success"; request_id: string; money_source: Record<string, unknown>; balance?: number; contract_amount?: number }
  | { status: "refused"; error: string; error_description?: string };

export async function requestPayment(
  accessToken: string,
  params: { to: string; amount_due: number; label: string; message?: string; comment?: string }
): Promise<RequestPaymentResult> {
  const body = new URLSearchParams({
    pattern_id: "p2p",
    to: params.to,
    amount_due: String(params.amount_due),
    label: params.label,
  });
  if (params.message?.trim()) body.set("message", params.message.trim());
  if (params.comment?.trim()) body.set("comment", params.comment.trim());

  const proxy = await getProxyUrl("payments");
  const res = await proxyFetch(`${YOOMONEY_API}/request-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${accessToken}`,
    },
    body: body.toString(),
  }, proxy);
  const data = (await res.json()) as { status?: string; request_id?: string; money_source?: Record<string, unknown>; error?: string; error_description?: string; balance?: number; contract_amount?: number };
  if (data.status === "refused") {
    return { status: "refused", error: data.error ?? "refused", error_description: data.error_description };
  }
  if (data.status === "success" && data.request_id) {
    return {
      status: "success",
      request_id: data.request_id,
      money_source: data.money_source ?? {},
      balance: data.balance,
      contract_amount: data.contract_amount,
    };
  }
  return { status: "refused", error: data.error ?? "Unknown error", error_description: data.error_description };
}

/** Ответ process-payment: success | refused | in_progress | ext_auth_required */
export type ProcessPaymentResult =
  | { status: "success"; payment_id?: string; balance?: number }
  | { status: "refused"; error: string }
  | { status: "in_progress"; next_retry?: number }
  | { status: "ext_auth_required"; acs_uri?: string; acs_params?: Record<string, string> };

export async function processPayment(
  accessToken: string,
  params: { request_id: string; money_source?: string; csc?: string }
): Promise<ProcessPaymentResult> {
  const body = new URLSearchParams({ request_id: params.request_id });
  if (params.money_source?.trim()) body.set("money_source", params.money_source.trim());
  if (params.csc?.trim()) body.set("csc", params.csc.trim());

  const proxy = await getProxyUrl("payments");
  const res = await proxyFetch(`${YOOMONEY_API}/process-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${accessToken}`,
    },
    body: body.toString(),
  }, proxy);
  const data = (await res.json()) as {
    status?: string;
    payment_id?: string;
    balance?: number;
    error?: string;
    next_retry?: number;
    acs_uri?: string;
    acs_params?: Record<string, string>;
  };
  const status = (data.status ?? "").toLowerCase();
  if (status === "success") {
    return { status: "success", payment_id: data.payment_id, balance: data.balance };
  }
  if (status === "refused") {
    return { status: "refused", error: data.error ?? "refused" };
  }
  if (status === "in_progress") {
    return { status: "in_progress", next_retry: data.next_retry };
  }
  if (status === "ext_auth_required") {
    return { status: "ext_auth_required", acs_uri: data.acs_uri, acs_params: data.acs_params };
  }
  return { status: "refused", error: data.error ?? data.status ?? "Unknown" };
}
