/**
 * расчёт цены доп. устройств при ПЕРВИЧНОЙ
 * покупке тарифа (не при продлении). Раньше бэк игнорировал tariff.pricePerExtraDevice
 * для новых платежей — юзер видел сумму с устройствами, а списывали только базовую.
 *
 * Формула совпадает с фронтовой `applyExtrasPrice` (client-tariffs.tsx):
 *   extrasTotal = pricePerExtraDevice × extras × (100 - tierDiscount%) / 100 × (durationDays / 30)
 *
 * Тарифные `deviceDiscountTiers` — JSON `[{ minExtraDevices, discountPercent }]`,
 * берётся наивысший подходящий tier (самый щедрый по сумме скидок применяется
 * через сортировку по minExtraDevices убыванию + `find`).
 */

export interface DeviceDiscountTier {
  minExtraDevices: number;
  discountPercent: number;
}

const EXTRA_DEVICE_BASE_DAYS = 30;

/** Парсит deviceDiscountTiers из БД (может быть JSON-строкой или сразу массивом). */
export function parseDeviceDiscountTiers(raw: unknown): DeviceDiscountTier[] {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((t): t is { minExtraDevices: number; discountPercent: number } =>
      t !== null && typeof t === "object"
      && typeof (t as { minExtraDevices?: unknown }).minExtraDevices === "number"
      && typeof (t as { discountPercent?: unknown }).discountPercent === "number"
    )
    .map((t) => ({ minExtraDevices: t.minExtraDevices, discountPercent: t.discountPercent }));
}

/**
 * Считает суммарную цену доп. устройств для покупки тарифа.
 *
 * @param pricePerExtraDevice — `tariff.pricePerExtraDevice` (цена за устройство в месяц).
 * @param extras — количество доп. устройств (`deviceCount` из запроса).
 * @param tiers — `tariff.deviceDiscountTiers` (JSON или массив).
 * @param durationDays — длительность подписки (для пропорционального масштабирования).
 * @returns `{ extrasTotal, pct }` — общая сумма и применённая скидка (для логов/UI).
 */
export function calcExtrasPrice(
  pricePerExtraDevice: number,
  extras: number,
  tiers: DeviceDiscountTier[] | unknown,
  durationDays = EXTRA_DEVICE_BASE_DAYS,
): { extrasTotal: number; pct: number } {
  const safe = Math.max(0, Math.floor(extras));
  if (safe === 0 || pricePerExtraDevice <= 0) return { extrasTotal: 0, pct: 0 };
  const parsedTiers = Array.isArray(tiers) ? tiers as DeviceDiscountTier[] : parseDeviceDiscountTiers(tiers);
  const sorted = [...parsedTiers].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const tier = sorted.find((t) => safe >= t.minExtraDevices);
  const pct = tier?.discountPercent ?? 0;
  const safeDays = Math.max(1, durationDays);
  const monthly = pricePerExtraDevice * safe * (100 - pct) / 100;
  return {
    extrasTotal: Math.round(monthly * (safeDays / EXTRA_DEVICE_BASE_DAYS) * 100) / 100,
    pct,
  };
}

/** Возвращает monthly-цену доп. устройств (без масштабирования по дням) — для записи в Subscription.extraDevicesMonthlyPrice. */
export function calcExtrasMonthlyPrice(
  pricePerExtraDevice: number,
  extras: number,
  tiers: DeviceDiscountTier[] | unknown,
): number {
  const safe = Math.max(0, Math.floor(extras));
  if (safe === 0 || pricePerExtraDevice <= 0) return 0;
  const parsedTiers = Array.isArray(tiers) ? tiers as DeviceDiscountTier[] : parseDeviceDiscountTiers(tiers);
  const sorted = [...parsedTiers].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const tier = sorted.find((t) => safe >= t.minExtraDevices);
  const pct = tier?.discountPercent ?? 0;
  return Math.round(pricePerExtraDevice * safe * (100 - pct) / 100 * 100) / 100;
}
