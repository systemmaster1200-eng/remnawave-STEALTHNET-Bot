/**
 * GeoIP service — resolves IP addresses to lat/lng coordinates.
 * Primary: MaxMind GeoLite2-City local DB.
 * Fallback: ip-api.com batch API (free, max 100 IPs per request, 15 req/min).
 */

import fs from "node:fs";
import path from "node:path";
import maxmind, { type CityResponse, type Reader } from "maxmind";
import { LRUCache } from "lru-cache";
import { prisma } from "../../db.js";

export interface GeoResult {
  lat: number;
  lng: number;
  country?: string;
  city?: string;
}

const CACHE_SENTINEL: GeoResult = { lat: NaN, lng: NaN };

const IP_CACHE = new LRUCache<string, GeoResult>({
  max: 50_000,
  ttl: 60 * 60 * 1000,
});

function isSentinel(r: GeoResult): boolean {
  return Number.isNaN(r.lat);
}

let mmReader: Reader<CityResponse> | null = null;
let mmLoadAttempted = false;
let mmLoadedPath: string | null = null;

async function getDbMaxmindPath(): Promise<string> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: "maxmind_db_path" } });
    if (row?.value?.trim()) return row.value.trim();
  } catch { /* fallback */ }
  return process.env.MAXMIND_DB_PATH || path.resolve("data", "GeoLite2-City.mmdb");
}

async function getMaxMindReader(): Promise<Reader<CityResponse> | null> {
  const dbPath = await getDbMaxmindPath();

  if (mmReader && mmLoadedPath === dbPath) return mmReader;
  if (mmLoadAttempted && mmLoadedPath === dbPath) return null;

  mmLoadAttempted = true;
  mmLoadedPath = dbPath;
  mmReader = null;

  if (!fs.existsSync(dbPath)) {
    console.warn(`[geoip] MaxMind DB not found at ${dbPath} — will use ip-api.com fallback`);
    return null;
  }

  try {
    mmReader = await maxmind.open<CityResponse>(dbPath);
    console.log("[geoip] MaxMind GeoLite2-City loaded successfully");
    return mmReader;
  } catch (e) {
    console.error("[geoip] Failed to load MaxMind DB:", e);
    return null;
  }
}

export function resetMaxMindReader(): void {
  mmReader = null;
  mmLoadAttempted = false;
  mmLoadedPath = null;
}

function lookupMaxMind(ip: string): GeoResult | null {
  if (!mmReader) return null;
  try {
    const result = mmReader.get(ip);
    if (!result?.location?.latitude || !result?.location?.longitude) return null;
    return {
      lat: result.location.latitude,
      lng: result.location.longitude,
      country: result.country?.iso_code,
      city: result.city?.names?.en,
    };
  } catch {
    return null;
  }
}

interface IpApiBatchItem {
  status: string;
  lat?: number;
  lon?: number;
  country?: string;
  city?: string;
  query: string;
}

async function lookupIpApiBatch(ips: string[]): Promise<Map<string, GeoResult>> {
  const results = new Map<string, GeoResult>();
  const BATCH_SIZE = 100;

  for (let i = 0; i < ips.length; i += BATCH_SIZE) {
    const batch = ips.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch("http://ip-api.com/batch?fields=status,lat,lon,country,city,query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch.map((q) => ({ query: q, fields: "status,lat,lon,country,city,query" }))),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as IpApiBatchItem[];
      for (const item of data) {
        if (item.status === "success" && item.lat != null && item.lon != null) {
          results.set(item.query, {
            lat: item.lat,
            lng: item.lon,
            country: item.country,
            city: item.city,
          });
        }
      }
    } catch {
      // ip-api.com might rate-limit; skip silently
    }

    if (i + BATCH_SIZE < ips.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return results;
}

function isPrivateIp(ip: string): boolean {
  return (
    ip.startsWith("10.") ||
    ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") || ip.startsWith("172.20.") || ip.startsWith("172.21.") ||
    ip.startsWith("172.22.") || ip.startsWith("172.23.") || ip.startsWith("172.24.") ||
    ip.startsWith("172.25.") || ip.startsWith("172.26.") || ip.startsWith("172.27.") ||
    ip.startsWith("172.28.") || ip.startsWith("172.29.") || ip.startsWith("172.30.") ||
    ip.startsWith("172.31.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("127.") ||
    ip === "::1" ||
    ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")
  );
}

/** Resolve a single IP to coordinates. */
export async function geolocateIp(ip: string): Promise<GeoResult | null> {
  if (isPrivateIp(ip)) return null;

  const cached = IP_CACHE.get(ip);
  if (cached !== undefined) return isSentinel(cached) ? null : cached;

  await getMaxMindReader();

  let result = lookupMaxMind(ip);
  if (!result) {
    const batch = await lookupIpApiBatch([ip]);
    result = batch.get(ip) ?? null;
  }

  IP_CACHE.set(ip, result ?? CACHE_SENTINEL);
  return result;
}

/** Resolve many IPs at once (uses cache, MaxMind first, then ip-api batch for misses). */
export async function geolocateIps(ips: string[]): Promise<Map<string, GeoResult>> {
  const results = new Map<string, GeoResult>();
  const toResolve: string[] = [];

  for (const ip of ips) {
    if (isPrivateIp(ip)) continue;
    const cached = IP_CACHE.get(ip);
    if (cached !== undefined) {
      if (!isSentinel(cached)) results.set(ip, cached);
      continue;
    }
    toResolve.push(ip);
  }

  if (toResolve.length === 0) return results;

  await getMaxMindReader();

  const needFallback: string[] = [];
  for (const ip of toResolve) {
    const r = lookupMaxMind(ip);
    if (r) {
      results.set(ip, r);
      IP_CACHE.set(ip, r);
    } else {
      needFallback.push(ip);
    }
  }

  if (needFallback.length > 0) {
    const fallbackResults = await lookupIpApiBatch(needFallback);
    for (const [ip, geo] of fallbackResults) {
      results.set(ip, geo);
      IP_CACHE.set(ip, geo);
    }
    for (const ip of needFallback) {
      if (!fallbackResults.has(ip)) {
        IP_CACHE.set(ip, CACHE_SENTINEL);
      }
    }
  }

  return results;
}

/** Initialize the MaxMind reader eagerly (call on startup). */
export async function initGeoIp(): Promise<void> {
  await getMaxMindReader();
}
