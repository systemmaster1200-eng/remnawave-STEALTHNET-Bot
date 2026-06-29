import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, MessageCircle, ShieldAlert, X } from "lucide-react";

/**
 * Напоминание о привязке аккаунта — компактная модалка строго по центру экрана.
 *
 * Показывается при открытии кабинета, если у клиента отсутствует email и/или
 * Telegram, чтобы он не потерял доступ. Содержимое зависит от того, что не
 * привязано. «Привязать» ведёт на /cabinet/connect, «Добавлю позже» закрывает
 * и запоминает выбор (onDismiss).
 */
export function LinkReminderModal({
  open,
  missingEmail,
  missingTelegram,
  onClose,
  onDismiss,
}: {
  open: boolean;
  missingEmail: boolean;
  missingTelegram: boolean;
  /** Закрыть без запоминания (перед переходом на привязку). */
  onClose: () => void;
  /** «Добавлю позже» / крестик / фон — закрыть и запомнить выбор. */
  onDismiss: () => void;
}) {
  const navigate = useNavigate();
  const bothMissing = missingEmail && missingTelegram;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  function go(type: "email" | "telegram") {
    onClose();
    navigate(`/cabinet/connect?type=${type}`);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onDismiss} />
      <div className="relative w-full max-w-[20rem] rounded-2xl border border-white/10 bg-zinc-950/95 p-4 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)] animate-in fade-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Закрыть"
          className="absolute top-3 right-3 h-7 w-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200 transition"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="flex flex-col items-center text-center gap-2.5 pt-1">
          <div className="h-11 w-11 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
            <ShieldAlert className="h-5 w-5 text-rose-400" />
          </div>
          <h3 className="text-base font-bold text-zinc-100">Не потеряйте доступ</h3>
          <p className="text-[13px] text-zinc-400 leading-snug">
            {bothMissing
              ? "Привяжите Email и Telegram, чтобы не потерять доступ к аккаунту."
              : missingEmail
                ? "Привяжите Email, чтобы не потерять доступ и входить по почте."
                : "Привяжите Telegram, чтобы не потерять доступ и получать уведомления."}
          </p>
        </div>

        <div className="mt-4 space-y-2">
          {missingEmail && (
            <button
              type="button"
              onClick={() => go("email")}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500/90 hover:bg-blue-500 text-white text-[13px] font-semibold py-2.5 transition active:scale-[0.98]"
            >
              <Mail className="h-4 w-4" /> Привязать Email
            </button>
          )}
          {missingTelegram && (
            <button
              type="button"
              onClick={() => go("telegram")}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500/90 hover:bg-blue-500 text-white text-[13px] font-semibold py-2.5 transition active:scale-[0.98]"
            >
              <MessageCircle className="h-4 w-4" /> Привязать Telegram
            </button>
          )}

          <button
            type="button"
            onClick={onDismiss}
            className="w-full py-2 text-[12px] font-medium text-zinc-500 hover:text-zinc-300 transition"
          >
            Добавлю позже
          </button>
        </div>
      </div>
    </div>
  );
}
