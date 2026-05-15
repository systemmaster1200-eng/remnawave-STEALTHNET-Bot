/**
 * STEALTHNET 3.2.7 — Telegram-бот
 * Полный функционал кабинета: главная, тарифы, профиль, пополнение, триал, реферальная ссылка, VPN.
 * Цветные кнопки: style primary / success / danger (Telegram Bot API).
 */

import "dotenv/config";
import { Bot, InputFile } from "grammy";
import { ProxyAgent as UndiciProxyAgent } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import * as api from "./api.js";
import {
  mainMenu,
  backToMenu,
  supportSubMenu,
  topUpPresets,
  tariffPayButtons,
  tariffsOfCategoryButtons,
  tariffPaymentMethodButtons,
  proxyTariffPayButtons,
  proxyTariffsOfCategoryButtons,
  proxyCategoryButtons,
  proxyPaymentMethodButtons,
  singboxTariffPayButtons,
  singboxTariffsOfCategoryButtons,
  singboxPaymentMethodButtons,
  topupPaymentMethodButtons,
  payUrlMarkup,
  profileButtons,
  extraOptionsButtons,
  optionPaymentMethodButtons,
  langButtons,
  currencyButtons,
  trialConfirmButton,
  openSubscribePageMarkup,
  giftMenuButtons,
  giftSubscriptionButtons,
  giftCodeResultButtons,
  giftPostPurchaseButtons,
  giftCodesListButtons,
  giftTariffButtons,
  giftPaymentButtons,
  type InlineMarkup,
  type InnerEmojiIds,
} from "./keyboard.js";
import { t as _t, formatDays as _formatDays, setTranslations } from "./i18n.js";

function formatRuDays(n: number): string {
  return _formatDays(n, "ru");
}

const userLangCache = new Map<number, string>();

function setUserLang(userId: number, lang: string) {
  userLangCache.set(userId, lang);
}

function getUserLang(userId: number): string {
  return userLangCache.get(userId) ?? "ru";
}

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Set BOT_TOKEN in .env");
  process.exit(1);
}

async function waitForApi(maxRetries = 10, delayMs = 3000): Promise<Awaited<ReturnType<typeof api.getPublicConfig>>> {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await api.getPublicConfig();
    } catch {
      if (i < maxRetries) {
        console.log(`[Bot] API недоступен, повтор через ${delayMs / 1000}с (${i}/${maxRetries})…`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  return null;
}

async function createBotWithProxy(token: string): Promise<Bot> {
  try {
    const cfg = await waitForApi();
    if (cfg?.proxyEnabled && cfg?.proxyTelegram && cfg?.proxyUrl?.trim()) {
      const url = cfg.proxyUrl.trim();
      const lower = url.toLowerCase();
      if (lower.startsWith("http://") || lower.startsWith("https://")) {
        console.log("[Proxy] Telegram Bot API через HTTP прокси");
        return new Bot(token, {
          client: { baseFetchConfig: { dispatcher: new UndiciProxyAgent(url) } as any },
        });
      }
      if (lower.startsWith("socks5://") || lower.startsWith("socks4://") || lower.startsWith("socks://")) {
        console.log("[Proxy] Telegram Bot API через SOCKS прокси");
        const agent = new SocksProxyAgent(url);
        return new Bot(token, {
          client: { baseFetchConfig: { agent } as any },
        });
      }
      console.warn(`[Proxy] Неизвестный протокол прокси: ${url}, запуск без прокси`);
    }
  } catch {
    console.warn("[Bot] Не удалось получить конфиг, запуск без прокси");
  }
  return new Bot(token);
}

const bot = await createBotWithProxy(BOT_TOKEN);

let BOT_USERNAME = "";

// ——— Принудительная подписка на канал ———

type SubscriptionCheckState = "subscribed" | "not_subscribed" | "cannot_verify";

type ForceChannelTarget = {
  chatId: string | null;
  joinUrl: string | null;
};

function parseForceChannelTarget(channelInput: string): ForceChannelTarget {
  const raw = channelInput.trim();
  if (!raw) return { chatId: null, joinUrl: null };

  const looksLikeUrl = /^https?:\/\//i.test(raw) || /^t\.me\//i.test(raw);
  if (looksLikeUrl) {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(candidate);
      const hostOk = u.hostname === "t.me" || u.hostname.endsWith(".t.me");
      const path = u.pathname.replace(/^\/+|\/+$/g, "");
      if (hostOk && path) {
        if (path.startsWith("c/")) {
          const idPart = path.slice(2).split("/")[0];
          if (/^\d+$/.test(idPart)) {
            return { chatId: `-100${idPart}`, joinUrl: candidate };
          }
        }
        if (path.startsWith("+") || path.startsWith("joinchat/")) {
          return { chatId: null, joinUrl: candidate };
        }
        const uname = path.split("/")[0];
        if (/^[a-zA-Z0-9_]{5,}$/.test(uname)) {
          return { chatId: `@${uname}`, joinUrl: `https://t.me/${uname}` };
        }
      }
    } catch {
      // fallthrough
    }
  }

  if (raw.startsWith("@")) {
    const uname = raw.slice(1);
    if (/^[a-zA-Z0-9_]{5,}$/.test(uname)) {
      return { chatId: `@${uname}`, joinUrl: `https://t.me/${uname}` };
    }
  }

  if (/^[a-zA-Z0-9_]{5,}$/.test(raw)) {
    return { chatId: `@${raw}`, joinUrl: `https://t.me/${raw}` };
  }

  if (/^-?\d+$/.test(raw)) {
    const joinUrl = raw.startsWith("-100") ? `https://t.me/c/${raw.slice(4)}` : null;
    return { chatId: raw, joinUrl };
  }

  return { chatId: null, joinUrl: null };
}

/** Проверяет, подписан ли пользователь на указанный канал/группу. */
async function checkUserSubscription(userId: number, channelInput: string): Promise<{ state: SubscriptionCheckState; target: ForceChannelTarget; error?: string }> {
  const target = parseForceChannelTarget(channelInput);
  if (!target.chatId) {
    return { state: "cannot_verify", target, error: "invalid_channel_id" };
  }
  try {
    const member = await bot.api.getChatMember(target.chatId, userId);
    const subscribed = ["member", "administrator", "creator", "restricted"].includes(member.status);
    return { state: subscribed ? "subscribed" : "not_subscribed", target };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("getChatMember error:", msg, { channelInput, parsedChatId: target.chatId });
    return { state: "cannot_verify", target, error: msg };
  }
}

function subscribeKeyboard(channelInput: string, lang = "ru"): InlineMarkup {
  const target = parseForceChannelTarget(channelInput);
  const rows: InlineMarkup["inline_keyboard"] = [];
  if (target.joinUrl) {
    rows.push([{ text: _t("subscribe.channel_button", lang), url: target.joinUrl }]);
  }
  rows.push([{ text: _t("subscribe.check_button", lang), callback_data: "check_subscribe" }]);
  return { inline_keyboard: rows };
}

/**
 * Проверяет подписку и, если не подписан, отправляет/редактирует сообщение.
 * Возвращает true если НЕ подписан (нужно прервать обработку).
 */
async function enforceSubscription(
  ctx: {
    from?: { id: number };
    reply: (text: string, opts?: { reply_markup?: InlineMarkup }) => Promise<unknown>;
  },
  config: Awaited<ReturnType<typeof api.getPublicConfig>>,
): Promise<boolean> {
  if (!config?.forceSubscribeEnabled) return false;
  const channelId = config.forceSubscribeChannelId?.trim();
  if (!channelId) return false;
  const userId = ctx.from?.id;
  if (!userId) return false;
  const lang = getUserLang(userId);
  const result = await checkUserSubscription(userId, channelId);
  if (result.state === "subscribed") return false;
  const msg = config.forceSubscribeMessage?.trim() || _t("subscribe.default_message", lang);
  if (result.state === "cannot_verify") {
    await ctx.reply(
      `⚠️ ${msg}\n\n${_t("subscribe.cannot_verify", lang)}`,
      { reply_markup: subscribeKeyboard(channelId, lang) }
    );
    return true;
  }
  await ctx.reply(`⚠️ ${msg}`, { reply_markup: subscribeKeyboard(channelId, lang) });
  return true;
}

type TariffItem = {
  id: string;
  name: string;
  description?: string | null;
  durationDays: number;
  trafficLimitBytes?: number | null;
  trafficResetMode?: string;
  deviceLimit?: number | null;
  price: number;
  currency: string;
};
type TariffCategory = { id: string; name: string; emoji?: string; emojiKey?: string | null; tariffs: TariffItem[] };

// Токены по telegram_id (в памяти; автоматическая переавторизация при потере)
const tokenStore = new Map<number, string>();

function getToken(userId: number): string | undefined {
  return tokenStore.get(userId);
}

function setToken(userId: number, token: string): void {
  tokenStore.set(userId, token);
}

/**
 * Получить токен пользователя. Если токен отсутствует (рестарт бота, протух и т.д.),
 * автоматически переавторизует через registerByTelegram и возвращает свежий токен.
 */
async function getOrRestoreToken(userId: number, username?: string): Promise<string | null> {
  const existing = tokenStore.get(userId);
  if (existing) return existing;
  try {
    const config = await api.getPublicConfig();
    if (config?.translations) setTranslations(config.translations);
    const auth = await api.registerByTelegram({
      telegramId: String(userId),
      telegramUsername: username,
      preferredLang: config?.defaultLanguage ?? "ru",
      preferredCurrency: config?.defaultCurrency ?? "usd",
    });
    tokenStore.set(userId, auth.token);
    if (auth.client?.preferredLang) setUserLang(userId, auth.client.preferredLang);
    return auth.token;
  } catch {
    return null;
  }
}

// Пользователи, ожидающие ввода промокода
const awaitingPromoCode = new Set<number>();
// Активный промокод на скидку (хранится до оплаты)
type DiscountInfo = { code: string; discountPercent?: number | null; discountFixed?: number | null };
const activeDiscountCode = new Map<number, DiscountInfo>();
// Ожидание ввода подарочного кода
const awaitingGiftCode = new Set<number>();

// Админ: ожидание ввода поиска; последний поиск по userId для пагинации
const awaitingAdminSearch = new Set<number>();
const lastAdminSearch = new Map<number, string>();
// Админ: пополнение баланса клиента — ожидаем число
const awaitingAdminBalance = new Map<number, string>();
// Админ: рассылка — ожидаем текст или фото+подпись, затем канал
const awaitingBroadcastMessage = new Set<number>();
type BroadcastPayload = { text: string; photoFileId?: string; buttonText?: string; buttonUrl?: string };
const lastBroadcastMessage = new Map<number, string | BroadcastPayload>();
// Админ: сквады — список для добавления/удаления (clientId + items с uuid/name)
const lastSquadsForAdd = new Map<number, { clientId: string; items: { uuid: string; name: string }[] }>();
const lastSquadsForRemove = new Map<number, { clientId: string; items: { uuid: string; name: string }[] }>();
// Устройства (HWID): список для экрана «Удалить устройство» (индекс в callback)
const lastDevicesList = new Map<number, { devices: { hwid: string; platform?: string; deviceModel?: string }[] }>();

/** Достаём subscriptionUrl из ответа Remna */
function getSubscriptionUrl(sub: unknown): string | null {
  if (!sub || typeof sub !== "object") return null;
  const o = sub as Record<string, unknown>;
  const resp = o.response ?? o.data;
  if (resp && typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    const url = r.subscriptionUrl ?? r.subscription_url;
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  if (typeof o.subscriptionUrl === "string" && o.subscriptionUrl.trim()) return o.subscriptionUrl.trim();
  return null;
}

/** Достаём объект пользователя из ответа Remna (response или data или сам объект) */
function getSubUser(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const o = sub as Record<string, unknown>;
  const resp = o.response ?? o.data ?? o;
  const r = typeof resp === "object" && resp !== null ? (resp as Record<string, unknown>) : null;
  if (r && (r.user != null || r.expireAt != null || r.subscriptionUrl != null)) {
    const user = r.user;
    return (typeof user === "object" && user !== null ? user : r) as Record<string, unknown>;
  }
  return r;
}

function bytesToGb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

/** Прогресс-бар из символов (0..1), длина barLen */
function progressBar(pct: number, barLen: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, pct)) * barLen);
  return "█".repeat(filled) + "░".repeat(barLen - filled);
}

const DEFAULT_MENU_TEXTS: Record<string, string> = {
  welcomeTitlePrefix: "🛡 ",
  welcomeGreeting: "👋 Добро пожаловать в ",
  balancePrefix: "💰 Баланс: ",
  tariffPrefix: "💎 Ваш тариф : ",
  subscriptionPrefix: "{{CHART}} Статус подписки — ",
  statusInactive: "{{STATUS_INACTIVE}} Истекла",
  statusActive: "{{STATUS_ACTIVE}} Активна",
  statusExpired: "{{STATUS_EXPIRED}} Истекла",
  statusLimited: "{{STATUS_LIMITED}} Ограничена",
  statusDisabled: "{{STATUS_DISABLED}} Отключена",
  expirePrefix: "📅 до ",
  daysLeftPrefix: "⏰ осталось ",
  devicesLabel: "📱 Устройств: ",
  devicesAvailable: " доступно",
  trafficPrefix: "📈 Трафик — ",
  linkLabel: "🔗 Ссылка подключения:",
  chooseAction: "Выберите действие:",
};

const DEFAULT_TARIFFS_TEXT = "Тарифы\n\n{{CATEGORY}}\n{{TARIFFS}}\n\nВыберите тариф для оплаты:";
const DEFAULT_PAYMENT_TEXT = "Оплата: {{NAME}} — {{PRICE}}\n\n{{ACTION}}";

type BotTariffLineFields = {
  name?: boolean;
  durationDays?: boolean;
  price?: boolean;
  currency?: boolean;
  trafficLimit?: boolean;
  trafficResetMode?: boolean;
  deviceLimit?: boolean;
};

const DEFAULT_TARIFF_LINE_FIELDS: Required<BotTariffLineFields> = {
  name: true,
  durationDays: false,
  price: true,
  currency: true,
  trafficLimit: false,
  trafficResetMode: false,
  deviceLimit: false,
};

function formatDaysRu(days: number): string {
  const full = _formatDays(days, "ru");
  return full.replace(/^\d+\s*/, "");
}

const RESET_MODE_LABELS: Record<string, string> = {
  no_reset: "",
  on_purchase: "сброс при покупке",
  monthly: "сброс ежемесячно",
  monthly_rolling: "скользящий месяц",
};

function formatTariffLine(tariff: TariffItem, fields: Required<BotTariffLineFields>): string {
  const parts: string[] = [];
  if (fields.name) parts.push(tariff.name);
  if (fields.durationDays) parts.push(`${tariff.durationDays} ${formatDaysRu(tariff.durationDays)}`);
  if (fields.price) {
    const pricePart = fields.currency ? `${tariff.price} ${tariff.currency}` : `${tariff.price}`;
    parts.push(pricePart);
  } else if (fields.currency) {
    parts.push(`${tariff.currency}`);
  }
  if (fields.trafficLimit) {
    const limit = tariff.trafficLimitBytes;
    parts.push(limit == null ? "трафик без лимита" : `трафик ${bytesToGb(limit)} GB`);
  }
  if (fields.trafficResetMode) {
    const label = RESET_MODE_LABELS[tariff.trafficResetMode ?? "no_reset"];
    if (label) parts.push(label);
  }
  if (fields.deviceLimit) {
    const limit = tariff.deviceLimit;
    parts.push(limit == null ? "устройства без лимита" : `устройства ${limit}`);
  }
  if (!parts.length) return `• ${tariff.name}`;
  return `• ${parts.join(" — ")}`;
}

function renderTariffsText(template: string, category: string, tariffLines: string): string {
  return template
    .split("{{CATEGORY}}").join(category)
    .split("{{TARIFFS}}").join(tariffLines);
}

function renderPaymentText(
  template: string,
  vars: { name: string; price: string; amount: string; currency: string; action: string }
): string {
  return template
    .split("{{NAME}}").join(vars.name)
    .split("{{PRICE}}").join(vars.price)
    .split("{{AMOUNT}}").join(vars.amount)
    .split("{{CURRENCY}}").join(vars.currency)
    .split("{{ACTION}}").join(vars.action);
}

function buildPaymentMessage(
  config: Awaited<ReturnType<typeof api.getPublicConfig>> | null | undefined,
  vars: { name: string; price: string; amount: string; currency: string; action: string },
  discount?: { originalPrice: string; discountedPrice: string }
): { text: string; entities: CustomEmojiEntity[] } {
  const priceDisplay = discount
    ? `${discount.originalPrice} → ${discount.discountedPrice}`
    : vars.price;
  const template = (config?.botPaymentText ?? "").trim() || DEFAULT_PAYMENT_TEXT;
  const base = renderPaymentText(template, { ...vars, price: priceDisplay });
  const result = applyCustomEmojiPlaceholders(base, config?.botEmojis);
  if (discount) {
    const pos = result.text.indexOf(priceDisplay);
    if (pos >= 0) {
      result.entities.push(
        { type: "strikethrough", offset: pos, length: discount.originalPrice.length },
        { type: "bold", offset: pos + discount.originalPrice.length + 3, length: discount.discountedPrice.length },
      );
    }
  }
  return result;
}

function t(texts: Record<string, string> | null | undefined, key: string): string {
  return (texts?.[key] ?? DEFAULT_MENU_TEXTS[key]) || "";
}

type CustomEmojiEntity =
  | { type: "custom_emoji"; offset: number; length: number; custom_emoji_id: string }
  | { type: "strikethrough"; offset: number; length: number }
  | { type: "bold"; offset: number; length: number };

/** Длина первого символа в UTF-16 (для entity) */
function firstCharLengthUtf16(s: string): number {
  if (!s.length) return 0;
  const cp = s.codePointAt(0);
  return cp != null && cp > 0xffff ? 2 : 1;
}

const DEFAULT_EMOJI_UNICODE: Record<string, string> = {
  PACKAGE: "📦", TARIFFS: "📦", CARD: "💳", LINK: "🔗", PUZZLE: "👤", PROFILE: "👤",
  TRIAL: "🎁", SERVERS: "🌐", CONNECT: "🌐",
  CHART: "📊",
  STATUS_ACTIVE: "🟡", STATUS_EXPIRED: "🔴", STATUS_INACTIVE: "🔴",
  STATUS_LIMITED: "🟡", STATUS_DISABLED: "🔴",
};
const DEFAULT_CUSTOM_EMOJI_CHAR = "🙂";

const DEFAULT_MENU_EMOJI_KEY_BY_ID: Record<string, string> = {
  tariffs: "PACKAGE",
  proxy: "SERVERS",
  my_proxy: "SERVERS",
  singbox: "SERVERS",
  my_singbox: "SERVERS",
  profile: "PUZZLE",
  devices: "DEVICES",
  topup: "CARD",
  referral: "LINK",
  trial: "TRIAL",
  vpn: "SERVERS",
  cabinet: "SERVERS",
  support: "NOTE",
  tickets: "NOTE",
  promocode: "STAR",
  extra_options: "PACKAGE",
};

function getMenuEmojiKey(
  config: Awaited<ReturnType<typeof api.getPublicConfig>> | null | undefined,
  menuId: string
): string | null | undefined {
  const btn = config?.botButtons?.find((b) => b.id === menuId);
  if (btn && btn.emojiKey === "") return null;
  return btn?.emojiKey || DEFAULT_MENU_EMOJI_KEY_BY_ID[menuId];
}

/** Заголовок с эмодзи: если в botEmojis есть tgEmojiId для ключа — добавляем entity (премиум-эмодзи в тексте). */
function titleWithEmoji(
  emojiKey: string,
  rest: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  const entry = botEmojis?.[emojiKey];
  const unicode = entry?.unicode?.trim() || DEFAULT_EMOJI_UNICODE[emojiKey] || "•";
  const space = rest.startsWith("\n") ? "" : " ";
  const text = unicode + space + rest;
  const entities: CustomEmojiEntity[] = [];
  if (entry?.tgEmojiId) {
    const len = firstCharLengthUtf16(unicode);
    if (len > 0) entities.push({ type: "custom_emoji", offset: 0, length: len, custom_emoji_id: entry.tgEmojiId });
  }
  return { text, entities };
}

function applyCustomEmojiPlaceholders(
  text: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  if (!text) return { text, entities: [] };
  const entities: CustomEmojiEntity[] = [];
  const re = /\{\{([A-Z0-9_]+)\}\}/g;
  let out = "";
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const key = match[1]!;
    out += text.slice(lastIdx, match.index);
    const entry = botEmojis?.[key];
    const fallbackUnicode = DEFAULT_EMOJI_UNICODE[key];
    const unicode = entry?.unicode?.trim() || (entry?.tgEmojiId ? DEFAULT_CUSTOM_EMOJI_CHAR : "") || fallbackUnicode || "";
    if (unicode) {
      const offset = out.length;
      out += unicode;
      if (entry?.tgEmojiId) {
        entities.push({ type: "custom_emoji", offset, length: unicode.length, custom_emoji_id: entry.tgEmojiId });
      }
    } else {
      out += match[0];
    }
    lastIdx = match.index + match[0].length;
  }
  out += text.slice(lastIdx);
  return { text: out, entities };
}

function titleWithEmojiAndCustomEmojis(
  emojiKey: string,
  rest: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  const entry = botEmojis?.[emojiKey];
  const unicode = entry?.unicode?.trim() || DEFAULT_EMOJI_UNICODE[emojiKey] || "•";
  const space = rest.startsWith("\n") ? "" : " ";
  const leading = unicode + space;
  const { text: restText, entities: restEntities } = applyCustomEmojiPlaceholders(rest, botEmojis);
  const entities: CustomEmojiEntity[] = [];
  if (entry?.tgEmojiId) {
    const len = firstCharLengthUtf16(unicode);
    if (len > 0) entities.push({ type: "custom_emoji", offset: 0, length: len, custom_emoji_id: entry.tgEmojiId });
  }
  for (const e of restEntities) {
    entities.push({ ...e, offset: e.offset + leading.length });
  }
  return { text: leading + restText, entities };
}

function titleWithOptionalEmoji(
  emojiKey: string | null | undefined,
  rest: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  if (!emojiKey) return applyCustomEmojiPlaceholders(rest, botEmojis);
  return titleWithEmojiAndCustomEmojis(emojiKey, rest, botEmojis);
}

/** Полный текст главного меню + entities для премиум-эмодзи в тексте (владелец бота должен иметь Telegram Premium). */
function buildMainMenuText(opts: {
  serviceName: string;
  balance: number;
  currency: string;
  subscription: unknown;
  /** Отображаемое имя тарифа с бэкенда: Триал, название с сайта или «Тариф не выбран» */
  tariffDisplayName?: string | null;
  menuTexts?: Record<string, string> | null;
  menuLineVisibility?: Record<string, boolean> | null;
  menuTextCustomEmojiIds?: Record<string, string> | null;
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null;
}): { text: string; entities: CustomEmojiEntity[] } {
  const { serviceName, balance, currency, subscription, tariffDisplayName, menuTexts, menuLineVisibility, menuTextCustomEmojiIds, botEmojis } = opts;
  const name = serviceName.trim() || "Кабинет";
  const balanceStr = formatMoney(balance, currency);
  const lines: string[] = [];
  const lineStartKeys: (string | null)[] = [];
  const lineEntitiesByIndex: CustomEmojiEntity[][] = [];
  const shouldShow = (key: string) => menuLineVisibility?.[key] !== false;
  const pushLine = (key: string, text: string) => {
    if (!shouldShow(key)) return;
    const { text: processed, entities } = applyCustomEmojiPlaceholders(text, botEmojis);
    lines.push(processed);
    lineStartKeys.push(key);
    lineEntitiesByIndex.push(entities);
  };

  pushLine("welcomeGreeting", t(menuTexts, "welcomeGreeting"));
  pushLine("welcomeTitlePrefix", t(menuTexts, "welcomeTitlePrefix") + name);
  pushLine("balancePrefix", t(menuTexts, "balancePrefix") + balanceStr);

  const user = getSubUser(subscription);
  const url = getSubscriptionUrl(subscription);
  const tariffName = (tariffDisplayName && tariffDisplayName.trim()) || "Тариф не выбран";
  pushLine("tariffPrefix", t(menuTexts, "tariffPrefix") + tariffName);

  if (!user && !url) {
    pushLine("subscriptionPrefix", t(menuTexts, "subscriptionPrefix") + t(menuTexts, "statusInactive"));
    pushLine("trafficPrefix", t(menuTexts, "trafficPrefix") + " 0.00 GB");
    pushLine("chooseAction", t(menuTexts, "chooseAction"));
  } else {
    const expireAt = user?.expireAt ?? user?.expirationDate ?? user?.expire_at;
    let expireDate: Date | null = null;
    if (expireAt != null) {
      const d = typeof expireAt === "number" ? new Date(expireAt * 1000) : new Date(String(expireAt));
      if (!Number.isNaN(d.getTime())) expireDate = d;
    }
    const status = (user?.status ?? user?.userStatus ?? "ACTIVE") as string;
    const statusLabel =
      status === "ACTIVE" ? t(menuTexts, "statusActive")
      : status === "EXPIRED" ? t(menuTexts, "statusExpired")
      : status === "LIMITED" ? t(menuTexts, "statusLimited")
      : status === "DISABLED" ? t(menuTexts, "statusDisabled")
      : `🟡 ${status}`;
    const expireStr = expireDate
      ? expireDate.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";
    const daysLeft =
      expireDate && expireDate > new Date()
        ? Math.max(0, Math.ceil((expireDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
        : null;

    pushLine("subscriptionPrefix", t(menuTexts, "subscriptionPrefix") + statusLabel);
    pushLine("expirePrefix", t(menuTexts, "expirePrefix") + expireStr);
    if (daysLeft != null) {
      pushLine("daysLeftPrefix", t(menuTexts, "daysLeftPrefix") + `${daysLeft} ${daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"}`);
    }
    const deviceLimit = user?.hwidDeviceLimit ?? user?.deviceLimit ?? user?.device_limit;
    const devicesUsed = user?.devicesUsed ?? user?.devices_used;
    if (deviceLimit != null && typeof deviceLimit === "number") {
      const available = devicesUsed != null ? Math.max(0, deviceLimit - Number(devicesUsed)) : deviceLimit;
      pushLine("devicesLabel", t(menuTexts, "devicesLabel") + available + t(menuTexts, "devicesAvailable"));
    }
    const trafficUsedBytes =
      (user?.userTraffic as { usedTrafficBytes?: number } | undefined)?.usedTrafficBytes ??
      user?.trafficUsedBytes ??
      user?.usedTrafficBytes ??
      user?.traffic_used_bytes;
    const trafficLimitBytes = user?.trafficLimitBytes ?? user?.traffic_limit_bytes;
    const usedNum = typeof trafficUsedBytes === "string" ? parseFloat(trafficUsedBytes) : Number(trafficUsedBytes);
    const limitNum = typeof trafficLimitBytes === "string" ? parseFloat(trafficLimitBytes) : Number(trafficLimitBytes);
    if (Number.isFinite(usedNum) && Number.isFinite(limitNum) && limitNum > 0) {
      const pct = usedNum / limitNum;
      const usedGb = bytesToGb(usedNum);
      const limitGb = bytesToGb(limitNum);
      const pctInt = Math.round(Math.min(100, pct * 100));
      pushLine("trafficPrefix", t(menuTexts, "trafficPrefix") + `🟢 ${progressBar(pct, 14)} ${pctInt}% (${usedGb} / ${limitGb} GB)`);
    } else if (Number.isFinite(usedNum)) {
      pushLine("trafficPrefix", t(menuTexts, "trafficPrefix") + ` ${bytesToGb(usedNum)} GB`);
    } else {
      pushLine("trafficPrefix", t(menuTexts, "trafficPrefix") + " 0.00 GB");
    }
    if (url) {
      if (shouldShow("linkLabel")) {
        const { text: label, entities } = applyCustomEmojiPlaceholders(t(menuTexts, "linkLabel"), botEmojis);
        lines.push(label, url);
        lineStartKeys.push("linkLabel", null);
        lineEntitiesByIndex.push(entities, []);
      }
    }
    pushLine("chooseAction", t(menuTexts, "chooseAction"));
  }

  const text = lines.join("\n");
  const entities: CustomEmojiEntity[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineEntities = lineEntitiesByIndex[i] ?? [];
    for (const e of lineEntities) {
      entities.push({ ...e, offset: e.offset + offset });
    }
    const key = lineStartKeys[i];
    if (key && menuTextCustomEmojiIds?.[key] && !lineEntities.some((e) => e.offset === 0)) {
      const line = lines[i]!;
      const firstLen = firstCharLengthUtf16(line);
      if (firstLen > 0) entities.push({ type: "custom_emoji", offset, length: firstLen, custom_emoji_id: menuTextCustomEmojiIds[key]! });
    }
    offset += lines[i]!.length + 1;
  }
  return { text, entities };
}

const TELEGRAM_CAPTION_MAX = 1024;

/** Логотип из настроек: data URL или URL → источник для sendPhoto/sendAnimation и признак GIF */
function logoToMediaSource(logo: string | null | undefined): { source: InputFile | string; isGif: boolean } | null {
  if (!logo || !logo.trim()) return null;
  const s = logo.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) {
    const isGif = /\.gif(\?|$)/i.test(s);
    return { source: s, isGif };
  }
  const base64Match = /^data:image\/([a-z]+);base64,(.+)$/i.exec(s);
  if (base64Match) {
    try {
      const subtype = (base64Match[1] ?? "").toLowerCase();
      const buf = Buffer.from(base64Match[2]!, "base64");
      if (buf.length > 0) {
        const isGif = subtype === "gif";
        const name = isGif ? "logo.gif" : "logo.png";
        return { source: new InputFile(buf, name), isGif };
      }
    } catch {
      return null;
    }
  }
  try {
    const buf = Buffer.from(s, "base64");
    if (buf.length > 0) return { source: new InputFile(buf, "logo.png"), isGif: false };
  } catch {
    // ignore
  }
  return null;
}

/** Редактировать сообщение: текст и клавиатура (если с фото/анимацией — caption, иначе text) */
async function editMessageContent(ctx: {
  editMessageCaption: (opts: { caption: string; caption_entities?: CustomEmojiEntity[]; reply_markup?: InlineMarkup }) => Promise<unknown>;
  editMessageText: (text: string, opts?: { entities?: CustomEmojiEntity[]; reply_markup?: InlineMarkup }) => Promise<unknown>;
  deleteMessage: () => Promise<unknown>;
  chat?: { id: number };
  callbackQuery?: { message?: { photo?: unknown[]; animation?: unknown; video?: unknown } };
}, text: string, reply_markup: InlineMarkup, entities?: CustomEmojiEntity[]): Promise<unknown> {
  const msg = ctx.callbackQuery?.message;
  const hasPhoto = msg && typeof msg === "object" && "photo" in msg && Array.isArray((msg as { photo: unknown[] }).photo) && (msg as { photo: unknown[] }).photo.length > 0;
  const hasAnimation = msg && typeof msg === "object" && "animation" in msg && (msg as { animation: unknown }).animation != null;
  const hasVideo = msg && typeof msg === "object" && "video" in msg && (msg as { video: unknown }).video != null;
  if (hasVideo && ctx.chat?.id) {
    await ctx.deleteMessage().catch(() => {});
    return bot.api.sendMessage(ctx.chat.id, text, { entities: entities?.length ? entities : undefined, reply_markup });
  }
  const hasMediaWithCaption = hasPhoto || hasAnimation;
  const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
  const truncatedEntities = text.length > TELEGRAM_CAPTION_MAX && entities ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
  if (hasMediaWithCaption) return ctx.editMessageCaption({ caption, caption_entities: truncatedEntities?.length ? truncatedEntities : undefined, reply_markup });
  return ctx.editMessageText(text, { entities: entities?.length ? entities : undefined, reply_markup });
}

function formatMoney(amount: number, currency: string): string {
  const c = currency.toUpperCase();
  const sym = c === "RUB" ? "₽" : c === "USD" ? "$" : "₴";
  return `${amount} ${sym}`;
}

/** Рассчитать цену со скидкой */
function getDiscountedPrice(price: number, discount: DiscountInfo): number {
  let final = price;
  if (discount.discountPercent && discount.discountPercent > 0) final -= final * discount.discountPercent / 100;
  if (discount.discountFixed && discount.discountFixed > 0) final -= discount.discountFixed;
  return Math.max(0, Math.round(final * 100) / 100);
}

/**
 * Парсинг start-параметра.
 * Новый формат (через __): ref_CODE__s_SOURCE__m_MEDIUM__k_CAMPAIGN__n_CONTENT__t_TERM
 * Старый формат (через _c_): ref_CODE_c_SOURCE_CAMPAIGN
 */
function parseStartPayload(payload: string): {
  refCode?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
} {
  const out: ReturnType<typeof parseStartPayload> = {};

  if (payload.includes("__")) {
    const segments = payload.split("__");
    for (const seg of segments) {
      if (seg.startsWith("ref_")) out.refCode = seg.slice(4);
      else if (seg.startsWith("s_")) out.utm_source = seg.slice(2);
      else if (seg.startsWith("m_")) out.utm_medium = seg.slice(2);
      else if (seg.startsWith("k_")) out.utm_campaign = seg.slice(2);
      else if (seg.startsWith("n_")) out.utm_content = seg.slice(2);
      else if (seg.startsWith("t_")) out.utm_term = seg.slice(2);
    }
    return out;
  }

  const cIdx = payload.indexOf("_c_");
  const refPart = cIdx >= 0 ? payload.slice(0, cIdx) : payload;
  const campaignPart = cIdx >= 0 ? payload.slice(cIdx + 3) : "";
  if (refPart && /^ref_?/i.test(refPart)) {
    const code = refPart.replace(/^ref_?/i, "").trim();
    if (code) out.refCode = code;
  }
  if (campaignPart) {
    const parts = campaignPart.split("_").filter(Boolean);
    if (parts.length >= 2) {
      out.utm_source = parts[0];
      out.utm_campaign = parts.length === 2 ? parts[1] : parts[parts.length - 1];
      if (parts.length >= 3) out.utm_medium = parts.slice(1, -1).join("_");
    }
  }
  return out;
}

// ——— /start с реферальным кодом (например /start ref_ABC123) или промо (/start promo_XXXX) или кампания (/start c_facebook_summer)
bot.command("start", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const telegramId = String(from.id);
  const telegramUsername = from.username ?? undefined;
  const payload = ctx.match?.trim() || "";

  // Сбрасываем состояние рассылки, чтобы баннер/фото не «залипало»
  lastBroadcastMessage.delete(from.id);
  awaitingBroadcastMessage.delete(from.id);

  // Deep-link авторизация на сайте: /start auth_TOKEN
  if (/^auth_/i.test(payload)) {
    const lang = getUserLang(from.id);
    const authToken = payload.replace(/^auth_/i, "");
    if (!authToken) {
      await ctx.reply(_t("auth.invalid_link", lang));
      return;
    }
    try {
      await api.confirmTelegramAuth(authToken, from.id, telegramUsername);
      await ctx.reply(_t("auth.confirmed", lang));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : _t("unknown_error", lang);
      console.error("[/start auth_] confirm error:", msg);
      if (msg.includes("expired") || msg.includes("410")) {
        await ctx.reply(_t("auth.expired", lang));
      } else if (msg.includes("already confirmed") || msg.includes("409")) {
        await ctx.reply(_t("auth.already_used", lang));
      } else {
        await ctx.reply(_t("auth_error_start", lang));
      }
    }
    return;
  }

  // Определяем тип deeplink
  const isPromo = /^promo_/i.test(payload);
  const isCode = /^code_/i.test(payload);
  const promoCode = isPromo ? payload.replace(/^promo_/i, "") : undefined;
  const codeValue = isCode ? payload.replace(/^code_/i, "") : undefined;
  const parsed = parseStartPayload(payload);
  const refCode = (!isPromo && !isCode) ? (parsed.refCode ?? (payload.replace(/^ref_?/i, "").trim() || undefined)) : undefined;

  try {
    const config = await api.getPublicConfig();
    if (config?.translations) setTranslations(config.translations);
    const name = config?.serviceName?.trim() || "Кабинет";

    const auth = await api.registerByTelegram({
      telegramId,
      telegramUsername,
      preferredLang: config?.defaultLanguage ?? "ru",
      preferredCurrency: config?.defaultCurrency ?? "usd",
      referralCode: refCode,
      utm_source: parsed.utm_source,
      utm_medium: parsed.utm_medium,
      utm_campaign: parsed.utm_campaign,
      utm_content: parsed.utm_content,
      utm_term: parsed.utm_term,
    });

    setToken(from.id, auth.token);
    const client = auth.client;
    if (client?.preferredLang) setUserLang(from.id, client.preferredLang);

    // Если это промо-ссылка — активируем промо-группу
    if (promoCode) {
      try {
        const result = await api.activatePromo(auth.token, promoCode);
        await ctx.reply(`✅ ${result.message}\n\nНажмите /start чтобы открыть меню.`);
        return;
      } catch (promoErr: unknown) {
        const promoMsg = promoErr instanceof Error ? promoErr.message : "Ошибка активации промокода";
        await ctx.reply(`❌ ${promoMsg}\n\nНажмите /start чтобы открыть меню.`);
        return;
      }
    }

    // Если это deep link с промокодом — активируем промокод
    if (codeValue) {
      const lang = getUserLang(from.id);
      const menuKb = { reply_markup: { inline_keyboard: [[{ text: config?.botBackLabel ?? _t("back_to_menu", lang), callback_data: "menu:main" }]] } };
      try {
        const checkResult = await api.checkPromoCode(auth.token, codeValue);
        if (checkResult.type === "FREE_DAYS") {
          const activateResult = await api.activatePromoCode(auth.token, codeValue);
          await ctx.reply(`✅ ${activateResult.message}`, menuKb);
        } else if (checkResult.type === "DISCOUNT") {
          const desc = checkResult.discountPercent
            ? `скидка ${checkResult.discountPercent}%`
            : checkResult.discountFixed
              ? `скидка ${checkResult.discountFixed}`
              : "скидка";
          activeDiscountCode.set(from.id, { code: codeValue, discountPercent: checkResult.discountPercent, discountFixed: checkResult.discountFixed });
          await ctx.reply(`✅ Промокод «${checkResult.name}» принят! ${desc}.\n\n${_t("promo.discount_applied", lang)}`, menuKb);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : _t("error_generic", lang);
        await ctx.reply(`❌ ${msg}`, menuKb);
      }
      return;
    }

    // Проверка подписки на канал
    if (await enforceSubscription(ctx, config)) return;

    const [subRes, proxyRes, singboxRes] = await Promise.all([
      api.getSubscription(auth.token).catch(() => ({ subscription: null })),
      api.getPublicProxyTariffs().catch(() => ({ items: [] })),
      api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
    ]);
    const vpnUrl = getSubscriptionUrl(subRes.subscription);
    const showTrial = Boolean(config?.trialEnabled && !client?.trialUsed);
    const showProxy = proxyRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
    const showSingbox = singboxRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
    const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;

    const { text, entities } = buildMainMenuText({
      serviceName: name,
      balance: client?.balance ?? 0,
      currency: client?.preferredCurrency ?? config?.defaultCurrency ?? "usd",
      subscription: subRes.subscription,
      tariffDisplayName: (subRes as { tariffDisplayName?: string | null }).tariffDisplayName ?? null,
      menuTexts: config?.botMenuTexts ?? config?.resolvedBotMenuTexts ?? null,
      menuLineVisibility: config?.botMenuLineVisibility ?? null,
      menuTextCustomEmojiIds: config?.menuTextCustomEmojiIds ?? null,
      botEmojis: config?.botEmojis ?? null,
    });
    const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
    const captionEntities = text.length > TELEGRAM_CAPTION_MAX && entities.length ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
    const hasVideoInstructions = config?.videoInstructionsEnabled && (config?.videoInstructions?.length ?? 0) > 0;
    const hasSupportLinks = !!(config?.supportLink || config?.agreementLink || config?.offerLink || config?.instructionsLink || hasVideoInstructions);
    const markup = mainMenu({
      showTrial,
      showVpn: Boolean(vpnUrl),
      showProxy,
      showSingbox,
      showGift: config?.giftSubscriptionsEnabled === true,
      appUrl,
      botButtons: config?.botButtons ?? null,
      botBackLabel: config?.botBackLabel ?? null,
      hasSupportLinks,
      showTickets: config?.ticketsEnabled === true,
      showExtraOptions: config?.sellOptionsEnabled === true && (config?.sellOptions?.length ?? 0) > 0,
      buttonsPerRow: config?.botButtonsPerRow ?? 1,
      remnaSubscriptionUrl: config?.useRemnaSubscriptionPage ? vpnUrl : null,
    });
    const isBotAdmin = config?.botAdminTelegramIds?.includes(String(from.id)) ?? false;
    if (isBotAdmin) {
      markup.inline_keyboard.push([{ text: "⚙️ Панель админа", callback_data: "admin:menu" }]);
    }

    const media = logoToMediaSource(config?.logoBot);
    if (media) {
      const opts = { caption, caption_entities: captionEntities.length ? captionEntities : undefined, reply_markup: markup };
      if (media.isGif) {
        await ctx.replyWithAnimation(media.source, opts);
      } else {
        await ctx.replyWithPhoto(media.source, opts);
      }
    } else {
      await ctx.reply(text, { entities: entities.length ? entities : undefined, reply_markup: markup });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка входа";
    await ctx.reply(`❌ ${msg}`);
  }
});

// ——— /link КОД — привязка Telegram к аккаунту (код из кабинета на сайте)
bot.command("link", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const lang = getUserLang(from.id);
  const code = (ctx.match?.trim() || "").replace(/\s+/g, " ");
  if (!code) {
    await ctx.reply(_t("link.prompt", lang));
    return;
  }
  try {
    await api.linkTelegramFromBot(code, from.id, from.username ?? undefined);
    await ctx.reply(_t("link.success", lang));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : _t("error_generic", lang);
    await ctx.reply(`❌ ${msg}`);
  }
});

// ——— Callback: меню и действия
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from?.id;
  if (!userId) return;
  await ctx.answerCallbackQuery().catch(() => {});

  // Админ-панель в боте (не требует токена пользователя)
  if (data.startsWith("admin:")) {
    const config = await api.getPublicConfig();
    if (!config?.botAdminTelegramIds?.includes(String(userId))) {
      await ctx.answerCallbackQuery({ text: "Доступ запрещён", show_alert: true }).catch(() => {});
      return;
    }
    if (data === "admin:menu") {
      lastAdminSearch.delete(userId);
      awaitingAdminSearch.delete(userId);
      awaitingAdminBalance.delete(userId);
      awaitingBroadcastMessage.delete(userId);
      lastBroadcastMessage.delete(userId);
      lastSquadsForAdd.delete(userId);
      lastSquadsForRemove.delete(userId);
      const markup: InlineMarkup = {
        inline_keyboard: [
          [{ text: "📊 Статистика", callback_data: "admin:stats" }],
          [{ text: "🔔 Уведомления", callback_data: "admin:notifications" }],
          [{ text: "👥 Клиенты", callback_data: "admin:clients:1" }],
          [{ text: "🔍 Поиск пользователя", callback_data: "admin:search" }],
          [
            { text: "💳 Ожидают оплаты", callback_data: "admin:payments:pending:1" },
            { text: "💰 Последние платежи", callback_data: "admin:payments:paid:1" },
          ],
          [{ text: "📢 Рассылка", callback_data: "admin:broadcast" }],
          [{ text: "◀️ В меню", callback_data: "menu:main" }],
        ],
      };
      await editMessageContent(ctx, "⚙️ Панель админа\n\nВыберите раздел:", markup);
      return;
    }
    if (data === "admin:notifications") {
      const settings = await api.getBotAdminNotificationSettings(userId);
      const s = settings;
      const yesNo = (v: boolean) => (v ? "Вкл" : "Выкл");
      const text =
        "🔔 Настройки уведомлений\n\n" +
        `Пополнение баланса: ${yesNo(s.notifyBalanceTopup)}\n` +
        `Оплата тарифов: ${yesNo(s.notifyTariffPayment)}\n` +
        `Новые клиенты: ${yesNo(s.notifyNewClient)}\n` +
        `Новые тикеты: ${yesNo(s.notifyNewTicket)}\n\n` +
        "Нажмите на пункт ниже, чтобы переключить.";
      const markup: InlineMarkup = {
        inline_keyboard: [
          [{ text: `💰 Пополнение баланса: ${yesNo(s.notifyBalanceTopup)}`, callback_data: "admin:notif:balance" }],
          [{ text: `📦 Оплата тарифов: ${yesNo(s.notifyTariffPayment)}`, callback_data: "admin:notif:tariff" }],
          [{ text: `👤 Новые клиенты: ${yesNo(s.notifyNewClient)}`, callback_data: "admin:notif:newclient" }],
          [{ text: `🎫 Новые тикеты: ${yesNo(s.notifyNewTicket)}`, callback_data: "admin:notif:newticket" }],
          [{ text: "◀️ В админку", callback_data: "admin:menu" }],
        ],
      };
      await editMessageContent(ctx, text, markup);
      return;
    }
    if (data.startsWith("admin:notif:")) {
      const kind = data.slice("admin:notif:".length);
      const current = await api.getBotAdminNotificationSettings(userId);
      const payload: Partial<api.BotAdminNotificationSettings> = {};
      if (kind === "balance") {
        payload.notifyBalanceTopup = !current.notifyBalanceTopup;
      } else if (kind === "tariff") {
        payload.notifyTariffPayment = !current.notifyTariffPayment;
      } else if (kind === "newclient") {
        payload.notifyNewClient = !current.notifyNewClient;
      } else if (kind === "newticket") {
        payload.notifyNewTicket = !current.notifyNewTicket;
      }
      const updated = await api.patchBotAdminNotificationSettings(userId, payload);
      const s = updated;
      const yesNo = (v: boolean) => (v ? "Вкл" : "Выкл");
      const text =
        "🔔 Настройки уведомлений\n\n" +
        `Пополнение баланса: ${yesNo(s.notifyBalanceTopup)}\n` +
        `Оплата тарифов: ${yesNo(s.notifyTariffPayment)}\n` +
        `Новые клиенты: ${yesNo(s.notifyNewClient)}\n` +
        `Новые тикеты: ${yesNo(s.notifyNewTicket)}\n\n` +
        "Нажмите на пункт ниже, чтобы переключить.";
      const markup: InlineMarkup = {
        inline_keyboard: [
          [{ text: `💰 Пополнение баланса: ${yesNo(s.notifyBalanceTopup)}`, callback_data: "admin:notif:balance" }],
          [{ text: `📦 Оплата тарифов: ${yesNo(s.notifyTariffPayment)}`, callback_data: "admin:notif:tariff" }],
          [{ text: `👤 Новые клиенты: ${yesNo(s.notifyNewClient)}`, callback_data: "admin:notif:newclient" }],
          [{ text: `🎫 Новые тикеты: ${yesNo(s.notifyNewTicket)}`, callback_data: "admin:notif:newticket" }],
          [{ text: "◀️ В админку", callback_data: "admin:menu" }],
        ],
      };
      await editMessageContent(ctx, text, markup);
      return;
    }
    if (data === "admin:search") {
      awaitingAdminSearch.add(userId);
      await editMessageContent(
        ctx,
        "🔍 Поиск пользователя\n\nВведите Telegram ID, @username или email:",
        { inline_keyboard: [[{ text: "◀️ Отмена", callback_data: "admin:menu" }]] }
      );
      return;
    }
    if (data === "admin:stats") {
      const stats = await api.getBotAdminStats(userId);
      const u = stats.users;
      const s = stats.sales;
      const text =
        `📊 Статистика\n\n👥 Пользователи: ${u.total}\nС Remna: ${u.withRemna}\nНовых за 7 дн.: ${u.newLast7Days}\nНовых за 30 дн.: ${u.newLast30Days}\n\n` +
        `💰 Продажи (всего): ${s.totalAmount} ₽ (${s.totalCount})\nЗа 7 дн.: ${s.last7DaysAmount} ₽ (${s.last7DaysCount})\nЗа 30 дн.: ${s.last30DaysAmount} ₽ (${s.last30DaysCount})`;
      const back: InlineMarkup = { inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]] };
      await editMessageContent(ctx, text, back);
      return;
    }
    if (data.startsWith("admin:clients:")) {
      const suffix = data.slice("admin:clients:".length);
      if (suffix === "clear") {
        lastAdminSearch.delete(userId);
        // Показать первую страницу без поиска
        const { items, total, limit } = await api.getBotAdminClients(userId, 1);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        let msg = `👥 Клиенты (${total})\n\n`;
        items.forEach((c, i) => {
          const label = c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8);
          msg += `${i + 1}. ${label} ${c.isBlocked ? "🚫" : ""}\n`;
        });
        msg += `\nСтр. 1/${totalPages}`;
        const rows: InlineMarkup["inline_keyboard"] = [];
        items.forEach((c) => {
          rows.push([
            {
              text: `${c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8)} ${c.isBlocked ? "🚫" : ""}`,
              callback_data: `admin:client:${c.id}`,
            },
          ]);
        });
        const nav: InlineMarkup["inline_keyboard"][0] = [];
        nav.push({ text: "◀️ В админку", callback_data: "admin:menu" });
        if (totalPages > 1) nav.push({ text: "Вперёд ▶", callback_data: "admin:clients:2" });
        rows.push(nav);
        await editMessageContent(ctx, msg, { inline_keyboard: rows });
        return;
      }
      const page = parseInt(suffix, 10) || 1;
      const search = lastAdminSearch.get(userId);
      const { items, total, limit } = await api.getBotAdminClients(userId, page, search);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      let msg = search ? `👥 Поиск «${search}» (${total})\n\n` : `👥 Клиенты (${total})\n\n`;
      items.forEach((c, i) => {
        const label = c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8);
        msg += `${(page - 1) * limit + i + 1}. ${label} ${c.isBlocked ? "🚫" : ""}\n`;
      });
      msg += `\nСтр. ${page}/${totalPages}`;
      const rows: InlineMarkup["inline_keyboard"] = [];
      items.forEach((c) => {
        rows.push([
          {
            text: `${c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8)} ${c.isBlocked ? "🚫" : ""}`,
            callback_data: `admin:client:${c.id}`,
          },
        ]);
      });
      const nav: InlineMarkup["inline_keyboard"][0] = [];
      if (page > 1) nav.push({ text: "◀ Назад", callback_data: `admin:clients:${page - 1}` });
      nav.push({ text: "◀️ В админку", callback_data: "admin:menu" });
      if (search) nav.push({ text: "✖ Сбросить поиск", callback_data: "admin:clients:clear" });
      if (page < totalPages) nav.push({ text: "Вперёд ▶", callback_data: `admin:clients:${page + 1}` });
      rows.push(nav);
      await editMessageContent(ctx, msg, { inline_keyboard: rows });
      return;
    }
    if (data.startsWith("admin:client:")) {
      const clientId = data.slice("admin:client:".length);
      if (!clientId) return;
      const client = await api.getBotAdminClient(userId, clientId);
      const created = client.createdAt ? new Date(client.createdAt).toLocaleString("ru-RU") : "—";
      let text = `👤 ${client.email || client.telegramUsername || client.telegramId || client.id}\n\n`;
      text += `ID: ${client.id}\nБаланс: ${client.balance}\nРефералов: ${client._count?.referrals ?? 0}\nСоздан: ${created}\n`;
      if (client.isBlocked) text += `\n🚫 Заблокирован${client.blockReason ? `: ${client.blockReason}` : ""}`;
      const kb: InlineMarkup["inline_keyboard"] = [];
      if (client.isBlocked) {
        kb.push([{ text: "✅ Разблокировать", callback_data: `admin:unblock:${client.id}` }]);
      } else {
        kb.push([{ text: "🚫 Заблокировать", callback_data: `admin:block:${client.id}` }]);
      }
      kb.push([{ text: "💵 Пополнить баланс", callback_data: `admin:balance:${client.id}` }]);
      if (client.remnawaveUuid) {
        kb.push(
          [
            { text: "🔄 Отозвать подписку", callback_data: `admin:remna:revoke:${client.id}` },
            { text: "⏸ Отключить Remna", callback_data: `admin:remna:disable:${client.id}` },
          ],
          [
            { text: "▶ Включить Remna", callback_data: `admin:remna:enable:${client.id}` },
            { text: "📊 Сбросить трафик", callback_data: `admin:remna:reset:${client.id}` },
          ],
          [
            { text: "➕ Добавить сквад", callback_data: `admin:squad:add:${client.id}` },
            { text: "➖ Убрать сквад", callback_data: `admin:squad:remove:${client.id}` },
          ]
        );
      }
      kb.push([{ text: "◀️ К списку", callback_data: "admin:clients:1" }]);
      await editMessageContent(ctx, text, { inline_keyboard: kb });
      return;
    }
    if (data.startsWith("admin:balance:")) {
      const clientId = data.slice("admin:balance:".length);
      if (!clientId) return;
      awaitingAdminBalance.set(userId, clientId);
      await editMessageContent(
        ctx,
        "💵 Пополнение баланса\n\nВведите сумму (число):",
        { inline_keyboard: [[{ text: "◀️ Отмена", callback_data: "admin:menu" }]] }
      );
      return;
    }
    if (data.startsWith("admin:remna:revoke:")) {
      const clientId = data.slice("admin:remna:revoke:".length);
      if (!clientId) return;
      try {
        await api.postBotAdminClientRemnaRevoke(userId, clientId);
        await editMessageContent(ctx, `✅ Подписка Remna отозвана для клиента.`, {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:remna:disable:")) {
      const clientId = data.slice("admin:remna:disable:".length);
      if (!clientId) return;
      try {
        await api.postBotAdminClientRemnaDisable(userId, clientId);
        await editMessageContent(ctx, "✅ Пользователь отключён в Remna.", {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:remna:enable:")) {
      const clientId = data.slice("admin:remna:enable:".length);
      if (!clientId) return;
      try {
        await api.postBotAdminClientRemnaEnable(userId, clientId);
        await editMessageContent(ctx, "✅ Пользователь включён в Remna.", {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:remna:reset:")) {
      const clientId = data.slice("admin:remna:reset:".length);
      if (!clientId) return;
      try {
        await api.postBotAdminClientRemnaResetTraffic(userId, clientId);
        await editMessageContent(ctx, "✅ Трафик сброшен.", {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:squad:add:")) {
      const rest = data.slice("admin:squad:add:".length);
      const parts = rest.split(":");
      const clientId = parts[0];
      const indexStr = parts[1];
      if (!clientId) return;
      if (indexStr !== undefined) {
        const index = parseInt(indexStr, 10);
        const stored = lastSquadsForAdd.get(userId);
        if (!stored || index < 0 || index >= stored.items.length) {
          await editMessageContent(ctx, "Сессия истекла или сквад не найден. Вернитесь к клиенту.", {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
          return;
        }
        const squadUuid = stored.items[index]!.uuid;
        try {
          await api.postBotAdminClientRemnaSquadAdd(userId, clientId, squadUuid);
          lastSquadsForAdd.delete(userId);
          await editMessageContent(ctx, `✅ Сквад «${stored.items[index]!.name}» добавлен.`, {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
        } catch (e: unknown) {
          await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
            inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:squad:add:${clientId}` }]],
          });
        }
        return;
      }
      try {
        const { items } = await api.getBotAdminRemnaSquadsInternal(userId);
        if (!items.length) {
          await editMessageContent(ctx, "Нет доступных сквадов в Remna.", {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
          return;
        }
        lastSquadsForAdd.set(userId, { clientId, items });
        const rows: InlineMarkup["inline_keyboard"] = items.slice(0, 15).map((s, i) => [
          { text: `➕ ${s.name || s.uuid.slice(0, 8)}`, callback_data: `admin:squad:add:${clientId}:${i}` },
        ]);
        rows.push([{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]);
        await editMessageContent(ctx, "Выберите сквад для добавления:", { inline_keyboard: rows });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:squad:remove:")) {
      const rest = data.slice("admin:squad:remove:".length);
      const parts = rest.split(":");
      const clientId = parts[0];
      const indexStr = parts[1];
      if (!clientId) return;
      if (indexStr !== undefined) {
        const index = parseInt(indexStr, 10);
        const stored = lastSquadsForRemove.get(userId);
        if (!stored || index < 0 || index >= stored.items.length) {
          await editMessageContent(ctx, "Сессия истекла или сквад не найден. Вернитесь к клиенту.", {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
          return;
        }
        const squadUuid = stored.items[index]!.uuid;
        try {
          await api.postBotAdminClientRemnaSquadRemove(userId, clientId, squadUuid);
          lastSquadsForRemove.delete(userId);
          await editMessageContent(ctx, `✅ Сквад «${stored.items[index]!.name}» убран.`, {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
        } catch (e: unknown) {
          await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
            inline_keyboard: [[{ text: "◀️ Назад", callback_data: `admin:squad:remove:${clientId}` }]],
          });
        }
        return;
      }
      try {
        const remna = await api.getBotAdminClientRemna(userId, clientId);
        const allSquads = await api.getBotAdminRemnaSquadsInternal(userId);
        const uuidToName = new Map(allSquads.items.map((s) => [s.uuid, s.name || s.uuid.slice(0, 8)]));
        const current = remna.activeInternalSquads.map((uuid) => ({ uuid, name: uuidToName.get(uuid) ?? uuid.slice(0, 8) }));
        if (!current.length) {
          await editMessageContent(ctx, "У пользователя нет сквадов.", {
            inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
          });
          return;
        }
        lastSquadsForRemove.set(userId, { clientId, items: current });
        const rows: InlineMarkup["inline_keyboard"] = current.slice(0, 15).map((s, i) => [
          { text: `➖ ${s.name}`, callback_data: `admin:squad:remove:${clientId}:${i}` },
        ]);
        rows.push([{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]);
        await editMessageContent(ctx, "Выберите сквад для удаления у пользователя:", { inline_keyboard: rows });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `admin:client:${clientId}` }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:payments:")) {
      const rest = data.slice("admin:payments:".length);
      const [status, pageStr] = rest.split(":");
      const page = parseInt(pageStr ?? "1", 10) || 1;
      const isPending = status === "pending";
      const { items, total, limit } = await api.getBotAdminPayments(userId, isPending ? "PENDING" : "PAID", page);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const title = isPending ? `💳 Ожидают оплаты (${total})` : `💰 Последние платежи (${total})`;
      let msg = `${title}\n\n`;
      const rows: InlineMarkup["inline_keyboard"] = [];
      items.forEach((p, i) => {
        const label = `${p.amount} ${p.currency} — ${p.clientTelegramUsername || p.clientEmail || p.clientTelegramId || "—"}`;
        msg += `${(page - 1) * limit + i + 1}. ${label}\n`;
        if (isPending) {
          rows.push([{ text: `✅ ${p.amount} ${p.currency} — отметить оплаченным`, callback_data: `admin:pay:${p.id}` }]);
        }
      });
      msg += `\nСтр. ${page}/${totalPages}`;
      const nav: InlineMarkup["inline_keyboard"][0] = [];
      if (page > 1) nav.push({ text: "◀ Назад", callback_data: `admin:payments:${status}:${page - 1}` });
      nav.push({ text: "◀️ В админку", callback_data: "admin:menu" });
      if (page < totalPages) nav.push({ text: "Вперёд ▶", callback_data: `admin:payments:${status}:${page + 1}` });
      rows.push(nav);
      await editMessageContent(ctx, msg, { inline_keyboard: rows });
      return;
    }
    if (data.startsWith("admin:pay:")) {
      const paymentId = data.slice("admin:pay:".length);
      if (!paymentId) return;
      try {
        await api.patchBotAdminPaymentMarkPaid(userId, paymentId);
        await editMessageContent(ctx, "✅ Платёж отмечен как оплаченный.", {
          inline_keyboard: [[{ text: "◀️ К платежам", callback_data: "admin:payments:pending:1" }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ Назад", callback_data: "admin:payments:pending:1" }]],
        });
      }
      return;
    }
    if (data === "admin:broadcast") {
      const counts = await api.getBotAdminBroadcastCount(userId);
      awaitingBroadcastMessage.add(userId);
      await editMessageContent(
        ctx,
        `📢 Рассылка\n\nСейчас: Telegram ${counts.withTelegram}, Email ${counts.withEmail}\n\nОтправьте текст сообщения или фото с подписью (caption):`,
        { inline_keyboard: [[{ text: "◀️ Отмена", callback_data: "admin:menu" }]] }
      );
      return;
    }
    if (data.startsWith("admin:bc:")) {
      const channel = data.slice("admin:bc:".length) as "tg" | "email" | "both";
      const raw = lastBroadcastMessage.get(userId);
      if (raw == null) {
        await editMessageContent(ctx, "Текст рассылки не найден. Начните заново.", {
          inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]],
        });
        return;
      }
      const msg: BroadcastPayload = typeof raw === "string" ? { text: raw } : raw;
      const ch: "telegram" | "email" | "both" = channel === "tg" ? "telegram" : channel === "email" ? "email" : "both";
      const channelLabel = ch === "telegram" ? "Telegram" : ch === "email" ? "Email" : "Telegram и Email";
      // Сразу показываем, что рассылка запущена, чтобы было понятно и не нажимали повторно
      await editMessageContent(ctx, `📢 Рассылка по каналу «${channelLabel}» запущена, подождите…`, {
        inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]],
      });
      lastBroadcastMessage.delete(userId);
      try {
        const result = await api.postBotAdminBroadcast(userId, msg.text, ch, msg.photoFileId, msg.buttonText, msg.buttonUrl);
        const text = `✅ Рассылка завершена.\n\nTelegram: отправлено ${result.sentTelegram}, ошибок ${result.failedTelegram}\nEmail: отправлено ${result.sentEmail}, ошибок ${result.failedEmail}${result.errors?.length ? "\n\nОшибки: " + result.errors.slice(0, 3).join("; ") : ""}`;
        await editMessageContent(ctx, text, {
          inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]],
        });
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "◀️ В админку", callback_data: "admin:menu" }]],
        });
      }
      return;
    }
    if (data.startsWith("admin:block:")) {
      const clientId = data.slice("admin:block:".length);
      if (!clientId) return;
      await api.patchBotAdminClientBlock(userId, clientId, true);
      const client = await api.getBotAdminClient(userId, clientId);
      const created = client.createdAt ? new Date(client.createdAt).toLocaleString("ru-RU") : "—";
      let text = `👤 ${client.email || client.telegramUsername || client.telegramId || client.id}\n\nID: ${client.id}\nБаланс: ${client.balance}\nРефералов: ${client._count?.referrals ?? 0}\nСоздан: ${created}\n\n🚫 Заблокирован`;
      const kb: InlineMarkup["inline_keyboard"] = [
        [{ text: "✅ Разблокировать", callback_data: `admin:unblock:${client.id}` }],
        [{ text: "◀️ К списку", callback_data: "admin:clients:1" }],
      ];
      await editMessageContent(ctx, text, { inline_keyboard: kb });
      return;
    }
    if (data.startsWith("admin:unblock:")) {
      const clientId = data.slice("admin:unblock:".length);
      if (!clientId) return;
      await api.patchBotAdminClientBlock(userId, clientId, false);
      const client = await api.getBotAdminClient(userId, clientId);
      const created = client.createdAt ? new Date(client.createdAt).toLocaleString("ru-RU") : "—";
      let text = `👤 ${client.email || client.telegramUsername || client.telegramId || client.id}\n\nID: ${client.id}\nБаланс: ${client.balance}\nРефералов: ${client._count?.referrals ?? 0}\nСоздан: ${created}`;
      const kb: InlineMarkup["inline_keyboard"] = [
        [{ text: "🚫 Заблокировать", callback_data: `admin:block:${client.id}` }],
        [{ text: "◀️ К списку", callback_data: "admin:clients:1" }],
      ];
      await editMessageContent(ctx, text, { inline_keyboard: kb });
      return;
    }
    return;
  }

  const token = await getOrRestoreToken(userId, ctx.from?.username);
  if (!token) {
    await ctx.reply(_t("auth_failed", getUserLang(userId)));
    return;
  }

  try {
    const config = await api.getPublicConfig();
    if (config?.translations) setTranslations(config.translations);

    // Обработка кнопки «Я подписался»
    if (data === "check_subscribe") {
      const lang = getUserLang(userId);
      const channelId = config?.forceSubscribeChannelId?.trim();
      if (channelId && config?.forceSubscribeEnabled) {
        const result = await checkUserSubscription(userId, channelId);
        if (result.state === "cannot_verify") {
          await ctx.answerCallbackQuery({
            text: _t("subscribe.cannot_verify", lang).slice(0, 200),
            show_alert: true,
          }).catch(() => {});
          await editMessageContent(
            ctx,
            `⚠️ ${_t("subscribe.cannot_verify", lang)}`,
            subscribeKeyboard(channelId, lang)
          );
          return;
        }
        if (result.state !== "subscribed") {
          await ctx.answerCallbackQuery({ text: _t("subscribe.not_subscribed", lang), show_alert: true }).catch(() => {});
          return;
        }
      }
      await ctx.answerCallbackQuery({ text: _t("subscribe.confirmed", lang) }).catch(() => {});
      await ctx.reply(_t("subscribe.send_start", lang));
      return;
    }

    // Проверка подписки на канал для всех действий
    if (config?.forceSubscribeEnabled && config.forceSubscribeChannelId?.trim()) {
      const lang = getUserLang(userId);
      const channelId = config.forceSubscribeChannelId.trim();
      const result = await checkUserSubscription(userId, channelId);
      if (result.state !== "subscribed") {
        const msg = config.forceSubscribeMessage?.trim() || _t("subscribe.default_message", lang);
        const details = result.state === "cannot_verify"
          ? `\n\n${_t("subscribe.cannot_verify", lang)}`
          : "";
        await editMessageContent(ctx, `⚠️ ${msg}${details}`, subscribeKeyboard(channelId, lang));
        return;
      }
    }

    const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
    const rawStyles = config?.botInnerButtonStyles;
    const innerStyles = {
      tariffPay: rawStyles?.tariffPay !== undefined ? rawStyles.tariffPay : "success",
      topup: rawStyles?.topup !== undefined ? rawStyles.topup : "primary",
      back: rawStyles?.back !== undefined ? rawStyles.back : "danger",
      profile: rawStyles?.profile !== undefined ? rawStyles.profile : "primary",
      trialConfirm: rawStyles?.trialConfirm !== undefined ? rawStyles.trialConfirm : "success",
      lang: rawStyles?.lang !== undefined ? rawStyles.lang : "primary",
      currency: rawStyles?.currency !== undefined ? rawStyles.currency : "primary",
    };
    const botEmojis = config?.botEmojis;
    const innerEmojiIds: InnerEmojiIds | undefined = botEmojis
      ? {
          back: botEmojis.BACK?.tgEmojiId,
          card: botEmojis.CARD?.tgEmojiId,
          tariff: botEmojis.PACKAGE?.tgEmojiId || botEmojis.TARIFFS?.tgEmojiId,
          trial: botEmojis.TRIAL?.tgEmojiId,
          profile: botEmojis.PUZZLE?.tgEmojiId || botEmojis.PROFILE?.tgEmojiId,
          connect: botEmojis.SERVERS?.tgEmojiId || botEmojis.CONNECT?.tgEmojiId,
        }
      : undefined;

    if (data === "menu:main") {
      const [client, subRes, proxyRes, singboxRes] = await Promise.all([
        api.getMe(token),
        api.getSubscription(token).catch(() => ({ subscription: null })),
        api.getPublicProxyTariffs().catch(() => ({ items: [] })),
        api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
      ]);
      if (client?.preferredLang) setUserLang(userId, client.preferredLang);
      const vpnUrl = getSubscriptionUrl(subRes.subscription);
      const showTrial = Boolean(config?.trialEnabled && !client?.trialUsed);
      const showProxy = proxyRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
      const showSingbox = singboxRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
      const name = config?.serviceName?.trim() || "Кабинет";
      const { text, entities } = buildMainMenuText({
        serviceName: name,
        balance: client?.balance ?? 0,
        currency: client?.preferredCurrency ?? config?.defaultCurrency ?? "usd",
        subscription: subRes.subscription,
        tariffDisplayName: (subRes as { tariffDisplayName?: string | null }).tariffDisplayName ?? null,
        menuTexts: config?.botMenuTexts ?? config?.resolvedBotMenuTexts ?? null,
        menuLineVisibility: config?.botMenuLineVisibility ?? null,
        menuTextCustomEmojiIds: config?.menuTextCustomEmojiIds ?? null,
        botEmojis: config?.botEmojis ?? null,
      });
      const hasVideoInstructionsCb = config?.videoInstructionsEnabled && (config?.videoInstructions?.length ?? 0) > 0;
      const hasSupportLinks = !!(config?.supportLink || config?.agreementLink || config?.offerLink || config?.instructionsLink || hasVideoInstructionsCb);
      const backMarkup = mainMenu({
        showTrial,
        showVpn: Boolean(vpnUrl),
        showProxy,
        showSingbox,
        showGift: config?.giftSubscriptionsEnabled === true,
        appUrl,
        botButtons: config?.botButtons ?? null,
        botBackLabel: config?.botBackLabel ?? null,
        hasSupportLinks,
        showTickets: config?.ticketsEnabled === true,
        showExtraOptions: config?.sellOptionsEnabled === true && (config?.sellOptions?.length ?? 0) > 0,
        buttonsPerRow: config?.botButtonsPerRow ?? 1,
        remnaSubscriptionUrl: config?.useRemnaSubscriptionPage ? vpnUrl : null,
      });
      if (config?.botAdminTelegramIds?.includes(String(userId))) {
        backMarkup.inline_keyboard.push([{ text: "⚙️ Панель админа", callback_data: "admin:menu" }]);
      }
      await editMessageContent(ctx, text, backMarkup, entities);
      return;
    }

    if (data === "menu:support") {
      const lang = getUserLang(userId);
      const hasVideoInstr = config?.videoInstructionsEnabled && (config?.videoInstructions?.length ?? 0) > 0;
      const hasAny = config?.supportLink || config?.agreementLink || config?.offerLink || config?.instructionsLink || hasVideoInstr;
      if (!hasAny) {
        await editMessageContent(ctx, _t("support.not_configured", lang), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      await editMessageContent(
        ctx,
        _t("support.title", lang),
        supportSubMenu(
          {
            support: config?.supportLink,
            agreement: config?.agreementLink,
            offer: config?.offerLink,
            instructions: config?.instructionsLink,
            hasVideoInstructions: hasVideoInstr,
          },
          config?.botBackLabel ?? null,
          innerStyles?.back,
          innerEmojiIds,
          lang
        )
      );
      return;
    }

    if (data === "menu:video_instructions") {
      const vItems = config?.videoInstructions ?? [];
      if (!vItems.length) {
        await editMessageContent(ctx, "Инструкции пока не добавлены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const backLabel = (config?.botBackLabel && config.botBackLabel.trim()) || "« Назад";
      const rows: { text: string; callback_data: string }[][] = vItems
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => [{ text: `📹 ${v.title}`, callback_data: `vinstr:${v.id}` }]);
      rows.push([{ text: backLabel, callback_data: "menu:support" }]);
      await editMessageContent(ctx, "📹 Видео-инструкции\n\nВыберите инструкцию:", { inline_keyboard: rows });
      return;
    }

    if (data.startsWith("vinstr:")) {
      const instrId = data.slice(7);
      const vItems = config?.videoInstructions ?? [];
      const instr = vItems.find((v) => v.id === instrId);
      if (!instr) {
        await editMessageContent(ctx, "Инструкция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const backLabel = (config?.botBackLabel && config.botBackLabel.trim()) || "« Назад";
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      try {
        await ctx.deleteMessage().catch(() => {});
      } catch { /* ignore */ }
      try {
        await ctx.api.sendVideo(chatId, instr.telegramFileId, {
          caption: `📹 ${instr.title}`,
          reply_markup: {
            inline_keyboard: [
              [{ text: "« Назад к инструкциям", callback_data: "menu:video_instructions_fresh" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        });
      } catch (e) {
        await ctx.api.sendMessage(chatId, "Не удалось отправить видео. Попробуйте позже.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "« Назад к инструкциям", callback_data: "menu:video_instructions_fresh" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        });
      }
      return;
    }

    if (data === "menu:video_instructions_fresh") {
      const vItems = config?.videoInstructions ?? [];
      if (!vItems.length) {
        await ctx.api.sendMessage(ctx.chat!.id, "Инструкции пока не добавлены.", {
          reply_markup: backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
        });
        return;
      }
      const backLabel = (config?.botBackLabel && config.botBackLabel.trim()) || "« Назад";
      const rows: { text: string; callback_data: string }[][] = vItems
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => [{ text: `📹 ${v.title}`, callback_data: `vinstr:${v.id}` }]);
      rows.push([{ text: backLabel, callback_data: "menu:support" }]);
      try {
        await ctx.deleteMessage().catch(() => {});
      } catch { /* ignore */ }
      await ctx.api.sendMessage(ctx.chat!.id, "📹 Видео-инструкции\n\nВыберите инструкцию:", {
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    if (data === "menu:tariffs") {
      const { items } = await api.getPublicTariffs();
      if (!items?.length) {
        await editMessageContent(ctx, _t("tariffs.not_configured", getUserLang(userId)), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const tariffsEmojiKey = getMenuEmojiKey(config, "tariffs");
      const tariffsEmojiEntry = tariffsEmojiKey ? config?.botEmojis?.[tariffsEmojiKey] : undefined;
      const tariffsEmojiUnicode = tariffsEmojiKey && !tariffsEmojiEntry?.tgEmojiId
        ? (tariffsEmojiEntry?.unicode?.trim() || DEFAULT_EMOJI_UNICODE[tariffsEmojiKey])
        : undefined;
      const tariffsEmojiIds = innerEmojiIds && tariffsEmojiEntry?.tgEmojiId
        ? { ...innerEmojiIds, tariff: tariffsEmojiEntry.tgEmojiId }
        : innerEmojiIds;
      if (items.length > 1) {
        const { text, entities } = titleWithOptionalEmoji(tariffsEmojiKey, "Тарифы\n\nВыберите категорию:", config?.botEmojis);
        await editMessageContent(ctx, text, tariffPayButtons(items, config?.botBackLabel ?? null, innerStyles, tariffsEmojiIds, tariffsEmojiUnicode), entities);
        return;
      }
      const cat = items[0]!;
      const nameOnly = (cat.name || "").replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "").trim() || cat.name || "";
      const head = (cat.emoji && cat.emoji.trim() ? cat.emoji + " " : "") + nameOnly;
      const tariffFields = { ...DEFAULT_TARIFF_LINE_FIELDS, ...(config?.botTariffsFields ?? {}) };
      const template = (config?.botTariffsText ?? "").trim() || DEFAULT_TARIFFS_TEXT;
      const tariffLines = cat.tariffs.map((t: TariffItem) => formatTariffLine(t, tariffFields)).join("\n");
      const body = renderTariffsText(template, head, tariffLines);
      const { text, entities } = titleWithOptionalEmoji(tariffsEmojiKey, body, config?.botEmojis);
      await editMessageContent(ctx, text, tariffPayButtons(items, config?.botBackLabel ?? null, innerStyles, tariffsEmojiIds, tariffsEmojiUnicode), entities);
      return;
    }

    if (data.startsWith("cat_tariffs:")) {
      const categoryId = data.slice("cat_tariffs:".length);
      const { items } = await api.getPublicTariffs();
      const category = items?.find((c: TariffCategory) => c.id === categoryId);
      if (!category?.tariffs?.length) {
        await editMessageContent(ctx, "Категория не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const nameOnly = (category.name || "").replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "").trim() || category.name || "";
      const head = (category.emoji && category.emoji.trim() ? category.emoji + " " : "") + nameOnly;
      const tariffsEmojiKey = getMenuEmojiKey(config, "tariffs");
      const tariffsEmojiEntry = tariffsEmojiKey ? config?.botEmojis?.[tariffsEmojiKey] : undefined;
      const tariffsEmojiUnicode = tariffsEmojiKey && !tariffsEmojiEntry?.tgEmojiId
        ? (tariffsEmojiEntry?.unicode?.trim() || DEFAULT_EMOJI_UNICODE[tariffsEmojiKey])
        : undefined;
      const tariffsEmojiIds = innerEmojiIds && tariffsEmojiEntry?.tgEmojiId
        ? { ...innerEmojiIds, tariff: tariffsEmojiEntry.tgEmojiId }
        : innerEmojiIds;
      const tariffFields = { ...DEFAULT_TARIFF_LINE_FIELDS, ...(config?.botTariffsFields ?? {}) };
      const template = (config?.botTariffsText ?? "").trim() || DEFAULT_TARIFFS_TEXT;
      const tariffLines = category.tariffs.map((t: TariffItem) => formatTariffLine(t, tariffFields)).join("\n");
      const body = renderTariffsText(template, head, tariffLines);
      const { text, entities } = titleWithOptionalEmoji(tariffsEmojiKey, body, config?.botEmojis);
      await editMessageContent(ctx, text, tariffsOfCategoryButtons(category, config?.botBackLabel ?? null, innerStyles, "menu:tariffs", tariffsEmojiIds, tariffsEmojiUnicode), entities);
      return;
    }

    if (data === "menu:proxy") {
      const { items } = await api.getPublicProxyTariffs();
      if (!items?.length || items.every((c: { tariffs: unknown[] }) => !c.tariffs?.length)) {
        await editMessageContent(ctx, "Тарифы прокси пока не настроены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const cats = items.filter((c: { tariffs: unknown[] }) => c.tariffs?.length > 0);
      if (cats.length === 1 && cats[0]!.tariffs.length <= 5) {
        const head = cats[0]!.name;
        const lines = cats[0]!.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${t.currency}`).join("\n");
        await editMessageContent(ctx, `🌐 Прокси\n\n${head}\n${lines}\n\nВыберите тариф:`, proxyTariffPayButtons(cats, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
      } else {
        await editMessageContent(ctx, "🌐 Прокси\n\nВыберите категорию:", proxyTariffPayButtons(cats, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("cat_proxy:")) {
      const categoryId = data.slice("cat_proxy:".length);
      const { items } = await api.getPublicProxyTariffs();
      const category = items?.find((c: { id: string }) => c.id === categoryId);
      if (!category?.tariffs?.length) {
        await editMessageContent(ctx, "Категория не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const head = category.name;
      const lines = category.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${t.currency}`).join("\n");
      await editMessageContent(ctx, `🌐 ${head}\n\n${lines}\n\nВыберите тариф:`, proxyTariffsOfCategoryButtons(category, config?.botBackLabel ?? null, innerStyles, "menu:proxy", innerEmojiIds));
      return;
    }

    if (data === "menu:singbox") {
      const { items } = await api.getPublicSingboxTariffs();
      if (!items?.length || items.every((c: { tariffs: unknown[] }) => !c.tariffs?.length)) {
        await editMessageContent(ctx, "Тарифы доступов пока не настроены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const cats = items.filter((c: { tariffs: unknown[] }) => c.tariffs?.length > 0);
      if (cats.length === 1 && cats[0]!.tariffs.length <= 5) {
        const head = cats[0]!.name;
        const lines = cats[0]!.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${t.currency}`).join("\n");
        await editMessageContent(ctx, `🔑 Доступы\n\n${head}\n${lines}\n\nВыберите тариф:`, singboxTariffPayButtons(cats, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
      } else {
        await editMessageContent(ctx, "🔑 Доступы\n\nВыберите категорию:", singboxTariffPayButtons(cats, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("cat_singbox:")) {
      const categoryId = data.slice("cat_singbox:".length);
      const { items } = await api.getPublicSingboxTariffs();
      const category = items?.find((c: { id: string }) => c.id === categoryId);
      if (!category?.tariffs?.length) {
        await editMessageContent(ctx, "Категория не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const head = category.name;
      const lines = category.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${t.currency}`).join("\n");
      await editMessageContent(ctx, `🔑 ${head}\n\n${lines}\n\nВыберите тариф:`, singboxTariffsOfCategoryButtons(category, config?.botBackLabel ?? null, innerStyles, "menu:singbox", innerEmojiIds));
      return;
    }

    if (data === "menu:my_singbox") {
      const slotsRes = await api.getSingboxSlots(token);
      const slots = slotsRes.slots ?? [];
      if (slots.length === 0) {
        await editMessageContent(ctx, "У вас пока нет активных доступов. Купите тариф в разделе «Доступы».", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const lines = slots.map((s: { subscriptionLink: string; expiresAt: string; protocol: string }) => {
        const exp = new Date(s.expiresAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
        return `${s.protocol} — до ${exp}\n${s.subscriptionLink}`;
      }).join("\n\n");
      const msg = `📋 Мои доступы (${slots.length})\n\nСкопируйте ссылку в приложение (v2rayN, Nekoray и др.):\n\n${lines}`;
      await editMessageContent(ctx, msg.slice(0, 4096), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      return;
    }

    if (data === "menu:my_proxy") {
      const { slots } = await api.getProxySlots(token);
      if (!slots?.length) {
        await editMessageContent(ctx, "📋 Мои прокси\n\nУ вас пока нет активных прокси. Купите тариф в разделе «Прокси».", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      let text = "📋 Мои прокси\n\n";
      for (const s of slots) {
        text += `• SOCKS5: \`socks5://${s.login}:${s.password}@${s.host}:${s.socksPort}\`\n`;
        text += `• HTTP: \`http://${s.login}:${s.password}@${s.host}:${s.httpPort}\`\n`;
        text += `  До: ${new Date(s.expiresAt).toLocaleString("ru-RU")}\n\n`;
      }
      text += "Скопируйте строку в настройки прокси приложения.";
      await editMessageContent(ctx, text.slice(0, 4096), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      return;
    }

    if (data.startsWith("pay_proxy_balance:")) {
      const proxyTariffId = data.slice("pay_proxy_balance:".length);
      try {
        const result = await api.payByBalance(token, { proxyTariffId });
        await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_proxy_yoomoney:")) {
      const proxyTariffId = data.slice("pay_proxy_yoomoney:".length);
      const { items } = await api.getPublicProxyTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === proxyTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createYoomoneyPayment(token, { amount: tariff.price, paymentType: "AC", proxyTariffId });
        const msg = buildPaymentMessage(config, {
          name: tariff.name,
          price: formatMoney(tariff.price, tariff.currency),
          amount: String(tariff.price),
          currency: tariff.currency,
          action: "Нажмите для оплаты через ЮMoney:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_proxy_yookassa:")) {
      const proxyTariffId = data.slice("pay_proxy_yookassa:".length);
      const { items } = await api.getPublicProxyTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === proxyTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (tariff.currency.toUpperCase() !== "RUB") {
        await editMessageContent(ctx, "ЮKassa принимает только рубли (RUB).", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createYookassaPayment(token, { amount: tariff.price, currency: "RUB", proxyTariffId });
        const msg = buildPaymentMessage(config, {
          name: tariff.name,
          price: formatMoney(tariff.price, tariff.currency),
          amount: String(tariff.price),
          currency: tariff.currency,
          action: "Нажмите для оплаты через ЮKassa:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_proxy_cryptopay:")) {
      const proxyTariffId = data.slice("pay_proxy_cryptopay:".length);
      const { items } = await api.getPublicProxyTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === proxyTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createCryptopayPayment(token, { amount: tariff.price, currency: tariff.currency, proxyTariffId });
        const msg = buildPaymentMessage(config, { name: tariff.name, price: formatMoney(tariff.price, tariff.currency), amount: String(tariff.price), currency: tariff.currency, action: "Нажмите для оплаты через Crypto Bot:" });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_proxy:")) {
      const rest = data.slice("pay_proxy:".length);
      const parts = rest.split(":");
      const proxyTariffId = parts[0];
      const methodIdFromBtn = parts.length >= 2 ? Number(parts[1]) : null;
      const { items } = await api.getPublicProxyTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === proxyTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const methods = config?.plategaMethods ?? [];
      const client = await api.getMe(token);
      const balanceLabel = client && client.balance >= tariff.price ? `💰 Оплатить балансом (${formatMoney(client.balance, client.preferredCurrency ?? "RUB")})` : null;
      const discountInfoProxy = activeDiscountCode.get(userId);
      const promoCodeProxy = discountInfoProxy?.code;
      const discountArgProxy = discountInfoProxy ? {
        originalPrice: formatMoney(tariff.price, tariff.currency),
        discountedPrice: formatMoney(getDiscountedPrice(tariff.price, discountInfoProxy), tariff.currency),
      } : undefined;
      if (methodIdFromBtn != null && Number.isFinite(methodIdFromBtn)) {
        try {
          const payment = await api.createPlategaPayment(token, {
            amount: tariff.price,
            currency: tariff.currency,
            paymentMethod: methodIdFromBtn,
            description: `Прокси: ${tariff.name}`,
            proxyTariffId: tariff.id,
            promoCode: promoCodeProxy,
          });
          if (promoCodeProxy) activeDiscountCode.delete(userId);
          const msg = buildPaymentMessage(config, {
            name: tariff.name,
            price: formatMoney(tariff.price, tariff.currency),
            amount: String(tariff.price),
            currency: tariff.currency,
            action: "Нажмите для оплаты:",
          }, discountArgProxy);
          await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка";
          await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        }
        return;
      }
      const markup = proxyPaymentMethodButtons(
        proxyTariffId,
        methods,
        config?.botBackLabel ?? null,
        innerStyles?.back,
        innerEmojiIds,
        balanceLabel,
        !!config?.yoomoneyEnabled,
        !!config?.yookassaEnabled,
        !!config?.cryptopayEnabled,
        tariff.currency,
      );
      const msg = buildPaymentMessage(config, {
        name: tariff.name,
        price: formatMoney(tariff.price, tariff.currency),
        amount: String(tariff.price),
        currency: tariff.currency,
        action: "Выберите способ оплаты:",
      }, discountArgProxy);
      await editMessageContent(ctx, msg.text, markup, msg.entities);
      return;
    }

    if (data.startsWith("pay_singbox_balance:")) {
      const singboxTariffId = data.slice("pay_singbox_balance:".length);
      try {
        const result = await api.payByBalance(token, { singboxTariffId });
        await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_singbox_yoomoney:")) {
      const singboxTariffId = data.slice("pay_singbox_yoomoney:".length);
      const { items } = await api.getPublicSingboxTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === singboxTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createYoomoneyPayment(token, { amount: tariff.price, paymentType: "AC", singboxTariffId });
        const msg = buildPaymentMessage(config, {
          name: tariff.name,
          price: formatMoney(tariff.price, tariff.currency),
          amount: String(tariff.price),
          currency: tariff.currency,
          action: "Нажмите для оплаты через ЮMoney:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_singbox_yookassa:")) {
      const singboxTariffId = data.slice("pay_singbox_yookassa:".length);
      const { items } = await api.getPublicSingboxTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === singboxTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (tariff.currency.toUpperCase() !== "RUB") {
        await editMessageContent(ctx, "ЮKassa принимает только рубли (RUB).", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createYookassaPayment(token, { amount: tariff.price, currency: "RUB", singboxTariffId });
        const msg = buildPaymentMessage(config, {
          name: tariff.name,
          price: formatMoney(tariff.price, tariff.currency),
          amount: String(tariff.price),
          currency: tariff.currency,
          action: "Нажмите для оплаты через ЮKassa:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_singbox_cryptopay:")) {
      const singboxTariffId = data.slice("pay_singbox_cryptopay:".length);
      const { items } = await api.getPublicSingboxTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === singboxTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createCryptopayPayment(token, { amount: tariff.price, currency: tariff.currency, singboxTariffId });
        const msg = buildPaymentMessage(config, { name: tariff.name, price: formatMoney(tariff.price, tariff.currency), amount: String(tariff.price), currency: tariff.currency, action: "Нажмите для оплаты через Crypto Bot:" });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_singbox:")) {
      const rest = data.slice("pay_singbox:".length);
      const parts = rest.split(":");
      const singboxTariffId = parts[0];
      const methodIdFromBtn = parts.length >= 2 ? Number(parts[1]) : null;
      const { items } = await api.getPublicSingboxTariffs();
      const tariff = items?.flatMap((c: { tariffs: { id: string; name: string; price: number; currency: string }[] }) => c.tariffs).find((t: { id: string }) => t.id === singboxTariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const methods = config?.plategaMethods ?? [];
      const client = await api.getMe(token);
      const balanceLabel = client && client.balance >= tariff.price ? `💰 Оплатить балансом (${formatMoney(client.balance, client.preferredCurrency ?? "RUB")})` : null;
      const discountInfoSingbox = activeDiscountCode.get(userId);
      const promoCodeSingbox = discountInfoSingbox?.code;
      const discountArgSingbox = discountInfoSingbox ? {
        originalPrice: formatMoney(tariff.price, tariff.currency),
        discountedPrice: formatMoney(getDiscountedPrice(tariff.price, discountInfoSingbox), tariff.currency),
      } : undefined;
      if (methodIdFromBtn != null && Number.isFinite(methodIdFromBtn)) {
        try {
          const payment = await api.createPlategaPayment(token, {
            amount: tariff.price,
            currency: tariff.currency,
            paymentMethod: methodIdFromBtn,
            description: `Доступы: ${tariff.name}`,
            singboxTariffId: tariff.id,
            promoCode: promoCodeSingbox,
          });
          if (promoCodeSingbox) activeDiscountCode.delete(userId);
          const msg = buildPaymentMessage(config, {
            name: tariff.name,
            price: formatMoney(tariff.price, tariff.currency),
            amount: String(tariff.price),
            currency: tariff.currency,
            action: "Нажмите для оплаты:",
          }, discountArgSingbox);
          await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка";
          await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        }
        return;
      }
      const markup = singboxPaymentMethodButtons(
        singboxTariffId,
        methods,
        config?.botBackLabel ?? null,
        innerStyles?.back,
        innerEmojiIds,
        balanceLabel,
        !!config?.yoomoneyEnabled,
        !!config?.yookassaEnabled,
        !!config?.cryptopayEnabled,
        tariff.currency,
      );
      const msg = buildPaymentMessage(config, {
        name: tariff.name,
        price: formatMoney(tariff.price, tariff.currency),
        amount: String(tariff.price),
        currency: tariff.currency,
        action: "Выберите способ оплаты:",
      }, discountArgSingbox);
      await editMessageContent(ctx, msg.text, markup, msg.entities);
      return;
    }

    if (data.startsWith("pay_tariff_balance:")) {
      const tariffId = data.slice("pay_tariff_balance:".length);
      try {
        const discountInfoBal = activeDiscountCode.get(userId);
        const promoCode = discountInfoBal?.code;
        const result = await api.payByBalance(token, { tariffId, promoCode });
        if (promoCode) activeDiscountCode.delete(userId);
        await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_tariff_yoomoney:")) {
      const tariffId = data.slice("pay_tariff_yoomoney:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfoYm = activeDiscountCode.get(userId);
        const promoCode = discountInfoYm?.code;
        const payment = await api.createYoomoneyPayment(token, {
          amount: tariff.price,
          paymentType: "AC",
          tariffId: tariff.id,
          promoCode,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        const discountArgYm = discountInfoYm ? {
          originalPrice: formatMoney(tariff.price, tariff.currency),
          discountedPrice: formatMoney(getDiscountedPrice(tariff.price, discountInfoYm), tariff.currency),
        } : undefined;
        const msg = buildPaymentMessage(config, {
          name: tariff.name,
          price: formatMoney(tariff.price, tariff.currency),
          amount: String(tariff.price),
          currency: tariff.currency,
          action: "Нажмите кнопку ниже для оплаты через ЮMoney:",
        }, discountArgYm);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_tariff_yookassa:")) {
      const tariffId = data.slice("pay_tariff_yookassa:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (tariff.currency.toUpperCase() !== "RUB") {
        await editMessageContent(ctx, "ЮKassa принимает только рубли (RUB).", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfoYk = activeDiscountCode.get(userId);
        const promoCode = discountInfoYk?.code;
        const payment = await api.createYookassaPayment(token, {
          amount: tariff.price,
          currency: "RUB",
          tariffId: tariff.id,
          promoCode,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        const discountArgYk = discountInfoYk ? {
          originalPrice: formatMoney(tariff.price, tariff.currency),
          discountedPrice: formatMoney(getDiscountedPrice(tariff.price, discountInfoYk), tariff.currency),
        } : undefined;
        const msg = buildPaymentMessage(config, {
          name: tariff.name,
          price: formatMoney(tariff.price, tariff.currency),
          amount: String(tariff.price),
          currency: tariff.currency,
          action: "Нажмите кнопку ниже для оплаты через ЮKassa:",
        }, discountArgYk);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_tariff_cryptopay:")) {
      const tariffId = data.slice("pay_tariff_cryptopay:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfoCp = activeDiscountCode.get(userId);
        const promoCode = discountInfoCp?.code;
        const payment = await api.createCryptopayPayment(token, { amount: tariff.price, currency: tariff.currency, tariffId: tariff.id, promoCode });
        if (promoCode) activeDiscountCode.delete(userId);
        const discountArgCp = discountInfoCp ? {
          originalPrice: formatMoney(tariff.price, tariff.currency),
          discountedPrice: formatMoney(getDiscountedPrice(tariff.price, discountInfoCp), tariff.currency),
        } : undefined;
        const msg = buildPaymentMessage(config, { name: tariff.name, price: formatMoney(tariff.price, tariff.currency), amount: String(tariff.price), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты через Crypto Bot:" }, discountArgCp);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "menu:extra_options") {
      const options = config?.sellOptions ?? [];
      if (!options.length) {
        await editMessageContent(ctx, "Доп. опции пока не доступны. Оформите подписку в разделе «Тарифы».", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const { text, entities } = titleWithEmoji("PACKAGE", "Доп. опции\n\nТрафик, устройства или серверы — докупка к подписке. Выберите опцию:", config?.botEmojis);
      await editMessageContent(ctx, text, extraOptionsButtons(options, config?.botBackLabel ?? null, innerStyles, innerEmojiIds), entities);
      return;
    }

    if (data.startsWith("pay_option_balance:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const result = await api.payOptionByBalance(token, { kind: option.kind, productId: option.id });
        await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_option_yookassa:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createYookassaPayment(token, {
          extraOption: { kind: option.kind, productId: option.id },
        });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, {
          name: optName,
          price: formatMoney(option.price, option.currency),
          amount: String(option.price),
          currency: option.currency,
          action: "Нажмите кнопку ниже для оплаты через ЮKassa:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        const isAuthError = /401|unauthorized|истек|авториз|токен/i.test(msg);
        if (isAuthError) {
          tokenStore.delete(userId);
          const freshToken = await getOrRestoreToken(userId, ctx.from?.username);
          if (freshToken) {
            await editMessageContent(ctx, "🔄 Повторите действие.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          } else {
            await editMessageContent(ctx, "❌ Ошибка авторизации. Отправьте /start", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          }
        } else {
          await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        }
      }
      return;
    }

    if (data.startsWith("pay_option_cryptopay:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createCryptopayPayment(token, { extraOption: { kind: option.kind, productId: option.id } });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, { name: optName, price: formatMoney(option.price, option.currency), amount: String(option.price), currency: option.currency, action: "Нажмите кнопку ниже для оплаты через Crypto Bot:" });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        const isAuthError = /401|unauthorized|истек|авториз|токен/i.test(msg);
        if (isAuthError) {
          tokenStore.delete(userId);
          const freshToken = await getOrRestoreToken(userId, ctx.from?.username);
          if (freshToken) {
            await editMessageContent(ctx, "🔄 Повторите действие.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          } else {
            await editMessageContent(ctx, "❌ Ошибка авторизации. Отправьте /start", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          }
        } else {
          await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        }
      }
      return;
    }

    if (data.startsWith("pay_option_yoomoney:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createYoomoneyPayment(token, {
          amount: option.price,
          paymentType: "AC",
          extraOption: { kind: option.kind, productId: option.id },
        });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, {
          name: optName,
          price: formatMoney(option.price, option.currency),
          amount: String(option.price),
          currency: option.currency,
          action: "Нажмите кнопку ниже для оплаты через ЮMoney:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_option_platega:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 3 ? parts.slice(2, -1).join(":") : parts[2] ?? "";
      const methodId = parts.length >= 4 ? Number(parts[parts.length - 1]) : Number(parts[2]);
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (!Number.isFinite(methodId)) {
        await editMessageContent(ctx, "Неверный способ оплаты.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const payment = await api.createPlategaPayment(token, {
          amount: option.price,
          currency: option.currency,
          paymentMethod: methodId,
          description: option.name || `${option.kind} ${option.id}`,
          extraOption: { kind: option.kind, productId: option.id },
        });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, {
          name: optName,
          price: formatMoney(option.price, option.currency),
          amount: String(option.price),
          currency: option.currency,
          action: "Нажмите кнопку ниже для оплаты:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_option:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      const options = config?.sellOptions ?? [];
      const option = options.find((o) => o.kind === kind && o.id === productId);
      if (!option) {
        await editMessageContent(ctx, "Опция не найдена. Обновите меню (/start) и попробуйте снова.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (option.currency.toUpperCase() !== "RUB") {
        await editMessageContent(ctx, "Оплата в боте доступна только в рублях (RUB).", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
      const choiceText = buildPaymentMessage(config, {
        name: optName,
        price: formatMoney(option.price, option.currency),
        amount: String(option.price),
        currency: option.currency,
        action: "Выберите способ оплаты:",
      });
      const markup = optionPaymentMethodButtons(
        option,
        client?.balance ?? 0,
        config?.botBackLabel ?? null,
        innerStyles,
        innerEmojiIds,
        config?.plategaMethods ?? [],
        !!config?.yoomoneyEnabled,
        !!config?.yookassaEnabled,
        !!config?.cryptopayEnabled
      );
      await editMessageContent(ctx, choiceText.text, markup, choiceText.entities);
      return;
    }

    if (data.startsWith("pay_tariff:")) {
      const rest = data.slice("pay_tariff:".length);
      const parts = rest.split(":");
      const tariffId = parts[0];
      const methodIdFromBtn = parts.length >= 2 ? Number(parts[1]) : null;
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const methods = config?.plategaMethods ?? [];
      const client = await api.getMe(token);
      const balanceLabel = client && client.balance >= tariff.price ? `💰 Оплатить балансом (${formatMoney(client.balance, client.preferredCurrency ?? "RUB")})` : null;

      const discountInfoTariff = activeDiscountCode.get(userId);
      const discountArgTariff = discountInfoTariff ? {
        originalPrice: formatMoney(tariff.price, tariff.currency),
        discountedPrice: formatMoney(getDiscountedPrice(tariff.price, discountInfoTariff), tariff.currency),
      } : undefined;

      if (methodIdFromBtn != null && Number.isFinite(methodIdFromBtn)) {
        const promoCode = discountInfoTariff?.code;
        const payment = await api.createPlategaPayment(token, {
          amount: tariff.price,
          currency: tariff.currency,
          paymentMethod: methodIdFromBtn,
          description: `Тариф: ${tariff.name}`,
          tariffId: tariff.id,
          promoCode,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        const msg = buildPaymentMessage(config, {
          name: tariff.name,
          price: formatMoney(tariff.price, tariff.currency),
          amount: String(tariff.price),
          currency: tariff.currency,
          action: "Нажмите кнопку ниже для оплаты:",
        }, discountArgTariff);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        return;
      }
      // Показываем способы оплаты (всегда, чтобы была кнопка баланса)
      const pay2 = buildPaymentMessage(config, {
        name: tariff.name,
        price: formatMoney(tariff.price, tariff.currency),
        amount: String(tariff.price),
        currency: tariff.currency,
        action: "Выберите способ оплаты:",
      }, discountArgTariff);
      await editMessageContent(ctx, pay2.text, tariffPaymentMethodButtons(tariffId, methods, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds, balanceLabel, !!config?.yoomoneyEnabled, !!config?.yookassaEnabled, !!config?.cryptopayEnabled, tariff.currency), pay2.entities);
      return;
    }

    if (data === "menu:profile") {
      const client = await api.getMe(token);
      if (client?.preferredLang) setUserLang(userId, client.preferredLang);
      const lang = getUserLang(userId);
      const langs = config?.activeLanguages?.length ? config.activeLanguages : ["ru", "en"];
      const currencies = config?.activeCurrencies?.length ? config.activeCurrencies : ["usd", "rub"];
      const autoRenewStr = client?.autoRenewEnabled ? _t("profile.autorenew_on", lang) : _t("profile.autorenew_off", lang);
      const { text, entities } = titleWithEmoji(
        "PROFILE",
        `${_t("profile.title", lang)}\n\n${_t("profile.balance", lang)}${formatMoney(client?.balance ?? 0, client?.preferredCurrency ?? "usd")}\n${_t("profile.lang", lang)}${client?.preferredLang ?? "ru"}\n${_t("profile.currency", lang)}${client?.preferredCurrency ?? "usd"}\n${_t("profile.autorenew", lang)}${autoRenewStr}\n\n${_t("profile.change", lang)}`,
        config?.botEmojis
      );
      await editMessageContent(ctx, text, profileButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, client?.autoRenewEnabled, lang), entities);
      return;
    }

    if (data === "menu:devices") {
      const lang = getUserLang(userId);
      try {
        const { total, devices } = await api.getClientDevices(token);
        lastDevicesList.set(userId, { devices });
        if (devices.length === 0) {
          await editMessageContent(
            ctx,
            _t("devices.no_devices", lang),
            { inline_keyboard: [[{ text: config?.botBackLabel ?? _t("back_to_menu", lang), callback_data: "menu:main" }]] }
          );
          return;
        }
        const lines = [_t("devices.delete_hint", lang) + "\n"];
        const rows: InlineMarkup["inline_keyboard"] = [];
        devices.slice(0, 15).forEach((d, i) => {
          const label = [d.platform, d.deviceModel].filter(Boolean).join(" · ") || d.hwid.slice(0, 12) + "…";
          lines.push(`${i + 1}. ${label}`);
          rows.push([{ text: `🗑 Удалить: ${label.slice(0, 25)}`, callback_data: `devices:delete:${i}` }]);
        });
        rows.push([{ text: config?.botBackLabel ?? "◀️ В меню", callback_data: "menu:main" }]);
        await editMessageContent(ctx, lines.join("\n"), { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `📱 Устройства\n\n❌ ${msg}`, {
          inline_keyboard: [[{ text: config?.botBackLabel ?? "◀️ В меню", callback_data: "menu:main" }]],
        });
      }
      return;
    }

    if (data.startsWith("devices:delete:")) {
      const lang = getUserLang(userId);
      const indexStr = data.slice("devices:delete:".length);
      const index = parseInt(indexStr, 10);
      const stored = lastDevicesList.get(userId);
      if (!stored || index < 0 || index >= stored.devices.length) {
        await editMessageContent(ctx, _t("devices.session_expired", lang), {
          inline_keyboard: [[{ text: config?.botBackLabel ?? _t("back_to_menu", lang), callback_data: "menu:main" }]],
        });
        return;
      }
      const hwid = stored.devices[index]!.hwid;
      try {
        await api.postClientDeviceDelete(token, hwid);
        const nextDevices = stored.devices.filter((_, i) => i !== index);
        lastDevicesList.set(userId, { devices: nextDevices });
        if (nextDevices.length === 0) {
          await editMessageContent(
            ctx,
            _t("devices.deleted", lang),
            { inline_keyboard: [[{ text: config?.botBackLabel ?? _t("back_to_menu", lang), callback_data: "menu:main" }]] }
          );
        } else {
          const lines = [_t("devices.deleted", lang) + "\n"];
          const rows: InlineMarkup["inline_keyboard"] = [];
          nextDevices.slice(0, 15).forEach((d, i) => {
            const label = [d.platform, d.deviceModel].filter(Boolean).join(" · ") || d.hwid.slice(0, 12) + "…";
            lines.push(`${i + 1}. ${label}`);
            rows.push([{ text: `🗑 Удалить: ${label.slice(0, 25)}`, callback_data: `devices:delete:${i}` }]);
          });
          rows.push([{ text: config?.botBackLabel ?? "◀️ В меню", callback_data: "menu:main" }]);
          await editMessageContent(ctx, lines.join("\n"), { inline_keyboard: rows });
        }
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: config?.botBackLabel ?? "◀️ В меню", callback_data: "menu:devices" }]],
        });
      }
      return;
    }

    if (data === "profile:lang") {
      const lang = getUserLang(userId);
      const langs = config?.activeLanguages?.length ? config.activeLanguages : ["ru", "en"];
      await editMessageContent(ctx, _t("profile.choose_lang", lang), langButtons(langs, innerStyles, innerEmojiIds, lang));
      return;
    }

    if (data.startsWith("set_lang:")) {
      const lang = data.slice("set_lang:".length);
      await api.updateProfile(token, { preferredLang: lang });
      setUserLang(userId, lang);
      await editMessageContent(ctx, _t("profile.lang_changed", lang, { lang: lang.toUpperCase() }), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      return;
    }

    if (data === "profile:currency") {
      const lang = getUserLang(userId);
      const currencies = config?.activeCurrencies?.length ? config.activeCurrencies : ["usd", "rub"];
      await editMessageContent(ctx, _t("profile.choose_currency", lang), currencyButtons(currencies, innerStyles, innerEmojiIds, lang));
      return;
    }

    if (data.startsWith("set_currency:")) {
      const lang = getUserLang(userId);
      const currency = data.slice("set_currency:".length);
      await api.updateProfile(token, { preferredCurrency: currency });
      await editMessageContent(ctx, _t("profile.currency_changed", lang, { currency: currency.toUpperCase() }), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      return;
    }

    if (data.startsWith("profile:autorenew:")) {
      const enabled = data === "profile:autorenew:on";
      try {
        await api.toggleAutoRenew(token, enabled);
        const client = await api.getMe(token);
        if (client?.preferredLang) setUserLang(userId, client.preferredLang);
        const lang = getUserLang(userId);
        const autoRenewStr = client?.autoRenewEnabled ? _t("profile.autorenew_on", lang) : _t("profile.autorenew_off", lang);
        const { text, entities } = titleWithEmoji(
          "PROFILE",
          `${_t("profile.title", lang)}\n\n${_t("profile.balance", lang)}${formatMoney(client?.balance ?? 0, client?.preferredCurrency ?? "usd")}\n${_t("profile.lang", lang)}${client?.preferredLang ?? "ru"}\n${_t("profile.currency", lang)}${client?.preferredCurrency ?? "usd"}\n${_t("profile.autorenew", lang)}${autoRenewStr}\n\n${_t("profile.change", lang)}`,
          config?.botEmojis
        );
        await editMessageContent(ctx, text, profileButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, client?.autoRenewEnabled, lang), entities);
      } catch (err: any) {
        await ctx.answerCallbackQuery({ text: err.message || "Ошибка", show_alert: true });
      }
      return;
    }

    if (data === "menu:topup") {
      const lang = getUserLang(userId);
      const client = await api.getMe(token);
      if (client?.preferredLang) setUserLang(userId, client.preferredLang);
      const methods = config?.plategaMethods ?? [];
      const yooEnabled = !!config?.yoomoneyEnabled;
      const yookassaEnabledTopup = !!config?.yookassaEnabled;
      if (!methods.length && !yooEnabled && !yookassaEnabledTopup) {
        await editMessageContent(ctx, _t("topup.unavailable", lang), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const topupTitle = titleWithEmoji("CARD", "Пополнить баланс\n\nВыберите сумму или введите свою (числом):", config?.botEmojis);
      await editMessageContent(ctx, topupTitle.text, topUpPresets(client.preferredCurrency, config?.botBackLabel ?? null, innerStyles, innerEmojiIds), topupTitle.entities);
      return;
    }

    if (data.startsWith("topup_yoomoney:")) {
      const amountStr = data.slice("topup_yoomoney:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createYoomoneyPayment(token, {
          amount,
          paymentType: "AC",
        });
        const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты через ЮMoney:`, config?.botEmojis);
        await editMessageContent(ctx, yooTopup.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), yooTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_yookassa:")) {
      const amountStr = data.slice("topup_yookassa:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createYookassaPayment(token, { amount, currency: "RUB" });
        const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, "RUB")}\n\nНажмите кнопку ниже для оплаты через ЮKassa:`, config?.botEmojis);
        await editMessageContent(ctx, yooTopup.text, payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), yooTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_cryptopay:")) {
      const amountStr = data.slice("topup_cryptopay:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createCryptopayPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const cpTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты через Crypto Bot:`, config?.botEmojis);
        await editMessageContent(ctx, cpTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), cpTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа Crypto Bot";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup:")) {
      const rest = data.slice("topup:".length);
      const parts = rest.split(":");
      const amountStr = parts[0];
      const amount = Number(amountStr);
      const methodIdFromBtn = parts.length >= 2 ? Number(parts[1]) : null;
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      const methods = config?.plategaMethods ?? [];
      if (methodIdFromBtn != null && Number.isFinite(methodIdFromBtn)) {
        const payment = await api.createPlategaPayment(token, {
          amount,
          currency: client.preferredCurrency,
          paymentMethod: methodIdFromBtn,
          description: "Пополнение баланса",
        });
        const topupPay1 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, topupPay1.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), topupPay1.entities);
        return;
      }
      const yooEnabled = !!config?.yoomoneyEnabled;
      const yookassaEnabled = !!config?.yookassaEnabled;
      const cryptopayEnabled = !!config?.cryptopayEnabled;
      if (methods.length > 1 || (methods.length >= 1 && (yooEnabled || yookassaEnabled || cryptopayEnabled)) || (methods.length === 0 && ((yooEnabled && yookassaEnabled) || (yooEnabled && cryptopayEnabled) || (yookassaEnabled && cryptopayEnabled)))) {
        const topupPay2 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nВыберите способ оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, topupPay2.text, topupPaymentMethodButtons(amountStr, methods, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds, yooEnabled, yookassaEnabled, cryptopayEnabled), topupPay2.entities);
        return;
      }
      // Если ЮMoney единственный способ (нет platega, нет ЮKassa) — сразу создаём платёж ЮMoney
      if (methods.length === 0 && yooEnabled && !yookassaEnabled) {
        try {
          const payment = await api.createYoomoneyPayment(token, { amount, paymentType: "AC" });
          const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты через ЮMoney:`, config?.botEmojis);
          await editMessageContent(ctx, yooTopup.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), yooTopup.entities);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
          await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        }
        return;
      }
      // Если только ЮKassa — сразу создаём платёж ЮKassa
      if (methods.length === 0 && yookassaEnabled) {
        try {
          const payment = await api.createYookassaPayment(token, { amount, currency: "RUB" });
          const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, "RUB")}\n\nНажмите кнопку ниже для оплаты через ЮKassa:`, config?.botEmojis);
          await editMessageContent(ctx, yooTopup.text, payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), yooTopup.entities);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
          await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        }
        return;
      }
      const methodId = methods[0]?.id ?? 2;
      const payment = await api.createPlategaPayment(token, {
        amount,
        currency: client.preferredCurrency,
        paymentMethod: methodId,
        description: "Пополнение баланса",
      });
      const topupPay3 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
      await editMessageContent(ctx, topupPay3.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), topupPay3.entities);
      return;
    }

    if (data === "menu:referral") {
      const lang = getUserLang(userId);
      const client = await api.getMe(token);
      if (client?.preferredLang) setUserLang(userId, client.preferredLang);
      if (!client.referralCode) {
        await editMessageContent(ctx, _t("referral.link_unavailable", lang), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const linkSite = appUrl ? `${appUrl}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}` : null;
      const linkBot = `https://t.me/${BOT_USERNAME || "bot"}?start=ref_${client.referralCode}`;
      // Показываем фактический персональный процент клиента.
      // Фолбэк на дефолт только если персональный не задан (null/undefined).
      const p1 = client.referralPercent ?? (config?.defaultReferralPercent ?? 0);
      const p2 = config?.referralPercentLevel2 ?? 0;
      const p3 = config?.referralPercentLevel3 ?? 0;
      let rest = `${_t("referral.title", lang)}\n\n${_t("referral.description", lang)}\n\n`;
      rest += `${_t("referral.how_it_works", lang)}\n`;
      rest += `• ${_t("referral.level1", lang, { percent: String(p1) })}\n`;
      rest += `• ${_t("referral.level2", lang, { percent: String(p2) })}\n`;
      rest += `• ${_t("referral.level3", lang, { percent: String(p3) })}\n`;
      rest += `\n${_t("referral.earnings_info", lang)}`;
      rest += `\n\n${_t("referral.your_links", lang)}`;
      if (linkSite) rest += `\n\n${_t("referral.site", lang)}\n` + linkSite;
      rest += `\n\n${_t("referral.bot", lang)}\n` + linkBot;
      const { text: refText, entities: refEntities } = titleWithEmoji("LINK", rest, config?.botEmojis);
      await editMessageContent(ctx, refText, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), refEntities);
      return;
    }

    if (data === "menu:promocode") {
      const lang = getUserLang(userId);
      awaitingPromoCode.add(userId);
      await editMessageContent(
        ctx,
        _t("promo.enter_title", lang),
        backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
      );
      return;
    }

    if (data === "menu:trial" || data === "trial:confirm") {
      try {
        const result = await api.activateTrial(token);
        await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка активации";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "menu:vpn") {
      const lang = getUserLang(userId);
      const subRes = await api.getSubscription(token);
      const vpnUrl = getSubscriptionUrl(subRes.subscription);
      if (!vpnUrl) {
        await editMessageContent(ctx, _t("vpn.link_unavailable", lang), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
      const useRemna = config?.useRemnaSubscriptionPage === true;
      if (useRemna) {
        const vpnTitle = titleWithEmoji("SERVERS", `${_t("vpn.connect_title", lang)}\n\n${_t("vpn.connect_hint", lang)}`, config?.botEmojis);
        await editMessageContent(ctx, vpnTitle.text, openSubscribePageMarkup(appUrl ?? "", config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds, vpnUrl), vpnTitle.entities);
      } else if (appUrl) {
        const vpnTitle = titleWithEmoji("SERVERS", `${_t("vpn.connect_title", lang)}\n\n${_t("vpn.connect_hint", lang)}`, config?.botEmojis);
        await editMessageContent(ctx, vpnTitle.text, openSubscribePageMarkup(appUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), vpnTitle.entities);
      } else {
        const vpnTitle2 = titleWithEmoji("SERVERS", `Подключиться к VPN\n\nОткройте ссылку в приложении VPN:\n${vpnUrl}`, config?.botEmojis);
        await editMessageContent(ctx, vpnTitle2.text, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), vpnTitle2.entities);
      }
      return;
    }

    // ——— Gift / Secondary Subscriptions handlers ———

    if (data === "menu:gift") {
      if (!config?.giftSubscriptionsEnabled) {
        await editMessageContent(ctx, "Функция подарков недоступна.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      await editMessageContent(
        ctx,
        "🎁 Подарки и подписки\n\nЗдесь вы можете купить дополнительные подписки, подарить их или активировать подарок.",
        giftMenuButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
      );
      return;
    }

    if (data === "gift:buy") {
      const { items } = await api.getPublicTariffs();
      if (!items?.length) {
        await editMessageContent(ctx, "Тарифы не настроены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      await editMessageContent(
        ctx,
        "🛒 Купить доп. подписку\n\nВыберите тариф:",
        giftTariffButtons(items, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
      );
      return;
    }

    if (data.startsWith("gift_tariff:")) {
      const tariffId = data.slice("gift_tariff:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      const balanceLabel = `💰 Оплатить балансом (${formatMoney(client?.balance ?? 0, client?.preferredCurrency ?? "RUB")})`;
      await editMessageContent(
        ctx,
        `🛒 ${tariff.name}\n\nСтоимость: ${formatMoney(tariff.price, tariff.currency)}\n\nПодтвердите оплату:`,
        giftPaymentButtons(tariffId, balanceLabel, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
      );
      return;
    }

    if (data.startsWith("gift_pay_balance:")) {
      const tariffId = data.slice("gift_pay_balance:".length);
      try {
        const result = await api.buyGiftSubscription(token, { tariffId });
        await editMessageContent(
          ctx,
          `✅ Дополнительная подписка создана!\n\nПодписка #${result.subscriptionIndex}\n\nВы можете активировать её на своём аккаунте или подарить другу.`,
          giftPostPurchaseButtons(result.secondarySubscriptionId, result.subscriptionIndex, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "gift:subscriptions") {
      try {
        const result = await api.getGiftSubscriptions(token);
        if (!result.subscriptions?.length) {
          await editMessageContent(
            ctx,
            "📋 Мои подписки\n\nУ вас пока нет дополнительных подписок.",
            giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
          );
          return;
        }
        await editMessageContent(
          ctx,
          `📋 Мои подписки\n\nУ вас ${result.subscriptions.length} доп. подписок:`,
          giftSubscriptionButtons(result.subscriptions, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:connect:")) {
      const subscriptionId = data.slice("gift:connect:".length);
      try {
        // Сначала активируем подписку (снимаем GIFT_RESERVED, если есть)
        await api.activateGiftForSelf(token, subscriptionId).catch(() => {});
        // Потом получаем URL
        const result = await api.getGiftSubscriptionUrl(token, subscriptionId);
        const appUrl2 = config?.publicAppUrl?.replace(/\/$/, "") ?? null;

        // Если включена Remna-страница подписки — отдаём remna subscriptionUrl.
        if (config?.useRemnaSubscriptionPage) {
          const byUuid = await api.getSubscriptionByUuid(token, result.uuid);
          const remnaUrl = getSubscriptionUrl(byUuid.subscription);
          if (!remnaUrl) {
            await editMessageContent(
              ctx,
              "❌ Не удалось получить ссылку Remna для этой подписки.",
              backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
            );
            return;
          }
          await editMessageContent(
            ctx,
            `📲 Ссылка на подписку:\n\n${remnaUrl}`,
            openSubscribePageMarkup(appUrl2 ?? "", config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds, remnaUrl),
          );
          return;
        }

        // Иначе показываем ссылку + кнопку "Подключиться" в мини-апп на нашу страницу
        // подключения для конкретной secondary-подписки.
        const webUrl = appUrl2 ? `${appUrl2}/cabinet/subscribe?uuid=${encodeURIComponent(result.uuid)}` : null;
        const buttons = webUrl
          ? {
              inline_keyboard: [
                [{ text: "📲 Подключиться", web_app: { url: webUrl } }],
                [{ text: config?.botBackLabel ?? "← Назад", callback_data: "menu:gift" }],
              ],
            }
          : giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds);
        await editMessageContent(
          ctx,
          `📲 Ссылка на подписку:\n\n${webUrl ?? `Подписка UUID: ${result.uuid}`}`,
          buttons,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка получения ссылки";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:give:")) {
      const subscriptionId = data.slice("gift:give:".length);
      try {
        const result = await api.createGiftCode(token, { secondarySubscriptionId: subscriptionId });
        const expiresAt = new Date(result.expiresAt).toLocaleDateString("ru-RU");
        const tariffLabel = result.tariffName ? `\nТариф: ${result.tariffName}` : "";

        // Формируем ссылку на подарок и кнопку "Поделиться"
        const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? "";
        const giftUrl = appUrl ? `${appUrl}/gift/${result.code}` : "";
        const shareText = `🎁 Я дарю тебе VPN-подписку STEALTHNET${result.tariffName ? ` (${result.tariffName})` : ""}! Активируй по ссылке:`;
        const shareUrl = giftUrl
          ? `https://t.me/share/url?url=${encodeURIComponent(giftUrl)}&text=${encodeURIComponent(shareText)}`
          : "";

        const buttons: (({ text: string; callback_data: string } | { text: string; url: string })[])[] = [];
        if (shareUrl) {
          buttons.push([{ text: "📤 Поделиться в Telegram", url: shareUrl }]);
        }
        if (giftUrl) {
          buttons.push([{ text: "🔗 Ссылка на подарок", url: giftUrl }]);
        }
        buttons.push([{ text: config?.botBackLabel ?? "← Назад", callback_data: "menu:gift" }]);

        await editMessageContent(
          ctx,
          `🎁 Подарочный код создан!\n\nКод: \`${result.code}\`${tariffLabel}\n\nОтправьте этот код получателю или поделитесь ссылкой. Код действителен до ${expiresAt}.`,
          { inline_keyboard: buttons },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания кода";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:delete:")) {
      const subscriptionId = data.slice("gift:delete:".length);
      try {
        const result = await api.deleteGiftSubscription(token, subscriptionId);
        await editMessageContent(
          ctx,
          `✅ ${result.message || "Подписка удалена"}`,
          giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка удаления";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "gift:redeem") {
      awaitingGiftCode.add(userId);
      await editMessageContent(
        ctx,
        "🎁 Введите подарочный код:",
        backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
      );
      return;
    }

    if (data === "gift:codes") {
      try {
        const result = await api.getGiftCodes(token);
        if (!result.codes?.length) {
          await editMessageContent(
            ctx,
            "🎟️ Мои подарки\n\nУ вас пока нет подарочных кодов.",
            giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
          );
          return;
        }
        const lines = result.codes.map((c) => {
          const statusLabel = c.status === "ACTIVE" ? "✅ Активен" : c.status === "REDEEMED" ? "🎁 Использован" : "❌ Отменён";
          return `${c.code} — ${statusLabel}`;
        }).join("\n");
        await editMessageContent(
          ctx,
          `🎟️ Мои подарки\n\n${lines}`,
          giftCodesListButtons(result.codes, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:cancel_code:")) {
      const codeOrId = data.slice("gift:cancel_code:".length);
      try {
        const result = await api.cancelGiftCode(token, codeOrId);
        await editMessageContent(
          ctx,
          `✅ ${result.message}`,
          giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка отмены";
        await editMessageContent(ctx, `❌ ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    await ctx.answerCallbackQuery({ text: "Неизвестное действие" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    await ctx.reply(`❌ ${msg}`).catch(() => {});
  }
});

// Видео от админа → возвращаем file_id для видео-инструкций
bot.on("message:video", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const config = await api.getPublicConfig();
  const isAdmin = config?.botAdminTelegramIds?.includes(String(userId)) ?? false;
  if (!isAdmin) return;
  const fileId = ctx.message.video.file_id;
  await ctx.reply(
    `📹 <b>file_id видео:</b>\n<code>${fileId}</code>\n\nСкопируйте и вставьте в админку при добавлении видео-инструкции.`,
    { parse_mode: "HTML" }
  );
});

// Сообщения с фото — админ может отправить фото с подписью для рассылки
bot.on("message:photo", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  if (!awaitingBroadcastMessage.has(userId)) return;
  awaitingBroadcastMessage.delete(userId);
  const config = await api.getPublicConfig();
  if (!config?.botAdminTelegramIds?.includes(String(userId))) {
    await ctx.reply("Доступ запрещён.");
    return;
  }
  const photos = ctx.message.photo;
  if (!photos?.length) {
    await ctx.reply("Фото не получено. Отправьте фото с подписью или текст.");
    return;
  }
  const largest = photos[photos.length - 1];
  const caption = ctx.message.caption?.trim() ?? "";
  // Парсим кнопку вида [Текст кнопки](URL) из подписи
  const btnMatch = caption.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  const buttonText = btnMatch?.[1];
  const buttonUrl = btnMatch?.[2];
  const cleanCaption = btnMatch ? caption.replace(btnMatch[0], "").trim() : caption;
  lastBroadcastMessage.set(userId, { text: cleanCaption || caption, photoFileId: largest.file_id, buttonText, buttonUrl });
  await ctx.reply("Кому отправить?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📱 Только Telegram", callback_data: "admin:bc:tg" },
          { text: "📧 Только Email", callback_data: "admin:bc:email" },
        ],
        [{ text: "📱+📧 Telegram и Email", callback_data: "admin:bc:both" }],
        [{ text: "◀️ Отмена", callback_data: "admin:menu" }],
      ],
    },
  });
});

// Сообщения с текстом — промокод или число для пополнения
bot.on("message:text", async (ctx) => {
  if (ctx.message.text?.startsWith("/")) return;
  const userId = ctx.from?.id;
  if (!userId) return;

  // Админ: ввод текста рассылки
  if (awaitingBroadcastMessage.has(userId)) {
    awaitingBroadcastMessage.delete(userId);
    const config = await api.getPublicConfig();
    if (!config?.botAdminTelegramIds?.includes(String(userId))) {
      await ctx.reply("Доступ запрещён.");
      return;
    }
    const text = ctx.message.text?.trim() ?? "";
    if (!text) {
      await ctx.reply("Введите непустой текст сообщения.");
      return;
    }
    // Парсим кнопку вида [Текст кнопки](URL) из текста
    const btnMatch = text.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    const buttonText = btnMatch?.[1];
    const buttonUrl = btnMatch?.[2];
    const cleanText = btnMatch ? text.replace(btnMatch[0], "").trim() : text;
    lastBroadcastMessage.set(userId, { text: cleanText || text, buttonText, buttonUrl });
    await ctx.reply("Кому отправить?", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📱 Только Telegram", callback_data: "admin:bc:tg" },
            { text: "📧 Только Email", callback_data: "admin:bc:email" },
          ],
          [{ text: "📱+📧 Telegram и Email", callback_data: "admin:bc:both" }],
          [{ text: "◀️ Отмена", callback_data: "admin:menu" }],
        ],
      },
    });
    return;
  }

  // Админ: ввод суммы пополнения баланса
  if (awaitingAdminBalance.has(userId)) {
    const clientId = awaitingAdminBalance.get(userId);
    awaitingAdminBalance.delete(userId);
    const config = await api.getPublicConfig();
    if (!config?.botAdminTelegramIds?.includes(String(userId)) || !clientId) {
      await ctx.reply("Доступ запрещён или сессия истекла.");
      return;
    }
    const num = Number(ctx.message.text?.replace(/,/, "."));
    if (!Number.isFinite(num) || num <= 0 || num > 1000000) {
      await ctx.reply("Введите положительное число (до 1 000 000).");
      return;
    }
    try {
      const result = await api.patchBotAdminClientBalance(userId, clientId, num);
      await ctx.reply(`✅ Баланс пополнен. Новый баланс: ${result.newBalance}`);
    } catch (e: unknown) {
      await ctx.reply(`❌ ${e instanceof Error ? e.message : "Ошибка"}`);
    }
    return;
  }

  // Админ: ввод поиска (Telegram ID, @username, email)
  if (awaitingAdminSearch.has(userId)) {
    awaitingAdminSearch.delete(userId);
    const config = await api.getPublicConfig();
    if (!config?.botAdminTelegramIds?.includes(String(userId))) {
      await ctx.reply("Доступ запрещён.");
      return;
    }
    const searchQuery = ctx.message.text?.trim() ?? "";
    lastAdminSearch.set(userId, searchQuery);
    try {
      const { items, total, limit } = await api.getBotAdminClients(userId, 1, searchQuery || undefined);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const msg =
        (searchQuery ? `👥 Поиск «${searchQuery}» (${total})\n\n` : `👥 Клиенты (${total})\n\n`) +
        items
          .map(
            (c, i) =>
              `${i + 1}. ${c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8)} ${c.isBlocked ? "🚫" : ""}`
          )
          .join("\n") +
        `\n\nСтр. 1/${totalPages}`;
      const rows: InlineMarkup["inline_keyboard"] = items.map((c) => [
        {
          text: `${c.email || c.telegramUsername || c.telegramId || c.id.slice(0, 8)} ${c.isBlocked ? "🚫" : ""}`,
          callback_data: `admin:client:${c.id}`,
        },
      ]);
      const nav: InlineMarkup["inline_keyboard"][0] = [
        { text: "◀️ В админку", callback_data: "admin:menu" },
      ];
      if (searchQuery) nav.push({ text: "✖ Сбросить поиск", callback_data: "admin:clients:clear" });
      if (totalPages > 1) nav.push({ text: "Вперёд ▶", callback_data: "admin:clients:2" });
      rows.push(nav);
      await ctx.reply(msg, { reply_markup: { inline_keyboard: rows } });
    } catch (e: unknown) {
      lastAdminSearch.delete(userId);
      const errMsg = e instanceof Error ? e.message : "Ошибка поиска";
      await ctx.reply(`❌ ${errMsg}`);
    }
    return;
  }

  const token = await getOrRestoreToken(userId, ctx.from?.username);
  if (!token) return;
  const publicConfig = await api.getPublicConfig().catch(() => null);
  if (await enforceSubscription(ctx, publicConfig)) return;

  // Если пользователь ожидает ввод подарочного кода
  if (awaitingGiftCode.has(userId)) {
    awaitingGiftCode.delete(userId);
    const code = ctx.message.text.trim().toUpperCase();
    const menuKb = { reply_markup: { inline_keyboard: [[{ text: publicConfig?.botBackLabel ?? "← Назад", callback_data: "menu:gift" }]] } };
    if (!code) {
      await ctx.reply("Код не может быть пустым.", menuKb);
      return;
    }
    try {
      const result = await api.redeemGiftCode(token, code);
      let text = `✅ Подарок активирован!\n\nПодписка #${result.subscriptionIndex} добавлена в ваш аккаунт!`;
      if (result.tariffName) {
        text += `\nТариф: ${result.tariffName}`;
      }
      if (result.giftMessage) {
        text += `\n\n💌 Сообщение от дарителя:\n«${result.giftMessage}»`;
      }
      await ctx.reply(text, menuKb);

      // Уведомляем дарителя о том, что подарок активирован
      if (result.creatorTelegramId) {
        const recipientName = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "Пользователь";
        const notifyText = `🎁 Ваш подарок активирован!\n\n${recipientName} принял(а) ваш подарок${result.tariffName ? ` (${result.tariffName})` : ""}.`;
        bot.api.sendMessage(result.creatorTelegramId, notifyText).catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка активации подарка";
      await ctx.reply(`❌ ${msg}`, menuKb);
    }
    return;
  }

  // Если пользователь ожидает ввод промокода
  if (awaitingPromoCode.has(userId)) {
    awaitingPromoCode.delete(userId);
    const lang = getUserLang(userId);
    const code = ctx.message.text.trim();
    const menuKb = { reply_markup: { inline_keyboard: [[{ text: publicConfig?.botBackLabel ?? _t("back_to_menu", lang), callback_data: "menu:main" }]] } };
    if (!code) {
      await ctx.reply(_t("promo.empty_code", lang), menuKb);
      return;
    }
    try {
      const checkResult = await api.checkPromoCode(token, code);
      if (checkResult.type === "FREE_DAYS") {
        const activateResult = await api.activatePromoCode(token, code);
        await ctx.reply(`✅ ${activateResult.message}`, menuKb);
      } else if (checkResult.type === "DISCOUNT") {
        const desc = checkResult.discountPercent
          ? `скидка ${checkResult.discountPercent}%`
          : checkResult.discountFixed
            ? `скидка ${checkResult.discountFixed}`
            : "скидка";
        activeDiscountCode.set(userId, { code, discountPercent: checkResult.discountPercent, discountFixed: checkResult.discountFixed });
        await ctx.reply(`✅ Промокод «${checkResult.name}» принят! ${desc}.\n\n${_t("promo.discount_applied", lang)}`, menuKb);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : _t("error_generic", lang);
      await ctx.reply(`❌ ${msg}`, menuKb);
    }
    return;
  }

  const num = Number(ctx.message.text.replace(/,/, "."));
  if (!Number.isFinite(num) || num < 1 || num > 1000000) return;

  try {
    const config = publicConfig ?? await api.getPublicConfig();
    const methods = config?.plategaMethods ?? [];
    const yooEnabled = !!config?.yoomoneyEnabled;
    const yookassaEnabledMsg = !!config?.yookassaEnabled;
    const cryptopayEnabledMsg = !!config?.cryptopayEnabled;
    if (!methods.length && !yooEnabled && !yookassaEnabledMsg && !cryptopayEnabledMsg) {
      await ctx.reply("Пополнение временно недоступно.");
      return;
    }
    const client = await api.getMe(token);
    const rawStyles = config?.botInnerButtonStyles;
    const backStyle = rawStyles?.back !== undefined ? rawStyles.back : "danger";
    const botEmojis = config?.botEmojis;
    const msgEmojiIds: InnerEmojiIds | undefined = botEmojis
      ? {
          back: botEmojis.BACK?.tgEmojiId,
          card: botEmojis.CARD?.tgEmojiId,
          tariff: botEmojis.PACKAGE?.tgEmojiId || botEmojis.TARIFFS?.tgEmojiId,
          trial: botEmojis.TRIAL?.tgEmojiId,
          profile: botEmojis.PUZZLE?.tgEmojiId || botEmojis.PROFILE?.tgEmojiId,
          connect: botEmojis.SERVERS?.tgEmojiId || botEmojis.CONNECT?.tgEmojiId,
        }
      : undefined;
    if (methods.length > 1 || (methods.length >= 1 && (yooEnabled || yookassaEnabledMsg || cryptopayEnabledMsg)) || (methods.length === 0 && ((yooEnabled && yookassaEnabledMsg) || (yooEnabled && cryptopayEnabledMsg) || (yookassaEnabledMsg && cryptopayEnabledMsg)))) {
      const topupMsg1 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, client.preferredCurrency)}\n\nВыберите способ оплаты:`, config?.botEmojis);
      await ctx.reply(topupMsg1.text, {
        entities: topupMsg1.entities.length ? topupMsg1.entities : undefined,
        reply_markup: topupPaymentMethodButtons(String(num), methods, config?.botBackLabel ?? null, backStyle, msgEmojiIds, yooEnabled, yookassaEnabledMsg, cryptopayEnabledMsg),
      });
      return;
    }
    // Если только ЮMoney (нет platega, нет ЮKassa) — сразу создаём
    if (methods.length === 0 && yooEnabled) {
      const payment = await api.createYoomoneyPayment(token, { amount: num, paymentType: "AC" });
      const topupMsgYoo = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты через ЮMoney:`, config?.botEmojis);
      await ctx.reply(topupMsgYoo.text, {
        entities: topupMsgYoo.entities.length ? topupMsgYoo.entities : undefined,
        reply_markup: payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, backStyle, msgEmojiIds),
      });
      return;
    }
    // Если только ЮKassa
    if (methods.length === 0 && yookassaEnabledMsg) {
      const payment = await api.createYookassaPayment(token, { amount: num, currency: "RUB" });
      const topupMsgYoo = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, "RUB")}\n\nНажмите кнопку ниже для оплаты через ЮKassa:`, config?.botEmojis);
      await ctx.reply(topupMsgYoo.text, {
        entities: topupMsgYoo.entities.length ? topupMsgYoo.entities : undefined,
        reply_markup: payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, backStyle, msgEmojiIds),
      });
      return;
    }
    // Если только Crypto Pay
    if (methods.length === 0 && cryptopayEnabledMsg) {
      const payment = await api.createCryptopayPayment(token, { amount: num, currency: client.preferredCurrency });
      const topupMsgCp = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты через Crypto Bot:`, config?.botEmojis);
      await ctx.reply(topupMsgCp.text, {
        entities: topupMsgCp.entities.length ? topupMsgCp.entities : undefined,
        reply_markup: payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, backStyle, msgEmojiIds),
      });
      return;
    }
    const payment = await api.createPlategaPayment(token, {
      amount: num,
      currency: client.preferredCurrency,
      paymentMethod: methods[0].id,
      description: "Пополнение баланса",
    });
    const topupMsg2 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(num, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
    await ctx.reply(topupMsg2.text, {
      entities: topupMsg2.entities.length ? topupMsg2.entities : undefined,
      reply_markup: payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, backStyle, msgEmojiIds),
    });
  } catch {
    // не число или ошибка — игнорируем
  }
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.start({
  onStart: async (info) => {
    BOT_USERNAME = info.username || "";
    console.log(`Bot @${BOT_USERNAME} started`);
    try {
      const cfg = await api.getPublicConfig();
      if (cfg?.translations) setTranslations(cfg.translations);
    } catch { /* ignore */ }
  },
});
