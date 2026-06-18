import { useEffect, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DashboardChartPoint = {
  date: string;
  revenue: number;
  users: number;
};

function formatMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function DashboardRevenueChart({
  data,
  defaultCurrency,
}: {
  data: DashboardChartPoint[];
  defaultCurrency: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setSize(width > 0 && height > 0 ? { width, height } : null);
    };

    updateSize();
    if (typeof ResizeObserver === "undefined") {
      const frame = window.requestAnimationFrame(updateSize);
      return () => window.cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="h-full w-full min-w-0">
      {!size ? (
        <div className="h-full w-full rounded-xl bg-foreground/[0.03]" />
      ) : (
        <ComposedChart width={size.width} height={size.height} data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
      )}
    </div>
  );
}
