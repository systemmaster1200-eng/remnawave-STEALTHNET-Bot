/**
 * Custom (variant: journey) — три шага «как это работает», нумерованные карточки.
 */

import { motion } from "framer-motion";
import { Sparkles, CreditCard, Rocket, type LucideIcon } from "lucide-react";
import { txt, arr, SECTION_SCROLL_OFFSET, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

const ICONS: LucideIcon[] = [Sparkles, CreditCard, Rocket];

const DEFAULT_STEPS = [
  { title: "Выбираешь сценарий", desc: "Гибкие тарифы под устройства и задачи. Не платишь за лишнее." },
  { title: "Оплачиваешь как удобно", desc: "Карта, СБП, кошелёк или крипта — выбирай удобный способ." },
  { title: "Подключаешься без боли", desc: "Бот и кабинет сразу выдадут инструкции. Настройка — минута." },
];

export function CustomJourney({ block }: { block: LandingApiBlock }) {
  const { accentTheme } = useLandingTheme();
  const steps = arr<{ title: string; desc: string }>(block.props, "steps", DEFAULT_STEPS).slice(0, 3);
  const title = txt(block.text, "title", "Как это работает");
  const desc = txt(block.text, "desc", "Три коротких шага: выбрал, оплатил, подключился.");

  return (
    <section className={`container mx-auto px-4 py-12 md:py-16 ${SECTION_SCROLL_OFFSET}`}>
      <div className="text-center">
        <h2 className="text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl dark:text-white">{title}</h2>
        {desc ? <p className="mx-auto mt-3 max-w-xl text-base text-slate-600 dark:text-slate-300">{desc}</p> : null}
      </div>

      <div className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-3">
        {steps.map((step, idx) => {
          const Icon = ICONS[idx % ICONS.length];
          return (
            <motion.div
              key={`${step.title}-${idx}`}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.08 }}
              className="rounded-3xl border border-slate-200/70 dark:border-white/10 bg-white/80 dark:bg-white/5 p-6 backdrop-blur-xl"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: `${accentTheme.primary}18`, color: accentTheme.primary }}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-xs font-semibold uppercase tracking-[0.32em]" style={{ color: accentTheme.primary }}>
                  0{idx + 1}
                </div>
              </div>
              <h3 className="mt-5 text-lg font-bold text-slate-950 dark:text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{step.desc}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
