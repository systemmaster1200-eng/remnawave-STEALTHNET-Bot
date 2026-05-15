/**
 * Унифицированный клиент для новых админских эндпоинтов:
 * - audit log
 * - webhook inbox
 * - diagnostics (health / crons / logs)
 * - quick search
 * - admin security (logout-all, logout-admin)
 */

const API_BASE = "/api/admin";

async function req<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = res.statusText;
    try {
      const parsed = JSON.parse(txt) as { message?: string };
      if (parsed.message) msg = parsed.message;
    } catch {
      if (txt) msg = txt;
    }
    throw new Error(`${res.status}: ${msg}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Audit ────────────────────────────────────────────────────────────────

export interface AdminEvent {
  id: string;
  kind: string;
  actorId: string | null;
  actorIp: string | null;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditFacets {
  kinds: string[];
  actors: string[];
  targetTypes: string[];
}

export const auditApi = {
  list: (token: string, params: {
    kind?: string;
    actorId?: string;
    targetType?: string;
    targetId?: string;
    q?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    cursor?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return req<{ items: AdminEvent[]; nextCursor: string | null }>(token, `/audit?${qs.toString()}`);
  },
  facets: (token: string) => req<AuditFacets>(token, `/audit/facets`),
};

// ─── Webhook inbox ────────────────────────────────────────────────────────

export interface WebhookEventListItem {
  id: string;
  provider: string;
  remoteIp: string | null;
  responseStatus: number;
  outcome: string;
  errorMessage: string | null;
  paymentId: string | null;
  durationMs: number | null;
  replayedBy: string | null;
  replayOfId: string | null;
  createdAt: string;
}

export interface WebhookEventDetail extends WebhookEventListItem {
  rawBody: string;
  headers: Record<string, string>;
}

export const webhookInboxApi = {
  list: (token: string, params: {
    provider?: string;
    outcome?: string;
    paymentId?: string;
    q?: string;
    limit?: number;
    cursor?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return req<{ items: WebhookEventListItem[]; nextCursor: string | null }>(token, `/webhook-inbox?${qs.toString()}`);
  },
  get: (token: string, id: string) => req<WebhookEventDetail>(token, `/webhook-inbox/${id}`),
  replay: (token: string, id: string) =>
    req<{ ok: boolean; replayedHttpStatus?: number }>(token, `/webhook-inbox/${id}/replay`, { method: "POST" }),
};

// ─── Diagnostics ──────────────────────────────────────────────────────────

export interface HealthCheck {
  name: string;
  status: "ok" | "warn" | "error" | "skip";
  detail?: string;
  meta?: Record<string, unknown>;
  durationMs?: number;
}

export interface HealthResponse {
  overallStatus: "ok" | "warn" | "error";
  checks: HealthCheck[];
  timestamp: string;
}

export interface CronEntry {
  name: string;
  cron: string;
  description: string | null;
  running: boolean;
  registeredAt: string;
  nextRunAt: string | null;
  recent: Array<{ startedAt: string; finishedAt: string | null; ok: boolean; error?: string; durationMs: number }>;
  canTrigger: boolean;
}

export const diagnosticsApi = {
  health: (token: string) => req<HealthResponse>(token, `/diagnostics/health`),
  crons: (token: string) => req<{ items: CronEntry[] }>(token, `/diagnostics/crons`),
  triggerCron: (token: string, name: string) =>
    req<{ ok: boolean }>(token, `/diagnostics/crons/${encodeURIComponent(name)}/trigger`, { method: "POST" }),
  logs: (token: string, params: { lines?: number; filter?: string; container?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return req<{ container: string; lines: number; text: string }>(token, `/diagnostics/logs?${qs.toString()}`);
  },
};

// ─── Quick search ─────────────────────────────────────────────────────────

export interface QuickSearchResult {
  group: string;
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  score: number;
}

export const quickSearchApi = {
  search: (token: string, q: string) =>
    req<{ items: QuickSearchResult[] }>(token, `/quick-search?q=${encodeURIComponent(q)}`),
};

// ─── Admin security ───────────────────────────────────────────────────────

export const adminSecurityApi = {
  logoutAll: (token: string, opts: { includingMe?: boolean; reason?: string } = {}) =>
    req<{ ok: boolean; deletedTokens: number; message: string }>(token, `/security/logout-all`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  logoutAdmin: (token: string, adminId: string) =>
    req<{ ok: boolean; adminEmail: string; deletedTokens: number }>(token, `/security/logout-admin/${encodeURIComponent(adminId)}`, {
      method: "POST",
    }),
};

// ─── Notifications counters (inbox bell) ─────────────────────────────────

export interface NotificationCounter {
  key: string;
  label: string;
  count: number;
  url: string;
  severity: "info" | "warn" | "error";
}

export const notificationsApi = {
  counters: (token: string) =>
    req<{ counters: NotificationCounter[]; total: number }>(token, `/notifications/counters`),
};

// ─── Payment actions (refund / mark-failed / retry-activation) ───────────

export interface PaymentDetailPayment {
  id: string;
  clientId: string;
  amount: number;
  currency: string;
  status: string;
  provider: string | null;
  externalId: string | null;
  orderId: string;
  tariffId: string | null;
  proxyTariffId: string | null;
  singboxTariffId: string | null;
  createdAt: string;
  paidAt: string | null;
  metadata: string | null;
  client: {
    id: string;
    email: string | null;
    telegramId: string | null;
    telegramUsername: string | null;
    balance: number;
    isBlocked: boolean;
  };
}

export interface PaymentDetailResponse {
  payment: PaymentDetailPayment;
  referralCredits: Array<{
    id: string;
    amount: number;
    referrerId: string;
    paymentId: string;
    referrer?: { id: string; email: string | null; telegramUsername: string | null };
  }>;
}

export interface RefundResult {
  ok: boolean;
  payment: PaymentDetailPayment;
  summary: {
    creditedToBalance: number;
    reversedReferralAmount: number;
    reversedReferralCount: number;
  };
}

export const paymentActionsApi = {
  details: (token: string, paymentId: string) =>
    req<PaymentDetailResponse>(token, `/payments/${encodeURIComponent(paymentId)}`),
  markFailed: (token: string, paymentId: string, reason?: string) =>
    req<{ ok: boolean; payment: PaymentDetailPayment }>(token, `/payments/${encodeURIComponent(paymentId)}/mark-failed`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? "" }),
    }),
  refund: (token: string, paymentId: string, opts: {
    refundToBalance?: boolean;
    reverseReferrals?: boolean;
    reason?: string;
  } = {}) =>
    req<RefundResult>(token, `/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  retryActivation: (token: string, paymentId: string) =>
    req<{ ok: boolean; result: unknown }>(token, `/payments/${encodeURIComponent(paymentId)}/retry-activation`, {
      method: "POST",
    }),
};

// ─── Bulk client actions ─────────────────────────────────────────────────

export type BulkClientAction =
  | "block"
  | "unblock"
  | "credit_balance"
  | "debit_balance"
  | "reset_trial"
  | "mark_unreachable"
  | "mark_reachable";

export interface BulkClientResult {
  total: number;
  ok: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}

export const clientsBulkApi = {
  bulk: (token: string, payload: {
    action: BulkClientAction;
    ids: string[];
    params?: { reason?: string; amount?: number; note?: string };
  }) =>
    req<BulkClientResult>(token, `/clients/bulk`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

// ─── Business analytics ──────────────────────────────────────────────────

export interface KpiByCurrency {
  currency: string;
  mrr: number;
  totalRevenue: number;
  arpu: number;
  ltv: number;
  paidCount: number;
  payingClients: number;
}

export interface ChurnStat {
  prevPeriodPayingClients: number;
  retainedClients: number;
  churnedClients: number;
  churnRate: number;
}

export interface CohortRow {
  weekStart: string;
  cohortSize: number;
  retention: { week: number; active: number; pct: number }[];
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  pctOfPrev: number;
  pctOfStart: number;
}

export interface ProviderRow {
  provider: string;
  total: number;
  paid: number;
  failed: number;
  refunded: number;
  successRate: number;
  avgSecondsToPaid: number | null;
  revenueByCurrency: { currency: string; amount: number }[];
  avgAmountByCurrency: { currency: string; amount: number }[];
}

export interface BusinessAnalyticsResponse {
  windowDays: number;
  windowStart: string;
  generatedAt: string;
  kpis: KpiByCurrency[];
  churn: ChurnStat;
  cohorts: CohortRow[];
  funnel: FunnelStep[];
  providers: ProviderRow[];
}

export const businessAnalyticsApi = {
  get: (token: string, days = 30) =>
    req<BusinessAnalyticsResponse>(token, `/business-analytics?days=${days}`),
};

// ─── Anti-fraud signals ──────────────────────────────────────────────────

export interface FraudSignal {
  key: string;
  label: string;
  description: string;
  severity: "info" | "warn" | "error";
  count: number;
  topItems?: Array<Record<string, unknown>>;
}

export const antiFraudApi = {
  signals: (token: string) =>
    req<{ generatedAt: string; signals: FraudSignal[]; total: number }>(token, `/anti-fraud/signals`),
  detail: (token: string, key: string, limit = 50) =>
    req<{ key: string; items: Array<Record<string, unknown>>; total: number }>(token, `/anti-fraud/signal/${encodeURIComponent(key)}?limit=${limit}`),
};

// ─── Admin permissions (granular actions) ────────────────────────────────

export interface ActionDef {
  key: string;
  label: string;
  description: string;
  group: "payments" | "clients" | "security" | "operations";
  severity: "info" | "warn" | "critical";
}

export const adminPermissionsApi = {
  actions: (token: string) =>
    req<{ actions: ActionDef[] }>(token, `/admin-permissions/actions`),
  get: (token: string, adminId: string) =>
    req<{ adminId: string; email: string; role: string; sections: string[]; actions: string[] }>(token, `/admin-permissions/${encodeURIComponent(adminId)}`),
  set: (token: string, adminId: string, actions: string[]) =>
    req<{ ok: boolean; actions: string[] }>(token, `/admin-permissions/${encodeURIComponent(adminId)}`, {
      method: "PUT",
      body: JSON.stringify({ actions }),
    }),
};

// ─── Email templates ─────────────────────────────────────────────────────

export interface EmailTemplate {
  key: string;
  label: string;
  description: string;
  variables: { name: string; example: string; required?: boolean }[];
  subject: string;
  body: string;
  isDefault?: boolean;
}

export const emailTemplatesApi = {
  list: (token: string) => req<{ items: EmailTemplate[] }>(token, `/email-templates/list`),
  get: (token: string, key: string) => req<EmailTemplate>(token, `/email-templates/${encodeURIComponent(key)}`),
  update: (token: string, key: string, subject: string, body: string) =>
    req<{ ok: boolean } & EmailTemplate>(token, `/email-templates/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ subject, body }),
    }),
  preview: (token: string, key: string, vars?: Record<string, string>) =>
    req<{ subject: string; body: string; vars: Record<string, string> }>(token, `/email-templates/${encodeURIComponent(key)}/preview`, {
      method: "POST",
      body: JSON.stringify({ vars: vars ?? {} }),
    }),
  sendTest: (token: string, key: string, toEmail: string, vars?: Record<string, string>) =>
    req<{ ok: boolean }>(token, `/email-templates/${encodeURIComponent(key)}/send-test`, {
      method: "POST",
      body: JSON.stringify({ toEmail, vars: vars ?? {} }),
    }),
};

// ─── Bot messages ────────────────────────────────────────────────────────

export interface BotMessage {
  key: string;
  group: string;
  label: string;
  description: string;
  valueType: "text" | "json" | "markdown" | "boolean" | "number";
  variables?: string[];
  value: string;
}

export const botMessagesApi = {
  list: (token: string) => req<{ items: BotMessage[] }>(token, `/bot-messages/list`),
  get: (token: string, key: string) => req<BotMessage>(token, `/bot-messages/${encodeURIComponent(key)}`),
  update: (token: string, key: string, value: string) =>
    req<{ ok: boolean; key: string; value: string }>(token, `/bot-messages/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
};

// ─── Bot conversations (timeline per client) ─────────────────────────────

export interface BotConversationListItem {
  id: string;
  email: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  balance: number;
  isBlocked: boolean;
  telegramUnreachable: boolean;
  trialUsed: boolean;
  createdAt: string;
  updatedAt: string;
  counts: { payments: number; tickets: number; broadcasts: number };
}

export interface TimelineEvent {
  ts: string;
  kind: "registered" | "payment_paid" | "payment_failed" | "payment_refunded" | "broadcast" | "ticket_opened" | "ticket_message" | "gift" | "admin_action";
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export const botConversationsApi = {
  list: (token: string, params: { q?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return req<{ items: BotConversationListItem[]; total: number }>(token, `/bot-conversations?${qs.toString()}`);
  },
  detail: (token: string, clientId: string) =>
    req<{
      client: Record<string, unknown>;
      events: TimelineEvent[];
      stats: { totalPayments: number; paidPayments: number; totalTickets: number; totalBroadcasts: number; totalAdminActions: number };
    }>(token, `/bot-conversations/${encodeURIComponent(clientId)}`),
};
