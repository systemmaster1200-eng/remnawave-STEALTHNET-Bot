/**
 * Типы блоков лендинга. Структура соответствует backend `landing.service.ts`
 * и публичному эндпоинту `GET /api/public/landing`.
 */

export interface LandingApiBlock {
  id: string;
  type: string;
  variant: string;
  order: number;
  /** Структурные настройки: цвета, лейаут, картинки, ссылки. */
  props: Record<string, unknown>;
  /** Локализованные тексты под текущий язык (уже выбраны на бэке). */
  text: Record<string, unknown>;
}

export interface LandingApiTheme {
  primaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  fontFamily?: string | null;
  fontPresets?: { name: string; url: string }[];
  borderRadius?: string | null;
  containerWidth?: string | null;
  customCss?: string | null;
}

export interface LandingApiResponse {
  blocks: LandingApiBlock[];
  theme: LandingApiTheme;
  lang: string;
}

/** Список поддерживаемых типов блоков. Должен совпадать с backend BLOCK_TYPES. */
export const BLOCK_TYPES = [
  "hero",
  "features",
  "benefits",
  "tariffs",
  "devices",
  "faq",
  "cta",
  "stats",
  "logos",
  "testimonials",
  "video",
  "spacer",
  "custom",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];
