/**
 * Inline-клавиатуры с цветными кнопками (Telegram Bot API: style — primary, success, danger).
 * Эмодзи в тексте кнопок (Unicode).
 */
import { t as _t } from "./i18n.js";

type ButtonStyle = "primary" | "success" | "danger";

interface InlineButton {
  text: string;
  callback_data: string;
  style?: ButtonStyle;
  icon_custom_emoji_id?: string;
}

type WebAppButton = { text: string; web_app: { url: string }; icon_custom_emoji_id?: string; style?: ButtonStyle };
type UrlButton = { text: string; url: string; icon_custom_emoji_id?: string; style?: ButtonStyle };
export type InlineMarkup = { inline_keyboard: (InlineButton | WebAppButton | UrlButton)[][] };

export type BotButtonConfig = { id: string; visible: boolean; label: string; order: number; style?: string; iconCustomEmojiId?: string; onePerRow?: boolean };

// Стрип ведущего unicode-эмодзи (с опциональным VS16, ZWJ-секвенциями и пробелом).
// Когда у кнопки задан `icon_custom_emoji_id`, Telegram рендерит премиум-иконку слева
// от текста, а unicode-эмодзи в лейбле даёт второй значок — двойная иконка. Чтобы избежать
// дублирования, при наличии premium-icon вырезаем ведущий эмодзи из текста.
const LEADING_EMOJI_RE = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u;
function stripLeadingEmoji(text: string): string {
  return text.replace(LEADING_EMOJI_RE, "");
}

function btn(text: string, data: string, style?: ButtonStyle | null, iconCustomEmojiId?: string): InlineButton {
  const finalText = iconCustomEmojiId ? stripLeadingEmoji(text) : text;
  const b: InlineButton = { text: finalText, callback_data: data };
  if (style) b.style = style;
  if (iconCustomEmojiId) b.icon_custom_emoji_id = iconCustomEmojiId;
  return b;
}

function resolveStyle(configured: ButtonStyle | undefined | null, fallback: ButtonStyle): ButtonStyle | undefined {
  if (configured === null) return fallback;
  return configured;
}

const MENU_IDS: Record<string, string> = {
  tariffs: "menu:tariffs",
  proxy: "menu:proxy",
  my_proxy: "menu:my_proxy",
  singbox: "menu:singbox",
  my_singbox: "menu:my_singbox",
  profile: "menu:profile",
  devices: "menu:devices",
  topup: "menu:topup",
  referral: "menu:referral",
  trial: "menu:trial",
  vpn: "menu:vpn",
  support: "menu:support",
  promocode: "menu:promocode",
  extra_options: "menu:extra_options",
  gift: "menu:gift",
  own_bot: "menu:own_bot",
};

const DEFAULT_BUTTONS: BotButtonConfig[] = [
  { id: "tariffs", visible: true, label: "📦 Тарифы", order: 0, style: "success" },
  { id: "proxy", visible: true, label: "🌐 Прокси", order: 0.5, style: "primary" },
  { id: "my_proxy", visible: true, label: "📋 Мои прокси", order: 0.6, style: "primary" },
  { id: "singbox", visible: true, label: "🔑 Доступы", order: 0.55, style: "primary" },
  { id: "my_singbox", visible: true, label: "📋 Мои доступы", order: 0.65, style: "primary" },
  { id: "profile", visible: true, label: "👤 Профиль", order: 1, style: "" },
  { id: "devices", visible: true, label: "📱 Устройства", order: 1.5, style: "primary" },
  { id: "topup", visible: true, label: "💳 Пополнить баланс", order: 2, style: "success" },
  { id: "referral", visible: true, label: "🔗 Реферальная программа", order: 3, style: "primary" },
  { id: "trial", visible: true, label: "🎁 Бесплатный Тест", order: 4, style: "success" },
  { id: "vpn", visible: true, label: "🌐 Подключиться к VPN", order: 5, style: "danger", onePerRow: true },
  { id: "cabinet", visible: true, label: "🌐 Web Кабинет", order: 6, style: "primary" },
  { id: "tickets", visible: true, label: "🎫 Тикеты", order: 6.5, style: "primary" },
  { id: "own_bot", visible: true, label: "🤖 Свой бот", order: 6.52, style: "primary", onePerRow: true },
  { id: "support", visible: true, label: "🆘 Поддержка", order: 7, style: "primary" },
  { id: "promocode", visible: true, label: "🎟️ Промокод", order: 8, style: "primary" },
  { id: "gift", visible: true, label: "🎁 Подарки", order: 8.5, style: "primary" },
  { id: "extra_options", visible: true, label: "➕ Доп. опции", order: 9, style: "primary" },
];

function toStyle(s: string | undefined): ButtonStyle | undefined | null {
  if (s === "primary" || s === "success" || s === "danger") return s;
  if (s === "") return undefined;
  return null;
}

export type InnerButtonStyles = {
  tariffPay?: string;
  topup?: string;
  back?: string;
  profile?: string;
  trialConfirm?: string;
  lang?: string;
  currency?: string;
};

/** ID премиум-эмодзи для внутренних кнопок (из botEmojis: BACK, CARD, PACKAGE, TRIAL, PUZZLE, SERVERS) */
export type InnerEmojiIds = {
  back?: string;
  card?: string;
  tariff?: string;
  trial?: string;
  profile?: string;
  connect?: string;
};

/** Главное меню: кнопки из конфига. Эмодзи в label (Unicode) и/или icon_custom_emoji_id (премиум). Поддержка показывается только если задана хотя бы одна ссылка. Тикеты — Web App при включённой тикет-системе. buttonsPerRow: 1 или 2. */
export function mainMenu(opts: {
  showTrial: boolean;
  showVpn: boolean;
  showProxy?: boolean;
  showSingbox?: boolean;
  appUrl: string | null;
  botButtons?: BotButtonConfig[] | null;
  botBackLabel?: string | null;
  hasSupportLinks?: boolean;
  showTickets?: boolean;
  showExtraOptions?: boolean;
  showGift?: boolean;
  /** Кнопок в ряд: 1 или 2 (по умолчанию 1) */
  buttonsPerRow?: 1 | 2;
  /** URL страницы подписки Remna (если задан — кнопка VPN ведёт туда) */
  remnaSubscriptionUrl?: string | null;
}): InlineMarkup {
  const configButtons = opts.botButtons ?? [];
  const fromConfig = configButtons.length > 0;
  let list = fromConfig ? [...configButtons] : [...DEFAULT_BUTTONS];
  if (fromConfig && !list.some((b) => b.id === "devices")) {
    list.push({ id: "devices", visible: true, label: "📱 Устройства", order: 1.5, style: "primary" });
  }
  if (fromConfig && opts.showGift === true && !list.some((b) => b.id === "gift")) {
    list.push({ id: "gift", visible: true, label: "🎁 Подарки", order: 8.5, style: "primary" });
  }
  if (fromConfig && opts.showTickets === true && !!opts.appUrl?.trim() && !list.some((b) => b.id === "own_bot")) {
    list.push({ id: "own_bot", visible: true, label: "🤖 Свой бот", order: 6.52, style: "primary", onePerRow: true });
  }
  list = list
    .filter((b) => b.visible)
    .filter((b) => {
      if (b.id === "trial") return opts.showTrial;
      if (b.id === "vpn") return opts.showVpn;
      if (b.id === "proxy" || b.id === "my_proxy") return opts.showProxy === true;
      if (b.id === "singbox" || b.id === "my_singbox") return opts.showSingbox === true;
      if (b.id === "cabinet") return !!opts.appUrl?.trim();
      if (b.id === "tickets") return opts.showTickets === true && !!opts.appUrl?.trim();
      if (b.id === "own_bot") return opts.showTickets === true && !!opts.appUrl?.trim();
      if (b.id === "support") return !!opts.hasSupportLinks;
      if (b.id === "extra_options") return opts.showExtraOptions === true;
      if (b.id === "gift") return opts.showGift === true;
      return true;
    })
    .sort((a, b) => a.order - b.order);
  const base = opts.appUrl?.replace(/\/$/, "") ?? "";
  const perRow = opts.buttonsPerRow === 2 ? 2 : 1;
  const items: { node: InlineButton | WebAppButton | UrlButton; onePerRow: boolean }[] = [];
  for (const b of list) {
    const iconId = b.iconCustomEmojiId;
    const onePerRow = b.onePerRow === true;
    const labelForIcon = iconId ? stripLeadingEmoji(b.label) : b.label;
    // Стиль (primary/success/danger) для всех типов кнопок — в т.ч. web_app/url.
    // Telegram Bot API игнорирует поле для не-callback кнопок, но мы передаём
    // его на случай поддержки в будущих версиях клиента.
    const styleForBtn = toStyle(b.style);
    if (b.id === "cabinet") {
      if (base) {
        const w: WebAppButton = { text: labelForIcon, web_app: { url: `${base}/cabinet` } };
        if (iconId) w.icon_custom_emoji_id = iconId;
        if (styleForBtn) w.style = styleForBtn;
        items.push({ node: w, onePerRow });
      }
    } else     if (b.id === "vpn" && (opts.remnaSubscriptionUrl || base)) {
      if (opts.remnaSubscriptionUrl) {
        const u: UrlButton = { text: labelForIcon, url: opts.remnaSubscriptionUrl };
        if (iconId) u.icon_custom_emoji_id = iconId;
        if (styleForBtn) u.style = styleForBtn;
        items.push({ node: u, onePerRow });
      } else {
        const w: WebAppButton = { text: labelForIcon, web_app: { url: `${base}/cabinet/subscribe` } };
        if (iconId) w.icon_custom_emoji_id = iconId;
        if (styleForBtn) w.style = styleForBtn;
        items.push({ node: w, onePerRow });
      }
    } else if (b.id === "tickets" && base) {
      const w: WebAppButton = { text: labelForIcon, web_app: { url: `${base}/cabinet/tickets` } };
      if (iconId) w.icon_custom_emoji_id = iconId;
      if (styleForBtn) w.style = styleForBtn;
      items.push({ node: w, onePerRow });
    } else if (MENU_IDS[b.id]) {
      items.push({ node: btn(b.label, MENU_IDS[b.id], styleForBtn, iconId), onePerRow });
    }
  }
  const rows: (InlineButton | WebAppButton | UrlButton)[][] = [];
  let currentRow: (InlineButton | WebAppButton | UrlButton)[] = [];
  for (const { node, onePerRow } of items) {
    if (onePerRow) {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      rows.push([node]);
    } else {
      currentRow.push(node);
      if (currentRow.length >= perRow) {
        rows.push(currentRow);
        currentRow = [];
      }
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return { inline_keyboard: rows };
}

const DEFAULT_BACK_LABEL = "◀️ В меню";

/** Меню «Поддержка»: 4 кнопки-ссылки (только с заданным URL) + «В меню». */
export function supportSubMenu(
  links: { support?: string | null; agreement?: string | null; offer?: string | null; instructions?: string | null; hasVideoInstructions?: boolean },
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds,
  lang = "ru"
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || _t("back_to_menu", lang);
  const backSty = resolveStyle(toStyle(backStyle), "danger");
  const rows: (InlineButton | UrlButton)[][] = [];
  const items: [string, string | null | undefined][] = [
    [_t("support.btn_tech", lang), links.support],
    [_t("support.btn_agreement", lang), links.agreement],
    [_t("support.btn_offer", lang), links.offer],
    [_t("support.btn_instructions", lang), links.instructions],
  ];
  for (const [label, url] of items) {
    const u = (url ?? "").trim();
    if (u) rows.push([{ text: label, url: u }]);
  }
  if (links.hasVideoInstructions) {
    rows.push([btn(_t("support.btn_video_instructions", lang), "menu:video_instructions", undefined, undefined)]);
  }
  rows.push([btn(back, "menu:main", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

export function backToMenu(backLabel?: string | null, backStyle?: string, emojiIds?: InnerEmojiIds, lang = "ru"): InlineMarkup {
  const text = (backLabel && backLabel.trim()) || _t("back_to_menu", lang);
  return { inline_keyboard: [[btn(text, "menu:main", resolveStyle(toStyle(backStyle), "danger"), emojiIds?.back)]] };
}

/** Кнопка «Оплатить» (открывает paymentUrl) + «В меню» */
export function payUrlMarkup(
  paymentUrl: string,
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = undefined;
  const payBtn: UrlButton = { text: "💳 Оплатить", url: paymentUrl };
  if (emojiIds?.card) payBtn.icon_custom_emoji_id = emojiIds.card;
  return {
    inline_keyboard: [
      [payBtn],
      [btn(back, "menu:main", backSty, emojiIds?.back)],
    ],
  };
}

export function openSubscribePageMarkup(appUrl: string, backLabel?: string | null, backStyle?: string, emojiIds?: InnerEmojiIds, remnaSubscriptionUrl?: string | null): InlineMarkup {
  const base = appUrl.replace(/\/$/, "");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  if (remnaSubscriptionUrl) {
    const connectBtn: UrlButton = { text: "📲 Открыть страницу подключения", url: remnaSubscriptionUrl };
    if (emojiIds?.connect) connectBtn.icon_custom_emoji_id = emojiIds.connect;
    return {
      inline_keyboard: [
        [connectBtn],
        [btn(back, "menu:main", resolveStyle(toStyle(backStyle), "danger"), emojiIds?.back)],
      ],
    };
  }
  const connectBtn: WebAppButton = { text: "📲 Открыть страницу подключения", web_app: { url: `${base}/cabinet/subscribe` } };
  if (emojiIds?.connect) connectBtn.icon_custom_emoji_id = emojiIds.connect;
  return {
    inline_keyboard: [
      [connectBtn],
      [btn(back, "menu:main", resolveStyle(toStyle(backStyle), "danger"), emojiIds?.back)],
    ],
  };
}

export function topUpPresets(currency: string, backLabel?: string | null, innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds): InlineMarkup {
  const sym = currency.toUpperCase() === "RUB" ? "₽" : currency.toUpperCase() === "USD" ? "$" : "₴";
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const topup = resolveStyle(toStyle(innerStyles?.topup), "primary");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const cardId = emojiIds?.card;
  return {
    inline_keyboard: [
      [
        btn(`${sym} 100`, "topup:100", topup, cardId),
        btn(`${sym} 300`, "topup:300", topup, cardId),
        btn(`${sym} 500`, "topup:500", topup, cardId),
      ],
      [
        btn(`${sym} 1000`, "topup:1000", topup, cardId),
        btn(`${sym} 2000`, "topup:2000", topup, cardId),
      ],
      [btn(back, "menu:main", backSty, emojiIds?.back)],
    ],
  };
}

/** Кнопки категорий тарифов (первый экран при нескольких категориях). Только эмодзи категории (ordinary/premium), без общего эмодзи «Тарифы». */
export function tariffCategoryButtons(
  categories: { id: string; name: string; emoji?: string }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds,
  _prefixEmoji?: string
): InlineMarkup {
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const tariffId = emojiIds?.tariff;
  const rows: InlineButton[][] = categories.map((cat) => {
    const label = ((cat.emoji && cat.emoji.trim()) ? `${cat.emoji} ` : "") + (cat.name || "").trim();
    return [btn(label.slice(0, 64), `cat_tariffs:${cat.id}`, tariffPay, tariffId)];
  });
  rows.push([btn(back, "menu:main", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки тарифов одной категории. Только эмодзи категории (ordinary/premium), без общего эмодзи «Тарифы». */
export function tariffsOfCategoryButtons(
  category: { name: string; emoji?: string; tariffs: { id: string; name: string; price: number; currency: string; hasOptions?: boolean; priceOptions?: { price: number; durationDays: number }[] }[] },
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  backData: string = "menu:tariffs",
  emojiIds?: InnerEmojiIds,
  _prefixEmoji?: string
): InlineMarkup {
  const rows: InlineButton[][] = [];
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const prefix = (category.emoji && category.emoji.trim()) ? `${category.emoji} ` : "";
  const tariffId = emojiIds?.tariff;
  for (const t of category.tariffs) {
    const opts = t.priceOptions;
    const minPrice = t.hasOptions && opts?.length
      ? opts.reduce((m, o) => (o.price < m ? o.price : m), opts[0]!.price)
      : t.price;
    const label = t.hasOptions
      ? `${prefix}${t.name} от ${minPrice} ${currencySymbol(t.currency)}`.slice(0, 64)
      : `${prefix}${t.name} — ${minPrice} ${currencySymbol(t.currency)}`.slice(0, 64);
    rows.push([btn(label, `pay_tariff:${t.id}`, tariffPay, tariffId)]);
  }
  rows.push([btn(back, backData, backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Все тарифы списком (одна категория — без экрана выбора категории) */
export function tariffPayButtons(
  categories: {
    id: string;
    name: string;
    emoji?: string;
    tariffs: { id: string; name: string; price: number; currency: string; hasOptions?: boolean }[];
  }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds,
  prefixEmoji?: string
): InlineMarkup {
  if (categories.length === 0) {
    const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
    const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
    return { inline_keyboard: [[btn(back, "menu:main", backSty, emojiIds?.back)]] };
  }
  if (categories.length === 1) {
    return tariffsOfCategoryButtons(categories[0]!, backLabel, innerStyles, "menu:main", emojiIds, prefixEmoji);
  }
  return tariffCategoryButtons(categories, backLabel, innerStyles, emojiIds, prefixEmoji);
}

/**
 * Кнопки выбора опции цены тарифа (когда у тарифа несколько priceOptions).
 * callback_data: `topt:<idx>` — индекс в кэше options для пользователя.
 * Опция с лучшей ценой за день помечается эмодзи 🌟.
 */
export function tariffOptionPickerButtons(
  options: { id: string; durationDays: number; price: number }[],
  currency: string,
  bestId: string | null,
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds,
): InlineMarkup {
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const tariffId = emojiIds?.tariff;
  const sym = currencySymbol(currency);
  const rows: InlineButton[][] = options.map((o, idx) => {
    const star = bestId && o.id === bestId ? "🌟 " : "";
    const label = `${star}${o.durationDays} дн — ${o.price} ${sym}`.slice(0, 64);
    return [btn(label, `topt:${idx}`, tariffPay, tariffId)];
  });
  rows.push([btn(back, "menu:tariffs", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/**
 * Символ валюты для коротких inline-лейблов кнопок (₽/$/₴).
 * formatMoney() в index.ts даёт то же поведение, но для лейблов кнопок проще inline.
 */
function currencySymbol(currency: string): string {
  const c = currency.toUpperCase();
  return c === "RUB" ? "₽" : c === "USD" ? "$" : c === "UAH" ? "₴" : c;
}

/**
 * Шаг 2: выбор количества ДОП. устройств (extras). Показывается после выбора длительности
 * (topt:), только если у тарифа включены доп. устройства.
 *
 * Каждая плитка — кнопка с текстом "+N · {total} {sym} [discount?]".
 * Плитка «+0» — без доп. устройств, базовая цена тарифа.
 * callback_data: `tdev:<N>` — N = количество ДОП. устройств (0..maxExtras).
 *
 * Скидочные плитки выделяются эмодзи 🎁; лучшая цена за устройство — ⭐.
 */
export function tariffDevicePickerButtons(
  tiles: { extras: number; included: number; total: number; pct: number; isBest: boolean }[],
  currency: string,
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds,
): InlineMarkup {
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const tariffId = emojiIds?.tariff;
  const sym = currencySymbol(currency);
  // По 2 плитки в ряд для удобства на мобиле.
  const rows: InlineButton[][] = [];
  let row: InlineButton[] = [];
  for (const t of tiles) {
    const badge = t.pct > 0 ? ` 🎁−${t.pct}%` : t.isBest ? " ⭐" : "";
    // Префикс: «Без доп.» для +0, иначе «+N устр».
    const prefix = t.extras === 0 ? "Без доп." : `+${t.extras} устр`;
    const label = `${prefix} · ${t.total} ${sym}${badge}`.slice(0, 64);
    row.push(btn(label, `tdev:${t.extras}`, tariffPay, tariffId));
    if (row.length >= 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) rows.push(row);
  rows.push([btn(back, "menu:tariffs", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки выбора способа оплаты (СБП, Карты и т.д. из админки) для тарифа + баланс + ЮMoney */
export function tariffPaymentMethodButtons(
  tariffId: string,
  methods: { id: number; label: string }[],
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds,
  balanceLabel?: string | null,
  yoomoneyEnabled?: boolean,
  yookassaEnabled?: boolean,
  cryptopayEnabled?: boolean,
  tariffCurrency?: string,
  heleketEnabled?: boolean,
  lavaEnabled?: boolean,
  lavatopEnabled?: boolean,
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = undefined;
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = [];
  // Кнопка оплаты балансом (первая)
  if (balanceLabel) {
    rows.push([btn(balanceLabel, `pay_tariff_balance:${tariffId}`, undefined, cardId)]);
  }
  // ЮMoney — только для рублёвых тарифов
  if (yoomoneyEnabled && (!tariffCurrency || tariffCurrency.toUpperCase() === "RUB")) {
    rows.push([btn("💳 ЮMoney — оплата картой", `pay_tariff_yoomoney:${tariffId}`, undefined, cardId)]);
  }
  // ЮKassa — только RUB
  if (yookassaEnabled && (!tariffCurrency || tariffCurrency.toUpperCase() === "RUB")) {
    rows.push([btn("💳 ЮKassa — карта / СБП", `pay_tariff_yookassa:${tariffId}`, undefined, cardId)]);
  }
  // LAVA Business — только RUB (СБП / Карты / СберPay)
  if (lavaEnabled && (!tariffCurrency || tariffCurrency.toUpperCase() === "RUB")) {
    rows.push([btn("💳 Lava — СБП / Карты", `pay_tariff_lava:${tariffId}`, undefined, cardId)]);
  }
  // Lava.top — RUB / USD / EUR через product/offer модель
  if (lavatopEnabled) {
    rows.push([btn("💳 Lava.top — СБП / Карты", `pay_tariff_lavatop:${tariffId}`, undefined, cardId)]);
  }
  if (cryptopayEnabled) {
    rows.push([btn("💳 Crypto Bot — криптовалюта", `pay_tariff_cryptopay:${tariffId}`, undefined, cardId)]);
  }
  if (heleketEnabled) {
    rows.push([btn("💳 Heleket — криптовалюта", `pay_tariff_heleket:${tariffId}`, undefined, cardId)]);
  }
  for (const m of methods) {
    rows.push([btn(m.label, `pay_tariff:${tariffId}:${m.id}`, undefined, cardId)]);
  }
  rows.push([btn(back, "menu:tariffs", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки категорий прокси (аналогично тарифам) */
export function proxyCategoryButtons(
  categories: { id: string; name: string; tariffs: { id: string; name: string; price: number; currency: string; hasOptions?: boolean }[] }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const tariffId = emojiIds?.tariff;
  const rows: InlineButton[][] = categories.map((cat) => {
    const label = cat.name.slice(0, 64);
    return [btn(label, `cat_proxy:${cat.id}`, tariffPay, tariffId)];
  });
  rows.push([btn(back, "menu:main", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки тарифов прокси одной категории */
export function proxyTariffsOfCategoryButtons(
  category: { name: string; tariffs: { id: string; name: string; price: number; currency: string; hasOptions?: boolean }[] },
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  backData = "menu:proxy",
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const rows: InlineButton[][] = [];
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const tariffId = emojiIds?.tariff;
  for (const t of category.tariffs) {
    rows.push([btn(`${t.name} — ${t.price} ${currencySymbol(t.currency)}`.slice(0, 64), `pay_proxy:${t.id}`, tariffPay, tariffId)]);
  }
  rows.push([btn(back, backData, backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки прокси-тарифов (категории или список тарифов) */
export function proxyTariffPayButtons(
  categories: { id: string; name: string; tariffs: { id: string; name: string; price: number; currency: string; hasOptions?: boolean }[] }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  if (categories.length === 0) return { inline_keyboard: [[btn(back, "menu:main", backSty, emojiIds?.back)]] };
  if (categories.length === 1 && categories[0]!.tariffs.length <= 5) {
    return proxyTariffsOfCategoryButtons(categories[0]!, backLabel, innerStyles, "menu:main", emojiIds);
  }
  return proxyCategoryButtons(categories, backLabel, innerStyles, emojiIds);
}

/** Кнопки способа оплаты для прокси-тарифа */
export function proxyPaymentMethodButtons(
  proxyTariffId: string,
  methods: { id: number; label: string }[],
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds,
  balanceLabel?: string | null,
  yoomoneyEnabled?: boolean,
  yookassaEnabled?: boolean,
  cryptopayEnabled?: boolean,
  currency?: string,
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = undefined;
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = [];
  if (balanceLabel) rows.push([btn(balanceLabel, `pay_proxy_balance:${proxyTariffId}`, undefined, cardId)]);
  if (yoomoneyEnabled && (!currency || currency.toUpperCase() === "RUB")) {
    rows.push([btn("💳 ЮMoney — карта", `pay_proxy_yoomoney:${proxyTariffId}`, undefined, cardId)]);
  }
  if (yookassaEnabled && (!currency || currency.toUpperCase() === "RUB")) {
    rows.push([btn("💳 ЮKassa — карта / СБП", `pay_proxy_yookassa:${proxyTariffId}`, undefined, cardId)]);
  }
  if (cryptopayEnabled) rows.push([btn("💳 Crypto Bot — криптовалюта", `pay_proxy_cryptopay:${proxyTariffId}`, undefined, cardId)]);
  for (const m of methods) {
    rows.push([btn(m.label, `pay_proxy:${proxyTariffId}:${m.id}`, undefined, cardId)]);
  }
  rows.push([btn(back, "menu:proxy", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки категорий Sing-box (доступы) */
export function singboxCategoryButtons(
  categories: { id: string; name: string; tariffs: { id: string; name: string; price: number; currency: string; hasOptions?: boolean }[] }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const tariffId = emojiIds?.tariff;
  const rows: InlineButton[][] = categories.map((cat) => {
    const label = cat.name.slice(0, 64);
    return [btn(label, `cat_singbox:${cat.id}`, tariffPay, tariffId)];
  });
  rows.push([btn(back, "menu:main", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки тарифов Sing-box одной категории */
export function singboxTariffsOfCategoryButtons(
  category: { name: string; tariffs: { id: string; name: string; price: number; currency: string; hasOptions?: boolean }[] },
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  backData = "menu:singbox",
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const rows: InlineButton[][] = [];
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const tariffId = emojiIds?.tariff;
  for (const t of category.tariffs) {
    rows.push([btn(`${t.name} — ${t.price} ${currencySymbol(t.currency)}`.slice(0, 64), `pay_singbox:${t.id}`, tariffPay, tariffId)]);
  }
  rows.push([btn(back, backData, backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки тарифов Sing-box (категории или список) */
export function singboxTariffPayButtons(
  categories: { id: string; name: string; tariffs: { id: string; name: string; price: number; currency: string; hasOptions?: boolean }[] }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  if (categories.length === 0) return { inline_keyboard: [[btn(back, "menu:main", backSty, emojiIds?.back)]] };
  if (categories.length === 1 && categories[0]!.tariffs.length <= 5) {
    return singboxTariffsOfCategoryButtons(categories[0]!, backLabel, innerStyles, "menu:main", emojiIds);
  }
  return singboxCategoryButtons(categories, backLabel, innerStyles, emojiIds);
}

/** Кнопки способа оплаты для тарифа Sing-box */
export function singboxPaymentMethodButtons(
  singboxTariffId: string,
  methods: { id: number; label: string }[],
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds,
  balanceLabel?: string | null,
  yoomoneyEnabled?: boolean,
  yookassaEnabled?: boolean,
  cryptopayEnabled?: boolean,
  currency?: string,
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = undefined;
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = [];
  if (balanceLabel) rows.push([btn(balanceLabel, `pay_singbox_balance:${singboxTariffId}`, undefined, cardId)]);
  if (yoomoneyEnabled && (!currency || currency.toUpperCase() === "RUB")) {
    rows.push([btn("💳 ЮMoney — карта", `pay_singbox_yoomoney:${singboxTariffId}`, undefined, cardId)]);
  }
  if (yookassaEnabled && (!currency || currency.toUpperCase() === "RUB")) {
    rows.push([btn("💳 ЮKassa — карта / СБП", `pay_singbox_yookassa:${singboxTariffId}`, undefined, cardId)]);
  }
  if (cryptopayEnabled) rows.push([btn("💳 Crypto Bot — криптовалюта", `pay_singbox_cryptopay:${singboxTariffId}`, undefined, cardId)]);
  for (const m of methods) {
    rows.push([btn(m.label, `pay_singbox:${singboxTariffId}:${m.id}`, undefined, cardId)]);
  }
  rows.push([btn(back, "menu:singbox", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки выбора способа оплаты для пополнения на сумму + ЮMoney */
export function topupPaymentMethodButtons(
  amount: string,
  methods: { id: number; label: string }[],
  backLabel?: string | null,
  backStyle?: string,
  emojiIds?: InnerEmojiIds,
  yoomoneyEnabled?: boolean,
  yookassaEnabled?: boolean,
  cryptopayEnabled?: boolean,
  heleketEnabled?: boolean,
  lavaEnabled?: boolean,
  lavatopEnabled?: boolean,
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(backStyle), "danger");
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = [];
  if (yoomoneyEnabled) {
    rows.push([btn("💳 ЮMoney — оплата картой", `topup_yoomoney:${amount}`, "primary", cardId)]);
  }
  if (yookassaEnabled) {
    rows.push([btn("💳 ЮKassa — карта / СБП", `topup_yookassa:${amount}`, "primary", cardId)]);
  }
  if (lavaEnabled) {
    rows.push([btn("💳 Lava — СБП / Карты", `topup_lava:${amount}`, "primary", cardId)]);
  }
  // Lava.top — только для тарифов (subscription mode), не для топ-апа баланса.
  // Параметр lavatopEnabled оставлен в сигнатуре для обратной совместимости.
  void lavatopEnabled;
  if (cryptopayEnabled) {
    rows.push([btn("💳 Crypto Bot — криптовалюта", `topup_cryptopay:${amount}`, "primary", cardId)]);
  }
  if (heleketEnabled) {
    rows.push([btn("💳 Heleket — криптовалюта", `topup_heleket:${amount}`, "primary", cardId)]);
  }
  for (const m of methods) {
    rows.push([btn(m.label, `topup:${amount}:${m.id}`, "primary", cardId)]);
  }
  rows.push([btn(back, "menu:topup", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

type SellOptionItem =
  | { kind: "traffic"; id: string; name: string; trafficGb: number; price: number; currency: string }
  | { kind: "devices"; id: string; name: string; deviceCount: number; price: number; currency: string }
  | { kind: "servers"; id: string; name: string; squadUuid: string; trafficGb?: number; price: number; currency: string };

/** Кнопки списка доп. опций (трафик, устройства, серверы). */
export function extraOptionsButtons(
  options: SellOptionItem[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = options.map((o) => {
    const extra = o.kind === "servers" && (o.trafficGb ?? 0) > 0 ? ` + ${o.trafficGb} ГБ` : "";
    const label = `${o.name || o.kind}${extra} — ${o.price} ${currencySymbol(o.currency)}`.slice(0, 64);
    return [btn(label, `pay_option:${o.kind}:${o.id}`, "success", cardId)];
  });
  rows.push([btn(back, "menu:main", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки выбора способа оплаты опции: баланс, ЮMoney, ЮKassa, Platega. */
export function optionPaymentMethodButtons(
  option: SellOptionItem,
  balance: number,
  backLabel: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds,
  plategaMethods: { id: number; label: string }[] = [],
  yoomoneyEnabled?: boolean,
  yookassaEnabled?: boolean,
  cryptopayEnabled?: boolean,
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = undefined;
  const cardId = emojiIds?.card;
  const rows: InlineButton[][] = [];
  if (balance >= option.price) {
    rows.push([btn(`💰 Оплатить балансом (${option.price} ₽)`, `pay_option_balance:${option.kind}:${option.id}`, undefined, cardId)]);
  }
  if (yoomoneyEnabled) {
    rows.push([btn("💳 ЮMoney — карта", `pay_option_yoomoney:${option.kind}:${option.id}`, undefined, cardId)]);
  }
  if (yookassaEnabled !== false) {
    rows.push([btn("💳 ЮKassa — карта / СБП", `pay_option_yookassa:${option.kind}:${option.id}`, undefined, cardId)]);
  }
  if (cryptopayEnabled) {
    rows.push([btn("💳 Crypto Bot — криптовалюта", `pay_option_cryptopay:${option.kind}:${option.id}`, undefined, cardId)]);
  }
  for (const m of plategaMethods) {
    rows.push([btn(m.label, `pay_option_platega:${option.kind}:${option.id}:${m.id}`, undefined, cardId)]);
  }
  if (rows.length === 0) {
    rows.push([btn("💳 Оплата (ЮKassa)", `pay_option_yookassa:${option.kind}:${option.id}`, undefined, cardId)]);
  }
  rows.push([btn(back, "menu:extra_options", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

export function profileButtons(backLabel?: string | null, innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds, autoRenewEnabled?: boolean, lang = "ru"): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || _t("back_to_menu", lang);
  const profile = resolveStyle(toStyle(innerStyles?.profile), "primary");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const profileId = emojiIds?.profile;
  const autoRenewText = autoRenewEnabled ? _t("profile.btn_autorenew_on", lang) : _t("profile.btn_autorenew_off", lang);
  const autoRenewData = autoRenewEnabled ? "profile:autorenew:off" : "profile:autorenew:on";
  return {
    inline_keyboard: [
      [btn(autoRenewText, autoRenewData, profile, profileId)],
      [btn(_t("profile.btn_lang", lang), "profile:lang", profile, profileId), btn(_t("profile.btn_currency", lang), "profile:currency", profile, profileId)],
      [btn(back, "menu:main", backSty, emojiIds?.back)],
    ],
  };
}

export function langButtons(langs: string[], innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds, lang = "ru"): InlineMarkup {
  const langStyle = resolveStyle(toStyle(innerStyles?.lang), "primary");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const row: InlineButton[] = langs.slice(0, 3).map((l) => btn(l.toUpperCase(), `set_lang:${l}`, langStyle));
  return { inline_keyboard: [row, [btn(_t("back", lang), "menu:profile", backSty, emojiIds?.back)]] };
}

export function currencyButtons(currencies: string[], innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds, lang = "ru"): InlineMarkup {
  const currencyStyle = resolveStyle(toStyle(innerStyles?.currency), "primary");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const row: InlineButton[] = currencies.slice(0, 3).map((c) => btn(c.toUpperCase(), `set_currency:${c}`, currencyStyle));
  return { inline_keyboard: [row, [btn(_t("back", lang), "menu:profile", backSty, emojiIds?.back)]] };
}

export function trialConfirmButton(innerStyles?: InnerButtonStyles, emojiIds?: InnerEmojiIds, lang = "ru"): InlineMarkup {
  const trialConfirm = resolveStyle(toStyle(innerStyles?.trialConfirm), "success");
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  return {
    inline_keyboard: [
      [btn(_t("menu.btn_trial", lang), "trial:confirm", trialConfirm, emojiIds?.trial), btn(_t("cancel", lang), "menu:main", backSty, emojiIds?.back)],
    ],
  };
}

// ——— Gift / Secondary Subscriptions keyboards ———

/** Меню подарков: доп. подписки, активация, список подарков */
export function giftMenuButtons(
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  return {
    inline_keyboard: [
      [btn("🛒 Купить доп. подписку", "gift:buy", tariffPay, emojiIds?.tariff)],
      [btn("📋 Мои подписки", "gift:subscriptions", "primary", emojiIds?.connect)],
      [btn("🎁 Активировать подарок", "gift:redeem", "primary", emojiIds?.trial)],
      [btn("🎟️ Мои подарки", "gift:codes", "primary", emojiIds?.card)],
      [btn(back, "menu:main", backSty, emojiIds?.back)],
    ],
  };
}

/** Список вторичных подписок с кнопками «Подключить» и «Подарить» */
export function giftSubscriptionButtons(
  subscriptions: { id: string; subscriptionIndex: number | null; giftStatus: string | null }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const rows: InlineButton[][] = [];
  for (const sub of subscriptions) {
    const idx = sub.subscriptionIndex ?? 0;
    const statusLabel =
      sub.giftStatus === "GIFTED"
        ? " (подарена)"
        : sub.giftStatus === "GIFT_RESERVED"
          ? " (код создан)"
          : sub.giftStatus === "ACTIVATED_SELF"
            ? " (для себя)"
            : "";
    // Кнопка «Подключить» нужна и для ACTIVATED_SELF — иначе при нескольких таких подписках
    // остаётся только «Назад», без страницы подписки / Remna.
    rows.push([
      btn(`📲 Подписка #${idx}${statusLabel}`, `gift:connect:${sub.id}`, "primary", emojiIds?.connect),
    ]);
    if (!sub.giftStatus) {
      rows.push([
        btn(`🎁 Подарить #${idx}`, `gift:give:${sub.id}`, "success", emojiIds?.trial),
        btn(`🗑 Удалить #${idx}`, `gift:delete:${sub.id}`, "danger"),
      ]);
    }
  }
  rows.push([btn(back, "menu:gift", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** После покупки доп. подписки — «Активировать себе» или «Подарить» */
export function giftPostPurchaseButtons(
  subscriptionId: string,
  subscriptionIndex: number,
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  return {
    inline_keyboard: [
      [btn(`✅ Активировать себе`, `gift:connect:${subscriptionId}`, "primary", emojiIds?.connect)],
      [btn(`🎁 Подарить`, `gift:give:${subscriptionId}`, "success", emojiIds?.trial)],
      [btn(back, "menu:gift", backSty, emojiIds?.back)],
    ],
  };
}

/** Результат создания подарочного кода — только кнопка назад */
export function giftCodeResultButtons(
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  return {
    inline_keyboard: [
      [btn(back, "menu:gift", backSty, emojiIds?.back)],
    ],
  };
}

/** Список подарочных кодов с кнопкой отмены для активных */
export function giftCodesListButtons(
  codes: { id: string; code: string; status: string }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const rows: InlineButton[][] = [];
  for (const c of codes) {
    if (c.status === "ACTIVE") {
      rows.push([btn(`❌ Отменить ${c.code}`, `gift:cancel_code:${c.id}`, "danger")]);
    }
  }
  rows.push([btn(back, "menu:gift", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Тарифы для покупки подарочной подписки (с gift_tariff: префиксом) */
export function giftTariffButtons(
  categories: {
    id: string;
    name: string;
    emoji?: string;
    tariffs: { id: string; name: string; price: number; currency: string; hasOptions?: boolean }[];
  }[],
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const tariffPay = resolveStyle(toStyle(innerStyles?.tariffPay), "success");
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const tariffId = emojiIds?.tariff;
  const rows: InlineButton[][] = [];
  for (const cat of categories) {
    const prefix = (cat.emoji && cat.emoji.trim()) ? `${cat.emoji} ` : "";
    for (const t of cat.tariffs) {
      const fromPrefix = t.hasOptions ? "от " : "";
    const label = `${prefix}${t.name} — ${fromPrefix}${t.price} ${currencySymbol(t.currency)}`.slice(0, 64);
      rows.push([btn(label, `gift_tariff:${t.id}`, tariffPay, tariffId)]);
    }
  }
  rows.push([btn(back, "menu:gift", backSty, emojiIds?.back)]);
  return { inline_keyboard: rows };
}

/** Кнопки подтверждения покупки подарочной подписки (баланс) */
export function giftPaymentButtons(
  tariffId: string,
  balanceLabel: string,
  backLabel?: string | null,
  innerStyles?: InnerButtonStyles,
  emojiIds?: InnerEmojiIds
): InlineMarkup {
  const back = (backLabel && backLabel.trim()) || DEFAULT_BACK_LABEL;
  const backSty = resolveStyle(toStyle(innerStyles?.back), "danger");
  const cardId = emojiIds?.card;
  return {
    inline_keyboard: [
      [btn(balanceLabel, `gift_pay_balance:${tariffId}`, undefined, cardId)],
      [btn(back, "gift:buy", backSty, emojiIds?.back)],
    ],
  };
}
