import { prisma } from "../../db.js";

/**
 * Персональная скидка клиента: проценты (0–100), выставленные админом.
 * Применяется к продуктовым оплатам (тариф / прокси / sing-box / кастомный билд /
 * доп-опции) ВО ВСЕХ каналах (баланс, Platega, YooMoney, YooKassa, CryptoPay, Heleket)
 * и стэкается поверх промокода (сначала персональная скидка, затем промокод).
 *
 * Скидка НЕ применяется к пополнениям баланса (топапам) — иначе клиент смог бы
 * «майнить» баланс по льготной цене и обойти правила работы промокодов/рефералки.
 */

/** Получить персональный процент скидки клиента (или 0, если не задан). */
export async function getPersonalDiscountPercent(clientId: string): Promise<number> {
  if (!clientId) return 0;
  const row = await prisma.client.findUnique({
    where: { id: clientId },
    select: { personalDiscountPercent: true },
  });
  const pct = row?.personalDiscountPercent;
  if (typeof pct !== "number" || !isFinite(pct) || pct <= 0) return 0;
  return Math.min(100, pct);
}

/** Применить процентную скидку к цене с округлением до копеек. */
export function applyPercent(price: number, percent: number): number {
  if (!percent || percent <= 0) return price;
  const discounted = Math.max(0, price - (price * percent) / 100);
  return Math.round(discounted * 100) / 100;
}

/**
 * Удобная обёртка: применяет персональную скидку клиента к сумме и возвращает
 * итоговую сумму плюс процент, который был применён (0 если скидки нет).
 */
export async function applyPersonalDiscount(
  amount: number,
  clientId: string,
): Promise<{ amount: number; personalDiscountPercent: number }> {
  const pct = await getPersonalDiscountPercent(clientId);
  return { amount: applyPercent(amount, pct), personalDiscountPercent: pct };
}
