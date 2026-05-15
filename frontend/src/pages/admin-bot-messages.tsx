/**
 * Bot message editor — единый редактор всех bot_* строк.
 *
 * Сгруппирован по разделам (Меню / Тарифы / UI / Прочее). По клику открывается
 * редактор для конкретного ключа (text/json/markdown/boolean/number).
 */

import { useEffect, useState } from "react";
import { Bot, Loader2, RefreshCw, Save, Check, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { botMessagesApi, type BotMessage } from "@/lib/admin-extras-api";

export function AdminBotMessagesPage() {
  const { state } = useAuth();
  const [items, setItems] = useState<BotMessage[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    if (!state.accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await botMessagesApi.list(state.accessToken);
      const list = Array.isArray(r?.items) ? r.items : [];
      setItems(list);
      if (!activeKey && list.length > 0) {
        setActiveKey(list[0].key);
        setVal(list[0].value);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state.accessToken]);

  function select(item: BotMessage) {
    setActiveKey(item.key);
    setVal(item.value);
    setSaved(false);
  }

  const active = items.find((i) => i.key === activeKey);

  async function save() {
    if (!state.accessToken || !active) return;
    setBusy(true);
    setErr(null);
    try {
      // local validate JSON
      if (active.valueType === "json" && val.trim()) {
        try { JSON.parse(val); }
        catch { setErr("Невалидный JSON"); setBusy(false); return; }
      }
      await botMessagesApi.update(state.accessToken, active.key, val);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // обновляем item локально
      setItems((prev) => prev.map((i) => i.key === active.key ? { ...i, value: val } : i));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save error");
    } finally {
      setBusy(false);
    }
  }

  // group by .group
  const groups = items.reduce<Record<string, BotMessage[]>>((acc, m) => {
    if (!acc[m.group]) acc[m.group] = [];
    acc[m.group].push(m);
    return acc;
  }, {});

  return (
    <div className="w-full space-y-4 px-4 sm:px-6 md:px-8 pt-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <Bot className="h-6 w-6 text-violet-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Тексты бота</h1>
            <p className="text-sm text-muted-foreground mt-1">Все bot_* настройки в одном месте: меню, тарифы, оплата, кнопки</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl gap-2">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Обновить
        </Button>
      </div>

      {err && (
        <Card className="p-3 bg-rose-500/10 border-rose-500/30 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
          <p className="text-xs text-rose-500">{err}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* LEFT: groups */}
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-3 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            Object.entries(groups).map(([gname, gitems]) => (
              <div key={gname} className="mb-3">
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2 mb-1">{gname}</h4>
                <div className="space-y-1">
                  {gitems.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => select(m)}
                      className={cn(
                        "w-full text-left rounded-xl px-3 py-2 text-sm transition",
                        m.key === activeKey
                          ? "bg-primary/15 text-foreground font-medium border border-primary/30"
                          : "hover:bg-foreground/[0.04] text-muted-foreground border border-transparent",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate">{m.label}</span>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 ml-auto">{m.valueType}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </Card>

        {/* RIGHT: editor */}
        {active ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-5 space-y-3">
            <div>
              <h2 className="text-lg font-bold">{active.label}</h2>
              <p className="text-xs text-muted-foreground">{active.description}</p>
              <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">key: {active.key}</p>
              {active.variables && active.variables.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">Переменные: {active.variables.map((v) => <code key={v} className="bg-foreground/[0.05] px-1 rounded mx-0.5">{v}</code>)}</p>
              )}
            </div>

            {active.valueType === "boolean" ? (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={val === "true"}
                  onChange={(e) => { setVal(e.target.checked ? "true" : "false"); setSaved(false); }}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-sm">Включено: {val === "true" ? "да" : "нет"}</span>
              </div>
            ) : active.valueType === "number" ? (
              <Input type="number" value={val} onChange={(e) => { setVal(e.target.value); setSaved(false); }} />
            ) : (
              <textarea
                value={val}
                onChange={(e) => { setVal(e.target.value); setSaved(false); }}
                className={cn(
                  "w-full rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/10 p-3",
                  active.valueType === "json" || active.valueType === "markdown" ? "min-h-[320px] font-mono text-xs" : "min-h-[100px] text-sm",
                )}
                spellCheck={false}
              />
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-white/10">
              <Button onClick={save} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {saved ? "Сохранено" : "Сохранить"}
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-8 text-center text-sm text-muted-foreground">
            Выберите ключ слева
          </Card>
        )}
      </div>
    </div>
  );
}
