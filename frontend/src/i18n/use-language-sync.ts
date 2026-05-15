import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { loadLanguagePack } from "./init";
import { api } from "@/lib/api";

const loadedPackCodes = new Set<string>();
let packsFetchedPromise: Promise<Record<string, Record<string, unknown>>> | null = null;

function ensureTranslationsLoaded(): Promise<Record<string, Record<string, unknown>>> {
  if (!packsFetchedPromise) {
    packsFetchedPromise = api.getPublicConfig()
      .then((c) => {
        const packs = c.translations ?? {};
        for (const [code, pack] of Object.entries(packs)) {
          if (code === "ru" || loadedPackCodes.has(code)) continue;
          loadLanguagePack(code, pack);
          loadedPackCodes.add(code);
        }
        return packs;
      })
      .catch(() => ({} as Record<string, Record<string, unknown>>));
  }
  return packsFetchedPromise;
}

export function useLanguageSync(
  preferredLang: string | undefined | null,
  translations?: Record<string, Record<string, unknown>> | null,
) {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (translations) {
      for (const [code, pack] of Object.entries(translations)) {
        if (code === "ru" || loadedPackCodes.has(code)) continue;
        loadLanguagePack(code, pack);
        loadedPackCodes.add(code);
      }
      return;
    }
    ensureTranslationsLoaded();
  }, [translations]);

  useEffect(() => {
    const lang = preferredLang || "ru";
    ensureTranslationsLoaded().then(() => {
      if (i18n.language !== lang) {
        i18n.changeLanguage(lang);
      }
    });
  }, [preferredLang, i18n]);
}

export function useAdminLanguageSync() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const stored = localStorage.getItem("admin_preferred_lang") || "ru";
    ensureTranslationsLoaded().then(() => {
      if (i18n.language !== stored) {
        i18n.changeLanguage(stored);
      }
    });
  }, [i18n]);
}

export function setAdminLanguage(lang: string) {
  localStorage.setItem("admin_preferred_lang", lang);
}
