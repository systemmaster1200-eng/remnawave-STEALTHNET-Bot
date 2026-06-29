/**
 * Stealth Referral — реферальная система в Hundler-style.
 *
 * Структура:
 *   1. KPI-карточка с red border:
 *      - НАКОПЛЕНО (totalEarnings + currency) | ДРУЗЕЙ (referralCount)
 *   2. ТВОЯ ССЫЛКА — карточка с TG-link (или сайтовой) + Скопировать/Поделиться
 *   3. (Опц.) Раздел «Твои друзья» — пока статичный пункт-link
 *   4. Accordion «Правила и бонусы» — 2-3 TipCard'а с цветовой кодировкой
 */

import { useEffect, useMemo, useState } from "react";
import { Gift, Send, Copy, Check, Users, ChevronDown, Award, Repeat, AlertTriangle, ChevronRight } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientReferralStats, type PublicConfig } from "@/lib/api";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { TipCard } from "@/components/stealth/tip-card";
import { cn } from "@/lib/utils";

function fmtMoney(n: number, currency: string) {
  const sym = currency === "rub" || currency === "RUB" ? "₽" : currency === "usd" || currency === "USD" ? "$" : "";
  return `${Math.round(n)}${sym}`;
}

export function StealthReferral() {
  const { state } = useClientAuth();
  const [stats, setStats] = useState<ClientReferralStats | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKind, setCopiedKind] = useState<"bot" | "site" | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    if (!state.token) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      api.getClientReferralStats(state.token).catch(() => null),
      api.getPublicConfig().catch(() => null),
    ]).then(([s, c]) => {
      if (!alive) return;
      setStats(s);
      setConfig(c);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [state.token]);

  // Реф-ссылка для Telegram-бота (если бот настроен).
  const botLink = useMemo(() => {
    if (!stats?.referralCode || !config?.telegramBotUsername) return null;
    return `https://t.me/${config.telegramBotUsername.replace(/^@/, "")}?start=ref_${stats.referralCode}`;
  }, [stats, config]);

  // Реф-ссылка на веб-сайт (регистрация в кабинете). Доступна всегда.
  const siteLink = useMemo(() => {
    if (!stats?.referralCode) return null;
    const origin = (config as { publicAppUrl?: string | null })?.publicAppUrl?.replace(/\/+$/, "")
      || (typeof window !== "undefined" ? window.location.origin : "");
    if (!origin) return null;
    return `${origin}/cabinet/register?ref=${encodeURIComponent(stats.referralCode)}`;
  }, [stats, config]);

  // Основная ссылка для «Поделиться» — бот в приоритете, иначе сайт.
  const link = botLink ?? siteLink;


  const currency = state.client?.preferredCurrency ?? "rub";

  function copyLink(value: string | null, kind: "bot" | "site") {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopiedKind(kind);
    setTimeout(() => setCopiedKind(null), 2000);
  }

  function share() {
    if (!link) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      navigator.share({ url: link, title: "Присоединяйся!" }).catch(() => {});
    } else {
      copyLink(link, botLink ? "bot" : "site");
    }
  }

  return (
    <div className="px-4 pt-2 space-y-4 pb-2">
      {/* Header card */}
      <div className="flex items-center gap-3 px-1">
        <div className="h-10 w-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
          <Gift className="h-5 w-5 text-blue-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight">Реферальная система</h2>
          <p className="text-xs text-zinc-500">Приглашай друзей — получай бонусы</p>
        </div>
      </div>

      {/* KPI card with red border */}
      <div className="relative overflow-hidden rounded-3xl border border-blue-500/40 bg-zinc-900/40 p-5">
        {/* Decorative watermark */}
        <div
          className="absolute -right-6 -top-6 text-blue-500/[0.06] font-bold text-[140px] leading-none pointer-events-none select-none"
          style={{ fontFamily: '"Syncopate", sans-serif' }}
        >
          V
        </div>

        <div className="relative grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-blue-400/80">Накоплено</p>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tabular-nums">{stats ? fmtMoney(stats.totalEarnings, currency) : (loading ? "…" : "0")}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-400">Друзей</p>
            <div className="mt-1.5 text-4xl font-bold tabular-nums">{stats?.referralCount ?? 0}</div>
          </div>
        </div>

        <p className="relative text-xs text-zinc-400 mt-3">Приглашай друзей — получай бонусы за каждого</p>
      </div>

      {/* Your links — Telegram + сайт */}
      <div className="space-y-3">
        {/* Telegram-ссылка (если бот настроен) */}
        {botLink && (
          <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4 space-y-3">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-500">Ссылка для Telegram</p>
            <div className="rounded-xl border border-white/[0.06] bg-zinc-950/60 p-3">
              <p className="font-mono text-xs text-zinc-200 break-all">{botLink}</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <StadiumButton variant="ghost" size="md" iconLeft={copiedKind === "bot" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />} onClick={() => copyLink(botLink, "bot")}>
                {copiedKind === "bot" ? "Скопировано" : "Скопировать"}
              </StadiumButton>
              <StadiumButton variant="primary" size="md" iconLeft={<Send className="h-4 w-4" />} onClick={share}>
                Поделиться
              </StadiumButton>
            </div>
          </div>
        )}

        {/* Ссылка на веб-сайт */}
        <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4 space-y-3">
          <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-500">Ссылка на сайт</p>
          <div className="rounded-xl border border-white/[0.06] bg-zinc-950/60 p-3">
            <p className="font-mono text-xs text-zinc-200 break-all">{siteLink ?? "Ссылка появится после привязки"}</p>
          </div>
          <StadiumButton variant="ghost" size="md" iconLeft={copiedKind === "site" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />} onClick={() => copyLink(siteLink, "site")} disabled={!siteLink}>
            {copiedKind === "site" ? "Скопировано" : "Скопировать"}
          </StadiumButton>
        </div>
      </div>

      {/* Friends row */}
      <button
        type="button"
        className="w-full rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-3 flex items-center gap-3 text-left hover:border-white/15 transition"
      >
        <div className="h-10 w-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
          <Users className="h-5 w-5 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm">Твои друзья</h4>
          <p className="text-xs text-zinc-500">Поделись ссылкой, чтобы получать бонусы</p>
        </div>
        <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
      </button>

      {/* Rules accordion */}
      <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setRulesOpen((v) => !v)}
          className="w-full p-3.5 flex items-center gap-3 hover:bg-white/[0.02] transition"
        >
          <div className="h-9 w-9 rounded-lg bg-zinc-800/80 border border-white/10 flex items-center justify-center">
            <Award className="h-4 w-4 text-zinc-300" />
          </div>
          <span className="flex-1 text-left font-semibold text-sm">Правила и бонусы</span>
          <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", rulesOpen && "rotate-180")} />
        </button>

        {rulesOpen && stats && (
          <div className="p-3 pt-0 space-y-2.5">
            <TipCard
              tone="emerald"
              icon={Gift}
              title="За регистрацию друга"
            >
              Друг получает свой welcome-бонус сразу после регистрации по твоей ссылке.
            </TipCard>

            <TipCard
              tone="rose"
              icon={Repeat}
              title="За каждую оплату друга"
              chip={`${Math.round(stats.referralPercent)}%`}
            >
              <ul className="space-y-1">
                <li>• 1-й уровень — <strong>{Math.round(stats.referralPercent)}%</strong> от каждой оплаты твоих рефералов</li>
                {stats.referralPercentLevel2 > 0 && (
                  <li>• 2-й уровень — <strong>{Math.round(stats.referralPercentLevel2)}%</strong> от оплат рефералов 2-го уровня</li>
                )}
                {stats.referralPercentLevel3 > 0 && (
                  <li>• 3-й уровень — <strong>{Math.round(stats.referralPercentLevel3)}%</strong> от оплат рефералов 3-го уровня</li>
                )}
              </ul>
            </TipCard>

            <TipCard
              tone="amber"
              icon={AlertTriangle}
              title="Условия"
            >
              Бонусы начисляются автоматически на твой баланс после успешной оплаты другом.
              С баланса можно оплачивать любые тарифы и услуги внутри сервиса.
            </TipCard>
          </div>
        )}
      </div>
    </div>
  );
}
