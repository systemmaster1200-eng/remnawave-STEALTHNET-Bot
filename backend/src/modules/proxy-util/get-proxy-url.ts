import { getSystemConfig } from "../client/client.service.js";

export type ProxyTarget = "telegram" | "payments" | "ai";

/**
 * Возвращает proxy URL для указанного целевого сервиса, если прокси включен
 * для этого сервиса. Возвращает null, если прокси не настроен или отключён.
 */
export async function getProxyUrl(target: ProxyTarget): Promise<string | null> {
  const config = await getSystemConfig();

  const proxyUrl = (config as any).proxyUrl?.trim();
  if (!proxyUrl) return null;

  const enabled: boolean = (config as any).proxyEnabled === true || (config as any).proxyEnabled === "true";
  if (!enabled) return null;

  if (target === "telegram") {
    const tgEnabled = (config as any).proxyTelegram === true || (config as any).proxyTelegram === "true";
    return tgEnabled ? proxyUrl : null;
  }

  if (target === "payments") {
    const payEnabled = (config as any).proxyPayments === true || (config as any).proxyPayments === "true";
    return payEnabled ? proxyUrl : null;
  }

  if (target === "ai") {
    const aiEnabled = (config as any).proxyAi === true || (config as any).proxyAi === "true";
    return aiEnabled ? proxyUrl : null;
  }

  return null;
}
