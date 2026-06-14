/**
 * Авто-рассылка: настраиваемые правила (после регистрации, неактивность, без платежа и т.д.).
 * Джоб выбирает подходящих клиентов, отправляет сообщение и пишет лог.
 *
 * Триггеры делятся на два типа:
 *  - ONE-TIME: отправляется клиенту один раз за всё время (after_registration, no_payment,
 *              trial_not_connected, trial_used_never_paid, no_traffic)
 *  - RECURRING: может отправляться повторно, если условие снова наступило — дедупликация
 *              за последние RECURRING_COOLDOWN_DAYS дней (inactivity, subscription_expired,
 *              subscription_ending_soon)
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { sendEmail } from "../mail/mail.service.js";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

/** Задержка между Telegram-сообщениями (мс). Telegram rate limit ~30 msg/sec, берём с запасом. */
const TELEGRAM_DELAY_MS = 50;
/** Задержка между email-сообщениями (мс). */
const EMAIL_DELAY_MS = 200;
/**
 * Для recurring-триггеров: кулдаун в днях. Если клиенту уже отправлялось это правило
 * в пределах кулдауна — пропускаем. Предотвращает спам при каждом запуске cron.
 */
const RECURRING_COOLDOWN_DAYS = 30;

/**
 * «Окно актуальности» для one-time триггеров (в днях).
 *
 * Проблема: без верхней границы критерий «createdAt <= now-delay» захватывает всех клиентов
 * старше N дней — при создании нового правила это приводит к одномоментному спаму по
 * всей базе. Ограничиваем выборку клиентами, у которых событие-триггер наступило недавно
 * (в пределах этого окна).
 *
 * Cron работает ежедневно — 3 дня дают достаточный буфер на случай простоя / ребилдов.
 */
const ONE_TIME_WINDOW_DAYS = 3;

/** Окно для subscription_expired: показывать только недавно истёкшие (чтобы не спамить годами). */
const EXPIRED_WINDOW_DAYS = 7;

const LOG_PREFIX = "[auto-broadcast]";

export type TriggerType =
  | "after_registration"
  | "inactivity"
  | "no_payment"
  | "trial_not_connected"
  | "trial_used_never_paid"
  | "no_traffic"
  | "subscription_expired"
  | "subscription_ending_soon"
  // новый триггер — за N МИНУТ до окончания (а не дней).
  // delayDays интерпретируется как минуты. Пример: delayDays=15 → за 15 минут до истечения.
  | "subscription_ending_minutes"
  // пассивные пользователи (не брал триал И не платил).
  // Различие — наличие активной подписки (факт, не гадание). Без окна createdAt → вся база,
  // one-time дедуп → каждому 1 раз.
  | "inactive_no_subscription"   // без действий + НЕТ подписки
  | "inactive_with_subscription"; // без действий + ЕСТЬ подписка

/** Recurring-триггеры — могут повторяться, дедупликация по кулдауну */
const RECURRING_TRIGGERS: Set<TriggerType> = new Set([
  "inactivity",
  "subscription_expired",
  "subscription_ending_soon",
  "subscription_ending_minutes",
]);

function isRecurring(trigger: string): boolean {
  return RECURRING_TRIGGERS.has(trigger as TriggerType);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Telegram send ────────────────────────────────────────────────

type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; web_app: { url: string } }
  | { text: string; url: string };

type InlineKeyboard = { inline_keyboard: InlineKeyboardButton[][] };

function makeButton(label: string, action: string, publicAppUrl?: string | null): InlineKeyboardButton {
  if (action.startsWith("menu:")) {
    return { text: label, callback_data: action };
  }
  if (action.startsWith("webapp:")) {
    const path = action.slice(7);
    const base = (publicAppUrl || "").replace(/\/+$/, "");
    return { text: label, web_app: { url: `${base}${path}` } };
  }
  return { text: label, url: action };
}

/**
 * builder reply_markup для одной или двух кнопок.
 * Кнопки идут отдельными рядами (каждая на новой строке).
 */
function buildReplyMarkup(
  buttonText?: string | null,
  buttonAction?: string | null,
  publicAppUrl?: string | null,
  button2Text?: string | null,
  button2Action?: string | null,
): InlineKeyboard | undefined {
  const rows: InlineKeyboardButton[][] = [];
  const lbl1 = buttonText?.trim();
  const act1 = buttonAction?.trim();
  if (lbl1 && act1) rows.push([makeButton(lbl1, act1, publicAppUrl)]);
  const lbl2 = button2Text?.trim();
  const act2 = button2Action?.trim();
  if (lbl2 && act2) rows.push([makeButton(lbl2, act2, publicAppUrl)]);
  if (rows.length === 0) return undefined;
  return { inline_keyboard: rows };
}

async function sendTelegram(botToken: string, chatId: string, text: string, replyMarkup?: InlineKeyboard): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const proxy = await getProxyUrl("telegram");
    // T-debug (14.05.2026) — детальный лог для отладки авто-рассылки.
    console.log(`${LOG_PREFIX} [DEBUG-SEND] POST chat=${chatId} proxy=${proxy ?? "none"} botToken=${botToken.slice(0, 10)}... text="${text.slice(0, 60).replace(/\n/g, " ")}"`);
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, proxy);
    const bodyRaw = await res.text();
    let data: { ok?: boolean; description?: string; result?: { message_id?: number } } = {};
    try { data = JSON.parse(bodyRaw); } catch { /* not json */ }
    console.log(`${LOG_PREFIX} [DEBUG-SEND] RESP chat=${chatId} httpStatus=${res.status} ok=${data.ok} msgId=${data.result?.message_id ?? "-"} body="${bodyRaw.slice(0, 300).replace(/\n/g, " ")}"`);
    if (!res.ok || !data.ok) {
      const err = data.description ?? `HTTP ${res.status}`;
      console.warn(`${LOG_PREFIX} Telegram send failed for chat ${chatId}: ${err}`);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Telegram send error for chat ${chatId}:`, msg);
    return { ok: false, error: msg };
  }
}

// ─── Dedup helpers ────────────────────────────────────────────────

/**
 * для триггеров subscription_* дедуп
 * идёт по ID подписки (а не клиента). У одного клиента может быть несколько
 * подписок — каждая должна получать своё уведомление независимо.
 */
function isSubscriptionTrigger(t: string): boolean {
  return t === "subscription_expired"
    || t === "subscription_ending_soon"
    || t === "subscription_ending_minutes";
}

/**
 * Возвращает Set уже отправленных «ключей» для правила (только для НЕ-subscription
 * триггеров — там ключ = clientId). Для subscription_* триггеров используется
 * `getSentSubscriptionSnapshots` ниже — там ключ = (subscriptionId, expireAtSnapshot).
 *
 * @param cooldownDays если задан — учитываем только записи за последние N дней (RECURRING).
 *                     если null/undefined — все записи (ONE-TIME).
 */
async function getSentClientKeys(
  ruleId: string,
  cooldownDays: number | null,
): Promise<Set<string>> {
  const where: { ruleId: string; sentAt?: { gte: Date } } = { ruleId };
  if (cooldownDays != null) {
    where.sentAt = { gte: new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000) };
  }
  const logs = await prisma.autoBroadcastLog.findMany({
    where,
    select: { clientId: true },
    distinct: ["clientId"],
  });
  return new Set(logs.map((l) => l.clientId));
}

/**
 * возвращает Map<subscriptionId, Set<expireAtMs>>
 * со всеми отправленными snapshot'ами для правила. Используется при проверке
 * кандидатных подписок: подписка считается «уже уведомлённой за текущий цикл», только
 * если её текущий `expireAt` СОВПАДАЕТ с одним из snapshot'ов в наборе. После
 * ПРОДЛЕНИЯ подписки expireAt сдвинется → ни один старый snapshot не совпадёт →
 * правило снова отправит уведомление на новый цикл.
 *
 * Legacy записи (snapshot=null до миграции) бэкфилл'ятся в SQL миграции —
 * после деплоя их быть не должно. Если всё же встретим null — кладём ключ 0,
 * который никогда не совпадёт с реальным expireAt (Date.getTime() > 0).
 */
async function getSentSubscriptionSnapshots(
  ruleId: string,
): Promise<Map<string, Set<number>>> {
  const logs = await prisma.autoBroadcastLog.findMany({
    where: { ruleId, subscriptionId: { not: null } },
    select: { subscriptionId: true, expireAtSnapshot: true },
  });
  const map = new Map<string, Set<number>>();
  for (const l of logs) {
    if (!l.subscriptionId) continue;
    const set = map.get(l.subscriptionId) ?? new Set<number>();
    set.add(l.expireAtSnapshot ? l.expireAtSnapshot.getTime() : 0);
    map.set(l.subscriptionId, set);
  }
  return map;
}

// ─── Eligible clients ─────────────────────────────────────────────

/**
 * Фильтр «есть канал, пригодный для правила». Без него клиенты без telegramId (для
 * telegram-правила) попадали в eligible, отправка пропускалась, лог не писался —
 * и клиент висел как «подходящий» навечно, завышая eligibleCount в админке.
 */
function channelFilter(channel: string): Record<string, unknown> {
  if (channel === "telegram") return { telegramId: { not: null } };
  if (channel === "email") return { email: { not: null } };
  // both — хотя бы один из каналов
  return { OR: [{ telegramId: { not: null } }, { email: { not: null } }] };
}

/**
 * Стэкинг дат подписки, как в activateTariffForClient:
 * base = max(prevExpire, paidAt); newExpire = base + durationDays.
 * Используем для реконструкции expireAt в базе данных без похода в Remnawave.
 *
 * Если вернули null — значит у клиента нет ни одного завершённого платёжного
 * цикла с тарифом (и сроком его жизни).
 */
function computeStackedExpireAt(
  payments: Array<{ paidAt: Date; durationDays: number }>,
): Date | null {
  if (payments.length === 0) return null;
  // Гарантируем порядок по времени (возрастанию)
  const ordered = [...payments].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  let expire: Date | null = null;
  for (const p of ordered) {
    const base: Date = expire && expire.getTime() > p.paidAt.getTime() ? expire : p.paidAt;
    expire = new Date(base.getTime() + p.durationDays * 24 * 60 * 60 * 1000);
  }
  return expire;
}

/**
 * Собрать текущий expireAt для всех клиентов по PAID-платежам основного тарифа.
 * Один запрос + in-memory стэкинг по clientId.
 */
async function getClientMainExpiries(): Promise<Map<string, Date>> {
  const payments = await prisma.payment.findMany({
    where: {
      status: "PAID",
      tariffId: { not: null },
      paidAt: { not: null },
    },
    select: { clientId: true, paidAt: true, tariff: { select: { durationDays: true } } },
    orderBy: { paidAt: "asc" },
  });
  const byClient = new Map<string, Array<{ paidAt: Date; durationDays: number }>>();
  for (const p of payments) {
    if (!p.clientId || !p.paidAt || p.tariff?.durationDays == null) continue;
    const arr = byClient.get(p.clientId) ?? [];
    arr.push({ paidAt: p.paidAt, durationDays: p.tariff.durationDays });
    byClient.set(p.clientId, arr);
  }
  const out = new Map<string, Date>();
  for (const [clientId, arr] of byClient) {
    const expire = computeStackedExpireAt(arr);
    if (expire) out.set(clientId, expire);
  }
  return out;
}

/**
 * Target = «одна отправка».
 * Для subscription_* триггеров каждая подписка клиента — отдельный target.
 * Это позволяет одному клиенту получать уведомления про РАЗНЫЕ подписки
 * (например 5-мин до окончания подписки #2 И через 5 дней — про подписку #7).
 */
export interface BroadcastTarget {
  clientId: string;
  /** Только для subscription_* триггеров. Для остальных — undefined. */
  subscriptionId?: string;
  /** Кэшируем имя тарифа чтобы не запрашивать повторно в runRule. */
  tariffName?: string;
  /**
   * текущий expireAt подписки на момент сбора
   * кандидатов. Используется в runRule при записи лога — сохраняется как
   * expireAtSnapshot для будущего дедупа. Только для subscription_* триггеров.
   */
  subExpireAt?: Date;
}

/**
 * Получить ID клиентов, подходящих под правило (для UI eligible-count и
 * обратной совместимости). Внутри использует getEligibleTargets и сводит
 * до уникальных clientId.
 */
export async function getEligibleClientIds(ruleId: string): Promise<string[]> {
  const targets = await getEligibleTargets(ruleId);
  return Array.from(new Set(targets.map((t) => t.clientId)));
}

/**
 * Возвращает массив target'ов для отправки. Для subscription_* триггеров каждая
 * запись = подписка (clientId + subscriptionId). Для прочих триггеров — клиент.
 *
 * Дедуп:
 *   subscription_* → по (ruleId, subscriptionId) — каждая подписка отдельно
 *   прочие         → по (ruleId, clientId)
 */
/**
 * для after_registration больше не запускаем
 * по cron — правило срабатывает event-driven при /start в боте через
 * `fireRegistrationRulesForClient(clientId)` ниже. Передавая `opts.onlyClientId`,
 * мы фильтруем target'ы только до этого клиента (без поиска по окну createdAt).
 */
export async function getEligibleTargets(
  ruleId: string,
  opts?: { onlyClientId?: string },
): Promise<BroadcastTarget[]> {
  const rule = await prisma.autoBroadcastRule.findUnique({
    where: { id: ruleId },
  });
  if (!rule) return [];

  // для subscription_* триггеров используем
  // snapshot-based дедуп (по expireAt). Для остальных — старый key-based по clientId
  // (с cooldown 30 дней для recurring).
  const useSubKey = isSubscriptionTrigger(rule.triggerType);
  const sentSubMap = useSubKey ? await getSentSubscriptionSnapshots(ruleId) : new Map<string, Set<number>>();
  const sentClientSet = !useSubKey
    ? await getSentClientKeys(ruleId, isRecurring(rule.triggerType) ? RECURRING_COOLDOWN_DAYS : null)
    : new Set<string>();

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const delayDays = Math.max(0, rule.delayDays);

  // Базовая часть WHERE: не заблокирован + есть канал доставки, подходящий правилу
  const baseWhere = { isBlocked: false, ...channelFilter(rule.channel) };

  let targets: BroadcastTarget[] = [];

  switch (rule.triggerType as TriggerType) {
    // ── after_registration ──────────────────────────────────────
    case "after_registration": {
      // два режима — event и cron, выбирается
      // флагом `eventDriven` на правиле:
      //   • event (onlyClientId задан): берём ТОЛЬКО этого клиента, без фильтров
      //     активности — мгновенный welcome при /start, юзер ещё не успел ничего
      //     сделать, важно поприветствовать.
      //   • cron (onlyClientId не задан): окно [createdAt - delay - 3d, createdAt - delay]
      //     ПЛЮС фильтр «вообще ничего не сделал»:
      //       — не пробовал триал (trialUsed=false)
      //       — не платил (нет PAID платежей)
      //       — не подключён к Remna (нет подписки с remnawaveUuid)
      //     Это исключает спам тех, кто уже взял триал/купил/подключился.
      if (opts?.onlyClientId) {
        const c = await prisma.client.findUnique({
          where: { id: opts.onlyClientId },
          select: { id: true, isBlocked: true, telegramId: true, email: true },
        });
        if (c && !c.isBlocked) {
          const passChannel =
            rule.channel === "telegram" ? !!c.telegramId :
            rule.channel === "email" ? !!c.email :
            !!(c.telegramId || c.email);
          if (passChannel) targets = [{ clientId: c.id }];
        }
      } else {
        const windowEnd = new Date(now.getTime() - delayDays * dayMs);
        const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
        const cs = await prisma.client.findMany({
          where: {
            ...baseWhere,
            createdAt: { gte: windowStart, lte: windowEnd },
            trialUsed: false,
            payments: { none: { status: "PAID", amount: { gt: 0 } } },
            ownedSubscriptions: { none: { remnawaveUuid: { not: null } } },
          },
          select: { id: true },
        });
        targets = cs.map((c) => ({ clientId: c.id }));
      }
      break;
    }

    case "no_payment": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
      const cs = await prisma.client.findMany({
        where: {
          ...baseWhere,
          createdAt: { gte: windowStart, lte: windowEnd },
          payments: { none: { status: "PAID", amount: { gt: 0 } } },
        },
        select: { id: true },
      });
      targets = cs.map((c) => ({ clientId: c.id }));
      break;
    }

    // ── inactive_no_subscription ─────────────────────────────────
    // пассивный без подписки —
    // не брал триал, не платил, и НЕТ активной подписки (нет sub с remnawaveUuid).
    // БЕЗ окна createdAt — вся база. one-time дедуп → каждому 1 раз.
    case "inactive_no_subscription": {
      const cs = await prisma.client.findMany({
        where: {
          ...baseWhere,
          trialUsed: false,
          payments: { none: { status: "PAID", amount: { gt: 0 } } },
          ownedSubscriptions: { none: { remnawaveUuid: { not: null } } },
        },
        select: { id: true },
      });
      targets = cs.map((c) => ({ clientId: c.id }));
      break;
    }

    // ── inactive_with_subscription ───────────────────────────────
    // пассивный с подпиской —
    // не брал триал, не платил, но ЕСТЬ активная подписка (sub с remnawaveUuid).
    case "inactive_with_subscription": {
      const cs = await prisma.client.findMany({
        where: {
          ...baseWhere,
          trialUsed: false,
          payments: { none: { status: "PAID", amount: { gt: 0 } } },
          ownedSubscriptions: { some: { remnawaveUuid: { not: null } } },
        },
        select: { id: true },
      });
      targets = cs.map((c) => ({ clientId: c.id }));
      break;
    }

    case "trial_not_connected": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
      const cs = await prisma.client.findMany({
        where: {
          ...baseWhere,
          createdAt: { gte: windowStart, lte: windowEnd },
          trialUsed: false,
          // после T-unify клиент может
          // иметь подписки даже если client.remnawaveUuid=null (это legacy primary
          // поле). Корректно проверять «не привязан к Remna» через отсутствие
          // ЛЮБОЙ подписки с remnawaveUuid в таблице Subscription.
          ownedSubscriptions: { none: { remnawaveUuid: { not: null } } },
        },
        select: { id: true },
      });
      targets = cs.map((c) => ({ clientId: c.id }));
      break;
    }

    case "trial_used_never_paid": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
      const cs = await prisma.client.findMany({
        where: {
          ...baseWhere,
          createdAt: { gte: windowStart, lte: windowEnd },
          trialUsed: true,
          payments: { none: { status: "PAID", amount: { gt: 0 } } },
        },
        select: { id: true },
      });
      targets = cs.map((c) => ({ clientId: c.id }));
      break;
    }

    case "no_traffic": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - ONE_TIME_WINDOW_DAYS * dayMs);
      const cs = await prisma.client.findMany({
        where: {
          ...baseWhere,
          // «привязан к Remna» — это
          // ХОТЯ БЫ одна подписка с remnawaveUuid в таблице Subscription.
          // Раньше через client.remnawaveUuid (legacy primary) — после unify это
          // поле может быть null у клиентов с активными подписками.
          ownedSubscriptions: { some: { remnawaveUuid: { not: null } } },
          createdAt: { gte: windowStart, lte: windowEnd },
          payments: { none: { status: "PAID", amount: { gt: 0 } } },
        },
        select: { id: true },
      });
      targets = cs.map((c) => ({ clientId: c.id }));
      break;
    }

    case "inactivity": {
      const since = new Date(now.getTime() - delayDays * dayMs);
      const all = await prisma.client.findMany({
        where: {
          ...baseWhere,
          payments: { some: { status: "PAID", amount: { gt: 0 } } },
          // клиент с
          // ДЕЙСТВУЮЩЕЙ подпиской (любая длительность — 7 дней, год, год+) —
          // НЕ «неактивный», даже если давно не платил (купил на год вперёд).
          // Раньше: юзер с годовой подпиской через 30 дней получал «вы неактивны»,
          // и каждый месяц до конца действия подписки.
          ownedSubscriptions: { none: { expireAt: { gt: now } } },
        },
        select: { id: true },
      });
      const recentlyPaidIds = new Set(
        (
          await prisma.payment.findMany({
            where: { status: "PAID", amount: { gt: 0 }, paidAt: { gte: since } },
            select: { clientId: true },
            distinct: ["clientId"],
          })
        ).map((p) => p.clientId),
      );
      targets = all.filter((c) => !recentlyPaidIds.has(c.id)).map((c) => ({ clientId: c.id }));
      break;
    }

    // ── subscription_* триггеры ─────────────────────────────────
    // каждая подписка — отдельный target.
    // Дедуп по subscriptionId — позволяет уведомлять про РАЗНЫЕ подписки одного
    // клиента независимо. Раньше был distinct(ownerId), и юзер с 5 истекающими
    // подписками получал уведомление только за одну.

    case "subscription_expired": {
      const windowEnd = new Date(now.getTime() - delayDays * dayMs);
      const windowStart = new Date(windowEnd.getTime() - EXPIRED_WINDOW_DAYS * dayMs);
      const subs = await prisma.subscription.findMany({
        where: {
          expireAt: { gte: windowStart, lte: windowEnd },
          autoRenewEnabled: false,
          tariffId: { not: null },
          // подписки в инвентаре подарков
          // (purchasedAsGift=true) не уведомляем — это «товар» в gift-flow дарителя,
          // не «активная подписка» юзера.
          //
          // Что покрывает фильтр:
          //   purchasedAsGift=true + giftStatus=null         → куплена в инвентарь, не подарена → НЕ слать
          //   purchasedAsGift=true + giftStatus=GIFT_RESERVED → код создан, ждёт активации     → НЕ слать
          //
          // Что НЕ исключает (покрывается логикой purchasedAsGift=false):
          //   purchasedAsGift=false + giftStatus=GIFTED          → передана получателю, теперь его → СЛАТЬ
          //   purchasedAsGift=false + giftStatus=ACTIVATED_SELF  → даритель забрал себе → СЛАТЬ
          //   purchasedAsGift=false + giftStatus=null            → обычная подписка → СЛАТЬ
          purchasedAsGift: false,
          owner: baseWhere,
        },
        select: { id: true, ownerId: true, expireAt: true, tariff: { select: { name: true } } },
      });
      targets = subs.map((s) => ({
        clientId: s.ownerId,
        subscriptionId: s.id,
        tariffName: s.tariff?.name ?? undefined,
        subExpireAt: s.expireAt ?? undefined,
      }));
      break;
    }

    case "subscription_ending_minutes": {
      const minutesLeft = Math.max(1, delayDays);
      const minuteMs = 60 * 1000;
      const windowStart = new Date(now.getTime() + (minutesLeft - 1) * minuteMs);
      const windowEnd = new Date(now.getTime() + minutesLeft * minuteMs);
      const subs = await prisma.subscription.findMany({
        where: {
          expireAt: { gte: windowStart, lt: windowEnd },
          autoRenewEnabled: false,
          tariffId: { not: null },
          owner: baseWhere,
        },
        select: { id: true, ownerId: true, expireAt: true, tariff: { select: { name: true } } },
      });
      targets = subs.map((s) => ({
        clientId: s.ownerId,
        subscriptionId: s.id,
        tariffName: s.tariff?.name ?? undefined,
        subExpireAt: s.expireAt ?? undefined,
      }));
      break;
    }

    case "subscription_ending_soon": {
      const daysLeft = Math.max(1, delayDays);
      const windowStart = new Date(now.getTime() + (daysLeft - 1) * dayMs);
      const windowEnd = new Date(now.getTime() + daysLeft * dayMs);
      const subs = await prisma.subscription.findMany({
        where: {
          expireAt: { gte: windowStart, lt: windowEnd },
          autoRenewEnabled: false,
          tariffId: { not: null },
          owner: baseWhere,
        },
        select: { id: true, ownerId: true, expireAt: true, tariff: { select: { name: true } } },
      });
      targets = subs.map((s) => ({
        clientId: s.ownerId,
        subscriptionId: s.id,
        tariffName: s.tariff?.name ?? undefined,
        subExpireAt: s.expireAt ?? undefined,
      }));
      break;
    }

    default:
      console.warn(`${LOG_PREFIX} Unknown trigger type: ${rule.triggerType}`);
      return [];
  }

  // для subscription_* фильтр идёт через
  // sentSubMap. Подписка считается «уже уведомлённой за текущий цикл», только если
  // её current expireAt совпадает с одним из сохранённых snapshot'ов. После продления
  // (expireAt сдвинулся) подписка снова попадёт в eligible.
  let eligible: BroadcastTarget[];
  let alreadySent: number;
  if (useSubKey) {
    let skipped = 0;
    eligible = targets.filter((t) => {
      if (!t.subscriptionId) return true;
      const snapshots = sentSubMap.get(t.subscriptionId);
      if (!snapshots || snapshots.size === 0) return true;
      const currentExpireMs = t.subExpireAt ? t.subExpireAt.getTime() : 0;
      const alreadyForThisCycle = snapshots.has(currentExpireMs);
      if (alreadyForThisCycle) skipped++;
      return !alreadyForThisCycle;
    });
    alreadySent = skipped;
  } else {
    eligible = targets.filter((t) => !sentClientSet.has(t.clientId));
    alreadySent = sentClientSet.size;
  }

  console.log(
    `${LOG_PREFIX} Rule "${rule.name}" (${rule.triggerType}, delay=${rule.delayDays}, channel=${rule.channel}): ` +
    `${targets.length} matched, ${alreadySent} already sent, ${eligible.length} eligible`,
  );

  return eligible;
}

// ─── Run rule ─────────────────────────────────────────────────────

export type RunRuleResult = {
  ruleId: string;
  ruleName: string;
  sent: number;
  skipped: number;
  errors: string[];
};

/**
 * Выполнить одно правило: отправить сообщение подходящим клиентам и записать лог.
 */
export async function runRule(ruleId: string, opts?: { onlyClientId?: string }): Promise<RunRuleResult> {
  // подгружаем promoCode для подстановки в текст + проверки лимита.
  const rule = await prisma.autoBroadcastRule.findUnique({
    where: { id: ruleId },
    include: { promoCode: true, _count: { select: { logs: true } } },
  });
  if (!rule) return { ruleId, ruleName: "", sent: 0, skipped: 0, errors: ["Rule not found"] };
  if (!rule.enabled) return { ruleId, ruleName: rule.name, sent: 0, skipped: 0, errors: [] };

  // теперь работаем через targets — для
  // subscription_* триггеров каждая подписка отдельный target. Один клиент с
  // несколькими истекающими подписками получит N сообщений (по одному на подписку).
  // T-event-driven: для after_registration onlyClientId сужает выборку до 1 клиента.
  let targets = await getEligibleTargets(ruleId, opts);
  if (targets.length === 0) {
    return { ruleId, ruleName: rule.name, sent: 0, skipped: 0, errors: [] };
  }

  const alreadySent = rule._count.logs;
  let effectiveMax: number | null = rule.maxRecipients ?? null;
  if (rule.promoCode && rule.promoCode.maxUses > 0) {
    const remainingPromoUses = rule.promoCode.maxUses - alreadySent;
    if (remainingPromoUses <= 0) {
      console.log(`${LOG_PREFIX} Rule "${rule.name}": промокод исчерпан (${alreadySent}/${rule.promoCode.maxUses}). Отправка остановлена.`);
      return { ruleId, ruleName: rule.name, sent: 0, skipped: 0, errors: [] };
    }
    effectiveMax = effectiveMax != null ? Math.min(effectiveMax, remainingPromoUses) : remainingPromoUses;
  }
  if (effectiveMax != null) {
    const slotsLeft = effectiveMax - alreadySent;
    if (slotsLeft <= 0) {
      console.log(`${LOG_PREFIX} Rule "${rule.name}": лимит получателей исчерпан (${alreadySent}/${effectiveMax}).`);
      return { ruleId, ruleName: rule.name, sent: 0, skipped: 0, errors: [] };
    }
    if (targets.length > slotsLeft) targets = targets.slice(0, slotsLeft);
  }

  const config = await getSystemConfig();
  const doTelegram = rule.channel === "telegram" || rule.channel === "both";
  const doEmail = rule.channel === "email" || rule.channel === "both";
  const botToken = config.telegramBotToken?.trim();

  // Проверка конфигурации каналов
  if (doTelegram && !botToken) {
    console.error(
      `${LOG_PREFIX} Rule "${rule.name}": telegram channel selected but telegram_bot_token is not configured in settings!`,
    );
  }

  const smtpConfig = doEmail
    ? {
        host: config.smtpHost || "",
        port: config.smtpPort ?? 587,
        secure: config.smtpSecure ?? false,
        user: config.smtpUser ?? null,
        password: config.smtpPassword ?? null,
        fromEmail: config.smtpFromEmail ?? null,
        fromName: config.smtpFromName ?? null,
      }
    : null;

  if (doEmail && (!smtpConfig?.host || !smtpConfig?.fromEmail)) {
    console.error(
      `${LOG_PREFIX} Rule "${rule.name}": email channel selected but SMTP is not configured (host or fromEmail missing)!`,
    );
  }

  const serviceName = config.serviceName || "Сервис";
  const subject = rule.subject?.trim() || `Сообщение от ${serviceName}`;
  // подставляем глобальные плейсхолдеры (одинаковые для всех клиентов).
  // {{PROMOCODE}} → код PromoCode.
  // {{DISCOUNT}} → discountPercent промокода ИЛИ personalDiscountPercent.
  // Per-client плейсхолдеры ({{TARIFF}}, {{SUBSCRIPTION_ID}}) применяем внутри цикла.
  let globalMessage = rule.message.trim();
  if (rule.promoCode) {
    globalMessage = globalMessage.split("{{PROMOCODE}}").join(rule.promoCode.code);
    if (rule.promoCode.discountPercent != null) {
      globalMessage = globalMessage.split("{{DISCOUNT}}").join(`${Math.round(rule.promoCode.discountPercent)}%`);
    }
  }
  if (rule.personalDiscountPercent != null) {
    globalMessage = globalMessage.split("{{DISCOUNT}}").join(`${Math.round(rule.personalDiscountPercent)}%`);
  }

  // Уникальные clientId для загрузки контактов (TG/email).
  const uniqueClientIds = Array.from(new Set(targets.map((t) => t.clientId)));
  const clientsRaw = await prisma.client.findMany({
    where: { id: { in: uniqueClientIds } },
    select: { id: true, telegramId: true, email: true },
  });
  const clientsMap = new Map(clientsRaw.map((c) => [c.id, c]));

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  const SKIP_PATTERNS = /blocked by the user|can't initiate conversation|send messages to bots|chat not found|user is deactivated|bot was kicked/i;
  const personalDiscountAlreadyApplied = new Set<string>();
  // Анти-задвоение: для subscription_* триггеров у клиента может быть несколько
  // подписок (несколько target'ов в одном прогоне). Шлём ОДНО сообщение на клиента
  // за прогон, но в лог пишем КАЖДУЮ подписку (чтобы дедуп-снапшоты по подпискам
  // сохранялись и правило не сработало повторно в следующих тиках).
  const isSubTrigger = isSubscriptionTrigger(rule.triggerType);
  const clientMessagedThisRun = new Set<string>();

  console.log(`${LOG_PREFIX} Rule "${rule.name}": sending to ${targets.length} targets (${uniqueClientIds.length} unique clients)...`);

  for (const t of targets) {
    const c = clientsMap.get(t.clientId);
    if (!c) continue;
    let telegramOk = false;
    let emailOk = false;
    let telegramSkipped = false;

    // Личная скидка: выставляем один раз на клиента, даже если у него несколько target'ов.
    if (
      rule.personalDiscountPercent != null &&
      rule.personalDiscountPercent > 0 &&
      !personalDiscountAlreadyApplied.has(c.id)
    ) {
      await prisma.client.update({
        where: { id: c.id },
        data: {
          personalDiscountPercent: rule.personalDiscountPercent,
          personalDiscountIsOneTime: rule.personalDiscountIsOneTime ?? true,
        },
      }).catch(() => { /* ignore */ });
      personalDiscountAlreadyApplied.add(c.id);
    }

    // для subscription_* триггеров подписка
    // и её tariffName УЖЕ выбраны в targets[t] (из getEligibleTargets). Для прочих
    // триггеров — подписки нет (target = client). Тогда {{TARIFF}} → дефолт,
    // {{SUBSCRIPTION_ID}} остаётся пустой (или подставляется недавняя для
    // совместимости с правилами after_registration etc).
    let perClientMessage = globalMessage;
    let subscriptionIdForButton: string | null = t.subscriptionId ?? null;
    let tariffNameForText: string | null = t.tariffName ?? null;
    if (!subscriptionIdForButton) {
      // Fallback для не-subscription триггеров: берём любую активную с тарифом.
      // Без primary-приоритета — нам всё равно какая (для после-регистр. правил
      // {{TARIFF}} обычно вообще не нужен).
      try {
        const fb = await prisma.subscription.findFirst({
          where: { ownerId: c.id, tariffId: { not: null } },
          orderBy: { createdAt: "desc" },
          include: { tariff: { select: { name: true } } },
        });
        if (fb) {
          subscriptionIdForButton = fb.id;
          tariffNameForText = fb.tariff?.name ?? null;
        }
      } catch { /* ignore */ }
    }
    perClientMessage = perClientMessage
      .split("{{TARIFF}}")
      .join(tariffNameForText ?? "подписка");
    if (subscriptionIdForButton) {
      perClientMessage = perClientMessage.split("{{SUBSCRIPTION_ID}}").join(subscriptionIdForButton);
    }
    // Литеральные «\n»/«\r\n» из ручного ввода в админке → реальные переносы строк.
    // Реальные переносы (из seed) не содержат backslash и не затрагиваются.
    perClientMessage = perClientMessage.replace(/\\r\\n|\\n/g, "\n");

    // Анти-задвоение: этому клиенту в этом прогоне уже отправили — не шлём повтор,
    // но ниже всё равно запишем лог по текущей подписке (для дедуп-снапшота).
    const alreadyMessagedClient = isSubTrigger && clientMessagedThisRun.has(c.id);

    const subB1Url = rule.buttonUrl && subscriptionIdForButton
      ? rule.buttonUrl.split("{{SUBSCRIPTION_ID}}").join(subscriptionIdForButton)
      : rule.buttonUrl;
    const subB2Url = rule.button2Url && subscriptionIdForButton
      ? rule.button2Url.split("{{SUBSCRIPTION_ID}}").join(subscriptionIdForButton)
      : rule.button2Url;
    const perClientMarkup = buildReplyMarkup(
      rule.buttonText, subB1Url, config.publicAppUrl,
      rule.button2Text, subB2Url,
    );

    // Telegram (пропускаем, если клиенту уже отправили в этом прогоне — анти-задвоение)
    if (doTelegram && botToken && c.telegramId?.trim() && !alreadyMessagedClient) {
      const tgResult = await sendTelegram(botToken, c.telegramId.trim(), perClientMessage, perClientMarkup);
      telegramOk = tgResult.ok;
      if (telegramOk) clientMessagedThisRun.add(c.id);
      if (!telegramOk) {
        if (tgResult.error && SKIP_PATTERNS.test(tgResult.error)) {
          skipped++;
          telegramSkipped = true;
        } else if (errors.length < 20) {
          errors.push(`Telegram ${c.telegramId}: ${tgResult.error ?? "unknown error"}`);
        }
      }
      await delay(TELEGRAM_DELAY_MS);
    }

    // Email (пропускаем, если клиенту уже отправили в этом прогоне — анти-задвоение)
    if (doEmail && smtpConfig?.host && smtpConfig?.fromEmail && c.email?.trim() && !alreadyMessagedClient) {
      try {
        const perClientHtml = `<!DOCTYPE html><html><body style="font-family: sans-serif;">${perClientMessage.replace(/\n/g, "<br>\n")}</body></html>`;
        const res = await sendEmail(smtpConfig, c.email.trim(), subject, perClientHtml);
        emailOk = res.ok;
        if (!emailOk && errors.length < 20) {
          errors.push(`Email fail: ${c.email}`);
        }
      } catch (err) {
        if (errors.length < 20) {
          errors.push(`Email error: ${c.email} — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await delay(EMAIL_DELAY_MS);
    }

    const anySent = telegramOk || emailOk;
    // Логируем (= помечаем подписку обработанной) если отправили, либо клиент
    // заблокировал бота, либо пропустили как дубль клиента в этом прогоне —
    // во всех случаях по этой подписке больше слать не нужно.
    const shouldLog = anySent || telegramSkipped || alreadyMessagedClient;
    if (shouldLog) {
      try {
        await prisma.autoBroadcastLog.create({
          data: {
            ruleId: rule.id,
            clientId: c.id,
            subscriptionId: t.subscriptionId ?? null,
            // сохраняем текущий expireAt подписки
            // как snapshot. После продления подписки expireAt изменится — следующий
            // тик правила увидит несовпадение и снова попадёт в eligible.
            expireAtSnapshot: t.subscriptionId && t.subExpireAt ? t.subExpireAt : null,
          },
        });
      } catch (logErr) {
        console.error(`${LOG_PREFIX} Failed to write log for rule ${rule.id}, client ${c.id}, sub ${t.subscriptionId ?? "—"}:`, logErr);
      }
      if (anySent) sent++;
    }
  }

  console.log(
    `${LOG_PREFIX} Rule "${rule.name}" done: ${sent} sent, ${skipped} skipped` +
    (errors.length > 0 ? `, ${errors.length} error(s)` : ""),
  );

  return { ruleId, ruleName: rule.name, sent, skipped, errors };
}

// ─── Run all rules ────────────────────────────────────────────────

/**
 * Запустить все включённые правила.
 */
export async function runAllRules(): Promise<RunRuleResult[]> {
  const rules = await prisma.autoBroadcastRule.findMany({
    where: { enabled: true },
    select: { id: true, name: true },
  });

  if (rules.length === 0) {
    console.log(`${LOG_PREFIX} No enabled rules found.`);
    return [];
  }

  console.log(`${LOG_PREFIX} Running ${rules.length} enabled rule(s)...`);

  const results: RunRuleResult[] = [];
  for (const r of rules) {
    try {
      const res = await runRule(r.id);
      results.push(res);
    } catch (err) {
      console.error(`${LOG_PREFIX} Rule "${r.name}" (${r.id}) crashed:`, err);
      results.push({
        ruleId: r.id,
        ruleName: r.name,
        sent: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  const totalSent = results.reduce((s, r) => s + r.sent, 0);
  const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  console.log(`${LOG_PREFIX} All rules done: ${totalSent} sent, ${totalSkipped} skipped, ${totalErrors} error(s)`);

  return results;
}

/**
 * запустить ВСЕ правила с триггером
 * `after_registration` для конкретного клиента (event-driven path). Вызывается
 * сразу после регистрации в боте — приветствие приходит в течение секунды.
 *
 * Дедуп тот же что у крон-пути — `(rule_id, client_id)` через autoBroadcastLog.
 * Если клиент удалил учётку и зарегистрировался заново — у него новый client_id,
 * дедуп пройдёт, юзер получит welcome снова. Если случайно вызовем дважды для
 * того же client_id — второй вызов отбросится дедупом, спама не будет.
 */
export async function fireRegistrationRulesForClient(clientId: string): Promise<RunRuleResult[]> {
  if (!clientId) return [];
  // запускаем ТОЛЬКО event-driven правила.
  // Cron-правила с тем же триггером (after_registration) обрабатываются в обычном
  // потоке планировщика и НЕ должны срабатывать здесь — иначе будет двойная отправка.
  const rules = await prisma.autoBroadcastRule.findMany({
    where: { triggerType: "after_registration", enabled: true, eventDriven: true },
    select: { id: true, name: true },
  });
  if (rules.length === 0) return [];

  console.log(`${LOG_PREFIX} fireRegistrationRulesForClient: ${rules.length} rule(s) for client ${clientId}`);
  const results: RunRuleResult[] = [];
  for (const r of rules) {
    try {
      const result = await runRule(r.id, { onlyClientId: clientId });
      results.push(result);
      if (result.sent > 0) {
        console.log(`${LOG_PREFIX} [event] Rule "${r.name}": sent=${result.sent} to client ${clientId}`);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} [event] Rule "${r.name}" failed for client ${clientId}:`, err);
      results.push({
        ruleId: r.id,
        ruleName: r.name,
        sent: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }
  return results;
}
