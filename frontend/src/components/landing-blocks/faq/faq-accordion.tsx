/**
 * FAQ (variant: accordion) — раскрывающиеся вопросы.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { txt, arr, SECTION_SCROLL_OFFSET } from "../utils";
import type { LandingApiBlock } from "../types";

const DEFAULT_FAQ = [
  { q: "Что такое VPN и зачем он нужен?", a: "VPN шифрует трафик, помогает обойти блокировки и обеспечивает стабильный доступ к нужным сервисам — дома, в поездках и за рубежом." },
  { q: "Ведётся ли логирование подключений?", a: "Нет. Сервис придерживается zero-log подхода: история активности не хранится, действия не привязываются к личности." },
  { q: "Сколько устройств можно подключить?", a: "Зависит от выбранного тарифа. Лимиты, срок и условия отображаются в кабинете и могут гибко настраиваться." },
  { q: "Как быстро начать?", a: "Регистрируешься, выбираешь тариф, оплачиваешь и сразу получаешь инструкции в кабинете и в Telegram-боте." },
];

interface FaqItem {
  q: string;
  a: string;
}

export function FaqAccordion({ block }: { block: LandingApiBlock }) {
  const items = arr<FaqItem>(block.text, "items", DEFAULT_FAQ);
  const title = txt(block.text, "title", "Частые вопросы");
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className={`container mx-auto px-4 py-16 md:py-24 ${SECTION_SCROLL_OFFSET}`}>
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl dark:text-white">{title}</h2>

        <div className="mt-10 space-y-3">
          {items.map((item, idx) => {
            const isOpen = open === idx;
            return (
              <div
                key={`${item.q}-${idx}`}
                className="overflow-hidden rounded-3xl border border-slate-200/70 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-xl"
              >
                <button
                  onClick={() => setOpen(isOpen ? null : idx)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-slate-50/60 dark:hover:bg-white/5"
                >
                  <span className="text-base font-semibold text-slate-950 dark:text-white md:text-lg">{item.q}</span>
                  <motion.span animate={{ rotate: isOpen ? 180 : 0 }} className="shrink-0">
                    <ChevronDown className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="px-6 pb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300 md:text-base">
                        {item.a}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
