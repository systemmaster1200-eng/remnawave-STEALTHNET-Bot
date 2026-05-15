/**
 * WizardHeader — header для multi-step wizard'ов в Stealth-стиле.
 *
 * Структура (как у Hundler VPN):
 *   ┌──────────────────────────────────────┐
 *   │ [<]    1 ИЗ 3              [✕]      │
 *   ├──────────────────────────────────────┤
 *   │ ███───────────────────────────────  │ ← прогресс-бар (3 сегмента)
 *   └──────────────────────────────────────┘
 *
 * Сегменты прогресса:
 *  - пройденные: pure rose-500
 *  - текущий: ярко rose-500 (тот же)
 *  - будущие: zinc-800
 */

import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  step: number;       // 1-based
  totalSteps: number;
  onBack?: () => void;
  onClose?: () => void;
}

export function WizardHeader({ step, totalSteps, onBack, onClose }: Props) {
  return (
    <div className="px-4 pt-1">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={!onBack || step <= 1}
          className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] active:scale-95 transition disabled:opacity-30"
          aria-label="Назад"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="text-sm font-medium tabular-nums">
          <span className="text-white">{step}</span>
          <span className="text-zinc-500 mx-2 tracking-[0.2em] text-[11px]">ИЗ</span>
          <span className="text-zinc-500">{totalSteps}</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={!onClose}
          className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] active:scale-95 transition disabled:opacity-30"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Прогресс-бар */}
      <div className="flex gap-1.5 mt-3">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-[3px] flex-1 rounded-full transition-colors",
              i + 1 < step && "bg-rose-500/70",
              i + 1 === step && "bg-rose-500 shadow-[0_0_8px_rgba(255,35,87,0.5)]",
              i + 1 > step && "bg-zinc-800",
            )}
          />
        ))}
      </div>
    </div>
  );
}
