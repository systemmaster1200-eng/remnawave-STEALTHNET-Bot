/**
 * кулдаун ПРОДЛЕНИЯ конкретной подписки.
 *
 * Если у тарифа задан `purchaseCooldownDays > 0` — конкретную подписку с этим тарифом
 * можно продлевать не чаще раз в N дней. Каждая подписка считается **независимо** —
 * у клиента может быть 2 одинаковых тарифа (#1 и #2), и у каждой свой кулдаун.
 *
 * Кулдаун НЕ применяется к покупке НОВОЙ подписки (даже если тариф тот же) — это
 * отдельная подписка с собственным счётом дней.
 *
 * Используется во всех точках создания платежа продления (extendsSecondarySubId) +
 * в GET-эндпоинте проверки для бота (показывает 🧱 на заблокированных и pre-check).
 */

import { prisma } from "../../db.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CooldownCheckResult =
  | { ok: true }
  | { ok: false; daysLeft: number; nextAvailableAt: Date; message: string; cooldownDays: number; tariffName: string };

/**
 * Проверить можно ли продлить конкретную подписку прямо сейчас.
 *
 * Логика: ищем последний `PAID` платёж за ЭТУ подписку (по `subscriptionId`) и сравниваем
 * с `tariff.purchaseCooldownDays`. Покупки других подписок (даже того же тарифа) не учитываются.
 *
 * @returns `{ ok: true }` если кулдаун не настроен или прошёл, иначе детали блокировки.
 */
export async function checkSubscriptionRenewalCooldown(
  subscriptionId: string,
): Promise<CooldownCheckResult> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      ownerId: true,
      tariff: { select: { name: true, purchaseCooldownDays: true } },
    },
  });
  if (!sub || !sub.tariff) return { ok: true };
  const cooldownDays = sub.tariff.purchaseCooldownDays;
  if (!cooldownDays || cooldownDays <= 0) return { ok: true };

  // Считаем ВСЕ PAID-платежи за эту подписку. Первый chronologically = создание подписки
  // (не продление, cooldown не применяется). Со второго и далее — это уже продления.
  // Это позволяет клиенту сразу после покупки... ничего не делать (cooldown не активен).
  // Но как только продлил один раз — cooldown N дней до следующего продления.
  const allPaid = await prisma.payment.findMany({
    where: {
      clientId: sub.ownerId,
      subscriptionId: sub.id,
      status: "PAID",
    },
    orderBy: { paidAt: "desc" },
    select: { paidAt: true },
    take: 2,
  });
  // Меньше 2 платежей → только создание → продлений ещё не было → cooldown не действует.
  if (allPaid.length < 2) return { ok: true };
  const lastRenewal = allPaid[0];
  if (!lastRenewal.paidAt) return { ok: true };

  const since = new Date(Date.now() - cooldownDays * DAY_MS);
  // Если последнее продление было раньше окна — cooldown прошёл.
  if (lastRenewal.paidAt < since) return { ok: true };

  const nextAvailableAt = new Date(lastRenewal.paidAt.getTime() + cooldownDays * DAY_MS);
  const msLeft = nextAvailableAt.getTime() - Date.now();
  const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS));
  const tariffName = sub.tariff.name;
  // многострочное сообщение с явной датой следующего продления
  // (МСК), как просил клиент в брифе.
  const message =
    `⏳ Операция недоступна – слишком рано.\n\n` +
    `Продление тарифа «${tariffName}» доступно не чаще одного раза в ${cooldownDays} ${plural(cooldownDays, "день", "дня", "дней")}.\n\n` +
    `🕒 Следующая доступная дата:\n` +
    `${fmtMsk(nextAvailableAt)}`;
  return { ok: false, daysLeft, nextAvailableAt, message, cooldownDays, tariffName };
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Дата+время в МСК (Europe/Moscow) формата DD.MM.YYYY HH:MM. */
function fmtMsk(d: Date): string {
  // Контейнеры запущены с TZ=Europe/Moscow — toLocaleString и Intl корректно отдают МСК.
  const parts = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Moscow",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
}
