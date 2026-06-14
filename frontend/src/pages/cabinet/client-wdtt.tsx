import { useEffect, useState } from "react";
import { Wifi, Loader2, Copy, Calendar, Shield } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type WdttClientSlotItem } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function formatBytes(bytes: string | null): string {
  if (!bytes) return "—";
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ClientWdttPage() {
  const { state } = useClientAuth();
  const token = state.token;
  const [slots, setSlots] = useState<WdttClientSlotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("slots");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getWdttSlots(token).then((r) => {
      setSlots(r.items);
    }).finally(() => setLoading(false));
  }, [token]);

  const copyLink = async (link: string, id: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const activeSlots = slots.filter((s) => s.status === "ACTIVE");
  const expiredSlots = slots.filter((s) => s.status !== "ACTIVE");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Wifi className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">WDTT / Warp доступы</h2>
          <p className="text-sm text-muted-foreground">WireGuard-over-TURN VPN для Android</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : slots.length === 0 ? (
        <Card className="p-12 text-center">
          <Wifi className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">У вас пока нет активных WDTT доступов.</p>
          <p className="text-sm text-muted-foreground mt-1">Приобретите тариф в разделе «Тарифы».</p>
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="slots">Активные ({activeSlots.length})</TabsTrigger>
            <TabsTrigger value="expired">История ({expiredSlots.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="slots" className="space-y-3 mt-4">
            {activeSlots.map((s) => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-medium text-emerald-500">Активен</span>
                        <span className="text-xs text-muted-foreground">на {s.nodeName || s.publicHost}</span>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs font-mono break-all text-muted-foreground mb-2">{s.wdttLink}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyLink(s.wdttLink, s.id)}
                        >
                          {copiedId === s.id ? (
                            <><Check className="h-3 w-3 mr-1" />Скопировано</>
                          ) : (
                            <><Copy className="h-3 w-3 mr-1" />Копировать ссылку</>
                          )}
                        </Button>
                      </div>
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />До {formatDate(s.expiresAt)}</span>
                        {s.trafficLimitBytes && (
                          <span>Трафик: {formatBytes(s.trafficUsedBytes)} / {formatBytes(s.trafficLimitBytes)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </TabsContent>

          <TabsContent value="expired" className="space-y-3 mt-4">
            {expiredSlots.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">Нет истёкших доступов</Card>
            ) : (
              expiredSlots.map((s) => (
                <Card key={s.id} className="p-4 opacity-60">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono">{s.wdttLink}</span>
                      <span className="text-xs text-muted-foreground">({s.status === "EXPIRED" ? "Истёк" : "Отозван"})</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Действовал до {formatDate(s.expiresAt)}</div>
                  </div>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
