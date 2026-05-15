/**
 * Аудит-лог админских действий: фильтры (kind, actor, targetType, диапазон дат, поиск),
 * пагинация по cursor'у, JSON payload в дровере.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, RefreshCw, ShieldAlert, ChevronRight } from "lucide-react";
import { auditApi, type AdminEvent, type AuditFacets } from "@/lib/admin-extras-api";

const KIND_COLOR: Record<string, string> = {
  block: "text-red-600 dark:text-red-400",
  unblock: "text-emerald-600 dark:text-emerald-400",
  refund: "text-amber-600 dark:text-amber-400",
  delete: "text-red-600 dark:text-red-400",
  create: "text-emerald-600 dark:text-emerald-400",
  update: "text-blue-600 dark:text-blue-400",
  publish: "text-violet-600 dark:text-violet-400",
  draw: "text-violet-600 dark:text-violet-400",
  login: "text-slate-600 dark:text-slate-400",
  logout: "text-slate-600 dark:text-slate-400",
  trigger: "text-orange-600 dark:text-orange-400",
  replay: "text-cyan-600 dark:text-cyan-400",
};

function colorOfKind(kind: string): string {
  for (const [k, v] of Object.entries(KIND_COLOR)) {
    if (kind.includes(k)) return v;
  }
  return "text-foreground";
}

export function AdminAuditPage() {
  const { state } = useAuth();
  const token = state.accessToken;

  const [items, setItems] = useState<AdminEvent[]>([]);
  const [facets, setFacets] = useState<AuditFacets | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminEvent | null>(null);

  const [filters, setFilters] = useState({ kind: "", actorId: "", targetType: "", q: "" });

  const load = useCallback(async (reset = true) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await auditApi.list(token, {
        kind: filters.kind || undefined,
        actorId: filters.actorId || undefined,
        targetType: filters.targetType || undefined,
        q: filters.q || undefined,
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
  }, [token, filters, cursor]);

  useEffect(() => {
    if (!token) return;
    auditApi.facets(token).then(setFacets).catch(() => {});
  }, [token]);

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.kind, filters.actorId, filters.targetType]);

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-emerald-500" />
          <h1 className="text-2xl font-bold">Аудит-лог</h1>
        </div>
        <Button onClick={() => load(true)} variant="outline" size="sm" disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 grid gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">Тип события</Label>
            <select
              value={filters.kind}
              onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))}
              className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Все</option>
              {facets?.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Кто (admin email)</Label>
            <select
              value={filters.actorId}
              onChange={(e) => setFilters((f) => ({ ...f, actorId: e.target.value }))}
              className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Все</option>
              {facets?.actors.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Объект</Label>
            <select
              value={filters.targetType}
              onChange={(e) => setFilters((f) => ({ ...f, targetType: e.target.value }))}
              className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Все</option>
              {facets?.targetTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Поиск</Label>
            <div className="mt-1.5 relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && load(true)}
                placeholder="kind, actor, targetId…"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300 mb-4">
          {error}
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {items.length === 0 && !loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Нет событий. Журнал начинает заполняться по мере действий админов.
            </div>
          ) : (
            <div className="divide-y">
              {items.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => setSelected(ev)}
                  className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-accent"
                >
                  <div className="text-xs text-muted-foreground font-mono w-32 shrink-0">
                    {new Date(ev.createdAt).toLocaleString("ru")}
                  </div>
                  <div className={`text-sm font-semibold w-48 shrink-0 ${colorOfKind(ev.kind)}`}>
                    {ev.kind}
                  </div>
                  <div className="text-sm text-foreground/90 w-40 shrink-0 truncate">
                    {ev.actorId ?? <span className="text-muted-foreground italic">system</span>}
                  </div>
                  <div className="text-xs text-muted-foreground flex-1 truncate">
                    {ev.targetType ? `${ev.targetType}` : ""}
                    {ev.targetId ? ` ${ev.targetId.slice(0, 16)}…` : ""}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
              {cursor ? (
                <div className="p-3 text-center">
                  <Button onClick={() => load(false)} variant="outline" size="sm" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Загрузить ещё"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={colorOfKind(selected?.kind ?? "")}>{selected?.kind}</span>
              <span className="text-sm text-muted-foreground font-mono">{selected?.id.slice(0, 12)}…</span>
            </DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <span className="text-muted-foreground">Время:</span>
                <span className="font-mono">{new Date(selected.createdAt).toLocaleString("ru")}</span>
                <span className="text-muted-foreground">Админ:</span>
                <span>{selected.actorId ?? <span className="text-muted-foreground italic">system</span>}</span>
                <span className="text-muted-foreground">IP:</span>
                <span className="font-mono">{selected.actorIp ?? "—"}</span>
                <span className="text-muted-foreground">Объект:</span>
                <span className="font-mono">{selected.targetType ?? "—"} {selected.targetId ? selected.targetId : ""}</span>
              </div>
              {selected.payload ? (
                <div>
                  <Label className="text-xs text-muted-foreground">payload</Label>
                  <pre className="mt-1 max-h-96 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs font-mono">
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
