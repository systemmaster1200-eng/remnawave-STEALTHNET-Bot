/**
 * Клиент для эндпоинтов лендинга:
 * - публичный `/api/public/landing` (без токена, без черновиков),
 * - админский `/api/admin/landing/preview` (с токеном, с черновиками).
 *
 * Не использует api.ts чтобы держать лендинг отвязанным от тяжёлых типов админки.
 */

import type { LandingApiResponse } from "@/components/landing-blocks/types";

const API_BASE = "/api";

export async function fetchLanding(lang: string = "ru"): Promise<LandingApiResponse> {
  const res = await fetch(`${API_BASE}/public/landing?lang=${encodeURIComponent(lang)}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`landing fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchLandingPreview(token: string, lang: string = "ru"): Promise<LandingApiResponse> {
  const res = await fetch(`${API_BASE}/admin/landing/preview?lang=${encodeURIComponent(lang)}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`landing preview fetch failed: ${res.status}`);
  return res.json();
}
