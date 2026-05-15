/**
 * Tariffs (variant: live) — тарифы из API. Отдельный компонент для SSR-friendly загрузки.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, type PublicTariffCategory } from "@/lib/api";
import { useUtmCaptureAndBuildLink, txt, SECTION_SCROLL_OFFSET, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

interface TariffsLiveProps {
  block: LandingApiBlock;
}

export function TariffsLive({ block }: TariffsLiveProps) {
  const { accentTheme } = useLandingTheme();
  const buildLink = useUtmCaptureAndBuildLink();
  const [categories, setCategories] = useState<PublicTariffCategory[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPublicTariffs()
      .then((res) => setCategories(res.items))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, []);

  const title = txt(block.text, "title", "Тарифы");
  const subtitle = txt(block.text, "subtitle", "Выбирай удобный сценарий — без переплат и со свободой смены тарифа.");
  const noTariffsMessage = txt(block.text, "noTariffsMessage", "Скоро тарифы появятся — следи за обновлениями.");
  const buttonChooseTariff = txt(block.text, "buttonChooseTariff", "Выбрать");

  const accentBg = `linear-gradient(135deg, ${accentTheme.primary}, ${accentTheme.tertiary})`;

  return (
    <section id="tariffs" className={`container mx-auto px-4 py-16 md:py-24 ${SECTION_SCROLL_OFFSET}`}>
      <div className="text-center">
        <h2 className="text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-5xl dark:text-white">{title}</h2>
        {subtitle ? <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 dark:text-slate-300 md:text-lg">{subtitle}</p> : null}
      </div>

      {loading ? (
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-3xl border border-slate-200/70 dark:border-white/10 bg-white/40 dark:bg-white/5" />
          ))}
        </div>
      ) : categories && categories.length > 0 ? (
        <div className="mt-12 space-y-12">
          {categories.map((cat) => (
            <div key={cat.id}>
              {cat.name ? <h3 className="mb-5 text-xl font-bold text-slate-950 dark:text-white">{cat.name}</h3> : null}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {cat.tariffs.map((t, idx) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.35, delay: idx * 0.04 }}
                  >
                    <Card className="h-full border-slate-200/70 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-xl">
                      <CardContent className="flex h-full flex-col p-6">
                        <h4 className="text-lg font-bold text-slate-950 dark:text-white">{t.name}</h4>
                        {t.description ? (
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t.description}</p>
                        ) : null}

                        <div className="mt-5 flex items-baseline gap-1">
                          <span className="text-4xl font-black tracking-tight" style={{ color: accentTheme.primary }}>
                            {t.price}
                          </span>
                          <span className="text-sm text-slate-500 dark:text-slate-400">{t.currency.toUpperCase()}</span>
                        </div>

                        <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                          {t.durationDays ? (
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4" style={{ color: accentTheme.primary }} />
                              {t.durationDays} дней доступа
                            </li>
                          ) : null}
                          {t.deviceLimit ? (
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4" style={{ color: accentTheme.primary }} />
                              До {t.deviceLimit} устройств
                            </li>
                          ) : null}
                          {t.trafficLimitBytes ? (
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4" style={{ color: accentTheme.primary }} />
                              {Math.round(t.trafficLimitBytes / 1024 / 1024 / 1024)} GB трафика
                            </li>
                          ) : (
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4" style={{ color: accentTheme.primary }} />
                              Без лимита трафика
                            </li>
                          )}
                        </ul>

                        <Button asChild className="group mt-6 h-11 rounded-full font-semibold text-white" style={{ background: accentBg }}>
                          <Link to={buildLink("/cabinet/register")} className="flex items-center justify-center gap-2">
                            {buttonChooseTariff}
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-10 rounded-3xl border border-dashed border-slate-300 dark:border-white/10 bg-white/60 dark:bg-white/5 px-8 py-16 text-center">
          <p className="text-base text-slate-600 dark:text-slate-300">{noTariffsMessage}</p>
        </div>
      )}
    </section>
  );
}
