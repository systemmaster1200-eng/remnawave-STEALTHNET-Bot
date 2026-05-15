/**
 * Дополнительный клиент для новых эндпоинтов конкурсов: undo-draw, apply prize, manual winners,
 * audit log. Не модифицирует основной api.ts чтобы не плодить там 4000+ строк.
 */

const BASE = "/api/admin/contests";

async function req<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
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

export interface ContestEventRow {
  id: string;
  contestId: string;
  kind: string;
  actorId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export const contestExtrasApi = {
  undoDraw: (token: string, contestId: string) =>
    req<{ message: string; refunded: number }>(token, `/${contestId}/undo-draw`, { method: "POST" }),

  applyPrize: (token: string, contestId: string, winnerId: string) =>
    req<{ message: string; newExpireAt?: string }>(token, `/${contestId}/winners/${winnerId}/apply`, { method: "POST" }),

  removeWinner: (token: string, contestId: string, winnerId: string) =>
    req<{ message: string; refunded: number }>(token, `/${contestId}/winners/${winnerId}`, { method: "DELETE" }),

  addManualWinner: (
    token: string,
    contestId: string,
    body: { clientId: string; place: number; prizeType: "custom" | "balance" | "vpn_days"; prizeValue: string },
  ) =>
    req<{ id: string }>(token, `/${contestId}/winners`, { method: "POST", body: JSON.stringify(body) }),

  getEvents: (token: string, contestId: string) =>
    req<ContestEventRow[]>(token, `/${contestId}/events`),
};
