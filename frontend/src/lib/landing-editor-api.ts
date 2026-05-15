/**
 * Клиент для админских эндпоинтов редактора лендинга — `/api/admin/landing/*`.
 * Использует Bearer-токен из useAuth.
 */

const API_BASE = "/api/admin/landing";

export interface AdminLandingBlock {
  id: string;
  type: string;
  variant: string;
  order: number;
  visible: boolean;
  props: Record<string, unknown>;
  i18n: Record<string, unknown>;
  propsDraft: Record<string, unknown> | null;
  i18nDraft: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminLandingTheme {
  id: string;
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  fontFamily: string | null;
  fontPresets: { name: string; url: string }[];
  borderRadius: string | null;
  containerWidth: string | null;
  customCss: string | null;
  draft: Record<string, unknown> | null;
  updatedAt: string;
}

export interface AdminLandingSnapshot {
  id: string;
  label: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface DraftsStatus {
  hasBlockDrafts: boolean;
  hasThemeDraft: boolean;
}

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

export const landingEditorApi = {
  listBlocks: (token: string) => req<AdminLandingBlock[]>(token, "/blocks"),
  getBlock: (token: string, id: string) => req<AdminLandingBlock>(token, `/blocks/${id}`),
  createBlock: (token: string, body: { type: string; variant?: string; props?: unknown; i18n?: unknown; visible?: boolean }) =>
    req<AdminLandingBlock>(token, "/blocks", { method: "POST", body: JSON.stringify(body) }),
  updateBlock: (token: string, id: string, body: { propsDraft?: unknown; i18nDraft?: unknown; visible?: boolean; variant?: string; order?: number }) =>
    req<AdminLandingBlock>(token, `/blocks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteBlock: (token: string, id: string) => req<void>(token, `/blocks/${id}`, { method: "DELETE" }),
  reorderBlocks: (token: string, items: { id: string; order: number }[]) =>
    req<AdminLandingBlock[]>(token, "/blocks/reorder", { method: "POST", body: JSON.stringify({ items }) }),
  publishBlock: (token: string, id: string) => req<AdminLandingBlock>(token, `/blocks/${id}/publish`, { method: "POST" }),
  discardBlockDraft: (token: string, id: string) => req<AdminLandingBlock>(token, `/blocks/${id}/discard-draft`, { method: "POST" }),
  applyBlockDefaults: (token: string, id: string, mode: "merge" | "overwrite" = "merge") =>
    req<AdminLandingBlock>(token, `/blocks/${id}/apply-defaults`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  seedDefaults: (token: string) =>
    req<{ filled: number; total: number }>(token, `/seed-defaults`, { method: "POST" }),

  getTheme: (token: string) => req<AdminLandingTheme>(token, "/theme"),
  updateThemeDraft: (token: string, draft: Record<string, unknown> | null) =>
    req<AdminLandingTheme>(token, "/theme", { method: "PATCH", body: JSON.stringify({ draft }) }),
  publishTheme: (token: string) => req<AdminLandingTheme>(token, "/theme/publish", { method: "POST" }),
  discardThemeDraft: (token: string) => req<AdminLandingTheme>(token, "/theme/discard-draft", { method: "POST" }),

  listSnapshots: (token: string) => req<AdminLandingSnapshot[]>(token, "/snapshots"),
  getSnapshot: (token: string, id: string) => req<AdminLandingSnapshot & { data: unknown }>(token, `/snapshots/${id}`),
  createSnapshot: (token: string, label?: string) =>
    req<AdminLandingSnapshot>(token, "/snapshots", { method: "POST", body: JSON.stringify({ label }) }),
  restoreSnapshot: (token: string, id: string) =>
    req<{ restored: boolean; blocksCount: number }>(token, `/snapshots/${id}/restore`, { method: "POST" }),
  deleteSnapshot: (token: string, id: string) => req<void>(token, `/snapshots/${id}`, { method: "DELETE" }),

  draftsStatus: (token: string) => req<DraftsStatus>(token, "/drafts-status"),
  publishAll: (token: string) =>
    req<{ publishedBlocks: number; themePublished: boolean }>(token, "/publish-all", { method: "POST" }),
  discardAllDrafts: (token: string) => req<{ discarded: boolean }>(token, "/discard-all-drafts", { method: "POST" }),

  getStatus: (token: string) => req<{ enabled: boolean }>(token, "/status"),
  setStatus: (token: string, enabled: boolean) =>
    req<{ enabled: boolean }>(token, "/status", { method: "PATCH", body: JSON.stringify({ enabled }) }),

  uploadImage: async (token: string, file: File): Promise<{ url: string; size: number; mime: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    return res.json();
  },
};
