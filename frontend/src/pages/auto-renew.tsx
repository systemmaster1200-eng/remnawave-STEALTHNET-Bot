/**
 * админ-страница «Автосписание».
 *
 * Две секции:
 *   1. ⚙️ Настройки списания (расписание + ЮKassa-recurring) — про деньги, не про текст.
 *   2. 📨 Конструктор уведомлений — список карточек шаблонов с типами событий и переменными.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { AutoRenewNotificationRecord, AutoRenewTriggerType, AdminSettings } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, Plus, Pencil, Trash2, Save, X, RefreshCw, Bell, Sparkles,
  Clock, CheckCircle2, XCircle, RotateCw, Ban, Layers, Wand2, ArrowRight,
  Sliders, CreditCard, Wallet, Info, Eye,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Предустановленные действия кнопок (как в авто-рассылках). Значение → callback/web_app/url.
//   menu:*          — открыть раздел бота (callback)
//   webapp:/path    — открыть мини-апп на странице /path (внутри Telegram)
//   __custom_url__  — произвольная внешняя ссылка
// В webapp-действиях можно использовать {{SUBSCRIPTION_ID}} — подставится id той
// подписки, по которой пришло уведомление (для кнопки «Продлить»).
const BUTTON_ACTIONS: { value: string; label: string }[] = [
  // ── Разделы бота (callback) ──
  { value: "menu:my_subs", label: "💬 Бот · Мои подписки" },
  { value: "menu:tariffs", label: "💬 Бот · Тарифы" },
  { value: "menu:topup", label: "💬 Бот · Пополнить баланс" },
  { value: "menu:profile", label: "💬 Бот · Профиль" },
  { value: "menu:trial", label: "💬 Бот · Бесплатный триал" },
  { value: "menu:referral", label: "💬 Бот · Рефералка" },
  { value: "menu:promocode", label: "💬 Бот · Промокод" },
  { value: "menu:support", label: "💬 Бот · Поддержка" },
  { value: "menu:vpn", label: "💬 Бот · VPN подключение" },
  { value: "menu:devices", label: "💬 Бот · Устройства" },
  { value: "menu:extra_options", label: "💬 Бот · Доп. опции" },
  { value: "menu:main", label: "💬 Бот · Главное меню" },
  // ── Страницы мини-аппа (web_app, открываются внутри Telegram) ──
  { value: "webapp:/cabinet/extend/{{SUBSCRIPTION_ID}}", label: "🌐 Миниапп · Продлить эту подписку" },
  { value: "webapp:/cabinet/topup", label: "🌐 Миниапп · Пополнить баланс" },
  { value: "webapp:/cabinet/tariffs", label: "🌐 Миниапп · Тарифы" },
  { value: "webapp:/cabinet/subscribe", label: "🌐 Миниапп · Подключение к VPN" },
  { value: "webapp:/cabinet/devices", label: "🌐 Миниапп · Мои устройства" },
  { value: "webapp:/cabinet/promocode", label: "🌐 Миниапп · Промокод" },
  { value: "webapp:/cabinet/trial", label: "🌐 Миниапп · Триал" },
  { value: "webapp:/cabinet/referral", label: "🌐 Миниапп · Рефералка" },
  { value: "webapp:/cabinet/profile", label: "🌐 Миниапп · Профиль" },
  { value: "webapp:/cabinet", label: "🌐 Миниапп · Главная кабинета" },
  // ── Произвольная ссылка ──
  { value: "__custom_url__", label: "🔗 Своя ссылка (URL)" },
];

// Кнопка в конструкторе. customUrl используется только когда action === "__custom_url__".
type EditorButton = { text: string; action: string; customUrl: string };

/** Запись из API (text+action) → форма редактора (с раскрытием custom URL). */
function apiButtonToEditor(b: { text: string; action: string }): EditorButton {
  const known = BUTTON_ACTIONS.some((a) => a.value === b.action && a.value !== "__custom_url__");
  if (known) return { text: b.text, action: b.action, customUrl: "" };
  // Неизвестное action (внешняя ссылка) → режим «своя ссылка».
  return { text: b.text, action: "__custom_url__", customUrl: b.action };
}

/** Дефолтный набор (показывается, когда buttons === null) — для предзаполнения при "настроить". */
const DEFAULT_EDITOR_BUTTONS: EditorButton[] = [
  { text: "📋 Мои подписки", action: "menu:my_subs", customUrl: "" },
  { text: "🏠 Главное меню", action: "menu:main", customUrl: "" },
];


const TRIGGER_INFO: Record<AutoRenewTriggerType, {
  label: string;
  Icon: typeof Clock;
  iconColor: string;
  tabGradient: string;
  cardGradient: string;
  description: string;
}> = {
  UPCOMING: {
    label: "До списания",
    Icon: Clock,
    iconColor: "text-amber-300",
    tabGradient: "from-amber-500/30 via-yellow-500/20 to-orange-500/30",
    cardGradient: "from-amber-500/10 via-yellow-500/5 to-orange-500/10 border-amber-500/30",
    description: "Напоминание ДО автосписания. Можно создать несколько (за 3 дня, за 1 день, за 15 минут).",
  },
  SUCCESS: {
    label: "Успешно",
    Icon: CheckCircle2,
    iconColor: "text-emerald-300",
    tabGradient: "from-emerald-500/30 via-green-500/20 to-teal-500/30",
    cardGradient: "from-emerald-500/10 via-green-500/5 to-teal-500/10 border-emerald-500/30",
    description: "Подтверждение после успешного списания.",
  },
  FAILED: {
    label: "Ошибка",
    Icon: XCircle,
    iconColor: "text-rose-300",
    tabGradient: "from-rose-500/30 via-red-500/20 to-pink-500/30",
    cardGradient: "from-rose-500/10 via-red-500/5 to-pink-500/10 border-rose-500/30",
    description: "Если автосписание не удалось (нет баланса, ошибка ЮKassa).",
  },
  RETRY: {
    label: "Повтор",
    Icon: RotateCw,
    iconColor: "text-violet-300",
    tabGradient: "from-violet-500/30 via-purple-500/20 to-fuchsia-500/30",
    cardGradient: "from-violet-500/10 via-purple-500/5 to-fuchsia-500/10 border-violet-500/30",
    description: "Между попытками в грейс-периоде.",
  },
  EXPIRED: {
    label: "Истёк грейс",
    Icon: Ban,
    iconColor: "text-slate-300",
    tabGradient: "from-slate-500/30 via-gray-500/20 to-zinc-500/30",
    cardGradient: "from-slate-500/10 via-gray-500/5 to-zinc-500/10 border-slate-500/30",
    description: "После всех неудач — автосписание выключается.",
  },
};

const VARIABLES_INFO = [
  { key: "{tariff_name}", desc: "Имя тарифа", example: "🌐 Стандартная" },
  { key: "{amount}", desc: "Сумма списания", example: "249" },
  { key: "{currency}", desc: "Валюта", example: "₽" },
  { key: "{days_left}", desc: "Дней до истечения", example: "3" },
  { key: "{hours_left}", desc: "Часов до истечения", example: "72" },
  { key: "{minutes_left}", desc: "Минут до истечения", example: "4320" },
  { key: "{days_unit}", desc: "«день/дня/дней» (склонение)", example: "дня" },
  { key: "{expire_date}", desc: "Дата истечения", example: "14.05.2026" },
  { key: "{sub_index}", desc: "Номер подписки", example: "2" },
  { key: "{balance}", desc: "Баланс клиента", example: "150" },
];

const SAMPLE_CONTEXT = {
  tariff_name: "🌐 Стандартная",
  amount: "249",
  currency: "₽",
  days_left: "3",
  hours_left: "72",
  minutes_left: "4320",
  days_unit: "дня",
  expire_date: "14.05.2026",
  sub_index: "2",
  balance: "150",
};

function renderSample(text: string): string {
  return Object.entries(SAMPLE_CONTEXT).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), v),
    text,
  );
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return "Сразу";
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} ч`;
  const days = Math.round(minutes / (60 * 24));
  return `${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"}`;
}

type EditState = "create" | { edit: AutoRenewNotificationRecord } | null;
type TabFilter = AutoRenewTriggerType | "ALL";

export function AutoRenewPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? null;

  const [notifs, setNotifs] = useState<AutoRenewNotificationRecord[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditState>(null);
  const [tab, setTab] = useState<TabFilter>("ALL");

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [notifRes, settingsRes] = await Promise.all([
        api.getAutoRenewNotifications(token),
        api.getSettings(token),
      ]);
      setNotifs(notifRes.items);
      setSettings(settingsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleSaveSettings = async () => {
    if (!token || !settings) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      await api.updateSettings(token, {
        defaultAutoRenewEnabled: settings.defaultAutoRenewEnabled,
        yookassaRecurringEnabled: settings.yookassaRecurringEnabled,
        autoRenewDaysBeforeExpiry: settings.autoRenewDaysBeforeExpiry,
        autoRenewGracePeriodDays: settings.autoRenewGracePeriodDays,
        autoRenewMaxRetries: settings.autoRenewMaxRetries,
      });
      setSavedMsg("Сохранено ✅");
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (n: AutoRenewNotificationRecord) => {
    if (!token) return;
    try {
      await api.updateAutoRenewNotification(token, n.id, { enabled: !n.enabled });
      setNotifs((arr) => arr.map((it) => (it.id === n.id ? { ...it, enabled: !it.enabled } : it)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleDelete = async (n: AutoRenewNotificationRecord) => {
    if (!token) return;
    if (!confirm(`Удалить шаблон «${n.name}»?`)) return;
    try {
      await api.deleteAutoRenewNotification(token, n.id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const grouped = useMemo(() => {
    const g: Record<AutoRenewTriggerType, AutoRenewNotificationRecord[]> = {
      UPCOMING: [], SUCCESS: [], FAILED: [], RETRY: [], EXPIRED: [],
    };
    notifs.forEach((n) => g[n.triggerType].push(n));
    return g;
  }, [notifs]);

  const filteredNotifs = tab === "ALL" ? notifs : grouped[tab];
  const counts = useMemo(() => {
    const c: Partial<Record<TabFilter, number>> = { ALL: notifs.length };
    (Object.keys(grouped) as AutoRenewTriggerType[]).forEach((k) => (c[k] = grouped[k].length));
    return c;
  }, [grouped, notifs.length]);

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* ── HERO ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-500/25 via-indigo-500/15 to-fuchsia-500/25 p-6 sm:p-8"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(99,102,241,0.25),_transparent_60%)] pointer-events-none" />
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-fuchsia-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-start gap-5">
          <motion.div
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
            className="h-16 w-16 rounded-2xl bg-gradient-to-br from-cyan-500/40 via-indigo-500/30 to-fuchsia-500/40 flex items-center justify-center shadow-xl border border-white/30 shrink-0 backdrop-blur"
          >
            <RefreshCw className="h-8 w-8 text-white drop-shadow" />
          </motion.div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 via-sky-300 to-fuchsia-300">
              Автосписание
            </h1>
            <p className="text-sm sm:text-base text-white/70 mt-2 max-w-2xl leading-relaxed">
              Управляйте поведением автопродления подписок и конструируйте уведомления клиентам — гибко, по событиям и с подстановкой переменных.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge label={`${notifs.length} шаблон${notifs.length === 1 ? "" : notifs.length < 5 ? "а" : "ов"}`} icon={Wand2} />
              <Badge label={settings?.yookassaRecurringEnabled ? "ЮKassa-recurring вкл." : "ЮKassa-recurring выкл."} icon={CreditCard} variant={settings?.yookassaRecurringEnabled ? "ok" : "muted"} />
              <Badge label={settings?.defaultAutoRenewEnabled ? "Default ON" : "Default OFF"} icon={Wallet} variant={settings?.defaultAutoRenewEnabled ? "ok" : "muted"} />
            </div>
          </div>
        </div>
      </motion.div>

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/10 backdrop-blur">
          <CardContent className="p-4">
            <p className="text-rose-300 text-sm">❌ {error}</p>
          </CardContent>
        </Card>
      )}

      {loading || !settings ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* ── TIMELINE визуализация ── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur p-5 sm:p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <Layers className="h-5 w-5 text-cyan-400" />
              <h2 className="font-semibold">Как работает автосписание</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <TimelineStep
                emoji="⏰" title="UPCOMING"
                desc="Напоминания клиенту перед списанием"
                count={grouped.UPCOMING.length}
                color="from-amber-500/20 to-orange-500/10 border-amber-500/30"
              />
              <TimelineArrow />
              <TimelineStep
                emoji="💳" title="Списание"
                desc={`За ${settings.autoRenewDaysBeforeExpiry ?? 1} дн до истечения`}
                badge="cron"
                color="from-cyan-500/20 to-indigo-500/10 border-cyan-500/30"
              />
              <TimelineArrow />
              <TimelineStep
                emoji="✅" title="SUCCESS / FAILED"
                desc="Уведомление о результате"
                count={grouped.SUCCESS.length + grouped.FAILED.length}
                color="from-emerald-500/20 to-rose-500/10 border-emerald-500/30"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <TimelineStep
                emoji="🔄" title="RETRY (в грейсе)"
                desc={`Грейс ${settings.autoRenewGracePeriodDays ?? 2} дн · до ${settings.autoRenewMaxRetries ?? 3} попыток`}
                count={grouped.RETRY.length}
                color="from-violet-500/20 to-fuchsia-500/10 border-violet-500/30"
              />
              <TimelineStep
                emoji="🛑" title="EXPIRED"
                desc="Все попытки исчерпаны → автосписание выкл."
                count={grouped.EXPIRED.length}
                color="from-slate-500/20 to-gray-500/10 border-slate-500/30"
              />
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-sm">
                  <Info className="h-4 w-4 text-cyan-400 shrink-0" />
                  <p className="text-muted-foreground">
                    Каждое событие триггерит <span className="text-foreground font-semibold">все активные шаблоны</span> своего типа.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Секция: Поведение списания ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur overflow-hidden"
          >
            <div className="bg-gradient-to-br from-cyan-500/15 via-indigo-500/10 to-blue-500/15 p-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-cyan-500/20 flex items-center justify-center backdrop-blur">
                  <Sliders className="h-5 w-5 text-cyan-300" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Поведение списания</h2>
                  <p className="text-xs text-muted-foreground">Когда и сколько раз cron пытается списать. <span className="text-cyan-300">Текстовые уведомления — в конструкторе ниже.</span></p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-3 p-5">
              {/* Toggles */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ToggleRow
                  title="Автопродление подписки"
                  desc="Включать автопродление (списание с баланса) для новых клиентов по умолчанию."
                  checked={settings.defaultAutoRenewEnabled ?? false}
                  onChange={(v) => setSettings((s) => (s ? { ...s, defaultAutoRenewEnabled: v } : s))}
                />
                <ToggleRow
                  title="Рекуррентные платежи ЮKassa"
                  desc={!settings.yookassaShopId || !settings.yookassaSecretKey
                    ? "Сначала настройте ЮKassa во вкладке «Платежи»."
                    : "Если баланса не хватает — спишем с сохранённой карты клиента."}
                  checked={settings.yookassaRecurringEnabled ?? false}
                  onChange={(v) => setSettings((s) => (s ? { ...s, yookassaRecurringEnabled: v } : s))}
                  disabled={!settings.yookassaShopId || !settings.yookassaSecretKey}
                />
              </div>

              {/* Numeric settings */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <NumberCard
                  label="Списать за N дней до"
                  value={settings.autoRenewDaysBeforeExpiry ?? 1}
                  min={1} max={30}
                  hint="Когда cron начинает попытки списать с баланса/карты"
                  emoji="📅"
                  onChange={(v) => setSettings((s) => (s ? { ...s, autoRenewDaysBeforeExpiry: v } : s))}
                />
                <NumberCard
                  label="Грейс-период (дн.)"
                  value={settings.autoRenewGracePeriodDays ?? 2}
                  min={0} max={14}
                  hint="Сколько дней после истечения продолжать попытки"
                  emoji="⏳"
                  onChange={(v) => setSettings((s) => (s ? { ...s, autoRenewGracePeriodDays: v } : s))}
                />
                <NumberCard
                  label="Макс. попыток списания"
                  value={settings.autoRenewMaxRetries ?? 3}
                  min={1} max={10}
                  hint="После N фейлов автосписание выключится автоматически"
                  emoji="🎯"
                  onChange={(v) => setSettings((s) => (s ? { ...s, autoRenewMaxRetries: v } : s))}
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleSaveSettings}
                  disabled={saving}
                  className="bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500 text-white hover:opacity-90"
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Сохранить настройки
                </Button>
                {savedMsg && <span className="text-sm text-emerald-300">{savedMsg}</span>}
              </div>
            </CardContent>
          </motion.section>

          {/* ── Секция: Конструктор уведомлений ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur overflow-hidden"
          >
            <div className="relative bg-gradient-to-br from-fuchsia-500/20 via-pink-500/10 to-violet-500/20 p-5 border-b border-white/10">
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-fuchsia-500/20 blur-3xl pointer-events-none" />
              <div className="relative flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-fuchsia-500/40 to-violet-500/40 flex items-center justify-center backdrop-blur shadow-lg">
                    <Wand2 className="h-5 w-5 text-fuchsia-200" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      Конструктор уведомлений
                      <Sparkles className="h-4 w-4 text-fuchsia-300 animate-pulse" />
                    </h2>
                    <p className="text-xs text-muted-foreground">Все сообщения клиенту — настраиваемые шаблоны с переменными</p>
                  </div>
                </div>
                <Button onClick={() => setEditor("create")} className="bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white hover:opacity-90">
                  <Plus className="h-4 w-4 mr-2" />
                  Создать шаблон
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="px-5 pt-4 pb-2 border-b border-white/10 flex flex-wrap gap-2">
              <TabButton active={tab === "ALL"} count={counts.ALL ?? 0} onClick={() => setTab("ALL")}>
                <Layers className="h-3.5 w-3.5 mr-1.5" />
                Все
              </TabButton>
              {(Object.keys(TRIGGER_INFO) as AutoRenewTriggerType[]).map((t) => {
                const info = TRIGGER_INFO[t];
                const Icon = info.Icon;
                return (
                  <TabButton key={t} active={tab === t} count={counts[t] ?? 0} onClick={() => setTab(t)}>
                    <Icon className={`h-3.5 w-3.5 mr-1.5 ${info.iconColor}`} />
                    {info.label}
                  </TabButton>
                );
              })}
            </div>

            <CardContent className="p-5">
              {filteredNotifs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Шаблонов в этой категории нет.</p>
                  <Button variant="outline" className="mt-3" onClick={() => setEditor("create")}>
                    <Plus className="h-4 w-4 mr-2" /> Создать первый
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {filteredNotifs.map((n) => {
                    const info = TRIGGER_INFO[n.triggerType];
                    const Icon = info.Icon;
                    return (
                      <motion.div
                        key={n.id}
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        whileHover={{ y: -2 }}
                        transition={{ type: "spring", damping: 20 }}
                        className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${info.cardGradient} p-4 ${!n.enabled ? "opacity-50" : ""} backdrop-blur`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-3 flex-wrap min-w-0">
                            <div className={`h-9 w-9 rounded-xl bg-background/40 flex items-center justify-center shrink-0 backdrop-blur`}>
                              <Icon className={`h-4 w-4 ${info.iconColor}`} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold leading-tight truncate">{n.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {info.label}{n.triggerType === "UPCOMING" ? ` · за ${formatOffset(n.offsetMinutes)}` : ""}
                              </p>
                            </div>
                          </div>
                          <Switch checked={n.enabled} onCheckedChange={() => handleToggle(n)} />
                        </div>
                        <div className="text-xs whitespace-pre-wrap line-clamp-5 text-foreground/80 bg-background/40 rounded-lg p-3 mt-2 border border-white/5 font-mono">
                          {n.messageText}
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="outline" className="bg-background/40 backdrop-blur" onClick={() => setEditor({ edit: n })}>
                            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Изменить
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300" onClick={() => handleDelete(n)}>
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Удалить
                          </Button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Подсказка про переменные */}
              <details className="mt-5 group">
                <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2 p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.06] transition-colors list-none">
                  <Info className="h-4 w-4 text-cyan-400" />
                  Переменные в тексте сообщения <span className="text-xs text-muted-foreground font-normal">(нажмите чтобы развернуть)</span>
                  <ArrowRight className="h-3.5 w-3.5 ml-auto transition-transform group-open:rotate-90" />
                </summary>
                <div className="mt-3 p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {VARIABLES_INFO.map((v) => (
                      <div key={v.key} className="flex items-start gap-2 p-2 rounded bg-background/30">
                        <code className="text-cyan-300 bg-cyan-500/10 rounded px-1.5 py-0.5 font-mono shrink-0">{v.key}</code>
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground">{v.desc}</p>
                          <p className="text-muted-foreground text-[10px]">пример: <span className="text-foreground/80">{v.example}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    💡 Поддерживается HTML Telegram: <code className="text-amber-300 bg-amber-500/10 rounded px-1">&lt;b&gt;жирный&lt;/b&gt;</code>, <code className="text-amber-300 bg-amber-500/10 rounded px-1">&lt;i&gt;курсив&lt;/i&gt;</code>, <code className="text-amber-300 bg-amber-500/10 rounded px-1">&lt;code&gt;моноширинный&lt;/code&gt;</code>.
                  </p>
                </div>
              </details>
            </CardContent>
          </motion.section>
        </>
      )}

      <AnimatePresence>
        {editor && (
          <NotifEditor
            initial={editor === "create" ? null : editor.edit}
            onClose={() => setEditor(null)}
            onSaved={async () => {
              setEditor(null);
              await load();
            }}
            token={token}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function Badge({ label, icon: Icon, variant = "neutral" }: { label: string; icon: typeof Clock; variant?: "neutral" | "ok" | "muted" }) {
  const c = variant === "ok" ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/30"
    : variant === "muted" ? "bg-white/[0.06] text-muted-foreground border-white/10"
    : "bg-cyan-500/15 text-cyan-200 border-cyan-500/30";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border backdrop-blur ${c}`}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

function TimelineStep({ emoji, title, desc, count, badge, color }: {
  emoji: string; title: string; desc: string; count?: number; badge?: string; color: string;
}) {
  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${color} p-3 relative overflow-hidden`}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">{emoji}</span>
        <p className="font-semibold text-sm">{title}</p>
        {count != null && (
          <span className="ml-auto text-[10px] bg-background/60 rounded-full px-2 py-0.5 border border-white/10">
            {count}
          </span>
        )}
        {badge && (
          <span className="ml-auto text-[10px] bg-cyan-500/20 text-cyan-300 rounded-full px-2 py-0.5 border border-cyan-500/30">
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}

function TimelineArrow() {
  return (
    <div className="hidden md:flex items-center justify-center">
      <ArrowRight className="h-5 w-5 text-muted-foreground/40" />
    </div>
  );
}

function ToggleRow({ title, desc, checked, onChange, disabled }: {
  title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 p-4 rounded-xl border bg-white/[0.03] ${disabled ? "opacity-50" : "hover:bg-white/[0.05]"} transition-colors`}>
      <div className="space-y-0.5 flex-1 min-w-0">
        <Label className="font-semibold">{title}</Label>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function NumberCard({ label, value, min, max, hint, emoji, onChange }: {
  label: string; value: number; min: number; max: number; hint: string; emoji: string; onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-xl border bg-white/[0.03] p-4 space-y-1.5 hover:bg-white/[0.05] transition-colors">
      <div className="flex items-center gap-2">
        <span className="text-lg">{emoji}</span>
        <Label className="font-medium">{label}</Label>
      </div>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || min)}
        className="text-base font-semibold"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function TabButton({ active, count, children, onClick }: { active: boolean; count: number; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center text-xs sm:text-sm px-3 py-1.5 rounded-full border transition-all ${
        active
          ? "bg-gradient-to-r from-fuchsia-500/30 to-violet-500/30 border-fuchsia-500/40 text-foreground"
          : "bg-white/[0.03] border-white/10 text-muted-foreground hover:bg-white/[0.06]"
      }`}
    >
      {children}
      <span className="ml-1.5 bg-background/60 rounded-full px-1.5 text-[10px] border border-white/10">{count}</span>
    </button>
  );
}

// ── Editor Modal ────────────────────────────────────────────────

function NotifEditor({
  initial, onClose, onSaved, token,
}: {
  initial: AutoRenewNotificationRecord | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  token: string | null;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [triggerType, setTriggerType] = useState<AutoRenewTriggerType>(initial?.triggerType ?? "UPCOMING");
  const [offsetValue, setOffsetValue] = useState(initial?.offsetMinutes ?? 15);
  const [offsetUnit, setOffsetUnit] = useState<"minutes" | "hours" | "days">(
    initial && initial.offsetMinutes % (60 * 24) === 0 && initial.offsetMinutes > 0
      ? "days"
      : initial && initial.offsetMinutes % 60 === 0 && initial.offsetMinutes > 0
        ? "hours"
        : "minutes",
  );
  const [messageText, setMessageText] = useState(initial?.messageText ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  // Конструктор кнопок. buttonsMode:
  //   "default" → buttons === null (отправляется дефолтный набор),
  //   "custom"  → отправляются кнопки из списка buttons (пустой список = без кнопок).
  const [buttonsMode, setButtonsMode] = useState<"default" | "custom">(
    initial && initial.buttons !== null ? "custom" : "default",
  );
  const [buttons, setButtons] = useState<EditorButton[]>(
    initial?.buttons ? initial.buttons.map(apiButtonToEditor) : [],
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      if (initial.offsetMinutes % (60 * 24) === 0 && initial.offsetMinutes > 0) setOffsetValue(initial.offsetMinutes / (60 * 24));
      else if (initial.offsetMinutes % 60 === 0 && initial.offsetMinutes > 0) setOffsetValue(initial.offsetMinutes / 60);
      else setOffsetValue(initial.offsetMinutes);
    }
  }, [initial]);

  const toMinutes = () => {
    const v = Math.max(0, offsetValue);
    if (offsetUnit === "days") return v * 60 * 24;
    if (offsetUnit === "hours") return v * 60;
    return v;
  };

  const handleSave = async () => {
    if (!token) return;
    setErr(null);
    if (!name.trim()) return setErr("Укажите название");
    if (!messageText.trim()) return setErr("Укажите текст сообщения");
    setSaving(true);
    try {
      // Кнопки → массив {text, action}. В "default"-режиме отправляем null
      // (бэк подставит дефолтный набор). В "custom" — заданный список ([] = без кнопок).
      let buttonsPayload: { text: string; action: string }[] | null = null;
      if (buttonsMode === "custom") {
        buttonsPayload = buttons
          .map((b) => {
            const action = b.action === "__custom_url__" ? b.customUrl.trim() : b.action;
            return { text: b.text.trim(), action };
          })
          .filter((b) => b.text && b.action);
      }
      const payload = {
        name: name.trim(),
        triggerType,
        offsetMinutes: triggerType === "UPCOMING" ? toMinutes() : 0,
        messageText: messageText.trim(),
        buttons: buttonsPayload,
        enabled,
      };
      if (initial) await api.updateAutoRenewNotification(token, initial.id, payload);
      else await api.createAutoRenewNotification(token, payload);
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const previewText = renderSample(messageText || "");

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 24 }}
        className="bg-background border border-white/10 rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-gradient-to-br from-fuchsia-500/25 via-pink-500/15 to-violet-500/25 px-6 py-4 border-b border-white/10 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-fuchsia-300" />
              {initial ? "Изменить шаблон" : "Новый шаблон уведомления"}
            </h3>
            <Button size="icon" variant="ghost" onClick={onClose}><X className="h-5 w-5" /></Button>
          </div>
        </div>
        <div className="p-6 space-y-5 grid grid-cols-1 lg:grid-cols-2 lg:gap-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Название (для админки)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Уведомление за 1 день" />
            </div>

            <div className="space-y-1.5">
              <Label>Тип события</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TRIGGER_INFO) as AutoRenewTriggerType[]).map((t) => {
                  const info = TRIGGER_INFO[t];
                  const Icon = info.Icon;
                  const active = triggerType === t;
                  return (
                    <button
                      key={t} type="button"
                      onClick={() => setTriggerType(t)}
                      className={`text-left p-3 rounded-xl border transition-all ${active ? `bg-gradient-to-br ${info.tabGradient} ring-2 ring-fuchsia-400/40` : "bg-white/[0.03] hover:bg-white/[0.06]"}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${info.iconColor}`} />
                        <p className="font-semibold text-sm">{info.label}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{info.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {triggerType === "UPCOMING" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                className="space-y-1.5 p-3 rounded-xl border bg-amber-500/10 border-amber-500/20"
              >
                <Label className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-300" /> За сколько ДО списания
                </Label>
                <div className="flex gap-2">
                  <Input type="number" min={1} value={offsetValue} onChange={(e) => setOffsetValue(parseInt(e.target.value) || 1)} className="flex-1" />
                  <select
                    value={offsetUnit}
                    onChange={(e) => setOffsetUnit(e.target.value as "minutes" | "hours" | "days")}
                    className="rounded-md border border-input bg-background px-3"
                  >
                    <option value="minutes">минут</option>
                    <option value="hours">часов</option>
                    <option value="days">дней</option>
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">Cron запускается каждый час · допуск ±30 мин</p>
              </motion.div>
            )}

            <div className="space-y-1.5">
              <Label>Текст сообщения (HTML)</Label>
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={9}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder={`⚠️ <b>Скоро автосписание</b>\n\nЧерез {days_left} {days_unit} с подписки «{tariff_name}» спишется {amount} {currency}.`}
              />
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl border bg-white/[0.03]">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <Label>Шаблон включён</Label>
            </div>

            {/* ─── Конструктор кнопок ─── */}
            <div className="space-y-3 p-3 rounded-xl border bg-white/[0.02]">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-violet-300" /> Кнопки под сообщением
                </Label>
              </div>

              {/* Режим: дефолт / свои */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setButtonsMode("default")}
                  className={`text-left p-2.5 rounded-xl border text-xs transition-all ${buttonsMode === "default" ? "bg-violet-500/15 ring-2 ring-violet-400/40" : "bg-white/[0.03] hover:bg-white/[0.06]"}`}
                >
                  <p className="font-semibold">По умолчанию</p>
                  <p className="text-muted-foreground mt-0.5">«Мои подписки» + «Главное меню»</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setButtonsMode("custom");
                    // Первый переход в custom без кнопок → предзаполняем дефолтным набором,
                    // чтобы было что редактировать. Пустой список оставляем как есть.
                    if (buttons.length === 0 && !(initial?.buttons && initial.buttons.length === 0)) {
                      setButtons(DEFAULT_EDITOR_BUTTONS.map((b) => ({ ...b })));
                    }
                  }}
                  className={`text-left p-2.5 rounded-xl border text-xs transition-all ${buttonsMode === "custom" ? "bg-violet-500/15 ring-2 ring-violet-400/40" : "bg-white/[0.03] hover:bg-white/[0.06]"}`}
                >
                  <p className="font-semibold">Настроить свои</p>
                  <p className="text-muted-foreground mt-0.5">Добавить / убрать кнопки</p>
                </button>
              </div>

              {buttonsMode === "custom" && (
                <div className="space-y-2.5">
                  {buttons.length === 0 && (
                    <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                      Кнопок нет — сообщение отправится без кнопок.
                    </p>
                  )}
                  {buttons.map((b, i) => (
                    <div key={i} className="space-y-2 p-2.5 rounded-xl border border-white/10 bg-white/[0.02]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">Кнопка {i + 1}</span>
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 px-2 text-rose-400 hover:text-rose-300"
                          onClick={() => setButtons((arr) => arr.filter((_, idx) => idx !== i))}
                        >
                          Удалить
                        </Button>
                      </div>
                      <Input
                        value={b.text}
                        onChange={(e) => setButtons((arr) => arr.map((x, idx) => idx === i ? { ...x, text: e.target.value } : x))}
                        placeholder="Текст кнопки (напр. 📋 Мои подписки)"
                      />
                      <select
                        value={b.action}
                        onChange={(e) => setButtons((arr) => arr.map((x, idx) => idx === i ? { ...x, action: e.target.value } : x))}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {BUTTON_ACTIONS.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                      {b.action === "__custom_url__" && (
                        <Input
                          value={b.customUrl}
                          onChange={(e) => setButtons((arr) => arr.map((x, idx) => idx === i ? { ...x, customUrl: e.target.value } : x))}
                          placeholder="https://example.com"
                        />
                      )}
                    </div>
                  ))}
                  {buttons.length < 8 && (
                    <Button
                      type="button" variant="outline" size="sm"
                      className="w-full bg-background/40"
                      onClick={() => setButtons((arr) => [...arr, { text: "", action: "menu:my_subs", customUrl: "" }])}
                    >
                      + Добавить кнопку
                    </Button>
                  )}
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    🌐 «Миниапп» открывает страницу внутри Telegram. «Продлить эту подписку»
                    автоматически ведёт на ту подписку, по которой пришло уведомление —
                    в шаблонах типа <b>До списания</b>, <b>Ошибка</b>, <b>Повтор</b>.
                    Если у уведомления нет конкретной подписки, такая кнопка просто не покажется.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Preview column */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-sm">
              <Eye className="h-4 w-4 text-cyan-300" /> Live preview (с подстановкой)
            </Label>
            <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-indigo-500/10 p-5 min-h-[200px] backdrop-blur">
              <div className="text-xs text-cyan-300 mb-2 font-mono">📱 Telegram</div>
              <div className="bg-background/60 rounded-xl p-4 border border-white/5 text-sm whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: previewText || "<span class='text-muted-foreground italic'>Введите текст сообщения слева — здесь будет preview...</span>" }} />
              {/* Превью кнопок */}
              {(() => {
                const previewBtns = buttonsMode === "default"
                  ? DEFAULT_EDITOR_BUTTONS
                  : buttons.filter((b) => b.text.trim() && (b.action !== "__custom_url__" || b.customUrl.trim()));
                if (previewBtns.length === 0) return null;
                return (
                  <div className="mt-2 space-y-1.5">
                    {previewBtns.map((b, i) => (
                      <div key={i} className="bg-background/80 rounded-lg px-3 py-2 border border-cyan-500/20 text-center text-xs font-medium text-cyan-100">
                        {b.text.trim() || "—"}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <details className="group">
              <summary className="cursor-pointer text-xs font-semibold flex items-center gap-2 p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.06] transition-colors list-none">
                <Info className="h-3.5 w-3.5 text-cyan-400" />
                Подставить переменную в текст
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-1">
                {VARIABLES_INFO.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setMessageText((t) => t + v.key)}
                    className="text-left text-xs p-2 rounded bg-white/[0.03] hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
                  >
                    <code className="text-cyan-300 bg-cyan-500/10 rounded px-1.5 py-0.5 font-mono shrink-0">{v.key}</code>
                    <span className="text-muted-foreground truncate">{v.desc}</span>
                  </button>
                ))}
              </div>
            </details>
          </div>

          {err && <p className="text-rose-300 text-sm lg:col-span-2">❌ {err}</p>}

          <div className="flex gap-2 pt-2 lg:col-span-2">
            <Button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-fuchsia-500 via-pink-500 to-violet-500 text-white flex-1 hover:opacity-90">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {initial ? "Сохранить изменения" : "Создать шаблон"}
            </Button>
            <Button variant="outline" onClick={onClose}>Отмена</Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default AutoRenewPage;
