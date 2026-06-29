/**
 * Уведомления пользователя в Telegram (пополнение баланса, оплата тарифа).
 * Вызывается из webhook'ов после успешной обработки платежа.
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

/** Inline keyboard with a single "Back to menu" button for client notifications. */
function backToMenuMarkup(backLabel?: string | null): Record<string, unknown> {
  return { inline_keyboard: [[{ text: backLabel || "◀️ В меню", callback_data: "menu:main" }]] };
}

type AdminNotificationEventType =
  | "balance_topup"
  | "tariff_payment"
  | "new_client"
  | "new_ticket"
  | "trial_activated"
  | "subscription_converted"
  | "withdrawal_request"
  | "promo_activated"
  | "gift_redeemed"
  | "auto_renew_failed";

type AdminNotificationPreferenceRow = {
  telegramId: string;
  notifyBalanceTopup: boolean;
  notifyTariffPayment: boolean;
  notifyNewClient: boolean;
  notifyNewTicket: boolean;
};

export type TelegramUserSendOptions = { clientIdForBotToken?: string };

export async function sendTelegramToUser(
  telegramId: string,
  text: string,
  messageThreadId?: number | null,
  replyMarkup?: Record<string, unknown>,
  _opts?: TelegramUserSendOptions,
): Promise<void> {
  // v5.0.0: единственный бот, токен берётся из system_settings (или env).
  let token: string | undefined;
  {
    const config = await getSystemConfig();
    token = config.telegramBotToken?.trim() ?? undefined;
  }
  if (!token) {
    console.warn("[Telegram notify] Bot token not configured, skip notification");
    return;
  }
  const chatId = telegramId.trim();
  if (!chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (messageThreadId) payload.message_thread_id = messageThreadId;
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    const proxy = await getProxyUrl("telegram");
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, proxy);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !data.ok) {
      console.warn("[Telegram notify] sendMessage failed", { chatId: chatId.slice(0, 8) + "...", error: data.description ?? res.statusText });
    }
  } catch (e) {
    console.warn("[Telegram notify] sendMessage error", e);
  }
}

function getTopicIdForEvent(config: Record<string, unknown>, eventType: AdminNotificationEventType): number | null {
  let raw: string | null = null;
  switch (eventType) {
    case "new_client":
      raw = (config.notificationTopicNewClients as string) ?? null;
      break;
    case "balance_topup":
    case "tariff_payment":
      raw = (config.notificationTopicPayments as string) ?? null;
      break;
    case "new_ticket":
      raw = (config.notificationTopicTickets as string) ?? null;
      break;
    case "trial_activated":
      raw = (config.notificationTopicTrials as string) ?? null;
      break;
    case "subscription_converted":
      raw = (config.notificationTopicConversions as string) ?? null;
      break;
    case "withdrawal_request":
      raw = (config.notificationTopicWithdrawals as string) ?? null;
      break;
    case "promo_activated":
      raw = (config.notificationTopicPromo as string) ?? null;
      break;
    case "gift_redeemed":
      raw = (config.notificationTopicGifts as string) ?? null;
      break;
    case "auto_renew_failed":
      raw = (config.notificationTopicAutoRenew as string) ?? null;
      break;
  }
  if (!raw?.trim()) return null;
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function sendTelegramToAdminsForEvent(eventType: AdminNotificationEventType, text: string): Promise<void> {
  const config = await getSystemConfig();
  // ── manager-notify дубль new_ticket в отдельную группу менеджеров.
  // Группу читаем напрямую из systemSetting (не через allowlist getSystemConfig) — устойчивее к пересборкам.
  if (eventType === "new_ticket") {
    try {
      const mg = await prisma.systemSetting.findFirst({ where: { key: "notification_managers_group_id" } });
      const managersGroupId = mg?.value?.trim();
      if (managersGroupId) {
        const tp = await prisma.systemSetting.findFirst({ where: { key: "notification_managers_topic_tickets" } });
        const tpNum = tp?.value?.trim() ? parseInt(tp.value.trim(), 10) : NaN;
        const managersTopicId = Number.isFinite(tpNum) ? tpNum : undefined;
        await sendTelegramToUser(managersGroupId, text, managersTopicId).catch((e) => {
          console.warn("[Telegram notify] send to managers group failed", e);
        });
      }
    } catch (e) {
      console.warn("[Telegram notify] managers-group lookup failed", e);
    }
  }
  const groupId = config.notificationTelegramGroupId?.trim();
  if (groupId) {
    const topicId = getTopicIdForEvent(config as unknown as Record<string, unknown>, eventType);
    await sendTelegramToUser(groupId, text, topicId).catch((e) => {
      console.warn("[Telegram notify] send to group failed", e);
    });
    return;
  }
  const adminIds = config.botAdminTelegramIds ?? [];
  if (!adminIds.length) return;
  const prefs = (await prisma.adminNotificationPreference.findMany({
    where: { telegramId: { in: adminIds } },
  })) as AdminNotificationPreferenceRow[];
  const byId = new Map<string, AdminNotificationPreferenceRow>(prefs.map((p) => [p.telegramId, p]));
  const shouldSend = (telegramId: string) => {
    const p = byId.get(telegramId);
    if (!p) return true;
    switch (eventType) {
      case "balance_topup":
        return p.notifyBalanceTopup;
      case "tariff_payment":
        return p.notifyTariffPayment;
      case "new_client":
        return p.notifyNewClient;
      case "new_ticket":
        return p.notifyNewTicket;
      default:
        return true;
    }
  };
  await Promise.all(
    adminIds
      .filter((id) => shouldSend(id))
      .map((id) =>
        sendTelegramToUser(id, text).catch((e) => {
          console.warn("[Telegram notify] send to admin failed", e);
        })
      )
  );
}

function formatMoney(amount: number, currency: string): string {
  const curr = (currency || "RUB").toUpperCase();
  if (curr === "RUB") return `${amount.toFixed(2)} ₽`;
  if (curr === "USD") return `$${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${curr}`;
}

/**
 * Отправить уведомление о пополнении баланса.
 */
export async function notifyBalanceToppedUp(clientId: string, amount: number, currency: string, provider?: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, email: true, telegramUsername: true, id: true, balance: true },
  });
  if (!client) return;
  if (client.telegramId) {
    const textForClient = `✅ <b>Баланс пополнен</b> на ${formatMoney(amount, currency)}.\nВаш баланс: ${formatMoney(client.balance ?? 0, currency)}`;
    const config = await getSystemConfig();
    await sendTelegramToUser(client.telegramId, textForClient, null, backToMenuMarkup(config.botBackLabel), {
      clientIdForBotToken: client.id,
    });
  }
  const clientLabel = formatClientLabel(client);
  const lines = [
    `💰 <b>Пополнение баланса</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`💵 Сумма: <b>${formatMoney(amount, currency)}</b>`);
  lines.push(`💰 Баланс после: ${formatMoney(client.balance ?? 0, currency)}`);
  if (provider) lines.push(`🏦 Провайдер: ${escapeHtml(provider)}`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("balance_topup", lines.join("\n"));
}

/**
 * Отправить уведомление об оплате и активации тарифа.
 */
export async function notifyTariffActivated(clientId: string, paymentId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, email: true, telegramUsername: true, id: true, balance: true },
  });
  if (!client) return;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      amount: true,
      currency: true,
      provider: true,
      subscriptionId: true,
      tariffId: true,
      metadata: true,
      tariff: { select: { name: true, durationDays: true, price: true, locations: true, trafficLimitBytes: true } },
      tariffPriceOption: { select: { durationDays: true } },
    },
  });
  const tariffName = payment?.tariff?.name?.trim() || "Тариф";
  // если оплачена подарочная подписка — автогенерируем GiftCode
  // и шлём клиенту текст по ТЗ (Стандарт / Unblock с трафиком) с готовой ссылкой.
  // если выдан админом — меняем заголовок «Тариф ... оплачен и активирован»
  // на «Администратор выдал Вам подписку Тариф «...»».
  // админский комментарий — показываем клиенту в уведомлении.
  let isGiftPurchase = false;
  let isAdminGrant = false;
  let adminNote: string | null = null;
  try {
    const meta = payment?.metadata ? JSON.parse(payment.metadata) as Record<string, unknown> : null;
    isGiftPurchase = meta?.purchasedAsGift === true;
    isAdminGrant = meta?.kind === "admin_grant";
    if (typeof meta?.note === "string" && meta.note.trim()) {
      adminNote = meta.note.trim();
    }
  } catch { /* ignore */ }

  if (client.telegramId && isGiftPurchase && payment?.subscriptionId) {
    // Авто-создание gift code сразу после оплаты.
    try {
      const { createGiftCode } = await import("../gift/gift.service.js");
      const codeResult = await createGiftCode(clientId, payment.subscriptionId, undefined, { skipConfigCheck: true });
      if (codeResult.ok) {
        const cfg = await getSystemConfig();
        const botToken = (cfg.telegramBotToken || "").trim();
        const botUsernameRes = botToken
          ? await fetch(`https://api.telegram.org/bot${botToken}/getMe`).then((r) => r.json() as Promise<{ ok: boolean; result?: { username?: string } }>).catch(() => null)
          : null;
        const botUsername = botUsernameRes?.result?.username ?? "bot";
        const giftUrl = `https://t.me/${botUsername}?start=gift_${codeResult.data.code}`;
        const durationDays = codeResult.data.durationDays ?? payment.tariff?.durationDays ?? 0;
        const trafficBytes = codeResult.data.trafficLimitBytes ?? (payment.tariff?.trafficLimitBytes != null ? Number(payment.tariff.trafficLimitBytes) : 0);
        const hasTraffic = trafficBytes > 0;
        let giftText: string;
        if (hasTraffic) {
          const trafficGb = Math.round(trafficBytes / 1024 ** 3);
          giftText =
            `💝 Подарочная ${tariffName} готова!\n\n` +
            `✅ Оплата прошла успешно.\n📅 ${durationDays} дней, ${trafficGb} GB\n\n` +
            `👉 Перешлите ссылку человеку, которому хотите подарить подписку ⬇️\n\n` +
            `💡 Чтобы скопировать ссылку, нажмите на неё один раз.\n\n` +
            `${giftUrl}\n\n` +
            `🎉 При переходе по ссылке подписка автоматически активируется!`;
        } else {
          giftText =
            `💝 Подарочная подписка готова!\n\n` +
            `✅ Оплата прошла успешно.\nКод: ${codeResult.data.code}\nТариф: ${tariffName}\n📅 ${durationDays} дней\n\n` +
            `👉 Перешлите ссылку человеку, которому хотите подарить подписку ⬇️\n\n` +
            `${giftUrl}\n\n` +
            `🎉 При переходе по ссылке подписка автоматически активируется!`;
        }
        // `?url=` обязателен — иначе share-окно не открывается.
        // новый текст шеринга подарка.
        const shareText = `У меня для тебя подарок 🎁\n \nПодписка на сервис безопасного удалённого доступа 🛡 \n\n💡 Нажми на ссылку, чтобы активировать:\n\n${giftUrl}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(giftUrl)}&text=${encodeURIComponent(shareText)}`;
        if (botToken) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: client.telegramId,
              text: giftText,
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📤 Поделиться в Telegram", url: shareUrl }],
                  [{ text: "🎁 Мои подарки", callback_data: "gift:subscriptions" }],
                  [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
                ],
              },
            }),
          }).catch((e) => console.error("[notify] gift purchase send failed:", e));
        }
      }
    } catch (e) {
      console.error("[notify] gift purchase auto-create failed:", e);
    }
    // Для подарочной не шлём «Тариф оплачен и активирован» — клиент получил красивый gift-текст выше.
    // Админ-уведомление шлётся в конце функции в любом случае.
  } else if (client.telegramId) {
    // после успешной оплаты — выдаём ту же UX что после триала:
    // ссылка подписки + кнопки «📲 Инструкции по установке» и «🌐 Локации» (если есть).
    let subscriptionUrl: string | null = null;
    if (payment?.subscriptionId) {
      const sub = await prisma.subscription.findUnique({
        where: { id: payment.subscriptionId },
        select: { remnawaveUuid: true },
      });
      if (sub?.remnawaveUuid) {
        try {
          const { remnaGetUser } = await import("../remna/remna.client.js");
          const r = await remnaGetUser(sub.remnawaveUuid);
          const inner = (r.data as { response?: Record<string, unknown>; data?: Record<string, unknown> } | null)?.response
            ?? (r.data as { response?: Record<string, unknown>; data?: Record<string, unknown> } | null)?.data
            ?? (r.data as Record<string, unknown> | null);
          subscriptionUrl = (inner as { subscriptionUrl?: string } | null)?.subscriptionUrl ?? null;
        } catch { /* ignore */ }
      }
    }
    const cfg = await getSystemConfig();
    // Настройки сообщения «после оформления подписки» (админка → Подписка):
    //   purchase_message_enabled  — "0" отключает отправку этого сообщения клиенту;
    //   purchase_message_text     — кастомный текст (плейсхолдеры {{TARIFF}}, {{SUBSCRIPTION_URL}});
    //   purchase_message_buttons  — JSON-конструктор кнопок ([{text, action}, …]).
    let purchaseMsgEnabled = true;
    let purchaseMsgText: string | null = null;
    let purchaseMsgButtons: string | null = null;
    try {
      const rowsCfg = await prisma.systemSetting.findMany({
        where: { key: { in: ["purchase_message_enabled", "purchase_message_text", "purchase_message_buttons"] } },
        select: { key: true, value: true },
      });
      for (const r of rowsCfg) {
        if (r.key === "purchase_message_enabled") purchaseMsgEnabled = r.value !== "0";
        else if (r.key === "purchase_message_text") purchaseMsgText = r.value;
        else if (r.key === "purchase_message_buttons") purchaseMsgButtons = r.value;
      }
    } catch { /* настройки недоступны → дефолтное поведение */ }
    // подсказка «если инструкция не открылась»
    // (платная/админская подписка). Текст из настроек (Тексты бота) или дефолт.
    const instrFallback = ((cfg as { botInstructionFallbackText?: string | null }).botInstructionFallbackText ?? "").trim()
      || "💡 Если инструкции не открываются: скопируйте ссылку подписки и вставьте её в приложение Happ вручную или обратитесь в поддержку.";
    const linkBlock = subscriptionUrl
      ? `\n\n🔗 Ссылка подписки:\n${subscriptionUrl}\n\nДля подключения нажмите кнопку «📲 Инструкции по установке»:\n\n${instrFallback}`
      : "";
    // два заголовка в зависимости от источника подписки.
    const headline = isAdminGrant
      ? `✅ Администратор выдал Вам подписку Тариф «<b>${escapeHtml(tariffName)}</b>»`
      : `✅ <b>Тариф «${escapeHtml(tariffName)}»</b> оплачен и активирован`;
    // если админ оставил комментарий — показываем клиенту.
    const noteBlock = (isAdminGrant && adminNote)
      ? `\n\n💬 <i>${escapeHtml(adminNote)}</i>`
      : "";
    const textClient = `${headline}.${noteBlock}${linkBlock}`;
    const hasLocations = !!(payment?.tariff?.locations?.trim());
    type Row = ({ text: string; callback_data: string } | { text: string; url: string })[];

    // Отключение отправки (только для обычной покупки; админская выдача всегда уведомляет).
    if (!purchaseMsgEnabled && !isAdminGrant) {
      // Клиенту ничего не шлём — переходим к админ-уведомлению ниже.
    } else {
      // Текст: кастомный из настроек (с плейсхолдерами) или дефолтный.
      let finalText = textClient;
      if (purchaseMsgText && purchaseMsgText.trim()) {
        finalText = purchaseMsgText
          .split("{{TARIFF}}").join(escapeHtml(tariffName))
          .split("{{SUBSCRIPTION_URL}}").join(subscriptionUrl ?? "");
      }
      // Кнопки: кастомный конструктор из настроек, иначе дефолтный набор.
      let rows: Row[] = [];
      let usedCustomButtons = false;
      if (purchaseMsgButtons != null) {
        try {
          const parsed = JSON.parse(purchaseMsgButtons) as Array<{ text?: string; action?: string }>;
          if (Array.isArray(parsed)) {
            const base = (cfg.publicAppUrl || "").replace(/\/+$/, "");
            for (const b of parsed) {
              const text = (b?.text ?? "").trim();
              let action = (b?.action ?? "").trim();
              if (!text || !action) continue;
              if (action.includes("{{SUBSCRIPTION_URL}}")) {
                if (!subscriptionUrl) continue;
                action = action.split("{{SUBSCRIPTION_URL}}").join(subscriptionUrl);
              }
              if (action.startsWith("menu:")) rows.push([{ text, callback_data: action }]);
              else if (action.startsWith("webapp:")) rows.push([{ text, url: `${base}${action.slice("webapp:".length)}` }]);
              else rows.push([{ text, url: action }]);
            }
            usedCustomButtons = true;
          }
        } catch { /* битый JSON → дефолтные кнопки */ }
      }
      if (!usedCustomButtons) {
        if (subscriptionUrl) rows.push([{ text: "📲 Инструкции по установке", url: subscriptionUrl }]);
        if (hasLocations && payment?.tariffId) {
          rows.push([{ text: "🌐 Локации", callback_data: `menu:locations:${payment.tariffId}` }]);
        }
        rows.push([{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]);
        rows.push([{ text: cfg.botBackLabel ?? "🏠 Главное меню", callback_data: "menu:main" }]);
      }
      await sendTelegramToUser(client.telegramId, finalText, null, rows.length > 0 ? { inline_keyboard: rows } : undefined, {
        clientIdForBotToken: clientId,
      });
    }
  }
  const clientLabel = formatClientLabel(client);
  const lines = [
    `📦 <b>Оплата тарифа</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`📋 Тариф: <b>${escapeHtml(tariffName)}</b>`);
  // Срок берём из выбранной опции длительности (если есть), иначе fallback на базовый срок тарифа.
  const durationDays = payment?.tariffPriceOption?.durationDays ?? payment?.tariff?.durationDays;
  if (durationDays) lines.push(`📅 Срок: ${durationDays} дн.`);
  if (payment?.amount != null) lines.push(`💵 Сумма: <b>${formatMoney(payment.amount, payment.currency ?? "RUB")}</b>`);
  if (payment?.provider) lines.push(`🏦 Провайдер: ${escapeHtml(payment.provider)}`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("tariff_payment", lines.join("\n"));
}

/**
 * алерт админам: платёж прошёл, а активация тарифа УПАЛА.
 * Раньше в этом случае админ-группа получала обычное «📦 Оплата тарифа», клиент —
 * «активирован», и проблема всплывала только когда клиент приходил в саппорт.
 */
export async function notifyTariffActivationFailed(clientId: string, paymentId: string, error: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, email: true, telegramUsername: true, id: true },
  });
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { amount: true, currency: true, provider: true, tariff: { select: { name: true } } },
  });
  const lines = [
    `🚨 <b>Оплата прошла, но активация тарифа УПАЛА</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(client ? formatClientLabel(client) : clientId)}`,
  ];
  if (client?.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  if (payment?.tariff?.name) lines.push(`📋 Тариф: <b>${escapeHtml(payment.tariff.name)}</b>`);
  if (payment?.amount != null) lines.push(`💵 Сумма: <b>${formatMoney(payment.amount, payment.currency ?? "RUB")}</b>`);
  if (payment?.provider) lines.push(`🏦 Провайдер: ${escapeHtml(payment.provider)}`);
  lines.push(`❌ Ошибка: <code>${escapeHtml(error.slice(0, 300))}</code>`);
  lines.push(`🧾 Payment: <code>${escapeHtml(paymentId)}</code>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("tariff_payment", lines.join("\n"));
}

/**
 * уведомление клиенту об успешной активации
 * extra-option (доп. устройства / трафик / серверы), после оплаты картой / криптой / etc.
 */
export async function notifyExtraOptionApplied(clientId: string, paymentId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true },
  });
  if (!client?.telegramId) return;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { amount: true, currency: true, metadata: true, provider: true },
  });
  if (!payment) return;
  // Парсим extraOption.kind из metadata.
  let kind: "traffic" | "devices" | "servers" | null = null;
  try {
    const meta = payment.metadata ? JSON.parse(payment.metadata) as { extraOption?: { kind?: string } } : null;
    const k = meta?.extraOption?.kind;
    if (k === "traffic" || k === "devices" || k === "servers") kind = k;
  } catch { /* ignore */ }

  // Текст по типу опции. verb согласован с родом title-а.
  let title: string;
  let verb: string;
  if (kind === "traffic") { title = "Дополнительный трафик"; verb = "добавлен"; }
  else if (kind === "devices") { title = "Дополнительное устройство"; verb = "добавлено"; }
  else if (kind === "servers") { title = "Дополнительный сервер"; verb = "добавлен"; }
  else { title = "Дополнительная опция"; verb = "добавлена"; }

  const amount = payment.amount ?? 0;
  const currency = (payment.currency ?? "RUB").toUpperCase();
  const lines = [
    `✅ <b>${escapeHtml(title)}</b> успешно ${verb} к вашей подписке.`,
  ];
  if (amount > 0) lines.push(`💵 Списано: <b>${formatMoney(amount, currency)}</b>`);
  lines.push("", "Изменения вступили в силу мгновенно — можете пользоваться.");

  const cfg = await getSystemConfig();
  const botToken = cfg.telegramBotToken?.trim();
  if (!botToken) return;
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }],
      [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
    ],
  };
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: client.telegramId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }),
  }).catch((e) => console.error("[notifyExtraOptionApplied] send failed:", e));
}

/** Человекочитаемый маркер «к сообщению приложены фото». */
function attachmentsBadge(count?: number): string {
  if (!count || count <= 0) return "";
  return count === 1 ? " 📷" : ` 📷 ×${count}`;
}

export async function notifyAdminsAboutNewTicket(params: {
  ticketId: string;
  clientId: string;
  subject: string;
  firstMessage: string;
  attachmentsCount?: number;
}): Promise<void> {
  const [client, ticket] = await Promise.all([
    prisma.client.findUnique({
      where: { id: params.clientId },
      select: { email: true, telegramId: true, telegramUsername: true, id: true },
    }),
    prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: { id: true, subject: true, status: true },
    }),
  ]);
  if (!ticket) return;
  const config = await getSystemConfig();
  const clientLabel = formatClientLabel(client ?? { id: params.clientId });
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const attachmentsHint = attachmentsBadge(params.attachmentsCount);
  const previewBody = params.firstMessage || (attachmentsHint ? "(только фото)" : "");
  const preview =
    previewBody.length > 200 ? `${previewBody.slice(0, 197)}...` : previewBody;
  const lines = [
    `🆕 <b>Новый тикет</b>${attachmentsHint}`,
    ``,
    `📋 Тема: <b>${escapeHtml(ticket.subject)}</b>`,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
  ];
  if (client?.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(``, `💬 ${escapeHtml(preview)}`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/tickets`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("new_ticket", lines.join("\n"));
}

export async function notifyAdminsAboutClientTicketMessage(params: {
  ticketId: string;
  clientId: string;
  content: string;
  attachmentsCount?: number;
}): Promise<void> {
  const [client, ticket] = await Promise.all([
    prisma.client.findUnique({
      where: { id: params.clientId },
      select: { email: true, telegramId: true, telegramUsername: true, id: true },
    }),
    prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: { id: true, subject: true, status: true },
    }),
  ]);
  if (!ticket) return;
  const config = await getSystemConfig();
  const clientLabel = formatClientLabel(client ?? { id: params.clientId });
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const attachmentsHint = attachmentsBadge(params.attachmentsCount);
  const previewBody = params.content || (attachmentsHint ? "(только фото)" : "");
  const preview =
    previewBody.length > 200 ? `${previewBody.slice(0, 197)}...` : previewBody;
  const lines = [
    `💬 <b>Новое сообщение в тикете</b>${attachmentsHint}`,
    ``,
    `📋 Тема: <b>${escapeHtml(ticket.subject)}</b>`,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
    ``,
    `${escapeHtml(preview)}`,
    `🕐 ${formatDate(new Date())}`,
  ];
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/tickets`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("new_ticket", lines.join("\n"));
}

export async function notifyAdminsAboutSupportReply(params: {
  ticketId: string;
  clientId: string;
  content: string;
  attachmentsCount?: number;
}): Promise<void> {
  const [client, ticket] = await Promise.all([
    prisma.client.findUnique({
      where: { id: params.clientId },
      select: { email: true, telegramId: true, telegramUsername: true, id: true },
    }),
    prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: { id: true, subject: true, status: true },
    }),
  ]);
  if (!ticket) return;
  const config = await getSystemConfig();
  const clientLabel = formatClientLabel(client ?? { id: params.clientId });
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const attachmentsHint = attachmentsBadge(params.attachmentsCount);
  const previewBody = params.content || (attachmentsHint ? "(только фото)" : "");
  const preview =
    previewBody.length > 200 ? `${previewBody.slice(0, 197)}...` : previewBody;
  const lines = [
    `✅ <b>Ответ поддержки в тикете</b>${attachmentsHint}`,
    ``,
    `📋 Тема: <b>${escapeHtml(ticket.subject)}</b>`,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
    ``,
    `${escapeHtml(preview)}`,
    `🕐 ${formatDate(new Date())}`,
  ];
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/tickets`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("new_ticket", lines.join("\n"));
}

export async function notifyAdminsAboutTicketStatusChange(params: {
  ticketId: string;
  clientId: string;
  subject: string;
  status: string;
}): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: params.clientId },
    select: { email: true, telegramId: true, telegramUsername: true, id: true },
  });
  const config = await getSystemConfig();
  const clientLabel = formatClientLabel(client ?? { id: params.clientId });
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const statusLabel = params.status === "closed" ? "🔴 Закрыт" : "🟢 Открыт";
  const lines = [
    `ℹ️ <b>Статус тикета изменён</b>`,
    ``,
    `📋 Тема: <b>${escapeHtml(params.subject)}</b>`,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
    `📌 Статус: <b>${statusLabel}</b>`,
    `🕐 ${formatDate(new Date())}`,
  ];
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/tickets`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("new_ticket", lines.join("\n"));
}

export async function notifyAdminsAboutNewClient(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, createdAt: true },
  });
  if (!client) return;
  const config = await getSystemConfig();
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const clientLabel = formatClientLabel(client);
  const totalClients = await prisma.client.count().catch(() => null);
  const lines = [
    `👤 <b>Новый клиент</b>`,
    ``,
    `📝 ${escapeHtml(clientLabel)}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  if (client.telegramUsername) lines.push(`📱 Username: @${escapeHtml(client.telegramUsername)}`);
  if (client.email) lines.push(`📧 Email: ${escapeHtml(client.email)}`);
  if (totalClients != null) lines.push(`📊 Всего клиентов: <b>${totalClients}</b>`);
  lines.push(`🕐 ${formatDate(client.createdAt)}`);
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/clients`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("new_client", lines.join("\n"));
}

/**
 * уведомление админам о новой заявке на вывод реф. баланса.
 */
export async function notifyAdminsAboutWithdrawal(withdrawalId: string): Promise<void> {
  const wr = await prisma.withdrawalRequest.findUnique({
    where: { id: withdrawalId },
    include: { client: { select: { id: true, telegramId: true, telegramUsername: true, email: true } } },
  });
  if (!wr) return;
  const config = await getSystemConfig();
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const clientLabel = formatClientLabel(wr.client);
  const lines = [
    `💰 <b>Заявка на вывод (USDT TRC20)</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
  ];
  if (wr.client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(wr.client.telegramId)}</code>`);
  lines.push(`💸 Сумма: <b>${wr.amount.toFixed(2)} ₽</b>`);
  lines.push(`🏦 Кошелёк TRC20: <code>${escapeHtml(wr.walletTrc20)}</code>`);
  lines.push(`🕐 ${formatDate(wr.createdAt)}`);
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/withdrawals`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("withdrawal_request", lines.join("\n"));
}

/**
 * уведомление админам: клиент активировал пробный период.
 */
export async function notifyAdminsAboutTrialActivated(clientId: string, trialName: string, durationDays: number): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) return;
  const lines = [
    `🎁 <b>Активирован пробный период</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(formatClientLabel(client))}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`📋 Триал: <b>${escapeHtml(trialName)}</b>`);
  lines.push(`📅 Срок: ${durationDays} дн.`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("trial_activated", lines.join("\n"));
}

/**
 * уведомление админам: покупка конвертировала существующую подписку
 * (режим «одна подписка из категории» — смена тарифа с pro-rata конвертацией остатка).
 */
export async function notifyAdminsAboutSubscriptionConverted(
  clientId: string,
  oldTariffName: string | null,
  newTariffName: string,
  convertedDays?: number | null,
): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) return;
  const lines = [
    `🔄 <b>Конвертация подписки</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(formatClientLabel(client))}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`📋 Тариф: <b>${escapeHtml(oldTariffName?.trim() || "—")}</b> → <b>${escapeHtml(newTariffName)}</b>`);
  if (convertedDays != null && convertedDays > 0) lines.push(`📅 Конвертировано дней: <b>+${convertedDays}</b>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("subscription_converted", lines.join("\n"));
}

/**
 * уведомление админам: активирован промокод FREE_DAYS.
 */
export async function notifyAdminsAboutPromoActivated(clientId: string, code: string, durationDays: number): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) return;
  const lines = [
    `🏷 <b>Активирован промокод</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(formatClientLabel(client))}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`🎟 Код: <code>${escapeHtml(code)}</code>`);
  lines.push(`📅 Дней: <b>${durationDays}</b>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("promo_activated", lines.join("\n"));
}

/**
 * уведомление админам: подарочный код активирован получателем.
 */
export async function notifyAdminsAboutGiftRedeemed(
  creatorClientId: string,
  recipientClientId: string,
  tariffName: string | null,
): Promise<void> {
  const [creator, recipient] = await Promise.all([
    prisma.client.findUnique({
      where: { id: creatorClientId },
      select: { id: true, email: true, telegramId: true, telegramUsername: true },
    }),
    prisma.client.findUnique({
      where: { id: recipientClientId },
      select: { id: true, email: true, telegramId: true, telegramUsername: true },
    }),
  ]);
  const lines = [
    `🎁 <b>Подарок активирован</b>`,
    ``,
    `👤 Даритель: ${escapeHtml(creator ? formatClientLabel(creator) : creatorClientId)} → Получатель: ${escapeHtml(recipient ? formatClientLabel(recipient) : recipientClientId)}`,
  ];
  if (recipient?.telegramId) lines.push(`🆔 TG ID получателя: <code>${escapeHtml(recipient.telegramId)}</code>`);
  if (tariffName?.trim()) lines.push(`📋 Тариф: <b>${escapeHtml(tariffName.trim())}</b>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("gift_redeemed", lines.join("\n"));
}

/**
 * уведомление админам: автосписание провалилось (компенсация отработала, тариф не продлён).
 */
export async function notifyAdminsAboutAutoRenewFailed(clientId: string, tariffName: string, error: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  const lines = [
    `🚨 <b>Автосписание провалилось</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(client ? formatClientLabel(client) : clientId)}`,
  ];
  if (client?.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`📋 Тариф: <b>${escapeHtml(tariffName)}</b>`);
  lines.push(`❌ Ошибка: <code>${escapeHtml(error.slice(0, 300))}</code>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("auto_renew_failed", lines.join("\n"));
}

/**
 * уведомление клиенту что вывод средств выполнен.
 */
export async function notifyClientAboutWithdrawalApproved(withdrawalId: string): Promise<void> {
  const wr = await prisma.withdrawalRequest.findUnique({
    where: { id: withdrawalId },
    include: { client: { select: { id: true, telegramId: true } } },
  });
  if (!wr || !wr.client.telegramId) return;
  const text = [
    `✅ Заявка на вывод средств успешно исполнена.`,
    ``,
    `В течение 48 часов средства поступят на указанный Вами кошелёк.`,
    ``,
    `Благодарим за сотрудничество 🤝`,
  ].join("\n");
  // добавили кнопку «🏠 Главное меню» — чтобы клиент мог
  // одним кликом вернуться в бот после получения уведомления о выплате.
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
    ],
  };
  // Используем функцию sendTelegramMessage если есть, иначе через прямой fetch к Telegram API.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import("../bot/bot.service.js") as any;
    const sendFn = mod.sendTelegramMessage ?? mod.sendMessage;
    if (typeof sendFn === "function") {
      // Передаём reply_markup опциональным 3-м параметром — если функция не поддерживает,
      // он будет проигнорирован (но мы дублируем в fallback).
      await sendFn(wr.client.telegramId, text, { reply_markup: replyMarkup });
      return;
    }
  } catch {
    // ignore
  }
  // Фолбэк через Bot API напрямую.
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) return;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: wr.client.telegramId, text, reply_markup: replyMarkup }),
  }).catch(() => {});
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatClientLabel(client: { email?: string | null; telegramUsername?: string | null; id?: string }): string {
  if (client.telegramUsername) return `@${client.telegramUsername}`;
  if (client.email?.trim()) return client.email.trim();
  return client.id ?? "unknown";
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

/**
 * Отправить уведомление о создании прокси-слотов (после оплаты).
 */
export async function notifyProxySlotsCreated(clientId: string, slotIds: string[], tariffName?: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId || slotIds.length === 0) return;

  const slots = await prisma.proxySlot.findMany({
    where: { id: { in: slotIds } },
    select: { node: { select: { publicHost: true, socksPort: true, httpPort: true } }, login: true, password: true },
    orderBy: { createdAt: "asc" },
  });

  const name = tariffName?.trim() || "Прокси";
  let text = `✅ <b>Прокси «${escapeHtml(name)}»</b> оплачены.\n\n`;
  for (const s of slots) {
    const host = s.node.publicHost ?? "host";
    text += `• SOCKS5: <code>socks5://${escapeHtml(s.login)}:${escapeHtml(s.password)}@${escapeHtml(host)}:${s.node.socksPort}</code>\n`;
    text += `• HTTP: <code>http://${escapeHtml(s.login)}:${escapeHtml(s.password)}@${escapeHtml(host)}:${s.node.httpPort}</code>\n\n`;
  }
  text += "Скопируйте строку в настройки прокси вашего приложения.";

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Отправить уведомление о создании Sing-box слотов (после оплаты).
 */
export async function notifySingboxSlotsCreated(clientId: string, slotIds: string[], tariffName?: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId || slotIds.length === 0) return;

  const slots = await prisma.singboxSlot.findMany({
    where: { id: { in: slotIds } },
    select: {
      userIdentifier: true,
      secret: true,
      node: { select: { publicHost: true, port: true, protocol: true, tlsEnabled: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const { buildSingboxSlotSubscriptionLink } = await import("../singbox/singbox-link.js");
  const name = tariffName?.trim() || "Sing-box";
  let text = `✅ <b>Доступы «${escapeHtml(name)}»</b> оплачены.\n\n`;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    const link = buildSingboxSlotSubscriptionLink(
      { publicHost: s.node.publicHost ?? "", port: s.node.port ?? 443, protocol: s.node.protocol ?? "VLESS", tlsEnabled: s.node.tlsEnabled },
      { userIdentifier: s.userIdentifier, secret: s.secret },
      `${name}-${i + 1}`
    );
    text += `• <code>${escapeHtml(link)}</code>\n\n`;
  }
  text += "Скопируйте ссылку в приложение (v2rayN, Nekoray, Shadowrocket и др.).";

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

export async function notifyAutoRenewSuccess(clientId: string, tariffName: string, amount: number, currency: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId) return;
  const text = `🔄 <b>Автопродление успешно</b>\n\nТариф «${escapeHtml(tariffName)}» был автоматически продлен. Списано: ${formatMoney(amount, currency)}.`;
  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

export async function notifyAutoRenewFailed(clientId: string, tariffName: string, reason: "balance" | "error"): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId) return;
  let text = `❌ <b>Автопродление отключено</b>\n\nНе удалось автоматически продлить тариф «${escapeHtml(tariffName)}».\n`;
  if (reason === "balance") {
    text += "\nПричина: недостаточно средств на балансе. Все попытки исчерпаны.\n\n";
    text += "💡 <i>Пополните баланс и включите автопродление снова в кабинете или боте.</i>";
  } else {
    text += "\nПричина: системная ошибка. Все попытки исчерпаны.\n\n";
    text += "💡 <i>Обратитесь в поддержку или попробуйте продлить тариф вручную.</i>";
  }
  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Уведомление об успешном автоплатеже через ЮKassa.
 */
export async function notifyAutoRenewYookassaSuccess(
  clientId: string,
  tariffName: string,
  amount: number,
  currency: string,
  paymentMethodTitle?: string,
  balancePortion?: number,
  cardPortion?: number,
): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId) return;

  let text =
    `🔄 <b>Автопродление успешно (ЮKassa)</b>\n\n` +
    `Тариф «${escapeHtml(tariffName)}» был автоматически продлен.\n`;

  if (balancePortion && balancePortion > 0 && cardPortion) {
    text += `Списано с баланса: ${formatMoney(balancePortion, currency)}\n`;
    text += `Списано с карты: ${formatMoney(cardPortion, currency)}`;
  } else {
    text += `Списано с карты: ${formatMoney(amount, currency)}`;
  }

  if (paymentMethodTitle) {
    text += ` (${escapeHtml(paymentMethodTitle)})`;
  }
  text += `.`;

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Уведомление о неудачном автоплатеже через ЮKassa.
 */
export async function notifyAutoRenewYookassaFailed(
  clientId: string,
  tariffName: string,
  error: string,
): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId) return;

  const text =
    `❌ <b>Автоплатёж ЮKassa не прошёл</b>\n\n` +
    `Не удалось списать оплату за тариф «${escapeHtml(tariffName)}».\n` +
    `Причина: ${escapeHtml(error)}\n\n` +
    `💡 <i>Попробуйте пополнить баланс или оплатить тариф вручную.</i>`;

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Уведомление о приближающемся списании (low balance warning).
 * Отправляется за N дней до истечения, если баланс меньше стоимости тарифа.
 */
export async function notifyAutoRenewUpcoming(
  clientId: string,
  tariffName: string,
  price: number,
  currency: string,
  daysLeft: number,
): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, balance: true, id: true },
  });
  if (!client?.telegramId) return;

  const deficit = price - (client.balance ?? 0);
  const text =
    `⏳ <b>Скоро автопродление</b>\n\n` +
    `Тариф «${escapeHtml(tariffName)}» истекает через <b>${daysLeft} дн.</b>\n` +
    `Стоимость продления: ${formatMoney(price, currency)}\n` +
    `Ваш баланс: ${formatMoney(client.balance ?? 0, currency)}\n\n` +
    `⚠️ Не хватает <b>${formatMoney(Math.max(0, deficit), currency)}</b> для автопродления.\n` +
    `💡 <i>Пополните баланс, чтобы подписка продлилась автоматически.</i>`;

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Уведомление о повторной попытке списания (retry attempt).
 */
export async function notifyAutoRenewRetry(
  clientId: string,
  tariffName: string,
  price: number,
  currency: string,
  currentRetry: number,
  maxRetries: number,
): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, balance: true, id: true },
  });
  if (!client?.telegramId) return;

  const retriesLeft = maxRetries - currentRetry;
  const text =
    `🔄 <b>Не удалось продлить подписку</b>\n\n` +
    `Тариф «${escapeHtml(tariffName)}»: недостаточно средств.\n` +
    `Нужно: ${formatMoney(price, currency)} | Баланс: ${formatMoney(client.balance ?? 0, currency)}\n\n` +
    `Попытка ${currentRetry} из ${maxRetries}` +
    (retriesLeft > 0 ? `. Осталось попыток: <b>${retriesLeft}</b>.` : `. Это была последняя попытка.`) +
    `\n\n💡 <i>Пополните баланс, чтобы автопродление сработало при следующей проверке.</i>`;

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}
