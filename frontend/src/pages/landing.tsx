/**
 * Новый блочный лендинг — рендерит секции из `/api/public/landing`.
 * Старая монолитная версия (1392 строки) заменена набором компонентов в
 * `components/landing-blocks/`. Управление содержимым — через админ-редактор.
 */

import { useEffect, useState } from "react";
import type { PublicConfig } from "@/lib/api";
import { fetchLanding } from "@/lib/landing-api";
import type { LandingApiResponse } from "@/components/landing-blocks/types";
import { BlockRenderer } from "@/components/landing-blocks/block-renderer";
import { LandingHeader } from "@/components/landing-blocks/header";
import { useUtmCaptureAndBuildLink } from "@/components/landing-blocks/utils";

interface LandingPageProps {
  config: PublicConfig;
}

export function LandingPage({ config }: LandingPageProps) {
  const [data, setData] = useState<LandingApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Активирует UTM-капчер на корне страницы (в шапке/блоках сами уже).
  useUtmCaptureAndBuildLink();

  useEffect(() => {
    const lang = config.defaultLanguage ?? "ru";
    fetchLanding(lang)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [config.defaultLanguage]);

  // Подгрузка шрифта из темы.
  useEffect(() => {
    if (!data?.theme.fontFamily) return;
    const preset = (data.theme.fontPresets ?? []).find((f) => f.name === data.theme.fontFamily);
    if (!preset?.url) return;
    const linkId = "landing-font-link";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = preset.url;
    document.documentElement.style.setProperty("--landing-font", `"${preset.name}", sans-serif`);
    return () => {
      document.documentElement.style.removeProperty("--landing-font");
    };
  }, [data?.theme.fontFamily, data?.theme.fontPresets]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-sm text-slate-600 dark:text-slate-400">Не удалось загрузить лендинг: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-900 dark:border-slate-700 dark:border-t-white" />
      </div>
    );
  }

  const headerNav = [
    { label: "Преимущества", href: "#benefits" },
    { label: "Тарифы", href: "#tariffs" },
    { label: "Устройства", href: "#devices" },
    { label: "FAQ", href: "#faq" },
  ];

  // CTA-тексты для шапки (если есть Hero — берём из неё, иначе дефолты).
  const heroBlock = data.blocks.find((b) => b.type === "hero");
  const headerCta = (heroBlock?.text.ctaText as string | undefined) ?? "В кабинет";
  const headerLogin = (heroBlock?.text.secondaryCtaText as string | undefined) ?? "Вход";
  const headerBadge = heroBlock?.text.headerBadge as string | undefined;

  // Тема: применяем основные цвета через CSS-переменные.
  const themeStyle: React.CSSProperties = {
    fontFamily: data.theme.fontFamily ? `var(--landing-font, ${data.theme.fontFamily})` : undefined,
    backgroundColor: data.theme.backgroundColor ?? undefined,
    color: data.theme.textColor ?? undefined,
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50/50 to-white text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-950 dark:text-slate-100" style={themeStyle}>
      {data.theme.customCss ? <style dangerouslySetInnerHTML={{ __html: data.theme.customCss }} /> : null}

      <LandingHeader
        serviceName={config.serviceName}
        logoUrl={config.logo}
        navItems={headerNav}
        loginText={headerLogin}
        ctaText={headerCta}
        headerBadge={headerBadge}
      />

      <main>
        {data.blocks.map((block) => (
          <BlockRenderer key={block.id} block={block} serviceName={config.serviceName} />
        ))}
      </main>
    </div>
  );
}
