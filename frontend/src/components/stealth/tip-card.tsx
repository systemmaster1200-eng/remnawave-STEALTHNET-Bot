/**
 * TipCard — цветная информационная карточка с иконкой-плашкой слева.
 * Используется для:
 *   - Правил рефералки (зелёный/красный/жёлтый)
 *   - FAQ
 *   - Условий промокодов
 *   - Алертов внутри страниц
 *
 * Цветовая палитра:
 *   - emerald — позитивный (бонус)
 *   - rose    — рекуррентный/CTA
 *   - amber   — предупреждение/условие
 *   - sky     — нейтральный/инфо
 *   - violet  — premium/recommended
 */

import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "emerald" | "rose" | "amber" | "sky" | "violet";

interface Props {
  tone: Tone;
  icon: LucideIcon;
  title: ReactNode;
  /** Опциональный chip-tag (например "+5") в правой части заголовка. */
  chip?: ReactNode;
  children: ReactNode;
  className?: string;
}

const TONES: Record<Tone, { card: string; iconBg: string; iconColor: string; title: string; chip: string }> = {
  emerald: {
    card: "bg-emerald-500/[0.08] border-emerald-500/30",
    iconBg: "bg-emerald-500/15 border-emerald-500/30",
    iconColor: "text-emerald-400",
    title: "text-emerald-100",
    chip: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  },
  rose: {
    card: "bg-rose-500/[0.06] border-rose-500/30",
    iconBg: "bg-rose-500/15 border-rose-500/30",
    iconColor: "text-rose-400",
    title: "text-rose-100",
    chip: "bg-rose-500/20 text-rose-200 border-rose-500/40",
  },
  amber: {
    card: "bg-amber-500/[0.06] border-amber-500/30",
    iconBg: "bg-amber-500/15 border-amber-500/30",
    iconColor: "text-amber-400",
    title: "text-amber-100",
    chip: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  },
  sky: {
    card: "bg-sky-500/[0.06] border-sky-500/30",
    iconBg: "bg-sky-500/15 border-sky-500/30",
    iconColor: "text-sky-400",
    title: "text-sky-100",
    chip: "bg-sky-500/20 text-sky-200 border-sky-500/40",
  },
  violet: {
    card: "bg-violet-500/[0.06] border-violet-500/30",
    iconBg: "bg-violet-500/15 border-violet-500/30",
    iconColor: "text-violet-400",
    title: "text-violet-100",
    chip: "bg-violet-500/20 text-violet-200 border-violet-500/40",
  },
};

export function TipCard({ tone, icon: Icon, title, chip, children, className }: Props) {
  const t = TONES[tone];
  return (
    <div className={cn("rounded-2xl border p-3.5", t.card, className)}>
      <div className="flex items-start gap-3">
        <div className={cn("h-9 w-9 rounded-lg border flex items-center justify-center shrink-0", t.iconBg)}>
          <Icon className={cn("h-4 w-4", t.iconColor)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className={cn("text-sm font-semibold tracking-tight", t.title)}>{title}</h4>
            {chip && (
              <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-bold", t.chip)}>{chip}</span>
            )}
          </div>
          <div className="text-xs text-zinc-300/80 mt-1.5 leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
