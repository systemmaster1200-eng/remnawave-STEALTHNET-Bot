/**
 * StadiumButton — стадион-pill кнопки в стиле Stealth.
 *
 * Варианты (вдохновлено Hundler VPN):
 *   - primary    — solid red, белый текст, red glow вокруг
 *   - white      — БЕЛЫЙ фон, чёрный текст (для главного Buy CTA)
 *   - outline    — прозрачный, с border, белый текст
 *   - ghost      — без border, hover/active заливка
 *   - highlight  — тёмный + красный glow border (focused/recommended item)
 *
 * Радиус всегда `rounded-full` (полностью pill), высота 52px на mobile, 56px на md+.
 */

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "white" | "outline" | "ghost" | "highlight" | "danger";
type Size = "md" | "lg" | "sm";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const VARIANT_STYLES: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-blue-500 via-blue-600 to-blue-700 text-white font-semibold " +
    "shadow-[0_0_32px_-4px_rgba(47,107,255,0.55),0_10px_28px_-8px_rgba(47,107,255,0.65),inset_0_1px_0_rgba(255,255,255,0.25)] " +
    "hover:-translate-y-0.5 hover:shadow-[0_0_44px_-4px_rgba(47,107,255,0.7),0_14px_34px_-8px_rgba(47,107,255,0.75),inset_0_1px_0_rgba(255,255,255,0.3)] " +
    "active:translate-y-0 active:scale-[0.98]",
  white:
    "bg-white text-black font-semibold " +
    "shadow-[0_8px_28px_-6px_rgba(255,255,255,0.25),inset_0_-2px_8px_rgba(0,0,0,0.06)] " +
    "hover:-translate-y-0.5 hover:shadow-[0_12px_36px_-6px_rgba(255,255,255,0.35)] hover:bg-zinc-50 " +
    "active:translate-y-0 active:scale-[0.98]",
  outline:
    "bg-white/[0.02] text-white font-medium border border-white/15 backdrop-blur-xl " +
    "hover:bg-white/[0.06] hover:border-white/25 active:scale-[0.98]",
  ghost:
    "bg-white/[0.04] text-white font-medium border border-white/[0.07] backdrop-blur-xl " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] " +
    "hover:bg-white/[0.08] hover:border-white/15 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_24px_-12px_rgba(47,107,255,0.25)] " +
    "active:scale-[0.98]",
  highlight:
    "bg-zinc-900/70 text-white font-semibold border border-blue-500/40 backdrop-blur-xl " +
    "shadow-[0_0_28px_-4px_rgba(47,107,255,0.3),inset_0_0_20px_rgba(47,107,255,0.06),inset_0_1px_0_rgba(255,255,255,0.08)] " +
    "hover:border-blue-500/60 hover:shadow-[0_0_40px_-4px_rgba(47,107,255,0.5),inset_0_0_24px_rgba(47,107,255,0.1)] active:scale-[0.98]",
  danger:
    "bg-gradient-to-b from-red-500 via-red-600 to-red-700 text-white font-semibold " +
    "shadow-[0_0_32px_-4px_rgba(239,68,68,0.55),0_10px_28px_-8px_rgba(239,68,68,0.65),inset_0_1px_0_rgba(255,255,255,0.25)] " +
    "hover:-translate-y-0.5 hover:shadow-[0_0_44px_-4px_rgba(239,68,68,0.75),0_14px_34px_-8px_rgba(239,68,68,0.8),inset_0_1px_0_rgba(255,255,255,0.3)] " +
    "active:translate-y-0 active:scale-[0.98]",
};

const SIZE_STYLES: Record<Size, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-13 px-5 text-sm md:h-14 md:px-6 md:text-base",
  lg: "h-14 px-6 text-base md:h-16 md:px-8",
};

export const StadiumButton = forwardRef<HTMLButtonElement, Props>(function StadiumButton(
  { variant = "primary", size = "md", fullWidth = true, iconLeft, iconRight, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-full transition-all duration-300",
        "disabled:opacity-50 disabled:pointer-events-none",
        "focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 focus:ring-offset-[#03070f]",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
});
