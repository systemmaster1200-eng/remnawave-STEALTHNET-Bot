/**
 * Hero (variant: split) — двух-колоночный hero с акцентным заголовком, CTA и right-card.
 * Текст: badge, headline1, headline2, title, subtitle, hint, ctaText, secondaryCtaText, paymentText.
 * Props: ctaUrl, secondaryCtaUrl, showRightCard.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUtmCaptureAndBuildLink, txt, p, SECTION_SCROLL_OFFSET, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

interface HeroSplitProps {
  block: LandingApiBlock;
  serviceName: string;
}

export function HeroSplit({ block, serviceName }: HeroSplitProps) {
  const { accentTheme, resolvedMode } = useLandingTheme();
  const buildLink = useUtmCaptureAndBuildLink();

  const badge = txt(block.text, "badge", "Приватность · Скорость · Доступ");
  const headline1 = txt(block.text, "headline1", "Подключение, которое");
  const headline2 = txt(block.text, "headline2", "выглядит дорого");
  const title = txt(block.text, "title", serviceName);
  const subtitle = txt(
    block.text,
    "subtitle",
    "Telegram, YouTube, видеозвонки и доступ к любым сервисам в одной подписке. Без ограничений и сложных настроек.",
  );
  const hint = txt(block.text, "hint", "Регистрация за минуту · Карта · СБП · Кошелёк · Крипта");
  const ctaText = txt(block.text, "ctaText", "Попробовать");
  const secondaryCtaText = txt(block.text, "secondaryCtaText", "Войти в кабинет");
  const ctaUrl = p(block.props, "ctaUrl", "/cabinet/register");
  const secondaryCtaUrl = p(block.props, "secondaryCtaUrl", "/cabinet/login");

  const accentBg = `linear-gradient(135deg, ${accentTheme.primary}, ${accentTheme.tertiary})`;
  const accentText: React.CSSProperties = {
    backgroundImage: accentBg,
    color: resolvedMode === "dark" ? accentTheme.tertiary : accentTheme.primary,
  };

  return (
    <section id="home" className={`container mx-auto px-4 pb-12 pt-12 md:pb-20 md:pt-16 ${SECTION_SCROLL_OFFSET}`}>
      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <motion.div {...fadeUp} className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200/60 dark:border-white/10 bg-white/90 dark:bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-slate-600 backdrop-blur-xl dark:text-slate-300">
            <Sparkles className="h-4 w-4" style={{ color: accentTheme.primary }} />
            {badge}
          </div>

          <h1 className="text-5xl font-black leading-[0.95] tracking-[-0.05em] text-slate-950 md:text-6xl lg:text-[5.4rem] dark:text-white">
            {headline1}
            <span className="block bg-clip-text text-transparent" style={accentText}>
              {headline2}
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300 md:text-xl">
            {title ? <span className="font-semibold text-slate-900 dark:text-white">{title}</span> : null}
            {title ? " — " : null}
            {subtitle}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="group h-14 rounded-full border px-7 text-base font-semibold text-white shadow-lg" style={{ background: accentBg, borderColor: "transparent" }}>
              <Link to={buildLink(ctaUrl)} className="flex items-center justify-center gap-2">
                {ctaText}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-14 rounded-full border-slate-200/80 dark:border-white/12 bg-white/70 dark:bg-white/8 px-7 text-base text-slate-900 dark:text-white backdrop-blur-xl">
              <Link to={buildLink(secondaryCtaUrl)}>{secondaryCtaText}</Link>
            </Button>
          </div>

          {hint ? <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">{hint}</p> : null}
        </motion.div>

        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="rounded-[28px] border border-slate-200/60 dark:border-white/10 bg-gradient-to-br from-white via-white to-slate-50/50 dark:from-slate-900/40 dark:via-slate-900/20 dark:to-slate-950/0 p-6 shadow-[0_25px_80px_-30px_rgba(15,23,42,0.25)] backdrop-blur-xl"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.32em]" style={{ color: accentTheme.primary }}>
            {txt(block.text, "rightCardEyebrow", "Premium Access")}
          </div>
          <h3 className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-950 dark:text-white">
            {txt(block.text, "rightCardTitle", "Один доступ — все нужные сервисы")}
          </h3>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            {txt(block.text, "rightCardSubtitle", "Подключи устройства, оплати как удобно — и сервис работает.")}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {(["AES-256", "Zero-Log", "Карта · СБП", "USDT"] as const).map((tag) => (
              <span key={tag} className="rounded-full border border-slate-200/70 dark:border-white/10 bg-white/70 dark:bg-white/8 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                {tag}
              </span>
            ))}
          </div>
        </motion.aside>
      </div>
    </section>
  );
}
