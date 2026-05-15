/**
 * Stats (variant: strip-3 | strip-4) — горизонтальная полоса с цифрами.
 */

import { motion } from "framer-motion";
import { txt, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

interface Stat {
  value: string;
  label: string;
}

export function StatsStrip({ block }: { block: LandingApiBlock }) {
  const { accentTheme } = useLandingTheme();

  // Сначала пытаемся читать stats как массив, иначе — старую плоскую структуру.
  const itemsRaw = block.text.items;
  const items: Stat[] = Array.isArray(itemsRaw) && itemsRaw.length > 0
    ? (itemsRaw as Stat[])
    : [
        { value: txt(block.text, "platforms", "5+"), label: "платформ" },
        { value: txt(block.text, "tariffsCount", "10"), label: txt(block.text, "tariffsLabel", "тарифов онлайн") },
        { value: txt(block.text, "paymentMethods", "6"), label: txt(block.text, "accessLabel", "способов оплаты") },
      ];
  const cap = block.variant === "strip-4" ? 4 : 3;
  const displayed = items.slice(0, cap);

  return (
    <section className="container mx-auto px-4 py-8 md:py-12">
      <div className={`grid gap-3 ${cap === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3"}`}>
        {displayed.map((s, idx) => (
          <motion.div
            key={`${s.label}-${idx}`}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: idx * 0.06 }}
            className="rounded-3xl border border-slate-200/60 dark:border-white/10 bg-white/80 dark:bg-white/5 p-6 text-center backdrop-blur-xl"
          >
            <div className="text-4xl font-black tracking-tight md:text-5xl" style={{ color: accentTheme.primary }}>
              {s.value}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{s.label}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
