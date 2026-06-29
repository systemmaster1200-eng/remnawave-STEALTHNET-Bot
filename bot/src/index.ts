/**
 * STEALTHNET 4.2.0 — Telegram-бот
 * Полный функционал кабинета: главная, тарифы, профиль, пополнение, триал, реферальная ссылка, VPN.
 * Цветные кнопки: style primary / success / danger (Telegram Bot API).
 */

import "dotenv/config";
import { Bot, Composer, Context, InputFile } from "grammy";
import type { Api } from "grammy";
import { ProxyAgent as UndiciProxyAgent } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import * as api from "./api.js";
import {
  mainMenu,
  backToMenu,
  backToSubLabel,
  backToSubsListLabel,
  backButton,
  supportSubMenu,
  helpMainMenu,
  documentsSubMenu,
  topUpPresets,
  tariffPayButtons,
  tariffsOfCategoryButtons,
  tariffCategoryButtons,
  tariffPaymentMethodButtons,
  tariffOptionPickerButtons,
  tariffDevicePickerButtons,
  type InnerButtonStyles,
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
  mySubsListButtons,
  subDetailButtons,
  tariffActionChoiceButtons,
  type InlineMarkup,
  type InnerEmojiIds,
} from "./keyboard.js";
import { t as _t, formatDays as _formatDays, setTranslations } from "./i18n.js";
// 54-ФЗ-чек ЮКассы: prompt «нужен ли чек», ввод email, etc.
import {
  storePendingReceipt,
  peekPendingReceipt,
  takePendingReceipt,
  setPendingEmailInput,
  takePendingEmailInput,
  hasPendingEmailInput,
  receiptPromptText,
  receiptPromptKeyboard,
  EMAIL_PROMPT_TEXT,
  RECEIPT_OK_LINE,
  isValidEmail,
} from "./yk-receipt.js";

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

/** Общая логика для основного (единственного) бота. */
const composer = new Composer<Context>();

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
async function checkUserSubscription(
  telegramApi: Api,
  userId: number,
  channelInput: string,
): Promise<{ state: SubscriptionCheckState; target: ForceChannelTarget; error?: string }> {
  const target = parseForceChannelTarget(channelInput);
  if (!target.chatId) {
    return { state: "cannot_verify", target, error: "invalid_channel_id" };
  }
  try {
    const member = await telegramApi.getChatMember(target.chatId, userId);
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
    api: Api;
  },
  config: Awaited<ReturnType<typeof api.getPublicConfig>>,
): Promise<boolean> {
  if (!config?.forceSubscribeEnabled) return false;
  const channelId = config.forceSubscribeChannelId?.trim();
  if (!channelId) return false;
  const userId = ctx.from?.id;
  if (!userId) return false;
  const lang = getUserLang(userId);
  const result = await checkUserSubscription(ctx.api, userId, channelId);
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

type TariffPriceOption = { id: string; durationDays: number; price: number; sortOrder: number };
type DeviceDiscountTier = { minExtraDevices: number; discountPercent: number };
type TariffItem = {
  id: string;
  name: string;
  description?: string | null;
  durationDays: number;
  trafficLimitBytes?: number | null;
  trafficResetMode?: string;
  deviceLimit?: number | null;
  includedDevices?: number;
  pricePerExtraDevice?: number;
  maxExtraDevices?: number;
  deviceDiscountTiers?: DeviceDiscountTier[];
  price: number;
  currency: string;
  // T11+T12 (11.05.2026) — rich-text список локаций тарифа.
  locations?: string | null;
  priceOptions?: TariffPriceOption[];
};

/**
 * Цена пакета доп. устройств с учётом длительности.
 * pricePerExtra указан за 30 дней (база). Для других опций умножаем на (days/30).
 * Формула: extrasTotal = pricePerExtra × extras × (100 − discount) / 100 × (durationDays / 30)
 */
const EXTRA_DEVICE_BASE_DAYS = 30;
function applyExtraDevicesPriceBot(
  pricePerExtra: number,
  extraCount: number,
  tiers: DeviceDiscountTier[] | undefined,
  durationDays: number = EXTRA_DEVICE_BASE_DAYS,
): { extrasTotal: number; pct: number } {
  const safeCount = Math.max(0, Math.floor(extraCount));
  if (safeCount === 0 || pricePerExtra <= 0) return { extrasTotal: 0, pct: 0 };
  const sorted = [...(tiers ?? [])].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const tier = sorted.find((t) => safeCount >= t.minExtraDevices);
  const pct = tier?.discountPercent ?? 0;
  const safeDays = Math.max(1, durationDays);
  const monthly = pricePerExtra * safeCount * (100 - pct) / 100;
  const extrasTotal = Math.round(monthly * (safeDays / EXTRA_DEVICE_BASE_DAYS) * 100) / 100;
  return { extrasTotal, pct };
}

/** Включена ли продажа доп. устройств для тарифа. */
function hasExtraDevices(t: TariffItem): boolean {
  return (t.pricePerExtraDevice ?? 0) > 0 && (t.maxExtraDevices ?? 0) > 0;
}

/**
 * Помечает каждый тариф флагом `hasOptions` для отображения «от» в кнопках.
 * "от" показывается если: несколько priceOptions ИЛИ включены доп. устройства.
 */
function markHasOptions<T extends { tariffs: TariffItem[] }>(categories: T[]): (T & { tariffs: (TariffItem & { hasOptions: boolean })[] })[] {
  return categories.map((c) => ({
    ...c,
    tariffs: c.tariffs.map((t) => ({
      ...t,
      hasOptions: (t.priceOptions?.length ?? 0) > 1 || hasExtraDevices(t),
    })),
  }));
}
type TariffCategory = { id: string; name: string; emoji?: string; emojiKey?: string | null; singleSubscriptionMode?: boolean; tariffs: TariffItem[] };

/**
 * Сортировка опций цен. Опции с durationDays > 0 идут по sortOrder, затем по durationDays.
 * Возвращает копию массива (не мутирует оригинал).
 */
function sortedPriceOptions(options: TariffPriceOption[] | undefined | null): TariffPriceOption[] {
  if (!options || options.length === 0) return [];
  return [...options].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.durationDays - b.durationDays;
  });
}

/** Опция с лучшей ценой за день (для пометки эмодзи). Возвращает id или null. */
function bestPricePerDayOptionId(options: TariffPriceOption[]): string | null {
  if (options.length <= 1) return null;
  let bestId: string | null = null;
  let bestPerDay = Number.POSITIVE_INFINITY;
  for (const o of options) {
    if (o.durationDays <= 0) continue;
    const perDay = o.price / o.durationDays;
    if (perDay < bestPerDay) {
      bestPerDay = perDay;
      bestId = o.id;
    }
  }
  return bestId;
}

/** Кэш списка priceOptions тарифа для пользователя — для разрешения индекса из callback_data. */
// «addsub» mode — userId → tariffId, выставляется когда пользователь
// в category-aware диалоге выбрал «Купить как доп. подписку» (callback `pay_tariff:<id>:add`).
// Читается в pay_<provider>: handlers — если совпадает tariffId, передаём asAdditional=true
// в create<Provider>Payment, и на webhook'е activateTariffByPaymentId создаст secondary
// subscription через createAdditionalSubscription. Для balance — переключается на
// buyGiftSubscription напрямую (без webhook). Чистится при успешной оплате и при
// возврате в menu:main / menu:tariffs.
const addsubPending = new Map<number, string>();

/**
 * продление существующей secondary.
 * userId → { tariffId, secondaryId }. Ставится при клике на «💰 Продлить» в детали
 * secondary-подписки (через callback `pay_tariff:<tariffId>:extsec:<secondaryId>`).
 * Consume'ся в payment-методах — добавляется в metadata создаваемого payment.
 * При успешной оплате backend увидит `extendsSecondarySubId` и продлит ИМЕННО эту
 * secondary вместо создания новой.
 */
const extendingSecondaryPending = new Map<number, { tariffId: string; secondaryId: string }>();

/**
 * выбор тарифа для КОНВЕРТАЦИИ триала.
 * Если у триала задан convertTariffIds, перед продлением показываем экран выбора
 * тарифа. callback_data 64-байтный лимит не вмещает sid+tariffId (два cuid),
 * поэтому список кэшируется per-user, кнопки ссылаются на индекс
 * (`pay_ext_pickt:<i>`).
 */
const trialConvertPickCache = new Map<number, { sid: string; options: { id: string; name: string }[] }>();

/**
 * отложенное удаление доп. устройств.
 * Юзер нажал «🗑 Убрать устройства, продлить за X ₽» → запоминаем; реальный
 * removeExtraDevices вызываем ТОЛЬКО при подтверждении способа оплаты в handler'е.
 * Иначе: если юзер передумал и нажал Назад — устройства бы удалились НАПРАСНО.
 * userId → subscriptionId на которой ждёт drop.
 */
const pendingDropExtras = new Map<number, string>();

/**
 * целевая подписка для покупаемой extra-option.
 * userId → "primary" (= client.remnawaveUuid) или secondaryId.
 * Ставится в шаге выбора подписки перед оплатой опции; consume'ся в pay_option_*
 * (передаётся в backend через body.targetSubscriptionId).
 */
const extraOptionTargetSub = new Map<number, string>();
/**
 * T7c.3 fix (11.05.2026): pending выбранная опция (kind+productId) до выбора подписки.
 * Раньше пробрасывали через callback_data → callback `extra_opt_setsub:<sub>:<kind>:<productId>`
 * вырастал до >64 байт (Telegram режет → productId терял хвост → бэкенд не находил опцию,
 * показывал «Опция не найдена»). Теперь kind+productId хранится тут, callback короткий.
 * Ставится в `extra_opt_pick:`, consume'ся в `extra_opt_setsub:` (форвард на pay_option:).
 */
const extraOptionPending = new Map<number, { kind: "traffic" | "devices" | "servers"; productId: string }>();

const tariffOptionsCache = new Map<number, { tariffId: string; options: TariffPriceOption[] }>();
/** Выбранная опция цены тарифа + кол-во ДОП. устройств (extras), которые клиент докупил. */
const selectedTariffOption = new Map<number, { tariffId: string; option: TariffPriceOption; extraDevices: number }>();
/**
 * выбор «какой триал заменить» при покупке тарифа, когда у клиента >1 триальных
 * подписок. userId → subscriptionId триала. Ставится кнопкой `trialrepl:next` на экране
 * способов оплаты, прокидывается в payload покупки как `replaceTrialSubId`,
 * чистится после успешной оплаты или когда триалов ≤1.
 */
const trialReplaceChoice = new Map<number, string>();
/**
 * выбор «убрать доп. устройства» при конвертации/same-tariff-продлении
 * (превью tariffConversionPreview, БЕЗ extendsSecondarySubId — тот флоу живёт в
 * pendingDropExtras). userId в Set = юзер выбрал «убрать». Toggle — `convx:toggle`.
 */
const convDropExtras = new Set<number>();
/** Аналог для подарков: выбранная опция + extras для дополнительной подписки. */
const selectedGiftOption = new Map<number, { tariffId: string; option: TariffPriceOption | null; extraDevices: number }>();
/** Кэш priceOptions для подарков — для разрешения индекса из callback. */
const giftOptionsCache = new Map<number, { tariffId: string; options: TariffPriceOption[] }>();

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
// conversation state для заявки на вывод USDT TRC20.
// awaitingWithdrawAmount = ждём от юзера сумму (>= 3000).
// awaitingWithdrawWallet = ждём кошелёк TRC20, хранит уже введённую сумму.
const awaitingWithdrawAmount = new Set<number>();
const awaitingWithdrawWallet = new Map<number, number>();
// ожидание ввода кастомной суммы пополнения.
const awaitingCustomTopup = new Set<number>();

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
// храним subscriptionType + subscriptionId — нужны при удалении,
// чтобы backend знал из какой подписки удалять (раньше удалял только root → secondary error).
const lastDevicesList = new Map<number, { devices: { hwid: string; platform?: string; deviceModel?: string; subscriptionType?: "root" | "secondary"; subscriptionId?: string }[] }>();

// Poco/Redmi и пр. шлют битые (непарные)
// UTF-8 суррогаты в platform/deviceModel → Telegram отвергает "inline keyboard button
// text must be encoded in UTF-8" и экран «Устройства» падает на editMessageText.
// Buffer.from(utf8) заменяет непарные суррогаты на U+FFFD (валидный UTF-8) + срезаем
// управляющие символы. Если после чистки пусто — вызывающий код даёт fallback на hwid.
function sanitizeLabel(s: string): string {
  return Array.from(Buffer.from(String(s ?? ""), "utf8").toString("utf8")).filter((c) => c >= " ").join("");
}

/**
 * Если включён `botAutoDeleteUnknownMessages`, пробуем удалить сообщение пользователя.
 * Используется в fallback-ветках handler-ов (когда юзер прислал что-то не относящееся
 * к команде/активному вводу). Удаление silently fails если у бота нет прав.
 */
async function tryAutoDeleteUnknown(ctx: Context): Promise<void> {
  try {
    const config = await api.getPublicConfig();
    if (!config?.botAutoDeleteUnknownMessages) return;
    await ctx.deleteMessage().catch(() => {});
  } catch { /* не критично */ }
}

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

// подсказка под ссылкой подписки.
// Редактируется в админке (Тексты бота → bot_instruction_fallback_text). Этот дефолт
// используется если настройка пустая. Хелпер ниже подставляет текст из конфига или дефолт.
const DEFAULT_INSTRUCTION_FALLBACK =
  "💡 Если инструкции не открываются: скопируйте ссылку подписки и вставьте её в приложение Happ вручную или обратитесь в поддержку.";
function instructionFallbackText(cfg: { botInstructionFallbackText?: string | null } | null | undefined): string {
  return (cfg?.botInstructionFallbackText ?? "").trim() || DEFAULT_INSTRUCTION_FALLBACK;
}

const DEFAULT_MENU_TEXTS: Record<string, string> = {
  // маркетинговый welcome — весь текст в одной мульти-строке.
  // Остальные строки (welcomeTitlePrefix, balance/tariff/status/expire/...) скрыты по
  // умолчанию через DEFAULT_MENU_LINE_VISIBILITY — админ-конфиг может их вернуть точечно.
  welcomeTitlePrefix: "🛡 ",
  welcomeGreeting: [
    "🌐 Большой выбор локаций",
    "🎥 YouTube на высокой скорости без рекламы",
    "👥 Выгодная реферальная программа",
  ].join("\n"),
  balancePrefix: "💰 Ваш Баланс: ",
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

// дефолтная видимость строк welcome-меню.
// Маркетинговый шаблон в welcomeGreeting уже содержит все нужные инструкции,
// поэтому дублирующие info-строки (баланс/тариф/статус/дни/устройства/трафик/ссылка/CTA)
// скрыты по умолчанию. Админ может включить их обратно через
// SystemSetting → Bot → menuLineVisibility[key] = true.
const DEFAULT_MENU_LINE_VISIBILITY: Record<string, boolean> = {
  welcomeTitlePrefix: false,
  balancePrefix: false,
  tariffPrefix: false,
  subscriptionPrefix: false,
  expirePrefix: false,
  daysLeftPrefix: false,
  devicesLabel: false,
  trafficPrefix: false,
  linkLabel: false,
  chooseAction: false,
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

/**
 * единая точка маппинга currency-кода в символ.
 * Используется в formatTariffLine и в proxy/singbox fallback-строках, чтобы в боте
 * везде показывалось «₽» вместо «rub» / «RUB» / «руб». Mirrors keyboard.ts:currencySymbol.
 */
function currencySymbol(currency: string): string {
  const c = (currency || "").toUpperCase();
  return c === "RUB" ? "₽" : c === "USD" ? "$" : c === "UAH" ? "₴" : c === "EUR" ? "€" : c;
}

function formatTariffLine(tariff: TariffItem, fields: Required<BotTariffLineFields>): string {
  const parts: string[] = [];
  const opts = sortedPriceOptions(tariff.priceOptions);
  const multi = opts.length > 1;
  // Минимальная цена и минимальная длительность среди опций (для приставки «от»).
  const minPrice = multi ? opts.reduce((m, o) => (o.price < m ? o.price : m), opts[0]!.price) : tariff.price;
  const minDays = multi ? opts.reduce((m, o) => (o.durationDays < m ? o.durationDays : m), opts[0]!.durationDays) : tariff.durationDays;
  if (fields.name) parts.push(tariff.name);
  if (fields.durationDays) {
    const prefix = multi ? "от " : "";
    parts.push(`${prefix}${minDays} ${formatDaysRu(minDays)}`);
  }
  if (fields.price) {
    const prefix = multi ? "от " : "";
    const pricePart = fields.currency ? `${prefix}${minPrice} ${currencySymbol(tariff.currency)}` : `${prefix}${minPrice}`;
    parts.push(pricePart);
  } else if (fields.currency) {
    parts.push(`${currencySymbol(tariff.currency)}`);
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
  const rendered = template
    .split("{{CATEGORY}}").join(category)
    .split("{{TARIFFS}}").join(tariffLines);
  // автозамена математического знака бесконечности (U+221E)
  // на полноценный emoji «♾️» (U+267E + VS16). Иначе в Telegram «∞» отображается
  // тонким моноширинным символом — клиенты ожидают яркий emoji-бесконечность.
  return rendered.replace(/∞/g, "♾️");
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
  | { type: "bold"; offset: number; length: number }
  // моноширинный текст — копируется по тапу в Telegram.
  | { type: "code"; offset: number; length: number };

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
  // если body уже начинается с эмодзи (хардкод в коде
  // или юзер в шаблоне написал эмодзи) — не добавляем дополнительный префикс,
  // иначе получаются дубли вида «👥 👥 Реферальная программа».
  if (/^\p{Extended_Pictographic}/u.test(rest.trimStart())) {
    return { text: rest, entities: [] };
  }
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

/**
 * расширенный парсер текста меню — поддерживает И custom-emoji
 * placeholder'ы `{{KEY}}` (как applyCustomEmojiPlaceholders), И markdown-жирный
 * `**слово**`. Используется в pushLine/pushRaw (buildMainMenuText), чтобы админ
 * мог пометить «» жирным через шаблон welcomeGreeting.
 *
 * Single-pass char-iterator (не regex), поэтому offset'ы entity всегда корректны.
 * Внутри `**...**` рекурсивно прогоняется через ту же функцию — поддерживает
 * вложенные placeholder'ы внутри жирного.
 */
function applyMarkdownAndEmoji(
  rawText: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  if (!rawText) return { text: "", entities: [] };
  const entities: CustomEmojiEntity[] = [];
  let out = "";
  let i = 0;
  const n = rawText.length;
  while (i < n) {
    // {{KEY}} — emoji placeholder
    if (rawText[i] === "{" && rawText[i + 1] === "{") {
      const end = rawText.indexOf("}}", i + 2);
      if (end > i + 2) {
        const key = rawText.slice(i + 2, end);
        if (/^[A-Z0-9_]+$/.test(key)) {
          const entry = botEmojis?.[key];
          const fallbackUnicode = DEFAULT_EMOJI_UNICODE[key];
          const unicode = entry?.unicode?.trim() || (entry?.tgEmojiId ? DEFAULT_CUSTOM_EMOJI_CHAR : "") || fallbackUnicode || "";
          if (unicode) {
            const off = out.length;
            out += unicode;
            if (entry?.tgEmojiId) {
              entities.push({ type: "custom_emoji", offset: off, length: unicode.length, custom_emoji_id: entry.tgEmojiId });
            }
            i = end + 2;
            continue;
          }
        }
      }
    }
    // **text** — bold markdown
    if (rawText[i] === "*" && rawText[i + 1] === "*") {
      const end = rawText.indexOf("**", i + 2);
      if (end > i + 2) {
        const inner = rawText.slice(i + 2, end);
        const innerProcessed = applyMarkdownAndEmoji(inner, botEmojis);
        const off = out.length;
        for (const e of innerProcessed.entities) {
          entities.push({ ...e, offset: off + e.offset });
        }
        entities.push({ type: "bold", offset: off, length: innerProcessed.text.length });
        out += innerProcessed.text;
        i = end + 2;
        continue;
      }
    }
    // `code` — моноширинный текст. В Telegram такой
    // текст копируется по одному тапу («tap to copy»). Используется для Telegram ID в «Помощи».
    if (rawText[i] === "`") {
      const end = rawText.indexOf("`", i + 1);
      if (end > i + 1) {
        const inner = rawText.slice(i + 1, end);
        const off = out.length;
        entities.push({ type: "code", offset: off, length: inner.length });
        out += inner;
        i = end + 1;
        continue;
      }
    }
    out += rawText[i];
    i++;
  }
  return { text: out, entities };
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
  // если body уже начинается с эмодзи (юзер сам прописал
  // эмодзи в начале шаблона/заголовка) — не добавляем дополнительный префикс,
  // иначе получаются дубли вида «🛒🛒 Выберите тип подписки».
  if (/^\p{Extended_Pictographic}/u.test(rest.trimStart())) {
    return applyCustomEmojiPlaceholders(rest, botEmojis);
  }
  return titleWithEmojiAndCustomEmojis(emojiKey, rest, botEmojis);
}

/** Полный текст главного меню + entities для премиум-эмодзи в тексте (владелец бота должен иметь Telegram Premium). */
/**
 * парсит сырой Remnawave user из item.subscription и возвращает
 * готовые поля для форматирования (статус-эмодзи, тип-эмодзи, дни, дата, трафик).
 * Используется и в welcome-блоке (formatSubLine), и в «Мои подписки» handler'е.
 */
function parseSubInfo(item: {
  type: "root" | "secondary";
  subscriptionIndex: number | null;
  subscription: unknown;
  /** для определения ♾️ префикса у безлимитного Unblock (legacy fallback). */
  tariffDisplayName?: string | null;
  /** эмодзи-префикс из админки (Tariff.menuEmoji) — приоритетнее name-matching. */
  tariffMenuEmoji?: string | null;
}): {
  idx: number;
  typeEmoji: string;
  /** «🟢»/«🟡»/«🔴» — для текста (welcome). */
  statusEmojiBig: string;
  /** «✅»/«🟡»/«❌» — для кнопок (более компактный/контрастный). */
  statusEmojiSmall: string;
  /** Например «205 дн.». «—» если нет данных. */
  daysStr: string;
  /** «DD.MM.YYYY». «—» если нет данных. */
  dateStr: string;
  /** « | X/Y ГБ» или пусто (если без лимита). */
  trafficSuffix: string;
  /** true если подписка EXPIRED/DISABLED или expireAt в прошлом. */
  isExpired: boolean;
} {
  const subData = item.subscription as Record<string, unknown> | null;
  const inner = subData ? ((subData.response ?? subData.data ?? subData) as Record<string, unknown>) : null;
  const status = (inner?.status ?? inner?.userStatus ?? "ACTIVE") as string;
  const statusEmojiBig =
    status === "ACTIVE" ? "🟢" :
    status === "EXPIRED" ? "🔴" :
    status === "LIMITED" ? "🟡" :
    status === "DISABLED" ? "🔴" : "🟡";
  const statusEmojiSmall =
    status === "ACTIVE" ? "✅" :
    status === "EXPIRED" ? "❌" :
    status === "LIMITED" ? "🟡" :
    status === "DISABLED" ? "❌" : "🟡";
  // эмодзи зависит от ТАРИФА, не от типа подписки (root/secondary).
  // Приоритет:
  //   1. tariffMenuEmoji — настраиваемое поле Tariff.menuEmoji из админки (если задано)
  //   2. legacy name-matching: «Безлимит/∞» → ♾️🔒, «Unblock/Анблок» → 🔒, «Стандарт» → 🌐
  //   3. fallback по типу подписки: root → 🌐, secondary → 🔒
  let typeEmoji: string;
  const adminEmoji = item.tariffMenuEmoji?.trim();
  if (adminEmoji) {
    typeEmoji = adminEmoji;
  } else {
    const tariffNameRaw = item.tariffDisplayName ?? "";
    const tariffNameLower = tariffNameRaw.toLowerCase();
    const isUnlimited = tariffNameRaw.includes("∞") || tariffNameLower.includes("безлимит");
    const isUnblock = tariffNameLower.includes("unblock") || tariffNameLower.includes("анблок");
    const isStandard = tariffNameLower.includes("стандарт");
    if (isUnlimited) {
      typeEmoji = "♾️🔒";
    } else if (isUnblock) {
      typeEmoji = "🔒";
    } else if (isStandard) {
      typeEmoji = "🌐";
    } else {
      typeEmoji = item.type === "root" ? "🌐" : "🔒";
    }
  }
  const idx = item.subscriptionIndex ?? 0;

  let daysStr = "—";
  let dateStr = "—";
  let expiredByDate = false;
  const expireAtRaw = inner?.expireAt ?? inner?.expire_at;
  if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
    const expireAt = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
    if (!isNaN(expireAt.getTime())) {
      const diffMs = expireAt.getTime() - Date.now();
      const days = Math.max(0, Math.ceil(diffMs / 86_400_000));
      daysStr = `${days} дн.`;
      dateStr = expireAt.toLocaleDateString("ru-RU");
      if (diffMs <= 0) expiredByDate = true;
    }
  }
  // подписка считается истёкшей если EXPIRED/DISABLED по
  // Remna-статусу ИЛИ если expireAt прошёл (даже если статус ещё ACTIVE — может быть
  // задержка перевода в EXPIRED на стороне Remna).
  const isExpired = status === "EXPIRED" || status === "DISABLED" || expiredByDate;

  let trafficSuffix = "";
  const tlimit = inner?.trafficLimitBytes ?? inner?.traffic_limit_bytes;
  const tused = (inner?.userTraffic as { usedTrafficBytes?: number } | undefined)?.usedTrafficBytes
    ?? inner?.trafficUsedBytes ?? inner?.usedTrafficBytes ?? inner?.traffic_used_bytes;
  const limitNum = typeof tlimit === "string" ? parseFloat(tlimit) : Number(tlimit);
  const usedNum = typeof tused === "string" ? parseFloat(tused) : Number(tused);
  if (Number.isFinite(limitNum) && limitNum > 0) {
    const u = bytesToGb(Number.isFinite(usedNum) ? usedNum : 0);
    const l = bytesToGb(limitNum);
    trafficSuffix = ` | ${u}/${l} ГБ`;
  }

  return { idx, typeEmoji, statusEmojiBig, statusEmojiSmall, daysStr, dateStr, trafficSuffix, isExpired };
}

/**
 * форматирует строку для welcome-блока «Мои подписки» под главным меню.
 * Шаблон: «🟢 🌐 Подписка #N — N дн. до DD.MM.YYYY [| used/limit ГБ]».
 * **daysStr** обёрнуты в bold-markdown для applyMarkdownAndEmoji в pushRaw.
 */
function formatSubLine(item: {
  type: "root" | "secondary";
  subscriptionIndex: number | null;
  subscription: unknown;
  /** T16 (12.05.2026) — название тарифа и кастомный эмодзи для главного меню. */
  tariffDisplayName?: string | null;
  tariffMenuEmoji?: string | null;
}): string {
  const { idx, typeEmoji, statusEmojiBig, daysStr, dateStr, trafficSuffix } = parseSubInfo(item);
  return `${statusEmojiBig} ${typeEmoji} Подписка #${idx} — **${daysStr}** до ${dateStr}${trafficSuffix}`;
}

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
  /** Кастомный инфо-блок (тех. работы, акции, контакты). Скрывается если пусто. */
  infoBlock?: string | null;
  /**
   * список ВСЕХ подписок клиента (root + secondary), для блок подписок
   * под welcomeGreeting (фейковая нагрузка + список). Если undefined — блок не
   * рендерится (для других callers, без блока подписок).
   */
  allSubs?: {
    items: Array<{
      type: "root" | "secondary";
      id: string;
      subscriptionIndex: number | null;
      subscription: unknown;
      tariffDisplayName: string;
      /** T16 (12.05.2026) — эмодзи-префикс тарифа для главного меню бота. */
      tariffMenuEmoji?: string | null;
    }>;
  } | null;
}): { text: string; entities: CustomEmojiEntity[] } {
  const { serviceName, balance, currency, subscription, tariffDisplayName, menuTexts, menuLineVisibility, menuTextCustomEmojiIds, botEmojis, infoBlock, allSubs } = opts;
  const name = serviceName.trim() || "Кабинет";
  const balanceStr = formatMoney(balance, currency);
  const lines: string[] = [];
  const lineStartKeys: (string | null)[] = [];
  const lineEntitiesByIndex: CustomEmojiEntity[][] = [];
  // Учитываем DEFAULT_MENU_LINE_VISIBILITY (см. константу выше).
  // Приоритет: admin override (menuLineVisibility[key]) → default → visible.
  const shouldShow = (key: string) => {
    if (menuLineVisibility && key in menuLineVisibility) return menuLineVisibility[key] !== false;
    if (key in DEFAULT_MENU_LINE_VISIBILITY) return DEFAULT_MENU_LINE_VISIBILITY[key]!;
    return true;
  };
  const pushLine = (key: string, text: string) => {
    if (!shouldShow(key)) return;
    // applyMarkdownAndEmoji вместо applyCustomEmojiPlaceholders —
    // дополнительно парсит **bold** markdown в шаблонах (для жирного «»).
    const { text: processed, entities } = applyMarkdownAndEmoji(text, botEmojis);
    lines.push(processed);
    lineStartKeys.push(key);
    lineEntitiesByIndex.push(entities);
  };

  // Приветствие + имя сервиса в ОДНУ строку, жирным:
  // «👋 Добро пожаловать в 🛡 STEALTHNET».
  pushLine("welcomeGreeting", `**${t(menuTexts, "welcomeGreeting")} в ${t(menuTexts, "welcomeTitlePrefix")}${name}**`);
  // Баланс — сразу под шапкой (выше списка подписок), жирным.
  pushLine("balancePrefix", `**${t(menuTexts, "balancePrefix")}${balanceStr}**`);

  // Блок «список подписок» — все root + secondary активные/полученные в подарок
  // (как в «Мои подписки»), сразу после шапки.
  if (allSubs !== undefined) {
    // pushRaw тоже идёт через applyMarkdownAndEmoji — поддерживает **bold**
    // (количество подписок, дни) и {{KEY}} placeholders.
    const pushRaw = (text: string) => {
      const { text: processed, entities } = applyMarkdownAndEmoji(text, botEmojis);
      lines.push(processed);
      lineStartKeys.push(null);
      lineEntitiesByIndex.push(entities);
    };
    if (allSubs && allSubs.items.length > 0) {
      pushRaw("");
      pushRaw(`🔢 Подписок: **${allSubs.items.length}**`);
      const sorted = [...allSubs.items].sort((a, b) => {
        if (a.type !== b.type) return a.type === "root" ? -1 : 1;
        return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
      });
      for (const item of sorted) {
        pushRaw(formatSubLine(item));
      }
    }
  }

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

  // Кастомный инфо-блок: пустая строка-разделитель + сам блок построчно.
  // Скрывается если null/empty. Каждая строка обрабатывается отдельно для корректной позиции entities.
  const trimmedInfo = infoBlock?.trim();
  if (trimmedInfo) {
    lines.push("");
    lineStartKeys.push(null);
    lineEntitiesByIndex.push([]);
    for (const rawLine of trimmedInfo.split("\n")) {
      const { text: processed, entities } = applyCustomEmojiPlaceholders(rawLine, botEmojis);
      lines.push(processed);
      lineStartKeys.push(null);
      lineEntitiesByIndex.push(entities);
    }
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
  api: Api;
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
    return ctx.api.sendMessage(ctx.chat.id, text, { entities: entities?.length ? entities : undefined, reply_markup });
  }
  const hasMediaWithCaption = hasPhoto || hasAnimation;
  const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
  const truncatedEntities = text.length > TELEGRAM_CAPTION_MAX && entities ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
  if (hasMediaWithCaption) return ctx.editMessageCaption({ caption, caption_entities: truncatedEntities?.length ? truncatedEntities : undefined, reply_markup });
  return ctx.editMessageText(text, { entities: entities?.length ? entities : undefined, reply_markup });
}

/**
 * единый билд экрана «Помощь».
 * Возвращает текст (ID в `backtick` → копируется по тапу), entities и клавиатуру.
 * Используется И командой `/support`, И callback `menu:support` — чтобы не было
 * рассинхрона «через раз копируется ID» (раньше /support слал plain text без entities).
 */
function buildHelpScreen(opts: {
  helpIntroText?: string | null;
  supportLink?: string | null;
  botBackLabel?: string | null;
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null;
  tgId: string;
  tgUsername: string;
  subsCount: number;
  backStyle?: string;
  emojiIds?: InnerEmojiIds;
  lang?: string;
}): { text: string; entities: CustomEmojiEntity[]; markup: InlineMarkup } {
  const introRaw = (opts.helpIntroText ?? "").trim();
  const lines: string[] = [];
  if (introRaw) lines.push(introRaw, "");
  // Часы работы НЕ хардкодим — они задаются в helpIntroText (см. админку), иначе дублировались бы.
  lines.push(`🆔 Telegram ID: \`${opts.tgId}\``);
  if (opts.tgUsername) lines.push(`👤 Username: @${opts.tgUsername}`);
  lines.push(`🗒 Активных подписок: ${opts.subsCount}`);
  const { text, entities } = applyMarkdownAndEmoji(lines.join("\n"), opts.botEmojis ?? null);
  const markup = helpMainMenu(
    { support: opts.supportLink },
    opts.botBackLabel ?? null,
    opts.backStyle,
    opts.emojiIds,
    opts.lang ?? "ru",
  );
  return { text, entities, markup };
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
 * унифицированный расчёт «зачёркивания»
 * для тарифа с учётом обоих типов скидок — персональной (clients.personal_discount_percent)
 * и промокода (activeDiscountCode). Стэкаются в порядке «сначала персональная, затем
 * промокод» (так же делает бэк в payment endpoints).
 *
 * Возвращает:
 *   - `finalPrice` — целое в рублях (Math.floor, без копеек — как считает бэк)
 *   - `discountArg` — для `buildPaymentMessage`, рисующий `~~basePrice~~ → finalPrice (−N%)`.
 *     `undefined` если ни одной скидки не применилось.
 *
 * Важно: на бэк всё равно отправляем `basePrice` (бэк сам пересчитает с pd + promo —
 * не доверяем боту); этот helper только для UI.
 */
function buildTariffDiscountArg(
  basePrice: number,
  personalDiscountPercent: number,
  promo: DiscountInfo | undefined,
  currency: string,
): { discountArg: { originalPrice: string; discountedPrice: string } | undefined; finalPrice: number } {
  let withPd = basePrice;
  if (personalDiscountPercent > 0) {
    withPd = Math.max(0, Math.floor(basePrice * (1 - personalDiscountPercent / 100)));
  }
  const withPromo = promo ? getDiscountedPrice(withPd, promo) : withPd;
  const finalPrice = Math.max(0, Math.floor(withPromo));
  if (finalPrice >= Math.floor(basePrice)) {
    return { discountArg: undefined, finalPrice };
  }
  const pct = Math.round((1 - finalPrice / basePrice) * 100);
  return {
    discountArg: {
      originalPrice: formatMoney(Math.floor(basePrice), currency),
      discountedPrice: formatMoney(finalPrice, currency) + " (-" + pct + "%)",
    },
    finalPrice,
  };
}

/**
 * Парсинг start-параметра.
 * Новый формат (через __): ref_CODE__s_SOURCE__m_MEDIUM__k_CAMPAIGN__n_CONTENT__t_TERM
 * Старый формат (через _c_): ref_CODE_c_SOURCE_CAMPAIGN
 * Кампания без рефкода: c_SOURCE_CAMPAIGN (например /start c_vk_winter)
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

  const parseCampaignPart = (campaignPart: string): void => {
    const parts = campaignPart.split("_").filter(Boolean);
    if (parts.length >= 2) {
      out.utm_source = parts[0];
      out.utm_campaign = parts.length === 2 ? parts[1] : parts[parts.length - 1];
      if (parts.length >= 3) out.utm_medium = parts.slice(1, -1).join("_");
    } else if (parts.length === 1) {
      out.utm_source = parts[0];
    }
  };

  // Кампания без рефкода: payload начинается сразу с `c_`.
  // этот формат раньше не парсился вовсе — поиск `_c_` находит
  // подчёркивание ПЕРЕД `c`, а в "c_vk_winter" его нет. UTM терялись, а fallback
  // в обработчике /start записывал весь payload клиенту как refCode.
  if (/^c_/i.test(payload)) {
    parseCampaignPart(payload.slice(2));
    return out;
  }

  const cIdx = payload.indexOf("_c_");
  const refPart = cIdx >= 0 ? payload.slice(0, cIdx) : payload;
  const campaignPart = cIdx >= 0 ? payload.slice(cIdx + 3) : "";
  if (refPart && /^ref_?/i.test(refPart)) {
    const code = refPart.replace(/^ref_?/i, "").trim();
    if (code) out.refCode = code;
  }
  if (campaignPart) parseCampaignPart(campaignPart);
  return out;
}

// ——— /start с реферальным кодом (например /start ref_ABC123) или промо (/start promo_XXXX) или кампания (/start c_facebook_summer)
// per-user throttle для /start. При массовой рассылке (30k+
// мигрированных юзеров) или если юзер нервно жмёт «Старт» несколько раз — каждый
// повтор от одного и того же tgid в течение 2 сек тихо игнорируется. Защищает
// DB/Remna от лишних запросов и Telegram-API от спама ответов.
const startThrottle = new Map<number, number>();
setInterval(() => {
  const cutoff = Date.now() - 60 * 1000;
  for (const [k, v] of startThrottle) if (v < cutoff) startThrottle.delete(k);
}, 60 * 1000).unref?.();

composer.command("start", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const now = Date.now();
  const last = startThrottle.get(from.id) ?? 0;
  if (now - last < 2000) return; // повтор < 2 сек — тихо дропаем
  startThrottle.set(from.id, now);
  const telegramId = String(from.id);
  const telegramUsername = from.username ?? undefined;
  const payload = ctx.match?.trim() || "";

  // Сбрасываем состояние рассылки, чтобы баннер/фото не «залипало»
  lastBroadcastMessage.delete(from.id);
  awaitingBroadcastMessage.delete(from.id);

  // Deep-link активации подарка: /start gift_<code>
  // Юзер получил ссылку `t.me/<bot>?start=gift_<code>` от того кто подарил.
  // Активируем подарок мгновенно — без диалога подтверждения.
  if (/^gift_/i.test(payload)) {
    const lang = getUserLang(from.id);
    const code = payload.replace(/^gift_/i, "").trim();
    if (!code) {
      await ctx.reply("❌ Неверная ссылка подарка.");
      return;
    }
    try {
      // Сначала убедимся что юзер зарегистрирован — если нет, регнём по telegramId.
      let token = getToken(from.id);
      if (!token) {
        const reg = await api.registerByTelegram({
          telegramId,
          telegramUsername,
          preferredLang: from.language_code ?? "ru",
        });
        token = reg.token;
        if (token) tokenStore.set(from.id, token);
      }
      if (!token) {
        await ctx.reply("❌ Не удалось получить доступ. Попробуйте позже.");
        return;
      }
      // Активируем подарочный код.
      const result = await api.redeemGiftCode(token, code);
      // config тут не в scope — грузим отдельно.
      const giftCfg = await api.getPublicConfig().catch(() => null);
      // новые тексты получателю по ТЗ клиента.
      // Стандартная (без трафика) — короткий красивый текст.
      // Unblock (с трафиком) — полное описание Unblock с лимитом.
      const hasTrafficLimit = result.trafficLimitBytes != null && result.trafficLimitBytes > 0;
      const days = result.durationDays ?? 0;
      const tariffName = result.tariffName ?? "Подписка";
      const supportLink = giftCfg?.supportLink || "";
      // подсказка «если инструкция не открылась» (подарочная подписка).
      // приписка редактируется в админке («Тексты бота» →
      // bot_gift_url_note); раньше «до 4 устройств» было захардкожено.
      const giftUrlNote = (giftCfg?.botGiftUrlNote ?? "").trim()
        || "💡 Подписка обновляется автоматически\n1️⃣ подписка - до 4️⃣ устройств одновременно";
      const urlBlock = result.subscriptionUrl
        ? `Ссылка подписки:\n${result.subscriptionUrl}\n\n${giftUrlNote}\n\n${instructionFallbackText(giftCfg)}`
        : "";
      let receiverText: string;
      if (hasTrafficLimit) {
        const trafficGb = Math.round((result.trafficLimitBytes ?? 0) / 1024 ** 3);
        // добавляем «💰 Стоимость: X ₽» для Unblock по ТЗ клиента.
        const priceBlock = result.tariffPrice != null && result.tariffPrice > 0
          ? `💰 Стоимость: ${Math.round(result.tariffPrice)} ${(result.tariffCurrency ?? "RUB").toUpperCase() === "RUB" ? "₽" : (result.tariffCurrency ?? "")}\n\n`
          : "";
        receiverText =
          `💝 Вам подарили ${tariffName} на ${days} дней!\n\n` +
          `💡 Это Unblock подписка\nОна позволяет оставаться на связи даже при ограничениях интернета в регионе.\n\n` +
          `📅 Срок действия: ${days} дней\n📊 Лимит трафика: ${trafficGb} GB\n${priceBlock}` +
          `Unblock Internet🔓 — позволяет оставаться на связи в любых ситуациях.\n\n` +
          `⚡️ Unblock поможет, если:\n      🛜 у вас в регионе периодически действуют ограничения мобильного интернета (отключают интернет)\n      🤜 локации из обычной подписки уже не спасают\n      ⛔️ ключи из обычной подписки сами перестают работать через несколько минут после включения\n\n` +
          `💡 Во всех остальных случаях вам поможет стандартная подписка: Главное меню → 💳 Купить доступ\n\n` +
          `🎥 Нет рекламы на YouTube.\n\n` +
          `❗️Если у вас НЕ работают даже сайты из Белого списка (Яндекс, VK, Госуслуги и т.д.) – данная подписка не поможет.\n\n` +
          `💡 Чтобы скопировать подписку, нажмите на неё один раз\n\n` +
          `${urlBlock}\n\n` +
          `💬 По любым вопросам вам поможет наша поддержка - ${supportLink}`;
      } else {
        receiverText =
          `💝 Вам подарили подписку на ${days} день!\n\n` +
          `💡 Чтобы скопировать подписку, нажмите на неё один раз\n\n` +
          `${urlBlock}\n\n` +
          `💬 По любым вопросам вам поможет наша поддержка - ${supportLink}`;
      }
      // Кнопки как при покупке/триале.
      type Row = ({ text: string; callback_data: string } | { text: string; url: string })[];
      const giftRows: Row[] = [];
      if (result.subscriptionUrl) giftRows.push([{ text: "📲 Инструкции по установке", url: result.subscriptionUrl }]);
      giftRows.push([{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]);
      giftRows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
      await ctx.reply(receiverText, { reply_markup: { inline_keyboard: giftRows } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка активации подарка";
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }

  // deep-link «продлить конкретную подписку».
  // Используется из авторассылки `subscription_expired` — кнопка «🔄 Продлить» в сообщении
  // содержит url `https://t.me/<bot>?start=renew_<subscriptionId>`. По нажатию открываем
  // оплату того же тарифа подписки (как кнопка «💰 Продлить» в детали).
  if (/^renew_/i.test(payload)) {
    const subId = payload.replace(/^renew_/i, "").trim();
    if (!subId) {
      await ctx.reply("❌ Неверная ссылка продления.");
      return;
    }
    const token = await getOrRestoreToken(from.id, from.username);
    if (!token) {
      await ctx.reply("🔐 Сначала запустите бота через /start");
      return;
    }
    try {
      const all = await api.getAllSubscriptions(token);
      const item = (all.items ?? []).find((it) => it.id === subId);
      if (!item) {
        await ctx.reply("❌ Подписка не найдена или истекла. Зайдите в «📋 Мои подписки».", {
          reply_markup: { inline_keyboard: [[{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]] },
        });
        return;
      }
      if (!item.tariffId) {
        await ctx.reply("⚠️ К подписке не привязан тариф. Выберите вручную из меню тарифов.", {
          reply_markup: { inline_keyboard: [[{ text: "💳 Купить доступ", callback_data: "menu:tariffs" }]] },
        });
        return;
      }
      // Открываем оплату того же тарифа (использует продление через pay_tariff_ext).
      await ctx.reply(
        `🔄 Продление подписки #${item.subscriptionIndex ?? 0} — ${item.tariffDisplayName ?? "Тариф"}\n\nВыберите способ оплаты:`,
        { reply_markup: { inline_keyboard: [[{ text: "💰 Продлить эту подписку", callback_data: `pay_tariff_ext:${item.id}` }], [{ text: "🏠 Главное меню", callback_data: "menu:main" }]] } },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка";
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }

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

  // Deep-link привязки Telegram к аккаунту сайта: /start link_<code>
  // Открывается прямой ссылкой из кабинета (кнопка «Привязать Telegram»).
  if (/^link_/i.test(payload)) {
    const linkLang = getUserLang(from.id);
    const code = payload.replace(/^link_/i, "").trim();
    if (!code) {
      await ctx.reply(_t("link.prompt", linkLang));
      return;
    }
    try {
      await api.linkTelegramFromBot(code, from.id, from.username ?? undefined);
      await ctx.reply(_t("link.success", linkLang));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : _t("error_generic", linkLang);
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }

  // Определяем тип deeplink
  const isPromo = /^promo_/i.test(payload);
  const promoCode = isPromo ? payload.replace(/^promo_/i, "") : undefined;
  const parsed = parseStartPayload(payload);
  // Fallback «голый payload = рефкод» — только если payload реально похож на
  // рефкод (без префиксов c_/ref_). Раньше `payload.replace(/^ref_?/i, "")`
  // при отсутствии префикса возвращал строку как есть, и кампанийные ссылки
  // вида `c_vk_winter` записывались клиенту как referralCode.
  const isCampaignOnly = /^c_/i.test(payload);
  const bareRefFallback = !isCampaignOnly && !/^ref_?/i.test(payload) ? payload.trim() || undefined : undefined;
  const refCode = !isPromo ? (parsed.refCode ?? bareRefFallback) : undefined;

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

    // event-driven welcome (after_registration)
    // запускаем сразу после регистрации НОВОГО клиента — не ждём крон. Бэкенд сам
    // дедупит по (rule_id, client_id), так что повторный вызов безопасен.
    // Удалил учётку → новый client_id → дедуп пройдёт → юзер опять получит приветствие.
    if (auth.isNewClient) {
      api.fireOnRegistration(auth.token).catch((e) => {
        console.error("[fireOnRegistration] failed:", e);
      });
    }

    // Если это промо-ссылка — активируем промокод
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

    // Проверка подписки на канал
    if (await enforceSubscription(ctx, config)) return;

    // ─── Приветственное сообщение (если включено в админке) ───
    // Показываем картинку + текст с кнопкой «Войти», которая ведёт в главное меню.
    // Если showOnce=true — только при первом /start (когда client.onboardingCompleted=false).
    const welcomeEnabled = Boolean((config as { botWelcomeEnabled?: boolean })?.botWelcomeEnabled);
    if (welcomeEnabled) {
      const showOnce = Boolean((config as { botWelcomeShowOnce?: boolean })?.botWelcomeShowOnce);
      const alreadySeen = showOnce && client?.onboardingCompleted === true;
      if (!alreadySeen) {
        const welcomeText = ((config as { botWelcomeText?: string | null })?.botWelcomeText ?? "").trim();
        const welcomeImage = ((config as { botWelcomeImage?: string | null })?.botWelcomeImage ?? "").trim();
        if (welcomeText || welcomeImage) {
          const continueMarkup = { inline_keyboard: [[{ text: "✨ Войти в кабинет", callback_data: "welcome:continue" }]] };
          try {
            const media = welcomeImage ? logoToMediaSource(welcomeImage) : null;
            const captionMax = TELEGRAM_CAPTION_MAX;
            const safeText = welcomeText.length > captionMax ? welcomeText.slice(0, captionMax - 3) + "..." : welcomeText;
            if (media) {
              if (media.isGif) {
                await ctx.replyWithAnimation(media.source, { caption: safeText || undefined, reply_markup: continueMarkup });
              } else {
                await ctx.replyWithPhoto(media.source, { caption: safeText || undefined, reply_markup: continueMarkup });
              }
            } else {
              await ctx.reply(welcomeText, { reply_markup: continueMarkup });
            }
            // Если showOnce — отметим что приветствие показано (сохранится после первого «Войти»)
            return;
          } catch (e) {
            console.error("[/start welcome] failed:", e instanceof Error ? e.message : e);
            // продолжаем как обычно — fallback на главное меню
          }
        }
      }
    }

    const [subRes, proxyRes, singboxRes, allSubsRes] = await Promise.all([
      api.getSubscription(auth.token).catch(() => ({ subscription: null })),
      api.getPublicProxyTariffs().catch(() => ({ items: [] })),
      api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
      // тянем все подписки клиента для блок подписок в welcome (нагрузка + список).
      api.getAllSubscriptions(auth.token).catch(() => ({ items: [] })),
    ]);
    const vpnUrl = getSubscriptionUrl(subRes.subscription);
    // если в админке настроены trials → используем их (скрываем
    // кнопку когда юзер всё взял); иначе fallback на legacy single-trial.
    const trialAvail = await api.getAvailableTrials(auth.token).catch(() => ({ items: [], hasAnyEnabled: false }));
    // Скрываем кнопку бесплатного теста, если есть хотя бы одна активная подписка.
    const hasActiveSub = (allSubsRes.items ?? []).some((it) => !parseSubInfo(it).isExpired);
    const showTrial = !hasActiveSub && (trialAvail.hasAnyEnabled
      ? trialAvail.items.length > 0
      : Boolean(config?.trialEnabled && !client?.trialUsed));
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
      infoBlock: config?.botInfoBlock ?? null,
      allSubs: allSubsRes,
    });
    const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
    const captionEntities = text.length > TELEGRAM_CAPTION_MAX && entities.length ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
    const hasVideoInstructions = config?.videoInstructionsEnabled && (config?.videoInstructions?.length ?? 0) > 0;
    const hasSupportLinks = !!(config?.supportLink || config?.agreementLink || config?.offerLink || config?.instructionsLink || hasVideoInstructions);
    const markup = mainMenu({
      showTrial,
      // кнопка «🔌 Подключиться автоматически» показывается
      // если есть ХОТЯ БЫ ОДНА подписка (root ИЛИ secondary, включая триал). Раньше зависела
      // только от vpnUrl (root), и юзеры с одним триалом не видели кнопку.
      showVpn: Boolean(vpnUrl) || (allSubsRes.items?.length ?? 0) > 0,
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
composer.command("link", async (ctx) => {
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

// ─── T8: bot menu commands ────────────────────────────────────────
// Команды бота, попадающие в синюю панельку (через setMyCommands в onStart):
//   /start          — Главное меню          (уже есть выше)
//   /subscriptions  — Моя подписка / инструкции
//   /referral       — Реферальная программа
//   /support        — Поддержка
// Каждая команда отправляет inline-кнопку, которая дёргает существующий
// callback_query handler — это zero-risk вариант (не трогаем основную логику).
//   /link  — оставлен как back-compat хендлер, но НЕ показывается в меню.

// убраны промежуточные сообщения с inline-кнопкой
// «Открыть [меню]» — команды сразу рендерят финальный контент (список / экран).
// Логика дублирует соответствующие callback handler'ы (menu:my_subs / menu:referral /
// menu:support), но вместо editMessageContent отправляет новое сообщение через ctx.reply.

composer.command("subscriptions", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const token = await getOrRestoreToken(userId, ctx.from?.username);
  if (!token) {
    await ctx.reply("🔐 Сначала запустите бота через /start");
    return;
  }
  try {
    const result = await api.getAllSubscriptions(token);
    if (!result.items?.length) {
      await ctx.reply("📋 Мои подписки\n\nУ вас пока нет активных подписок.", {
        reply_markup: { inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "menu:main" }]] },
      });
      return;
    }
    const sorted = [...result.items].sort((a, b) => {
      if (a.type !== b.type) return a.type === "root" ? -1 : 1;
      return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
    });
    const cfg = await api.getPublicConfig().catch(() => null);
    const bodyLines = [`📋 Мои подписки (**${sorted.length}**)`, ""];
    const buttonItems = sorted.map((it) => {
      const info = parseSubInfo(it);
      const trialBodyMark = it.trialId ? " 🎁" : "";
      // без названия тарифа в текстовой строке —
      // для истёкших «❌ истекла», для активных «N дн. до DD.MM.YYYY [+трафик]».
      if (info.isExpired) {
        bodyLines.push(`${info.typeEmoji} #${info.idx}${trialBodyMark} — ❌ истекла`);
      } else {
        bodyLines.push(`${info.typeEmoji} #${info.idx}${trialBodyMark} — **${info.daysStr}** до ${info.dateStr}${info.trafficSuffix}`);
      }
      // В кнопке: «✅/❌ #N <tariff> (N дн./истекла)». tariffDisplayName уже с эмодзи.
      const tariff = (it.tariffDisplayName || "—").slice(0, 38);
      const trialBtnMark = it.trialId ? " 🎁" : "";
      const lifetimeStr = info.isExpired ? "истекла" : info.daysStr;
      const label = `${info.statusEmojiSmall} #${info.idx} ${tariff} (${lifetimeStr})${trialBtnMark}`;
      return { type: it.type, id: it.id, label };
    });
    const { text, entities } = applyMarkdownAndEmoji(bodyLines.join("\n"), cfg?.botEmojis ?? null);
    await ctx.reply(text, {
      entities: entities?.length ? entities : undefined,
      reply_markup: mySubsListButtons(buttonItems, cfg?.botBackLabel ?? null, undefined, undefined),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    await ctx.reply(`❌ ${msg}`);
  }
});

composer.command("referral", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const token = await getOrRestoreToken(userId, ctx.from?.username);
  if (!token) {
    await ctx.reply("🔐 Сначала запустите бота через /start");
    return;
  }
  try {
    const client = await api.getMe(token);
    if (!client.referralCode) {
      await ctx.reply("Реферальная ссылка пока недоступна. Попробуйте позже.");
      return;
    }
    const cfg = await api.getPublicConfig().catch(() => null);
    const stats = await api.getReferralStats(token).catch(() => null);
    const baseUrl = cfg?.publicAppUrl?.replace(/\/$/, "") ?? "";
    const linkSite = baseUrl ? `${baseUrl}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}` : null;
    const linkBot = `https://t.me/${ctx.me?.username ?? "bot"}?start=ref_${client.referralCode}`;
    const p1 = stats?.referralPercent ?? client.referralPercent ?? (cfg?.defaultReferralPercent ?? 0);
    const p2 = stats?.referralPercentLevel2 ?? (cfg?.referralPercentLevel2 ?? 0);
    const fmt = (n: number) => `${Math.round(n)}₽`;
    const lines: string[] = [
      "👥 Реферальная программа",
      "",
      "Поделитесь ссылкой с друзьями и получайте процент со всех их пополнений! 🤝",
      "",
      `👥 Рефералы 1 уровня: ${p1}%`,
      `Вы получаете ${p1}% от пополнений тех, кто перешёл по вашей ссылке.`,
      `• Переходов по вашей ссылке: ${stats?.l1Clicks ?? 0}`,
      `• Приобрели подписку: ${stats?.l1Purchased ?? 0}`,
      `• Доход с рефералов 1 уровня: ${fmt(stats?.l1Earned ?? 0)}`,
      "",
      `🤝 Рефералы 2 уровня: ${p2}%`,
      `Вы получаете ${p2}% от пополнений рефералов ваших рефералов.`,
      `• Приглашено вашими рефералами: ${stats?.l2InvitesCount ?? 0}`,
      `• Доход с рефералов 2 уровня: ${fmt(stats?.l2Earned ?? 0)}`,
      "",
      `💰 Ваш заработок (всего): ${fmt(stats?.totalEarned ?? 0)}`,
      `💸 Выведено: ${fmt(stats?.totalWithdrawn ?? 0)}`,
      `🛒 Потрачено: ${fmt(stats?.totalSpent ?? 0)}`,
      `💵 Доступно: ${fmt(stats?.availableBalance ?? client.balance ?? 0)}`,
      "",
      "🔗 Ваша реферальная ссылка:",
      "",
      "Telegram Бот:",
      linkBot,
    ];
    if (linkSite) {
      lines.push("", "Сайт:", linkSite);
    }
    lines.push("", "💡 С реферального баланса можно оплатить подписку или вывести эти средства на свой кошелёк.");
    // формат как в gift — `url=` + `text=`.
    // Ссылку В САМ ТЕКСТ НЕ кладём — она уже идёт через параметр `url=` и
    // выводится TG-клиентом ПЕРВОЙ строкой автоматически. Если продублировать
    // в shareText — получим две одинаковых ссылки подряд (баг юзера 14.05).
    const shareText = `\n🛡 Надёжный VPN, который реально работает!\n\nРаботает там, где другие не справляются.\n\n💡 Нажми на ссылку выше, чтобы подключиться.`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(linkBot)}&text=${encodeURIComponent(shareText)}`;
    const rows: ({ text: string; url: string } | { text: string; callback_data: string })[][] = [];
    rows.push([{ text: "📢 Поделиться ссылкой", url: shareUrl }]);
    rows.push([{ text: "💳 Оплатить/продлить доступ", callback_data: "menu:tariffs" }]);
    // кнопка вывода скрывается тогглом из админки;
    // мин. сумма — из настройки withdrawal_min_amount (была захардкожена 3000₽).
    if (cfg?.withdrawalsEnabled !== false) {
      rows.push([{ text: `💰 Заявка на вывод (от ${cfg?.withdrawalMinAmount ?? 3000}₽)`, callback_data: "withdraw:start" }]);
    }
    rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.reply(lines.join("\n"), { reply_markup: { inline_keyboard: rows as any } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    await ctx.reply(`❌ ${msg}`);
  }
});

composer.command("support", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const token = await getOrRestoreToken(userId, ctx.from?.username);
  if (!token) {
    await ctx.reply("🔐 Сначала запустите бота через /start");
    return;
  }
  try {
    const cfg = await api.getPublicConfig().catch(() => null);
    const tgId = String(userId);
    const tgUsername = ctx.from?.username ?? "";
    let subsCount = 0;
    try {
      const subs = await api.getAllSubscriptions(token);
      subsCount = subs.items?.length ?? 0;
    } catch { /* ignore */ }
    // тот же билд, что и callback menu:support → ID копируется.
    const { text, entities, markup } = buildHelpScreen({
      helpIntroText: cfg?.helpIntroText,
      supportLink: cfg?.supportLink,
      botBackLabel: cfg?.botBackLabel,
      botEmojis: cfg?.botEmojis,
      tgId,
      tgUsername,
      subsCount,
      lang: getUserLang(userId),
    });
    await ctx.reply(text, {
      entities: entities.length ? entities : undefined,
      reply_markup: markup,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    await ctx.reply(`❌ ${msg}`);
  }
});

/**
 * Показать экран «способы оплаты» для тарифа с уже выбранными опцией и числом ДОП. устройств.
 * effectivePrice = priceOption.price + (extras × pricePerExtraDevice × (100 − discount) / 100).
 */
type ConfigSnapshot = Awaited<ReturnType<typeof api.getPublicConfig>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// T-tariff-restriction (портировано из WolfVPN): при отказе-ограничении (code TARIFF_RESTRICTED)
// показываем ЯВНУЮ кнопку «🏠 Главное меню» (чтобы юзер не застрял), иначе обычный backToMenu.
function tariffErrMarkup(e: unknown, config: ConfigSnapshot | null, backStyle: Parameters<typeof backToMenu>[1], emojiIds: Parameters<typeof backToMenu>[2]): ReturnType<typeof backToMenu> {
  if ((e as { code?: string } | null)?.code === "TARIFF_RESTRICTED") {
    return { inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "menu:main" }]] };
  }
  return backToMenu(config?.botBackLabel ?? null, backStyle, emojiIds);
}

async function showPaymentMethodsForTariff(ctx: any, userId: number, tariff: TariffItem, option: TariffPriceOption | null, extraDevices: number, config: ConfigSnapshot | null, innerStyles: InnerButtonStyles | undefined, innerEmojiIds: InnerEmojiIds | undefined, token: string, subExtrasMonthlyPrice: number = 0): Promise<void> {
  const opts = sortedPriceOptions(tariff.priceOptions);
  const eff = option ?? opts[0] ?? null;
  const unitPrice = eff?.price ?? tariff.price;
  const effectiveDays = eff?.durationDays ?? tariff.durationDays;
  const includedDevices = tariff.includedDevices ?? 1;
  const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
  // добавляем стоимость доп. устройств подписки
  // (накопленных через sell-options), масштабированную на выбранную длительность.
  const subExtrasForPeriod = subExtrasMonthlyPrice > 0 && effectiveDays > 0
    ? Math.round(subExtrasMonthlyPrice * (effectiveDays / 30) * 100) / 100
    : 0;
  const effectivePrice = unitPrice + extrasTotal + subExtrasForPeriod;
  const methods = config?.plategaMethods ?? [];
  const client = await api.getMe(token);
  // помощник стэкает персональную скидку клиента
  // и активный промокод. Возвращает finalPrice + discountArg для зачёркивания базовой цены.
  const personalDiscount = client?.personalDiscountPercent ?? 0;
  const discountInfo = activeDiscountCode.get(userId);
  const { discountArg, finalPrice: priceForDisplay } = buildTariffDiscountArg(effectivePrice, personalDiscount, discountInfo, tariff.currency);
  const balanceLabel = client && client.balance >= priceForDisplay ? `💰 Оплатить балансом (${formatMoney(client.balance, client.preferredCurrency ?? "RUB")})` : null;
  const totalDevices = includedDevices + extraDevices;
  const devicesSuffix = extraDevices > 0 ? ` · ${totalDevices} устр (+${extraDevices} доп.)` : "";
  const nameWithDays = opts.length > 1 || option
    ? `${tariff.name} · ${formatRuDays(effectiveDays)}${devicesSuffix}`
    : `${tariff.name}${devicesSuffix}`;
  const pay = buildPaymentMessage(config, {
    name: nameWithDays,
    price: formatMoney(priceForDisplay, tariff.currency),
    amount: String(priceForDisplay),
    currency: tariff.currency,
    action: "Выберите способ оплаты:",
  }, discountArg);
  // T11+T12 (11.05.2026): для тарифов с одним priceOption (Unblock и т.п.) этот экран —
  // первый видимый юзеру шаг покупки. Подставляем `tariff.description` чтобы клиент
  // увидел rich-text (как на эталонных скринах 4 / Unblock и Безлимитная Unblock).
  // Для тарифов с несколькими opts (Стандартная) описание уже показано в picker'е длительности.
  const desc = ((tariff as TariffItem & { description?: string | null }).description ?? "").trim();
  // предупреждение о конвертации (режим «одна подписка из
  // категории»): покупка обновит существующую подписку, а не создаст вторую.
  let convNote = "";
  // интерактивные ряды НАД клавиатурой способов оплаты
  // (toggle «сохранить/убрать устройства», выбор заменяемого триала).
  const extraRows: { text: string; callback_data: string }[][] = [];
  let convHasExtras = false;
  let trialsCount = 0;
  try {
    const conv = await api.tariffConversionPreview(token, { tariffId: tariff.id, priceOptionId: eff?.id });
    if (conv.willConvert && conv.subscription) {
      const subName = conv.subscription.tariffName ? `«${conv.subscription.tariffName}»` : `#${conv.subscription.index}`;
      const extras = conv.extras;
      const dropChosen = convDropExtras.has(userId);
      if (conv.mode === "extend") {
        // тот же тариф = продление: дни складываются, ничего не сбрасывается.
        // newDevicesNote: НОВЫЕ устройства, выбранные в ЭТОЙ покупке (extraDevices) —
        // они уже в цене и добавятся в любом случае; количества показываем с ними.
        const newSuffix = extraDevices > 0 ? ` + ${extraDevices} новых из этой покупки` : "";
        convNote = `\n\n🔄 Этот тариф у вас уже есть — подписка ${subName} будет ПРОДЛЕНА (дни сложатся: остаток ${conv.remainingDays ?? 0} дн. + ${conv.purchasedDays ?? 0} дн. = ${conv.totalDays ?? 0} дн.).${extraDevices > 0 ? "" : " Устройства и серверы останутся как есть."}`;
        if (extras && extras.extraDevices > 0) {
          convHasExtras = true;
          if (dropChosen) {
            convNote += `\n📱 Прежние доп. устройства (+${extras.extraDevices}) будут УБРАНЫ — без доплаты за них. Останется ${extras.drop.totalDevices + extraDevices} устройств (из тарифа${newSuffix}).`;
            if (extraDevices >= extras.extraDevices) {
              convNote += `\n⚠️ Вы убираете ${extras.extraDevices} прежних и добавляете ${extraDevices} новых — устройств меньше не станет, а за новые вы платите. Если хотели оставить как есть — выберите «сохранить» и уберите новые устройства.`;
            }
          } else if ((extras.keep.extraCost ?? 0) > 0) {
            convNote += `\n📱 Доплата за +${extras.extraDevices} прежних доп. устройств: ${extras.keep.extraCost} ₽ за период. Всего будет ${extras.keep.totalDevices + extraDevices} устройств (${extras.keep.totalDevices} прежних${newSuffix}).`;
          } else {
            convNote += `\n📱 Ваши +${extras.extraDevices} доп. устройств сохранятся (итого ${extras.keep.totalDevices + extraDevices} устройств${newSuffix ? ` — ${extras.keep.totalDevices} прежних${newSuffix}` : ""}) — без доплаты.`;
          }
        }
      } else {
        const head = conv.subscription.isTrial
          ? "🔄 Пробная подписка станет платной"
          : `🔄 Подписка ${subName} будет обновлена`;
        const daysPart = (conv.convertedDays ?? 0) > 0 && (conv.remainingDays ?? 0) > 0
          ? `\nОстаток ${conv.remainingDays} дн. → ${conv.convertedDays} дн. по цене нового тарифа. Итого: ${conv.totalDays} дн.`
          : "";
        convNote = `\n\n${head} — вторая подписка не создаётся.${daysPart}`;
        // расклад по доп. устройствам: вариант выбирается toggle-кнопкой ниже
        // (по умолчанию — сохранить; «убрать» даёт больше конвертированных дней).
        if (extras && extras.extraDevices > 0) {
          convHasExtras = true;
          const newSuffixConv = extraDevices > 0 ? ` + ${extraDevices} новых из этой покупки` : "";
          if (dropChosen) {
            convNote += `\n📱 Прежние доп. устройства (+${extras.extraDevices}) будут УБРАНЫ: конвертация ${extras.drop.convertedDays} дн. Останется ${extras.drop.totalDevices + extraDevices} устройств (из тарифа${newSuffixConv}).`;
            if (extraDevices >= extras.extraDevices) {
              convNote += `\n⚠️ Вы убираете ${extras.extraDevices} прежних и добавляете ${extraDevices} новых — устройств меньше не станет, а за новые вы платите.`;
            }
          } else {
            convNote += `\n📱 Ваши +${extras.extraDevices} доп. устройств сохранятся (итого ${extras.keep.totalDevices + extraDevices} устройств${newSuffixConv ? ` — ${extras.keep.totalDevices} прежних${newSuffixConv}` : ""}, конвертация ${extras.keep.convertedDays} дн.).`;
          }
        }
      }
      if (convHasExtras) {
        extraRows.push([{ text: `📱 Устройства: ${dropChosen ? "убрать ✓" : "сохранить ✓"}`, callback_data: "convx:toggle" }]);
      }
    }
    // покупка заменяет активный триал (полностью, с удалением).
    // Показываем предупреждение с именем заменяемого пробника; при нескольких
    // триалах — кнопку циклического выбора, какой именно заменить.
    if (!convNote) {
      const subsAll = await api.getAllSubscriptions(token);
      const trialsOwned = (subsAll.items ?? []).filter((s) => s.trialId);
      trialsCount = trialsOwned.length;
      if (trialsOwned.length > 0) {
        const chosenId = trialReplaceChoice.get(userId);
        const chosen = trialsOwned.find((s) => s.id === chosenId) ?? trialsOwned[0];
        const tname = chosen.trialName ?? chosen.tariffDisplayName;
        convNote = `\n\n⚠️ Покупка заменит ваш пробный период «${tname}» — дни и трафик пробника не переносятся.`;
        if (trialsOwned.length > 1) {
          // фиксируем выбор сразу: экран и payload покупки всегда согласованы.
          trialReplaceChoice.set(userId, chosen.id);
          convNote += `\nЗаменится: «${tname}»`;
          extraRows.push([{ text: "🎁 Заменить другой пробник ▸", callback_data: "trialrepl:next" }]);
        }
      }
    }
  } catch { /* превью не критично — не блокируем оплату */ }
  // сбросы устаревшего выбора: превью без extras / триалов ≤1.
  if (!convHasExtras) convDropExtras.delete(userId);
  if (trialsCount <= 1) trialReplaceChoice.delete(userId);
  // convNote добавляется СУФФИКСОМ: префикс сместил бы offsets pay.entities (custom emoji).
  const finalText = `${desc && opts.length === 1 ? `${desc}\n\n${pay.text}` : pay.text}${convNote}`;
  const markup = tariffPaymentMethodButtons(tariff.id, methods, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds, balanceLabel, !!config?.yoomoneyEnabled, !!config?.yookassaEnabled, !!config?.cryptopayEnabled, tariff.currency, !!config?.heleketEnabled, !!config?.lavaEnabled, !!config?.lavatopEnabled, config?.botEmojis ?? null);
  for (let i = extraRows.length - 1; i >= 0; i--) markup.inline_keyboard.unshift(extraRows[i]!);
  await editMessageContent(ctx, finalText, markup, pay.entities);
}

/** Picker доп. устройств для подарочной подписки. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showGiftDevicePicker(ctx: any, userId: number, tariff: TariffItem, option: TariffPriceOption | null, config: ConfigSnapshot | null, innerStyles: InnerButtonStyles | undefined, innerEmojiIds: InnerEmojiIds | undefined): Promise<void> {
  const opts = sortedPriceOptions(tariff.priceOptions);
  const eff = option ?? opts[0] ?? null;
  const unitPrice = eff?.price ?? tariff.price;
  const days = eff?.durationDays ?? tariff.durationDays;
  const tiers = tariff.deviceDiscountTiers;
  const pricePerExtra = tariff.pricePerExtraDevice ?? 0;
  const maxExtras = tariff.maxExtraDevices ?? 0;
  const includedDevices = tariff.includedDevices ?? 1;
  const sym = tariff.currency.toUpperCase() === "RUB" ? "₽" : tariff.currency.toUpperCase() === "USD" ? "$" : tariff.currency;

  const tiles = Array.from({ length: maxExtras + 1 }, (_, i) => {
    const extras = i;
    const { extrasTotal, pct } = applyExtraDevicesPriceBot(pricePerExtra, extras, tiers, days);
    return { extras, total: unitPrice + extrasTotal, pct };
  });
  const bestExtra = tiles.slice(1).reduce((best, cur) => {
    const perDev = cur.total / (includedDevices + cur.extras);
    if (best == null || perDev < best.perDev) return { extras: cur.extras, perDev };
    return best;
  }, null as { extras: number; perDev: number } | null);

  const rows: { text: string; callback_data: string }[][] = [];
  let row: { text: string; callback_data: string }[] = [];
  for (const tile of tiles) {
    const isBest = bestExtra?.extras === tile.extras && tile.extras > 0 && tile.pct === 0;
    const badge = tile.pct > 0 ? ` 🎁−${tile.pct}%` : isBest ? " ⭐" : "";
    const prefix = tile.extras === 0 ? "Без доп." : `+${tile.extras} устр`;
    const label = `${prefix} · ${tile.total} ${sym}${badge}`.slice(0, 64);
    row.push({ text: label, callback_data: `gift_tdev:${tile.extras}` });
    if (row.length >= 2) { rows.push(row); row = []; }
  }
  if (row.length > 0) rows.push(row);
  rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);

  const text = `🎁 ${tariff.name} · ${days} ${formatRuDays(days)}\n\n📱 В тариф включено: ${includedDevices} устр.\nДобавьте дополнительные:`;
  // Mark unused params to satisfy linter
  void innerStyles; void innerEmojiIds;
  await editMessageContent(ctx, text, { inline_keyboard: rows } as InlineMarkup);
}

/** Финальный экран оплаты подарка балансом (с уже выбранной длительностью + extras). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showGiftPaymentConfirm(ctx: any, userId: number, tariff: TariffItem, option: TariffPriceOption | null, extras: number, config: ConfigSnapshot | null, innerStyles: InnerButtonStyles | undefined, innerEmojiIds: InnerEmojiIds | undefined, token: string): Promise<void> {
  const opts = sortedPriceOptions(tariff.priceOptions);
  const eff = option ?? opts[0] ?? null;
  const unitPrice = eff?.price ?? tariff.price;
  const days = eff?.durationDays ?? tariff.durationDays;
  const includedDevices = tariff.includedDevices ?? 1;
  const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extras, tariff.deviceDiscountTiers, days);
  const total = unitPrice + extrasTotal;
  const totalDevices = includedDevices + extras;
  const client = await api.getMe(token);
  const balanceLabel = `💰 Оплатить балансом (${formatMoney(client?.balance ?? 0, client?.preferredCurrency ?? "RUB")})`;
  const devicesSuffix = extras > 0 ? ` · ${totalDevices} устр (+${extras} доп.)` : "";
  const text = `🛒 ${tariff.name} · ${days} ${formatRuDays(days)}${devicesSuffix}\n\nСтоимость: ${formatMoney(total, tariff.currency)}\n\nПодтвердите оплату:`;
  void userId;
  // теперь подарочную можно оплатить любым включённым провайдером.
  // Баланс показываем только если на нём достаточно денег.
  const hasBalance = (client?.balance ?? 0) >= total;
  await editMessageContent(ctx, text, giftPaymentButtons(
    tariff.id,
    hasBalance ? balanceLabel : null,
    config?.botBackLabel ?? null,
    innerStyles,
    innerEmojiIds,
    !!config?.yookassaEnabled,
    !!config?.yoomoneyEnabled,
    !!config?.cryptopayEnabled,
    !!config?.heleketEnabled,
    !!config?.lavaEnabled,
    tariff.currency,
  ));
}

// ——— Callback: меню и действия
composer.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from?.id;
  if (!userId) return;
  await ctx.answerCallbackQuery().catch(() => {});

  // ─── 54-ФЗ-чек: prompt «нужен ли чек» перед ЮКасса-платежом ───
  // Каждый pay_*_yookassa-handler сохраняет builder+finalize в yk-receipt store и показывает
  // этот prompt. Тут мы реагируем на 3 варианта ответа: «без чека», «на сохранённый email»,
  // «ввести другой email» (последний — ставит pending text input, ниже обработается).
  if (data.startsWith("yk_recpt:")) {
    const parts = data.split(":");
    const action = parts[1]; // no | saved | ask
    const tok = parts.slice(2).join(":");
    if (action === "ask") {
      const p = peekPendingReceipt(tok);
      if (!p || p.userId !== userId) {
        await ctx.reply("⏰ Сессия истекла. Откройте «Оплатить» ещё раз.");
        return;
      }
      setPendingEmailInput(userId, tok);
      await ctx.reply(EMAIL_PROMPT_TEXT);
      return;
    }
    const p = takePendingReceipt(tok);
    if (!p || p.userId !== userId) {
      await ctx.reply("⏰ Сессия истекла. Откройте «Оплатить» ещё раз.");
      return;
    }
    // для "no" передаём пустую строку (явный отказ),
    // не undefined: иначе backend сделает fallback на client.email и пришлёт чек.
    const receiptEmail: string = action === "saved" ? (p.savedEmail ?? "") : "";
    try {
      const payment = await p.builder(receiptEmail);
      await p.finalize(payment, { receiptSentTo: receiptEmail || null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }

  // ─── Приветствие → «Войти в кабинет» — открывает главное меню ───
  if (data === "welcome:continue") {
    const token = getToken(userId);
    if (!token) {
      await ctx.reply("Сессия истекла. Отправьте /start ещё раз.");
      return;
    }
    try {
      // Помечаем что онбординг пройден (чтобы при showOnce=true приветствие больше не показывалось)
      await api.completeOnboarding(token).catch(() => {});
      const config = await api.getPublicConfig();
      if (config?.translations) setTranslations(config.translations);
      const me = await api.getMe(token);
      const [subRes, proxyRes, singboxRes, allSubsRes] = await Promise.all([
        api.getSubscription(token).catch(() => ({ subscription: null })),
        api.getPublicProxyTariffs().catch(() => ({ items: [] })),
        api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
        // для блок подписок в welcome.
        api.getAllSubscriptions(token).catch(() => ({ items: [] })),
      ]);
      const vpnUrl = getSubscriptionUrl(subRes.subscription);
      // T15: новый/legacy flow.
      const trialAvail = await api.getAvailableTrials(token).catch(() => ({ items: [], hasAnyEnabled: false }));
      // Скрываем кнопку бесплатного теста, если есть хотя бы одна активная подписка.
      const hasActiveSub = (allSubsRes.items ?? []).some((it) => !parseSubInfo(it).isExpired);
      const showTrial = !hasActiveSub && (trialAvail.hasAnyEnabled
        ? trialAvail.items.length > 0
        : Boolean(config?.trialEnabled && !me.trialUsed));
      const showProxy = proxyRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
      const showSingbox = singboxRes.items?.some((c: { tariffs: unknown[] }) => c.tariffs?.length > 0) ?? false;
      const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
      const { text, entities } = buildMainMenuText({
        serviceName: config?.serviceName?.trim() || "Кабинет",
        balance: me.balance ?? 0,
        currency: me.preferredCurrency ?? config?.defaultCurrency ?? "usd",
        subscription: subRes.subscription,
        tariffDisplayName: (subRes as { tariffDisplayName?: string | null }).tariffDisplayName ?? null,
        menuTexts: config?.botMenuTexts ?? config?.resolvedBotMenuTexts ?? null,
        menuLineVisibility: config?.botMenuLineVisibility ?? null,
        menuTextCustomEmojiIds: config?.menuTextCustomEmojiIds ?? null,
        botEmojis: config?.botEmojis ?? null,
        infoBlock: config?.botInfoBlock ?? null,
        allSubs: allSubsRes,
      });
      const hasVideoInstructions = config?.videoInstructionsEnabled && (config?.videoInstructions?.length ?? 0) > 0;
      const hasSupportLinks = !!(config?.supportLink || config?.agreementLink || config?.offerLink || config?.instructionsLink || hasVideoInstructions);
      const markup = mainMenu({
        showTrial,
        // T-fix (11.05.2026): кнопка vpn доступна если есть ЛЮБАЯ подписка (включая secondary/триал).
        showVpn: Boolean(vpnUrl) || (allSubsRes.items?.length ?? 0) > 0,
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
      const isBotAdmin = config?.botAdminTelegramIds?.includes(String(userId)) ?? false;
      if (isBotAdmin) markup.inline_keyboard.push([{ text: "⚙️ Панель админа", callback_data: "admin:menu" }]);
      // Нельзя editMessageContent у photo — отправляем новое сообщение и удаляем старое
      const cbMsg = ctx.callbackQuery?.message;
      const media = logoToMediaSource(config?.logoBot);
      if (media) {
        const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
        const captionEntities = text.length > TELEGRAM_CAPTION_MAX && entities.length ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
        const opts = { caption, caption_entities: captionEntities.length ? captionEntities : undefined, reply_markup: markup };
        if (media.isGif) await ctx.replyWithAnimation(media.source, opts);
        else await ctx.replyWithPhoto(media.source, opts);
      } else {
        await ctx.reply(text, { entities: entities.length ? entities : undefined, reply_markup: markup });
      }
      if (cbMsg?.message_id) {
        await ctx.api.deleteMessage(cbMsg.chat.id, cbMsg.message_id).catch(() => {});
      }
    } catch (e) {
      console.error("[welcome:continue]", e instanceof Error ? e.message : e);
      await ctx.reply("Не удалось открыть меню. Попробуйте /start.");
    }
    return;
  }

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
          [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
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
        const result = await checkUserSubscription(ctx.api, userId, channelId);
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
      const result = await checkUserSubscription(ctx.api, userId, channelId);
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
          profile: botEmojis.PROFILE?.tgEmojiId || botEmojis.PUZZLE?.tgEmojiId,
          connect: botEmojis.SERVERS?.tgEmojiId || botEmojis.CONNECT?.tgEmojiId,
        }
      : undefined;

    if (data === "menu:main") {
      // defensive cleanup — выходя в главное меню сбрасываем addsub-флаг.
      addsubPending.delete(userId);
      const [client, subRes, proxyRes, singboxRes, allSubsRes] = await Promise.all([
        api.getMe(token),
        api.getSubscription(token).catch(() => ({ subscription: null })),
        api.getPublicProxyTariffs().catch(() => ({ items: [] })),
        api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
        // для блок подписок в welcome (нагрузка + список подписок).
        api.getAllSubscriptions(token).catch(() => ({ items: [] })),
      ]);
      if (client?.preferredLang) setUserLang(userId, client.preferredLang);
      const vpnUrl = getSubscriptionUrl(subRes.subscription);
      // если в админке настроены trials → используем их (скрываем
      // кнопку когда юзер всё взял); иначе fallback на legacy single-trial.
      const trialAvail = await api.getAvailableTrials(token).catch(() => ({ items: [], hasAnyEnabled: false }));
      // Скрываем кнопку бесплатного теста, если есть хотя бы одна активная подписка.
      const hasActiveSub = (allSubsRes.items ?? []).some((it) => !parseSubInfo(it).isExpired);
      const showTrial = !hasActiveSub && (trialAvail.hasAnyEnabled
        ? trialAvail.items.length > 0
        : Boolean(config?.trialEnabled && !client?.trialUsed));
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
        infoBlock: config?.botInfoBlock ?? null,
        allSubs: allSubsRes,
      });
      const hasVideoInstructionsCb = config?.videoInstructionsEnabled && (config?.videoInstructions?.length ?? 0) > 0;
      const hasSupportLinks = !!(config?.supportLink || config?.agreementLink || config?.offerLink || config?.instructionsLink || hasVideoInstructionsCb);
      const backMarkup = mainMenu({
        showTrial,
        // T-fix (11.05.2026): кнопка vpn доступна если есть ЛЮБАЯ подписка (включая secondary/триал).
        showVpn: Boolean(vpnUrl) || (allSubsRes.items?.length ?? 0) > 0,
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

      // If current message is text-only (no photo/animation) but logo is configured,
      // delete the text message and re-send the main menu with the logo image.
      const cbMsg = ctx.callbackQuery?.message;
      const cbHasPhoto = cbMsg && typeof cbMsg === "object" && "photo" in cbMsg && Array.isArray((cbMsg as { photo: unknown[] }).photo) && (cbMsg as { photo: unknown[] }).photo.length > 0;
      const cbHasAnimation = cbMsg && typeof cbMsg === "object" && "animation" in cbMsg && (cbMsg as { animation: unknown }).animation != null;
      const media = logoToMediaSource(config?.logoBot);
      if (!cbHasPhoto && !cbHasAnimation && media && ctx.chat?.id) {
        await ctx.deleteMessage().catch(() => {});
        const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
        const captionEntities = text.length > TELEGRAM_CAPTION_MAX && entities ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
        const opts = { caption, caption_entities: captionEntities?.length ? captionEntities : undefined, reply_markup: backMarkup };
        if (media.isGif) {
          await ctx.api.sendAnimation(ctx.chat.id, media.source, opts);
        } else {
          await ctx.api.sendPhoto(ctx.chat.id, media.source, opts);
        }
        return;
      }

      await editMessageContent(ctx, text, backMarkup, entities);
      return;
    }

    // T11 (11.05.2026) — экран «⭕ Помощь» по эталону скрина 15.
    // Содержит: helpIntroText (большой блок «цели/приоритеты»),
    //           часы поддержки (support_hours_from/to),
    //           блок с контактами клиента (Telegram ID, Username, Активных подписок).
    // Кнопки: «🧑‍💼 Написать в поддержку», «📄 Документы», «🏠 Главное меню».
    // ❌ Решение по UX (11.05.2026) — НЕ показываем «Активных ключей» и «Пароль для сайта».
    if (data === "menu:support") {
      const lang = getUserLang(userId);
      const tgId = String(userId);
      const tgUsername = ctx.from?.username ?? "";
      // Подсчёт подписок клиента: всё что есть в getAllSubscriptions
      let subsCount = 0;
      try {
        const subs = await api.getAllSubscriptions(token);
        subsCount = subs.items?.length ?? 0;
      } catch {
        /* ignore */
      }
      // единый билд экрана Помощи (см. buildHelpScreen).
      const { text, entities, markup } = buildHelpScreen({
        helpIntroText: config?.helpIntroText,
        supportLink: config?.supportLink,
        botBackLabel: config?.botBackLabel,
        botEmojis: config?.botEmojis,
        tgId,
        tgUsername,
        subsCount,
        backStyle: innerStyles?.back,
        emojiIds: innerEmojiIds,
        lang,
      });
      await editMessageContent(ctx, text, markup, entities);
      return;
    }

    // T11 (11.05.2026) — подменю «📄 Документы» по эталону скрина 16.
    if (data === "menu:docs") {
      const lang = getUserLang(userId);
      await editMessageContent(
        ctx,
        "📄 Документы",
        documentsSubMenu(
          {
            agreement: config?.agreementLink,
            offer: config?.offerLink,
            refund: config?.refundLink,
          },
          config?.botBackLabel ?? null,
          innerStyles?.back,
          innerEmojiIds,
          lang,
        ),
      );
      return;
    }

    // T11+T12 (11.05.2026) — экран «🌐 Локации» для конкретного тарифа.
    // два формата callback'а:
    //   1) `loc:<tariffId>:<r|s>:<subId>` — новый сжатый (subDetailButtons), даёт кнопку «Назад»
    //   2) `menu:locations:<tariffId>` — legacy, без кнопки «Назад» (только «В меню»)
    if (data.startsWith("loc:") || data.startsWith("menu:locations:")) {
      const isCompact = data.startsWith("loc:");
      const tail = data.slice(isCompact ? "loc:".length : "menu:locations:".length);
      const parts = tail.split(":");
      const tariffId = parts[0] ?? "";
      const compactT = isCompact ? parts[1] : null;
      const backSubType: "root" | "secondary" | null =
        compactT === "r" ? "root" : compactT === "s" ? "secondary" : null;
      const backSubId = isCompact ? (parts[2] ?? null) : null;
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
        const text = ((tariff as TariffItem & { locations?: string | null } | undefined)?.locations ?? "").trim()
          || "🌐 Локации\n\nДля этого тарифа локации пока не настроены. Обратитесь в поддержку.";
        // Текст «Назад» из настроек админки (config.botBackLabel) — пользователь видит
        // тот же смайлик что и везде в боте. Fallback на «⬅️ Назад».
        const backText = (config?.botBackLabel && config.botBackLabel.trim()) || "⬅️ Назад";
        const homeText = "🏠 Главное меню";
        const inline_keyboard: { text: string; callback_data: string }[][] = [];
        if (backSubType && backSubId) {
          inline_keyboard.push([{ text: backText, callback_data: `sub:detail:${backSubType}:${backSubId}` }]);
        }
        inline_keyboard.push([{ text: homeText, callback_data: "menu:main" }]);
        await editMessageContent(ctx, text, { inline_keyboard });
      } catch {
        await editMessageContent(ctx, "🌐 Локации\n\n❌ Ошибка загрузки.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // T14 (11.05.2026) — экран «🛡 Бесплатный Прокси для Telegram».
    // динамический список прокси-серверов (tgProxyServers).
    // Каждый элемент = {flag, name, url}. Рендерим по кнопке на каждый.
    // Backward compat: если массив пуст — используем старые primary/backup
    // с дефолтными лейблами по странам (NL / DE).
    if (data === "menu:tg_proxy") {
      const text = (config?.tgProxyText ?? "").trim() || "🛡 Бесплатный прокси для Telegram\n\nНастройки прокси пока не заданы. Обратитесь в поддержку.";
      const servers = (config?.tgProxyServers ?? []) as { flag?: string; name?: string; url?: string }[];
      const rows: { text: string; url?: string; callback_data?: string }[][] = [];
      if (servers.length > 0) {
        for (const s of servers) {
          const url = (s.url ?? "").trim();
          if (!url) continue;
          const label = `${(s.flag ?? "").trim()} ${(s.name ?? "").trim()}`.trim() || "Прокси";
          rows.push([{ text: label, url }]);
        }
      } else {
        // Fallback на legacy-поля primary/backup.
        const primaryUrl = (config?.tgProxyUrlPrimary ?? "").trim();
        const backupUrl = (config?.tgProxyUrlBackup ?? "").trim();
        if (primaryUrl) rows.push([{ text: "🇳🇱 Нидерланды", url: primaryUrl }]);
        if (backupUrl) rows.push([{ text: "🇩🇪 Германия", url: backupUrl }]);
      }
      // «menu:back» не зарегистрирован → кнопка ломалась.
      // Используем «menu:main» и переименуем в «🏠 Главное меню».
      rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await editMessageContent(ctx, text, { inline_keyboard: rows as any });
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
      // defensive cleanup — возврат в список тарифов сбрасывает addsub-флаг.
      addsubPending.delete(userId);
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
      // меню выбора категорий (Настройки → Бот, default ON). Если включено
      // и категорий больше одной — сначала показываем экран выбора категории; клик по
      // категории → cat_tariffs:<id> → список её тарифов. Категории с пустым списком тарифов
      // пропускаем. Если категория всего одна — меню не нужно, сразу её тарифы.
      const showCategories = config?.botShowTariffCategories !== false;
      const nonEmptyCats = items.filter((c: TariffCategory) => (c.tariffs ?? []).length > 0);
      if (showCategories && nonEmptyCats.length > 1) {
        const menuEmojiKey = getMenuEmojiKey(config, "tariffs");
        const menuBody = "Выберите категорию тарифов:";
        const { text, entities } = titleWithOptionalEmoji(menuEmojiKey, menuBody, config?.botEmojis);
        await editMessageContent(
          ctx,
          text,
          tariffCategoryButtons(
            nonEmptyCats.map((c: TariffCategory) => ({ id: c.id, name: c.name, emoji: c.emoji })),
            config?.botBackLabel ?? null,
            innerStyles,
            tariffsEmojiIds,
          ),
          entities,
        );
        return;
      }
      // меню выключено ИЛИ одна категория — плоский список.
      // Несколько категорий при выключенном меню сливаем в одну виртуальную.
      if (items.length > 1) {
        const merged = items.flatMap((c: TariffCategory) => c.tariffs ?? []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const virtual: any = { id: "_all_", name: "Тарифы", emoji: "", emojiKey: null, tariffs: merged };
        items.splice(0, items.length, virtual);
      }
      const cat = items[0]!;
      const nameOnly = (cat.name || "").replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "").trim() || cat.name || "";
      const head = (cat.emoji && cat.emoji.trim() ? cat.emoji + " " : "") + nameOnly;
      const tariffFields = { ...DEFAULT_TARIFF_LINE_FIELDS, ...(config?.botTariffsFields ?? {}) };
      const template = (config?.botTariffsText ?? "").trim() || DEFAULT_TARIFFS_TEXT;
      const tariffLines = cat.tariffs.map((t: TariffItem) => formatTariffLine(t, tariffFields)).join("\n");
      const body = renderTariffsText(template, head, tariffLines);
      const { text, entities } = titleWithOptionalEmoji(tariffsEmojiKey, body, config?.botEmojis);
      // тогглы скрытия кнопок «➕ Докупить устройство» / «💼 Мой баланс» (Настройки → Бот).
      await editMessageContent(ctx, text, tariffPayButtons(markHasOptions(items), config?.botBackLabel ?? null, innerStyles, tariffsEmojiIds, tariffsEmojiUnicode, {
        showExtraDevices: config?.botTariffsShowExtraDevicesButton !== false,
        showBalance: config?.botTariffsShowBalanceButton !== false,
      }), entities);
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
      // тогглы скрытия кнопок «➕ Докупить устройство» / «💼 Мой баланс» (Настройки → Бот).
      await editMessageContent(ctx, text, tariffsOfCategoryButtons(markHasOptions([category])[0]!, config?.botBackLabel ?? null, innerStyles, "menu:tariffs", tariffsEmojiIds, tariffsEmojiUnicode, {
        showExtraDevices: config?.botTariffsShowExtraDevicesButton !== false,
        showBalance: config?.botTariffsShowBalanceButton !== false,
      }), entities);
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
        const lines = cats[0]!.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${currencySymbol(t.currency)}`).join("\n");
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
      const lines = category.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${currencySymbol(t.currency)}`).join("\n");
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
        const lines = cats[0]!.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${currencySymbol(t.currency)}`).join("\n");
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
      const lines = category.tariffs.map((t: { name: string; price: number; currency: string }) => `• ${t.name} — ${t.price} ${currencySymbol(t.currency)}`).join("\n");
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
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
          action: "Нажмите для оплаты:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        // 54-ФЗ-чек prompt перед созданием платежа.
        const mePx = await api.getMe(token);
        const savedEmailPx = mePx?.email ?? null;
        const tokRcptP = storePendingReceipt({
          userId,
          savedEmail: savedEmailPx,
          builder: (receiptEmail) => api.createYookassaPayment(token, { amount: tariff.price, currency: "RUB", proxyTariffId, receiptEmail }),
          finalize: async (payment, { receiptSentTo }) => {
            const msg = buildPaymentMessage(config, {
              name: tariff.name,
              price: formatMoney(tariff.price, tariff.currency),
              amount: String(tariff.price),
              currency: tariff.currency,
              action: "Нажмите для оплаты:",
            });
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${msg.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(msg.text, { entities: msg.entities, reply_markup: markup });
            }
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailPx), receiptPromptKeyboard(tokRcptP, savedEmailPx));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        const msg = buildPaymentMessage(config, { name: tariff.name, price: formatMoney(tariff.price, tariff.currency), amount: String(tariff.price), currency: tariff.currency, action: "Нажмите для оплаты:" });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
          action: "Нажмите для оплаты:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        // 54-ФЗ-чек prompt.
        const meSb = await api.getMe(token);
        const savedEmailSb = meSb?.email ?? null;
        const tokRcptSb = storePendingReceipt({
          userId,
          savedEmail: savedEmailSb,
          builder: (receiptEmail) => api.createYookassaPayment(token, { amount: tariff.price, currency: "RUB", singboxTariffId, receiptEmail }),
          finalize: async (payment, { receiptSentTo }) => {
            const msg = buildPaymentMessage(config, {
              name: tariff.name,
              price: formatMoney(tariff.price, tariff.currency),
              amount: String(tariff.price),
              currency: tariff.currency,
              action: "Нажмите для оплаты:",
            });
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${msg.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(msg.text, { entities: msg.entities, reply_markup: markup });
            }
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailSb), receiptPromptKeyboard(tokRcptSb, savedEmailSb));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        const msg = buildPaymentMessage(config, { name: tariff.name, price: formatMoney(tariff.price, tariff.currency), amount: String(tariff.price), currency: tariff.currency, action: "Нажмите для оплаты:" });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
      // если в addsub-режиме — переключаемся на gift/buy (создаёт
      // secondary subscription напрямую с балансом, без webhook'а — отдельный path
      // от обычной activateTariffForClient). Промокод не применяется к доп. подпискам.
      const asAdditional = addsubPending.get(userId) === tariffId;
      const extPairTid = extendingSecondaryPending.get(userId);
      const extendsSecondarySubId = extPairTid && extPairTid.tariffId === tariffId ? extPairTid.secondaryId : undefined;
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
        if (!tariff) {
          await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const tariffPriceOptionId = sel?.tariffId === tariffId ? sel.option.id : undefined;
        const extraDevices = sel?.tariffId === tariffId ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        let resultMessage: string;
        // T7b: продление существующей secondary имеет приоритет над addsub.
        if (extendsSecondarySubId) {
          const discountInfoBal = activeDiscountCode.get(userId);
          const promoCode = discountInfoBal?.code;
          const result = await api.payByBalance(token, { tariffId, tariffPriceOptionId, deviceCount: extraDevices, promoCode, extendsSecondarySubId, removeExtrasOnActivate });
          if (promoCode) activeDiscountCode.delete(userId);
          extendingSecondaryPending.delete(userId);
          if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
          resultMessage = result.message;
        } else if (asAdditional) {
          // покупка доп. подписки балансом теперь идёт через
          // /payments/balance с asAdditional=true (НЕ через gift/buy — иначе подписки
          // ошибочно попадали в «🎁 Мои подарки» вместо «📋 Мои подписки»).
          const discountInfoBal = activeDiscountCode.get(userId);
          const promoCode = discountInfoBal?.code;
          const result = await api.payByBalance(token, { tariffId, tariffPriceOptionId, deviceCount: extraDevices, promoCode, asAdditional: true, removeExtrasOnActivate, replaceTrialSubId });
          if (promoCode) activeDiscountCode.delete(userId);
          addsubPending.delete(userId);
          resultMessage = result.message;
        } else {
          const discountInfoBal = activeDiscountCode.get(userId);
          const promoCode = discountInfoBal?.code;
          const result = await api.payByBalance(token, { tariffId, tariffPriceOptionId, deviceCount: extraDevices, promoCode, removeExtrasOnActivate, replaceTrialSubId });
          if (promoCode) activeDiscountCode.delete(userId);
          resultMessage = result.message;
        }
        selectedTariffOption.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        await editMessageContent(ctx, `✅ ${resultMessage}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // addsub mode → backend mark metadata.isAdditionalSubscription
        // → activateTariffByPaymentId создаст secondary вместо основной подписки.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // унифицированный расчёт personal+promo,
        // отображаем зачёркнутую базовую цену и финальную с %.
        const me = await api.getMe(token);
        const pd = me?.personalDiscountPercent ?? 0;
        const { discountArg: discountArgYm, finalPrice: priceWithDiscount } = buildTariffDiscountArg(totalPrice, pd, discountInfoYm, tariff.currency);
        const payment = await api.createYoomoneyPayment(token, {
          amount: totalPrice,
          paymentType: "AC",
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, {
          name: nameWithDays,
          price: formatMoney(priceWithDiscount, tariff.currency),
          amount: String(priceWithDiscount),
          currency: tariff.currency,
          action: "Нажмите кнопку ниже для оплаты:",
        }, discountArgYm);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler выше.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meYk = await api.getMe(token);
        const pdYk = meYk?.personalDiscountPercent ?? 0;
        const { discountArg: discountArgYk, finalPrice: priceWithDiscountYk } = buildTariffDiscountArg(totalPrice, pdYk, discountInfoYk, tariff.currency);
        // 54-ФЗ: перед созданием платежа спрашиваем, нужен ли чек.
        const savedEmailYk = (meYk?.email ?? null);
        const tokRcptT = storePendingReceipt({
          userId,
          savedEmail: savedEmailYk,
          builder: (receiptEmail) => api.createYookassaPayment(token, {
            amount: totalPrice,
            currency: "RUB",
            tariffId: tariff.id,
            tariffPriceOptionId: eff?.id,
            deviceCount: extraDevices,
            promoCode,
            asAdditional: asAdditional || undefined,
            extendsSecondarySubId,
            removeExtrasOnActivate,
            replaceTrialSubId,
            receiptEmail,
          }),
          finalize: async (payment, { receiptSentTo }) => {
            if (promoCode) activeDiscountCode.delete(userId);
            selectedTariffOption.delete(userId);
            if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
            if (asAdditional) addsubPending.delete(userId);
            if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
            convDropExtras.delete(userId);
            trialReplaceChoice.delete(userId);
            const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
              ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
              : tariff.name;
            const msg = buildPaymentMessage(config, {
              name: nameWithDays,
              price: formatMoney(priceWithDiscountYk, tariff.currency),
              amount: String(priceWithDiscountYk),
              currency: tariff.currency,
              action: "Нажмите кнопку ниже для оплаты:",
            }, discountArgYk);
            const baseText = msg.text;
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${baseText}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(baseText, { entities: msg.entities, reply_markup: markup });
            }
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailYk), receiptPromptKeyboard(tokRcptT, savedEmailYk));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meCp = await api.getMe(token);
        const pdCp = meCp?.personalDiscountPercent ?? 0;
        const { discountArg: discountArgCp, finalPrice: priceWithDiscountCp } = buildTariffDiscountArg(totalPrice, pdCp, discountInfoCp, tariff.currency);
        const payment = await api.createCryptopayPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountCp, tariff.currency), amount: String(priceWithDiscountCp), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArgCp);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // Lava: оплата тарифа (RUB only, СБП/Карта/СберPay)
    if (data.startsWith("pay_tariff_lava:")) {
      const tariffId = data.slice("pay_tariff_lava:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfo = activeDiscountCode.get(userId);
        const promoCode = discountInfo?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meLava = await api.getMe(token);
        const pdLava = meLava?.personalDiscountPercent ?? 0;
        const { discountArg, finalPrice: priceWithDiscountLava } = buildTariffDiscountArg(totalPrice, pdLava, discountInfo, tariff.currency);
        const payment = await api.createLavaPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountLava, tariff.currency), amount: String(priceWithDiscountLava), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArg);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Ошибка создания платежа Lava";
        await editMessageContent(ctx, `❌ ${m}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_tariff_lavatop:")) {
      const tariffId = data.slice("pay_tariff_lavatop:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfo = activeDiscountCode.get(userId);
        const promoCode = discountInfo?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meLavatop = await api.getMe(token);
        const pdLavatop = meLavatop?.personalDiscountPercent ?? 0;
        const { discountArg, finalPrice: priceWithDiscountLavatop } = buildTariffDiscountArg(totalPrice, pdLavatop, discountInfo, tariff.currency);
        const payment = await api.createLavatopPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountLavatop, tariff.currency), amount: String(priceWithDiscountLavatop), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArg);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Ошибка создания платежа Lava.top";
        await editMessageContent(ctx, `❌ ${m}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // Heleket: оплата тарифа (крипто)
    if (data.startsWith("pay_tariff_heleket:")) {
      const tariffId = data.slice("pay_tariff_heleket:".length);
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const discountInfo = activeDiscountCode.get(userId);
        const promoCode = discountInfo?.code;
        const sel = selectedTariffOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;
        // см. yoomoney handler.
        const asAdditional = addsubPending.get(userId) === tariff.id;
        const extPairT = extendingSecondaryPending.get(userId);
        const extendsSecondarySubId = extPairT && extPairT.tariffId === tariff.id ? extPairT.secondaryId : undefined;
        // юзер выбрал «продлить без устройств».
        // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
        // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
        const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
        const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;
        let subExtrasForPeriod = 0;
        if (extendsSecondarySubId && !removeExtrasOnActivate) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const target = allSubs.items?.find((it) => it.id === extendsSecondarySubId);
            const monthly = target?.extraDevicesMonthlyPrice ?? 0;
            if (monthly > 0 && effectiveDays > 0) {
              subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        const totalPrice = effectivePrice + subExtrasForPeriod;
        // см. yoomoney handler.
        const meHeleket = await api.getMe(token);
        const pdHeleket = meHeleket?.personalDiscountPercent ?? 0;
        const { discountArg, finalPrice: priceWithDiscountHeleket } = buildTariffDiscountArg(totalPrice, pdHeleket, discountInfo, tariff.currency);
        const payment = await api.createHeleketPayment(token, {
          amount: totalPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          tariffPriceOptionId: eff?.id,
          deviceCount: extraDevices,
          promoCode,
          asAdditional: asAdditional || undefined,
          extendsSecondarySubId,
          removeExtrasOnActivate,
          replaceTrialSubId,
        });
        if (promoCode) activeDiscountCode.delete(userId);
        selectedTariffOption.delete(userId);
        if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
        if (asAdditional) addsubPending.delete(userId);
        if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
        convDropExtras.delete(userId);
        trialReplaceChoice.delete(userId);
        const nameWithDays = (opts.length > 1 || (sel?.tariffId === tariff.id))
          ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
          : tariff.name;
        const msg = buildPaymentMessage(config, { name: nameWithDays, price: formatMoney(priceWithDiscountHeleket, tariff.currency), amount: String(priceWithDiscountHeleket), currency: tariff.currency, action: "Нажмите кнопку ниже для оплаты:" }, discountArg);
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Ошибка создания платежа Heleket";
        await editMessageContent(ctx, `❌ ${m}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "menu:extra_options") {
      const options = config?.sellOptions ?? [];
      if (!options.length) {
        await editMessageContent(ctx, "Доп. опции пока не доступны. Оформите подписку в разделе «Тарифы».", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      // новый текст по эталону клиента.
      // Заголовок «📦 Дополнительные опции» рисует titleWithEmoji — НЕ дублируем эмодзи в тексте.
      // текст редактируется в админке («Тексты бота» →
      // bot_extra_options_text); раньше был захардкожен здесь.
      const optsText = (config?.botExtraOptionsText ?? "").trim() || [
        "Дополнительные опции",
        "",
        "Каждая подписка поддерживает до 4 устройств одновременно.",
        "",
        "✨ Если вы хотите подключить больше устройств, купите ещё одну подписку, либо:",
        "➕ Вы можете докупить устройство для любой из имеющихся подписок.",
        "",
        "🗓️ Цена указана за 30 календарных дней",
        "",
        "Чтобы докупить устройство, нажмите кнопку:",
      ].join("\n");
      const { text, entities } = titleWithEmoji("PACKAGE", optsText, config?.botEmojis);
      await editMessageContent(ctx, text, extraOptionsButtons(options, config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null), entities);
      return;
    }

    // «📦 Выбор подписки для опции» — промежуточный шаг
    // перед стандартным экраном выбора метода оплаты `pay_option:`.
    // Если 1 подписка — Map ставится автоматом, редирект на pay_option:.
    // Если 2+ — выбор кнопками → ставит Map → редирект на pay_option:.
    // Callback: extra_opt_pick:<kind>:<productId>
    if (data.startsWith("extra_opt_pick:")) {
      const parts = data.split(":");
      const kind = (parts[1] ?? "") as "traffic" | "devices" | "servers";
      const productId = parts.length > 2 ? parts.slice(2).join(":") : "";
      try {
        const subs = await api.getAllSubscriptions(token);
        const subItems = subs.items ?? [];
        if (subItems.length === 0) {
          await editMessageContent(ctx, "❌ Сначала оформите подписку — потом сможете покупать опции.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        extraOptionPending.set(userId, { kind, productId });

        // рассчитываем актуальную цену
        // для каждой подписки с объяснением (коэф по остатку дней + личная скидка).
        const product = (config?.sellOptions ?? []).find((o) => o.kind === kind && o.id === productId);
        const basePrice = product?.price ?? 0;
        const me = await api.getMe(token).catch(() => null);
        const personalDiscount = me?.personalDiscountPercent ?? 0;
        const computeForSub = (s: { subscription?: unknown }) => {
          const inner = s.subscription as Record<string, unknown> | null;
          const innerData = inner
            ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>)
            : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) {
              daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
            }
          }
          const coef = Math.max(1, daysLeft / 30);
          // округление ВНИЗ до целых рублей — 230.87 → 230.
          // Эта же цена идёт в бэк (Math.floor там же) — юзер платит ровно сколько видит.
          const rawPrice = Math.floor(basePrice * coef);
          const finalPrice = personalDiscount > 0
            ? Math.max(0, Math.floor(rawPrice * (1 - personalDiscount / 100)))
            : rawPrice;
          return { daysLeft: Math.round(daysLeft), coef: Math.round(coef * 10) / 10, rawPrice, finalPrice };
        };

        const productName = product?.name ?? (kind === "devices" ? "Доп. устройство" : kind === "traffic" ? "Доп. трафик" : "Сервер");

        if (subItems.length === 1) {
          const only = subItems[0]!;
          extraOptionTargetSub.set(userId, only.id);
          const calc = computeForSub(only);
          const lines = [
            `📦 Опция: ${productName}`,
            "",
            `📲 Подписка: #${only.subscriptionIndex ?? 0}${only.tariffDisplayName ? ` (${only.tariffDisplayName})` : ""}`,
            "",
            `🗓️ Базовая цена: ${basePrice} ₽ за 30 дней`,
            `⏰ Осталось дней: ${calc.daysLeft}`,
            `📐 Коэффициент: ×${calc.coef} (дней / 30)`,
            `💰 Цена за период: ${calc.rawPrice} ₽`,
          ];
          if (personalDiscount > 0) {
            const discountAmount = Math.round((calc.rawPrice - calc.finalPrice) * 100) / 100;
            lines.push(`💎 Ваша персональная скидка: −${personalDiscount}% (−${discountAmount} ₽)`);
          }
          lines.push("", `━━━━━━━━━━━━━━`, `💵 Итого к оплате: ${calc.finalPrice} ₽`);
          await editMessageContent(ctx, lines.join("\n"), {
            inline_keyboard: [
              [{ text: `▶ Продолжить к оплате (${calc.finalPrice} ₽)`, callback_data: `pay_option:${kind}:${productId}` }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          });
          return;
        }

        // 2+ подписок → выбор с актуальной ценой для каждой.
        const titleLines = [
          `📦 К какой подписке применить опцию: ${productName}?`,
          "",
          `🗓️ Базовая цена: ${basePrice} ₽ за 30 дней.`,
          `📐 Стоимость зависит от оставшегося количества дней подписки.`,
          `Цена увеличивается пропорционально оставшимся дням подписки (×N от 30 дн).`,
          `💡 Опция «${productName}» действует до окончания выбранной подписки.`,
        ];
        if (personalDiscount > 0) {
          titleLines.push(`💎 К итогу применится ваша персональная скидка −${personalDiscount}%.`);
        }
        const rows: { text: string; callback_data: string }[][] = subItems.map((s) => {
          const calc = computeForSub(s);
          const tariffLabel = s.tariffDisplayName ? ` ${s.tariffDisplayName}` : "";
          // убрали слово «Подписка» с кнопок — оставили #N.
          const label = `#${s.subscriptionIndex ?? 0}${tariffLabel} — ${calc.finalPrice} ₽`;
          return [{ text: label.slice(0, 60), callback_data: `extra_opt_setsub:${s.id}`.slice(0, 64) }];
        });
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        await editMessageContent(ctx, titleLines.join("\n"), { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // T7c: после выбора подписки → ставим Map и форвардим на стандартный `pay_option:`.
    // Берём kind+productId из extraOptionPending (поставлено в extra_opt_pick:).
    if (data.startsWith("extra_opt_setsub:")) {
      // subMarker = subscription.id для всех подписок.
      const subMarker = data.slice("extra_opt_setsub:".length);
      const pending = extraOptionPending.get(userId);
      if (!pending) {
        await editMessageContent(ctx, "⏳ Сессия выбора опции истекла. Откройте меню опций заново.", {
          inline_keyboard: [[{ text: "📦 К опциям", callback_data: "menu:extra_options" }]],
        });
        return;
      }
      const { kind, productId } = pending;
      if (subMarker) extraOptionTargetSub.set(userId, subMarker);

      // подтверждение выбора с детальным
      // расчётом цены (коэф по остатку дней + личная скидка).
      try {
        const subs = await api.getAllSubscriptions(token);
        const target = subs.items?.find((it) => it.id === subMarker);
        const product = (config?.sellOptions ?? []).find((o) => o.kind === kind && o.id === productId);
        const basePrice = product?.price ?? 0;
        const me = await api.getMe(token).catch(() => null);
        const pd = me?.personalDiscountPercent ?? 0;
        const inner = target?.subscription as Record<string, unknown> | null;
        const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
        const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
        let daysLeft = 30;
        if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
          const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
          if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
        }
        const coef = Math.max(1, daysLeft / 30);
        // округление вниз до целых рублей.
        const rawPrice = Math.floor(basePrice * coef);
        const finalPrice = pd > 0 ? Math.max(0, Math.floor(rawPrice * (1 - pd / 100))) : rawPrice;
        const productName = product?.name ?? (kind === "devices" ? "Доп. устройство" : kind === "traffic" ? "Доп. трафик" : "Сервер");
        const lines = [
          `📦 Опция: ${productName}`,
          "",
          `📲 Подписка: #${target?.subscriptionIndex ?? 0}${target?.tariffDisplayName ? ` (${target.tariffDisplayName})` : ""}`,
          "",
          `🗓️ Базовая цена: ${basePrice} ₽ за 30 дней`,
          `⏰ Осталось дней: ${Math.round(daysLeft)}`,
          `📐 Коэффициент: ×${Math.round(coef * 10) / 10}`,
          `💰 Цена за период: ${rawPrice} ₽`,
        ];
        if (pd > 0) {
          const discountAmount = Math.round((rawPrice - finalPrice) * 100) / 100;
          lines.push(`💎 Персональная скидка: −${pd}% (−${discountAmount} ₽)`);
        }
        lines.push("", `━━━━━━━━━━━━━━`, `💵 Итого к оплате: ${finalPrice} ₽`);
        await editMessageContent(ctx, lines.join("\n"), {
          inline_keyboard: [
            [{ text: `▶ Продолжить к оплате (${finalPrice} ₽)`, callback_data: `pay_option:${kind}:${productId}` }],
            [{ text: "← Назад", callback_data: `extra_opt_pick:${kind}:${productId}` }],
            [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
          ],
        });
      } catch {
        // Fallback на простое подтверждение если расчёт не удался.
        await editMessageContent(ctx, `📦 Подписка выбрана.`, {
          inline_keyboard: [
            [{ text: "▶ Продолжить к оплате", callback_data: `pay_option:${kind}:${productId}` }],
            [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
          ],
        });
      }
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
      // T7c: consume target подписки (если был выбран). primary = передаём undefined backend'у.
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        const result = await api.payOptionByBalance(token, { kind: option.kind, productId: option.id, targetSubscriptionId });
        extraOptionTargetSub.delete(userId);
        extraOptionPending.delete(userId);
        await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        // 54-ФЗ-чек prompt.
        const savedEmailOp = me?.email ?? null;
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const tokRcptOp = storePendingReceipt({
          userId,
          savedEmail: savedEmailOp,
          builder: (receiptEmail) => api.createYookassaPayment(token, {
            extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId },
            receiptEmail,
          }),
          finalize: async (payment, { receiptSentTo }) => {
            const msg = buildPaymentMessage(config, {
              name: optName,
              price: formatMoney(displayPrice, option.currency),
              amount: String(displayPrice),
              currency: option.currency,
              action: "Нажмите кнопку ниже для оплаты:",
            });
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${msg.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(msg.text, { entities: msg.entities, reply_markup: markup });
            }
            extraOptionTargetSub.delete(userId);
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailOp), receiptPromptKeyboard(tokRcptOp, savedEmailOp));
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
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        const payment = await api.createCryptopayPayment(token, { extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId } });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, { name: optName, price: formatMoney(displayPrice, option.currency), amount: String(displayPrice), currency: option.currency, action: "Нажмите кнопку ниже для оплаты:" });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        extraOptionTargetSub.delete(userId);
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
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        const payment = await api.createYoomoneyPayment(token, {
          amount: displayPrice,
          paymentType: "AC",
          extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId },
        });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, {
          name: optName,
          price: formatMoney(displayPrice, option.currency),
          amount: String(displayPrice),
          currency: option.currency,
          action: "Нажмите кнопку ниже для оплаты:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        extraOptionTargetSub.delete(userId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
      const target = extraOptionTargetSub.get(userId);
      const targetSubscriptionId = target && target !== "primary" ? target : undefined;

      // рассчитываем pro-rata цену для display.
      let displayPrice = option.price;
      if (option.kind === "devices" && targetSubscriptionId) {
        try {
          const subs = await api.getAllSubscriptions(token);
          const target_sub = subs.items?.find((it) => it.id === targetSubscriptionId);
          const inner = target_sub?.subscription as Record<string, unknown> | null;
          const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
          const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
          let daysLeft = 30;
          if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
            const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
            if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
          }
          const coef = Math.max(1, daysLeft / 30);
          displayPrice = Math.floor(option.price * coef);
        } catch { /* ignore */ }
      }
      const me = await api.getMe(token).catch(() => null);
      const pd = me?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      try {
        const payment = await api.createPlategaPayment(token, {
          amount: displayPrice,
          currency: option.currency,
          paymentMethod: methodId,
          description: option.name || `${option.kind} ${option.id}`,
          extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId },
        });
        const optName = option.name || (option.kind === "traffic" ? `+${option.trafficGb} ГБ` : option.kind === "devices" ? `+${option.deviceCount} устр.` : "Сервер");
        const msg = buildPaymentMessage(config, {
          name: optName,
          price: formatMoney(displayPrice, option.currency),
          amount: String(displayPrice),
          currency: option.currency,
          action: "Нажмите кнопку ниже для оплаты:",
        });
        await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
        extraOptionTargetSub.delete(userId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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

      // на экране выбора способа оплаты
      // показываем РЕАЛЬНУЮ цену (с pro-rata + personal discount), а не базовую option.price.
      let displayPrice = option.price;
      if (option.kind === "devices") {
        const target = extraOptionTargetSub.get(userId);
        if (target && target !== "primary") {
          try {
            const subs = await api.getAllSubscriptions(token);
            const targetSub = subs.items?.find((it) => it.id === target);
            const inner = targetSub?.subscription as Record<string, unknown> | null;
            const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
            const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
            let daysLeft = 30;
            if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
              const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
              if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
            }
            const coef = Math.max(1, daysLeft / 30);
            displayPrice = Math.floor(option.price * coef);
          } catch { /* ignore */ }
        }
      }
      const pd = client?.personalDiscountPercent ?? 0;
      if (pd > 0) {
        displayPrice = Math.max(0, Math.floor(displayPrice * (1 - pd / 100)));
      }

      const choiceText = buildPaymentMessage(config, {
        name: optName,
        price: formatMoney(displayPrice, option.currency),
        amount: String(displayPrice),
        currency: option.currency,
        action: "Выберите способ оплаты:",
      });
      const markup = optionPaymentMethodButtons(
        { ...option, price: displayPrice },
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

    if (data.startsWith("topt:")) {
      // Шаг 1: выбрана опция длительности. Дальше — picker доп. устройств (если включены).
      const idxStr = data.slice("topt:".length);
      const idx = parseInt(idxStr, 10);
      const cache = tariffOptionsCache.get(userId);
      if (!cache || !Number.isFinite(idx) || idx < 0 || idx >= cache.options.length) {
        await editMessageContent(ctx, "Сессия выбора опции истекла. Откройте тарифы заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const option = cache.options[idx]!;
      selectedTariffOption.set(userId, { tariffId: cache.tariffId, option, extraDevices: 0 });
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === cache.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }

      // если идёт ПРОДЛЕНИЕ подписки с
      // докупленными устройствами — показываем промежуточный экран с детализацией цены
      // и выбором: продлить со всеми устройствами / убрать устройства и продлить только тариф.
      const extPair = extendingSecondaryPending.get(userId);
      if (extPair && extPair.tariffId === tariff.id) {
        try {
          const allSubs = await api.getAllSubscriptions(token);
          const targetSub = allSubs.items?.find((it) => it.id === extPair.secondaryId);
          const extraDevices = targetSub?.extraDevices ?? 0;
          const monthlyPrice = targetSub?.extraDevicesMonthlyPrice ?? 0;
          if (extraDevices > 0 && monthlyPrice > 0) {
            const extrasForPeriod = Math.round(monthlyPrice * (option.durationDays / 30) * 100) / 100;
            const totalWith = option.price + extrasForPeriod;
            // применяем личную скидку для отображения
            const meExt = await api.getMe(token);
            const pdExt = meExt?.personalDiscountPercent ?? 0;
            const displayTotalWith = pdExt > 0 ? Math.max(0, Math.round(totalWith * (1 - pdExt / 100) * 100) / 100) : totalWith;
            const displayPrice = pdExt > 0 ? Math.max(0, Math.round(option.price * (1 - pdExt / 100) * 100) / 100) : option.price;
            const coef = option.durationDays / 30;
            const coefStr = option.durationDays % 30 === 0 ? `${coef}` : coef.toFixed(1);
            const lines = [
              "🔄 Продление подписки",
              "",
              `📦 Тариф: ${tariff.name}`,
              `⏰ Длительность: ${formatRuDays(option.durationDays)}`,
              `💰 Базовая цена тарифа: ${displayPrice} ₽`,
              "",
              `📱 На этой подписке у вас докуплено: ${extraDevices} ${(() => { const n = extraDevices % 100; const n1 = n % 10; if (n > 10 && n < 20) return "доп. устройств"; if (n1 > 1 && n1 < 5) return "доп. устройства"; if (n1 === 1) return "доп. устройство"; return "доп. устройств"; })()}`,
              `💵 Цена устройств: ${monthlyPrice} ₽ за 30 дней × ${coefStr} = ${extrasForPeriod} ₽`,
              "",
              `━━━━━━━━━━━━━━`,
              `💵 Итого со всеми устройствами: ${displayTotalWith} ₽`,
              `💵 Без доп. устройств: ${displayPrice} ₽`,
              "",
              `💡 По умолчанию в подписку входит ${tariff.includedDevices ?? 4} устройства, но у вас куплены дополнительные устройства.`,
              "⚠️ Если продлить подписку без доп. устройств и при этом продолжить использовать прежнее количество устройств, сервис может перестать работать на некоторых из них.",
            ];
            await editMessageContent(ctx, lines.join("\n"), {
              inline_keyboard: [
                [{ text: `✅ Со всеми устройствами (${displayTotalWith} ₽)`, callback_data: `pay_ext_keep:${idx}` }],
                [{ text: `🗑 Убрать устройства, продлить за ${displayPrice} ₽`, callback_data: `pay_ext_drop:${idx}` }],
                [{ text: "← Назад", callback_data: `sub:detail:${targetSub?.type ?? "secondary"}:${extPair.secondaryId}` }],
              ],
            });
            return;
          }
        } catch (e) {
          console.warn("[bot] topt extras intermediate screen failed:", e);
          // упало — продолжаем обычным flow без промежуточного экрана
        }
      }

      // Если в тарифе ВКЛЮЧЕНЫ доп. устройства — показываем picker.
      if (hasExtraDevices(tariff)) {
        const tiers = tariff.deviceDiscountTiers;
        const pricePerExtra = tariff.pricePerExtraDevice ?? 0;
        const maxExtras = tariff.maxExtraDevices ?? 0;
        const includedDevices = tariff.includedDevices ?? 1;
        // Плитка «+0» = базовая цена тарифа, дальше +1, +2, ... до maxExtras.
        const tiles = Array.from({ length: maxExtras + 1 }, (_, i) => {
          const extras = i;
          const { extrasTotal, pct } = applyExtraDevicesPriceBot(pricePerExtra, extras, tiers, option.durationDays);
          return { extras, total: option.price + extrasTotal, pct };
        });
        const bestExtra = tiles.slice(1).reduce((best, cur) => {
          const perDev = cur.total / (includedDevices + cur.extras);
          if (best == null || perDev < best.perDev) return { extras: cur.extras, perDev };
          return best;
        }, null as { extras: number; perDev: number } | null);
        const tilesWithBest = tiles.map((t) => ({
          extras: t.extras,
          included: includedDevices,
          total: t.total,
          pct: t.pct,
          isBest: bestExtra?.extras === t.extras && t.extras > 0 && t.pct === 0,
        }));
        const text = `${tariff.name} · ${formatRuDays(option.durationDays)}\n\n📱 В тариф включено: ${includedDevices} устр.\nДобавьте дополнительные:`;
        await editMessageContent(ctx, text, tariffDevicePickerButtons(tilesWithBest, tariff.currency, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
        return;
      }
      // Доп. устройств нет — сразу способы оплаты с extras=0.
      await showPaymentMethodsForTariff(ctx, userId, tariff, option, 0, config, innerStyles, innerEmojiIds, token);
      return;
    }

    // продление с устройствами / без.
    // pay_ext_keep:<idx> — оставить устройства, продолжить flow.
    // pay_ext_drop:<idx> — сначала убрать устройства (extraDevices=0), потом продолжить.
    if (data.startsWith("pay_ext_keep:") || data.startsWith("pay_ext_drop:")) {
      const isKeep = data.startsWith("pay_ext_keep:");
      const idxStr = data.slice(isKeep ? "pay_ext_keep:".length : "pay_ext_drop:".length);
      const idx = parseInt(idxStr, 10);
      const cache = tariffOptionsCache.get(userId);
      const extPair = extendingSecondaryPending.get(userId);
      if (!cache || !extPair || !Number.isFinite(idx) || idx < 0 || idx >= cache.options.length) {
        await editMessageContent(ctx, "Сессия истекла. Откройте подписку заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const option = cache.options[idx]!;
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === cache.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      let subExtrasMonthlyPrice = 0;
      try {
        const allSubs = await api.getAllSubscriptions(token);
        const target = allSubs.items?.find((it) => it.id === extPair.secondaryId);
        if (!isKeep) {
          // НЕ удаляем сразу — только запоминаем
          // намерение. Реальный removeExtraDevices вызовется в handler'е способа оплаты
          // (yookassa/balance/etc) ПЕРЕД созданием платежа. Если юзер передумает и
          // вернётся назад — устройства останутся при нём.
          pendingDropExtras.set(userId, extPair.secondaryId);
          subExtrasMonthlyPrice = 0; // на экране оплаты показываем цену БЕЗ устройств
        } else {
          // KEEP: на всякий случай сбрасываем pending drop (если юзер передумал убирать).
          pendingDropExtras.delete(userId);
          subExtrasMonthlyPrice = target?.extraDevicesMonthlyPrice ?? 0;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ Не удалось получить данные подписки: ${msg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      selectedTariffOption.set(userId, { tariffId: tariff.id, option, extraDevices: 0 });
      await showPaymentMethodsForTariff(ctx, userId, tariff, option, 0, config, innerStyles, innerEmojiIds, token, subExtrasMonthlyPrice);
      return;
    }

    if (data.startsWith("tdev:")) {
      // Шаг 2: выбрано количество ДОП. устройств (extras). Применяем скидку и показываем способы оплаты.
      const nStr = data.slice("tdev:".length);
      const extraDevices = parseInt(nStr, 10);
      const sel = selectedTariffOption.get(userId);
      if (!sel || !Number.isFinite(extraDevices) || extraDevices < 0) {
        await editMessageContent(ctx, "Сессия выбора устройств истекла. Откройте тарифы заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sel.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const cappedExtras = Math.min(Math.max(0, extraDevices), tariff.maxExtraDevices ?? 0);
      selectedTariffOption.set(userId, { ...sel, extraDevices: cappedExtras });
      await showPaymentMethodsForTariff(ctx, userId, tariff, sel.option, cappedExtras, config, innerStyles, innerEmojiIds, token);
      return;
    }

    // выбор тарифа для конвертации триала (см. trialConvertPickCache).
    // Юзер выбрал, на какой тариф переходить — открываем стандартный флоу продления
    // с выбранным тарифом (backend заменит сквады/трафик: trial → convertMode).
    // циклический выбор «какой триал заменить» на экране способов оплаты тарифа.
    // Переключает trialReplaceChoice на следующий триал клиента и перерисовывает экран.
    if (data === "trialrepl:next") {
      const sel = selectedTariffOption.get(userId);
      if (!sel) {
        await editMessageContent(ctx, "Выбор устарел — откройте оплату заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const subsAll = await api.getAllSubscriptions(token);
        const trials = (subsAll.items ?? []).filter((s) => s.trialId);
        if (trials.length === 0) {
          await editMessageContent(ctx, "Выбор устарел — откройте оплату заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        const currentId = trialReplaceChoice.get(userId);
        const curIdxRaw = currentId ? trials.findIndex((s) => s.id === currentId) : 0;
        const curIdx = curIdxRaw >= 0 ? curIdxRaw : 0;
        const next = trials[(curIdx + 1) % trials.length]!;
        trialReplaceChoice.set(userId, next.id);
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sel.tariffId);
        if (!tariff) {
          await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        await showPaymentMethodsForTariff(ctx, userId, tariff, sel.option, sel.extraDevices, config, innerStyles, innerEmojiIds, token);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // toggle «сохранить/убрать доп. устройства» при конвертации/same-tariff-продлении.
    // Переключает convDropExtras и перерисовывает экран способов оплаты.
    if (data === "convx:toggle") {
      const sel = selectedTariffOption.get(userId);
      if (!sel) {
        await editMessageContent(ctx, "Выбор устарел — откройте оплату заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (convDropExtras.has(userId)) convDropExtras.delete(userId);
      else convDropExtras.add(userId);
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sel.tariffId);
        if (!tariff) {
          await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        await showPaymentMethodsForTariff(ctx, userId, tariff, sel.option, sel.extraDevices, config, innerStyles, innerEmojiIds, token);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_ext_pickt:")) {
      const idx = Number(data.slice("pay_ext_pickt:".length));
      const cached = trialConvertPickCache.get(userId);
      const choice = cached && Number.isInteger(idx) ? cached.options[idx] : undefined;
      if (!cached || !choice) {
        await editMessageContent(ctx, "Выбор устарел — откройте продление заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === choice.id);
        if (!tariff) {
          await editMessageContent(ctx, "❌ Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        extendingSecondaryPending.set(userId, { tariffId: tariff.id, secondaryId: cached.sid });
        addsubPending.delete(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        if (opts.length > 1) {
          tariffOptionsCache.set(userId, { tariffId: tariff.id, options: opts });
          const bestId = bestPricePerDayOptionId(opts);
          await editMessageContent(ctx, `🔄 Переход на «${tariff.name}»\n\nВыберите длительность:`, tariffOptionPickerButtons(opts, tariff.currency, bestId, null, innerStyles, innerEmojiIds, null, config?.botEmojis ?? null));
          return;
        }
        const onlyOpt = opts[0] ?? null;
        if (onlyOpt) selectedTariffOption.set(userId, { tariffId: tariff.id, option: onlyOpt, extraDevices: 0 });
        await showPaymentMethodsForTariff(ctx, userId, tariff, onlyOpt, 0, config, innerStyles, innerEmojiIds, token);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // «💰 Продлить» для ЛЮБОЙ подписки (primary или доп.).
    // Короткий callback (только subscriptionId) — пара tariffId+subId не влезает в 64-байтовый
    // Telegram callback_data. Резолвим tariffId из подписки на стороне бота.
    // Backend: metadata.extendsSecondarySubId → extendSecondarySubscription (работает для любой Subscription).
    if (data.startsWith("pay_tariff_ext:")) {
      const sid = data.slice("pay_tariff_ext:".length);
      try {
        const subs = await api.getAllSubscriptions(token);
        // Раньше: фильтр type === "secondary". Теперь — любая подписка с этим id (root тоже).
        const sec = subs.items?.find((it) => it.id === sid);
        if (!sec || !sec.tariffId) {
          await editMessageContent(ctx, "❌ Подписка или тариф не найдены.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        // pre-check кулдауна ДО показа экрана выбора провайдера.
        // Если подписка в кулдауне — сразу выводим сообщение и кнопку «Назад».
        try {
          const cd = await api.checkSubscriptionCooldown(token, sid);
          if (cd.blocked) {
            // сообщение уже содержит свой эмодзи ⏳ — не дублируем 🚫.
            await editMessageContent(ctx, cd.message, {
              inline_keyboard: [
                [{ text: backButton(config?.botEmojis ?? null).text, callback_data: `sub:detail:${sec.type}:${sid}` }],
                [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
              ],
            });
            return;
          }
        } catch { /* ignore — пропустим check если эндпоинт упал */ }

        // конвертация триала: запрещена тогглом → отказ; разрешена
        // в любой тариф (convertAllTariffs) или в список convertTariffIds — даём
        // выбрать, на какой тариф переходить (дни и остаток трафика сохранятся).
        if (sec.trialId && sec.trialConvertEnabled === false) {
          await editMessageContent(ctx, "Этот пробный период нельзя конвертировать или продлить.", {
            inline_keyboard: [[{ text: "← Назад", callback_data: `sub:detail:${sec.type}:${sid}` }]],
          });
          return;
        }
        const trialConvertIds = (sec.convertTariffIds ?? []).filter((id) => id && id !== sec.tariffId);
        if (sec.trialId && (sec.trialConvertAllTariffs === true || trialConvertIds.length > 0)) {
          const { items: catItems } = await api.getPublicTariffs();
          const allTariffs = catItems?.flatMap((c: TariffCategory) => c.tariffs) ?? [];
          const own = allTariffs.find((t: TariffItem) => t.id === sec.tariffId);
          const targets = sec.trialConvertAllTariffs === true
            ? allTariffs.filter((t: TariffItem) => t.id !== sec.tariffId)
            : trialConvertIds
                .map((id) => allTariffs.find((t: TariffItem) => t.id === id))
                .filter((t): t is TariffItem => Boolean(t));
          if (targets.length > 0) {
            const options = [
              ...(own ? [{ id: own.id, name: own.name }] : []),
              ...targets.map((t) => ({ id: t.id, name: t.name })),
            ];
            trialConvertPickCache.set(userId, { sid, options });
            const rows = options.map((o, i) => ([{
              text: own && i === 0 ? `💎 ${o.name}` : `➡️ ${o.name}`,
              callback_data: `pay_ext_pickt:${i}`,
            }]));
            rows.push([{ text: "← Назад", callback_data: `sub:detail:${sec.type}:${sid}` }]);
            await editMessageContent(
              ctx,
              "🔄 Переход на платный тариф\n\nВыберите тариф — дни и остаток трафика пробного периода сохранятся:",
              { inline_keyboard: rows },
            );
            return;
          }
        }

        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sec.tariffId);
        if (!tariff) {
          await editMessageContent(ctx, "❌ Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        // Помечаем что эта оплата — продление именно этой secondary.
        extendingSecondaryPending.set(userId, { tariffId: tariff.id, secondaryId: sid });
        // Сбрасываем addsub-флаг (если был от прошлой сессии) — это не создание новой.
        addsubPending.delete(userId);

        const opts = sortedPriceOptions(tariff.priceOptions);
        const desc = ((tariff as TariffItem & { description?: string | null }).description ?? "").trim();
        // Если опций > 1 — picker длительности.
        if (opts.length > 1) {
          tariffOptionsCache.set(userId, { tariffId: tariff.id, options: opts });
          const bestId = bestPricePerDayOptionId(opts);
          // T-fix (11.05.2026): не дублируем `${tariff.name}` если desc уже содержит заголовок.
          const text = desc
            ? `🔄 Продление подписки\n\n${desc}\n\nВыберите тариф для продления:`
            : `🔄 Продление подписки\n\n${tariff.name}\n\nВыберите длительность:`;
          await editMessageContent(ctx, text, tariffOptionPickerButtons(opts, tariff.currency, bestId, null, innerStyles, innerEmojiIds, null, config?.botEmojis ?? null));
          return;
        }
        // Одна опция — сразу к оплате (без picker'а доп. устройств для простоты продления).
        const onlyOpt = opts[0] ?? null;
        if (onlyOpt) {
          selectedTariffOption.set(userId, { tariffId: tariff.id, option: onlyOpt, extraDevices: 0 });
        }
        // если у подписки есть extraDevices —
        // показываем промежуточный экран ВСЕГДА (даже когда у тарифа одна опция длительности).
        // Бывшее поведение «сразу к оплате» проглатывало кнопку «Убрать устройства».
        if (onlyOpt) {
          try {
            const allSubs = await api.getAllSubscriptions(token);
            const targetSub = allSubs.items?.find((it) => it.id === sid);
            const extraDevices = targetSub?.extraDevices ?? 0;
            const monthlyPrice = targetSub?.extraDevicesMonthlyPrice ?? 0;
            if (extraDevices > 0 && monthlyPrice > 0) {
              // Копия логики промежуточного экрана из `topt:` handler.
              const extrasForPeriod = Math.floor(monthlyPrice * (onlyOpt.durationDays / 30));
              const totalWith = onlyOpt.price + extrasForPeriod;
              const coef = onlyOpt.durationDays / 30;
              const coefStr = onlyOpt.durationDays % 30 === 0 ? `${coef}` : coef.toFixed(1);
              const lines = [
                "🔄 Продление подписки",
                "",
                `📦 Тариф: ${tariff.name}`,
                `⏰ Длительность: ${formatRuDays(onlyOpt.durationDays)}`,
                `💰 Базовая цена тарифа: ${onlyOpt.price} ₽`,
                "",
                `📱 На этой подписке у вас докуплено: ${extraDevices} ${(() => { const n = extraDevices % 100; const n1 = n % 10; if (n > 10 && n < 20) return "доп. устройств"; if (n1 > 1 && n1 < 5) return "доп. устройства"; if (n1 === 1) return "доп. устройство"; return "доп. устройств"; })()}`,
                `💵 Цена устройств: ${monthlyPrice} ₽ за 30 дней × ${coefStr} = ${extrasForPeriod} ₽`,
                "",
                `━━━━━━━━━━━━━━`,
                `💵 Итого со всеми устройствами: ${totalWith} ₽`,
                `💵 Без доп. устройств: ${onlyOpt.price} ₽`,
                "",
                `💡 По умолчанию в подписку входит ${tariff.includedDevices ?? 4} устройства, но у вас куплены дополнительные устройства.`,
              "⚠️ Если продлить подписку без доп. устройств и при этом продолжить использовать прежнее количество устройств, сервис может перестать работать на некоторых из них.",
              ];
              await editMessageContent(ctx, lines.join("\n"), {
                inline_keyboard: [
                  [{ text: `✅ Со всеми устройствами (${totalWith} ₽)`, callback_data: `pay_ext_keep:0` }],
                  [{ text: `🗑 Убрать устройства, продлить за ${onlyOpt.price} ₽`, callback_data: `pay_ext_drop:0` }],
                  [{ text: "← Назад", callback_data: `sub:detail:${targetSub?.type ?? "secondary"}:${sid}` }],
                ],
              });
              // Кэшируем option для последующих pay_ext_keep/drop:0
              tariffOptionsCache.set(userId, { tariffId: tariff.id, options: [onlyOpt] });
              return;
            }
          } catch (e) {
            console.warn("[pay_tariff_ext] intermediate screen failed:", e);
          }
        }
        await showPaymentMethodsForTariff(ctx, userId, tariff, onlyOpt, 0, config, innerStyles, innerEmojiIds, token);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // picker подписок клиента с этим tariffId для продления.
    // После выбора подписки → переход на pay_tariff_ext:<sid> (готовый flow продления secondary).
    if (data.startsWith("renew_pick:")) {
      const tariffId = data.slice("renew_pick:".length);
      try {
        const all = await api.getAllSubscriptions(token);
        const matching = (all.items ?? []).filter((it) => it.tariffId === tariffId);
        if (matching.length === 0) {
          await editMessageContent(ctx, "❌ У вас нет подписок с этим тарифом — нечего продлевать.", {
            inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "menu:main" }]],
          });
          return;
        }
        // сортируем по subscriptionIndex —
        // primary (idx=0) идёт первой автоматически. Тип больше не нужен для роутинга.
        const sorted = [...matching].sort((a, b) => (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0));

        // batch-проверка кулдауна для всех подписок этого тарифа.
        // Заблокированные → бейдж 🚫 в кнопке. При клике handler `pay_tariff_ext` сам покажет сообщение.
        const blockedSet = new Set<string>();
        try {
          const cdBatch = await api.checkSubscriptionsCooldownBatch(token, sorted.map((s) => s.id));
          for (const it of (cdBatch.items ?? [])) {
            if (it.blocked) blockedSet.add(it.subscriptionId);
          }
        } catch { /* ignore — без бейджей */ }

        const bodyLines: string[] = ["🔌 Выберите подписку для продления:", ""];
        const rows: { text: string; callback_data: string }[][] = [];
        for (const s of sorted) {
          const info = parseSubInfo(s);
          const idx = s.subscriptionIndex ?? 0;
          // primary slot = «Главная», остальные = «#N»
          const typeText = idx === 0 ? "🌟 Главная" : `Подписка #${idx}`;
          const isBlocked = blockedSet.has(s.id);
          const blockedPrefix = isBlocked ? "🚫 " : "";
          bodyLines.push(`${blockedPrefix}${info.statusEmojiSmall} ${typeText} — ${info.daysStr} до ${info.dateStr}${info.trafficSuffix}`);
          // ВСЕ подписки идут через pay_tariff_ext:<id> — единый flow продления.
          // Заблокированные тоже ведут в pay_tariff_ext — там pre-check покажет сообщение.
          const callback = `pay_tariff_ext:${s.id}`;
          const btnLabel = `${blockedPrefix}${idx === 0 ? "🌟 Главная" : "#" + idx} ${info.daysStr}`;
          rows.push([{ text: btnLabel.slice(0, 60), callback_data: callback.slice(0, 64) }]);
        }
        { const bk = backButton(config?.botEmojis ?? null); rows.push([{ text: bk.text, callback_data: `pay_tariff:${tariffId}` }]); }
        await editMessageContent(ctx, bodyLines.join("\n"), { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("pay_tariff:")) {
      const rest = data.slice("pay_tariff:".length);
      const parts = rest.split(":");
      const tariffId = parts[0];
      // TEMP DEBUG: log incoming pay_tariff callback (to be removed after diagnosing).
      console.log(`[pay_tariff] user=${userId} data="${data}" parts=${JSON.stringify(parts)} tariffId="${tariffId}"`);
      // (bypass-маркеры из tariffActionChoiceButtons.
      // burn  → юзер выбрал «🔥 Сменить основную (сжечь дни)» — пропускаем диалог,
      //            идём в обычный flow (proration backend'а конвертирует/сжигает дни).
      // add   → юзер выбрал «➕ Купить как доп. подписку» — пропускаем диалог,
      //            ставим addsub-флаг (читается ниже в pay_<provider>: и Platega-ветке)
      //            и идём в обычный flow (длительность/устройства/методы), но платёж
      //            создаётся с asAdditional=true → backend пометит metadata, на webhook'е
      //            activateTariffByPaymentId вызовет createAdditionalSubscription.
      // T7b (11.05.2026):
      // extsec:<secondaryId> → юзер нажал «💰 Продлить» в детали secondary-подписки.
      //            Идём в обычный flow выбора длительности/устройств/оплаты, но в metadata
      //            платежа добавляется extendsSecondarySubId → backend вызывает
      //            extendSecondarySubscription (продлевает существующую, НЕ создаёт новую).
      const isBurnBypass = parts[1] === "burn";
      const isAddBypass = parts[1] === "add";
      const isExtsec = parts[1] === "extsec" && parts.length >= 3;
      const extsecSecondaryId = isExtsec ? parts.slice(2).join(":") : null;
      // r — маркер «продление root» из renew_pick.
      // Поведение идентично обычному pay_tariff: (без add), просто пропускает промежуточный
      // экран «Продлить / Купить новую» (иначе бесконечный цикл при выборе основной подписки).
      const isRenewRoot = parts[1] === "r";
      const isBypass = isBurnBypass || isAddBypass || isExtsec || isRenewRoot;
      const methodIdFromBtn = !isBypass && parts.length >= 2 ? Number(parts[1]) : null;
      // T7b: запоминаем что юзер хочет продлить именно эту secondary.
      // Consume'ся ниже при создании любого payment — параметр extendsSecondarySubId
      // прокинется во все методы (balance/yookassa/yoomoney/cryptopay/heleket/lava/lavatop/platega).
      if (isExtsec && extsecSecondaryId) {
        extendingSecondaryPending.set(userId, { tariffId, secondaryId: extsecSecondaryId });
        // При extsec НЕ ставим addsubPending (это не создание новой, а продление).
      } else if (methodIdFromBtn == null) {
        // если юзер вошёл в pay_tariff БЕЗ маркера extsec
        // (т.е. это новая покупка / выбор тарифа), сбрасываем «висящий» Map от предыдущего
        // нажатия «💰 Продлить». Иначе при следующей оплате прокидывается extendsSecondarySubId
        // → бэк блокирует кулдауном.
        // methodIdFromBtn != null означает что юзер уже на этапе выбора провайдера — Map нужен.
        extendingSecondaryPending.delete(userId);
      }
      // Управление addsub-стейтом:
      //   add → set; burn → clear; naked → clear (fresh choice).
      //   extsec → НЕ трогаем addsub.
      //   methodIdFromBtn != null (Platega-метод) — не трогаем здесь, ниже сами consume'м.
      if (isAddBypass) {
        addsubPending.set(userId, tariffId);
      } else if (isBurnBypass || methodIdFromBtn == null) {
        addsubPending.delete(userId);
      }
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      // single-режим категории: «одна подписка на категорию». В нём НЕ спрашиваем
      // «Продлить / Купить новую» и не показываем кнопку «Продлить» — покупка всегда
      // конвертирует/продлевает существующую подписку (бэк делает это сам), поэтому
      // сразу ведём на экран оплаты, где convNote разложит «подписка будет продлена».
      const isSingleCategory = items?.find((c: TariffCategory) => c.tariffs.some((t) => t.id === tariffId))?.singleSubscriptionMode === true;

      // диалог «Покупка тарифа из другой категории» УБРАН.
      // Раньше при клике на тариф другой категории показывался диалог-промежуток. Юзер не хотел
      // лишнего шага → теперь сразу автоматически идём на «купить как новую подписку» (addsubPending),
      // флоу длительности/устройств/оплаты не меняется, на webhook'е создастся параллельная sub.
      if (methodIdFromBtn == null && !isBypass) {
        try {
          const me = await api.getMe(token);
          const newCategory = items?.find((c) => c.tariffs.some((t) => t.id === tariffId));
          if (me.currentTariff && me.currentTariff.categoryId && newCategory && newCategory.id !== me.currentTariff.categoryId) {
            // Автоматически помечаем как additional — backend пометит metadata.isAdditionalSubscription
            // → активация через createAdditionalSubscription (новая параллельная sub).
            addsubPending.set(userId, tariff.id);
          }
        } catch {
          // Если /me не ответил — не блокируем покупку, fallback в обычный flow.
        }
      }

      const opts = sortedPriceOptions(tariff.priceOptions);
      const existingSelection = selectedTariffOption.get(userId);
      const matchesThisTariff = existingSelection?.tariffId === tariff.id;

      // При первичном входе (без methodId): picker длительности (если опций > 1),
      // потом picker доп. устройств (если включены), потом — методы оплаты.
      if (methodIdFromBtn == null) {
        // T11+T12 (11.05.2026): подставляем `tariff.description` (rich-text админа)
        // между названием и приглашением выбрать длительность.
        // Если description пустой — экран как раньше: только название + «Выберите длительность».
        if (opts.length > 1) {
          tariffOptionsCache.set(userId, { tariffId: tariff.id, options: opts });
          const bestId = bestPricePerDayOptionId(opts);
          const desc = ((tariff as TariffItem & { description?: string | null }).description ?? "").trim();
          // заголовок тарифа теперь внутри description.
          // Если desc есть — НЕ дублируем `${tariff.name}` сверху.
          const text = desc
            ? `${desc}\n\nВыберите тариф:`
            : `${tariff.name}\n\nВыберите длительность подписки:`;
          // проверяем, есть ли у клиента подписки с ЭТИМ tariffId.
          // Если есть → сверху picker'а длительностей появится кнопка «🔌 Продлить подписку».
          // в single-режиме кнопку «🔌 Продлить» не показываем —
          // выбор длительности и так ведёт к конвертации/продлению (см. isSingleCategory).
          let hasOwnSubsWithThisTariff = false;
          if (!isSingleCategory) {
            try {
              const all = await api.getAllSubscriptions(token);
              hasOwnSubsWithThisTariff = (all.items ?? []).some((it) => it.tariffId === tariff.id);
            } catch { /* ignore — не блокируем покупку */ }
          }
          await editMessageContent(
            ctx,
            text,
            tariffOptionPickerButtons(
              opts,
              tariff.currency,
              bestId,
              null,
              innerStyles,
              innerEmojiIds,
              hasOwnSubsWithThisTariff ? tariff.id : null,
              config?.botEmojis ?? null,
            ),
          );
          return;
        }
        const onlyOpt = opts[0] ?? null;
        if (onlyOpt) {
          selectedTariffOption.set(userId, { tariffId: tariff.id, option: onlyOpt, extraDevices: 0 });
          // для тарифа с ОДНОЙ опцией длительности (Unblock и т.п.) —
          // если у клиента уже есть подписка с этим тарифом, показываем промежуточный экран:
          // «🔌 Продлить» / «🛒 Купить новую». Без подписки — сразу к оплате.
          // single-режим: пропускаем выбор «Продлить / Купить новую» —
          // покупка и так конвертирует/продлит существующую подписку, экран оплаты ниже
          // (showPaymentMethodsForTariff) сам покажет пояснение через convNote.
          if (!isBypass && !isSingleCategory) {
            try {
              const all = await api.getAllSubscriptions(token);
              const hasMine = (all.items ?? []).some((it) => it.tariffId === tariff.id);
              if (hasMine) {
                const desc = ((tariff as TariffItem & { description?: string | null }).description ?? "").trim();
                const introText = desc ? desc : tariff.name;
                await editMessageContent(ctx, `${introText}\n\nУ вас уже есть подписка с этим тарифом. Что хотите сделать?`, {
                  inline_keyboard: [
                    [{ text: "🔌 Продлить подписку", callback_data: `renew_pick:${tariff.id}` }],
                    [{ text: "🛒 Купить новую", callback_data: `pay_tariff:${tariff.id}:add` }],
                    // «← Назад» к списку тарифов (привязка к bot_emojis.BACK).
                    [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:tariffs" }],
                  ],
                });
                return;
              }
            } catch { /* ignore — fallback в обычный flow */ }
          }
          if (hasExtraDevices(tariff)) {
            const tiers = tariff.deviceDiscountTiers;
            const pricePerExtra = tariff.pricePerExtraDevice ?? 0;
            const maxExtras = tariff.maxExtraDevices ?? 0;
            const includedDevices = tariff.includedDevices ?? 1;
            const tiles = Array.from({ length: maxExtras + 1 }, (_, i) => {
              const extras = i;
              const { extrasTotal, pct } = applyExtraDevicesPriceBot(pricePerExtra, extras, tiers, onlyOpt.durationDays);
              return { extras, total: onlyOpt.price + extrasTotal, pct };
            });
            const bestExtra = tiles.slice(1).reduce((best, cur) => {
              const perDev = cur.total / (includedDevices + cur.extras);
              if (best == null || perDev < best.perDev) return { extras: cur.extras, perDev };
              return best;
            }, null as { extras: number; perDev: number } | null);
            const tilesWithBest = tiles.map((t) => ({
              extras: t.extras,
              included: includedDevices,
              total: t.total,
              pct: t.pct,
              isBest: bestExtra?.extras === t.extras && t.extras > 0 && t.pct === 0,
            }));
            const text = `${tariff.name} · ${formatRuDays(onlyOpt.durationDays)}\n\n📱 В тариф включено: ${includedDevices} устр.\nДобавьте дополнительные:`;
            await editMessageContent(ctx, text, tariffDevicePickerButtons(tilesWithBest, tariff.currency, config?.botBackLabel ?? null, innerStyles, innerEmojiIds));
            return;
          }
        }
        await showPaymentMethodsForTariff(ctx, userId, tariff, onlyOpt, 0, config, innerStyles, innerEmojiIds, token);
        return;
      }

      // Метод выбран: считаем effectivePrice с учётом extras + создаём Platega-платёж.
      const eff = matchesThisTariff && existingSelection ? existingSelection.option : (opts.length === 1 ? opts[0]! : null);
      const unitPrice = eff?.price ?? tariff.price;
      const effectiveDays = eff?.durationDays ?? tariff.durationDays;
      const extraDevices = matchesThisTariff && existingSelection ? existingSelection.extraDevices : 0;
      const includedDevices = tariff.includedDevices ?? 1;
      // ВАЖНО: передаём effectiveDays — иначе extras считались за 30 дней (дефолт)
      // вместо реальной длительности опции, и на экране Platega цена занижалась
      // (выглядела как «скидка»), хотя бэк списывал верную сумму. Как во всех др. ветках.
      const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
      const effectivePrice = unitPrice + extrasTotal;
      const discountInfoTariff = activeDiscountCode.get(userId);
      const discountArgTariff = discountInfoTariff ? {
        originalPrice: formatMoney(effectivePrice, tariff.currency),
        discountedPrice: formatMoney(getDiscountedPrice(effectivePrice, discountInfoTariff), tariff.currency),
      } : undefined;
      const totalDevices = includedDevices + extraDevices;
      const devicesSuffix = extraDevices > 0 ? ` · ${totalDevices} устр (+${extraDevices} доп.)` : "";
      const nameWithDays = opts.length > 1 || matchesThisTariff
        ? `${tariff.name} · ${formatRuDays(effectiveDays)}${devicesSuffix}`
        : `${tariff.name}${devicesSuffix}`;
      const promoCode = discountInfoTariff?.code;
      // если в addsub-режиме (через :add bypass), помечаем платёж
      // как «купить как доп. подписку» — backend поставит metadata.isAdditionalSubscription
      // и на webhook'е activateTariffByPaymentId создаст secondary вместо main.
      const asAdditionalPlatega = addsubPending.get(userId) === tariff.id;
      // T7b: если в режиме продления конкретной secondary — прокидываем её id.
      const extPairPlatega = extendingSecondaryPending.get(userId);
      const extendsSecondarySubIdPlatega = extPairPlatega && extPairPlatega.tariffId === tariff.id ? extPairPlatega.secondaryId : undefined;
      // юзер выбрал «продлить без устройств».
      // Флаг прокидываем в backend — там после успешной активации helper удалит устройства.
      // НЕ удаляем здесь — юзер может закрыть экран оплаты и устройства останутся при нём.
      const removeExtrasOnActivatePlatega = !!(extendsSecondarySubIdPlatega && pendingDropExtras.get(userId) === extendsSecondarySubIdPlatega) || (!extendsSecondarySubIdPlatega && convDropExtras.has(userId));
      const replaceTrialSubIdPlatega = !extendsSecondarySubIdPlatega ? trialReplaceChoice.get(userId) : undefined;
      let subExtrasForPeriodPlatega = 0;
      if (extendsSecondarySubIdPlatega && !removeExtrasOnActivatePlatega) {
        try {
          const allSubs = await api.getAllSubscriptions(token);
          const target = allSubs.items?.find((it) => it.id === extendsSecondarySubIdPlatega);
          const monthly = target?.extraDevicesMonthlyPrice ?? 0;
          if (monthly > 0 && effectiveDays > 0) {
            subExtrasForPeriodPlatega = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
          }
        } catch { /* ignore */ }
      }
      const totalPricePlatega = effectivePrice + subExtrasForPeriodPlatega;
      const payment = await api.createPlategaPayment(token, {
        amount: totalPricePlatega,
        currency: tariff.currency,
        paymentMethod: methodIdFromBtn,
        description: `Тариф: ${tariff.name}`,
        tariffId: tariff.id,
        tariffPriceOptionId: eff?.id,
        deviceCount: extraDevices,
        promoCode,
        asAdditional: asAdditionalPlatega || undefined,
        extendsSecondarySubId: extendsSecondarySubIdPlatega,
        removeExtrasOnActivate: removeExtrasOnActivatePlatega,
        replaceTrialSubId: replaceTrialSubIdPlatega,
      });
      if (promoCode) activeDiscountCode.delete(userId);
      selectedTariffOption.delete(userId);
      if (asAdditionalPlatega) addsubPending.delete(userId);
      if (extendsSecondarySubIdPlatega && removeExtrasOnActivatePlatega) extendingSecondaryPending.delete(userId);
      if (removeExtrasOnActivatePlatega) pendingDropExtras.delete(userId);
      convDropExtras.delete(userId);
      trialReplaceChoice.delete(userId);
      const discountArgTariffUpdated = discountInfoTariff ? {
        originalPrice: formatMoney(totalPricePlatega, tariff.currency),
        discountedPrice: formatMoney(getDiscountedPrice(totalPricePlatega, discountInfoTariff), tariff.currency),
      } : undefined;
      const msg = buildPaymentMessage(config, {
        name: nameWithDays,
        price: formatMoney(totalPricePlatega, tariff.currency),
        amount: String(totalPricePlatega),
        currency: tariff.currency,
        action: "Нажмите кнопку ниже для оплаты:",
      }, discountArgTariffUpdated);
      await editMessageContent(ctx, msg.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), msg.entities);
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

    // «📱 Мои Устройства» — единый список устройств всех подписок
    // (root + secondary) с пометкой «Подписка #N — тариф». Используется новый endpoint
    // `/devices/all` который собирает devices из всех Remna-юзеров клиента.
    if (data === "menu:devices") {
      const lang = getUserLang(userId);
      try {
        const all = await api.getAllDevices(token);
        // Маппим в стандартный формат для совместимости с devices:delete handler.
        // T-fix (12.05.2026): пробрасываем subscriptionType + subscriptionId — нужны при удалении.
        const flat = all.items.map((it) => ({
          hwid: it.hwid,
          platform: it.platform,
          deviceModel: it.deviceModel,
          createdAt: it.createdAt,
          subscriptionType: it.subscriptionType,
          subscriptionId: it.subscriptionId,
        }));
        lastDevicesList.set(userId, { devices: flat });
        if (all.items.length === 0) {
          await editMessageContent(
            ctx,
            _t("devices.no_devices", lang),
            { inline_keyboard: [[{ text: config?.botBackLabel ?? _t("back_to_menu", lang), callback_data: "menu:main" }]] }
          );
          return;
        }
        // текст шапки берётся из настроек админки
        // (`config.botDevicesText`). Fallback — i18n (`devices.delete_hint`).
        const devicesHeader = (config?.botDevicesText ?? "").trim() || _t("devices.delete_hint", lang);
        // Группируем устройства по подпискам — для красивого вывода.
        const lines: string[] = [devicesHeader + "\n"];
        const rows: InlineMarkup["inline_keyboard"] = [];
        // Сначала группируем для заголовков, потом перебираем последовательно.
        const groups = new Map<string, { label: string; devices: { idx: number; d: typeof all.items[number] }[] }>();
        all.items.slice(0, 30).forEach((d, i) => {
          const groupKey = `${d.subscriptionType}:${d.subscriptionId}`;
          // root показываем как «Подписка #0»,
          // а не «🌟 Основная» — чтобы юзер видел единый формат «Подписка #N».
          const groupLabel = `Подписка #${d.subscriptionIndex}${d.tariffName ? ` ${d.tariffName}` : ""}`;
          if (!groups.has(groupKey)) groups.set(groupKey, { label: groupLabel, devices: [] });
          groups.get(groupKey)!.devices.push({ idx: i, d });
        });
        for (const [, grp] of groups) {
          lines.push(`\n${grp.label}:`);
          for (const { idx, d } of grp.devices) {
            // приложение рядом с устройством.
            const appPart = d.appName ? ` · 📱 ${d.appName}` : "";
            const label = sanitizeLabel([d.platform, d.deviceModel].filter(Boolean).join(" · ") + appPart) || d.hwid.slice(0, 12) + "…";
            lines.push(`  ${idx + 1}. ${label}`);
            rows.push([{ text: sanitizeLabel(`🗑 Удалить #${idx + 1}: ${label.slice(0, 22)}`), callback_data: `devices:delete:${idx}` }]);
          }
        }
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        // починка разорванного ключа install_second_device_text:
        // он редактировался в админке, но ботом нигде не читался. Показываем блок
        // «Как подключить второе устройство» под списком устройств (если задан).
        const secondDeviceNote = (config?.installSecondDeviceText ?? "").trim();
        if (secondDeviceNote) lines.push("", secondDeviceNote);
        await editMessageContent(ctx, lines.join("\n"), { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `📱 Устройства\n\n❌ ${msg}`, {
          inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "menu:main" }]],
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
      const dev = stored.devices[index]!;
      const hwid = dev.hwid;
      // T-fix (12.05.2026): передаём subscriptionType + subscriptionId — backend удалит ровно из этой подписки.
      const subInfo = dev.subscriptionType && dev.subscriptionId
        ? { type: dev.subscriptionType, id: dev.subscriptionId }
        : undefined;
      try {
        await api.postClientDeviceDelete(token, hwid, subInfo);
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
            const label = sanitizeLabel([d.platform, d.deviceModel].filter(Boolean).join(" · ")) || d.hwid.slice(0, 12) + "…";
            lines.push(`${i + 1}. ${label}`);
            rows.push([{ text: sanitizeLabel(`🗑 Удалить: ${label.slice(0, 25)}`), callback_data: `devices:delete:${i}` }]);
          });
          rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
          await editMessageContent(ctx, lines.join("\n"), { inline_keyboard: rows });
        }
      } catch (e: unknown) {
        await editMessageContent(ctx, `❌ ${e instanceof Error ? e.message : "Ошибка"}`, {
          inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "menu:main" }]],
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

    // экран «💼 Мой баланс» с балансом, статистикой
    // (потрачено / накоплено реф.) и кнопкой пополнения. Открывается из menu:tariffs.
    if (data === "menu:balance") {
      try {
        const me = await api.getMe(token);
        const stats = await api.getReferralStats(token).catch(() => null);
        const currency = (me?.preferredCurrency ?? "RUB").toUpperCase();
        const sym = currency === "RUB" ? "₽" : currency === "USD" ? "$" : currency;
        const balance = (me?.balance ?? 0).toFixed(2);
        const totalEarned = stats ? stats.totalEarned.toFixed(2) : "0.00";
        const totalSpent = stats ? stats.totalSpent.toFixed(2) : "0.00";
        // подсказка внизу редактируется в админке («Тексты бота» →
        // bot_balance_text); раньше была захардкожена здесь.
        const balanceHint = (config?.botBalanceText ?? "").trim() || [
          "💡 С баланса можно оплатить любую подписку или докупить устройство.",
          "",
          "Пополнить баланс можно с помощью кнопки «💳 Пополнить баланс» или через 👥 Реферальную программу.",
        ].join("\n");
        const lines: string[] = [
          "💼 Мой баланс",
          "",
          `💵 Доступно: **${balance} ${sym}**`,
          "",
          "📊 Статистика:",
          `• 🛒 Потрачено с баланса: ${totalSpent} ${sym}`,
          `• 👥 Начислено от рефералов: ${totalEarned} ${sym}`,
          "",
          balanceHint,
        ];
        const { text, entities } = applyMarkdownAndEmoji(lines.join("\n"), config?.botEmojis ?? null);
        await editMessageContent(ctx, text, {
          inline_keyboard: [
            [{ text: "💳 Пополнить баланс", callback_data: "menu:topup" }],
            [{ text: "👥 Реферальная программа", callback_data: "menu:referral" }],
            // «← Назад» к списку тарифов (привязка к bot_emojis.BACK).
            [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:tariffs" }],
            [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
          ],
        }, entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
      // текст редактируется в админке («Тексты бота» → bot_topup_text).
      const topupBody = (config?.botTopupText ?? "").trim() || "Пополнить баланс\n\nВыберите сумму или введите свою (числом):";
      const topupTitle = titleWithEmoji("CARD", topupBody, config?.botEmojis);
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
        const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, yooTopup.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), yooTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        // 54-ФЗ-чек prompt.
        const savedEmailTp = client?.email ?? null;
        const tokRcptTp = storePendingReceipt({
          userId,
          savedEmail: savedEmailTp,
          builder: (receiptEmail) => api.createYookassaPayment(token, { amount, currency: "RUB", receiptEmail }),
          finalize: async (payment, { receiptSentTo }) => {
            const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
            const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
            if (receiptSentTo) {
              await ctx.reply(`${yooTopup.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
            } else {
              await ctx.reply(yooTopup.text, { entities: yooTopup.entities, reply_markup: markup });
            }
          },
        });
        await editMessageContent(ctx, receiptPromptText(savedEmailTp), receiptPromptKeyboard(tokRcptTp, savedEmailTp));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
        const cpTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, cpTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), cpTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа Crypto Bot";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_lava:")) {
      const amountStr = data.slice("topup_lava:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createLavaPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const lvTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, lvTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), lvTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа Lava";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_lavatop:")) {
      const amountStr = data.slice("topup_lavatop:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createLavatopPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const lvTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, lvTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), lvTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа Lava.top";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup_heleket:")) {
      const amountStr = data.slice("topup_heleket:".length);
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await editMessageContent(ctx, "Неверная сумма.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const client = await api.getMe(token);
      try {
        const payment = await api.createHeleketPayment(token, { amount, currency: client.preferredCurrency ?? "RUB" });
        const hkTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency ?? "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, hkTopup.text, payUrlMarkup(payment.payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), hkTopup.entities);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания платежа Heleket";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("topup:")) {
      const rest = data.slice("topup:".length);
      // «Ввести свою сумму» — переход в conversation flow.
      // Бот ждёт следующее сообщение от юзера как сумму, затем создаёт payment.
      if (rest === "custom") {
        awaitingCustomTopup.add(userId);
        await editMessageContent(
          ctx,
          "✏️ Введите сумму пополнения числом (например: 250, 750, 1500). Минимум 50 ₽.",
          { inline_keyboard: [[{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:topup" }]] },
        );
        return;
      }
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
      const heleketEnabled = !!config?.heleketEnabled;
      const lavaEnabled = !!config?.lavaEnabled;
      const lavatopEnabled = !!config?.lavatopEnabled;
      // Если есть >1 способа любого типа — показываем выбор
      const anyOnline = yooEnabled || yookassaEnabled || cryptopayEnabled || heleketEnabled || lavaEnabled || lavatopEnabled;
      const enabledOnlineCount = [yooEnabled, yookassaEnabled, cryptopayEnabled, heleketEnabled, lavaEnabled, lavatopEnabled].filter(Boolean).length;
      if (methods.length > 1 || (methods.length >= 1 && anyOnline) || (methods.length === 0 && enabledOnlineCount >= 2)) {
        const topupPay2 = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nВыберите способ оплаты:`, config?.botEmojis);
        await editMessageContent(ctx, topupPay2.text, topupPaymentMethodButtons(amountStr, methods, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds, yooEnabled, yookassaEnabled, cryptopayEnabled, heleketEnabled, lavaEnabled, lavatopEnabled), topupPay2.entities);
        return;
      }
      // Если ЮMoney единственный способ (нет platega, нет ЮKassa) — сразу создаём платёж ЮMoney
      if (methods.length === 0 && yooEnabled && !yookassaEnabled) {
        try {
          const payment = await api.createYoomoneyPayment(token, { amount, paymentType: "AC" });
          const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, client.preferredCurrency)}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
          await editMessageContent(ctx, yooTopup.text, payUrlMarkup(payment.paymentUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds), yooTopup.entities);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮMoney";
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
        }
        return;
      }
      // Если только ЮKassa — сразу создаём платёж ЮKassa
      if (methods.length === 0 && yookassaEnabled) {
        try {
          // 54-ФЗ-чек prompt.
          const savedEmailTp2 = client?.email ?? null;
          const tokRcptTp2 = storePendingReceipt({
            userId,
            savedEmail: savedEmailTp2,
            builder: (receiptEmail) => api.createYookassaPayment(token, { amount, currency: "RUB", receiptEmail }),
            finalize: async (payment, { receiptSentTo }) => {
              const yooTopup = titleWithEmoji("CARD", `Пополнение на ${formatMoney(amount, "RUB")}\n\nНажмите кнопку ниже для оплаты:`, config?.botEmojis);
              const markup = payUrlMarkup(payment.confirmationUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
              if (receiptSentTo) {
                await ctx.reply(`${yooTopup.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
              } else {
                await ctx.reply(yooTopup.text, { entities: yooTopup.entities, reply_markup: markup });
              }
            },
          });
          await editMessageContent(ctx, receiptPromptText(savedEmailTp2), receiptPromptKeyboard(tokRcptTp2, savedEmailTp2));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
          await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
      // новый текст по эталону клиента + статистика из /referral-stats.
      const stats = await api.getReferralStats(token).catch(() => null);
      const linkSite = appUrl ? `${appUrl}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}` : null;
      const linkBot = `https://t.me/${ctx.me?.username ?? "bot"}?start=ref_${client.referralCode}`;
      const p1 = stats?.referralPercent ?? client.referralPercent ?? (config?.defaultReferralPercent ?? 0);
      const p2 = stats?.referralPercentLevel2 ?? (config?.referralPercentLevel2 ?? 0);
      const fmt = (n: number) => `${Math.round(n)}₽`;
      // вступление и футер редактируются в админке («Тексты бота» →
      // bot_referral_intro_text / bot_referral_footer_text); раньше были захардкожены.
      const referralIntro = (config?.botReferralIntroText ?? "").trim()
        || "Поделитесь ссылкой с друзьями и получайте процент со всех их пополнений! 🤝";
      const lines: string[] = [
        "👥 Реферальная программа",
        "",
        referralIntro,
        "",
        `👥 Рефералы 1 уровня: ${p1}%`,
        `Вы получаете ${p1}% от пополнений тех, кто перешёл по вашей ссылке.`,
        `• Переходов по вашей ссылке: ${stats?.l1Clicks ?? 0}`,
        `• Приобрели подписку: ${stats?.l1Purchased ?? 0}`,
        `• Доход с рефералов 1 уровня: ${fmt(stats?.l1Earned ?? 0)}`,
        "",
        `🤝 Рефералы 2 уровня: ${p2}%`,
        `Вы получаете ${p2}% от пополнений рефералов ваших рефералов.`,
        `• Приглашено вашими рефералами: ${stats?.l2InvitesCount ?? 0}`,
        `• Доход с рефералов 2 уровня: ${fmt(stats?.l2Earned ?? 0)}`,
        "",
        `💰 Ваш заработок (всего): ${fmt(stats?.totalEarned ?? 0)}`,
        `💸 Выведено: ${fmt(stats?.totalWithdrawn ?? 0)}`,
        `🛒 Потрачено: ${fmt(stats?.totalSpent ?? 0)}`,
        `💵 Доступно: ${fmt(stats?.availableBalance ?? client.balance ?? 0)}`,
        "",
        "🔗 Ваша реферальная ссылка:",
        "",
        "Telegram Бот:",
        linkBot,
      ];
      if (linkSite) {
        lines.push("");
        lines.push("Сайт:");
        lines.push(linkSite);
      }
      lines.push("");
      lines.push(
        (config?.botReferralFooterText ?? "").trim()
          || "💡 С реферального баланса можно оплатить подписку или вывести эти средства на свой кошелёк.",
      );

      // T-fix (11.05.2026): кнопки по эталону клиента.
      // 1. «📢 Поделиться ссылкой» — t.me/share URL для пересылки
      // 2. «💳 Оплатить/продлить доступ» — callback menu:tariffs (можно купить с реф. баланса)
      // 3. «💰 Заявка на вывод (от 3000₽)» — conversation flow withdraw:start
      // формат как в gift — `url=` + `text=`.
      // Ссылку В САМ ТЕКСТ НЕ кладём — она уже идёт через параметр `url=` и
      // выводится TG-клиентом ПЕРВОЙ строкой автоматически. Если продублировать
      // в shareText — получим две одинаковых ссылки подряд (баг юзера 14.05).
      // текст шаринга редактируется в админке («Тексты бота» → bot_referral_share_text).
      // Ведущий \n обязателен: ссылка из `url=` рисуется TG-клиентом первой строкой.
      const shareBody = (config?.botReferralShareText ?? "").trim()
        || "🛡 Надёжный VPN, который реально работает!\n\nРаботает там, где другие не справляются.\n\n💡 Нажми на ссылку выше, чтобы подключиться.";
      const shareText = `\n${shareBody}`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(linkBot)}&text=${encodeURIComponent(shareText)}`;
      const rows: ({ text: string; url: string } | { text: string; callback_data: string })[][] = [];
      rows.push([{ text: "📢 Поделиться ссылкой", url: shareUrl }]);
      rows.push([{ text: "💳 Оплатить/продлить доступ", callback_data: "menu:tariffs" }]);
      // кнопка вывода скрывается тогглом; мин. сумма из настройки.
      if (config?.withdrawalsEnabled !== false) {
        rows.push([{ text: `💰 Заявка на вывод (от ${config?.withdrawalMinAmount ?? 3000}₽)`, callback_data: "withdraw:start" }]);
      }
      rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);

      const { text: refText, entities: refEntities } = titleWithEmoji("LINK", lines.join("\n"), config?.botEmojis);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await editMessageContent(ctx, refText, { inline_keyboard: rows as any }, refEntities);
      return;
    }

    // Conversation flow для вывода USDT TRC20.
    // Шаг 1: withdraw:start — спрашиваем сумму (минимум 3000)
    // Шаг 2 (text): юзер вводит сумму → проверяем → спрашиваем кошелёк TRC20
    // Шаг 3 (text): юзер вводит кошелёк → показываем подтверждение
    // Шаг 4: withdraw:confirm:<amount>:<wallet> → создаём заявку
    if (data === "withdraw:start") {
      try {
        // мин. сумма из настройки + общий выключатель фичи.
        if (config?.withdrawalsEnabled === false) {
          await editMessageContent(ctx, "💰 Заявки на вывод временно отключены.", {
            inline_keyboard: [[{ text: "👥 К рефералке", callback_data: "menu:referral" }]],
          });
          return;
        }
        const withdrawMin = config?.withdrawalMinAmount ?? 3000;
        const me = await api.getMe(token);
        const balance = me?.balance ?? 0;
        if (balance < withdrawMin) {
          await editMessageContent(
            ctx,
            `💰 Заявка на вывод (USDT TRC20)\n\n⚠️ Минимальная сумма вывода — ${withdrawMin}₽\n\nВаш текущий баланс: ${balance.toFixed(2)}₽\n\nПродолжайте приглашать друзей по реферальной ссылке — и накопите нужную сумму!`,
            {
              inline_keyboard: [
                [{ text: "👥 К рефералке", callback_data: "menu:referral" }],
                [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
              ],
            },
          );
          return;
        }
        awaitingWithdrawAmount.add(userId);
        awaitingWithdrawWallet.delete(userId);
        await editMessageContent(
          ctx,
          `💰 Заявка на вывод (USDT TRC20)\n\nВведите сумму для вывода (минимум ${withdrawMin}₽).\nДоступно: ${balance.toFixed(2)}₽`,
          {
            inline_keyboard: [
              [{ text: "❌ Отмена", callback_data: "menu:referral" }],
            ],
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("withdraw:confirm:")) {
      // Формат: withdraw:confirm:<amount>:<wallet>
      const parts = data.slice("withdraw:confirm:".length).split(":");
      const amount = parseFloat(parts[0] ?? "0");
      const wallet = parts.slice(1).join(":");
      const withdrawConfirmMin = config?.withdrawalMinAmount ?? 3000;
      if (!Number.isFinite(amount) || amount < withdrawConfirmMin || !wallet) {
        await editMessageContent(ctx, "❌ Некорректные данные заявки. Попробуйте снова.", {
          inline_keyboard: [[{ text: "💰 К рефералке", callback_data: "menu:referral" }]],
        });
        return;
      }
      try {
        const result = await api.createWithdrawal(token, { amount, walletTrc20: wallet });
        awaitingWithdrawAmount.delete(userId);
        awaitingWithdrawWallet.delete(userId);
        await editMessageContent(
          ctx,
          `✅ ${result.message}\n\n💸 Сумма: ${amount.toFixed(2)}₽\n🏦 Кошелёк: ${wallet}\n\nКак только администратор обработает заявку — мы пришлём уведомление в этот чат.`,
          {
            inline_keyboard: [
              [{ text: "👥 К рефералке", callback_data: "menu:referral" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, {
          inline_keyboard: [[{ text: "👥 К рефералке", callback_data: "menu:referral" }]],
        });
      }
      return;
    }

    if (data === "menu:promocode") {
      const lang = getUserLang(userId);
      awaitingPromoCode.add(userId);
      // текст редактируется в админке («Тексты бота» → bot_promocode_text); fallback — i18n.
      await editMessageContent(
        ctx,
        (config?.botPromocodeText ?? "").trim() || _t("promo.enter_title", lang),
        backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
      );
      return;
    }

    // несколько триалов с настраиваемыми тарифами.
    // - Если доступных 0 → "Уже использовали все триалы" + back.
    // - Если 1 → автоактивация (как раньше — без выбора).
    // - Если 2+ → показать список с кнопками.
    // Старый callback `trial:confirm` оставлен как back-compat (legacy single-trial flow).
    if (data === "menu:trial") {
      try {
        const { items } = await api.getAvailableTrials(token);
        if (items.length === 0) {
          // текст редактируется в админке («Тексты бота» → bot_trial_used_text).
          await editMessageContent(
            ctx,
            (config?.botTrialUsedText ?? "").trim() || "🎁 Пробные подписки\n\nВсе доступные пробные подписки уже использованы.",
            backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
          );
          return;
        }
        // убрана авто-активация при 1 триале —
        // юзер всегда явно выбирает триал кнопкой (даже если он один).
        // Старая логика if (items.length === 1) → activateTrialById удалена.
        if (false as boolean) {
          return;
        }
        // 2+ триалов → выбор.
        // новый текст по эталону клиента — заголовок + описание
        // каждого триала из поля description в БД (rich-text), вместо короткой строки «• N дн. (Тариф)».
        // заголовок редактируется в админке («Тексты бота» → bot_trial_text).
        const trialHeader = (config?.botTrialText ?? "").trim() || "🎁 Получить пробную подписку\n\n📱 Выберите тип подписки";
        const lines: string[] = [trialHeader, ""];
        for (const t of items) {
          const desc = (t.description ?? "").trim();
          if (desc) {
            lines.push(desc);
          } else {
            // Fallback на старый формат, если description не заполнен.
            const tariffStr = t.tariffName ? ` (${t.tariffName})` : "";
            lines.push(`• ${t.name} — ${t.durationDays} дн.${tariffStr}`);
          }
          lines.push("");
        }
        lines.push("Выберите тип подписки:");
        const rows: { text: string; callback_data: string }[][] = items.map((t) => [
          { text: `${t.name} — ${t.durationDays} дн.`.slice(0, 64), callback_data: `trial:activate:${t.id}` },
        ]);
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        await editMessageContent(ctx, lines.join("\n"), { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки триалов";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // T15: активация конкретного триала по ID из списка.
    if (data.startsWith("trial:activate:")) {
      const trialId = data.slice("trial:activate:".length);
      try {
        const result = await api.activateTrialById(token, trialId);
        // новый UX после активации триала по запросу клиента.
        // Кнопки: 📲 Инструкции по установке (URL) / 🌐 Локации / 📋 Мои подписки / 🏠 Главное меню.
        // Текст: «✅ Пробная подписка ... активирована.\n\n🔗 Ссылка подписки: ...\n\nДля подключения нажмите «📲 Подключиться»».
        type Row = ({ text: string; callback_data: string } | { text: string; url: string })[];
        const rows: Row[] = [];
        if (result.subscriptionUrl && result.subscriptionUrl.trim()) {
          rows.push([{ text: "📲 Инструкции по установке", url: result.subscriptionUrl.trim() }]);
        }
        if (result.tariffHasLocations && result.tariffId) {
          rows.push([{ text: "🌐 Локации", callback_data: `menu:locations:${result.tariffId}` }]);
        }
        rows.push([{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]);
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        // подсказка «если инструкция не открылась».
        const fallback = instructionFallbackText(config);
        const linkBlock = result.subscriptionUrl && result.subscriptionUrl.trim()
          ? `\n\n🔗 Ссылка подписки:\n${result.subscriptionUrl.trim()}\n\nДля подключения нажмите кнопку «📲 Инструкции по установке»:\n\n${fallback}`
          : "";
        await editMessageContent(
          ctx,
          `✅ ${result.message}${linkBlock}`,
          { inline_keyboard: rows },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка активации";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // Back-compat для legacy `trial:confirm` (дефолтный single-trial flow).
    if (data === "trial:confirm") {
      try {
        const result = await api.activateTrial(token);
        // после активации запрашиваем /subscription/all,
        // берём URL первой активной подписки клиента — рендерим тот же красивый UX
        // что после нового trial:activate (📲 Инструкции / 🔗 Ссылка подписки / Подключиться).
        let subscriptionUrl: string | null = null;
        try {
          const all = await api.getAllSubscriptions(token);
          const first = (all.items ?? []).find((it) => it.remnawaveUuid && it.subscription);
          if (first) {
            const sub = first.subscription as { subscriptionUrl?: string; response?: { subscriptionUrl?: string }; data?: { subscriptionUrl?: string } } | null;
            subscriptionUrl = sub?.subscriptionUrl ?? sub?.response?.subscriptionUrl ?? sub?.data?.subscriptionUrl ?? null;
          }
        } catch { /* ignore */ }

        type Row = ({ text: string; callback_data: string } | { text: string; url: string })[];
        const rows: Row[] = [];
        if (subscriptionUrl) rows.push([{ text: "📲 Инструкции по установке", url: subscriptionUrl }]);
        rows.push([{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]);
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        const fallbackLegacy = instructionFallbackText(config);
        const linkBlock = subscriptionUrl
          ? `\n\n🔗 Ссылка подписки:\n${subscriptionUrl}\n\nДля подключения нажмите кнопку «📲 Инструкции по установке»:\n\n${fallbackLegacy}`
          : "";
        await editMessageContent(ctx, `✅ ${result.message}${linkBlock}`, { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка активации";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "menu:vpn") {
      const lang = getUserLang(userId);
      // «🔌 Подключиться» из главного меню.
      // Старое поведение: показывал ссылку ТОЛЬКО для основной подписки → юзеры с
      // дополнительными подписками не могли через эту кнопку получить нужный URL.
      // Новое поведение:
      //   • 0 подписок (включая secondary) → "у вас нет подписок"
      //   • 1 подписка (любая)            → форвардим на sub:connect:<type>:<id> (выдача URL)
      //   • 2+ подписок                   → picker подписок → каждая ведёт на sub:connect:
      try {
        const all = await api.getAllSubscriptions(token);
        const items = all.items ?? [];
        if (items.length === 0) {
          await editMessageContent(ctx, _t("vpn.link_unavailable", lang), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        if (items.length === 1) {
          // Один сабклик — одна ссылка. Эмулируем sub:connect: чтобы не дублировать flow.
          const only = items[0]!;
          const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
          const useRemna = config?.useRemnaSubscriptionPage === true;
          let url: string | null = null;
          let webAppPath: string | null = null;
          if (only.type === "root") {
            url = getSubscriptionUrl(only.subscription);
            webAppPath = appUrl ? `${appUrl}/cabinet/subscribe` : null;
          } else {
            // T17: secondary в menu:vpn уже отфильтрована (purchasedAsGift=false), активация не нужна.
            const giftRes = await api.getGiftSubscriptionUrl(token, only.id);
            if (useRemna) {
              const byUuid = await api.getSubscriptionByUuid(token, giftRes.uuid);
              url = getSubscriptionUrl(byUuid.subscription);
            }
            webAppPath = appUrl ? `${appUrl}/cabinet/subscribe?uuid=${encodeURIComponent(giftRes.uuid)}` : null;
          }
          if (useRemna && url) {
            await editMessageContent(ctx, `📲 Ссылка на подписку:\n\n${url}`, {
              inline_keyboard: [
                [{ text: "📲 Открыть страницу подключения", url }],
                // T16-fix (11.05.2026): «menu:back» нигде не зарегистрирован → кнопка ломалась.
                // Используем «menu:main» который рендерит главное меню. Текст — «🏠 Главное меню».
                [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
              ],
            });
          } else if (webAppPath) {
            await editMessageContent(ctx, "📲 Подключитесь через мини-приложение:", {
              inline_keyboard: [
                [{ text: "📲 Открыть страницу подключения", web_app: { url: webAppPath } }],
                [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
              ],
            });
          } else if (url) {
            await editMessageContent(ctx, `📲 Ссылка на подписку:\n\n${url}\n\nОткройте её в приложении VPN.`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          } else {
            await editMessageContent(ctx, _t("vpn.link_unavailable", lang), backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          }
          return;
        }
        // 2+ подписок → picker. Кнопка ведёт на sub:connect:<type>:<id> (готовый handler).
        // T16-fix (11.05.2026): добавляем наглядную инфу о каждой подписке (срок + трафик)
        // — как в menu:my_subs. parseSubInfo даёт {idx, daysStr, dateStr, trafficSuffix, statusEmojiSmall}.
        const sorted = [...items].sort((a, b) => {
          if (a.type !== b.type) return a.type === "root" ? -1 : 1;
          return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
        });
        const bodyLines: string[] = [
          "📲 К какой подписке хотите подключиться?",
          "",
          "Выберите её ниже — выдадим ссылку для приложения.",
          "",
        ];
        const rows: { text: string; callback_data: string }[][] = [];
        for (const s of sorted) {
          const info = parseSubInfo(s);
          const idx = s.subscriptionIndex ?? 0;
          const tariff = (s.tariffDisplayName || "—").slice(0, 30);
          const trialMark = s.trialId ? " 🎁" : "";
          // везде единый формат «Подписка #N» (включая root).
          // Body: «Подписка #0 (🌐 Стандартная) — 120 дн. до 07.09.2026»
          //       «Подписка #2 (🔒 Unblock) — 30 дн. до 09.06.2026 | 0/90 ГБ»
          const typeText = `Подписка #${idx}`;
          bodyLines.push(`${info.statusEmojiSmall} ${typeText}${trialMark} ${tariff}`);
          bodyLines.push(`    📅 ${info.daysStr} до ${info.dateStr}${info.trafficSuffix}`);
          bodyLines.push("");
          // Button label остаётся коротким — иначе не влезает в 64 байта callback.
          const btnLabel = `#${idx}${trialMark} ${tariff}`;
          rows.push([{ text: btnLabel.slice(0, 60), callback_data: `sub:connect:${s.type}:${s.id}`.slice(0, 64) }]);
        }
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        await editMessageContent(ctx, bodyLines.join("\n").trim(), { inline_keyboard: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // ——— My subscriptions (root + secondary) handlers ———
    // Унифицированный список ВСЕХ подписок клиента (основная + доп./подаренные).
    // Бот тянет данные через /api/client/subscription/all (один запрос на оба типа).
    // Карточка подписки даёт «Подключиться» (URL подписки) и «Продлить» (пока ведёт
    // в общий menu:tariffs — Commit 2 заменит на category-aware экран).

    if (data === "menu:my_subs") {
      try {
        const result = await api.getAllSubscriptions(token);
        if (!result.items?.length) {
          await editMessageContent(
            ctx,
            "📋 Мои подписки\n\nУ вас пока нет активных подписок.",
            backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds),
          );
          return;
        }
        // Sort: root первая, затем secondary по subscriptionIndex.
        const sorted = [...result.items].sort((a, b) => {
          if (a.type !== b.type) return a.type === "root" ? -1 : 1;
          return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
        });
        // Формат тела: «🌐 #N — N дн. до DD.MM.YYYY [| used/limit ГБ]» (по строке на подписку).
        // Формат кнопки: «✅ #N <typeEmoji> <tariff> (N дн.)».
        // Дни жирные (через **markdown** + applyMarkdownAndEmoji).
        const bodyLines = [`📋 Мои подписки (**${sorted.length}**)`, ""];
        const buttonItems = sorted.map((it) => {
          const info = parseSubInfo(it);
          // T15.4: маркер 🎁 для триал-подписок в текстовой строке (под лимит callback_data
          // в кнопках уже не влезает, поэтому только в body).
          const trialBodyMark = it.trialId ? " 🎁" : "";
          // без названия тарифа в текстовой строке —
          // для истёкших «❌ истекла», для активных «N дн. до DD.MM.YYYY [+трафик]».
          if (info.isExpired) {
            bodyLines.push(`${info.typeEmoji} #${info.idx}${trialBodyMark} — ❌ истекла`);
          } else {
            bodyLines.push(`${info.typeEmoji} #${info.idx}${trialBodyMark} — **${info.daysStr}** до ${info.dateStr}${info.trafficSuffix}`);
          }
          // tariffDisplayName уже содержит эмодзи категории (🌐/🔒) в начале — не дублируем
          // typeEmoji в лейбле кнопки. Slice 38 → запас под Telegram-лимит 64 байта.
          const tariff = (it.tariffDisplayName || "—").slice(0, 38);
          // T15.4: для trial — компактный маркер 🎁 в конце лейбла кнопки.
          const trialBtnMark = it.trialId ? " 🎁" : "";
          const lifetimeStr = info.isExpired ? "истекла" : info.daysStr;
          const label = `${info.statusEmojiSmall} #${info.idx} ${tariff} (${lifetimeStr})${trialBtnMark}`;
          return { type: it.type, id: it.id, label };
        });
        const { text, entities } = applyMarkdownAndEmoji(bodyLines.join("\n"), config?.botEmojis ?? null);
        await editMessageContent(
          ctx,
          text,
          mySubsListButtons(buttonItems, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
          entities,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("sub:detail:")) {
      // Формат callback_data: sub:detail:<root|secondary>:<id>
      const rest = data.slice("sub:detail:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      // очистка маркера если юзер вернулся в детали подписки
      pendingDropExtras.delete(userId);
      try {
        const result = await api.getAllSubscriptions(token);
        const item = result.items.find((it) => it.type === subType && it.id === subId);
        if (!item) {
          await editMessageContent(
            ctx,
            "❌ Подписка не найдена",
            { inline_keyboard: [[{ text: "← К списку", callback_data: "menu:my_subs" }]] },
          );
          return;
        }
        const idx = item.subscriptionIndex ?? 0;
        const tariff = item.tariffDisplayName || "—";
        // Извлекаем все нужные поля из сырого Remnawave user (через .response/.data wrapper).
        const subData = item.subscription as Record<string, unknown> | null;
        const inner = subData
          ? ((subData.response ?? subData.data ?? subData) as Record<string, unknown>)
          : null;

        // Статус
        const status = (inner?.status ?? inner?.userStatus ?? "ACTIVE") as string;
        const statusLabel =
          status === "ACTIVE" ? "🟢 Активна" :
          status === "EXPIRED" ? "🔴 Истекла" :
          status === "LIMITED" ? "🟡 Ограничена" :
          status === "DISABLED" ? "🔴 Отключена" :
          `🟡 ${status}`;

        // Дата + время + дни
        const expireAtRaw = inner?.expireAt ?? inner?.expire_at;
        let expireDateTimeStr = "";
        let daysLeftStr = "";
        if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
          const expireAt = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
          if (!isNaN(expireAt.getTime())) {
            expireDateTimeStr = expireAt.toLocaleString("ru-RU", {
              day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
            });
            const days = Math.max(0, Math.ceil((expireAt.getTime() - Date.now()) / 86_400_000));
            daysLeftStr = `${days} ${formatDaysRu(days)}`;
          }
        }

        // Устройства: «Устройств: N доступно» (доступно = limit - used).
        const deviceLimit = inner?.hwidDeviceLimit ?? inner?.deviceLimit ?? inner?.device_limit;
        const devicesUsed = inner?.devicesUsed ?? inner?.devices_used;
        let devicesLine = "";
        if (typeof deviceLimit === "number") {
          const available = typeof devicesUsed === "number" ? Math.max(0, deviceLimit - devicesUsed) : deviceLimit;
          devicesLine = `📱 Устройств: ${available} доступно`;
        }

        // Трафик: используется/лимит. Если без лимита — «X.XX GB / ♾».
        const tlimit = inner?.trafficLimitBytes ?? inner?.traffic_limit_bytes;
        const tused = (inner?.userTraffic as { usedTrafficBytes?: number } | undefined)?.usedTrafficBytes
          ?? inner?.trafficUsedBytes ?? inner?.usedTrafficBytes ?? inner?.traffic_used_bytes;
        const limitNum = typeof tlimit === "string" ? parseFloat(tlimit) : Number(tlimit);
        const usedNum = typeof tused === "string" ? parseFloat(tused) : Number(tused);
        const usedGb = bytesToGb(Number.isFinite(usedNum) ? usedNum : 0);
        let trafficLine = `📈 Трафик —  ${usedGb} GB`;
        if (Number.isFinite(limitNum) && limitNum > 0) {
          trafficLine = `📈 Трафик —  ${usedGb} / ${bytesToGb(limitNum)} GB`;
        } else {
          trafficLine = `📈 Трафик —  ${usedGb} GB / ♾`;
        }

        // Ссылка для подключения
        const subUrl = getSubscriptionUrl(item.subscription);

        // T15.4 (11.05.2026): пометка «🎁 Пробная» для подписок, созданных через trial.
        // убрали разделение «Основная/Дополнительная» — после унификации
        // все подписки равные. Триал-метка остаётся (это отдельная семантика, не root/secondary).
        const isTrialSub = !!item.trialId;
        const trialMark = isTrialSub ? "🎁 Пробная" : "";
        const lines = [
          `📲 Подписка #${idx}`,
          "",
        ];
        if (trialMark) lines.push(trialMark);
        lines.push(`💎 Тариф: ${tariff}`);
        lines.push(`📊 Статус подписки — ${statusLabel}`);
        if (expireDateTimeStr) lines.push(`📅 до ${expireDateTimeStr}`);
        if (daysLeftStr) lines.push(`⏰ осталось ${daysLeftStr}`);
        if (devicesLine) lines.push(devicesLine);
        lines.push(trafficLine);
        if (subUrl) {
          lines.push("");
          lines.push("🔗 Ссылка для подключения:");
          lines.push(subUrl);
          // подсказка «если инструкции не открываются»
          // прямо в карточке деталей подписки (sub:detail) — здесь юзер видит ссылку чаще всего.
          lines.push("");
          lines.push(instructionFallbackText(config));
        }
        const text = lines.join("\n");

        // подгружаем tariff.locations чтобы решить —
        // показывать ли кнопку «🌐 Локации» в детали подписки.
        let tariffHasLocations = false;
        if (item.tariffId) {
          try {
            const { items: tariffsByCat } = await api.getPublicTariffs();
            const tariffFull = tariffsByCat?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === item.tariffId);
            tariffHasLocations = !!((tariffFull as TariffItem & { locations?: string | null } | undefined)?.locations?.trim());
          } catch {
            /* ignore — без кнопки локаций */
          }
        }
        await editMessageContent(
          ctx,
          text,
          // пробрасываем tariffId — кнопка «Продлить» откроет оплату
          // СРАЗУ для этого тарифа (без выбора в menu:tariffs).
          // T15.4: пробрасываем isTrialSub → CTA «Конвертировать в платную» вместо «Продлить».
          // пробрасываем subUrl — кнопка «📲 Инструкции по установке»
          // открывает его напрямую (без промежуточного экрана со ссылкой).
          subDetailButtons(subType, subId, backToSubsListLabel(config?.botEmojis ?? null), innerStyles, innerEmojiIds, item.tariffId, tariffHasLocations, isTrialSub, item.autoRenewEnabled === true, subUrl, item.extraDevices ?? 0, item.trialConvertEnabled),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // «🗑 Убрать доп. устройства».
    // Confirm-диалог → removeExtraDevices API → extraDevices=0 + hwid kick в Remna.
    if (data.startsWith("sub:remove_extras:")) {
      const rest = data.slice("sub:remove_extras:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      await editMessageContent(
        ctx,
        "🗑 Убрать все доп. устройства?\n\n" +
        "• С подписки уберутся все докупленные устройства\n" +
        "• Лимит устройств вернётся к базовому (по тарифу)\n" +
        "• Активные «лишние» устройства будут отключены\n" +
        "• Возврата денег НЕТ — устройства отработали свой срок\n\n" +
        "Подтвердить?",
        {
          inline_keyboard: [
            [{ text: "✅ Да, убрать", callback_data: `sub:remove_extras_confirm:${subType}:${subId}` }],
            [{ text: "❌ Отмена", callback_data: `sub:detail:${subType}:${subId}` }],
          ],
        },
      );
      return;
    }
    if (data.startsWith("sub:remove_extras_confirm:")) {
      const rest = data.slice("sub:remove_extras_confirm:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      try {
        const result = await api.removeExtraDevices(token, subType, subId);
        const msg = result.hwidKicked > 0
          ? `🗑 Готово!\n\n• Убрано: ${result.extraDevicesRemoved} устройств\n• Отключено активных: ${result.hwidKicked}\n• Новый лимит: ${result.newDeviceLimit}\n\nПри следующем продлении цена будет без надбавки за устройства.`
          : `🗑 Готово!\n\n• Убрано: ${result.extraDevicesRemoved} устройств\n• Новый лимит: ${result.newDeviceLimit}\n\nПри следующем продлении цена будет без надбавки за устройства.`;
        await editMessageContent(
          ctx,
          msg,
          {
            inline_keyboard: [
              [{ text: "← К подписке", callback_data: `sub:detail:${subType}:${subId}` }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${errMsg}`, {
          inline_keyboard: [[{ text: "← К подписке", callback_data: `sub:detail:${subType}:${subId}` }]],
        });
      }
      return;
    }

    // «🔄 Обновить подписку» — диалог подтверждения.
    // Текст приходит из system_settings.reissue_warning_text (правило №3).
    // toggle автосписания на подписку.
    // Если баланс пустой и юзер пытается включить — backend вернёт ошибку с code=EMPTY_BALANCE.
    if (data.startsWith("sub:autorenew:")) {
      const rest = data.slice("sub:autorenew:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      try {
        // Определяем текущее состояние через /subscription/all → autoRenewEnabled
        const all = await api.getAllSubscriptions(token);
        const item = all.items.find((it) => it.type === subType && it.id === subId);
        const wasEnabled = item?.autoRenewEnabled === true;
        if (wasEnabled) {
          // Просто выключаем без подтверждения.
          await api.toggleSubAutoRenew(token, subType, subId, false);
          await editMessageContent(
            ctx,
            "🛑 Автосписание выключено.\n\nПодписка больше не будет продлеваться автоматически.",
            {
              inline_keyboard: [
                [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }],
                [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
              ],
            },
          );
        } else {
          // Включаем — диалог подтверждения. Текст зависит от наличия YooKassa-recurring.
          const me = await api.getMe(token).catch(() => null);
          const ykCardTitle = me?.yookassaPaymentMethodTitle?.trim();
          const ykRecurringOn = (config as { yookassaRecurringEnabled?: boolean } | null)?.yookassaRecurringEnabled === true;
          const hasYkFallback = ykRecurringOn && !!ykCardTitle;

          // если у клиента есть сохранённая карта YooKassa
          // и в админке включены рекуррентные платежи → предупреждаем что списание может идти с карты.
          let dialogText: string;
          if (hasYkFallback) {
            dialogText = [
              "♻️ Автосписание подписки",
              "",
              "Когда срок этой подписки подойдёт к концу — мы автоматически продлим её. Порядок списания:",
              "",
              "1️⃣ Сначала спишем с **баланса**.",
              `2️⃣ Если на балансе не хватит — недостающую сумму **спишем с вашей сохранённой карты ЮKassa** (${ykCardTitle}).`,
              "",
              "💡 Сохранённая карта была привязана при предыдущей оплате через ЮKassa. Если хотите её отвязать — обратитесь в поддержку.",
              "",
              "❗ Включая автосписание, вы соглашаетесь на регулярные списания с указанной карты согласно условиям оферты.",
              "",
              "Подтвердить включение?",
            ].join("\n");
          } else {
            dialogText = [
              "♻️ Автосписание с баланса",
              "",
              "Когда срок этой подписки подойдёт к концу — мы автоматически продлим её с вашего баланса.",
              "",
              "💡 Если на балансе не будет хватать средств — продление пропустится, мы уведомим вас.",
              "",
              "Подтвердить включение?",
            ].join("\n");
          }

          const { text: msgText, entities: msgEntities } = applyMarkdownAndEmoji(dialogText, config?.botEmojis ?? null);
          await editMessageContent(
            ctx,
            msgText,
            {
              inline_keyboard: [
                [{ text: "✅ Включить", callback_data: `sub:autorenew_confirm:${subType}:${subId}` }],
                [{ text: "❌ Отмена", callback_data: `sub:detail:${subType}:${subId}` }],
              ],
            },
            msgEntities,
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("sub:autorenew_confirm:")) {
      const rest = data.slice("sub:autorenew_confirm:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      try {
        await api.toggleSubAutoRenew(token, subType, subId, true);
        await editMessageContent(
          ctx,
          "✅ Автосписание включено!\n\nПодписка будет автоматически продлеваться с баланса при приближении срока истечения.",
          {
            inline_keyboard: [
              [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        // Если backend вернул EMPTY_BALANCE — показываем предложение пополнить.
        const errMsg = e instanceof Error ? e.message : "Ошибка";
        if (errMsg.includes("EMPTY_BALANCE") || errMsg.includes("Баланс пустой")) {
          await editMessageContent(
            ctx,
            "❌ Баланс пустой\n\nЧтобы включить автосписание — сначала пополните баланс или получите реферальные начисления.",
            {
              inline_keyboard: [
                [{ text: "💳 Пополнить баланс", callback_data: "menu:topup" }],
                [{ text: "👥 Реферальная программа", callback_data: "menu:referral" }],
                [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }],
              ],
            },
          );
        } else {
          await editMessageContent(ctx, `❌ ${errMsg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        }
      }
      return;
    }

    if (data.startsWith("sub:reissue:")) {
      const rest = data.slice("sub:reissue:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      const text = ((config as { reissueWarningText?: string | null })?.reissueWarningText ?? "").trim()
        || "⚠️ Обновление подписки\n\nБот выдаст вам новую подписку с аналогичным сроком действия. Старая перестанет работать.\n\nВы действительно обновить подписку?";
      await editMessageContent(ctx, text, {
        inline_keyboard: [[
          { text: "✅ Да", callback_data: `sub:reissue_confirm:${subType}:${subId}` },
          { text: "❌ Нет", callback_data: `sub:detail:${subType}:${subId}` },
        ]],
      });
      return;
    }

    // T13: подтверждение перевыпуска subscription URL.
    if (data.startsWith("sub:reissue_confirm:")) {
      const rest = data.slice("sub:reissue_confirm:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      try {
        const result = await api.reissueSubscription(token, subType, subId);
        const newUrl = result.subscriptionUrl ?? "—";
        // подсказка «если инструкция не открылась».
        await editMessageContent(ctx, `✅ Подписка обновлена!\n\n🔗 Новая ссылка для подключения:\n${newUrl}\n\nСтарая ссылка больше не работает. Не забудьте заново добавить подписку в приложение.\n\n${instructionFallbackText(config)}`, {
          inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }]],
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка обновления подписки";
        await editMessageContent(ctx, `❌ ${msg}`, {
          inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: `sub:detail:${subType}:${subId}` }]],
        });
      }
      return;
    }

    if (data.startsWith("sub:connect:")) {
      // Формат: sub:connect:<root|secondary>:<id>
      // Для root — берём URL основной подписки (как menu:vpn).
      // Для secondary — переиспользуем gift activation+url flow.
      const rest = data.slice("sub:connect:".length);
      const sep = rest.indexOf(":");
      if (sep === -1) return;
      const subType = rest.slice(0, sep) as "root" | "secondary";
      const subId = rest.slice(sep + 1);
      const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
      const useRemna = config?.useRemnaSubscriptionPage === true;
      // кнопка «К подписке» на экране ссылки подключения
      // ведёт ОБРАТНО в picker «🔌 Подключиться автоматически» (menu:vpn), а не в детали
      // конкретной подписки. Так юзер может быстро выбрать другую подписку для подключения.
      const backCallback = "menu:vpn";
      try {
        let url: string | null = null;
        let webAppPath: string | null = null;
        if (subType === "root") {
          const subRes = await api.getSubscription(token);
          url = getSubscriptionUrl(subRes.subscription);
          webAppPath = appUrl ? `${appUrl}/cabinet/subscribe` : null;
        } else {
          // T17: secondary в Мои подписки уже отфильтрована (purchasedAsGift=false), активация не нужна.
          const giftRes = await api.getGiftSubscriptionUrl(token, subId);
          if (useRemna) {
            const byUuid = await api.getSubscriptionByUuid(token, giftRes.uuid);
            url = getSubscriptionUrl(byUuid.subscription);
          }
          webAppPath = appUrl ? `${appUrl}/cabinet/subscribe?uuid=${encodeURIComponent(giftRes.uuid)}` : null;
        }

        // подсказка «если инструкция не открылась».
        const fallbackSub = instructionFallbackText(config);
        if (useRemna && url) {
          // Remna sub-page включена → отдаём прямую ссылку на неё (URL-кнопкой).
          await editMessageContent(
            ctx,
            `📲 Ссылка на подписку:\n\n${url}\n\n${fallbackSub}`,
            {
              inline_keyboard: [
                [{ text: "📲 Открыть страницу подключения", url }],
                [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }],
              ],
            },
          );
        } else if (webAppPath) {
          await editMessageContent(
            ctx,
            `📲 Подключитесь через мини-приложение:\n\n${fallbackSub}`,
            {
              inline_keyboard: [
                [{ text: "📲 Открыть страницу подключения", web_app: { url: webAppPath } }],
                [{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }],
              ],
            },
          );
        } else if (url) {
          // Нет publicAppUrl и нет Remna sub-page — показываем сырую ссылку.
          await editMessageContent(
            ctx,
            `📲 Ссылка на подписку:\n\n${url}\n\nОткройте её в приложении VPN.\n\n${fallbackSub}`,
            { inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }]] },
          );
        } else {
          await editMessageContent(
            ctx,
            "❌ Не удалось получить ссылку на подписку",
            { inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }]] },
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка получения ссылки";
        await editMessageContent(
          ctx,
          `❌ ${msg}`,
          { inline_keyboard: [[{ text: backToSubLabel(config?.botEmojis ?? null), callback_data: backCallback }]] },
        );
      }
      return;
    }

    // ——— Gift / Secondary Subscriptions handlers ———

    // T11 (11.05.2026, ред. 2): экран «🎁 Подарить подписку».
    // Текст — новый эталонный из system_settings.gift_intro_text (скрин 11),
    // кнопки — оригинальные `giftMenuButtons` (как в бэкапе): купить / активировать / мои подарки / назад.
    // Решение по UX (11.05.2026): «верни кнопки на те, которые были, текст оставь».
    if (data === "menu:gift") {
      if (!config?.giftSubscriptionsEnabled) {
        await editMessageContent(ctx, "Функция подарков недоступна.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const intro = ((config as { giftIntroText?: string | null })?.giftIntroText ?? "").trim()
        || "🎁 Подарки и подписки\n\nЗдесь вы можете купить новые подписки, подарить их или активировать подарок.";
      await editMessageContent(
        ctx,
        intro,
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
      // текст редактируется в админке («Тексты бота» → bot_gift_buy_text);
      // раньше был захардкожен здесь (эталон клиента с описанием тарифов).
      const text = (config?.botGiftBuyText ?? "").trim() || [
        "Выберите тип подписки, которую хотите подарить:",
        "",
        "🚀 Стандартная — стандартная подписка с доступом ко всем локациям",
        "🔓 Unblock — позволяет оставаться на связи в любых ситуациях. Помогает, если у вас в регионе действуют ограничения интернета (отключают интернет), либо локации из обычной подписки уже не спасают.",
        "Есть лимит по трафику",
        "🔓∞ Безлимитный Unblock — Unblock без лимита трафика",
      ].join("\n");
      await editMessageContent(
        ctx,
        text,
        giftTariffButtons(markHasOptions(items), config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
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
      const opts = sortedPriceOptions(tariff.priceOptions);
      // Если опций > 1 — показываем picker длительности.
      if (opts.length > 1) {
        giftOptionsCache.set(userId, { tariffId, options: opts });
        const text = `🎁 ${tariff.name}\n\nВыберите длительность подписки:`;
        // Используем тот же picker длительности что и для основных тарифов, но с другим callback prefix.
        // звёздочка «лучшая цена за день» убрана по запросу клиента.
        const tariffPay = "success" as const;
        const rows: { text: string; callback_data: string }[][] = opts.map((o, idx) => {
          const sym = tariff.currency.toUpperCase() === "RUB" ? "₽" : tariff.currency.toUpperCase() === "USD" ? "$" : tariff.currency;
          return [{ text: `${o.durationDays} дн — ${o.price} ${sym}`.slice(0, 64), callback_data: `gift_topt:${idx}` }];
        });
        rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);
        await editMessageContent(ctx, text, { inline_keyboard: rows.map((r) => r.map((b) => ({ ...b, style: tariffPay }))) } as InlineMarkup);
        return;
      }
      // Одна опция — сохраняем её и идём к picker'у устройств (если включены)
      const onlyOpt = opts[0] ?? null;
      selectedGiftOption.set(userId, { tariffId, option: onlyOpt, extraDevices: 0 });
      if (hasExtraDevices(tariff)) {
        await showGiftDevicePicker(ctx, userId, tariff, onlyOpt, config, innerStyles, innerEmojiIds);
        return;
      }
      // Без опций и без extras — сразу подтверждение оплаты.
      await showGiftPaymentConfirm(ctx, userId, tariff, onlyOpt, 0, config, innerStyles, innerEmojiIds, token);
      return;
    }

    if (data.startsWith("gift_topt:")) {
      const idx = parseInt(data.slice("gift_topt:".length), 10);
      const cache = giftOptionsCache.get(userId);
      if (!cache || !Number.isFinite(idx) || idx < 0 || idx >= cache.options.length) {
        await editMessageContent(ctx, "Сессия истекла. Откройте подарки заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const option = cache.options[idx]!;
      selectedGiftOption.set(userId, { tariffId: cache.tariffId, option, extraDevices: 0 });
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === cache.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      if (hasExtraDevices(tariff)) {
        await showGiftDevicePicker(ctx, userId, tariff, option, config, innerStyles, innerEmojiIds);
        return;
      }
      await showGiftPaymentConfirm(ctx, userId, tariff, option, 0, config, innerStyles, innerEmojiIds, token);
      return;
    }

    if (data.startsWith("gift_tdev:")) {
      const extras = parseInt(data.slice("gift_tdev:".length), 10);
      const sel = selectedGiftOption.get(userId);
      if (!sel || !Number.isFinite(extras) || extras < 0) {
        await editMessageContent(ctx, "Сессия истекла. Откройте подарки заново.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const { items } = await api.getPublicTariffs();
      const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === sel.tariffId);
      if (!tariff) {
        await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
        return;
      }
      const cappedExtras = Math.min(Math.max(0, extras), tariff.maxExtraDevices ?? 0);
      selectedGiftOption.set(userId, { ...sel, extraDevices: cappedExtras });
      await showGiftPaymentConfirm(ctx, userId, tariff, sel.option, cappedExtras, config, innerStyles, innerEmojiIds, token);
      return;
    }

    if (data.startsWith("gift_pay_balance:")) {
      const tariffId = data.slice("gift_pay_balance:".length);
      try {
        const sel = selectedGiftOption.get(userId);
        const tariffPriceOptionId = sel?.tariffId === tariffId ? sel.option?.id : undefined;
        const extraDevices = sel?.tariffId === tariffId ? sel.extraDevices : 0;
        const result = await api.buyGiftSubscription(token, { tariffId, tariffPriceOptionId, extraDevices });
        selectedGiftOption.delete(userId);
        await editMessageContent(
          ctx,
          `✅ Подписка создана!\n\nПодписка #${result.subscriptionIndex}\n\nВы можете активировать её на своём аккаунте или подарить другу.`,
          giftPostPurchaseButtons(result.subscriptionId, result.subscriptionIndex, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка оплаты";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // покупка подарочной через внешние платёжки.
    // Создаём обычный pay_tariff* платёж с флагом asGift=true. Webhook при оплате
    // создаст Subscription с purchasedAsGift=true (попадёт в «🎁 Мои подарки» юзера).
    if (data.startsWith("gift_pay_yookassa:") || data.startsWith("gift_pay_yoomoney:") || data.startsWith("gift_pay_cryptopay:") || data.startsWith("gift_pay_heleket:") || data.startsWith("gift_pay_lava:")) {
      const provider = data.startsWith("gift_pay_yookassa:") ? "yookassa"
        : data.startsWith("gift_pay_yoomoney:") ? "yoomoney"
        : data.startsWith("gift_pay_cryptopay:") ? "cryptopay"
        : data.startsWith("gift_pay_heleket:") ? "heleket"
        : "lava";
      const tariffId = data.slice(data.indexOf(":") + 1);
      try {
        const { items } = await api.getPublicTariffs();
        const tariff = items?.flatMap((c: TariffCategory) => c.tariffs).find((t: TariffItem) => t.id === tariffId);
        if (!tariff) {
          await editMessageContent(ctx, "Тариф не найден.", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        const sel = selectedGiftOption.get(userId);
        const opts = sortedPriceOptions(tariff.priceOptions);
        const eff = sel?.tariffId === tariff.id ? sel.option : (opts.length === 1 ? opts[0]! : null);
        const unitPrice = eff?.price ?? tariff.price;
        const effectiveDays = eff?.durationDays ?? tariff.durationDays;
        const extraDevices = sel?.tariffId === tariff.id ? sel.extraDevices : 0;
        const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
        const effectivePrice = unitPrice + extrasTotal;

        // T-unify: создаём платёж с покупкой подарочной. На бэке metadata.purchasedAsGift=true.
        // Используем тот же flow что обычная asAdditional покупка, но с дополнительным флагом.
        const nameWithDaysGift = `🎁 ${tariff.name} · ${formatRuDays(effectiveDays)} (подарочная)`;
        const renderGiftFinal = async (payUrl: string, receiptSentTo: string | null) => {
          const msg = buildPaymentMessage(config, {
            name: nameWithDaysGift,
            price: formatMoney(effectivePrice, tariff.currency),
            amount: String(effectivePrice),
            currency: tariff.currency,
            action: "Нажмите кнопку ниже для оплаты:",
          });
          const markup = payUrlMarkup(payUrl, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds);
          if (receiptSentTo) {
            await ctx.reply(`${msg.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
          } else {
            await ctx.reply(msg.text, { entities: msg.entities, reply_markup: markup });
          }
        };

        if (provider === "yookassa") {
          // 54-ФЗ-чек prompt только для ЮКассы.
          const meGf = await api.getMe(token);
          const savedEmailGf = meGf?.email ?? null;
          const tokRcptGf = storePendingReceipt({
            userId,
            savedEmail: savedEmailGf,
            builder: (receiptEmail) => api.createYookassaPayment(token, { amount: effectivePrice, currency: "RUB", tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true, receiptEmail }),
            finalize: async (payment, { receiptSentTo }) => {
              selectedGiftOption.delete(userId);
              await renderGiftFinal(payment.confirmationUrl, receiptSentTo);
            },
          });
          await editMessageContent(ctx, receiptPromptText(savedEmailGf), receiptPromptKeyboard(tokRcptGf, savedEmailGf));
          return;
        }

        // Остальные провайдеры — как было (без чека-prompt).
        let payUrl: string | null = null;
        if (provider === "yoomoney") {
          const p = await api.createYoomoneyPayment(token, { amount: effectivePrice, paymentType: "AC", tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.paymentUrl;
        } else if (provider === "cryptopay") {
          const p = await api.createCryptopayPayment(token, { amount: effectivePrice, currency: tariff.currency, tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.payUrl;
        } else if (provider === "heleket") {
          const p = await api.createHeleketPayment(token, { amount: effectivePrice, currency: tariff.currency, tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.payUrl;
        } else {
          const p = await api.createLavaPayment(token, { amount: effectivePrice, currency: "RUB", tariffId: tariff.id, tariffPriceOptionId: eff?.id, deviceCount: extraDevices, asAdditional: true, asGift: true });
          payUrl = p.payUrl;
        }

        selectedGiftOption.delete(userId);

        if (!payUrl) {
          await editMessageContent(ctx, "❌ Не удалось получить ссылку оплаты", backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
          return;
        }
        await renderGiftFinal(payUrl, null);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : "Ошибка создания платежа";
        await editMessageContent(ctx, `❌ ${errMsg}`, backToMenu(config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "gift:subscriptions") {
      try {
        const result = await api.getGiftSubscriptions(token);
        if (!result.subscriptions?.length) {
          await editMessageContent(
            ctx,
            "🎁 Мои подарки\n\nУ вас нет купленных подарочных подписок.\n\nКупите подписку через «🛒 Купить новую подписку» — она появится здесь.",
            giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
          );
          return;
        }
        // «🎁 Мои подарки» — только подписки купленные через gift flow.
        // Для GIFT_RESERVED — кнопки «Показать код» / «Отменить» / «Забрать себе».
        // Для без статуса — «Подарить» / «Удалить» / «Забрать себе».
        await editMessageContent(
          ctx,
          `🎁 Мои подарки\n\nУ вас ${result.subscriptions.length} ${result.subscriptions.length === 1 ? "подарочная подписка" : "подарочных подписок"}:\n\n📌 Если подписка БЕЗ кода:\n• «🎁 Подарить» — создать код для друга\n• «✅ Забрать себе» — перенести в «📋 Мои подписки»\n• «🗑 Удалить» — отменить покупку\n\n📌 Если КОД УЖЕ СОЗДАН (нажмите на подписку):\n• Откроется ссылка на подарок — переслать другу\n• «❌ Отменить код» — снять резерв подарка\n• «✅ Забрать себе» — отменить код и забрать себе`,
          giftSubscriptionButtons(result.subscriptions, config?.botBackLabel ?? null, innerStyles, innerEmojiIds),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // явная кнопка «✅ Забрать себе».
    // Снимает purchasedAsGift и переносит подписку из «🎁 Мои подарки» в «📋 Мои подписки».
    if (data.startsWith("gift:take_self:")) {
      const subscriptionId = data.slice("gift:take_self:".length);
      try {
        await api.activateGiftForSelf(token, subscriptionId);
        await editMessageContent(
          ctx,
          "✅ Подписка перенесена в «📋 Мои подписки»!\n\nТеперь её можно подключить через главное меню → «🔌 Подключиться».",
          {
            inline_keyboard: [
              [{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка переноса";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data.startsWith("gift:connect:")) {
      const subscriptionId = data.slice("gift:connect:".length);
      try {
        // больше НЕ зовём activateGiftForSelf автоматически.
        // Раньше при простом получении URL подарок автоматом «забирался себе» →
        // подписка пропадала из «🎁 Мои подарки» и появлялась в «📋 Мои подписки».
        // Теперь забрать себе можно ТОЛЬКО явной кнопкой «✅ Забрать себе» в gift menu.
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
                [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:gift" }],
              ],
            }
          : giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null);
        await editMessageContent(
          ctx,
          `📲 Ссылка на подписку:\n\n${webUrl ?? `Подписка UUID: ${result.uuid}`}`,
          buttons,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка получения ссылки";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    // noop — заголовок-разделитель в gift list, ничего не делает.
    if (data.startsWith("gift:noop:")) {
      await ctx.answerCallbackQuery({ text: "Используйте кнопки ниже для управления кодом подарка" }).catch(() => {});
      return;
    }

    // «🎁 Показать код» — повторно показать share-UI для уже созданного кода.
    // Грузит активный GiftCode по subId через новый endpoint /gift/active-code/:subId.
    if (data.startsWith("gift:show_code:")) {
      const subscriptionId = data.slice("gift:show_code:".length);
      try {
        const result = await api.getActiveGiftCodeForSubscription(token, subscriptionId);
        const expiresAt = new Date(result.expiresAt).toLocaleDateString("ru-RU");
        const tariffLabel = result.tariffName ? `\nТариф: ${result.tariffName}` : "";
        const botUsername = ctx.me?.username ?? "";
        const giftUrl = botUsername ? `https://t.me/${botUsername}?start=gift_${result.code}` : "";
        // Telegram share API требует `?url=` параметр —
        // без него share-окно не открывается на десктопе и части мобильных клиентов.
        // Ссылка автоматически идёт как preview-карточка сверху. Это нативное поведение TG,
        // изменить порядок невозможно через стандартное share API.
        // новый текст для шеринга подарочной подписки.
        const shareText = `У меня для тебя подарок 🎁\n \nПодписка на сервис безопасного удалённого доступа 🛡 \n\n💡 Нажми на ссылку, чтобы активировать:\n\n${giftUrl}`;
        const shareUrl = giftUrl ? `https://t.me/share/url?url=${encodeURIComponent(giftUrl)}&text=${encodeURIComponent(shareText)}` : "";
        const buttons: (({ text: string; callback_data: string } | { text: string; url: string })[])[] = [];
        if (shareUrl) buttons.push([{ text: "📤 Поделиться в Telegram", url: shareUrl }]);
        // убрана кнопка «🔗 Ссылка на подарок (для пересылки)»
        // по запросу клиента — ссылка уже видна в тексте сообщения, копируется тапом.
        buttons.push([{ text: "❌ Отменить код", callback_data: `gift:cancel_code:${subscriptionId}` }]);
        buttons.push([{ text: backButton(config?.botEmojis ?? null).text, callback_data: "gift:subscriptions" }]);
        await editMessageContent(
          ctx,
          `🎁 Активный подарочный код:\n\nКод: \`${result.code}\`${tariffLabel}\n\n📲 Перешлите получателю эту ссылку — она откроет бота и активирует подписку автоматически:\n${giftUrl}\n\nКод действителен до ${expiresAt}.`,
          { inline_keyboard: buttons },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки кода";
        await editMessageContent(ctx, `❌ ${msg}`, {
          inline_keyboard: [[{ text: "← К подаркам", callback_data: "gift:subscriptions" }]],
        });
      }
      return;
    }

    // «❌ Отменить код» — отменяет активный gift code и снимает GIFT_RESERVED.
    // Подписка возвращается в покупаемое состояние: можно создать новый код / подарить / удалить.
    if (data.startsWith("gift:cancel_code:")) {
      const subscriptionId = data.slice("gift:cancel_code:".length);
      try {
        // Сначала находим активный код по подписке, потом отменяем по нему.
        const codeInfo = await api.getActiveGiftCodeForSubscription(token, subscriptionId);
        await api.cancelGiftCode(token, codeInfo.code);
        await editMessageContent(
          ctx,
          `✅ Подарочный код отменён.\n\nПодписка снова доступна для подарка или активации.`,
          {
            inline_keyboard: [
              [{ text: "🎁 К моим подаркам", callback_data: "gift:subscriptions" }],
              [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
            ],
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка отмены";
        await editMessageContent(ctx, `❌ ${msg}`, {
          inline_keyboard: [[{ text: "← К подаркам", callback_data: "gift:subscriptions" }]],
        });
      }
      return;
    }

    if (data.startsWith("gift:give:")) {
      const subscriptionId = data.slice("gift:give:".length);
      try {
        const result = await api.createGiftCode(token, { subscriptionId: subscriptionId });

        // ссылка teper deep-link в Telegram-бот.
        const botUsername = ctx.me?.username ?? "";
        const giftUrl = botUsername ? `https://t.me/${botUsername}?start=gift_${result.code}` : "";

        // `?url=` обязателен — иначе share не работает на части клиентов.
        // URL всегда идёт превью сверху (нативное поведение TG, не меняется через standard share API).
        // новый текст для шеринга подарочной подписки.
        const shareText = `У меня для тебя подарок 🎁\n \nПодписка на сервис безопасного удалённого доступа 🛡 \n\n💡 Нажми на ссылку, чтобы активировать:\n\n${giftUrl}`;
        const shareUrl = giftUrl
          ? `https://t.me/share/url?url=${encodeURIComponent(giftUrl)}&text=${encodeURIComponent(shareText)}`
          : "";

        const buttons: (({ text: string; callback_data: string } | { text: string; url: string })[])[] = [];
        if (shareUrl) {
          buttons.push([{ text: "📤 Поделиться в Telegram", url: shareUrl }]);
        }
        buttons.push([{ text: "❌ Отменить код", callback_data: `gift:cancel_code:${subscriptionId}` }]);
        buttons.push([{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:gift" }]);

        // два формата текста подарка из ТЗ клиента —
        // 1) Стандартная (без трафика) — формат «Код / Тариф / N дней».
        // 2) Unblock (с трафиком) — формат «N дней, NN GB» + «💡 Чтобы скопировать ссылку, нажмите...».
        const hasTrafficLimit = result.trafficLimitBytes != null && result.trafficLimitBytes > 0;
        const tariffDisplay = result.tariffName ?? "Подписка";
        const trafficGb = hasTrafficLimit ? `${Math.round((result.trafficLimitBytes ?? 0) / 1024 ** 3)} GB` : "";
        const days = result.durationDays ?? 0;
        let msgText: string;
        if (hasTrafficLimit) {
          msgText = `💝 Подарочная ${tariffDisplay} готова!\n\n✅ Оплата прошла успешно.\n📅 ${days} дней, ${trafficGb}\n\n👉 Перешлите ссылку человеку, которому хотите подарить подписку ⬇️\n\n💡 Чтобы скопировать ссылку, нажмите на неё один раз.\n\n${giftUrl}\n\n🎉 При переходе по ссылке подписка автоматически активируется!`;
        } else {
          msgText = `💝 Подарочная подписка готова!\n\n✅ Оплата прошла успешно.\nКод: \`${result.code}\`\nТариф: ${tariffDisplay}\n📅 ${days} дней\n\n👉 Перешлите ссылку человеку, которому хотите подарить подписку ⬇️\n\n${giftUrl}\n\n🎉 При переходе по ссылке подписка автоматически активируется!`;
        }

        await editMessageContent(ctx, msgText, { inline_keyboard: buttons });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка создания кода";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
          giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка удаления";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
      }
      return;
    }

    if (data === "gift:redeem") {
      awaitingGiftCode.add(userId);
      // «← Назад» в gift меню + «🏠 Главное меню».
      await editMessageContent(
        ctx,
        "🎁 Введите подарочный код:",
        {
          inline_keyboard: [
            [{ text: backButton(config?.botEmojis ?? null).text, callback_data: "menu:gift" }],
            [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
          ],
        },
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
            giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
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
          giftCodesListButtons(result.codes, config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
          giftCodeResultButtons(config?.botBackLabel ?? null, innerStyles, innerEmojiIds, config?.botEmojis ?? null),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка отмены";
        await editMessageContent(ctx, `❌ ${msg}`, tariffErrMarkup(e, config, innerStyles?.back, innerEmojiIds));
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
composer.on("message:video", async (ctx) => {
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
composer.on("message:photo", async (ctx) => {
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
composer.on("message:text", async (ctx) => {
  if (ctx.message.text?.startsWith("/")) return;
  const userId = ctx.from?.id;
  if (!userId) return;

  // клиент вводит email для 54-ФЗ-чека ЮКассы.
  if (hasPendingEmailInput(userId)) {
    const raw = ctx.message.text?.trim() ?? "";
    if (!isValidEmail(raw)) {
      await ctx.reply("⚠️ Это не похоже на email. Введите валидный адрес (например, example@mail.com), или нажмите /start для отмены.");
      return;
    }
    const tok = takePendingEmailInput(userId)!;
    const p = takePendingReceipt(tok);
    if (!p) {
      await ctx.reply("⏰ Сессия истекла. Откройте «Оплатить» ещё раз.");
      return;
    }
    try {
      const payment = await p.builder(raw);
      await p.finalize(payment, { receiptSentTo: raw });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка создания платежа ЮKassa";
      await ctx.reply(`❌ ${msg}`);
    }
    return;
  }

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
    const menuKb = { reply_markup: { inline_keyboard: [[{ text: backButton(publicConfig?.botEmojis ?? null).text, callback_data: "menu:gift" }]] } };
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
        ctx.api.sendMessage(result.creatorTelegramId, notifyText).catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка активации подарка";
      await ctx.reply(`❌ ${msg}`, menuKb);
    }
    return;
  }

  // conversation для кастомного пополнения баланса.
  if (awaitingCustomTopup.has(userId)) {
    const raw = ctx.message.text.trim().replace(/[,\s]/g, ".").replace(/[^\d.]/g, "");
    const amount = parseFloat(raw);
    awaitingCustomTopup.delete(userId);
    if (!Number.isFinite(amount) || amount < 50) {
      await ctx.reply("❌ Минимальная сумма — 50 ₽. Попробуйте снова через «💳 Пополнить баланс».", { reply_markup: { inline_keyboard: [[{ text: "💳 Пополнить баланс", callback_data: "menu:topup" }]] } });
      return;
    }
    // Эмулируем callback topup:<amount> чтобы отрисовался стандартный пикер методов.
    const client = await api.getMe(token);
    const cfgT = await api.getPublicConfig().catch(() => null);
    const topupTitle = titleWithEmoji("CARD", `Пополнить баланс на ${formatMoney(amount, client.preferredCurrency)}\n\nВыберите способ оплаты:`, cfgT?.botEmojis);
    await ctx.reply(topupTitle.text, {
      entities: topupTitle.entities?.length ? topupTitle.entities : undefined,
      reply_markup: topupPaymentMethodButtons(
        String(amount),
        cfgT?.plategaMethods ?? [],
        cfgT?.botBackLabel ?? null,
        undefined,
        undefined,
        !!cfgT?.yoomoneyEnabled,
        !!cfgT?.yookassaEnabled,
        !!cfgT?.cryptopayEnabled,
        !!cfgT?.heleketEnabled,
        !!cfgT?.lavaEnabled,
        !!cfgT?.lavatopEnabled,
      ),
    });
    return;
  }

  // conversation для заявки на вывод USDT TRC20.
  // Шаг 1 — пользователь вводит сумму (если в awaitingWithdrawAmount).
  if (awaitingWithdrawAmount.has(userId)) {
    const raw = ctx.message.text.trim().replace(/[,\s]/g, ".").replace(/[^\d.]/g, "");
    const amount = parseFloat(raw);
    // «👥 К рефералке» → «↩️ Отмена» во время ввода данных заявки.
    const backRef = { reply_markup: { inline_keyboard: [[{ text: "↩️ Отмена", callback_data: "menu:referral" }]] } };
    // мин. сумма из настройки (была захардкожена 3000₽).
    const wdCfg = await api.getPublicConfig().catch(() => null);
    const withdrawMin = wdCfg?.withdrawalMinAmount ?? 3000;
    if (!Number.isFinite(amount) || amount < withdrawMin) {
      await ctx.reply(`❌ Минимальная сумма вывода — ${withdrawMin}₽. Введите корректную сумму или нажмите «Отмена».`, backRef);
      return;
    }
    try {
      const me = await api.getMe(token);
      if ((me?.balance ?? 0) < amount) {
        await ctx.reply(`❌ Недостаточно средств. Доступно: ${(me?.balance ?? 0).toFixed(2)}₽`, backRef);
        awaitingWithdrawAmount.delete(userId);
        return;
      }
    } catch {
      // ignore — backend всё равно проверит при создании
    }
    awaitingWithdrawAmount.delete(userId);
    awaitingWithdrawWallet.set(userId, amount);
    await ctx.reply(
      `✅ Сумма: ${amount.toFixed(2)}₽\n\n🏦 Теперь введите ваш кошелёк USDT TRC20 (адрес начинается с T):`,
      backRef,
    );
    return;
  }

  // Шаг 2 — пользователь вводит кошелёк (если есть в awaitingWithdrawWallet).
  if (awaitingWithdrawWallet.has(userId)) {
    const wallet = ctx.message.text.trim();
    const amount = awaitingWithdrawWallet.get(userId)!;
    // «👥 К рефералке» → «↩️ Отмена» во время ввода кошелька.
    const backRef = { reply_markup: { inline_keyboard: [[{ text: "↩️ Отмена", callback_data: "menu:referral" }]] } };
    // Базовая валидация TRC20-адреса (длина 34, начинается с T, base58 алфавит).
    if (!/^T[A-Za-z0-9]{33}$/.test(wallet)) {
      await ctx.reply("❌ Некорректный кошелёк TRC20.\n\nАдрес должен начинаться с буквы T и содержать 34 символа.\nПопробуйте снова:", backRef);
      return;
    }
    awaitingWithdrawWallet.delete(userId);
    const callbackData = `withdraw:confirm:${amount}:${wallet}`.slice(0, 64);
    await ctx.reply(
      `📋 Проверьте заявку на вывод:\n\n💸 Сумма: ${amount.toFixed(2)}₽\n🏦 Кошелёк TRC20: ${wallet}\n\nПодтвердите создание заявки:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Подтвердить", callback_data: callbackData }],
            [{ text: "❌ Отмена", callback_data: "menu:referral" }],
          ],
        },
      },
    );
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

  // Любое прочее текстовое сообщение (в т.ч. просто число) — это НЕ команда и НЕ
  // активный ввод (легитимное пополнение обрабатывается выше через awaitingCustomTopup).
  // Раньше «голое» число 1..1000000 запускало пополнение баланса, из-за чего случайные
  // цифры создавали платёж. Теперь такие сообщения считаются нераспознанными и
  // удаляются (если включён auto-delete) — точно так же, как текст из букв.
  await tryAutoDeleteUnknown(ctx);
});

// Fallback для НЕтекстовых сообщений — стикеры, фото, голосовые, GIF, документы, локации и т.п.
// Сюда не попадают тексты (handler выше) и команды. Если auto-delete включён — удаляем.
composer.on("message", async (ctx) => {
  await tryAutoDeleteUnknown(ctx);
});

// Дожидаемся API чтобы перед стартом получить публичный конфиг и translations.
await waitForApi();

const botInstances: Bot[] = [];
{
  const token = BOT_TOKEN.trim();
  if (!token) {
    throw new Error("BOT_TOKEN не задан в env");
  }
  const b = await createBotWithProxy(token);
  b.use(composer);
  b.catch((err) => console.error(`[Bot ${token.slice(0, 6)}…] error:`, err));
  botInstances.push(b);
}
// start() для long polling не завершается — нельзя await, иначе после старта код не пойдёт дальше.
for (const b of botInstances) {
  const token = b.token;
  void b.start({
    onStart: async (info) => {
      console.log(`Bot @${info.username ?? "?"} started`);
      try {
        const cfg = await api.getPublicConfig();
        if (cfg?.translations) setTranslations(cfg.translations);
      } catch {
        /* ignore */
      }
      // ─── T8: установить меню команд в синей панельке Telegram ───
      // /link и прочие хендлеры остаются работающими, но в меню НЕ выводятся.
      try {
        await b.api.setMyCommands([
          { command: "start", description: "Главное меню" },
          { command: "subscriptions", description: "Моя подписка / инструкции" },
          { command: "referral", description: "Реферальная программа" },
          { command: "support", description: "Поддержка" },
        ]);
      } catch (e) {
        console.error(`[Bot @${info.username}] setMyCommands failed:`, e);
      }
    },
  });
}
