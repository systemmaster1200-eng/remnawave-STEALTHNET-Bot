/**
 * StealthModal — lightbox-стиль модалка для Stealth-дизайна.
 *
 * Открывается поверх контента: тёмный backdrop с blur, в центре карточка с
 * заголовком и close-X. Контент модалки — children. Idiom как у Hundler:
 * не fullscreen, а compact-card.
 */

import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** maxWidth для карточки (по умолчанию 28rem = max-w-md). */
  maxWidth?: string;
}

export function StealthModal({ open, onClose, title, children, maxWidth = "28rem" }: Props) {
  // Закрытие по Escape + блокировка скролла body
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center pb-24 sm:pb-0 px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Card */}
      <div
        className={cn(
          "relative w-full rounded-3xl border border-white/[0.08] bg-zinc-900/95 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)]",
          "p-5 max-h-[80vh] overflow-y-auto",
          "animate-in slide-in-from-bottom-4 duration-200",
        )}
        style={{ maxWidth }}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-bold tracking-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] active:scale-95 transition shrink-0"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
