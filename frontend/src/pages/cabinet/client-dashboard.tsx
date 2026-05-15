import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthDashboard } from "@/pages/cabinet/stealth/stealth-dashboard";
import {
  
  Package,
  Wallet,
  Wifi,
  Calendar,
  
  
  ArrowRight,
  PlusCircle,
  
  Copy,
  Check,
  Gift,
  Loader2,
  Users,
  
  AlertCircle,
  Zap,
  Smartphone,
  Tag,
  X,
  RotateCcw,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { api } from "@/lib/api";
import { formatRuDays } from "@/lib/i18n";
import type { ClientPayment, ClientReferralStats } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";


function formatDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + " ГБ";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + " МБ";
  return (bytes / 1024).toFixed(0) + " КБ";
}


function getSubscriptionPayload(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const raw = sub as Record<string, unknown>;
  if (raw.response && typeof raw.response === "object") return raw.response as Record<string, unknown>;
  if (raw.data && typeof raw.data === "object") {
    const d = raw.data as Record<string, unknown>;
    if (d.response && typeof d.response === "object") return d.response as Record<string, unknown>;
  }
  return raw;
}

function parseSubscription(sub: unknown): {
  status?: string;
  expireAt?: string;
  trafficUsed?: number;
  trafficLimitBytes?: number;
  hwidDeviceLimit?: number;
  subscriptionUrl?: string;
  productName?: string;
} {
  const o = getSubscriptionPayload(sub);
  if (!o) return {};
  const userTraffic = o.userTraffic && typeof o.userTraffic === "object" ? (o.userTraffic as Record<string, unknown>) : null;
  const usedBytes = userTraffic != null && typeof userTraffic.usedTrafficBytes === "number"
    ? userTraffic.usedTrafficBytes
    : typeof o.trafficUsed === "number"
      ? o.trafficUsed
      : undefined;
  const subUrl = typeof o.subscriptionUrl === "string" ? o.subscriptionUrl : undefined;
  const productName = typeof o.productName === "string" ? o.productName.trim() : undefined;
  const subscriptionProductName = typeof (o as Record<string, unknown>).subscriptionProductName === "string" ? (o as Record<string, unknown>).subscriptionProductName as string : undefined;
  return {
    status: typeof o.status === "string" ? o.status : undefined,
    expireAt: typeof o.expireAt === "string" ? o.expireAt : undefined,
    trafficUsed: usedBytes,
    trafficLimitBytes: typeof o.trafficLimitBytes === "number" ? o.trafficLimitBytes : undefined,
    hwidDeviceLimit: typeof o.hwidDeviceLimit === "number" ? o.hwidDeviceLimit : (o.hwidDeviceLimit != null ? Number(o.hwidDeviceLimit) : undefined),
    subscriptionUrl: subUrl?.trim() || undefined,
    productName: productName || subscriptionProductName || undefined,
  };
}

/**
 * Wrapper: switcher между Classic-версией главной и новым Stealth-дизайном.
 * Делается тонким wrapper'ом, чтобы не нарушать правила хуков (хуки реальной
 * страницы вызываются только в той ветке которую рендерим).
 */
export function ClientDashboardPage() {
  const design = useCabinetDesign();
  if (design === "stealth") return <StealthDashboard />;
  return <ClassicDashboardPage />;
}

function ClassicDashboardPage() {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscription, setSubscription] = useState<unknown>(null);
  const [secondarySubscriptions, setSecondarySubscriptions] = useState<Array<{ type: string; id: string; subscriptionIndex: number | null; subscription: unknown; tariffDisplayName: string; remnawaveUuid: string | null }>>([]);
  const [tariffDisplayName, setTariffDisplayName] = useState<string | null>(null);
  const [autoRenewNext, setAutoRenewNext] = useState<{ amount: number | null; at: string | null; currency: string | null }>({ amount: null, at: null, currency: null });
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [_payments, setPayments] = useState<ClientPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentMessage, setPaymentMessage] = useState<"success_topup" | "success_tariff" | "success" | "failed" | null>(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [_referralStats, setReferralStats] = useState<ClientReferralStats | null>(null);
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [autoRenewLoading, setAutoRenewLoading] = useState(false);

  const token = state.token;
  const isMiniapp = useCabinetMiniapp();
  const client = state.client;
  const trialDays = config?.trialDays ?? 0;

  useEffect(() => {
    const payment = searchParams.get("payment");
    const yoomoneyForm = searchParams.get("yoomoney_form");
    const paymentKind = searchParams.get("payment_kind");
    if (payment === "success") {
      if (paymentKind === "topup") setPaymentMessage("success_topup");
      else if (paymentKind === "tariff") setPaymentMessage("success_tariff");
      else setPaymentMessage("success");
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    } else if (payment === "failed") {
      setPaymentMessage("failed");
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    } else if (yoomoneyForm === "success") {
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    } else if (searchParams.get("yookassa") === "success") {
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    } else if (searchParams.get("heleket") === "success") {
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    }
  }, [searchParams, setSearchParams, token, refreshProfile]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setSubscriptionError(null);
    Promise.all([
      api.clientSubscription(token),
      api.clientPayments(token),
      api.getClientDevices(token).catch(() => ({ total: 0 })),
      api.clientAllSubscriptions(token).catch(() => ({ items: [] })),
    ])
      .then(([subRes, payRes, devRes, allSubRes]) => {
        if (cancelled) return;
        setSubscription(subRes.subscription ?? null);
        setTariffDisplayName(subRes.tariffDisplayName ?? null);
        setAutoRenewNext({
          amount: subRes.autoRenewNextChargeAmount ?? null,
          at: subRes.autoRenewNextChargeAt ?? null,
          currency: subRes.autoRenewCurrency ?? null,
        });
        if (subRes.message) setSubscriptionError(subRes.message);
        setPayments(payRes.items ?? []);
        setDeviceCount(devRes.total ?? null);
        setSecondarySubscriptions((allSubRes.items || []).filter(s => s.type === "secondary"));
      })
      .catch((e) => {
        if (!cancelled) setSubscriptionError(e instanceof Error ? e.message : t("cabinet.dashboard.error_loading"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  useEffect(() => {
    if (!token || !isMiniapp) return;
    api.getClientReferralStats(token).then(setReferralStats).catch(() => {});
  }, [token, isMiniapp]);

  // Auto-redeem pending gift code (saved by /gift/:code page before redirect to login/register)
  const [giftRedeemMessage, setGiftRedeemMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!token || loading) return;
    const pendingCode = localStorage.getItem("stealthnet_pending_gift");
    if (!pendingCode) return;
    localStorage.removeItem("stealthnet_pending_gift");
    api.giftRedeemCode(token, pendingCode)
      .then((res) => {
        setGiftRedeemMessage({ type: "success", text: res.message || "Подарок активирован!" });
        setRefreshKey((k) => k + 1);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Не удалось активировать подарок";
        setGiftRedeemMessage({ type: "error", text: msg });
      });
  }, [token, loading]);

  async function toggleAutoRenew(enabled: boolean) {
    if (!token || !client) return;
    setAutoRenewLoading(true);
    try {
      await api.clientUpdateAutoRenew(token, { enabled });
      await refreshProfile();
    } catch (err) {
      console.error("Failed to toggle auto-renew", err);
    } finally {
      setAutoRenewLoading(false);
    }
  }

  const [autoRenewPromoInput, setAutoRenewPromoInput] = useState("");
  const [autoRenewPromoLoading, setAutoRenewPromoLoading] = useState(false);
  const [autoRenewPromoError, setAutoRenewPromoError] = useState<string | null>(null);
  const [autoRenewPromoSaved, setAutoRenewPromoSaved] = useState(false);

  useEffect(() => {
    setAutoRenewPromoInput(client?.autoRenewPromoCode ?? "");
    setAutoRenewPromoError(null);
    setAutoRenewPromoSaved(false);
  }, [client?.autoRenewPromoCode]);

  async function saveAutoRenewPromo(code: string | null) {
    if (!token) return;
    setAutoRenewPromoError(null);
    setAutoRenewPromoSaved(false);
    setAutoRenewPromoLoading(true);
    try {
      await api.clientUpdateAutoRenew(token, { promoCode: code });
      await refreshProfile();
      setAutoRenewPromoSaved(true);
      setTimeout(() => setAutoRenewPromoSaved(false), 2000);
    } catch (e) {
      setAutoRenewPromoError(e instanceof Error ? e.message : t("cabinet.dashboard.auto_renew_promo_error"));
    } finally {
      setAutoRenewPromoLoading(false);
    }
  }

  async function activateTrial() {
    if (!token) return;
    setTrialError(null);
    setTrialLoading(true);
    try {
      await api.clientActivateTrial(token);
      await refreshProfile();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setTrialError(e instanceof Error ? e.message : t("cabinet.dashboard.trial_error"));
    } finally {
      setTrialLoading(false);
    }
  }

  if (!client) return null;

  const subParsed = parseSubscription(subscription);
  const hasActiveSubscription =
    subscription && typeof subscription === "object" && (subParsed.status === "ACTIVE" || subParsed.status === undefined);
  const vpnUrl = subParsed.subscriptionUrl || null;
  // Триал предлагаем только если подписки нет (vpnUrl пуст) и юзер ещё не использовал триал.
  // Без проверки vpnUrl кнопка триала висела даже после покупки тарифа.
  const showTrial = config?.trialEnabled && !client?.trialUsed && !vpnUrl;
  const [referralCopied, setReferralCopied] = useState<"site" | "bot" | null>(null);
  const siteOrigin = config?.publicAppUrl?.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  const referralLinkSite =
    client.referralCode && siteOrigin
      ? `${siteOrigin}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}`
      : "";
  const referralLinkBot =
    client.referralCode && config?.telegramBotUsername
      ? `https://t.me/${config.telegramBotUsername.replace(/^@/, "")}?start=ref_${client.referralCode}`
      : "";
  const hasReferralLinks = Boolean(referralLinkSite || referralLinkBot);
  const copyReferral = (which: "site" | "bot") => {
    const url = which === "site" ? referralLinkSite : referralLinkBot;
    if (url) {
      navigator.clipboard.writeText(url);
      setReferralCopied(which);
      setTimeout(() => setReferralCopied(null), 2000);
    }
  };
  const trafficPercent = subParsed.trafficLimitBytes != null && subParsed.trafficLimitBytes > 0 && subParsed.trafficUsed != null
    ? Math.min(100, Math.round((subParsed.trafficUsed / subParsed.trafficLimitBytes) * 100))
    : null;

  const expireDate = subParsed.expireAt ? (() => { try { const d = new Date(subParsed.expireAt); return Number.isNaN(d.getTime()) ? null : d; } catch { return null; } })() : null;
  const daysLeft = expireDate && expireDate > new Date()
    ? Math.max(0, Math.ceil((expireDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  // Компонент-состояние отсутствия подписки
  const NoSubscriptionState = () => (
    <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Package className="h-8 w-8 text-primary/70" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-foreground">{t("cabinet.dashboard.no_subscription_title")}</h3>
        <p className="text-[14px] text-muted-foreground max-w-xs mt-2 mx-auto leading-relaxed">
          {t("cabinet.dashboard.no_subscription_desc")}
        </p>
      </div>
      <Button className="mt-2 shadow-lg h-11 px-6 rounded-xl hover:scale-105 transition-transform duration-300 [&_svg]:self-center [&_span]:leading-none" asChild>
        <Link to="/cabinet/tariffs" className="inline-flex items-center justify-center gap-2">
          <span className="inline-flex items-center leading-none">{t("cabinet.dashboard.choose_tariff")}</span>
        </Link>
      </Button>
    </div>
  );

  if (isMiniapp) {
    return (
      <div className="w-full min-w-0 overflow-hidden space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {(paymentMessage === "success" || paymentMessage === "success_topup" || paymentMessage === "success_tariff") && (
          <div className="rounded-xl bg-green-500/15 backdrop-blur-md border border-green-500/30 px-4 py-3 text-sm font-medium text-green-700 dark:text-green-400 shadow-sm">
            {paymentMessage === "success_topup"
              ? "Оплата прошла успешно. Баланс пополнен."
              : paymentMessage === "success_tariff"
                ? "Оплата прошла успешно. Тариф активируется автоматически."
                : "Оплата прошла успешно. Статус обновляется автоматически."}
          </div>
        )}
        {paymentMessage === "failed" && (
          <div className="rounded-xl bg-destructive/15 backdrop-blur-md border border-destructive/30 px-4 py-3 text-sm font-medium text-destructive shadow-sm">
            Оплата не прошла. Попробуйте снова.
          </div>
        )}
        {giftRedeemMessage && (
          <div className={`rounded-xl backdrop-blur-md px-4 py-3 text-sm font-medium shadow-sm ${giftRedeemMessage.type === "success" ? "bg-green-500/15 border border-green-500/30 text-green-700 dark:text-green-400" : "bg-destructive/15 border border-destructive/30 text-destructive"}`}>
            {giftRedeemMessage.type === "success" ? "🎁 " : "❌ "}{giftRedeemMessage.text}
          </div>
        )}

        {config?.botInfoBlock?.trim() && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 backdrop-blur-md px-4 py-3 text-sm whitespace-pre-line shadow-sm">
            {config.botInfoBlock.trim()}
          </div>
        )}

        {/* 1. Статус, срок, тариф, трафик, устройства — с иконками */}
        <section data-tour="subscription" className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl p-5 shadow-sm overflow-hidden transition-all duration-300">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-5">
            <div className="p-1.5 bg-primary/20 rounded-lg">
              <Zap className="h-4 w-4 shrink-0 text-primary" />
            </div>
            {t("cabinet.dashboard.subscription_status")}
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
            </div>
          ) : subscriptionError || !hasActiveSubscription ? (
            <NoSubscriptionState />
          ) : (
            <div className="space-y-4 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-green-500/20 text-green-700 dark:text-green-400 border border-green-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {t("cabinet.dashboard.active")}
                </span>
                {daysLeft != null && (
                  <span className="text-sm font-semibold text-foreground bg-foreground/5 px-3 py-1.5 rounded-full border border-border/50">
                    {t("cabinet.dashboard.days_left")} {daysLeft} {daysLeft === 1 ? t("cabinet.common.day_one") : daysLeft < 5 ? t("cabinet.common.day_few") : t("cabinet.common.day_many")}
                  </span>
                )}
                {subParsed.hwidDeviceLimit != null && subParsed.hwidDeviceLimit > 0 && deviceCount != null && (
                  <span className="text-sm font-semibold text-foreground bg-primary/10 text-primary px-3 py-1.5 rounded-full border border-primary/20 flex items-center gap-1.5">
                    <Smartphone className="h-4 w-4" /> {deviceCount} / {subParsed.hwidDeviceLimit}
                  </span>
                )}
              </div>

              <div className="space-y-3 border-t border-border/50 pt-4 mt-2">
                {((tariffDisplayName ?? subParsed.productName) || client?.trialUsed) && (
                  <div className="flex items-center gap-4 bg-background/40 p-3.5 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Package className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.tariff_label")}</p>
                      <p className="text-[14px] font-semibold truncate text-foreground" title={((tariffDisplayName ?? subParsed.productName?.trim() ?? "").trim()) || t("cabinet.dashboard.test_label")}>
                        {((tariffDisplayName ?? subParsed.productName?.trim() ?? "").trim()) || t("cabinet.dashboard.test_label")}
                      </p>
                    </div>
                  </div>
                )}
                {subParsed.expireAt && (
                  <div className="flex items-center gap-4 bg-background/40 p-3.5 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.valid_until")}</p>
                      <p className="text-[14px] font-semibold text-foreground">
                        {formatDate(subParsed.expireAt)}
                      </p>
                    </div>
                  </div>
                )}
                <div className="bg-background/40 p-3.5 rounded-2xl border border-border/50 space-y-3 transition-colors hover:bg-background/60 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Wifi className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.traffic")}</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[14px] font-semibold text-foreground">
                          {subParsed.trafficLimitBytes != null && subParsed.trafficLimitBytes > 0
                            ? `${formatBytes(subParsed.trafficUsed ?? 0)} / ${formatBytes(subParsed.trafficLimitBytes)}`
                            : t("cabinet.dashboard.unlimited")}
                        </p>
                        {trafficPercent != null && <span className="text-[12px] font-bold text-muted-foreground">{trafficPercent}%</span>}
                      </div>
                    </div>
                  </div>
                  {trafficPercent != null && (
                    <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500 ease-in-out" style={{ width: `${trafficPercent}%` }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {secondarySubscriptions.length > 0 && secondarySubscriptions.map((sec) => {
          const secParsed = parseSubscription(sec.subscription);
          const secHasActive = sec.subscription && typeof sec.subscription === "object" && (secParsed.status === "ACTIVE" || secParsed.status === undefined);
          const secExpireDate = secParsed.expireAt ? new Date(secParsed.expireAt) : null;
          const secDaysLeft = secExpireDate && secExpireDate > new Date() ? Math.max(0, Math.ceil((secExpireDate.getTime() - Date.now()) / (24*60*60*1000))) : null;
          const secTrafficPercent = secParsed.trafficLimitBytes && secParsed.trafficLimitBytes > 0 && secParsed.trafficUsed != null ? Math.min(100, Math.round((secParsed.trafficUsed / secParsed.trafficLimitBytes) * 100)) : null;

          return (
            <section key={sec.id} className="rounded-3xl border border-indigo-500/30 bg-card/40 backdrop-blur-xl p-5 shadow-sm overflow-hidden transition-all duration-300">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-4">
                <div className="p-1.5 bg-indigo-500/20 rounded-lg">
                  <Package className="h-4 w-4 shrink-0 text-indigo-400" />
                </div>
                Дополнительная подписка #{sec.subscriptionIndex ?? ""}
              </h2>
              
              <div className="space-y-4 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {secHasActive ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      Активна
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-muted/30 text-muted-foreground border border-border/50">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      Неактивна
                    </span>
                  )}
                  {secDaysLeft != null && (
                    <span className="text-sm font-semibold text-foreground bg-foreground/5 px-3 py-1.5 rounded-full border border-border/50">
                      {t("cabinet.dashboard.days_left")} {secDaysLeft} {secDaysLeft === 1 ? t("cabinet.common.day_one") : secDaysLeft < 5 ? t("cabinet.common.day_few") : t("cabinet.common.day_many")}
                    </span>
                  )}
                  {secParsed.hwidDeviceLimit != null && secParsed.hwidDeviceLimit > 0 && (
                    <span className="text-sm font-semibold text-foreground bg-indigo-500/10 text-indigo-400 px-3 py-1.5 rounded-full border border-indigo-500/20 flex items-center gap-1.5">
                      <Smartphone className="h-4 w-4" /> {secParsed.hwidDeviceLimit}
                    </span>
                  )}
                </div>

                <div className="space-y-3 border-t border-border/50 pt-4 mt-2">
                  {sec.tariffDisplayName && (
                    <div className="flex items-center gap-4 bg-background/40 p-3.5 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                        <Package className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.tariff_label")}</p>
                        <p className="text-[14px] font-semibold truncate text-foreground" title={sec.tariffDisplayName}>
                          {sec.tariffDisplayName}
                        </p>
                      </div>
                    </div>
                  )}
                  {secParsed.expireAt && (
                    <div className="flex items-center gap-4 bg-background/40 p-3.5 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                        <Calendar className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.valid_until")}</p>
                        <p className="text-[14px] font-semibold text-foreground">
                          {formatDate(secParsed.expireAt)}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="bg-background/40 p-3.5 rounded-2xl border border-border/50 space-y-3 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                        <Wifi className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.traffic")}</p>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[14px] font-semibold text-foreground">
                            {secParsed.trafficLimitBytes != null && secParsed.trafficLimitBytes > 0
                              ? `${formatBytes(secParsed.trafficUsed ?? 0)} / ${formatBytes(secParsed.trafficLimitBytes)}`
                              : t("cabinet.dashboard.unlimited")}
                          </p>
                          {secTrafficPercent != null && <span className="text-[12px] font-bold text-muted-foreground">{secTrafficPercent}%</span>}
                        </div>
                      </div>
                    </div>
                    {secTrafficPercent != null && (
                      <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500 transition-all duration-500 ease-in-out" style={{ width: `${secTrafficPercent}%` }} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-2">
                  <Button className="w-full gap-2 shadow-lg h-12 rounded-xl text-md hover:scale-[1.02] transition-transform duration-300 [&_svg]:self-center [&_span]:leading-none bg-indigo-600 hover:bg-indigo-700 text-white" asChild>
                    <Link to={`/cabinet/subscribe?uuid=${sec.remnawaveUuid}`} className="inline-flex w-full items-center justify-center gap-2">
                      <Wifi className="h-5 w-5 shrink-0" />
                      <span className="inline-flex items-center leading-none">Подключиться</span>
                    </Link>
                  </Button>
                </div>
              </div>
            </section>
          );
        })}

        {/* 2. Как подключиться — ссылка и кнопка */}
        <section className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl p-5 shadow-sm overflow-hidden transition-all duration-300">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-4">
             <div className="p-1.5 bg-primary/20 rounded-lg">
              <Wifi className="h-4 w-4 shrink-0 text-primary" />
            </div>
            {t("cabinet.dashboard.connection")}
          </h2>
          {vpnUrl ? (
            <div className="space-y-4">
              <p className="text-[14px] text-muted-foreground leading-relaxed">{t("cabinet.dashboard.connection_desc")}</p>
              <div className="flex gap-2 min-w-0">
                <code className="flex-1 min-w-0 truncate rounded-xl bg-background/50 border border-border/50 px-3 py-2.5 text-xs font-mono flex items-center text-foreground/80" title={vpnUrl}>
                  {vpnUrl}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0 h-auto w-11 rounded-xl bg-background/50 hover:bg-background/80 transition-transform hover:scale-105"
                  onClick={() => {
                    navigator.clipboard.writeText(vpnUrl);
                    window.Telegram?.WebApp?.showPopup?.({ title: t("cabinet.dashboard.copied_title"), message: t("cabinet.dashboard.copied_message") });
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button className="w-full gap-2 shadow-lg h-12 rounded-xl text-md hover:scale-[1.02] transition-transform duration-300 [&_svg]:self-center [&_span]:leading-none" asChild>
                <Link to="/cabinet/subscribe" className="inline-flex w-full items-center justify-center gap-2">
                  <Wifi className="h-5 w-5 shrink-0" />
                  <span className="inline-flex items-center leading-none">{t("cabinet.dashboard.connect_vpn")}</span>
                </Link>
              </Button>
            </div>
          ) : showTrial ? (
            <div className="space-y-4 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-600 mb-2">
                 <Gift className="h-6 w-6" />
              </div>
              <p className="text-[14px] text-muted-foreground">
                {t("cabinet.dashboard.free_trial_desc")} {formatRuDays(trialDays)}.
              </p>
              <Button className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white shadow-lg h-12 rounded-xl hover:scale-[1.02] transition-transform duration-300 [&_svg]:self-center [&_span]:leading-none" onClick={activateTrial} disabled={trialLoading}>
                {trialLoading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Gift className="h-5 w-5 shrink-0" />}
                <span className="inline-flex items-center leading-none font-medium text-base">{t("cabinet.dashboard.free_trial")}</span>
              </Button>
              {trialError && <p className="text-sm text-destructive break-words text-center">{trialError}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20 text-[14px] text-primary flex gap-3 items-start">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{t("cabinet.dashboard.link_after_payment")}</p>
              </div>
              <Button className="w-full shadow-md rounded-xl hover:scale-[1.02] transition-transform duration-300 h-12 [&_svg]:self-center [&_span]:leading-none" variant="default" asChild>
                <Link to="/cabinet/tariffs" className="inline-flex w-full items-center justify-center gap-2">
                  <span className="inline-flex items-center leading-none">{t("cabinet.dashboard.choose_tariff")}</span>
                </Link>
              </Button>
            </div>
          )}
        </section>

        {/* 3. Баланс */}
        <section data-tour="balance" className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl p-5 shadow-sm overflow-hidden transition-all duration-300 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/20 rounded-xl">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/80">{t("cabinet.dashboard.my_balance")}</h2>
              <p className="text-2xl font-bold tracking-tight text-foreground leading-none mt-1">{formatMoney(client.balance, client.preferredCurrency)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between p-3 rounded-2xl bg-background/40 border border-border/50">
            <div className="flex flex-col min-w-0">
              <Label className="text-sm font-semibold">{t("cabinet.dashboard.auto_renew")}</Label>
              {client.autoRenewEnabled && autoRenewNext.amount != null ? (
                <span className="text-[11px] mt-0.5 leading-tight inline-flex items-center gap-1 truncate">
                  <RotateCcw className="h-3 w-3 text-primary shrink-0" />
                  <span className="font-bold tabular-nums text-foreground">
                    {autoRenewNext.amount.toLocaleString("ru-RU")} {autoRenewNext.currency === "RUB" ? "₽" : autoRenewNext.currency === "USD" ? "$" : autoRenewNext.currency}
                  </span>
                  {autoRenewNext.at && (
                    <span className="text-muted-foreground">
                      · {new Date(autoRenewNext.at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                  {config?.yookassaRecurringEnabled
                    ? <>Сначала с баланса{client.yookassaPaymentMethodTitle ? <>, затем с карты <span className="font-medium">{client.yookassaPaymentMethodTitle}</span></> : ", затем с карты"}</>
                    : "Списание с баланса"
                  }
                </span>
              )}
            </div>
            <Switch
              checked={client.autoRenewEnabled ?? false}
              disabled={autoRenewLoading}
              onCheckedChange={toggleAutoRenew}
            />
          </div>
          {client.autoRenewEnabled && (
            <div className="flex items-center gap-2 p-2.5 pl-3 rounded-2xl bg-background/40 border border-border/50">
              <Tag className="h-4 w-4 text-primary shrink-0" />
              <Input
                value={autoRenewPromoInput}
                onChange={(e) => { setAutoRenewPromoInput(e.target.value.toUpperCase()); setAutoRenewPromoError(null); setAutoRenewPromoSaved(false); }}
                placeholder={t("cabinet.dashboard.auto_renew_promo_placeholder")}
                className="h-8 bg-transparent border-0 px-0 text-sm font-mono uppercase focus-visible:ring-0 placeholder:text-muted-foreground/60 shadow-none"
                disabled={autoRenewPromoLoading}
                title={t("cabinet.dashboard.auto_renew_promo_hint")}
              />
              {autoRenewPromoLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              ) : autoRenewPromoSaved ? (
                <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
              ) : client.autoRenewPromoCode && autoRenewPromoInput === client.autoRenewPromoCode ? (
                <button
                  type="button"
                  onClick={() => saveAutoRenewPromo(null)}
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                  title={t("cabinet.dashboard.auto_renew_promo_remove")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!autoRenewPromoInput.trim()}
                  onClick={() => saveAutoRenewPromo(autoRenewPromoInput.trim())}
                  className="h-7 px-3 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-primary/15 hover:bg-primary/25 text-primary disabled:opacity-40 disabled:hover:bg-primary/15 transition-colors shrink-0"
                >
                  {t("cabinet.dashboard.auto_renew_promo_save")}
                </button>
              )}
            </div>
          )}
          {client.autoRenewEnabled && autoRenewPromoError && (
            <p className="text-[11px] font-medium text-red-500 dark:text-red-400 -mt-2">{autoRenewPromoError}</p>
          )}
          <Button className="w-full gap-2 shadow-md hover:scale-[1.02] transition-transform duration-300 rounded-xl h-12 [&_svg]:self-center [&_span]:leading-none" asChild>
            <Link to="/cabinet/profile#topup" className="inline-flex w-full items-center justify-center gap-2">
              <PlusCircle className="h-5 w-5 shrink-0" />
              <span className="inline-flex items-center leading-none">{t("cabinet.dashboard.top_up")}</span>
            </Link>
          </Button>
        </section>
      </div>
    );
  }

  // DESKTOP LAYOUT
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      {/* Hero + CTA */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-3xl bg-card/40 backdrop-blur-2xl border border-border/50 p-8 sm:p-10 shadow-xl"
      >
        {/* Декоративное свечение */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-primary/20 blur-[80px] pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
              {t("cabinet.dashboard.welcome")}{client.email ? `, ${client.email.split("@")[0]}` : client.telegramUsername ? `, @${client.telegramUsername}` : ""}
            </h1>
            <p className="mt-3 text-[16px] text-muted-foreground max-w-xl leading-relaxed">
              {hasActiveSubscription
                ? t("cabinet.dashboard.sub_active_desc")
                : t("cabinet.dashboard.sub_inactive_desc")}
            </p>
            
            {(paymentMessage === "success" || paymentMessage === "success_topup" || paymentMessage === "success_tariff") && (
              <div className="mt-4 inline-flex items-center gap-2 bg-green-500/15 border border-green-500/30 px-4 py-2 rounded-xl text-green-700 dark:text-green-400 font-medium text-sm">
                <Check className="h-4 w-4" />
                {t("cabinet.dashboard.payment_success")}
              </div>
            )}
            {paymentMessage === "failed" && (
              <div className="mt-4 inline-flex items-center gap-2 bg-destructive/15 border border-destructive/30 px-4 py-2 rounded-xl text-destructive font-medium text-sm">
                <AlertCircle className="h-4 w-4" />
                {t("cabinet.dashboard.payment_failed")}
              </div>
            )}
            {giftRedeemMessage && (
              <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm ${giftRedeemMessage.type === "success" ? "bg-green-500/15 border border-green-500/30 text-green-700 dark:text-green-400" : "bg-destructive/15 border border-destructive/30 text-destructive"}`}>
                {giftRedeemMessage.type === "success" ? "🎁" : "❌"} {giftRedeemMessage.text}
              </div>
            )}
            {trialError && <p className="mt-3 text-sm text-destructive font-medium">{trialError}</p>}
          </div>

          <div className="flex flex-col sm:flex-row md:flex-col gap-3 shrink-0 min-w-[240px]">
            {showTrial ? (
              <Button size="lg" className="w-full gap-2 shadow-xl bg-green-600 hover:bg-green-700 text-white rounded-xl h-14 hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none" onClick={activateTrial} disabled={trialLoading}>
                {trialLoading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Gift className="h-5 w-5 shrink-0" />}
                <span className="inline-flex items-center text-base font-medium leading-none">{t("cabinet.dashboard.free_trial")}</span>
              </Button>
            ) : vpnUrl ? (
              <Button size="lg" className="w-full gap-2 shadow-xl rounded-xl h-14 hover:scale-105 transition-transform bg-primary text-primary-foreground [&_svg]:self-center [&_span]:leading-none" asChild>
                <Link to="/cabinet/subscribe" className="inline-flex items-center justify-center gap-2 leading-none">
                  <Wifi className="h-5 w-5 shrink-0" />
                  <span className="inline-flex items-center text-base font-medium leading-none">{t("cabinet.dashboard.connect_vpn")}</span>
                </Link>
              </Button>
            ) : (
              <Button size="lg" variant="default" className="w-full gap-2 shadow-xl rounded-xl h-14 hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none" asChild>
                <Link to="/cabinet/tariffs" className="inline-flex items-center justify-center gap-2 leading-none">
                  <Package className="h-5 w-5 shrink-0" />
                  <span className="inline-flex items-center text-base font-medium leading-none">{t("cabinet.dashboard.choose_tariff")}</span>
                </Link>
              </Button>
            )}
            <Button variant="secondary" size="lg" className="w-full gap-2 rounded-xl h-14 hover:scale-105 transition-transform bg-background/50 hover:bg-background/80 border border-border/50 [&_svg]:self-center [&_span]:leading-none" asChild>
              <Link to="/cabinet/profile#topup" className="inline-flex items-center justify-center gap-2 leading-none">
                <PlusCircle className="h-5 w-5 shrink-0 text-foreground/70" />
                <span className="inline-flex items-center text-base font-medium leading-none">{t("cabinet.dashboard.top_up")}</span>
              </Link>
            </Button>
          </div>
        </div>
      </motion.section>

      {config?.botInfoBlock?.trim() && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 backdrop-blur-md px-5 py-4 text-sm whitespace-pre-line shadow-sm">
          {config.botInfoBlock.trim()}
        </div>
      )}

      {/* Cards grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Подписка / тариф */}
        <Card data-tour="subscription" className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 sm:col-span-2 lg:col-span-1 flex flex-col">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-3 text-xl text-foreground">
              <div className="p-2.5 bg-primary/20 rounded-xl">
                <Package className="h-6 w-6 text-primary" />
              </div>
              {t("cabinet.dashboard.my_subscription")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-center">
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : subscriptionError || !hasActiveSubscription ? (
              <NoSubscriptionState />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {t("cabinet.dashboard.active")}
                  </span>
                  {daysLeft != null && (
                    <span className="text-sm font-semibold text-foreground bg-foreground/5 px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
                      {daysLeft} {daysLeft === 1 ? t("cabinet.common.day_one") : daysLeft < 5 ? t("cabinet.common.day_few") : t("cabinet.common.day_many")}
                    </span>
                  )}
                  {subParsed.hwidDeviceLimit != null && subParsed.hwidDeviceLimit > 0 && deviceCount != null && (
                    <span className="text-sm font-semibold text-foreground bg-primary/10 text-primary px-3 py-1.5 rounded-full border border-primary/20 shadow-sm flex items-center gap-1.5">
                      <Smartphone className="h-4 w-4" /> {deviceCount} / {subParsed.hwidDeviceLimit}
                    </span>
                  )}
                </div>
                {((tariffDisplayName ?? subParsed.productName) || client?.trialUsed) && (
                  <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Package className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.tariff_label")}</p>
                      <p className="text-[15px] font-semibold truncate text-foreground">
                        {((tariffDisplayName ?? subParsed.productName?.trim() ?? "").trim()) || t("cabinet.dashboard.test_label")}
                      </p>
                    </div>
                  </div>
                )}
                {subParsed.expireAt && (
                  <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Calendar className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.valid_until")}</p>
                      <p className="text-[15px] font-semibold text-foreground">
                        {formatDate(subParsed.expireAt)}
                      </p>
                    </div>
                  </div>
                )}
                <div className="bg-background/40 p-4 rounded-2xl border border-border/50 space-y-3 transition-colors hover:bg-background/60 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Wifi className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.traffic")}</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[15px] font-semibold text-foreground">
                          {subParsed.trafficLimitBytes != null && subParsed.trafficLimitBytes > 0
                            ? `${formatBytes(subParsed.trafficUsed ?? 0)} / ${formatBytes(subParsed.trafficLimitBytes)}`
                            : t("cabinet.dashboard.unlimited")}
                        </p>
                        {trafficPercent != null && <span className="text-[13px] font-bold text-muted-foreground">{trafficPercent}%</span>}
                      </div>
                    </div>
                  </div>
                  {trafficPercent != null && (
                    <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500 ease-in-out" style={{ width: `${trafficPercent}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Баланс + пополнение */}
        <Card data-tour="balance" className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col justify-between">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-3 text-xl text-foreground">
              <div className="p-2.5 bg-primary/20 rounded-xl">
                <Wallet className="h-6 w-6 text-primary" />
              </div>
              {t("cabinet.dashboard.balance")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 flex-1 flex flex-col justify-center text-center">
            <div>
              <p className="text-5xl font-extrabold tracking-tight text-foreground drop-shadow-sm">
                {formatMoney(client.balance, client.preferredCurrency)}
              </p>
              <p className="text-[15px] text-muted-foreground mt-3">На счету для продления тарифов</p>
            </div>
            
            <div className="flex items-center justify-between p-4 rounded-2xl bg-background/40 border border-border/50 text-left">
              <div className="flex flex-col min-w-0">
                <Label className="text-[15px] font-semibold">{t("cabinet.dashboard.auto_renew")}</Label>
                {client.autoRenewEnabled && autoRenewNext.amount != null ? (
                  <span className="text-sm mt-0.5 inline-flex items-center gap-1.5 truncate">
                    <RotateCcw className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="font-bold tabular-nums text-foreground">
                      {autoRenewNext.amount.toLocaleString("ru-RU")} {autoRenewNext.currency === "RUB" ? "₽" : autoRenewNext.currency === "USD" ? "$" : autoRenewNext.currency}
                    </span>
                    {autoRenewNext.at && (
                      <span className="text-muted-foreground">
                        · {new Date(autoRenewNext.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground mt-0.5">
                    {config?.yookassaRecurringEnabled
                      ? <>Сначала с баланса{client.yookassaPaymentMethodTitle ? <>, затем с карты <span className="font-medium">{client.yookassaPaymentMethodTitle}</span></> : ", затем с карты"}</>
                      : "Списание с баланса"
                    }
                  </span>
                )}
              </div>
              <Switch
                checked={client.autoRenewEnabled ?? false}
                disabled={autoRenewLoading}
                onCheckedChange={toggleAutoRenew}
              />
            </div>

            {client.autoRenewEnabled && (
              <div className="flex items-center gap-2 p-3 pl-4 rounded-2xl bg-background/40 border border-border/50">
                <Tag className="h-4 w-4 text-primary shrink-0" />
                <Input
                  value={autoRenewPromoInput}
                  onChange={(e) => { setAutoRenewPromoInput(e.target.value.toUpperCase()); setAutoRenewPromoError(null); setAutoRenewPromoSaved(false); }}
                  placeholder={t("cabinet.dashboard.auto_renew_promo_placeholder")}
                  className="h-9 bg-transparent border-0 px-0 text-sm font-mono uppercase focus-visible:ring-0 placeholder:text-muted-foreground/60 shadow-none"
                  disabled={autoRenewPromoLoading}
                  title={t("cabinet.dashboard.auto_renew_promo_hint")}
                />
                {autoRenewPromoLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                ) : autoRenewPromoSaved ? (
                  <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                ) : client.autoRenewPromoCode && autoRenewPromoInput === client.autoRenewPromoCode ? (
                  <button
                    type="button"
                    onClick={() => saveAutoRenewPromo(null)}
                    className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                    title={t("cabinet.dashboard.auto_renew_promo_remove")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!autoRenewPromoInput.trim()}
                    onClick={() => saveAutoRenewPromo(autoRenewPromoInput.trim())}
                    className="h-7 px-3 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-primary/15 hover:bg-primary/25 text-primary disabled:opacity-40 disabled:hover:bg-primary/15 transition-colors shrink-0"
                  >
                    {t("cabinet.dashboard.auto_renew_promo_save")}
                  </button>
                )}
              </div>
            )}
            {client.autoRenewEnabled && autoRenewPromoError && (
              <p className="text-[11px] font-medium text-red-500 dark:text-red-400 -mt-2">{autoRenewPromoError}</p>
            )}

            <Button variant="default" size="lg" className="w-full gap-2 shadow-lg h-14 rounded-xl text-[16px] hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none" asChild>
              <Link to="/cabinet/profile#topup" className="inline-flex items-center justify-center gap-2 leading-none">
                <PlusCircle className="h-5 w-5 shrink-0" />
                <span className="inline-flex items-center leading-none">{t("cabinet.dashboard.top_up")}</span>
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Справа от баланса: Рефералы или Подключение */}
        <Card className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 sm:col-span-2 lg:col-span-1">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-3 text-xl text-foreground">
              <div className="p-2.5 bg-primary/20 rounded-xl">
                {hasReferralLinks ? <Users className="h-6 w-6 text-primary" /> : <Wifi className="h-6 w-6 text-primary" />}
              </div>
              {hasReferralLinks ? t("cabinet.dashboard.referrals") : t("cabinet.dashboard.connection")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-2 flex flex-col justify-center h-[calc(100%-5rem)]">
            {hasReferralLinks ? (
              <>
                <p className="text-[15px] text-muted-foreground leading-relaxed">Делитесь ссылкой и получайте <strong className="text-foreground">бонус на баланс</strong> за каждого приглашенного друга!</p>
                {referralLinkSite && (
                  <div className="space-y-2">
                    <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Сайт</p>
                    <div className="flex items-center gap-2">
                      <code className="rounded-xl bg-background/50 border border-border/50 px-4 py-3 text-[15px] font-mono flex-1 truncate block text-foreground/80" title={referralLinkSite}>
                        {referralLinkSite}
                      </code>
                      <Button variant="secondary" size="icon" onClick={() => copyReferral("site")} className="shrink-0 h-12 w-12 rounded-xl hover:scale-105 transition-transform border border-border/50 bg-background/50" title="Копировать">
                        {referralCopied === "site" ? <Check className="h-5 w-5 text-green-500" /> : <Copy className="h-5 w-5 text-foreground/70" />}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="pt-3">
                  <Button variant="outline" className="w-full rounded-xl h-12 text-[15px] bg-background/30 hover:bg-background/60 transition-colors border-border/50 [&_svg]:self-center [&_span]:leading-none" asChild>
                     <Link to="/cabinet/referral" className="inline-flex items-center justify-center gap-2 leading-none">
                       <span className="inline-flex items-center leading-none">Подробная статистика</span>
                       <ArrowRight className="h-4 w-4 shrink-0" />
                     </Link>
                  </Button>
                </div>
              </>
            ) : vpnUrl ? (
              <div className="flex flex-col h-full justify-between space-y-6">
                <p className="text-[15px] text-muted-foreground leading-relaxed">Ваша подписка готова к использованию. Перейдите к настройке приложения.</p>
                <div className="p-6 bg-primary/10 rounded-2xl border border-primary/20 text-center">
                   <Wifi className="h-12 w-12 text-primary mx-auto mb-3 opacity-80" />
                   <p className="text-[15px] text-foreground font-medium">Всё готово к работе</p>
                </div>
                <Button variant="default" size="lg" className="w-full gap-2 rounded-xl shadow-lg h-14 text-[16px] hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none" asChild>
                  <Link to="/cabinet/subscribe" className="inline-flex items-center justify-center gap-2 leading-none">
                    <Wifi className="h-5 w-5 shrink-0" />
                    <span className="inline-flex items-center leading-none">Подключить VPN</span>
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col h-full justify-center space-y-6">
                <div className="p-6 bg-background/30 rounded-2xl border border-border/50 text-center">
                   <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-40" />
                   <p className="text-[15px] text-muted-foreground">Оплатите тариф, чтобы получить ссылку</p>
                </div>
                <Button variant="outline" size="lg" className="w-full rounded-xl h-14 text-[16px] bg-background/30 hover:bg-background/60 border-border/50 transition-colors [&_span]:leading-none" asChild>
                  <Link to="/cabinet/tariffs" className="inline-flex items-center justify-center leading-none">
                    <span className="inline-flex items-center leading-none">Выбрать тариф</span>
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {secondarySubscriptions.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-4 pt-4"
        >
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground ml-1">
            <Package className="h-6 w-6 text-indigo-400" />
            Дополнительные подписки
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {secondarySubscriptions.map((sec) => {
              const secParsed = parseSubscription(sec.subscription);
              const secHasActive = sec.subscription && typeof sec.subscription === "object" && (secParsed.status === "ACTIVE" || secParsed.status === undefined);
              const secExpireDate = secParsed.expireAt ? new Date(secParsed.expireAt) : null;
              const secDaysLeft = secExpireDate && secExpireDate > new Date() ? Math.max(0, Math.ceil((secExpireDate.getTime() - Date.now()) / (24*60*60*1000))) : null;
              const secTrafficPercent = secParsed.trafficLimitBytes && secParsed.trafficLimitBytes > 0 && secParsed.trafficUsed != null ? Math.min(100, Math.round((secParsed.trafficUsed / secParsed.trafficLimitBytes) * 100)) : null;

              return (
                <Card key={sec.id} className="rounded-3xl border border-indigo-500/30 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center justify-between text-lg text-foreground">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-500/20 rounded-xl">
                          <Package className="h-5 w-5 text-indigo-400" />
                        </div>
                        Подписка #{sec.subscriptionIndex ?? ""}
                      </div>
                      {secHasActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          Активна
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold bg-muted/30 text-muted-foreground border border-border/50">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          Неактивна
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-center">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        {secDaysLeft != null && (
                          <span className="text-sm font-semibold text-foreground bg-foreground/5 px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
                            {secDaysLeft} {secDaysLeft === 1 ? t("cabinet.common.day_one") : secDaysLeft < 5 ? t("cabinet.common.day_few") : t("cabinet.common.day_many")}
                          </span>
                        )}
                        {secParsed.hwidDeviceLimit != null && secParsed.hwidDeviceLimit > 0 && (
                          <span className="text-sm font-semibold text-foreground bg-indigo-500/10 text-indigo-400 px-3 py-1.5 rounded-full border border-indigo-500/20 shadow-sm flex items-center gap-1.5">
                            <Smartphone className="h-4 w-4" /> {secParsed.hwidDeviceLimit}
                          </span>
                        )}
                      </div>
                      
                      {sec.tariffDisplayName && (
                        <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                            <Package className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.tariff_label")}</p>
                            <p className="text-[15px] font-semibold truncate text-foreground">
                              {sec.tariffDisplayName}
                            </p>
                          </div>
                        </div>
                      )}
                      
                      {secParsed.expireAt && (
                        <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                            <Calendar className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.valid_until")}</p>
                            <p className="text-[15px] font-semibold text-foreground">
                              {formatDate(secParsed.expireAt)}
                            </p>
                          </div>
                        </div>
                      )}
                      
                      <div className="bg-background/40 p-4 rounded-2xl border border-border/50 space-y-3 transition-colors hover:bg-background/60 shadow-sm">
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                            <Wifi className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.traffic")}</p>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[15px] font-semibold text-foreground">
                                {secParsed.trafficLimitBytes != null && secParsed.trafficLimitBytes > 0
                                  ? `${formatBytes(secParsed.trafficUsed ?? 0)} / ${formatBytes(secParsed.trafficLimitBytes)}`
                                  : t("cabinet.dashboard.unlimited")}
                              </p>
                              {secTrafficPercent != null && <span className="text-[13px] font-bold text-muted-foreground">{secTrafficPercent}%</span>}
                            </div>
                          </div>
                        </div>
                        {secTrafficPercent != null && (
                          <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
                            <div className="h-full rounded-full bg-indigo-500 transition-all duration-500 ease-in-out" style={{ width: `${secTrafficPercent}%` }} />
                          </div>
                        )}
                      </div>

                      <div className="pt-2">
                        <Button variant="default" size="lg" className="w-full gap-2 rounded-xl shadow-lg h-14 text-[16px] hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none bg-indigo-600 hover:bg-indigo-700 text-white" asChild>
                          <Link to={`/cabinet/subscribe?uuid=${sec.remnawaveUuid}`} className="inline-flex items-center justify-center gap-2 leading-none">
                            <Wifi className="h-5 w-5 shrink-0" />
                            <span className="inline-flex items-center leading-none">Подключиться</span>
                          </Link>
                        </Button>
                      </div>

                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </motion.section>
      )}
    </div>
  );
}
