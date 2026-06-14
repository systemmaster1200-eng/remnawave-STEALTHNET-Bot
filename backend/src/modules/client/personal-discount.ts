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

/** Применить процентную скидку к цене с округлением ВНИЗ до целых рублей.
 *  юзер видит цену в UI и платит ровно её. */
export function applyPercent(price: number, percent: number): number {
  if (!percent || percent <= 0) return price;
  const discounted = Math.max(0, price - (price * percent) / 100);
  return Math.floor(discounted);
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

/**
 * сжигает одноразовую персональную
 * скидку клиента ПОСЛЕ успешной продуктовой покупки (тариф / proxy / singbox /
 * extra-option). Топ-ап баланса НЕ должен вызывать эту функцию.
 *
 * Скидка остаётся, если она НЕ помечена one-time (т.е. выставлена админом
 * вручную — такая скидка действует бессрочно, пока админ не уберёт).
 *
 * Вызывать после payment.status = PAID и успешной активации.
 * Идемпотентно: повторный вызов для уже сгоревшей скидки — no-op.
 */
export async function extinguishOneTimeDiscount(clientId: string | null | undefined): Promise<void> {
  if (!clientId) return;
  try {
    const c = await prisma.client.findUnique({
      where: { id: clientId },
      select: { personalDiscountIsOneTime: true, personalDiscountPercent: true },
    });
    if (!c) return;
    if (!c.personalDiscountIsOneTime) return;
    if ((c.personalDiscountPercent ?? 0) <= 0) return;
    await prisma.client.update({
      where: { id: clientId },
      data: { personalDiscountPercent: 0, personalDiscountIsOneTime: false },
    });
  } catch (e) {
    console.error("[extinguishOneTimeDiscount] error:", e);
  }
}
