/**
 * Community Blacklist — автоматическая блокировка пользователей
 * из https://github.com/BEDOLAGA-DEV/VPN-BLACKLIST/blob/main/blacklist.txt
 *
 * Список кэшируется в памяти на 30 минут.
 */

import { prisma } from "../../db.js";

const BLACKLIST_URL =
  "https://raw.githubusercontent.com/BEDOLAGA-DEV/VPN-BLACKLIST/main/blacklist.txt";

const CACHE_TTL_MS = 30 * 60 * 1000;

let cachedSet: Set<string> | null = null;
let lastFetchMs = 0;

function parseBlacklistText(raw: string): Set<string> {
  const set = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.split("#")[0]!.trim();
    if (trimmed && /^\d+$/.test(trimmed)) {
      set.add(trimmed);
    }
  }
  return set;
}

async function fetchBlacklist(): Promise<Set<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(BLACKLIST_URL, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[Blacklist] Fetch failed: ${res.status} ${res.statusText}`);
      return cachedSet ?? new Set();
    }
    const text = await res.text();
    return parseBlacklistText(text);
  } catch (e) {
    console.warn("[Blacklist] Fetch error:", e);
    return cachedSet ?? new Set();
  } finally {
    clearTimeout(timer);
  }
}

export async function getBlacklistSet(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedSet && now - lastFetchMs < CACHE_TTL_MS) {
    return cachedSet;
  }
  cachedSet = await fetchBlacklist();
  lastFetchMs = Date.now();
  return cachedSet;
}

/**
 * Проверяет telegramId по blacklist.
 * Если найден — ставит isBlocked = true, blockReason = "Community Blacklist".
 * Возвращает true если пользователь заблокирован.
 */
export async function checkAndBlockIfBlacklisted(telegramId: string): Promise<boolean> {
  const set = await getBlacklistSet();
  if (!set.has(telegramId)) return false;

  await prisma.client.updateMany({
    where: { telegramId, isBlocked: false },
    data: { isBlocked: true, blockReason: "Community Blacklist" },
  });

  return true;
}
