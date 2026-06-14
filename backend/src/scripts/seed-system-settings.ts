import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";

const DEFAULTS: Array<[string, string]> = [
  ["active_languages", "ru,en"],
  ["active_currencies", "usd,rub"],
  ["default_referral_percent", "10"],
  ["trial_days", "3"],
  ["service_name", "STEALTHNET"],
  [
    "bot_inner_button_styles",
    '{"tariffPay":"success","topup":"primary","back":"danger","profile":"primary","trialConfirm":"success","lang":"primary","currency":"primary"}',
  ],
  ["category_emojis", '{"ordinary":"📦","premium":"⭐"}'],
  [
    "bot_emojis",
    '{"TRIAL":{"unicode":"🎁"},"PACKAGE":{"unicode":"📦"},"CARD":{"unicode":"💳"},"LINK":{"unicode":"🔗"},"SERVERS":{"unicode":"🌐"},"PUZZLE":{"unicode":"🧩"},"BACK":{"unicode":"◀️"},"MAIN_MENU":{"unicode":"👋"},"BALANCE":{"unicode":"💰"},"TARIFFS":{"unicode":"📦"},"HEADER":{"unicode":"🛡"}}',
  ],
  [
    "bot_menu_line_visibility",
    '{"welcomeTitlePrefix":true,"welcomeGreeting":true,"balancePrefix":true,"tariffPrefix":true,"subscriptionPrefix":true,"expirePrefix":true,"daysLeftPrefix":true,"devicesLabel":true,"trafficPrefix":true,"linkLabel":true,"chooseAction":true}',
  ],
  ["default_auto_renew_enabled", "false"],
  ["auto_renew_days_before_expiry", "1"],
  ["auto_renew_notify_days_before", "3"],
  ["auto_renew_grace_period_days", "2"],
  ["auto_renew_max_retries", "3"],
  ["yookassa_recurring_enabled", "false"],
  ["gift_subscriptions_enabled", "false"],
  ["gift_code_expiry_hours", "72"],
  ["max_additional_subscriptions", "5"],
  ["gift_code_format_length", "12"],
  ["gift_rate_limit_per_minute", "5"],
  ["gift_expiry_notification_days", "3"],
  ["gift_referral_enabled", "true"],
  ["gift_message_max_length", "200"],
  // ─── T11+T13+T14 (11.05.2026): дефолтные тексты бота со скринов ───
  // Часы работы поддержки (по эталону скрина 15: «10:00 до 22:00»).
  ["support_hours_from", "10:00"],
  ["support_hours_to", "22:00"],
  // T11 — большой блок «Цели/приоритеты» на экране Помощи (скрин 15).
  // Используется по умолчанию; админ может поменять через UI.
  [
    "help_intro_text",
    "Обращайтесь к нам по любым вопросам и предложениям ✨\n\n🎯 Наша цель - дать возможность каждому пользоваться безопасным интернетом без ограничений.\n🙃 Задача нашей поддержки - индивидуально и быстро решить вопрос каждого.\n\n⚡ Наши главные приоритеты - скорость, стабильность, безопасность, надежность, доступность 💪\n\n🔑 Обратите внимание, 1 подписку вы можете использовать одновременно (включить сервис одновременно) не более чем на 3 устройствах\n👍 Если вы хотите использовать сервис одновременно более чем на 3 устройствах, приобретите ещё 1 подписку.",
  ],
  // T11 — инструкция «Как подключить второе устройство» (скрин 17).
  [
    "install_second_device_text",
    "📲 Как подключить второе устройство:\n\n1️⃣ В этом боте нажмите «Моя подписка»\n(кнопка Меню в левом нижнем углу → Моя подписка)\n2️⃣ Выберите подписку, которую хотите установить\n3️⃣ Перед Вами будет Ваша подписка (похожа на ссылку), скопируйте её (в большинстве случаев для этого нужно нажать на неё один раз)\n4️⃣ Перенесите подписку на второе устройство любым удобным способом (например, отправьте через мессенджер).\n5️⃣ На втором устройстве установите приложение Happ (название может отличаться в зависимости от выбранного на вашем устройстве региона, но в названии точно будет слово Happ)\n6️⃣ На втором устройстве скопируйте полученную подписку.\n7️⃣ В Happ нажмите «+» в правом верхнем углу → «Добавить из буфера обмена» или Import from clipboard\n8️⃣ Нажмите во всплывшем окне «Разрешить вставку»\n9️⃣ Выберите в приложении Happ нужную локацию в добавленной подписке (для этого достаточно нажать на неё один раз).\n💡 Рекомендуем попробовать несколько локаций, чтобы понять, какая лучше работает именно у Вас.\n🔟 Нажмите кнопку включения в приложении (большая круглая кнопка посередине)\n✅ Разрешите добавление конфигурации\n\n🎉 Готово!",
  ],
  // T13 — текст диалога «Обновление подписки» (скрин 8).
  [
    "reissue_warning_text",
    "⚠️ Обновление подписки\n\nБот выдаст вам новую подписку с аналогичным сроком действия ✅\nНужно будет заново добавить её в приложение.\n\n❌ Старая подписка перестанет действовать, ее можно удалить из приложения.\n\nВы действительно обновить подписку?",
  ],
  // T14 — текст экрана «Бесплатный прокси для Telegram» (скрин 14).
  [
    "tg_proxy_text",
    "🛡 Бесплатный прокси для Telegram\n\nВ последнее время Telegram работает нестабильно 😔\n\nЧтобы вы всегда могли воспользоваться нашим ботом, мы запустили для вас бесплатный прокси-сервер. 💎\n\nЧто такое прокси?\nЭто сетевая настройка для Telegram, которая позволяет всегда оставаться на связи.\n- Работает только в Telegram\n- Включается одним нажатием\n- Не влияет на другие приложения\n\n🟢 Для подключения нажмите кнопку Ниже",
  ],
  // T14 — пустые URL для прокси (админ заполнит сам в админке через раздел настроек бота).
  ["tg_proxy_url_primary", ""],
  ["tg_proxy_url_backup", ""],
  // T11 — пустой URL для «Политики возврата» (Telegraph), админ заполнит.
  ["refund_link", ""],
  // T11 (11.05.2026): приглашение на экране «🎁 Подарить подписку» (скрин 11).
  [
    "gift_intro_text",
    "🤔 Устали смотреть, как мучается Ваш близкий человек?\n\nПодарите ему доступ к нашему VPN 💖\n\n🎁 После оплаты придёт доступ, который вам останется лишь переслать человеку, которому вы хотите его подарить! 🤗",
  ],
];

export async function ensureSystemSettings() {
  for (const [key, value] of DEFAULTS) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }
  await seedEnglishPack();
  await seedMarketplaceCategories();
}

const MARKETPLACE_CATEGORIES: Array<{
  slug: string;
  labelRu: string;
  labelEn: string;
  icon: string;
  sortOrder: number;
}> = [
  { slug: "vpn-servers",     labelRu: "VPN-серверы",          labelEn: "VPN servers",         icon: "Server",      sortOrder: 10 },
  { slug: "ipv4-proxy",      labelRu: "IPv4 / IPv6 прокси",   labelEn: "IPv4 / IPv6 proxies", icon: "Globe",       sortOrder: 20 },
  { slug: "residential",     labelRu: "Резидентские прокси",  labelEn: "Residential proxies", icon: "Network",     sortOrder: 30 },
  { slug: "ready-panels",    labelRu: "Готовые панели",       labelEn: "Turn-key panels",     icon: "LayoutGrid",  sortOrder: 40 },
  { slug: "branding",        labelRu: "Брендинг и дизайн",    labelEn: "Branding & design",   icon: "Palette",     sortOrder: 50 },
  { slug: "marketing",       labelRu: "Маркетинг и трафик",   labelEn: "Marketing & traffic", icon: "Megaphone",   sortOrder: 60 },
  { slug: "support",         labelRu: "Поддержка и настройка", labelEn: "Support & setup",    icon: "LifeBuoy",    sortOrder: 70 },
  { slug: "software",        labelRu: "Софт и боты",          labelEn: "Software & bots",     icon: "Cpu",         sortOrder: 80 },
  { slug: "other",           labelRu: "Прочее",               labelEn: "Other",               icon: "Sparkles",    sortOrder: 999 },
];

async function seedMarketplaceCategories() {
  try {
    for (const c of MARKETPLACE_CATEGORIES) {
      await prisma.marketplaceCategory.upsert({
        where: { slug: c.slug },
        create: c,
        update: {
          // апдейтим только sortOrder/icon, ярлыки могли быть переименованы вручную в UI
          sortOrder: c.sortOrder,
          icon: c.icon,
        },
      });
    }
  } catch (e) {
    console.warn("[seed] marketplace categories skip:", e instanceof Error ? e.message : e);
  }
}

async function seedEnglishPack() {
  const existing = await prisma.systemSetting.findUnique({ where: { key: "lang_pack_en" } });
  if (existing) return;
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(dir, "../i18n/en.json"),
      resolve(dir, "../../../frontend/src/i18n/locales/en.json"),
    ];
    let data: string | null = null;
    for (const p of candidates) {
      try { data = readFileSync(p, "utf-8"); break; } catch { /* next */ }
    }
    if (!data) { console.warn("[seed] en.json not found, skip"); return; }
    JSON.parse(data);
    await prisma.systemSetting.create({ data: { key: "lang_pack_en", value: data } });
    console.log("[seed] English language pack seeded");
  } catch (e) {
    console.warn("[seed] Could not seed English pack:", e instanceof Error ? e.message : e);
  }
}
