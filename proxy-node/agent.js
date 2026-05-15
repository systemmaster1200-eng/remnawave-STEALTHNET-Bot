#!/usr/bin/env node
/**
 * Агент прокси-ноды STEALTHNET: регистрация, heartbeat, слоты → 3proxy (SOCKS5 + HTTP).
 * Переменные: STEALTHNET_API_URL, PROXY_NODE_TOKEN, SOCKS_PORT, HTTP_PORT, CONFIG_PATH, PASSWD_PATH
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const API_URL = (process.env.STEALTHNET_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.PROXY_NODE_TOKEN || "";
// Порты: начальные из env, потом обновляются из API панели
let socksPort = parseInt(process.env.SOCKS_PORT || "1080", 10);
let httpPort = parseInt(process.env.HTTP_PORT || "8080", 10);
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "3proxy.cfg");
const PASSWD_PATH = process.env.PASSWD_PATH || path.join(__dirname, "passwd");
const LOG_PATH = process.env.LOG_PATH || path.join(path.dirname(CONFIG_PATH), "3proxy.log");
const POLL_INTERVAL_MS = (parseInt(process.env.POLL_INTERVAL_SEC || "60", 10) || 60) * 1000;
/** Логировать отладочные сообщения (трафик, парсинг). */
const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";

if (!API_URL || !TOKEN) {
  console.error("Set STEALTHNET_API_URL and PROXY_NODE_TOKEN");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "X-Proxy-Node-Token": TOKEN,
};

let proxyProcess = null;
let lastSlotsSignature = null;
// Метрики: трафик по логинам, общий трафик ноды. Собираем из файла лога 3proxy.
let stats = { trafficIn: 0, trafficOut: 0, byLogin: {} };
// Подключения за последний интервал (сбрасываются после heartbeat)
let intervalConns = 0;
let intervalConnsByLogin = {};
let logReadOffset = 0;
// 3proxy logformat "LSTN %U %I %O" → каждая строка: STN login bytesIn bytesOut
// "L" — директива local time (НЕ литеральный текст!), "STN" — литеральный префикс.
const TRAFFIC_LINE = /^STN\s+(\S+)\s+(\d+)\s+(\d+)/;

function slotsSignature(slots) {
  if (!slots || slots.length === 0) return "";
  return slots.map((s) => `${s.login}:${s.password}:${s.connectionLimit ?? ""}`).join("|");
}

function writePasswd(slots) {
  const dir = path.dirname(PASSWD_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lines = (slots || []).map((s) => `${s.login}:CL:${s.password}`);
  fs.writeFileSync(PASSWD_PATH, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
}

function writeConfig(slots) {
  const dir = path.dirname(CONFIG_PATH);
  if (!dir || (dir !== "." && !fs.existsSync(dir))) fs.mkdirSync(dir, { recursive: true });
  const logDir = path.dirname(LOG_PATH);
  if (logDir && logDir !== "." && !fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const lines = [
    "nserver 8.8.8.8",
    "nserver 8.8.4.4",
    "nscache 65536",
    "timeouts 1 5 30 60 180 1800 15 60",
    `log ${LOG_PATH}`,
    'logformat "LSTN %U %I %O"',
    `users $${PASSWD_PATH}`,
    "auth strong",
  ];

  // Per-user connection limits: connlim N 0 user → max N simultaneous connections
  const activeSlots = (slots || []).filter((s) => s.connectionLimit != null && s.connectionLimit > 0);
  if (activeSlots.length > 0) {
    for (const s of activeSlots) {
      lines.push(`connlim ${s.connectionLimit} 0 ${s.login}`);
    }
  }

  lines.push(
    "allow *",
    "maxconn 500",
    `socks -p${socksPort} -i0.0.0.0`,
    `proxy -p${httpPort} -i0.0.0.0`,
  );

  fs.writeFileSync(CONFIG_PATH, lines.join("\n"), "utf8");
}

function start3proxy() {
  if (proxyProcess) {
    try {
      proxyProcess.kill("SIGTERM");
      proxyProcess = null;
    } catch (_) {}
  }
  const bin = "3proxy";
  proxyProcess = spawn(bin, [CONFIG_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  proxyProcess.stdout?.on("data", (d) => process.stdout.write(d));
  proxyProcess.stderr?.on("data", (d) => process.stderr.write(d));
  proxyProcess.on("error", (err) => {
    console.error("3proxy spawn error:", err.message);
  });
  proxyProcess.on("exit", (code, sig) => {
    if (code !== null && code !== 0) console.error("3proxy exited:", code, sig);
    proxyProcess = null;
  });
  console.log("3proxy started (SOCKS", socksPort + ", HTTP", httpPort + ")");
}

function applySlots(slots) {
  const sig = slotsSignature(slots);
  if (sig === lastSlotsSignature) return;
  lastSlotsSignature = sig;
  writePasswd(slots);
  writeConfig(slots);
  start3proxy();
}

async function register() {
  const res = await fetch(`${API_URL}/api/proxy-nodes/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "" }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("Register failed:", res.status, text);
    return null;
  }
  const data = JSON.parse(text);
  console.log("Registered nodeId:", data.nodeId);
  return data.nodeId;
}

function collectStatsFromLog() {
  try {
    if (!fs.existsSync(LOG_PATH)) {
      if (DEBUG) console.log("[log] file not found:", LOG_PATH);
      return;
    }
    const size = fs.statSync(LOG_PATH).size;
    if (size < logReadOffset) logReadOffset = 0;
    if (logReadOffset >= size) return;
    const fd = fs.openSync(LOG_PATH, "r");
    const buf = Buffer.alloc(256 * 1024);
    let offset = logReadOffset;
    let n = 0;
    let matched = 0;
    let totalLines = 0;
    while ((n = fs.readSync(fd, buf, 0, buf.length, offset)) > 0) {
      offset += n;
      const chunk = buf.toString("utf8", 0, n);
      const lines = chunk.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        totalLines++;
        const m = line.match(TRAFFIC_LINE);
        if (m) {
          matched++;
          const login = m[1];
          const inB = parseInt(m[2], 10) || 0;
          const outB = parseInt(m[3], 10) || 0;
          stats.trafficIn += inB;
          stats.trafficOut += outB;
          if (!stats.byLogin[login]) stats.byLogin[login] = 0;
          stats.byLogin[login] += inB + outB;
          intervalConns++;
          intervalConnsByLogin[login] = (intervalConnsByLogin[login] || 0) + 1;
        } else if (DEBUG && totalLines <= 5) {
          console.log("[log] unmatched line:", JSON.stringify(line));
        }
      }
    }
    fs.closeSync(fd);
    logReadOffset = offset;
    if (DEBUG && (matched > 0 || totalLines > 0)) {
      console.log("[log] read %d lines, matched %d, trafficIn=%d trafficOut=%d", totalLines, matched, stats.trafficIn, stats.trafficOut);
    }
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Log read error:", err.message);
  }
}

async function heartbeat(nodeId, slots) {
  collectStatsFromLog();
  const slotsPayload = (slots || []).map((s) => ({
    slotId: s.id,
    trafficUsed: stats.byLogin[s.login] || 0,
    connections: intervalConnsByLogin[s.login] || 0,
  }));
  const body = {
    connections: intervalConns,
    trafficIn: stats.trafficIn,
    trafficOut: stats.trafficOut,
    slots: slotsPayload.length ? slotsPayload : undefined,
  };
  // Сбросить счётчики подключений за интервал после отправки
  intervalConns = 0;
  intervalConnsByLogin = {};
  if (DEBUG) {
    console.error("[heartbeat] sending trafficIn=%s trafficOut=%s slots=%s", body.trafficIn, body.trafficOut, body.slots?.length ?? 0);
  }
  const res = await fetch(`${API_URL}/api/proxy-nodes/${nodeId}/heartbeat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("Heartbeat failed:", res.status, await res.text());
  }
}

async function getSlots(nodeId) {
  const res = await fetch(`${API_URL}/api/proxy-nodes/${nodeId}/slots`, { headers });
  if (!res.ok) return { slots: [], portsChanged: false };
  const data = await res.json();
  let portsChanged = false;
  if (data.socksPort && data.socksPort !== socksPort) {
    console.log("SOCKS port changed:", socksPort, "→", data.socksPort);
    socksPort = data.socksPort;
    portsChanged = true;
  }
  if (data.httpPort && data.httpPort !== httpPort) {
    console.log("HTTP port changed:", httpPort, "→", data.httpPort);
    httpPort = data.httpPort;
    portsChanged = true;
  }
  return { slots: data.slots || [], portsChanged };
}

async function main() {
  const nodeId = await register();
  if (!nodeId) {
    console.error("Registration failed. Exiting.");
    process.exit(1);
  }

  const tick = async () => {
    const { slots, portsChanged } = await getSlots(nodeId);
    if (portsChanged) lastSlotsSignature = null; // force config rewrite
    applySlots(slots);
    await heartbeat(nodeId, slots);
    if (slots.length > 0) {
      const total = stats.trafficIn + stats.trafficOut;
      console.log("Slots:", slots.length, "Traffic:", Math.round(total / 1024), "KB");
    }
  };

  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
  console.log("Heartbeat + 3proxy config refresh every", POLL_INTERVAL_MS / 1000, "s");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
