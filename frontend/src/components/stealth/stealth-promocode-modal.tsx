/**
 * StealthPromocodeModal — простой ввод промокода + Активировать.
 * Минимализм по образу Hundler VPN — только input + кнопка, без истории.
 */

import { useState } from "react";
import { Check, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { StealthModal } from "./stealth-modal";
import { StadiumButton } from "./stadium-button";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Колбэк после успешной активации — для обновления UI родителя. */
  onActivated?: () => void;
}

export function StealthPromocodeModal({ open, onClose, onActivated }: Props) {
  const { state, refreshProfile } = useClientAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function reset() {
    setCode("");
    setResult(null);
    setBusy(false);
  }

  async function activate() {
    if (!state.token || !code.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      // 1. Проверяем валидность
      await api.clientCheckPromoCode(state.token, code.trim());
      // 2. Активируем
      const r = await api.clientActivatePromoCode(state.token, code.trim());
      setResult({ ok: true, message: r.message ?? "Промокод применён" });
      await refreshProfile().catch(() => {});
      onActivated?.();
      // Авто-закрытие через 2 сек после успеха
      setTimeout(() => { reset(); onClose(); }, 2000);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Промокод недействителен" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <StealthModal open={open} onClose={() => { reset(); onClose(); }} title="Промокоды">
      <div className="space-y-3">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value); setResult(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && code.trim() && !busy) activate(); }}
          placeholder="Введите промокод"
          className="w-full rounded-2xl bg-zinc-950/60 border border-white/[0.08] px-4 py-3.5 text-sm placeholder-zinc-500 outline-none focus:border-rose-500/40 transition"
          autoFocus
        />

        {result && (
          <div className={cn(
            "rounded-xl border p-3 flex items-start gap-2 text-xs",
            result.ok ? "bg-emerald-500/10 border-emerald-500/30" : "bg-rose-500/10 border-rose-500/30",
          )}>
            {result.ok ? <Check className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />}
            <span className={result.ok ? "text-emerald-200" : "text-rose-200"}>{result.message}</span>
          </div>
        )}

        <StadiumButton
          variant="primary"
          size="md"
          iconLeft={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          onClick={activate}
          disabled={busy || !code.trim()}
        >
          {busy ? "Активация…" : "Активировать"}
        </StadiumButton>
      </div>
    </StealthModal>
  );
}
