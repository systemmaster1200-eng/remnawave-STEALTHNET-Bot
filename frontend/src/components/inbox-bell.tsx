/**
 * Inbox Bell — глобальный indicator открытых тикетов / webhook-ошибок / failed
 * payments / cron failures и т.д. Грузит /api/admin/notifications/counters
 * каждые 60 секунд, рендерит badge с total и popover-список с переходами.
 *
 * Используется в dashboard-layout topbar.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, AlertTriangle, AlertCircle, Info, ChevronRight, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { notificationsApi, type NotificationCounter } from "@/lib/admin-extras-api";

const REFRESH_MS = 60_000;

function severityIcon(severity: NotificationCounter["severity"]) {
  switch (severity) {
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-rose-500" />;
    case "warn":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    default:
      return <Info className="h-3.5 w-3.5 text-sky-500" />;
  }
}

function severityRing(severity: NotificationCounter["severity"]) {
  switch (severity) {
    case "error": return "ring-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10";
    case "warn":  return "ring-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10";
    default:      return "ring-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10";
  }
}

export function InboxBell() {
  const { state } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationCounter[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    if (!state.accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await notificationsApi.counters(state.accessToken);
      // защитные проверки — на случай неожиданной формы ответа
      setItems(Array.isArray(r?.counters) ? r.counters : []);
      setTotal(typeof r?.total === "number" ? r.total : 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load error");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!state.accessToken) return;
    load();
    timerRef.current = setInterval(load, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken]);

  const safeItems = Array.isArray(items) ? items : [];
  const hasError = safeItems.some((i) => i.severity === "error");
  const hasWarn = safeItems.some((i) => i.severity === "warn");
  const dotColor = hasError ? "bg-rose-500" : hasWarn ? "bg-amber-500" : "bg-sky-500";

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs h-9 px-2.5 rounded-xl border border-transparent hover:border-white/10 bg-background/20 hover:bg-background/40 relative"
        onClick={() => setOpen((v) => !v)}
        title="Inbox"
      >
        <Bell className="h-4 w-4" />
        {total > 0 && (
          <span className={cn(
            "absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center text-white ring-2 ring-background",
            dotColor,
          )}>
            {total > 99 ? "99+" : total}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={cn(
            "absolute right-0 top-full z-50 mt-3 w-[calc(100vw-2rem)] sm:w-[360px] max-w-[360px] rounded-[1.5rem] border border-white/40 dark:border-white/10 bg-slate-200/60 dark:bg-slate-900/60 backdrop-blur-[32px] shadow-[0_10px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_10px_60px_rgba(0,0,0,0.5)]",
            "p-3"
          )}>
            <div className="flex items-center justify-between px-2 pb-2">
              <h4 className="text-sm font-semibold tracking-tight text-foreground">Inbox</h4>
              <button
                onClick={() => load()}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                disabled={loading}
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {loading ? "Обновление…" : "Обновить"}
              </button>
            </div>

            {err && (
              <div className="text-xs text-rose-500 px-2 pb-2">{err}</div>
            )}

            {!err && safeItems.length === 0 && !loading && (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                Всё чисто. Нет требующих внимания событий.
              </div>
            )}

            <div className="space-y-1.5">
              {safeItems.map((it) => (
                <Link
                  key={it.key}
                  to={it.url}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 transition-colors",
                    severityRing(it.severity),
                  )}
                >
                  {severityIcon(it.severity)}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{it.label}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{it.url}</div>
                  </div>
                  <span className="text-xs font-semibold text-foreground">{it.count}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
