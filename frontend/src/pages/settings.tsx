import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { api, type AdminSettings, type AutoRenewStats, type SyncResult, type SyncToRemnaResult, type SyncCreateRemnaForMissingResult, type SubscriptionPageConfig, type SshConfig } from "@/lib/api";
import { SubscriptionPageEditor } from "@/components/subscription-page-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, Upload, Link2, Settings2, Gift, Users, ArrowLeftRight, Mail, MessageCircle, CreditCard, ChevronDown, ChevronUp, Copy, Check, Bot, FileJson, Palette, Wallet, Package, Plus, Trash2, KeyRound, Loader2, Sparkles, Layers, Globe, BarChart3, RotateCw, Shield, Terminal, FileText, MapPin, GripVertical, Smile, Sliders, MessageSquare, Eye, Megaphone, Trash, Bell, Send, Building, Languages as LanguagesIcon, Network } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACCENT_PALETTES } from "@/contexts/theme";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MarketplaceSettingsCard } from "@/pages/marketplace/marketplace-settings-card";

const FALLBACK_LANGS = ["ru", "en"];
const LANG_NAMES: Record<string, string> = {
  ru: "Русский",
  en: "English",
  uk: "Українська",
  be: "Беларуская",
  kz: "Қазақша",
  kk: "Қазақша",
  uz: "Oʻzbekcha",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  pt: "Português",
  it: "Italiano",
  pl: "Polski",
  tr: "Türkçe",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  ar: "العربية",
  hi: "हिन्दी",
  fa: "فارسی",
};
const ALLOWED_CURRENCIES = ["usd", "rub"];

const DEFAULT_PLATEGA_METHODS: { id: number; enabled: boolean; label: string }[] = [
  { id: 2, enabled: true, label: "СБП" },
  { id: 11, enabled: false, label: "Карты" },
  { id: 12, enabled: false, label: "Международный" },
  { id: 13, enabled: false, label: "Криптовалюта" },
];

type BotButtonItem = { id: string; visible: boolean; label: string; order: number; style?: string; emojiKey?: string; onePerRow?: boolean };
const DEFAULT_BOT_BUTTONS: BotButtonItem[] = [
  { id: "tariffs", visible: true, label: "📦 Тарифы", order: 0, style: "success", emojiKey: "PACKAGE" },
  { id: "proxy", visible: true, label: "🌐 Прокси", order: 0.5, style: "primary", emojiKey: "SERVERS" },
  { id: "my_proxy", visible: true, label: "📋 Мои прокси", order: 0.6, style: "primary", emojiKey: "SERVERS" },
  { id: "singbox", visible: true, label: "🔑 Доступы", order: 0.55, style: "primary", emojiKey: "SERVERS" },
  { id: "my_singbox", visible: true, label: "📋 Мои доступы", order: 0.65, style: "primary", emojiKey: "SERVERS" },
  { id: "profile", visible: true, label: "👤 Профиль", order: 1, style: "", emojiKey: "PUZZLE" },
  { id: "devices", visible: true, label: "📱 Устройства", order: 1.5, style: "primary", emojiKey: "DEVICES" },
  { id: "topup", visible: true, label: "💳 Пополнить баланс", order: 2, style: "success", emojiKey: "CARD" },
  { id: "referral", visible: true, label: "🔗 Реферальная программа", order: 3, style: "primary", emojiKey: "LINK" },
  { id: "trial", visible: true, label: "🎁 Попробовать бесплатно", order: 4, style: "success", emojiKey: "TRIAL" },
  { id: "vpn", visible: true, label: "🌐 Подключиться к VPN", order: 5, style: "danger", emojiKey: "SERVERS", onePerRow: true },
  { id: "cabinet", visible: true, label: "🌐 Web Кабинет", order: 6, style: "primary", emojiKey: "SERVERS" },
  { id: "tickets", visible: true, label: "🎫 Тикеты", order: 6.5, style: "primary", emojiKey: "NOTE" },
  { id: "own_bot", visible: true, label: "🤖 Свой бот", order: 6.52, style: "primary", emojiKey: "NOTE", onePerRow: true },
  { id: "support", visible: true, label: "🆘 Поддержка", order: 7, style: "primary", emojiKey: "NOTE" },
  { id: "promocode", visible: true, label: "🎟️ Промокод", order: 8, style: "primary", emojiKey: "STAR" },
  { id: "gift", visible: true, label: "🎁 Подарки", order: 8.5, style: "primary", emojiKey: "TRIAL" },
  { id: "extra_options", visible: true, label: "➕ Доп. опции", order: 9, style: "primary", emojiKey: "PACKAGE" },
];

const BOT_EMOJI_KEYS = ["HEADER", "MAIN_MENU", "STATUS", "BALANCE", "TARIFFS", "PACKAGE", "PROFILE", "CARD", "TRIAL", "LINK", "SERVERS", "BACK", "PUZZLE", "DATE", "TIME", "TRAFFIC", "ACTIVE_GREEN", "ACTIVE_YELLOW", "INACTIVE", "CONNECT", "NOTE", "STAR", "CROWN", "DURATION", "DEVICES", "LOCATION", "CUSTOM_1", "CUSTOM_2", "CUSTOM_3", "CUSTOM_4", "CUSTOM_5"] as const;

const DEFAULT_BOT_MENU_TEXTS: Record<string, string> = {
  welcomeTitlePrefix: "🛡 ",
  welcomeGreeting: "👋 Добро пожаловать в ",
  balancePrefix: "💰 Баланс: ",
  tariffPrefix: "💎 Ваш тариф : ",
  subscriptionPrefix: "📊 Статус подписки — ",
  statusInactive: "🔴 Истекла",
  statusActive: "🟡 Активна",
  statusExpired: "🔴 Истекла",
  statusLimited: "🟡 Ограничена",
  statusDisabled: "🔴 Отключена",
  expirePrefix: "📅 до ",
  daysLeftPrefix: "⏰ осталось ",
  devicesLabel: "📱 Устройств: ",
  devicesAvailable: " доступно",
  trafficPrefix: "📈 Трафик — ",
  linkLabel: "🔗 Ссылка подключения:",
  chooseAction: "Выберите действие:",
};

const DEFAULT_BOT_TARIFFS_TEXT = "Тарифы\n\n{{CATEGORY}}\n{{TARIFFS}}\n\nВыберите тариф для оплаты:";
const DEFAULT_BOT_PAYMENT_TEXT = "Оплата: {{NAME}} — {{PRICE}}\n\n{{ACTION}}";

const DEFAULT_BOT_TARIFF_FIELDS: Record<string, boolean> = {
  name: true,
  durationDays: false,
  price: true,
  currency: true,
  trafficLimit: false,
  deviceLimit: false,
};

const DEFAULT_BOT_MENU_LINE_VISIBILITY: Record<string, boolean> = {
  welcomeTitlePrefix: true,
  welcomeGreeting: true,
  balancePrefix: true,
  tariffPrefix: true,
  subscriptionPrefix: true,
  expirePrefix: true,
  daysLeftPrefix: true,
  devicesLabel: true,
  trafficPrefix: true,
  linkLabel: true,
  chooseAction: true,
};

const BOT_TARIFF_FIELD_LABELS: Record<string, string> = {
  name: "Название",
  durationDays: "Длительность (дни)",
  price: "Цена",
  currency: "Валюта",
  trafficLimit: "Лимит трафика",
  deviceLimit: "Лимит устройств",
};

const BOT_MENU_LINE_LABELS: Record<string, string> = {
  welcomeTitlePrefix: "Название бота",
  welcomeGreeting: "Приветствие",
  balancePrefix: "Баланс",
  tariffPrefix: "Тариф",
  subscriptionPrefix: "Статус подписки",
  expirePrefix: "Дата окончания",
  daysLeftPrefix: "Осталось дней",
  devicesLabel: "Устройства",
  trafficPrefix: "Трафик",
  linkLabel: "Ссылка подключения",
  chooseAction: "Призыв к действию",
};

/** Все ключи стилей внутренних кнопок и их дефолты — при изменении одного не терять остальные */
const DEFAULT_BOT_INNER_STYLES: Record<string, string> = {
  tariffPay: "success",
  topup: "primary",
  back: "danger",
  profile: "primary",
  trialConfirm: "success",
  lang: "primary",
  currency: "primary",
};

const BOT_MENU_TEXT_LABELS: Record<string, string> = {
  welcomeTitlePrefix: "Заголовок (префикс перед названием)",
  welcomeGreeting: "Приветствие",
  balancePrefix: "Подпись баланса",
  tariffPrefix: "Подпись тарифа (Ваш тариф : …)",
  subscriptionPrefix: "Подпись статуса подписки",
  statusInactive: "Статус: не активна",
  statusActive: "Статус: активна",
  statusExpired: "Статус: истекла",
  statusLimited: "Статус: ограничена",
  statusDisabled: "Статус: отключена",
  expirePrefix: "Подпись даты окончания",
  daysLeftPrefix: "Подпись «осталось дней»",
  devicesLabel: "Подпись устройств",
  devicesAvailable: "Суффикс «доступно»",
  trafficPrefix: "Подпись трафика",
  linkLabel: "Подпись ссылки подключения",
  chooseAction: "Призыв к действию",
};

/** Человеко-читаемые описания emoji-ключей для админки (вместо технических HEADER, BALANCE и т.п.). */
const BOT_EMOJI_LABELS: Record<string, string> = {
  HEADER: "Заголовок главного меню",
  MAIN_MENU: "Иконка «Главное меню»",
  STATUS: "Статус подписки",
  BALANCE: "Баланс",
  TARIFFS: "Раздел «Тарифы»",
  PACKAGE: "Пакет / Тариф",
  PROFILE: "Профиль",
  CARD: "Оплата / Карта",
  TRIAL: "Триал / Подарок",
  LINK: "Ссылка / Реферал",
  SERVERS: "VPN / Серверы",
  BACK: "Кнопка «Назад»",
  PUZZLE: "Меню профиля",
  DATE: "Дата окончания",
  TIME: "Осталось дней",
  TRAFFIC: "Трафик",
  ACTIVE_GREEN: "Активно (зелёный)",
  ACTIVE_YELLOW: "Ограничено (жёлтый)",
  INACTIVE: "Неактивно (серый)",
  CONNECT: "Подключение",
  NOTE: "Поддержка / Заметка",
  STAR: "Промокод / Звезда",
  CROWN: "Премиум / Корона",
  DURATION: "Длительность",
  DEVICES: "Устройства",
  LOCATION: "Локация",
  CUSTOM_1: "Свой эмодзи №1",
  CUSTOM_2: "Свой эмодзи №2",
  CUSTOM_3: "Свой эмодзи №3",
  CUSTOM_4: "Свой эмодзи №4",
  CUSTOM_5: "Свой эмодзи №5",
};

/** Опции стилей кнопок с цветовыми превью. Внутренние ID-стили примерно одинаковы в TG. */
const BOT_STYLE_OPTIONS: { value: string; label: string; swatch: string }[] = [
  { value: "", label: "По умолчанию", swatch: "bg-muted" },
  { value: "primary", label: "Синий", swatch: "bg-blue-500" },
  { value: "success", label: "Зелёный", swatch: "bg-emerald-500" },
  { value: "danger", label: "Красный", swatch: "bg-red-500" },
];

/** Человеко-читаемые имена кнопок главного меню по их id (для подсказок справа от ввода). */
const BOT_BUTTON_HUMAN_NAMES: Record<string, string> = {
  tariffs: "Список тарифов VPN",
  proxy: "Прокси-тарифы",
  my_proxy: "Мои прокси-доступы",
  singbox: "Singbox-доступы",
  my_singbox: "Мои singbox-доступы",
  profile: "Профиль клиента",
  devices: "Управление устройствами",
  topup: "Пополнение баланса",
  referral: "Реферальная программа",
  trial: "Бесплатный триал",
  vpn: "Подключение к VPN",
  cabinet: "Открыть веб-кабинет",
  tickets: "Тикеты поддержки",
  own_bot: "Заявка на своего бота-клона (токен в тикете)",
  support: "Связь с поддержкой",
  promocode: "Ввод промокода",
  gift: "Подарочные коды",
  extra_options: "Доп. опции (трафик, устройства)",
};

/** Подсказки к текстам экранов бота: где это используется и какие переменные доступны. */
const BOT_INNER_STYLE_LABELS: Record<string, { label: string; desc: string }> = {
  tariffPay: { label: "Кнопка оплаты тарифа", desc: "Цвет кнопки выбора тарифа в списке" },
  topup: { label: "Кнопка пополнения", desc: "Цвет на экране пополнения баланса" },
  back: { label: "Кнопка «Назад»", desc: "Возврат в предыдущее меню" },
  profile: { label: "Кнопка профиля", desc: "Кнопки внутри экрана профиля" },
  trialConfirm: { label: "Подтверждение триала", desc: "Подтверждение активации триала" },
  lang: { label: "Выбор языка", desc: "Кнопки выбора языка интерфейса" },
  currency: { label: "Выбор валюты", desc: "Кнопки выбора валюты" },
};

/**
 * Кнопка-загрузчик офферов из Lava.top.
 * Дёргает /api/admin/lavatop/products, показывает список с offer ID и ценами.
 * Каждый offer ID можно скопировать в один клик.
 */
function LavatopOffersBrowser() {
  type Offer = {
    offerId: string;
    offerName: string;
    offerDescription?: string;
    productId: string;
    productTitle: string;
    productType: string;
    prices: { currency: string; amount: number; periodicity: string }[];
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/lavatop/products", {
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`);
      setOffers(data.offers as Offer[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }

  async function copyId(id: string) {
    try { await navigator.clipboard.writeText(id); } catch { /* ignore */ }
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  return (
    <div className="mt-4 pt-4 border-t border-dashed">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h5 className="text-sm font-semibold">Офферы в твоём Lava.top кабинете</h5>
          <p className="text-xs text-muted-foreground">Скопируй offer ID и вставь в поле «Lava.top Offer ID» нужного тарифа.</p>
        </div>
        <Button type="button" size="sm" onClick={load} disabled={loading}>
          {loading ? "Загружаю…" : (offers ? "Обновить" : "Показать офферы")}
        </Button>
      </div>
      {error && (
        <div className="text-xs rounded-md border border-red-300/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-2 mb-2">
          ❌ {error}
        </div>
      )}
      {offers && offers.length === 0 && (
        <p className="text-xs text-muted-foreground">У тебя нет ни одного оффера в кабинете Lava.top. Создай продукт + оффер на developers.lava.top.</p>
      )}
      {offers && offers.length > 0 && (
        <div className="grid gap-2">
          {offers.map((o) => {
            const isCopied = copiedId === o.offerId;
            return (
              <div key={o.offerId} className="rounded-lg border border-white/10 bg-background/40 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{o.offerName || "(без названия)"}</div>
                    <div className="text-muted-foreground text-[10px] truncate">{o.productTitle} · {o.productType}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isCopied ? "default" : "outline"}
                    onClick={() => copyId(o.offerId)}
                    className="shrink-0"
                  >
                    {isCopied ? "✓ Copied" : "Copy ID"}
                  </Button>
                </div>
                <div className="font-mono text-[11px] break-all text-primary">{o.offerId}</div>
                {o.prices.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {o.prices.map((p, i) => (
                      <span key={i} className="rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5">
                        {p.amount} {p.currency} · {p.periodicity}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { state, updateAdmin } = useAuth();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [twoFaEnableOpen, setTwoFaEnableOpen] = useState(false);
  const [twoFaDisableOpen, setTwoFaDisableOpen] = useState(false);
  const [twoFaSetupData, setTwoFaSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [twoFaStep, setTwoFaStep] = useState<1 | 2>(1);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [sshConfig, setSshConfig] = useState<SshConfig | null>(null);
  const [sshSaving, setSshSaving] = useState(false);
  const [sshMessage, setSshMessage] = useState("");
  const [syncLoading, setSyncLoading] = useState<"from" | "to" | "missing" | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [squads, setSquads] = useState<{ uuid: string; name?: string }[]>([]);
  const [activeTab, setActiveTab] = useState("general");
  const [botSubTab, setBotSubTab] = useState<"menu" | "texts" | "emoji" | "behavior" | "links">("menu");
  const [installedLangCodes, setInstalledLangCodes] = useState<string[]>(FALLBACK_LANGS);
  const [plategaCallbackCopied, setPlategaCallbackCopied] = useState(false);
  const [yoomoneyWebhookCopied, setYoomoneyWebhookCopied] = useState(false);
  const [yookassaWebhookCopied, setYookassaWebhookCopied] = useState(false);
  const [cryptopayWebhookCopied, setCryptopayWebhookCopied] = useState(false);
  const [heleketWebhookCopied, setHeleketWebhookCopied] = useState(false);
  const [lavaWebhookCopied, setLavaWebhookCopied] = useState(false);
  const [overpayWebhookCopied, setOverpayWebhookCopied] = useState(false);
  const [defaultSubpageConfig, setDefaultSubpageConfig] = useState<SubscriptionPageConfig | null>(null);
  const [autoRenewStats, setAutoRenewStats] = useState<AutoRenewStats | null>(null);
  const defaultJourneySteps = [
    { title: "Выбираешь сценарий", desc: "Доступны гибкие тарифы: выбери то, что подходит именно тебе, без переплат." },
    { title: "Оплачиваешь как удобно", desc: "Карта, СБП, крипта — выбирай любой удобный и безопасный метод оплаты." },
    { title: "Подключаешься без боли", desc: "После оплаты бот или личный кабинет сразу выдадут все инструкции. Настройка за 1 минуту." },
  ];
  const defaultSignalCards = [
    { eyebrow: "privacy core", title: "Zero-log и аккуратная защита", desc: "Не ощущается как странный хак: нормальный продуктовый слой, чистый доступ и понятный контроль." },
    { eyebrow: "global access", title: "Нужные сервисы открываются без драмы", desc: "Маршруты и сценарии уже собраны под реальные поездки, работу и привычные повседневные задачи." },
    { eyebrow: "payments sync", title: "Оплата встроена в общий сценарий", desc: "Не отдельная форма из девяностых, а часть единого опыта: выбрал, оплатил, сразу подключился." },
  ];
  const defaultTrustPoints = ["Современные протоколы шифрования", "Строгая политика Zero-Log: мы не храним данные", "Высокая пропускная способность без ограничений"];
  const defaultExperiencePanels = [
    { title: "Никаких зависаний", desc: "Смотри видео в 4K, играй в игры и работай без задержек." },
    { title: "Мгновенное подключение", desc: "Достаточно нажать одну кнопку, чтобы оказаться в защищенной сети." },
    { title: "Удобный кабинет", desc: "Управляй подпиской, устройствами и получай поддержку в пару кликов." },
  ];
  const defaultDevicesList = ["Windows", "macOS", "iPhone / iPad", "Android", "Linux"];
  const defaultQuickStartList = ["Мгновенный доступ после оплаты", "Подробные инструкции и техподдержка", "Удобный личный кабинет в Telegram"];
  const [landingJourneySteps, setLandingJourneySteps] = useState<{ title: string; desc: string }[]>(defaultJourneySteps);
  const [landingSignalCards, setLandingSignalCards] = useState<{ eyebrow: string; title: string; desc: string }[]>(defaultSignalCards);
  const [landingTrustPoints, setLandingTrustPoints] = useState<string[]>(defaultTrustPoints);
  const [landingExperiencePanels, setLandingExperiencePanels] = useState<{ title: string; desc: string }[]>(defaultExperiencePanels);
  const [landingDevicesList, setLandingDevicesList] = useState<string[]>(defaultDevicesList);
  const [landingQuickStartList, setLandingQuickStartList] = useState<string[]>(defaultQuickStartList);
  const token = state.accessToken!;

  useEffect(() => {
    let cancelled = false;
    api.getLanguages(token).then((res) => {
      if (cancelled || !res?.ok) return;
      const codes = Array.from(new Set<string>(["ru", ...res.languages.map((l) => l.code)]));
      setInstalledLangCodes(codes);
    }).catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    api.getSettings(token).then((data) => {
      const allowed = installedLangCodes;
      setSettings({
        ...data,
        activeLanguages: (data.activeLanguages || []).filter((l: string) => allowed.includes(l)),
        activeCurrencies: (data.activeCurrencies || []).filter((c: string) => ALLOWED_CURRENCIES.includes(c)),
        defaultReferralPercent: data.defaultReferralPercent ?? 30,
        referralPercentLevel2: (data as AdminSettings).referralPercentLevel2 ?? 10,
        referralPercentLevel3: (data as AdminSettings).referralPercentLevel3 ?? 10,
        plategaMethods: (data as AdminSettings).plategaMethods ?? DEFAULT_PLATEGA_METHODS,
        botButtons: (() => {
          const raw = (data as AdminSettings).botButtons;
          const loaded = Array.isArray(raw) ? raw : [];
          return DEFAULT_BOT_BUTTONS.map((def) => {
            const fromApi = loaded.find((b: { id: string }) => b.id === def.id);
            return fromApi ? { ...def, ...fromApi } : def;
          }) as BotButtonItem[];
        })(),
        botButtonsPerRow: (data as AdminSettings).botButtonsPerRow ?? 1,
        botEmojis: (data as AdminSettings).botEmojis ?? {},
        botBackLabel: (data as AdminSettings).botBackLabel ?? "◀️ В меню",
        botMenuTexts: { ...DEFAULT_BOT_MENU_TEXTS, ...((data as AdminSettings).botMenuTexts ?? {}) },
        botMenuLineVisibility: { ...DEFAULT_BOT_MENU_LINE_VISIBILITY, ...((data as AdminSettings).botMenuLineVisibility ?? {}) },
        botTariffsText: (data as AdminSettings).botTariffsText ?? DEFAULT_BOT_TARIFFS_TEXT,
        botTariffsFields: { ...DEFAULT_BOT_TARIFF_FIELDS, ...((data as AdminSettings).botTariffsFields ?? {}) },
        botPaymentText: (data as AdminSettings).botPaymentText ?? DEFAULT_BOT_PAYMENT_TEXT,
        botInnerButtonStyles: (() => {
          const raw = (data as AdminSettings).botInnerButtonStyles;
          const loaded =
            raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
          return { ...DEFAULT_BOT_INNER_STYLES, ...loaded };
        })(),
        subscriptionPageConfig: (data as AdminSettings).subscriptionPageConfig ?? null,
        supportLink: (data as AdminSettings).supportLink ?? "",
        agreementLink: (data as AdminSettings).agreementLink ?? "",
        offerLink: (data as AdminSettings).offerLink ?? "",
        instructionsLink: (data as AdminSettings).instructionsLink ?? "",
        ticketsEnabled: (data as AdminSettings).ticketsEnabled ?? false,
        aiChatEnabled: (data as AdminSettings).aiChatEnabled !== false,
        sellOptionsEnabled: (data as AdminSettings).sellOptionsEnabled ?? false,
        sellOptionsTrafficEnabled: (data as AdminSettings).sellOptionsTrafficEnabled ?? false,
        sellOptionsTrafficProducts: (data as AdminSettings).sellOptionsTrafficProducts ?? [],
        sellOptionsDevicesEnabled: (data as AdminSettings).sellOptionsDevicesEnabled ?? false,
        sellOptionsDevicesProducts: (data as AdminSettings).sellOptionsDevicesProducts ?? [],
        sellOptionsServersEnabled: (data as AdminSettings).sellOptionsServersEnabled ?? false,
        sellOptionsServersProducts: (data as AdminSettings).sellOptionsServersProducts ?? [],
        giftSubscriptionsEnabled: (data as AdminSettings).giftSubscriptionsEnabled ?? false,
        giftCodeExpiryHours: (data as AdminSettings).giftCodeExpiryHours ?? 72,
        maxAdditionalSubscriptions: (data as AdminSettings).maxAdditionalSubscriptions ?? 5,
        giftCodeFormatLength: (data as AdminSettings).giftCodeFormatLength ?? 12,
        giftRateLimitPerMinute: (data as AdminSettings).giftRateLimitPerMinute ?? 5,
        giftExpiryNotificationDays: (data as AdminSettings).giftExpiryNotificationDays ?? 3,
        giftReferralEnabled: (data as AdminSettings).giftReferralEnabled ?? true,
        giftMessageMaxLength: (data as AdminSettings).giftMessageMaxLength ?? 200,
      });
    }).finally(() => setLoading(false));
    api.getAutoRenewStats(token).then(setAutoRenewStats).catch(() => {});
    api.getSshConfig(token).then(setSshConfig).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!settings) return;
    try {
      const raw = (settings as { landingJourneyStepsJson?: string | null }).landingJourneyStepsJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a) && a.length >= 1) {
          setLandingJourneySteps(a.slice(0, 3).map((x: unknown) => ({
            title: typeof (x as { title?: string }).title === "string" ? (x as { title: string }).title : "",
            desc: typeof (x as { desc?: string }).desc === "string" ? (x as { desc: string }).desc : "",
          })));
        }
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingSignalCardsJson?: string | null }).landingSignalCardsJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a) && a.length >= 1) {
          setLandingSignalCards(a.slice(0, 3).map((x: unknown) => ({
            eyebrow: typeof (x as { eyebrow?: string }).eyebrow === "string" ? (x as { eyebrow: string }).eyebrow : "",
            title: typeof (x as { title?: string }).title === "string" ? (x as { title: string }).title : "",
            desc: typeof (x as { desc?: string }).desc === "string" ? (x as { desc: string }).desc : "",
          })));
        }
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingTrustPointsJson?: string | null }).landingTrustPointsJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a)) setLandingTrustPoints(a.slice(0, 5).map((x) => String(x)));
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingExperiencePanelsJson?: string | null }).landingExperiencePanelsJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a) && a.length >= 1) {
          setLandingExperiencePanels(a.slice(0, 3).map((x: unknown) => ({
            title: typeof (x as { title?: string }).title === "string" ? (x as { title: string }).title : "",
            desc: typeof (x as { desc?: string }).desc === "string" ? (x as { desc: string }).desc : "",
          })));
        }
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingDevicesListJson?: string | null }).landingDevicesListJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a)) setLandingDevicesList(a.slice(0, 8).map((x: unknown) => (typeof (x as { name?: string }).name === "string" ? (x as { name: string }).name : String(x))));
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingQuickStartJson?: string | null }).landingQuickStartJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a)) setLandingQuickStartList(a.slice(0, 5).map((x) => String(x)));
      }
    } catch { /* keep default */ }
  }, [settings?.landingJourneyStepsJson, settings?.landingSignalCardsJson, settings?.landingTrustPointsJson, settings?.landingExperiencePanelsJson, settings?.landingDevicesListJson, settings?.landingQuickStartJson]);

  useEffect(() => {
    if (activeTab === "subpage") {
      api.getDefaultSubscriptionPageConfig(token).then((c) => setDefaultSubpageConfig(c ?? null)).catch(() => setDefaultSubpageConfig(null));
    }
  }, [token, activeTab]);

  useEffect(() => {
    api.getRemnaSquadsInternal(token).then((raw: unknown) => {
      const res = raw as { response?: { internalSquads?: { uuid: string; name?: string }[] } };
      const items = res?.response?.internalSquads ?? (Array.isArray(res) ? res : []);
      setSquads(Array.isArray(items) ? items : []);
    }).catch(() => setSquads([]));
  }, [token]);

  async function handleSyncFromRemna() {
    setSyncLoading("from");
    setSyncMessage(null);
    try {
      const r: SyncResult = await api.syncFromRemna(token);
      setSyncMessage(
        r.ok
          ? t("admin.settings.sync_from_result", { created: r.created, updated: r.updated, skipped: r.skipped })
          : t("admin.settings.sync_errors", { errors: r.errors.join("; ") })
      );
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : t("admin.settings.sync_error"));
    } finally {
      setSyncLoading(null);
    }
  }

  async function handleSyncToRemna() {
    setSyncLoading("to");
    setSyncMessage(null);
    try {
      const r: SyncToRemnaResult = await api.syncToRemna(token);
      const parts: string[] = [];
      if (r.updated > 0) parts.push(`${t("admin.settings.sync_updated")}: ${r.updated}`);
      if (r.unlinked > 0) parts.push(`${t("admin.settings.sync_unlinked")}: ${r.unlinked}`);
      const successMsg = parts.length > 0 ? parts.join(". ") : t("admin.settings.sync_no_changes");
      const msg = r.ok ? successMsg : (r.errors.length > 0 ? `${t("admin.settings.error")}: ${r.errors.join("; ")}` : "") + (r.unlinked > 0 ? (r.errors.length ? ". " : "") + `${t("admin.settings.sync_unlinked")}: ${r.unlinked}` : "");
      setSyncMessage(msg || successMsg);
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : t("admin.settings.sync_error"));
    } finally {
      setSyncLoading(null);
    }
  }

  async function handleSyncCreateRemnaForMissing() {
    setSyncLoading("missing");
    setSyncMessage(null);
    try {
      const r: SyncCreateRemnaForMissingResult = await api.syncCreateRemnaForMissing(token);
      setSyncMessage(
        r.ok
          ? `${t("admin.settings.sync_created")}: ${r.created}, ${t("admin.settings.sync_linked")}: ${r.linked}`
          : `${t("admin.settings.error")}: ${r.errors.join("; ")}`
      );
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : t("admin.settings.error"));
    } finally {
      setSyncLoading(null);
    }
  }

  async function openTwoFaEnable() {
    setTwoFaError(null);
    setTwoFaSetupData(null);
    setTwoFaStep(1);
    setTwoFaCode("");
    setTwoFaEnableOpen(true);
    setTwoFaLoading(true);
    try {
      const data = await api.admin2FASetup(token);
      setTwoFaSetupData(data);
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : t("admin.settings.error"));
    } finally {
      setTwoFaLoading(false);
    }
  }
  function closeTwoFaEnable() {
    setTwoFaEnableOpen(false);
    setTwoFaSetupData(null);
    setTwoFaStep(1);
    setTwoFaCode("");
    setTwoFaError(null);
  }
  async function confirmTwoFaEnable() {
    if (!twoFaCode.trim() || twoFaCode.length !== 6) {
      setTwoFaError(t("admin.settings.2fa_enter_code_error"));
      return;
    }
    setTwoFaError(null);
    setTwoFaLoading(true);
    try {
      await api.admin2FAConfirm(token, twoFaCode.trim());
      const admin = await api.getMe(token);
      updateAdmin(admin);
      closeTwoFaEnable();
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : t("admin.settings.2fa_invalid_code"));
    } finally {
      setTwoFaLoading(false);
    }
  }
  async function openTwoFaDisable() {
    setTwoFaDisableOpen(true);
    setTwoFaCode("");
    setTwoFaError(null);
  }
  async function confirmTwoFaDisable() {
    if (!twoFaCode.trim() || twoFaCode.length !== 6) {
      setTwoFaError(t("admin.settings.2fa_enter_code_error"));
      return;
    }
    setTwoFaError(null);
    setTwoFaLoading(true);
    try {
      await api.admin2FADisable(token, twoFaCode.trim());
      const admin = await api.getMe(token);
      updateAdmin(admin);
      setTwoFaDisableOpen(false);
      setTwoFaCode("");
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : t("admin.settings.2fa_invalid_code"));
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function saveOptionsOnly() {
    if (!settings) return;
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        sellOptionsEnabled: settings.sellOptionsEnabled ?? false,
        sellOptionsTrafficEnabled: settings.sellOptionsTrafficEnabled ?? false,
        sellOptionsTrafficProducts: (settings.sellOptionsTrafficProducts?.length ? JSON.stringify(settings.sellOptionsTrafficProducts) : "") as string | null,
        sellOptionsDevicesEnabled: settings.sellOptionsDevicesEnabled ?? false,
        sellOptionsDevicesProducts: (settings.sellOptionsDevicesProducts?.length ? JSON.stringify(settings.sellOptionsDevicesProducts) : "") as string | null,
        sellOptionsServersEnabled: settings.sellOptionsServersEnabled ?? false,
        sellOptionsServersProducts: (settings.sellOptionsServersProducts?.length ? JSON.stringify(settings.sellOptionsServersProducts) : "") as string | null,
      };
      const updated = await api.updateSettings(token, payload);
      const u = updated as AdminSettings;
      setSettings((prev) => (prev ? { ...prev, ...u } : prev));
      setMessage(t("admin.settings.saved"));
    } catch {
      setMessage(t("admin.settings.save_error"));
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage("");
    const allowedLangs = installedLangCodes.length ? installedLangCodes : FALLBACK_LANGS;
    const langs = Array.isArray(settings.activeLanguages) ? settings.activeLanguages.filter((l) => allowedLangs.includes(l)) : allowedLangs;
    const currs = Array.isArray(settings.activeCurrencies) ? settings.activeCurrencies.filter((c) => ALLOWED_CURRENCIES.includes(c)) : ALLOWED_CURRENCIES;
    const defaultLang = (settings.defaultLanguage && allowedLangs.includes(settings.defaultLanguage) ? settings.defaultLanguage : langs[0]) ?? "ru";
    const defaultCurr = (settings.defaultCurrency && ALLOWED_CURRENCIES.includes(settings.defaultCurrency) ? settings.defaultCurrency : currs[0]) ?? "usd";
    api
      .updateSettings(token, {
        activeLanguages: langs.length ? langs.join(",") : allowedLangs.join(","),
        activeCurrencies: currs.length ? currs.join(",") : ALLOWED_CURRENCIES.join(","),
        defaultLanguage: defaultLang,
        defaultCurrency: defaultCurr,
        defaultReferralPercent: settings.defaultReferralPercent,
        referralPercentLevel2: settings.referralPercentLevel2 ?? 10,
        referralPercentLevel3: settings.referralPercentLevel3 ?? 10,
        trialDays: settings.trialDays,
        trialSquadUuid: settings.trialSquadUuid ?? null,
        trialDeviceLimit: settings.trialDeviceLimit ?? null,
        trialTrafficLimitBytes: settings.trialTrafficLimitBytes ?? null,
        serviceName: settings.serviceName,
        logo: settings.logo ?? null,
        logoBot: settings.logoBot ?? null,
        favicon: settings.favicon ?? null,
        cabinetDesign: settings.cabinetDesign ?? undefined,
        remnaClientUrl: settings.remnaClientUrl ?? null,
        smtpHost: settings.smtpHost ?? null,
        smtpPort: settings.smtpPort ?? undefined,
        smtpSecure: settings.smtpSecure ?? undefined,
        smtpUser: settings.smtpUser ?? null,
        smtpPassword: settings.smtpPassword && settings.smtpPassword !== "********" ? settings.smtpPassword : undefined,
        smtpFromEmail: settings.smtpFromEmail ?? null,
        smtpFromName: settings.smtpFromName ?? null,
        skipEmailVerification: settings.skipEmailVerification ?? false,
        defaultAutoRenewEnabled: settings.defaultAutoRenewEnabled ?? false,
        autoRenewDaysBeforeExpiry: settings.autoRenewDaysBeforeExpiry ?? 1,
        autoRenewNotifyDaysBefore: settings.autoRenewNotifyDaysBefore ?? 3,
        autoRenewGracePeriodDays: settings.autoRenewGracePeriodDays ?? 2,
        autoRenewMaxRetries: settings.autoRenewMaxRetries ?? 3,
        yookassaRecurringEnabled: settings.yookassaRecurringEnabled ?? false,
        useRemnaSubscriptionPage: settings.useRemnaSubscriptionPage ?? false,
        publicAppUrl: settings.publicAppUrl ?? null,
        telegramBotToken: settings.telegramBotToken ?? null,
        telegramBotUsername: settings.telegramBotUsername ?? null,
        botAdminTelegramIds: settings.botAdminTelegramIds ?? null,
        notificationTelegramGroupId: settings.notificationTelegramGroupId ?? null,
        notificationTopicNewClients: settings.notificationTopicNewClients ?? null,
        notificationTopicPayments: settings.notificationTopicPayments ?? null,
        notificationTopicTickets: settings.notificationTopicTickets ?? null,
        notificationTopicBackups: settings.notificationTopicBackups ?? null,
        plategaMerchantId: settings.plategaMerchantId ?? null,
        plategaSecret: settings.plategaSecret && settings.plategaSecret !== "********" ? settings.plategaSecret : undefined,
        plategaMethods: settings.plategaMethods != null ? JSON.stringify(settings.plategaMethods) : undefined,
        plategaWebhookSecret: (settings as { plategaWebhookSecret?: string | null }).plategaWebhookSecret && (settings as { plategaWebhookSecret?: string | null }).plategaWebhookSecret !== "********" ? (settings as { plategaWebhookSecret?: string | null }).plategaWebhookSecret : undefined,
        paymentProvidersConfig: settings.paymentProviders != null ? JSON.stringify(settings.paymentProviders) : undefined,
        yoomoneyClientId: settings.yoomoneyClientId ?? null,
        yoomoneyClientSecret: settings.yoomoneyClientSecret && settings.yoomoneyClientSecret !== "********" ? settings.yoomoneyClientSecret : undefined,
        yoomoneyReceiverWallet: settings.yoomoneyReceiverWallet ?? null,
        yoomoneyNotificationSecret: settings.yoomoneyNotificationSecret && settings.yoomoneyNotificationSecret !== "********" ? settings.yoomoneyNotificationSecret : undefined,
        yookassaShopId: settings.yookassaShopId ?? null,
        yookassaSecretKey: settings.yookassaSecretKey && settings.yookassaSecretKey !== "********" ? settings.yookassaSecretKey : undefined,
        yookassaWebhookBasicUser: (settings as { yookassaWebhookBasicUser?: string | null }).yookassaWebhookBasicUser ?? null,
        yookassaWebhookBasicPassword: (settings as { yookassaWebhookBasicPassword?: string | null }).yookassaWebhookBasicPassword && (settings as { yookassaWebhookBasicPassword?: string | null }).yookassaWebhookBasicPassword !== "********" ? (settings as { yookassaWebhookBasicPassword?: string | null }).yookassaWebhookBasicPassword : undefined,
        cryptopayApiToken: settings.cryptopayApiToken ?? null,
        cryptopayTestnet: settings.cryptopayTestnet ?? false,
        heleketMerchantId: settings.heleketMerchantId ?? null,
        heleketApiKey: settings.heleketApiKey && settings.heleketApiKey !== "********" ? settings.heleketApiKey : undefined,
        lavaShopId: settings.lavaShopId ?? null,
        lavaSecretKey: settings.lavaSecretKey && settings.lavaSecretKey !== "********" ? settings.lavaSecretKey : undefined,
        lavaAdditionalKey: settings.lavaAdditionalKey && settings.lavaAdditionalKey !== "********" ? settings.lavaAdditionalKey : undefined,
        lavatopApiKey: settings.lavatopApiKey && settings.lavatopApiKey !== "********" ? settings.lavatopApiKey : undefined,
        lavatopDefaultOfferId: settings.lavatopDefaultOfferId ?? null,
        botWelcomeEnabled: settings.botWelcomeEnabled ?? false,
        botWelcomeText: settings.botWelcomeText ?? null,
        botWelcomeImage: settings.botWelcomeImage ?? null,
        botWelcomeShowOnce: settings.botWelcomeShowOnce ?? true,
        cabinetDesignApplyInBrowser: settings.cabinetDesignApplyInBrowser ?? false,
        overpayApiUrl: settings.overpayApiUrl ?? null,
        overpayProjectId: settings.overpayProjectId ?? null,
        overpayLogin: settings.overpayLogin ?? null,
        overpayPassword: settings.overpayPassword && settings.overpayPassword !== "********" ? settings.overpayPassword : undefined,
        groqApiKey: settings.groqApiKey && settings.groqApiKey !== "********" ? settings.groqApiKey : undefined,
        groqModel: settings.groqModel ?? undefined,
        groqFallback1: settings.groqFallback1 ?? undefined,
        groqFallback2: settings.groqFallback2 ?? undefined,
        groqFallback3: settings.groqFallback3 ?? undefined,
        aiSystemPrompt: settings.aiSystemPrompt ?? undefined,
        botButtons: settings.botButtons != null ? JSON.stringify(settings.botButtons) : undefined,
        botButtonsPerRow: settings.botButtonsPerRow ?? 1,
        botEmojis: settings.botEmojis != null ? settings.botEmojis : undefined,
        botBackLabel: settings.botBackLabel ?? null,
        botMenuTexts: settings.botMenuTexts != null ? JSON.stringify(settings.botMenuTexts) : undefined,
        botMenuLineVisibility: settings.botMenuLineVisibility != null ? JSON.stringify(settings.botMenuLineVisibility) : undefined,
        botTariffsText: settings.botTariffsText ?? undefined,
        botTariffsFields: settings.botTariffsFields != null ? JSON.stringify(settings.botTariffsFields) : undefined,
        botPaymentText: settings.botPaymentText ?? undefined,
        botInnerButtonStyles: JSON.stringify({
          ...DEFAULT_BOT_INNER_STYLES,
          ...(settings.botInnerButtonStyles ?? {}),
        }),
        subscriptionPageConfig: settings.subscriptionPageConfig ?? undefined,
        supportLink: settings.supportLink ?? undefined,
        agreementLink: settings.agreementLink ?? undefined,
        offerLink: settings.offerLink ?? undefined,
        instructionsLink: settings.instructionsLink ?? undefined,
        ticketsEnabled: settings.ticketsEnabled ?? false,
        adminFrontNotificationsEnabled: settings.adminFrontNotificationsEnabled ?? true,
        aiChatEnabled: settings.aiChatEnabled !== false,
        themeAccent: settings.themeAccent ?? "default",
        forceSubscribeEnabled: settings.forceSubscribeEnabled ?? false,
        forceSubscribeChannelId: settings.forceSubscribeChannelId ?? null,
        forceSubscribeMessage: settings.forceSubscribeMessage ?? null,
        blacklistEnabled: settings.blacklistEnabled ?? false,
        botAutoDeleteUnknownMessages: settings.botAutoDeleteUnknownMessages ?? false,
        botInfoBlock: settings.botInfoBlock ?? null,
        allowUserThemeChange: (settings as any).allowUserThemeChange ?? true,
        sellOptionsEnabled: settings.sellOptionsEnabled ?? false,
        sellOptionsTrafficEnabled: settings.sellOptionsTrafficEnabled ?? false,
        sellOptionsTrafficProducts: settings.sellOptionsTrafficProducts?.length ? JSON.stringify(settings.sellOptionsTrafficProducts) : null,
        sellOptionsDevicesEnabled: settings.sellOptionsDevicesEnabled ?? false,
        sellOptionsDevicesProducts: settings.sellOptionsDevicesProducts?.length ? JSON.stringify(settings.sellOptionsDevicesProducts) : null,
        sellOptionsServersEnabled: settings.sellOptionsServersEnabled ?? false,
        sellOptionsServersProducts: settings.sellOptionsServersProducts?.length ? JSON.stringify(settings.sellOptionsServersProducts) : null,
        giftSubscriptionsEnabled: settings.giftSubscriptionsEnabled ?? false,
        giftCodeExpiryHours: settings.giftCodeExpiryHours ?? 72,
        maxAdditionalSubscriptions: settings.maxAdditionalSubscriptions ?? 5,
        giftCodeFormatLength: settings.giftCodeFormatLength ?? 12,
        giftRateLimitPerMinute: settings.giftRateLimitPerMinute ?? 5,
        giftExpiryNotificationDays: settings.giftExpiryNotificationDays ?? 3,
        giftReferralEnabled: settings.giftReferralEnabled ?? true,
        giftMessageMaxLength: settings.giftMessageMaxLength ?? 200,
        customBuildEnabled: settings.customBuildEnabled ?? false,
        customBuildPricePerDay: settings.customBuildPricePerDay ?? 0,
        customBuildPricePerDevice: settings.customBuildPricePerDevice ?? 0,
        customBuildTrafficMode: settings.customBuildTrafficMode ?? "unlimited",
        customBuildPricePerGb: settings.customBuildPricePerGb ?? 0,
        customBuildSquadUuid: settings.customBuildSquadUuid ?? null,
        customBuildCurrency: settings.customBuildCurrency ?? "rub",
        customBuildMaxDays: settings.customBuildMaxDays ?? 360,
        customBuildMaxDevices: settings.customBuildMaxDevices ?? 10,
        googleLoginEnabled: settings.googleLoginEnabled ?? false,
        googleClientId: settings.googleClientId ?? null,
        googleClientSecret: settings.googleClientSecret && settings.googleClientSecret !== "********" ? settings.googleClientSecret : undefined,
        appleLoginEnabled: settings.appleLoginEnabled ?? false,
        appleClientId: settings.appleClientId ?? null,
        appleTeamId: settings.appleTeamId ?? null,
        appleKeyId: settings.appleKeyId ?? null,
        applePrivateKey: settings.applePrivateKey && settings.applePrivateKey !== "********" ? settings.applePrivateKey : undefined,
        landingEnabled: settings.landingEnabled ?? false,
        landingHeroTitle: settings.landingHeroTitle ?? null,
        landingHeroSubtitle: settings.landingHeroSubtitle ?? null,
        landingHeroCtaText: settings.landingHeroCtaText ?? null,
        landingShowTariffs: settings.landingShowTariffs !== false,
        landingContacts: settings.landingContacts ?? null,
        landingOfferLink: settings.landingOfferLink ?? null,
        landingPrivacyLink: settings.landingPrivacyLink ?? null,
        landingFooterText: settings.landingFooterText ?? null,
        landingHeroBadge: settings.landingHeroBadge ?? null,
        landingHeroHint: settings.landingHeroHint ?? null,
        landingFeature1Label: settings.landingFeature1Label ?? null,
        landingFeature1Sub: settings.landingFeature1Sub ?? null,
        landingFeature2Label: settings.landingFeature2Label ?? null,
        landingFeature2Sub: settings.landingFeature2Sub ?? null,
        landingFeature3Label: settings.landingFeature3Label ?? null,
        landingFeature3Sub: settings.landingFeature3Sub ?? null,
        landingFeature4Label: settings.landingFeature4Label ?? null,
        landingFeature4Sub: settings.landingFeature4Sub ?? null,
        landingFeature5Label: settings.landingFeature5Label ?? null,
        landingFeature5Sub: settings.landingFeature5Sub ?? null,
        landingBenefitsTitle: settings.landingBenefitsTitle ?? null,
        landingBenefitsSubtitle: settings.landingBenefitsSubtitle ?? null,
        landingBenefit1Title: settings.landingBenefit1Title ?? null,
        landingBenefit1Desc: settings.landingBenefit1Desc ?? null,
        landingBenefit2Title: settings.landingBenefit2Title ?? null,
        landingBenefit2Desc: settings.landingBenefit2Desc ?? null,
        landingBenefit3Title: settings.landingBenefit3Title ?? null,
        landingBenefit3Desc: settings.landingBenefit3Desc ?? null,
        landingBenefit4Title: settings.landingBenefit4Title ?? null,
        landingBenefit4Desc: settings.landingBenefit4Desc ?? null,
        landingBenefit5Title: settings.landingBenefit5Title ?? null,
        landingBenefit5Desc: settings.landingBenefit5Desc ?? null,
        landingBenefit6Title: settings.landingBenefit6Title ?? null,
        landingBenefit6Desc: settings.landingBenefit6Desc ?? null,
        landingTariffsTitle: settings.landingTariffsTitle ?? null,
        landingTariffsSubtitle: settings.landingTariffsSubtitle ?? null,
        landingDevicesTitle: settings.landingDevicesTitle ?? null,
        landingDevicesSubtitle: settings.landingDevicesSubtitle ?? null,
        landingFaqTitle: settings.landingFaqTitle ?? null,
        landingFaqJson: settings.landingFaqJson ?? null,
        landingHeroHeadline1: settings.landingHeroHeadline1 ?? null,
        landingHeroHeadline2: settings.landingHeroHeadline2 ?? null,
        landingHeaderBadge: settings.landingHeaderBadge ?? null,
        landingButtonLogin: settings.landingButtonLogin ?? null,
        landingButtonLoginCabinet: settings.landingButtonLoginCabinet ?? null,
        landingNavBenefits: settings.landingNavBenefits ?? null,
        landingNavTariffs: settings.landingNavTariffs ?? null,
        landingNavDevices: settings.landingNavDevices ?? null,
        landingNavFaq: settings.landingNavFaq ?? null,
        landingBenefitsBadge: settings.landingBenefitsBadge ?? null,
        landingDefaultPaymentText: settings.landingDefaultPaymentText ?? null,
        landingButtonChooseTariff: settings.landingButtonChooseTariff ?? null,
        landingNoTariffsMessage: settings.landingNoTariffsMessage ?? null,
        landingButtonWatchTariffs: settings.landingButtonWatchTariffs ?? null,
        landingButtonStart: settings.landingButtonStart ?? null,
        landingButtonOpenCabinet: settings.landingButtonOpenCabinet ?? null,
        landingJourneyStepsJson: landingJourneySteps.length ? JSON.stringify(landingJourneySteps) : null,
        landingSignalCardsJson: landingSignalCards.length ? JSON.stringify(landingSignalCards) : null,
        landingTrustPointsJson: landingTrustPoints.some(Boolean) ? JSON.stringify(landingTrustPoints) : null,
        landingExperiencePanelsJson: landingExperiencePanels.length ? JSON.stringify(landingExperiencePanels) : null,
        landingDevicesListJson: landingDevicesList.filter(Boolean).length ? JSON.stringify(landingDevicesList.filter(Boolean).map((name) => ({ name }))) : null,
        landingQuickStartJson: landingQuickStartList.some(Boolean) ? JSON.stringify(landingQuickStartList) : null,
        landingInfraTitle: settings.landingInfraTitle ?? null,
        landingNetworkCockpitText: settings.landingNetworkCockpitText ?? null,
        landingPulseTitle: settings.landingPulseTitle ?? null,
        landingComfortTitle: settings.landingComfortTitle ?? null,
        landingComfortBadge: settings.landingComfortBadge ?? null,
        landingPrinciplesTitle: settings.landingPrinciplesTitle ?? null,
        landingTechTitle: settings.landingTechTitle ?? null,
        landingTechDesc: settings.landingTechDesc ?? null,
        landingCategorySubtitle: settings.landingCategorySubtitle ?? null,
        landingTariffDefaultDesc: settings.landingTariffDefaultDesc ?? null,
        landingTariffBullet1: settings.landingTariffBullet1 ?? null,
        landingTariffBullet2: settings.landingTariffBullet2 ?? null,
        landingTariffBullet3: settings.landingTariffBullet3 ?? null,
        landingLowestTariffDesc: settings.landingLowestTariffDesc ?? null,
        landingDevicesCockpitText: settings.landingDevicesCockpitText ?? null,
        landingUniversalityTitle: settings.landingUniversalityTitle ?? null,
        landingUniversalityDesc: settings.landingUniversalityDesc ?? null,
        landingQuickSetupTitle: settings.landingQuickSetupTitle ?? null,
        landingQuickSetupDesc: settings.landingQuickSetupDesc ?? null,
        landingPremiumServiceTitle: settings.landingPremiumServiceTitle ?? null,
        landingPremiumServicePara1: settings.landingPremiumServicePara1 ?? null,
        landingPremiumServicePara2: settings.landingPremiumServicePara2 ?? null,
        landingHowItWorksTitle: settings.landingHowItWorksTitle ?? null,
        landingHowItWorksDesc: settings.landingHowItWorksDesc ?? null,
        landingStatsPlatforms: settings.landingStatsPlatforms ?? null,
        landingStatsTariffsLabel: settings.landingStatsTariffsLabel ?? null,
        landingStatsAccessLabel: settings.landingStatsAccessLabel ?? null,
        landingStatsPaymentMethods: settings.landingStatsPaymentMethods ?? null,
        landingReadyToConnectEyebrow: settings.landingReadyToConnectEyebrow ?? null,
        landingReadyToConnectTitle: settings.landingReadyToConnectTitle ?? null,
        landingReadyToConnectDesc: settings.landingReadyToConnectDesc ?? null,
        landingShowFeatures: settings.landingShowFeatures !== false,
        landingShowBenefits: settings.landingShowBenefits !== false,
        landingShowDevices: settings.landingShowDevices !== false,
        landingShowFaq: settings.landingShowFaq !== false,
        landingShowHowItWorks: settings.landingShowHowItWorks !== false,
        landingShowCta: settings.landingShowCta !== false,
        proxyEnabled: settings.proxyEnabled ?? false,
        proxyUrl: settings.proxyUrl ?? null,
        proxyTelegram: settings.proxyTelegram ?? false,
        proxyPayments: settings.proxyPayments ?? false,
        proxyAi: settings.proxyAi ?? false,
        nalogEnabled: settings.nalogEnabled ?? false,
        nalogInn: settings.nalogInn ?? null,
        nalogPassword: settings.nalogPassword ?? null,
        nalogDeviceId: settings.nalogDeviceId ?? null,
        nalogServiceName: settings.nalogServiceName ?? null,
        geoMapEnabled: settings.geoMapEnabled ?? false,
        geoCacheTtl: settings.geoCacheTtl ?? 60,
        maxmindDbPath: settings.maxmindDbPath ?? null,
      })
      .then((updated) => {
        const u = updated as AdminSettings;
        setSettings({
          ...u,
          botInnerButtonStyles: {
            ...DEFAULT_BOT_INNER_STYLES,
            ...(settings.botInnerButtonStyles ?? {}),
          },
        });
        setMessage(t("admin.settings.saved"));
      })
      .catch(() => setMessage(t("admin.settings.error")))
      .finally(() => setSaving(false));
  }

  if (loading) return <div className="text-muted-foreground">{t("admin.common.loading")}</div>;
  if (!settings) return <div className="text-destructive">{t("admin.common.loading_error")}</div>;

  return (
    <div className="space-y-6">
      {/* ═══ HERO ═══ */}
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-sky-500/10 via-indigo-500/10 to-fuchsia-500/10 backdrop-blur-3xl shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-fuchsia-500/10 pointer-events-none" />
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-gradient-to-br from-sky-500/20 to-fuchsia-500/20 blur-3xl pointer-events-none" />
        <div className="relative px-6 py-7 sm:px-8 sm:py-8 flex items-start gap-5">
          <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-sky-500/30 via-indigo-500/20 to-fuchsia-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
            <Settings2 className="h-8 w-8 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-sky-500 via-indigo-500 to-fuchsia-500">
              {t("admin.settings.title")}
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-2 leading-relaxed max-w-2xl">
              {t("admin.settings.subtitle")}
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-1.5 p-1.5 h-auto bg-muted/40 rounded-2xl border border-white/10 shadow-sm backdrop-blur-md">
          <TabsTrigger value="general" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-slate-500 data-[state=active]:to-zinc-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Settings2 className="h-4 w-4 shrink-0" />{t("admin.settings.tab_general")}
          </TabsTrigger>
          <TabsTrigger value="trial" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Gift className="h-4 w-4 shrink-0" />{t("admin.settings.tab_trial")}
          </TabsTrigger>
          <TabsTrigger value="referral" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Users className="h-4 w-4 shrink-0" />{t("admin.settings.tab_referral")}
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500 data-[state=active]:to-orange-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <CreditCard className="h-4 w-4 shrink-0" />{t("admin.settings.tab_payments")}
          </TabsTrigger>
          <TabsTrigger value="bot" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-sky-500 data-[state=active]:to-blue-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Bot className="h-4 w-4 shrink-0" />{t("admin.settings.tab_bot")}
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-fuchsia-500 data-[state=active]:to-pink-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Sparkles className="h-4 w-4 shrink-0" />{t("admin.settings.tab_ai")}
          </TabsTrigger>
          <TabsTrigger value="mail-telegram" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Mail className="h-4 w-4 shrink-0" />{t("admin.settings.tab_mail_telegram")}
          </TabsTrigger>
          <TabsTrigger value="subpage" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-rose-500 data-[state=active]:to-pink-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <FileJson className="h-4 w-4 shrink-0" />{t("admin.settings.tab_subpage")}
          </TabsTrigger>
          <TabsTrigger value="theme" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-pink-500 data-[state=active]:to-rose-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Palette className="h-4 w-4 shrink-0" />{t("admin.settings.tab_theme")}
          </TabsTrigger>
          <TabsTrigger value="options" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-yellow-500 data-[state=active]:to-amber-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Package className="h-4 w-4 shrink-0" />{t("admin.settings.tab_options")}
          </TabsTrigger>
          <TabsTrigger value="custom-build" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-violet-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Layers className="h-4 w-4 shrink-0" />{t("admin.settings.tab_custom_build")}
          </TabsTrigger>
          <TabsTrigger value="oauth" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-zinc-500 data-[state=active]:to-slate-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <KeyRound className="h-4 w-4 shrink-0" />{t("admin.settings.tab_oauth")}
          </TabsTrigger>
          <TabsTrigger value="landing" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-500 data-[state=active]:to-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Globe className="h-4 w-4 shrink-0" />{t("admin.settings.tab_landing")}
          </TabsTrigger>
          <TabsTrigger value="server-ssh" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-stone-500 data-[state=active]:to-zinc-600 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Terminal className="h-4 w-4 shrink-0" />{t("admin.settings.tab_ssh")}
          </TabsTrigger>
          <TabsTrigger value="proxy-settings" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500 data-[state=active]:to-red-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Shield className="h-4 w-4 shrink-0" />{t("admin.settings.tab_proxy")}
          </TabsTrigger>
          <TabsTrigger value="nalog-settings" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-yellow-600 data-[state=active]:to-amber-600 data-[state=active]:text-white data-[state=active]:shadow-md">
            <FileText className="h-4 w-4 shrink-0" />{t("admin.settings.tab_nalog")}
          </TabsTrigger>
          <TabsTrigger value="geo-map" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-teal-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <MapPin className="h-4 w-4 shrink-0" />{t("admin.settings.tab_map")}
          </TabsTrigger>
          <TabsTrigger value="gifts" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-pink-500 data-[state=active]:to-fuchsia-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Gift className="h-4 w-4 shrink-0" />Подарки
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:to-indigo-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <ArrowLeftRight className="h-4 w-4 shrink-0" />{t("admin.settings.tab_sync")}
          </TabsTrigger>
        </TabsList>

        <form onSubmit={handleSubmit}>
          <TabsContent value="general">
            <Card className="overflow-hidden border-white/10">
              <div className="relative bg-gradient-to-br from-slate-500/10 via-zinc-500/10 to-stone-500/10 p-6 sm:p-8 border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-slate-500/5 via-transparent to-zinc-500/5 pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-500/30 via-zinc-500/20 to-stone-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                    <Settings2 className="h-7 w-7 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-500 via-zinc-500 to-stone-500">
                      {t("admin.settings.general_title")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.general_subtitle")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-5 p-4 sm:p-6">
                {/* === Функции сервиса === */}
                <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/5 via-blue-500/5 to-indigo-500/5 p-5 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-sky-500/20 flex items-center justify-center"><Sparkles className="h-4 w-4 text-sky-500" /></div>
                    <h3 className="text-base font-semibold">Функции сервиса</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Включай/выключай ключевые модули клиентского кабинета и админки.</p>
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-white/5 hover:border-white/10 transition-colors cursor-pointer">
                      <div className="h-9 w-9 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0"><MessageSquare className="h-4 w-4 text-sky-500" /></div>
                      <div className="flex-1 min-w-0">
                        <Label htmlFor="tickets-enabled-general" className="text-sm font-medium cursor-pointer">{t("admin.settings.ticket_system")}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("admin.settings.ticket_hint")}</p>
                      </div>
                      <Switch
                        id="tickets-enabled-general"
                        checked={!!settings.ticketsEnabled}
                        onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, ticketsEnabled: checked === true } : s))}
                      />
                    </label>
                    <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-white/5 hover:border-white/10 transition-colors cursor-pointer">
                      <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0"><Bell className="h-4 w-4 text-blue-500" /></div>
                      <div className="flex-1 min-w-0">
                        <Label htmlFor="admin-front-notifications" className="text-sm font-medium cursor-pointer">{t("admin.settings.popup_notifications")}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("admin.settings.popup_hint")}</p>
                      </div>
                      <Switch
                        id="admin-front-notifications"
                        checked={settings.adminFrontNotificationsEnabled ?? true}
                        onCheckedChange={(checked: boolean) => setSettings((s) => s ? { ...s, adminFrontNotificationsEnabled: checked === true } : s)}
                      />
                    </label>
                    <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-white/5 hover:border-white/10 transition-colors cursor-pointer">
                      <div className="h-9 w-9 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0"><Sparkles className="h-4 w-4 text-indigo-500" /></div>
                      <div className="flex-1 min-w-0">
                        <Label htmlFor="ai-chat-enabled" className="text-sm font-medium cursor-pointer">{t("admin.settings.ai_chat_label")}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("admin.settings.ai_chat_hint")}</p>
                      </div>
                      <Switch
                        id="ai-chat-enabled"
                        checked={settings.aiChatEnabled !== false}
                        onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, aiChatEnabled: checked === true } : s))}
                      />
                    </label>
                  </div>
                </div>

                {/* === Уведомления в Telegram === */}
                <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 via-teal-500/5 to-sky-500/5 p-5 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-cyan-500/20 flex items-center justify-center"><Send className="h-4 w-4 text-cyan-500" /></div>
                    <h3 className="text-base font-semibold">Уведомления в Telegram-группу</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Бот шлёт системные уведомления (новые клиенты, оплаты, тикеты, бэкапы) в указанную группу. Если группа без тем — всё в общий чат, иначе можно разрулить по топикам ниже.</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">ID группы</Label>
                    <Input
                      value={settings.notificationTelegramGroupId ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, notificationTelegramGroupId: e.target.value.trim() || null } : s))}
                      placeholder="-1001234567890"
                    />
                    <p className="text-[11px] text-muted-foreground">{t("admin.settings.notification_group_hint")}</p>
                  </div>
                  {settings.notificationTelegramGroupId?.trim() && (
                    <div className="rounded-xl border border-white/10 bg-card/40 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-6 rounded-full bg-gradient-to-r from-cyan-500 to-teal-500" />
                        <p className="text-sm font-medium">{t("admin.settings.topics")}</p>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t("admin.settings.topics_hint")}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_new_clients")}</Label>
                          <Input
                            value={settings.notificationTopicNewClients ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicNewClients: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_payments")}</Label>
                          <Input
                            value={settings.notificationTopicPayments ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicPayments: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_tickets")}</Label>
                          <Input
                            value={settings.notificationTopicTickets ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicTickets: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_backups")}</Label>
                          <Input
                            value={settings.notificationTopicBackups ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicBackups: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {/* === Брендинг === */}
                <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/5 via-violet-500/5 to-fuchsia-500/5 p-5 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-purple-500/20 flex items-center justify-center"><Building className="h-4 w-4 text-purple-500" /></div>
                    <h3 className="text-base font-semibold">Брендинг</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Имя сервиса, логотипы, фавикон, публичный URL — всё что видит клиент в кабинете и боте.</p>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.settings.service_name")}</Label>
                    <Input
                      value={settings.serviceName}
                      onChange={(e) => setSettings((s) => (s ? { ...s, serviceName: e.target.value } : s))}
                    />
                    <p className="text-[11px] text-muted-foreground">{t("admin.settings.service_name_hint")}</p>
                  </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.logo")}</Label>
                  {settings.logo ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.logo} alt={t("admin.settings.logo_alt")} className="h-12 object-contain rounded border" />
                      <div className="flex gap-2">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4">{t("admin.settings.upload_another")}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = () => setSettings((s) => (s ? { ...s, logo: r.result as string } : s));
                              r.readAsDataURL(f);
                            }}
                          />
                        </Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, logo: null } : s))}>
                          {t("admin.settings.delete")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="cursor-pointer">
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent">{t("admin.settings.upload_logo")}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setSettings((s) => (s ? { ...s, logo: r.result as string } : s));
                            r.readAsDataURL(f);
                          }}
                        />
                      </Label>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{t("admin.settings.logo_hint")}</p>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.bot_logo")}</Label>
                  {settings.logoBot ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.logoBot} alt={t("admin.settings.bot_logo_alt")} className="h-12 object-contain rounded border" />
                      <div className="flex gap-2">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4">{t("admin.settings.upload_another")}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = () => setSettings((s) => (s ? { ...s, logoBot: r.result as string } : s));
                              r.readAsDataURL(f);
                            }}
                          />
                        </Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, logoBot: null } : s))}>
                          {t("admin.settings.delete")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="cursor-pointer">
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent">{t("admin.settings.upload_bot_logo")}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setSettings((s) => (s ? { ...s, logoBot: r.result as string } : s));
                            r.readAsDataURL(f);
                          }}
                        />
                      </Label>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{t("admin.settings.bot_logo_hint")}</p>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.favicon")}</Label>
                  {settings.favicon ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.favicon} alt="Favicon" className="h-8 w-8 object-contain rounded border" />
                      <div className="flex gap-2">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4">{t("admin.settings.upload_another")}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = () => setSettings((s) => (s ? { ...s, favicon: r.result as string } : s));
                              r.readAsDataURL(f);
                            }}
                          />
                        </Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, favicon: null } : s))}>
                          {t("admin.settings.delete")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="cursor-pointer">
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent">{t("admin.settings.upload_favicon")}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setSettings((s) => (s ? { ...s, favicon: r.result as string } : s));
                            r.readAsDataURL(f);
                          }}
                        />
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.favicon_hint")}</p>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.app_url")}</Label>
                  <Input
                    value={settings.publicAppUrl ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, publicAppUrl: e.target.value || null } : s))}
                    placeholder="https://example.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.app_url_hint")}
                  </p>
                </div>

                {/* Cabinet design selector — переключение между Classic и Stealth UI кабинета */}
                <div className="space-y-2">
                  <Label>Дизайн мини-аппа клиента</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { v: "classic", title: "Classic", desc: "Текущий glass-дизайн с настройкой темы и акцента", swatch: "from-primary/30 to-purple-500/20" },
                      { v: "stealth", title: "Stealth", desc: "Тёмный неон с red-акцентом, network-фоном и stadium-кнопками", swatch: "from-rose-500/40 to-orange-500/30" },
                    ] as const).map((d) => {
                      const active = (settings.cabinetDesign ?? "classic") === d.v;
                      return (
                        <button
                          key={d.v}
                          type="button"
                          onClick={() => setSettings((s) => (s ? { ...s, cabinetDesign: d.v } : s))}
                          className={`relative overflow-hidden rounded-2xl border p-4 text-left transition-all ${active ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-white/10 hover:border-white/30 bg-card/40"}`}
                        >
                          <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${d.swatch}`} />
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-base font-semibold tracking-tight">{d.title}</span>
                            {active && <span className="text-[10px] font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-md px-1.5 py-0.5">Активно</span>}
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{d.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Выбранный дизайн применится ко всем клиентам при следующем открытии кабинета. Админ-панель не затрагивается.
                  </p>
                  <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-card/30 p-3 mt-2 cursor-pointer hover:bg-card/50 transition-colors">
                    <Switch
                      checked={settings.cabinetDesignApplyInBrowser ?? false}
                      onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, cabinetDesignApplyInBrowser: checked === true } : s))}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">Применять также в обычном браузере</div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        По умолчанию выбранный дизайн используется только в Telegram Mini App. В обычном браузере (web кабинет) клиенты видят Classic.
                        Включи если хочешь чтобы Stealth применялся и на сайте.
                      </p>
                    </div>
                  </label>
                </div>
                </div>
                {/* === Локализация === */}
                <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-yellow-500/5 p-5 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-amber-500/20 flex items-center justify-center"><LanguagesIcon className="h-4 w-4 text-amber-500" /></div>
                    <h3 className="text-base font-semibold">Локализация</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Языки и валюты, доступные клиенту. Звёздочка ★ — язык/валюта по умолчанию для новых пользователей.</p>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.settings.languages")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const preset = installedLangCodes.length ? installedLangCodes : FALLBACK_LANGS;
                      const defaultLang = (settings.defaultLanguage && preset.includes(settings.defaultLanguage) ? settings.defaultLanguage : preset[0]) ?? "";
                      return preset.map((lang) => {
                        const isActive = settings.activeLanguages.includes(lang);
                        const isDefault = lang === defaultLang;
                        const displayName = LANG_NAMES[lang] ?? lang.toUpperCase();
                        return (
                          <Button
                            key={lang}
                            type="button"
                            variant={isActive ? "default" : "outline"}
                            size="sm"
                            title={displayName}
                            onClick={() =>
                              setSettings((s) => {
                                if (!s) return s;
                                const next = isActive
                                  ? s.activeLanguages.filter((x) => x !== lang)
                                  : [...s.activeLanguages, lang].filter((x) => preset.includes(x)).sort();
                                const defaultLang = (s.defaultLanguage && next.includes(s.defaultLanguage) ? s.defaultLanguage : next[0]) ?? "";
                                return { ...s, activeLanguages: next, defaultLanguage: defaultLang };
                              })
                            }
                          >
                            {lang.toUpperCase()}
                            {isActive && isDefault && " ★"}
                          </Button>
                        );
                      });
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.languages_hint", "Список языков формируется из раздела «Языки». Добавьте пакет там, чтобы включить новый язык здесь.")}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="text-xs text-muted-foreground">{t("admin.settings.default_language")}</Label>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={(() => {
                        const active = settings.activeLanguages.length ? settings.activeLanguages : installedLangCodes;
                        return (settings.defaultLanguage && active.includes(settings.defaultLanguage) ? settings.defaultLanguage : active[0]) ?? "";
                      })()}
                      onChange={(e) => setSettings((s) => s ? { ...s, defaultLanguage: e.target.value } : s)}
                    >
                      {(settings.activeLanguages.length ? settings.activeLanguages : installedLangCodes).map((l) => (
                        <option key={l} value={l}>{(LANG_NAMES[l] ?? l.toUpperCase())} ({l})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.currencies")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const preset = ["usd", "rub"];
                      const defaultCurr = (settings.defaultCurrency && preset.includes(settings.defaultCurrency) ? settings.defaultCurrency : preset[0]) ?? "";
                      return preset.map((curr) => {
                        const isActive = settings.activeCurrencies.includes(curr);
                        const isDefault = curr === defaultCurr;
                        return (
                          <Button
                            key={curr}
                            type="button"
                            variant={isActive ? "default" : "outline"}
                            size="sm"
                            onClick={() =>
                              setSettings((s) => {
                                if (!s) return s;
                                const next = isActive
                                  ? s.activeCurrencies.filter((x) => x !== curr)
                                  : [...s.activeCurrencies, curr].filter((x) => preset.includes(x)).sort();
                                const defaultCurr = (s.defaultCurrency && next.includes(s.defaultCurrency) ? s.defaultCurrency : next[0]) ?? "";
                                return { ...s, activeCurrencies: next, defaultCurrency: defaultCurr };
                              })
                            }
                          >
                            {curr.toUpperCase()}
                            {isActive && isDefault && " ★"}
                          </Button>
                        );
                      });
                    })()}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="text-xs text-muted-foreground">{t("admin.settings.default_currency")}</Label>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={(settings.defaultCurrency && ALLOWED_CURRENCIES.includes(settings.defaultCurrency) ? settings.defaultCurrency : ALLOWED_CURRENCIES[0]) ?? ""}
                      onChange={(e) => setSettings((s) => s ? { ...s, defaultCurrency: e.target.value } : s)}
                    >
                      {ALLOWED_CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                </div>
                </div>
                {/* === Безопасность === */}
                <div className="rounded-2xl border border-rose-500/20 bg-gradient-to-br from-rose-500/5 via-red-500/5 to-pink-500/5 p-5 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-rose-500/20 flex items-center justify-center"><Shield className="h-4 w-4 text-rose-500" /></div>
                    <h3 className="text-base font-semibold">{t("admin.settings.security")}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("admin.settings.2fa_hint")}</p>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-muted/40 border">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-primary/10 text-primary">
                        <KeyRound className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground mb-0.5">2FA</p>
                        <p className="font-medium text-sm truncate">{t("admin.settings.2fa_multi_level")}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {state.admin?.totpEnabled ? (
                        <>
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-green-500/20 text-green-700 dark:text-green-400">{t("admin.settings.2fa_enabled")}</span>
                          <Button type="button" variant="outline" size="sm" className="border-red-500/50 text-red-600 hover:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/20" onClick={openTwoFaDisable}>{t("admin.settings.2fa_disable")}</Button>
                        </>
                      ) : (
                        <Button type="button" variant="outline" size="sm" onClick={openTwoFaEnable}>{t("admin.settings.2fa_enable")}</Button>
                      )}
                    </div>
                  </div>
                </div>

                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving}>
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>
            <MarketplaceSettingsCard />
          </TabsContent>

          <TabsContent value="bot">
            <Card className="overflow-hidden border-white/10">
              <div className="relative bg-gradient-to-br from-sky-500/10 via-indigo-500/10 to-fuchsia-500/10 p-6 sm:p-8 border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 via-transparent to-fuchsia-500/5 pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500/30 via-indigo-500/20 to-fuchsia-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                    <Bot className="h-7 w-7 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-sky-500 via-indigo-500 to-fuchsia-500">
                      Настройки Telegram-бота
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                      Главное меню, тексты экранов, эмодзи, поведение и ссылки. Изменения подхватываются ботом автоматически после сохранения.
                    </p>
                  </div>
                </div>
              </div>
              <CardContent className="p-4 sm:p-6 space-y-6">
                <Tabs value={botSubTab} onValueChange={(v) => setBotSubTab(v as typeof botSubTab)}>
                  <TabsList className="w-full grid grid-cols-2 sm:grid-cols-5 gap-1.5 p-1.5 h-auto bg-muted/40 rounded-2xl border">
                    <TabsTrigger value="menu" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-sky-500 data-[state=active]:to-blue-500 data-[state=active]:text-white data-[state=active]:shadow-md">
                      <Layers className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Меню</span>
                    </TabsTrigger>
                    <TabsTrigger value="texts" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-md">
                      <MessageSquare className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Тексты</span>
                    </TabsTrigger>
                    <TabsTrigger value="emoji" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500 data-[state=active]:to-orange-500 data-[state=active]:text-white data-[state=active]:shadow-md">
                      <Smile className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Эмодзи</span>
                    </TabsTrigger>
                    <TabsTrigger value="behavior" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-md">
                      <Sliders className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Поведение</span>
                    </TabsTrigger>
                    <TabsTrigger value="links" className="gap-2 py-2.5 px-3 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-rose-500 data-[state=active]:to-pink-500 data-[state=active]:text-white data-[state=active]:shadow-md">
                      <Link2 className="h-4 w-4 shrink-0" /><span className="text-xs sm:text-sm">Ссылки</span>
                    </TabsTrigger>
                  </TabsList>

                  {/* === ВКЛАДКА: МЕНЮ === */}
                  <TabsContent value="menu" className="space-y-5 mt-5">
                    <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/5 via-blue-500/5 to-indigo-500/5 p-5 space-y-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-sky-500/20 flex items-center justify-center"><ArrowLeftRight className="h-4 w-4 text-sky-500" /></div>
                        <h3 className="text-base font-semibold">Кнопка возврата</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">Текст кнопки, которая возвращает пользователя в предыдущее меню. Появляется почти на всех экранах бота.</p>
                      <Input
                        value={settings.botBackLabel ?? "◀️ В меню"}
                        onChange={(e) => setSettings((s) => (s ? { ...s, botBackLabel: e.target.value || "◀️ В меню" } : s))}
                        placeholder="◀️ В меню"
                      />
                    </div>
                    <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/5 via-blue-500/5 to-indigo-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-blue-500/20 flex items-center justify-center"><Layers className="h-4 w-4 text-blue-500" /></div>
                        <h3 className="text-base font-semibold">Кнопки главного меню</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">Переименуй, скрой или поменяй порядок кнопок главного меню. Каждой кнопке можно задать иконку (эмодзи), цвет и режим «во всю ширину».</p>
                      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-background/40 border border-white/5">
                        <Label htmlFor="bot-buttons-per-row" className="text-sm font-medium">Кнопок в ряд:</Label>
                        <select
                          id="bot-buttons-per-row"
                          className="flex h-9 rounded-lg border border-input bg-background px-3 py-1 text-sm"
                          value={settings.botButtonsPerRow ?? 1}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, botButtonsPerRow: e.target.value === "2" ? 2 : 1 } : s))
                          }
                        >
                          <option value={1}>1 — по одной</option>
                          <option value={2}>2 — парами</option>
                        </select>
                        <span className="text-xs text-muted-foreground">Глобально для всего меню (отдельные кнопки можно вытолкнуть в свою строку флагом ниже)</span>
                      </div>
                      <div className="space-y-2">
                        {[...(settings.botButtons ?? DEFAULT_BOT_BUTTONS)]
                          .sort((a, b) => a.order - b.order)
                          .map((btn, idx) => (
                            <div key={btn.id} className={`group rounded-xl border bg-card/60 p-3 transition-all ${btn.visible ? "border-white/10" : "border-white/5 opacity-50"}`}>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary text-[10px] font-bold">{idx + 1}</span>
                                <span className={`h-3 w-3 rounded-full ${BOT_STYLE_OPTIONS.find((o) => o.value === (btn.style ?? ""))?.swatch ?? "bg-muted"} shrink-0 ring-2 ring-white/10`} title={BOT_STYLE_OPTIONS.find((o) => o.value === (btn.style ?? ""))?.label ?? "По умолчанию"} />
                                <span className="text-sm font-medium flex-1 truncate">{BOT_BUTTON_HUMAN_NAMES[btn.id] ?? btn.id}</span>
                                <div className="flex items-center gap-1.5">
                                  <Switch
                                    checked={btn.visible}
                                    onCheckedChange={(checked: boolean) =>
                                      setSettings((s) => {
                                        if (!s?.botButtons) return s;
                                        return { ...s, botButtons: s.botButtons.map((b) => b.id === btn.id ? { ...b, visible: checked === true } : b) };
                                      })
                                    }
                                  />
                                  <Label className="text-xs text-muted-foreground cursor-pointer">{btn.visible ? "Виден" : "Скрыт"}</Label>
                                </div>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-[100px_1fr_140px_140px_auto]">
                                <div className="space-y-1">
                                  <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Порядок</Label>
                                  <Input
                                    className="h-9"
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={btn.order}
                                    onChange={(e) =>
                                      setSettings((s) => {
                                        if (!s?.botButtons) return s;
                                        const v = parseFloat(e.target.value.replace(",", "."));
                                        if (!Number.isFinite(v) || v < 0) return s;
                                        return { ...s, botButtons: s.botButtons.map((b) => b.id === btn.id ? { ...b, order: v } : b) };
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Текст кнопки</Label>
                                  <Input
                                    className="h-9"
                                    value={btn.label}
                                    onChange={(e) =>
                                      setSettings((s) => {
                                        if (!s?.botButtons) return s;
                                        return { ...s, botButtons: s.botButtons.map((b) => b.id === btn.id ? { ...b, label: e.target.value } : b) };
                                      })
                                    }
                                    placeholder={t("admin.settings.bot_button_placeholder")}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Иконка</Label>
                                  <select
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                                    value={btn.emojiKey ?? ""}
                                    onChange={(e) =>
                                      setSettings((s) => {
                                        if (!s?.botButtons) return s;
                                        return { ...s, botButtons: s.botButtons.map((b) => b.id === btn.id ? { ...b, emojiKey: e.target.value } : b) };
                                      })
                                    }
                                  >
                                    <option value="">— нет —</option>
                                    {BOT_EMOJI_KEYS.map((k) => (
                                      <option key={k} value={k}>{BOT_EMOJI_LABELS[k] ?? k}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Цвет</Label>
                                  <select
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                                    value={btn.style ?? ""}
                                    onChange={(e) =>
                                      setSettings((s) => {
                                        if (!s?.botButtons) return s;
                                        return { ...s, botButtons: s.botButtons.map((b) => b.id === btn.id ? { ...b, style: e.target.value } : b) };
                                      })
                                    }
                                  >
                                    {BOT_STYLE_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex items-end gap-1.5 pb-1">
                                  <Switch
                                    id={`onePerRow-${btn.id}`}
                                    checked={btn.onePerRow === true}
                                    onCheckedChange={(checked: boolean) =>
                                      setSettings((s) => {
                                        if (!s?.botButtons) return s;
                                        return { ...s, botButtons: s.botButtons.map((b) => b.id === btn.id ? { ...b, onePerRow: checked === true } : b) };
                                      })
                                    }
                                  />
                                  <Label htmlFor={`onePerRow-${btn.id}`} className="text-xs cursor-pointer whitespace-nowrap">Во всю ширину</Label>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                      <p className="text-xs text-muted-foreground rounded-lg bg-background/40 border border-white/5 p-2.5">
                        💡 «Во всю ширину» вытолкнет кнопку на отдельную строку даже если выбран режим 2 кнопки в ряд. Используй для важных целевых действий.
                      </p>
                    </div>
                  </TabsContent>

                  {/* === ВКЛАДКА: ЭМОДЗИ === */}
                  <TabsContent value="emoji" className="space-y-5 mt-5">
                    <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-rose-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-amber-500/20 flex items-center justify-center"><Smile className="h-4 w-4 text-amber-500" /></div>
                        <h3 className="text-base font-semibold">Эмодзи и премиум-иконки</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_emojis_hint")}</p>
                      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                        <Sparkles className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700 dark:text-amber-300">{t("admin.settings.bot_emojis_premium_warn")}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 overflow-hidden bg-card/40">
                        <div className="grid grid-cols-[1fr_90px_1fr] gap-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-white/10">
                          <div className="py-2.5 px-3">Назначение</div>
                          <div className="py-2.5 px-2 text-center">Unicode</div>
                          <div className="py-2.5 px-3">Premium ID (Telegram)</div>
                        </div>
                        <div className="divide-y divide-white/5">
                          {BOT_EMOJI_KEYS.map((key) => {
                            const raw = (settings.botEmojis ?? {})[key];
                            const entry = typeof raw === "object" && raw !== null ? raw : { unicode: typeof raw === "string" ? raw : undefined, tgEmojiId: undefined };
                            return (
                              <div key={key} className="grid grid-cols-[1fr_90px_1fr] gap-0 items-center hover:bg-muted/20 transition-colors">
                                <div className="py-2 px-3">
                                  <div className="text-sm font-medium">{BOT_EMOJI_LABELS[key] ?? key}</div>
                                  <div className="text-[10px] text-muted-foreground font-mono">{key}</div>
                                </div>
                                <div className="py-2 px-2">
                                  <Input
                                    className="h-9 w-full p-1 text-center text-base"
                                    value={entry.unicode ?? ""}
                                    onChange={(e) =>
                                      setSettings((s) => {
                                        if (!s) return s;
                                        const prev = (s.botEmojis ?? {})[key];
                                        const prevObj = typeof prev === "object" && prev !== null ? prev : { unicode: typeof prev === "string" ? prev : undefined, tgEmojiId: undefined };
                                        return { ...s, botEmojis: { ...(s.botEmojis ?? {}), [key]: { ...prevObj, unicode: e.target.value || undefined } } };
                                      })
                                    }
                                    placeholder="📦"
                                  />
                                </div>
                                <div className="py-2 px-3">
                                  <Input
                                    className="h-9 min-w-0 text-xs font-mono"
                                    value={entry.tgEmojiId ?? ""}
                                    onChange={(e) =>
                                      setSettings((s) => {
                                        if (!s) return s;
                                        const prev = (s.botEmojis ?? {})[key];
                                        const prevObj = typeof prev === "object" && prev !== null ? prev : { unicode: typeof prev === "string" ? prev : undefined, tgEmojiId: undefined };
                                        return { ...s, botEmojis: { ...(s.botEmojis ?? {}), [key]: { ...prevObj, tgEmojiId: e.target.value || undefined } } };
                                      })
                                    }
                                    placeholder="5289722755871162900"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-rose-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-orange-500/20 flex items-center justify-center"><Palette className="h-4 w-4 text-orange-500" /></div>
                        <h3 className="text-base font-semibold">Цвета вторичных кнопок</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_inner_styles_hint")}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {Object.keys(BOT_INNER_STYLE_LABELS).map((key) => {
                          const meta = BOT_INNER_STYLE_LABELS[key]!;
                          const currentVal = (settings.botInnerButtonStyles ?? {})[key] ?? "";
                          const swatch = BOT_STYLE_OPTIONS.find((o) => o.value === currentVal)?.swatch ?? "bg-muted";
                          return (
                            <div key={key} className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-card/40">
                              <div className={`h-3 w-3 rounded-full ${swatch} shrink-0 ring-2 ring-white/10`} />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{meta.label}</div>
                                <div className="text-[11px] text-muted-foreground truncate">{meta.desc}</div>
                              </div>
                              <select
                                className="flex h-9 w-32 shrink-0 rounded-md border border-input bg-background px-2 py-1 text-sm"
                                value={currentVal}
                                onChange={(e) =>
                                  setSettings((s) => {
                                    if (!s) return s;
                                    const next = { ...DEFAULT_BOT_INNER_STYLES, ...(s.botInnerButtonStyles ?? {}), [key]: e.target.value };
                                    return { ...s, botInnerButtonStyles: next };
                                  })
                                }
                              >
                                {BOT_STYLE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </TabsContent>

                  {/* === ВКЛАДКА: ТЕКСТЫ === */}
                  <TabsContent value="texts" className="space-y-5 mt-5">
                    {/* ═══ Приветственное сообщение при /start ═══ */}
                    <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-teal-500/5 to-cyan-500/5 p-5 space-y-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-xl bg-emerald-500/20 flex items-center justify-center">✨</div>
                          <div>
                            <h3 className="text-base font-semibold">Приветственное сообщение</h3>
                            <p className="text-xs text-muted-foreground">Показывается клиенту при первом /start. Картинка-баннер + текст + кнопка «Войти».</p>
                          </div>
                        </div>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <Switch
                            checked={settings.botWelcomeEnabled ?? false}
                            onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, botWelcomeEnabled: checked === true } : s))}
                          />
                          <span className="text-sm">Включить</span>
                        </label>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-card/40 p-4 space-y-3">
                        <div className="space-y-2">
                          <Label className="text-xs">Текст приветствия</Label>
                          <textarea
                            className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={settings.botWelcomeText ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, botWelcomeText: e.target.value || null } : s))}
                            placeholder={"Добро пожаловать в VPN!\n\n🚀 Высокая скорость\n🚫 Удаляем рекламу\n♾ Огромный запас трафика\n👥 Платим 30% с платежей друзей"}
                            maxLength={4000}
                          />
                          <p className="text-[10px] text-muted-foreground">До 4000 символов. Эмодзи поддерживаются. Если задана картинка — текст идёт как caption (макс. 1024 символа в Telegram).</p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Картинка-баннер (PNG / JPG / GIF / WEBP, до 5 МБ)</Label>
                          <div className="flex items-center gap-3 flex-wrap">
                            {settings.botWelcomeImage && (
                              <img
                                src={settings.botWelcomeImage}
                                alt="welcome"
                                className="h-28 w-auto rounded-md border border-white/10 object-cover"
                              />
                            )}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/gif,image/webp"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                if (f.size > 5_000_000) {
                                  alert("Файл больше 5 МБ — попробуйте сжать.");
                                  return;
                                }
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const url = String(reader.result || "");
                                  setSettings((s) => (s ? { ...s, botWelcomeImage: url } : s));
                                };
                                reader.readAsDataURL(f);
                              }}
                              className="text-xs"
                            />
                            {settings.botWelcomeImage && (
                              <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, botWelcomeImage: null } : s))}>
                                Убрать картинку
                              </Button>
                            )}
                          </div>
                        </div>
                        <label className="inline-flex items-center gap-2 cursor-pointer text-xs pt-2 border-t border-white/5">
                          <Switch
                            checked={settings.botWelcomeShowOnce ?? true}
                            onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, botWelcomeShowOnce: checked === true } : s))}
                          />
                          <span>Показывать только при первом /start (пока клиент не нажал «Войти в кабинет»)</span>
                        </label>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-fuchsia-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-violet-500/20 flex items-center justify-center"><MessageSquare className="h-4 w-4 text-violet-500" /></div>
                        <h3 className="text-base font-semibold">Главное меню — содержимое</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_welcome_hint")}</p>
                      <div className="rounded-xl border border-white/10 bg-card/40 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Eye className="h-4 w-4 text-violet-500" />
                            <Label className="text-sm font-medium">Какие строки показывать</Label>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setSettings((s) => (s ? { ...s, botMenuLineVisibility: { ...DEFAULT_BOT_MENU_LINE_VISIBILITY } } : s))}
                          >
                            <RotateCw className="h-3.5 w-3.5 mr-1" />Сброс
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {Object.keys(DEFAULT_BOT_MENU_LINE_VISIBILITY).map((key) => {
                            const visible = (settings.botMenuLineVisibility ?? DEFAULT_BOT_MENU_LINE_VISIBILITY)[key] !== false;
                            return (
                              <label key={key} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/30 cursor-pointer transition-colors">
                                <Switch
                                  checked={visible}
                                  onCheckedChange={(checked: boolean) =>
                                    setSettings((s) =>
                                      s ? { ...s, botMenuLineVisibility: { ...(s.botMenuLineVisibility ?? DEFAULT_BOT_MENU_LINE_VISIBILITY), [key]: checked === true } } : s
                                    )
                                  }
                                />
                                <span className="text-sm">{BOT_MENU_LINE_LABELS[key] ?? key}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button type="button" variant="outline" className="w-full justify-between rounded-xl">
                            <span className="flex items-center gap-2"><FileText className="h-4 w-4" />Тексты строк меню</span>
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pt-3 space-y-3 border-t mt-3">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setSettings((s) => (s ? { ...s, botMenuTexts: { ...DEFAULT_BOT_MENU_TEXTS } } : s))}
                            >
                              <RotateCw className="h-3.5 w-3.5 mr-1" />Сбросить тексты
                            </Button>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {Object.keys(DEFAULT_BOT_MENU_TEXTS).map((key) => (
                                <div key={key} className="space-y-1">
                                  <Label className="text-xs">{BOT_MENU_TEXT_LABELS[key] ?? key}</Label>
                                  <Input
                                    value={settings.botMenuTexts?.[key] ?? DEFAULT_BOT_MENU_TEXTS[key] ?? ""}
                                    onChange={(e) =>
                                      setSettings((s) =>
                                        s ? { ...s, botMenuTexts: { ...(s.botMenuTexts ?? DEFAULT_BOT_MENU_TEXTS), [key]: e.target.value } } : s
                                      )
                                    }
                                    placeholder={DEFAULT_BOT_MENU_TEXTS[key]}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>

                    <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-fuchsia-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-purple-500/20 flex items-center justify-center"><Package className="h-4 w-4 text-purple-500" /></div>
                        <h3 className="text-base font-semibold">Экран «Тарифы»</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_tariffs_hint")}</p>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Шаблон сообщения</Label>
                        <Textarea
                          rows={6}
                          value={settings.botTariffsText ?? DEFAULT_BOT_TARIFFS_TEXT}
                          onChange={(e) => setSettings((s) => (s ? { ...s, botTariffsText: e.target.value } : s))}
                          placeholder={DEFAULT_BOT_TARIFFS_TEXT}
                          className="font-mono text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground">Доступные плейсхолдеры: <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{CATEGORY}}`}</code> — название категории, <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{TARIFFS}}`}</code> — список тарифов</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-card/40 p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm font-medium">Поля в карточке тарифа</Label>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setSettings((s) => (s ? { ...s, botTariffsFields: { ...DEFAULT_BOT_TARIFF_FIELDS } } : s))}
                          >
                            <RotateCw className="h-3.5 w-3.5 mr-1" />Сброс
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {Object.keys(DEFAULT_BOT_TARIFF_FIELDS).map((key) => {
                            const enabled = (settings.botTariffsFields ?? DEFAULT_BOT_TARIFF_FIELDS)[key] !== false;
                            return (
                              <label key={key} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/30 cursor-pointer transition-colors">
                                <Switch
                                  checked={enabled}
                                  onCheckedChange={(checked: boolean) =>
                                    setSettings((s) =>
                                      s ? { ...s, botTariffsFields: { ...(s.botTariffsFields ?? DEFAULT_BOT_TARIFF_FIELDS), [key]: checked === true } } : s
                                    )
                                  }
                                />
                                <span className="text-sm">{BOT_TARIFF_FIELD_LABELS[key] ?? key}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-fuchsia-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-fuchsia-500/20 flex items-center justify-center"><CreditCard className="h-4 w-4 text-fuchsia-500" /></div>
                        <h3 className="text-base font-semibold">Окно оплаты</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_payment_hint")}</p>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Шаблон сообщения оплаты</Label>
                        <Textarea
                          rows={5}
                          value={settings.botPaymentText ?? DEFAULT_BOT_PAYMENT_TEXT}
                          onChange={(e) => setSettings((s) => (s ? { ...s, botPaymentText: e.target.value } : s))}
                          placeholder={DEFAULT_BOT_PAYMENT_TEXT}
                          className="font-mono text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground">Плейсхолдеры: <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{NAME}}`}</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{PRICE}}`}</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{AMOUNT}}`}</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{CURRENCY}}`}</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">{`{{ACTION}}`}</code></p>
                      </div>
                    </div>
                  </TabsContent>
                  {/* === ВКЛАДКА: ПОВЕДЕНИЕ === */}
                  <TabsContent value="behavior" className="space-y-5 mt-5">
                    <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-teal-500/5 to-cyan-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-emerald-500/20 flex items-center justify-center"><Megaphone className="h-4 w-4 text-emerald-500" /></div>
                        <h3 className="text-base font-semibold">Инфо-блок (объявления)</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Произвольный текст, который показывается в главном меню бота и в кабинете клиента.
                        Используй для объявлений тех. работ, акций, контактов поддержки. Скрывается если поле пустое.
                      </p>
                      <Textarea
                        value={settings.botInfoBlock ?? ""}
                        onChange={(e) =>
                          setSettings((s) => (s ? { ...s, botInfoBlock: e.target.value.length ? e.target.value : null } : s))
                        }
                        rows={4}
                        maxLength={2000}
                        placeholder="📢 Тех. работы 12.05 с 03:00 до 05:00 МСК&#10;💬 Поддержка: @support_bot"
                      />
                      <p className="text-[11px] text-muted-foreground text-right">{(settings.botInfoBlock ?? "").length} / 2000</p>
                    </div>

                    <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-teal-500/5 to-cyan-500/5 p-5 space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="h-8 w-8 rounded-xl bg-teal-500/20 flex items-center justify-center shrink-0"><Trash className="h-4 w-4 text-teal-500" /></div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-semibold mb-1">Авто-удаление нераспознанных сообщений</h3>
                          <p className="text-xs text-muted-foreground">
                            Бот удаляет сообщения, которые не команды и не активный ввод (стикеры, случайный текст, фото).
                            Чат остаётся чистым. Требует право «Delete messages» у бота.
                          </p>
                        </div>
                        <Switch
                          checked={!!settings.botAutoDeleteUnknownMessages}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, botAutoDeleteUnknownMessages: checked === true } : s))
                          }
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-teal-500/5 to-cyan-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-cyan-500/20 flex items-center justify-center"><Bell className="h-4 w-4 text-cyan-500" /></div>
                        <h3 className="text-base font-semibold">Обязательная подписка на канал</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_force_hint")}</p>
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-background/40 border border-white/5">
                        <Switch
                          checked={!!settings.forceSubscribeEnabled}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, forceSubscribeEnabled: checked === true } : s))
                          }
                        />
                        <Label className="text-sm">{t("admin.settings.bot_check_subscribe")}</Label>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">ID канала или @username</Label>
                        <Input
                          value={settings.forceSubscribeChannelId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, forceSubscribeChannelId: e.target.value || null } : s))}
                          placeholder={t("admin.settings.bot_channel_placeholder")}
                          disabled={!settings.forceSubscribeEnabled}
                        />
                        <p className="text-[11px] text-muted-foreground">{t("admin.settings.bot_channel_hint")}</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Сообщение для не подписанных</Label>
                        <Input
                          value={settings.forceSubscribeMessage ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, forceSubscribeMessage: e.target.value || null } : s))}
                          placeholder={t("admin.settings.bot_unsub_placeholder")}
                          disabled={!settings.forceSubscribeEnabled}
                        />
                        <p className="text-[11px] text-muted-foreground">{t("admin.settings.bot_unsub_hint")}</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/5 via-rose-500/5 to-pink-500/5 p-5 space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="h-8 w-8 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0"><Shield className="h-4 w-4 text-red-500" /></div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-semibold mb-1">Community Blacklist</h3>
                          <p className="text-xs text-muted-foreground">{t("admin.settings.bot_blacklist_hint")}</p>
                        </div>
                        <Switch
                          checked={!!settings.blacklistEnabled}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, blacklistEnabled: checked === true } : s))
                          }
                        />
                      </div>
                    </div>
                  </TabsContent>

                  {/* === ВКЛАДКА: ССЫЛКИ === */}
                  <TabsContent value="links" className="space-y-5 mt-5">
                    <div className="rounded-2xl border border-rose-500/20 bg-gradient-to-br from-rose-500/5 via-pink-500/5 to-fuchsia-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-rose-500/20 flex items-center justify-center"><Link2 className="h-4 w-4 text-rose-500" /></div>
                        <h3 className="text-base font-semibold">Ссылки и поддержка</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.bot_support_hint")}</p>
                      <div className="grid gap-3">
                        <div className="space-y-1.5 p-4 rounded-xl border border-white/10 bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <MessageCircle className="h-4 w-4 text-rose-500" />
                            <Label className="text-sm font-medium">Техническая поддержка</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Username аккаунта поддержки или t.me-ссылка. Появляется в кнопке «Поддержка» в главном меню.</p>
                          <Input
                            value={settings.supportLink ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, supportLink: e.target.value || undefined } : s))}
                            placeholder={t("admin.settings.bot_support_placeholder")}
                          />
                        </div>
                        <div className="space-y-1.5 p-4 rounded-xl border border-white/10 bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-pink-500" />
                            <Label className="text-sm font-medium">Пользовательское соглашение</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Telegra.ph или внешняя страница с правилами использования сервиса.</p>
                          <Input
                            value={settings.agreementLink ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, agreementLink: e.target.value || undefined } : s))}
                            placeholder="https://telegra.ph/..."
                          />
                        </div>
                        <div className="space-y-1.5 p-4 rounded-xl border border-white/10 bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-fuchsia-500" />
                            <Label className="text-sm font-medium">Публичная оферта</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Юридическая оферта (особенно нужна при работе через ИП/самозанятость).</p>
                          <Input
                            value={settings.offerLink ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, offerLink: e.target.value || undefined } : s))}
                            placeholder="https://telegra.ph/..."
                          />
                        </div>
                        <div className="space-y-1.5 p-4 rounded-xl border border-white/10 bg-card/40">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-purple-500" />
                            <Label className="text-sm font-medium">Инструкции по подключению</Label>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">Инструкции для клиентов как подключить VPN на разных устройствах.</p>
                          <Input
                            value={settings.instructionsLink ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, instructionsLink: e.target.value || undefined } : s))}
                            placeholder="https://telegra.ph/..."
                          />
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>

                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving} className="w-full sm:w-auto h-11 px-6 rounded-xl bg-gradient-to-r from-sky-500 via-indigo-500 to-fuchsia-500 hover:opacity-90 text-white font-semibold shadow-lg shadow-primary/20">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trial">
            <Card className="overflow-hidden border-white/10">
              <div className="relative bg-gradient-to-br from-emerald-500/10 via-teal-500/10 to-green-500/10 p-6 sm:p-8 border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-green-500/5 pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500/30 via-teal-500/20 to-green-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                    <Gift className="h-7 w-7 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-500 via-teal-500 to-green-500">
                      {t("admin.settings.trial_title")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.trial_subtitle")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-5 p-4 sm:p-6">
                {/* === Длительность и сервер === */}
                <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-teal-500/5 to-green-500/5 p-5 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-emerald-500/20 flex items-center justify-center"><Gift className="h-4 w-4 text-emerald-500" /></div>
                    <h3 className="text-base font-semibold">Длительность и сервер</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Сколько дней триал длится и через какой Squad-сервер раздавать пробный доступ. Если Squad не выбран — триал не активируется.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.settings.trial_days")}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={settings.trialDays}
                        onChange={(e) => setSettings((s) => (s ? { ...s, trialDays: parseInt(e.target.value, 10) || 0 } : s))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.settings.trial_squad")}</Label>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                        value={settings.trialSquadUuid ?? ""}
                        onChange={(e) => setSettings((s) => s ? { ...s, trialSquadUuid: e.target.value || null } : s)}
                      >
                        <option value="">{t("admin.settings.trial_squad_none")}</option>
                        {squads.map((s) => (
                          <option key={s.uuid} value={s.uuid}>{s.name || s.uuid}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* === Лимиты === */}
                <div className="rounded-2xl border border-teal-500/20 bg-gradient-to-br from-teal-500/5 via-cyan-500/5 to-sky-500/5 p-5 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-teal-500/20 flex items-center justify-center"><Sliders className="h-4 w-4 text-teal-500" /></div>
                    <h3 className="text-base font-semibold">Лимиты на триале</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Ограничение устройств и трафика. Пусто = без лимита.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.settings.trial_device_limit")}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={settings.trialDeviceLimit ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, trialDeviceLimit: e.target.value === "" ? null : parseInt(e.target.value, 10) || 0 } : s))}
                        placeholder={t("admin.settings.trial_no_limit")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.settings.trial_traffic_limit")}</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        value={settings.trialTrafficLimitBytes != null ? (settings.trialTrafficLimitBytes / (1024 ** 3)).toFixed(1) : ""}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          if (v === "") {
                            setSettings((s) => (s ? { ...s, trialTrafficLimitBytes: null } : s));
                            return;
                          }
                          const n = parseFloat(v);
                          if (Number.isNaN(n)) return;
                          setSettings((s) => (s ? { ...s, trialTrafficLimitBytes: Math.round(n * 1024 ** 3) } : s));
                        }}
                        placeholder={t("admin.settings.trial_no_limit")}
                      />
                      <p className="text-[11px] text-muted-foreground">{t("admin.settings.trial_traffic_hint")}</p>
                    </div>
                  </div>
                </div>

                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving} className="w-full sm:w-auto h-11 px-6 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:opacity-90 text-white font-semibold shadow-lg shadow-emerald-500/20">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subpage">
            <Card className="overflow-hidden border-white/10">
              <div className="relative bg-gradient-to-br from-rose-500/10 via-pink-500/10 to-fuchsia-500/10 p-6 sm:p-8 border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 via-transparent to-fuchsia-500/5 pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-rose-500/30 via-pink-500/20 to-fuchsia-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                    <FileJson className="h-7 w-7 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-rose-500 via-pink-500 to-fuchsia-500">
                      {t("admin.settings.subpage_title")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.subpage_editor_hint")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-4 sm:p-6">
                <div className="p-4 rounded-lg border bg-muted/40 mb-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="useRemnaSubscriptionPage"
                      checked={settings.useRemnaSubscriptionPage ?? false}
                      onChange={(e) => setSettings((s) => (s ? { ...s, useRemnaSubscriptionPage: e.target.checked } : s))}
                      className="rounded border"
                    />
                    <Label htmlFor="useRemnaSubscriptionPage" className="cursor-pointer">
                      {t("admin.settings.use_remna_subpage")}
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.subpage_remna_hint")}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        setSaving(true);
                        setMessage("");
                        try {
                          await api.updateSettings(token, { useRemnaSubscriptionPage: settings.useRemnaSubscriptionPage ?? false });
                          setMessage(t("admin.settings.saved"));
                        } catch {
                          setMessage(t("admin.settings.save_error"));
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                    </Button>
                    {message && <span className="text-sm text-muted-foreground">{message}</span>}
                  </div>
                </div>
                <SubscriptionPageEditor
                  currentConfigJson={settings?.subscriptionPageConfig ?? null}
                  defaultConfig={defaultSubpageConfig}
                  onFetchDefault={async () => {
                    const c = await api.getDefaultSubscriptionPageConfig(token);
                    setDefaultSubpageConfig(c ?? null);
                    return c ?? null;
                  }}
                  saving={saving}
                  onSave={async (configJson) => {
                    setSettings((s) => (s ? { ...s, subscriptionPageConfig: configJson } : s));
                    setSaving(true);
                    setMessage("");
                    try {
                      await api.updateSettings(token, { subscriptionPageConfig: configJson });
                      setMessage(t("admin.settings.saved"));
                    } catch {
                      setMessage(t("admin.settings.save_error"));
                    } finally {
                      setSaving(false);
                    }
                  }}
                />
                {message && <p className="text-sm text-muted-foreground mt-4">{message}</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="referral">
            <Card className="overflow-hidden border-white/10">
              <div className="relative bg-gradient-to-br from-violet-500/10 via-purple-500/10 to-fuchsia-500/10 p-6 sm:p-8 border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-fuchsia-500/5 pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/30 via-purple-500/20 to-fuchsia-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                    <Users className="h-7 w-7 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500">
                      {t("admin.settings.referral_title")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.referral_subtitle")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-5 p-4 sm:p-6">
                <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-fuchsia-500/5 p-5 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-violet-500/20 flex items-center justify-center"><Network className="h-4 w-4 text-violet-500" /></div>
                    <h3 className="text-base font-semibold">3-уровневая реферальная сеть</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Процент с каждого пополнения, который начисляется на баланс реферера. Уровень 1 — прямой реф; уровень 2 — реф вашего рефа; уровень 3 — реф второго уровня.</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-violet-500/30 bg-card/40 p-4 space-y-2 relative overflow-hidden">
                      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-gradient-to-br from-violet-500/20 to-violet-500/5 blur-xl" />
                      <div className="relative flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-violet-500/15 text-violet-500 text-xs font-bold">L1</span>
                        <Label className="text-sm font-medium">{t("admin.settings.referral_level_1")}</Label>
                      </div>
                      <div className="relative flex items-baseline gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="text-2xl font-bold tabular-nums h-14"
                          value={settings.defaultReferralPercent ?? 30}
                          onChange={(e) => setSettings((s) => (s ? { ...s, defaultReferralPercent: Number(e.target.value) || 0 } : s))}
                        />
                        <span className="text-2xl font-bold text-violet-500">%</span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-purple-500/30 bg-card/40 p-4 space-y-2 relative overflow-hidden">
                      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-purple-500/5 blur-xl" />
                      <div className="relative flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-purple-500/15 text-purple-500 text-xs font-bold">L2</span>
                        <Label className="text-sm font-medium">{t("admin.settings.referral_level_2")}</Label>
                      </div>
                      <div className="relative flex items-baseline gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="text-2xl font-bold tabular-nums h-14"
                          value={settings.referralPercentLevel2 ?? 10}
                          onChange={(e) => setSettings((s) => (s ? { ...s, referralPercentLevel2: Number(e.target.value) || 0 } : s))}
                        />
                        <span className="text-2xl font-bold text-purple-500">%</span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-fuchsia-500/30 bg-card/40 p-4 space-y-2 relative overflow-hidden">
                      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-gradient-to-br from-fuchsia-500/20 to-fuchsia-500/5 blur-xl" />
                      <div className="relative flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-fuchsia-500/15 text-fuchsia-500 text-xs font-bold">L3</span>
                        <Label className="text-sm font-medium">{t("admin.settings.referral_level_3")}</Label>
                      </div>
                      <div className="relative flex items-baseline gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="text-2xl font-bold tabular-nums h-14"
                          value={settings.referralPercentLevel3 ?? 10}
                          onChange={(e) => setSettings((s) => (s ? { ...s, referralPercentLevel3: Number(e.target.value) || 0 } : s))}
                        />
                        <span className="text-2xl font-bold text-fuchsia-500">%</span>
                      </div>
                    </div>
                  </div>
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving} className="w-full sm:w-auto h-11 px-6 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 text-white font-semibold shadow-lg shadow-violet-500/20">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments" className="space-y-4">
            <Card className="overflow-hidden border-white/10">
              <div className="relative bg-gradient-to-br from-amber-500/10 via-orange-500/10 to-yellow-500/10 p-6 sm:p-8 border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-yellow-500/5 pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-500/30 via-orange-500/20 to-yellow-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                    <CreditCard className="h-7 w-7 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500">
                      {t("admin.settings.payments_general")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">Платёжные провайдеры, авто-продление подписки, общие настройки оплат.</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-4 p-4 sm:p-6">
                <div className="flex items-center justify-between gap-4 p-4 rounded-xl border bg-card/50">
                  <div className="space-y-1">
                    <Label className="text-base font-semibold">{t("admin.settings.auto_renew")}</Label>
                    <p className="text-sm text-muted-foreground">{t("admin.settings.auto_renew_hint")}</p>
                  </div>
                  <Switch
                    checked={settings.defaultAutoRenewEnabled ?? false}
                    onCheckedChange={(checked) => setSettings(s => s ? { ...s, defaultAutoRenewEnabled: checked } : s)}
                  />
                </div>

                <div className={`flex items-center justify-between gap-4 p-4 rounded-xl border bg-card/50${!settings.yookassaShopId || !settings.yookassaSecretKey || settings.yookassaSecretKey === "********" && !settings.yookassaShopId ? " opacity-50" : ""}`}>
                  <div className="space-y-1">
                    <Label className="text-base font-semibold">{t("admin.settings.yookassa_recurring")}</Label>
                    <p className="text-sm text-muted-foreground">
                      {!settings.yookassaShopId || !settings.yookassaSecretKey
                        ? t("admin.settings.yookassa_recurring_disabled")
                        : t("admin.settings.yookassa_recurring_hint")
                      }
                    </p>
                  </div>
                  <Switch
                    checked={settings.yookassaRecurringEnabled ?? false}
                    disabled={!settings.yookassaShopId || !settings.yookassaSecretKey}
                    onCheckedChange={(checked) => setSettings(s => s ? { ...s, yookassaRecurringEnabled: checked } : s)}
                  />
                </div>

                {/* Настройки автопродления */}
                <div className="space-y-4 p-4 rounded-xl border bg-card/50">
                  <Label className="text-base font-semibold">{t("admin.settings.auto_renew_settings")}</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.renew_days_before")}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        value={settings.autoRenewDaysBeforeExpiry ?? 1}
                        onChange={(e) => setSettings(s => s ? { ...s, autoRenewDaysBeforeExpiry: parseInt(e.target.value) || 1 } : s)}
                      />
                      <p className="text-xs text-muted-foreground">{t("admin.settings.renew_days_hint")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.settings.notify_days_before")}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        value={settings.autoRenewNotifyDaysBefore ?? 3}
                        onChange={(e) => setSettings(s => s ? { ...s, autoRenewNotifyDaysBefore: parseInt(e.target.value) || 3 } : s)}
                      />
                      <p className="text-xs text-muted-foreground">{t("admin.settings.notify_days_hint")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.settings.grace_period")}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={14}
                        value={settings.autoRenewGracePeriodDays ?? 2}
                        onChange={(e) => setSettings(s => s ? { ...s, autoRenewGracePeriodDays: parseInt(e.target.value) || 2 } : s)}
                      />
                      <p className="text-xs text-muted-foreground">{t("admin.settings.grace_period_hint")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.settings.max_retries")}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={settings.autoRenewMaxRetries ?? 3}
                        onChange={(e) => setSettings(s => s ? { ...s, autoRenewMaxRetries: parseInt(e.target.value) || 3 } : s)}
                      />
                      <p className="text-xs text-muted-foreground">{t("admin.settings.max_retries_hint")}</p>
                    </div>
                  </div>
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button onClick={handleSubmit} disabled={saving}>
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>

            {/* Auto-renewal statistics card */}
            {autoRenewStats && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    <CardTitle>{t("admin.settings.auto_renew_stats")}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-2xl font-bold text-green-500">{autoRenewStats.enabled}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.auto_renew_on")}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-2xl font-bold text-muted-foreground">{autoRenewStats.disabled}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.auto_renew_off")}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-2xl font-bold text-yellow-500">{autoRenewStats.retriesInProgress}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        <RotateCw className="inline h-3 w-3 mr-1" />
                        {t("admin.settings.retry_attempts")}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-2xl font-bold">{autoRenewStats.renewalsLast7Days}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.renewals_7d")}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-2xl font-bold">{autoRenewStats.renewalsLast30Days}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.renewals_30d")}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-2xl font-bold text-primary">{autoRenewStats.amountLast30Days.toLocaleString("ru-RU")} {settings?.defaultCurrency === "rub" ? "₽" : "$"}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.amount_30d")}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Порядок и названия платёжных провайдеров ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <GripVertical className="h-5 w-5 text-primary" />
                  <CardTitle>{t("admin.settings.payment_providers_order")}</CardTitle>
                </div>
                <p className="text-sm text-muted-foreground">{t("admin.settings.payment_providers_order_hint")}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {(settings.paymentProviders ?? []).map((prov, idx, arr) => (
                  <div key={prov.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card/50">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={prov.label}
                      onChange={(e) => {
                        const updated = [...arr];
                        updated[idx] = { ...prov, label: e.target.value };
                        setSettings((s) => s ? { ...s, paymentProviders: updated } : s);
                      }}
                      className="flex-1 h-9"
                    />
                    <span className="text-xs text-muted-foreground font-mono shrink-0">{prov.id}</span>
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={() => {
                          if (idx === 0) return;
                          const updated = [...arr];
                          [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
                          updated.forEach((p, i) => { p.sortOrder = i; });
                          setSettings((s) => s ? { ...s, paymentProviders: updated } : s);
                        }}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === arr.length - 1}
                        className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={() => {
                          if (idx === arr.length - 1) return;
                          const updated = [...arr];
                          [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
                          updated.forEach((p, i) => { p.sortOrder = i; });
                          setSettings((s) => s ? { ...s, paymentProviders: updated } : s);
                        }}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button onClick={handleSubmit} disabled={saving}>
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <Collapsible defaultOpen={false} className="group">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-5 w-5 text-primary" />
                          <CardTitle>Platega</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.platega_expand")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t("admin.settings.platega_callback_note")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.platega_callback")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/platega` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/platega` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setPlategaCallbackCopied(true);
                              setTimeout(() => setPlategaCallbackCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {plategaCallbackCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.platega_callback_hint")}</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.platega_merchant")}</Label>
                        <Input
                          value={settings.plategaMerchantId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, plategaMerchantId: e.target.value || null } : s))}
                          placeholder="UUID из ЛК Platega"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.platega_secret")}</Label>
                        <Input
                          type="password"
                          value={settings.plategaSecret ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, plategaSecret: e.target.value || null } : s))}
                          placeholder={t("admin.settings.platega_key_placeholder")}
                        />
                      </div>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 mt-4 space-y-2">
                      <Label className="text-emerald-700 dark:text-emerald-400">🔒 Защита webhook'ов от форджинга</Label>
                      <p className="text-xs text-muted-foreground">
                        Включается автоматически когда заданы <code className="text-[11px]">Merchant ID</code> и <code className="text-[11px]">Secret key</code> выше. Каждый входящий webhook проверяется через Platega API: запрашиваем у них реальный статус транзакции и доверяем только их ответу. Атакер не может подделать ответ от <code className="text-[11px]">app.platega.io</code>, поэтому форджинг невозможен.
                      </p>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Опционально: HMAC подпись (на будущее)</summary>
                        <div className="mt-2 space-y-1.5">
                          <p className="text-muted-foreground">
                            Если когда-нибудь Platega добавит подписание webhook'ов в кабинете — впишешь сюда секрет и все webhook'и без валидной HMAC-SHA256 в <code className="text-[11px]">X-Signature</code> будут отвергаться. <strong>Сейчас в их кабинете такой опции нет — оставь поле пустым.</strong>
                          </p>
                          <Input
                            type="password"
                            value={(settings as { plategaWebhookSecret?: string | null }).plategaWebhookSecret ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, plategaWebhookSecret: e.target.value || null } as typeof s : s))}
                            placeholder="(оставь пустым — Platega не поддерживает HMAC)"
                          />
                        </div>
                      </details>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.settings.payment_methods")}</Label>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.payment_methods_hint")}</p>
                      <div className="rounded-md border divide-y">
                        {(settings.plategaMethods ?? DEFAULT_PLATEGA_METHODS).map((m) => (
                          <div key={m.id} className="flex items-center gap-4 p-3">
                            <Switch
                              id={`platega-method-${m.id}`}
                              checked={m.enabled}
                              onCheckedChange={(checked: boolean) =>
                                setSettings((s) =>
                                  s
                                    ? {
                                        ...s,
                                        plategaMethods: (s.plategaMethods ?? DEFAULT_PLATEGA_METHODS).map((x) =>
                                          x.id === m.id ? { ...x, enabled: checked === true } : x
                                        ),
                                      }
                                    : s
                                )
                              }
                            />
                            <Label htmlFor={`platega-method-${m.id}`} className="shrink-0 w-8 cursor-pointer">
                              {m.id}
                            </Label>
                            <Input
                              className="flex-1"
                              value={m.label}
                              onChange={(e) =>
                                setSettings((s) =>
                                  s
                                    ? {
                                        ...s,
                                        plategaMethods: (s.plategaMethods ?? DEFAULT_PLATEGA_METHODS).map((x) =>
                                          x.id === m.id ? { ...x, label: e.target.value } : x
                                        ),
                                      }
                                    : s
                                )
                              }
                              placeholder={t("admin.settings.platega_btn_placeholder")}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    {message && <p className="text-sm text-muted-foreground">{message}</p>}
                    <Button type="submit" disabled={saving}>
                      {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                    </Button>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>ЮMoney</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.yoomoney_card")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t("admin.settings.yoomoney_register")} <a href="https://yoomoney.ru/myservices/new" target="_blank" rel="noreferrer" className="text-primary underline">yoomoney.ru/myservices/new</a>
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.yoomoney_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/yoomoney` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/yoomoney` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setYoomoneyWebhookCopied(true);
                              setTimeout(() => setYoomoneyWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {yoomoneyWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.yoomoney_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.yoomoney_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.yoomoney_wallet")}</Label>
                        <Input
                          value={settings.yoomoneyReceiverWallet ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yoomoneyReceiverWallet: e.target.value || null } : s))}
                          placeholder="41001123456789"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.yoomoney_wallet_hint")}</p>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.yoomoney_secret")}</Label>
                        <Input
                          type="password"
                          value={settings.yoomoneyNotificationSecret ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yoomoneyNotificationSecret: e.target.value || null } : s))}
                          placeholder={t("admin.settings.yoomoney_secret_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.yoomoney_secret_hint")}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>ЮKassa</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.yookassa_api")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t("admin.settings.yookassa_register")} <a href="https://yookassa.ru/joinups" target="_blank" rel="noreferrer" className="text-primary underline">yookassa.ru</a>
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.yookassa_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/yookassa` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/yookassa` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setYookassaWebhookCopied(true);
                              setTimeout(() => setYookassaWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {yookassaWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.yookassa_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.yookassa_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.yookassa_shop_id")}</Label>
                        <Input
                          value={settings.yookassaShopId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yookassaShopId: e.target.value || null } : s))}
                          placeholder="123456"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.yookassa_secret")}</Label>
                        <Input
                          type="password"
                          value={settings.yookassaSecretKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yookassaSecretKey: e.target.value || null } : s))}
                          placeholder="live_..."
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.yookassa_key_hint")}</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 mt-4 space-y-3">
                      <div>
                        <Label className="text-amber-700 dark:text-amber-400">Webhook Basic Auth</Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          Защита от форджинга webhook'ов. В кабинете ЮKassa настроить webhook URL вида{" "}
                          <code className="text-[11px]">https://USER:PASS@panel.example.com/api/webhooks/yookassa</code>{" "}
                          и сюда вписать те же USER и PASS. Если не задано — webhook принимается без проверки (с warning'ом в логах).
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className="text-xs">Basic-auth username</Label>
                          <Input
                            value={(settings as { yookassaWebhookBasicUser?: string | null }).yookassaWebhookBasicUser ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, yookassaWebhookBasicUser: e.target.value || null } as typeof s : s))}
                            placeholder="webhook_user"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Basic-auth password</Label>
                          <Input
                            type="password"
                            value={(settings as { yookassaWebhookBasicPassword?: string | null }).yookassaWebhookBasicPassword ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, yookassaWebhookBasicPassword: e.target.value || null } as typeof s : s))}
                            placeholder="случайный длинный пароль"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>Crypto Pay (Crypto Bot)</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.cryptopay_telegram")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t("admin.settings.cryptopay_register")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.cryptopay_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/cryptopay` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/cryptopay` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setCryptopayWebhookCopied(true);
                              setTimeout(() => setCryptopayWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {cryptopayWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.cryptopay_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.cryptopay_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.cryptopay_token")}</Label>
                        <Input
                          type="password"
                          value={settings.cryptopayApiToken ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, cryptopayApiToken: e.target.value || null } : s))}
                          placeholder="123456789:AAzQc..."
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.cryptopay_token_hint")}</p>
                      </div>
                      <div className="space-y-2 flex flex-col justify-end">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="cryptopayTestnet"
                            checked={settings.cryptopayTestnet ?? false}
                            onChange={(e) => setSettings((s) => (s ? { ...s, cryptopayTestnet: e.target.checked } : s))}
                            className="rounded border"
                          />
                          <Label htmlFor="cryptopayTestnet">{t("admin.settings.cryptopay_testnet")}</Label>
                        </div>
                        <p className="text-xs text-muted-foreground">{t("admin.settings.cryptopay_testnet_hint")}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>Heleket</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.heleket_crypto")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t("admin.settings.heleket_register")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.heleket_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/heleket` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/heleket` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setHeleketWebhookCopied(true);
                              setTimeout(() => setHeleketWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {heleketWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.heleket_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.heleket_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.heleket_merchant")}</Label>
                        <Input
                          value={settings.heleketMerchantId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, heleketMerchantId: e.target.value || null } : s))}
                          placeholder="8b03432e-385b-4670-8d06-064591096795"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.heleket_merchant_hint")}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.heleket_api_key")}</Label>
                        <Input
                          type="password"
                          value={settings.heleketApiKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, heleketApiKey: e.target.value || null } : s))}
                          placeholder={t("admin.settings.heleket_key_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.heleket_key_hint")}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>LAVA</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.lava_desc_short")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t("admin.settings.lava_register")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.lava_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/lava` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/lava` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setLavaWebhookCopied(true);
                              setTimeout(() => setLavaWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {lavaWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.lava_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.lava_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.lava_shop_id")}</Label>
                        <Input
                          value={settings.lavaShopId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, lavaShopId: e.target.value || null } : s))}
                          placeholder="00000000-0000-0000-0000-000000000000"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.lava_shop_id_hint")}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.lava_secret_key")}</Label>
                        <Input
                          type="password"
                          value={settings.lavaSecretKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, lavaSecretKey: e.target.value || null } : s))}
                          placeholder={t("admin.settings.lava_secret_key_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.lava_secret_key_hint")}</p>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.lava_additional_key")}</Label>
                        <Input
                          type="password"
                          value={settings.lavaAdditionalKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, lavaAdditionalKey: e.target.value || null } : s))}
                          placeholder={t("admin.settings.lava_additional_key_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.lava_additional_key_hint")}</p>
                      </div>
                    </div>

                    {/* ─── Lava.top — отдельный провайдер, product/offer модель ─── */}
                    <div className="pt-4 mt-4 border-t border-dashed">
                      <h4 className="text-sm font-semibold mb-2">Lava.top (gate.lava.top)</h4>
                      <p className="text-xs text-muted-foreground mb-3">
                        Новый Lava (lava.top) — отличается от Lava Business (lava.ru). Использует продукты/офферы:
                        в ЛК Lava.top создайте продукт с одним или несколькими offer'ами, скопируйте API-ключ
                        и UUID дефолтного оффера. <a className="text-primary underline" href="https://developers.lava.top/ru" target="_blank" rel="noopener noreferrer">developers.lava.top</a> · <a className="text-primary underline" href="https://gate.lava.top/docs" target="_blank" rel="noopener noreferrer">Swagger</a>
                      </p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Webhook URL: <code className="font-mono">{(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/lavatop</code>
                        <br/>IP whitelist Lava.top для webhook'ов: <code className="font-mono">158.160.60.174</code>
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>API-ключ Lava.top</Label>
                          <Input
                            type="password"
                            value={settings.lavatopApiKey ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, lavatopApiKey: e.target.value || null } : s))}
                            placeholder="********"
                          />
                          <p className="text-xs text-muted-foreground">ЛК Lava.top → Integrations → Public API</p>
                        </div>
                        <div className="space-y-2">
                          <Label>Default Offer ID (UUID)</Label>
                          <Input
                            value={settings.lavatopDefaultOfferId ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, lavatopDefaultOfferId: e.target.value || null } : s))}
                            placeholder="00000000-0000-0000-0000-000000000000"
                          />
                          <p className="text-xs text-muted-foreground">UUID оффера. Используется как фолбэк если у тарифа нет своего offerId.</p>
                        </div>
                      </div>

                      {/* ─── Список офферов из Lava.top API ─── */}
                      <LavatopOffersBrowser />
                    </div>

                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>Overpay</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.overpay_desc_short")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t("admin.settings.overpay_register")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.overpay_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/overpay` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/overpay` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setOverpayWebhookCopied(true);
                              setTimeout(() => setOverpayWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {overpayWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.overpay_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.overpay_api_url")}</Label>
                        <Input
                          value={settings.overpayApiUrl ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, overpayApiUrl: e.target.value || null } : s))}
                          placeholder="https://api.overpay.io"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_api_url_hint")}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.overpay_project_id")}</Label>
                        <Input
                          value={settings.overpayProjectId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, overpayProjectId: e.target.value || null } : s))}
                          placeholder="1234"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_project_id_hint")}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.overpay_login")}</Label>
                        <Input
                          value={settings.overpayLogin ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, overpayLogin: e.target.value || null } : s))}
                          placeholder="api-login"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_login_hint")}</p>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.overpay_password")}</Label>
                        <Input
                          type="password"
                          value={settings.overpayPassword ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, overpayPassword: e.target.value || null } : s))}
                          placeholder={t("admin.settings.overpay_password_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_password_hint")}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </TabsContent>

          <TabsContent value="ai">
            <Card className="overflow-hidden border-white/10">
              <div className="relative bg-gradient-to-br from-fuchsia-500/10 via-pink-500/10 to-purple-500/10 p-6 sm:p-8 border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/5 via-transparent to-purple-500/5 pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-fuchsia-500/30 via-pink-500/20 to-purple-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                    <Sparkles className="h-7 w-7 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-500 via-pink-500 to-purple-500">
                      {t("admin.settings.ai_title")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.ai_subtitle")} {t("admin.settings.ai_integration_hint")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-4 p-4 sm:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.settings.ai_groq_key")}</Label>
                    <Input
                      type="password"
                      value={settings.groqApiKey ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqApiKey: e.target.value || null } : s))}
                      placeholder="gsk_..."
                    />
                    <p className="text-xs text-muted-foreground">{t("admin.settings.ai_key_hint")}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.settings.ai_model")}</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={settings.groqModel ?? "llama3-8b-8192"}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqModel: e.target.value } : s))}
                    >
                      <option value="llama3-8b-8192">llama3-8b-8192</option>
                      <option value="llama3-70b-8192">llama3-70b-8192</option>
                      <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                      <option value="llama-3.1-70b-versatile">llama-3.1-70b-versatile</option>
                      <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                      <option value="deepseek-r1-distill-llama-70b">deepseek-r1-distill-llama-70b</option>
                      <option value="deepseek-r1-distill-qwen-32b">deepseek-r1-distill-qwen-32b</option>
                      <option value="qwen-2.5-32b">qwen-2.5-32b</option>
                      <option value="qwen-2.5-coder-32b">qwen-2.5-coder-32b</option>
                      <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                      <option value="llama3-70b-8192">llama3-70b-8192</option>
                      <option value="llama3-8b-8192">llama3-8b-8192</option>
                      <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                      <option value="gemma2-9b-it">gemma2-9b-it</option>
                    </select>
                    <p className="text-xs text-muted-foreground">{t("admin.settings.ai_model_hint")}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.ai_fallback")}</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("admin.settings.ai_fallback_hint")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:opacity-50"
                      value={settings.groqFallback1 ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqFallback1: e.target.value || null } : s))}
                    >
                      <option value="">{t("admin.settings.ai_no_fallback")} 1</option>
                      <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                      <option value="deepseek-r1-distill-llama-70b">deepseek-r1-distill-llama-70b</option>
                      <option value="deepseek-r1-distill-qwen-32b">deepseek-r1-distill-qwen-32b</option>
                      <option value="qwen-2.5-32b">qwen-2.5-32b</option>
                      <option value="qwen-2.5-coder-32b">qwen-2.5-coder-32b</option>
                      <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                      <option value="llama3-70b-8192">llama3-70b-8192</option>
                      <option value="llama3-8b-8192">llama3-8b-8192</option>
                      <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                      <option value="gemma2-9b-it">gemma2-9b-it</option>
                    </select>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:opacity-50"
                      value={settings.groqFallback2 ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqFallback2: e.target.value || null } : s))}
                    >
                      <option value="">{t("admin.settings.ai_no_fallback")} 2</option>
                      <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                      <option value="deepseek-r1-distill-llama-70b">deepseek-r1-distill-llama-70b</option>
                      <option value="deepseek-r1-distill-qwen-32b">deepseek-r1-distill-qwen-32b</option>
                      <option value="qwen-2.5-32b">qwen-2.5-32b</option>
                      <option value="qwen-2.5-coder-32b">qwen-2.5-coder-32b</option>
                      <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                      <option value="llama3-70b-8192">llama3-70b-8192</option>
                      <option value="llama3-8b-8192">llama3-8b-8192</option>
                      <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                      <option value="gemma2-9b-it">gemma2-9b-it</option>
                    </select>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:opacity-50"
                      value={settings.groqFallback3 ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqFallback3: e.target.value || null } : s))}
                    >
                      <option value="">{t("admin.settings.ai_no_fallback")} 3</option>
                      <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                      <option value="deepseek-r1-distill-llama-70b">deepseek-r1-distill-llama-70b</option>
                      <option value="deepseek-r1-distill-qwen-32b">deepseek-r1-distill-qwen-32b</option>
                      <option value="qwen-2.5-32b">qwen-2.5-32b</option>
                      <option value="qwen-2.5-coder-32b">qwen-2.5-coder-32b</option>
                      <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                      <option value="llama3-70b-8192">llama3-70b-8192</option>
                      <option value="llama3-8b-8192">llama3-8b-8192</option>
                      <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                      <option value="gemma2-9b-it">gemma2-9b-it</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.ai_system_prompt")}</Label>
                  <textarea
                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={settings.aiSystemPrompt ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, aiSystemPrompt: e.target.value } : s))}
                    placeholder="Ты — лучший менеджер техподдержки VPN-сервиса..."
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.ai_prompt_hint")}
                  </p>
                </div>
                <div className="pt-2 border-t">
                  <Button type="submit" disabled={saving} className="min-w-[140px]">
                    {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mail-telegram">
            <Card className="overflow-hidden border-white/10">
              <div className="relative bg-gradient-to-br from-cyan-500/10 via-teal-500/10 to-sky-500/10 p-6 sm:p-8 border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-sky-500/5 pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-cyan-500/30 via-teal-500/20 to-sky-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                    <Mail className="h-7 w-7 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 via-teal-500 to-sky-500">
                      {t("admin.settings.smtp_title")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.smtp_subtitle")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-5 p-4 sm:p-6">
                <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 via-teal-500/5 to-sky-500/5 p-5 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-cyan-500/20 flex items-center justify-center"><Mail className="h-4 w-4 text-cyan-500" /></div>
                    <h3 className="text-base font-semibold">SMTP-сервер</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Параметры почтового сервера для отправки email с письмами регистрации, восстановления пароля и системных уведомлений.</p>
                <label className="flex items-center gap-3 p-3.5 rounded-xl bg-card/40 border border-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    id="skipEmailVerification"
                    checked={settings.skipEmailVerification ?? false}
                    onChange={(e) => setSettings((s) => (s ? { ...s, skipEmailVerification: e.target.checked } : s))}
                    className="rounded border w-4 h-4"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{t("admin.settings.skip_email")}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t("admin.settings.smtp_no_confirm_hint")}</p>
                  </div>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_host")}</Label>
                    <Input
                      value={settings.smtpHost ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpHost: e.target.value || null } : s))}
                      placeholder="smtp.example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_port")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={65535}
                      value={settings.smtpPort ?? 587}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpPort: parseInt(e.target.value, 10) || 587 } : s))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="smtpSecure"
                    checked={settings.smtpSecure ?? false}
                    onChange={(e) => setSettings((s) => (s ? { ...s, smtpSecure: e.target.checked } : s))}
                    className="rounded border"
                  />
                  <Label htmlFor="smtpSecure">SSL/TLS (secure)</Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_user")}</Label>
                    <Input
                      value={settings.smtpUser ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpUser: e.target.value || null } : s))}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_password")}</Label>
                    <Input
                      type="password"
                      value={settings.smtpPassword ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpPassword: e.target.value || null } : s))}
                      placeholder="********"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_from_email")}</Label>
                    <Input
                      type="email"
                      value={settings.smtpFromEmail ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpFromEmail: e.target.value || null } : s))}
                      placeholder="noreply@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.settings.smtp_from_name")}</Label>
                    <Input
                      value={settings.smtpFromName ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpFromName: e.target.value || null } : s))}
                      placeholder={t("admin.settings.smtp_service_name_placeholder")}
                    />
                  </div>
                </div>
                </div>
              </CardContent>
            </Card>
            <Card className="mt-6 overflow-hidden border-white/10">
              <div className="relative bg-gradient-to-br from-sky-500/10 via-blue-500/10 to-cyan-500/10 p-6 sm:p-8 border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 via-transparent to-cyan-500/5 pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500/30 via-blue-500/20 to-cyan-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                    <MessageCircle className="h-7 w-7 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-500">
                      {t("admin.settings.telegram_title")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.telegram_bot_hint")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-4 p-4 sm:p-6">
                <div className="space-y-2">
                  <Label>{t("admin.settings.telegram_bot_token")}</Label>
                  <Input
                    type="password"
                    value={settings.telegramBotToken ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, telegramBotToken: e.target.value || null } : s))}
                    placeholder="123456:ABC-DEF..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.telegram_bot_username")}</Label>
                  <Input
                    value={settings.telegramBotUsername ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, telegramBotUsername: e.target.value || null } : s))}
                    placeholder="MyStealthNetBot"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.telegram_admins")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.telegram_admins_hint")}
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    {(settings.botAdminTelegramIds ?? []).map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm">
                        {id}
                        <button
                          type="button"
                          onClick={() => setSettings((s) => (s ? { ...s, botAdminTelegramIds: (s.botAdminTelegramIds ?? []).filter((x) => x !== id) } : s))}
                          className="text-muted-foreground hover:text-destructive"
                          title={t("admin.settings.telegram_delete")}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        placeholder="123456789"
                        className="w-36"
                        id="newBotAdminId"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const input = document.getElementById("newBotAdminId") as HTMLInputElement;
                            const v = input?.value?.trim();
                            if (v && /^\d+$/.test(v)) {
                              setSettings((s) => (s ? { ...s, botAdminTelegramIds: [...(s.botAdminTelegramIds ?? []), v] } : s));
                              input.value = "";
                            }
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const input = document.getElementById("newBotAdminId") as HTMLInputElement;
                          const v = input?.value?.trim();
                          if (v && /^\d+$/.test(v)) {
                            setSettings((s) => (s ? { ...s, botAdminTelegramIds: [...(s.botAdminTelegramIds ?? []), v] } : s));
                            input.value = "";
                          }
                        }}
                      >
                        {t("admin.settings.add_id")}
                      </Button>
                    </div>
                  </div>
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving}>
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </form>

        <TabsContent value="theme">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-pink-500/10 via-rose-500/10 to-fuchsia-500/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 via-transparent to-fuchsia-500/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-pink-500/30 via-rose-500/20 to-fuchsia-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <Palette className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-rose-500 to-fuchsia-500">
                    {t("admin.settings.theme_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.theme_global_hint")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-6">
              <div className="flex items-center justify-between rounded-xl border border-white/10 p-4 bg-card/40">
                <div className="space-y-0.5">
                  <Label className="text-base font-medium">{t("admin.settings.theme_user_choice")}</Label>
                  <p className="text-xs text-muted-foreground">{t("admin.settings.theme_user_choice_hint")}</p>
                </div>
                <Switch
                  checked={Boolean((settings as any)?.allowUserThemeChange ?? true)}
                  onCheckedChange={(c: boolean) => setSettings((s) => s ? { ...s, allowUserThemeChange: c } : s)}
                />
              </div>
              <div>
                <Label className="text-sm font-medium mb-3 block">{t("admin.settings.theme_accent")}</Label>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {(Object.entries(ACCENT_PALETTES) as [string, { label: string; swatch: string }][]).map(([key, palette]) => {
                    const selected = (settings.themeAccent ?? "default") === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSettings({ ...settings, themeAccent: key })}
                        className={`flex flex-col items-center gap-2 rounded-xl p-3 text-xs font-medium transition-all border-2 ${
                          selected
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-transparent hover:bg-muted/50"
                        }`}
                      >
                        <div
                          className="h-10 w-10 rounded-full shadow-sm"
                          style={{ backgroundColor: palette.swatch }}
                        />
                        <span className={selected ? "text-primary" : "text-muted-foreground"}>
                          {palette.label}
                        </span>
                        {selected && (
                          <Check className="h-3 w-3 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="pt-2">
                {message && <p className="text-sm text-muted-foreground mb-2">{message}</p>}
                <Button
                  onClick={() => {
                    setSaving(true);
                    setMessage("");
                    api.updateSettings(token, { themeAccent: settings.themeAccent ?? "default", allowUserThemeChange: (settings as any).allowUserThemeChange ?? true })
                      .then(() => setMessage(t("admin.settings.theme_saved")))
                      .catch(() => setMessage(t("admin.settings.save_error")))
                      .finally(() => setSaving(false));
                  }}
                  disabled={saving}
                >
                  {saving ? t("admin.settings.saving") : t("admin.settings.save_theme")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="options">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-yellow-500/10 via-amber-500/10 to-orange-500/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/5 via-transparent to-orange-500/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-yellow-500/30 via-amber-500/20 to-orange-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <Package className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-yellow-500 via-amber-500 to-orange-500">
                    {t("admin.settings.options_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.options_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="sell-options-enabled"
                  checked={settings.sellOptionsEnabled ?? false}
                  onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, sellOptionsEnabled: !!c } : s))}
                />
                <Label htmlFor="sell-options-enabled" className="cursor-pointer">{t("admin.settings.options_enable")}</Label>
              </div>

              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-2 font-medium">
                  <ChevronDown className="h-4 w-4" />
                  {t("admin.settings.options_traffic")}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Switch
                      id="sell-traffic-enabled"
                      checked={settings.sellOptionsTrafficEnabled ?? false}
                      onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, sellOptionsTrafficEnabled: !!c } : s))}
                    />
                    <Label htmlFor="sell-traffic-enabled" className="cursor-pointer">{t("admin.settings.options_enable_short")}</Label>
                  </div>
                  <div className="rounded-md border overflow-x-auto overflow-hidden">
                    <table className="w-full text-sm min-w-[400px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2 font-medium">{t("admin.settings.options_col_name")}</th>
                          <th className="text-left p-2 font-medium w-24">{t("admin.settings.options_col_gb")}</th>
                          <th className="text-left p-2 font-medium w-28">{t("admin.settings.options_col_price")}</th>
                          <th className="text-left p-2 font-medium w-24">{t("admin.settings.options_col_currency")}</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {(settings.sellOptionsTrafficProducts ?? []).map((p, i) => (
                          <tr key={p.id} className="border-b last:border-0">
                            <td className="p-2"><Input className="h-9 w-full max-w-[180px]" placeholder={t("admin.settings.options_name_placeholder")} value={p.name} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsTrafficProducts) return s; const arr = [...s.sellOptionsTrafficProducts]; arr[i] = { ...arr[i], name: e.target.value }; return { ...s, sellOptionsTrafficProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={0.1} step={0.5} className="h-9 w-full" value={p.trafficGb || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsTrafficProducts) return s; const arr = [...s.sellOptionsTrafficProducts]; arr[i] = { ...arr[i], trafficGb: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsTrafficProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={0} step={1} className="h-9 w-full" value={p.price || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsTrafficProducts) return s; const arr = [...s.sellOptionsTrafficProducts]; arr[i] = { ...arr[i], price: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsTrafficProducts: arr }; })} /></td>
                            <td className="p-2">
                              <select className="h-9 rounded-md border px-2 w-full bg-background" value={p.currency} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsTrafficProducts) return s; const arr = [...s.sellOptionsTrafficProducts]; arr[i] = { ...arr[i], currency: e.target.value }; return { ...s, sellOptionsTrafficProducts: arr }; })}>
                                {ALLOWED_CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                              </select>
                            </td>
                            <td className="p-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsTrafficProducts: (s.sellOptionsTrafficProducts ?? []).filter((_, j) => j !== i) } : s))}><Trash2 className="h-4 w-4" /></Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsTrafficProducts: [...(s.sellOptionsTrafficProducts ?? []), { id: `traffic_${Date.now()}`, name: "", trafficGb: 5, price: 0, currency: "rub" }] } : s))}>
                      <Plus className="h-4 w-4 mr-1" /> {t("admin.settings.options_add")}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-2 font-medium">
                  <ChevronDown className="h-4 w-4" />
                  {t("admin.settings.options_devices")}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Switch
                      id="sell-devices-enabled"
                      checked={settings.sellOptionsDevicesEnabled ?? false}
                      onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, sellOptionsDevicesEnabled: !!c } : s))}
                    />
                    <Label htmlFor="sell-devices-enabled" className="cursor-pointer">{t("admin.settings.options_enable_short")}</Label>
                  </div>
                  <div className="rounded-md border overflow-x-auto overflow-hidden">
                    <table className="w-full text-sm min-w-[400px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2 font-medium">{t("admin.settings.options_col_name")}</th>
                          <th className="text-left p-2 font-medium w-20">{t("admin.settings.options_col_qty")}</th>
                          <th className="text-left p-2 font-medium w-28">{t("admin.settings.options_col_price")}</th>
                          <th className="text-left p-2 font-medium w-24">{t("admin.settings.options_col_currency")}</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {(settings.sellOptionsDevicesProducts ?? []).map((p, i) => (
                          <tr key={p.id} className="border-b last:border-0">
                            <td className="p-2"><Input className="h-9 w-full max-w-[180px]" placeholder={t("admin.settings.options_name_placeholder")} value={p.name} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsDevicesProducts) return s; const arr = [...s.sellOptionsDevicesProducts]; arr[i] = { ...arr[i], name: e.target.value }; return { ...s, sellOptionsDevicesProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={1} className="h-9 w-full" value={p.deviceCount || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsDevicesProducts) return s; const arr = [...s.sellOptionsDevicesProducts]; arr[i] = { ...arr[i], deviceCount: parseInt(e.target.value, 10) || 0 }; return { ...s, sellOptionsDevicesProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={0} step={1} className="h-9 w-full" value={p.price || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsDevicesProducts) return s; const arr = [...s.sellOptionsDevicesProducts]; arr[i] = { ...arr[i], price: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsDevicesProducts: arr }; })} /></td>
                            <td className="p-2">
                              <select className="h-9 rounded-md border px-2 w-full bg-background" value={p.currency} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsDevicesProducts) return s; const arr = [...s.sellOptionsDevicesProducts]; arr[i] = { ...arr[i], currency: e.target.value }; return { ...s, sellOptionsDevicesProducts: arr }; })}>
                                {ALLOWED_CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                              </select>
                            </td>
                            <td className="p-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsDevicesProducts: (s.sellOptionsDevicesProducts ?? []).filter((_, j) => j !== i) } : s))}><Trash2 className="h-4 w-4" /></Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsDevicesProducts: [...(s.sellOptionsDevicesProducts ?? []), { id: `devices_${Date.now()}`, name: "", deviceCount: 1, price: 0, currency: "rub" }] } : s))}>
                      <Plus className="h-4 w-4 mr-1" /> {t("admin.settings.options_add")}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-2 font-medium">
                  <ChevronDown className="h-4 w-4" />
                  {t("admin.settings.options_servers")}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Switch
                      id="sell-servers-enabled"
                      checked={settings.sellOptionsServersEnabled ?? false}
                      onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, sellOptionsServersEnabled: !!c } : s))}
                    />
                    <Label htmlFor="sell-servers-enabled" className="cursor-pointer">{t("admin.settings.options_enable_short")}</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("admin.settings.options_squads_hint")}</p>
                  <div className="rounded-md border overflow-x-auto overflow-hidden">
                    <table className="w-full text-sm min-w-[520px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2 font-medium">{t("admin.settings.options_col_name")}</th>
                          <th className="text-left p-2 font-medium">{t("admin.settings.options_col_squad")}</th>
                          <th className="text-left p-2 font-medium w-20">{t("admin.settings.options_col_gb")}</th>
                          <th className="text-left p-2 font-medium w-28">{t("admin.settings.options_col_price")}</th>
                          <th className="text-left p-2 font-medium w-24">{t("admin.settings.options_col_currency")}</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {(settings.sellOptionsServersProducts ?? []).map((p, i) => (
                          <tr key={p.id} className="border-b last:border-0">
                            <td className="p-2"><Input className="h-9 w-full max-w-[160px]" placeholder={t("admin.settings.options_name_placeholder")} value={p.name} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], name: e.target.value }; return { ...s, sellOptionsServersProducts: arr }; })} /></td>
                            <td className="p-2">
                              <select className="h-9 rounded-md border px-2 w-full min-w-[180px] bg-background" value={p.squadUuid} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], squadUuid: e.target.value }; return { ...s, sellOptionsServersProducts: arr }; })}>
                                <option value="">{t("admin.settings.options_squad_none")}</option>
                                {squads.map((sq) => <option key={sq.uuid} value={sq.uuid}>{sq.name || sq.uuid}</option>)}
                              </select>
                            </td>
                            <td className="p-2"><Input type="number" min={0} step={0.5} className="h-9 w-full" placeholder="0" value={p.trafficGb ?? ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], trafficGb: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsServersProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={0} step={1} className="h-9 w-full" value={p.price || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], price: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsServersProducts: arr }; })} /></td>
                            <td className="p-2">
                              <select className="h-9 rounded-md border px-2 w-full bg-background" value={p.currency} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], currency: e.target.value }; return { ...s, sellOptionsServersProducts: arr }; })}>
                                {ALLOWED_CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                              </select>
                            </td>
                            <td className="p-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsServersProducts: (s.sellOptionsServersProducts ?? []).filter((_, j) => j !== i) } : s))}><Trash2 className="h-4 w-4" /></Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsServersProducts: [...(s.sellOptionsServersProducts ?? []), { id: `server_${Date.now()}`, name: "", squadUuid: squads[0]?.uuid ?? "", trafficGb: 0, price: 0, currency: "rub" }] } : s))}>
                      <Plus className="h-4 w-4 mr-1" /> {t("admin.settings.options_add")}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="pt-4 border-t">
                {message && <p className="text-sm text-muted-foreground mb-2">{message}</p>}
                <Button type="button" onClick={saveOptionsOnly} disabled={saving}>{saving ? t("admin.settings.saving") : t("admin.settings.options_save")}</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custom-build">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-purple-500/10 via-violet-500/10 to-indigo-500/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-indigo-500/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-500/30 via-violet-500/20 to-indigo-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <Layers className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-500 via-violet-500 to-indigo-500">
                    {t("admin.settings.custom_build_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.custom_build_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-4 p-4 sm:p-6">
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <Switch
                  id="custom-build-enabled"
                  checked={!!settings.customBuildEnabled}
                  onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, customBuildEnabled: !!c } : s))}
                />
                <Label htmlFor="custom-build-enabled" className="cursor-pointer font-medium">{t("admin.settings.custom_build_enable")}</Label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_price_day")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={settings.customBuildPricePerDay ?? 0}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildPricePerDay: parseFloat(e.target.value) || 0 } : s))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_price_device")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={settings.customBuildPricePerDevice ?? 0}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildPricePerDevice: parseFloat(e.target.value) || 0 } : s))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.custom_build_traffic")}</Label>
                <div className="flex gap-4 items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="customBuildTrafficMode"
                      checked={(settings.customBuildTrafficMode ?? "unlimited") === "unlimited"}
                      onChange={() => setSettings((s) => (s ? { ...s, customBuildTrafficMode: "unlimited" as const } : s))}
                      className="rounded-full"
                    />
                    {t("admin.settings.custom_build_unlimited")}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="customBuildTrafficMode"
                      checked={(settings.customBuildTrafficMode ?? "unlimited") === "per_gb"}
                      onChange={() => setSettings((s) => (s ? { ...s, customBuildTrafficMode: "per_gb" as const } : s))}
                      className="rounded-full"
                    />
                    {t("admin.settings.custom_build_per_gb")}
                  </label>
                  {(settings.customBuildTrafficMode ?? "unlimited") === "per_gb" && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        className="w-24"
                        value={settings.customBuildPricePerGb ?? 0}
                        onChange={(e) => setSettings((s) => (s ? { ...s, customBuildPricePerGb: parseFloat(e.target.value) || 0 } : s))}
                      />
                      <span className="text-sm text-muted-foreground">за 1 ГБ</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.custom_build_squad")}</Label>
                <select
                  className="flex h-10 w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={settings.customBuildSquadUuid ?? ""}
                  onChange={(e) => setSettings((s) => (s ? { ...s, customBuildSquadUuid: e.target.value || null } : s))}
                >
                  <option value="">{t("admin.settings.custom_build_squad_none")}</option>
                  {squads.map((s) => (
                    <option key={s.uuid} value={s.uuid}>{s.name || s.uuid}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_currency")}</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={settings.customBuildCurrency ?? "rub"}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildCurrency: e.target.value } : s))}
                  >
                    {ALLOWED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_max_days")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={360}
                    value={settings.customBuildMaxDays ?? 360}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildMaxDays: Math.min(360, Math.max(1, parseInt(e.target.value, 10) || 360)) } : s))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_max_devices")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.customBuildMaxDevices ?? 10}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildMaxDevices: Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 10)) } : s))}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.custom_build_hint")}
              </p>
              <div className="pt-2 flex items-center gap-2">
                <Button
                  type="button"
                  disabled={saving}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSubmit(e as unknown as React.FormEvent);
                  }}
                >
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
                {message && <span className="text-sm text-muted-foreground">{message}</span>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="oauth">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-zinc-500/10 via-slate-500/10 to-stone-500/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-zinc-500/5 via-transparent to-stone-500/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-zinc-500/30 via-slate-500/20 to-stone-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <KeyRound className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-zinc-500 via-slate-500 to-stone-500">
                    {t("admin.settings.oauth_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.oauth_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-6">
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Google Sign In</h3>
                    <p className="text-xs text-muted-foreground">{t("admin.settings.oauth_google_hint")}</p>
                  </div>
                  <Switch
                    checked={settings?.googleLoginEnabled ?? false}
                    onCheckedChange={(v) => setSettings((s) => (s ? { ...s, googleLoginEnabled: v } : s))}
                  />
                </div>
                {settings?.googleLoginEnabled && (
                  <div className="space-y-3">
                    <div>
                      <Label>Client ID</Label>
                      <Input
                        placeholder="xxxx.apps.googleusercontent.com"
                        value={settings.googleClientId ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, googleClientId: e.target.value || null } : s))}
                      />
                    </div>
                    <div>
                      <Label>{t("admin.settings.oauth_google_secret")}</Label>
                      <Input
                        type="password"
                        placeholder="GOCSPX-..."
                        value={settings.googleClientSecret ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, googleClientSecret: e.target.value || null } : s))}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("admin.settings.oauth_google_secret_hint")}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("admin.settings.oauth_google_origins_hint")}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Apple Sign In</h3>
                    <p className="text-xs text-muted-foreground">{t("admin.settings.oauth_apple_hint")}</p>
                  </div>
                  <Switch
                    checked={settings?.appleLoginEnabled ?? false}
                    onCheckedChange={(v) => setSettings((s) => (s ? { ...s, appleLoginEnabled: v } : s))}
                  />
                </div>
                {settings?.appleLoginEnabled && (
                  <div className="space-y-3">
                    <div>
                      <Label>Services ID (Client ID)</Label>
                      <Input
                        placeholder="com.example.service"
                        value={settings.appleClientId ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, appleClientId: e.target.value || null } : s))}
                      />
                    </div>
                    <div>
                      <Label>Team ID</Label>
                      <Input
                        placeholder="XXXXXXXXXX"
                        value={settings.appleTeamId ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, appleTeamId: e.target.value || null } : s))}
                      />
                    </div>
                    <div>
                      <Label>Key ID</Label>
                      <Input
                        placeholder="YYYYYYYYYY"
                        value={settings.appleKeyId ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, appleKeyId: e.target.value || null } : s))}
                      />
                    </div>
                    <div>
                      <Label>Private Key (.p8)</Label>
                      <Textarea
                        rows={4}
                        placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
                        value={settings.applePrivateKey ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, applePrivateKey: e.target.value || null } : s))}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("admin.settings.oauth_apple_desc")} Return URL: <code>{`${window.location.origin}/cabinet/login`}</code>
                    </p>
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center gap-2">
                <Button
                  type="button"
                  disabled={saving}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSubmit(e as unknown as React.FormEvent);
                  }}
                >
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
                {message && <span className="text-sm text-muted-foreground">{message}</span>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="landing">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-green-500/10 via-emerald-500/10 to-teal-500/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-transparent to-teal-500/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-green-500/30 via-emerald-500/20 to-teal-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <Globe className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-bold tracking-tight">{t("admin.settings.tab_landing")}</h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                    Лендинг переехал в отдельный блочный редактор: drag-drop секций, превью без сохранения, шрифты и снапшоты.
                  </p>
                </div>
              </div>
            </div>

            <CardContent className="p-6 sm:p-8">
              <div className="rounded-2xl border border-white/10 bg-white/40 dark:bg-white/5 p-8 text-center">
                <Globe className="mx-auto h-10 w-10 text-emerald-500" />
                <h3 className="mt-4 text-lg font-semibold">Откройте редактор лендинга</h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Здесь больше нет полей: тексты, картинки, шрифты, цвета и порядок секций редактируются в визуальном редакторе.
                </p>
                <Button asChild size="lg" className="mt-6 gap-2">
                  <Link to="/admin/landing-editor">
                    <Globe className="h-4 w-4" />
                    Перейти в редактор
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="server-ssh">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-stone-500/10 via-zinc-500/10 to-slate-600/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-stone-500/5 via-transparent to-slate-600/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-stone-500/30 via-zinc-500/20 to-slate-600/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <Terminal className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-stone-400 via-zinc-400 to-slate-400">
                    {t("admin.settings.ssh_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.ssh_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-6">
              {!sshConfig ? (
                <p className="text-sm text-muted-foreground py-4">
                  {t("admin.settings.ssh_not_found")}
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>{t("admin.settings.ssh_port")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={65535}
                      value={sshConfig.port}
                      onChange={(e) => setSshConfig({ ...sshConfig, port: parseInt(e.target.value, 10) || 22 })}
                    />
                    <p className="text-xs text-muted-foreground">Стандартный порт — 22. Смена порта снижает количество ботов.</p>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("admin.settings.ssh_root_login")}</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={sshConfig.permitRootLogin}
                      onChange={(e) => setSshConfig({ ...sshConfig, permitRootLogin: e.target.value })}
                    >
                      <option value="yes">yes — разрешён вход по паролю и ключу</option>
                      <option value="prohibit-password">prohibit-password — только по ключу</option>
                      <option value="no">no — полностью запрещён</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <Label className="text-base font-medium">{t("admin.settings.ssh_password_auth")}</Label>
                      <p className="text-sm text-muted-foreground">PasswordAuthentication — отключите, если используете только ключи</p>
                    </div>
                    <Switch
                      checked={sshConfig.passwordAuthentication}
                      onCheckedChange={(v) => setSshConfig({ ...sshConfig, passwordAuthentication: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <Label className="text-base font-medium">{t("admin.settings.ssh_pubkey_auth")}</Label>
                      <p className="text-sm text-muted-foreground">PubkeyAuthentication — всегда должен быть включён, если заходите по ключу</p>
                    </div>
                    <Switch
                      checked={sshConfig.pubkeyAuthentication}
                      onCheckedChange={(v) => setSshConfig({ ...sshConfig, pubkeyAuthentication: v })}
                    />
                  </div>

                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
                    {t("admin.settings.ssh_warning")}
                    Перед изменением убедитесь, что у вас есть альтернативный способ доступа (например, консоль провайдера).
                  </div>

                  {sshMessage && (
                    <p className={`text-sm ${sshMessage === t("admin.settings.saved") ? "text-emerald-500" : "text-destructive"}`}>
                      {sshMessage}
                    </p>
                  )}

                  <Button
                    disabled={sshSaving}
                    onClick={async () => {
                      setSshSaving(true);
                      setSshMessage("");
                      try {
                        const updated = await api.updateSshConfig(token, sshConfig);
                        setSshConfig(updated);
                        setSshMessage(t("admin.settings.saved"));
                      } catch (e) {
                        setSshMessage(e instanceof Error ? e.message : t("admin.settings.error"));
                      } finally {
                        setSshSaving(false);
                      }
                    }}
                  >
                    {sshSaving ? t("admin.settings.saving") : t("admin.settings.ssh_apply")}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="proxy-settings">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-orange-500/10 via-red-500/10 to-rose-500/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-rose-500/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-500/30 via-red-500/20 to-rose-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <Shield className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-orange-500 via-red-500 to-rose-500">
                    {t("admin.settings.proxy_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.proxy_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-5 p-4 sm:p-6">
              <div className="rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500/5 via-red-500/5 to-rose-500/5 p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0"><Shield className="h-4 w-4 text-orange-500" /></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold mb-1">{t("admin.settings.proxy_enabled")}</h3>
                    <p className="text-xs text-muted-foreground">Глобальный переключатель — выключает ВСЕ прокси-маршруты сразу. Если выключен, бот/платежи/AI ходят напрямую.</p>
                  </div>
                  <Switch
                    checked={settings.proxyEnabled ?? false}
                    onCheckedChange={(v) => setSettings({ ...settings, proxyEnabled: v })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Proxy URL</Label>
                  <Input
                    placeholder="http://user:pass@host:port или socks5://user:pass@host:port"
                    value={settings.proxyUrl ?? ""}
                    onChange={(e) => setSettings({ ...settings, proxyUrl: e.target.value || null })}
                    disabled={!settings.proxyEnabled}
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">Протоколы: <code className="bg-muted/40 px-1 py-0.5 rounded">http://</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">https://</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">socks5://</code></p>
                </div>
              </div>

              <div className="rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/5 via-rose-500/5 to-pink-500/5 p-5 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-xl bg-red-500/20 flex items-center justify-center"><Network className="h-4 w-4 text-red-500" /></div>
                  <h3 className="text-base font-semibold">{t("admin.settings.proxy_routing")}</h3>
                </div>
                <p className="text-xs text-muted-foreground">Какие сервисы пускать через прокси. Можно гибко включать/выключать по одному.</p>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-white/5 cursor-pointer">
                  <div className="h-9 w-9 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0"><MessageCircle className="h-4 w-4 text-sky-500" /></div>
                  <div className="flex-1 min-w-0">
                    <Label className="text-sm font-medium cursor-pointer">{t("admin.settings.proxy_telegram")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Бот, уведомления, отправка сообщений в Telegram</p>
                  </div>
                  <Switch
                    checked={settings.proxyTelegram ?? false}
                    onCheckedChange={(v) => setSettings({ ...settings, proxyTelegram: v })}
                    disabled={!settings.proxyEnabled}
                  />
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-white/5 cursor-pointer">
                  <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0"><CreditCard className="h-4 w-4 text-amber-500" /></div>
                  <div className="flex-1 min-w-0">
                    <Label className="text-sm font-medium cursor-pointer">{t("admin.settings.proxy_payments")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Platega, YooKassa, YooMoney, CryptoPay, Heleket</p>
                  </div>
                  <Switch
                    checked={settings.proxyPayments ?? false}
                    onCheckedChange={(v) => setSettings({ ...settings, proxyPayments: v })}
                    disabled={!settings.proxyEnabled}
                  /></label>
                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-white/5 cursor-pointer">
                  <div className="h-9 w-9 rounded-xl bg-fuchsia-500/10 flex items-center justify-center shrink-0"><Sparkles className="h-4 w-4 text-fuchsia-500" /></div>
                  <div className="flex-1 min-w-0">
                    <Label className="text-sm font-medium cursor-pointer">AI чат</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Запросы к Groq API (api.groq.com) — нужен прокси если хостинг блочит их IP</p>
                  </div>
                  <Switch
                    checked={settings.proxyAi ?? false}
                    onCheckedChange={(v) => setSettings({ ...settings, proxyAi: v })}
                    disabled={!settings.proxyEnabled}
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/5 p-4 flex items-start gap-3">
                <Sparkles className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  <strong>Важно:</strong> после изменения настроек прокси для Telegram бота необходимо перезапустить контейнер бота,
                  чтобы он подключился через новый прокси.
                </p>
              </div>

              <Button
                onClick={(e) => {
                  handleSubmit(e as unknown as React.FormEvent);
                }}
                disabled={saving}
                className="w-full sm:w-auto h-11 px-6 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-90 text-white font-semibold shadow-lg shadow-orange-500/20"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                {saving ? t("admin.settings.saving") : t("admin.settings.save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nalog-settings">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-yellow-600/10 via-amber-600/10 to-orange-600/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-yellow-600/5 via-transparent to-orange-600/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-yellow-600/30 via-amber-600/20 to-orange-600/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <FileText className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-yellow-600 via-amber-600 to-orange-600">
                    {t("admin.settings.nalog_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.nalog_subtitle")} {t("admin.settings.nalog_selfemployed_hint")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-4 p-4 sm:p-6">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-medium">{t("admin.settings.nalog_enabled")}</Label>
                  <p className="text-sm text-muted-foreground">{t("admin.settings.nalog_enabled_hint")}</p>
                </div>
                <Switch
                  checked={settings.nalogEnabled ?? false}
                  onCheckedChange={(v) => setSettings({ ...settings, nalogEnabled: v })}
                />
              </div>

              <div>
                <Label htmlFor="nalog-inn">{t("admin.settings.nalog_inn")}</Label>
                <Input
                  id="nalog-inn"
                  placeholder="123456789012"
                  maxLength={12}
                  value={settings.nalogInn ?? ""}
                  onChange={(e) => setSettings({ ...settings, nalogInn: e.target.value || null })}
                  disabled={!settings.nalogEnabled}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.nalog_inn_hint")}</p>
              </div>

              <div>
                <Label htmlFor="nalog-password">{t("admin.settings.nalog_password")}</Label>
                <Input
                  id="nalog-password"
                  type="password"
                  placeholder="••••••••"
                  value={settings.nalogPassword ?? ""}
                  onChange={(e) => setSettings({ ...settings, nalogPassword: e.target.value || null })}
                  disabled={!settings.nalogEnabled}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.nalog_password_hint")}</p>
              </div>

              <div>
                <Label htmlFor="nalog-service-name">{t("admin.settings.nalog_service_name")}</Label>
                <Input
                  id="nalog-service-name"
                  placeholder="Оплата VPN-подписки"
                  value={settings.nalogServiceName ?? ""}
                  onChange={(e) => setSettings({ ...settings, nalogServiceName: e.target.value || null })}
                  disabled={!settings.nalogEnabled}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.nalog_service_name_hint")}</p>
              </div>

              <div>
                <Label htmlFor="nalog-device-id">{t("admin.settings.nalog_device_id")}</Label>
                <Input
                  id="nalog-device-id"
                  placeholder="stealthnet-bot-nalog"
                  value={settings.nalogDeviceId ?? ""}
                  onChange={(e) => setSettings({ ...settings, nalogDeviceId: e.target.value || null })}
                  disabled={!settings.nalogEnabled}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.nalog_device_id_hint")}</p>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!settings.nalogEnabled || !settings.nalogInn || !settings.nalogPassword}
                  onClick={async () => {
                    setMessage("");
                    try {
                      const result = await api.testNalogConnection(token!);
                      setMessage(result.ok ? t("admin.settings.nalog_test_success", { inn: result.inn }) : t("admin.settings.nalog_test_error", { error: result.error }));
                    } catch {
                      setMessage(t("admin.settings.nalog_test_failed"));
                    }
                  }}
                >
                  {t("admin.settings.nalog_test")}
                </Button>
                <Button
                  onClick={(e) => {
                    handleSubmit(e as unknown as React.FormEvent);
                  }}
                  disabled={saving}
                >
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </div>

              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-blue-200 space-y-2">
                <p><strong>{t("admin.settings.nalog_how_title")}</strong></p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>{t("admin.settings.nalog_how_1")}</li>
                  <li>{t("admin.settings.nalog_how_2")}</li>
                  <li>{t("admin.settings.nalog_how_3")}</li>
                  <li>{t("admin.settings.nalog_how_4")}</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="geo-map">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-teal-500/10 via-cyan-500/10 to-sky-500/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 via-transparent to-sky-500/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-teal-500/30 via-cyan-500/20 to-sky-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <MapPin className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-teal-500 via-cyan-500 to-sky-500">
                    {t("admin.settings.map_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.map_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-6">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-medium">{t("admin.settings.map_enabled")}</Label>
                  <p className="text-sm text-muted-foreground">{t("admin.settings.map_enabled_hint")}</p>
                </div>
                <Switch
                  checked={settings.geoMapEnabled ?? false}
                  onCheckedChange={(v) => setSettings({ ...settings, geoMapEnabled: v })}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("admin.settings.map_cache_ttl")}</Label>
                <Input
                  type="number"
                  min={10}
                  max={3600}
                  placeholder="60"
                  value={settings.geoCacheTtl ?? 60}
                  onChange={(e) => setSettings({ ...settings, geoCacheTtl: parseInt(e.target.value) || 60 })}
                  disabled={!settings.geoMapEnabled}
                />
                <p className="text-xs text-muted-foreground">
                  {t("admin.settings.map_cache_ttl_hint")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("admin.settings.map_maxmind_path")}</Label>
                <Input
                  placeholder="./data/GeoLite2-City.mmdb"
                  value={settings.maxmindDbPath ?? ""}
                  onChange={(e) => setSettings({ ...settings, maxmindDbPath: e.target.value || null })}
                  disabled={!settings.geoMapEnabled}
                />
                <p className="text-xs text-muted-foreground">
                  {t("admin.settings.map_maxmind_hint")}
                </p>
              </div>

              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-blue-200 space-y-2">
                <p><strong>{t("admin.settings.map_maxmind_title")}</strong></p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>{t("admin.settings.map_maxmind_1")}</li>
                  <li>{t("admin.settings.map_maxmind_2")}</li>
                  <li>{t("admin.settings.map_maxmind_3")}</li>
                  <li>{t("admin.settings.map_maxmind_4")}</li>
                </ul>
              </div>

              <Button
                onClick={(e) => {
                  handleSubmit(e as unknown as React.FormEvent);
                }}
                disabled={saving}
              >
                {saving ? t("admin.settings.saving") : t("admin.settings.save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gifts">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-pink-500/10 via-fuchsia-500/10 to-rose-500/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 via-transparent to-rose-500/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-pink-500/30 via-fuchsia-500/20 to-rose-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <Gift className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-fuchsia-500 to-rose-500">
                    Подарки и доп. подписки
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">Настройки системы подарков, кодов и дополнительных подписок</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <Switch
                  id="gift-subscriptions-enabled"
                  checked={!!settings.giftSubscriptionsEnabled}
                  onCheckedChange={(checked: boolean) =>
                    setSettings((s) => (s ? { ...s, giftSubscriptionsEnabled: checked === true } : s))
                  }
                />
                <div>
                  <Label htmlFor="gift-subscriptions-enabled" className="text-base font-medium cursor-pointer">
                    Включить систему подарков
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Разрешить клиентам покупать дополнительные подписки и дарить их другим пользователям
                  </p>
                </div>
              </div>

              {settings.giftSubscriptionsEnabled && (
                <div className="space-y-6 pl-4 border-l-2 border-primary/30">
                  <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Gift className="h-4 w-4 text-primary shrink-0" />
                      <Label className="text-base font-medium">Основные настройки</Label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="gift-code-expiry-hours">Срок действия кода (часы)</Label>
                        <Input
                          id="gift-code-expiry-hours"
                          type="number"
                          min={1}
                          value={settings.giftCodeExpiryHours ?? 72}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftCodeExpiryHours: parseInt(e.target.value, 10) || 72 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Через сколько часов истекает неиспользованный подарочный код
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="max-additional-subscriptions">Макс. доп. подписок</Label>
                        <Input
                          id="max-additional-subscriptions"
                          type="number"
                          min={1}
                          value={settings.maxAdditionalSubscriptions ?? 5}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, maxAdditionalSubscriptions: parseInt(e.target.value, 10) || 5 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Максимальное количество дополнительных подписок на одного клиента
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Settings2 className="h-4 w-4 text-primary shrink-0" />
                      <Label className="text-base font-medium">Коды и лимиты</Label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="gift-code-format-length">Длина кода</Label>
                        <Input
                          id="gift-code-format-length"
                          type="number"
                          min={6}
                          max={24}
                          value={settings.giftCodeFormatLength ?? 12}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftCodeFormatLength: parseInt(e.target.value, 10) || 12 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Количество символов в подарочном коде (формат XXXX-XXXX-XXXX)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="gift-rate-limit">Лимит попыток/мин</Label>
                        <Input
                          id="gift-rate-limit"
                          type="number"
                          min={1}
                          max={60}
                          value={settings.giftRateLimitPerMinute ?? 5}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftRateLimitPerMinute: parseInt(e.target.value, 10) || 5 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Максимум попыток активации подарочного кода в минуту (защита от перебора)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="gift-message-max-length">Макс. длина сообщения</Label>
                        <Input
                          id="gift-message-max-length"
                          type="number"
                          min={0}
                          max={1000}
                          value={settings.giftMessageMaxLength ?? 200}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftMessageMaxLength: parseInt(e.target.value, 10) || 200 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Максимальная длина персонального сообщения к подарку
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-4 w-4 text-primary shrink-0" />
                      <Label className="text-base font-medium">Уведомления и рефералы</Label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="gift-expiry-notification-days">Уведомление за (дни)</Label>
                        <Input
                          id="gift-expiry-notification-days"
                          type="number"
                          min={0}
                          max={30}
                          value={settings.giftExpiryNotificationDays ?? 3}
                          onChange={(e) =>
                            setSettings((s) => (s ? { ...s, giftExpiryNotificationDays: parseInt(e.target.value, 10) || 3 } : s))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          За сколько дней до истечения подарочной подписки уведомлять пользователя
                        </p>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                        <Switch
                          id="gift-referral-enabled"
                          checked={settings.giftReferralEnabled !== false}
                          onCheckedChange={(checked: boolean) =>
                            setSettings((s) => (s ? { ...s, giftReferralEnabled: checked === true } : s))
                          }
                        />
                        <div>
                          <Label htmlFor="gift-referral-enabled" className="text-sm font-medium cursor-pointer">
                            Реферальная связь через подарки
                          </Label>
                          <p className="text-xs text-muted-foreground mt-1">
                            При активации подарка новым пользователем, отправитель становится его рефералом
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {message && <p className="text-sm text-muted-foreground">{message}</p>}
              <Button
                type="button"
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault();
                  handleSubmit(e as unknown as React.FormEvent);
                }}
              >
                {saving ? t("admin.settings.saving") : t("admin.settings.save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync">
          <Card className="overflow-hidden border-white/10">
            <div className="relative bg-gradient-to-br from-violet-500/10 via-indigo-500/10 to-blue-500/10 p-6 sm:p-8 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-blue-500/5 pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/30 via-indigo-500/20 to-blue-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
                  <ArrowLeftRight className="h-7 w-7 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500">
                    {t("admin.settings.sync_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.settings.sync_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-4 p-4 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <button type="button" onClick={handleSyncFromRemna} disabled={syncLoading !== null} className="group relative overflow-hidden rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent p-5 text-left transition-all hover:border-violet-500/50 hover:shadow-lg hover:shadow-violet-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
                  <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-violet-500/10 blur-2xl group-hover:bg-violet-500/20 transition-colors" />
                  <div className="relative flex items-center gap-3 mb-2">
                    <div className="h-10 w-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                      {syncLoading === "from" ? <Loader2 className="h-5 w-5 text-violet-500 animate-spin" /> : <Download className="h-5 w-5 text-violet-500" />}
                    </div>
                    <span className="text-sm font-bold uppercase tracking-wider text-violet-500/80">From Remna →</span>
                  </div>
                  <div className="relative text-base font-semibold mb-1">{syncLoading === "from" ? t("admin.settings.sync_in_progress") : t("admin.settings.sync_from_remna")}</div>
                  <p className="relative text-xs text-muted-foreground">Подтянуть всех клиентов и подписки из Remna в локальную БД</p>
                </button>

                <button type="button" onClick={handleSyncToRemna} disabled={syncLoading !== null} className="group relative overflow-hidden rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-indigo-500/5 to-transparent p-5 text-left transition-all hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
                  <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-indigo-500/10 blur-2xl group-hover:bg-indigo-500/20 transition-colors" />
                  <div className="relative flex items-center gap-3 mb-2">
                    <div className="h-10 w-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                      {syncLoading === "to" ? <Loader2 className="h-5 w-5 text-indigo-500 animate-spin" /> : <Upload className="h-5 w-5 text-indigo-500" />}
                    </div>
                    <span className="text-sm font-bold uppercase tracking-wider text-indigo-500/80">→ To Remna</span>
                  </div>
                  <div className="relative text-base font-semibold mb-1">{syncLoading === "to" ? t("admin.settings.sync_in_progress") : t("admin.settings.sync_to_remna")}</div>
                  <p className="relative text-xs text-muted-foreground">Записать локальные изменения обратно в Remna-панель</p>
                </button>

                <button type="button" onClick={handleSyncCreateRemnaForMissing} disabled={syncLoading !== null} className="group relative overflow-hidden rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent p-5 text-left transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
                  <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-blue-500/10 blur-2xl group-hover:bg-blue-500/20 transition-colors" />
                  <div className="relative flex items-center gap-3 mb-2">
                    <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                      {syncLoading === "missing" ? <Loader2 className="h-5 w-5 text-blue-500 animate-spin" /> : <Link2 className="h-5 w-5 text-blue-500" />}
                    </div>
                    <span className="text-sm font-bold uppercase tracking-wider text-blue-500/80">+ Создать</span>
                  </div>
                  <div className="relative text-base font-semibold mb-1">{syncLoading === "missing" ? t("admin.settings.sync_running") : t("admin.settings.sync_create_missing")}</div>
                  <p className="relative text-xs text-muted-foreground">Создать в Remna записи для клиентов, которых там нет</p>
                </button>
              </div>
              {syncMessage && (
                <div className="rounded-xl border border-white/10 bg-card/40 p-4 text-sm">{syncMessage}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={twoFaEnableOpen} onOpenChange={(open) => !open && closeTwoFaEnable()}>
        <DialogContent className="max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              {t("admin.settings.2fa_enable_title")}
            </DialogTitle>
            <DialogDescription>
              {twoFaStep === 1
                ? t("admin.settings.2fa_scan_hint")
                : t("admin.settings.2fa_enter_code")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {twoFaLoading && !twoFaSetupData ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : twoFaStep === 1 && twoFaSetupData ? (
              <>
                <div className="flex justify-center rounded-xl bg-white p-4 dark:bg-white/95">
                  <QRCodeSVG value={twoFaSetupData.otpauthUrl} size={200} level="M" />
                </div>
                <p className="text-xs text-muted-foreground break-all font-mono bg-muted/50 rounded-lg p-2">{twoFaSetupData.secret}</p>
                <Button onClick={() => setTwoFaStep(2)}>{t("admin.settings.2fa_next")}</Button>
              </>
            ) : twoFaStep === 2 ? (
              <>
                <Input
                  placeholder="000000"
                  maxLength={6}
                  value={twoFaCode}
                  onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-lg tracking-[0.4em] font-mono"
                />
                <Button onClick={confirmTwoFaEnable} disabled={twoFaLoading || twoFaCode.length !== 6}>
                  {twoFaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("admin.settings.2fa_confirm")}
                </Button>
              </>
            ) : null}
            {twoFaError && <p className="text-sm text-destructive">{twoFaError}</p>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={twoFaDisableOpen} onOpenChange={(open) => !open && setTwoFaDisableOpen(false)}>
        <DialogContent className="max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("admin.settings.2fa_disable_title")}</DialogTitle>
            <DialogDescription>
              {t("admin.settings.2fa_disable_hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <Input
              placeholder="000000"
              maxLength={6}
              value={twoFaCode}
              onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.4em] font-mono"
            />
            <Button onClick={confirmTwoFaDisable} disabled={twoFaLoading || twoFaCode.length !== 6}>
              {twoFaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("admin.settings.2fa_disable_btn")}
            </Button>
            {twoFaError && <p className="text-sm text-destructive">{twoFaError}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
