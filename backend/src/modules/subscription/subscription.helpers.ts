/**
 * Helper-функции для работы с унифицированной таблицей Subscription.
 *
 * Архитектура (см. план в чате):
 * - У клиента 0..N подписок в таблице `subscriptions`.
 * - subscriptionIndex=0 — «главная» (бывш. root, ранее жила в Client.remnawaveUuid+currentTariffId+autoRenew*).
 * - subscriptionIndex=1..N — дополнительные (бывш. SecondarySubscription).
 * - Все подписки в одной модели — никаких отдельных функций для root и secondary.
 *
 * Правило: «Первая созданная подписка любого типа (покупка / триал / подарок) получает index=0».
 * После «обнуления» (admin revoke / fail продления / истечение без auto-renew) запись index=0
 * остаётся, у неё tariffId=null. Следующая покупка продлевает её — снова главная.
 */

import { prisma } from "../../db.js";

export type SubscriptionWithRelations = Awaited<ReturnType<typeof getPrimarySubscription>>;

/**
 * Получить главную подписку клиента (subscriptionIndex=0) или null если ещё не создана.
 * Используется ВСЮДУ где раньше читали client.remnawaveUuid / client.currentTariffId / client.autoRenewEnabled.
 */
export async function getPrimarySubscription(clientId: string) {
  return prisma.subscription.findUnique({
    where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
    include: {
      tariff: { select: { id: true, name: true, menuEmoji: true, durationDays: true, trafficLimitBytes: true, deviceLimit: true, includedDevices: true, pricePerExtraDevice: true, maxExtraDevices: true, deviceDiscountTiers: true, internalSquadUuids: true, trafficResetMode: true, price: true, currency: true } },
      autoRenewTariff: { select: { id: true, name: true } },
    },
  });
}

/**
 * Получить ВСЕ подписки клиента (отсортированные по subscriptionIndex).
 * Заменяет паттерн «root от Remna + findMany secondary».
 */
export async function getAllClientSubscriptions(clientId: string) {
  return prisma.subscription.findMany({
    where: { ownerId: clientId },
    orderBy: { subscriptionIndex: "asc" },
    include: {
      tariff: { select: { id: true, name: true, menuEmoji: true, trafficLimitBytes: true, price: true, currency: true } },
    },
  });
}

/**
 * следующий subscriptionIndex — ПЕРВЫЙ СВОБОДНЫЙ слот с 0.
 *
 * Простая и правильная логика: проходим 0, 1, 2... и возвращаем первый незанятый.
 *   - У клиента нет подписок → 0
 *   - Подписки [0, 1, 2] → 3
 *   - Подписки [0, 2, 3] → 1 (был gap)
 *   - Подписки [1, 2] → 0 (primary освободился — заполняем!)
 *
 * Раньше было max+1 — после удаления primary новые покупки уезжали в [N+1] и [0] навсегда
 * оставался пустым. Это и был баг «не создаётся 0 после удаления всех подписок».
 */
export async function getNextSubscriptionIndex(clientId: string, minIndex = 0): Promise<number> {
  const subs = await prisma.subscription.findMany({
    where: { ownerId: clientId },
    select: { subscriptionIndex: true },
    orderBy: { subscriptionIndex: "asc" },
  });
  const used = new Set(subs.map((s) => s.subscriptionIndex));
  // T-gift-index-fix : minIndex — нижняя граница поиска. Для подарочных/доп.
  // подписок передаём 1, чтобы не занять primary-слот (0) и найти ПЕРВЫЙ СВОБОДНЫЙ ≥minIndex
  // (а не тупо 1 — иначе у клиента с дырой на index 0 и занятым index 1 был UNIQUE-конфликт
  // (ownerId, subscriptionIndex) и активация подарка после оплаты падала с 500).
  // Защита от бесконечного цикла — 10_000 потолок (реально лимит подписок ≤ 100).
  for (let i = minIndex; i < 10_000; i++) {
    if (!used.has(i)) return i;
  }
  return Math.max(subs.length, minIndex);
}

/**
 * Проверить — есть ли у клиента хоть одна подписка (включая главную).
 * Заменяет проверки `client.remnawaveUuid != null`.
 */
export async function hasAnySubscription(clientId: string): Promise<boolean> {
  const count = await prisma.subscription.count({ where: { ownerId: clientId } });
  return count > 0;
}

/**
 * Получить remnawaveUuid главной подписки клиента (или null).
 * Заменяет прямое чтение `client.remnawaveUuid` в кодовых местах,
 * которые работают с «основной» подпиской.
 */
export async function getPrimaryRemnawaveUuid(clientId: string): Promise<string | null> {
  const primary = await prisma.subscription.findUnique({
    where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
    select: { remnawaveUuid: true },
  });
  return primary?.remnawaveUuid ?? null;
}

/**
 * Найти подписку клиента по её remnawaveUuid (главная или доп).
 * Заменяет логику «если client.remnawaveUuid==uuid → root, иначе ищем в secondary».
 */
export async function findSubscriptionByRemnawaveUuid(uuid: string) {
  return prisma.subscription.findFirst({
    where: { remnawaveUuid: uuid },
    include: { tariff: true },
  });
}

/**
 * Тип подписки относительно клиента: главная (index=0) или дополнительная.
 * Используется для условий «если главная — обновляй currentTariffId, иначе...».
 * В новой модели обоим случаям применяется одна и та же функция.
 */
export function isPrimary(subscription: { subscriptionIndex: number }): boolean {
  return subscription.subscriptionIndex === 0;
}

/**
 * универсальный upsert главной подписки клиента.
 *
 * Гарантирует что у клиента ВСЕГДА появляется Subscription[0] при любом первом контакте
 * с VPN — будь то триал, обычная покупка тарифа, или редкий кейс «первая покупка = подарочная,
 * нет ещё primary».
 *
 * Правило: запись с subscriptionIndex=0 — единственная primary. Если она уже есть — UPDATE.
 * Если нет — CREATE с idx=0 (НЕЗАВИСИМО от того, сколько у клиента уже доп. подписок).
 * Это исправляет старый баг: раньше при наличии Subscription[1+] новая «главная» уходила в
 * idx=max+1 вместо 0, и primary никогда не материализовалась.
 *
 * @param clientId — владелец
 * @param data — поля для записи (remnawaveUuid обязателен, остальное опционально)
 * @returns id созданной/обновлённой подписки
 */
export async function upsertPrimarySubscription(
  clientId: string,
  data: {
    remnawaveUuid: string;
    tariffId?: string | null;
    trialId?: string | null;
    customPrice?: number | null;
    currentPricePerDay?: number | null;
    autoRenewTariffId?: string | null;
    autoRenewPriceOptionId?: string | null;
    autoRenewExtraDevices?: number;
    autoRenewEnabled?: boolean;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.subscription.findUnique({
    where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
    select: { id: true },
  });

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        remnawaveUuid: data.remnawaveUuid,
        // tariffId передаём только если явно указан (включая null → сброс).
        // Trial не должен затирать tariffId предыдущей платной подписки клиента.
        ...(data.tariffId !== undefined ? { tariffId: data.tariffId } : {}),
        ...(data.trialId !== undefined ? { trialId: data.trialId } : {}),
        ...(data.customPrice !== undefined ? { customPrice: data.customPrice } : {}),
        ...(data.currentPricePerDay !== undefined ? { currentPricePerDay: data.currentPricePerDay } : {}),
        ...(data.autoRenewTariffId !== undefined ? { autoRenewTariffId: data.autoRenewTariffId } : {}),
        ...(data.autoRenewPriceOptionId !== undefined ? { autoRenewPriceOptionId: data.autoRenewPriceOptionId } : {}),
        ...(data.autoRenewExtraDevices !== undefined ? { autoRenewExtraDevices: data.autoRenewExtraDevices } : {}),
        ...(data.autoRenewEnabled !== undefined ? { autoRenewEnabled: data.autoRenewEnabled } : {}),
      },
    });
    return { id: existing.id, created: false };
  }

  // Создаём ВСЕГДА как idx=0 — primary-слот может быть занят только одной записью.
  // Если параллельный запрос успеет создать первой — поймаем ошибку уникальности и
  // повторим как UPDATE.
  try {
    const created = await prisma.subscription.create({
      data: {
        ownerId: clientId,
        subscriptionIndex: 0,
        remnawaveUuid: data.remnawaveUuid,
        tariffId: data.tariffId ?? null,
        trialId: data.trialId ?? null,
        customPrice: data.customPrice ?? null,
        currentPricePerDay: data.currentPricePerDay ?? null,
        autoRenewTariffId: data.autoRenewTariffId ?? null,
        autoRenewPriceOptionId: data.autoRenewPriceOptionId ?? null,
        autoRenewExtraDevices: data.autoRenewExtraDevices ?? 0,
        autoRenewEnabled: data.autoRenewEnabled ?? false,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (e) {
    // Race condition: между findUnique и create кто-то ещё создал [0]. Делаем update.
    const again = await prisma.subscription.findUnique({
      where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
      select: { id: true },
    });
    if (!again) throw e;
    await prisma.subscription.update({
      where: { id: again.id },
      data: { remnawaveUuid: data.remnawaveUuid },
    });
    return { id: again.id, created: false };
  }
}

/**
 * следующий index для ДОП. подписки (НЕ primary).
 * Первый свободный слот, но **никогда не 0**. Если [0] свободен — пропускаем, берём 1.
 * Используется для подарочных подписок (они не должны занимать primary-слот).
 */
export async function getNextAdditionalSubscriptionIndex(clientId: string): Promise<number> {
  const subs = await prisma.subscription.findMany({
    where: { ownerId: clientId },
    select: { subscriptionIndex: true },
  });
  const used = new Set(subs.map((s) => s.subscriptionIndex));
  for (let i = 1; i < 10_000; i++) {
    if (!used.has(i)) return i;
  }
  return subs.length + 1;
}

/**
 * универсальный upsert по первому свободному слоту.
 *
 * Используется когда нужно «приземлить» Remna-юзера (UUID) в подписку клиента,
 * НЕ привязываясь к конкретному index. Берём первый свободный (0, 1, 2…) и пишем туда.
 *
 * Если у клиента уже есть подписка с этим remnawaveUuid → UPDATE (а не дубль).
 * Это важно для триала: триал может несколько раз обновлять Remna-юзера в рамках одной
 * подписки клиента, не плодя записи.
 */
export async function upsertSubscriptionByRemnaUuid(
  clientId: string,
  data: {
    remnawaveUuid: string;
    tariffId?: string | null;
    trialId?: string | null;
    customPrice?: number | null;
    currentPricePerDay?: number | null;
    autoRenewEnabled?: boolean;
    expireAt?: Date | null;
  },
): Promise<{ id: string; subscriptionIndex: number; created: boolean }> {
  // Сначала ищем существующую подписку с этим UUID — чтобы не плодить дубли.
  const byUuid = await prisma.subscription.findFirst({
    where: { ownerId: clientId, remnawaveUuid: data.remnawaveUuid },
    select: { id: true, subscriptionIndex: true },
  });
  if (byUuid) {
    await prisma.subscription.update({
      where: { id: byUuid.id },
      data: {
        ...(data.tariffId !== undefined ? { tariffId: data.tariffId } : {}),
        ...(data.trialId !== undefined ? { trialId: data.trialId } : {}),
        ...(data.customPrice !== undefined ? { customPrice: data.customPrice } : {}),
        ...(data.currentPricePerDay !== undefined ? { currentPricePerDay: data.currentPricePerDay } : {}),
        ...(data.autoRenewEnabled !== undefined ? { autoRenewEnabled: data.autoRenewEnabled } : {}),
        ...(data.expireAt !== undefined ? { expireAt: data.expireAt } : {}),
      },
    });
    return { id: byUuid.id, subscriptionIndex: byUuid.subscriptionIndex, created: false };
  }

  // Новая подписка в первом свободном слоте.
  const idx = await getNextSubscriptionIndex(clientId);
  try {
    const created = await prisma.subscription.create({
      data: {
        ownerId: clientId,
        subscriptionIndex: idx,
        remnawaveUuid: data.remnawaveUuid,
        tariffId: data.tariffId ?? null,
        trialId: data.trialId ?? null,
        customPrice: data.customPrice ?? null,
        currentPricePerDay: data.currentPricePerDay ?? null,
        autoRenewEnabled: data.autoRenewEnabled ?? false,
        expireAt: data.expireAt ?? null,
      },
      select: { id: true, subscriptionIndex: true },
    });
    return { id: created.id, subscriptionIndex: created.subscriptionIndex, created: true };
  } catch (e) {
    // Race с unique(ownerId, subscriptionIndex) — пробуем ещё раз с следующим свободным.
    const idx2 = await getNextSubscriptionIndex(clientId);
    if (idx2 === idx) throw e;
    const created = await prisma.subscription.create({
      data: {
        ownerId: clientId,
        subscriptionIndex: idx2,
        remnawaveUuid: data.remnawaveUuid,
        tariffId: data.tariffId ?? null,
        trialId: data.trialId ?? null,
        customPrice: data.customPrice ?? null,
        currentPricePerDay: data.currentPricePerDay ?? null,
        autoRenewEnabled: data.autoRenewEnabled ?? false,
        expireAt: data.expireAt ?? null,
      },
      select: { id: true, subscriptionIndex: true },
    });
    return { id: created.id, subscriptionIndex: created.subscriptionIndex, created: true };
  }
}
