import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, Smartphone, Server, CreditCard, Loader2, Wallet, Layers, Shield, Zap, ArrowLeft } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import type { PublicSellOption } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

function optionLabel(o: PublicSellOption): string {
  if (o.kind === "traffic") return `+${o.trafficGb} ГБ трафика`;
  if (o.kind === "devices") return `+${o.deviceCount} ${o.deviceCount === 1 ? "устройство" : "устройства"}`;
  if (o.kind === "servers") {
    const traffic = (o.trafficGb ?? 0) > 0 ? ` + ${o.trafficGb} ГБ` : "";
    return (o.name || "Доп. сервер") + traffic;
  }
  return "Доп. опция";
}

function optionIcon(o: PublicSellOption) {
  if (o.kind === "traffic") return <Wifi className="h-5 w-5" />;
  if (o.kind === "devices") return <Smartphone className="h-5 w-5" />;
  return <Server className="h-5 w-5" />;
}

export function ClientExtraOptionsPage() {
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const balance = state.client?.balance ?? 0;
  const [options, setOptions] = useState<PublicSellOption[]>([]);
  const [sellOptionsEnabled, setSellOptionsEnabled] = useState(false);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [yookassaEnabled, setYookassaEnabled] = useState(false);
  const [cryptopayEnabled, setCryptopayEnabled] = useState(false);
  const [heleketEnabled, setHeleketEnabled] = useState(false);
  const [lavaEnabled, setLavaEnabled] = useState(false);
  const [overpayEnabled, setOverpayEnabled] = useState(false);
  const [paymentProviders, setPaymentProviders] = useState<{ id: string; label: string; sortOrder: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [payModal, setPayModal] = useState<PublicSellOption | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string } | null>(null);

  const isMobileOrMiniapp = useCabinetMiniapp();

  useEffect(() => {
    api.getPublicConfig().then((c) => {
      setSellOptionsEnabled(Boolean(c.sellOptionsEnabled));
      setOptions(c.sellOptions ?? []);
      setPlategaMethods(c.plategaMethods ?? []);
      setYoomoneyEnabled(Boolean(c.yoomoneyEnabled));
      setYookassaEnabled(Boolean(c.yookassaEnabled));
      setCryptopayEnabled(Boolean(c.cryptopayEnabled));
      setHeleketEnabled(Boolean(c.heleketEnabled));
      setLavaEnabled(Boolean(c.lavaEnabled));
      setOverpayEnabled(Boolean(c.overpayEnabled));
      setPaymentProviders(c.paymentProviders ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function startYookassaPayment(option: PublicSellOption) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yookassaCreatePayment(token, {
        extraOption: { kind: option.kind, productId: option.id },
      });
      if (res.confirmationUrl) setReadyUrl({ url: res.confirmationUrl, provider: "ЮKassa" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startCryptopayPayment(option: PublicSellOption) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.cryptopayCreatePayment(token, {
        extraOption: { kind: option.kind, productId: option.id },
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Crypto Bot" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startHeleketPayment(option: PublicSellOption) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.heleketCreatePayment(token, {
        extraOption: { kind: option.kind, productId: option.id },
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Heleket" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startLavaPayment(option: PublicSellOption) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.lavaCreatePayment(token, {
        extraOption: { kind: option.kind, productId: option.id },
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "LAVA" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startOverpayPayment(option: PublicSellOption) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.overpayCreatePayment(token, {
        extraOption: { kind: option.kind, productId: option.id },
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Overpay" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startPlategaPayment(option: PublicSellOption, methodId: number) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.clientCreatePlategaPayment(token, {
        paymentMethod: methodId,
        extraOption: { kind: option.kind, productId: option.id },
      });
      if (res.paymentUrl) setReadyUrl({ url: res.paymentUrl, provider: "Platega" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startYoomoneyPayment(option: PublicSellOption) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yoomoneyCreateFormPayment(token, {
        paymentType: "AC",
        extraOption: { kind: option.kind, productId: option.id },
      });
      if (res.paymentUrl) setReadyUrl({ url: res.paymentUrl, provider: "ЮMoney" });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startBalancePayment(option: PublicSellOption) {
    if (!token) return;
    if (balance < option.price) {
      setPayError("Недостаточно средств на балансе");
      return;
    }
    setPayError(null);
    setPayLoading(true);
    try {
      await api.clientPayOptionByBalance(token, { extraOption: { kind: option.kind, productId: option.id } });
      setPayModal(null);
      await refreshProfile();
      setPayError(null);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка оплаты с баланса");
    } finally {
      setPayLoading(false);
    }
  }

  const closePayment = () => {
    setPayModal(null);
    setPayError(null);
    setReadyUrl(null);
  };

  const PaymentContent = () => {
    if (!payModal) return null;
    // Оставляем кнопку всегда (даже если баланса нет), просто делаем ее disabled
    const hasBalance = balance >= payModal.price;

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
        <div className={cn("rounded-2xl relative overflow-hidden", isMobileOrMiniapp ? "bg-card/40 border border-white/5 p-5" : "bg-background/50 border border-border/50 p-4")}>
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex justify-between items-center relative z-10">
             <div className="space-y-1.5">
                <p className={cn("font-medium", isMobileOrMiniapp ? "text-sm text-muted-foreground" : "text-muted-foreground")}>
                  {isMobileOrMiniapp ? "Итого к оплате" : "Опция:"}
                </p>
                {!isMobileOrMiniapp && <p className="font-bold text-foreground">{payModal.name || optionLabel(payModal)}</p>}
                {isMobileOrMiniapp && (
                   <span className="text-3xl font-black text-primary">{formatMoney(payModal.price, payModal.currency)}</span>
                )}
             </div>
             {!isMobileOrMiniapp && (
                <div className="text-right">
                   <span className="font-bold text-xl text-primary">{formatMoney(payModal.price, payModal.currency)}</span>
                </div>
             )}
          </div>
        </div>

        <div className={cn("space-y-3", isMobileOrMiniapp ? "pb-24" : "")}>
          <div className="flex items-center gap-2 pt-2 pb-1">
            <Wallet className={cn("text-primary", isMobileOrMiniapp ? "h-5 w-5" : "h-4 w-4")} />
            <span className={cn("font-bold", isMobileOrMiniapp ? "text-lg" : "text-sm")}>Способ оплаты</span>
          </div>

          {payError && (
            <div className={cn("p-4 bg-destructive/10 border border-destructive/20 text-destructive text-center font-bold", isMobileOrMiniapp ? "rounded-2xl text-sm" : "rounded-xl text-sm mb-4")}>
              {payError}
            </div>
          )}

          <div className="space-y-3">
            {/* Оплата с баланса (теперь показывается всегда, но дизейблится) */}
            <Button
              size="lg"
              onClick={() => startBalancePayment(payModal)}
              disabled={payLoading || !hasBalance}
              className={cn("w-full shadow-lg border-0 group relative overflow-hidden", isMobileOrMiniapp ? "justify-between px-6 h-16 rounded-2xl bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400" : "gap-2 h-14 rounded-xl bg-gradient-to-r from-primary to-primary/80 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300")}
            >
              {!isMobileOrMiniapp && <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />}
              {isMobileOrMiniapp ? (
                  <>
                  <div className="flex items-center gap-3">
                    {payLoading ? <Loader2 className="h-6 w-6 text-white animate-spin" /> : <Wallet className="h-6 w-6 text-white" />}
                    <span className="text-base font-bold text-white">Оплатить с баланса</span>
                  </div>
                  <span className="text-white/80 font-mono font-medium bg-black/20 px-2 py-1 rounded-lg">
                    {formatMoney(balance, payModal.currency)}
                  </span>
                  </>
              ) : (
                  <>
                  {payLoading ? <Loader2 className="h-5 w-5 animate-spin relative z-10" /> : <Wallet className="h-5 w-5 relative z-10" />}
                  <span className="text-base font-semibold relative z-10">Оплатить с баланса</span>
                  <span className="opacity-90 font-medium ml-1 bg-black/10 px-2 py-0.5 rounded-md relative z-10">
                    ({formatMoney(balance, payModal.currency)})
                  </span>
                  </>
              )}
            </Button>

            {(() => {
              const providerLabel = (id: string, fallback: string) => paymentProviders.find((p) => p.id === id)?.label || fallback;
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
                { id: "cryptopay", enabled: cryptopayEnabled, onClick: () => startCryptopayPayment(payModal!), label: providerLabel("cryptopay", "Crypto Bot"), icon: "crypto" },
                { id: "heleket", enabled: heleketEnabled, onClick: () => startHeleketPayment(payModal!), label: providerLabel("heleket", "Heleket"), icon: "crypto" },
                { id: "yookassa", enabled: yookassaEnabled && payModal?.currency.toUpperCase() === "RUB", onClick: () => startYookassaPayment(payModal!), label: providerLabel("yookassa", "СБП / Карты РФ"), icon: "card" },
                { id: "yoomoney", enabled: yoomoneyEnabled && payModal?.currency.toUpperCase() === "RUB", onClick: () => startYoomoneyPayment(payModal!), label: providerLabel("yoomoney", "ЮMoney / Карты"), icon: "card" },
                { id: "lava", enabled: lavaEnabled && payModal?.currency.toUpperCase() === "RUB", onClick: () => startLavaPayment(payModal!), label: providerLabel("lava", "LAVA"), icon: "card" },
                { id: "overpay", enabled: overpayEnabled, onClick: () => startOverpayPayment(payModal!), label: providerLabel("overpay", "Overpay"), icon: "card" },
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
                    <Button key={m.id} size="lg" variant="outline" onClick={() => startPlategaPayment(payModal!, m.id)} disabled={payLoading} className={btnCls}>
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
          {isMobileOrMiniapp && <div className="h-8" />}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sellOptionsEnabled || options.length === 0) {
    return (
      <div className="space-y-6 w-full min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Доп. опции</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {!sellOptionsEnabled
              ? "Продажа доп. опций отключена."
              : "Дополнительные опции пока не настроены. Оформите подписку в разделе «Тарифы», затем здесь можно будет докупить трафик, устройства или серверы."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const trafficOptions = options.filter(o => o.kind === "traffic");
  const deviceOptions = options.filter(o => o.kind === "devices");
  const serverOptions = options.filter(o => o.kind === "servers");

  return (
    <>
      <AnimatePresence mode="wait">
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
                  <h2 className="text-sm sm:text-base font-bold truncate text-foreground">Оплата опции</h2>
                  <p className="text-[11px] font-medium text-muted-foreground truncate">{payModal.name || optionLabel(payModal)}</p>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-6 pb-8">
               <PaymentContent />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="options-list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="space-y-8 max-w-6xl mx-auto pb-24"
          >
            <div className="relative overflow-hidden rounded-3xl bg-card/40 backdrop-blur-2xl border border-border/50 p-8 sm:p-10 shadow-xl">
              <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-primary/20 blur-[80px] pointer-events-none" />
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="flex-1">
                  <h1 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground flex items-center gap-3">
                    <Layers className="h-8 w-8 text-primary" />
                    Доп. опции
                  </h1>
                  <p className="mt-3 text-[16px] text-muted-foreground max-w-xl leading-relaxed">
                    Не хватает трафика, нужны дополнительные устройства или серверы?
                    Здесь вы можете прокачать вашу текущую подписку. Опции применяются моментально после оплаты.
                  </p>
                </div>
              </div>
            </div>

            {trafficOptions.length > 0 && (
              <section className="space-y-4">
                <h2 className="flex items-center gap-2 text-lg font-semibold px-2">
                  <Wifi className="h-5 w-5 text-primary" />
                  Дополнительный трафик
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {trafficOptions.map((opt) => (
                    <Card key={`traffic-${opt.id}`} className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col group hover:-translate-y-1">
                      <CardContent className="flex-1 flex flex-col p-5 min-h-0 min-w-0">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:scale-110 group-hover:bg-primary/20 transition-all duration-300">
                            {optionIcon(opt)}
                          </div>
                          <div>
                            <h3 className="font-bold text-lg text-foreground truncate">{opt.name || "Пакет трафика"}</h3>
                            <p className="text-sm text-muted-foreground truncate">{optionLabel(opt)}</p>
                          </div>
                        </div>
                        <div className="mt-auto space-y-4 pt-4 border-t border-border/50">
                          <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-foreground">{formatMoney(opt.price, opt.currency)}</span>
                          </div>
                          <Button onClick={() => setPayModal(opt)} className="w-full gap-2 shadow-md hover:scale-[1.02] transition-transform rounded-xl h-12">
                            <CreditCard className="h-5 w-5" />
                            Купить пакет
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {deviceOptions.length > 0 && (
              <section className="space-y-4">
                <h2 className="flex items-center gap-2 text-lg font-semibold px-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  Устройства (Слоты)
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {deviceOptions.map((opt) => (
                    <Card key={`devices-${opt.id}`} className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col group hover:-translate-y-1">
                      <CardContent className="flex-1 flex flex-col p-5 min-h-0 min-w-0">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:scale-110 group-hover:bg-primary/20 transition-all duration-300">
                            {optionIcon(opt)}
                          </div>
                          <div>
                            <h3 className="font-bold text-lg text-foreground truncate">{opt.name || "Слоты устройств"}</h3>
                            <p className="text-sm text-muted-foreground truncate">{optionLabel(opt)}</p>
                          </div>
                        </div>
                        <div className="mt-auto space-y-4 pt-4 border-t border-border/50">
                          <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-foreground">{formatMoney(opt.price, opt.currency)}</span>
                          </div>
                          <Button onClick={() => setPayModal(opt)} className="w-full gap-2 shadow-md hover:scale-[1.02] transition-transform rounded-xl h-12">
                            <CreditCard className="h-5 w-5" />
                            Добавить устройства
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {serverOptions.length > 0 && (
              <section className="space-y-4">
                <h2 className="flex items-center gap-2 text-lg font-semibold px-2">
                  <Server className="h-5 w-5 text-primary" />
                  Дополнительные серверы
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {serverOptions.map((opt) => (
                    <Card key={`servers-${opt.id}`} className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col group hover:-translate-y-1">
                      <CardContent className="flex-1 flex flex-col p-5 min-h-0 min-w-0">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:scale-110 group-hover:bg-primary/20 transition-all duration-300">
                            {optionIcon(opt)}
                          </div>
                          <div>
                            <h3 className="font-bold text-lg text-foreground truncate">{opt.name || "Доп. сервер"}</h3>
                            <p className="text-sm text-muted-foreground truncate">{optionLabel(opt)}</p>
                          </div>
                        </div>
                        <div className="mt-auto space-y-4 pt-4 border-t border-border/50">
                          <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-foreground">{formatMoney(opt.price, opt.currency)}</span>
                          </div>
                          <Button onClick={() => setPayModal(opt)} className="w-full gap-2 shadow-md hover:scale-[1.02] transition-transform rounded-xl h-12">
                            <CreditCard className="h-5 w-5" />
                            Купить сервер
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!isMobileOrMiniapp && (
        <Dialog open={!!payModal} onOpenChange={(open) => { if (!open && !payLoading) closePayment(); }}>
          <DialogContent className="w-full max-w-md mx-auto sm:rounded-3xl p-5 sm:p-6 border border-border/50 bg-card/60 backdrop-blur-3xl shadow-2xl" showCloseButton={!payLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader className="mb-4 text-center sm:text-left">
              <DialogTitle className="text-2xl font-bold flex items-center justify-center sm:justify-start gap-2">
                <div className="p-2 bg-primary/10 rounded-xl">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                Оплата опции
              </DialogTitle>
              <DialogDescription className="hidden" />
            </DialogHeader>

            <PaymentContent />

            <DialogFooter className="mt-4 sm:justify-center border-t border-border/50 pt-4">
              <Button variant="ghost" onClick={closePayment} disabled={payLoading} className="rounded-xl hover:bg-background/50 hover:text-foreground text-muted-foreground transition-colors">
                Отмена
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
