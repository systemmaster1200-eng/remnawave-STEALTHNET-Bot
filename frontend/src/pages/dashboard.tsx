import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  Users,
  Server,
  UserPlus,
  Activity,
  Loader2,
  Power,
  PowerOff,
  RotateCw,
  Globe,
  Wifi,
  Zap,
  Cpu,
  Gift,
  Send,
  CheckCircle,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { DashboardStats, RemnaNode, RemnaNodesResponse, ServerStats, GiftAnalytics } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/auth";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

/* ── Animation variants ── */

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: i * 0.05,
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

/* ── Utilities ── */

function formatMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "—";
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(2) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
  return bytes + " B";
}

function formatNodeCpuRam(node: { cpuCount?: number | null; totalRam?: string | null; system?: { info?: { cpus?: number; memoryTotal?: number } | null } | null }): string {
  const cpuCores = node.system?.info?.cpus ?? node.cpuCount;
  const cpu = cpuCores != null ? `${cpuCores} cores` : "—";
  const memTotal = node.system?.info?.memoryTotal;
  const ram = memTotal != null ? formatBytes(memTotal) : (node.totalRam?.trim() || "—");
  return `${cpu} / ${ram}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}д ${hours}ч ${mins}м`;
  if (hours > 0) return `${hours}ч ${mins}м`;
  return `${mins}м`;
}

function formatGb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1) + " GB";
}

function canAccessRemnaNodes(role: string, allowedSections: string[] | undefined): boolean {
  if (role === "ADMIN") return true;
  return Array.isArray(allowedSections) && allowedSections.includes("remna-nodes");
}

/* ── CountUp Hook & Components ── */

function useCountUp(target: number, duration = 1200): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0) {
      setValue(0);
      return;
    }
    startRef.current = null;
    const animate = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

function CountUpMoney({ value, currency, className }: { value: number; currency: string; className?: string }) {
  const animated = useCountUp(value);
  return <span className={className}>{formatMoney(animated, currency)}</span>;
}

function CountUpNumber({ value, className }: { value: number; className?: string }) {
  const animated = useCountUp(value);
  return <span className={className}>{animated.toLocaleString()}</span>;
}

/* ── Sparkline ── */

function Sparkline({
  data,
  color,
  height = 40,
  width = 100,
}: {
  data: { v: number }[];
  color: string;
  height?: number;
  width?: number;
}) {
  const gradientId = `spark-${color.replace("#", "")}`;
  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive
          animationDuration={1000}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Section Header (glass) ── */

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

/* ── Stat Card (glass) ── */

const ACCENT_MAP = {
  primary: { iconText: "text-primary", spark: "hsl(var(--primary))", glow: "hsl(var(--primary)/0.35)", iconBg: "from-primary/25 to-primary/5", bar: "from-primary to-primary/40" },
  emerald: { iconText: "text-emerald-500 dark:text-emerald-400", spark: "#10b981", glow: "rgba(16,185,129,0.35)", iconBg: "from-emerald-500/25 to-emerald-500/5", bar: "from-emerald-500 to-emerald-500/40" },
  amber: { iconText: "text-amber-500 dark:text-amber-400", spark: "#f59e0b", glow: "rgba(245,158,11,0.35)", iconBg: "from-amber-500/25 to-amber-500/5", bar: "from-amber-500 to-amber-500/40" },
  red: { iconText: "text-red-500 dark:text-red-400", spark: "#ef4444", glow: "rgba(239,68,68,0.35)", iconBg: "from-red-500/25 to-red-500/5", bar: "from-red-500 to-red-500/40" },
  violet: { iconText: "text-violet-500 dark:text-violet-400", spark: "#a78bfa", glow: "rgba(167,139,250,0.35)", iconBg: "from-violet-500/25 to-violet-500/5", bar: "from-violet-500 to-violet-500/40" },
  cyan: { iconText: "text-cyan-500 dark:text-cyan-400", spark: "#22d3ee", glow: "rgba(34,211,238,0.35)", iconBg: "from-cyan-500/25 to-cyan-500/5", bar: "from-cyan-500 to-cyan-500/40" },
} as const;

function StatCard({
  index,
  icon: Icon,
  title,
  value,
  subtitle,
  sparkData,
  accentColor = "primary",
}: {
  index: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: React.ReactNode;
  subtitle: string;
  sparkData?: { v: number }[];
  accentColor?: keyof typeof ACCENT_MAP;
}) {
  const accent = ACCENT_MAP[accentColor];
  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <Card
        className="group relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl hover:shadow-2xl hover:border-white/20 transition-all duration-300"
        style={{ ["--card-glow" as string]: accent.glow }}
      >
        {/* Accent gradient orb in top-right */}
        <div
          className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-0 group-hover:opacity-60 blur-3xl transition-opacity duration-500"
          style={{ background: `radial-gradient(circle, ${accent.glow}, transparent 70%)` }}
        />
        {/* Left accent bar */}
        <div className={cn("absolute left-0 top-1/4 h-1/2 w-[3px] rounded-r-full bg-gradient-to-b opacity-70", accent.bar)} />
        <div className="relative flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-foreground">
              {value}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground/80">{subtitle}</p>
          </div>
          <div className={cn(
            "h-10 w-10 rounded-2xl bg-gradient-to-br border border-white/10 flex items-center justify-center shadow-inner shrink-0 transition-transform group-hover:scale-110 group-hover:rotate-3",
            accent.iconBg,
          )}>
            <Icon className={cn("h-5 w-5", accent.iconText)} />
          </div>
        </div>
        {sparkData && sparkData.length > 0 && (
          <div className="relative mt-3 -mx-1 opacity-80 group-hover:opacity-100 transition-opacity">
            <Sparkline data={sparkData} color={accent.spark} height={36} width={120} />
          </div>
        )}
      </Card>
    </motion.div>
  );
}

/* ── Smooth Progress Bar ── */

function ProgressBar({
  percent,
  label,
  value,
  tone = "primary",
}: {
  percent: number;
  label: string;
  value: string;
  tone?: "primary" | "emerald" | "amber" | "red" | "violet";
}) {
  const toneClass = {
    primary: "from-primary/80 to-primary",
    emerald: "from-emerald-500/80 to-emerald-400",
    amber: "from-amber-500/80 to-amber-400",
    red: "from-red-500/80 to-red-400",
    violet: "from-violet-500/80 to-violet-400",
  }[tone];

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-end text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">
          {value}
          <span className="ml-2 text-[10px] text-muted-foreground/70">{percent.toFixed(1)}%</span>
        </span>
      </div>
      <div className="h-2 bg-foreground/[0.06] dark:bg-white/5 border border-white/5 rounded-full overflow-hidden">
        <motion.div
          className={cn("h-full bg-gradient-to-r rounded-full", toneClass)}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(percent, 100)}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

/* ── Server Stats Card ── */

function ServerStatsCard({ serverStats }: { serverStats: ServerStats }) {
  const pickTone = (p: number): "primary" | "emerald" | "amber" | "red" | "violet" =>
    p > 80 ? "red" : p > 60 ? "amber" : "primary";

  return (
    <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-6 shadow-xl">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Resources */}
        <div className="xl:col-span-2 space-y-4">
          <ProgressBar
            label={`CPU · ${serverStats.cpu.cores} cores`}
            percent={serverStats.cpu.usagePercent}
            value={`${serverStats.cpu.usagePercent.toFixed(1)}%`}
            tone={pickTone(serverStats.cpu.usagePercent)}
          />
          <ProgressBar
            label="Память"
            percent={serverStats.memory.usagePercent}
            value={`${formatGb(serverStats.memory.usedBytes)} / ${formatGb(serverStats.memory.totalBytes)}`}
            tone={pickTone(serverStats.memory.usagePercent) === "primary" ? "violet" : pickTone(serverStats.memory.usagePercent)}
          />
          {serverStats.disk && (
            <ProgressBar
              label="Диск"
              percent={serverStats.disk.usagePercent}
              value={`${formatGb(serverStats.disk.usedBytes)} / ${formatGb(serverStats.disk.totalBytes)}`}
              tone={pickTone(serverStats.disk.usagePercent) === "primary" ? "emerald" : pickTone(serverStats.disk.usagePercent)}
            />
          )}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Hostname</p>
              <p className="mt-1 font-semibold text-sm truncate">{serverStats.hostname}</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Платформа</p>
              <p className="mt-1 font-semibold text-sm truncate">{serverStats.platform} · {serverStats.arch}</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-3 col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Load average</p>
              <p className="mt-1 font-semibold text-sm tabular-nums">
                {serverStats.loadAvg.map((l) => l.toFixed(2)).join(" / ")}
              </p>
            </div>
          </div>
        </div>

        {/* Uptime */}
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-primary/10 via-purple-500/5 to-transparent p-5 flex flex-col items-center justify-center text-center shadow-inner h-full min-h-[180px]">
            <motion.div
              animate={{ opacity: [0.25, 0.5, 0.25] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.2)_0%,transparent_60%)] pointer-events-none"
            />
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">Аптайм</p>
            <p className="text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              {formatUptime(serverStats.uptimeSeconds)}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 dark:text-emerald-400 px-3 py-1 text-[10px] font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
                Online
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 text-muted-foreground px-2.5 py-1 text-[10px]">
                <Zap className="h-3 w-3" /> сеть
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Node Card ── */

function NodeCard({
  index,
  node,
  isBusy,
  onAction,
  t,
}: {
  index: number;
  node: RemnaNode;
  isBusy: boolean;
  onAction: (uuid: string, action: "enable" | "disable" | "restart") => void;
  t: (key: string) => string;
}) {
  const statusLabel = node.isDisabled
    ? t("admin.dashboard.node_disabled")
    : node.isConnecting
      ? t("admin.dashboard.node_connecting")
      : node.isConnected
        ? t("admin.dashboard.node_online")
        : t("admin.dashboard.node_offline");

  const statusBadge = node.isDisabled
    ? "bg-gray-500/10 text-gray-400 border-gray-500/20"
    : node.isConnecting
      ? "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20"
      : node.isConnected
        ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
        : "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20";

  const dotColor = node.isDisabled
    ? "bg-gray-400"
    : node.isConnecting
      ? "bg-amber-400 shadow-[0_0_6px_#fbbf24]"
      : node.isConnected
        ? "bg-emerald-400 shadow-[0_0_6px_#10b981]"
        : "bg-red-400 shadow-[0_0_6px_#f87171]";

  const limit = node.trafficLimitBytes ?? 0;
  const usedVal = node.trafficUsedBytes ?? 0;
  const percent = limit > 0 ? Math.min((usedVal / limit) * 100, 100) : 0;
  const tone: "primary" | "amber" | "red" = percent >= 90 ? "red" : percent >= 70 ? "amber" : "primary";
  const valueStr = limit > 0 ? `${formatBytes(usedVal)} / ${formatBytes(limit)}` : `${formatBytes(usedVal)}`;

  return (
    <motion.div custom={index} variants={cardVariants}>
      <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl hover:border-white/20 transition-all">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/15 to-purple-500/10 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
              <Server className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold truncate">{node.name || node.uuid.substring(0, 8)}</p>
              <p className="text-xs text-muted-foreground truncate">
                {node.address}
                {node.port != null ? `:${node.port}` : ""}
              </p>
            </div>
          </div>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium backdrop-blur-md shrink-0", statusBadge)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
            {statusLabel}
          </span>
        </div>

        {/* Bandwidth */}
        <div className="mb-4">
          <ProgressBar label="Трафик" percent={percent} value={valueStr} tone={tone} />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-3">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Cpu className="h-3 w-3" /> CPU / RAM
            </span>
            <p className="mt-1 font-semibold text-sm tabular-nums">{formatNodeCpuRam(node)}</p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-3">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Wifi className="h-3 w-3" /> Подключено
            </span>
            <p className="mt-1 font-semibold text-sm flex items-center gap-2 tabular-nums">
              {node.usersOnline != null ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
                  {node.usersOnline} онлайн
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-slate-500/50" />
                  Нет данных
                </>
              )}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {node.isDisabled ? (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-2 border-emerald-500/30 text-emerald-500 dark:text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50 bg-white/[0.02]"
              disabled={isBusy}
              onClick={() => onAction(node.uuid, "enable")}
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              Включить
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-2 border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50 bg-white/[0.02]"
              disabled={isBusy}
              onClick={() => onAction(node.uuid, "disable")}
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />}
              Отключить
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-2 border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 bg-white/[0.02]"
            disabled={isBusy}
            onClick={() => onAction(node.uuid, "restart")}
          >
            <RotateCw className="h-4 w-4" />
            Рестарт
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*                       MAIN COMPONENT                              */
/* ══════════════════════════════════════════════════════════════════ */

export function DashboardPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const token = state.accessToken ?? null;
  const admin = state.admin;
  const hasRemnaNodesAccess = admin ? canAccessRemnaNodes(admin.role, admin.allowedSections) : false;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [analyticsData, setAnalyticsData] = useState<any | null>(null);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const [chartPeriod, setChartPeriod] = useState(30);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [nodes, setNodes] = useState<RemnaNode[]>([]);
  const [giftAnalytics, setGiftAnalytics] = useState<GiftAnalytics | null>(null);
  const [defaultCurrency, setDefaultCurrency] = useState<string>("USD");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodeActionUuid, setNodeActionUuid] = useState<string | null>(null);

  const refetchNodes = useCallback(async () => {
    if (!token || !hasRemnaNodesAccess) return;
    const data = (await api.getRemnaNodes(token).catch(() => ({ response: [] }))) as RemnaNodesResponse;
    setNodes(Array.isArray(data?.response) ? data.response : []);
  }, [token, hasRemnaNodesAccess]);

  const handleNodeAction = useCallback(
    async (nodeUuid: string, action: "enable" | "disable" | "restart") => {
      if (!token || !hasRemnaNodesAccess) return;
      setNodeActionUuid(nodeUuid);
      try {
        if (action === "enable") await api.remnaNodeEnable(token, nodeUuid);
        else if (action === "disable") await api.remnaNodeDisable(token, nodeUuid);
        else await api.remnaNodeRestart(token, nodeUuid);
        await refetchNodes();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("admin.dashboard.node_error"));
      } finally {
        setNodeActionUuid(null);
      }
    },
    [token, hasRemnaNodesAccess, refetchNodes, t]
  );

  const loadAll = useCallback(
    async (silent = false) => {
      if (!token) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const statsP = api.getDashboardStats(token);
        const nodesP = hasRemnaNodesAccess
          ? api.getRemnaNodes(token).catch(() => ({ response: [] }))
          : Promise.resolve(null);
        const settingsP = api.getSettings(token).catch(() => null);
        const serverP = api.getServerStats(token).catch(() => null);
        const analyticsP = api.getAnalytics(token).catch(() => null);
        const giftAnalyticsP = api.getGiftAnalytics(token).catch(() => null);
        const [statsRes, nodesRes, settingsRes, serverRes, analyticsRes, giftAnalyticsRes] = await Promise.all([
          statsP, nodesP, settingsP, serverP, analyticsP, giftAnalyticsP,
        ]);
        setStats(statsRes);
        setServerStats(serverRes);
        setAnalyticsData(analyticsRes);
        setGiftAnalytics(giftAnalyticsRes);
        if (nodesRes != null) {
          const data = nodesRes as RemnaNodesResponse;
          setNodes(Array.isArray(data?.response) ? data.response : []);
        } else {
          setNodes([]);
        }
        const curr = settingsRes?.defaultCurrency;
        setDefaultCurrency(curr ? String(curr).toUpperCase() : "USD");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("admin.dashboard.loading_error"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, hasRemnaNodesAccess, t]
  );

  useEffect(() => {
    let cancelled = false;
    if (!cancelled) loadAll(false);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, hasRemnaNodesAccess]);

  const chartData = useMemo(() => {
    const revenueSeries = analyticsData?.revenueSeries ?? [];
    const clientsSeries = analyticsData?.clientsSeries ?? [];
    const period = Math.max(chartPeriod, 1);

    const revenueSlice = revenueSeries.slice(-period);
    const clientsSlice = clientsSeries.slice(-period);
    const maxLen = Math.max(revenueSlice.length, clientsSlice.length);

    return Array.from({ length: maxLen }).map((_, index) => {
      const revenuePoint = revenueSlice[index];
      const clientsPoint = clientsSlice[index];
      const dateRaw = revenuePoint?.date ?? clientsPoint?.date ?? "";
      const date = dateRaw
        ? new Date(dateRaw)
            .toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })
            .replace(".", "")
        : "";

      return {
        date,
        revenue: revenuePoint?.value ?? 0,
        users: clientsPoint?.value ?? 0,
      };
    });
  }, [analyticsData, chartPeriod]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const sales90d = analyticsData?.revenueSeries?.reduce((acc: any, curr: any) => acc + curr.value, 0) || 0;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /* ── Loading ── */
  if (loading && !stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">{t("admin.dashboard.initializing")}</p>
      </div>
    );
  }

  /* ── Nodes online/total ── */
  const nodesOnline = nodes.filter((n) => n.isConnected && !n.isDisabled).length;
  const nodesTotal = nodes.length;

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      {/* Background ambient orbs */}
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <Activity className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-primary/80 to-foreground/60">
              {t("admin.dashboard.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("admin.dashboard.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 dark:text-emerald-400 px-3 py-1 text-[11px] font-medium backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
            </span>
            Live
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => loadAll(true)}
            disabled={loading || refreshing}
            className="h-9 w-9 rounded-full hover:bg-white/10"
            title="Обновить"
          >
            <RefreshCw className={cn("h-4 w-4 text-muted-foreground", refreshing && "animate-spin text-primary")} />
          </Button>
        </div>
      </motion.div>

      {/* Manager warning */}
      {admin?.role === "MANAGER" && (!admin.allowedSections || admin.allowedSections.length === 0) && (
        <motion.div
          className="rounded-2xl border border-amber-500/30 bg-amber-500/10 backdrop-blur-md px-4 py-3 text-sm text-amber-500 dark:text-amber-400"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {t("admin.dashboard.no_access_warning")}
        </motion.div>
      )}

      {/* Error display */}
      {error && (
        <motion.div
          className="rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-md px-4 py-3 text-sm text-red-500 dark:text-red-400"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {error}
        </motion.div>
      )}

      {/* Users Section */}
      <section>
        <SectionHeader icon={Users} title={t("admin.dashboard.users_title")} subtitle={t("admin.dashboard.users_subtitle")} />
        <motion.div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" variants={staggerContainer} initial="hidden" animate="visible">
          <StatCard
            index={0}
            icon={Users}
            title={t("admin.dashboard.total_users")}
            value={stats ? <CountUpNumber value={stats.users.total} /> : "—"}
            subtitle={t("admin.dashboard.panel_clients")}
            accentColor="primary"
          />
          <StatCard
            index={1}
            icon={Shield}
            title={t("admin.dashboard.bound_to_remna")}
            value={stats ? <CountUpNumber value={stats.users.withRemna} /> : "—"}
            subtitle={t("admin.dashboard.with_remna_uuid")}
            accentColor="cyan"
          />
          <StatCard
            index={2}
            icon={UserPlus}
            title={t("admin.dashboard.new_today")}
            value={stats ? <CountUpNumber value={stats.users.newToday} /> : "—"}
            subtitle={t("admin.dashboard.registrations_today")}
            accentColor="emerald"
          />
        </motion.div>
      </section>

      {/* Analytics Section */}
      <section>
        <SectionHeader icon={Activity} title={t("admin.dashboard.micro_analytics")} subtitle={t("admin.dashboard.key_metrics")} />
        <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={0}>
          <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-6 shadow-xl">
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {[
                { label: t("admin.dashboard.total"), amount: stats?.sales.totalAmount ?? 0, count: stats?.sales.totalCount ?? 0, gradient: "from-primary/15 to-primary/5", textColor: "text-primary" },
                { label: t("admin.dashboard.today"), amount: stats?.sales.todayAmount ?? 0, count: stats?.sales.todayCount ?? 0, gradient: "from-emerald-500/15 to-emerald-500/5", textColor: "text-emerald-500 dark:text-emerald-400" },
                { label: t("admin.dashboard.7_days"), amount: stats?.sales.last7DaysAmount ?? 0, count: stats?.sales.last7DaysCount ?? 0, gradient: "from-cyan-500/15 to-cyan-500/5", textColor: "text-cyan-500 dark:text-cyan-400" },
                { label: t("admin.dashboard.30_days"), amount: stats?.sales.last30DaysAmount ?? 0, count: stats?.sales.last30DaysCount ?? 0, gradient: "from-violet-500/15 to-violet-500/5", textColor: "text-violet-500 dark:text-violet-400" },
                { label: t("admin.dashboard.90_days"), amount: sales90d as number, count: 0, isLast90: true, gradient: "from-amber-500/15 to-amber-500/5", textColor: "text-amber-500 dark:text-amber-400" },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  whileHover={{ y: -2, scale: 1.02 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className={cn("relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br p-3 shadow-sm", item.gradient)}
                >
                  <p className={cn("text-[11px] font-medium", item.textColor)}>{item.label}</p>
                  <p className="mt-1.5 text-lg font-extrabold tabular-nums tracking-tight text-foreground">
                    {stats || analyticsData ? <CountUpMoney value={item.amount} currency={defaultCurrency} /> : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                    {item.isLast90 ? "90 days" : `${item.count} платежей`}
                  </p>
                </motion.div>
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{t("admin.dashboard.analytics_period")}</p>
                <h3 className="text-base font-bold tracking-tight">Доход / новые пользователи</h3>
              </div>
              <div className="flex items-center gap-1 bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-white/5">
                {[7, 30, 90].map((period) => {
                  const isActive = chartPeriod === period;
                  return (
                    <button
                      key={period}
                      onClick={() => setChartPeriod(period)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-md"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                      )}
                    >
                      {period}d
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 h-[320px] w-full rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 backdrop-blur-md">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-white/10" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    tickFormatter={(value) => formatMoney(Number(value ?? 0), defaultCurrency)}
                  />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(10,10,20,0.85)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: "12px",
                      color: "white",
                      fontSize: "12px",
                    }}
                    formatter={(value, name) => {
                      if (name === "Доход") return [formatMoney(Number(value ?? 0), defaultCurrency), "Доход"];
                      return [Number(value ?? 0).toLocaleString(), "Новые"];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(148,163,184,0.9)" }} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="revenue"
                    name="Доход"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#dashRevenue)"
                    dot={false}
                    isAnimationActive
                    animationDuration={1000}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="users"
                    name="Новые"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                    animationDuration={1000}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>
      </section>

      {/* Gift Analytics */}
      {giftAnalytics && (giftAnalytics.totalSubscriptions > 0 || giftAnalytics.pendingCodes > 0) && (
        <section>
          <SectionHeader icon={Gift} title="Подарки" subtitle="Аналитика подарков" />
          <motion.div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" variants={staggerContainer} initial="hidden" animate="visible">
            <StatCard
              index={0}
              icon={Gift}
              title="Всего подписок"
              value={<CountUpNumber value={giftAnalytics.totalSubscriptions} />}
              subtitle={`+${giftAnalytics.last30Days} за 30 дней`}
              accentColor="violet"
            />
            <StatCard
              index={1}
              icon={CheckCircle}
              title="Свои"
              value={<CountUpNumber value={giftAnalytics.activatedSelf} />}
              subtitle="активировано себе"
              accentColor="emerald"
            />
            <StatCard
              index={2}
              icon={Send}
              title="Подарено"
              value={<CountUpNumber value={giftAnalytics.gifted} />}
              subtitle={`${giftAnalytics.redeemedCodes} кодов использовано`}
              accentColor="cyan"
            />
            <StatCard
              index={3}
              icon={TrendingUp}
              title="Конверсия"
              value={<span>{giftAnalytics.conversionRate}%</span>}
              subtitle={`${giftAnalytics.pendingCodes} ожид. · ${giftAnalytics.expiredCodes} истёк.`}
              accentColor="amber"
            />
          </motion.div>
        </section>
      )}

      {/* Server Stats */}
      {serverStats && (
        <section>
          <SectionHeader icon={Server} title={t("admin.dashboard.command_center")} subtitle={t("admin.dashboard.server_monitoring")} />
          <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={0}>
            <ServerStatsCard serverStats={serverStats} />
          </motion.div>
        </section>
      )}

      {/* Remna Nodes */}
      <section>
        <SectionHeader
          icon={Globe}
          title={t("admin.dashboard.remna_nodes")}
          subtitle={
            hasRemnaNodesAccess && nodes.length > 0
              ? t("admin.dashboard.nodes_online_count").replace("{online}", String(nodesOnline)).replace("{total}", String(nodesTotal))
              : t("admin.dashboard.nodes_subtitle")
          }
        />
        {!hasRemnaNodesAccess ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-10 text-center shadow-xl">
            <p className="text-sm text-muted-foreground">{t("admin.dashboard.no_node_access")}</p>
          </Card>
        ) : nodes.length === 0 ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-10 text-center shadow-xl">
            <p className="text-sm text-muted-foreground">{t("admin.dashboard.nodes_not_loaded")}</p>
          </Card>
        ) : (
          <motion.div className="grid gap-4 lg:grid-cols-2" variants={staggerContainer} initial="hidden" animate="visible">
            {nodes.map((node, idx) => (
              <NodeCard
                key={node.uuid}
                index={idx}
                node={node}
                isBusy={nodeActionUuid === node.uuid}
                onAction={handleNodeAction}
                t={t}
              />
            ))}
          </motion.div>
        )}
      </section>
    </div>
  );
}
