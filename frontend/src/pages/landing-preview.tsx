/**
 * Превью лендинга для админа: рендерит блоки с подмешанными черновиками.
 * Используется как iframe-источник внутри `/admin/landing-editor`.
 *
 * Auth: токен из useAuth — нужен для `/api/admin/landing/preview`.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type PublicConfig } from "@/lib/api";
import { fetchLandingPreview } from "@/lib/landing-api";
import type { LandingApiResponse, LandingApiBlock } from "@/components/landing-blocks/types";
import { BlockRenderer } from "@/components/landing-blocks/block-renderer";
import { LandingHeader } from "@/components/landing-blocks/header";
import { useUtmCaptureAndBuildLink } from "@/components/landing-blocks/utils";
import { Eye, Pencil } from "lucide-react";

export function LandingPreviewPage() {
  const { state } = useAuth();
  const token = state.accessToken;

  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [data, setData] = useState<LandingApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useUtmCaptureAndBuildLink();

  useEffect(() => {
    api.getPublicConfig().then(setConfig).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!token || !config) return;
    const lang = config.defaultLanguage ?? "ru";
    fetchLandingPreview(token, lang)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [token, config]);

  // Подгрузка шрифта.
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
  }, [data?.theme.fontFamily, data?.theme.fontPresets]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-sm text-slate-600 dark:text-slate-400">Ошибка превью: {error}</div>
      </div>
    );
  }

  if (!data || !config) {
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

  const heroBlock = data.blocks.find((b) => b.type === "hero");
  const headerCta = (heroBlock?.text.ctaText as string | undefined) ?? "В кабинет";
  const headerLogin = (heroBlock?.text.secondaryCtaText as string | undefined) ?? "Вход";
  const headerBadge = heroBlock?.text.headerBadge as string | undefined;

  const themeStyle: React.CSSProperties = {
    fontFamily: data.theme.fontFamily ? `var(--landing-font, ${data.theme.fontFamily})` : undefined,
    backgroundColor: data.theme.backgroundColor ?? undefined,
    color: data.theme.textColor ?? undefined,
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-white via-slate-50/50 to-white text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-950 dark:text-slate-100"
      style={themeStyle}
    >
      {data.theme.customCss ? <style dangerouslySetInnerHTML={{ __html: data.theme.customCss }} /> : null}

      {/* Preview banner */}
      <div className="sticky top-0 z-[60] flex items-center justify-center gap-2 border-b border-amber-300/40 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
        <Eye className="h-3.5 w-3.5" />
        Превью с черновиками — изменения видны только админу
      </div>

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
          <EditableBlock key={block.id} block={block} serviceName={config.serviceName} />
        ))}
      </main>
    </div>
  );
}

/**
 * Обёртка над BlockRenderer: если открыто внутри iframe, добавляет hover-рамку и
 * pencil-кнопку. Клик постит сообщение родителю чтобы тот выбрал блок в редакторе.
 */
function EditableBlock({ block, serviceName }: { block: LandingApiBlock; serviceName: string }) {
  const inIframe = useMemo(() => typeof window !== "undefined" && window.parent !== window, []);
  if (!inIframe) {
    return <BlockRenderer block={block} serviceName={serviceName} />;
  }
  const onPick = () => {
    window.parent.postMessage({ type: "stealthnet-landing:edit-block", id: block.id }, "*");
  };
  return (
    <div
      onClick={onPick}
      data-block-id={block.id}
      className="group relative cursor-pointer transition-all hover:ring-2 hover:ring-emerald-500 hover:ring-offset-2 hover:ring-offset-transparent"
    >
      <div className="pointer-events-none absolute right-3 top-3 z-50 flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        <Pencil className="h-3 w-3" />
        Редактировать
      </div>
      <div className="pointer-events-none">
        <BlockRenderer block={block} serviceName={serviceName} />
      </div>
    </div>
  );
}
