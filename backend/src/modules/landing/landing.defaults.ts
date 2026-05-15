/**
 * Канонические дефолты блоков лендинга. Используются в:
 * - migrate-landing-to-blocks (для новых инсталляций — сразу с заполнённым контентом),
 * - applyBlockDefaults (кнопка «Стандартные значения» в редакторе),
 * - seedDefaultsToEmptyBlocks (одноразовая заливка для существующих блоков с пустым i18n).
 *
 * Когда фронтенд-компонент рендерит блок с пустым полем, он показывает свой
 * локальный fallback (см. DEFAULT_ITEMS в features-strip.tsx и т.п.). Эти дефолты
 * отзеркаливают те fallbacks, чтобы редактор показывал то же, что и live-превью.
 */

export interface BlockDefaults {
  props?: Record<string, unknown>;
  i18n?: { ru?: Record<string, unknown>; en?: Record<string, unknown> };
}

export function getBlockDefaults(type: string, variant: string): BlockDefaults {
  const key = `${type}/${variant}`;
  switch (key) {
    case "hero/split":
      return {
        props: { ctaUrl: "/cabinet/register", secondaryCtaUrl: "/cabinet/login", showRightCard: true },
        i18n: {
          ru: {
            badge: "Приватность · Скорость · Доступ",
            headline1: "Подключение, которое",
            headline2: "выглядит дорого",
            title: "STEALTHNET",
            subtitle: "Telegram, YouTube, видеозвонки и доступ к любым сервисам в одной подписке. Без ограничений и сложных настроек.",
            hint: "Регистрация за минуту · Карта · СБП · Кошелёк · Крипта",
            ctaText: "Попробовать",
            secondaryCtaText: "Войти в кабинет",
            rightCardEyebrow: "Premium Access",
            rightCardTitle: "Один доступ — все нужные сервисы",
            rightCardSubtitle: "Подключи устройства, оплати как удобно — и сервис работает.",
          },
        },
      };

    case "features/strip":
      return {
        i18n: {
          ru: {
            items: [
              { label: "Защита", sub: "Современные протоколы" },
              { label: "Zero-Log", sub: "История не сохраняется" },
              { label: "Оплата", sub: "Анонимно и безопасно" },
              { label: "Серверы", sub: "Собственная инфраструктура" },
              { label: "Установка", sub: "За 30 секунд" },
            ],
          },
        },
      };

    case "benefits/cards-6":
    case "benefits/cards-4":
      return {
        i18n: {
          ru: {
            badge: "Преимущества",
            title: "Почему выбирают нас",
            subtitle: "Шесть причин, почему сервис ощущается надёжным с первого экрана.",
            items: [
              { title: "Всегда онлайн", desc: "Работает стабильно даже в перегруженных сетях, быстрый отклик с любого устройства." },
              { title: "Сервисы без границ", desc: "Доступ к любым сайтам, видеозвонкам и работе без визуальных ограничений." },
              { title: "Своя инфраструктура", desc: "Без посредников: своя сеть и аккуратная маршрутизация под реальные сценарии." },
              { title: "Чистая приватность", desc: "Шифрование, маскировка, отсутствие лишних следов и привязок." },
              { title: "Управление в одном месте", desc: "Telegram-бот и личный кабинет, тарифы и продление в одной системе." },
              { title: "Премиум-опыт", desc: "Чистый и понятный продуктовый интерфейс от первого экрана до покупки." },
            ],
          },
        },
      };

    case "stats/strip-3":
      return {
        i18n: {
          ru: {
            items: [
              { value: "5+", label: "платформ" },
              { value: "6", label: "способов оплаты" },
              { value: "24/7", label: "поддержка" },
            ],
          },
        },
      };

    case "stats/strip-4":
      return {
        i18n: {
          ru: {
            items: [
              { value: "5+", label: "платформ" },
              { value: "6", label: "способов оплаты" },
              { value: "24/7", label: "поддержка" },
              { value: "99.9%", label: "аптайм" },
            ],
          },
        },
      };

    case "tariffs/live":
      return {
        i18n: {
          ru: {
            title: "Тарифы",
            subtitle: "Выбирай удобный сценарий — без переплат и со свободой смены тарифа.",
            buttonChooseTariff: "Выбрать",
            noTariffsMessage: "Скоро тарифы появятся — следи за обновлениями.",
          },
        },
      };

    case "devices/strip":
      return {
        props: {
          items: [
            { name: "Windows" },
            { name: "macOS" },
            { name: "iPhone / iPad" },
            { name: "Android" },
            { name: "Linux" },
          ],
        },
        i18n: {
          ru: {
            title: "Работает на всех платформах",
            subtitle: "Один аккаунт — все устройства. Деплой и подключение за минуту.",
          },
        },
      };

    case "faq/accordion":
      return {
        i18n: {
          ru: {
            title: "Частые вопросы",
            items: [
              { q: "Что такое VPN и зачем он нужен?", a: "VPN шифрует трафик, помогает обойти блокировки и обеспечивает стабильный доступ к нужным сервисам — дома, в поездках и за рубежом." },
              { q: "Ведётся ли логирование подключений?", a: "Нет. Сервис придерживается zero-log подхода: история активности не хранится, действия не привязываются к личности." },
              { q: "Сколько устройств можно подключить?", a: "Зависит от выбранного тарифа. Лимиты, срок и условия отображаются в кабинете и могут гибко настраиваться." },
              { q: "Как быстро начать?", a: "Регистрируешься, выбираешь тариф, оплачиваешь и сразу получаешь инструкции в кабинете и в Telegram-боте." },
            ],
          },
        },
      };

    case "cta/full-banner":
      return {
        props: { ctaUrl: "/cabinet/register" },
        i18n: {
          ru: {
            eyebrow: "Готов начать?",
            title: "Подключись за 30 секунд",
            desc: "Регистрация без лишних полей, оплата привычным способом, доступ — сразу.",
            ctaText: "Начать сейчас",
          },
        },
      };

    case "custom/journey":
      return {
        props: {
          steps: [
            { title: "Выбираешь сценарий", desc: "Гибкие тарифы под устройства и задачи. Не платишь за лишнее." },
            { title: "Оплачиваешь как удобно", desc: "Карта, СБП, кошелёк или крипта — выбирай удобный способ." },
            { title: "Подключаешься без боли", desc: "Бот и кабинет сразу выдадут инструкции. Настройка — минута." },
          ],
        },
        i18n: {
          ru: {
            title: "Как это работает",
            desc: "Три коротких шага: выбрал, оплатил, подключился.",
          },
        },
      };

    case "custom/footer":
      return {
        i18n: {
          ru: {
            footerText: `© ${new Date().getFullYear()} STEALTHNET. Все права защищены.`,
          },
        },
      };

    case "logos/strip":
      return {
        i18n: { ru: { title: "Принимаем оплату" } },
      };

    case "testimonials/cards":
      return {
        i18n: {
          ru: {
            title: "Что говорят пользователи",
            items: [
              { text: "Подключился за минуту, всё работает стабильно — даже на мобильном интернете.", author: "Алексей", role: "клиент" },
              { text: "Цены прозрачные, поддержка отвечает быстро. Лучшее, что пробовал из VPN.", author: "Мария", role: "клиент" },
              { text: "Кабинет понятный, тарифы гибкие, оплата через СБП — то что надо.", author: "Дмитрий", role: "клиент" },
            ],
          },
        },
      };

    case "video/embed":
      return {};

    default:
      return {};
  }
}

/** True если объект пустой или все его значения «пустые» (null/undefined/""/[]). */
function isEmptyish(o: unknown): boolean {
  if (o === null || o === undefined) return true;
  if (typeof o === "string") return o.trim() === "";
  if (Array.isArray(o)) return o.length === 0;
  if (typeof o === "object") {
    const keys = Object.keys(o as Record<string, unknown>);
    if (keys.length === 0) return true;
    return keys.every((k) => isEmptyish((o as Record<string, unknown>)[k]));
  }
  return false;
}

export function isBlockEmpty(props: unknown, i18n: unknown): boolean {
  // Блок «пустой» если в i18n.ru ничего нет и в props тоже почти ничего —
  // но props мы трактуем мягче, потому что некоторые блоки (devices/journey)
  // хранят данные именно в props.
  const i18nObj = (i18n ?? {}) as Record<string, unknown>;
  const ru = (i18nObj.ru ?? {}) as Record<string, unknown>;
  const i18nRuEmpty = isEmptyish(ru);
  const propsEmpty = isEmptyish(props);
  return i18nRuEmpty && propsEmpty;
}

/** Объединяет дефолты в существующие props/i18n, не перетирая то, что уже есть. */
export function mergeDefaults(
  existing: { props: Record<string, unknown>; i18n: Record<string, unknown> },
  defaults: BlockDefaults,
): { props: Record<string, unknown>; i18n: Record<string, unknown> } {
  const propsOut = { ...existing.props };
  if (defaults.props) {
    for (const [k, v] of Object.entries(defaults.props)) {
      if (propsOut[k] === undefined || isEmptyish(propsOut[k])) propsOut[k] = v;
    }
  }
  const existingI18n = (existing.i18n ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const i18nOut: Record<string, Record<string, unknown>> = {};
  for (const lang of Object.keys(defaults.i18n ?? {})) {
    const ex = existingI18n[lang] ?? {};
    const def = (defaults.i18n as Record<string, Record<string, unknown>>)[lang] ?? {};
    const merged: Record<string, unknown> = { ...ex };
    for (const [k, v] of Object.entries(def)) {
      if (merged[k] === undefined || isEmptyish(merged[k])) merged[k] = v;
    }
    i18nOut[lang] = merged;
  }
  // Сохраняем существующие языки, которых не было в дефолтах.
  for (const [lang, val] of Object.entries(existingI18n)) {
    if (!i18nOut[lang] && val) i18nOut[lang] = val;
  }
  return { props: propsOut, i18n: i18nOut };
}
