/**
 * Features (variant: strip) — горизонтальная полоса из 5 карточек.
 * Текст: items[]: { label, sub, desc?, chips? }.
 */

import { motion } from "framer-motion";
import { Shield, Lock, Star, Zap, Smartphone, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { arr, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

const DEFAULT_ICONS: LucideIcon[] = [Shield, Lock, Star, Zap, Smartphone];

const DEFAULT_ITEMS = [
  { label: "Защита", sub: "Современные протоколы" },
  { label: "Zero-Log", sub: "История не сохраняется" },
  { label: "Оплата", sub: "Анонимно и безопасно" },
  { label: "Серверы", sub: "Собственная инфраструктура" },
  { label: "Установка", sub: "За 30 секунд" },
];

interface Item {
  label: string;
  sub: string;
}

export function FeaturesStrip({ block }: { block: LandingApiBlock }) {
  const { accentTheme } = useLandingTheme();
  const items = arr<Item>(block.text, "items", DEFAULT_ITEMS);

  return (
    <section className="container mx-auto px-4 pb-10 md:pb-16">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        {items.slice(0, 5).map((item, idx) => {
          const Icon = DEFAULT_ICONS[idx % DEFAULT_ICONS.length];
          return (
            <motion.div
              key={`${item.label}-${idx}`}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
            >
              <Card className="h-full border-slate-200/70 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-xl transition-shadow hover:shadow-lg">
                <CardContent className="p-5">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-2xl"
                    style={{ background: `${accentTheme.primary}15`, color: accentTheme.primary }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-slate-950 dark:text-white">{item.label}</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.sub}</p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
