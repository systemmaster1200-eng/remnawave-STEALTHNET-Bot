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
  remnaDeleteUser,
} from "../remna/remna.client.js";
import { createAdditionalSubscription } from "../gift/gift.service.js";
import { getSystemConfig } from "../client/client.service.js";
import { upsertSubscriptionByRemnaUuid } from "../subscription/subscription.helpers.js";

export type ActivationResult =
  | { ok: true; /** дни, добавленные pro-rata конвертацией остатка (режим convert) */ convertedDays?: number }
  | { ok: false; error: string; status: number };

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
/**
 * текущий trafficLimitBytes из Remnawave-юзера.
 * Используется в логике накопительного трафика при продлении тарифа.
 */
function extractCurrentTrafficLimitBytes(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const o = data as Record<string, unknown>;
  const inner = (o.response ?? o.data ?? o) as Record<string, unknown>;
  const v = inner?.trafficLimitBytes;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * текущий ИСПОЛЬЗОВАННЫЙ трафик из Remnawave-юзера.
 * Поле: `userTraffic.usedTrafficBytes` (проверено на API стенда). Нужен для режима
 * «перенос остатка» — считаем remaining = limit − used.
 */
function extractCurrentTrafficUsed(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const o = data as Record<string, unknown>;
  const inner = (o.response ?? o.data ?? o) as Record<string, unknown>;
  const ut = inner?.userTraffic as Record<string, unknown> | undefined;
  const v = ut?.usedTrafficBytes;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * единая логика трафика при продлении подписки.
 * Возвращает финальный лимит и флаг «нужно ли сбросить used счётчик в Remna».
 *
 * Режимы (0 = безлимит):
 *  - on_purchase / monthly → жёсткий сброс: лимит = тариф, used → 0.
 *  - carry_over ИЛИ триал   → перенос остатка: лимит = тариф + max(0, limit − used), used → 0.
 *      Пример: было 90 ГБ, использовано 40 (остаток 50), докупили 90 → 0 из 140.
 *      Для триала: было 90, использовано 87 (остаток 3), продлили на 90 → 0 из 93.
 *  - no_reset (рост без сброса) → стек: лимит = текущий + тариф, used НЕ трогаем.
 *      Пример: было 90/used 40, докупили 90 → 40 из 180.
 *  - нет активной подписки    → просто ставим лимит тарифа (юзер новый/истёк).
 */
function computeTrafficOnRenewal(args: {
  mode: TrafficResetMode;
  isTrial: boolean;
  currentLimitBytes: number;
  currentUsedBytes: number;
  newTariffLimitBytes: number;
  hadActiveSub: boolean;
}): { finalLimitBytes: number; resetUsed: boolean } {
  const { mode, isTrial, currentLimitBytes, currentUsedBytes, newTariffLimitBytes } = args;

  // T-traffic-expired-fix : перенос остатка (carry_over) и стек (no_reset)
  // применяются и к ИСТЁКШИМ подпискам. Раньше тут стоял ранний `if (!hadActiveSub) return
  // newTariffLimitBytes` — он обнулял перенос у всех, кто продлевал ПОСЛЕ истечения (трафик
  // «не переносился»: было 90/used 40 → продлил после истечения → 40/90 вместо 0/140).
  // Remna-юзер при истечении НЕ удаляется → currentLimit/used валидны, переносим как у активных.
  // (hadActiveSub в args оставлен для совместимости вызова, но на трафик больше не влияет.)

  const eitherUnlimited = currentLimitBytes === 0 || newTariffLimitBytes === 0;

  if (mode === "on_purchase" || mode === "monthly") {
    return { finalLimitBytes: newTariffLimitBytes, resetUsed: true };
  }

  if (mode === "carry_over" || isTrial) {
    if (eitherUnlimited) return { finalLimitBytes: 0, resetUsed: true };
    const remaining = Math.max(0, currentLimitBytes - currentUsedBytes);
    return { finalLimitBytes: newTariffLimitBytes + remaining, resetUsed: true };
  }

  // no_reset (рост без сброса)
  if (eitherUnlimited) return { finalLimitBytes: 0, resetUsed: false };
  return { finalLimitBytes: currentLimitBytes + newTariffLimitBytes, resetUsed: false };
}

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

// добавлен режим "carry_over" — перенос остатка трафика.
// В Remna ставится NO_RESET (как и no_reset), но панель сама пересчитывает лимит и сбрасывает used.
export type TrafficResetMode = "no_reset" | "carry_over" | "on_purchase" | "monthly" | "monthly_rolling";

function remnaStrategy(mode: TrafficResetMode): "NO_RESET" | "MONTH" | "MONTH_ROLLING" {
  if (mode === "monthly") return "MONTH";
  if (mode === "monthly_rolling") return "MONTH_ROLLING";
  // no_reset И carry_over → NO_RESET (carry_over управляется панелью, не Remna).
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
export function computeConvertedDays(args: {
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

  // Загружаем сохранённое состояние клиента для конвертации.
  const dbClient = await prisma.client.findUnique({
    where: { id: client.id },
    select: { currentTariffId: true, currentPricePerDay: true },
  });
  const oldPricePerDay = dbClient?.currentPricePerDay ?? null;

  let workingUuid = client.remnawaveUuid;
  // сохраняем итоговый expireAt чтобы синкнуть его в БД.
  let finalExpireAt: string | null = null;

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
    finalExpireAt = expireAt;
    void calculateExpireAt;
    const activeInternalSquads = await mergeSquads(tariff.internalSquadUuids, currentSquads);

    // единая логика трафика при продлении (см. computeTrafficOnRenewal).
    //   on_purchase/monthly → сброс used + лимит тарифа.
    //   carry_over          → перенос остатка (limit−used) + лимит тарифа, used сброшен.
    //   no_reset            → стек лимита, used сохраняется.
    // Primary-активация тут (триалы идут через secondary) — isTrial=false.
    const hadActiveSub = currentExpireAt !== null;
    const currentLimitBytes = extractCurrentTrafficLimitBytes(userRes.data);
    const currentUsedBytes = extractCurrentTrafficUsed(userRes.data);
    const traffic = computeTrafficOnRenewal({
      mode: resetMode,
      isTrial: false,
      currentLimitBytes,
      currentUsedBytes,
      newTariffLimitBytes: trafficLimitBytes,
      hadActiveSub,
    });
    // T-traffic-expired-fix : used сбрасываем по resetUsed независимо от
    // hadActiveSub — иначе у истёкших carry_over лимит рос (90+остаток), а счётчик used не обнулялся.
    if (traffic.resetUsed) {
      await remnaResetUserTraffic(workingUuid);
    }
    const finalTrafficLimitBytes = traffic.finalLimitBytes;

    const updateRes = await remnaUpdateUser({
      uuid: workingUuid,
      expireAt,
      trafficLimitBytes: finalTrafficLimitBytes,
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
    finalExpireAt = expireAt;

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
    }
    if (!existingUuid) return { ok: false, error: "Ошибка создания пользователя VPN", status: 502 };

    const remnaUserData = (await remnaGetUser(existingUuid)).data;
    const currentSquads = extractCurrentSquads(remnaUserData);
    const activeInternalSquads = await mergeSquads(tariff.internalSquadUuids, currentSquads);

    // единая логика трафика для существующего Remna-юзера
    // (нашли по TG/email). Primary-активация → isTrial=false.
    const currentLimit2 = extractCurrentTrafficLimitBytes(remnaUserData);
    const currentUsed2 = extractCurrentTrafficUsed(remnaUserData);
    const traffic2 = computeTrafficOnRenewal({
      mode: resetMode,
      isTrial: false,
      currentLimitBytes: currentLimit2,
      currentUsedBytes: currentUsed2,
      newTariffLimitBytes: trafficLimitBytes,
      hadActiveSub: currentExpireAt !== null,
    });
    // T-traffic-expired-fix : used сбрасываем по resetUsed, не завися от истечения.
    if (traffic2.resetUsed) {
      await remnaResetUserTraffic(existingUuid);
    }
    await remnaUpdateUser({ uuid: existingUuid, expireAt, trafficLimitBytes: traffic2.finalLimitBytes, trafficLimitStrategy, hwidDeviceLimit, activeInternalSquads });
    await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: existingUuid } });
  }

  // Сохраняем currentTariffId + currentPricePerDay как Source of Truth (Client — DEPRECATED, для совместимости кабинета).
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

  // материализуем подписку для этого Remna-юзера в БД.
  // Если уже есть подписка с этим UUID — UPDATE (тариф/цена). Если нет — создаём в первом
  // свободном слоте (0, 1, 2…). Не привязываемся жёстко к [0] — это даёт правильное поведение
  // когда клиент впервые покупает после удаления primary, или просто покупает первый тариф.
  const finalUuid = await prisma.client.findUnique({ where: { id: client.id }, select: { remnawaveUuid: true } }).then((c) => c?.remnawaveUuid ?? null);
  if (finalUuid) {
    await upsertSubscriptionByRemnaUuid(client.id, {
      remnawaveUuid: finalUuid,
      ...(tariff.id ? { tariffId: tariff.id } : {}),
      trialId: null,
      customPrice: effectivePrice,
      currentPricePerDay: newPricePerDay > 0 ? newPricePerDay : null,
      // кешируем дату истечения для broadcast-фильтра.
      ...(finalExpireAt ? { expireAt: new Date(finalExpireAt) } : {}),
    }).catch((e) => console.error("[tariff-activation] upsertSubscriptionByRemnaUuid failed:", e));
  }

  // Синхронизируем autoRenewTariffId с купленным тарифом + сохраняем priceOption.
  // Без autoRenewTariffId плашка «следующее списание» не покажется на /subscription
  // (там guard на autoRenewTariff relation), и крон спишет за старый тариф если был.
  // Связь priceOption требует существующую запись в БД (не просто id) — отдельный апдейт.
  if (tariff.id) {
    // если админ включил «Автопродление по умолчанию» —
    // при покупке тарифа автоматически включаем autoRenewEnabled у клиента (если не было раньше).
    // Не перезаписываем если юзер сам выключил autoRenew — только включаем тем у кого false.
    const cfgForDefault = await getSystemConfig().catch(() => null);
    const shouldDefaultEnableAR = cfgForDefault?.defaultAutoRenewEnabled === true;
    const currentClient = shouldDefaultEnableAR
      ? await prisma.client.findUnique({ where: { id: client.id }, select: { autoRenewEnabled: true } })
      : null;
    const turnOnAR = shouldDefaultEnableAR && currentClient && currentClient.autoRenewEnabled === false;

    await prisma.client
      .update({
        where: { id: client.id },
        data: {
          autoRenewTariffId: tariff.id,
          ...(selectedOption && (selectedOption as { id?: string }).id
            ? { autoRenewPriceOptionId: (selectedOption as { id?: string }).id ?? null }
            : {}),
          ...(turnOnAR ? { autoRenewEnabled: true } : {}),
        },
      })
      .catch(() => {});

    // синхронизируем autoRenewEnabled на Subscription[0].
    if (turnOnAR) {
      await prisma.subscription.updateMany({
        where: { ownerId: client.id, subscriptionIndex: 0 },
        data: { autoRenewEnabled: true },
      }).catch(() => {});
    }
  }

  return { ok: true };
}

/**
 * Продление существующей **secondary** подписки.
 * В отличие от activateTariffForClient — работает с конкретной SecondarySubscription
 * (не с client.remnawaveUuid), не трогает client.currentTariffId / autoRenew.
 *
 * Логика:
 * 1. Находим secondary, берём её remnawaveUuid (это пользователь Remna для этой sub).
 * 2. Из Remna читаем текущий expireAt и squads.
 * 3. Если expireAt в будущем → новая дата = expireAt + effectiveDays (стек).
 *    Если в прошлом или нет → новая дата = now + effectiveDays.
 * 4. PATCH в Remna: новый expireAt + лимиты + squads.
 * 5. Опц.: обновляем secondary.tariffId если клиент сменил тариф.
 */
export async function extendSecondarySubscription(
  secondaryId: string,
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
  extraDevices?: number,
  /** убрать доп. устройства после
   *  успешного продления. Используется когда юзер выбрал «продлить без устройств». */
  removeExtrasAfter?: boolean,
  /** режим КОНВЕРТАЦИИ (single-subscription категории / переход с триала):
   *  вместо стека дней к expireAt — остаток конвертируется pro-rata по ставке
   *  (computeConvertedDays), отсчёт от «сейчас», сквады ЗАМЕНЯЮТСЯ на сквады
   *  нового тарифа, трафик начинается заново по новому тарифу. */
  convertMode?: boolean,
): Promise<ActivationResult> {
  if (!isRemnaConfigured()) return { ok: false, error: "Сервис временно недоступен", status: 503 };

  const sec = await prisma.subscription.findUnique({
    where: { id: secondaryId },
    select: { id: true, remnawaveUuid: true, tariffId: true, ownerId: true, customPrice: true, extraDevices: true, extraDevicesMonthlyPrice: true, trialId: true, currentPricePerDay: true },
  });
  if (!sec) {
    return { ok: false, error: "Доп. подписка не найдена", status: 404 };
  }
  if (!sec.remnawaveUuid) {
    return { ok: false, error: "Доп. подписка не привязана к Remnawave", status: 400 };
  }

  const effectiveDays = selectedOption?.durationDays ?? tariff.durationDays;
  const includedDevices = Math.max(1, tariff.includedDevices ?? 1);

  // T-extras-universal (12.06.2026): устройства, докупаемые ЭТОЙ оплатой
  // (deviceCount платежа), теперь честно выдаются и при продлении/конвертации —
  // раньше параметр игнорировался (void), и «+2 устройства» при покупке тарифа
  // из single-категории пропадали. Цена этих extras уже включена в сумму платежа
  // (client.routes считает calcExtrasPrice для ЛЮБОЙ покупки).
  const maxExtra = Math.max(0, tariff.maxExtraDevices ?? 0);
  const newExtras = Math.min(Math.max(0, Math.floor(extraDevices ?? 0)), maxExtra);
  // существующие extras подписки: остаются или убираются по removeExtrasAfter.
  const keptExtras = removeExtrasAfter ? 0 : (sec.extraDevices ?? 0);
  const keptExtrasMonthly = removeExtrasAfter ? 0 : (sec.extraDevicesMonthlyPrice ?? 0);
  // месячная ставка новых extras — для будущих продлений (формула option.price + monthly × days/30).
  const newExtrasMonthly = newExtras > 0
    ? applyExtraDevicesPrice(
        Math.max(0, tariff.pricePerExtraDevice ?? 0),
        newExtras,
        parseDeviceDiscountTiers(tariff.deviceDiscountTiers),
        EXTRA_DEVICE_BASE_DAYS,
      ).extrasTotal
    : 0;
  const effectiveExtras = keptExtras + newExtras;
  const effectiveExtrasMonthly = Math.round((keptExtrasMonthly + newExtrasMonthly) * 100) / 100;

  const trafficLimitBytes = tariff.trafficLimitBytes != null ? Number(tariff.trafficLimitBytes) : 0;
  const totalDevices = includedDevices + effectiveExtras;
  const hwidDeviceLimit = totalDevices;
  const resetMode: TrafficResetMode = (tariff.trafficResetMode as TrafficResetMode) || "no_reset";
  const trafficLimitStrategy = remnaStrategy(resetMode);

  const userRes = await remnaGetUser(sec.remnawaveUuid);
  if (userRes.error || !userRes.data) {
    return { ok: false, error: "Пользователь VPN для этой подписки не найден", status: 404 };
  }
  const currentExpireAt = extractCurrentExpireAt(userRes.data);
  const currentSquads = extractCurrentSquads(userRes.data);

  // конвертация ТРИАЛА — это всегда переход (convertMode):
  // сквады заменяются на сквады целевого тарифа (уход с триального сквада),
  // трафик начинается заново. Остаток бесплатных дней не конвертируется
  // (currentPricePerDay у триала нет → computeConvertedDays вернёт 0).
  const isTrialConversion = sec.trialId != null;
  const effectiveConvert = convertMode || isTrialConversion;

  // ── Конвертация: остаток дней переносится pro-rata по ставке, отсчёт от «сейчас» ──
  //
  // учёт ДОП. УСТРОЙСТВ (sell-options) в ставках. Юзер платил
  // полную ставку: базовый тариф + доп. устройства (extraDevicesMonthlyPrice за 30 дн).
  // Вся эта остаточная ценность конвертируется:
  //   • УБИРАЕТ устройства (removeExtrasAfter) → ценность устройств тоже превращается
  //     в дни чистого нового тарифа — дней БОЛЬШЕ, устройств меньше.
  //   • ОСТАВЛЯЕТ устройства → они переезжают на новую подписку (новый included +
  //     прежние extra), но новая полная ставка выше (тариф + устройства) — дней МЕНЬШЕ.
  let convertedDays = 0;
  if (effectiveConvert) {
    const remainingMs = currentExpireAt ? currentExpireAt.getTime() - Date.now() : 0;
    const remainingDays = Math.max(0, Math.floor(remainingMs / 86_400_000));
    if (isTrialConversion) {
      // конвертация ТРИАЛА сохраняет дни 1:1 (и остаток
      // трафика — см. traffic ниже): юзер ничего не теряет при переходе на платный.
      convertedDays = remainingDays;
    } else {
      const newPrice = selectedOption?.price ?? tariff.price ?? 0;
      const newBasePerDay = effectiveDays > 0 ? newPrice / effectiveDays : 0;
      const extrasPerDay = (sec.extraDevices ?? 0) > 0 ? (sec.extraDevicesMonthlyPrice ?? 0) / 30 : 0;
      const keepExtras = !removeExtrasAfter && extrasPerDay > 0;
      // Старая ПОЛНАЯ ставка (база + устройства).
      const oldFullPerDay = sec.currentPricePerDay != null
        ? sec.currentPricePerDay + extrasPerDay
        : (extrasPerDay > 0 ? extrasPerDay : null);
      // Новая ставка: с устройствами, если юзер их оставляет.
      const newFullPerDay = newBasePerDay + (keepExtras ? extrasPerDay : 0);
      convertedDays = computeConvertedDays({
        remainingDays,
        oldPricePerDay: oldFullPerDay,
        newPricePerDay: newFullPerDay,
      });
    }
  }

  // Стек дней: если подписка активна → +effectiveDays к expireAt; иначе now+effectiveDays.
  // При конвертации стека нет — всегда now + (купленные дни + конвертированный остаток).
  const baseDate = !effectiveConvert && currentExpireAt && currentExpireAt.getTime() > Date.now()
    ? currentExpireAt
    : new Date();
  const totalDays = effectiveDays + convertedDays;
  const expireAt = new Date(baseDate.getTime() + totalDays * 24 * 60 * 60 * 1000).toISOString();

  // Конвертация = переход на другой тариф: сквады ЗАМЕНЯЮТСЯ (юзер уходит со старых
  // серверов — в т.ч. с триального сквада — на сервера нового тарифа).
  // Обычное продление — merge, как раньше.
  const activeInternalSquads = effectiveConvert
    ? tariff.internalSquadUuids
    : await mergeSquads(tariff.internalSquadUuids, currentSquads);
  const hadActiveSub = currentExpireAt !== null;

  // единая логика трафика (см. computeTrafficOnRenewal).
  const currentLimitBytes = extractCurrentTrafficLimitBytes(userRes.data);
  const currentUsedBytes = extractCurrentTrafficUsed(userRes.data);
  // При конвертации трафик начинается заново по новому тарифу (это смена тарифа,
  // а не продление того же) — лимит нового тарифа, счётчик used в ноль.
  // конвертация ТРИАЛА переносит неизрасходованный остаток
  // («гиги остаются»): finalLimit = лимит нового тарифа + остаток триала.
  const trialCarryOver = isTrialConversion && trafficLimitBytes > 0
    ? Math.max(0, (currentLimitBytes ?? 0) - (currentUsedBytes ?? 0))
    : 0;
  const traffic = effectiveConvert
    ? { finalLimitBytes: trafficLimitBytes > 0 ? trafficLimitBytes + trialCarryOver : trafficLimitBytes, resetUsed: true }
    : computeTrafficOnRenewal({
        mode: resetMode,
        isTrial: false,
        currentLimitBytes,
        currentUsedBytes,
        newTariffLimitBytes: trafficLimitBytes,
        hadActiveSub,
      });
  // T-traffic-expired-fix : used сбрасываем по resetUsed, не завися от истечения
  // (доп./триальные подписки тоже должны переносить остаток после истечения).
  if (traffic.resetUsed) {
    await remnaResetUserTraffic(sec.remnawaveUuid);
  }
  const finalTrafficLimitBytes = traffic.finalLimitBytes;

  const updateRes = await remnaUpdateUser({
    uuid: sec.remnawaveUuid,
    expireAt,
    trafficLimitBytes: finalTrafficLimitBytes,
    trafficLimitStrategy,
    hwidDeviceLimit,
    activeInternalSquads,
  });
  if (updateRes.error) {
    return { ok: false, error: updateRes.error, status: updateRes.status >= 400 ? updateRes.status : 500 };
  }

  // синкаем expireAt и tariffId в БД одним апдейтом.
  // Если подписка была trial-овой — снимаем trial-метку (юзер продлил настоящим тарифом).
  // фиксируем итоговое количество extraDevices.
  // В convertMode дополнительно фиксируем новую цену/ставку (для будущих продлений и автосписаний).
  const newPriceForDb = selectedOption?.price ?? tariff.price;
  await prisma.subscription.update({
    where: { id: sec.id },
    data: {
      expireAt: new Date(expireAt),
      trialId: null,
      extraDevices: effectiveExtras,
      extraDevicesMonthlyPrice: effectiveExtrasMonthly,
      ...(tariff.id && tariff.id !== sec.tariffId ? { tariffId: tariff.id } : {}),
      ...(effectiveConvert && newPriceForDb != null && newPriceForDb > 0 ? {
        customPrice: newPriceForDb,
        currentPricePerDay: effectiveDays > 0 ? newPriceForDb / effectiveDays : null,
      } : {}),
      // После конвертации ТРИАЛА в платную подписку автопродление включается
      // принудительно — независимо от баланса. Само по себе это лишь булев флаг:
      // списание выполнит крон в свой срок, а нехватку средств обработают
      // ретраи/грейс. autoRenewTariffId обязателен — по нему крон знает, каким
      // тарифом продлевать; priceOptionId фиксирует длительность/цену продления.
      ...(isTrialConversion && tariff.id ? {
        autoRenewEnabled: true,
        autoRenewTariffId: tariff.id,
        autoRenewRetryCount: 0,
        ...(selectedOption?.id ? { autoRenewPriceOptionId: selectedOption.id } : {}),
      } : {}),
    },
  }).catch(() => {});

  // юзер выбрал «без устройств» — лимит уже выставлен выше (included + новые extras,
  // старые обнулены в счётчиках), остаётся кикнуть HWID-устройства сверх нового лимита.
  // НЕ зовём removeAllExtraDevicesForSub: он обнулил бы и только что докупленные extras.
  if (removeExtrasAfter) {
    try {
      const { kickExcessHwidDevices } = await import("../subscription/extras.helper.js");
      await kickExcessHwidDevices(sec.remnawaveUuid, hwidDeviceLimit);
    } catch (e) {
      console.error("[extendSecondarySubscription] removeExtrasAfter kick failed:", e);
    }
  }

  return effectiveConvert ? { ok: true, convertedDays } : { ok: true };
}

/**
 * Поиск подписки для КОНВЕРТАЦИИ (режим «одна подписка из категории»).
 *
 * Если тариф принадлежит категории с singleSubscriptionMode и у клиента уже есть
 * подписка с тарифом этой категории — возвращаем её: покупка должна конвертировать
 * эту подписку (pro-rata остатка + смена тарифа), а не плодить вторую.
 *
 * Кандидаты — ЛЮБЫЕ подписки клиента (включая index 0 — никакого спецкода для
 * «нулевой»), кроме подарочных/зарезервированных под подарок и не привязанных к Remna.
 * Если кандидатов несколько (легаси-дубли) — берём «самую живую» (max expireAt).
 */
export async function findConvertibleSubscription(
  clientId: string,
  tariffId: string,
): Promise<{ id: string; subscriptionIndex: number; tariffId: string | null; tariffName: string | null; expireAt: Date | null; currentPricePerDay: number | null; trialId: string | null; /** покупается ТОТ ЖЕ тариф → это продление (стек дней), а не конвертация */ sameTariff: boolean } | null> {
  const tariff = await prisma.tariff.findUnique({
    where: { id: tariffId },
    select: { categoryId: true, category: { select: { singleSubscriptionMode: true } } },
  });
  if (!tariff?.categoryId || !tariff.category?.singleSubscriptionMode) return null;

  const commonWhere = {
    ownerId: clientId,
    purchasedAsGift: false,
    giftStatus: null,
    remnawaveUuid: { not: null },
  } as const;
  const candidateSelect = {
    id: true,
    subscriptionIndex: true,
    tariffId: true,
    expireAt: true,
    currentPricePerDay: true,
    trialId: true,
    tariff: { select: { name: true } },
  } as const;

  // приоритет универсален для ЛЮБОЙ подписки (не только #0):
  // 1) подписка с ТЕМ ЖЕ тарифом (не триал) → продление именно её;
  // 2) иначе любая подписка с тарифом этой категории → конвертация «самой живой».
  // Без приоритета у клиента с несколькими подписками категории «самая живая»
  // перехватывала конвертацию, хотя рядом была подписка ровно с этим тарифом.
  const candidate =
    (await prisma.subscription.findFirst({
      where: { ...commonWhere, tariffId, trialId: null },
      orderBy: { expireAt: { sort: "desc", nulls: "last" } },
      select: candidateSelect,
    })) ??
    (await prisma.subscription.findFirst({
      where: { ...commonWhere, tariff: { categoryId: tariff.categoryId } },
      orderBy: { expireAt: { sort: "desc", nulls: "last" } },
      select: candidateSelect,
    }));
  if (!candidate) return null;
  return {
    id: candidate.id,
    subscriptionIndex: candidate.subscriptionIndex,
    tariffId: candidate.tariffId,
    tariffName: candidate.tariff?.name ?? null,
    expireAt: candidate.expireAt,
    currentPricePerDay: candidate.currentPricePerDay,
    trialId: candidate.trialId,
    // тот же тариф = продление (дни складываются, сквады/трафик
    // не сбрасываются), конвертация только при ДРУГОМ тарифе. Триал не считается
    // «тем же» — переход с пробного на платный всегда конвертация.
    sameTariff: candidate.tariffId === tariffId && candidate.trialId == null,
  };
}

/**
 * Активация тарифа по paymentId — находит клиента и тариф из Payment (или customBuild из metadata), вызывает activateTariffForClient.
 */
export async function activateTariffByPaymentId(paymentId: string): Promise<ActivationResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
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

  // УНИФИЦИРОВАННАЯ логика покупки тарифа.
  //
  // Раньше было 3 разные ветки:
  //   1. extendsSecondaryId → extendSecondarySubscription (продление конкретной подписки)
  //   2. isAdditional → createAdditionalSubscription (новая доп.)
  //   3. legacy primary → activateTariffForClient (продление Subscription[0]!) ← БАГ
  //
  // Теперь:
  //   1. extendsSecondaryId → продление этой подписки (явный intent клиента)
  //   2. ИНАЧЕ → ВСЕГДА createAdditionalSubscription (новая подписка).
  //      Для свежего клиента она получит subscriptionIndex=0 (= primary).
  //      Для клиента с подписками — subscriptionIndex=max+1.
  //
  // Эффект: «обычная покупка» больше никогда не продлевает чужую подписку. Хочешь
  // продлить — явный extendsSecondarySubId в metadata. Хочешь новую — просто покупай.
  const extendsSecondaryId = getExtendsSecondarySubId(payment.metadata);
  const isGiftPurchase = isGiftPurchasePayment(payment.metadata);

  if (payment.tariffId) {
    const tariff = await prisma.tariff.findUnique({ where: { id: payment.tariffId } });
    if (!tariff) {
      return { ok: false, error: "Тариф не найден", status: 404 };
    }

    const selectedOption = payment.tariffPriceOption && payment.tariffPriceOptionId
      ? { id: payment.tariffPriceOptionId, durationDays: payment.tariffPriceOption.durationDays, price: payment.tariffPriceOption.price }
      : undefined;

    const resetOneTimeDiscount = async (): Promise<void> => {
      await prisma.client.updateMany({
        where: { id: client.id, personalDiscountPercent: { gt: 0 } },
        data: { personalDiscountPercent: null },
      }).catch(() => { /* ignore */ });
    };

    // ── Ветка 1: явное продление конкретной подписки ──────────────────────
    if (extendsSecondaryId) {
      // конвертация триала: разрешение и список целевых тарифов
      // задаются в настройках триала (convertEnabled / convertAllTariffs / convertTariffIds).
      const targetSub = await prisma.subscription.findUnique({
        where: { id: extendsSecondaryId },
        select: { tariffId: true, trialId: true, trial: { select: { convertEnabled: true, convertAllTariffs: true, convertTariffIds: true } } },
      });
      if (targetSub?.trialId) {
        if (targetSub.trial?.convertEnabled === false) {
          return { ok: false, error: "Этот пробный период нельзя конвертировать или продлить", status: 400 };
        }
        const sameAsTrialTariff = targetSub.tariffId != null && targetSub.tariffId === tariff.id;
        if (!sameAsTrialTariff && targetSub.trial?.convertAllTariffs !== true) {
          let allowed: string[] = [];
          try {
            const parsed = targetSub.trial?.convertTariffIds ? JSON.parse(targetSub.trial.convertTariffIds) as unknown : [];
            if (Array.isArray(parsed)) allowed = parsed.map((x) => String(x));
          } catch { /* битый JSON → пустой список */ }
          if (!allowed.includes(tariff.id)) {
            return { ok: false, error: "Этот тариф недоступен для перехода с пробного периода", status: 400 };
          }
        }
      }
      // юзер выбрал «продлить без устройств» —
      // флаг прокидывается в metadata при создании платежа. Удаление произойдёт после
      // успешного extendSecondarySubscription.
      const removeExtrasAfter = shouldRemoveExtrasOnActivate(payment.metadata);
      // Продление на ДРУГОЙ тариф → конвертация (остаток дней пересчитывается
      // pro-rata по цене дня и суммируется с новыми). Тот же тариф → обычный стек дней.
      const convertOnExtend = targetSub?.tariffId != null && targetSub.tariffId !== tariff.id;
      const result = await extendSecondarySubscription(extendsSecondaryId, {
        id: tariff.id,
        durationDays: selectedOption?.durationDays ?? tariff.durationDays,
        trafficLimitBytes: tariff.trafficLimitBytes,
        deviceLimit: tariff.deviceLimit,
        includedDevices: tariff.includedDevices,
        pricePerExtraDevice: tariff.pricePerExtraDevice,
        maxExtraDevices: tariff.maxExtraDevices,
        deviceDiscountTiers: tariff.deviceDiscountTiers,
        internalSquadUuids: tariff.internalSquadUuids,
        trafficResetMode: tariff.trafficResetMode ?? undefined,
        price: selectedOption?.price ?? tariff.price,
      }, selectedOption, payment.deviceCount ?? undefined, removeExtrasAfter, convertOnExtend);
      if (result.ok) {
        await prisma.payment.update({ where: { id: payment.id }, data: { subscriptionId: extendsSecondaryId } }).catch(() => {});
        await resetOneTimeDiscount();
      }
      return result;
    }

    // ── Ветка 1.5: режим «одна подписка из категории» ──
    // Если тариф из single-категории и у клиента уже есть подписка с тарифом этой
    // категории — КОНВЕРТИРУЕМ её (pro-rata остатка + смена тарифа/сквадов) вместо
    // создания второй. Подарки исключение: подарок — всегда новая подписка.
    if (!isGiftPurchase) {
      const convertible = await findConvertibleSubscription(client.id, tariff.id);
      if (convertible) {
        // юзер выбирает судьбу доп. устройств при конвертации:
        // убрать (бо́льшая конвертация дней) или оставить (устройства переезжают).
        const removeExtrasOnConvert = shouldRemoveExtrasOnActivate(payment.metadata);
        const result = await extendSecondarySubscription(convertible.id, {
          id: tariff.id,
          durationDays: selectedOption?.durationDays ?? tariff.durationDays,
          trafficLimitBytes: tariff.trafficLimitBytes,
          deviceLimit: tariff.deviceLimit,
          includedDevices: tariff.includedDevices,
          pricePerExtraDevice: tariff.pricePerExtraDevice,
          maxExtraDevices: tariff.maxExtraDevices,
          deviceDiscountTiers: tariff.deviceDiscountTiers,
          internalSquadUuids: tariff.internalSquadUuids,
          trafficResetMode: tariff.trafficResetMode ?? undefined,
          price: selectedOption?.price ?? tariff.price,
        // тот же тариф → обычное продление (стек), другой → конвертация.
        }, selectedOption, payment.deviceCount ?? undefined, removeExtrasOnConvert, /* convertMode */ !convertible.sameTariff);
        if (result.ok) {
          // фиксируем конвертацию в платеже: и привязку подписки, и детали для отчётности.
          const meta = (() => {
            try { return payment.metadata ? JSON.parse(payment.metadata) as Record<string, unknown> : {}; } catch { return {}; }
          })();
          meta.convertedSubscriptionId = convertible.id;
          meta.convertedDays = result.convertedDays ?? 0;
          await prisma.payment.update({
            where: { id: payment.id },
            data: { subscriptionId: convertible.id, metadata: JSON.stringify(meta) },
          }).catch(() => {});
          await resetOneTimeDiscount();
          // уведомление админам: покупка конвертировала подписку (best-effort, не ломаем активацию).
          if (!convertible.sameTariff) {
            const convertedDaysNotify = result.convertedDays ?? null;
            import("../notification/telegram-notify.service.js")
              .then((m) => m.notifyAdminsAboutSubscriptionConverted(client.id, convertible.tariffName, tariff.name, convertedDaysNotify))
              .catch((e) => console.error("[activate] convert admin notify failed:", e));
          }
        }
        return result;
      }
    }

    // ── Ветка 2: новая подписка (любая покупка тарифа без extendsSecondaryId) ──
    // покупка при активном триале ЗАМЕНЯЕТ его (триал удаляется,
    // новая подписка занимает слот). Выбор триала — metadata.replaceTrialSubId.
    if (!isGiftPurchase) {
      await replaceTrialOnPurchase(client.id, getReplaceTrialSubId(payment.metadata));
    }
    const result = await createAdditionalSubscription(client.id, {
      id: tariff.id,
      name: tariff.name,
      price: selectedOption?.price ?? tariff.price,
      durationDays: selectedOption?.durationDays ?? tariff.durationDays,
      trafficLimitBytes: tariff.trafficLimitBytes,
      deviceLimit: tariff.deviceLimit,
      includedDevices: tariff.includedDevices,
      pricePerExtraDevice: tariff.pricePerExtraDevice,
      maxExtraDevices: tariff.maxExtraDevices,
      deviceDiscountTiers: tariff.deviceDiscountTiers,
      internalSquadUuids: tariff.internalSquadUuids,
      trafficResetMode: tariff.trafficResetMode ?? undefined,
    }, { extraDevices: payment.deviceCount ?? 0, purchasedAsGift: isGiftPurchase, skipConfigCheck: true });
    if (result.ok) {
      await prisma.payment.update({ where: { id: payment.id }, data: { subscriptionId: result.data.subscriptionId } }).catch(() => {});
      await resetOneTimeDiscount();
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error, status: result.status };
  }

  const customBuild = parseCustomBuildMetadata(payment.metadata);
  if (customBuild) {
    const result = await createAdditionalSubscription(client.id, customBuild, { purchasedAsGift: isGiftPurchase, skipConfigCheck: true });
    return result.ok ? { ok: true } : { ok: false, error: result.error, status: result.status };
  }

  return { ok: false, error: "Тариф не привязан к платежу", status: 400 };
}

/**
 * извлечь ID secondary-подписки на которую идёт продление,
 * если в metadata лежит `extendsSecondarySubId`. Возвращает null если нет.
 *
 * Если этот ID есть — payment должен **продлить существующую** secondary,
 * а не создавать новую (даже если isAdditionalSubscription тоже true).
 */
function getExtendsSecondarySubId(metadata: string | null): string | null {
  if (!metadata?.trim()) return null;
  try {
    const o = JSON.parse(metadata) as Record<string, unknown>;
    const id = o?.extendsSecondarySubId;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/** metadata.replaceTrialSubId — какой триал заменить покупкой (выбор юзера в UI). */
function getReplaceTrialSubId(metadata: string | null): string | null {
  if (!metadata?.trim()) return null;
  try {
    const o = JSON.parse(metadata) as Record<string, unknown>;
    const id = o?.replaceTrialSubId;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/**
 * замена триала покупкой. Покупка новой подписки при
 * активном триале ПОЛНОСТЬЮ заменяет его: триальная подписка удаляется (вместе
 * с Remna-юзером), а новая занимает освободившийся слот. Если триалов несколько —
 * UI передаёт replaceTrialSubId (выбор юзера); без выбора берём самый старый.
 * Возвращает id удалённой подписки или null (триалов нет).
 */
export async function replaceTrialOnPurchase(clientId: string, requestedTrialSubId: string | null): Promise<string | null> {
  const trials = await prisma.subscription.findMany({
    where: { ownerId: clientId, trialId: { not: null }, purchasedAsGift: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, remnawaveUuid: true },
  });
  if (trials.length === 0) return null;
  const target = (requestedTrialSubId && trials.find((t) => t.id === requestedTrialSubId)) || trials[0];
  if (target.remnawaveUuid) {
    const del = await remnaDeleteUser(target.remnawaveUuid);
    if (del.error) console.error("[trial-replace] remnaDeleteUser failed:", del.error);
  }
  await prisma.subscription.delete({ where: { id: target.id } }).catch((e) => {
    console.error("[trial-replace] subscription delete failed:", e);
  });
  // легаси-указатель клиента мог смотреть на удалённого Remna-юзера.
  await prisma.client.updateMany({
    where: { id: clientId, remnawaveUuid: target.remnawaveUuid ?? undefined },
    data: { remnawaveUuid: null },
  }).catch(() => {});
  return target.id;
}

/** metadata.purchasedAsGift=true → подписка для подарка. */
function isGiftPurchasePayment(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const o = JSON.parse(metadata) as Record<string, unknown>;
    return o?.purchasedAsGift === true;
  } catch {
    return false;
  }
}

/** metadata.removeExtrasOnActivate=true
 *  → после успешного extendSecondarySubscription удалить все доп. устройства подписки. */
function shouldRemoveExtrasOnActivate(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const o = JSON.parse(metadata) as Record<string, unknown>;
    return o?.removeExtrasOnActivate === true;
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
