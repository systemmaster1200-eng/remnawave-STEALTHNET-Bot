/**
 * Bot conversation viewer (pragmatic).
 *
 * Слева — список клиентов с TG-аккаунтами + поиск. Справа — timeline
 * взаимодействий (регистрация, оплаты, рассылки, тикеты, gift, admin actions).
 */

import { useEffect, useState, useCallback } from "react";
import {
  MessageSquare, Loader2, Search, RefreshCw, User, Send, CreditCard,
  ShieldCheck, Ticket, Gift, AlertCircle, UserPlus, Mail, MessagesSquare,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { botConversationsApi, type BotConversationListItem, type TimelineEvent } from "@/lib/admin-extras-api";

const KIND_META: Record<TimelineEvent["kind"], { color: string; Icon: typeof User }> = {
  registered:        { color: "text-emerald-500", Icon: UserPlus },
  payment_paid:      { color: "text-emerald-500", Icon: CreditCard },
  payment_failed:    { color: "text-rose-500", Icon: AlertCircle },
  payment_refunded:  { color: "text-violet-500", Icon: CreditCard },
  broadcast:         { color: "text-sky-500", Icon: Send },
  ticket_opened:     { color: "text-amber-500", Icon: Ticket },
  ticket_message:    { color: "text-amber-500", Icon: MessagesSquare },
  gift:              { color: "text-pink-500", Icon: Gift },
  admin_action:      { color: "text-foreground", Icon: ShieldCheck },
};

export function AdminBotConversationsPage() {
  const { state } = useAuth();
  const [items, setItems] = useState<BotConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ client: Record<string, unknown>; events: TimelineEvent[]; stats: Record<string, number> } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!state.accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await botConversationsApi.list(state.accessToken, { q: search, limit: 100 });
      setItems(Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
    }
  }, [state.accessToken, search]);

  useEffect(() => { load(); }, [load]);

  async function selectClient(id: string) {
    if (!state.accessToken) return;
    setActiveId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const r = await botConversationsApi.detail(state.accessToken, id);
      setDetail(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "detail error");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="w-full space-y-4 px-4 sm:px-6 md:px-8 pt-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <MessageSquare className="h-6 w-6 text-cyan-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Активность клиентов</h1>
            <p className="text-sm text-muted-foreground mt-1">Timeline всех событий по клиенту: оплаты, рассылки, тикеты, действия админа</p>
          </div>
        </div>
      </div>

      {err && (
        <Card className="p-3 bg-rose-500/10 border-rose-500/30 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
          <p className="text-xs text-rose-500">{err}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* LEFT: list */}
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-3 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] overflow-y-auto">
          <div className="flex items-center gap-1 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput.trim()); }}
                placeholder="@username, TG id, email"
                className="pl-9 h-9 text-xs"
              />
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSearch(searchInput.trim())} className="h-9 px-2"><Search className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={() => load()} className="h-9 px-2"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></Button>
          </div>

          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-4">{search ? "Ничего не найдено" : "Нет клиентов"}</p>
          ) : (
            <div className="space-y-1.5">
              {items.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectClient(c.id)}
                  className={cn(
                    "w-full text-left rounded-xl p-2.5 transition",
                    c.id === activeId
                      ? "bg-primary/15 border border-primary/30"
                      : "hover:bg-foreground/[0.04] border border-transparent",
                    c.isBlocked && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center text-[10px] shrink-0",
                      c.isBlocked ? "bg-rose-500/15 text-rose-500" : "bg-primary/10 text-primary",
                    )}>
                      <User className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 text-xs">
                        <span className="font-medium truncate">
                          {c.telegramUsername ? `@${c.telegramUsername}` : c.email ?? c.telegramId ?? c.id.slice(0, 10)}
                        </span>
                        {c.telegramUnreachable && <Mail className="h-3 w-3 text-amber-500" />}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span title="платежей">💳 {c.counts.payments}</span>
                        <span title="тикетов">🎫 {c.counts.tickets}</span>
                        <span title="рассылок">📤 {c.counts.broadcasts}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* RIGHT: timeline */}
        {!activeId ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-12 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Выберите клиента слева чтобы увидеть его активность</p>
          </Card>
        ) : detailLoading ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-12 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </Card>
        ) : detail ? (
          <div className="space-y-3">
            {/* Client summary */}
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-4">
              <div className="grid sm:grid-cols-5 gap-3 text-xs">
                {Object.entries(detail.stats).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/10 p-2 text-center">
                    <div className="text-lg font-bold tabular-nums">{v}</div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">{k.replace(/([A-Z])/g, " $1").toLowerCase().trim()}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Timeline */}
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-4">
              <h3 className="text-sm font-semibold mb-3">Timeline ({detail.events.length})</h3>
              {detail.events.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-4">Событий нет</p>
              ) : (
                <ol className="relative border-l-2 border-white/10 ml-3 space-y-3">
                  {detail.events.map((e, i) => {
                    const meta = KIND_META[e.kind];
                    const Icon = meta.Icon;
                    return (
                      <li key={i} className="ml-4 pl-3">
                        <div className={cn("absolute -left-[11px] mt-0.5 h-5 w-5 rounded-full bg-background border-2 border-white/10 flex items-center justify-center", meta.color)}>
                          <Icon className="h-3 w-3" />
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums font-mono">{new Date(e.ts).toLocaleString("ru-RU")}</div>
                        <div className="text-sm font-medium text-foreground">{e.title}</div>
                        {e.detail && <div className="text-xs text-muted-foreground mt-0.5 break-words">{e.detail}</div>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
