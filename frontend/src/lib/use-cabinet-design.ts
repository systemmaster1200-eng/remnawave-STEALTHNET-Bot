/**
 * Хук для чтения текущего дизайна кабинета (classic | stealth) из публичного
 * конфига.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  ПРАВИЛО: дизайн `stealth` — это **дизайн мини-аппы Telegram**.
 *  В обычном браузере (web cabinet) принудительно классический дизайн,
 *  даже если оператор выбрал Stealth в настройках. Stealth применяется
 *  только если страница открыта внутри Telegram WebApp.
 *
 *  Это разделение нужно потому что Stealth UI (тёмная неоновая тема,
 *  bottom-tabs навигация, full-height layout) рассчитан на мобильный
 *  вьюпорт мини-аппы и плохо смотрится в desktop-браузере.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Кэшируется в localStorage чтобы при следующем открытии не было
 * мерцания дефолтного classic перед загрузкой.
 */

import { useEffect, useState } from "react";
import { api } from "./api";

export type CabinetDesign = "classic" | "stealth";

const CACHE_KEY = "cabinet_design_cache";

/** True если страница открыта внутри Telegram Mini App (а не в обычном браузере) */
function isInsideTelegramMiniApp(): boolean {
  try {
    const tg = (window as { Telegram?: { WebApp?: { initData?: string; platform?: string } } }).Telegram?.WebApp;
    if (!tg) return false;
    if (typeof tg.initData === "string" && tg.initData.length > 0) return true;
    if (tg.platform && tg.platform !== "unknown") return true;
    return false;
  } catch {
    return false;
  }
}

type DesignCache = { design: CabinetDesign; applyInBrowser: boolean };

function readCache(): DesignCache {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    if (!v) return { design: "classic", applyInBrowser: false };
    // Поддерживаем legacy-формат: значение строкой "stealth"|"classic"
    if (v === "stealth" || v === "classic") return { design: v, applyInBrowser: false };
    const parsed = JSON.parse(v) as Partial<DesignCache>;
    const design = parsed.design === "stealth" ? "stealth" : "classic";
    const applyInBrowser = parsed.applyInBrowser === true;
    return { design, applyInBrowser };
  } catch {
    return { design: "classic", applyInBrowser: false };
  }
}

function writeCache(c: DesignCache): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

/**
 * Хук для чтения текущего дизайна кабинета.
 *
 *  ─── Логика ───
 *  Оператор в админке выбирает:
 *    • `cabinetDesign` — какой дизайн использовать (Classic или Stealth)
 *    • `cabinetDesignApplyInBrowser` — применять ли его и в обычном браузере
 *
 *  Поведение:
 *    1) Внутри Telegram Mini App — всегда `cabinetDesign` (как админ выбрал)
 *    2) В обычном браузере:
 *        • если `applyInBrowser=true` → `cabinetDesign`
 *        • если `applyInBrowser=false` (по умолчанию) → принудительно `classic`
 */
export function useCabinetDesign(): CabinetDesign {
  const inMiniapp = isInsideTelegramMiniApp();
  const cache = readCache();
  const initial: CabinetDesign = inMiniapp || cache.applyInBrowser ? cache.design : "classic";
  const [design, setDesign] = useState<CabinetDesign>(initial);

  useEffect(() => {
    let alive = true;
    api.getPublicConfig()
      .then((cfg) => {
        if (!alive) return;
        const adminDesign = (cfg as { cabinetDesign?: CabinetDesign }).cabinetDesign === "stealth" ? "stealth" : "classic";
        const applyInBrowser = Boolean((cfg as { cabinetDesignApplyInBrowser?: boolean }).cabinetDesignApplyInBrowser);
        writeCache({ design: adminDesign, applyInBrowser });
        const next: CabinetDesign = inMiniapp || applyInBrowser ? adminDesign : "classic";
        setDesign(next);
      })
      .catch(() => { /* ignore — keep cached */ });
    return () => { alive = false; };
  }, [inMiniapp]);

  return design;
}
