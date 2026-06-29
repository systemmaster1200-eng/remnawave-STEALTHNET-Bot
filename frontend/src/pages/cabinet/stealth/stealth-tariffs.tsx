/**
 * Stealth Tariffs / Payment — выбор подписки в стиле Hundler VPN.
 *
 * Структура:
 *   1. (Если >1 категории) — горизонтальный chip-selector категорий
 *   2. (Если в категории >1 тарифа) — chip-selector тарифов
 *   3. Большой блок выбора периода:
 *      - Chip-pills предустановок (3д / 7д / 14д / 30д / 90д / 180д / 365д)
 *      - Заголовок периода + цена за день
 *      - Слайдер (если поддерживается) — пока упрощённо: только chips
 *      - «Итого: ₽X» большая цифра
 *   4. Промокод input + Активировать
 *   5. Tile-сетка способов оплаты (СБП/Карта/Крипто и т.п.) с активным =
 *      тёмная карточка, неактивный = бледнее
 *   6. (Если хватает баланса) — отдельный «Оплатить с баланса»
 *   7. Преимущества checklist
 *   8. БЕЛАЯ кнопка «Оплатить» внизу
 *
 * Использует существующие endpoint'ы:
 *   - api.getPublicTariffs → категории + тарифы + priceOptions
 *   - api.getPublicConfig  → enabled-флаги платежей
 *   - api.clientCreatePlategaPayment / yookassaCreatePayment / cryptopayCreatePayment /
 *     heleketCreatePayment / lavaCreatePayment / yoomoneyCreateFormPayment / clientPayByBalance
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Wallet, Bitcoin, Check, AlertCircle, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicTariffCategory, type PublicConfig, type TariffConversionPreview } from "@/lib/api";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { PayNowPanel } from "@/components/payment/pay-now-panel";
import { cn } from "@/lib/utils";

interface PriceOption {
  id: string;
  durationDays: number;
  price: number;
}

interface TariffLite {
  id: string;
  name: string;
  price: number;
  currency: string;
  priceOptions?: PriceOption[];
  durationDays?: number;
  trafficLimitBytes?: string | null;
  includedDevices?: number;
  // Доп. устройства (для выбора количества при покупке/продлении).
  pricePerExtraDevice?: number;
  maxExtraDevices?: number;
  deviceDiscountTiers?: { minExtraDevices: number; discountPercent: number }[];
}

// Расчёт цены доп. устройств — зеркало backend applyExtraDevicesPrice.
// pricePerExtraDevice задаётся за 30 дней; масштабируется по длительности.
// Тиры скидок применяются по количеству устройств (берётся максимальный подходящий).
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
  const durationCoeff = Math.max(1, durationDays) / 30;
  const monthlyWithDiscount = pricePerExtraDevice * safeCount * (100 - discount) / 100;
  return Math.round(monthlyWithDiscount * durationCoeff * 100) / 100;
}

type PayMethod =
  | { kind: "platega"; id: number; label: string; icon: typeof Wallet }
  | { kind: "yookassa"; label: string; icon: typeof Wallet }
  | { kind: "yoomoney"; label: string; icon: typeof Wallet }
  | { kind: "cryptopay"; label: string; icon: typeof Bitcoin }
  | { kind: "heleket"; label: string; icon: typeof Bitcoin }
  | { kind: "lava"; label: string; icon: typeof Wallet }
  | { kind: "balance"; label: string; icon: typeof Wallet };

function fmtPrice(n: number, currency: string) {
  const sym = currency === "rub" || currency === "RUB" ? "₽" : currency === "usd" || currency === "USD" ? "$" : currency.toUpperCase();
  return `${Math.round(n)}${sym}`;
}

// Цена за день — всегда с копейками (2 знака), в отличие от полной цены.
function fmtPricePerDay(n: number, currency: string) {
  const sym = currency === "rub" || currency === "RUB" ? "₽" : currency === "usd" || currency === "USD" ? "$" : currency.toUpperCase();
  return `${n.toFixed(2)}${sym}`;
}

export function StealthTariffs() {
  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // режим продления конкретной подписки (?extend=<subId> с дашборда).
  // Механика как в основном кабинете: каталог фильтруется до тарифа подписки,
  // оплата уходит с extendsSecondarySubId — единый код для любой подписки.
  const extendParam = searchParams.get("extend");
  const [extendTarget, setExtendTarget] = useState<{ id: string; label: string; tariffId: string | null; isTrial: boolean; convertTariffIds: string[]; trialConvertAllTariffs: boolean; extraDevices: number; extraDevicesMonthlyPrice: number } | null>(null);
  // судьба доп. устройств при продлении (true = сохранить, цена выше).
  // Выбранное кол-во доп. устройств для покупки/продления.
  // Покупка нового → 0; продление → стартово = текущие устройства подписки (Вопрос 2=A).
  const [selectedExtraDevices, setSelectedExtraDevices] = useState(0);

  const [categories, setCategories] = useState<PublicTariffCategory[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [selectedTariffId, setSelectedTariffId] = useState<string | null>(null);
  const [selectedPriceOptionId, setSelectedPriceOptionId] = useState<string | null>(null);

  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);

  const [selectedMethod, setSelectedMethod] = useState<PayMethod | null>(null);
  const [paying, setPaying] = useState(false);
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string; paymentId?: string } | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  // превью конвертации (режим «одна подписка из категории»).
  const [convPreview, setConvPreview] = useState<TariffConversionPreview | null>(null);
  // судьба доп. устройств при конвертации (true = оставить).
  const [convKeepExtras, setConvKeepExtras] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.getPublicTariffs().catch(() => ({ items: [] as PublicTariffCategory[] })),
      api.getPublicConfig().catch(() => null),
    ]).then(([t, c]) => {
      if (!alive) return;
      const cats = (t.items ?? []).filter((cat) => cat.tariffs.length > 0);
      setCategories(cats);
      setConfig(c);
      // initial selections
      if (cats.length > 0) {
        setSelectedCatId(cats[0].id);
        const firstTariff = cats[0].tariffs[0];
        if (firstTariff) {
          setSelectedTariffId(firstTariff.id);
          const opts = (firstTariff as TariffLite).priceOptions ?? [];
          if (opts.length > 0) {
            // Default to ~30 days option if exists, else first
            const def = opts.find((o) => o.durationDays === 30) ?? opts[0];
            setSelectedPriceOptionId(def.id);
          }
        }
      }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Все подписки клиента: для режима продления (?extend) и для подсказки
  // «у вас уже есть подписка с этим тарифом — продлить или купить ещё одну».
  const [mySubs, setMySubs] = useState<{ id: string; label: string; tariffId: string | null; expireAt: string | null; isTrial: boolean; trialName: string | null }[]>([]);
  // покупка заменяет триал: выбор какого (если несколько).
  const [replaceTrialChoice, setReplaceTrialChoice] = useState<string | null>(null);
  useEffect(() => {
    if (!state.token) { setExtendTarget(null); setMySubs([]); return; }
    let alive = true;
    api.clientAllSubscriptions(state.token).then((r) => {
      if (!alive) return;
      const items = r.items ?? [];
      setMySubs(items.map((it) => {
        const raw = it.subscription as Record<string, unknown> | null;
        const payload = (raw && typeof raw === "object" && raw.response && typeof raw.response === "object")
          ? (raw.response as Record<string, unknown>)
          : raw;
        return {
          id: it.id,
          label: it.tariffDisplayName?.trim() || `Подписка #${it.subscriptionIndex ?? 0}`,
          tariffId: it.tariffId ?? null,
          expireAt: payload && typeof payload.expireAt === "string" ? payload.expireAt : null,
          isTrial: Boolean(it.trialId),
          trialName: it.trialName ?? null,
        };
      }));
      if (!extendParam) { setExtendTarget(null); return; }
      const it = items.find((s) => s.id === extendParam);
      if (!it) { setExtendTarget(null); return; }
      const idx = it.subscriptionIndex ?? 0;
      setExtendTarget({
        id: it.id,
        label: it.tariffDisplayName?.trim() || `Подписка #${idx}`,
        tariffId: it.tariffId ?? null,
        isTrial: Boolean(it.trialId),
        convertTariffIds: it.convertTariffIds ?? [],
        trialConvertAllTariffs: it.trialConvertAllTariffs ?? false,
        extraDevices: it.extraDevices ?? 0,
        extraDevicesMonthlyPrice: it.extraDevicesMonthlyPrice ?? 0,
      });
    }).catch(() => { if (alive) { setExtendTarget(null); setMySubs([]); } });
    return () => { alive = false; };
  }, [extendParam, state.token]);

  // В режиме продления каталог сужается до тарифа подписки (как в основном
  // кабинете). Для триальной подписки добавляются тарифы из настройки триала
  // convertTariffIds — переход с пробного сквада на боевой; convertAllTariffs —
  // каталог не фильтруется вовсе. Standalone-триал (без тарифа) — только разрешённые.
  const displayCategories = useMemo(() => {
    if (!extendTarget) return categories;
    if (extendTarget.isTrial && extendTarget.trialConvertAllTariffs) return categories;
    const allowed = [
      ...(extendTarget.tariffId ? [extendTarget.tariffId] : []),
      ...(extendTarget.isTrial ? extendTarget.convertTariffIds : []),
    ];
    if (allowed.length === 0) return categories;
    const filtered = categories
      .map((c) => ({ ...c, tariffs: c.tariffs.filter((t) => allowed.includes(t.id)) }))
      .filter((c) => c.tariffs.length > 0);
    // Тариф подписки удалён из каталога — fallback на полный список.
    return filtered.length > 0 ? filtered : categories;
  }, [categories, extendTarget]);

  // Предвыбор категории/тарифа подписки при входе в режим продления.
  useEffect(() => {
    if (!extendTarget?.tariffId || categories.length === 0) return;
    const cat = categories.find((c) => c.tariffs.some((t) => t.id === extendTarget.tariffId));
    const tariff = cat?.tariffs.find((t) => t.id === extendTarget.tariffId) as TariffLite | undefined;
    if (!cat || !tariff) return;
    setSelectedCatId(cat.id);
    setSelectedTariffId(tariff.id);
    const opts = tariff.priceOptions ?? [];
    if (opts.length > 0) {
      const def = opts.find((o) => o.durationDays === 30) ?? opts[0];
      setSelectedPriceOptionId(def.id);
    }
  }, [extendTarget?.tariffId, categories]);

  const currentCat = displayCategories.find((c) => c.id === selectedCatId);
  const currentTariff = currentCat?.tariffs.find((t) => t.id === selectedTariffId) as TariffLite | undefined;
  const priceOptions: PriceOption[] = currentTariff?.priceOptions ?? [];
  const currentOption = priceOptions.find((o) => o.id === selectedPriceOptionId);
  const basePrice = currentOption?.price ?? currentTariff?.price ?? 0;
  const days = currentOption?.durationDays ?? currentTariff?.durationDays ?? 30;

  // Нижняя граница выбора устройств = уже имеющиеся на подписке (при продлении
  // они всегда сохраняются; уменьшать нельзя — только докупать). При покупке нового = 0.
  const baseExtraDevices = extendTarget ? extendTarget.extraDevices : 0;
  const maxExtra = currentTariff?.maxExtraDevices ?? 0;

  // Сбрасываем выбор устройств к стартовому при смене тарифа/режима/опции «убрать».
  useEffect(() => {
    setSelectedExtraDevices(baseExtraDevices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTariffId, extendTarget?.id]);

  // Чтобы выбор не вышел за пределы [baseExtraDevices, maxExtra].
  useEffect(() => {
    setSelectedExtraDevices((v) => Math.min(Math.max(v, baseExtraDevices), Math.max(baseExtraDevices, maxExtra)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseExtraDevices, maxExtra]);

  // НОВЫЕ устройства, докупаемые сверх уже имеющихся (для расчёта доплаты и deviceCount).
  const newExtraDevices = Math.max(0, selectedExtraDevices - baseExtraDevices);
  // Стоимость докупаемых устройств (по тарифу, формула зеркалит backend).
  const newExtrasPrice = currentTariff
    ? calcExtraDevicesPrice(currentTariff.pricePerExtraDevice ?? 0, newExtraDevices, currentTariff.deviceDiscountTiers, days)
    : 0;
  // доплата за СОХРАНЯЕМЫЕ доп. устройства при продлении
  // (цена хранится за 30 дней — масштабируем на выбранный срок). Раньше stealth
  // не показывал её, и бэк списывал больше, чем юзер видел в «Итого».
  const extendExtrasCost = extendTarget && extendTarget.extraDevices > 0
    ? Math.round(extendTarget.extraDevicesMonthlyPrice * (Math.max(1, days) / 30))
    : 0;
  // same-tariff продление (single-режим, без ?extend): доплата за
  // сохраняемые устройства из превью — чтобы «Итого» совпадало со списанием.
  const convExtendExtrasCost = !extendTarget && convPreview?.mode === "extend" && convKeepExtras && (convPreview.extras?.extraDevices ?? 0) > 0
    ? Math.round((convPreview.extras?.extraDevicesMonthlyPrice ?? 0) * (Math.max(1, days) / 30))
    : 0;
  const totalPrice = basePrice + extendExtrasCost + convExtendExtrasCost + newExtrasPrice;
  const pricePerDay = days > 0 ? totalPrice / days : 0;
  const currency = currentTariff?.currency ?? "rub";

  // Payment methods доступные сейчас
  const availableMethods: PayMethod[] = useMemo(() => {
    if (!config) return [];
    const list: PayMethod[] = [];
    (config.plategaMethods ?? []).forEach((m) => {
      list.push({ kind: "platega", id: m.id, label: m.label, icon: Wallet });
    });
    if (config.yookassaEnabled) list.push({ kind: "yookassa", label: "YooKassa", icon: Wallet });
    if (config.yoomoneyEnabled) list.push({ kind: "yoomoney", label: "YooMoney", icon: Wallet });
    if (config.cryptopayEnabled) list.push({ kind: "cryptopay", label: "Crypto Pay", icon: Bitcoin });
    if (config.heleketEnabled) list.push({ kind: "heleket", label: "Heleket", icon: Bitcoin });
    if (config.lavaEnabled) list.push({ kind: "lava", label: "Lava", icon: Wallet });
    return list;
  }, [config]);

  // Auto-select first method when methods load
  useEffect(() => {
    if (!selectedMethod && availableMethods.length > 0) {
      setSelectedMethod(availableMethods[0]);
    }
  }, [availableMethods, selectedMethod]);

  // Свежий баланс: профиль мог быть не загружен/устаревшим — без этого тайл
  // «Баланс» показывал 0 и решение о доступности оплаты было неверным.
  useEffect(() => {
    refreshProfile().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Balance available?
  const balance = state.client?.balance ?? 0;
  const canPayByBalance = balance >= totalPrice && totalPrice > 0;

  // Если выбран «Баланс», а юзер переключился на тариф дороже остатка —
  // мягко возвращаем первый доступный метод, чтобы не отправлять заведомо
  // провальную оплату.
  useEffect(() => {
    if (selectedMethod?.kind === "balance" && !canPayByBalance) {
      setSelectedMethod(availableMethods[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPayByBalance]);

  // Превью конвертации: если тариф из single-категории и у клиента уже есть
  // подписка этой категории — покупка обновит её, а не создаст вторую. Показываем
  // юзеру расчёт до оплаты. В режиме явного продления (?extend) превью не нужно.
  useEffect(() => {
    if (!state.token || !selectedTariffId || extendTarget) { setConvPreview(null); return; }
    let alive = true;
    setConvKeepExtras(true);
    api.clientTariffConversionPreview(state.token, {
      tariffId: selectedTariffId,
      priceOptionId: selectedPriceOptionId ?? undefined,
    })
      .then((p) => { if (alive) setConvPreview(p); })
      .catch(() => { if (alive) setConvPreview(null); });
    return () => { alive = false; };
  }, [state.token, selectedTariffId, selectedPriceOptionId, extendTarget]);

  async function applyPromo() {
    if (!state.token || !promoInput.trim()) return;
    setPromoBusy(true);
    setPromoMsg(null);
    try {
      // clientCheckPromoCode возвращает данные промо при успехе или throws при ошибке
      await api.clientCheckPromoCode(state.token, promoInput.trim());
      setPromoApplied(promoInput.trim());
      setPromoMsg("Промокод применён");
    } catch (e) {
      setPromoApplied(null);
      setPromoMsg(e instanceof Error ? e.message : "Промокод недействителен");
    } finally {
      setPromoBusy(false);
    }
  }

  async function pay() {
    if (!state.token || !selectedTariffId || !selectedPriceOptionId || !selectedMethod) return;
    setPaying(true);
    setPayError(null);
    try {
      const base = {
        tariffId: selectedTariffId,
        tariffPriceOptionId: selectedPriceOptionId,
        promoCode: promoApplied ?? undefined,
        // Докупаемые доп. устройства (сверх уже имеющихся при продлении / с нуля при покупке).
        ...(newExtraDevices > 0 ? { deviceCount: newExtraDevices } : {}),
        // режим продления конкретной подписки (?extend=) —
        // оплата продлевает ИМЕННО её, а не создаёт новую.
        ...(extendTarget ? { extendsSecondarySubId: extendTarget.id } : {}),
        // При продлении текущие доп. устройства всегда сохраняются (сброс убран);
        // докупленные сверх передаются через deviceCount выше.
        // same-tariff (single-режим): покупка того же тарифа = честное
        // продление через extend-флоу (единая логика доплаты/устройств).
        ...(!extendTarget && convPreview?.mode === "extend" && convPreview.subscription
          ? {
              extendsSecondarySubId: convPreview.subscription.id,
              ...(((convPreview.extras?.extraDevices ?? 0) > 0 && !convKeepExtras) ? { removeExtrasOnActivate: true } : {}),
            }
          : {}),
        // конвертация: юзер выбрал убрать доп. устройства —
        // их остаточная ценность уйдёт в дни нового тарифа.
        ...(convPreview?.willConvert && convPreview.mode !== "extend" && (convPreview.extras?.extraDevices ?? 0) > 0 && !convKeepExtras
          ? { removeExtrasOnActivate: true }
          : {}),
        // покупка заменяет активный триал (выбор при нескольких).
        ...(() => {
          if (extendTarget || convPreview?.willConvert) return {};
          const trialsOwned = mySubs.filter((s) => s.isTrial);
          return trialsOwned.length > 0
            ? { replaceTrialSubId: replaceTrialChoice ?? trialsOwned[0].id }
            : {};
        })(),
      };
      let url: string | null = null;
      let paymentId: string | undefined;
      let providerLabel: string = selectedMethod.kind;
      if (selectedMethod.kind === "platega") {
        const r = await api.clientCreatePlategaPayment(state.token, { ...base, paymentMethod: selectedMethod.id });
        url = r.paymentUrl; paymentId = r.paymentId; providerLabel = "Platega";
      } else if (selectedMethod.kind === "yookassa") {
        const r = await api.yookassaCreatePayment(state.token, base);
        url = r.confirmationUrl; paymentId = r.paymentId; providerLabel = "ЮKassa";
      } else if (selectedMethod.kind === "yoomoney") {
        const r = await api.yoomoneyCreateFormPayment(state.token, { ...base, paymentType: "AC" });
        url = r.paymentUrl; paymentId = r.paymentId; providerLabel = "ЮMoney";
      } else if (selectedMethod.kind === "cryptopay") {
        const r = await api.cryptopayCreatePayment(state.token, base);
        // CryptoBot mini-app preferred when in Telegram, иначе fallback
        url = r.miniAppPayUrl ?? r.webAppPayUrl ?? r.payUrl; paymentId = r.paymentId; providerLabel = "Crypto Bot";
      } else if (selectedMethod.kind === "heleket") {
        const r = await api.heleketCreatePayment(state.token, base);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "Heleket";
      } else if (selectedMethod.kind === "lava") {
        const r = await api.lavaCreatePayment(state.token, base);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "LAVA";
      } else if (selectedMethod.kind === "balance") {
        await api.clientPayByBalance(state.token, base);
        await refreshProfile();
        navigate("/cabinet/dashboard?paid=balance");
        return;
      }
      // Как в классическом кабинете: панель с кнопкой, открывающей оплату в ОТДЕЛЬНОЙ
      // вкладке/браузере (в мини-аппе — WebApp.openLink).
      if (url) setReadyUrl({ url, provider: providerLabel, paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    // Shimmer-скелетоны вместо спиннера — силуэт будущего контента.
    return (
      <div className="px-4 pt-2 space-y-4 pb-2">
        <div className="flex gap-2">
          {[88, 104, 96].map((w, i) => (
            <div
              key={i}
              className="h-9 rounded-full bg-white/[0.04] border border-white/[0.06] overflow-hidden relative"
              style={{ width: w }}
            >
              <motion.div
                className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent"
                animate={{ x: ["-100%", "250%"] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "linear", delay: i * 0.15 }}
              />
            </div>
          ))}
        </div>
        {[164, 56, 120].map((h, i) => (
          <div
            key={i}
            className="rounded-3xl bg-white/[0.03] border border-white/[0.06] overflow-hidden relative"
            style={{ height: h }}
          >
            <motion.div
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
              animate={{ x: ["-100%", "400%"] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear", delay: 0.2 + i * 0.2 }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="px-4 pt-10 text-center text-zinc-400 text-sm">
        Тарифы пока не настроены.
      </div>
    );
  }

  // Платёж создан — показываем панель открытия оплаты (как в классическом кабинете:
  // оплата открывается в ОТДЕЛЬНОЙ вкладке/браузере, в мини-аппе — WebApp.openLink).
  if (readyUrl) {
    return (
      <div className="px-4 pt-2 space-y-4 pb-2">
        <PayNowPanel
          url={readyUrl.url}
          provider={readyUrl.provider}
          onBack={() => setReadyUrl(null)}
          onPaid={() => {
            const pid = readyUrl.paymentId;
            const u = readyUrl.url, prov = readyUrl.provider;
            if (pid) navigate(`/cabinet/payment-wait?id=${encodeURIComponent(pid)}&kind=tariff`, { state: { url: u, provider: prov } });
          }}
          compact
        />
      </div>
    );
  }

  return (
    <div className="px-4 pt-2 space-y-4 pb-2">
      {/* Режим продления: бейдж с подпиской, каталог сужен до её тарифа */}
      {extendTarget && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="relative overflow-hidden rounded-2xl border border-blue-500/25 bg-blue-500/[0.07] backdrop-blur-xl p-3.5 shadow-[0_0_36px_-14px_rgba(47,107,255,0.4)]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-transparent pointer-events-none" />
          <div className="relative flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-blue-500/15 shrink-0">
              <RefreshCw className="h-3.5 w-3.5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold">Продление подписки</p>
              <p className="text-[11px] text-zinc-400 truncate">{extendTarget.label} — выберите срок и способ оплаты</p>
            </div>
          </div>
          {/* Управление доп. устройствами при продлении вынесено в общий
              степпер «Доп. устройства» ниже: текущие сохраняются, можно докупить. */}
        </motion.div>
      )}

      {/* Category tabs (только если >1) */}
      {displayCategories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {displayCategories.map((c) => {
            const active = c.id === selectedCatId;
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedCatId(c.id);
                  const firstT = c.tariffs[0];
                  if (firstT) {
                    setSelectedTariffId(firstT.id);
                    const opts = (firstT as TariffLite).priceOptions ?? [];
                    setSelectedPriceOptionId((opts.find((o) => o.durationDays === 30) ?? opts[0])?.id ?? null);
                  }
                }}
                className={cn(
                  "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 active:scale-95",
                  active
                    ? "bg-white text-black border-white shadow-[0_0_28px_-8px_rgba(255,255,255,0.5)]"
                    : "bg-white/[0.03] text-zinc-300 border-white/[0.08] backdrop-blur-xl hover:border-white/25 hover:bg-white/[0.06]",
                )}
              >
                {c.emoji ? `${c.emoji} ` : ""}{c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Tariff tabs (если >1 в категории) */}
      {currentCat && currentCat.tariffs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {currentCat.tariffs.map((t) => {
            const active = t.id === selectedTariffId;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedTariffId(t.id);
                  const opts = (t as TariffLite).priceOptions ?? [];
                  setSelectedPriceOptionId((opts.find((o) => o.durationDays === 30) ?? opts[0])?.id ?? null);
                }}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-300 active:scale-95",
                  active
                    ? "bg-white/[0.06] text-white border-blue-500/45 backdrop-blur-xl shadow-[0_0_24px_-4px_rgba(47,107,255,0.45)]"
                    : "bg-white/[0.02] text-zinc-400 border-white/[0.06] backdrop-blur-xl hover:border-white/20 hover:bg-white/[0.04]",
                )}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Period selector card */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative rounded-3xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-2xl p-5 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_-24px_rgba(0,0,0,0.8)] before:absolute before:inset-0 before:rounded-3xl before:bg-gradient-to-b before:from-white/[0.04] before:to-transparent before:pointer-events-none"
      >
        {priceOptions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {priceOptions.sort((a, b) => a.durationDays - b.durationDays).map((opt) => {
              const active = opt.id === selectedPriceOptionId;
              return (
                <motion.button
                  key={opt.id}
                  onClick={() => setSelectedPriceOptionId(opt.id)}
                  whileTap={{ scale: 0.94 }}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-300 min-w-[58px]",
                    active
                      ? "bg-white text-black border-white shadow-[0_0_24px_-6px_rgba(255,255,255,0.45)]"
                      : "bg-white/[0.03] text-zinc-300 border-white/[0.08] backdrop-blur-xl hover:border-white/25 hover:bg-white/[0.06]",
                  )}
                >
                  {opt.durationDays} дн.
                </motion.button>
              );
            })}
          </div>
        )}

        {/* Выбор доп. устройств — если тариф их допускает (maxExtraDevices > 0).
            Показываем и при покупке нового, и при продлении (в т.ч. когда у подписки
            ещё нет доп. устройств — даём возможность докупить). */}
        {currentTariff && maxExtra > 0 && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-100">Доп. устройства</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  Включено в тариф: {currentTariff.includedDevices ?? 1}
                  {baseExtraDevices > 0 ? ` · уже есть: +${baseExtraDevices}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedExtraDevices((v) => Math.max(baseExtraDevices, v - 1))}
                  disabled={selectedExtraDevices <= baseExtraDevices}
                  className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.04] text-lg leading-none text-zinc-200 disabled:opacity-30 hover:bg-white/[0.08] transition"
                >
                  −
                </button>
                <span className="min-w-[2.5rem] text-center text-base font-bold tabular-nums text-zinc-100">
                  +{selectedExtraDevices}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedExtraDevices((v) => Math.min(maxExtra, v + 1))}
                  disabled={selectedExtraDevices >= maxExtra}
                  className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.04] text-lg leading-none text-zinc-200 disabled:opacity-30 hover:bg-white/[0.08] transition"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-zinc-500">
                Всего устройств: {(currentTariff.includedDevices ?? 1) + selectedExtraDevices}
              </span>
              {newExtraDevices > 0 && (
                <span className="font-semibold text-blue-300">
                  +{fmtPrice(newExtrasPrice, currency)}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex items-end justify-between gap-4 pt-1">
          <div>
            <div className="text-3xl font-bold leading-none">{days}</div>
            <div className="text-xs text-zinc-500 mt-1.5">дн.</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{fmtPricePerDay(pricePerDay, currency)}</div>
            <div className="text-xs text-zinc-500">/день</div>
          </div>
        </div>

        <div className="border-t border-white/[0.06] pt-3 flex items-center justify-between">
          <span className="text-sm text-zinc-400">Итого:</span>
          <motion.span
            key={totalPrice}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="text-2xl font-bold tabular-nums bg-gradient-to-r from-blue-400 via-blue-300 to-cyan-400 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(47,107,255,0.35)]"
          >
            {fmtPrice(totalPrice, currency)}
          </motion.span>
        </div>
      </motion.div>

      {/* покупка заменяет активный триал (выбор при нескольких). */}
      {!extendTarget && !convPreview?.willConvert && (() => {
        const trialsOwned = mySubs.filter((s) => s.isTrial);
        if (trialsOwned.length === 0) return null;
        const chosen = replaceTrialChoice ?? trialsOwned[0].id;
        return (
          <div className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4">
            <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 to-transparent pointer-events-none" />
            <div className="relative space-y-2">
              <p className="text-sm font-bold">
                {trialsOwned.length === 1 ? "Пробная подписка будет заменена этой покупкой" : "Покупка заменит один из пробных периодов"}
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Триал удалится полностью (дни и трафик пробного периода не переносятся).
              </p>
              {trialsOwned.length > 1 && (
                <div className="space-y-1.5">
                  {trialsOwned.map((tr) => (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => setReplaceTrialChoice(tr.id)}
                      className={cn(
                        "w-full text-left rounded-xl border px-3 py-2 text-xs transition-all",
                        chosen === tr.id ? "border-amber-500/50 bg-amber-500/10 font-bold" : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                      )}
                    >
                      🎁 {tr.trialName ?? tr.label}
                      {tr.expireAt ? ` — до ${new Date(tr.expireAt).toLocaleDateString("ru-RU")}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* без single-режима: подписка с этим тарифом уже есть —
          предлагаем продлить её, либо продолжить покупку ещё одной. */}
      {!extendTarget && !convPreview?.willConvert && (() => {
        // среди ВСЕХ подписок с этим тарифом предлагаем «самую живую».
        // Триалы исключены: их «продление» — конвертация, покупка их заменяет.
        const matches = selectedTariffId ? mySubs.filter((s) => s.tariffId === selectedTariffId && !s.isTrial) : [];
        const dup = matches.length > 0
          ? [...matches].sort((a, b) => (b.expireAt ? Date.parse(b.expireAt) : 0) - (a.expireAt ? Date.parse(a.expireAt) : 0))[0]
          : null;
        if (!dup) return null;
        return (
          <div className="relative overflow-hidden rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.07] p-4">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-transparent pointer-events-none" />
            <div className="relative space-y-2">
              <p className="text-sm font-bold">У вас уже есть подписка с этим тарифом</p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                «{dup.label}»{dup.expireAt ? ` — до ${new Date(dup.expireAt).toLocaleDateString("ru-RU")}` : ""}.
                Можно продлить её (дни сложатся) — или продолжить ниже и купить ещё одну отдельную подписку.
              </p>
              <button
                onClick={() => navigate(`/cabinet/tariffs?extend=${encodeURIComponent(dup.id)}`)}
                className="rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 px-3.5 py-2 text-xs font-bold text-indigo-300 transition inline-flex items-center gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Продлить «{dup.label}»
              </button>
            </div>
          </div>
        );
      })()}

      {/* Конвертация: покупка из single-категории обновляет существующую подписку */}
      {convPreview?.willConvert && convPreview.subscription && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] backdrop-blur-xl p-4 shadow-[0_0_36px_-14px_rgba(47,107,255,0.35)]"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-transparent pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <div className="p-2 rounded-xl bg-blue-500/15 shrink-0">
              <RefreshCw className="h-4 w-4 text-blue-400" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-bold">
                {convPreview.mode === "extend"
                  ? "Этот тариф у вас уже есть — подписка будет продлена"
                  : convPreview.subscription.isTrial ? "Пробная подписка станет платной" : "Подписка будет обновлена"}
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {convPreview.mode === "extend"
                  ? `Вторая подписка не создастся — дни сложатся: остаток ${convPreview.remainingDays ?? 0} дн. + покупка ${convPreview.purchasedDays ?? 0} дн. = ${convPreview.totalDays ?? 0} дн. Устройства и серверы останутся как есть.`
                  : <>Покупка не создаст вторую подписку — она обновит
                {convPreview.subscription.tariffName ? ` «${convPreview.subscription.tariffName}»` : " текущую"} до нового тарифа.
                {(convPreview.convertedDays ?? 0) > 0 && (convPreview.remainingDays ?? 0) > 0 && !(convPreview.extras && convPreview.extras.extraDevices > 0)
                  ? ` Остаток ${convPreview.remainingDays} дн. превратится в ${convPreview.convertedDays} дн. по цене нового тарифа.`
                  : ""}</>}
              </p>
              {convPreview.mode !== "extend" && (convPreview.extras?.extraDevices ?? 0) === 0 && (convPreview.totalDays ?? 0) > 0 && (
                <p className="text-xs font-bold text-blue-400">Итого: {convPreview.totalDays} дн. нового тарифа</p>
              )}

              {/* same-tariff продление: устройства — сохранить (доплата) или убрать. */}
              {convPreview.mode === "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-bold">
                    У вас докуплено +{convPreview.extras.extraDevices} доп. устройств — что с ними сделать?
                  </p>
                  <button
                    type="button"
                    onClick={() => setConvKeepExtras(true)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all",
                      convKeepExtras ? "border-blue-500/50 bg-blue-500/10" : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                    )}
                  >
                    <p className="text-xs font-bold">📱 Сохранить устройства (+{fmtPrice(convPreview.extras.keep.extraCost ?? 0, currency)})</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Всего {convPreview.extras.keep.totalDevices} устройств. Доплата за устройства
                      добавится к «Итого» выше.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConvKeepExtras(false)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all",
                      !convKeepExtras ? "border-blue-500/50 bg-blue-500/10" : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                    )}
                  >
                    <p className="text-xs font-bold">⚡ Убрать устройства — без доплаты</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Останется {convPreview.extras.drop.totalDevices} устройств (только из тарифа).
                    </p>
                  </button>
                </div>
              )}

              {/* выбор судьбы доп. устройств при конвертации. */}
              {convPreview.mode !== "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-bold">
                    У вас докуплено +{convPreview.extras.extraDevices} доп. устройств — что с ними сделать?
                  </p>
                  <button
                    type="button"
                    onClick={() => setConvKeepExtras(true)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all",
                      convKeepExtras
                        ? "border-blue-500/50 bg-blue-500/10"
                        : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                    )}
                  >
                    <p className="text-xs font-bold">📱 Оставить устройства</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Всего {convPreview.extras.keep.totalDevices} устройств
                      ({convPreview.extras.newIncludedDevices} в тарифе + {convPreview.extras.extraDevices} доп.).
                      Конвертация остатка: +{convPreview.extras.keep.convertedDays} дн. —
                      итого {convPreview.extras.keep.totalDays} дн.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConvKeepExtras(false)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-all",
                      !convKeepExtras
                        ? "border-blue-500/50 bg-blue-500/10"
                        : "border-white/[0.08] bg-zinc-900/40 hover:border-white/20",
                    )}
                  >
                    <p className="text-xs font-bold">⚡ Убрать устройства — больше дней</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Останется {convPreview.extras.drop.totalDevices} устройств (только из тарифа).
                      Стоимость устройств тоже превратится в дни: +{convPreview.extras.drop.convertedDays} дн. —
                      итого {convPreview.extras.drop.totalDays} дн.
                    </p>
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Promo */}
      {/* min-w-0 на input обязателен: flex-item с дефолтным min-width:auto
          не сжимался на узких экранах и выталкивал кнопку за край контейнера. */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-2 flex items-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus-within:border-blue-500/35 focus-within:shadow-[0_0_28px_-10px_rgba(47,107,255,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-300">
        <input
          value={promoInput}
          onChange={(e) => { setPromoInput(e.target.value); setPromoMsg(null); }}
          placeholder="Введите промокод"
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm placeholder-zinc-500 outline-none"
        />
        <button
          onClick={applyPromo}
          disabled={promoBusy || !promoInput.trim()}
          className="shrink-0 whitespace-nowrap rounded-xl bg-zinc-800/80 hover:bg-zinc-800 px-4 py-2 text-xs font-medium border border-white/[0.06] disabled:opacity-50 transition"
        >
          {promoBusy ? "..." : promoApplied ? <Check className="h-4 w-4 inline" /> : "Активировать"}
        </button>
      </div>
      {promoMsg && (
        <div className={cn("text-xs px-1", promoApplied ? "text-emerald-400" : "text-blue-400")}>{promoMsg}</div>
      )}

      {/* Payment method tiles */}
      {availableMethods.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5">
          {availableMethods.map((m) => {
            const active = selectedMethod && (
              (selectedMethod.kind === "platega" && m.kind === "platega" && selectedMethod.id === m.id) ||
              (selectedMethod.kind === m.kind && m.kind !== "platega" && selectedMethod.kind !== "platega")
            );
            const Icon = m.icon;
            return (
              <motion.button
                key={`${m.kind}-${m.kind === "platega" ? m.id : ""}`}
                onClick={() => setSelectedMethod(m)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className={cn(
                  "rounded-2xl border p-4 transition-colors duration-300 flex flex-col items-center gap-2 backdrop-blur-xl",
                  active
                    ? "bg-white/[0.06] border-blue-500/45 shadow-[0_0_36px_-10px_rgba(47,107,255,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]"
                    : "bg-white/[0.02] border-white/[0.06] hover:border-white/20 hover:bg-white/[0.04]",
                )}
              >
                <Icon className={cn("h-5 w-5 transition-colors duration-300", active ? "text-blue-400 drop-shadow-[0_0_8px_rgba(47,107,255,0.6)]" : "text-zinc-500")} />
                <span className="text-[11px] font-bold uppercase tracking-wider">{m.label}</span>
              </motion.button>
            );
          })}
          {/* Тайл «Баланс» виден всегда (раньше прятался при нехватке средств,
              и юзеры думали, что оплаты с баланса в приложении нет вовсе). */}
          {state.client && (
            <motion.button
              onClick={() => canPayByBalance && setSelectedMethod({ kind: "balance", label: `Баланс (${balance.toFixed(0)}${fmtPrice(0, currency).slice(-1)})`, icon: Wallet })}
              disabled={!canPayByBalance}
              whileHover={canPayByBalance ? { scale: 1.02 } : undefined}
              whileTap={canPayByBalance ? { scale: 0.97 } : undefined}
              className={cn(
                "rounded-2xl border p-4 transition-colors duration-300 flex flex-col items-center gap-1.5 backdrop-blur-xl",
                selectedMethod?.kind === "balance"
                  ? "bg-emerald-500/[0.08] border-emerald-500/35 shadow-[0_0_32px_-10px_rgba(52,211,153,0.45),inset_0_1px_0_rgba(255,255,255,0.07)]"
                  : canPayByBalance
                    ? "bg-white/[0.02] border-white/[0.06] hover:border-white/20 hover:bg-white/[0.04]"
                    : "bg-zinc-900/20 border-white/[0.04] opacity-60 cursor-not-allowed",
              )}
            >
              <Wallet className={cn("h-5 w-5", selectedMethod?.kind === "balance" ? "text-emerald-400" : canPayByBalance ? "text-zinc-500" : "text-zinc-600")} />
              <span className="text-[11px] font-bold uppercase tracking-wider">Баланс</span>
              <span className={cn(
                "text-[10px] font-medium tabular-nums",
                canPayByBalance ? "text-emerald-400/90" : "text-zinc-500",
              )}>
                {canPayByBalance ? fmtPrice(balance, currency) : `${fmtPrice(balance, currency)} — не хватает`}
              </span>
            </motion.button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 p-3 text-xs text-zinc-400 text-center">
          Способы оплаты не настроены.
        </div>
      )}

      {/* Benefits */}
      <div className="space-y-2 pt-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Преимущества</p>
        <ul className="space-y-1.5">
          {[
            currentTariff?.includedDevices ? `До ${currentTariff.includedDevices} устройств` : "Поддержка нескольких устройств",
            currentTariff?.trafficLimitBytes && currentTariff.trafficLimitBytes !== "0" ? "Ограниченный трафик" : "Безлимитный трафик",
            "Минимальные задержки",
          ].map((b, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="h-4 w-4 rounded-full bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
                <Check className="h-2.5 w-2.5 text-sky-400" strokeWidth={3} />
              </span>
              <span className="text-zinc-200">{b}</span>
            </li>
          ))}
        </ul>
      </div>

      {payError && (
        <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-3 flex items-start gap-2 text-xs">
          <AlertCircle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
          <span className="text-blue-300">{payError}</span>
        </div>
      )}

      {/* Big white CTA */}
      <div className="pt-2">
        <StadiumButton
          variant="white"
          size="lg"
          onClick={pay}
          disabled={paying || !selectedMethod || !currentTariff}
          iconLeft={paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        >
          {paying ? "Создаём платёж…" : `Оплатить ${fmtPrice(totalPrice, currency)}`}
        </StadiumButton>
      </div>
    </div>
  );
}
