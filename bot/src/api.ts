/**
 * STEALTHNET 3.0 — API клиент бота (вызовы бэкенда).
 */

const API_URL = (process.env.API_URL || "").replace(/\/$/, "");
if (!API_URL) {
  console.warn("API_URL not set in .env — bot API calls will fail");
}

function getHeaders(token?: string): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function fetchJson<T>(path: string, opts?: { method?: string; body?: unknown; token?: string }): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts?.method ?? "GET",
    headers: getHeaders(opts?.token),
    ...(opts?.body !== undefined && { body: JSON.stringify(opts.body) }),
  });
  const data = (await res.json().catch(() => ({}))) as T | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/** Привязка Telegram к аккаунту по коду (вызывается ботом при /link КОД) */
export async function linkTelegramFromBot(code: string, telegramId: number, telegramUsername?: string): Promise<{ message: string }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}/api/public/link-telegram-from-bot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Token": botToken,
    },
    body: JSON.stringify({ code: code.trim(), telegramId, telegramUsername: telegramUsername ?? "" }),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) {
    const msg = typeof data.message === "string" ? data.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { message: string };
}

/** Подтверждение deep-link авторизации (бот → API) */
export async function confirmTelegramAuth(token: string, telegramId: number, telegramUsername?: string): Promise<{ ok: boolean }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}/api/client/auth/telegram-login-confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Token": botToken,
    },
    body: JSON.stringify({ token: token.trim(), telegramId, telegramUsername: telegramUsername ?? "" }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok) {
    const msg = typeof data.message === "string" ? data.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { ok: boolean };
}

/** Активный конкурс (для меню и ежедневной рассылки) */
export async function getActiveContest(): Promise<{
  active: boolean;
  contest: null | {
    id: string;
    name: string;
    startAt: string;
    endAt: string;
    dailyMessage: string | null;
    prize1Type: string;
    prize1Value: string;
    prize2Type: string;
    prize2Value: string;
    prize3Type: string;
    prize3Value: string;
    conditionsJson: string | null;
    drawType: string;
  };
}> {
  return fetchJson("/api/public/contests/active");
}

/** Публичный конфиг (тарифы, кнопки, способы оплаты, trial и т.д.) */
export async function getPublicConfig(): Promise<{
  serviceName?: string | null;
  logo?: string | null;
  logoBot?: string | null;
  /** Telegram ID пользователей, которым показывается кнопка «Панель админа» в боте */
  botAdminTelegramIds?: string[] | null;
  publicAppUrl?: string | null;
  defaultCurrency?: string;
  trialEnabled?: boolean;
  trialDays?: number;
  plategaMethods?: { id: number; label: string }[];
  yoomoneyEnabled?: boolean;
  yookassaEnabled?: boolean;
  cryptopayEnabled?: boolean;
  heleketEnabled?: boolean;
  lavaEnabled?: boolean;
  lavatopEnabled?: boolean;
  botWelcomeEnabled?: boolean;
  botWelcomeText?: string | null;
  botWelcomeImage?: string | null;
  botWelcomeShowOnce?: boolean;
  botButtons?: { id: string; visible: boolean; label: string; order: number; style?: string; iconCustomEmojiId?: string; onePerRow?: boolean; emojiKey?: string }[] | null;
  /** Кнопок в ряд в главном меню: 1 или 2 */
  botButtonsPerRow?: 1 | 2;
  /** Тексты меню с уже подставленными эмодзи ({{BALANCE}} → unicode из bot_emojis) */
  resolvedBotMenuTexts?: Record<string, string>;
  /** Для каких ключей текста меню в начале стоит премиум-эмодзи: key → custom_emoji_id (для entities) */
  menuTextCustomEmojiIds?: Record<string, string>;
  /** Эмодзи по ключам: unicode и tgEmojiId (премиум) — для кнопок и подстановки в текст */
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }>;
  botBackLabel?: string | null;
  botMenuTexts?: Record<string, string> | null;
  botMenuLineVisibility?: Record<string, boolean> | null;
  botInnerButtonStyles?: Record<string, string> | null;
  botTariffsText?: string | null;
  botTariffsFields?: Record<string, boolean> | null;
  botPaymentText?: string | null;
  activeLanguages?: string[];
  activeCurrencies?: string[];
  defaultReferralPercent?: number;
  referralPercentLevel2?: number;
  referralPercentLevel3?: number;
  supportLink?: string | null;
  agreementLink?: string | null;
  offerLink?: string | null;
  instructionsLink?: string | null;
  videoInstructionsEnabled?: boolean;
  videoInstructions?: { id: string; title: string; telegramFileId: string; sortOrder: number }[];
  ticketsEnabled?: boolean;
  forceSubscribeEnabled?: boolean;
  forceSubscribeChannelId?: string | null;
  forceSubscribeMessage?: string | null;
  sellOptionsEnabled?: boolean;
  sellOptions?: Array<
    | { kind: "traffic"; id: string; name: string; trafficGb: number; price: number; currency: string }
    | { kind: "devices"; id: string; name: string; deviceCount: number; price: number; currency: string }
    | { kind: "servers"; id: string; name: string; squadUuid: string; trafficGb?: number; price: number; currency: string }
  >;
  useRemnaSubscriptionPage?: boolean;
  proxyEnabled?: boolean;
  proxyUrl?: string | null;
  proxyTelegram?: boolean;
  proxyPayments?: boolean;
  /** Авто-удаление нераспознанных сообщений (стикеры, случайный текст и т.п.) */
  botAutoDeleteUnknownMessages?: boolean;
  /** Кастомный информационный блок (главное меню бота + кабинет). Пустая строка = скрыто. */
  botInfoBlock?: string | null;
  giftSubscriptionsEnabled?: boolean;
  defaultLanguage?: string;
  translations?: Record<string, Record<string, unknown>>;
} | null> {
  return fetchJson("/api/public/config");
}

/** Регистрация / вход по Telegram */
export async function registerByTelegram(body: {
  telegramId: string;
  telegramUsername?: string;
  preferredLang?: string;
  preferredCurrency?: string;
  referralCode?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}): Promise<{ token: string; client: { id: string; telegramUsername?: string | null; preferredLang?: string; preferredCurrency: string; balance: number; trialUsed?: boolean; referralCode?: string | null; onboardingCompleted?: boolean } }> {
  return fetchJson("/api/client/auth/register", { method: "POST", body });
}

/** Вход по коду 2FA (после register/login, когда бэкенд вернул requires2FA) */
export async function client2FALogin(
  tempToken: string,
  code: string
): Promise<{ token: string; client: { id: string; balance: number; preferredCurrency: string; trialUsed?: boolean; telegramUsername?: string | null } }> {
  return fetchJson("/api/client/auth/2fa-login", {
    method: "POST",
    body: { tempToken, code },
  });
}

/** Текущий пользователь */
export async function getMe(token: string): Promise<{
  id: string;
  telegramUsername?: string | null;
  preferredLang: string;
  preferredCurrency: string;
  balance: number;
  referralCode?: string | null;
  referralPercent?: number | null;
  trialUsed?: boolean;
  autoRenewEnabled?: boolean;
}> {
  return fetchJson("/api/client/auth/me", { token });
}

/** Подписка Remna (для ссылки VPN, статус, трафик) + отображаемое имя тарифа с сайта */
export async function getSubscription(token: string): Promise<{ subscription: unknown; tariffDisplayName?: string | null; message?: string }> {
  return fetchJson("/api/client/subscription", { token });
}

/** Подписка по конкретному UUID (для secondary/gift подписок) */
export async function getSubscriptionByUuid(
  token: string,
  uuid: string
): Promise<{ subscription: unknown; tariffDisplayName?: string | null; message?: string }> {
  return fetchJson("/api/client/subscription/by-uuid/" + encodeURIComponent(uuid), { token });
}

/** Список устройств (HWID) пользователя в Remna */
export async function getClientDevices(token: string): Promise<{ total: number; devices: { hwid: string; platform?: string; deviceModel?: string; createdAt?: string }[] }> {
  return fetchJson("/api/client/devices", { token });
}

/** Удалить устройство по HWID */
export async function postClientDeviceDelete(token: string, hwid: string): Promise<{ ok: boolean; message?: string }> {
  return fetchJson("/api/client/devices/delete", { method: "POST", body: { hwid }, token });
}

/** Публичный список тарифов прокси по категориям */
export async function getPublicProxyTariffs(): Promise<{
  items: { id: string; name: string; tariffs: { id: string; name: string; proxyCount: number; durationDays: number; price: number; currency: string }[] }[];
}> {
  return fetchJson("/api/public/proxy-tariffs");
}

/** Активные прокси-слоты клиента */
export async function getProxySlots(token: string): Promise<{
  slots: { id: string; login: string; password: string; host: string; socksPort: number; httpPort: number; expiresAt: string }[];
}> {
  return fetchJson("/api/client/proxy-slots", { token });
}

/** Публичный список тарифов Sing-box по категориям */
export async function getPublicSingboxTariffs(): Promise<{
  items: { id: string; name: string; tariffs: { id: string; name: string; slotCount: number; durationDays: number; price: number; currency: string }[] }[];
}> {
  return fetchJson("/api/public/singbox-tariffs");
}

/** Активные Sing-box слоты клиента (с subscriptionLink) */
export async function getSingboxSlots(token: string): Promise<{
  slots: { id: string; subscriptionLink: string; expiresAt: string; protocol: string }[];
}> {
  return fetchJson("/api/client/singbox-slots", { token });
}

/** Публичный список тарифов по категориям (emoji из админки по коду ordinary/premium) */
export async function getPublicTariffs(): Promise<{
  items: {
    id: string;
    name: string;
    emojiKey: string | null;
    emoji: string;
    tariffs: {
      id: string;
      name: string;
      description?: string | null;
      durationDays: number;
      trafficLimitBytes?: number | null;
      trafficResetMode?: string;
      deviceLimit?: number | null;
      price: number;
      currency: string;
      priceOptions: { id: string; durationDays: number; price: number; sortOrder: number }[];
    }[];
  }[];
}> {
  return fetchJson("/api/public/tariffs");
}

/** Создать платёж Platega (возвращает paymentUrl). Для опции — extraOption. Для прокси — proxyTariffId. */
export async function createPlategaPayment(
  token: string,
  body: {
    amount?: number;
    currency?: string;
    paymentMethod: number;
    description?: string;
    tariffId?: string;
    tariffPriceOptionId?: string;
    deviceCount?: number;
    proxyTariffId?: string;
    singboxTariffId?: string;
    promoCode?: string;
    extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
  }
): Promise<{ paymentUrl: string; orderId: string; paymentId: string }> {
  return fetchJson("/api/client/payments/platega", { method: "POST", body, token });
}

/** Создать платёж ЮMoney (оплата картой). Для тарифа — tariffId, для прокси — proxyTariffId, для опции — extraOption. */
export async function createYoomoneyPayment(
  token: string,
  body: { amount?: number; paymentType: "PC" | "AC"; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string } }
): Promise<{ paymentId: string; paymentUrl: string }> {
  return fetchJson("/api/client/yoomoney/create-form-payment", { method: "POST", body, token });
}

/** Создать платёж ЮKassa (карта, СБП). Только RUB. Для тарифа — tariffId, для прокси — proxyTariffId, для опции — extraOption. */
export async function createYookassaPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string } }
): Promise<{ paymentId: string; confirmationUrl: string }> {
  return fetchJson("/api/client/yookassa/create-payment", { method: "POST", body, token });
}

/** Crypto Pay (Crypto Bot) — создать инвойс, вернуть ссылку на оплату */
export async function createCryptopayPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string } }
): Promise<{ paymentId: string; payUrl: string }> {
  const res = await fetchJson<{ paymentId: string; payUrl: string }>("/api/client/cryptopay/create-payment", { method: "POST", body, token });
  return { paymentId: res.paymentId, payUrl: res.payUrl };
}

/** Heleket — создать инвойс на крипту, вернуть ссылку на оплату */
export async function createHeleketPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string } }
): Promise<{ paymentId: string; payUrl: string }> {
  return fetchJson("/api/client/heleket/create-payment", { method: "POST", body, token });
}

/** LAVA Business — создать счёт (RUB: СБП / Карты / СберPay) */
export async function createLavaPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string } }
): Promise<{ paymentId: string; payUrl: string }> {
  return fetchJson("/api/client/lava/create-payment", { method: "POST", body, token });
}

/** Помечает что онбординг (приветствие в боте) завершён — `client.onboardingCompleted=true` */
export async function completeOnboarding(token: string): Promise<{ message: string }> {
  return fetchJson("/api/client/complete-onboarding", { method: "POST", token });
}

/** Lava.top — создать invoice через product/offer модель (RUB/USD/EUR) */
export async function createLavatopPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; email?: string; offerId?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string } }
): Promise<{ paymentId: string; payUrl: string }> {
  return fetchJson("/api/client/lavatop/create-payment", { method: "POST", body, token });
}

/** Обновить профиль (язык, валюта) */
export async function updateProfile(
  token: string,
  body: { preferredLang?: string; preferredCurrency?: string }
): Promise<unknown> {
  return fetchJson("/api/client/profile", { method: "PATCH", body, token });
}

/** Включить/выключить автопродление */
export async function toggleAutoRenew(
  token: string,
  enabled: boolean
): Promise<{ message: string }> {
  return fetchJson("/api/client/auto-renew", { method: "PATCH", body: { enabled }, token });
}

/** Активировать триал */
export async function activateTrial(token: string): Promise<{ message: string }> {
  return fetchJson("/api/client/trial", { method: "POST", body: {}, token });
}

/** Оплата тарифа или прокси-тарифа балансом */
export async function payByBalance(
  token: string,
  opts: { tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string }
): Promise<{ message: string; paymentId?: string; newBalance?: number }> {
  return fetchJson("/api/client/payments/balance", { method: "POST", body: opts, token });
}

/** Оплата опции (доп. трафик/устройства/сервер) с баланса */
export async function payOptionByBalance(
  token: string,
  extraOption: { kind: "traffic" | "devices" | "servers"; productId: string }
): Promise<{ message: string; paymentId: string; newBalance: number }> {
  return fetchJson("/api/client/payments/balance/option", { method: "POST", body: { extraOption }, token });
}

/** Активировать промо-ссылку (PromoGroup) */
export async function activatePromo(token: string, code: string): Promise<{ message: string }> {
  return fetchJson("/api/client/promo/activate", { method: "POST", body: { code }, token });
}

/** Проверить промокод (PromoCode — скидка / бесплатные дни) */
export async function checkPromoCode(token: string, code: string): Promise<{ type: string; discountPercent?: number | null; discountFixed?: number | null; durationDays?: number | null; name: string }> {
  return fetchJson("/api/client/promo-code/check", { method: "POST", body: { code }, token });
}

/** Активировать промокод FREE_DAYS */
export async function activatePromoCode(token: string, code: string): Promise<{ message: string }> {
  return fetchJson("/api/client/promo-code/activate", { method: "POST", body: { code }, token });
}

// ——— Bot Admin API (X-Telegram-Bot-Token + telegramId в query/body) ———

const BOT_ADMIN_BASE = "/api/bot-admin";

export type BotAdminStats = {
  users: { total: number; withRemna: number; newLast7Days: number; newLast30Days: number };
  sales: {
    totalAmount: number;
    totalCount: number;
    last7DaysAmount: number;
    last7DaysCount: number;
    last30DaysAmount: number;
    last30DaysCount: number;
  };
};

export type BotAdminNotificationSettings = {
  notifyBalanceTopup: boolean;
  notifyTariffPayment: boolean;
  notifyNewClient: boolean;
  notifyNewTicket: boolean;
};

export async function getBotAdminStats(telegramId: number): Promise<BotAdminStats> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/stats?telegramId=${telegramId}`, {
    headers: { "X-Telegram-Bot-Token": botToken },
  });
  const data = (await res.json().catch(() => ({}))) as BotAdminStats | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as BotAdminStats;
}

export async function getBotAdminNotificationSettings(telegramId: number): Promise<BotAdminNotificationSettings> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/notification-settings?telegramId=${telegramId}`, {
    headers: { "X-Telegram-Bot-Token": botToken },
  });
  const data = (await res.json().catch(() => ({}))) as BotAdminNotificationSettings | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as BotAdminNotificationSettings;
}

export async function patchBotAdminNotificationSettings(
  telegramId: number,
  settings: Partial<BotAdminNotificationSettings>
): Promise<BotAdminNotificationSettings> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/notification-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId, ...settings }),
  });
  const data = (await res.json().catch(() => ({}))) as BotAdminNotificationSettings | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as BotAdminNotificationSettings;
}

export type BotAdminClientItem = {
  id: string;
  email: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  balance: number;
  isBlocked: boolean;
  createdAt: string;
};

export async function getBotAdminClients(
  telegramId: number,
  page: number,
  search?: string
): Promise<{ items: BotAdminClientItem[]; total: number; page: number; limit: number }> {
  const params = new URLSearchParams({ telegramId: String(telegramId), page: String(page), limit: "8" });
  if (search?.trim()) params.set("search", search.trim());
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients?${params}`, {
    headers: { "X-Telegram-Bot-Token": botToken },
  });
  const data = (await res.json().catch(() => ({}))) as { items: BotAdminClientItem[]; total: number; page: number; limit: number } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { items: BotAdminClientItem[]; total: number; page: number; limit: number };
}

export type BotAdminClient = BotAdminClientItem & {
  preferredLang: string | null;
  preferredCurrency: string | null;
  referralCode: string | null;
  remnawaveUuid: string | null;
  trialUsed: boolean | null;
  blockReason: string | null;
  _count: { referrals: number };
};

export async function getBotAdminClient(telegramId: number, clientId: string): Promise<BotAdminClient> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}?telegramId=${telegramId}`, {
    headers: { "X-Telegram-Bot-Token": botToken },
  });
  const data = (await res.json().catch(() => ({}))) as BotAdminClient | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as BotAdminClient;
}

export async function patchBotAdminClientBlock(
  telegramId: number,
  clientId: string,
  isBlocked: boolean,
  blockReason?: string
): Promise<{ ok: boolean; isBlocked: boolean }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}/block`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId, isBlocked, blockReason }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok: boolean; isBlocked: boolean } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { ok: boolean; isBlocked: boolean };
}

export type BotAdminPaymentItem = {
  id: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  tariffName: string | null;
  clientEmail: string | null;
  clientTelegramId: string | null;
  clientTelegramUsername: string | null;
  paidAt: string | null;
  createdAt: string;
};

export async function getBotAdminPayments(
  telegramId: number,
  status: "PENDING" | "PAID",
  page: number
): Promise<{ items: BotAdminPaymentItem[]; total: number; page: number; limit: number }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(
    `${API_URL}${BOT_ADMIN_BASE}/payments?telegramId=${telegramId}&status=${status}&page=${page}&limit=8`,
    { headers: { "X-Telegram-Bot-Token": botToken } }
  );
  const data = (await res.json().catch(() => ({}))) as {
    items: BotAdminPaymentItem[];
    total: number;
    page: number;
    limit: number;
  } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { items: BotAdminPaymentItem[]; total: number; page: number; limit: number };
}

export async function patchBotAdminPaymentMarkPaid(telegramId: number, paymentId: string): Promise<unknown> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/payments/${encodeURIComponent(paymentId)}/mark-paid`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function getBotAdminBroadcastCount(telegramId: number): Promise<{ withTelegram: number; withEmail: number }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/broadcast/count?telegramId=${telegramId}`, {
    headers: { "X-Telegram-Bot-Token": botToken },
  });
  const data = (await res.json().catch(() => ({}))) as { withTelegram: number; withEmail: number } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { withTelegram: number; withEmail: number };
}

export async function postBotAdminBroadcast(
  telegramId: number,
  message: string,
  channel: "telegram" | "email" | "both",
  photoFileId?: string,
  buttonText?: string,
  buttonUrl?: string
): Promise<{ ok: boolean; sentTelegram: number; sentEmail: number; failedTelegram: number; failedEmail: number; errors: string[] }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId, message, channel, photoFileId: photoFileId ?? undefined, buttonText: buttonText ?? undefined, buttonUrl: buttonUrl ?? undefined }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok: boolean;
    sentTelegram: number;
    sentEmail: number;
    failedTelegram: number;
    failedEmail: number;
    errors: string[];
  } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { ok: boolean; sentTelegram: number; sentEmail: number; failedTelegram: number; failedEmail: number; errors: string[] };
}

export async function patchBotAdminClientBalance(telegramId: number, clientId: string, amount: number): Promise<{ ok: boolean; newBalance: number }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}/balance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId, amount }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok: boolean; newBalance: number } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { ok: boolean; newBalance: number };
}

export async function postBotAdminClientRemnaRevoke(telegramId: number, clientId: string): Promise<unknown> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}/remna/revoke-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`);
  return data;
}

export async function postBotAdminClientRemnaDisable(telegramId: number, clientId: string): Promise<unknown> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}/remna/disable`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`);
  return data;
}

export async function postBotAdminClientRemnaEnable(telegramId: number, clientId: string): Promise<unknown> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}/remna/enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`);
  return data;
}

export async function postBotAdminClientRemnaResetTraffic(telegramId: number, clientId: string): Promise<unknown> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}/remna/reset-traffic`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`);
  return data;
}

export type BotAdminSquadItem = { uuid: string; name: string };

export async function getBotAdminRemnaSquadsInternal(telegramId: number): Promise<{ items: BotAdminSquadItem[] }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/remna/squads/internal?telegramId=${telegramId}`, {
    headers: { "X-Telegram-Bot-Token": botToken },
  });
  const data = (await res.json().catch(() => ({}))) as { items: BotAdminSquadItem[] } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { items: BotAdminSquadItem[] };
}

export async function getBotAdminClientRemna(telegramId: number, clientId: string): Promise<{ remnaUuid: string; activeInternalSquads: string[] }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(
    `${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}/remna?telegramId=${telegramId}`,
    { headers: { "X-Telegram-Bot-Token": botToken } }
  );
  const data = (await res.json().catch(() => ({}))) as { remnaUuid: string; activeInternalSquads: string[] } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { remnaUuid: string; activeInternalSquads: string[] };
}

export async function postBotAdminClientRemnaSquadAdd(telegramId: number, clientId: string, squadUuid: string): Promise<{ ok: boolean; activeInternalSquads: string[] }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}/remna/squads/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId, squadUuid }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok: boolean; activeInternalSquads: string[] } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { ok: boolean; activeInternalSquads: string[] };
}

export async function postBotAdminClientRemnaSquadRemove(telegramId: number, clientId: string, squadUuid: string): Promise<{ ok: boolean; activeInternalSquads: string[] }> {
  const botToken = process.env.BOT_TOKEN || "";
  const res = await fetch(`${API_URL}${BOT_ADMIN_BASE}/clients/${encodeURIComponent(clientId)}/remna/squads/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken },
    body: JSON.stringify({ telegramId, squadUuid }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok: boolean; activeInternalSquads: string[] } | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { ok: boolean; activeInternalSquads: string[] };
}

// ——— Gift / Secondary Subscriptions API ———

/** Купить дополнительную подписку (оплата балансом) */
export async function buyGiftSubscription(
  token: string,
  body: { tariffId: string; tariffPriceOptionId?: string; extraDevices?: number }
): Promise<{ message: string; secondarySubscriptionId: string; subscriptionIndex: number }> {
  return fetchJson("/api/client/gift/buy", { method: "POST", body, token });
}

/** Список дополнительных подписок клиента */
export async function getGiftSubscriptions(
  token: string
): Promise<{ subscriptions: { id: string; remnawaveUuid: string | null; subscriptionIndex: number | null; giftStatus: string | null; ownerId: string }[] }> {
  return fetchJson("/api/client/gift/subscriptions", { token });
}

/** Создать подарочный код */
export async function createGiftCode(
  token: string,
  body: { secondarySubscriptionId: string; giftMessage?: string }
): Promise<{ message: string; code: string; expiresAt: string; tariffName: string | null }> {
  return fetchJson("/api/client/gift/create-code", { method: "POST", body, token });
}

/** Активировать подарочный код */
export async function redeemGiftCode(
  token: string,
  code: string
): Promise<{ message: string; secondarySubscriptionId: string; subscriptionIndex: number; giftMessage: string | null; creatorTelegramId: string | null; tariffName: string | null }> {
  return fetchJson("/api/client/gift/redeem", { method: "POST", body: { code }, token });
}

/** Отменить подарочный код */
export async function cancelGiftCode(
  token: string,
  codeOrId: string
): Promise<{ message: string }> {
  return fetchJson("/api/client/gift/cancel/" + encodeURIComponent(codeOrId), { method: "DELETE", token });
}

/** Список подарочных кодов клиента */
export async function getGiftCodes(
  token: string
): Promise<{ codes: { id: string; code: string; status: string; expiresAt: string; createdAt: string; redeemedAt: string | null; secondarySubscriptionId: string; giftMessage: string | null }[] }> {
  return fetchJson("/api/client/gift/codes", { token });
}

/** Активировать подписку на себя (снять GIFT_RESERVED) */
export async function activateGiftForSelf(
  token: string,
  subscriptionId: string
): Promise<{ message: string; subscriptionId: string }> {
  return fetchJson("/api/client/gift/activate-self", { method: "POST", body: { subscriptionId }, token });
}

/** Удалить дополнительную подписку */
export async function deleteGiftSubscription(
  token: string,
  subscriptionId: string
): Promise<{ message: string }> {
  return fetchJson("/api/client/gift/subscription/" + encodeURIComponent(subscriptionId), { method: "DELETE", token });
}

/** URL подписки для вторичного аккаунта */
export async function getGiftSubscriptionUrl(
  token: string,
  subscriptionId: string
): Promise<{ uuid: string }> {
  return fetchJson("/api/client/gift/subscription-url/" + encodeURIComponent(subscriptionId), { token });
}

/** Строка из GET /api/internal/bots (для мульти-бота в одном процессе). */
export type InternalBotRow = {
  id: string;
  token: string;
  username: string | null;
  markupPercent: number;
  isPrimary: boolean;
};

/**
 * Активные боты в БД. Заголовок X-Telegram-Bot-Token — любой токен из активных
 * (обычно BOT_TOKEN основного бота).
 */
export async function fetchInternalBotsList(bootstrapToken: string): Promise<{ items: InternalBotRow[] }> {
  const res = await fetch(`${API_URL}/api/internal/bots`, {
    headers: { "X-Telegram-Bot-Token": bootstrapToken.trim() },
  });
  const data = (await res.json().catch(() => ({}))) as { items?: InternalBotRow[]; message?: string };
  if (!res.ok) {
    const msg = typeof data.message === "string" ? data.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { items: Array.isArray(data.items) ? data.items : [] };
}

/** Сообщить бэкенду username после getMe (обновление в таблице bots). */
export async function reportBotMeUsername(botToken: string, username: string | undefined): Promise<void> {
  try {
    await fetch(`${API_URL}/api/internal/bots/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Token": botToken.trim() },
      body: JSON.stringify({ username: username?.replace(/^@/, "") }),
    });
  } catch {
    /* ignore */
  }
}
