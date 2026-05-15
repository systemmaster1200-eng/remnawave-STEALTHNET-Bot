/**
 * Schemas описывают набор полей каждого блок-типа для автогенерации формы редактора.
 * Поля делятся на `props` (структурные — цвета/ссылки/картинки) и `i18n` (переводимые тексты).
 *
 * Формы для языков: пока редактируем только текущий язык (RU). Когда подключим i18n,
 * добавим переключатель ru/en сверху над i18n-секцией.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "url"
  | "bool"
  | "color"
  | "image"
  | "select"
  | "number"
  | "list-text" // массив строк
  | "list-pair" // массив объектов с подполями (см. itemFields)
  ;

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  placeholder?: string;
  rows?: number;
  /** Для select. */
  options?: { value: string; label: string }[];
  /** Для list-pair: подполя каждого элемента. */
  itemFields?: FieldSchema[];
  /** Максимальное число элементов в list-* (для UI-лимита). */
  maxItems?: number;
}

export interface BlockSchema {
  type: string;
  label: string;
  /** Имя иконки lucide-react (см. icon-map в landing-editor.tsx). */
  icon: string;
  /** Краткое описание для подсказки и галереи добавления. */
  description?: string;
  /** Доступные варианты для этого типа. */
  variants: { value: string; label: string }[];
  /** Поля в props (одинаковые для всех вариантов). */
  propsFields: FieldSchema[];
  /** Поля в i18n.<lang> (одинаковые для всех вариантов). */
  i18nFields: FieldSchema[];
}

const ITEM_TITLE_DESC: FieldSchema[] = [
  { key: "title", label: "Заголовок", type: "text" },
  { key: "desc", label: "Описание", type: "textarea", rows: 2 },
];

const ITEM_LABEL_SUB: FieldSchema[] = [
  { key: "label", label: "Лейбл", type: "text" },
  { key: "sub", label: "Подпись", type: "text" },
];

const ITEM_Q_A: FieldSchema[] = [
  { key: "q", label: "Вопрос", type: "text" },
  { key: "a", label: "Ответ", type: "textarea", rows: 3 },
];

const ITEM_VALUE_LABEL: FieldSchema[] = [
  { key: "value", label: "Значение", type: "text", placeholder: "5+" },
  { key: "label", label: "Подпись", type: "text", placeholder: "платформ" },
];

const ITEM_NAME: FieldSchema[] = [
  { key: "name", label: "Название", type: "text" },
];

export const BLOCK_SCHEMAS: Record<string, BlockSchema> = {
  hero: {
    type: "hero",
    label: "Главный экран",
    icon: "Sparkles",
    description: "Заголовок, подзаголовок и две кнопки. Первое, что видит пользователь.",
    variants: [
      { value: "split", label: "Две колонки" },
    ],
    propsFields: [
      { key: "ctaUrl", label: "Главная CTA-ссылка", type: "url", placeholder: "/cabinet/register" },
      { key: "secondaryCtaUrl", label: "Вторая ссылка", type: "url", placeholder: "/cabinet/login" },
      { key: "showRightCard", label: "Показывать карточку справа", type: "bool" },
    ],
    i18nFields: [
      { key: "badge", label: "Бейдж", type: "text", hint: "Маленький текст над заголовком (uppercase)" },
      { key: "headline1", label: "Заголовок (часть 1)", type: "text" },
      { key: "headline2", label: "Заголовок (часть 2 — акцент)", type: "text", hint: "Подсветится градиентом" },
      { key: "title", label: "Имя сервиса в подзаголовке", type: "text" },
      { key: "subtitle", label: "Подзаголовок", type: "textarea", rows: 3 },
      { key: "hint", label: "Подсказка под кнопками", type: "text" },
      { key: "ctaText", label: "Текст главной кнопки", type: "text", placeholder: "Попробовать" },
      { key: "secondaryCtaText", label: "Текст второй кнопки", type: "text", placeholder: "Войти в кабинет" },
      { key: "headerBadge", label: "Бейдж в шапке (над названием)", type: "text" },
      { key: "rightCardEyebrow", label: "Карточка справа: бейдж", type: "text", placeholder: "Premium Access" },
      { key: "rightCardTitle", label: "Карточка справа: заголовок", type: "text" },
      { key: "rightCardSubtitle", label: "Карточка справа: подпись", type: "textarea", rows: 2 },
    ],
  },

  features: {
    type: "features",
    label: "Возможности",
    icon: "Star",
    description: "Полоса из 5 карточек с короткими преимуществами (Защита, Zero-Log, Оплата…).",
    variants: [{ value: "strip", label: "Полоса" }],
    propsFields: [],
    i18nFields: [
      {
        key: "items",
        label: "Карточки",
        type: "list-pair",
        maxItems: 5,
        itemFields: ITEM_LABEL_SUB,
        hint: "До 5 карточек. Иконки выбираются автоматически по позиции.",
      },
    ],
  },

  benefits: {
    type: "benefits",
    label: "Преимущества",
    icon: "Award",
    description: "Большой блок с 4 или 6 карточками-преимуществами + заголовок и подзаголовок.",
    variants: [
      { value: "cards-6", label: "6 карточек" },
      { value: "cards-4", label: "4 карточки" },
    ],
    propsFields: [],
    i18nFields: [
      { key: "badge", label: "Бейдж", type: "text", placeholder: "Преимущества" },
      { key: "title", label: "Заголовок", type: "text" },
      { key: "subtitle", label: "Подзаголовок", type: "textarea", rows: 2 },
      {
        key: "items",
        label: "Карточки",
        type: "list-pair",
        maxItems: 6,
        itemFields: ITEM_TITLE_DESC,
      },
    ],
  },

  stats: {
    type: "stats",
    label: "Цифры",
    icon: "BarChart3",
    description: "Полоса больших цифр с подписями: 5+ платформ, 6 способов оплаты, 99% аптайм.",
    variants: [
      { value: "strip-3", label: "3 цифры" },
      { value: "strip-4", label: "4 цифры" },
    ],
    propsFields: [],
    i18nFields: [
      {
        key: "items",
        label: "Цифры",
        type: "list-pair",
        maxItems: 4,
        itemFields: ITEM_VALUE_LABEL,
        hint: "Каждая запись — одно число и подпись (например, «6» / «способов оплаты»).",
      },
    ],
  },

  tariffs: {
    type: "tariffs",
    label: "Тарифы",
    icon: "Tag",
    description: "Карточки тарифов из админки. Цены и условия подтягиваются автоматически.",
    variants: [{ value: "live", label: "Живые из админки" }],
    propsFields: [],
    i18nFields: [
      { key: "title", label: "Заголовок", type: "text" },
      { key: "subtitle", label: "Подзаголовок", type: "textarea", rows: 2 },
      { key: "buttonChooseTariff", label: "Текст кнопки на карточке", type: "text", placeholder: "Выбрать" },
      { key: "noTariffsMessage", label: "Сообщение «нет тарифов»", type: "text" },
    ],
  },

  devices: {
    type: "devices",
    label: "Платформы",
    icon: "Monitor",
    description: "Поддерживаемые устройства: Windows, macOS, iPhone, Android, Linux.",
    variants: [{ value: "strip", label: "Полоса" }],
    propsFields: [
      {
        key: "items",
        label: "Платформы",
        type: "list-pair",
        maxItems: 8,
        itemFields: ITEM_NAME,
        hint: "Иконки автоматически по названию (Windows, macOS, iPhone…).",
      },
    ],
    i18nFields: [
      { key: "title", label: "Заголовок", type: "text" },
      { key: "subtitle", label: "Подзаголовок", type: "textarea", rows: 2 },
    ],
  },

  faq: {
    type: "faq",
    label: "Частые вопросы",
    icon: "HelpCircle",
    description: "Раскрывающиеся вопросы и ответы. Сюда хорошо ложатся «работает ли в РФ?», «возврат денег», «лимит устройств».",
    variants: [{ value: "accordion", label: "Аккордеон" }],
    propsFields: [],
    i18nFields: [
      { key: "title", label: "Заголовок", type: "text", placeholder: "Частые вопросы" },
      {
        key: "items",
        label: "Вопросы",
        type: "list-pair",
        maxItems: 20,
        itemFields: ITEM_Q_A,
      },
    ],
  },

  cta: {
    type: "cta",
    label: "Призыв к действию",
    icon: "Megaphone",
    description: "Финальный баннер с яркой кнопкой. Закрывает страницу и подталкивает к регистрации.",
    variants: [{ value: "full-banner", label: "Полный баннер" }],
    propsFields: [{ key: "ctaUrl", label: "Ссылка кнопки", type: "url" }],
    i18nFields: [
      { key: "eyebrow", label: "Бейдж", type: "text" },
      { key: "title", label: "Заголовок", type: "text" },
      { key: "desc", label: "Описание", type: "textarea", rows: 2 },
      { key: "ctaText", label: "Текст кнопки", type: "text" },
    ],
  },

  logos: {
    type: "logos",
    label: "Логотипы / партнёры",
    icon: "ImageIcon",
    description: "Полоса логотипов: платёжки, партнёры, сертификаты. В чёрно-белом, цветные при наведении.",
    variants: [{ value: "strip", label: "Полоса" }],
    propsFields: [
      {
        key: "items",
        label: "Логотипы",
        type: "list-pair",
        maxItems: 12,
        itemFields: [
          { key: "imageUrl", label: "Картинка", type: "image" },
          { key: "alt", label: "Alt-текст", type: "text", placeholder: "СБП" },
          { key: "href", label: "Ссылка (опционально)", type: "url" },
        ],
        hint: "Загружайте PNG/SVG с прозрачным фоном.",
      },
    ],
    i18nFields: [
      { key: "title", label: "Заголовок (опционально)", type: "text", placeholder: "Принимаем оплату" },
      { key: "subtitle", label: "Подзаголовок", type: "text" },
    ],
  },

  testimonials: {
    type: "testimonials",
    label: "Отзывы",
    icon: "MessageSquare",
    description: "Карточки с отзывами клиентов. Аватар или инициалы, имя, роль.",
    variants: [{ value: "cards", label: "Карточки" }],
    propsFields: [],
    i18nFields: [
      { key: "title", label: "Заголовок", type: "text", placeholder: "Что говорят пользователи" },
      { key: "subtitle", label: "Подзаголовок", type: "text" },
      {
        key: "items",
        label: "Отзывы",
        type: "list-pair",
        maxItems: 6,
        itemFields: [
          { key: "text", label: "Текст отзыва", type: "textarea", rows: 3 },
          { key: "author", label: "Имя", type: "text" },
          { key: "role", label: "Роль / должность", type: "text", placeholder: "клиент" },
          { key: "avatar", label: "Аватар (опционально)", type: "image" },
        ],
      },
    ],
  },

  video: {
    type: "video",
    label: "Видео",
    icon: "Video",
    description: "YouTube, Vimeo или прямая ссылка mp4/webm. Адаптивный плеер 16:9.",
    variants: [{ value: "embed", label: "Embed" }],
    propsFields: [
      { key: "url", label: "URL видео", type: "url", placeholder: "https://youtu.be/dQw4w9WgXcQ", hint: "YouTube, Vimeo или прямая ссылка mp4/webm." },
      { key: "poster", label: "Постер (только для mp4)", type: "image" },
    ],
    i18nFields: [
      { key: "title", label: "Заголовок секции", type: "text" },
      { key: "caption", label: "Подпись под видео", type: "text" },
    ],
  },

  spacer: {
    type: "spacer",
    label: "Пустое пространство",
    icon: "Minus",
    description: "Отступ между блоками. Размер выбирается в варианте.",
    variants: [
      { value: "xs", label: "Очень маленький" },
      { value: "sm", label: "Маленький" },
      { value: "md", label: "Средний" },
      { value: "lg", label: "Большой" },
      { value: "xl", label: "Огромный" },
    ],
    propsFields: [],
    i18nFields: [],
  },

  custom: {
    // Внутри `custom` живут несколько вариантов — обработаем особо: schema выбирается по variant.
    // BLOCK_SCHEMAS["custom"] здесь — заглушка; реальные схемы в CUSTOM_VARIANT_SCHEMAS.
    type: "custom",
    label: "Кастомный блок",
    icon: "Layers",
    description: "Готовые шаблоны, которые не входят в стандартные категории.",
    variants: [
      { value: "journey", label: "Шаги — как это работает" },
      { value: "footer", label: "Подвал лендинга" },
    ],
    propsFields: [],
    i18nFields: [],
  },
};

/** Описание для каждого варианта (для add-galery / hover hints). */
export const VARIANT_DESCRIPTIONS: Record<string, string> = {
  "custom/journey": "Три пронумерованных шага: «выбираешь → оплачиваешь → подключаешься».",
  "custom/footer": "Низ страницы с копирайтом, контактами и ссылками на оферту/политику.",
};

export const CUSTOM_VARIANT_SCHEMAS: Record<string, { propsFields: FieldSchema[]; i18nFields: FieldSchema[] }> = {
  journey: {
    propsFields: [
      {
        key: "steps",
        label: "Шаги",
        type: "list-pair",
        maxItems: 3,
        itemFields: ITEM_TITLE_DESC,
      },
    ],
    i18nFields: [
      { key: "title", label: "Заголовок секции", type: "text" },
      { key: "desc", label: "Подзаголовок секции", type: "textarea", rows: 2 },
    ],
  },
  footer: {
    propsFields: [
      { key: "offerLink", label: "Ссылка на оферту", type: "url" },
      { key: "privacyLink", label: "Ссылка на политику", type: "url" },
    ],
    i18nFields: [
      { key: "contacts", label: "Контакты", type: "text", placeholder: "support@stealthnet.app" },
      { key: "footerText", label: "Копирайт / текст в подвале", type: "text" },
    ],
  },
};

/** Получает schema для конкретного блока (с учётом custom-вариантов). */
export function getBlockSchema(type: string, variant: string): BlockSchema | null {
  const base = BLOCK_SCHEMAS[type];
  if (!base) return null;
  if (type === "custom") {
    const cv = CUSTOM_VARIANT_SCHEMAS[variant];
    if (!cv) return null;
    return { ...base, propsFields: cv.propsFields, i18nFields: cv.i18nFields };
  }
  return base;
}
