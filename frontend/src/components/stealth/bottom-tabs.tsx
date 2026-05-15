/**
 * BottomTabs — нижняя навигация для Stealth-дизайна.
 *
 * 3 вкладки: Главная / Поддержка / Профиль (как у Hundler VPN).
 * Активная: иконка + label красные + короткий красный underline-bar (3px высоты,
 * ~24px ширины) под лейблом.
 *
 * Sticky bottom, безопасная зона iOS (env(safe-area-inset-bottom)).
 */

import { Link, useLocation } from "react-router-dom";
import { Shield, HelpCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface Tab {
  to: string;
  label: string;
  icon: typeof Shield;
}

const TABS: Tab[] = [
  { to: "/cabinet/dashboard", label: "ГЛАВНАЯ", icon: Shield },
  { to: "/cabinet/tickets", label: "ПОДДЕРЖКА", icon: HelpCircle },
  { to: "/cabinet/profile", label: "ПРОФИЛЬ", icon: User },
];

export function BottomTabs() {
  const location = useLocation();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 bg-[#020202]/95 backdrop-blur-xl border-t border-white/[0.04]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto max-w-md grid grid-cols-3 px-4 pt-2 pb-2">
        {TABS.map((t) => {
          const active = location.pathname === t.to ||
            (t.to === "/cabinet/dashboard" && location.pathname === "/cabinet");
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className="relative flex flex-col items-center gap-1 py-1 transition-all"
              aria-current={active ? "page" : undefined}
            >
              <Icon
                className={cn(
                  "h-5 w-5 transition-colors",
                  active ? "text-rose-500" : "text-zinc-500",
                )}
                strokeWidth={active ? 2.4 : 2}
              />
              <span
                className={cn(
                  "text-[10px] font-bold tracking-[0.12em] transition-colors",
                  active ? "text-rose-500" : "text-zinc-500",
                )}
              >
                {t.label}
              </span>
              {active && (
                <span className="absolute -bottom-1 h-[3px] w-6 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(255,35,87,0.6)]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
