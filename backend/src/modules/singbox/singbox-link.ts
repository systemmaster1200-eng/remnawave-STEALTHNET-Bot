/**
 * Формирование ссылки подписки (vless://, trojan://, hy2://, ss://) по данным ноды и слота.
 */

export type NodeLinkInfo = {
  publicHost: string;
  port: number;
  protocol: string;
  tlsEnabled: boolean;
};

export type SlotLinkInfo = {
  userIdentifier: string;
  secret: string | null;
};

export function buildSingboxSlotSubscriptionLink(
  node: NodeLinkInfo,
  slot: SlotLinkInfo,
  name?: string
): string {
  const host = node.publicHost?.trim() || "localhost";
  const port = Number(node.port) || 443;
  const protocol = (node.protocol || "VLESS").toUpperCase();
  const tls = node.tlsEnabled !== false;
  const label = (name || `${protocol}-${host}`).replace(/[#?@[\]]/g, "_");

  if (protocol === "VLESS") {
    const security = tls ? "tls" : "none";
    const params = `type=tcp&security=${security}${tls ? "&allowInsecure=1&fp=chrome" : ""}`;
    return `vless://${slot.userIdentifier}@${host}:${port}?${params}#${encodeURIComponent(label)}`;
  }
  if (protocol === "TROJAN") {
    const password = slot.secret || slot.userIdentifier;
    const security = tls ? "tls" : "none";
    const params = `security=${security}${tls ? "&allowInsecure=1&fp=chrome" : ""}`;
    return `trojan://${encodeURIComponent(password)}@${host}:${port}?${params}#${encodeURIComponent(label)}`;
  }
  if (protocol === "HYSTERIA2") {
    const password = slot.secret || "";
    // Нода использует самоподписанный сертификат — клиенту нужен insecure=1
    const insecure = "1";
    return `hysteria2://${encodeURIComponent(password)}@${host}:${port}?insecure=${insecure}#${encodeURIComponent(label)}`;
  }
  if (protocol === "SHADOWSOCKS" || protocol === "SS") {
    const method = "aes-256-gcm";
    const pwd = slot.secret || slot.userIdentifier;
    const userinfo = Buffer.from(`${method}:${pwd}`, "utf8").toString("base64").replace(/=+$/, "");
    return `ss://${userinfo}@${host}:${port}#${encodeURIComponent(label)}`;
  }

  return `vless://${slot.userIdentifier}@${host}:${port}?type=tcp&security=${tls ? "tls" : "none"}#${encodeURIComponent(label)}`;
}
