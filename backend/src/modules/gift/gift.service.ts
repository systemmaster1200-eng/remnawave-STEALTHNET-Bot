/**
 * Сервис дополнительных подписок и подарков (v2).
 *
 * Бизнес-логика:
 * 1. Покупка доп. подписки → создаётся SecondarySubscription + Remnawave-пользователь с суффиксом _1, _2, ...
 * 2. Активировать себе → снять GIFT_RESERVED, подписка появляется на дашборде владельца
 * 3. Подарить → генерируется 12-символьный код XXXX-XXXX-XXXX, подписка скрывается (giftStatus = GIFT_RESERVED)
 * 4. Активировать подарок → подписка переносится на получателя (ownerId → recipient, giftedToClientId → recipient)
 * 5. Отмена / экспирация → подписка возвращается дарителю (giftStatus = null)
 * 6. Удаление подписки → remnaDeleteUser + hard delete SecondarySubscription
 *
 * Все мутации логируются в GiftHistory.
 */

import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { sendTelegramNotification } from "./telegram-notify.js";
import {
  remnaCreateUser,
  remnaUsernameFromClient,
  extractRemnaUuid,
  isRemnaConfigured,
  remnaDeleteUser,
} from "../remna/remna.client.js";
import { getSystemConfig } from "../client/client.service.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GiftResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

export type SecondarySubscriptionData = {
  id: string;
  ownerId: string;
  remnawaveUuid: string | null;
  subscriptionIndex: number;
  tariffId: string | null;
  giftStatus: string | null;
  giftedToClientId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Генерирует 12-символьный уникальный код в формате XXXX-XXXX-XXXX. */
function generateGiftCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без I/O/0/1 для читаемости
  let code = "";
  const bytes = randomBytes(12);
  for (let i = 0; i < 12; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

/** Нормализует ввод кода: убирает пробелы/дефисы, приводит к uppercase. */
function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** Определяет следующий subscriptionIndex для данного клиента. */
async function getNextSubscriptionIndex(ownerId: string): Promise<number> {
  const last = await prisma.secondarySubscription.findFirst({
    where: { ownerId },
    orderBy: { subscriptionIndex: "desc" },
    select: { subscriptionIndex: true },
  });
  return (last?.subscriptionIndex ?? 0) + 1;
}

/** Генерирует Remnawave username для дочерней подписки: {rootUsername}_{index}. */
function secondaryRemnaUsername(
  rootClient: { telegramUsername?: string | null; telegramId?: string | null; email?: string | null; id: string },
  index: number,
): string {
  const base = remnaUsernameFromClient({
    telegramUsername: rootClient.telegramUsername,
    telegramId: rootClient.telegramId,
    email: rootClient.email,
    clientIdFallback: rootClient.id,
  });
  const suffix = `_${index}`;
  return (base + suffix).slice(0, 36);
}

/** Записать событие в GiftHistory. */
async function logGiftEvent(
  clientId: string,
  eventType: string,
  secondarySubscriptionId?: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.giftHistory.create({
    data: {
      clientId,
      secondarySubscriptionId: secondarySubscriptionId ?? null,
      eventType,
      metadata: (metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Создаёт дополнительную подписку (SecondarySubscription + Remnawave user).
 * Вызывается ПОСЛЕ успешной оплаты тарифа (из webhook / оплата балансом).
 */
export async function createAdditionalSubscription(
  rootClientId: string,
  tariff: {
    id?: string;
    name?: string;
    price?: number;
    durationDays: number;
    trafficLimitBytes: bigint | null;
    deviceLimit: number | null;
    /** Сколько устройств включено в базовую цену тарифа (новая модель). */
    includedDevices?: number;
    internalSquadUuids: string[];
    trafficResetMode?: string;
  },
  options?: { skipConfigCheck?: boolean; extraDevices?: number },
): Promise<GiftResult<{ secondarySubscriptionId: string; subscriptionIndex: number }>> {
  if (!isRemnaConfigured()) {
    return { ok: false, error: "Сервис временно недоступен", status: 503 };
  }

  const config = await getSystemConfig();
  if (!options?.skipConfigCheck && !config.giftSubscriptionsEnabled) {
    return { ok: false, error: "Дополнительные подписки отключены", status: 403 };
  }

  const rootClient = await prisma.client.findUnique({
    where: { id: rootClientId },
    select: {
      id: true,
      email: true,
      telegramId: true,
      telegramUsername: true,
    },
  });
  if (!rootClient) {
    return { ok: false, error: "Клиент не найден", status: 404 };
  }

  // Проверяем лимит
  const existingCount = await prisma.secondarySubscription.count({
    where: { ownerId: rootClientId },
  });
  if (existingCount >= config.maxAdditionalSubscriptions) {
    return {
      ok: false,
      error: `Максимум ${config.maxAdditionalSubscriptions} дополнительных подписок`,
      status: 400,
    };
  }

  let index = await getNextSubscriptionIndex(rootClientId);

  // Создаём пользователя в Remnawave
  const trafficLimitBytes = tariff.trafficLimitBytes != null ? Number(tariff.trafficLimitBytes) : 0;
  const expireAt = new Date(Date.now() + tariff.durationDays * 24 * 60 * 60 * 1000).toISOString();

  const trafficResetMode = tariff.trafficResetMode || "no_reset";
  const trafficLimitStrategy =
    trafficResetMode === "monthly" ? "MONTH" : trafficResetMode === "monthly_rolling" ? "MONTH_ROLLING" : "NO_RESET";

  // HWID лимит: новая модель — includedDevices + extras. Если ни того, ни другого нет —
  // fallback на legacy deviceLimit (для совместимости со старыми вызовами).
  const includedDevices = tariff.includedDevices ?? null;
  const extraDevices = Math.max(0, options?.extraDevices ?? 0);
  const hwidDeviceLimit = includedDevices != null
    ? includedDevices + extraDevices
    : tariff.deviceLimit ?? undefined;

  // Retry с инкрементом индекса — если username уже занят в Remnawave
  const MAX_ATTEMPTS = 5;
  let remnaUuid: string | undefined;
  let username = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    username = secondaryRemnaUsername(rootClient, index);

    const createRes = await remnaCreateUser({
      username,
      trafficLimitBytes,
      trafficLimitStrategy,
      expireAt,
      hwidDeviceLimit: hwidDeviceLimit ?? undefined,
      activeInternalSquads: tariff.internalSquadUuids,
    });

    remnaUuid = extractRemnaUuid(createRes.data) ?? undefined;
    if (remnaUuid) break;

    const isUsernameTaken =
      createRes.status === 400 &&
      typeof createRes.error === "string" &&
      createRes.error.toLowerCase().includes("already exists");

    if (isUsernameTaken) {
      console.warn(`[gift] Username "${username}" already exists in Remnawave, retrying with index ${index + 1}`);
      index++;
      continue;
    }

    console.error("[gift] Remna createUser failed for secondary:", createRes.error, createRes.status);
    return { ok: false, error: "Ошибка создания VPN-пользователя", status: 502 };
  }

  if (!remnaUuid) {
    console.error(`[gift] Failed to create Remnawave user after ${MAX_ATTEMPTS} attempts for root ${rootClientId}`);
    return { ok: false, error: "Ошибка создания VPN-пользователя (все имена заняты)", status: 502 };
  }

  // Создаём запись SecondarySubscription
  const subscription = await prisma.secondarySubscription.create({
    data: {
      ownerId: rootClientId,
      subscriptionIndex: index,
      remnawaveUuid: remnaUuid,
      tariffId: tariff.id ?? null,
    },
  });

  // Логируем
  await logGiftEvent(rootClientId, "PURCHASED", subscription.id, {
    tariffName: tariff.name ?? null,
    price: tariff.price ?? null,
    subscriptionIndex: index,
  });

  return {
    ok: true,
    data: { secondarySubscriptionId: subscription.id, subscriptionIndex: index },
  };
}

/**
 * Активирует подписку на себя: снимает GIFT_RESERVED, подписка появляется на дашборде.
 * Для подписки, которую клиент купил и ещё не подарил — просто «оставить себе».
 */
export async function activateForSelf(
  ownerId: string,
  subscriptionId: string,
): Promise<GiftResult<{ subscriptionId: string }>> {
  const sub = await prisma.secondarySubscription.findUnique({
    where: { id: subscriptionId },
    include: { tariff: { select: { name: true } } },
  });

  if (!sub || sub.ownerId !== ownerId) {
    return { ok: false, error: "Подписка не найдена", status: 404 };
  }

  if (sub.giftStatus === "ACTIVATED_SELF") {
    // Уже активна на себя
    return { ok: true, data: { subscriptionId } };
  }

  if (sub.giftStatus === "GIFTED") {
    return { ok: false, error: "Подписка уже подарена", status: 400 };
  }

  // Если есть активный код — отменяем его
  if (sub.giftStatus === "GIFT_RESERVED") {
    await prisma.giftCode.updateMany({
      where: { secondarySubscriptionId: subscriptionId, status: "ACTIVE" },
      data: { status: "CANCELLED" },
    });
  }

  await prisma.secondarySubscription.update({
    where: { id: subscriptionId },
    data: { giftStatus: "ACTIVATED_SELF" },
  });

  await logGiftEvent(ownerId, "ACTIVATED_SELF", subscriptionId, {
    tariffName: sub.tariff?.name ?? null,
  });

  return { ok: true, data: { subscriptionId } };
}

/**
 * Удалить дополнительную подписку: отменить коды + remnaDeleteUser + hard delete.
 */
export async function deleteSubscription(
  ownerId: string,
  subscriptionId: string,
): Promise<GiftResult> {
  const sub = await prisma.secondarySubscription.findUnique({
    where: { id: subscriptionId },
    include: { tariff: { select: { name: true } } },
  });

  if (!sub || sub.ownerId !== ownerId) {
    return { ok: false, error: "Подписка не найдена", status: 404 };
  }

  // Нельзя удалить подарённую подписку (она уже у получателя)
  if (sub.giftStatus === "GIFTED" && sub.giftedToClientId) {
    return { ok: false, error: "Нельзя удалить подарённую подписку", status: 400 };
  }

  // Нельзя удалить активированную на себя подписку через раздел подарков
  if (sub.giftStatus === "ACTIVATED_SELF") {
    return { ok: false, error: "Подписка активирована на себя и не может быть удалена из подарков", status: 400 };
  }

  // Отменяем все активные коды
  await prisma.giftCode.updateMany({
    where: { secondarySubscriptionId: subscriptionId, status: "ACTIVE" },
    data: { status: "CANCELLED" },
  });

  // Удаляем пользователя из Remnawave
  if (sub.remnawaveUuid) {
    const deleteRes = await remnaDeleteUser(sub.remnawaveUuid);
    if (deleteRes.status >= 400 && deleteRes.status !== 404) {
      console.warn(`[gift] Failed to delete Remnawave user ${sub.remnawaveUuid}:`, deleteRes.error);
      // Продолжаем удаление — не блокируем
    }
  }

  // Логируем ДО удаления (после удаления FK уже не существует)
  await logGiftEvent(ownerId, "DELETED", subscriptionId, {
    tariffName: sub.tariff?.name ?? null,
    subscriptionIndex: sub.subscriptionIndex,
  });

  // Hard delete
  await prisma.secondarySubscription.delete({
    where: { id: subscriptionId },
  });

  return { ok: true, data: undefined };
}

/**
 * Список всех подписок клиента (основная + дополнительные).
 * Скрытые (giftStatus = GIFT_RESERVED) не включаются.
 * Подаренные и уже активированные у текущего клиента (giftStatus = GIFTED) — показываются.
 */
export async function listClientSubscriptions(
  rootClientId: string,
): Promise<GiftResult<SecondarySubscriptionData[]>> {
  const secondaries = await prisma.secondarySubscription.findMany({
    where: {
      ownerId: rootClientId,
      OR: [
        { giftStatus: null },
        { giftStatus: "" },
        { giftStatus: "ACTIVATED_SELF" },
        { giftStatus: "GIFTED" },
      ], // не показываем только зарезервированные под подарок
    },
    orderBy: { subscriptionIndex: "asc" },
  });
  return { ok: true, data: secondaries };
}

/**
 * Список ВСЕХ подписок клиента включая GIFT_RESERVED и ACTIVATED_SELF (для страницы управления подарками).
 * ACTIVATED_SELF показываются как «активирована на себя» (без кнопок действий).
 * GIFTED включаются — показываются как «подарена вам» (ownerId перезаписан на получателя).
 */
export async function listAllClientSubscriptions(
  rootClientId: string,
): Promise<GiftResult<SecondarySubscriptionData[]>> {
  const secondaries = await prisma.secondarySubscription.findMany({
    where: {
      ownerId: rootClientId,
      OR: [
        { giftStatus: null },
        { giftStatus: "" },
        { giftStatus: "GIFT_RESERVED" },
        { giftStatus: "GIFTED" },
        { giftStatus: "ACTIVATED_SELF" },
      ],
    },
    orderBy: { subscriptionIndex: "asc" },
  });
  return { ok: true, data: secondaries };
}

/**
 * Создаёт код подарка для конкретной дочерней подписки.
 * Помечает подписку как GIFT_RESERVED (скрывает из UI дарителя).
 */
export async function createGiftCode(
  rootClientId: string,
  secondarySubscriptionId: string,
  giftMessage?: string,
  options?: { skipConfigCheck?: boolean },
): Promise<GiftResult<{ code: string; expiresAt: Date; tariffName: string | null }>> {
  const config = await getSystemConfig();
  if (!options?.skipConfigCheck && !config.giftSubscriptionsEnabled) {
    return { ok: false, error: "Подарки отключены", status: 403 };
  }

  // Read for ownership check + tariff name lookup (read-only).
  const sub = await prisma.secondarySubscription.findUnique({
    where: { id: secondarySubscriptionId },
    include: { tariff: { select: { name: true } } },
  });
  if (!sub || sub.ownerId !== rootClientId) {
    return { ok: false, error: "Подписка не найдена", status: 404 };
  }
  if (sub.giftStatus === "GIFTED") {
    return { ok: false, error: "Подписка уже подарена", status: 400 };
  }
  if (sub.giftStatus === "ACTIVATED_SELF") {
    return { ok: false, error: "Подписка активирована на себя и не может быть подарена", status: 400 };
  }

  // Тут была дыра: 25 параллельных /create-code на одну подписку — все 25
  // успевали прочитать giftStatus=null, проверить что активного кода нет,
  // и каждый создавал свой код. На выходе одна подписка → 25+ кодов.
  //
  // Фикс — атомарный flip giftStatus null → GIFT_RESERVED через updateMany.
  // PG лочит строку, кто первый успел — забрал. Остальным count=0, идут
  // лесом с 409. Заодно убирается отдельная проверка "активный код уже есть",
  // потому что инвариант: ACTIVE GiftCode <=> giftStatus = GIFT_RESERVED.
  const reserve = await prisma.secondarySubscription.updateMany({
    where: {
      id: secondarySubscriptionId,
      ownerId: rootClientId,
      giftStatus: null,
    },
    data: { giftStatus: "GIFT_RESERVED" },
  });
  if (reserve.count === 0) {
    return { ok: false, error: "Активный код для этой подписки уже существует", status: 409 };
  }

  // Генерируем уникальный код (теперь это безопасно — резервация уже зафиксирована)
  let code = generateGiftCode();
  let attempts = 0;
  while (attempts < 10) {
    const normalized = normalizeCode(code);
    const exists = await prisma.giftCode.findFirst({
      where: { code: { in: [code, normalized] } },
    });
    if (!exists) break;
    code = generateGiftCode();
    attempts++;
  }
  if (attempts >= 10) {
    // Rollback reservation — could not generate unique code.
    await prisma.secondarySubscription.update({
      where: { id: secondarySubscriptionId },
      data: { giftStatus: null },
    }).catch(() => {});
    return { ok: false, error: "Не удалось сгенерировать уникальный код", status: 500 };
  }

  const expiresAt = new Date(Date.now() + config.giftCodeExpiryHours * 60 * 60 * 1000);

  // Обрезаем сообщение до 200 символов
  const trimmedMessage = giftMessage?.trim().slice(0, 200) || null;

  // Создаём GiftCode. Резервация уже стоит — параллельные /create-code не могут
  // дойти сюда для той же подписки.
  try {
    await prisma.giftCode.create({
      data: {
        code,
        creatorId: rootClientId,
        secondarySubscriptionId,
        status: "ACTIVE",
        expiresAt,
        giftMessage: trimmedMessage,
      },
    });
  } catch (err) {
    // Rollback reservation on unexpected failure (e.g. unique-violation).
    await prisma.secondarySubscription.update({
      where: { id: secondarySubscriptionId },
      data: { giftStatus: null },
    }).catch(() => {});
    throw err;
  }

  await logGiftEvent(rootClientId, "CODE_CREATED", secondarySubscriptionId, {
    code,
    tariffName: sub.tariff?.name ?? null,
    giftMessage: trimmedMessage,
  });

  return { ok: true, data: { code, expiresAt, tariffName: sub.tariff?.name ?? null } };
}

/**
 * Активирует подарок: переносит подписку на получателя.
 * Создаёт новую SecondarySubscription у получателя, обновляет giftedToClientId.
 */
export async function redeemGiftCode(
  recipientRootClientId: string,
  rawCode: string,
): Promise<GiftResult<{ secondarySubscriptionId: string; subscriptionIndex: number; giftMessage: string | null; creatorTelegramId: string | null; tariffName: string | null }>> {
  const config = await getSystemConfig();
  if (!config.giftSubscriptionsEnabled) {
    return { ok: false, error: "Подарки отключены", status: 403 };
  }

  // Находим код (поддержка и с дефисами, и без)
  const normalized = normalizeCode(rawCode);
  const giftCode = await prisma.giftCode.findFirst({
    where: {
      OR: [
        { code: rawCode.trim().toUpperCase() },
        { code: { contains: normalized } },
      ],
      status: "ACTIVE",
    },
    include: {
      secondarySubscription: {
        include: { tariff: { select: { id: true, name: true } } },
      },
    },
  });

  if (!giftCode) {
    // Проверяем, существует ли код вообще (для лучших сообщений об ошибке)
    const anyCode = await prisma.giftCode.findFirst({
      where: {
        OR: [
          { code: rawCode.trim().toUpperCase() },
          { code: { contains: normalized } },
        ],
      },
    });
    if (anyCode) {
      const statusMsg: Record<string, string> = {
        REDEEMED: "Код уже использован",
        EXPIRED: "Код истёк",
        CANCELLED: "Код отменён",
      };
      return { ok: false, error: statusMsg[anyCode.status] ?? "Код недействителен", status: 400 };
    }
    return { ok: false, error: "Код не найден", status: 404 };
  }

  // Lazy expiration check
  if (giftCode.expiresAt < new Date()) {
    await expireGiftCode(giftCode.id, giftCode.secondarySubscriptionId);
    return { ok: false, error: "Код истёк", status: 400 };
  }

  // Нельзя подарить самому себе
  if (giftCode.creatorId === recipientRootClientId) {
    return { ok: false, error: "Нельзя использовать свой собственный подарочный код", status: 400 };
  }

  // Проверяем получателя
  const recipient = await prisma.client.findUnique({
    where: { id: recipientRootClientId },
    select: { id: true },
  });
  if (!recipient) {
    return { ok: false, error: "Получатель не найден", status: 404 };
  }

  // Проверяем лимит у получателя
  const recipientSubCount = await prisma.secondarySubscription.count({
    where: { ownerId: recipientRootClientId },
  });
  if (recipientSubCount >= config.maxAdditionalSubscriptions) {
    return {
      ok: false,
      error: `У получателя уже максимум дополнительных подписок (${config.maxAdditionalSubscriptions})`,
      status: 400,
    };
  }

  // Проверка дублирования: если у получателя уже есть подписка на этот тариф
  const sub = giftCode.secondarySubscription;
  if (sub.tariffId) {
    const existingDupe = await prisma.secondarySubscription.findFirst({
      where: {
        ownerId: recipientRootClientId,
        tariffId: sub.tariffId,
      },
    });
    if (existingDupe) {
      return {
        ok: false,
        error: "У получателя уже есть подписка на этот тариф",
        status: 409,
      };
    }
  }

  // Определяем новый индекс у получателя
  const newIndex = await getNextSubscriptionIndex(recipientRootClientId);

  // Главная дыра в редеме: $transaction([code.update, sub.update]) — НЕ лок.
  // Это просто два SQL'а в одной транзе. Параллельные /redeem с одним кодом
  // все видели status=ACTIVE, каждый писал REDEEMED поверх, каждый перепривязывал
  // подписку себе. По репорту — код прокатил 25 раз. Подписка одна, владельцев 25.
  //
  // Чиним атомарным flip status ACTIVE → REDEEMED через updateMany.
  // Кто первый дошёл — забрал код. Остальным count=0, ответ "уже использован".
  // Перенос подписки делаем уже ПОСЛЕ успешного claim — конкурентов больше нет.
  const claim = await prisma.giftCode.updateMany({
    where: { id: giftCode.id, status: "ACTIVE" },
    data: {
      status: "REDEEMED",
      redeemedById: recipientRootClientId,
      redeemedAt: new Date(),
    },
  });
  if (claim.count === 0) {
    return { ok: false, error: "Код уже использован", status: 400 };
  }

  // Теперь безопасно перепривязываем подписку — других претендентов нет.
  try {
    await prisma.secondarySubscription.update({
      where: { id: giftCode.secondarySubscriptionId },
      data: {
        ownerId: recipientRootClientId,
        subscriptionIndex: newIndex,
        giftStatus: "GIFTED",
        giftedToClientId: recipientRootClientId,
      },
    });
  } catch (err) {
    // Что-то пошло не так после claim — возвращаем код в ACTIVE,
    // чтобы юзер мог ретраить.
    await prisma.giftCode.update({
      where: { id: giftCode.id },
      data: { status: "ACTIVE", redeemedById: null, redeemedAt: null },
    }).catch(() => {});
    throw err;
  }

  // Логируем для обеих сторон
  await logGiftEvent(giftCode.creatorId, "GIFT_SENT", giftCode.secondarySubscriptionId, {
    code: giftCode.code,
    recipientId: recipientRootClientId,
    tariffName: sub.tariff?.name ?? null,
  });
  await logGiftEvent(recipientRootClientId, "GIFT_RECEIVED", giftCode.secondarySubscriptionId, {
    code: giftCode.code,
    senderId: giftCode.creatorId,
    tariffName: sub.tariff?.name ?? null,
    giftMessage: giftCode.giftMessage ?? null,
  });

  // Referral integration: если у получателя нет реферера и подарочный реферал включён
  if (config.giftReferralEnabled) {
    const recipientData = await prisma.client.findUnique({
      where: { id: recipientRootClientId },
      select: { referrerId: true },
    });
    if (recipientData && !recipientData.referrerId && giftCode.creatorId !== recipientRootClientId) {
      await prisma.client.update({
        where: { id: recipientRootClientId },
        data: { referrerId: giftCode.creatorId },
      });
    }
  }

  // Загружаем данные дарителя для уведомлений
  const creator = await prisma.client.findUnique({
    where: { id: giftCode.creatorId },
    select: { telegramId: true },
  });

  // Уведомляем дарителя о том, что подарок активирован (fire-and-forget)
  if (creator?.telegramId) {
    const recipientInfo = await prisma.client.findUnique({
      where: { id: recipientRootClientId },
      select: { telegramUsername: true, email: true },
    });
    const recipientName = recipientInfo?.telegramUsername
      ? `@${recipientInfo.telegramUsername}`
      : recipientInfo?.email?.split("@")[0] ?? "Пользователь";
    const tariffLabel = sub.tariff?.name ? ` (${sub.tariff.name})` : "";
    sendTelegramNotification(
      creator.telegramId,
      `🎁 Ваш подарок активирован!\n\n${recipientName} принял(а) ваш подарок${tariffLabel}.`,
    );
  }

  return {
    ok: true,
    data: {
      secondarySubscriptionId: giftCode.secondarySubscriptionId,
      subscriptionIndex: newIndex,
      giftMessage: giftCode.giftMessage ?? null,
      creatorTelegramId: creator?.telegramId ?? null,
      tariffName: sub.tariff?.name ?? null,
    },
  };
}

/**
 * Отменяет подарочный код: снимает резерв, возвращает подписку дарителю.
 */
export async function cancelGiftCode(
  rootClientId: string,
  codeOrId: string,
): Promise<GiftResult> {
  const normalized = normalizeCode(codeOrId);
  const giftCode = await prisma.giftCode.findFirst({
    where: {
      OR: [
        { code: codeOrId.toUpperCase() },
        { code: { contains: normalized } },
        { id: codeOrId },
      ],
      creatorId: rootClientId,
      status: "ACTIVE",
    },
  });
  if (!giftCode) {
    return { ok: false, error: "Активный код не найден", status: 404 };
  }

  await prisma.$transaction([
    prisma.giftCode.update({
      where: { id: giftCode.id },
      data: { status: "CANCELLED" },
    }),
    prisma.secondarySubscription.update({
      where: { id: giftCode.secondarySubscriptionId },
      data: { giftStatus: null },
    }),
  ]);

  await logGiftEvent(rootClientId, "CODE_CANCELLED", giftCode.secondarySubscriptionId, {
    code: giftCode.code,
  });

  return { ok: true, data: undefined };
}

/**
 * Помечает код как истёкший и снимает резерв с подписки.
 * Вызывается при lazy check (попытка использования просроченного кода).
 */
async function expireGiftCode(giftCodeId: string, secondarySubscriptionId: string): Promise<void> {
  await prisma.$transaction([
    prisma.giftCode.update({
      where: { id: giftCodeId },
      data: { status: "EXPIRED" },
    }),
    prisma.secondarySubscription.update({
      where: { id: secondarySubscriptionId },
      data: { giftStatus: null },
    }),
  ]);

  const gc = await prisma.giftCode.findUnique({
    where: { id: giftCodeId },
    select: { creatorId: true, code: true },
  });
  if (gc) {
    await logGiftEvent(gc.creatorId, "CODE_EXPIRED", secondarySubscriptionId, {
      code: gc.code,
    });
  }
}

/**
 * Lazy expiration: обрабатывает все просроченные активные коды.
 * Вызывается периодически (или при каждом запросе к списку кодов).
 */
export async function expireOldGiftCodes(): Promise<number> {
  const expiredCodes = await prisma.giftCode.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: { lt: new Date() },
    },
    select: { id: true, secondarySubscriptionId: true },
  });

  for (const gc of expiredCodes) {
    await expireGiftCode(gc.id, gc.secondarySubscriptionId);
  }

  if (expiredCodes.length > 0) {
    console.log(`[gift] Expired ${expiredCodes.length} gift codes`);
  }

  return expiredCodes.length;
}

/**
 * Список подарочных кодов, созданных клиентом.
 */
export async function listGiftCodes(
  rootClientId: string,
): Promise<GiftResult<Array<{
  id: string;
  code: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  redeemedAt: Date | null;
  giftMessage: string | null;
  secondarySubscriptionId: string;
}>>> {
  // Lazy expire перед выдачей списка
  await expireOldGiftCodes();

  const codes = await prisma.giftCode.findMany({
    where: { creatorId: rootClientId },
    select: {
      id: true,
      code: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      redeemedAt: true,
      giftMessage: true,
      secondarySubscriptionId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return { ok: true, data: codes };
}

/**
 * Получает Remnawave subscription URL для конкретной подписки.
 */
export async function getSubscriptionUrl(
  subscriptionId: string,
  rootClientId: string,
): Promise<GiftResult<{ uuid: string }>> {
  const sub = await prisma.secondarySubscription.findUnique({
    where: { id: subscriptionId },
    select: { ownerId: true, remnawaveUuid: true, giftStatus: true },
  });

  if (!sub || sub.ownerId !== rootClientId) {
    return { ok: false, error: "Подписка не найдена", status: 404 };
  }
  if (sub.giftStatus === "GIFT_RESERVED") {
    return { ok: false, error: "Подписка зарезервирована как подарок", status: 400 };
  }
  if (!sub.remnawaveUuid) {
    return { ok: false, error: "VPN-пользователь не создан", status: 400 };
  }

  return { ok: true, data: { uuid: sub.remnawaveUuid } };
}

/**
 * Получить историю подарочных событий клиента (с пагинацией).
 */
export async function getGiftHistory(
  clientId: string,
  page: number = 1,
  limit: number = 20,
): Promise<GiftResult<{ items: Array<{
  id: string;
  eventType: string;
  metadata: unknown;
  createdAt: Date;
  secondarySubscriptionId: string | null;
}>; total: number; page: number; limit: number }>> {
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.giftHistory.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        eventType: true,
        metadata: true,
        createdAt: true,
        secondarySubscriptionId: true,
      },
    }),
    prisma.giftHistory.count({ where: { clientId } }),
  ]);

  return { ok: true, data: { items, total, page, limit } };
}

/**
 * Публичная информация о подарочном коде (для страницы /gift/:code).
 * Не требует авторизации.
 */
export async function getPublicGiftCodeInfo(
  rawCode: string,
): Promise<GiftResult<{
  code: string;
  status: string;
  giftMessage: string | null;
  expiresAt: Date;
  createdAt: Date;
  tariffName: string | null;
  isExpired: boolean;
}>> {
  const normalized = normalizeCode(rawCode);
  const gc = await prisma.giftCode.findFirst({
    where: {
      OR: [
        { code: rawCode.trim().toUpperCase() },
        { code: { contains: normalized } },
      ],
    },
    include: {
      secondarySubscription: {
        include: { tariff: { select: { name: true } } },
      },
    },
  });

  if (!gc) {
    return { ok: false, error: "Код не найден", status: 404 };
  }

  // Lazy expire
  const isExpired = gc.status === "ACTIVE" && gc.expiresAt < new Date();
  if (isExpired) {
    await expireGiftCode(gc.id, gc.secondarySubscriptionId);
  }

  return {
    ok: true,
    data: {
      code: gc.code,
      status: isExpired ? "EXPIRED" : gc.status,
      giftMessage: gc.giftMessage,
      expiresAt: gc.expiresAt,
      createdAt: gc.createdAt,
      tariffName: gc.secondarySubscription?.tariff?.name ?? null,
      isExpired: isExpired || gc.status === "EXPIRED",
    },
  };
}

/**
 * Создание подарочного кода от лица администратора.
 * Создаёт SecondarySubscription у указанного клиента + генерирует код.
 */
export async function adminCreateGiftCode(
  ownerClientId: string,
  tariffId: string,
  giftMessage?: string,
): Promise<GiftResult<{ code: string; expiresAt: Date; secondarySubscriptionId: string }>> {
  // Находим тариф
  const tariff = await prisma.tariff.findUnique({
    where: { id: tariffId },
  });
  if (!tariff) {
    return { ok: false, error: "Тариф не найден", status: 404 };
  }

  // Создаём подписку (админ обходит проверку giftSubscriptionsEnabled)
  const subResult = await createAdditionalSubscription(ownerClientId, {
    id: tariff.id,
    name: tariff.name,
    price: 0, // admin-created, no cost
    durationDays: tariff.durationDays,
    trafficLimitBytes: tariff.trafficLimitBytes,
    deviceLimit: tariff.deviceLimit,
    internalSquadUuids: tariff.internalSquadUuids ?? [],
    trafficResetMode: tariff.trafficResetMode ?? undefined,
  }, { skipConfigCheck: true });
  if (!subResult.ok) {
    return subResult;
  }

  // Создаём подарочный код (админ обходит проверку giftSubscriptionsEnabled)
  const codeResult = await createGiftCode(
    ownerClientId,
    subResult.data.secondarySubscriptionId,
    giftMessage,
    { skipConfigCheck: true },
  );
  if (!codeResult.ok) {
    return codeResult;
  }

  // Логируем как ADMIN_CREATED
  await logGiftEvent(ownerClientId, "ADMIN_CREATED", subResult.data.secondarySubscriptionId, {
    tariffName: tariff.name,
    code: codeResult.data.code,
    giftMessage: giftMessage?.trim().slice(0, 200) || null,
    createdByAdmin: true,
  });

  return {
    ok: true,
    data: {
      code: codeResult.data.code,
      expiresAt: codeResult.data.expiresAt,
      secondarySubscriptionId: subResult.data.secondarySubscriptionId,
    },
  };
}
