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

type Variant = "primary" | "white" | "outline" | "ghost" | "highlight";
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
    "bg-gradient-to-b from-rose-500 to-rose-600 text-white font-semibold " +
    "shadow-[0_0_24px_rgba(255,35,87,0.45),0_8px_24px_-8px_rgba(255,35,87,0.6)] " +
    "hover:from-rose-500 hover:to-rose-500 active:scale-[0.98]",
  white:
    "bg-white text-black font-semibold " +
    "shadow-[0_8px_28px_-6px_rgba(255,255,255,0.25)] " +
    "hover:bg-zinc-100 active:scale-[0.98]",
  outline:
    "bg-transparent text-white font-medium border border-white/15 " +
    "hover:bg-white/[0.04] active:scale-[0.98]",
  ghost:
    "bg-white/[0.04] text-white font-medium " +
    "hover:bg-white/[0.08] active:scale-[0.98]",
  highlight:
    "bg-zinc-900/80 text-white font-semibold border border-rose-500/40 " +
    "shadow-[0_0_28px_-4px_rgba(255,35,87,0.3),inset_0_0_20px_rgba(255,35,87,0.06)] " +
    "hover:border-rose-500/60 hover:shadow-[0_0_36px_-4px_rgba(255,35,87,0.45)] active:scale-[0.98]",
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
        "relative inline-flex items-center justify-center gap-2 rounded-full transition-all duration-200",
        "disabled:opacity-50 disabled:pointer-events-none",
        "focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:ring-offset-2 focus:ring-offset-[#020202]",
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
