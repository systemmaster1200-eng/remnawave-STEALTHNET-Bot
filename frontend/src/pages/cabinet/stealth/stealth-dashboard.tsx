/**
 * Stealth Dashboard — главная страница нового дизайна.
 *
 * мультиподписочность как в основном кабинете:
 *   1. Hero/визуал — мягкое свечение + большое лого/иконка над контентом
 *   2. Карточка «Подписки»: СПИСОК всех подписок клиента (единый код для любой —
 *      никаких спецслучаев для «нулевой»). На каждой: статус, «до даты», остаток
 *      дней, кнопки «Продлить» (/cabinet/tariffs?extend=id) и «Настроить»
 *      (/cabinet/subscribe?sub=id).
 *   3. Общие действия: установка VPN, промокоды, устройства, рефералка.
 *   4. Если подписок нет — hero + большая красная Buy CTA.
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Gift, Calendar, Clock, Plus, Check, Wallet, Wifi, Copy } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { LinkReminderModal } from "@/components/stealth/link-reminder-modal";
import { cn } from "@/lib/utils";

interface SubCard {
  id: string;
  type: "root" | "secondary";
  index: number;
  label: string;
  emoji: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
  isActive: boolean;
  isTrial: boolean;
  /** false → у триала нет кнопок продления/конвертации вовсе. */
  trialConvertEnabled: boolean;
  /** тариф подписки — нужен для тоггла автосписания (без тарифа списывать нечего). */
  tariffId: string | null;
  autoRenewEnabled: boolean;
  /** «ID Remna» (числовой id пользователя в Remnawave) — как в админ-карточке. */
  remnaId: string | null;
}

type PaySuccessKind = "topup" | "tariff" | "generic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return "—"; }
}

/**
 * Развернуть Remnawave-обёртку: ответ может приходить как
 * { response: {...} }, { data: { response: {...} } }, либо плоский объект.
 * Идентичная логика используется в classic-dashboard parseSubscription.
 */
function unwrapRemnaSub(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const raw = sub as Record<string, unknown>;
  if (raw.response && typeof raw.response === "object") return raw.response as Record<string, unknown>;
  if (raw.data && typeof raw.data === "object") {
    const d = raw.data as Record<string, unknown>;
    if (d.response && typeof d.response === "object") return d.response as Record<string, unknown>;
  }
  return raw;
}

function fmtBalance(n: number, currency: string) {
  const sym = currency === "rub" || currency === "RUB" ? "₽" : currency === "usd" || currency === "USD" ? "$" : currency.toUpperCase();
  return `${Math.round(n)}${sym}`;
}

export function StealthDashboard() {
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [subs, setSubs] = useState<SubCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0); // bump чтобы перезагрузить инфо после модалок
  const [trialsCount, setTrialsCount] = useState(0);
  // id карточки, чей Remna-ID только что скопирован (для галочки).
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Напоминание о привязке email/TG — показываем один раз за сессию вкладки.
  const [linkReminderOpen, setLinkReminderOpen] = useState(false);
  const [linkReminderDismissed, setLinkReminderDismissed] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState<PaySuccessKind | null>(null);
  const [autoRenewBusyId, setAutoRenewBusyId] = useState<string | null>(null);
  const [autoRenewError, setAutoRenewError] = useState<{ id: string; message: string } | null>(null);

  // T-pay-success-modal: ЕДИНЫЙ детект возврата с любой платёжки (как в classic client-dashboard).
  // Бэкенд редиректит по-разному: ?payment=success, ?yookassa=success, ?heleket=success,
  // ?yoomoney_form=success, ?lava=success, ?lavatop=success, ?overpay=return.
  useEffect(() => {
    const providerSuccess =
      searchParams.get("payment") === "success" ||
      searchParams.get("yoomoney_form") === "success" ||
      searchParams.get("yookassa") === "success" ||
      searchParams.get("heleket") === "success" ||
      searchParams.get("lava") === "success" ||
      searchParams.get("lavatop") === "success" ||
      searchParams.get("overpay") === "return";
    if (!providerSuccess) return;
    const paymentKind = searchParams.get("payment_kind");
    const kind: PaySuccessKind = paymentKind === "topup" ? "topup" : paymentKind === "tariff" ? "tariff" : "generic";
    setPaySuccess(kind);
    setSearchParams({}, { replace: true });
    setReloadKey((k) => k + 1);
    if (state.token) refreshProfile().catch(() => {});
  }, [searchParams, setSearchParams, state.token, refreshProfile]);

  useEffect(() => {
    if (!state.token) return;
    let alive = true;
    setLoading(true);
    api.clientAllSubscriptions(state.token).catch((): { items: [] } => ({ items: [] }))
      .then((all) => {
      if (!alive) return;
      const cards: SubCard[] = (all.items ?? []).map((it) => {
        const s = unwrapRemnaSub(it.subscription);
        const expireAt = typeof s?.expireAt === "string" ? s.expireAt : null;
        const expDate = expireAt ? new Date(expireAt) : null;
        const validDate = expDate && !Number.isNaN(expDate.getTime()) ? expDate : null;
        const isActive = !!validDate && validDate.getTime() > Date.now();
        const daysLeft = isActive
          ? Math.max(0, Math.ceil((validDate!.getTime() - Date.now()) / 86_400_000))
          : null;
        const idx = it.subscriptionIndex ?? 0;
        return {
          id: it.id,
          type: it.type,
          index: idx,
          label: it.tariffDisplayName?.trim() || `Подписка #${idx}`,
          emoji: it.tariffMenuEmoji ?? null,
          expiresAt: expireAt,
          daysLeft,
          isActive,
          isTrial: Boolean(it.trialId),
          trialConvertEnabled: it.trialConvertEnabled ?? true,
          tariffId: it.tariffId ?? null,
          autoRenewEnabled: it.autoRenewEnabled === true,
          // «ID Remna» — числовой id пользователя в Remna (как в админ-карточке,
          // раздел Подписки → Данные Remna → «ID Remna»).
          remnaId: (s?.id != null ? String(s.id) : null),
        };
      });
      setSubs(cards);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [state.token, reloadKey]);

  // Напоминание о привязке: если у клиента нет email и/или Telegram — показываем
  // модалку (с задержкой, чтобы авто-привязка TG в мини-аппе успела отработать).
  // Выбор «Добавлю позже» запоминаем в localStorage по составу недостающего —
  // если позже отвалится что-то ещё, напоминание появится снова.
  useEffect(() => {
    if (linkReminderDismissed) return;
    const client = state.client;
    if (!client) return;
    const missingEmail = !client.email;
    const missingTelegram = !client.telegramId;
    if (!missingEmail && !missingTelegram) return;
    const key = `linkReminderDismissed:${client.id}:${missingEmail ? "e" : ""}${missingTelegram ? "t" : ""}`;
    try {
      if (localStorage.getItem(key) === "1") return;
    } catch { /* localStorage недоступен — просто покажем */ }
    const t = setTimeout(() => {
      if (!state.client) return;
      if (state.client.email && state.client.telegramId) return;
      setLinkReminderOpen(true);
    }, 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.client?.email, state.client?.telegramId, linkReminderDismissed]);

  // Закрытие напоминания: запоминаем выбор, чтобы не показывать снова.
  function dismissLinkReminder() {
    setLinkReminderOpen(false);
    setLinkReminderDismissed(true);
    const client = state.client;
    if (client) {
      const key = `linkReminderDismissed:${client.id}:${!client.email ? "e" : ""}${!client.telegramId ? "t" : ""}`;
      try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
    }
  }

  // Доступные триалы: если есть хоть один — показываем кнопку «🎁 Пробный период».
  // reloadKey в deps: после активации триал исчезает из списка → кнопка скрывается.
  useEffect(() => {
    if (!state.token) return;
    let alive = true;
    api.getClientAvailableTrials(state.token)
      .then((res) => { if (alive) setTrialsCount(res.items.length); })
      .catch(() => { if (alive) setTrialsCount(0); });
    return () => { alive = false; };
  }, [state.token, reloadKey]);

  // Тоггл автосписания конкретной подписки — optimistic, с откатом при ошибке.
  async function toggleAutoRenew(sub: SubCard) {
    if (!state.token || autoRenewBusyId) return;
    const next = !sub.autoRenewEnabled;
    setAutoRenewBusyId(sub.id);
    setAutoRenewError(null);
    setSubs((prev) => prev?.map((x) => (x.id === sub.id ? { ...x, autoRenewEnabled: next } : x)) ?? prev);
    try {
      await api.clientSetSubscriptionAutoRenew(state.token, sub.type, sub.id, next);
    } catch (e) {
      // откат optimistic-обновления
      setSubs((prev) => prev?.map((x) => (x.id === sub.id ? { ...x, autoRenewEnabled: sub.autoRenewEnabled } : x)) ?? prev);
      setAutoRenewError({ id: sub.id, message: e instanceof Error ? e.message : "Не удалось изменить автосписание" });
    } finally {
      setAutoRenewBusyId(null);
    }
  }

  const hasAnySub = (subs?.length ?? 0) > 0;
  const hasActiveSub = (subs ?? []).some((s) => s.isActive);

  // Триал поддерживает ДВЕ системы (как в классическом client-dashboard.tsx):
  //   1. Новая мультитриальная (таблица trial) → trialsCount > 0.
  //   2. Legacy одиночный триал из настроек (config.trialEnabled + trialDays),
  //      доступен пока он не использован (client.trialUsed === false) и нет
  //      активной подписки, и только если новых мультитриалов нет.
  const hasMultiTrials = trialsCount > 0;
  const showLegacyTrial =
    !hasActiveSub && Boolean(config?.trialEnabled) && !state.client?.trialUsed && !hasMultiTrials;
  // При активной подписке триал не предлагаем вообще — кнопка «🎁 Пробный период»
  // (и большая CTA «Начать бесплатно») скрываются.
  const showAnyTrial = !hasActiveSub && (hasMultiTrials || showLegacyTrial);

  // «Начать бесплатно» / «🎁 Пробный период»:
  //   - мультитриалы → открыть модалку выбора триала;
  //   - иначе → активировать legacy single-trial напрямую (POST /client/trial).
  async function activateTrial() {
    if (!state.token || trialLoading) return;
    if (hasMultiTrials) {
      setTrialError(null);
      navigate("/cabinet/trial");
      return;
    }
    setTrialError(null);
    setTrialLoading(true);
    try {
      await api.clientActivateTrial(state.token);
      await refreshProfile().catch(() => {});
      setReloadKey((k) => k + 1);
    } catch (e) {
      setTrialError(e instanceof Error ? e.message : "Не удалось активировать пробный период");
    } finally {
      setTrialLoading(false);
    }
  }

  return (
    <div className="px-4 pt-1 space-y-5">
      {/* Hero — большой светящийся шар-логотип с живой пульсацией */}
      <div className="relative h-36 md:h-48 flex items-center justify-center">
        {/* Баланс + кнопка пополнения «+» слева, в один ряд — справа от щита */}
        {state.client && (
          <div className="absolute top-2 right-1 z-10 inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate("/cabinet/topup")}
              aria-label="Пополнить баланс"
              className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-gradient-to-b from-blue-500 to-blue-600 border border-blue-400/40 text-white shadow-[0_0_16px_-4px_rgba(47,107,255,0.7),inset_0_1px_0_rgba(255,255,255,0.3)] hover:from-blue-400 hover:to-blue-500 active:scale-95 transition"
            >
              <Plus className="h-4 w-4" strokeWidth={2.8} />
            </button>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-blue-500/25 px-3 py-1.5 backdrop-blur-md shadow-[0_0_20px_-8px_rgba(47,107,255,0.5)]">
              <Wallet className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-sm font-bold tabular-nums text-blue-100">
                {fmtBalance(state.client.balance ?? 0, state.client.preferredCurrency || "RUB")}
              </span>
            </div>
          </div>
        )}
        <motion.div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(closest-side, rgba(47,107,255,0.22), transparent 65%)",
            filter: "blur(14px)",
          }}
          animate={{ opacity: [0.7, 1, 0.7], scale: [1, 1.06, 1] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* внешнее тающее кольцо-эхо */}
        <motion.div
          className="absolute h-44 w-44 md:h-56 md:w-56 rounded-full border border-blue-500/15"
          animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0.15, 0.5] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden="true"
        />
        <motion.div
          className="relative h-32 w-32 md:h-40 md:w-40 rounded-full bg-gradient-to-br from-zinc-900 to-black border border-blue-500/25 flex items-center justify-center shadow-[0_0_70px_-10px_rgba(47,107,255,0.55),inset_0_0_34px_rgba(47,107,255,0.12)]"
          animate={{ scale: [1, 1.03, 1] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <svg
            viewBox="0 0 100 116"
            className="h-16 w-16 md:h-20 md:w-20 drop-shadow-[0_0_16px_rgba(47,107,255,0.7)]"
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="alexsolShieldEdge" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#7ea8ff" />
                <stop offset="55%" stopColor="#2f6bff" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
              <linearGradient id="alexsolShieldFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(47,107,255,0.30)" />
                <stop offset="100%" stopColor="rgba(34,211,238,0.10)" />
              </linearGradient>
            </defs>
            {/* контур щита со светящимся краем */}
            <path
              d="M50 4 L92 19 V56 C92 86 73 106 50 114 C27 106 8 86 8 56 V19 Z"
              fill="url(#alexsolShieldFill)"
              stroke="url(#alexsolShieldEdge)"
              strokeWidth="3.5"
              strokeLinejoin="round"
            />
            {/* тонкая внутренняя грань */}
            <path
              d="M50 14 L82 25 V56 C82 80 67 96 50 103 C33 96 18 80 18 56 V25 Z"
              fill="none"
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
              strokeLinejoin="round"
            />
            {/* дужка замка */}
            <path
              d="M39 55 V47 a11 11 0 0 1 22 0 V55"
              fill="none"
              stroke="#dbe6ff"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
            {/* корпус замка */}
            <rect x="33" y="55" width="34" height="28" rx="6" fill="#eaf1ff" />
            {/* скважина */}
            <circle cx="50" cy="66" r="3.6" fill="#0b1220" />
            <rect x="48.4" y="66" width="3.2" height="11" rx="1.3" fill="#0b1220" />
          </svg>
        </motion.div>
      </div>

      {/* CTA — ТОЛЬКО для новых пользователей без единой подписки.
          Для истёкших подписок отдельная кнопка здесь не нужна: продление
          доступно прямо в карточке подписки (и работает корректно). */}
      <AnimatePresence>
        {!loading && !hasActiveSub && !hasAnySub && (
          <motion.div
            className="px-1"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
          >
            {showAnyTrial ? (
              // Новый пользователь с доступным триалом (мульти ИЛИ legacy):
              // «Начать бесплатно» активирует пробный период, а НЕ ведёт на покупку.
              <>
                <StadiumButton
                  variant="danger" size="lg"
                  disabled={trialLoading}
                  onClick={activateTrial}
                >
                  {trialLoading ? "Активируем…" : "Начать бесплатно"}
                </StadiumButton>
                {trialError && (
                  <p className="mt-2 text-center text-sm text-blue-400 break-words">{trialError}</p>
                )}
              </>
            ) : (
              // Нет триала и нет подписок → ведём на оформление первой подписки.
              <StadiumButton
                variant="primary" size="lg"
                onClick={() => navigate("/cabinet/tariffs")}
              >
                Оформить подписку
              </StadiumButton>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subscriptions card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative rounded-3xl bg-white/[0.04] border border-white/[0.08] p-5 backdrop-blur-2xl space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_-24px_rgba(0,0,0,0.8)] before:absolute before:inset-0 before:rounded-3xl before:bg-gradient-to-b before:from-white/[0.05] before:to-transparent before:pointer-events-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight">
            📋 Мои подписки
          </h2>
          {!loading && !hasAnySub && (
            <span className="rounded-full bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Нет подписки
            </span>
          )}
        </div>

        {/* Список подписок — единый рендер для любой (включая index 0) */}
        {hasAnySub && (
          <div className="space-y-2.5">
            {(subs ?? []).map((s, subIdx) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: subIdx * 0.07, ease: "easeOut" }}
                whileHover={{ scale: 1.015 }}
                className={cn(
                  "relative rounded-2xl border p-3.5 space-y-2.5 transition-all duration-300 backdrop-blur-xl",
                  s.isActive
                    ? "bg-white/[0.04] border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-blue-500/30 hover:shadow-[0_0_40px_-12px_rgba(47,107,255,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "bg-zinc-900/40 border-white/[0.05]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="relative flex h-2 w-2 shrink-0">
                      {s.isActive && (
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                      )}
                      <span
                        className={cn(
                          "relative inline-flex h-2 w-2 rounded-full",
                          s.isActive
                            ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                            : "bg-zinc-600",
                        )}
                      />
                    </span>
                    <span className="text-sm font-bold truncate">
                      {s.emoji ? `${s.emoji} ` : ""}{s.label}
                    </span>
                    {s.isTrial && (
                      <span className="shrink-0 rounded-md bg-blue-500/10 border border-blue-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
                        проба
                      </span>
                    )}
                  </div>
                  {s.isActive ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2 py-1 text-[11px] tabular-nums shrink-0">
                      <Clock className="h-3 w-3 text-zinc-400" strokeWidth={2.2} />
                      {s.daysLeft} дн.
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-lg bg-zinc-800/80 border border-white/[0.05] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      истекла
                    </span>
                  )}
                </div>

                {/* Дата — на своей строке; ниже кнопка «Продлить»/«Конвертировать»
                    во всю ширину. Кнопка «Настроить» убрана — её функционал есть в
                    «Подключиться к VPN». */}
                <div className="space-y-2">
                  {/* Ваш ID (Remna) — ярко, ВЫШЕ даты. Копируется по тапу. */}
                  {s.remnaId && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(s.remnaId!);
                        setCopiedId(s.id);
                        setTimeout(() => setCopiedId((c) => (c === s.id ? null : c)), 1500);
                      }}
                      className="flex items-center gap-2 w-full min-w-0 rounded-xl bg-blue-500/10 border border-blue-500/30 px-3 py-2 hover:bg-blue-500/15 transition active:scale-[0.98]"
                      title="Скопировать ID"
                    >
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-blue-300/90">Ваш ID</span>
                      <span className="font-mono text-sm font-bold text-blue-100 truncate flex-1 text-left tabular-nums">{s.remnaId}</span>
                      {copiedId === s.id
                        ? <Check className="h-4 w-4 text-emerald-400 shrink-0" strokeWidth={2.4} />
                        : <Copy className="h-4 w-4 text-blue-300/80 shrink-0" strokeWidth={2} />}
                    </button>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 tabular-nums">
                    <Calendar className="h-3 w-3 text-blue-400/80" strokeWidth={2.2} />
                    до {formatDate(s.expiresAt)}
                  </span>
                  {/* триал: «Конвертировать» = выбор тарифа в каталоге (navigate),
                      обычная подписка: продление в диалоге без ухода со страницы. */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Зелёная «Подключить» — открывает страницу подписки (детали + подключение). */}
                    <button
                      onClick={() => navigate(`/cabinet/subscription/${encodeURIComponent(s.id)}`)}
                      className="min-w-0 justify-center rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 border border-emerald-400/40 px-3 py-2.5 text-sm font-bold text-white shadow-[0_0_22px_-4px_rgba(16,185,129,0.75),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-95 transition-all duration-300 inline-flex items-center gap-1.5"
                    >
                      <Wifi className="h-4 w-4 shrink-0" />
                      <span className="truncate">Подключить</span>
                    </button>
                    {(!s.isTrial || s.trialConvertEnabled) ? (
                      <button
                        onClick={() => {
                          if (s.isTrial) navigate(`/cabinet/tariffs?extend=${encodeURIComponent(s.id)}`);
                          else navigate(`/cabinet/extend/${encodeURIComponent(s.id)}`);
                        }}
                        className="min-w-0 justify-center rounded-2xl bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 border border-red-400/40 px-3 py-2.5 text-sm font-bold text-white shadow-[0_0_22px_-4px_rgba(239,68,68,0.75),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-95 transition-all duration-300 inline-flex items-center gap-1.5"
                      >
                        <Zap className="h-4 w-4 shrink-0" />
                        <span className="truncate">{s.isTrial ? "Купить подписку" : "Продлить"}</span>
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                </div>

                {/* Тоггл автосписания — только для НЕ-триальных подписок с тарифом. */}
                {!s.isTrial && s.tariffId && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[11px] text-zinc-400">♻️ Автосписание</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s.autoRenewEnabled}
                        aria-label="Автосписание"
                        disabled={autoRenewBusyId !== null}
                        onClick={() => toggleAutoRenew(s)}
                        className={cn(
                          "relative h-5 w-9 rounded-full border transition-colors shrink-0",
                          s.autoRenewEnabled
                            ? "bg-emerald-500/80 border-emerald-400/40"
                            : "bg-zinc-700/70 border-white/[0.08]",
                          autoRenewBusyId !== null && "opacity-60",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                            s.autoRenewEnabled ? "translate-x-4" : "translate-x-0",
                          )}
                        />
                      </button>
                    </div>
                    {autoRenewError?.id === s.id && (
                      <p className="text-[10px] leading-snug text-blue-400">{autoRenewError.message}</p>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* Action stack */}
        <div className="space-y-2.5 pt-1">
          <StadiumButton
            variant="ghost"
            size="md"
            iconLeft={hasAnySub ? <Plus className="h-4 w-4 text-blue-400" /> : <Zap className="h-4 w-4 text-blue-400" />}
            onClick={() => navigate("/cabinet/tariffs")}
          >
            {hasAnySub ? "Оформить ещё подписку" : "Оформить подписку"}
          </StadiumButton>

          <StadiumButton
            variant="ghost" size="md"
            iconLeft={<Gift className="h-4 w-4 text-zinc-400" />}
            onClick={() => navigate("/cabinet/promocode")}
          >
            Промокоды
          </StadiumButton>
        </div>
      </motion.div>

      {/* Если активных подписок нет — большая Buy CTA */}

      {/* Модалка «Оплата прошла» при возврате с платёжки. */}
      <AnimatePresence>
        {paySuccess !== null && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center pb-24 sm:pb-0 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setPaySuccess(null)}
              aria-hidden="true"
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-emerald-500/20 bg-zinc-900/95 p-6 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6),0_0_50px_-10px_rgba(52,211,153,0.35)]"
            >
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 h-40 w-40 rounded-full bg-emerald-500/25 blur-3xl pointer-events-none" />
              <div className="relative flex flex-col items-center gap-4 text-center">
                <motion.div
                  initial={{ scale: 0, rotate: -25 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
                  className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 shadow-xl shadow-emerald-500/40"
                >
                  <Check className="h-10 w-10 text-white" strokeWidth={3} />
                </motion.div>
                <h3 className="text-2xl font-black tracking-tight">Оплата прошла ✨</h3>
                <p className="text-sm leading-relaxed text-zinc-400 px-1">
                  {paySuccess === "topup"
                    ? "Баланс пополнен — средства уже на счету."
                    : paySuccess === "tariff"
                      ? "Спасибо за покупку! Подписка активируется автоматически в течение минуты."
                      : "Спасибо за покупку! Если подписка не появилась сразу — обновите страницу через минуту."}
                </p>
                <button
                  type="button"
                  onClick={() => setPaySuccess(null)}
                  className="mt-1 w-full h-12 rounded-2xl text-base font-bold text-white bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 active:scale-[0.98] transition shadow-[0_8px_24px_-8px_rgba(52,211,153,0.6)]"
                >
                  Отлично
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <LinkReminderModal
        open={linkReminderOpen}
        missingEmail={!state.client?.email}
        missingTelegram={!state.client?.telegramId}
        onClose={() => setLinkReminderOpen(false)}
        onDismiss={dismissLinkReminder}
      />
    </div>
  );
}
