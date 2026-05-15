/**
 * Devices (variant: strip) — список поддерживаемых платформ.
 */

import { motion } from "framer-motion";
import { Apple, Monitor, Smartphone, Terminal, Globe, type LucideIcon } from "lucide-react";
import { txt, arr, SECTION_SCROLL_OFFSET, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

const DEFAULT_DEVICES = [
  { name: "Windows" },
  { name: "macOS" },
  { name: "iPhone / iPad" },
  { name: "Android" },
  { name: "Linux" },
];

function iconFor(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("mac")) return Apple;
  if (n.includes("iphone") || n.includes("ipad") || n.includes("ios")) return Apple;
  if (n.includes("android")) return Smartphone;
  if (n.includes("linux")) return Terminal;
  if (n.includes("windows")) return Monitor;
  return Globe;
}

export function DevicesStrip({ block }: { block: LandingApiBlock }) {
  const { accentTheme } = useLandingTheme();
  const items = arr<{ name: string }>(block.props, "items", DEFAULT_DEVICES);

  const title = txt(block.text, "title", "Работает на всех платформах");
  const subtitle = txt(block.text, "subtitle", "Один аккаунт — все устройства. Деплой и подключение за минуту.");

  return (
    <section id="devices" className={`container mx-auto px-4 py-16 md:py-24 ${SECTION_SCROLL_OFFSET}`}>
      <div className="text-center">
        <h2 className="text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl dark:text-white">{title}</h2>
        {subtitle ? <p className="mx-auto mt-3 max-w-xl text-base text-slate-600 dark:text-slate-300">{subtitle}</p> : null}
      </div>

      <div className="mx-auto mt-10 flex max-w-4xl flex-wrap justify-center gap-3">
        {items.map((it, idx) => {
          const Icon = iconFor(it.name);
          return (
            <motion.div
              key={`${it.name}-${idx}`}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: idx * 0.05 }}
              className="flex items-center gap-2.5 rounded-full border border-slate-200/70 dark:border-white/10 bg-white/80 dark:bg-white/5 px-5 py-3 backdrop-blur-xl"
            >
              <Icon className="h-4 w-4" style={{ color: accentTheme.primary }} />
              <span className="text-sm font-medium text-slate-900 dark:text-white">{it.name}</span>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
