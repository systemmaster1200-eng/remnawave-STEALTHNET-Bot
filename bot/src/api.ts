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
  // Идентифицируем все вызовы из бота через X-Telegram-Bot-Token, чтобы:
  // 1) бэкенд знал какому клону принадлежит запрос (resolveBotForClientRequest)
  // 2) IP-rate-limit'ы пропускали бот-трафик (skip-условие в app.ts).
  // Без этого заголовка все регистрации через /start блокируются по IP бот-контейнера.
  const botToken = process.env.BOT_TOKEN || "";
  if (botToken) h["X-Telegram-Bot-Token"] = botToken;
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
  /** кастомные названия и порядок платёжных провайдеров из админки. */
  paymentProviders?: { id: string; label: string; sortOrder: number }[];
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
  // T11+T13+T14 (11.05.2026) — кастомизация бота
  refundLink?: string | null;
  supportHoursFrom?: string | null;
  supportHoursTo?: string | null;
  tgProxyText?: string | null;
  tgProxyUrlPrimary?: string | null;
  tgProxyUrlBackup?: string | null;
  // динамический список прокси-серверов для бота.
  tgProxyServers?: { flag: string; name: string; url: string }[];
  reissueWarningText?: string | null;
  installSecondDeviceText?: string | null;
  helpIntroText?: string | null;
  giftIntroText?: string | null;
  /** редактируемый текст шапки «📱 Мои устройства». */
  botDevicesText?: string | null;
  /** подсказка «если инструкция не открылась». */
  botInstructionFallbackText?: string | null;
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
  const cfg = await fetchJson<{
    paymentProviders?: { id: string; label: string; sortOrder: number }[];
  } | null>("/api/public/config");
  // синхронизируем кастомные названия платёжек с keyboard.ts —
  // module-level state используется во всех функциях кнопок выбора оплаты.
  try {
    const { setProviderLabels } = await import("./keyboard.js");
    setProviderLabels(cfg?.paymentProviders ?? null);
  } catch {
    // Если динамический импорт упал — кнопки используют дефолтные хардкоды.
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return cfg as any;
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
}): Promise<{ token: string; client: { id: string; telegramUsername?: string | null; preferredLang?: string; preferredCurrency: string; balance: number; trialUsed?: boolean; referralCode?: string | null; onboardingCompleted?: boolean }; isNewClient?: boolean }> {
  return fetchJson("/api/client/auth/register", { method: "POST", body });
}

/** запустить event-driven welcome (after_registration) */
export async function fireOnRegistration(token: string): Promise<{ ok: boolean; rulesProcessed: number; sent: number }> {
  return fetchJson("/api/client/auth/fire-on-registration", { method: "POST", token });
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
  // нужны для category-aware диалога в pay_tariff handler.
  // currentTariffId/currentTariff может быть null если у клиента ещё нет основной подписки.
  currentTariffId?: string | null;
  currentTariff?: { id: string; name: string; categoryId: string | null } | null;
  // для предупреждения юзера при включении автосписания
  // что есть YooKassa-recurring fallback с сохранённой карты.
  yookassaPaymentMethodTitle?: string | null;
  // персональная скидка клиента (%)
  personalDiscountPercent?: number | null;
  // для 54-ФЗ-чека: подставляем сохранённый email в receipt prompt.
  email?: string | null;
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

/**
 * доступные клиенту триалы (которые он ещё не активировал).
 * Если массив пустой — кнопка «🎁 Получить пробную» в главном меню скрывается.
 */
export async function getAvailableTrials(token: string): Promise<{
  items: { id: string; name: string; tariffId: string; tariffName: string | null; durationDays: number; description: string | null; sortOrder: number }[];
  hasAnyEnabled: boolean;
}> {
  return fetchJson("/api/client/trials/available", { token });
}

/** включить/выключить автосписание для подписки. */
export async function toggleSubAutoRenew(
  token: string,
  type: "root" | "secondary",
  id: string,
  enabled: boolean,
): Promise<{ ok: boolean; enabled: boolean; type: string; message?: string; code?: string }> {
  return fetchJson(`/api/client/subscription/${type}/${encodeURIComponent(id)}/auto-renew`, {
    method: "POST",
    body: { enabled },
    token,
  });
}

/** создание заявки на вывод реф. баланса (USDT TRC20). */
export async function createWithdrawal(
  token: string,
  body: { amount: number; walletTrc20: string },
): Promise<{ message: string; id: string; amount: number; walletTrc20: string; status: string }> {
  return fetchJson("/api/client/withdrawals", { method: "POST", body, token });
}

/** расширенная статистика реферальной программы. */
export async function getReferralStats(token: string): Promise<{
  referralCode: string | null;
  referralPercent: number;
  referralPercentLevel2: number;
  referralPercentLevel3: number;
  referralCount: number;
  l1Clicks: number;
  l1Purchased: number;
  l1Earned: number;
  l2InvitesCount: number;
  l2Earned: number;
  totalEarned: number;
  totalWithdrawn: number;
  totalSpent: number;
  availableBalance: number;
}> {
  return fetchJson("/api/client/referral-stats", { token });
}

/** T15: активация конкретного триала по ID. */
export async function activateTrialById(
  token: string,
  trialId: string,
): Promise<{
  message: string;
  subscriptionId: string;
  trialId: string;
  durationDays: number;
  // для кнопки «🌐 Локации» на экране активации.
  tariffId: string;
  tariffHasLocations: boolean;
  /** T-unify (12.05.2026) — URL подписки для кнопки «📲 Инструкции по установке». */
  subscriptionUrl?: string | null;
}> {
  return fetchJson(`/api/client/trials/${encodeURIComponent(trialId)}/activate`, { token, method: "POST" });
}

/**
 * Перевыпуск subscription URL.
 * Под капотом — Remnawave POST /api/users/{uuid}/actions/revoke (новый shortUuid).
 * type: "root" → id == clientId; type: "secondary" → id == secondarySubscription.id.
 */
export async function reissueSubscription(
  token: string,
  type: "root" | "secondary",
  id: string,
): Promise<{ ok: boolean; subscriptionUrl: string | null; message?: string }> {
  return fetchJson(`/api/client/subscription/${type}/${encodeURIComponent(id)}/reissue`, { token, method: "POST" });
}

/** Список устройств (HWID) пользователя в Remna */
export async function getClientDevices(token: string): Promise<{ total: number; devices: { hwid: string; platform?: string; deviceModel?: string; createdAt?: string }[] }> {
  return fetchJson("/api/client/devices", { token });
}

/**
 * все устройства всех подписок клиента (root + secondary),
 * с пометкой откуда. Используется в меню «📱 Мои Устройства» — показывает
 * единый список с подписью «Подписка #N — тариф».
 */
export async function getAllDevices(token: string): Promise<{
  total: number;
  items: {
    hwid: string;
    platform?: string;
    deviceModel?: string;
    /** приложение (Hiddify / v2rayN / Streisand …). */
    appName?: string;
    createdAt?: string;
    subscriptionType: "root" | "secondary";
    subscriptionId: string;
    subscriptionIndex: number;
    tariffName: string | null;
  }[];
}> {
  return fetchJson("/api/client/devices/all", { token });
}

/** Удалить устройство по HWID.
 *  добавили опциональные subscriptionType / subscriptionId —
 *  чтобы устройство удалялось именно из той подписки откуда оно показалось в UI (раньше
 *  endpoint удалял только из root, и для secondary получали «HWID device not found»). */
export async function postClientDeviceDelete(
  token: string,
  hwid: string,
  subscription?: { type: "root" | "secondary"; id: string },
): Promise<{ ok: boolean; message?: string }> {
  const body: Record<string, unknown> = { hwid };
  if (subscription) {
    body.subscriptionType = subscription.type;
    body.subscriptionId = subscription.id;
  }
  return fetchJson("/api/client/devices/delete", { method: "POST", body, token });
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
    extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string };
    /** купить тариф как ДОП. подписку — backend пометит Payment.metadata. */
    asAdditional?: boolean;
    /** продление существующей secondary (вместо создания новой) */
    extendsSecondarySubId?: string;
    /** удалить доп. устройства после активации подписки в бэке */
    removeExtrasOnActivate?: boolean;
  }
): Promise<{ paymentUrl: string; orderId: string; paymentId: string }> {
  return fetchJson("/api/client/payments/platega", { method: "POST", body, token });
}

/** Создать платёж ЮMoney (оплата картой). Для тарифа — tariffId, для прокси — proxyTariffId, для опции — extraOption. */
export async function createYoomoneyPayment(
  token: string,
  body: { amount?: number; paymentType: "PC" | "AC"; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string }; asAdditional?: boolean; extendsSecondarySubId?: string; asGift?: boolean; removeExtrasOnActivate?: boolean }
): Promise<{ paymentId: string; paymentUrl: string }> {
  return fetchJson("/api/client/yoomoney/create-form-payment", { method: "POST", body, token });
}

/** Создать платёж ЮKassa (карта, СБП). Только RUB. Для тарифа — tariffId, для прокси — proxyTariffId, для опции — extraOption.
 *  19.05.2026 — receiptEmail: 54-ФЗ. Если передан валидный email — ЮКасса пришлёт чек на эту почту,
 *  и email сохраняется в client.email для будущих покупок. Если пусто/невалидно — placeholder (без чека юзеру). */
export async function createYookassaPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string }; asAdditional?: boolean; extendsSecondarySubId?: string; asGift?: boolean; removeExtrasOnActivate?: boolean; receiptEmail?: string }
): Promise<{ paymentId: string; confirmationUrl: string }> {
  return fetchJson("/api/client/yookassa/create-payment", { method: "POST", body, token });
}

/** Crypto Pay (Crypto Bot) — создать инвойс, вернуть ссылку на оплату */
export async function createCryptopayPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string }; asAdditional?: boolean; extendsSecondarySubId?: string; asGift?: boolean; removeExtrasOnActivate?: boolean }
): Promise<{ paymentId: string; payUrl: string }> {
  const res = await fetchJson<{ paymentId: string; payUrl: string }>("/api/client/cryptopay/create-payment", { method: "POST", body, token });
  return { paymentId: res.paymentId, payUrl: res.payUrl };
}

/** Heleket — создать инвойс на крипту, вернуть ссылку на оплату */
export async function createHeleketPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string }; asAdditional?: boolean; extendsSecondarySubId?: string; asGift?: boolean; removeExtrasOnActivate?: boolean }
): Promise<{ paymentId: string; payUrl: string }> {
  return fetchJson("/api/client/heleket/create-payment", { method: "POST", body, token });
}

/** LAVA Business — создать счёт (RUB: СБП / Карты / СберPay) */
export async function createLavaPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string }; asAdditional?: boolean; extendsSecondarySubId?: string; asGift?: boolean; removeExtrasOnActivate?: boolean }
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
  body: { amount?: number; currency?: string; tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; email?: string; offerId?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string }; asAdditional?: boolean; extendsSecondarySubId?: string; asGift?: boolean; removeExtrasOnActivate?: boolean }
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
  opts: { tariffId?: string; tariffPriceOptionId?: string; deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string; extendsSecondarySubId?: string; asAdditional?: boolean; removeExtrasOnActivate?: boolean }
): Promise<{ message: string; paymentId?: string; newBalance?: number }> {
  return fetchJson("/api/client/payments/balance", { method: "POST", body: opts, token });
}

/** Оплата опции (доп. трафик/устройства/сервер) с баланса.
 * targetSubscriptionId — к какой подписке применить опцию (для secondary). */
export async function payOptionByBalance(
  token: string,
  args: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string }
): Promise<{ message: string; paymentId: string; newBalance: number }> {
  const { kind, productId, targetSubscriptionId } = args;
  return fetchJson("/api/client/payments/balance/option", {
    method: "POST",
    body: { extraOption: { kind, productId }, targetSubscriptionId },
    token,
  });
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
): Promise<{ message: string; subscriptionId: string; subscriptionIndex: number }> {
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
  body: { subscriptionId: string; giftMessage?: string }
): Promise<{
  message: string;
  code: string;
  expiresAt: string;
  tariffName: string | null;
  /** T-unify (12.05.2026) — для отображения формата подарка. */
  durationDays: number | null;
  trafficLimitBytes: number | null;
}> {
  return fetchJson("/api/client/gift/create-code", { method: "POST", body, token });
}

/** Активировать подарочный код */
export async function redeemGiftCode(
  token: string,
  code: string
): Promise<{
  message: string;
  subscriptionId: string;
  subscriptionIndex: number;
  giftMessage: string | null;
  creatorTelegramId: string | null;
  tariffName: string | null;
  /** T-unify (12.05.2026) — для текста получателю. */
  durationDays: number | null;
  trafficLimitBytes: number | null;
  subscriptionUrl: string | null;
  tariffPrice: number | null;
  tariffCurrency: string | null;
}> {
  return fetchJson("/api/client/gift/redeem", { method: "POST", body: { code }, token });
}

/** Отменить подарочный код */
export async function cancelGiftCode(
  token: string,
  codeOrId: string
): Promise<{ message: string }> {
  return fetchJson("/api/client/gift/cancel/" + encodeURIComponent(codeOrId), { method: "DELETE", token });
}

/**
 * получить активный подарочный код для подписки.
 * Используется когда юзер вернулся в «Мои подарки» к подписке с GIFT_RESERVED статусом —
 * чтобы снова показать share-UI для уже созданного кода.
 */
export async function getActiveGiftCodeForSubscription(
  token: string,
  secondarySubId: string,
): Promise<{ code: string; expiresAt: string; tariffName: string | null; subscriptionId: string }> {
  return fetchJson("/api/client/gift/active-code/" + encodeURIComponent(secondarySubId), { token });
}

/** Список подарочных кодов клиента */
export async function getGiftCodes(
  token: string
): Promise<{ codes: { id: string; code: string; status: string; expiresAt: string; createdAt: string; redeemedAt: string | null; subscriptionId: string; giftMessage: string | null }[] }> {
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

// ——— My subscriptions (root + secondary) ———

/**
 * Унифицированный список подписок клиента: root (Client.remnawaveUuid) +
 * secondary (купленные доп. + полученные в подарок). Эндпоинт
 * `/api/client/subscription/all` уже возвращает оба типа в одном массиве —
 * бот использует это в меню «📋 Мои подписки» вместо двух отдельных запросов.
 */
export type SubscriptionListItem = {
  type: "root" | "secondary";
  /** Для root — clientId, для secondary — subscriptionId */
  id: string;
  subscriptionIndex: number | null;
  /** Сырой Remnawave user (для извлечения subscriptionUrl/expireAt) */
  subscription: unknown;
  tariffDisplayName: string;
  remnawaveUuid: string | null;
  /** id текущего тарифа подписки — для кнопки «Продлить» (быстрая оплата
   *  того же тарифа без выбора). null если тариф удалён или не определён. */
  tariffId: string | null;
  /** T15.4 (11.05.2026): id триала, если подписка была создана через активацию пробного.
   *  Бот рисует пометку «🎁 Пробная» и кнопку «🔄 Конвертировать в платную». null = обычная sub. */
  trialId: string | null;
  /** включено ли индивидуальное автосписание для этой подписки. */
  autoRenewEnabled?: boolean;
  /** эмодзи-префикс из админки (Tariff.menuEmoji) для главного меню бота.
   *  Если null — бот применяет fallback по типу подписки (root → 🌐, secondary → 🔒). */
  tariffMenuEmoji?: string | null;
  /** кол-во докупленных доп. устройств. */
  extraDevices?: number;
  /** цена за все доп. устройства на 30 дней. */
  extraDevicesMonthlyPrice?: number;
};

/** Убрать ВСЕ доп. устройства с подписки (extraDevices=0, hwid kick в Remna). */
export async function removeExtraDevices(
  token: string,
  subType: "root" | "secondary",
  subId: string,
): Promise<{ ok: boolean; extraDevicesRemoved: number; hwidKicked: number; newDeviceLimit: number }> {
  return fetchJson(`/api/client/subscription/${subType}/${subId}/remove-extra-devices`, {
    method: "POST",
    token,
  });
}
export async function getAllSubscriptions(
  token: string
): Promise<{ items: SubscriptionListItem[] }> {
  return fetchJson("/api/client/subscription/all", { token });
}

/**
 * pre-check кулдауна продления для конкретной подписки.
 * Бот зовёт перед открытием экрана продления — если blocked, сразу показывает сообщение.
 */
export async function checkSubscriptionCooldown(
  token: string,
  subscriptionId: string,
): Promise<{ blocked: false } | { blocked: true; daysLeft: number; message: string; tariffName: string; cooldownDays: number; nextAvailableAt: string }> {
  return fetchJson(`/api/client/subscription/${encodeURIComponent(subscriptionId)}/cooldown`, { token });
}

/**
 * batch-проверка для списка подписок (renew_pick экран).
 * Возвращает массив с blocked-флагами для отрисовки 🚫 на заблокированных подписках.
 */
export async function checkSubscriptionsCooldownBatch(
  token: string,
  ids: string[],
): Promise<{ items: Array<{ subscriptionId: string; blocked: boolean; daysLeft?: number; message?: string; tariffName?: string; cooldownDays?: number }> }> {
  return fetchJson("/api/client/subscriptions/cooldown-check", { token, method: "POST", body: { ids } });
}

// (v5.0.0) Удалены fetchInternalBotsList / reportBotMeUsername — клоны бота больше
// не поддерживаются, бот один, его токен живёт в process.env.BOT_TOKEN.
