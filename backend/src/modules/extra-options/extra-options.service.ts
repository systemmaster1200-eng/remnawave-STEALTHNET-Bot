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
/**
 * извлечь targetSubscriptionId из metadata платежа.
 * Если задан — extra-option применяется к этой конкретной secondary; иначе — primary клиента.
 * После apply мы также увеличиваем custom_price подписки на стоимость опции (для будущих продлений).
 */
function getTargetSubscriptionId(metadata: string | null): string | null {
  if (!metadata?.trim()) return null;
  try {
    const o = JSON.parse(metadata) as Record<string, unknown>;
    const id = o?.targetSubscriptionId;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export async function applyExtraOptionByPaymentId(paymentId: string): Promise<ApplyExtraOptionResult> {
  if (!isRemnaConfigured()) return { ok: false, error: "Remna API не настроен", status: 503 };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { clientId: true, metadata: true, amount: true },
  });
  if (!payment) return { ok: false, error: "Платёж не найден", status: 404 };

  const option = parseMetadataExtraOption(payment.metadata);
  if (!option) return { ok: false, error: "Платёж не является покупкой опции", status: 400 };

  // УНИФИЦИРОВАННЫЙ резолв целевой подписки.
  // После унификации все подписки клиента живут в одной таблице Subscription. Primary =
  // subscriptionIndex=0, secondary = 1..N — но логически они равноправны.
  //
  // Алгоритм:
  //   1. Если в metadata указан targetSubscriptionId — ищем эту подписку (любой index).
  //   2. Иначе — fallback на subscriptionIndex=0 клиента (бывш. primary).
  //
  // Старая ветка через client.remnawaveUuid (legacy) — больше не используется.
  // Это исправляет кейс: юзер выбирал secondary, но extra-option применялась к primary
  // потому что бот не пробрасывал targetSubscriptionId в платёжных хэндлерах.
  const targetSecondaryId = getTargetSubscriptionId(payment.metadata);
  let targetSub: { id: string; remnawaveUuid: string | null; ownerId: string; customPrice: number | null; subscriptionIndex: number } | null = null;
  if (targetSecondaryId) {
    targetSub = await prisma.subscription.findUnique({
      where: { id: targetSecondaryId },
      select: { id: true, remnawaveUuid: true, ownerId: true, customPrice: true, subscriptionIndex: true },
    });
    if (!targetSub || targetSub.ownerId !== payment.clientId) {
      return { ok: false, error: "Подписка для опции не найдена / не принадлежит клиенту", status: 404 };
    }
  } else {
    // Fallback: primary подписка клиента (subscriptionIndex=0).
    targetSub = await prisma.subscription.findUnique({
      where: { ownerId_subscriptionIndex: { ownerId: payment.clientId, subscriptionIndex: 0 } },
      select: { id: true, remnawaveUuid: true, ownerId: true, customPrice: true, subscriptionIndex: true },
    });
    if (!targetSub) {
      return { ok: false, error: "У клиента нет подписки для применения опции. Сначала оформите подписку.", status: 400 };
    }
  }
  if (!targetSub.remnawaveUuid) {
    return { ok: false, error: "Подписка не привязана к VPN", status: 400 };
  }
  const uuid = targetSub.remnawaveUuid;
  // Для совместимости с существующей логикой bumpCustomPrice/extraDevices ниже —
  // обе ветки (primary/secondary) теперь используют один объект подписки.
  const secondaryDb = targetSub;

  const userRes = await remnaGetUser(uuid);
  if (userRes.error) {
    return { ok: false, error: userRes.error, status: userRes.status >= 400 ? userRes.status : 500 };
  }

  // после apply увеличиваем custom_price выбранной подписки на цену опции.
  // Используется при следующем продлении: tariff-activation вместо базовой tariff.price берёт custom_price.
  // Стоимость опции = payment.amount (это итоговая сумма с учётом скидок/акций — то что юзер заплатил).
  // bumpCustomPrice работает только с конкретной
  // подпиской (раньше была отдельная ветка для primary через client.customPrimaryPrice —
  // больше не нужна, primary тоже Subscription с subscriptionIndex=0).
  const optionAmount = payment.amount ?? 0;
  const bumpCustomPrice = async () => {
    if (optionAmount <= 0) return;
    const newPrice = (secondaryDb.customPrice ?? 0) + optionAmount;
    await prisma.subscription.update({
      where: { id: secondaryDb.id },
      data: { customPrice: newPrice },
    }).catch(() => {});
  };

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
    await bumpCustomPrice();
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
    // запоминаем количество + цену за 30 дней.
    // цена должна быть БАЗОВОЙ (productPriceMonthly из metadata),
    // а не payment.amount (которая может быть масштабирована). Для пакета «+2 за 99» это всегда 99,
    // вне зависимости от pro-rata коэффициента который применялся при оплате.
    // При продлении: finalPrice = option.price + monthlyPrice × (days/30).
    let pkgPrice = payment.amount ?? 0;
    try {
      const meta = payment.metadata ? JSON.parse(payment.metadata) as Record<string, unknown> : null;
      const extraMeta = meta?.extraOption as Record<string, unknown> | undefined;
      const monthly = typeof extraMeta?.productPriceMonthly === "number" ? extraMeta.productPriceMonthly : null;
      if (monthly != null && monthly > 0) pkgPrice = monthly;
    } catch {
      // ignore parse errors
    }
    // secondaryDb теперь всегда задан (primary
    // тоже Subscription). Раньше была отдельная ветка с findFirst по remnawaveUuid —
    // больше не нужна.
    await prisma.subscription.update({
      where: { id: secondaryDb.id },
      data: {
        extraDevices: { increment: option.deviceCount },
        extraDevicesMonthlyPrice: { increment: pkgPrice },
      },
    }).catch((e) => console.error("[extra-options] extraDevices/monthlyPrice update failed:", e));
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
    await bumpCustomPrice();
    return { ok: true };
  }

  return { ok: false, error: "Неизвестный тип опции", status: 400 };
}
