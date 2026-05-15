/**
 * CTA (variant: full-banner) — финальный призыв с акцентным фоном.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUtmCaptureAndBuildLink, txt, p, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

export function CtaBanner({ block }: { block: LandingApiBlock }) {
  const { accentTheme } = useLandingTheme();
  const buildLink = useUtmCaptureAndBuildLink();

  const eyebrow = txt(block.text, "eyebrow", "Готов начать?");
  const title = txt(block.text, "title", "Подключись за 30 секунд");
  const desc = txt(block.text, "desc", "Регистрация без лишних полей, оплата привычным способом, доступ — сразу.");
  const ctaText = txt(block.text, "ctaText", "Начать сейчас");
  const ctaUrl = p(block.props, "ctaUrl", "/cabinet/register");

  const accentBg = `linear-gradient(135deg, ${accentTheme.primary}, ${accentTheme.tertiary})`;

  return (
    <section className="container mx-auto px-4 pb-20 pt-4 md:pb-28">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="relative overflow-hidden rounded-[36px] p-10 text-center md:p-16"
        style={{ background: accentBg }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%),radial-gradient(circle_at_75%_80%,rgba(255,255,255,0.12),transparent_50%)]" />

        <div className="relative mx-auto max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.32em] text-white/80">{eyebrow}</div>
          <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-white md:text-5xl">{title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/90 md:text-lg">{desc}</p>
          <Button asChild size="lg" className="group mt-8 h-14 rounded-full bg-white px-8 text-base font-semibold text-slate-950 shadow-lg hover:bg-white/95">
            <Link to={buildLink(ctaUrl)} className="flex items-center gap-2">
              {ctaText}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>
      </motion.div>
    </section>
  );
}
