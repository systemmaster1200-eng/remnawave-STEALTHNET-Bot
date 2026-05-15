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
import { useNavigate } from "react-router-dom";
import { Wallet, Bitcoin, Check, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicTariffCategory, type PublicConfig } from "@/lib/api";
import { StadiumButton } from "@/components/stealth/stadium-button";
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

export function StealthTariffs() {
  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();

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
  const [payError, setPayError] = useState<string | null>(null);

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

  const currentCat = categories.find((c) => c.id === selectedCatId);
  const currentTariff = currentCat?.tariffs.find((t) => t.id === selectedTariffId) as TariffLite | undefined;
  const priceOptions: PriceOption[] = currentTariff?.priceOptions ?? [];
  const currentOption = priceOptions.find((o) => o.id === selectedPriceOptionId);
  const totalPrice = currentOption?.price ?? currentTariff?.price ?? 0;
  const days = currentOption?.durationDays ?? currentTariff?.durationDays ?? 30;
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

  // Balance available?
  const balance = state.client?.balance ?? 0;
  const canPayByBalance = balance >= totalPrice && totalPrice > 0;

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
      };
      let url: string | null = null;
      if (selectedMethod.kind === "platega") {
        const r = await api.clientCreatePlategaPayment(state.token, { ...base, paymentMethod: selectedMethod.id });
        url = r.paymentUrl;
      } else if (selectedMethod.kind === "yookassa") {
        const r = await api.yookassaCreatePayment(state.token, base);
        url = r.confirmationUrl;
      } else if (selectedMethod.kind === "yoomoney") {
        const r = await api.yoomoneyCreateFormPayment(state.token, { ...base, paymentType: "AC" });
        url = r.paymentUrl;
      } else if (selectedMethod.kind === "cryptopay") {
        const r = await api.cryptopayCreatePayment(state.token, base);
        // CryptoBot mini-app preferred when in Telegram, иначе fallback
        url = r.miniAppPayUrl ?? r.webAppPayUrl ?? r.payUrl;
      } else if (selectedMethod.kind === "heleket") {
        const r = await api.heleketCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "lava") {
        const r = await api.lavaCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "balance") {
        await api.clientPayByBalance(state.token, base);
        await refreshProfile();
        navigate("/cabinet/dashboard?paid=balance");
        return;
      }
      if (url) window.location.href = url;
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="px-4 pt-10 flex justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-rose-500" />
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

  return (
    <div className="px-4 pt-2 space-y-4 pb-2">
      {/* Category tabs (только если >1) */}
      {categories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {categories.map((c) => {
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
                  "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-all",
                  active ? "bg-white text-black border-white" : "bg-zinc-900/60 text-zinc-300 border-white/[0.08] hover:border-white/20",
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
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all",
                  active ? "bg-zinc-900/80 text-white border-rose-500/40 shadow-[0_0_16px_-4px_rgba(255,35,87,0.3)]" : "bg-zinc-900/40 text-zinc-400 border-white/[0.06] hover:border-white/20",
                )}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Period selector card */}
      <div className="rounded-3xl border border-white/[0.08] bg-zinc-900/60 p-5 space-y-4">
        {priceOptions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {priceOptions.sort((a, b) => a.durationDays - b.durationDays).map((opt) => {
              const active = opt.id === selectedPriceOptionId;
              return (
                <button
                  key={opt.id}
                  onClick={() => setSelectedPriceOptionId(opt.id)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all min-w-[58px]",
                    active ? "bg-white text-black border-white" : "bg-zinc-900/60 text-zinc-300 border-white/[0.08] hover:border-white/20",
                  )}
                >
                  {opt.durationDays} дн.
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-end justify-between gap-4 pt-1">
          <div>
            <div className="text-3xl font-bold leading-none">{days}</div>
            <div className="text-xs text-zinc-500 mt-1.5">дн.</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{fmtPrice(pricePerDay, currency)}</div>
            <div className="text-xs text-zinc-500">/день</div>
          </div>
        </div>

        <div className="border-t border-white/[0.06] pt-3 flex items-center justify-between">
          <span className="text-sm text-zinc-400">Итого:</span>
          <span className="text-2xl font-bold tabular-nums">{fmtPrice(totalPrice, currency)}</span>
        </div>
      </div>

      {/* Promo */}
      <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-2 flex items-center gap-2">
        <input
          value={promoInput}
          onChange={(e) => { setPromoInput(e.target.value); setPromoMsg(null); }}
          placeholder="Введите промокод"
          className="flex-1 bg-transparent px-3 py-2.5 text-sm placeholder-zinc-500 outline-none"
        />
        <button
          onClick={applyPromo}
          disabled={promoBusy || !promoInput.trim()}
          className="rounded-xl bg-zinc-800/80 hover:bg-zinc-800 px-4 py-2 text-xs font-medium border border-white/[0.06] disabled:opacity-50 transition"
        >
          {promoBusy ? "..." : promoApplied ? <Check className="h-4 w-4 inline" /> : "Активировать"}
        </button>
      </div>
      {promoMsg && (
        <div className={cn("text-xs px-1", promoApplied ? "text-emerald-400" : "text-rose-400")}>{promoMsg}</div>
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
              <button
                key={`${m.kind}-${m.kind === "platega" ? m.id : ""}`}
                onClick={() => setSelectedMethod(m)}
                className={cn(
                  "rounded-2xl border p-4 transition-all flex flex-col items-center gap-2",
                  active ? "bg-zinc-900/80 border-white/30" : "bg-zinc-900/30 border-white/[0.06] hover:border-white/15",
                )}
              >
                <Icon className={cn("h-5 w-5", active ? "text-rose-400" : "text-zinc-500")} />
                <span className="text-[11px] font-bold uppercase tracking-wider">{m.label}</span>
              </button>
            );
          })}
          {canPayByBalance && (
            <button
              onClick={() => setSelectedMethod({ kind: "balance", label: `Баланс (${balance.toFixed(0)}${fmtPrice(0, currency).slice(-1)})`, icon: Wallet })}
              className={cn(
                "rounded-2xl border p-4 transition-all flex flex-col items-center gap-2",
                selectedMethod?.kind === "balance" ? "bg-emerald-500/[0.08] border-emerald-500/30" : "bg-zinc-900/30 border-white/[0.06] hover:border-white/15",
              )}
            >
              <Wallet className={cn("h-5 w-5", selectedMethod?.kind === "balance" ? "text-emerald-400" : "text-zinc-500")} />
              <span className="text-[11px] font-bold uppercase tracking-wider">Баланс</span>
            </button>
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
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 flex items-start gap-2 text-xs">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
          <span className="text-rose-300">{payError}</span>
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
