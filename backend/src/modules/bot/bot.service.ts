/**
 * Сервис ботов-клонов.
 *
 * Концепция (см. также docs/clone-bots или README):
 *   - Все клоны = «1:1 копия» основного бота, отличаются только токеном
 *     и наценкой (markupPercent).
 *   - База клиентов изолирована: один TG-юзер в каждом клоне = разный Client.
 *   - Платежи падают на общие реквизиты платформы, выручка от наценки копится
 *     как долг перед владельцем клона (см. модель BotPayout).
 *   - Реферальные начисления считаются от Payment.baseAmount (без наценки).
 *
 * Этот файл — единая точка для:
 *   - resolveBotByToken: middleware-помощник для авторизации запросов от бота.
 *   - getPrimaryBot:     получение «основного» клона (для legacy-кода и broadcast-default).
 *   - applyMarkup:       единый расчёт цены с наценкой клона (используется в getPublicConfig
 *                        и при создании Payment).
 *   - getBotEarnings:    отчёт «заработано / выплачено / к выплате» по клону.
 */

import type { Bot } from "@prisma/client";
import { prisma } from "../../db.js";

/** Найти бота по токену (и только активного). Возвращает null если нет. */
export async function getBotByToken(token: string): Promise<Bot | null> {
  const trimmed = token?.trim();
  if (!trimmed) return null;
  return prisma.bot.findFirst({ where: { token: trimmed, isActive: true } });
}

/** Найти бота по id. */
export async function getBotById(id: string): Promise<Bot | null> {
  if (!id) return null;
  return prisma.bot.findUnique({ where: { id } });
}

/**
 * Primary бот — fallback для legacy-операций без явного botId
 * (например, серверные шедулеры, не привязанные к конкретному клону).
 */
export async function getPrimaryBot(): Promise<Bot | null> {
  return prisma.bot.findFirst({ where: { isPrimary: true } });
}

/**
 * Список активных ботов — используется bot-процессом для поднятия инстансов.
 */
export async function listActiveBots(): Promise<Bot[]> {
  return prisma.bot.findMany({
    where: { isActive: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Применяет наценку клона к базовой цене.
 *
 * Формула: final = round(base × (1 + markup/100), 2)
 *
 * Округление до копеек/центов (2 знака) — чтобы не получить 99.99999 в Payment.amount
 * и не сломать сравнение «достаточно ли на балансе».
 *
 * Используется:
 *   - в getPublicConfig/getPublicTariffs — отображение цены клиенту
 *   - в payment-сервисах при создании Payment (snapshot в Payment.amount)
 *
 * НЕ применяется к: пополнению баланса, призам конкурсов, реферальным начислениям.
 */
export function applyMarkup(basePrice: number, markupPercent: number | null | undefined): number {
  const pct = markupPercent ?? 0;
  if (pct <= 0) return Math.round(basePrice * 100) / 100;
  return Math.round(basePrice * (1 + pct / 100) * 100) / 100;
}

/**
 * Контекст бота клиента — то, что нужно для расчёта наценки в платеже.
 *
 * Используется на каждом Payment.create: сначала вызываем эту функцию по clientId,
 * потом передаём результат в buildPaymentMarkupSnapshot.
 */
export async function getClientBotPaymentContext(clientId: string): Promise<{
  botId: string;
  markupPercent: number;
} | null> {
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    select: { botId: true, bot: { select: { markupPercent: true } } },
  });
  if (!c?.bot) return null;
  return { botId: c.botId, markupPercent: c.bot.markupPercent };
}

/**
 * Готовит snapshot полей Payment для создания записи о платеже.
 * Принимает «цену БЕЗ наценки клона» (то есть итоговую цену с учётом скидок,
 * но БЕЗ markup) и контекст бота — возвращает все поля для createPayment (db.ts).
 *
 * Семантика: Payment.amount = price × (1 + markup/100).
 * Это «percentage-correct» интерпретация — для % скидок коммутативно с markup,
 * для fixed-скидок есть микроразница (см. бизнес-вопрос «before/after» в плане).
 *
 * Пример:
 *   const ctx = await getClientBotPaymentContext(clientId);
 *   if (!ctx) return res.status(503).json({ message: "Bot context missing" });
 *   const snap = buildPaymentMarkupSnapshot(finalPriceBeforeMarkup, ctx);
 *   await createPayment({ data: {
 *     clientId, orderId, currency, status, provider, ...
 *     ...snap,  // amount, baseAmount, botMarkupPercent, botMarkupAmount, botId
 *   }});
 */
export function buildPaymentMarkupSnapshot(
  amountBeforeMarkup: number,
  ctx: { botId: string; markupPercent: number },
): { amount: number; baseAmount: number; botMarkupPercent: number; botMarkupAmount: number; botId: string } {
  const baseAmount = Math.round(amountBeforeMarkup * 100) / 100;
  const amount = applyMarkup(amountBeforeMarkup, ctx.markupPercent);
  const botMarkupPercent = ctx.markupPercent ?? 0;
  const botMarkupAmount = Math.round((amount - baseAmount) * 100) / 100;
  return { amount, baseAmount, botMarkupPercent, botMarkupAmount, botId: ctx.botId };
}

/** Пополнение баланса — наценка клона не применяется. */
export function paymentSnapshotTopup(_clientId: string, amount: number) {
  const rounded = Math.round(amount * 100) / 100;
  return { amount: rounded, baseAmount: rounded, botMarkupPercent: 0, botMarkupAmount: 0 };
}

/**
 * Продуктовый платёж: к сумме после скидок добавляется наценка клона (markupPercent).
 * Рефералка использует Payment.baseAmount (без наценки).
 */
export async function paymentSnapshotProduct(clientId: string, baseAfterDiscounts: number) {
  const ctx = await getClientBotPaymentContext(clientId);
  if (!ctx) {
    const rounded = Math.round(baseAfterDiscounts * 100) / 100;
    return { amount: rounded, baseAmount: rounded, botMarkupPercent: 0, botMarkupAmount: 0 };
  }
  return buildPaymentMarkupSnapshot(baseAfterDiscounts, ctx);
}

/**
 * Версия с прямой передачей Bot — для случаев, когда у нас уже есть полный объект Bot
 * (например, в bot-routes при ручном создании платежа админом).
 */
export function buildPaymentMarkupSnapshotFromBot(amountBeforeMarkup: number, bot: Pick<Bot, "id" | "markupPercent">) {
  return buildPaymentMarkupSnapshot(amountBeforeMarkup, { botId: bot.id, markupPercent: bot.markupPercent });
}

/**
 * Заработок и выплаты клона.
 *
 * Считаем только PAID-платежи провайдера (status=PAID).
 * Платежи через balance не считаем — наценка уже учлась в момент списания
 * с баланса (там тоже создаётся Payment), но «реальные деньги» не приходили.
 *
 * Если потребуется учитывать balance-платежи отдельно — вызывайте с includeBalance=true.
 */
export async function getBotEarnings(botId: string, opts?: { from?: Date; to?: Date; includeBalance?: boolean }): Promise<{
  earnedTotal: number;
  earnedByCurrency: Record<string, number>;
  paidOutTotal: number;
  paidOutByCurrency: Record<string, number>;
  balance: number;
  balanceByCurrency: Record<string, number>;
}> {
  const where: Record<string, unknown> = {
    botId,
    status: "PAID",
    botMarkupAmount: { gt: 0 },
  };
  if (!opts?.includeBalance) {
    where.provider = { not: "balance" };
  }
  if (opts?.from || opts?.to) {
    where.paidAt = {
      ...(opts?.from ? { gte: opts.from } : {}),
      ...(opts?.to ? { lte: opts.to } : {}),
    };
  }

  const payments = await prisma.payment.findMany({
    where,
    select: { currency: true, botMarkupAmount: true },
  });

  const earnedByCurrency: Record<string, number> = {};
  for (const p of payments) {
    if (p.botMarkupAmount == null) continue;
    earnedByCurrency[p.currency] = (earnedByCurrency[p.currency] ?? 0) + p.botMarkupAmount;
  }
  const earnedTotal = Object.values(earnedByCurrency).reduce((s, v) => s + v, 0);

  const payouts = await prisma.botPayout.findMany({
    where: {
      botId,
      ...(opts?.from || opts?.to
        ? { paidAt: { ...(opts?.from ? { gte: opts.from } : {}), ...(opts?.to ? { lte: opts.to } : {}) } }
        : {}),
    },
    select: { currency: true, amount: true },
  });

  const paidOutByCurrency: Record<string, number> = {};
  for (const p of payouts) {
    paidOutByCurrency[p.currency] = (paidOutByCurrency[p.currency] ?? 0) + p.amount;
  }
  const paidOutTotal = Object.values(paidOutByCurrency).reduce((s, v) => s + v, 0);

  const balanceByCurrency: Record<string, number> = {};
  for (const cur of new Set([...Object.keys(earnedByCurrency), ...Object.keys(paidOutByCurrency)])) {
    balanceByCurrency[cur] = Math.round(((earnedByCurrency[cur] ?? 0) - (paidOutByCurrency[cur] ?? 0)) * 100) / 100;
  }
  const balance = Math.round((earnedTotal - paidOutTotal) * 100) / 100;

  return { earnedTotal, earnedByCurrency, paidOutTotal, paidOutByCurrency, balance, balanceByCurrency };
}
