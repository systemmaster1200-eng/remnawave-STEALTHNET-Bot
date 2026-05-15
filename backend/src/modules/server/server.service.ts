/**
 * Мониторинг хоста (CPU, RAM, Disk, Uptime, Load) и управление SSH.
 * Контейнер API монтирует:
 *   - /proc:/host-proc:ro   — метрики хоста
 *   - /etc/ssh:/host-etc/ssh — конфиг SSH хоста
 * + pid: host               — для nsenter (reload sshd)
 */

import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HOST_PROC = "/host-proc";

export interface ServerStats {
  hostname: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  loadAvg: [number, number, number];
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
    mount: string;
  } | null;
}

// ─── Чтение хостовых метрик через /host-proc ───

async function readHostFile(name: string): Promise<string | null> {
  for (const base of [HOST_PROC, "/proc"]) {
    try {
      return await fs.readFile(`${base}/${name}`, "utf-8");
    } catch { /* next */ }
  }
  return null;
}

async function getHostUptime(): Promise<number> {
  const raw = await readHostFile("uptime");
  if (raw) {
    const secs = parseFloat(raw.split(/\s+/)[0]);
    if (!isNaN(secs)) return Math.floor(secs);
  }
  return Math.floor(os.uptime());
}

async function getHostLoadAvg(): Promise<[number, number, number]> {
  const raw = await readHostFile("loadavg");
  if (raw) {
    const parts = raw.trim().split(/\s+/);
    const a = parseFloat(parts[0]);
    const b = parseFloat(parts[1]);
    const c = parseFloat(parts[2]);
    if (!isNaN(a)) return [
      Math.round(a * 100) / 100,
      Math.round(b * 100) / 100,
      Math.round(c * 100) / 100,
    ];
  }
  const la = os.loadavg() as [number, number, number];
  return [Math.round(la[0] * 100) / 100, Math.round(la[1] * 100) / 100, Math.round(la[2] * 100) / 100];
}

async function getHostMemory(): Promise<{ totalBytes: number; usedBytes: number; freeBytes: number; usagePercent: number }> {
  const raw = await readHostFile("meminfo");
  if (raw) {
    const get = (key: string): number => {
      const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
      return m ? parseInt(m[1], 10) * 1024 : 0;
    };
    const total = get("MemTotal");
    const free = get("MemFree");
    const buffers = get("Buffers");
    const cached = get("Cached");
    const sReclaimable = get("SReclaimable");
    const available = get("MemAvailable");
    const realFree = available > 0 ? available : (free + buffers + cached + sReclaimable);
    const used = total - realFree;
    return {
      totalBytes: total,
      usedBytes: Math.max(0, used),
      freeBytes: realFree,
      usagePercent: total > 0 ? Math.round((Math.max(0, used) / total) * 10000) / 100 : 0,
    };
  }
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    totalBytes: totalMem,
    usedBytes: usedMem,
    freeBytes: freeMem,
    usagePercent: totalMem > 0 ? Math.round((usedMem / totalMem) * 10000) / 100 : 0,
  };
}

async function getHostCpuUsage(): Promise<{ model: string; cores: number; usagePercent: number }> {
  const raw = await readHostFile("stat");
  const cpuInfo = await readHostFile("cpuinfo");

  let model = "unknown";
  let cores = os.cpus().length;
  if (cpuInfo) {
    const mm = cpuInfo.match(/^model name\s*:\s*(.+)/m);
    if (mm) model = mm[1].trim();
    const procs = cpuInfo.match(/^processor\s*:/gm);
    if (procs) cores = procs.length;
  }

  if (raw) {
    const line = raw.split("\n").find((l) => l.startsWith("cpu "));
    if (line) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] || 0);
      const total = parts.reduce((a, b) => a + b, 0);
      const usage = total > 0 ? Math.round((1 - idle / total) * 10000) / 100 : 0;
      return { model, cores, usagePercent: usage };
    }
  }

  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.values(cpu.times)) totalTick += type;
    totalIdle += cpu.times.idle;
  }
  const avg = cpus.length || 1;
  const pct = totalTick > 0 ? Math.round((1 - totalIdle / avg / (totalTick / avg)) * 10000) / 100 : 0;
  return { model: cpus[0]?.model?.trim() || model, cores: cpus.length || cores, usagePercent: pct };
}

async function getHostHostname(): Promise<string> {
  const raw = await readHostFile("sys/kernel/hostname");
  if (raw) return raw.trim();
  return os.hostname();
}

async function getDiskUsage(): Promise<ServerStats["disk"]> {
  try {
    const { stdout } = await execFileAsync("df", ["-B1", "/"], { timeout: 5000 });
    const lines = stdout.trim().split("\n");
    if (lines.length < 2) return null;
    const parts = lines[1].split(/\s+/);
    const totalBytes = parseInt(parts[1], 10) || 0;
    const usedBytes = parseInt(parts[2], 10) || 0;
    const freeBytes = parseInt(parts[3], 10) || 0;
    const mount = parts[5] || "/";
    return {
      totalBytes,
      usedBytes,
      freeBytes,
      usagePercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0,
      mount,
    };
  } catch {
    return null;
  }
}

export async function getServerStats(): Promise<ServerStats> {
  const [hostname, cpu, memory, loadAvg, uptimeSeconds, disk] = await Promise.all([
    getHostHostname(),
    getHostCpuUsage(),
    getHostMemory(),
    getHostLoadAvg(),
    getHostUptime(),
    getDiskUsage(),
  ]);

  return {
    hostname,
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    uptimeSeconds,
    loadAvg,
    cpu,
    memory,
    disk,
  };
}

// ──────────────────────────────────────
// SSH Management
// ──────────────────────────────────────

const SSHD_CONFIG_PATH = "/host-etc/ssh/sshd_config";
const SSHD_CONFIG_HOST = "/etc/ssh/sshd_config";

export interface SshConfig {
  port: number;
  permitRootLogin: string;
  passwordAuthentication: boolean;
  pubkeyAuthentication: boolean;
}

async function readSshdConfig(): Promise<string | null> {
  for (const p of [SSHD_CONFIG_PATH, SSHD_CONFIG_HOST]) {
    try {
      return await fs.readFile(p, "utf-8");
    } catch { /* next */ }
  }
  return null;
}

async function getConfigPath(): Promise<string> {
  try {
    await fs.access(SSHD_CONFIG_PATH);
    return SSHD_CONFIG_PATH;
  } catch {
    return SSHD_CONFIG_HOST;
  }
}

function parseSshdParam(content: string, param: string, fallback: string): string {
  const regex = new RegExp(`^\\s*${param}\\s+(.+)`, "im");
  const match = content.match(regex);
  return match ? match[1].trim() : fallback;
}

export async function getSshConfig(): Promise<SshConfig | null> {
  const content = await readSshdConfig();
  if (!content) return null;

  return {
    port: parseInt(parseSshdParam(content, "Port", "22"), 10) || 22,
    permitRootLogin: parseSshdParam(content, "PermitRootLogin", "yes"),
    passwordAuthentication: parseSshdParam(content, "PasswordAuthentication", "yes").toLowerCase() !== "no",
    pubkeyAuthentication: parseSshdParam(content, "PubkeyAuthentication", "yes").toLowerCase() !== "no",
  };
}

export async function updateSshConfig(updates: Partial<SshConfig>): Promise<{ ok: boolean; error?: string }> {
  const configPath = await getConfigPath();
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch {
    return { ok: false, error: "Не удалось прочитать sshd_config" };
  }

  function setParam(src: string, param: string, value: string): string {
    const regex = new RegExp(`^(\\s*#?\\s*${param}\\s+)(.+)`, "im");
    if (regex.test(src)) {
      return src.replace(regex, `${param} ${value}`);
    }
    return src.trimEnd() + `\n${param} ${value}\n`;
  }

  if (updates.port != null) {
    const port = Math.max(1, Math.min(65535, updates.port));
    content = setParam(content, "Port", String(port));
  }
  if (updates.permitRootLogin != null) {
    const allowed = ["yes", "no", "prohibit-password", "without-password", "forced-commands-only"];
    const val = allowed.includes(updates.permitRootLogin) ? updates.permitRootLogin : "prohibit-password";
    content = setParam(content, "PermitRootLogin", val);
  }
  if (updates.passwordAuthentication != null) {
    content = setParam(content, "PasswordAuthentication", updates.passwordAuthentication ? "yes" : "no");
  }
  if (updates.pubkeyAuthentication != null) {
    content = setParam(content, "PubkeyAuthentication", updates.pubkeyAuthentication ? "yes" : "no");
  }

  try {
    await fs.writeFile(configPath, content, "utf-8");
  } catch (e) {
    return { ok: false, error: `Не удалось записать sshd_config: ${e instanceof Error ? e.message : e}` };
  }

  try {
    await execFileAsync("nsenter", ["--target", "1", "--mount", "--uts", "--ipc", "--net", "--pid", "--", "systemctl", "reload", "sshd"], { timeout: 10000 });
  } catch {
    try {
      await execFileAsync("nsenter", ["--target", "1", "--mount", "--uts", "--ipc", "--net", "--pid", "--", "service", "ssh", "reload"], { timeout: 10000 });
    } catch { /* конфиг записан, SSH подхватит при перезапуске */ }
  }

  return { ok: true };
}
