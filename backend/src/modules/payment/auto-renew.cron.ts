import cron from "node-cron";
import { prisma } from "../../db.js";
import { randomUUID } from "crypto";
import { activateTariffByPaymentId, applyExtraDevicesPrice, parseDeviceDiscountTiers } from "../tariff/tariff-activation.service.js";
import { remnaGetUser, isRemnaConfigured } from "../remna/remna.client.js";
import { getSystemConfig } from "../client/client.service.js";
import { createYookassaAutopayment } from "../yookassa/yookassa.service.js";
import { applyPercent } from "../client/personal-discount.js";

/**
 * Считает базовую сумму автопродления для клиента: priceOption.price + extras × pricePerExtra × scaling × discount.
 * Если у клиента сохранён autoRenewPriceOptionId — использует его, иначе берёт минимальную опцию тарифа.
 * Возвращает также priceOption и extras — для записи в Payment.
 */
async function computeAutoRenewBaseAmount(client: {
  id: string;
  autoRenewExtraDevices: number;
  autoRenewPriceOptionId: string | null;
  autoRenewTariff: { id: string; price: number; durationDays: number; pricePerExtraDevice: number; deviceDiscountTiers: unknown } | null;
}): Promise<{ amount: number; priceOptionId: string | null; durationDays: number; extras: number }> {
  if (!client.autoRenewTariff) return { amount: 0, priceOptionId: null, durationDays: 30, extras: 0 };
  const tariff = client.autoRenewTariff;
  let opt: { id: string; durationDays: number; price: number } | null = null;
  if (client.autoRenewPriceOptionId) {
    const savedOpt = await prisma.tariffPriceOption.findFirst({
      where: { id: client.autoRenewPriceOptionId, tariffId: tariff.id },
    });
    if (savedOpt) opt = { id: savedOpt.id, durationDays: savedOpt.durationDays, price: savedOpt.price };
  }
  if (!opt) {
    const fallback = await prisma.tariffPriceOption.findFirst({
      where: { tariffId: tariff.id },
      orderBy: { price: "asc" },
    });
    if (fallback) opt = { id: fallback.id, durationDays: fallback.durationDays, price: fallback.price };
  }
  const unitPrice = opt?.price ?? tariff.price;
  const durationDays = opt?.durationDays ?? tariff.durationDays;
  const extras = Math.max(0, client.autoRenewExtraDevices ?? 0);
  const tiers = parseDeviceDiscountTiers(tariff.deviceDiscountTiers);
  const { extrasTotal } = applyExtraDevicesPrice(tariff.pricePerExtraDevice ?? 0, extras, tiers, durationDays);
  return {
    amount: unitPrice + extrasTotal,
    priceOptionId: opt?.id ?? null,
    durationDays,
    extras,
  };
}
import {
  notifyAutoRenewSuccess,
  notifyAutoRenewFailed,
  notifyAutoRenewUpcoming,
  notifyAutoRenewRetry,
  notifyAutoRenewYookassaSuccess,
  notifyAutoRenewYookassaFailed,
  notifyAdminsAboutAutoRenewFailed,
} from "../notification/telegram-notify.service.js";
// кастомные уведомления из конструктора (/admin/auto-renew).
// Дёргаются параллельно со старыми хардкоженными — старые остаются как fallback.
import { dispatchAutoRenewNotification } from "../notification/auto-renew-notifications.service.js";

/**
 * Проверить промокод для автопродления и посчитать финальную цену.
 * Возвращает `{ finalPrice, promoCodeId }` или `{ finalPrice: basePrice, promoCodeId: null }`,
 * если промокод невалиден/истёк/исчерпан — в автопродлении такие случаи не блокируют
 * оплату, просто применяется полная цена.
 */
async function tryApplyPromoForAutoRenew(
  clientId: string,
  code: string | null,
  basePrice: number,
): Promise<{ finalPrice: number; promoCodeId: string | null }> {
  if (!code?.trim()) return { finalPrice: basePrice, promoCodeId: null };
  const promo = await prisma.promoCode.findUnique({ where: { code: code.trim() } });
  if (!promo || !promo.isActive || promo.type !== "DISCOUNT") {
    return { finalPrice: basePrice, promoCodeId: null };
  }
  if (promo.expiresAt && promo.expiresAt < new Date()) {
    return { finalPrice: basePrice, promoCodeId: null };
  }
  if (promo.maxUses > 0) {
    const totalUsages = await prisma.promoCodeUsage.count({ where: { promoCodeId: promo.id } });
    if (totalUsages >= promo.maxUses) return { finalPrice: basePrice, promoCodeId: null };
  }
  const clientUsages = await prisma.promoCodeUsage.count({
    where: { promoCodeId: promo.id, clientId },
  });
  if (clientUsages >= promo.maxUsesPerClient) return { finalPrice: basePrice, promoCodeId: null };

  let finalPrice = basePrice;
  if (promo.discountPercent && promo.discountPercent > 0) {
    finalPrice = Math.max(0, finalPrice - finalPrice * promo.discountPercent / 100);
  }
  if (promo.discountFixed && promo.discountFixed > 0) {
    finalPrice = Math.max(0, finalPrice - promo.discountFixed);
  }
  finalPrice = Math.round(finalPrice * 100) / 100;
  if (finalPrice <= 0) return { finalPrice: basePrice, promoCodeId: null };
  return { finalPrice, promoCodeId: promo.id };
}

// T-instant-notif (14.05.2026, wolf): крон бежит ЕЖЕМИНУТНО (был ежечасно).
// Это даёт точность UPCOMING-уведомлений до ±60 секунд вместо ±60 минут.
// Тело cron-а легко выдерживает минутный интервал — dedup-ключ last_notified_key
// предотвращает повторные отправки одного и того же уведомления.
export function startAutoRenewScheduler() {
  cron.schedule("* * * * *", async () => {
    console.log("[auto-renew] Cron triggered, checking for subscriptions to renew...");
    try {
      await processAutoRenewals();
    } catch (e) {
      console.error("[auto-renew] Error in cron job:", e);
    }
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Интервал между повторными попытками автосписания при нехватке средств.
// Без него вторичный cron (раз в минуту) долбит списание каждую минуту.
const AUTO_RENEW_RETRY_INTERVAL_MS = 60 * 60 * 1000; // 1 час

export async function processAutoRenewals() {
  if (!isRemnaConfigured()) {
    console.warn("[auto-renew] Remna is not configured. Skipping.");
    return;
  }

  // Load configurable settings
  const config = await getSystemConfig();
  const daysBeforeExpiry = config.autoRenewDaysBeforeExpiry ?? 1;
  const notifyDaysBefore = config.autoRenewNotifyDaysBefore ?? 3;
  const gracePeriodDays = config.autoRenewGracePeriodDays ?? 2;
  const maxRetries = config.autoRenewMaxRetries ?? 3;

  const renewThreshold = daysBeforeExpiry * DAY_MS;
  const notifyThreshold = notifyDaysBefore * DAY_MS;
  const gracePeriod = gracePeriodDays * DAY_MS;

  // Find clients with autoRenewEnabled and an associated tariff
  const clients = await prisma.client.findMany({
    where: {
      autoRenewEnabled: true,
      autoRenewTariffId: { not: null },
      remnawaveUuid: { not: null },
      isBlocked: false,
    },
    include: { autoRenewTariff: true },
  });

  const now = Date.now();

  for (const client of clients) {
    if (!client.remnawaveUuid || !client.autoRenewTariff) continue;

    // defensive дедуп — если у клиента primary-подписка
    // (Subscription[0]) уже имеет autoRenewEnabled=true → её обработает новый Subscription-цикл.
    // Пропускаем в legacy Client-цикле, чтобы не списать дважды.
    const primaryHasAutoRenew = await prisma.subscription.findUnique({
      where: { ownerId_subscriptionIndex: { ownerId: client.id, subscriptionIndex: 0 } },
      select: { autoRenewEnabled: true },
    });
    if (primaryHasAutoRenew?.autoRenewEnabled === true) {
      console.log(`[auto-renew] Skipping legacy Client-cycle for ${client.id}: Subscription[0].autoRenewEnabled handled by unified cycle.`);
      continue;
    }

    try {
      // Get current expireAt from Remna
      const remnaUser = await remnaGetUser(client.remnawaveUuid);
      if (remnaUser.error) {
        console.error(`[auto-renew] Failed to fetch remna user ${client.remnawaveUuid}:`, remnaUser.error);
        continue;
      }

      const userData = (remnaUser.data as Record<string, unknown>)?.response ?? (remnaUser.data as Record<string, unknown>);
      if (!userData || typeof userData !== "object") continue;
      const expireAtRaw = (userData as Record<string, unknown>).expireAt;
      if (!expireAtRaw) continue;

      const expireAtDate = new Date(expireAtRaw as string);
      if (Number.isNaN(expireAtDate.getTime())) continue;

      const timeLeft = expireAtDate.getTime() - now;

      // Считаем сумму к списанию по сохранённой опции + extras (с учётом коэффициента длительности).
      const renewBase = await computeAutoRenewBaseAmount(client);

      // === Phase 1: "Upcoming charge" notification ===
      // Notify when timeLeft <= notifyThreshold AND hasn't been notified in the last 24h
      if (timeLeft > 0 && timeLeft <= notifyThreshold) {
        const shouldNotify =
          !client.autoRenewNotifiedAt ||
          now - client.autoRenewNotifiedAt.getTime() > DAY_MS;

        // Учитываем персональную скидку, чтобы не слать «недостаточно средств», когда
        // после скидки сумма на самом деле списалась бы без проблем.
        const personalPctPhase1 = typeof client.personalDiscountPercent === "number" && client.personalDiscountPercent > 0
          ? Math.min(100, client.personalDiscountPercent)
          : 0;
        const upcomingPrice = applyPercent(renewBase.amount, personalPctPhase1);

        if (shouldNotify && client.balance < upcomingPrice) {
          await notifyAutoRenewUpcoming(
            client.id,
            client.autoRenewTariff.name,
            upcomingPrice,
            client.autoRenewTariff.currency,
            Math.max(0, Math.ceil(timeLeft / DAY_MS)),
          );
          await prisma.client.update({
            where: { id: client.id },
            data: { autoRenewNotifiedAt: new Date() },
          });
        }
      }

      // кастомные UPCOMING-шаблоны для root.
      // Дёргаем каждый проход cron'а — внутри функция фильтрует по offsetMinutes (±30 мин).
      // Это параллельно со старым notifyAutoRenewUpcoming (тот шлёт только если баланса не хватает,
      // а конструктор — независимо от баланса, по расписанию).
      if (timeLeft > 0) {
        await dispatchAutoRenewNotification(client.id, "UPCOMING", {
          tariffName: client.autoRenewTariff.name,
          amount: renewBase.amount,
          currency: client.autoRenewTariff.currency,
          minutesLeft: Math.round(timeLeft / 60000),
          expireAt: expireAtDate,
          subIndex: 0,
          balance: client.balance,
          dedupKeyForRoot: { clientId: client.id, ttlMs: 60 * 60 * 1000 },
        }).catch(() => {});
      }

      // === Phase 2: Renewal logic ===
      // Only attempt renewal when within threshold, and not expired too long ago (3 days max)
      if (timeLeft <= renewThreshold && timeLeft >= -(3 * DAY_MS)) {
        const baseTariffPrice = renewBase.amount;

        // Персональная скидка админа применяется ДО промокода.
        const personalPct = typeof client.personalDiscountPercent === "number" && client.personalDiscountPercent > 0
          ? Math.min(100, client.personalDiscountPercent)
          : 0;
        const priceAfterPersonal = applyPercent(baseTariffPrice, personalPct);

        // Применяем сохранённый для авто-продления промокод (если задан и валиден).
        // Невалидные/истёкшие промокоды в автопродлении игнорируем — оплачиваем полную цену.
        const { finalPrice: tariffPrice, promoCodeId: autoRenewPromoCodeId } =
          await tryApplyPromoForAutoRenew(client.id, client.autoRenewPromoCode, priceAfterPersonal);

        // Атомик debit-with-balance-check. Раньше было: read balance → check >= price
        // → потом transaction с decrement. Окно между check и decrement = пара секунд
        // (transaction делает много вещей внутри). Если за это время юзер сам списал
        // баланс через /payments/balance — auto-renew всё равно decrement'ил, баланс
        // уезжал в минус. Теперь — сначала атомарно списываем (UPDATE WHERE balance >= price),
        // если count=0 — пропускаем renewal, конкурент уже занял баланс.
        const debitGuard = await prisma.client.updateMany({
          where: { id: client.id, balance: { gte: tariffPrice } },
          data: {
            balance: { decrement: tariffPrice },
            autoRenewRetryCount: 0,
            autoRenewNotifiedAt: null,
          },
        });

        if (debitGuard.count > 0) {
          // Enough balance → RENEW (баланс уже списан атомарно выше).
          // Если payment.create или активация упадут — нужно откатить debit,
          // иначе бабки списали а тарифа не выдали.
          //
          // активация ВНЕ транзакции. activateTariffByPaymentId
          // читает платёж через глобальный prisma и не видела незакоммиченную запись
          // из tx → стабильно падала «Платёж не найден», debit откатывался, и
          // автопродление молча не работало при достаточном балансе.
          let renewalFailed = false;
          let createdPaymentId: string | null = null;
          let createdPromoUsageId: string | null = null;
          try {
            const metaObj: Record<string, unknown> = { autoRenew: true };
            if (autoRenewPromoCodeId) {
              metaObj.promoCodeId = autoRenewPromoCodeId;
              metaObj.originalPrice = baseTariffPrice;
            }
            if (personalPct > 0) {
              metaObj.personalDiscountPercent = personalPct;
              if (!metaObj.originalPrice) metaObj.originalPrice = baseTariffPrice;
            }
            const hasExtras = autoRenewPromoCodeId || personalPct > 0;
            // Транзакция — только быстрые INSERT'ы (payment + promo usage), без внешних вызовов.
            const { paymentId } = await prisma.$transaction(async (tx) => {
              const payment = await tx.payment.create({
                data: {
                  clientId: client.id,
                  orderId: randomUUID(),
                  amount: tariffPrice,
                  currency: client.autoRenewTariff!.currency.toUpperCase(),
                  status: "PAID",
                  provider: "balance",
                  tariffId: client.autoRenewTariff!.id,
                  tariffPriceOptionId: renewBase.priceOptionId,
                  deviceCount: renewBase.extras,
                  paidAt: new Date(),
                  metadata: hasExtras ? JSON.stringify(metaObj) : null,
                },
              });

              if (autoRenewPromoCodeId) {
                const usage = await tx.promoCodeUsage.create({
                  data: { promoCodeId: autoRenewPromoCodeId, clientId: client.id },
                });
                createdPromoUsageId = usage.id;
              }
              return { paymentId: payment.id };
            });
            createdPaymentId = paymentId;

            // Платёж закоммичен — теперь активация его видит.
            const activationRes = await activateTariffByPaymentId(paymentId);
            if (!activationRes.ok) {
              throw new Error(`Activation failed: ${activationRes.error}`);
            }

            // Distribute referral rewards asynchronously
            import("../referral/referral.service.js")
              .then((m) => m.distributeReferralRewards(paymentId))
              .catch((e) => console.error("[auto-renew] Referral reward error:", e));
          } catch (err) {
            // Продление упало — компенсируем: возвращаем баланс, гасим платёж и
            // снимаем promo usage, чтобы юзер не остался без денег и без тарифа.
            renewalFailed = true;
            await prisma.client.update({
              where: { id: client.id },
              data: { balance: { increment: tariffPrice } },
            }).catch((e) => console.error("[auto-renew] Rollback debit failed:", e));
            if (createdPaymentId) {
              await prisma.payment.updateMany({
                where: { id: createdPaymentId, status: "PAID" },
                data: { status: "FAILED" },
              }).catch((e) => console.error("[auto-renew] Rollback payment failed:", e));
            }
            if (createdPromoUsageId) {
              await prisma.promoCodeUsage.deleteMany({
                where: { id: createdPromoUsageId },
              }).catch((e) => console.error("[auto-renew] Rollback promo usage failed:", e));
            }
            console.error(`[auto-renew] Client ${client.id} renewal failed, debit rolled back:`, err);
            // уведомление админам в TG-группу: автосписание провалилось (best-effort).
            notifyAdminsAboutAutoRenewFailed(
              client.id,
              client.autoRenewTariff.name,
              err instanceof Error ? err.message : String(err),
            ).catch((e) => console.error("[auto-renew] admin notify failed:", e));
          }
          if (renewalFailed) continue;

          await notifyAutoRenewSuccess(
            client.id,
            client.autoRenewTariff.name,
            tariffPrice,
            client.autoRenewTariff.currency,
          );
          // T-autorenew: кастомные SUCCESS-шаблоны для root.
          await dispatchAutoRenewNotification(client.id, "SUCCESS", {
            tariffName: client.autoRenewTariff.name,
            amount: tariffPrice,
            currency: client.autoRenewTariff.currency,
            expireAt: expireAtDate,
            subIndex: 0,
            balance: Math.max(0, client.balance - tariffPrice),
          }).catch(() => {});
          console.log(`[auto-renew] Client ${client.id} successfully renewed${autoRenewPromoCodeId ? ` (promo applied, ${baseTariffPrice} → ${tariffPrice})` : ""}.`);
        } else {
          // Insufficient balance → try partial balance + YooKassa for the remainder, otherwise retry or disable
          let yookassaPaid = false;

          if (
            config.yookassaRecurringEnabled &&
            client.yookassaPaymentMethodId &&
            config.yookassaShopId?.trim() &&
            config.yookassaSecretKey?.trim()
          ) {
            // Если за последние 2 часа уже был успешный автоплатёж за этот тариф —
            // значит карта списалась ранее, но активация по каким-то причинам не завершилась
            // (например, Remna временно недоступна). В таком случае НЕ списываем повторно —
            // просто пробуем активировать тариф по существующему оплаченному платежу.
            const recentAutopay = await prisma.payment.findFirst({
              where: {
                clientId: client.id,
                provider: "yookassa",
                status: "PAID",
                tariffId: client.autoRenewTariffId,
                paidAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
              },
              orderBy: { paidAt: "desc" },
            });

            if (recentAutopay) {
              console.log(
                `[auto-renew] Client ${client.id}: found recent PAID YooKassa autopay ${recentAutopay.id}, retrying tariff activation only (no new charge).`,
              );
              const activationRes = await activateTariffByPaymentId(recentAutopay.id);
              if (activationRes.ok) {
                await prisma.client.update({
                  where: { id: client.id },
                  data: { autoRenewRetryCount: 0, autoRenewNotifiedAt: null },
                });
                await notifyAutoRenewYookassaSuccess(
                  client.id,
                  client.autoRenewTariff!.name,
                  recentAutopay.amount,
                  client.autoRenewTariff!.currency,
                  client.yookassaPaymentMethodTitle ?? undefined,
                  undefined,
                  recentAutopay.amount,
                );
                console.log(`[auto-renew] Client ${client.id} tariff activated from recent autopay ${recentAutopay.id}.`);
              } else {
                console.error(
                  `[auto-renew] Client ${client.id}: recent autopay ${recentAutopay.id} STILL failing activation: ${activationRes.error}`,
                );
              }
              // В любом случае не списываем повторно — деньги уже взяты.
              yookassaPaid = true;
            } else {
              // Calculate how much to charge from card vs balance
              const balancePortion = Math.min(client.balance, tariffPrice);
              const cardPortion = tariffPrice - balancePortion;

              // Attempt YooKassa autopayment for the shortfall only
              const orderId = randomUUID();
              const serviceName = config.serviceName?.trim() || "STEALTHNET";
              // добавили tg:<id> в description (см. /yookassa/create-payment).
              const tgIdSuffix = client.telegramId ? ` tg:${client.telegramId}` : "";
              const autopayResult = await createYookassaAutopayment({
                shopId: config.yookassaShopId.trim(),
                secretKey: config.yookassaSecretKey.trim(),
                amount: cardPortion,
                currency: client.autoRenewTariff!.currency.toUpperCase(),
                paymentMethodId: client.yookassaPaymentMethodId,
                description: `Автопродление ${serviceName}${tgIdSuffix}`,
                metadata: { auto_renew: "true", client_id: client.id },
                customerEmail: client.email,
                customerTelegramUsername: client.telegramUsername ?? null,
              });

              if (autopayResult.ok) {
                // Автоплатёж прошёл. Если есть balancePortion — атомарно
                // списываем (юзер мог за это время уже опустошить баланс через
                // /payments/balance, тогда decrement даст отрицательный остаток).
                // Если списать не удалось — забираем всё с карты, balancePortion=0.
                let actualBalancePortion = balancePortion;
                if (balancePortion > 0) {
                  const balDebit = await prisma.client.updateMany({
                    where: { id: client.id, balance: { gte: balancePortion } },
                    data: { balance: { decrement: balancePortion } },
                  });
                  if (balDebit.count === 0) {
                    // Конкурент опустошил баланс — yookassa списала всё что нужно,
                    // компенсировать не из чего. Логируем для расследования.
                    console.warn(`[auto-renew] Client ${client.id}: balance was drained between check and debit; treating as full-card payment.`);
                    actualBalancePortion = 0;
                  }
                }
                const payment = await prisma.$transaction(async (tx) => {

                  const ypMeta: Record<string, unknown> = { autoRenew: true };
                  if (autoRenewPromoCodeId) {
                    ypMeta.promoCodeId = autoRenewPromoCodeId;
                    ypMeta.originalPrice = baseTariffPrice;
                  }
                  if (personalPct > 0) {
                    ypMeta.personalDiscountPercent = personalPct;
                    if (!ypMeta.originalPrice) ypMeta.originalPrice = baseTariffPrice;
                  }
                  const ypHasExtras = autoRenewPromoCodeId || personalPct > 0;
                  const p = await tx.payment.create({
                    data: {
                      clientId: client.id,
                      orderId,
                      amount: tariffPrice,
                      currency: client.autoRenewTariff!.currency.toUpperCase(),
                      status: "PAID",
                      provider: "yookassa",
                      tariffId: client.autoRenewTariff!.id,
                      tariffPriceOptionId: renewBase.priceOptionId,
                      deviceCount: renewBase.extras,
                      paidAt: new Date(),
                      externalId: autopayResult.paymentId,
                      metadata: ypHasExtras ? JSON.stringify(ypMeta) : null,
                    },
                  });

                  if (autoRenewPromoCodeId) {
                    await tx.promoCodeUsage.create({
                      data: { promoCodeId: autoRenewPromoCodeId, clientId: client.id },
                    });
                  }

                  return p;
                });

                // Ретраим активацию тарифа — Remna может кратковременно лагать.
                let activationRes = await activateTariffByPaymentId(payment.id);
                for (let attempt = 1; attempt <= 2 && !activationRes.ok; attempt++) {
                  console.warn(
                    `[auto-renew] Client ${client.id}: tariff activation attempt ${attempt} failed for ${payment.id}: ${activationRes.error}. Retrying...`,
                  );
                  await new Promise((r) => setTimeout(r, 1500 * attempt));
                  activationRes = await activateTariffByPaymentId(payment.id);
                }

                if (activationRes.ok) {
                  await prisma.client.update({
                    where: { id: client.id },
                    data: {
                      autoRenewRetryCount: 0,
                      autoRenewNotifiedAt: null,
                    },
                  });

                  // Distribute referral rewards asynchronously
                  import("../referral/referral.service.js")
                    .then((m) => m.distributeReferralRewards(payment.id))
                    .catch((e) => console.error("[auto-renew] Referral reward error:", e));

                  await notifyAutoRenewYookassaSuccess(
                    client.id,
                    client.autoRenewTariff!.name,
                    tariffPrice,
                    client.autoRenewTariff!.currency,
                    client.yookassaPaymentMethodTitle ?? undefined,
                    balancePortion > 0 ? balancePortion : undefined,
                    cardPortion,
                  );
                  console.log(`[auto-renew] Client ${client.id} renewed via YooKassa (card: ${cardPortion}, balance: ${balancePortion}).`);
                } else {
                  // Карта списана, но активация всё ещё падает — на следующий час
                  // мы попадём в блок recentAutopay и попробуем только активацию.
                  console.error(
                    `[auto-renew] Client ${client.id}: YooKassa PAID (${payment.id}) but tariff activation failed after retries: ${activationRes.error}. Will retry activation on next cron run without re-charging.`,
                  );
                }
                // Деньги уже взяты — даже при неудачной активации НЕ запускаем retry/disable,
                // иначе через час снова будет списание и счётчик неудач.
                yookassaPaid = true;
              } else {
                // Автоплатёж не прошёл
                await notifyAutoRenewYookassaFailed(
                  client.id,
                  client.autoRenewTariff!.name,
                  autopayResult.error,
                );
                console.log(`[auto-renew] Client ${client.id} YooKassa autopayment failed: ${autopayResult.error}`);
              }
            }
          }

          if (!yookassaPaid) {
            // Fallback to retry/disable logic
            const currentRetryCount = client.autoRenewRetryCount ?? 0;

            if (currentRetryCount < maxRetries) {
              // Still have retries left — increment counter, notify retry
              const newRetryCount = currentRetryCount + 1;
              await prisma.client.update({
                where: { id: client.id },
                data: { autoRenewRetryCount: newRetryCount },
              });

              await notifyAutoRenewRetry(
                client.id,
                client.autoRenewTariff.name,
                tariffPrice,
                client.autoRenewTariff.currency,
                newRetryCount,
                maxRetries,
              );
              console.log(
                `[auto-renew] Client ${client.id} insufficient balance. Retry ${newRetryCount}/${maxRetries}.`,
              );
            } else {
              // All retries exhausted — check grace period
              const expiredSince = timeLeft < 0 ? Math.abs(timeLeft) : 0;

              if (expiredSince >= gracePeriod) {
                // Grace period over → disable auto-renewal
                await prisma.client.update({
                  where: { id: client.id },
                  data: {
                    autoRenewEnabled: false,
                    autoRenewRetryCount: 0,
                    autoRenewNotifiedAt: null,
                  },
                });
                await notifyAutoRenewFailed(
                  client.id,
                  client.autoRenewTariff.name,
                  "balance",
                );
                // T-autorenew: кастомное EXPIRED уведомление — все попытки исчерпаны, автопродление выключено.
                await dispatchAutoRenewNotification(client.id, "EXPIRED", {
                  tariffName: client.autoRenewTariff.name,
                  amount: renewBase.amount,
                  currency: client.autoRenewTariff.currency,
                  expireAt: expireAtDate,
                  subIndex: 0,
                  balance: client.balance,
                }).catch(() => {});
                console.log(
                  `[auto-renew] Client ${client.id} failed: all retries exhausted + grace period over. Auto-renew disabled.`,
                );
              } else {
                // Still within grace period — keep trying each hour
                console.log(
                  `[auto-renew] Client ${client.id} retries exhausted but grace period active. Will keep checking.`,
                );
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`[auto-renew] Error processing client ${client.id}:`, e);

      // On unexpected error → use retry logic instead of instant disable
      const currentRetryCount = client.autoRenewRetryCount ?? 0;
      if (currentRetryCount < maxRetries) {
        await prisma.client
          .update({
            where: { id: client.id },
            data: { autoRenewRetryCount: currentRetryCount + 1 },
          })
          .catch((err) => console.error("[auto-renew] Failed to update retry count:", err));
      } else {
        // Retries exhausted on errors too → disable
        await prisma.client
          .update({
            where: { id: client.id },
            data: {
              autoRenewEnabled: false,
              autoRenewRetryCount: 0,
              autoRenewNotifiedAt: null,
            },
          })
          .catch((err) => console.error("[auto-renew] Failed to disable auto-renew on error:", err));

        await notifyAutoRenewFailed(client.id, client.autoRenewTariff.name, "error").catch(() => {});
        // T-autorenew: кастомное FAILED уведомление — runtime ошибка обработки.
        await dispatchAutoRenewNotification(client.id, "FAILED", {
          tariffName: client.autoRenewTariff?.name ?? "—",
          amount: 0,
          currency: client.autoRenewTariff?.currency ?? "RUB",
          subIndex: 0,
          balance: client.balance,
        }).catch(() => {});
      }
    }
  }

  // обрабатываем индивидуальные автосписания secondary подписок.
  await processSecondaryAutoRenewals();
}

/**
 * автосписание для secondary подписок (per-sub).
 * Перебирает все secondary с auto_renew_enabled=true и за `daysBeforeExpiry` продлевает.
 *
 * Стратегия списания (mirror как у root):
 *   1. Сначала пытаемся полностью с баланса (атомарный debit).
 *   2. Если на балансе не хватает И включён YooKassa-recurring И есть saved card —
 *      списываем разницу с карты + остаток баланса (если есть). Сумма из карты = price - balance.
 *   3. Если ни баланс, ни YooKassa не сработали — пропускаем + лог.
 *
 * Защита:
 *   • Дедуп: если за последние 2 часа уже был PAID YooKassa autopay для этой sec — НЕ списываем повторно.
 *   • Activation fail после YK списания → баланс возвращаем, YooKassa деньги не возвращаем
 *     (но Payment остаётся PAID — на следующем cron tick попробуем активировать заново).
 *   • Notifications клиенту при успехе/ошибке (notifyAutoRenewYookassaSuccess/Failed).
 */
async function processSecondaryAutoRenewals(): Promise<void> {
  const config = await getSystemConfig();
  const daysBeforeExpiry = config.autoRenewDaysBeforeExpiry ?? 1;
  const renewThreshold = daysBeforeExpiry * DAY_MS;
  const maxRetries = config.autoRenewMaxRetries ?? 3;
  const now = Date.now();

  // цикл обрабатывает ВСЕ подписки с autoRenewEnabled,
  // включая primary (subscriptionIndex=0). Раньше был фильтр `subscriptionIndex > 0` чтобы избежать
  // дублирования с legacy циклом по `Client.autoRenewEnabled`. Но эндпоинт включения автопродления
  // (`/api/client/subscription/:type/:id/auto-renew`) теперь пишет ТОЛЬКО в Subscription, не в
  // Client → старый цикл по Client всё равно не сработает для primary, а новый его пропускал.
  // Зазор закрыт: один цикл = все подписки.
  //
  // Дедупликация: если у клиента случайно есть И `Client.autoRenewEnabled=true` И
  // `Subscription[0].autoRenewEnabled=true` (legacy backfill), defensive-фильтр в Client-цикле
  // ниже пропустит primary через `existsPrimaryWithAutoRenew` чтобы не списать дважды.
  const secondaries = await prisma.subscription.findMany({
    where: {
      autoRenewEnabled: true,
      remnawaveUuid: { not: null },
      tariffId: { not: null },
      // Триалы НИКОГДА не автопродлеваются: пробный период бесплатный и должен
      // конвертироваться только явным действием клиента (покупка тарифа), а не
      // списанием. Без этого фильтра триал на базе тарифа (trialId + tariffId +
      // autoRenewEnabled от defaultAutoRenewEnabled) попадал в цикл и крон пытался
      // списать полную цену тарифа за пробник.
      trialId: null,
    },
    include: {
      tariff: true,
      owner: {
        select: {
          id: true,
          balance: true,
          isBlocked: true,
          telegramId: true,
          telegramUsername: true,
          email: true,
          yookassaPaymentMethodId: true,
          yookassaPaymentMethodTitle: true,
          // personal discount применяется к auto-renew.
          personalDiscountPercent: true,
        },
      },
    },
  });

  for (const sec of secondaries) {
    if (!sec.remnawaveUuid || !sec.tariff || !sec.owner || sec.owner.isBlocked) continue;
    try {
      // 1. Проверяем срок подписки в Remna
      const remnaUser = await remnaGetUser(sec.remnawaveUuid);
      if (remnaUser.error) {
        console.warn(`[auto-renew/sec] Failed to fetch remna user ${sec.remnawaveUuid}:`, remnaUser.error);
        continue;
      }
      const userData = (remnaUser.data as Record<string, unknown>)?.response ?? remnaUser.data;
      const expireAtRaw = (userData as Record<string, unknown> | null)?.expireAt;
      if (!expireAtRaw) continue;
      const expireAtDate = new Date(expireAtRaw as string);
      if (Number.isNaN(expireAtDate.getTime())) continue;
      const timeLeft = expireAtDate.getTime() - now;

      // T-autorenew: для UPCOMING шаблонов — отправляем напоминания заранее, до момента списания.
      // Окно дёргаем при каждом проходе cron; dispatchAutoRenewNotification внутри сам сравнит
      // minutesLeft с offsetMinutes шаблонов (±30 мин) и отправит только подходящие.
      // расчёт цены автопродления с учётом
      // доп. устройств (extraDevicesMonthlyPrice × коэф длительности) и личной скидки.
      // Старый customPrice (legacy) используется только если extraDevices=0.
      const renewDurationDays = sec.tariff.durationDays || 30;
      const extrasMonthly = sec.extraDevicesMonthlyPrice ?? 0;
      const extrasForPeriod = extrasMonthly > 0
        ? Math.floor(extrasMonthly * (renewDurationDays / 30))
        : 0;
      const baseRenewPrice = extrasForPeriod > 0
        ? sec.tariff.price  // если есть новые extras — берём базовую цену тарифа, к ней добавим extras
        : (sec.customPrice && sec.customPrice > 0 ? sec.customPrice : sec.tariff.price);
      let priceBeforeDiscount = baseRenewPrice + extrasForPeriod;
      const pd = sec.owner.personalDiscountPercent ?? 0;
      const price = pd > 0
        ? Math.max(0, Math.floor(priceBeforeDiscount * (1 - pd / 100)))
        : priceBeforeDiscount;

      if (timeLeft > 0) {
        const minutesLeft = Math.round(timeLeft / 60000);
        await dispatchAutoRenewNotification(sec.owner.id, "UPCOMING", {
          tariffName: sec.tariff.name,
          amount: price,
          currency: sec.tariff.currency,
          minutesLeft,
          expireAt: expireAtDate,
          subIndex: sec.subscriptionIndex,
          subscriptionId: sec.id,
          balance: sec.owner.balance ?? 0,
          dedupKeyForSec: { secondarySubscriptionId: sec.id, ttlMs: 60 * 60 * 1000 },
        }).catch(() => {});
      }

      // Списываем только в окне [0..renewThreshold] (или до 7 дней просрочки).
      if (timeLeft > renewThreshold || timeLeft < -7 * DAY_MS) continue;

      if (price <= 0) continue;

      // 3. Дедуп: проверяем не было ли успешного YK autopay для этой sec за последние 2 часа.
      // Если был → значит карта уже списала, но activation мог не пройти.
      // Просто пробуем активировать снова через тот payment (не списываем повторно).
      const recentYkPayment = await prisma.payment.findFirst({
        where: {
          clientId: sec.owner.id,
          provider: "yookassa",
          status: "PAID",
          tariffId: sec.tariffId,
          paidAt: { gte: new Date(now - 2 * 60 * 60 * 1000) },
          metadata: { contains: sec.id },
        },
        orderBy: { paidAt: "desc" },
      });
      if (recentYkPayment) {
        console.log(`[auto-renew/sec] Found recent YK autopay ${recentYkPayment.id} for sec ${sec.id}, retrying activation only.`);
        const { extendSecondarySubscription } = await import("../tariff/tariff-activation.service.js");
        const retryResult = await extendSecondarySubscription(
          sec.id,
          {
            id: sec.tariff.id,
            durationDays: sec.tariff.durationDays,
            trafficLimitBytes: sec.tariff.trafficLimitBytes,
            deviceLimit: sec.tariff.deviceLimit,
            includedDevices: sec.tariff.includedDevices ?? undefined,
            pricePerExtraDevice: sec.tariff.pricePerExtraDevice ?? 0,
            maxExtraDevices: sec.tariff.maxExtraDevices ?? 0,
            internalSquadUuids: sec.tariff.internalSquadUuids,
            trafficResetMode: sec.tariff.trafficResetMode ?? undefined,
            price,
          },
          undefined,
          0,
        );
        if (retryResult.ok) {
          console.log(`[auto-renew/sec] sec ${sec.id} re-activated from recent YK payment ${recentYkPayment.id}.`);
        } else {
          console.error(`[auto-renew/sec] sec ${sec.id} retry activation STILL failing: ${retryResult.error}`);
        }
        continue;
      }

      // 4. Списание: balance-first, fallback YooKassa.
      const balanceForUser = sec.owner.balance ?? 0;
      let paidViaBalance = 0;
      let paidViaYookassa = 0;
      let yookassaPaymentId: string | null = null;
      let success = false;

      // Phase A: полное списание с баланса (атомарный debit).
      const balanceDebit = await prisma.client.updateMany({
        where: { id: sec.owner.id, balance: { gte: price } },
        data: { balance: { decrement: price } },
      });

      if (balanceDebit.count > 0) {
        paidViaBalance = price;
        success = true;
      } else {
        // Phase B: баланса не хватает. Проверяем YooKassa-recurring.
        const ykEnabled =
          config.yookassaRecurringEnabled === true &&
          !!sec.owner.yookassaPaymentMethodId &&
          !!config.yookassaShopId?.trim() &&
          !!config.yookassaSecretKey?.trim();

        if (!ykEnabled) {
          // Нет средств и карта отключена.
          //   • Попытка списания идёт КАЖДУЮ минуту (debit выше атомарный — при нуле
          //     баланса ничего не спишет; как только баланс пополнят, в ту же минуту
          //     спишется и подписка продлится). Автопродление НЕ выключаем.
          //   • Уведомляем клиента максимум maxRetries раз (с интервалом
          //     AUTO_RENEW_RETRY_INTERVAL_MS между уведомлениями). После лимита —
          //     перестаём слать уведомления, но списывать продолжаем.
          const prevRetries = sec.autoRenewRetryCount ?? 0;
          if (prevRetries < maxRetries) {
            const lastNotifyMs = sec.autoRenewNotifiedAt?.getTime() ?? 0;
            if (now - lastNotifyMs >= AUTO_RENEW_RETRY_INTERVAL_MS) {
              await prisma.subscription.update({
                where: { id: sec.id },
                data: { autoRenewRetryCount: prevRetries + 1, autoRenewNotifiedAt: new Date() },
              }).catch(() => {});
              console.log(`[auto-renew/sec] Insufficient balance for sec ${sec.id} (need ${price}, have ${balanceForUser}); notify ${prevRetries + 1}/${maxRetries}.`);
              await dispatchAutoRenewNotification(sec.owner.id, "FAILED", {
                tariffName: sec.tariff.name,
                amount: price,
                currency: sec.tariff.currency,
                expireAt: expireAtDate,
                subIndex: sec.subscriptionIndex,
                subscriptionId: sec.id,
                balance: balanceForUser,
              }).catch(() => {});
            }
          }
          // Лимит уведомлений исчерпан или ещё не прошёл интервал — молча продолжаем:
          // попытка списания уже была сделана выше и повторится на следующем тике.
          continue;
        }

        // Дебитуем доступный баланс (если что-то есть), остаток добираем картой.
        const balancePortion = Math.min(Math.max(0, balanceForUser), price);
        const cardPortion = price - balancePortion;

        if (balancePortion > 0) {
          const partialDebit = await prisma.client.updateMany({
            where: { id: sec.owner.id, balance: { gte: balancePortion } },
            data: { balance: { decrement: balancePortion } },
          });
          if (partialDebit.count > 0) {
            paidViaBalance = balancePortion;
          }
        }

        // YooKassa autopay для cardPortion.
        try {
          const orderIdForYk = randomUUID();
          // добавили tg:<id> в description (см. /yookassa/create-payment).
          const tgIdSuffix = sec.owner.telegramId ? ` tg:${sec.owner.telegramId}` : "";
          const autopayResult = await createYookassaAutopayment({
            shopId: config.yookassaShopId!.trim(),
            secretKey: config.yookassaSecretKey!.trim(),
            amount: cardPortion,
            currency: sec.tariff.currency.toUpperCase(),
            paymentMethodId: sec.owner.yookassaPaymentMethodId!,
            description: `Автопродление #${sec.subscriptionIndex} (${sec.tariff.name})${tgIdSuffix}`,
            metadata: {
              orderId: orderIdForYk,
              extendsSecondarySubId: sec.id,
              autoRenew: "true",
              clientId: sec.owner.id,
            },
            customerEmail: sec.owner.email,
            customerTelegramUsername: sec.owner.telegramUsername ?? null,
          });

          if (autopayResult.ok) {
            paidViaYookassa = cardPortion;
            yookassaPaymentId = autopayResult.paymentId;
            success = true;
          } else {
            // YK отказала — возвращаем частично списанный баланс.
            if (paidViaBalance > 0) {
              await prisma.client.update({
                where: { id: sec.owner.id },
                data: { balance: { increment: paidViaBalance } },
              }).catch(() => {});
              paidViaBalance = 0;
            }
            console.error(`[auto-renew/sec] YK autopay failed for sec ${sec.id}: ${autopayResult.error}`);
            await notifyAutoRenewYookassaFailed(sec.owner.id, sec.tariff.name, autopayResult.error).catch(() => {});
            await dispatchAutoRenewNotification(sec.owner.id, "FAILED", {
              tariffName: sec.tariff.name,
              amount: price,
              currency: sec.tariff.currency,
              expireAt: expireAtDate,
              subIndex: sec.subscriptionIndex,
              subscriptionId: sec.id,
              balance: sec.owner.balance ?? 0,
            }).catch(() => {});
            continue;
          }
        } catch (e) {
          // Сетевая / runtime ошибка YooKassa — возвращаем баланс.
          if (paidViaBalance > 0) {
            await prisma.client.update({
              where: { id: sec.owner.id },
              data: { balance: { increment: paidViaBalance } },
            }).catch(() => {});
            paidViaBalance = 0;
          }
          const errMsg = e instanceof Error ? e.message : "unknown error";
          console.error(`[auto-renew/sec] YK autopay exception for sec ${sec.id}:`, errMsg);
          await notifyAutoRenewYookassaFailed(sec.owner.id, sec.tariff.name, errMsg).catch(() => {});
          continue;
        }
      }

      if (!success) continue;

      // 5. Деньги списаны. Записываем Payment ПЕРЕД активацией (для дедупа на следующем тике
      // если activation fail — payment останется, recentYkPayment его найдёт).
      const payment = await prisma.payment.create({
        data: {
          clientId: sec.owner.id,
          orderId: randomUUID(),
          tariffId: sec.tariff.id,
          amount: price,
          currency: sec.tariff.currency.toUpperCase(),
          status: "PAID",
          provider: paidViaYookassa > 0 ? "yookassa" : "balance",
          paidAt: new Date(),
          metadata: JSON.stringify({
            extendsSecondarySubId: sec.id,
            autoRenew: true,
            balancePortion: paidViaBalance,
            cardPortion: paidViaYookassa,
            yookassaPaymentId,
          }),
        },
      }).catch((err) => {
        console.error(`[auto-renew/sec] Failed to create Payment record for sec ${sec.id}:`, err);
        return null;
      });

      // 6. Активация подписки.
      const { extendSecondarySubscription } = await import("../tariff/tariff-activation.service.js");
      const result = await extendSecondarySubscription(
        sec.id,
        {
          id: sec.tariff.id,
          durationDays: sec.tariff.durationDays,
          trafficLimitBytes: sec.tariff.trafficLimitBytes,
          deviceLimit: sec.tariff.deviceLimit,
          includedDevices: sec.tariff.includedDevices ?? undefined,
          pricePerExtraDevice: sec.tariff.pricePerExtraDevice ?? 0,
          maxExtraDevices: sec.tariff.maxExtraDevices ?? 0,
          internalSquadUuids: sec.tariff.internalSquadUuids,
          trafficResetMode: sec.tariff.trafficResetMode ?? undefined,
          price,
        },
        undefined,
        0,
      );

      if (!result.ok) {
        // Activation fail.
        // Баланс возвращаем (если списали).
        if (paidViaBalance > 0) {
          await prisma.client.update({
            where: { id: sec.owner.id },
            data: { balance: { increment: paidViaBalance } },
          }).catch(() => {});
        }
        // YK-деньги — НЕ возвращаем, оставляем Payment PAID, на след. cron tick
        // recentYkPayment его найдёт и попробует только активацию (без списания).
        if (payment && paidViaYookassa > 0) {
          console.error(`[auto-renew/sec] sec ${sec.id} extend FAILED, YK paid ${paidViaYookassa} kept — will retry activation on next cron.`);
        } else if (payment) {
          // Чистый balance-payment без YK — можем смело пометить FAILED.
          await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } }).catch(() => {});
        }
        console.error(`[auto-renew/sec] Failed to extend sec ${sec.id}: ${result.error}`);
        continue;
      }

      // Успешное продление → сбрасываем счётчик ретраев и метку backoff.
      await prisma.subscription.update({
        where: { id: sec.id },
        data: { autoRenewRetryCount: 0, autoRenewNotifiedAt: null },
      }).catch(() => {});

      // 7. Success → notif клиенту.
      if (paidViaYookassa > 0) {
        await notifyAutoRenewYookassaSuccess(
          sec.owner.id,
          sec.tariff.name,
          price,
          sec.tariff.currency,
          sec.owner.yookassaPaymentMethodTitle ?? undefined,
          paidViaBalance,
          paidViaYookassa,
        ).catch(() => {});
      }
      // T-autorenew: кастомные SUCCESS уведомления.
      await dispatchAutoRenewNotification(sec.owner.id, "SUCCESS", {
        tariffName: sec.tariff.name,
        amount: price,
        currency: sec.tariff.currency,
        expireAt: expireAtDate,
        subIndex: sec.subscriptionIndex,
        subscriptionId: sec.id,
        balance: Math.max(0, (sec.owner.balance ?? 0) - paidViaBalance),
      }).catch(() => {});

      console.log(`[auto-renew/sec] Renewed sec ${sec.id} for client ${sec.owner.id} — balance:${paidViaBalance}, yk:${paidViaYookassa}, total:${price}`);
    } catch (e) {
      console.error(`[auto-renew/sec] Unexpected error processing sec ${sec.id}:`, e);
    }
  }
}
