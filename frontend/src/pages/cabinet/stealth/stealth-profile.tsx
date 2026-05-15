/**
 * Stealth Profile — профиль клиента в Hundler-style.
 *
 * Структура:
 *   1. User card: gradient-аватар (буква имени) + имя/email + status pill
 *      «● ОСТАЛОСЬ N ДН.» с цветной точкой → chevron
 *   2. List-as-card (один контейнер с разделителями внутри):
 *      - Caps section header «ПРИЛОЖЕНИЕ»
 *      - Язык / Поддержка / Реферальная система
 *      - (Опц.) Featured row с red glow border (например «Telegram-канал»)
 *      - Платежи
 *      - Caps section header «БЕЗОПАСНОСТЬ»
 *      - Сменить пароль / 2FA / Удалить аккаунт (red text, опасный)
 *
 * Каждый item — `<button>` с иконкой-плашкой + label + chevron.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Globe, HelpCircle, Gift, CreditCard, FileText, Lock, ChevronRight,
  Shield, MessageCircle, LogOut, type LucideIcon,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicConfig } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StealthPaymentsModal } from "@/components/stealth/stealth-payments-modal";

interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  onClick?: () => void;
  rightLabel?: string;
  /** Цветной glow-border вокруг item'а (для важных CTA в списке) */
  glow?: "rose" | "emerald" | "violet" | "amber";
  danger?: boolean;
}

interface MenuSection {
  title?: string;
  items: MenuItem[];
}

function avatarLetter(s?: string | null): string {
  if (!s) return "?";
  const ch = s.trim().charAt(0).toUpperCase();
  return ch || "?";
}

export function StealthProfile() {
  const { state, logout } = useClientAuth();
  const navigate = useNavigate();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [subInfo, setSubInfo] = useState<{ daysLeft: number; active: boolean } | null>(null);
  const [showPayments, setShowPayments] = useState(false);

  useEffect(() => {
    api.getPublicConfig().then(setConfig).catch(() => {});
    if (state.token) {
      api.clientSubscription(state.token)
        .then((r) => {
          // Unwrap Remnawave-ответа: может прийти {response: {...}} или {data:{response:{...}}}
          const raw = r.subscription as Record<string, unknown> | null | undefined;
          let s: Record<string, unknown> | null = null;
          if (raw && typeof raw === "object") {
            if (raw.response && typeof raw.response === "object") s = raw.response as Record<string, unknown>;
            else if (raw.data && typeof raw.data === "object") {
              const d = raw.data as Record<string, unknown>;
              if (d.response && typeof d.response === "object") s = d.response as Record<string, unknown>;
            } else s = raw;
          }
          const expireAt = typeof s?.expireAt === "string" ? s.expireAt : null;
          if (!expireAt) { setSubInfo({ daysLeft: 0, active: false }); return; }
          const t = new Date(expireAt).getTime();
          if (Number.isNaN(t)) { setSubInfo({ daysLeft: 0, active: false }); return; }
          const d = Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
          setSubInfo({ daysLeft: d, active: t > Date.now() });
        })
        .catch(() => setSubInfo(null));
    }
  }, [state.token]);

  const display = state.client?.email ?? state.client?.telegramUsername ?? "Профиль";
  const langLabel = (state.client?.preferredLang ?? "ru") === "ru" ? "Русский" : (state.client?.preferredLang ?? "ru").toUpperCase();

  const sections: MenuSection[] = useMemo(() => {
    // Telegram-чат поддержки = admin's supportLink (поле «Поддержка» в админке).
    // Если не задан — пункт меню не показываем (вместо ссылки на бота, как было раньше).
    const supportTgUrl = (config as { supportLink?: string | null })?.supportLink?.trim() || null;
    // Из админки: agreementLink → пользовательское соглашение, offerLink → оферта, instructionsLink → инструкции.
    // Если ссылка пустая — пункт меню не показываем.
    const agreementUrl = (config as { agreementLink?: string | null })?.agreementLink?.trim() || null;
    const offerUrl = (config as { offerLink?: string | null })?.offerLink?.trim() || null;
    const instructionsUrl = (config as { instructionsLink?: string | null })?.instructionsLink?.trim() || null;
    const out: MenuSection[] = [
      {
        title: "Приложение",
        items: [
          { id: "language", label: "Язык", icon: Globe, rightLabel: langLabel, to: "/cabinet/profile?tab=language" },
          { id: "support", label: "Поддержка", icon: HelpCircle, to: "/cabinet/tickets" },
          { id: "referral", label: "Реферальная система", icon: Gift, to: "/cabinet/referral" },
        ],
      },
      {
        items: [
          // Featured rows (Hundler-style: red/green glow на CTA-пунктах)
          ...(supportTgUrl ? [{
            id: "tg-channel",
            label: "Telegram-чат поддержки",
            icon: MessageCircle,
            glow: "rose" as const,
            onClick: () => window.open(supportTgUrl, "_blank", "noopener,noreferrer"),
          }] : []),
          { id: "payments", label: "История платежей", icon: CreditCard, onClick: () => setShowPayments(true) },
          ...(agreementUrl ? [{
            id: "tos",
            label: "Пользовательское соглашение",
            icon: FileText,
            onClick: () => window.open(agreementUrl, "_blank", "noopener,noreferrer"),
          }] : []),
          ...(offerUrl ? [{
            id: "offer",
            label: "Публичная оферта",
            icon: Lock,
            onClick: () => window.open(offerUrl, "_blank", "noopener,noreferrer"),
          }] : []),
          ...(instructionsUrl ? [{
            id: "instructions",
            label: "Инструкции по подключению",
            icon: FileText,
            onClick: () => window.open(instructionsUrl, "_blank", "noopener,noreferrer"),
          }] : []),
        ],
      },
      {
        title: "Аккаунт",
        items: [
          // Note: Сменить пароль и 2FA пока используют classic-формы — переключайтесь
          // через админку на classic-дизайн чтобы их использовать. Stealth-modal
          // версии этих экранов в следующей итерации.
          { id: "logout", label: "Выйти", icon: LogOut, danger: true, onClick: () => { logout(); navigate("/cabinet/login"); } },
        ],
      },
    ];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, langLabel, logout]);

  return (
    <div className="px-4 pt-2 space-y-4 pb-2">
      {/* User card */}
      <button
        type="button"
        onClick={() => navigate("/cabinet/profile?tab=details")}
        className="w-full rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4 flex items-center gap-3 text-left hover:border-white/15 transition"
      >
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center font-bold text-lg text-white shrink-0 shadow-[0_0_24px_-6px_rgba(167,139,250,0.5)]">
          {avatarLetter(display)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{display}</div>
          {subInfo && (
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase">
              <span className={cn("h-1.5 w-1.5 rounded-full", subInfo.active ? "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)]" : "bg-zinc-500")} />
              <span className="text-zinc-300">
                {subInfo.active ? `Осталось ${subInfo.daysLeft} дн.` : "Без подписки"}
              </span>
            </div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
      </button>

      {/* Menu list-as-card */}
      <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 overflow-hidden divide-y divide-white/[0.04]">
        {sections.map((sec, sectionIdx) => (
          <div key={sectionIdx} className="py-1">
            {sec.title && (
              <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-500 px-4 py-2.5">
                {sec.title}
              </div>
            )}
            {sec.items.map((it) => {
              const Icon = it.icon;
              const glowStyle = it.glow ? {
                rose: "ring-1 ring-rose-500/40 shadow-[inset_0_0_20px_rgba(255,35,87,0.07)]",
                emerald: "ring-1 ring-emerald-500/40 shadow-[inset_0_0_20px_rgba(16,185,129,0.07)]",
                violet: "ring-1 ring-violet-500/40 shadow-[inset_0_0_20px_rgba(167,139,250,0.07)]",
                amber: "ring-1 ring-amber-500/40 shadow-[inset_0_0_20px_rgba(251,191,36,0.07)]",
              }[it.glow] : "";
              const onClick = it.onClick ?? (it.to ? () => navigate(it.to!) : undefined);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={onClick}
                  disabled={!onClick}
                  className={cn(
                    "w-full flex items-center gap-3 px-3.5 py-3 text-left transition",
                    "hover:bg-white/[0.03] disabled:opacity-50",
                    it.glow && "mx-2 my-1 rounded-xl",
                    glowStyle,
                  )}
                >
                  <div className={cn(
                    "h-9 w-9 rounded-lg border flex items-center justify-center shrink-0",
                    it.danger ? "bg-rose-500/15 border-rose-500/30" : "bg-zinc-800/60 border-white/10",
                  )}>
                    <Icon className={cn("h-4 w-4", it.danger ? "text-rose-400" : "text-zinc-300")} />
                  </div>
                  <span className={cn("flex-1 text-sm font-medium truncate", it.danger && "text-rose-400")}>{it.label}</span>
                  {it.rightLabel && <span className="text-xs text-zinc-500 shrink-0">{it.rightLabel}</span>}
                  <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Service info */}
      <div className="text-center text-[10px] text-zinc-600 pt-2">
        <Shield className="h-3 w-3 inline mr-1" />
        {(config?.serviceName ?? "STEALTHNET").toUpperCase()}
      </div>

      <StealthPaymentsModal open={showPayments} onClose={() => setShowPayments(false)} />
    </div>
  );
}
