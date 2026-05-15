/**
 * Master key list — used by the admin language editor to show all available translation keys
 * with their Russian defaults. The frontend and bot use these as fallback values.
 *
 * Structure: flat object with dot-notation keys grouped by prefix (bot.*, cabinet.*, admin.*).
 * Values are Russian defaults.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

let _ruCache: Record<string, unknown> | null = null;

function loadFrontendRu(): Record<string, unknown> {
  if (_ruCache) return _ruCache;
  const dir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(dir, "ru.json"),
    resolve(dir, "../../../frontend/src/i18n/locales/ru.json"),
  ];
  for (const p of candidates) {
    try {
      _ruCache = JSON.parse(readFileSync(p, "utf-8"));
      return _ruCache!;
    } catch { /* next */ }
  }
  return {};
}

function flattenObj(obj: unknown, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  if (!obj || typeof obj !== "object") return result;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      result[key] = v;
    } else if (typeof v === "object" && v !== null) {
      Object.assign(result, flattenObj(v, key));
    }
  }
  return result;
}

export function getMasterKeys(): Record<string, string> {
  const ru = loadFrontendRu();
  return flattenObj(ru);
}
