/**
 * Общие утилиты блоков: UTM-капчер, лейаут-помощники, акцентные стили.
 */

import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useTheme, type ThemeAccent } from "@/contexts/theme";

interface LandingAccentTheme {
  primary: string;
  secondary: string;
  tertiary: string;
}

const LANDING_ACCENT_THEMES: Record<ThemeAccent, LandingAccentTheme> = {
  default: { primary: "#10b981", secondary: "#06b6d4", tertiary: "#38bdf8" },
  blue: { primary: "#3b82f6", secondary: "#06b6d4", tertiary: "#60a5fa" },
  violet: { primary: "#8b5cf6", secondary: "#6366f1", tertiary: "#a78bfa" },
  rose: { primary: "#f43f5e", secondary: "#fb7185", tertiary: "#fda4af" },
  orange: { primary: "#f97316", secondary: "#fb923c", tertiary: "#fdba74" },
  green: { primary: "#22c55e", secondary: "#10b981", tertiary: "#4ade80" },
  emerald: { primary: "#10b981", secondary: "#14b8a6", tertiary: "#2dd4bf" },
  cyan: { primary: "#06b6d4", secondary: "#0ea5e9", tertiary: "#67e8f9" },
  amber: { primary: "#f59e0b", secondary: "#f97316", tertiary: "#fcd34d" },
  red: { primary: "#ef4444", secondary: "#f97316", tertiary: "#fca5a5" },
  pink: { primary: "#ec4899", secondary: "#f43f5e", tertiary: "#f9a8d4" },
  indigo: { primary: "#6366f1", secondary: "#8b5cf6", tertiary: "#a5b4fc" },
};

/** Возвращает акцентную палитру по текущей теме. Удобный wrapper над useTheme. */
export function useLandingTheme() {
  const { config, resolvedMode } = useTheme();
  const accentTheme = LANDING_ACCENT_THEMES[config.accent] ?? LANDING_ACCENT_THEMES.default;
  return { accentTheme, resolvedMode };
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
const UTM_STORAGE_KEY = "stealthnet_utm";

/**
 * Сохраняет UTM-метки из URL в localStorage и возвращает builder ссылок,
 * который добавляет сохранённые UTM к любой относительной ссылке.
 * Применяется ко всем CTA-кнопкам лендинга.
 */
export function useUtmCaptureAndBuildLink() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const fromUrl: Partial<Record<(typeof UTM_KEYS)[number], string>> = {};
    for (const key of UTM_KEYS) {
      const v = searchParams.get(key);
      if (v) fromUrl[key] = v;
    }
    if (Object.keys(fromUrl).length === 0) return;
    try {
      const raw = localStorage.getItem(UTM_STORAGE_KEY);
      const existing = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify({ ...existing, ...fromUrl }));
    } catch {
      // ignore corrupt storage
    }
  }, [searchParams]);

  return useMemo(() => {
    return (path: string) => {
      try {
        const stored = localStorage.getItem(UTM_STORAGE_KEY);
        if (!stored) return path;
        const data = JSON.parse(stored) as Record<string, string>;
        const params = new URLSearchParams();
        for (const k of UTM_KEYS) if (data[k]) params.set(k, data[k]);
        const qs = params.toString();
        if (!qs) return path;
        return path.includes("?") ? `${path}&${qs}` : `${path}?${qs}`;
      } catch {
        return path;
      }
    };
  }, []);
}

export const SECTION_SCROLL_OFFSET = "scroll-mt-24 md:scroll-mt-28";

/** Безопасный getter для локализованных строк. */
export function txt(text: Record<string, unknown>, key: string, fallback?: string): string {
  const v = text[key];
  if (typeof v === "string" && v.trim()) return v;
  return fallback ?? "";
}

/** Безопасный getter для строковых props. */
export function p(props: Record<string, unknown>, key: string, fallback?: string): string {
  const v = props[key];
  if (typeof v === "string" && v.trim()) return v;
  return fallback ?? "";
}

/** Получить массив из text/props с fallback на дефолтный. */
export function arr<T>(source: Record<string, unknown>, key: string, fallback: T[]): T[] {
  const v = source[key];
  if (Array.isArray(v) && v.length > 0) return v as T[];
  return fallback;
}
