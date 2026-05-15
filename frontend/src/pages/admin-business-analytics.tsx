/**
 * Business Analytics — KPI/Cohort/Funnel/Provider compare.
 *
 * Грузит /api/admin/business-analytics?days=N и рендерит:
 *   1. Period selector (7/30/90/180 days)
 *   2. KPI карточки по валюте: MRR / Revenue / ARPU / LTV / Churn
 *   3. Cohort retention таблица (12 недель)
 *   4. Funnel: register → trial → paid → repeat → auto-renew
 *   5. Provider comparison таблица
 */

import { useEffect, useState } from "react";
import {
  TrendingUp, Users, DollarSign, Repeat, Activity, Target, ArrowDownToLine,
  Wallet, Loader2, AlertCircle, RefreshCw, Calendar,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { businessAnalyticsApi, type BusinessAnalyticsResponse, type CohortRow } from "@/lib/admin-extras-api";

const PERIOD_OPTIONS = [
  { value: 7, label: "7д" },
  { value: 30, label: "30д" },
  { value: 90, label: "90д" },
  { value: 180, label: "180д" },
];

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}
function fmtNum(n: number): string {
  return n.toLocaleString("ru-RU");
}
function fmtPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}
function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toFixed(0)}с`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}мин`;
  return `${(seconds / 3600).toFixed(1)}ч`;
}

function retentionColor(pct: number): string {
  if (pct === 0) return "bg-foreground/[0.03] text-muted-foreground";
  if (pct < 0.05) return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
  if (pct < 0.15) return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  if (pct < 0.30) return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
  return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
}

export function AdminBusinessAnalyticsPage() {
  const { state } = useAuth();
  const [data, setData] = useState<BusinessAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);

  async function load() {
    if (!state.accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await businessAnalyticsApi.get(state.accessToken, days);
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken, days]);

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 md:px-8 pt-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-primary/80 to-foreground/60">
              Бизнес-аналитика
            </h1>
            <p className="text-sm text-muted-foreground mt-1">MRR · ARPU · LTV · Churn · Cohorts · Funnel · Providers</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-white/5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  days === opt.value
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl gap-2">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить
          </Button>
        </div>
      </div>

      {err && (
        <Card className="p-4 bg-rose-500/10 border-rose-500/30 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-rose-500 shrink-0" />
          <p className="text-sm text-rose-500">{err}</p>
        </Card>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : data ? (
        <>
          {/* KPI Cards — by currency */}
          {data.kpis.length === 0 ? (
            <Card className="p-8 text-center bg-background/40 backdrop-blur-3xl border-white/10 rounded-[2rem]">
              <p className="text-sm text-muted-foreground">Нет PAID-платежей за выбранный период.</p>
            </Card>
          ) : (
            data.kpis.map((kpi) => (
              <section key={kpi.currency}>
                <div className="flex items-center gap-2 mb-3 px-2">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">
                    {kpi.currency.toUpperCase()}
                  </h2>
                </div>
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
                  <KpiCard
                    icon={DollarSign}
                    label={`MRR (${data.windowDays}д)`}
                    value={fmtMoney(kpi.mrr)}
                    sub="С подписочных платежей"
                    accent="primary"
                  />
                  <KpiCard
                    icon={TrendingUp}
                    label={`Total Revenue (${data.windowDays}д)`}
                    value={fmtMoney(kpi.totalRevenue)}
                    sub={`${fmtNum(kpi.paidCount)} платежей · ${fmtNum(kpi.payingClients)} клиентов`}
                    accent="emerald"
                  />
                  <KpiCard
                    icon={Users}
                    label="ARPU"
                    value={fmtMoney(kpi.arpu)}
                    sub="Average Revenue Per User"
                    accent="cyan"
                  />
                  <KpiCard
                    icon={Activity}
                    label="LTV"
                    value={fmtMoney(kpi.ltv)}
                    sub="Lifetime value (за всё время)"
                    accent="violet"
                  />
                  <KpiCard
                    icon={Repeat}
                    label="Churn rate"
                    value={fmtPct(data.churn.churnRate)}
                    sub={`Из ${data.churn.prevPeriodPayingClients} платящих ушло ${data.churn.churnedClients}`}
                    accent={data.churn.churnRate > 0.3 ? "rose" : data.churn.churnRate > 0.15 ? "amber" : "emerald"}
                  />
                </div>
              </section>
            ))
          )}

          {/* Cohort retention */}
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-white/10 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-cyan-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Cohort retention (12 недель)</h2>
                <p className="text-xs text-muted-foreground">% клиентов из недельной когорты, кто сделал хоть одну оплату на N-й неделе после регистрации</p>
              </div>
            </div>

            {data.cohorts.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-4">Нет когорт за последние 12 недель.</p>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground border-b border-white/10">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">Когорта (нед.)</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Размер</th>
                      <th className="px-4 py-2.5 text-center font-semibold">W1</th>
                      <th className="px-4 py-2.5 text-center font-semibold">W2</th>
                      <th className="px-4 py-2.5 text-center font-semibold">W4</th>
                      <th className="px-4 py-2.5 text-center font-semibold">W8</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.cohorts.map((c) => (
                      <CohortTableRow key={c.weekStart} c={c} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Funnel */}
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 border border-white/10 flex items-center justify-center">
                <Target className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Воронка конверсии</h2>
                <p className="text-xs text-muted-foreground">От регистрации до подписчика с авто-продлением (по всем клиентам)</p>
              </div>
            </div>

            <div className="space-y-2">
              {data.funnel.map((step, i) => {
                const widthPct = step.pctOfStart * 100;
                return (
                  <div key={step.key} className="relative">
                    <div className="relative h-12 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/10 overflow-hidden">
                      <div
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-xl transition-all duration-500",
                          i === 0 && "bg-gradient-to-r from-primary/30 to-primary/10",
                          i === 1 && "bg-gradient-to-r from-cyan-500/30 to-cyan-500/10",
                          i === 2 && "bg-gradient-to-r from-emerald-500/30 to-emerald-500/10",
                          i === 3 && "bg-gradient-to-r from-violet-500/30 to-violet-500/10",
                          i === 4 && "bg-gradient-to-r from-amber-500/30 to-amber-500/10",
                        )}
                        style={{ width: `${Math.max(widthPct, 2)}%` }}
                      />
                      <div className="relative h-full px-4 flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{step.label}</span>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-bold tabular-nums text-foreground">{fmtNum(step.count)}</span>
                          {i > 0 && (
                            <span className="text-muted-foreground tabular-nums">
                              {fmtPct(step.pctOfPrev)} от пред.
                            </span>
                          )}
                          <span className="text-muted-foreground tabular-nums w-14 text-right">
                            {fmtPct(step.pctOfStart)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Providers */}
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 border border-white/10 flex items-center justify-center">
                <ArrowDownToLine className="h-4 w-4 text-violet-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Сравнение провайдеров</h2>
                <p className="text-xs text-muted-foreground">За последние {data.windowDays} дней</p>
              </div>
            </div>

            {data.providers.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-4">Нет платежей за период.</p>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground border-b border-white/10">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold">Провайдер</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Всего</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-emerald-500">PAID</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-rose-500">FAILED</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-violet-500">REFUND</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Success</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Ø время</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Выручка</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Ø чек</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.providers.map((p) => (
                      <tr key={p.provider} className="hover:bg-white/5 transition-colors">
                        <td className="px-3 py-3 font-medium">{p.provider}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmtNum(p.total)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-500">{fmtNum(p.paid)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-rose-500">{fmtNum(p.failed)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-violet-500">{fmtNum(p.refunded)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-xs font-semibold",
                            p.successRate >= 0.7 && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                            p.successRate >= 0.4 && p.successRate < 0.7 && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                            p.successRate < 0.4 && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                          )}>
                            {fmtPct(p.successRate)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {fmtDuration(p.avgSecondsToPaid)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <div className="flex flex-col items-end gap-0.5">
                            {p.revenueByCurrency.length === 0 ? "—" : p.revenueByCurrency.map((rc) => (
                              <span key={rc.currency} className="font-medium">
                                {fmtMoney(rc.amount)} <span className="text-[10px] text-muted-foreground">{rc.currency.toUpperCase()}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <div className="flex flex-col items-end gap-0.5 text-muted-foreground">
                            {p.avgAmountByCurrency.length === 0 ? "—" : p.avgAmountByCurrency.map((rc) => (
                              <span key={rc.currency}>
                                {fmtMoney(rc.amount)} <span className="text-[10px]">{rc.currency.toUpperCase()}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-[11px] text-muted-foreground text-center pt-2">
            Сгенерировано: {new Date(data.generatedAt).toLocaleString("ru-RU")}
          </p>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: "primary" | "emerald" | "cyan" | "violet" | "amber" | "rose";
}) {
  const accentColors: Record<typeof accent, { iconBg: string; iconText: string }> = {
    primary: { iconBg: "from-primary/20 to-primary/5", iconText: "text-primary" },
    emerald: { iconBg: "from-emerald-500/20 to-emerald-500/5", iconText: "text-emerald-500" },
    cyan: { iconBg: "from-cyan-500/20 to-cyan-500/5", iconText: "text-cyan-500" },
    violet: { iconBg: "from-violet-500/20 to-violet-500/5", iconText: "text-violet-500" },
    amber: { iconBg: "from-amber-500/20 to-amber-500/5", iconText: "text-amber-500" },
    rose: { iconBg: "from-rose-500/20 to-rose-500/5", iconText: "text-rose-500" },
  };
  const a = accentColors[accent];
  return (
    <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[1.5rem] p-4 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground truncate">{label}</p>
          <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-foreground">{value}</div>
          <p className="mt-1 text-[10px] text-muted-foreground/80">{sub}</p>
        </div>
        <div className={cn(
          "h-9 w-9 rounded-xl bg-gradient-to-br border border-white/10 flex items-center justify-center shadow-inner shrink-0",
          a.iconBg,
        )}>
          <Icon className={cn("h-4 w-4", a.iconText)} />
        </div>
      </div>
    </Card>
  );
}

function CohortTableRow({ c }: { c: CohortRow }) {
  return (
    <tr className="hover:bg-white/5 transition-colors">
      <td className="px-4 py-2.5 font-mono text-xs text-foreground">{c.weekStart}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{c.cohortSize}</td>
      {c.retention.map((r) => (
        <td key={r.week} className="px-4 py-2.5 text-center">
          <div className={cn(
            "inline-flex flex-col items-center gap-0 rounded-lg px-2 py-1 min-w-[60px]",
            retentionColor(r.pct),
          )}>
            <span className="font-semibold text-xs">{fmtPct(r.pct)}</span>
            <span className="text-[10px] opacity-70">{r.active}</span>
          </div>
        </td>
      ))}
    </tr>
  );
}
