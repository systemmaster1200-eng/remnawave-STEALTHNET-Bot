import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "./locales/ru.json";
import en from "./locales/en.json";

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: "ru",
  fallbackLng: "ru",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export function loadLanguagePack(code: string, pack: Record<string, unknown>) {
  i18n.addResourceBundle(code, "translation", pack, true, true);
}

export default i18n;
