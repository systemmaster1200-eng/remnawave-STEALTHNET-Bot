/**
 * StealthTopupModal — пополнение баланса в Stealth-стиле.
 *
 * Сумма + быстрые пресеты → плитки способов оплаты (как на странице оформления
 * подписки) → кнопка «Оплатить» сразу под выбором, открывает оплату напрямую.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, Loader2, Sparkles } from "lucide-react";
import { api, type PublicConfig } from "@/lib/api";
import { useClientAuth } from "@/contexts/client-auth";
import { cn } from "@/lib/utils";
import { StealthModal } from "@/components/stealth/stealth-modal";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { WizardHeader } from "@/components/stealth/wizard-header";
import { PayNowPanel } from "@/components/payment/pay-now-panel";

function symbol(currency: string) {
  return currency === "rub" || currency === "RUB" ? "₽"
    : currency === "usd" || currency === "USD" ? "$"
    : currency.toUpperCase();
}

export function StealthTopupModal({
  open,
  onClose,
  currency = "RUB",
  asPage = false,
}: {
  open: boolean;
  onClose: () => void;
  currency?: string;
  asPage?: boolean;
}) {
  const { state } = useClientAuth();
  const token = state.token;
  const navigate = useNavigate();

  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Платёж создан — показываем PayNowPanel (открытие оплаты в отдельной вкладке/браузере,
  // как в классическом кабинете). null = ещё выбираем сумму/способ.
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string; paymentId?: string } | null>(null);

  useEffect(() => {
    if (!open && !asPage) return;
    setError(null); setSelected(null); setAmount(""); setReadyUrl(null);
    api.getPublicConfig().then(setConfig).catch(() => {});
  }, [open, asPage]);

  const cur = currency.toUpperCase();
  const isRub = cur === "RUB";

  const providers = useMemo(() => {
    if (!config) return [] as { id: string; label: string }[];
    const list: { id: string; label: string }[] = [];
    (config.plategaMethods ?? []).forEach((m) => list.push({ id: `platega:${m.id}`, label: m.label }));
    const label = (id: string, fb: string) => config.paymentProviders?.find((p) => p.id === id)?.label || fb;
    const flags: { id: string; enabled: boolean; fb: string }[] = [
      { id: "cryptopay", enabled: Boolean(config.cryptopayEnabled), fb: "Crypto Bot" },
      { id: "heleket", enabled: Boolean(config.heleketEnabled), fb: "Heleket" },
      { id: "yookassa", enabled: Boolean(config.yookassaEnabled) && isRub, fb: "СБП / Карты РФ" },
      { id: "yoomoney", enabled: Boolean(config.yoomoneyEnabled) && isRub, fb: "ЮMoney" },
      { id: "lava", enabled: Boolean(config.lavaEnabled) && isRub, fb: "LAVA" },
      { id: "overpay", enabled: Boolean(config.overpayEnabled), fb: "Overpay" },
    ];
    const enabled = flags.filter((f) => f.enabled).map((f) => ({ id: f.id, label: label(f.id, f.fb) }));
    const order = (config.paymentProviders ?? []).map((p) => p.id);
    enabled.sort((a, b) => {
      const ia = order.indexOf(a.id); const ib = order.indexOf(b.id);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return [...list, ...enabled];
  }, [config, isRub]);

  const amountNum = Number((amount || "").replace(",", "."));
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;

  async function pay() {
    if (!token || !selected || !amountValid || busy) return;
    setBusy(true); setError(null);
    const amt = amountNum;
    const providerId = selected;
    try {
      let url = ""; let paymentId: string | undefined; let provider = "";
      if (providerId.startsWith("platega:")) {
        const methodId = Number(providerId.split(":")[1]);
        const r = await api.clientCreatePlategaPayment(token, { amount: amt, currency: cur, paymentMethod: methodId });
        url = r.paymentUrl ?? ""; paymentId = r.paymentId; provider = "Platega";
      } else if (providerId === "yookassa") {
        const r = await api.yookassaCreatePayment(token, { amount: amt, currency: "RUB" });
        url = r.confirmationUrl ?? ""; paymentId = r.paymentId; provider = "ЮKassa";
      } else if (providerId === "yoomoney") {
        const r = await api.yoomoneyCreateFormPayment(token, { amount: amt, paymentType: "AC" });
        url = r.paymentUrl ?? ""; paymentId = r.paymentId; provider = "ЮMoney";
      } else if (providerId === "cryptopay") {
        const r = await api.cryptopayCreatePayment(token, { amount: amt, currency: cur });
        url = r.payUrl ?? ""; paymentId = r.paymentId; provider = "Crypto Bot";
      } else if (providerId === "heleket") {
        const r = await api.heleketCreatePayment(token, { amount: amt, currency: cur });
        url = r.payUrl ?? ""; paymentId = r.paymentId; provider = "Heleket";
      } else if (providerId === "lava") {
        const r = await api.lavaCreatePayment(token, { amount: amt, currency: cur });
        url = r.payUrl ?? ""; paymentId = r.paymentId; provider = "LAVA";
      } else if (providerId === "overpay") {
        const r = await api.overpayCreatePayment(token, { amount: amt, currency: cur });
        url = r.payUrl ?? ""; paymentId = r.paymentId; provider = "Overpay";
      }
      if (!url) { setError("Не удалось создать платёж"); return; }
      // Как в классическом кабинете: показываем панель с кнопкой, которая открывает
      // оплату в ОТДЕЛЬНОЙ вкладке/браузере (а в мини-аппе — через WebApp.openLink).
      setReadyUrl({ url, provider, paymentId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать платёж");
    } finally {
      setBusy(false);
    }
  }

  const presets = isRub ? [100, 300, 500, 1000] : [5, 10, 20, 50];

  const inner = readyUrl ? (
    <PayNowPanel
      url={readyUrl.url}
      provider={readyUrl.provider}
      onBack={() => setReadyUrl(null)}
      onPaid={() => {
        const pid = readyUrl.paymentId;
        const u = readyUrl.url, prov = readyUrl.provider;
        onClose();
        if (pid) navigate(`/cabinet/payment-wait?id=${encodeURIComponent(pid)}&kind=topup`, { state: { url: u, provider: prov } });
      }}
      compact
    />
  ) : (
    <div className="space-y-4">
      {/* Текущий баланс клиента */}
      {state.client && (
        <div className="flex items-center justify-between rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-3">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Текущий баланс</span>
          <span className="text-lg font-extrabold text-zinc-100 tabular-nums">
            {(state.client.balance ?? 0).toLocaleString("ru-RU")}
            <span className="ml-1 text-zinc-400 font-bold">{symbol(cur)}</span>
          </span>
        </div>
      )}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">Сумма пополнения</p>
        <div className="relative">
          <input
            type="number" inputMode="decimal" min={1} autoFocus
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null); }}
            placeholder="0"
            className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-3 pr-9 text-lg font-bold text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">{symbol(cur)}</span>
        </div>
        <div className="flex gap-2 mt-2">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { setAmount(String(p)); setError(null); }}
              className="flex-1 rounded-lg bg-white/[0.04] border border-white/10 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/[0.08] hover:border-blue-500/40 transition"
            >
              {p}{symbol(cur)}
            </button>
          ))}
        </div>
      </div>

      {/* Плитки способов оплаты — в стиле страницы оформления подписки */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Способ оплаты</p>
        {providers.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5">
            {providers.map((p) => {
              const active = selected === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setSelected(p.id); setError(null); }}
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
          <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 p-3 text-xs text-zinc-400 text-center">
            Способы оплаты не настроены.
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-2.5 text-center text-xs font-bold text-red-400">
          {error}
        </div>
      )}

      {/* Кнопка «Оплатить» сразу под выбором — логика как в оформлении подписки */}
      <div className="pt-1">
        <StadiumButton
          variant="white"
          size="lg"
          onClick={pay}
          disabled={busy || !selected || !amountValid}
          iconLeft={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        >
          {busy ? "Создаём платёж…" : `Оплатить${amountValid ? ` ${amountNum}${symbol(cur)}` : ""}`}
        </StadiumButton>
      </div>
    </div>
  );

  if (asPage) {
    return (
      <div className="px-4 pt-2 space-y-5 pb-4">
        <WizardHeader step={1} totalSteps={1} onClose={() => { if (!busy) onClose(); }} />
        <h1 className="text-2xl font-extrabold text-zinc-100 px-1">Пополнить баланс</h1>
        {inner}
      </div>
    );
  }

  return (
    <StealthModal open={open} onClose={() => { if (!busy) onClose(); }} title="Пополнить баланс">
      {inner}
    </StealthModal>
  );
}
