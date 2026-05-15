/**
 * Webhook inbox: входящие webhook'и от Platega/YooKassa/Lava/Crypto/Heleket/YooMoney/Overpay.
 * Фильтр по провайдеру и outcome. Drawer с raw body + headers + кнопкой replay.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Inbox, ChevronRight, Repeat2, Search, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import {
  webhookInboxApi,
  type WebhookEventListItem,
  type WebhookEventDetail,
} from "@/lib/admin-extras-api";

const OUTCOME_META: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  accepted: { label: "Принят", cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30", icon: CheckCircle2 },
  rejected_signature: { label: "Подпись неверна", cls: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30", icon: XCircle },
  rejected_payload: { label: "Невалидный payload", cls: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30", icon: XCircle },
  payment_not_found: { label: "Платёж не найден", cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30", icon: AlertTriangle },
  payment_already_paid: { label: "Уже оплачен", cls: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30", icon: CheckCircle2 },
  payment_failed: { label: "FAILED от провайдера", cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30", icon: AlertTriangle },
  ignored_event: { label: "Игнор", cls: "text-slate-600 dark:text-slate-400 bg-slate-500/10 border-slate-500/30", icon: AlertTriangle },
  error: { label: "Ошибка обработки", cls: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30", icon: XCircle },
};

const PROVIDERS = ["platega", "yookassa", "yoomoney", "cryptopay", "heleket", "lava", "overpay"];

export function AdminWebhookInboxPage() {
  const { state } = useAuth();
  const token = state.accessToken;

  const [items, setItems] = useState<WebhookEventListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState("");
  const [outcome, setOutcome] = useState("");
  const [q, setQ] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<WebhookEventDetail | null>(null);
  const [replaying, setReplaying] = useState(false);

  const load = useCallback(async (reset = true) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await webhookInboxApi.list(token, {
        provider: provider || undefined,
        outcome: outcome || undefined,
        q: q || undefined,
        cursor: reset ? undefined : cursor || undefined,
        limit: 50,
      });
      setItems((prev) => (reset ? result.items : [...prev, ...result.items]));
      setCursor(result.nextCursor);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [token, provider, outcome, q, cursor]);

  useEffect(() => { void load(true); /* eslint-disable-next-line */ }, [provider, outcome]);

  useEffect(() => {
    if (!selectedId || !token) { setSelectedDetail(null); return; }
    webhookInboxApi.get(token, selectedId).then(setSelectedDetail).catch(() => {});
  }, [selectedId, token]);

  const handleReplay = async () => {
    if (!selectedId || !token) return;
    if (!confirm("Повторно отправить этот webhook нашему серверу? Создастся новая запись WebhookEvent с replay-меткой.")) return;
    setReplaying(true);
    try {
      const res = await webhookInboxApi.replay(token, selectedId);
      alert(`Replay выполнен. HTTP ${res.replayedHttpStatus ?? "?"}.`);
      await load(true);
    } catch (e) {
      alert(`Ошибка replay: ${e}`);
    } finally {
      setReplaying(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Inbox className="h-6 w-6 text-emerald-500" />
          <h1 className="text-2xl font-bold">Webhook inbox</h1>
        </div>
        <Button onClick={() => load(true)} variant="outline" size="sm" disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">Провайдер</Label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Все</option>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Результат</Label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Все</option>
              {Object.entries(OUTCOME_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Поиск (paymentId / error / body)</Label>
            <div className="mt-1.5 relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(true)} className="pl-8" placeholder="…" />
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300 mb-4">{error}</div> : null}

      <Card>
        <CardContent className="p-0">
          {items.length === 0 && !loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Нет webhook'ов. Capture включён только для Platega — для остальных провайдеров inbox пополнится после следующей итерации.
            </div>
          ) : (
            <div className="divide-y">
              {items.map((ev) => {
                const meta = OUTCOME_META[ev.outcome] ?? OUTCOME_META.ignored_event;
                const Icon = meta.icon;
                return (
                  <button key={ev.id} onClick={() => setSelectedId(ev.id)} className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-accent">
                    <div className="text-xs text-muted-foreground font-mono w-32 shrink-0">{new Date(ev.createdAt).toLocaleString("ru")}</div>
                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase w-24 shrink-0 justify-center bg-muted">{ev.provider}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                    <div className="text-xs text-muted-foreground flex-1 truncate">
                      {ev.paymentId ? <span className="font-mono">{ev.paymentId.slice(0, 16)}…</span> : null}
                      {ev.errorMessage ? <span className="ml-2">· {ev.errorMessage.slice(0, 80)}</span> : null}
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{ev.responseStatus} · {ev.durationMs ?? "—"}ms</span>
                    {ev.replayOfId ? <span className="text-[10px] inline-flex items-center gap-0.5 text-cyan-600 dark:text-cyan-400"><Repeat2 className="h-3 w-3" /></span> : null}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
              {cursor ? (
                <div className="p-3 text-center">
                  <Button onClick={() => load(false)} variant="outline" size="sm" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Загрузить ещё"}</Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedDetail?.provider}
              <span className="text-xs text-muted-foreground font-mono">{selectedDetail?.id.slice(0, 12)}…</span>
            </DialogTitle>
          </DialogHeader>
          {selectedDetail ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${(OUTCOME_META[selectedDetail.outcome] ?? OUTCOME_META.ignored_event).cls}`}>
                  {(OUTCOME_META[selectedDetail.outcome] ?? OUTCOME_META.ignored_event).label}
                </span>
                <span className="text-xs text-muted-foreground">HTTP {selectedDetail.responseStatus}</span>
                <span className="text-xs text-muted-foreground">{selectedDetail.durationMs ?? "?"} ms</span>
                <span className="text-xs text-muted-foreground">{new Date(selectedDetail.createdAt).toLocaleString("ru")}</span>
                <span className="text-xs text-muted-foreground font-mono">IP {selectedDetail.remoteIp ?? "—"}</span>
              </div>
              {selectedDetail.errorMessage ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <strong>Error:</strong> {selectedDetail.errorMessage}
                </div>
              ) : null}
              <div>
                <Label className="text-xs text-muted-foreground">Headers</Label>
                <pre className="mt-1 max-h-40 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs font-mono">{JSON.stringify(selectedDetail.headers, null, 2)}</pre>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Raw body</Label>
                <pre className="mt-1 max-h-96 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap break-all">{selectedDetail.rawBody}</pre>
              </div>
              <div className="flex gap-2 border-t pt-3">
                <Button onClick={handleReplay} disabled={replaying} className="gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white">
                  {replaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat2 className="h-4 w-4" />}
                  Повторить webhook
                </Button>
                {selectedDetail.replayOfId ? (
                  <Button onClick={() => setSelectedId(selectedDetail.replayOfId)} variant="outline" size="sm" className="gap-1.5">
                    Перейти к оригиналу
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
