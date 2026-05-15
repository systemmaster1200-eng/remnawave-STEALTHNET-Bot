import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { Package, Calendar, Wifi, Smartphone, CreditCard, Loader2, Gift, Tag, Check, Wallet, ChevronDown, Shield, Zap, ArrowLeft, AlertTriangle, Sparkles } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthTariffs } from "@/pages/cabinet/stealth/stealth-tariffs";
import { api } from "@/lib/api";
import type { PublicTariffCategory } from "@/lib/api";
import { formatRuDays } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { PayNowPanel } from "@/components/payment/pay-now-panel";
import { cn } from "@/lib/utils";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

type TariffPriceOption = { id: string; durationDays: number; price: number; sortOrder: number };
type DeviceDiscountTier = { minExtraDevices: number; discountPercent: number };
type TariffForPay = {
  id: string;
  name: string;
  price: number;
  currency: string;
  description?: string | null;
  durationDays?: number;
  trafficLimitBytes?: number | null;
  trafficResetMode?: string;
  deviceLimit?: number | null;
  includedDevices?: number;
  pricePerExtraDevice?: number;
  maxExtraDevices?: number;
  deviceDiscountTiers?: DeviceDiscountTier[];
  priceOptions?: TariffPriceOption[];
};

/**
 * Цена пакета доп. устройств с учётом длительности.
 * pricePerExtra указан за 30 дней (база), для других опций умножается на durationDays/30.
 * Скидка применяется ДО умножения на коэффициент.
 */
const EXTRA_DEVICE_BASE_DAYS = 30;
function applyExtrasPrice(
  pricePerExtra: number,
  extras: number,
  tiers: DeviceDiscountTier[] | undefined,
  durationDays: number = EXTRA_DEVICE_BASE_DAYS,
): { extrasTotal: number; pct: number } {
  const safe = Math.max(0, Math.floor(extras));
  if (safe === 0 || pricePerExtra <= 0) return { extrasTotal: 0, pct: 0 };
  const sorted = [...(tiers ?? [])].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const tier = sorted.find((t) => safe >= t.minExtraDevices);
  const pct = tier?.discountPercent ?? 0;
  const safeDays = Math.max(1, durationDays);
  const monthly = pricePerExtra * safe * (100 - pct) / 100;
  return { extrasTotal: Math.round(monthly * (safeDays / EXTRA_DEVICE_BASE_DAYS) * 100) / 100, pct };
}

function hasExtras(t: TariffForPay): boolean {
  return (t.pricePerExtraDevice ?? 0) > 0 && (t.maxExtraDevices ?? 0) > 0;
}

export function ClientTariffsPage() {
  const design = useCabinetDesign();
  if (design === "stealth") return <StealthTariffs />;
  return <ClassicTariffsPage />;
}

function ClassicTariffsPage() {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const client = state.client;
  const [tariffs, setTariffs] = useState<PublicTariffCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [yookassaEnabled, setYookassaEnabled] = useState(false);
  const [cryptopayEnabled, setCryptopayEnabled] = useState(false);
  const [heleketEnabled, setHeleketEnabled] = useState(false);
  const [lavaEnabled, setLavaEnabled] = useState(false);
  const [lavatopEnabled, setLavatopEnabled] = useState(false);
  const [overpayEnabled, setOverpayEnabled] = useState(false);
  const [paymentProviders, setPaymentProviders] = useState<{ id: string; label: string; sortOrder: number }[]>([]);
  const [trialConfig, setTrialConfig] = useState<{ trialEnabled: boolean; trialDays: number }>({ trialEnabled: false, trialDays: 0 });
  const [payModal, setPayModal] = useState<{ tariff: TariffForPay } | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string } | null>(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);

  // Активная подписка пользователя (для предупреждения о сбросе трафика)
  const [activeSubInfo, setActiveSubInfo] = useState<{ hasActive: boolean; expireAt: string | null; tariffName: string | null; currentPricePerDay: number | null }>({ hasActive: false, expireAt: null, tariffName: null, currentPricePerDay: null });
  const [warnModal, setWarnModal] = useState<{ tariff: TariffForPay } | null>(null);
  // Унифицированная модалка покупки: длительность + ДОП. устройства + скидки + total.
  const [purchaseModal, setPurchaseModal] = useState<{ tariff: TariffForPay } | null>(null);
  const [selectedPriceOptionId, setSelectedPriceOptionId] = useState<string | null>(null);
  /** Сколько ДОП. устройств клиент докупает поверх tariff.includedDevices (0..maxExtraDevices). */
  const [selectedExtraDevices, setSelectedExtraDevices] = useState<number>(0);

  // Промокод
  const [promoInput, setPromoInput] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoResult, setPromoResult] = useState<{ type: string; discountPercent?: number | null; discountFixed?: number | null; name: string } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  // Триал предлагаем только если у юзера ещё нет активной подписки и триал не использован.
  // Без проверки hasActive плашка висит даже после покупки тарифа.
  const showTrial = trialConfig.trialEnabled && !client?.trialUsed && !activeSubInfo.hasActive;

  const isMobileOrMiniapp = useCabinetMiniapp();
  const useCategoryCardLayout = isMobileOrMiniapp;
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (useCategoryCardLayout && tariffs.length > 0) {
      setExpandedCategoryId((prev) => (prev === null ? tariffs[0].id : prev));
    }
  }, [useCategoryCardLayout, tariffs]);

  useEffect(() => {
    api.getPublicTariffs().then((r) => {
      setTariffs(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.getPublicConfig().then((c) => {
      setPlategaMethods(c.plategaMethods ?? []);
      setYoomoneyEnabled(Boolean(c.yoomoneyEnabled));
      setYookassaEnabled(Boolean(c.yookassaEnabled));
      setCryptopayEnabled(Boolean(c.cryptopayEnabled));
      setHeleketEnabled(Boolean(c.heleketEnabled));
      setLavaEnabled(Boolean(c.lavaEnabled));
      setLavatopEnabled(Boolean(c.lavatopEnabled));
      setOverpayEnabled(Boolean(c.overpayEnabled));
      setPaymentProviders(c.paymentProviders ?? []);
      setTrialConfig({ trialEnabled: !!c.trialEnabled, trialDays: c.trialDays ?? 0 });
    }).catch(() => { });
  }, []);

  // Загружаем статус подписки чтобы показать предупреждение о сбросе трафика
  useEffect(() => {
    if (!token) return;
    api.clientSubscription(token).then((res) => {
      // Remna возвращает данные в subscription.response (или subscription напрямую)
      const sub = res?.subscription as Record<string, unknown> | null;
      const payload = (sub && typeof sub === "object" && sub.response && typeof sub.response === "object")
        ? (sub.response as Record<string, unknown>)
        : (sub ?? null);
      const expireRaw = payload && typeof payload.expireAt === "string" ? payload.expireAt : null;
      let hasActive = false;
      let expireAt: string | null = null;
      if (expireRaw) {
        try {
          const d = new Date(expireRaw);
          if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
            hasActive = true;
            expireAt = expireRaw;
          }
        } catch { /* ignore */ }
      }
      setActiveSubInfo({
        hasActive,
        expireAt,
        tariffName: res?.tariffDisplayName ?? null,
        currentPricePerDay: res?.currentPricePerDay ?? null,
      });
    }).catch(() => { /* not critical */ });
  }, [token]);

  // Запрос на покупку тарифа: открываем единую модалку.
  function requestBuy(tariff: TariffForPay) {
    const opts = tariff.priceOptions ?? [];
    const defaultOpt = opts[0] ?? null;
    setSelectedPriceOptionId(defaultOpt?.id ?? null);
    setSelectedExtraDevices(0);
    setPurchaseModal({ tariff });
  }

  // Подтверждение из purchaseModal: total = priceOption.price + extras × pricePerExtra × (1 − pct/100).
  function confirmPurchase() {
    if (!purchaseModal) return;
    const baseTariff = purchaseModal.tariff;
    const opts = baseTariff.priceOptions ?? [];
    const opt = opts.find((o) => o.id === selectedPriceOptionId) ?? opts[0];
    const unitPrice = opt?.price ?? baseTariff.price;
    const optDays = opt?.durationDays ?? baseTariff.durationDays ?? 30;
    const { extrasTotal } = applyExtrasPrice(baseTariff.pricePerExtraDevice ?? 0, selectedExtraDevices, baseTariff.deviceDiscountTiers, optDays);
    const total = unitPrice + extrasTotal;
    const tariffWithOption: TariffForPay = {
      ...baseTariff,
      durationDays: opt?.durationDays ?? baseTariff.durationDays,
      price: total,
    };
    setSelectedPriceOptionId(opt?.id ?? null);
    setPurchaseModal(null);
    if (activeSubInfo.hasActive) {
      setWarnModal({ tariff: tariffWithOption });
    } else {
      setPayModal({ tariff: tariffWithOption });
    }
  }

  function confirmWarnAndBuy() {
    if (!warnModal) return;
    const t = warnModal.tariff;
    setWarnModal(null);
    setPayModal({ tariff: t });
  }

  async function activateTrial() {
    if (!token) return;
    setTrialError(null);
    setTrialLoading(true);
    try {
      await api.clientActivateTrial(token);
      await refreshProfile();
    } catch (e) {
      setTrialError(e instanceof Error ? e.message : t("cabinet.tariffs.error_trial"));
    } finally {
      setTrialLoading(false);
    }
  }

  async function checkPromo() {
    if (!token || !promoInput.trim()) return;
    setPromoChecking(true);
    setPromoError(null);
    setPromoResult(null);
    try {
      const res = await api.clientCheckPromoCode(token, promoInput.trim());
      if (res.type === "DISCOUNT") {
        setPromoResult(res);
      } else {
        const activateRes = await api.clientActivatePromoCode(token, promoInput.trim());
        setPromoError(null);
        setPromoResult(null);
        setPromoInput("");
        setPayModal(null);
        alert(activateRes.message);
        await refreshProfile();
        return;
      }
    } catch (e) {
      setPromoError(e instanceof Error ? e.message : t("cabinet.tariffs.error_promo"));
      setPromoResult(null);
    } finally {
      setPromoChecking(false);
    }
  }

  function getDiscountedPrice(price: number): number {
    if (!promoResult) return price;
    let final = price;
    if (promoResult.discountPercent && promoResult.discountPercent > 0) {
      final -= final * promoResult.discountPercent / 100;
    }
    if (promoResult.discountFixed && promoResult.discountFixed > 0) {
      final -= promoResult.discountFixed;
    }
    return Math.max(0, Math.round(final * 100) / 100);
  }

  async function startPayment(tariff: TariffForPay, methodId: number) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.clientCreatePlategaPayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        paymentMethod: methodId,
        description: tariff.name,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      if (res.paymentUrl) setReadyUrl({ url: res.paymentUrl, provider: "Platega" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function payByBalance(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.clientPayByBalance(token, {
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      setPayModal(null);
      setPromoInput("");
      setPromoResult(null);
      alert(res.message);
      await refreshProfile();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startYoomoneyPayment(tariff: TariffForPay) {
    if (!token) return;
    if (tariff.currency.toUpperCase() !== "RUB") {
      setPayError(t("cabinet.tariffs.error_yoomoney_rub"));
      return;
    }
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yoomoneyCreateFormPayment(token, {
        amount: tariff.price,
        paymentType: "AC",
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      if (res.paymentUrl) setReadyUrl({ url: res.paymentUrl, provider: "ЮMoney" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startYookassaPayment(tariff: TariffForPay) {
    if (!token) return;
    if (tariff.currency.toUpperCase() !== "RUB") {
      setPayError(t("cabinet.tariffs.error_yookassa_rub"));
      return;
    }
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yookassaCreatePayment(token, {
        amount: tariff.price,
        currency: "RUB",
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      if (res.confirmationUrl) setReadyUrl({ url: res.confirmationUrl, provider: "ЮKassa" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startCryptopayPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.cryptopayCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Crypto Bot" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startHeleketPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.heleketCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Heleket" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startLavaPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.lavaCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "LAVA" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startLavatopPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.lavatopCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Lava.top" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startOverpayPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.overpayCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Overpay" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  const closePayment = () => {
    setPayModal(null);
    setPromoInput("");
    setPromoResult(null);
    setPromoError(null);
    setPayError(null);
    setReadyUrl(null);
  };

  // === КОНТЕНТ ОПЛАТЫ (ОБЩИЙ ДЛЯ MOBILE VIEW И DESKTOP DIALOG) ===
  const PaymentContent = () => {
    if (!payModal) return null;
    const tariff = payModal.tariff;
    const price = promoResult ? getDiscountedPrice(tariff.price) : tariff.price;
    const hasBalance = client ? client.balance >= price : false;

    if (readyUrl) {
      return (
        <PayNowPanel
          url={readyUrl.url}
          provider={readyUrl.provider}
          onBack={() => setReadyUrl(null)}
          onPaid={() => closePayment()}
          compact={isMobileOrMiniapp}
        />
      );
    }

    return (
      <div className="space-y-6">
        {/* Карточка с инфой о тарифе */}
        <div className={cn("rounded-2xl relative overflow-hidden", isMobileOrMiniapp ? "bg-card/40 border border-white/5 p-5" : "bg-background/50 border border-border/50 p-4")}>
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex justify-between items-start gap-4 relative z-10">
            <div className="space-y-1.5">
              <p className={cn("font-medium", isMobileOrMiniapp ? "text-sm text-muted-foreground" : "text-muted-foreground")}>
                {isMobileOrMiniapp ? t("cabinet.tariffs.total") : t("cabinet.tariffs.tariff_label")}
              </p>
              {!isMobileOrMiniapp && <p className="font-bold text-foreground">{tariff.name}</p>}
              
              {isMobileOrMiniapp && (
                <div className="flex items-baseline gap-2">
                  {promoResult ? (
                    <>
                      <span className="text-3xl font-black text-primary">{formatMoney(price, tariff.currency)}</span>
                      <span className="text-lg line-through text-muted-foreground decoration-2">{formatMoney(tariff.price, tariff.currency)}</span>
                    </>
                  ) : (
                    <span className="text-3xl font-black text-primary">{formatMoney(tariff.price, tariff.currency)}</span>
                  )}
                </div>
              )}
            </div>
            
            {!isMobileOrMiniapp && (
              <div className="text-right">
                {promoResult ? (
                  <div className="flex flex-col items-end">
                    <span className="line-through text-muted-foreground/70 text-sm decoration-2">{formatMoney(tariff.price, tariff.currency)}</span>
                    <span className="font-bold text-xl text-primary">{formatMoney(price, tariff.currency)}</span>
                  </div>
                ) : (
                  <span className="font-bold text-xl text-primary">{formatMoney(tariff.price, tariff.currency)}</span>
                )}
              </div>
            )}
          </div>
          
          {isMobileOrMiniapp && (
            <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 gap-3 relative z-10">
              <div className="bg-background/40 rounded-2xl p-3 border border-white/5">
                <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">{t("cabinet.tariffs.duration_label")}</p>
                <div className="flex items-center gap-1.5 font-bold text-sm">
                  <Calendar className="h-4 w-4 text-primary" />
                  {tariff.durationDays} {t("cabinet.tariffs.days_short")}
                </div>
              </div>
              <div className="bg-background/40 rounded-2xl p-3 border border-white/5">
                <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">{t("cabinet.tariffs.traffic_label")}</p>
                <div className="flex items-center gap-1.5 font-bold text-sm">
                  <Wifi className="h-4 w-4 text-primary" />
                  {tariff.trafficLimitBytes != null && tariff.trafficLimitBytes > 0 ? `${(tariff.trafficLimitBytes / 1024 / 1024 / 1024).toFixed(1)} ${t("cabinet.tariffs.gb_unit")}${tariff.trafficResetMode === "monthly" || tariff.trafficResetMode === "monthly_rolling" ? t("cabinet.tariffs.per_month") : ""}` : "∞"}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Промокод */}
        <div className={cn("space-y-3", !isMobileOrMiniapp && "bg-background/40 border border-border/50 rounded-2xl p-4 focus-within:border-primary/50 focus-within:bg-background/60 hover:border-primary/30 transition-all duration-300 relative overflow-hidden group")}>
          {!isMobileOrMiniapp && <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />}
          <div className="flex items-center gap-2 text-sm font-bold text-foreground pl-1 relative z-10">
            {isMobileOrMiniapp ? <Tag className="h-4 w-4 text-primary" /> : <div className="p-1.5 bg-primary/10 rounded-lg"><Tag className="h-4 w-4 text-primary" /></div>}
            {t("cabinet.tariffs.promo_code")}
          </div>
          <div className="flex gap-2 relative z-10">
            <Input
              name="promo_code"
              autoComplete="off"
              inputMode="text"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value)}
              placeholder={t("cabinet.tariffs.promo_placeholder")}
              className={cn("font-mono font-medium focus-visible:ring-primary/50", isMobileOrMiniapp ? "text-base bg-card/40 border-white/5 h-14 rounded-2xl" : "text-sm bg-background border-border/50 h-12 rounded-xl shadow-sm")}
              disabled={payLoading || promoChecking}
            />
            <Button
              variant={isMobileOrMiniapp ? "default" : "secondary"}
              onClick={checkPromo}
              disabled={!promoInput.trim() || payLoading || promoChecking}
              className={cn("shrink-0 font-bold bg-primary text-primary-foreground shadow-md transition-all hover:scale-105 active:scale-95", isMobileOrMiniapp ? "h-14 px-6 rounded-2xl text-base" : "h-12 px-5 rounded-xl text-sm border-0 hover:bg-primary/90")}
            >
              {promoChecking ? <Loader2 className="h-5 w-5 animate-spin" /> : t("cabinet.tariffs.promo_apply")}
            </Button>
          </div>
          <AnimatePresence>
            {promoResult && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden relative z-10">
                <div className={cn("flex items-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/20", isMobileOrMiniapp ? "rounded-2xl" : "rounded-lg")}>
                  <Check className={cn("text-green-500", isMobileOrMiniapp ? "h-5 w-5" : "h-4 w-4")} />
                  <span className={cn("font-bold text-green-500", isMobileOrMiniapp ? "text-sm" : "text-sm")}>
                    {promoResult.name}: -{promoResult.discountPercent ? `${promoResult.discountPercent}%` : ""}{promoResult.discountFixed ? ` ${promoResult.discountFixed}` : ""}
                  </span>
                </div>
              </motion.div>
            )}
            {promoError && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden relative z-10">
                <div className={cn("flex items-center gap-2 px-4 py-3 bg-destructive/10 border border-destructive/20", isMobileOrMiniapp ? "rounded-2xl" : "rounded-lg")}>
                  <span className={cn("font-bold text-destructive", isMobileOrMiniapp ? "text-sm" : "text-sm")}>
                    {promoError}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Способы оплаты */}
        <div className={cn("space-y-3")}>
          <div className="flex items-center gap-2 pt-2 pb-1">
            <Wallet className={cn("text-primary", isMobileOrMiniapp ? "h-5 w-5" : "h-4 w-4")} />
            <span className={cn("font-bold", isMobileOrMiniapp ? "text-lg" : "text-sm")}>{t("cabinet.tariffs.payment_method")}</span>
          </div>

          {payError && (
            <div className={cn("p-4 bg-destructive/10 border border-destructive/20 text-destructive text-center font-bold", isMobileOrMiniapp ? "rounded-2xl text-sm" : "rounded-xl text-sm mb-4")}>
              {payError}
            </div>
          )}

          <div className="space-y-3">
            {client && (
              <Button
                size="lg"
                onClick={() => payByBalance(tariff)}
                disabled={payLoading || !hasBalance}
                className={cn("w-full shadow-lg border-0 group relative overflow-hidden", isMobileOrMiniapp ? "justify-between px-6 h-16 rounded-2xl bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400" : "gap-2 h-14 rounded-xl bg-gradient-to-r from-primary to-primary/80 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300")}
              >
                {!isMobileOrMiniapp && <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />}
                
                {isMobileOrMiniapp ? (
                  <>
                    <div className="flex items-center gap-3">
                      {payLoading ? <Loader2 className="h-6 w-6 text-white animate-spin" /> : <Wallet className="h-6 w-6 text-white" />}
                      <span className="text-base font-bold text-white">{t("cabinet.tariffs.pay_balance")}</span>
                    </div>
                    <span className="text-white/80 font-mono font-medium bg-black/20 px-2 py-1 rounded-lg">
                      {formatMoney(client.balance, tariff.currency)}
                    </span>
                  </>
                ) : (
                  <>
                    {payLoading ? <Loader2 className="h-5 w-5 animate-spin relative z-10" /> : <Wallet className="h-5 w-5 relative z-10" />}
                    <span className="text-base font-semibold relative z-10">{t("cabinet.tariffs.pay_balance")}</span>
                    <span className="opacity-90 font-medium ml-1 bg-black/10 px-2 py-0.5 rounded-md relative z-10">
                      ({formatMoney(client.balance, payModal.tariff.currency)})
                    </span>
                  </>
                )}
              </Button>
            )}

            {(() => {
              const providerLabel = (id: string, fallback: string) => paymentProviders.find((p) => p.id === id)?.label || fallback;
              const isRub = tariff.currency.toUpperCase() === "RUB";
              const btnCls = cn("w-full", isMobileOrMiniapp ? "justify-start gap-4 px-6 h-16 rounded-2xl border-white/5 bg-card/40 hover:bg-card/60" : "gap-3 hover:bg-background/80 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-xl h-14 border-border/50 group justify-center px-6 relative");

              const colorMap: Record<string, { bg10: string; bg20: string; text: string }> = {
                cryptopay: { bg10: "bg-yellow-500/10", bg20: "group-hover:bg-yellow-500/20", text: "text-yellow-500" },
                heleket: { bg10: "bg-orange-500/10", bg20: "group-hover:bg-orange-500/20", text: "text-orange-500" },
                yookassa: { bg10: "bg-green-500/10", bg20: "group-hover:bg-green-500/20", text: "text-green-500" },
                yoomoney: { bg10: "bg-green-500/10", bg20: "group-hover:bg-green-500/20", text: "text-green-500" },
                lava: { bg10: "bg-sky-500/10", bg20: "group-hover:bg-sky-500/20", text: "text-sky-500" },
                overpay: { bg10: "bg-indigo-500/10", bg20: "group-hover:bg-indigo-500/20", text: "text-indigo-500" },
              };

              type ProviderEntry = { id: string; enabled: boolean; onClick: () => void; label: string; icon: "crypto" | "card" };
              const providers: ProviderEntry[] = [
                { id: "cryptopay", enabled: cryptopayEnabled, onClick: () => startCryptopayPayment(tariff), label: providerLabel("cryptopay", "Crypto Bot"), icon: "crypto" },
                { id: "heleket", enabled: heleketEnabled, onClick: () => startHeleketPayment(tariff), label: providerLabel("heleket", "Heleket"), icon: "crypto" },
                { id: "yookassa", enabled: yookassaEnabled && isRub, onClick: () => startYookassaPayment(tariff), label: providerLabel("yookassa", t("cabinet.tariffs.sbp_cards_ru")), icon: "card" },
                { id: "yoomoney", enabled: yoomoneyEnabled && isRub, onClick: () => startYoomoneyPayment(tariff), label: providerLabel("yoomoney", t("cabinet.tariffs.yoomoney_cards")), icon: "card" },
                { id: "lava", enabled: lavaEnabled && isRub, onClick: () => startLavaPayment(tariff), label: providerLabel("lava", "LAVA"), icon: "card" },
                { id: "lavatop", enabled: lavatopEnabled, onClick: () => startLavatopPayment(tariff), label: providerLabel("lavatop", "Lava.top"), icon: "card" },
                { id: "overpay", enabled: overpayEnabled, onClick: () => startOverpayPayment(tariff), label: providerLabel("overpay", "Overpay"), icon: "card" },
              ];

              const sortedProviders = paymentProviders.length > 0
                ? paymentProviders.map((pp) => providers.find((p) => p.id === pp.id)).filter((p): p is ProviderEntry => !!p)
                : providers;

              return (
                <>
                  {sortedProviders.filter((p) => p.enabled).map((p) => {
                    const c = colorMap[p.id] ?? colorMap.yookassa;
                    return (
                    <Button key={p.id} size="lg" variant="outline" onClick={p.onClick} disabled={payLoading} className={btnCls}>
                      {isMobileOrMiniapp ? (
                        <>
                          <div className={cn("p-2 rounded-xl", c.bg10)}>
                            {payLoading ? <Loader2 className={cn("h-6 w-6 animate-spin", c.text)} /> : p.icon === "crypto" ? <Zap className={cn("h-6 w-6", c.text)} /> : <CreditCard className={cn("h-6 w-6", c.text)} />}
                          </div>
                          <span className="text-base font-bold">{p.label}</span>
                        </>
                      ) : (
                        <>
                          <div className={cn("absolute left-6 p-1.5 rounded-lg transition-colors", c.bg10, c.bg20)}>
                            {payLoading ? <Loader2 className={cn("h-5 w-5 animate-spin", c.text)} /> : p.icon === "crypto" ? <Zap className={cn("h-5 w-5", c.text)} /> : <CreditCard className={cn("h-5 w-5", c.text)} />}
                          </div>
                          <span className="text-base font-medium">{p.icon === "crypto" ? "⚡" : "💳"} {p.label}</span>
                        </>
                      )}
                    </Button>
                    );
                  })}
                  {plategaMethods.map((m) => (
                    <Button key={m.id} size="lg" variant="outline" onClick={() => startPayment(tariff, m.id)} disabled={payLoading} className={btnCls}>
                      {isMobileOrMiniapp ? (
                        <>
                          <div className="p-2 rounded-xl bg-green-500/10">
                            {payLoading ? <Loader2 className="h-6 w-6 animate-spin text-green-500" /> : <CreditCard className="h-6 w-6 text-green-500" />}
                          </div>
                          <span className="text-base font-bold">{m.label}</span>
                        </>
                      ) : (
                        <>
                          <div className="absolute left-6 p-1.5 rounded-lg bg-green-500/10 group-hover:bg-green-500/20 transition-colors">
                            {payLoading ? <Loader2 className="h-5 w-5 animate-spin text-green-500" /> : <CreditCard className="h-5 w-5 text-green-500" />}
                          </div>
                          <span className="text-base font-medium">💳 {m.label}</span>
                        </>
                      )}
                    </Button>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <AnimatePresence mode="wait">
        {/* MOBILE VIEW */}
        {isMobileOrMiniapp && payModal ? (
          <motion.div
            key="payment-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col w-full rounded-[2.5rem] border border-white/10 dark:border-white/5 bg-slate-50/60 dark:bg-slate-950/60 backdrop-blur-[32px] shadow-2xl relative"
          >
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border/50 bg-background/30 backdrop-blur-md z-10 transition-colors rounded-t-[2.5rem]">
              <div className="flex items-center gap-3 min-w-0">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="shrink-0 h-9 w-9 rounded-full bg-background/50 hover:bg-background/80 transition-transform hover:scale-105" 
                  onClick={closePayment}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm sm:text-base font-bold truncate text-foreground">{t("cabinet.tariffs.payment_title")}</h2>
                  <p className="text-[11px] font-medium text-muted-foreground truncate">{payModal.tariff.name}</p>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-6 pb-8">
               {PaymentContent()}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="tariffs-list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="space-y-8 max-w-6xl mx-auto"
          >
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">{t("cabinet.tariffs.title")}</h1>
              <p className="text-muted-foreground text-[15px] font-medium max-w-2xl">
                {t("cabinet.tariffs.subtitle")}
              </p>
            </div>

            {showTrial && (
              <Card className="rounded-3xl border border-green-500/30 bg-green-500/5 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300">
                <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/20 text-green-500 shadow-inner shrink-0">
                      <Gift className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="font-bold text-lg text-foreground">{t("cabinet.tariffs.free_trial")}</p>
                      <p className="text-sm text-muted-foreground font-medium">
                        {trialConfig.trialDays > 0
                          ? `${formatRuDays(trialConfig.trialDays)} ${t("cabinet.tariffs.free_access")}`
                          : t("cabinet.tariffs.free_access_0")}
                      </p>
                    </div>
                  </div>
                  <Button
                    className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white shadow-lg h-12 rounded-xl text-md hover:scale-[1.02] transition-transform duration-300 shrink-0 gap-2"
                    onClick={activateTrial}
                    disabled={trialLoading}
                  >
                    {trialLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Gift className="h-5 w-5" />}
                    {t("cabinet.tariffs.free_trial")}
                  </Button>
                </CardContent>
                {trialError && <p className="text-sm text-destructive px-6 pb-4 font-medium">{trialError}</p>}
              </Card>
            )}

            <div data-tour="tariff-list">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
              </div>
            ) : tariffs.length === 0 ? (
              <Card className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-4">
                  <Package className="h-12 w-12 opacity-20" />
                  <p className="text-base font-medium text-center">{t("cabinet.tariffs.empty")}</p>
                </CardContent>
              </Card>
            ) : useCategoryCardLayout ? (
              <div className="space-y-1">
                {tariffs.map((cat, catIndex) => (
                  <Collapsible
                    key={cat.id}
                    open={expandedCategoryId === cat.id}
                    onOpenChange={(open) => setExpandedCategoryId(open ? cat.id : null)}
                  >
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: catIndex * 0.03 }}
                      className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg overflow-hidden transition-all duration-300"
                    >
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/20 active:bg-muted/30 transition-colors"
                        >
                          <span className="flex items-center gap-3 font-bold text-[16px] text-foreground">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary shadow-inner shrink-0">
                              <Package className="h-4 w-4" />
                            </div>
                            {cat.name}
                          </span>
                          <ChevronDown
                            className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${expandedCategoryId === cat.id ? "rotate-180" : ""}`}
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-3 pb-4 pt-1 flex flex-col gap-3">
                          {cat.tariffs.map((tf) => (
                            <Card key={tf.id} className="rounded-2xl border border-border/50 bg-background/50 backdrop-blur-md shadow-sm hover:shadow-md transition-all duration-300">
                              <CardContent className="flex flex-row items-center gap-4 py-4 px-4 min-h-0 min-w-0">
                                <div className="flex-1 min-w-0 space-y-1.5">
                                  <p className="text-[15px] font-bold leading-tight truncate text-foreground">{tf.name}</p>
                                  {tf.description?.trim() ? (
                                    <p className="text-xs text-muted-foreground font-medium line-clamp-2">{tf.description}</p>
                                  ) : null}
                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                    <span className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md border border-border/50">
                                      <Calendar className="h-3 w-3 text-primary" />
                                      {(() => {
                                        const opts = tf.priceOptions ?? [];
                                        if (opts.length > 1) {
                                          const minDays = opts.reduce((min, o) => Math.min(min, o.durationDays), opts[0].durationDays);
                                          return <>от {minDays} {t("cabinet.tariffs.days_short")}</>;
                                        }
                                        return <>{tf.durationDays} {t("cabinet.tariffs.days_short")}</>;
                                      })()}
                                    </span>
                                    <span className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md border border-border/50">
                                      <Wifi className="h-3 w-3 text-primary" />
                                      {tf.trafficLimitBytes != null && tf.trafficLimitBytes > 0 ? `${(tf.trafficLimitBytes / 1024 / 1024 / 1024).toFixed(1)} ${t("cabinet.tariffs.gb_unit")}${tf.trafficResetMode === "monthly" || tf.trafficResetMode === "monthly_rolling" ? t("cabinet.tariffs.per_month") : ""}` : "∞"}
                                    </span>
                                    <span className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md border border-border/50">
                                      <Smartphone className="h-3 w-3 text-primary" />
                                      {tf.deviceLimit != null && tf.deviceLimit > 0 ? `${tf.deviceLimit}` : "∞"}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex flex-col items-center justify-center gap-2.5 shrink-0 min-w-[90px]">
                                  <span className="text-lg font-bold tabular-nums whitespace-nowrap text-foreground" title={formatMoney(tf.price, tf.currency)}>
                                    {(() => {
                                      const opts = tf.priceOptions ?? [];
                                      if (opts.length > 1) {
                                        const min = opts.reduce((a, b) => (a.price < b.price ? a : b));
                                        return <>{t("cabinet.tariffs.from_price", { defaultValue: "от" })} {formatMoney(min.price, tf.currency)}</>;
                                      }
                                      return formatMoney(tf.price, tf.currency);
                                    })()}
                                  </span>
                                  {token ? (
                                    <Button
                                      size="sm"
                                      className="w-full h-9 rounded-xl shadow-md text-xs font-semibold gap-1.5 hover:scale-105 transition-transform"
                                      onClick={() => requestBuy({ ...tf })}
                                    >
                                      <CreditCard className="h-3.5 w-3.5 shrink-0" />
                                      {t("cabinet.tariffs.pay")}
                                    </Button>
                                  ) : (
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">{t("cabinet.tariffs.in_bot")}</span>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </motion.div>
                  </Collapsible>
                ))}
              </div>
            ) : (
              <div className="space-y-8">
                {tariffs.map((cat, catIndex) => (
                  <motion.section
                    key={cat.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: catIndex * 0.05 }}
                  >
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-3 text-foreground">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-inner shrink-0">
                        <Package className="h-5 w-5" />
                      </div>
                      {cat.name}
                    </h2>
                    <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {cat.tariffs.map((tf) => (
                        <Card key={tf.id} className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col group hover:-translate-y-1">
                          <CardContent className="flex-1 flex flex-col p-5 min-h-0 min-w-0">
                            <div className="mb-4">
                              <p className="text-lg font-bold leading-tight line-clamp-2 text-foreground group-hover:text-primary transition-colors">{tf.name}</p>
                              {tf.description?.trim() ? (
                                <p className="text-sm text-muted-foreground font-medium mt-1.5 line-clamp-2">{tf.description}</p>
                              ) : null}
                            </div>

                            <div className="flex flex-col gap-2.5 mt-auto mb-5 text-sm font-semibold text-muted-foreground">
                              <div className="flex items-center gap-3 bg-background/50 px-3 py-2 rounded-xl border border-border/50">
                                <div className="bg-primary/20 p-1.5 rounded-lg text-primary">
                                  <Calendar className="h-4 w-4 shrink-0" />
                                </div>
                                <span>
                                  {(() => {
                                    const opts = tf.priceOptions ?? [];
                                    if (opts.length > 1) {
                                      const minDays = opts.reduce((min, o) => Math.min(min, o.durationDays), opts[0].durationDays);
                                      return <>от {minDays} {t("cabinet.tariffs.days_label")}</>;
                                    }
                                    return <>{tf.durationDays} {t("cabinet.tariffs.days_label")}</>;
                                  })()}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 bg-background/50 px-3 py-2 rounded-xl border border-border/50">
                                <div className="bg-primary/20 p-1.5 rounded-lg text-primary">
                                  <Wifi className="h-4 w-4 shrink-0" />
                                </div>
                                <span>
                                  {tf.trafficLimitBytes != null && tf.trafficLimitBytes > 0
                                    ? `${(tf.trafficLimitBytes / 1024 / 1024 / 1024).toFixed(1)} ${t("cabinet.tariffs.gb_unit")}${tf.trafficResetMode === "monthly" || tf.trafficResetMode === "monthly_rolling" ? t("cabinet.tariffs.per_month") : ""}`
                                    : t("cabinet.tariffs.unlimited_traffic")}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 bg-background/50 px-3 py-2 rounded-xl border border-border/50">
                                <div className="bg-primary/20 p-1.5 rounded-lg text-primary">
                                  <Smartphone className="h-4 w-4 shrink-0" />
                                </div>
                                <span>{tf.deviceLimit != null && tf.deviceLimit > 0 ? `${tf.deviceLimit}` : "∞"} {t("cabinet.tariffs.devices")}</span>
                              </div>
                            </div>

                            <div className="pt-4 border-t border-border/50 mt-auto flex flex-col gap-3 min-w-0">
                              <span className="text-2xl font-black tabular-nums truncate min-w-0 text-foreground text-center" title={formatMoney(tf.price, tf.currency)}>
                                {(() => {
                                  const opts = tf.priceOptions ?? [];
                                  if (opts.length > 1) {
                                    const min = opts.reduce((a, b) => (a.price < b.price ? a : b));
                                    return <>{t("cabinet.tariffs.from_price", { defaultValue: "от" })} {formatMoney(min.price, tf.currency)}</>;
                                  }
                                  return formatMoney(tf.price, tf.currency);
                                })()}
                              </span>
                              {token ? (
                                <Button
                                  size="lg"
                                  className="w-full h-12 rounded-xl shadow-md text-[15px] font-bold gap-2 hover:scale-[1.02] transition-transform"
                                  onClick={() => requestBuy({ ...tf })}
                                >
                                  <CreditCard className="h-5 w-5 shrink-0" />
                                  {t("cabinet.tariffs.pay")}
                                </Button>
                              ) : (
                                <div className="w-full h-12 rounded-xl bg-muted/50 border border-border/50 flex items-center justify-center">
                                  <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{t("cabinet.tariffs.in_bot")}</span>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </motion.section>
                ))}
              </div>
            )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DESKTOP VIEW: DIALOG БЕЗ СКРОЛЛИНГА */}
      {!isMobileOrMiniapp && (
        <Dialog open={!!payModal} onOpenChange={(open) => { if (!open && !payLoading) closePayment(); }}>
          <DialogContent className="w-full max-w-md mx-auto sm:rounded-3xl p-5 sm:p-6 border border-border/50 bg-card/60 backdrop-blur-3xl shadow-2xl" showCloseButton={!payLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader className="mb-4 text-center sm:text-left">
              <DialogTitle className="text-2xl font-bold flex items-center justify-center sm:justify-start gap-2">
                <div className="p-2 bg-primary/10 rounded-xl">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                {t("cabinet.tariffs.payment_title")}
              </DialogTitle>
              <DialogDescription className="hidden" />
            </DialogHeader>

            {PaymentContent()}

            <DialogFooter className="mt-4 sm:justify-center border-t border-border/50 pt-4">
              <Button variant="ghost" onClick={closePayment} disabled={payLoading} className="rounded-xl hover:bg-background/50 hover:text-foreground text-muted-foreground transition-colors">
                {t("cabinet.tariffs.cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Предупреждение перед сменой тарифа: трафик сбросится, дни добавятся к текущему сроку */}
      <Dialog open={!!warnModal} onOpenChange={(open) => !open && setWarnModal(null)}>
        <DialogContent className="bg-background/85 backdrop-blur-3xl border-white/10 rounded-[2rem] sm:max-w-md overflow-hidden">
          <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-gradient-to-br from-amber-500/25 to-orange-500/15 blur-3xl pointer-events-none" />
          <DialogHeader className="relative">
            <div className="flex items-center gap-3 mb-1">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-500/30 to-orange-500/15 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                <AlertTriangle className="h-6 w-6 text-amber-500 dark:text-amber-400" />
              </div>
              <DialogTitle className="text-xl font-bold tracking-tight">
                У вас уже есть активная подписка
              </DialogTitle>
            </div>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed pt-2">
              Если вы продолжите покупку, произойдут следующие изменения:
            </DialogDescription>
          </DialogHeader>

          <div className="relative space-y-3 mt-1">
            <div className="rounded-2xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-2.5">
              <div className="flex items-start gap-3">
                <div className="h-7 w-7 shrink-0 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center mt-0.5">
                  <Wifi className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight">Сбросится израсходованный трафик</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Текущий счётчик обнулится — сможете снова использовать гигабайты по новому тарифу</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-7 w-7 shrink-0 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mt-0.5">
                  <Calendar className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight">Дни добавятся к текущему сроку</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {warnModal?.tariff.durationDays
                      ? `+${warnModal.tariff.durationDays} ${formatRuDays(warnModal.tariff.durationDays).replace(/^\d+\s/, "")} к подписке`
                      : "Дни нового тарифа добавятся к подписке"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-7 w-7 shrink-0 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center mt-0.5">
                  <Package className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight">Тариф сменится на новый</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Лимиты, устройства и серверы — по новому тарифу <span className="font-medium text-foreground">{warnModal?.tariff.name}</span>
                  </p>
                </div>
              </div>
              {(() => {
                // Расчёт конвертированных дней (pro-rata) на лету
                const oldPpd = activeSubInfo.currentPricePerDay;
                const expireRaw = activeSubInfo.expireAt;
                const newDays = warnModal?.tariff.durationDays ?? 0;
                const newPrice = warnModal?.tariff.price ?? 0;
                const newPpd = newDays > 0 ? newPrice / newDays : 0;
                if (!oldPpd || !expireRaw || !newPpd || newDays === 0) {
                  return (
                    <div className="flex items-start gap-3">
                      <div className="h-7 w-7 shrink-0 rounded-lg bg-sky-500/15 border border-sky-500/20 flex items-center justify-center mt-0.5">
                        <Sparkles className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-tight">Остаток конвертируется в дни</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Остаток вашего текущего тарифа пересчитается в дни нового по соотношению цен
                        </p>
                      </div>
                    </div>
                  );
                }
                const remainingMs = new Date(expireRaw).getTime() - Date.now();
                const remainingDays = Math.max(0, Math.floor(remainingMs / (24 * 60 * 60 * 1000)));
                const isSameTariff = activeSubInfo.tariffName?.trim() === warnModal?.tariff.name.trim();
                const convertedDays = isSameTariff
                  ? remainingDays // Тот же тариф = стек 1:1
                  : Math.max(0, Math.floor((remainingDays * oldPpd) / newPpd));
                const totalDays = newDays + convertedDays;
                return (
                  <div className="flex items-start gap-3">
                    <div className="h-7 w-7 shrink-0 rounded-lg bg-sky-500/15 border border-sky-500/20 flex items-center justify-center mt-0.5">
                      <Sparkles className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-tight">
                        {isSameTariff ? "Остаток сохранится полностью" : "Остаток конвертируется"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Осталось <span className="font-semibold text-foreground">{remainingDays}</span> дн. по текущему тарифу.
                        {!isSameTariff && (
                          <> Конвертируется в <span className="font-semibold text-foreground">{convertedDays}</span> дн. нового по соотношению цен.</>
                        )}
                      </p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">
                        Итого: {newDays} + {convertedDays} = {totalDays} {formatRuDays(totalDays).replace(/^\d+\s/, "")}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <DialogFooter className="mt-2 gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setWarnModal(null)} className="rounded-xl">
              Отмена
            </Button>
            <Button onClick={confirmWarnAndBuy} className="rounded-xl gap-2 bg-gradient-to-br from-primary to-primary/85 hover:from-primary/90 hover:to-primary/75">
              <CreditCard className="h-4 w-4" />
              Продолжить покупку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Унифицированная модалка покупки: длительность + ДОП. устройства + total */}
      <UnifiedPurchaseModal
        modal={purchaseModal}
        selectedPriceOptionId={selectedPriceOptionId}
        setSelectedPriceOptionId={setSelectedPriceOptionId}
        selectedExtraDevices={selectedExtraDevices}
        setSelectedExtraDevices={setSelectedExtraDevices}
        onClose={() => setPurchaseModal(null)}
        onConfirm={confirmPurchase}
      />
    </>
  );
}

// ─────────────── Унифицированная модалка покупки тарифа ───────────────
// Длительность (chips) → Устройства (плитки со скидкой) → итог + кнопка дальше.
function UnifiedPurchaseModal({
  modal,
  selectedPriceOptionId,
  setSelectedPriceOptionId,
  selectedExtraDevices,
  setSelectedExtraDevices,
  onClose,
  onConfirm,
}: {
  modal: { tariff: TariffForPay } | null;
  selectedPriceOptionId: string | null;
  setSelectedPriceOptionId: (v: string | null) => void;
  selectedExtraDevices: number;
  setSelectedExtraDevices: (v: number) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const tariff = modal?.tariff;
  if (!tariff) return null;

  const opts = [...(tariff.priceOptions ?? [])].sort((a, b) =>
    a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.durationDays - b.durationDays
  );
  const selectedOpt = opts.find((o) => o.id === selectedPriceOptionId) ?? opts[0] ?? null;
  const unitPrice = selectedOpt?.price ?? tariff.price;
  const includedDevices = tariff.includedDevices ?? 1;
  const pricePerExtra = tariff.pricePerExtraDevice ?? 0;
  const maxExtras = tariff.maxExtraDevices ?? 0;
  const extrasEnabled = hasExtras(tariff);
  const tiers = tariff.deviceDiscountTiers ?? [];

  // Best-deal по длительности (минимальная цена за день).
  let bestDurationId: string | null = null;
  if (opts.length > 1) {
    let bestRatio = Infinity;
    for (const o of opts) {
      if (o.durationDays <= 0) continue;
      const ratio = o.price / o.durationDays;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestDurationId = o.id;
      }
    }
  }

  // Длительность выбранной опции — нужна для масштаба цены доп. устройств.
  const selectedDays = selectedOpt?.durationDays ?? tariff.durationDays ?? 30;

  // Плитки доп. устройств: +0..+maxExtras.
  const deviceTiles = Array.from({ length: maxExtras + 1 }, (_, i) => {
    const extras = i;
    const { extrasTotal, pct } = applyExtrasPrice(pricePerExtra, extras, tiers, selectedDays);
    return { extras, total: unitPrice + extrasTotal, pct, totalDevices: includedDevices + extras };
  });
  const bestExtra = deviceTiles.slice(1).reduce((best, cur) => {
    const perDev = cur.totalDevices > 0 ? cur.total / cur.totalDevices : Infinity;
    if (best == null || perDev < best.perDev) return { extras: cur.extras, perDev };
    return best;
  }, null as { extras: number; perDev: number } | null);

  const { extrasTotal: appliedExtras, pct: appliedPct } = applyExtrasPrice(pricePerExtra, selectedExtraDevices, tiers, selectedDays);
  const finalTotal = unitPrice + appliedExtras;
  // Базовая сумма без скидки = pricePerExtra × extras × коэффициент длительности (для отображения «сэкономлено»).
  const baseExtrasNoDiscount = pricePerExtra * selectedExtraDevices * (selectedDays / EXTRA_DEVICE_BASE_DAYS);
  const savedAmount = baseExtrasNoDiscount - appliedExtras;

  return (
    <Dialog open={!!modal} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-background/85 backdrop-blur-3xl border-white/10 rounded-[2rem] sm:max-w-lg max-h-[92vh] overflow-y-auto overflow-x-hidden">
        <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-gradient-to-br from-primary/30 via-fuchsia-500/15 to-purple-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-16 h-52 w-52 rounded-full bg-gradient-to-tr from-cyan-500/15 to-primary/15 blur-3xl pointer-events-none" />

        <DialogHeader className="relative">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: [0, -6, 6, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 4 }}
              className="h-14 w-14 rounded-3xl bg-gradient-to-br from-primary/30 via-fuchsia-500/20 to-purple-500/30 border border-white/15 flex items-center justify-center shadow-xl shrink-0"
            >
              <Package className="h-7 w-7 text-primary" />
            </motion.div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500">
                {tariff.name}
              </DialogTitle>
              {tariff.description && (
                <DialogDescription className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {tariff.description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="relative space-y-5 mt-2">
          {/* ── 1. Длительность ── */}
          {opts.length > 0 && (
            <section>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2.5 block">
                <Calendar className="inline h-3 w-3 mr-1" /> Длительность
              </Label>
              <div className={cn(
                "grid gap-2",
                opts.length === 1 ? "grid-cols-1" : opts.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"
              )}>
                {opts.map((opt) => {
                  const isActive = (selectedOpt?.id ?? opts[0]?.id) === opt.id;
                  const isBest = opt.id === bestDurationId;
                  const perDay = opt.durationDays > 0 ? opt.price / opt.durationDays : 0;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelectedPriceOptionId(opt.id)}
                      className={cn(
                        "relative overflow-hidden rounded-2xl border p-3 transition-all text-center",
                        "hover:scale-[1.03] hover:shadow-lg",
                        isActive
                          ? "bg-gradient-to-br from-primary/25 via-fuchsia-500/10 to-purple-500/15 border-primary/50 ring-2 ring-primary/40 shadow-lg shadow-primary/20"
                          : "bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 hover:border-white/20"
                      )}
                    >
                      {isBest && (
                        <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-md bg-amber-500 text-white text-[9px] font-black shadow">
                          ★
                        </span>
                      )}
                      <p className={cn("text-sm font-bold", isActive && "text-primary")}>
                        {opt.durationDays} {formatRuDays(opt.durationDays).replace(/^\d+\s/, "")}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                        {formatMoney(Math.round(perDay * 100) / 100, tariff.currency)}/день
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 2. Доп. устройства (только если включены в тарифе) ── */}
          {extrasEnabled && (
            <section>
              <div className="flex items-center justify-between mb-2.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <Smartphone className="inline h-3 w-3 mr-1" /> Доп. устройства
                </Label>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  В тарифе: <strong className="text-foreground">{includedDevices}</strong>
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {deviceTiles.map((tile) => {
                  const isActive = tile.extras === selectedExtraDevices;
                  const isBest = bestExtra?.extras === tile.extras && tile.extras > 0 && tile.pct === 0;
                  return (
                    <motion.button
                      key={tile.extras}
                      type="button"
                      onClick={() => setSelectedExtraDevices(tile.extras)}
                      whileTap={{ scale: 0.96 }}
                      className={cn(
                        "relative overflow-hidden rounded-2xl border p-3 transition-all",
                        "hover:scale-[1.04] hover:shadow-lg",
                        isActive
                          ? "bg-gradient-to-br from-primary/25 via-fuchsia-500/15 to-purple-500/20 border-primary/50 ring-2 ring-primary/40 shadow-lg shadow-primary/20"
                          : tile.pct > 0
                            ? "bg-gradient-to-br from-emerald-500/[0.06] to-cyan-500/[0.04] border-emerald-500/25 hover:border-emerald-500/40"
                            : "bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 hover:border-white/20"
                      )}
                    >
                      {tile.pct > 0 && (
                        <div className={cn(
                          "absolute -top-1 -right-1 px-1.5 py-0.5 rounded-md text-[9px] font-black shadow z-10",
                          isActive ? "bg-fuchsia-500 text-white" : "bg-emerald-500 text-white"
                        )}>
                          −{tile.pct}%
                        </div>
                      )}
                      {isBest && (
                        <Sparkles className="absolute top-1.5 right-1.5 h-3 w-3 text-fuchsia-500" />
                      )}
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Smartphone className={cn("h-3.5 w-3.5", isActive ? "text-primary" : "text-muted-foreground")} />
                        <span className={cn("text-sm font-bold", isActive && "text-primary")}>
                          {tile.extras === 0 ? "Без доп." : `+${tile.extras}`}
                        </span>
                      </div>
                      <p className="text-[11px] font-bold text-foreground/90 tabular-nums text-center">
                        {formatMoney(tile.total, tariff.currency)}
                      </p>
                      <p className="text-[9px] text-muted-foreground/80 text-center mt-0.5">
                        {tile.totalDevices} устр
                      </p>
                      {isBest && (
                        <p className="text-[9px] font-medium text-fuchsia-500 dark:text-fuchsia-400 text-center mt-0.5">
                          выгоднее всего
                        </p>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 3. Итог ── */}
          <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-fuchsia-500/[0.04] to-purple-500/[0.06] p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs text-muted-foreground">Длительность</span>
              <span className="text-xs font-medium tabular-nums">
                {selectedOpt?.durationDays ?? 0} {formatRuDays(selectedOpt?.durationDays ?? 0).replace(/^\d+\s/, "")}
              </span>
            </div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs text-muted-foreground">Тариф ({includedDevices} устр)</span>
              <span className="text-xs font-medium tabular-nums">
                {formatMoney(unitPrice, tariff.currency)}
              </span>
            </div>
            {extrasEnabled && selectedExtraDevices > 0 && (
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs text-muted-foreground">+{selectedExtraDevices} доп. устр</span>
                <span className="text-xs font-medium tabular-nums">
                  {formatMoney(pricePerExtra * (selectedDays / EXTRA_DEVICE_BASE_DAYS), tariff.currency)} × {selectedExtraDevices}
                </span>
              </div>
            )}
            {savedAmount > 0 && (
              <div className="flex items-baseline justify-between mb-1 text-emerald-500 dark:text-emerald-400">
                <span className="text-xs flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Скидка {appliedPct}%
                </span>
                <span className="text-xs font-bold tabular-nums">
                  −{formatMoney(savedAmount, tariff.currency)}
                </span>
              </div>
            )}
            <div className="border-t border-primary/20 mt-2 pt-2 flex items-baseline justify-between">
              <span className="text-sm font-medium">К оплате</span>
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={finalTotal}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-primary to-fuchsia-500 tabular-nums"
                >
                  {formatMoney(finalTotal, tariff.currency)}
                </motion.span>
              </AnimatePresence>
            </div>
          </section>
        </div>

        <DialogFooter className="relative mt-4 gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={onClose} className="rounded-xl">
            Отмена
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!selectedOpt}
            className="rounded-xl gap-2 h-11 px-6 text-base font-bold bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500 hover:from-primary/90 hover:via-fuchsia-500/90 hover:to-purple-500/90 shadow-lg shadow-primary/30"
          >
            <CreditCard className="h-4 w-4" />
            К оплате
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
