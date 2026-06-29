/**
 * красивая модалка продления подписки прямо из дашборда.
 *
 * Раньше «Продлить» уводила юзера в каталог тарифов (?extend=...) — дёргано и
 * неочевидно. Теперь продление — это один диалог: срок → доп. устройства →
 * способ оплаты, без ухода со страницы.
 *
 * Компонент самодостаточен: по subId сам загружает подписку (clientAllSubscriptions),
 * её тариф (getPublicTariffs) и платёжный конфиг (getPublicConfig). Оплата уходит
 * с extendsSecondarySubId — единый механизм для ЛЮБОЙ подписки (включая index 0).
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Wallet, CreditCard, Loader2, Calendar, Smartphone } from "lucide-react";
import { api, type PublicConfig, type PublicTariffCategory } from "@/lib/api";
import { useClientAuth } from "@/contexts/client-auth";
import { StealthModal } from "@/components/stealth/stealth-modal";
import { WizardHeader } from "@/components/stealth/wizard-header";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { PayNowPanel } from "@/components/payment/pay-now-panel";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatRuDays } from "@/lib/i18n";

const EXTRA_DEVICE_BASE_DAYS = 30;

// Расчёт цены докупаемых устройств — зеркало backend applyExtraDevicesPrice.
function calcExtraDevicesPrice(
  pricePerExtraDevice: number,
  extraCount: number,
  tiers: { minExtraDevices: number; discountPercent: number }[] | undefined,
  durationDays: number,
): number {
  const safeCount = Math.max(0, Math.floor(extraCount));
  if (safeCount === 0 || pricePerExtraDevice <= 0) return 0;
  const sorted = [...(tiers ?? [])].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const applied = sorted.find((t) => safeCount >= t.minExtraDevices) ?? null;
  const discount = applied ? applied.discountPercent : 0;
  const durationCoeff = Math.max(1, durationDays) / EXTRA_DEVICE_BASE_DAYS;
  const monthlyWithDiscount = pricePerExtraDevice * safeCount * (100 - discount) / 100;
  return Math.round(monthlyWithDiscount * durationCoeff * 100) / 100;
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface SubData {
  id: string;
  index: number;
  label: string;
  tariffId: string | null;
  extraDevices: number;
  extraDevicesMonthlyPrice: number;
  expireAt: string | null;
}

interface TariffData {
  id: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  priceOptions: { id: string; durationDays: number; price: number }[];
  // Доп. устройства (для степпера докупки при продлении).
  includedDevices?: number;
  pricePerExtraDevice?: number;
  maxExtraDevices?: number;
  deviceDiscountTiers?: { minExtraDevices: number; discountPercent: number }[];
}

export function ExtendSubscriptionDialog({
  subId,
  open,
  onClose,
  onPaidByBalance,
  asPage = false,
}: {
  subId: string;
  open: boolean;
  onClose: () => void;
  /** Балансовая оплата мгновенна — родитель обновляет данные дашборда. */
  onPaidByBalance?: () => void;
  /** Рендер отдельной полноэкранной страницей (WizardHeader) вместо модалки. */
  asPage?: boolean;
}) {
  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();
  const token = state.token;
  const client = state.client;

  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<SubData | null>(null);
  const [allTariffs, setAllTariffs] = useState<TariffData[]>([]);
  const [selectedTariffId, setSelectedTariffId] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  // Выбранное ИТОГОВОЕ кол-во доп. устройств (стартует с текущего; докупать можно,
  // уменьшать нельзя — текущие всегда сохраняются).
  const [selectedExtra, setSelectedExtra] = useState(0);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // Выбранный способ оплаты (id провайдера или "balance"). Кнопка «Оплатить»
  // запускает payWith с этим значением — выбор плиткой, как на странице покупки.
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string; paymentId?: string } | null>(null);

  // Загрузка: подписка + её тариф + платёжный конфиг.
  useEffect(() => {
    if (!open || !token) return;
    let alive = true;
    setLoading(true);
    setPayError(null);
    Promise.all([
      api.clientAllSubscriptions(token).catch((): { items: [] } => ({ items: [] })),
      api.getPublicTariffs().catch((): { items: PublicTariffCategory[] } => ({ items: [] })),
      api.getPublicConfig().catch(() => null),
    ]).then(([all, tariffsRes, cfg]) => {
      if (!alive) return;
      const it = (all.items ?? []).find((s) => s.id === subId) ?? null;
      if (it) {
        const idx = it.subscriptionIndex ?? 0;
        setSub({
          id: it.id,
          index: idx,
          label: it.tariffDisplayName?.trim() || `Подписка #${idx}`,
          tariffId: it.tariffId ?? null,
          extraDevices: it.extraDevices ?? 0,
          extraDevicesMonthlyPrice: it.extraDevicesMonthlyPrice ?? 0,
          expireAt: (() => {
            const raw = it.subscription as Record<string, unknown> | null;
            const payload = (raw && typeof raw === "object" && raw.response && typeof raw.response === "object")
              ? (raw.response as Record<string, unknown>)
              : raw;
            return payload && typeof payload.expireAt === "string" ? payload.expireAt : null;
          })(),
        });
        // Все доступные тарифы из каталога — продлевать можно на любой.
        const flat: TariffData[] = (tariffsRes.items ?? [])
          .flatMap((c) => c.tariffs)
          .map((t) => ({
            id: t.id,
            name: t.name,
            price: t.price,
            currency: t.currency,
            durationDays: t.durationDays,
            priceOptions: (t.priceOptions ?? []).map((o) => ({ id: o.id, durationDays: o.durationDays, price: o.price })),
            includedDevices: t.includedDevices,
            pricePerExtraDevice: t.pricePerExtraDevice,
            maxExtraDevices: t.maxExtraDevices,
            deviceDiscountTiers: t.deviceDiscountTiers,
          }));
        setAllTariffs(flat);
        // По умолчанию — текущий тариф подписки (если он ещё в каталоге), иначе первый.
        const current = flat.find((tf) => tf.id === it.tariffId) ?? flat[0] ?? null;
        setSelectedTariffId(current?.id ?? null);
      } else {
        setSub(null);
      }
      setConfig(cfg);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, token, subId]);

  const tariff = useMemo(
    () => allTariffs.find((t) => t.id === selectedTariffId) ?? null,
    [allTariffs, selectedTariffId],
  );

  // Стартовое кол-во устройств = текущее на подписке (его можно только увеличивать).
  useEffect(() => {
    setSelectedExtra(sub?.extraDevices ?? 0);
  }, [sub?.extraDevices]);

  // переустанавливаем на дефолт (30 дней или первая).
  useEffect(() => {
    if (!tariff) return;
    const belongs = tariff.priceOptions.some((o) => o.id === selectedOptionId);
    if (!belongs) {
      const def = tariff.priceOptions.find((o) => o.durationDays === 30) ?? tariff.priceOptions[0];
      setSelectedOptionId(def?.id ?? null);
    }
  }, [tariff, selectedOptionId]);

  const option = tariff?.priceOptions.find((o) => o.id === selectedOptionId) ?? null;
  const days = option?.durationDays ?? tariff?.durationDays ?? 30;
  const unitPrice = option?.price ?? tariff?.price ?? 0;

  // Текущие доп. устройства подписки (всегда сохраняются при продлении).
  const baseExtra = sub?.extraDevices ?? 0;
  const maxExtra = tariff?.maxExtraDevices ?? 0;
  // Зажимаем выбор в границы [baseExtra, maxExtra] на лету (без эффекта — чтобы
  // не использовать переменные до объявления и не плодить лишние ререндеры).
  const safeSelectedExtra = Math.min(Math.max(selectedExtra, baseExtra), Math.max(baseExtra, maxExtra));
  // Докупаемые сверх имеющихся.
  const newExtra = Math.max(0, safeSelectedExtra - baseExtra);

  // Доплата за СОХРАНЯЕМЫЕ текущие устройства (цена за 30 дней → масштабируем).
  const extrasCost = sub && sub.extraDevices > 0
    ? Math.round(sub.extraDevicesMonthlyPrice * (Math.max(1, days) / EXTRA_DEVICE_BASE_DAYS))
    : 0;
  // Доплата за ДОКУПАЕМЫЕ устройства (по тарифу).
  const newExtrasCost = tariff
    ? calcExtraDevicesPrice(tariff.pricePerExtraDevice ?? 0, newExtra, tariff.deviceDiscountTiers, days)
    : 0;
  const total = unitPrice + extrasCost + newExtrasCost;
  const currency = tariff?.currency ?? "RUB";
  const hasBalance = (client?.balance ?? 0) >= total && total > 0;

  // Общие поля платёжного запроса: продление ИМЕННО этой подписки.
  // Текущие устройства всегда сохраняются (сброс убран); докупленные — через deviceCount.
  const payBase = useMemo(() => ({
    tariffId: tariff?.id,
    tariffPriceOptionId: option?.id,
    extendsSecondarySubId: subId,
    ...(newExtra > 0 ? { deviceCount: newExtra } : {}),
  }), [tariff?.id, option?.id, subId, newExtra]);

  async function payWith(providerId: string) {
    if (!token || !tariff) return;
    setPayLoading(true);
    setPayError(null);
    try {
      if (providerId === "balance") {
        await api.clientPayByBalance(token, payBase);
        await refreshProfile();
        toast.success("Подписка продлена 🎉", `${sub?.label ?? "Подписка"} продлена на ${formatRuDays(days)}.`);
        onPaidByBalance?.();
        onClose();
        return;
      }
      let url: string | null = null;
      let paymentId: string | undefined;
      let providerLabel = providerId;
      if (providerId.startsWith("platega:")) {
        const methodId = Number(providerId.slice("platega:".length));
        const r = await api.clientCreatePlategaPayment(token, { ...payBase, paymentMethod: methodId });
        url = r.paymentUrl; paymentId = r.paymentId; providerLabel = "Platega";
      } else if (providerId === "yookassa") {
        const r = await api.yookassaCreatePayment(token, payBase);
        url = r.confirmationUrl; paymentId = r.paymentId; providerLabel = "ЮKassa";
      } else if (providerId === "yoomoney") {
        const r = await api.yoomoneyCreateFormPayment(token, { ...payBase, paymentType: "AC" });
        url = r.paymentUrl; paymentId = r.paymentId; providerLabel = "ЮMoney";
      } else if (providerId === "cryptopay") {
        const r = await api.cryptopayCreatePayment(token, payBase);
        url = r.miniAppPayUrl ?? r.webAppPayUrl ?? r.payUrl; paymentId = r.paymentId; providerLabel = "Crypto Bot";
      } else if (providerId === "heleket") {
        const r = await api.heleketCreatePayment(token, payBase);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "Heleket";
      } else if (providerId === "lava") {
        const r = await api.lavaCreatePayment(token, payBase);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "LAVA";
      } else if (providerId === "lavatop") {
        const r = await api.lavatopCreatePayment(token, payBase);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "Lava.top";
      } else if (providerId === "overpay") {
        const r = await api.overpayCreatePayment(token, payBase);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "Overpay";
      }
      // Как в классическом кабинете: панель с кнопкой, открывающей оплату в ОТДЕЛЬНОЙ
      // вкладке/браузере (в мини-аппе — WebApp.openLink).
      if (url) setReadyUrl({ url, provider: providerLabel, paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  // Список включённых провайдеров в порядке из админки (paymentProviders).
  const providers = useMemo(() => {
    if (!config) return [] as { id: string; label: string }[];
    const isRub = currency.toUpperCase() === "RUB";
    const list: { id: string; label: string }[] = [];
    (config.plategaMethods ?? []).forEach((m) => list.push({ id: `platega:${m.id}`, label: m.label }));
    const label = (id: string, fb: string) => config.paymentProviders?.find((p) => p.id === id)?.label || fb;
    const flags: { id: string; enabled: boolean; fb: string }[] = [
      { id: "cryptopay", enabled: Boolean(config.cryptopayEnabled), fb: "Crypto Bot" },
      { id: "heleket", enabled: Boolean(config.heleketEnabled), fb: "Heleket" },
      { id: "yookassa", enabled: Boolean(config.yookassaEnabled) && isRub, fb: "СБП / Карты РФ" },
      { id: "yoomoney", enabled: Boolean(config.yoomoneyEnabled) && isRub, fb: "ЮMoney" },
      { id: "lava", enabled: Boolean(config.lavaEnabled) && isRub, fb: "LAVA" },
      { id: "lavatop", enabled: Boolean(config.lavatopEnabled), fb: "Lava.top" },
      { id: "overpay", enabled: Boolean(config.overpayEnabled), fb: "Overpay" },
    ];
    const enabled = flags.filter((f) => f.enabled).map((f) => ({ id: f.id, label: label(f.id, f.fb) }));
    // Сортировка по paymentProviders (как в каталоге), неизвестные — в конец.
    const order = (config.paymentProviders ?? []).map((p) => p.id);
    enabled.sort((a, b) => {
      const ia = order.indexOf(a.id); const ib = order.indexOf(b.id);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return [...list, ...enabled];
  }, [config, currency]);

  // Предвыбор способа оплаты: баланс (если хватает), иначе первый провайдер.
  // Срабатывает после загрузки конфига/баланса и при изменении доступности.
  useEffect(() => {
    if (selectedProvider) return;
    if (client && hasBalance) { setSelectedProvider("balance"); return; }
    if (providers.length > 0) setSelectedProvider(providers[0].id);
  }, [providers, client, hasBalance, selectedProvider]);

  const subtitle = sub ? (
    <p className="-mt-3 mb-4 text-xs text-zinc-400 truncate">{sub.label}</p>
  ) : null;

  const body = (
    <>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>
      ) : !sub || allTariffs.length === 0 ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-sm text-amber-500/90">
          Сейчас нет доступных тарифов для продления. Откройте раздел «Тарифы» позже.
          </div>
        ) : readyUrl ? (
          <PayNowPanel
            url={readyUrl.url}
            provider={readyUrl.provider}
            onBack={() => setReadyUrl(null)}
            onPaid={() => {
              const pid = readyUrl.paymentId;
              const u = readyUrl.url, prov = readyUrl.provider;
              onClose();
              if (pid) navigate(`/cabinet/payment-wait?id=${encodeURIComponent(pid)}&kind=tariff`, { state: { url: u, provider: prov } });
            }}
            compact
          />
        ) : (
          <div className="space-y-5">
            {/* Выбор тарифа — горизонтальные chip-табы (как на странице покупки).
                По умолчанию выбран текущий тариф, но можно переключиться на любой. */}
            {allTariffs.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-blue-400" /> Тариф
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
                  {allTariffs.map((t) => {
                    const active = t.id === selectedTariffId;
                    const isCurrent = t.id === sub.tariffId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTariffId(t.id)}
                        className={cn(
                          "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-300 active:scale-95 flex items-center gap-1.5",
                          active
                            ? "bg-white/[0.06] text-white border-blue-500/45 backdrop-blur-xl shadow-[0_0_24px_-4px_rgba(47,107,255,0.45)]"
                            : "bg-white/[0.02] text-zinc-400 border-white/[0.06] backdrop-blur-xl hover:border-white/20 hover:bg-white/[0.04]",
                        )}
                      >
                        <span className="truncate max-w-[160px]">{t.name}</span>
                        {isCurrent && (
                          <span className="shrink-0 rounded-full bg-white/[0.06] border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                            текущий
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selectedTariffId !== sub.tariffId && (
                  <p className="text-[11px] leading-snug text-zinc-400">
                    Остаток дней текущей подписки пересчитается по стоимости дня нового тарифа и суммируется с выбранным сроком.
                  </p>
                )}
              </div>
            )}

            {/* Срок продления */}
            {tariff && tariff.priceOptions.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-blue-400" /> Срок продления
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[...tariff.priceOptions].sort((a, b) => a.durationDays - b.durationDays).map((o) => {
                    const active = o.id === selectedOptionId;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setSelectedOptionId(o.id)}
                        className={cn(
                          "rounded-2xl border p-3 text-left transition-all duration-200",
                          active
                            ? "border-blue-500/50 bg-blue-500/10 shadow-[0_0_24px_-8px] shadow-blue-500/40"
                            : "border-white/10 bg-white/[0.03] hover:border-white/25",
                        )}
                      >
                        <p className="text-sm font-bold">{formatRuDays(o.durationDays)}</p>
                        <p className={cn("text-xs", active ? "text-blue-400" : "text-zinc-400")}>
                          {formatMoney(o.price, currency)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Доп. устройства: текущие сохраняются, можно докупить (если тариф допускает). */}
            {maxExtra > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5 text-blue-400" />
                      Доп. устройства
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Включено: {tariff?.includedDevices ?? 1}
                      {baseExtra > 0 ? ` · уже есть: +${baseExtra}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedExtra((v) => Math.max(baseExtra, v - 1))}
                      disabled={safeSelectedExtra <= baseExtra}
                      className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.04] text-lg leading-none text-zinc-200 disabled:opacity-30 hover:bg-white/[0.08] transition"
                    >
                      −
                    </button>
                    <span className="min-w-[2.5rem] text-center text-base font-bold tabular-nums text-zinc-100">
                      +{safeSelectedExtra}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedExtra((v) => Math.min(maxExtra, v + 1))}
                      disabled={safeSelectedExtra >= maxExtra}
                      className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.04] text-lg leading-none text-zinc-200 disabled:opacity-30 hover:bg-white/[0.08] transition"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">
                    Всего устройств: {(tariff?.includedDevices ?? 1) + safeSelectedExtra}
                  </span>
                  {newExtra > 0 && (
                    <span className="font-semibold text-blue-300">+{formatMoney(newExtrasCost, currency)}</span>
                  )}
                </div>
              </div>
            )}

            {/* Итого */}
            <div className="rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-zinc-400">Итого за {formatRuDays(days)}:</span>
              <span className="text-xl font-black text-blue-400 tabular-nums">{formatMoney(total, currency)}</span>
            </div>

            {payError && (
              <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-center text-sm font-bold text-red-400">
                {payError}
              </div>
            )}

            {/* Способы оплаты — плитки 2 в ряд (как на странице покупки) */}
            <div className="space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Способ оплаты</p>
              {(providers.length > 0 || client) ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Баланс — плитка с суммой */}
                  {client && (
                    <button
                      type="button"
                      disabled={payLoading || !hasBalance}
                      onClick={() => setSelectedProvider("balance")}
                      className={cn(
                        "rounded-2xl border p-4 transition-colors duration-300 flex flex-col items-center gap-1.5 backdrop-blur-xl",
                        selectedProvider === "balance"
                          ? "bg-emerald-500/[0.08] border-emerald-500/35 shadow-[0_0_32px_-10px_rgba(52,211,153,0.45),inset_0_1px_0_rgba(255,255,255,0.07)]"
                          : hasBalance
                            ? "bg-white/[0.02] border-white/[0.06] hover:border-white/20 hover:bg-white/[0.04]"
                            : "bg-zinc-900/20 border-white/[0.04] opacity-60 cursor-not-allowed",
                      )}
                    >
                      <Wallet className={cn("h-5 w-5", selectedProvider === "balance" ? "text-emerald-400" : hasBalance ? "text-zinc-500" : "text-zinc-600")} />
                      <span className="text-[11px] font-bold uppercase tracking-wider">Баланс</span>
                      <span className={cn("text-[10px] font-medium tabular-nums", hasBalance ? "text-emerald-400/90" : "text-zinc-500")}>
                        {hasBalance ? formatMoney(client.balance, currency) : `${formatMoney(client.balance, currency)} — не хватает`}
                      </span>
                    </button>
                  )}
                  {providers.map((p) => {
                    const active = selectedProvider === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={payLoading}
                        onClick={() => setSelectedProvider(p.id)}
                        className={cn(
                          "rounded-2xl border p-4 transition-colors duration-300 flex flex-col items-center gap-2 backdrop-blur-xl",
                          active
                            ? "bg-white/[0.06] border-blue-500/45 shadow-[0_0_36px_-10px_rgba(47,107,255,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]"
                            : "bg-white/[0.02] border-white/[0.06] hover:border-white/20 hover:bg-white/[0.04]",
                        )}
                      >
                        <CreditCard className={cn("h-5 w-5 transition-colors duration-300", active ? "text-blue-400 drop-shadow-[0_0_8px_rgba(47,107,255,0.6)]" : "text-zinc-500")} />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-center leading-tight">{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center text-xs text-zinc-400">Способы оплаты не настроены.</p>
              )}

              {/* Кнопка оплаты */}
              <StadiumButton
                variant="primary"
                size="md"
                disabled={payLoading || !selectedProvider || (selectedProvider === "balance" && !hasBalance)}
                onClick={() => selectedProvider && payWith(selectedProvider)}
                iconLeft={payLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : undefined}
              >
                <span className="flex-1 text-center">
                  {payLoading ? "Создаём платёж…" : `Оплатить ${formatMoney(total, currency)}`}
                </span>
              </StadiumButton>
            </div>
          </div>
        )}
    </>
  );

  if (asPage) {
    return (
      <div className="px-4 pt-2 space-y-5 pb-4">
        <WizardHeader step={1} totalSteps={1} onClose={() => { if (!payLoading) onClose(); }} />
        <h1 className="text-2xl font-extrabold text-zinc-100 px-1">Продление подписки</h1>
        {subtitle}
        {body}
      </div>
    );
  }

  return (
    <StealthModal
      open={open}
      onClose={() => { if (!payLoading) onClose(); }}
      title="Продление подписки"
    >
      {subtitle}
      {body}
    </StealthModal>
  );
}
