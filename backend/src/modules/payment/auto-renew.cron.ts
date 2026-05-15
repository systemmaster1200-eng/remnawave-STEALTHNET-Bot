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
} from "../notification/telegram-notify.service.js";

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

// Run every hour at minute 0
export function startAutoRenewScheduler() {
  cron.schedule("0 * * * *", async () => {
    console.log("[auto-renew] Cron triggered, checking for subscriptions to renew...");
    try {
      await processAutoRenewals();
    } catch (e) {
      console.error("[auto-renew] Error in cron job:", e);
    }
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
          let renewalFailed = false;
          try {
            await prisma.$transaction(async (tx) => {

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
              await tx.promoCodeUsage.create({
                data: { promoCodeId: autoRenewPromoCodeId, clientId: client.id },
              });
            }

            const activationRes = await activateTariffByPaymentId(payment.id);
            if (!activationRes.ok) {
              throw new Error(`Activation failed: ${activationRes.error}`);
            }

            // Distribute referral rewards asynchronously
            import("../referral/referral.service.js")
              .then((m) => m.distributeReferralRewards(payment.id))
              .catch((e) => console.error("[auto-renew] Referral reward error:", e));
            });
          } catch (err) {
            // Транзакция упала — откатываем атомарный debit, чтобы юзер не остался
            // без денег и без тарифа.
            renewalFailed = true;
            await prisma.client.update({
              where: { id: client.id },
              data: { balance: { increment: tariffPrice } },
            }).catch((e) => console.error("[auto-renew] Rollback debit failed:", e));
            console.error(`[auto-renew] Client ${client.id} renewal failed, debit rolled back:`, err);
          }
          if (renewalFailed) continue;

          await notifyAutoRenewSuccess(
            client.id,
            client.autoRenewTariff.name,
            tariffPrice,
            client.autoRenewTariff.currency,
          );
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
              const autopayResult = await createYookassaAutopayment({
                shopId: config.yookassaShopId.trim(),
                secretKey: config.yookassaSecretKey.trim(),
                amount: cardPortion,
                currency: client.autoRenewTariff!.currency.toUpperCase(),
                paymentMethodId: client.yookassaPaymentMethodId,
                description: `Автопродление ${serviceName}`,
                metadata: { auto_renew: "true", client_id: client.id },
                customerEmail: client.email,
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
      }
    }
  }
}
