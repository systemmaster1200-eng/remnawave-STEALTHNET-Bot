import { useEffect, useState } from "react";
import {
  ShieldAlert, Loader2, RefreshCw, AlertTriangle, Activity,
  Users, Server, TrendingUp, ChevronDown, ChevronUp, Search, ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type TrafficAbuseResponse, type TrafficAbuser } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function severityColor(score: number): string {
  if (score >= 200) return "text-red-500 dark:text-red-400";
  if (score >= 100) return "text-orange-500 dark:text-orange-400";
  if (score >= 80) return "text-yellow-500 dark:text-yellow-400";
  return "text-muted-foreground";
}

function severityBg(score: number): string {
  if (score >= 200) return "from-red-500 to-red-500/40";
  if (score >= 100) return "from-orange-500 to-orange-500/40";
  if (score >= 80) return "from-yellow-500 to-yellow-500/40";
  return "from-muted-foreground to-muted-foreground/40";
}

function severityLabel(score: number): string {
  if (score >= 200) return "Критический";
  if (score >= 100) return "Высокий";
  if (score >= 80) return "Средний";
  return "Низкий";
}

function AbuserRow({ user, index }: { user: TrafficAbuser; index: number }) {
  const [open, setOpen] = useState(false);
  const barWidth = Math.min(user.usagePercent, 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.3) }}
      className="rounded-2xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] overflow-hidden hover:border-white/20 transition-all"
    >
      <button
        type="button"
        className="w-full text-left p-4 flex items-center gap-4 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-red-500/15 to-red-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
          <ShieldAlert className="h-5 w-5 text-red-500 dark:text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{user.username}</span>
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              user.status === "ACTIVE" && "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
              user.status === "EXPIRED" && "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20",
              user.status !== "ACTIVE" && user.status !== "EXPIRED" && "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-white/10",
            )}>
              {user.status}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {user.email && <span>{user.email}</span>}
            {user.telegramId && <span>TG: {user.telegramId}</span>}
            {user.onlineAt && <span>Онлайн: {new Date(user.onlineAt).toLocaleString("ru-RU")}</span>}
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-end gap-0.5 min-w-[140px]">
          <span className="text-sm font-semibold tabular-nums">{formatBytes(user.periodUsageBytes)}</span>
          <span className="text-xs text-muted-foreground">
            лимит: {user.trafficLimitBytes > 0 ? formatBytes(user.trafficLimitBytes) : "∞"}
          </span>
        </div>

        <div className="hidden md:flex flex-col items-center gap-0.5 min-w-[90px]">
          <span className={cn("text-lg font-bold tabular-nums", severityColor(user.abuseScore))}>
            {user.abuseScore.toFixed(0)}%
          </span>
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", severityColor(user.abuseScore))}>
            {severityLabel(user.abuseScore)}
          </span>
        </div>

        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="border-t border-white/5 px-4 py-3 bg-foreground/[0.02] dark:bg-white/[0.01] space-y-3"
        >
          <div className="sm:hidden flex items-center justify-between text-sm">
            <span>Период: <strong>{formatBytes(user.periodUsageBytes)}</strong></span>
            <span className={cn("font-bold", severityColor(user.abuseScore))}>{user.abuseScore.toFixed(0)}% — {severityLabel(user.abuseScore)}</span>
          </div>

          {user.trafficLimitBytes > 0 && (
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Использование лимита</span>
                <span className="font-medium tabular-nums">{user.usagePercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-foreground/[0.06] dark:bg-white/5 border border-white/5 overflow-hidden">
                <motion.div
                  className={cn("h-full rounded-full bg-gradient-to-r", severityBg(user.abuseScore))}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(barWidth, 100)}%` }}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Текущий трафик</span>
              <span className="font-medium tabular-nums">{formatBytes(user.usedTrafficBytes)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">За всё время</span>
              <span className="font-medium tabular-nums">{formatBytes(user.lifetimeUsedTrafficBytes)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Стратегия</span>
              <span className="font-medium">{user.trafficLimitStrategy}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Истекает</span>
              <span className="font-medium">{user.expireAt ? new Date(user.expireAt).toLocaleDateString("ru-RU") : "—"}</span>
            </div>
          </div>

          {user.perNodeUsage.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground mb-2 block">Трафик по нодам:</span>
              <div className="space-y-1.5">
                {user.perNodeUsage.map((n, i) => {
                  const maxBytes = user.perNodeUsage[0]?.bytes ?? 1;
                  const pct = maxBytes > 0 ? (n.bytes / maxBytes) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-3 text-xs">
                      <span className="w-32 truncate text-muted-foreground">{n.nodeName}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-foreground/[0.06] dark:bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/40" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-20 text-right font-medium tabular-nums">{formatBytes(n.bytes)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

export function TrafficAbusePage() {
  const token = useAuth().state.accessToken!;
  const [days, setDays] = useState("7");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TrafficAbuseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getTrafficAbuseAnalytics(token, { days: Number(days) || 7 });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки аналитики");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = data?.abusers.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.username.toLowerCase().includes(q) ||
      (u.email?.toLowerCase().includes(q)) ||
      (u.telegramId && String(u.telegramId).includes(q));
  }) ?? [];

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      <div className="fixed -z-10 bg-red-500/10 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-orange-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <ShieldAlert className="h-6 w-6 text-red-500 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Анализ трафика
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Поиск пользователей с аномально высоким потреблением</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/10 px-3 py-1.5 text-sm">
            <span className="text-muted-foreground text-xs">Период:</span>
            <Input
              className="w-12 h-7 text-center text-sm border-0 bg-transparent p-0 focus-visible:ring-0"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
            />
            <span className="text-muted-foreground text-xs">дн.</span>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Обновить
          </Button>
        </div>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-md px-4 py-3 flex items-start gap-3"
        >
          <AlertTriangle className="h-5 w-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-500 dark:text-red-400">Ошибка получения данных</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
        </motion.div>
      )}

      {loading && !data ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 shadow-xl flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Анализ данных с нод...</p>
        </Card>
      ) : data && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Users, label: "Всего пользователей", value: String(data.stats.totalUsers), gradient: "from-blue-500/15 to-blue-500/5", iconColor: "text-blue-500 dark:text-blue-400" },
              { icon: AlertTriangle, label: "Нарушителей", value: String(data.stats.abusersCount), extra: data.stats.abuserTrafficPercent > 0 ? `${data.stats.abuserTrafficPercent}% трафика` : null, gradient: "from-red-500/15 to-red-500/5", iconColor: "text-red-500 dark:text-red-400" },
              { icon: TrendingUp, label: "Трафик нарушителей", value: formatBytes(data.stats.abuserTrafficTotal), extra: `из ${formatBytes(data.stats.totalTrafficPeriod)}`, gradient: "from-orange-500/15 to-orange-500/5", iconColor: "text-orange-500 dark:text-orange-400" },
              { icon: Server, label: "Активные ноды", value: String(data.stats.activeNodes), extra: data.stats.nodesWithData != null ? `${data.stats.nodesWithData} с данными` : null, gradient: "from-emerald-500/15 to-emerald-500/5", iconColor: "text-emerald-500 dark:text-emerald-400" },
            ].map((c, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ y: -2 }}
              >
                <Card className={cn("relative overflow-hidden bg-gradient-to-br border border-white/10 rounded-2xl p-4 shadow-lg h-full", c.gradient)}>
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-background/40 backdrop-blur-md border border-white/10 flex items-center justify-center">
                      <c.icon className={cn("h-5 w-5", c.iconColor)} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground">{c.label}</p>
                      <p className="text-2xl font-extrabold tabular-nums tracking-tight mt-0.5">{c.value}</p>
                      {c.extra && <p className="text-[10px] text-muted-foreground/80 mt-0.5">{c.extra}</p>}
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/5 px-3 py-2">
            <Activity className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Период: {data.stats.periodStart} — {data.stats.periodEnd} ({data.stats.periodDays} дн.) · Порог: {(data.stats.threshold * 100).toFixed(0)}% · Мин. трафик: {formatBytes(data.stats.minBytes)}</span>
          </div>

          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-500/20 to-red-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                  <ShieldAlert className="h-4 w-4 text-red-500 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight">
                    Список нарушителей
                    {filtered.length > 0 && <span className="text-muted-foreground font-normal ml-2">({filtered.length})</span>}
                  </h3>
                  <p className="text-xs text-muted-foreground">Раскройте строку для деталей</p>
                </div>
              </div>
              {data.abusers.length > 5 && (
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 w-48 pl-9 text-sm rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                    placeholder="Поиск..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="p-4 space-y-2">
              {filtered.length > 0 ? (
                filtered.map((u, i) => <AbuserRow key={`${u.uuid}-${u.username}`} user={u} index={i} />)
              ) : data.abusers.length > 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Нет совпадений по запросу «{search}»</div>
              ) : (
                <div className="py-12 flex flex-col items-center text-center gap-3 text-muted-foreground">
                  <div className="h-14 w-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <ShieldCheck className="h-7 w-7 text-emerald-500 dark:text-emerald-400" />
                  </div>
                  <p className="text-sm font-medium">Нарушители не обнаружены</p>
                  <p className="text-xs">Все пользователи в рамках допустимого потребления</p>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
