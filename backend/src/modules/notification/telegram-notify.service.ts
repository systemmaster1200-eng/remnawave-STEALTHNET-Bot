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

type AdminNotificationEventType = "balance_topup" | "tariff_payment" | "new_client" | "new_ticket";

type AdminNotificationPreferenceRow = {
  telegramId: string;
  notifyBalanceTopup: boolean;
  notifyTariffPayment: boolean;
  notifyNewClient: boolean;
  notifyNewTicket: boolean;
};

/** Токен активного бота-клона клиента; иначе undefined → используется основной токен из настроек. */
async function getBotApiTokenForClient(clientId: string): Promise<string | undefined> {
  const row = await prisma.client.findUnique({
    where: { id: clientId },
    select: { bot: { select: { token: true, isActive: true } } },
  });
  const t = row?.bot?.isActive ? row.bot.token?.trim() : undefined;
  return t && t.length > 0 ? t : undefined;
}

export type TelegramUserSendOptions = { clientIdForBotToken?: string };

export async function sendTelegramToUser(
  telegramId: string,
  text: string,
  messageThreadId?: number | null,
  replyMarkup?: Record<string, unknown>,
  opts?: TelegramUserSendOptions,
): Promise<void> {
  let token: string | undefined;
  if (opts?.clientIdForBotToken) {
    token = await getBotApiTokenForClient(opts.clientIdForBotToken);
  }
  if (!token) {
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
  }
  if (!raw?.trim()) return null;
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function sendTelegramToAdminsForEvent(eventType: AdminNotificationEventType, text: string): Promise<void> {
  const config = await getSystemConfig();
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
      tariff: { select: { name: true, durationDays: true, price: true } },
      tariffPriceOption: { select: { durationDays: true } },
    },
  });
  const tariffName = payment?.tariff?.name?.trim() || "Тариф";
  if (client.telegramId) {
    const textClient = `✅ <b>Тариф «${escapeHtml(tariffName)}»</b> оплачен и активирован.\n\nМожете подключаться к VPN.`;
    const cfg = await getSystemConfig();
    await sendTelegramToUser(client.telegramId, textClient, null, backToMenuMarkup(cfg.botBackLabel), {
      clientIdForBotToken: clientId,
    });
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
