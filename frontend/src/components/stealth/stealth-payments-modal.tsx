/**
 * StealthPaymentsModal — история платежей клиента в lightbox-модалке.
 *
 * Использует api.clientPayments. Показывает:
 *  - Сумма + валюта (большой шрифт)
 *  - Статус (PAID/FAILED/PENDING/REFUNDED) с цветом
 *  - Дата платежа (paidAt или createdAt)
 *  - Order ID (мелкий моно)
 *
 * Empty state: «Платежей пока нет».
 */

import { useEffect, useState } from "react";
import { Loader2, Receipt, Check, X as XIcon, Clock, RefreshCcw } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientPayment } from "@/lib/api";
import { StealthModal } from "./stealth-modal";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

function statusMeta(status: string) {
  if (status === "PAID") return { label: "Оплачено", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", Icon: Check };
  if (status === "FAILED") return { label: "Неудачно", color: "text-rose-400 bg-rose-500/10 border-rose-500/30", Icon: XIcon };
  if (status === "REFUNDED") return { label: "Возврат", color: "text-violet-400 bg-violet-500/10 border-violet-500/30", Icon: RefreshCcw };
  return { label: "Ожидает", color: "text-amber-400 bg-amber-500/10 border-amber-500/30", Icon: Clock };
}

function fmtAmount(n: number, currency: string) {
  const sym = currency.toUpperCase() === "RUB" ? "₽" : currency.toUpperCase() === "USD" ? "$" : currency.toUpperCase();
  return `${Math.round(n)}${sym}`;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

export function StealthPaymentsModal({ open, onClose }: Props) {
  const { state } = useClientAuth();
  const [items, setItems] = useState<ClientPayment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !state.token) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    api.clientPayments(state.token)
      .then((r) => { if (alive) setItems(r.items ?? []); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Не удалось загрузить"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, state.token]);

  return (
    <StealthModal open={open} onClose={onClose} title="История платежей">
      <div className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-rose-500" />
          </div>
        ) : err ? (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-200">{err}</div>
        ) : !items || items.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/40 p-8 text-center">
            <div className="h-12 w-12 mx-auto rounded-xl bg-zinc-800/60 border border-white/10 flex items-center justify-center mb-2">
              <Receipt className="h-5 w-5 text-zinc-400" />
            </div>
            <p className="text-sm text-zinc-400">Платежей пока нет</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto -mx-1 px-1">
            {items.map((p) => {
              const m = statusMeta(p.status);
              const Icon = m.Icon;
              return (
                <div
                  key={p.id}
                  className="rounded-2xl border border-white/[0.06] bg-zinc-950/40 p-3 flex items-center gap-3"
                >
                  <div className={cn("h-10 w-10 rounded-xl border flex items-center justify-center shrink-0", m.color)}>
                    <Icon className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-bold text-sm tabular-nums">{fmtAmount(p.amount, p.currency)}</span>
                      <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", m.color)}>
                        {m.label}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 flex items-center gap-2">
                      <span>{fmtDate(p.paidAt ?? p.createdAt)}</span>
                      <span className="font-mono truncate">#{p.orderId.slice(-10)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </StealthModal>
  );
}
