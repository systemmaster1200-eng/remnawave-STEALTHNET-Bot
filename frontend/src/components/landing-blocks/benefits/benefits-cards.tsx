/**
 * Benefits (variants: cards-4 | cards-6 | mosaic) — сетка карточек преимуществ.
 */

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Zap, Globe, Shield, Lock, LayoutDashboard, Sparkles, type LucideIcon } from "lucide-react";
import { txt, arr, SECTION_SCROLL_OFFSET, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

const ICONS: LucideIcon[] = [Zap, Globe, Shield, Lock, LayoutDashboard, Sparkles];

const DEFAULT_ITEMS = [
  { title: "Всегда онлайн", desc: "Работает стабильно даже в перегруженных сетях, быстрый отклик с любого устройства." },
  { title: "Сервисы без границ", desc: "Доступ к любым сайтам, видеозвонкам и работе без визуальных ограничений." },
  { title: "Своя инфраструктура", desc: "Без посредников: своя сеть и аккуратная маршрутизация под реальные сценарии." },
  { title: "Чистая приватность", desc: "Шифрование, маскировка, отсутствие лишних следов и привязок." },
  { title: "Управление в одном месте", desc: "Telegram-бот и личный кабинет, тарифы и продление в одной системе." },
  { title: "Премиум-опыт", desc: "Чистый и понятный продуктовый интерфейс от первого экрана до покупки." },
];

interface Item {
  title: string;
  desc: string;
}

export function BenefitsCards({ block }: { block: LandingApiBlock }) {
  const { accentTheme } = useLandingTheme();
  const cardsCount = block.variant === "cards-4" ? 4 : 6;
  const items = arr<Item>(block.text, "items", DEFAULT_ITEMS).slice(0, cardsCount);

  const title = txt(block.text, "title", "Почему выбирают нас");
  const subtitle = txt(block.text, "subtitle", "Шесть причин, почему сервис ощущается надёжным с первого экрана.");
  const badge = txt(block.text, "badge", "Преимущества");

  return (
    <section id="benefits" className={`container mx-auto px-4 py-16 md:py-24 ${SECTION_SCROLL_OFFSET}`}>
      <div className="text-center">
        {badge ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 dark:border-white/10 bg-white/80 dark:bg-white/5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-600 dark:text-slate-300">
            <Sparkles className="h-3.5 w-3.5" style={{ color: accentTheme.primary }} />
            {badge}
          </div>
        ) : null}
        <h2 className="mx-auto mt-5 max-w-3xl text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-5xl dark:text-white">{title}</h2>
        {subtitle ? <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300 md:text-lg">{subtitle}</p> : null}
      </div>

      <div className={`mt-10 grid gap-4 ${cardsCount === 4 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-2 lg:grid-cols-3"}`}>
        {items.map((it, idx) => {
          const Icon = ICONS[idx % ICONS.length];
          return (
            <motion.div
              key={`${it.title}-${idx}`}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
            >
              <Card className="h-full border-slate-200/70 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-xl">
                <CardContent className="p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `${accentTheme.primary}18`, color: accentTheme.primary }}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-slate-950 dark:text-white">{it.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{it.desc}</p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
