/**
 * BottomTabs — нижняя навигация для Stealth-дизайна.
 *
 * левитирующая glass-капсула: отступы от краёв
 * экрана, скруглённые края, backdrop-blur, blue-glow. Активная вкладка —
 * стеклянная pill-подсветка, плавно перетекающая между вкладками
 * (framer-motion layoutId) + пульсирующий underline.
 *
 * Fixed bottom с безопасной зоной iOS (env(safe-area-inset-bottom)).
 */

import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
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
      className="fixed inset-x-0 bottom-0 z-30 pointer-events-none px-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className={cn(
          "pointer-events-auto relative mx-auto max-w-md overflow-hidden",
          "rounded-[1.75rem] border border-white/[0.08]",
          "bg-zinc-900/70 backdrop-blur-2xl",
          "shadow-[0_12px_40px_-12px_rgba(0,0,0,0.85),0_0_28px_-14px_rgba(47,107,255,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]",
        )}
      >
        {/* верхний стеклянный блик */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="pointer-events-none absolute -top-10 left-1/2 h-16 w-40 -translate-x-1/2 rounded-full bg-blue-500/10 blur-2xl" />

        <div className="relative grid grid-cols-3 px-3 py-2">
          {TABS.map((t) => {
            const active = location.pathname === t.to ||
              (t.to === "/cabinet/dashboard" && location.pathname === "/cabinet");
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className="relative flex flex-col items-center gap-1 rounded-2xl px-2 py-1.5 transition-all active:scale-95"
                aria-current={active ? "page" : undefined}
              >
                {/* стеклянная pill активной вкладки — плавно перетекает между табами */}
                {active && (
                  <motion.span
                    layoutId="stealth-tab-pill"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-2xl bg-white/[0.06] border border-blue-500/25 shadow-[0_0_18px_-6px_rgba(47,107,255,0.5),inset_0_1px_0_rgba(255,255,255,0.06)]"
                  />
                )}
                <Icon
                  className={cn(
                    "relative h-5 w-5 transition-colors duration-300",
                    active ? "text-blue-500 drop-shadow-[0_0_6px_rgba(47,107,255,0.6)]" : "text-zinc-500",
                  )}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span
                  className={cn(
                    "relative text-[10px] font-bold tracking-[0.12em] transition-colors duration-300",
                    active ? "text-blue-400" : "text-zinc-500",
                  )}
                >
                  {t.label}
                </span>
                {active && (
                  <motion.span
                    layoutId="stealth-tab-underline"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute bottom-0.5 h-[3px] w-6 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 shadow-[0_0_10px_rgba(47,107,255,0.7)]"
                  />
                )}
              </Link>
            );
          })}
        </div>
      </motion.div>
    </nav>
  );
}
