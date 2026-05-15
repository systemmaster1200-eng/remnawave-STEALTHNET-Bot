/**
 * Health-агрегатор: проверяет всё что может тихо умереть и не подаёт виду.
 *
 * Сейчас:
 *   - Postgres (SELECT 1)
 *   - Remna API (configured + reachable)
 *   - Telegram bot (TG getMe)
 *   - Disk free / used (через `df -k /` через child_process)
 *   - RAM free/total (os.freemem/totalmem)
 *   - API uptime
 */

import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import os from "node:os";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { env } from "../../config/index.js";

const exec = promisify(execCb);

export interface HealthCheck {
  name: string;
  status: "ok" | "warn" | "error" | "skip";
  detail?: string;
  meta?: Record<string, unknown>;
  durationMs?: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T | null; error: unknown; ms: number }> {
  const t = Date.now();
  try {
    const result = await fn();
    return { result, error: null, ms: Date.now() - t };
  } catch (error) {
    return { result: null, error, ms: Date.now() - t };
  }
}

async function checkPostgres(): Promise<HealthCheck> {
  const t = await timed(() => prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`);
  if (t.error) return { name: "postgres", status: "error", detail: String(t.error), durationMs: t.ms };
  return { name: "postgres", status: "ok", durationMs: t.ms };
}

async function checkRemna(): Promise<HealthCheck> {
  // Remnawave-конфиг живёт в .env (REMNA_API_URL/REMNA_ADMIN_TOKEN), а не в system_settings.
  const url = env.REMNA_API_URL?.trim().replace(/\/$/, "") ?? "";
  const token = env.REMNA_ADMIN_TOKEN?.trim() ?? "";
  if (!url || !token) return { name: "remna", status: "skip", detail: "REMNA_API_URL/REMNA_ADMIN_TOKEN не заданы в .env" };

  const t = await timed(async () => {
    // /api/system/stats — лёгкий и стабильный эндпоинт, проверяющий и URL, и токен.
    // Если он отсутствует на старых версиях — fallback на /api/users?size=1.
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (env.REMNA_SECRET_KEY) {
      const colonIdx = env.REMNA_SECRET_KEY.indexOf(":");
      if (colonIdx > 0) {
        const cookieName = env.REMNA_SECRET_KEY.slice(0, colonIdx);
        const cookieValue = env.REMNA_SECRET_KEY.slice(colonIdx + 1);
        headers["Cookie"] = `${cookieName}=${cookieValue}`;
      }
    }
    const tryHit = async (path: string) => fetch(`${url}${path}`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    let res = await tryHit("/api/system/stats");
    if (res.status === 404) res = await tryHit("/api/users?size=1");
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return true;
  });
  if (t.error) return { name: "remna", status: "error", detail: String(t.error), durationMs: t.ms, meta: { url } };
  return { name: "remna", status: "ok", durationMs: t.ms, meta: { url } };
}

async function checkBot(): Promise<HealthCheck> {
  const config = await getSystemConfig();
  const token = (config as { telegramBotToken?: string | null }).telegramBotToken?.trim();
  if (!token) return { name: "telegram_bot", status: "skip", detail: "not configured" };

  const t = await timed(async () => {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    if (!data.ok) throw new Error("getMe returned ok=false");
    return data.result?.username ?? null;
  });
  if (t.error) return { name: "telegram_bot", status: "error", detail: String(t.error), durationMs: t.ms };
  return { name: "telegram_bot", status: "ok", durationMs: t.ms, meta: { username: t.result } };
}

async function checkDisk(): Promise<HealthCheck> {
  const t = await timed(async () => {
    // df -k / возвращает размер в килобайтах. Альпиновый df поддерживает.
    // Контейнер api имеет /proc:/host-proc:ro mount, но не /. Используем /app
    // (внутри контейнера это его FS). Лучше — host disk через /host-etc/ssh
    // mountpoint? нет, это файл. Просто df / даёт layered fs; полезно для
    // понимания "сколько свободно для логов/uploads".
    const { stdout } = await exec("df -k / 2>/dev/null | awk 'NR==2 {print $2,$3,$4,$5}'");
    const [total, used, avail, percentRaw] = stdout.trim().split(/\s+/);
    return {
      totalKb: Number(total),
      usedKb: Number(used),
      availKb: Number(avail),
      percent: parseInt(String(percentRaw).replace("%", ""), 10),
    };
  });
  if (t.error || !t.result) return { name: "disk", status: "warn", detail: String(t.error ?? "unable to read df"), durationMs: t.ms };
  const percent = t.result.percent;
  const status: HealthCheck["status"] = percent >= 95 ? "error" : percent >= 85 ? "warn" : "ok";
  return {
    name: "disk",
    status,
    detail: `${percent}% used, ${(t.result.availKb / 1024).toFixed(0)} MB free`,
    meta: t.result,
    durationMs: t.ms,
  };
}

function checkRam(): HealthCheck {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const percent = Math.round((used / total) * 100);
  const status: HealthCheck["status"] = percent >= 95 ? "error" : percent >= 85 ? "warn" : "ok";
  return {
    name: "ram",
    status,
    detail: `${percent}% used, ${(free / 1024 / 1024).toFixed(0)} MB free`,
    meta: { totalMb: Math.round(total / 1024 / 1024), freeMb: Math.round(free / 1024 / 1024), percent },
  };
}

function checkUptime(): HealthCheck {
  const seconds = Math.round(process.uptime());
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return {
    name: "api_uptime",
    status: "ok",
    detail: `${days}d ${hours}h ${minutes}m`,
    meta: { seconds },
  };
}

export async function aggregateHealth(): Promise<{
  overallStatus: "ok" | "warn" | "error";
  checks: HealthCheck[];
  timestamp: string;
}> {
  const checks: HealthCheck[] = [];
  const [pg, remna, bot, disk] = await Promise.all([checkPostgres(), checkRemna(), checkBot(), checkDisk()]);
  checks.push(pg, remna, bot, disk, checkRam(), checkUptime());

  const overallStatus = checks.some((c) => c.status === "error")
    ? "error"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";

  return { overallStatus, checks, timestamp: new Date().toISOString() };
}
