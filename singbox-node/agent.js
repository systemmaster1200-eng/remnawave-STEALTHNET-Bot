#!/usr/bin/env node
/**
 * Агент sing-box ноды STEALTHNET: регистрация, heartbeat, слоты → конфиг sing-box (JSON).
 * Переменные: STEALTHNET_API_URL, SINGBOX_NODE_TOKEN, PROTOCOL, PORT, CONFIG_PATH, POLL_INTERVAL_SEC
 */

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const API_URL = (process.env.STEALTHNET_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.SINGBOX_NODE_TOKEN || "";
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "config.json");
const APP_DIR = path.dirname(CONFIG_PATH);
const CERT_PATH = path.join(APP_DIR, "cert.pem");
const KEY_PATH = path.join(APP_DIR, "key.pem");
const POLL_INTERVAL_MS = (parseInt(process.env.POLL_INTERVAL_SEC || "60", 10) || 60) * 1000;
const MANAGED_INBOUND_TAG = "stealthnet-in";

// Из API приходят: protocol, port, tlsEnabled, customConfigJson, slots[]
let protocol = (process.env.PROTOCOL || "VLESS").toUpperCase();
let port = parseInt(process.env.PORT || "443", 10);
let tlsEnabled = process.env.TLS_ENABLED !== "0" && process.env.TLS_ENABLED !== "false";

const headers = {
  "Content-Type": "application/json",
  "X-Singbox-Node-Token": TOKEN,
};

let singboxProcess = null;
let lastSlotsSignature = null;

if (!API_URL || !TOKEN) {
  console.error("Set STEALTHNET_API_URL and SINGBOX_NODE_TOKEN");
  process.exit(1);
}

function slotsSignature(slots, customConfigJson) {
  const slotsPart = (!slots || slots.length === 0)
    ? ""
    : slots.map((s) => `${s.id}:${s.userIdentifier}:${s.secret || ""}`).join("|");
  const configPart = customConfigJson || "";
  return `${protocol}:${port}:${tlsEnabled}:${slotsPart}:${configPart}`;
}

/** Формирует массив users для sing-box из слотов в зависимости от протокола. */
function buildUsers(slots) {
  if (!slots || slots.length === 0) return [];
  const list = [];
  for (const s of slots) {
    const name = s.userIdentifier || s.id?.slice(0, 8) || "user";
    if (protocol === "VLESS" || protocol === "TROJAN") {
      // VLESS: uuid в userIdentifier, пароль не обязателен
      if (protocol === "VLESS") {
        list.push({ name, uuid: s.userIdentifier });
      } else {
        list.push({ name, password: s.secret || "" });
      }
    } else {
      // SHADOWSOCKS, HYSTERIA2: name + password
      list.push({ name, password: s.secret || "" });
    }
  }
  return list;
}

/** Генерирует самоподписанный сертификат для TLS (HYSTERIA2/TROJAN), если файлов ещё нет. */
function ensureTlsCert() {
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    return { certPath: CERT_PATH, keyPath: KEY_PATH };
  }
  if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
  const subj = "/CN=stealthnet-inbound";
  const r = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", KEY_PATH, "-out", CERT_PATH,
    "-days", "3650", "-nodes", "-subj", subj,
  ], { stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) {
    console.error("openssl failed:", r.stderr || r.error);
    return null;
  }
  console.log("Generated self-signed TLS cert for", protocol);
  return { certPath: CERT_PATH, keyPath: KEY_PATH };
}

/** Минимальный шаблон конфига по протоколу (без customConfigJson). */
function buildDefaultConfig(portVal, users, tlsPaths) {
  const listenPort = portVal || port;
  let inbound;
  if (protocol === "VLESS") {
    inbound = {
      type: "vless",
      tag: MANAGED_INBOUND_TAG,
      listen: "::",
      listen_port: listenPort,
      users: users.map((u) => ({ name: u.name, uuid: u.uuid })),
    };
    if (tlsEnabled && tlsPaths) {
      inbound.tls = { enabled: true, server_name: "localhost", certificate_path: tlsPaths.certPath, key_path: tlsPaths.keyPath };
    }
  } else if (protocol === "SHADOWSOCKS") {
    inbound = {
      type: "shadowsocks",
      tag: MANAGED_INBOUND_TAG,
      listen: "::",
      listen_port: listenPort,
      method: "2022-blake3-aes-256-gcm",
      users: users.map((u) => ({ name: u.name, password: u.password })),
    };
    if (inbound.users.length === 0) inbound.password = "replace-me-or-add-slots";
  } else if (protocol === "TROJAN") {
    const tls = tlsPaths
      ? { enabled: true, server_name: "localhost", certificate_path: tlsPaths.certPath, key_path: tlsPaths.keyPath }
      : {};
    inbound = {
      type: "trojan",
      tag: MANAGED_INBOUND_TAG,
      listen: "::",
      listen_port: listenPort,
      users: users.map((u) => ({ name: u.name, password: u.password })),
      tls,
    };
  } else if (protocol === "HYSTERIA2") {
    const tls = tlsPaths
      ? { enabled: true, server_name: "localhost", certificate_path: tlsPaths.certPath, key_path: tlsPaths.keyPath }
      : {};
    inbound = {
      type: "hysteria2",
      tag: MANAGED_INBOUND_TAG,
      listen: "::",
      listen_port: listenPort,
      users: users.map((u) => ({ name: u.name, password: u.password })),
      tls,
    };
  } else {
    inbound = {
      type: "vless",
      tag: MANAGED_INBOUND_TAG,
      listen: "::",
      listen_port: listenPort,
      users: users.map((u) => ({ name: u.name, uuid: u.uuid })),
    };
  }

  return {
    log: { level: "info" },
    inbounds: [inbound],
    outbounds: [{ type: "direct", tag: "direct" }],
    route: { final: "direct" },
  };
}

/** Подставляет users в кастомный конфиг (инбаунд с тегом stealthnet-in). Для HYSTERIA2/TROJAN подставляет реальные пути к сертификатам. */
function mergeCustomConfig(customJson, users) {
  let config;
  try {
    config = typeof customJson === "string" ? JSON.parse(customJson) : customJson;
  } catch (e) {
    console.error("Invalid customConfigJson:", e.message);
    return null;
  }
  const inbounds = config.inbounds;
  if (!Array.isArray(inbounds)) {
    console.error("customConfigJson: inbounds not found or not array");
    return null;
  }
  const managed = inbounds.find((i) => i && i.tag === MANAGED_INBOUND_TAG);
  if (!managed) {
    console.error("customConfigJson: no inbound with tag", MANAGED_INBOUND_TAG);
    return config;
  }
  if (protocol === "VLESS") {
    managed.users = users.map((u) => ({ name: u.name, uuid: u.uuid }));
  } else {
    managed.users = users.map((u) => ({ name: u.name, password: u.password }));
  }
  const needsTlsCert = protocol === "HYSTERIA2" || protocol === "TROJAN" || (protocol === "VLESS" && tlsEnabled);
  if (needsTlsCert) {
    const tlsPaths = ensureTlsCert();
    if (tlsPaths) {
      if (!managed.tls) managed.tls = { enabled: true, server_name: "localhost" };
      managed.tls.certificate_path = tlsPaths.certPath;
      managed.tls.key_path = tlsPaths.keyPath;
    }
  }
  // Порт из админки (передан в applySlots через portFromApi) — подставляем в инбаунд
  managed.listen_port = port;
  // Маршрут в интернет: если нет route.final — трафик из инбаунда может не идти в outbound
  if (!config.route) config.route = {};
  if (!config.route.final && config.outbounds?.length) {
    const direct = config.outbounds.find((o) => o && o.tag === "direct");
    config.route.final = direct ? "direct" : config.outbounds[0]?.tag || "direct";
  }
  return config;
}

function writeConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function stopSingbox() {
  return new Promise((resolve) => {
    if (!singboxProcess) return resolve();
    const proc = singboxProcess;
    singboxProcess = null;
    const timeout = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch (_) {}
      resolve();
    }, 5000);
    proc.on("exit", () => { clearTimeout(timeout); resolve(); });
    try { proc.kill("SIGTERM"); } catch (_) { clearTimeout(timeout); resolve(); }
  });
}

async function startSingbox() {
  await stopSingbox();
  // Small delay to let OS release the UDP socket
  await new Promise((r) => setTimeout(r, 500));
  const bin = "sing-box";
  singboxProcess = spawn(bin, ["run", "-c", CONFIG_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  singboxProcess.stdout?.on("data", (d) => process.stdout.write(d));
  singboxProcess.stderr?.on("data", (d) => process.stderr.write(d));
  singboxProcess.on("error", (err) => {
    console.error("sing-box spawn error:", err.message);
  });
  singboxProcess.on("exit", (code, sig) => {
    if (code !== null && code !== 0) console.error("sing-box exited:", code, sig);
    singboxProcess = null;
  });
  console.log("sing-box started (protocol:", protocol + ", port:", port + ")");
}

async function applySlots(slots, customConfigJson, protocolFromApi, portFromApi, tlsEnabledFromApi) {
  if (protocolFromApi) protocol = protocolFromApi;
  if (portFromApi) port = portFromApi;
  if (tlsEnabledFromApi !== undefined) tlsEnabled = tlsEnabledFromApi;

  const sig = slotsSignature(slots, customConfigJson);
  if (sig === lastSlotsSignature) return;
  lastSlotsSignature = sig;

  const users = buildUsers(slots);
  let config;
  if (customConfigJson && customConfigJson.trim()) {
    config = mergeCustomConfig(customConfigJson, users);
    if (!config) return;
  } else {
    let tlsPaths = null;
    const needsTls = protocol === "TROJAN" || protocol === "HYSTERIA2" || (protocol === "VLESS" && tlsEnabled);
    if (needsTls) {
      tlsPaths = ensureTlsCert();
      if (!tlsPaths) {
        console.error("TLS required for " + protocol + ". Could not generate certificate (install openssl).");
        return;
      }
    }
    config = buildDefaultConfig(port, users, tlsPaths);
  }
  writeConfig(config);
  await startSingbox();
}

async function register() {
  const res = await fetch(`${API_URL}/api/singbox-nodes/register`, {
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
  if (data.protocol) protocol = data.protocol;
  if (data.port) port = data.port;
  if (data.tlsEnabled !== undefined) tlsEnabled = data.tlsEnabled;
  return data.nodeId;
}

async function getSlots(nodeId) {
  const res = await fetch(`${API_URL}/api/singbox-nodes/${nodeId}/slots`, { headers });
  if (!res.ok) return { slots: [], customConfigJson: null, protocol: null, port: null, tlsEnabled: undefined };
  const data = await res.json();
  return {
    slots: data.slots || [],
    customConfigJson: data.customConfigJson ?? null,
    protocol: data.protocol ?? null,
    port: data.port ?? null,
    tlsEnabled: data.tlsEnabled,
  };
}

async function heartbeat(nodeId, slots) {
  const body = {
    connections: 0,
    trafficIn: 0,
    trafficOut: 0,
    slots: (slots || []).map((s) => ({ slotId: s.id, trafficUsed: 0, connections: 0 })),
  };
  const res = await fetch(`${API_URL}/api/singbox-nodes/${nodeId}/heartbeat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("Heartbeat failed:", res.status, await res.text());
  }
}

async function main() {
  const nodeId = await register();
  if (!nodeId) {
    console.error("Registration failed. Exiting.");
    process.exit(1);
  }

  const tick = async () => {
    const { slots, customConfigJson, protocol: apiProtocol, port: apiPort, tlsEnabled: apiTls } = await getSlots(nodeId);
    await applySlots(slots, customConfigJson, apiProtocol, apiPort, apiTls);
    await heartbeat(nodeId, slots);
    if (slots.length > 0) {
      console.log("Slots:", slots.length, "Protocol:", protocol);
    }
  };

  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
  console.log("Heartbeat + config refresh every", POLL_INTERVAL_MS / 1000, "s");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
