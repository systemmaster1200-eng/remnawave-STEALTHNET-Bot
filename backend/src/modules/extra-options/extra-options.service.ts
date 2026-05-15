/**
 * Применение купленных опций (доп. трафик, устройства, серверы) к пользователю Remna после оплаты.
 */

import { prisma } from "../../db.js";
import { remnaGetUser, remnaUpdateUser, isRemnaConfigured } from "../remna/remna.client.js";

export type ApplyExtraOptionResult = { ok: true } | { ok: false; error: string; status: number };

type ExtraOptionPayload =
  | { kind: "traffic"; trafficBytes: number }
  | { kind: "devices"; deviceCount: number }
  | { kind: "servers"; squadUuid: string; trafficBytes?: number };

function parseMetadataExtraOption(metadata: string | null): ExtraOptionPayload | null {
  if (!metadata?.trim()) return null;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    const extra = obj?.extraOption as Record<string, unknown> | undefined;
    if (!extra || typeof extra !== "object") return null;
    const kind = extra.kind as string;
    if (kind === "traffic" && typeof extra.trafficBytes === "number" && extra.trafficBytes > 0) {
      return { kind: "traffic", trafficBytes: extra.trafficBytes };
    }
    if (kind === "devices" && typeof extra.deviceCount === "number" && extra.deviceCount > 0) {
      return { kind: "devices", deviceCount: extra.deviceCount };
    }
    if (kind === "servers" && typeof extra.squadUuid === "string" && extra.squadUuid.length > 0) {
      const trafficBytes = typeof extra.trafficBytes === "number" && extra.trafficBytes > 0 ? extra.trafficBytes : undefined;
      return { kind: "servers", squadUuid: extra.squadUuid, ...(trafficBytes !== undefined && { trafficBytes }) };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Извлечь текущие trafficLimitBytes и hwidDeviceLimit из ответа Remna GET /api/users/{uuid} */
function getRemnaLimits(data: unknown): { trafficLimitBytes: number; hwidDeviceLimit: number | null } {
  if (!data || typeof data !== "object") return { trafficLimitBytes: 0, hwidDeviceLimit: null };
  const resp = (data as Record<string, unknown>).response ?? (data as Record<string, unknown>).data ?? data;
  const r = resp as Record<string, unknown>;
  const traffic = r?.trafficLimitBytes;
  const devices = r?.hwidDeviceLimit;
  return {
    trafficLimitBytes: typeof traffic === "number" ? traffic : 0,
    hwidDeviceLimit: typeof devices === "number" ? devices : (devices != null ? Number(devices) : null),
  };
}

/** Извлечь activeInternalSquads (uuid[]) из ответа Remna */
function getRemnaSquads(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const resp = (data as Record<string, unknown>).response ?? (data as Record<string, unknown>).data ?? data;
  const ais = (resp as Record<string, unknown>)?.activeInternalSquads;
  if (!Array.isArray(ais)) return [];
  const out: string[] = [];
  for (const s of ais) {
    const u = s && typeof s === "object" && "uuid" in s ? (s as Record<string, unknown>).uuid : s;
    if (typeof u === "string") out.push(u);
  }
  return out;
}

/**
 * Применить опцию по оплате: прочитать Payment.metadata.extraOption,
 * получить клиента и remnawaveUuid, обновить пользователя в Remna (добавить трафик/устройства/сквад).
 */
export async function applyExtraOptionByPaymentId(paymentId: string): Promise<ApplyExtraOptionResult> {
  if (!isRemnaConfigured()) return { ok: false, error: "Remna API не настроен", status: 503 };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { clientId: true, metadata: true },
  });
  if (!payment) return { ok: false, error: "Платёж не найден", status: 404 };

  const option = parseMetadataExtraOption(payment.metadata);
  if (!option) return { ok: false, error: "Платёж не является покупкой опции", status: 400 };

  const client = await prisma.client.findUnique({
    where: { id: payment.clientId },
    select: { remnawaveUuid: true },
  });
  if (!client?.remnawaveUuid) {
    return { ok: false, error: "Клиент не привязан к VPN (нет remnawaveUuid). Сначала оформите подписку.", status: 400 };
  }

  const userRes = await remnaGetUser(client.remnawaveUuid);
  if (userRes.error) {
    return { ok: false, error: userRes.error, status: userRes.status >= 400 ? userRes.status : 500 };
  }

  const uuid = client.remnawaveUuid;

  if (option.kind === "traffic") {
    const limits = getRemnaLimits(userRes.data);
    const newTraffic = limits.trafficLimitBytes + option.trafficBytes;
    const updateRes = await remnaUpdateUser({
      uuid,
      trafficLimitBytes: newTraffic,
    });
    if (updateRes.error) {
      return { ok: false, error: updateRes.error, status: updateRes.status >= 400 ? updateRes.status : 500 };
    }
    return { ok: true };
  }

  if (option.kind === "devices") {
    const limits = getRemnaLimits(userRes.data);
    const current = limits.hwidDeviceLimit ?? 0;
    const newDevices = current + option.deviceCount;
    const updateRes = await remnaUpdateUser({
      uuid,
      hwidDeviceLimit: newDevices,
    });
    if (updateRes.error) {
      return { ok: false, error: updateRes.error, status: updateRes.status >= 400 ? updateRes.status : 500 };
    }
    return { ok: true };
  }

  if (option.kind === "servers") {
    const limits = getRemnaLimits(userRes.data);
    const currentSquads = getRemnaSquads(userRes.data);
    let trafficLimitBytes = limits.trafficLimitBytes;
    if (option.trafficBytes && option.trafficBytes > 0) {
      trafficLimitBytes += option.trafficBytes;
    }
    const newSquads = currentSquads.includes(option.squadUuid) ? currentSquads : [...currentSquads, option.squadUuid];
    const updatePayload: { uuid: string; activeInternalSquads: string[]; trafficLimitBytes?: number } = {
      uuid,
      activeInternalSquads: newSquads,
    };
    if (trafficLimitBytes !== limits.trafficLimitBytes) {
      updatePayload.trafficLimitBytes = trafficLimitBytes;
    }
    const updateRes = await remnaUpdateUser(updatePayload);
    if (updateRes.error) {
      return { ok: false, error: updateRes.error, status: updateRes.status >= 400 ? updateRes.status : 500 };
    }
    // Не вызываем add-users: по api-1.yaml эндпоинт добавляет ВСЕХ пользователей в сквад; назначение уже в remnaUpdateUser(activeInternalSquads).
    return { ok: true };
  }

  return { ok: false, error: "Неизвестный тип опции", status: 400 };
}
