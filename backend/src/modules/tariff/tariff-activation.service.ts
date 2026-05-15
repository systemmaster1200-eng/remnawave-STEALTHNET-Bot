/**
 * Сервис активации тарифа в Remnawave для конкретного клиента.
 * Используется из: оплата балансом, вебхук Platega, админ mark-as-paid.
 */

import { prisma } from "../../db.js";
import {
  remnaCreateUser,
  remnaUpdateUser,
  remnaGetUser,
  isRemnaConfigured,
  remnaGetUserByTelegramId,
  remnaGetUserByEmail,
  extractRemnaUuid,
  remnaUsernameFromClient,
  remnaResetUserTraffic,
} from "../remna/remna.client.js";
import { createAdditionalSubscription } from "../gift/gift.service.js";

export type ActivationResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Извлекает текущий expireAt из ответа Remna GET /api/users/{uuid}.
 * Возвращает Date если дата валидна и в будущем, иначе null.
 */
function extractCurrentExpireAt(data: unknown): Date | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const resp = (o.response ?? o.data ?? o) as Record<string, unknown>;
  const raw = resp?.expireAt;
  if (typeof raw !== "string") return null;
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    // Только если дата в будущем — можно к ней добавлять
    return d.getTime() > Date.now() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Считает новый expireAt:
 * - Если у пользователя уже есть активная подписка (expireAt в будущем) — добавляет durationDays к текущему expireAt
 * - Иначе — от текущего момента + durationDays
 */
function calculateExpireAt(currentExpireAt: Date | null, durationDays: number): string {
  const base = currentExpireAt ?? new Date();
  return new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

/** Извлечь activeInternalSquads (uuid[]) из ответа Remna — чтобы мержить со сквадами тарифа и не затирать доп. опции. */
function extractCurrentSquads(data: unknown): string[] {
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
 * Собрать все сквады, которые относятся к каким-либо тарифам (primary-тарифы из БД).
 * Используется чтобы отличить «тарифный» сквад от add-on-сквада (покупка опции «сервер»,
 * подарок и т. д.). Тарифные сквады заменяются при смене тарифа, остальные сохраняются.
 */
async function getAllTariffSquadUuids(): Promise<Set<string>> {
  const tariffs = await prisma.tariff.findMany({ select: { internalSquadUuids: true } });
  const set = new Set<string>();
  for (const t of tariffs) {
    for (const u of t.internalSquadUuids) set.add(u);
  }
  return set;
}

/**
 * Объединить сквады тарифа с текущими сквадами пользователя.
 * Тарифные сквады старого тарифа замещаются новыми; add-on сквады (не относящиеся
 * ни к одному тарифу — покупки опции «серверы», подарки) — сохраняются.
 */
async function mergeSquads(tariffSquadUuids: string[], currentSquadUuids: string[]): Promise<string[]> {
  const allTariffSquads = await getAllTariffSquadUuids();
  const preserved = currentSquadUuids.filter((u) => !allTariffSquads.has(u) && !tariffSquadUuids.includes(u));
  return [...tariffSquadUuids, ...preserved];
}

export type TrafficResetMode = "no_reset" | "on_purchase" | "monthly" | "monthly_rolling";

function remnaStrategy(mode: TrafficResetMode): "NO_RESET" | "MONTH" | "MONTH_ROLLING" {
  if (mode === "monthly") return "MONTH";
  if (mode === "monthly_rolling") return "MONTH_ROLLING";
  return "NO_RESET";
}

/**
 * Рассчитать pro-rata конвертацию остатка дней при смене тарифной ставки.
 * Возвращает количество "конвертированных" дней, которые добавляются к новой покупке.
 *
 * Формула: convertedDays = floor(remainingDays × oldPricePerDay / newPricePerDay)
 *
 * Логика:
 * - Если ставка (₽/день) совпадает — дни складываются 1:1 без конвертации
 * - Если ставка другая (другой тариф ИЛИ та же модель но другая длительность/устройства) — pro-rata
 *
 * Это закрывает дыру: купил 1 устр за 250 на 30 дней (8.33/день), потом 5 устр за 1000
 * на 30 дней (33.33/день) — без конвертации стеклись бы 30 старых дней по 8.33 + 30 новых
 * по 33.33, и юзер фактически получил бы 60 дней на 5 устройств заплатив за 30. Now: остаток
 * конвертируется по ставке (30 × 8.33 / 33.33 ≈ 7.5 дней).
 */
function computeConvertedDays(args: {
  remainingDays: number;
  oldPricePerDay: number | null;
  newPricePerDay: number;
}): number {
  const { remainingDays, oldPricePerDay, newPricePerDay } = args;
  if (remainingDays <= 0) return 0;
  // Та же ставка — просто стек, без конвертации
  if (oldPricePerDay != null && Math.abs(oldPricePerDay - newPricePerDay) < 0.01) return remainingDays;
  // Нет ставки старого тарифа — не можем считать, теряем остаток (free → бывший trial)
  if (oldPricePerDay == null || oldPricePerDay <= 0) return 0;
  // Новая бесплатная — отдаём как есть (нечего конвертировать)
  if (newPricePerDay <= 0) return remainingDays;
  const converted = Math.floor((remainingDays * oldPricePerDay) / newPricePerDay);
  return Math.max(0, converted);
}

/**
 * Лесенка скидок за число ДОП. устройств: `[{minExtraDevices, discountPercent}]`.
 * Сортируется по minExtraDevices убывающе и берётся первая подходящая.
 */
export type DeviceDiscountTier = { minExtraDevices: number; discountPercent: number };

export function parseDeviceDiscountTiers(raw: unknown): DeviceDiscountTier[] {
  if (!Array.isArray(raw)) return [];
  const out: DeviceDiscountTier[] = [];
  for (const r of raw) {
    if (r && typeof r === "object") {
      const o = r as Record<string, unknown>;
      // Новый ключ minExtraDevices, fallback на старый minDevices для совместимости.
      const minRaw = typeof o.minExtraDevices === "number" ? o.minExtraDevices
        : typeof o.minDevices === "number" ? o.minDevices : NaN;
      const minExtra = Number.isFinite(minRaw) ? Math.floor(minRaw) : NaN;
      const discountPercent = typeof o.discountPercent === "number" ? o.discountPercent : NaN;
      if (Number.isFinite(minExtra) && minExtra >= 1 && Number.isFinite(discountPercent) && discountPercent >= 0 && discountPercent <= 90) {
        out.push({ minExtraDevices: minExtra, discountPercent });
      }
    }
  }
  return out.sort((a, b) => a.minExtraDevices - b.minExtraDevices);
}

/**
 * Цена за пакет ДОП. устройств — учитывает длительность опции и лесенку скидок.
 *
 * `pricePerExtraDevice` указывается админом из расчёта ЗА 30 ДНЕЙ. Для других
 * длительностей цена масштабируется коэффициентом `durationDays / BASE_DAYS`.
 *
 * Скидка применяется к цене за устройство ДО умножения на коэффициент длительности
 * (математически идентично применению после, но логически чище — сначала «цена со
 * скидкой за месяц», потом «помножим на месяцы»).
 *
 * Формула: extrasTotal = pricePerExtraDevice × extras × (100 − discount) / 100 × (durationDays / 30)
 */
export const EXTRA_DEVICE_BASE_DAYS = 30;

export function applyExtraDevicesPrice(
  pricePerExtraDevice: number,
  extraCount: number,
  tiers: DeviceDiscountTier[] | null | undefined,
  durationDays: number = EXTRA_DEVICE_BASE_DAYS,
): { extrasTotal: number; discountPercent: number; appliedTier: DeviceDiscountTier | null } {
  const safeCount = Math.max(0, Math.floor(extraCount));
  if (safeCount === 0 || pricePerExtraDevice <= 0) {
    return { extrasTotal: 0, discountPercent: 0, appliedTier: null };
  }
  const sorted = [...(tiers ?? [])].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const applied = sorted.find((t) => safeCount >= t.minExtraDevices) ?? null;
  const discount = applied ? applied.discountPercent : 0;
  const safeDays = Math.max(1, durationDays);
  const durationCoeff = safeDays / EXTRA_DEVICE_BASE_DAYS;
  // 1) Цена со скидкой за месяц: pricePerExtra × extras × (100 − discount) / 100
  // 2) Масштабируем по длительности: × durationCoeff
  const monthlyWithDiscount = pricePerExtraDevice * safeCount * (100 - discount) / 100;
  const extrasTotal = Math.round(monthlyWithDiscount * durationCoeff * 100) / 100;
  return { extrasTotal, discountPercent: discount, appliedTier: applied };
}

/**
 * Активирует тариф для клиента в Remnawave:
 * - обновляет/создаёт пользователя с expireAt, trafficLimitBytes (в байтах), deviceLimit
 * - назначает activeInternalSquads
 * - При покупке другого тарифа применяет pro-rata конвертацию остатка
 * - При покупке того же тарифа — дни просто суммируются
 *
 * `selectedOption` — выбранная клиентом опция (длительность + цена). Если не задана,
 * fallback на legacy tariff.durationDays + tariff.price.
 *
 * Лимит трафика: в панели 1 ГБ = 1 ГиБ = 1024³ байт; в Remna передаём значение в байтах как есть.
 */
export async function activateTariffForClient(
  client: {
    id: string;
    remnawaveUuid: string | null;
    email: string | null;
    telegramId: string | null;
    telegramUsername?: string | null;
  },
  tariff: {
    id?: string;
    durationDays: number;
    trafficLimitBytes: bigint | null;
    deviceLimit: number | null;
    includedDevices?: number;
    pricePerExtraDevice?: number;
    maxExtraDevices?: number;
    deviceDiscountTiers?: unknown;
    internalSquadUuids: string[];
    trafficResetMode?: string;
    price?: number;
  },
  selectedOption?: { id?: string; durationDays: number; price: number },
  /** Количество ДОП. устройств которые клиент докупил поверх includedDevices (0..maxExtraDevices). */
  extraDevices?: number,
): Promise<ActivationResult> {
  if (!isRemnaConfigured()) return { ok: false, error: "Сервис временно недоступен", status: 503 };

  // Эффективные значения из selectedOption (приоритет) или из legacy полей тарифа.
  const effectiveDays = selectedOption?.durationDays ?? tariff.durationDays;
  const unitPrice = selectedOption?.price ?? tariff.price ?? 0;

  // Параметры устройств:
  //   includedDevices — сколько входит в базовую цену
  //   pricePerExtraDevice — стоимость каждого доп. устройства
  //   maxExtraDevices — верхняя планка для extras
  //   extraDevices (input) — сколько докупает клиент (0..maxExtraDevices)
  const includedDevices = Math.max(1, tariff.includedDevices ?? 1);
  const pricePerExtra = Math.max(0, tariff.pricePerExtraDevice ?? 0);
  const maxExtra = Math.max(0, tariff.maxExtraDevices ?? 0);
  const requestedExtra = extraDevices != null && extraDevices > 0 ? Math.floor(extraDevices) : 0;
  const effectiveExtras = Math.min(Math.max(0, requestedExtra), maxExtra);

  // Скидка + масштаб по длительности применяются только к extras.
  const tiers = parseDeviceDiscountTiers(tariff.deviceDiscountTiers);
  const { extrasTotal } = applyExtraDevicesPrice(pricePerExtra, effectiveExtras, tiers, effectiveDays);
  const effectivePrice = unitPrice + extrasTotal;
  const newPricePerDay = effectiveDays > 0 ? effectivePrice / effectiveDays : 0;

  const trafficLimitBytes = tariff.trafficLimitBytes != null ? Number(tariff.trafficLimitBytes) : 0;
  // HWID лимит = включённые + докупленные. Legacy deviceLimit используется только если
  // фронт/вебхук не сообщил extras (старые ивенты, customBuild).
  const totalDevices = includedDevices + effectiveExtras;
  const hwidDeviceLimit = extraDevices != null ? totalDevices : (tariff.deviceLimit ?? totalDevices);
  const resetMode: TrafficResetMode = (tariff.trafficResetMode as TrafficResetMode) || "no_reset";
  const trafficLimitStrategy = remnaStrategy(resetMode);
  const shouldResetTraffic = resetMode === "on_purchase" || resetMode === "monthly";

  // Загружаем сохранённое состояние клиента для конвертации.
  const dbClient = await prisma.client.findUnique({
    where: { id: client.id },
    select: { currentTariffId: true, currentPricePerDay: true },
  });
  const oldPricePerDay = dbClient?.currentPricePerDay ?? null;

  let workingUuid = client.remnawaveUuid;

  if (workingUuid) {
    const userRes = await remnaGetUser(workingUuid);
    if (userRes.error || !userRes.data) {
      console.warn(`[tariff-activation] Remna user ${workingUuid} not found (status ${userRes.status}), will re-create`);
      workingUuid = null;
      await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: null } });
    }
  }

  if (workingUuid) {
    const userRes = await remnaGetUser(workingUuid);
    const currentExpireAt = extractCurrentExpireAt(userRes.data);
    const currentSquads = extractCurrentSquads(userRes.data);

    // Конвертация остатка при смене тарифа. Если тариф тот же — convertedDays = remainingDays
    // (фактически calculateExpireAt(currentExpireAt, …) делает то же самое — стек).
    // Если тариф другой — конвертируем по формуле (remaining × old$/d / new$/d).
    let bonusDays = 0;
    if (currentExpireAt) {
      const remainingMs = currentExpireAt.getTime() - Date.now();
      const remainingDays = Math.max(0, remainingMs / (24 * 60 * 60 * 1000));
      bonusDays = computeConvertedDays({
        remainingDays,
        oldPricePerDay,
        newPricePerDay,
      });
    }
    // Итог: now + (effectiveDays + bonusDays). Если bonusDays = remainingDays (стек),
    // эффект тот же что и calculateExpireAt(currentExpireAt, effectiveDays).
    const totalDays = effectiveDays + bonusDays;
    const expireAt = new Date(Date.now() + totalDays * 24 * 60 * 60 * 1000).toISOString();
    void calculateExpireAt;
    const activeInternalSquads = await mergeSquads(tariff.internalSquadUuids, currentSquads);

    // Сбрасываем трафик: либо явно указано в режиме тарифа, либо была активная подписка.
    const hadActiveSub = currentExpireAt !== null;
    if (shouldResetTraffic || hadActiveSub) {
      await remnaResetUserTraffic(workingUuid);
    }

    const updateRes = await remnaUpdateUser({
      uuid: workingUuid,
      expireAt,
      trafficLimitBytes,
      trafficLimitStrategy,
      hwidDeviceLimit,
      activeInternalSquads,
    });
    if (updateRes.error) {
      return { ok: false, error: updateRes.error, status: updateRes.status >= 400 ? updateRes.status : 500 };
    }
  } else {
    let existingUuid: string | null = null;
    let currentExpireAt: Date | null = null;

    if (client.telegramId?.trim()) {
      const byTgRes = await remnaGetUserByTelegramId(client.telegramId.trim());
      existingUuid = extractRemnaUuid(byTgRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byTgRes.data);
    }
    if (!existingUuid && client.email?.trim()) {
      const byEmailRes = await remnaGetUserByEmail(client.email.trim());
      existingUuid = extractRemnaUuid(byEmailRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byEmailRes.data);
    }

    // Применяем ту же логику конвертации для случая когда remna-юзер уже был
    // (например создан через бота / старый клиент).
    let bonusDays2 = 0;
    if (currentExpireAt) {
      const remainingMs = currentExpireAt.getTime() - Date.now();
      const remainingDays = Math.max(0, remainingMs / (24 * 60 * 60 * 1000));
      bonusDays2 = computeConvertedDays({
        remainingDays,
        oldPricePerDay,
        newPricePerDay,
      });
    }
    const totalDays2 = effectiveDays + bonusDays2;
    const expireAt = currentExpireAt
      ? new Date(Date.now() + totalDays2 * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + effectiveDays * 24 * 60 * 60 * 1000).toISOString();

    if (!existingUuid) {
      const displayUsername = remnaUsernameFromClient({
        telegramUsername: client.telegramUsername,
        telegramId: client.telegramId,
        email: client.email,
        clientIdFallback: client.id,
      });
      const createRes = await remnaCreateUser({
        username: displayUsername,
        trafficLimitBytes,
        trafficLimitStrategy,
        expireAt,
        hwidDeviceLimit: hwidDeviceLimit ?? undefined,
        activeInternalSquads: tariff.internalSquadUuids,
        ...(client.telegramId?.trim() && { telegramId: parseInt(client.telegramId, 10) }),
        ...(client.email?.trim() && { email: client.email.trim() }),
      });
      existingUuid = extractRemnaUuid(createRes.data);
      if (!existingUuid && createRes.error) {
        console.error("[tariff-activation] Remna createUser failed:", createRes.error, createRes.status);
      }
    } else if (shouldResetTraffic || currentExpireAt !== null) {
      // Симметрично основной ветке (см. выше hadActiveSub):
      // если у юзера в Remna была активная/истёкшая подписка — сбрасываем накопленный трафик,
      // иначе клиент после покупки нового тарифа упирается в лимит сразу.
      await remnaResetUserTraffic(existingUuid);
    }
    if (!existingUuid) return { ok: false, error: "Ошибка создания пользователя VPN", status: 502 };

    const currentSquads = extractCurrentSquads((await remnaGetUser(existingUuid)).data);
    const activeInternalSquads = await mergeSquads(tariff.internalSquadUuids, currentSquads);
    await remnaUpdateUser({ uuid: existingUuid, expireAt, trafficLimitBytes, trafficLimitStrategy, hwidDeviceLimit, activeInternalSquads });
    await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: existingUuid } });
  }

  // Сохраняем currentTariffId + currentPricePerDay как Source of Truth.
  // Также сохраняем контекст для автопродления: priceOption + extras, чтобы крон знал
  // какие именно условия продлевать (легаси модель списывала минимальный price без extras).
  await prisma.client
    .update({
      where: { id: client.id },
      data: {
        ...(tariff.id ? { currentTariffId: tariff.id } : {}),
        currentPricePerDay: newPricePerDay > 0 ? newPricePerDay : null,
        // Привязываем к autoRenew только если у нас есть нормальная опция и тариф из БД.
        // Если selectedOption не пришёл (старый flow) — поле не трогаем, чтобы не сбить ранее сохранённое.
        ...(tariff.id && selectedOption ? { autoRenewExtraDevices: effectiveExtras } : {}),
      },
    })
    .catch(() => {});

  // Синхронизируем autoRenewTariffId с купленным тарифом + сохраняем priceOption.
  // Без autoRenewTariffId плашка «следующее списание» не покажется на /subscription
  // (там guard на autoRenewTariff relation), и крон спишет за старый тариф если был.
  // Связь priceOption требует существующую запись в БД (не просто id) — отдельный апдейт.
  if (tariff.id) {
    await prisma.client
      .update({
        where: { id: client.id },
        data: {
          autoRenewTariffId: tariff.id,
          ...(selectedOption && (selectedOption as { id?: string }).id
            ? { autoRenewPriceOptionId: (selectedOption as { id?: string }).id ?? null }
            : {}),
        },
      })
      .catch(() => {});
  }

  return { ok: true };
}

/**
 * Активация тарифа по paymentId — находит клиента и тариф из Payment (или customBuild из metadata), вызывает activateTariffForClient.
 */
export async function activateTariffByPaymentId(paymentId: string): Promise<ActivationResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      tariffId: true,
      tariffPriceOptionId: true,
      deviceCount: true,
      clientId: true,
      metadata: true,
      tariffPriceOption: { select: { durationDays: true, price: true } },
    },
  });
  if (!payment) {
    return { ok: false, error: "Платёж не найден", status: 404 };
  }

  const client = await prisma.client.findUnique({
    where: { id: payment.clientId },
    select: { id: true, remnawaveUuid: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) {
    return { ok: false, error: "Клиент не найден", status: 404 };
  }

  // Проверяем, является ли это покупкой дополнительной подписки
  const isAdditional = isAdditionalSubscriptionPayment(payment.metadata);

  if (payment.tariffId) {
    const tariff = await prisma.tariff.findUnique({ where: { id: payment.tariffId } });
    if (!tariff) {
      return { ok: false, error: "Тариф не найден", status: 404 };
    }

    // Опция выбора (id + длительность + цена). id нужен чтоб сохранить autoRenewPriceOptionId.
    const selectedOption = payment.tariffPriceOption && payment.tariffPriceOptionId
      ? { id: payment.tariffPriceOptionId, durationDays: payment.tariffPriceOption.durationDays, price: payment.tariffPriceOption.price }
      : undefined;

    if (isAdditional) {
      // Доп. подписка: используем новую модель устройств. payment.deviceCount = extras.
      const result = await createAdditionalSubscription(client.id, {
        id: tariff.id,
        name: tariff.name,
        price: selectedOption?.price ?? tariff.price,
        durationDays: selectedOption?.durationDays ?? tariff.durationDays,
        trafficLimitBytes: tariff.trafficLimitBytes,
        deviceLimit: tariff.deviceLimit,
        includedDevices: tariff.includedDevices,
        internalSquadUuids: tariff.internalSquadUuids,
        trafficResetMode: tariff.trafficResetMode ?? undefined,
      }, { extraDevices: payment.deviceCount ?? 0 });
      return result.ok ? { ok: true } : { ok: false, error: result.error, status: result.status };
    }

    return activateTariffForClient(client, tariff, selectedOption, payment.deviceCount ?? undefined);
  }

  const customBuild = parseCustomBuildMetadata(payment.metadata);
  if (customBuild) {
    if (isAdditional) {
      const result = await createAdditionalSubscription(client.id, customBuild);
      return result.ok ? { ok: true } : { ok: false, error: result.error, status: result.status };
    }
    return activateTariffForClient(client, customBuild);
  }

  return { ok: false, error: "Тариф не привязан к платежу", status: 400 };
}

/** Проверяет, содержит ли metadata флаг isAdditionalSubscription. */
function isAdditionalSubscriptionPayment(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const o = JSON.parse(metadata) as Record<string, unknown>;
    return o?.isAdditionalSubscription === true;
  } catch {
    return false;
  }
}

function parseCustomBuildMetadata(metadata: string | null): { durationDays: number; trafficLimitBytes: bigint | null; deviceLimit: number | null; internalSquadUuids: string[] } | null {
  if (!metadata?.trim()) return null;
  try {
    const o = JSON.parse(metadata) as Record<string, unknown>;
    const cb = o?.customBuild as Record<string, unknown> | undefined;
    if (!cb || typeof cb !== "object") return null;
    const durationDays = typeof cb.durationDays === "number" ? cb.durationDays : 0;
    const deviceLimit = typeof cb.deviceLimit === "number" ? cb.deviceLimit : null;
    const internalSquadUuids = Array.isArray(cb.internalSquadUuids)
      ? (cb.internalSquadUuids as string[]).filter((u) => typeof u === "string" && u.trim())
      : [];
    const trafficLimitBytes =
      typeof cb.trafficLimitBytes === "number" && cb.trafficLimitBytes >= 0
        ? BigInt(Math.floor(cb.trafficLimitBytes))
        : typeof cb.trafficLimitBytes === "string"
          ? BigInt(cb.trafficLimitBytes)
          : null;
    if (durationDays < 1 || internalSquadUuids.length === 0) return null;
    return { durationDays, trafficLimitBytes, deviceLimit, internalSquadUuids };
  } catch {
    return null;
  }
}
