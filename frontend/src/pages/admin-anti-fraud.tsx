/**
 * Anti-fraud signals page.
 *
 * Показывает 8 сигналов от backend'а в виде карточек. По клику на карточку —
 * раскрывается список конкретных подозрительных записей.
 */

import { useEffect, useState } from "react";
import { ShieldAlert, AlertCircle, AlertTriangle, Info, Loader2, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { antiFraudApi, type FraudSignal } from "@/lib/admin-extras-api";

function severityColors(s: FraudSignal["severity"]) {
  if (s === "error") return { ring: "border-rose-500/30", bg: "bg-rose-500/5", text: "text-rose-500", Icon: AlertCircle };
  if (s === "warn") return { ring: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-500", Icon: AlertTriangle };
  return { ring: "border-sky-500/20", bg: "bg-sky-500/5", text: "text-sky-500", Icon: Info };
}

export function AdminAntiFraudPage() {
  const { state } = useAuth();
  const [signals, setSignals] = useState<FraudSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, Record<string, unknown>[]>>({});
  const [generatedAt, setGeneratedAt] = useState<string>("");

  async function load() {
    if (!state.accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await antiFraudApi.signals(state.accessToken);
      setSignals(Array.isArray(r?.signals) ? r.signals : []);
      setGeneratedAt(r?.generatedAt ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state.accessToken]);

  async function expand(key: string) {
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    if (!expandedItems[key] && state.accessToken) {
      try {
        const r = await antiFraudApi.detail(state.accessToken, key, 100);
        setExpandedItems((prev) => ({ ...prev, [key]: r.items }));
      } catch (e) {
        console.error(e);
      }
    }
  }

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 md:px-8 pt-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <ShieldAlert className="h-6 w-6 text-rose-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-rose-500/80 to-foreground/60">
              Anti-fraud signals
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Подозрительные паттерны в данных. Read-only — ничего не блокирует автоматически.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl gap-2">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Обновить
        </Button>
      </div>

      {err && (
        <Card className="p-4 bg-rose-500/10 border-rose-500/30">
          <p className="text-sm text-rose-500">{err}</p>
        </Card>
      )}

      {loading && signals.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-3">
          {signals.map((s) => {
            const c = severityColors(s.severity);
            const expanded = expandedKey === s.key;
            const items = expandedItems[s.key];
            return (
              <Card key={s.key} className={cn("border", c.ring, c.bg, "rounded-2xl overflow-hidden transition")}>
                <button
                  onClick={() => expand(s.key)}
                  className="w-full p-4 flex items-center gap-4 text-left hover:bg-foreground/[0.03] transition"
                >
                  <c.Icon className={cn("h-5 w-5 shrink-0", c.text)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground truncate">{s.label}</h3>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", c.bg, c.text)}>
                        {s.count}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                  </div>
                  {s.count > 0 && (expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />)}
                </button>

                {expanded && s.count > 0 && (
                  <div className="border-t border-white/10 p-3 bg-background/40">
                    {items === undefined ? (
                      <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                    ) : items.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic text-center py-2">нет записей</p>
                    ) : (
                      <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-xs">
                          <thead className="text-[10px] uppercase text-muted-foreground border-b border-white/5">
                            <tr>
                              {Object.keys(items[0]).map((k) => (
                                <th key={k} className="px-2 py-1.5 text-left font-semibold">{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {items.map((it, i) => (
                              <tr key={i} className="hover:bg-foreground/[0.02]">
                                {Object.entries(it).map(([k, v]) => (
                                  <td key={k} className="px-2 py-1.5 font-mono text-[10px] truncate max-w-[260px]">
                                    {Array.isArray(v) ? v.slice(0, 5).join(", ") : v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {generatedAt && (
        <p className="text-[11px] text-muted-foreground text-center pt-2">Сгенерировано: {new Date(generatedAt).toLocaleString("ru-RU")}</p>
      )}
    </div>
  );
}
