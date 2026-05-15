import { useEffect, useState, Fragment } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import {
  Loader2,
  TrendingUp,
  Users,
  DollarSign,
  ShoppingCart,
  Gift,
  Tag,
  Percent,
  UserPlus,
  Bot,
  Globe,
  Zap,
  Award,
  Wallet,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
  ComposedChart,
} from "recharts";
import { cn } from "@/lib/utils";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: Math.min(i * 0.04, 0.5),
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

function fmt(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
}
function fmtDec(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface AnalyticsData {
  revenueSeries: { date: string; value: number }[];
  clientsSeries: { date: string; value: number }[];
  trialsSeries: { date: string; value: number }[];
  promoActsSeries: { date: string; value: number }[];
  promoUsagesSeries: { date: string; value: number }[];
  refCreditsSeries: { date: string; value: number }[];
  topTariffs: { name: string; count: number; revenue: number }[];
  providerSeries: { provider: string; amount: number }[];
  topReferrers: { id: string; name: string; referrals: number; earnings: number; l1: number; l2: number; l3: number; credits: number }[];
  campaignsStats: { source: string; campaign: string | null; registrations: number; trials: number; payments: number; revenue: number }[];
  promoGroupStats: { name: string; code: string; maxActivations: number; activations: number }[];
  promoCodeStats: { code: string; name: string; type: string; maxUses: number; usages: number }[];
  summary: {
    totalClients: number;
    activeClients: number;
    totalRevenue: number;
    totalPayments: number;
    totalReferralPaid: number;
    promoActivations: number;
    promoCodeUsages: number;
    clientsNew24h: number;
    clientsNew7d: number;
    clientsNew30d: number;
    botClients: number;
    siteClients: number;
    bothClients: number;
    trialUsedCount: number;
    trialToPaid: number;
    trialConversionRate: number;
    avgCheck: number;
    arpu: number;
    payingClients: number;
    payingPercent: number;
    rev7: number;
    rev30: number;
    cnt7: number;
    cnt30: number;
    paymentsPending: number;
    totalBalance: number;
    withReferrer: number;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const COLOR_MAP = {
  emerald: { iconText: "text-emerald-500 dark:text-emerald-400", gradient: "from-emerald-500/20 to-emerald-500/5" },
  blue: { iconText: "text-blue-500 dark:text-blue-400", gradient: "from-blue-500/20 to-blue-500/5" },
  cyan: { iconText: "text-cyan-500 dark:text-cyan-400", gradient: "from-cyan-500/20 to-cyan-500/5" },
  violet: { iconText: "text-violet-500 dark:text-violet-400", gradient: "from-violet-500/20 to-violet-500/5" },
  amber: { iconText: "text-amber-500 dark:text-amber-400", gradient: "from-amber-500/20 to-amber-500/5" },
  rose: { iconText: "text-rose-500 dark:text-rose-400", gradient: "from-rose-500/20 to-rose-500/5" },
  pink: { iconText: "text-pink-500 dark:text-pink-400", gradient: "from-pink-500/20 to-pink-500/5" },
  primary: { iconText: "text-primary", gradient: "from-primary/20 to-primary/5" },
  yellow: { iconText: "text-yellow-500 dark:text-yellow-400", gradient: "from-yellow-500/20 to-yellow-500/5" },
  orange: { iconText: "text-orange-500 dark:text-orange-400", gradient: "from-orange-500/20 to-orange-500/5" },
  indigo: { iconText: "text-indigo-500 dark:text-indigo-400", gradient: "from-indigo-500/20 to-indigo-500/5" },
} as const;

type AccentColor = keyof typeof COLOR_MAP;

export function AnalyticsPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api.getAnalytics(token).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Загружаем аналитику…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-8 text-center">
          <p className="text-sm text-red-500 dark:text-red-400">Ошибка загрузки аналитики</p>
        </Card>
      </div>
    );
  }

  const s = data.summary;
  const revenueWeekly = aggregateByWeek(data.revenueSeries);
  const clientsWeekly = aggregateByWeek(data.clientsSeries);
  const trialsWeekly = aggregateByWeek(data.trialsSeries);
  const refCreditsWeekly = aggregateByWeek(data.refCreditsSeries);
  const promoWeekly = aggregateByWeekTwo(data.promoActsSeries, data.promoUsagesSeries);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="w-full space-y-6 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative"
    >
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <BarChart3 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-primary/80 to-foreground/60">
              Аналитика
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Полная статистика по всем направлениям</p>
          </div>
        </div>
      </motion.div>

      {/* Основные метрики */}
      <section>
        <SectionHeader icon={TrendingUp} title="Основные метрики" subtitle="Доходы и платежи" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard index={0} icon={DollarSign} label="Поступления" value={fmt(s.totalRevenue)} sub="без оплаты с баланса" color="emerald" />
          <MetricCard index={1} icon={DollarSign} label="Поступления 7 дн." value={fmt(s.rev7)} sub={`${s.cnt7} платежей`} color="emerald" />
          <MetricCard index={2} icon={DollarSign} label="Поступления 30 дн." value={fmt(s.rev30)} sub={`${s.cnt30} платежей`} color="emerald" />
          <MetricCard index={3} icon={ShoppingCart} label="Платежей" value={fmt(s.totalPayments)} sub={`${s.paymentsPending} ожидают`} color="blue" />
          <MetricCard index={4} icon={Target} label="Средний чек" value={fmtDec(s.avgCheck)} sub="на транзакцию" color="indigo" />
        </div>
      </section>

      {/* Клиенты */}
      <section>
        <SectionHeader icon={Users} title="Клиенты" subtitle="Статистика базы пользователей" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <MetricCard index={5} icon={Users} label="Всего клиентов" value={fmt(s.totalClients)} sub={`${s.activeClients} с подпиской`} color="blue" />
          <MetricCard index={6} icon={UserPlus} label="Новые 24ч / 7д / 30д" value={`${s.clientsNew24h} / ${s.clientsNew7d} / ${s.clientsNew30d}`} sub="регистрации" color="cyan" />
          <MetricCard index={7} icon={Bot} label="Только бот" value={fmt(s.botClients)} sub="клиентов" color="violet" />
          <MetricCard index={8} icon={Globe} label="Только сайт" value={fmt(s.siteClients)} sub="клиентов" color="orange" />
          <MetricCard index={9} icon={Users} label="Бот + Сайт" value={fmt(s.bothClients)} sub="клиентов" color="emerald" />
          <MetricCard index={10} icon={Wallet} label="Общий баланс" value={fmtDec(s.totalBalance)} sub="внутренние счета" color="amber" />
          <MetricCard index={11} icon={Percent} label="Платящих" value={`${s.payingClients} (${s.payingPercent}%)`} sub="от всех" color="rose" />
          <MetricCard index={12} icon={DollarSign} label="ARPU" value={fmtDec(s.arpu)} sub="доход / клиент" color="indigo" />
          <MetricCard index={13} icon={Award} label="По рефералу" value={fmt(s.withReferrer)} sub={`${s.totalClients > 0 ? Math.round((s.withReferrer / s.totalClients) * 100) : 0}% от всех`} color="pink" />
        </div>
      </section>

      {/* Триалы */}
      <section>
        <SectionHeader icon={Zap} title="Триалы" subtitle="Пробный период и конверсия" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard index={14} icon={Zap} label="Всего триалов" value={fmt(s.trialUsedCount)} sub="активаций" color="yellow" />
          <MetricCard
            index={15}
            icon={s.trialConversionRate > 20 ? ArrowUpRight : ArrowDownRight}
            label="Конверсия триал → покупка"
            value={`${s.trialConversionRate}%`}
            sub={`${s.trialToPaid} из ${s.trialUsedCount}`}
            color={s.trialConversionRate > 20 ? "emerald" : "orange"}
          />
        </div>
      </section>

      {/* Графики */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard index={16} title="Доход по неделям (90 дн.)" icon={TrendingUp}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueWeekly}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-foreground/10" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <Tooltip content={<CustomTooltip />} formatter={(v) => [fmt(Number(v ?? 0)), "Доход"]} />
              <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#revGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={17} title="Новые пользователи (90 дн.)" icon={UserPlus}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={clientsWeekly}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-foreground/10" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} formatter={(v) => [Number(v ?? 0), "Пользователей"]} />
              <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={18} title="Триалы по неделям (90 дн.)" icon={Zap}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trialsWeekly}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-foreground/10" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} formatter={(v) => [Number(v ?? 0), "Триалов"]} />
              <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={19} title="Реферальные выплаты (90 дн.)" icon={Award}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={refCreditsWeekly}>
              <defs>
                <linearGradient id="refGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ec4899" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-foreground/10" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <Tooltip content={<CustomTooltip />} formatter={(v) => [fmtDec(Number(v ?? 0)), "Выплаты"]} />
              <Area type="monotone" dataKey="value" stroke="#ec4899" strokeWidth={2} fillOpacity={1} fill="url(#refGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={20} title="Промо активации (90 дн.)" icon={Gift}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={promoWeekly}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-foreground/10" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="v1" name="Промо-ссылки" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="v2" name="Промокоды" stroke="#06b6d4" strokeWidth={2} dot={false} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={21} title="Источники клиентов" icon={Users}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[
                  { name: "Только бот", value: s.botClients },
                  { name: "Только сайт", value: s.siteClients },
                  { name: "Бот + сайт", value: s.bothClients },
                ].filter((d) => d.value > 0)}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                stroke="hsl(var(--background))"
                strokeWidth={2}
                label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {[COLORS[0], COLORS[2], COLORS[1]].map((c, i) => (
                  <Cell key={i} fill={c} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} formatter={(v) => [Number(v ?? 0), "Клиентов"]} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={22} title="Доход по способам оплаты (90 дн.)" icon={Tag}>
          {data.providerSeries.length === 0 ? (
            <NoData />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.providerSeries}
                  dataKey="amount"
                  nameKey="provider"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {data.providerSeries.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} formatter={(v) => [fmt(Number(v ?? 0)), "Сумма"]} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard index={23} title="Топ тарифов по доходу (90 дн.)" icon={ShoppingCart}>
          {data.topTariffs.length === 0 ? (
            <NoData />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topTariffs} layout="vertical" margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-foreground/10" />
                <XAxis type="number" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} className="text-muted-foreground" />
                <Tooltip content={<CustomTooltip />} formatter={(v) => [fmt(Number(v ?? 0)), "Доход"]} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" name="Доход" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* UTM-источники */}
      <section>
        <SectionHeader icon={Target} title="Источники трафика (UTM)" subtitle="Статистика по рекламным кампаниям" />
        {!data.campaignsStats?.length ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-10 text-center shadow-xl">
            <p className="text-sm text-muted-foreground">Нет данных по источникам</p>
          </Card>
        ) : (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-foreground/[0.04] dark:bg-white/[0.03]">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Источник</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Кампания</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Регистрации</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Триалы</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Платежи</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Доход</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaignsStats.map((row, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium">{row.source}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.campaign ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(row.registrations)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(row.trials)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(row.payments)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-500 dark:text-emerald-400">{fmtDec(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {/* Топ рефералов */}
      <section>
        <SectionHeader icon={Award} title="Топ рефералов" subtitle="Самые активные партнёры" />
        {data.topReferrers.length === 0 ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-10 text-center shadow-xl">
            <p className="text-sm text-muted-foreground">Нет данных по рефералам</p>
          </Card>
        ) : (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-foreground/[0.04] dark:bg-white/[0.03]">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">#</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Реферер</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Рефералов</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Заработок</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">L1</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">L2</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">L3</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Начислений</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topReferrers.map((r, i) => (
                    <tr key={r.id} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.referrals}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-500 dark:text-emerald-400">{fmtDec(r.earnings)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtDec(r.l1)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtDec(r.l2)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtDec(r.l3)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {/* Промо */}
      <section>
        <SectionHeader icon={Gift} title="Промо-статистика" subtitle="Активации кодов и ссылок" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3 mb-4">
          <MetricCard index={26} icon={Gift} label="Промо-ссылки активаций" value={fmt(s.promoActivations)} color="violet" />
          <MetricCard index={27} icon={Tag} label="Промокоды использований" value={fmt(s.promoCodeUsages)} color="cyan" />
          <MetricCard index={28} icon={Percent} label="Реферальные выплаты" value={fmtDec(s.totalReferralPaid)} color="pink" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SubTableCard index={29} title="Промо-ссылки (топ 10)" icon={Gift}>
            {data.promoGroupStats.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Нет данных</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-foreground/[0.04] dark:bg-white/[0.03]">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Название</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Код</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Активаций</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Лимит</th>
                  </tr>
                </thead>
                <tbody>
                  {data.promoGroupStats.map((g) => (
                    <tr key={g.code} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium">{g.name}</td>
                      <td className="px-4 py-3 text-xs font-mono text-primary">{g.code}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{g.activations}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{g.maxActivations || "∞"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SubTableCard>

          <SubTableCard index={30} title="Промокоды (топ 10)" icon={Tag}>
            {data.promoCodeStats.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Нет данных</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-foreground/[0.04] dark:bg-white/[0.03]">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Код</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Тип</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Использований</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Лимит</th>
                  </tr>
                </thead>
                <tbody>
                  {data.promoCodeStats.map((c) => (
                    <tr key={c.code} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-primary">{c.code}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur-md",
                          c.type === "DISCOUNT"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/20"
                        )}>
                          {c.type === "DISCOUNT" ? "Скидка" : "Дни"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{c.usages}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{c.maxUses || "∞"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SubTableCard>
        </div>
      </section>
    </motion.div>
  );
}

/* ── Components ── */

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <motion.div
      className="flex items-center gap-3 mb-5"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </motion.div>
  );
}

function MetricCard({
  index = 0,
  icon: Icon,
  label,
  value,
  sub,
  color = "primary",
}: {
  index?: number;
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: AccentColor;
}) {
  const accent = COLOR_MAP[color];
  const renderValue = () => {
    if (typeof value === "string" && value.includes(" / ")) {
      const parts = value.split(" / ");
      return (
        <div className="flex flex-wrap items-baseline gap-1">
          {parts.map((part, i) => (
            <Fragment key={i}>
              <span className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight">{part}</span>
              {i < parts.length - 1 && <span className="text-muted-foreground text-sm">/</span>}
            </Fragment>
          ))}
        </div>
      );
    }
    return <div className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">{value}</div>;
  };

  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className="h-full"
    >
      <Card className="group relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[1.5rem] p-4 sm:p-5 shadow-lg hover:shadow-xl hover:border-white/20 transition-all duration-300 h-full flex flex-col">
        <div className="flex justify-between items-start gap-2 mb-3">
          <p className="text-xs font-medium text-muted-foreground line-clamp-2 mt-1">{label}</p>
          <div className={cn(
            "h-9 w-9 shrink-0 rounded-2xl bg-gradient-to-br border border-white/10 flex items-center justify-center shadow-inner transition-transform group-hover:scale-110 group-hover:rotate-3",
            accent.gradient
          )}>
            <Icon className={cn("h-4 w-4", accent.iconText)} />
          </div>
        </div>
        <div className="mt-auto">
          {renderValue()}
          {sub && <p className="text-[11px] text-muted-foreground/80 mt-1">{sub}</p>}
        </div>
      </Card>
    </motion.div>
  );
}

function ChartCard({ title, icon: Icon, children, index = 0 }: { title: string; icon: React.ElementType; children: React.ReactNode; index?: number }) {
  return (
    <motion.div custom={index} variants={cardVariants} initial="hidden" animate="visible" className="h-full">
      <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl flex flex-col h-full">
        <div className="px-5 pt-5 pb-3 flex items-center gap-3 border-b border-white/5">
          <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <h3 className="text-sm font-bold tracking-tight">{title}</h3>
        </div>
        <div className="px-5 py-4 flex-1 min-h-[280px] h-72">
          {children}
        </div>
      </Card>
    </motion.div>
  );
}

function SubTableCard({ title, icon: Icon, children, index = 0 }: { title: string; icon: React.ElementType; children: React.ReactNode; index?: number }) {
  return (
    <motion.div custom={index} variants={cardVariants} initial="hidden" animate="visible" className="h-full">
      <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl">
        <div className="px-5 pt-5 pb-3 flex items-center gap-3 border-b border-white/5">
          <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <h3 className="text-sm font-bold tracking-tight">{title}</h3>
        </div>
        <div className="overflow-x-auto">{children}</div>
      </Card>
    </motion.div>
  );
}

function NoData() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-2">
      <p className="text-sm text-muted-foreground">Нет данных</p>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background/90 backdrop-blur-xl border border-white/10 rounded-xl px-3 py-2 shadow-2xl text-xs">
        {label && <p className="font-semibold mb-1.5 text-muted-foreground border-b border-white/10 pb-1">{label}</p>}
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-4 py-0.5">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.payload?.fill || "hsl(var(--primary))" }} />
              <span className="text-muted-foreground">{entry.name}</span>
            </div>
            <span className="font-semibold tabular-nums">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Utils ── */

function aggregateByWeek(series: { date: string; value: number }[]): { label: string; value: number }[] {
  const weeks: { label: string; value: number }[] = [];
  let weekSum = 0;
  let weekStart = "";
  for (let i = 0; i < series.length; i++) {
    if (i % 7 === 0) {
      if (i > 0) weeks.push({ label: weekStart, value: weekSum });
      weekStart = series[i].date.slice(5);
      weekSum = 0;
    }
    weekSum += series[i].value;
  }
  if (weekStart) weeks.push({ label: weekStart, value: weekSum });
  return weeks;
}

function aggregateByWeekTwo(
  s1: { date: string; value: number }[],
  s2: { date: string; value: number }[],
): { label: string; v1: number; v2: number }[] {
  const weeks: { label: string; v1: number; v2: number }[] = [];
  let w1 = 0, w2 = 0, weekStart = "";
  const len = Math.max(s1.length, s2.length);
  for (let i = 0; i < len; i++) {
    if (i % 7 === 0) {
      if (i > 0) weeks.push({ label: weekStart, v1: w1, v2: w2 });
      weekStart = (s1[i]?.date ?? s2[i]?.date ?? "").slice(5);
      w1 = 0; w2 = 0;
    }
    w1 += s1[i]?.value ?? 0;
    w2 += s2[i]?.value ?? 0;
  }
  if (weekStart) weeks.push({ label: weekStart, v1: w1, v2: w2 });
  return weeks;
}
