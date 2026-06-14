/**
 * T-extras-drop-after-pay (14.05.2026)
 *
 * Helper для удаления всех доп. устройств подписки с жёстким kick HWID в Remna.
 * Используется в двух точках:
 *   1. UI endpoint /api/client/subscription/:type/:id/remove-extra-devices (юзер сам нажал)
 *   2. ПОСЛЕ успешной активации платежа (если в metadata.removeExtrasOnActivate=true)
 *
 * Что делает:
 *   • Получает текущие HWID-устройства из Remna
 *   • Если их больше нового лимита (tariff.includedDevices) — удаляет лишние (старые первыми)
 *   • Уменьшает hwidDeviceLimit в Remna до базы тарифа
 *   • Обнуляет Subscription.extraDevices + extraDevicesMonthlyPrice
 *
 * Идемпотентно: повторный вызов для подписки без extras — no-op.
 */
import { prisma } from "../../db.js";
import {
  remnaGetUserHwidDevices,
  remnaDeleteUserHwidDevice,
  remnaUpdateUser,
} from "../remna/remna.client.js";

export interface RemoveExtrasResult {
  ok: boolean;
  extraDevicesRemoved: number;
  hwidKicked: number;
  newDeviceLimit: number;
  error?: string;
}

export async function removeAllExtraDevicesForSub(subId: string): Promise<RemoveExtrasResult> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: { id: true, remnawaveUuid: true, tariffId: true, extraDevices: true },
  });
  if (!sub) {
    return { ok: false, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: 0, error: "subscription not found" };
  }
  if (!sub.remnawaveUuid) {
    return { ok: false, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: 0, error: "not linked to remna" };
  }
  if ((sub.extraDevices ?? 0) === 0) {
    // Уже нет extras — ничего не делаем.
    return { ok: true, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: 0 };
  }

  const tariff = sub.tariffId
    ? await prisma.tariff.findUnique({
        where: { id: sub.tariffId },
        select: { includedDevices: true, deviceLimit: true },
      })
    : null;
  const includedDevices = tariff?.includedDevices ?? tariff?.deviceLimit ?? 1;

  // Список активных HWID — вариант Б: жёстко удалить лишние.
  let removedHwids = 0;
  try {
    const devicesRes = await remnaGetUserHwidDevices(sub.remnawaveUuid);
    const devicesData = devicesRes.data as { response?: { devices?: Array<{ hwid: string; createdAt?: string }> } } | undefined;
    const activeDevices = devicesData?.response?.devices ?? [];
    if (activeDevices.length > includedDevices) {
      // Сортируем по createdAt asc — старые удаляем первыми, новые сохраняем.
      const sorted = [...activeDevices].sort((a, b) => {
        const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aT - bT;
      });
      const toRemove = sorted.slice(0, activeDevices.length - includedDevices);
      for (const dev of toRemove) {
        await remnaDeleteUserHwidDevice(sub.remnawaveUuid, dev.hwid).catch((e) => {
          console.error("[remove-extras-helper] kick HWID failed:", dev.hwid, e);
        });
        removedHwids += 1;
      }
    }
  } catch (e) {
    console.error("[remove-extras-helper] devices kick error:", e);
  }

  // Уменьшаем лимит в Remna до базы.
  const updateRes = await remnaUpdateUser({
    uuid: sub.remnawaveUuid,
    hwidDeviceLimit: includedDevices,
  });
  if (updateRes.error) {
    return {
      ok: false,
      extraDevicesRemoved: 0,
      hwidKicked: removedHwids,
      newDeviceLimit: 0,
      error: updateRes.error,
    };
  }

  // Обнуляем счётчик + monthlyPrice в БД.
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { extraDevices: 0, extraDevicesMonthlyPrice: 0 },
  });

  return {
    ok: true,
    extraDevicesRemoved: sub.extraDevices ?? 0,
    hwidKicked: removedHwids,
    newDeviceLimit: includedDevices,
  };
}
